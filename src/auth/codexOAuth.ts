// Codex 登录流程 —— 自包含 OAuth（PKCE），不依赖官方 codex CLI。
// 两种方式：
//   loginBrowser     —— 本地起 127.0.0.1:1455 回调服务器，开浏览器完成授权（桌面）。
//   loginDeviceCode  —— 设备码轮询，显示 user_code + URL，用户在别处完成（headless/SSH）。

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

// ─── PKCE 辅助 ────────────────────────────────────────────────────────────────

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

// ─── 令牌交换 ─────────────────────────────────────────────────────────────────

interface TokenResponse {
  access_token: string
  refresh_token: string
  expires_in: number
}

// authorization_code → token（浏览器 / 设备码共用，仅 redirect_uri 不同）。
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

// 平台对应的「打开 URL」命令；失败不抛（用户可手动复制 URL）。
function openInBrowser(url: string): void {
  const cmd = platform() === 'darwin' ? 'open' : platform() === 'win32' ? 'start' : 'xdg-open'
  try {
    const child = spawn(cmd, [url], { stdio: 'ignore', detached: true, shell: platform() === 'win32' })
    child.on('error', () => {})
    child.unref()
  } catch {
    // 忽略：调用方已把 URL 打印给用户
  }
}

// ─── 浏览器登录 ───────────────────────────────────────────────────────────────

export interface BrowserLoginOptions {
  // 通知调用方授权 URL（供 UI 显示）。无论是否提供，本函数都会尝试自动打开浏览器。
  onAuthUrl?: (url: string) => void
  // 取消信号（用户 ESC 退出向导）→ 关闭本地回调服务器，释放端口。
  signal?: AbortSignal
}

export async function loginBrowser(options: BrowserLoginOptions = {}): Promise<CodexCredentials> {
  const verifier = generateVerifier()
  const challenge = challengeS256(verifier)
  const state = randomState()
  const authorizeUrl = buildAuthorizeUrl({ challenge, state, redirectUri: BROWSER_REDIRECT_URI })

  // 用一个 promise 把回调结果导出到 await 点。
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

  // 取消信号 → 拒绝等待中的 promise，触发 finally 里的 server.stop。
  if (options.signal) {
    if (options.signal.aborted) rejectCode(new Error('Login cancelled'))
    else options.signal.addEventListener('abort', () => rejectCode(new Error('Login cancelled')), { once: true })
  }

  try {
    options.onAuthUrl?.(authorizeUrl)
    openInBrowser(authorizeUrl)

    // 15 分钟内必须完成，否则超时。
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

// ─── 设备码登录 ───────────────────────────────────────────────────────────────

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
  // 拿到 user_code + 验证 URL 后回调给 UI 展示。
  onUserCode: (info: { userCode: string; verificationUri: string }) => void
  // 取消信号（用户 ESC 退出向导）→ 停止轮询。
  signal?: AbortSignal
}

export async function loginDeviceCode(options: DeviceLoginOptions): Promise<CodexCredentials> {
  const verifier = generateVerifier()
  const challenge = challengeS256(verifier)

  // 请求设备码 —— 同样带 PKCE challenge，最终交换时回传 verifier。
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

    // 403 / authorization_pending → 用户还没批准，继续轮询。
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

    // 完成：响应里带 authorization_code（+ 服务端回传的 code_verifier）。
    const code = (data.authorization_code as string) || (data.code as string)
    const returnedVerifier = (data.code_verifier as string) || verifier
    if (!code) continue // 偶发空响应，继续轮询

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

// ─── 小工具 ───────────────────────────────────────────────────────────────────

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
