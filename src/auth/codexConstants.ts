// Codex（ChatGPT 订阅）OAuth + Responses API 常量表。
// 取自 pi 项目（earendil-works/pi）的实测值；改动前请先确认 OpenAI 没有调整端点。

import { arch, platform, release } from 'os'

// OAuth 客户端 id（pi / codex CLI 共用的公开客户端）。
export const CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'

// 申请的 scope —— offline_access 让我们拿到 refresh_token。
export const SCOPE = 'openid profile email offline_access'

// 授权 / 令牌端点（auth.openai.com）。token 端点用 application/x-www-form-urlencoded。
export const AUTHORIZE_URL = 'https://auth.openai.com/oauth/authorize'
export const TOKEN_URL = 'https://auth.openai.com/oauth/token'

// 设备码（headless / SSH）端点。
export const DEVICE_USERCODE_URL = 'https://auth.openai.com/api/accounts/deviceauth/usercode'
export const DEVICE_TOKEN_URL = 'https://auth.openai.com/api/accounts/deviceauth/token'

// 回调地址：浏览器走 localhost:1455，设备码走 auth.openai.com 上的固定页。
export const BROWSER_REDIRECT_URI = 'http://localhost:1455/auth/callback'
export const DEVICE_REDIRECT_URI = 'https://auth.openai.com/deviceauth/callback'

// 浏览器登录本地回调服务器监听端口 / 路径（与 BROWSER_REDIRECT_URI 对应）。
export const CALLBACK_PORT = 1455
export const CALLBACK_PATH = '/auth/callback'

// Responses API 端点（ChatGPT 后端，非 api.openai.com）。
export const CODEX_API_BASE = 'https://chatgpt.com/backend-api'
export const CODEX_RESPONSES_URL = `${CODEX_API_BASE}/codex/responses`

// 请求头里的 originator。
// GOTCHA: 若后端拒绝（4xx）请求，第一件要试的事就是把它改成 'codex_cli_rs'
// ——OpenAI 可能校验该值只接受官方 codex CLI 的标识。
export const ORIGINATOR = 'astraea'

// accountId 藏在 access token（JWT）的自定义 claim 里。
export const ACCOUNT_ID_CLAIM = 'https://api.openai.com/auth'

// User-Agent：astraea (<platform> <release>; <arch>)，与 codex CLI 的格式对齐。
export function buildUserAgent(): string {
  return `astraea (${platform()} ${release()}; ${arch()})`
}
