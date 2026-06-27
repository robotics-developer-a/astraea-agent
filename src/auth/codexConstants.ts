// Codex (ChatGPT subscription) OAuth + Responses API constants table.
// Taken from values verified in the pi project (earendil-works/pi); before changing, first confirm OpenAI has not adjusted the endpoints.

import { arch, platform, release } from 'os'

// OAuth client id (the public client shared by pi / codex CLI).
export const CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'

// Requested scope —— offline_access lets us obtain a refresh_token.
export const SCOPE = 'openid profile email offline_access'

// Authorize / token endpoints (auth.openai.com). The token endpoint uses application/x-www-form-urlencoded.
export const AUTHORIZE_URL = 'https://auth.openai.com/oauth/authorize'
export const TOKEN_URL = 'https://auth.openai.com/oauth/token'

// Device-code (headless / SSH) endpoints.
export const DEVICE_USERCODE_URL = 'https://auth.openai.com/api/accounts/deviceauth/usercode'
export const DEVICE_TOKEN_URL = 'https://auth.openai.com/api/accounts/deviceauth/token'

// Callback addresses: the browser uses localhost:1455, device-code uses a fixed page on auth.openai.com.
export const BROWSER_REDIRECT_URI = 'http://localhost:1455/auth/callback'
export const DEVICE_REDIRECT_URI = 'https://auth.openai.com/deviceauth/callback'

// Listening port / path of the browser-login local callback server (matching BROWSER_REDIRECT_URI).
export const CALLBACK_PORT = 1455
export const CALLBACK_PATH = '/auth/callback'

// Responses API endpoint (the ChatGPT backend, not api.openai.com).
export const CODEX_API_BASE = 'https://chatgpt.com/backend-api'
export const CODEX_RESPONSES_URL = `${CODEX_API_BASE}/codex/responses`

// The originator in the request headers.
// GOTCHA: if the backend rejects (4xx) the request, the first thing to try is changing it to 'codex_cli_rs'
// —— OpenAI may validate this value and only accept the official codex CLI's identifier.
export const ORIGINATOR = 'astraea'

// accountId is hidden in a custom claim of the access token (JWT).
export const ACCOUNT_ID_CLAIM = 'https://api.openai.com/auth'

// User-Agent: astraea (<platform> <release>; <arch>), aligned with the codex CLI's format.
export function buildUserAgent(): string {
  return `astraea (${platform()} ${release()}; ${arch()})`
}
