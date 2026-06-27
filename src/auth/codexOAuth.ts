// Codex login flow —— self-contained OAuth (PKCE), no dependency on the official codex CLI.
// Two methods:
//   loginBrowser     —— spins up a local 127.0.0.1:1455 callback server, opens the browser to complete authorization (desktop).
//   loginDeviceCode  —— device-code polling, shows user_code + URL, user completes it elsewhere (headless/SSH).

import { createHash, randomBytes } from 'crypto'
import { spawn } from 'child_process'
import { platform } from 'os'
import {
  AUTHORIZE_URL,
  BROWSER_REDIRECT_URI,
  CALLBACK_PATH,
  CALLBACK_PORT,
  CLIENT_ID,
  DEVICE_REDIRECT_URI,
  DEVICE_TOKEN_URL,
  DEVICE_USERCODE_URL,
  SCOPE,
  TOKEN_URL,
  buildUserAgent,
} from './codexConstants'
import {
  extractAccountId,
  saveCodexCredentials,
  type CodexCredentials,
} from './codexAuth'

// ─── PKCE helpers ─────────────────────────────────────────────────────────────

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function generateVerifier(): string {
  return base64url(randomBytes(32))
}

export function challengeS256(verifier: string): string {
  return base64url(createHash('sha256').update(verifier).digest())
}

export function randomState(): string {
  return base64url(randomBytes(32))
}

// ─── Token exchange ───────────────────────────────────────────────────────────

interface TokenResponse {
  access_token: string
  refresh_token: string
  expires_in: number
}

// authorization_code → token (shared by browser / device-code flows, only redirect_uri differs).
async function exchangeCode(params: {
  code: string
  verifier: string
  redirectUri: string
}): Promise<CodexCredentials> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: params.code,
    redirect_uri: params.redirectUri,
    client_id: CLIENT_ID,
    code_verifier: params.verifier,
  })
  const resp = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': buildUserAgent(),
    },
    body: body.toString(),
  })
  if (!resp.ok) {
    const text = await resp.text().catch(() => '')
    throw new Error(`Token exchange failed (${resp.status}): ${text.slice(0, 200)}`)
  }
  const data = (await resp.json()) as TokenResponse
  const access = data.access_token
  return {
    type: 'oauth',
    access,
    refresh: data.refresh_token,
    expires: Date.now() + data.expires_in * 1000,
    accountId: extractAccountId(access),
  }
}

function buildAuthorizeUrl(opts: {
  challenge: string
  state: string
  redirectUri: string
}): string {
  const q = new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT_ID,
    redirect_uri: opts.redirectUri,
    scope: SCOPE,
    code_challenge: opts.challenge,
    code_challenge_method: 'S256',
    state: opts.state,
  })
  return `${AUTHORIZE_URL}?${q.toString()}`
}

// Per-platform "open URL" command; never throws on failure (user can copy the URL manually).
function openInBrowser(url: string): void {
  const cmd = platform() === 'darwin' ? 'open' : platform() === 'win32' ? 'start' : 'xdg-open'
  try {
    const child = spawn(cmd, [url], { stdio: 'ignore', detached: true, shell: platform() === 'win32' })
    child.on('error', () => {})
    child.unref()
  } catch {
    // Ignore: the caller has already printed the URL for the user
  }
}

// ─── Browser login ────────────────────────────────────────────────────────────

export interface BrowserLoginOptions {
  // Notifies the caller of the authorize URL (for the UI to display). Whether or not it is provided, this function still tries to open the browser automatically.
  onAuthUrl?: (url: string) => void
  // Cancellation signal (user presses ESC to exit the wizard) → close the local callback server, release the port.
  signal?: AbortSignal
}

export async function loginBrowser(options: BrowserLoginOptions = {}): Promise<CodexCredentials> {
  const verifier = generateVerifier()
  const challenge = challengeS256(verifier)
  const state = randomState()
  const authorizeUrl = buildAuthorizeUrl({ challenge, state, redirectUri: BROWSER_REDIRECT_URI })

  // Use a promise to surface the callback result at the await point.
  let resolveCode!: (code: string) => void
  let rejectCode!: (err: Error) => void
  const codePromise = new Promise<string>((resolve, reject) => {
    resolveCode = resolve
    rejectCode = reject
  })

  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: CALLBACK_PORT,
    fetch(req) {
      const url = new URL(req.url)
      if (url.pathname !== CALLBACK_PATH) {
        return new Response('Not found', { status: 404 })
      }
      const err = url.searchParams.get('error')
      if (err) {
        rejectCode(new Error(`Authorization denied: ${err}`))
        return htmlResponse('Authorization failed. You can close this tab.')
      }
      const code = url.searchParams.get('code')
      const returnedState = url.searchParams.get('state')
      if (!code) {
        rejectCode(new Error('Callback missing authorization code'))
        return htmlResponse('Authorization failed (no code). You can close this tab.')
      }
      if (returnedState !== state) {
        rejectCode(new Error('State mismatch — possible CSRF, aborting login'))
        return htmlResponse('Authorization failed (state mismatch). You can close this tab.')
      }
      resolveCode(code)
      return htmlResponse('✓ Astraea is now signed in to Codex. You can close this tab and return to the terminal.')
    },
  })

  // Cancellation signal → reject the pending promise, triggering server.stop in the finally block.
  if (options.signal) {
    if (options.signal.aborted) rejectCode(new Error('Login cancelled'))
    else options.signal.addEventListener('abort', () => rejectCode(new Error('Login cancelled')), { once: true })
  }

  try {
    options.onAuthUrl?.(authorizeUrl)
    openInBrowser(authorizeUrl)

    // Must complete within 15 minutes, otherwise it times out.
    const code = await withTimeout(codePromise, 15 * 60 * 1000, 'Browser login timed out')
    const creds = await exchangeCode({ code, verifier, redirectUri: BROWSER_REDIRECT_URI })
    saveCodexCredentials(creds)
    return creds
  } finally {
    server.stop(true)
  }
}

