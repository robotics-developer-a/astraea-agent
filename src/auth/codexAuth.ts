// Codex 凭据存储 + 刷新 —— OAuth access/refresh token 落盘到 ~/.astraea/auth.json，
// 过期前自动用 refresh_token 换新（单飞，防并发子 agent 重复刷新）。
//
// 文件结构（与 pi 对齐，预留其它 oauth provider）：
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
  expires: number // epoch ms；access token 失效时间点
  accountId: string
}

// auth.json 里 codex 凭据的 key（其它 oauth provider 后续可加同级 key）。
const CODEX_KEY = 'openai-codex'

export const authPath = join(homedir(), '.astraea', 'auth.json')

// access token 过期前这个余量内就提前刷新（避免边界竞争）。
const REFRESH_SKEW_MS = 60_000

function readAuthFile(path: string): Record<string, unknown> | null {
  try {
    return JSON.parse(readFileSync(path, 'utf-8'))
  } catch {
    // 文件不存在 / JSON 损坏 → 视为未登录
    return null
  }
}

// path 参数仅为可测性而设（默认即真实 authPath）；生产调用方一律走默认值。
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
  // 保留 auth.json 里其它 provider 的条目（只覆写 codex 这一块）。
  const existing = readAuthFile(path) ?? {}
  existing[CODEX_KEY] = creds
  // 同步写盘后立刻收紧权限到 0600（避免 Bun.write 异步与 chmodSync 的竞态）。
  writeFileSync(path, JSON.stringify(existing, null, 2))
  chmodSync(path, 0o600)
  // 写盘后让内存缓存失效，下次 getValidAccessToken 读到最新值。
  _cached = creds
}

// access token 是 JWT：base64url(header).base64url(payload).signature。
// accountId 在 payload 的自定义 claim 下。
export function extractAccountId(jwt: string): string {
  const parts = jwt.split('.')
  if (parts.length < 2) throw new Error('Malformed access token (not a JWT)')
  const payloadRaw = parts[1]!
  // JWT 用 base64url；补齐 padding 后用 Buffer 解码。
  const padded = payloadRaw.replace(/-/g, '+').replace(/_/g, '/')
  const payload = JSON.parse(Buffer.from(padded, 'base64').toString('utf-8'))
  const claim = payload[ACCOUNT_ID_CLAIM]
  const accountId = claim?.chatgpt_account_id
  if (!accountId || typeof accountId !== 'string') {
    throw new Error('access token missing chatgpt_account_id claim')
  }
  return accountId
}

// ─── 刷新 ─────────────────────────────────────────────────────────────────────

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
  // 部分实现刷新时不回传新 refresh_token —— 沿用旧的。
  const newRefresh = data.refresh_token || refresh
  return {
    type: 'oauth',
    access,
    refresh: newRefresh,
    expires: Date.now() + data.expires_in * 1000,
    accountId: extractAccountId(access),
  }
}

// ─── 取有效 token（单飞）─────────────────────────────────────────────────────

let _cached: CodexCredentials | null = null
let _inFlight: Promise<CodexCredentials> | null = null

// path 参数仅为可测性而设（默认即真实 authPath）；生产调用方一律走默认值。
export async function getValidAccessToken(
  path: string = authPath,
): Promise<{ access: string; accountId: string }> {
  const creds = _cached ?? loadCodexCredentials(path)
  if (!creds) {
    throw new Error('Not logged in to Codex — run /login and choose OpenAI Codex.')
  }
  _cached = creds

  // 仍在有效期内（含提前量）→ 直接用。
  if (Date.now() < creds.expires - REFRESH_SKEW_MS) {
    return { access: creds.access, accountId: creds.accountId }
  }

  // 已有刷新在途 → 复用同一个 promise（并发子 agent 不重复刷新）。
  if (!_inFlight) {
    _inFlight = refreshToken(creds.refresh)
      .then((fresh) => {
        saveCodexCredentials(fresh, path) // 同步落盘并更新 _cached
        return fresh
      })
      .finally(() => {
        _inFlight = null
      })
  }
  const fresh = await _inFlight
  return { access: fresh.access, accountId: fresh.accountId }
}

// 切换 provider / 重新登录时清空内存缓存，让下次调用重新读盘。
export function clearCodexTokenCache(): void {
  _cached = null
  _inFlight = null
}
