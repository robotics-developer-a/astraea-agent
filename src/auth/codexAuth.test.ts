import { test, expect, mock, afterEach, beforeEach } from 'bun:test'
import { mkdtempSync, rmSync, readFileSync, statSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  extractAccountId,
  refreshToken,
  loadCodexCredentials,
  saveCodexCredentials,
  getValidAccessToken,
  clearCodexTokenCache,
  type CodexCredentials,
} from './codexAuth'
import { ACCOUNT_ID_CLAIM } from './codexConstants'

// 构造一个合法 JWT（仅 header.payload.sig，签名不校验）。
function makeJwt(payload: Record<string, unknown>): string {
  const b64 = (o: unknown) =>
    Buffer.from(JSON.stringify(o)).toString('base64').replace(/=+$/, '')
  return `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64(payload)}.sig`
}

test('extractAccountId pulls chatgpt_account_id from the auth claim', () => {
  const jwt = makeJwt({ [ACCOUNT_ID_CLAIM]: { chatgpt_account_id: 'acct_123' }, sub: 'u' })
  expect(extractAccountId(jwt)).toBe('acct_123')
})

test('extractAccountId throws when the claim is absent', () => {
  const jwt = makeJwt({ sub: 'u', email: 'a@b.c' })
  expect(() => extractAccountId(jwt)).toThrow(/chatgpt_account_id/)
})

test('extractAccountId throws on a non-JWT string', () => {
  expect(() => extractAccountId('not-a-jwt')).toThrow(/Malformed/)
})

const originalFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = originalFetch
})