function htmlResponse(message: string): Response {
  return new Response(
    `<!doctype html><html><head><meta charset="utf-8"><title>Astraea</title></head><body style="font-family:system-ui;background:#10131a;color:#e6e9f0;display:flex;align-items:center;justify-content:center;height:100vh;margin:0"><p style="font-size:1.1rem">${message}</p></body></html>`,
    { headers: { 'Content-Type': 'text/html; charset=utf-8' } },
  )
}

// ─── Device-code login ────────────────────────────────────────────────────────

interface UserCodeResponse {
  device_code?: string
  user_code: string
  verification_uri?: string
  verification_url?: string
  verification_uri_complete?: string
  expires_in?: number
  interval?: number
}

export interface DeviceLoginOptions {
  // Once the user_code + verification URL are obtained, calls back to the UI to display them.
  onUserCode: (info: { userCode: string; verificationUri: string }) => void
  // Cancellation signal (user presses ESC to exit the wizard) → stop polling.
  signal?: AbortSignal
}

export async function loginDeviceCode(options: DeviceLoginOptions): Promise<CodexCredentials> {
  const verifier = generateVerifier()
  const challenge = challengeS256(verifier)

  // Request a device code —— also carries the PKCE challenge, replaying the verifier in the final exchange.
  const startBody = new URLSearchParams({
    client_id: CLIENT_ID,
    scope: SCOPE,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  })
  const startResp = await fetch(DEVICE_USERCODE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': buildUserAgent(),
    },
    body: startBody.toString(),
  })
  if (!startResp.ok) {
    const text = await startResp.text().catch(() => '')
    throw new Error(`Device authorization failed (${startResp.status}): ${text.slice(0, 200)}`)
  }
  const start = (await startResp.json()) as UserCodeResponse
  const verificationUri =
    start.verification_uri_complete || start.verification_uri || start.verification_url || ''
  options.onUserCode({ userCode: start.user_code, verificationUri })

  let intervalMs = (start.interval ?? 5) * 1000
  const deadline = Date.now() + 15 * 60 * 1000

  while (Date.now() < deadline) {
    if (options.signal?.aborted) throw new Error('Login cancelled')
    await sleep(intervalMs)
    if (options.signal?.aborted) throw new Error('Login cancelled')
    const pollBody = new URLSearchParams({
      client_id: CLIENT_ID,
      ...(start.device_code ? { device_code: start.device_code } : {}),
      user_code: start.user_code,
    })
    const pollResp = await fetch(DEVICE_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': buildUserAgent(),
      },
      body: pollBody.toString(),
    })

    // 403 / authorization_pending → user has not approved yet, keep polling.
    if (pollResp.status === 403) continue

    const data = (await pollResp.json().catch(() => ({}))) as Record<string, unknown>
    const errorCode = data.error as string | undefined

    if (errorCode === 'authorization_pending') continue
    if (errorCode === 'slow_down') {
      intervalMs += 5000
      continue
    }
    if (errorCode) {
      throw new Error(`Device login failed: ${errorCode}`)
    }

    // Done: the response carries authorization_code (+ the code_verifier returned by the server).
    const code = (data.authorization_code as string) || (data.code as string)
    const returnedVerifier = (data.code_verifier as string) || verifier
    if (!code) continue // occasional empty response, keep polling

    const creds = await exchangeCode({
      code,
      verifier: returnedVerifier,
      redirectUri: DEVICE_REDIRECT_URI,
    })
    saveCodexCredentials(creds)
    return creds
  }

  throw new Error('Device login timed out (15 min). Run /login to try again.')
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

function withTimeout<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms)
    p.then(
      (v) => {
        clearTimeout(timer)
        resolve(v)
      },
      (e) => {
        clearTimeout(timer)
        reject(e)
      },
    )
  })
}
