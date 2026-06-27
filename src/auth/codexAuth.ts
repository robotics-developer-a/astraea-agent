// Codex credential storage + refresh —— OAuth access/refresh token persisted to ~/.astraea/auth.json,
// auto-renewed via refresh_token before expiry (single-flight, prevents concurrent sub-agents from refreshing redundantly).
//
// File structure (aligned with pi, reserving room for other oauth providers):
//   { "openai-codex": { type, access, refresh, expires, accountId } }

import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { homedir } from 'os'
import {
  ACCOUNT_ID_CLAIM,
  CLIENT_ID,
  TOKEN_URL,
  buildUserAgent,
} from './codexConstants'

export interface CodexCredentials {
  type: 'oauth'
  access: string
  refresh: string
  expires: number // epoch ms; point in time when the access token expires
  accountId: string
}

// Key for the codex credentials in auth.json (other oauth providers can add sibling keys later).
const CODEX_KEY = 'openai-codex'

export const authPath = join(homedir(), '.astraea', 'auth.json')

// Refresh ahead of time once within this margin of the access token's expiry (avoids boundary races).
const REFRESH_SKEW_MS = 60_000

function readAuthFile(path: string): Record<string, unknown> | null {
  try {
    return JSON.parse(readFileSync(path, 'utf-8'))
  } catch {
    // File missing / corrupt JSON → treat as not logged in
    return null
  }
}

// The path parameter exists only for testability (defaults to the real authPath); production callers always use the default.
export function loadCodexCredentials(path: string = authPath): CodexCredentials | null {
  const data = readAuthFile(path)
  const entry = data?.[CODEX_KEY] as Partial<CodexCredentials> | undefined
  if (!entry || entry.type !== 'oauth') return null
  if (!entry.access || !entry.refresh || !entry.accountId || typeof entry.expires !== 'number') {
    return null
  }
  return {
    type: 'oauth',
    access: entry.access,
    refresh: entry.refresh,
    expires: entry.expires,
    accountId: entry.accountId,
  }
}

export function saveCodexCredentials(creds: CodexCredentials, path: string = authPath): void {
  mkdirSync(dirname(path), { mode: 0o700, recursive: true })
  // Preserve other providers' entries in auth.json (only overwrite the codex block).
  const existing = readAuthFile(path) ?? {}
  existing[CODEX_KEY] = creds
  // Tighten permissions to 0600 immediately after the synchronous write (avoids a race between async Bun.write and chmodSync).
  writeFileSync(path, JSON.stringify(existing, null, 2))
  chmodSync(path, 0o600)
  // Update the in-memory cache after persisting so the next getValidAccessToken reads the latest value.
  _cached = creds
}

// The access token is a JWT: base64url(header).base64url(payload).signature.
// accountId lives under a custom claim in the payload.
export function extractAccountId(jwt: string): string {
  const parts = jwt.split('.')
  if (parts.length < 2) throw new Error('Malformed access token (not a JWT)')
  const payloadRaw = parts[1]!
  // JWT uses base64url; restore padding then decode with Buffer.
  const padded = payloadRaw.replace(/-/g, '+').replace(/_/g, '/')
  const payload = JSON.parse(Buffer.from(padded, 'base64').toString('utf-8'))
  const claim = payload[ACCOUNT_ID_CLAIM]
  const accountId = claim?.chatgpt_account_id
  if (!accountId || typeof accountId !== 'string') {
    throw new Error('access token missing chatgpt_account_id claim')
  }
  return accountId
}

// ─── Refresh ─────────────────────────────────────────────────────────────────────

interface TokenResponse {
  access_token: string
  refresh_token?: string
  expires_in: number
}

export async function refreshToken(refresh: string): Promise<CodexCredentials> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refresh,
    client_id: CLIENT_ID,
  })
  const resp = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': buildUserAgent(),
    },
    body: body.toString(),
  })
  if (resp.status === 401) {
    throw new Error('Codex session expired — run /login to re-authenticate.')
  }
  if (!resp.ok) {
    const text = await resp.text().catch(() => '')
    throw new Error(`Codex token refresh failed (${resp.status}): ${text.slice(0, 200)}`)
  }
  const data = (await resp.json()) as TokenResponse
  const access = data.access_token
  // Some implementations don't return a new refresh_token on refresh —— reuse the old one.
  const newRefresh = data.refresh_token || refresh
  return {
    type: 'oauth',
    access,
    refresh: newRefresh,
    expires: Date.now() + data.expires_in * 1000,
    accountId: extractAccountId(access),
  }
}

// ─── Get a valid token (single-flight) ─────────────────────────────────────────────────────

let _cached: CodexCredentials | null = null
let _inFlight: Promise<CodexCredentials> | null = null

// The path parameter exists only for testability (defaults to the real authPath); production callers always use the default.
export async function getValidAccessToken(
  path: string = authPath,
): Promise<{ access: string; accountId: string }> {
  const creds = _cached ?? loadCodexCredentials(path)
  if (!creds) {
    throw new Error('Not logged in to Codex — run /login and choose OpenAI Codex.')
  }
  _cached = creds

  // Still within validity (including the head start) → use it directly.
  if (Date.now() < creds.expires - REFRESH_SKEW_MS) {
    return { access: creds.access, accountId: creds.accountId }
  }

  // A refresh is already in flight → reuse the same promise (concurrent sub-agents don't refresh redundantly).
  if (!_inFlight) {
    _inFlight = refreshToken(creds.refresh)
      .then((fresh) => {
        saveCodexCredentials(fresh, path) // synchronously persist to disk and update _cached
        return fresh
      })
      .finally(() => {
        _inFlight = null
      })
  }
  const fresh = await _inFlight
  return { access: fresh.access, accountId: fresh.accountId }
}

// Clear the in-memory cache when switching providers / re-logging in, so the next call re-reads from disk.
export function clearCodexTokenCache(): void {
  _cached = null
  _inFlight = null
}