test('refreshToken exchanges refresh for a new access token + recomputed expiry', async () => {
  const newAccess = makeJwt({ [ACCOUNT_ID_CLAIM]: { chatgpt_account_id: 'acct_xyz' } })
  globalThis.fetch = mock(async () =>
    new Response(
      JSON.stringify({ access_token: newAccess, refresh_token: 'r2', expires_in: 3600 }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ),
  ) as unknown as typeof fetch

  const before = Date.now()
  const creds = await refreshToken('r1')
  expect(creds.access).toBe(newAccess)
  expect(creds.refresh).toBe('r2')
  expect(creds.accountId).toBe('acct_xyz')
  expect(creds.expires).toBeGreaterThanOrEqual(before + 3600 * 1000)
})

test('refreshToken keeps the old refresh token when none is returned', async () => {
  const newAccess = makeJwt({ [ACCOUNT_ID_CLAIM]: { chatgpt_account_id: 'acct_xyz' } })
  globalThis.fetch = mock(async () =>
    new Response(JSON.stringify({ access_token: newAccess, expires_in: 60 }), { status: 200 }),
  ) as unknown as typeof fetch

  const creds = await refreshToken('keep-me')
  expect(creds.refresh).toBe('keep-me')
})

test('refreshToken raises a clear re-login error on 401', async () => {
  globalThis.fetch = mock(async () => new Response('unauthorized', { status: 401 })) as unknown as typeof fetch
  await expect(refreshToken('dead')).rejects.toThrow(/session expired.*\/login/i)
})

// ─── 凭据落盘 / 读取（隔离到临时文件，绝不碰真实 ~/.astraea/auth.json）─────────

function tmpAuthFile(): string {
  const dir = mkdtempSync(join(tmpdir(), 'astraea-codex-'))
  return join(dir, 'auth.json')
}

function creds(over: Partial<CodexCredentials> = {}): CodexCredentials {
  return { type: 'oauth', access: 'a', refresh: 'r', expires: 0, accountId: 'acct', ...over }
}

test('save → load round-trips all five fields', () => {
  const file = tmpAuthFile()
  const c = creds({ access: 'tok', refresh: 'ref', expires: 123, accountId: 'acct_9' })
  saveCodexCredentials(c, file)
  expect(loadCodexCredentials(file)).toEqual(c)
  rmSync(file, { force: true })
})

test('saved auth.json is chmod 0600', () => {
  const file = tmpAuthFile()
  saveCodexCredentials(creds(), file)
  expect(statSync(file).mode & 0o777).toBe(0o600)
  rmSync(file, { force: true })
})

test('saving codex preserves other providers’ entries in auth.json', () => {
  const file = tmpAuthFile()
  writeFileSync(file, JSON.stringify({ 'some-other-provider': { token: 'keep-me' } }))
  saveCodexCredentials(creds({ access: 'new' }), file)
  const raw = JSON.parse(readFileSync(file, 'utf-8'))
  expect(raw['some-other-provider']).toEqual({ token: 'keep-me' })
  expect(raw['openai-codex'].access).toBe('new')
  rmSync(file, { force: true })
})

test('loadCodexCredentials returns null on malformed JSON', () => {
  const file = tmpAuthFile()
  writeFileSync(file, 'not json at all')
  expect(loadCodexCredentials(file)).toBeNull()
  rmSync(file, { force: true })
})

test('loadCodexCredentials returns null when required fields are missing', () => {
  const file = tmpAuthFile()
  writeFileSync(file, JSON.stringify({ 'openai-codex': { type: 'oauth', access: 'a' } }))
  expect(loadCodexCredentials(file)).toBeNull()
  rmSync(file, { force: true })
})

test('loadCodexCredentials returns null when the file is absent', () => {
  expect(loadCodexCredentials(join(tmpdir(), 'astraea-codex-does-not-exist', 'auth.json'))).toBeNull()
})

// ─── getValidAccessToken：skew + 单飞刷新 ────────────────────────────────────

beforeEach(() => {
  clearCodexTokenCache() // 清掉上一个测试在内存里留下的凭据
})

const FUTURE = () => Date.now() + 10 * 60_000 // 远未过期
const PAST = () => Date.now() - 1000          // 已过期

test('getValidAccessToken returns the cached token without refreshing when still valid', async () => {
  const file = tmpAuthFile()
  saveCodexCredentials(creds({ access: 'fresh-tok', accountId: 'acct_ok', expires: FUTURE() }), file)
  clearCodexTokenCache()
  globalThis.fetch = mock(async () => { throw new Error('should not refresh') }) as unknown as typeof fetch

  const { access, accountId } = await getValidAccessToken(file)
  expect(access).toBe('fresh-tok')
  expect(accountId).toBe('acct_ok')
  rmSync(file, { force: true })
})

test('getValidAccessToken refreshes when within the 60s expiry skew', async () => {
  const file = tmpAuthFile()
  // 距过期不到 60s（仍在 expires 之前，但落在 skew 窗口内）→ 应触发刷新。
  saveCodexCredentials(creds({ access: 'old', refresh: 'r1', expires: Date.now() + 30_000 }), file)
  clearCodexTokenCache()
  const newAccess = makeJwt({ [ACCOUNT_ID_CLAIM]: { chatgpt_account_id: 'acct_new' } })
  globalThis.fetch = mock(async () =>
    new Response(JSON.stringify({ access_token: newAccess, refresh_token: 'r2', expires_in: 3600 }), { status: 200 }),
  ) as unknown as typeof fetch

  const { access } = await getValidAccessToken(file)
  expect(access).toBe(newAccess)
  // 刷新结果已落盘
  expect(loadCodexCredentials(file)?.access).toBe(newAccess)
  rmSync(file, { force: true })
})

test('concurrent getValidAccessToken calls trigger exactly one refresh (single-flight)', async () => {
  const file = tmpAuthFile()
  saveCodexCredentials(creds({ access: 'expired', refresh: 'r1', expires: PAST() }), file)
  clearCodexTokenCache()
  const newAccess = makeJwt({ [ACCOUNT_ID_CLAIM]: { chatgpt_account_id: 'acct_one' } })
  let calls = 0
  globalThis.fetch = mock(async () => {
    calls++
    await new Promise((r) => setTimeout(r, 20)) // 让并发调用都赶在刷新完成前进入
    return new Response(JSON.stringify({ access_token: newAccess, refresh_token: 'r2', expires_in: 3600 }), { status: 200 })
  }) as unknown as typeof fetch

  const results = await Promise.all(Array.from({ length: 5 }, () => getValidAccessToken(file)))
  expect(calls).toBe(1)
  expect(results.every((r) => r.access === newAccess)).toBe(true)
  rmSync(file, { force: true })
})

test('getValidAccessToken throws a clear error when not logged in', async () => {
  clearCodexTokenCache()
  const missing = join(tmpdir(), 'astraea-codex-none', 'auth.json')
  await expect(getValidAccessToken(missing)).rejects.toThrow(/Not logged in.*\/login/i)
})
