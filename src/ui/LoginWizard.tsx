// /login 交互式配置向导 — 分步选择 provider → model → API Key
// Codex (ChatGPT subscription) takes a branching flow: provider → model → login method (browser / device code) → OAuth.
import React, { useState, useEffect } from 'react'
import { Box, Text, useInput } from 'ink'
import TextInput from './TextInput'
import { config, type Provider } from '../config'
import { t } from '../i18n'
import { INDIGO, SILVER } from './theme'
import { loginBrowser, loginDeviceCode } from '../auth/codexOAuth'

const DIM = '#7A8AAA'
const GREEN = '#5AF78E'

// ─── 数据 ────────────────────────────────────────────────────────────────────

interface ProviderOption {
  label: string
  value: Exclude<Provider, 'ollama'>
  hint: string
}

const PROVIDERS: ProviderOption[] = [
  { label: 'Anthropic', value: 'anthropic', hint: 'claude-opus / sonnet / haiku' },
  { label: 'DeepSeek', value: 'deepseek', hint: 'V4 chat · R1 reasoning' },
  { label: 'Kimi (Moonshot)', value: 'kimi', hint: 'kimi-k2 · 256K context' },
  { label: 'OpenAI (GPT)', value: 'openai', hint: 'gpt-5.5 · gpt-5.4 · o3' },
  { label: 'OpenAI Codex (ChatGPT sub)', value: 'codex', hint: 'gpt-5.x · subscription OAuth' },
]

interface ModelOption { label: string; value: string; hint: string }

// hint 存 i18n key（运行时 t() 解析），不存翻译文本。
const MODELS: Record<Exclude<Provider, 'ollama'>, ModelOption[]> = {
  anthropic: [
    { label: 'claude-opus-4-7', value: 'claude-opus-4-7', hint: 'mStrongest' },
    { label: 'claude-sonnet-4-6', value: 'claude-sonnet-4-6', hint: 'mRecommended' },
    { label: 'claude-haiku-4-5', value: 'claude-haiku-4-5-20251001', hint: 'mFast' },
  ],
  deepseek: [
    { label: 'deepseek-v4-flash', value: 'deepseek-v4-flash', hint: 'mDsFlash' },
    { label: 'deepseek-v4-pro', value: 'deepseek-v4-pro', hint: 'mDsPro' },
    { label: 'deepseek-chat', value: 'deepseek-chat', hint: 'mDsChat' },
    { label: 'deepseek-reasoner', value: 'deepseek-reasoner', hint: 'mDsReasoner' },
  ],
  kimi: [
    { label: 'kimi-k2-0905-preview', value: 'kimi-k2-0905-preview', hint: 'mKimiK2' },
    { label: 'kimi-k2-turbo-preview', value: 'kimi-k2-turbo-preview', hint: 'mKimiTurbo' },
    { label: 'kimi-latest', value: 'kimi-latest', hint: 'mKimiLatest' },
    { label: 'moonshot-v1-128k', value: 'moonshot-v1-128k', hint: 'mMoonshot128' },
  ],
  openai: [
    { label: 'gpt-5.5', value: 'gpt-5.5', hint: 'mGpt55' },
    { label: 'gpt-5.4', value: 'gpt-5.4', hint: 'mGpt54' },
    { label: 'gpt-5.4-mini', value: 'gpt-5.4-mini', hint: 'mGpt54mini' },
    { label: 'gpt-4o', value: 'gpt-4o', hint: 'mGpt4o' },
    { label: 'o3', value: 'o3', hint: 'mO3' },
  ],
  codex: [
    { label: 'gpt-5.5', value: 'gpt-5.5', hint: 'mGpt55' },
    { label: 'gpt-5.4', value: 'gpt-5.4', hint: 'mGpt54' },
    { label: 'gpt-5.4-mini', value: 'gpt-5.4-mini', hint: 'mGpt54mini' },
    { label: 'gpt-5.3-codex-spark', value: 'gpt-5.3-codex-spark', hint: 'mGpt53spark' },
  ],
}

// ─── 类型 ────────────────────────────────────────────────────────────────────

export interface LoginResult {
  provider: Exclude<Provider, 'ollama'>
  model: string
  apiKey: string
}

interface Props {
  onDone: (result: LoginResult | null) => void
}

type Step = 'provider' | 'model' | 'credential' | 'apikey' | 'loginMethod' | 'oauthRunning'

const LOGIN_METHODS = [
  { label: 'Browser', hint: 'opens a browser tab (desktop)' },
  { label: 'Device code', hint: 'enter a code on another device (headless / SSH)' },
] as const

// ─── 子组件：列表选择行 ────────────────────────────────────────────────────────

function ListRow({ label, hint, active }: { label: string; hint: string; active: boolean }) {
  return (
    <Box>
      <Text color={active ? INDIGO : DIM}>{active ? '❯ ' : '  '}</Text>
      <Text color={active ? SILVER : DIM} bold={active}>{label.padEnd(18)}</Text>
      <Text color={DIM}>{hint}</Text>
    </Box>
  )
}

// ─── 向导主体 ─────────────────────────────────────────────────────────────────

export function LoginWizard({ onDone }: Props): React.ReactNode {
  const [step, setStep] = useState<Step>('provider')
  const [providerIdx, setProviderIdx] = useState(0)
  const [modelIdx, setModelIdx] = useState(0)
  const [credentialIdx, setCredentialIdx] = useState(0)
  const [provider, setProvider] = useState<Exclude<Provider, 'ollama'>>('anthropic')
  const [model, setModel] = useState('')
  const [apiKey, setApiKey] = useState('')
  // Codex OAuth progress state
  const [oauthMethod, setOauthMethod] = useState<'browser' | 'device' | null>(null)
  const [oauthStatus, setOauthStatus] = useState('')
  const [authUrl, setAuthUrl] = useState('')
  const [deviceInfo, setDeviceInfo] = useState<{ userCode: string; verificationUri: string } | null>(null)
  const [oauthError, setOauthError] = useState<string | null>(null)

  const models = MODELS[provider]
  const providerLabel = PROVIDERS.find(p => p.value === provider)?.label ?? provider
  // INTENT: Credential reuse is provider-scoped, so switching models never borrows another provider's secret.
  // codex has no apiKey field (credentials live in auth.json); use an empty-string placeholder to avoid reading undefined.
  const existingApiKey = provider === 'codex' ? '' : config[provider].apiKey

  // Codex OAuth flow: once in the oauthRunning step, start login via the chosen method and call onDone when complete.
  useEffect(() => {
    if (step !== 'oauthRunning' || !oauthMethod) return
    const controller = new AbortController()
    let cancelled = false
    ;(async () => {
      try {
        if (oauthMethod === 'browser') {
          setOauthStatus('Waiting for browser… complete the sign-in there.')
          await loginBrowser({
            signal: controller.signal,
            onAuthUrl: (url) => { if (!cancelled) setAuthUrl(url) },
          })
        } else {
          setOauthStatus('Requesting device code…')
          await loginDeviceCode({
            signal: controller.signal,
            onUserCode: (info) => {
              if (cancelled) return
              setDeviceInfo(info)
              setOauthStatus('Enter the code at the URL below, then waiting for approval…')
            },
          })
        }
        if (!cancelled) onDone({ provider: 'codex', model, apiKey: '' })
      } catch (e) {
        if (!cancelled) setOauthError(e instanceof Error ? e.message : String(e))
      }
    })()
    return () => {
      cancelled = true
      controller.abort()
    }
    // model is already set before this step, so it needn't be a dependency; onDone is a stable reference from the parent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, oauthMethod])

  useInput((_, key) => {
    // ESC 始终取消
    if (key.escape) {
      onDone(null)
      return
    }

    // apikey 步骤：只处理 ESC，其余交给 TextInput
    if (step === 'apikey') return
    // OAuth in progress: accept no keys other than ESC (handled above).
    if (step === 'oauthRunning') return

    if (key.upArrow) {
      if (step === 'provider') setProviderIdx(i => Math.max(0, i - 1))
      else if (step === 'model') setModelIdx(i => Math.max(0, i - 1))
      else setCredentialIdx(i => Math.max(0, i - 1))
    } else if (key.downArrow) {
      if (step === 'provider') setProviderIdx(i => Math.min(PROVIDERS.length - 1, i + 1))
      else if (step === 'model') setModelIdx(i => Math.min(models.length - 1, i + 1))
      else setCredentialIdx(i => Math.min(1, i + 1))
    } else if (key.return) {
      if (step === 'provider') {
        const chosen = PROVIDERS[providerIdx]!
        setProvider(chosen.value)
        setModelIdx(0)
        setStep('model')
      } else if (step === 'model') {
        setModel(models[modelIdx]!.value)
        setCredentialIdx(0)
        // codex goes through OAuth login-method selection, not API key paste.
        if (provider === 'codex') setStep('loginMethod')
        else setStep(existingApiKey ? 'credential' : 'apikey')
      } else if (step === 'loginMethod') {
        setOauthError(null)
        setOauthMethod(credentialIdx === 0 ? 'browser' : 'device')
        setStep('oauthRunning')
      } else if (step === 'credential') {
        if (credentialIdx === 0) onDone({ provider, model, apiKey: existingApiKey })
        else setStep('apikey')
      }
    }
  })

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={INDIGO}
      paddingX={2}
      paddingY={1}
      marginBottom={1}
      width={62}
    >
      {/* 标题 */}
      <Box marginBottom={1}>
        <Text color={INDIGO} bold>✦ </Text>
        <Text color={SILVER} bold>Astraea /login</Text>
        <Text color={DIM}> {t('loginTitleSuffix')}</Text>
      </Box>

      {/* Step 1: 选择 Provider */}
      {step === 'provider' && (
        <>
          <Text color={SILVER}>{t('loginSelectProvider')}</Text>
          <Box flexDirection="column" marginY={1}>
            {PROVIDERS.map((p, i) => (
              <ListRow key={p.value} label={p.label} hint={p.hint} active={i === providerIdx} />
            ))}
          </Box>
          <Text color={DIM}>{t('navHint')}</Text>
        </>
      )}

      {/* Step 2: 选择 Model */}
      {step === 'model' && (
        <>
          <Box>
            <Text color={DIM}>{t('labelProvider')} </Text>
            <Text color={SILVER}>{providerLabel}</Text>
          </Box>
          <Text color={SILVER}>{t('loginSelectModel')}</Text>
          <Box flexDirection="column" marginY={1}>
            {models.map((m, i) => (
              <ListRow key={m.value} label={m.label} hint={t(m.hint)} active={i === modelIdx} />
            ))}
          </Box>
          <Text color={DIM}>{t('navHint')}</Text>
        </>
      )}

      {/* Step 3: 已配置该 Provider 时选择复用或替换凭据 */}
      {step === 'credential' && (
        <>
          <Box>
            <Text color={DIM}>{t('labelProvider')} </Text>
            <Text color={SILVER}>{providerLabel}</Text>
          </Box>
          <Box marginBottom={1}>
            <Text color={DIM}>{t('labelModel')} </Text>
            <Text color={SILVER}>{model}</Text>
          </Box>
          <Text color={SILVER}>{t('loginSelectCredential')}</Text>
          <Box flexDirection="column" marginY={1}>
            <ListRow label={t('loginReuseApiKey')} hint={t('loginReuseApiKeyHint')} active={credentialIdx === 0} />
            <ListRow label={t('loginNewApiKey')} hint={t('loginNewApiKeyHint')} active={credentialIdx === 1} />
          </Box>
          <Text color={DIM}>{t('navHint')}</Text>
        </>
      )}

      {/* Codex: choose login method (browser / device code) */}
      {step === 'loginMethod' && (
        <>
          <Box>
            <Text color={DIM}>{t('labelProvider')} </Text>
            <Text color={SILVER}>{providerLabel}</Text>
          </Box>
          <Box marginBottom={1}>
            <Text color={DIM}>{t('labelModel')} </Text>
            <Text color={SILVER}>{model}</Text>
          </Box>
          <Text color={SILVER}>Choose login method:</Text>
          <Box flexDirection="column" marginY={1}>
            {LOGIN_METHODS.map((m, i) => (
              <ListRow key={m.label} label={m.label} hint={m.hint} active={i === credentialIdx} />
            ))}
          </Box>
          <Text color={DIM}>{t('navHint')}</Text>
        </>
      )}

      {/* Codex: OAuth in progress (shows status / device code / errors) */}
      {step === 'oauthRunning' && (
        <>
          <Box marginBottom={1}>
            <Text color={DIM}>{t('labelProvider')} </Text>
            <Text color={SILVER}>{providerLabel}</Text>
            <Text color={DIM}>  ·  {model}</Text>
          </Box>
          {oauthError ? (
            <>
              <Text color="#FF6B6B">✗ {oauthError}</Text>
              <Box marginTop={1}><Text color={DIM}>Press Esc to close, then run /login to retry.</Text></Box>
            </>
          ) : (
            <>
              <Text color={GREEN}>{oauthStatus || 'Starting…'}</Text>
              {deviceInfo && (
                <Box flexDirection="column" marginTop={1}>
                  <Box>
                    <Text color={DIM}>Code: </Text>
                    <Text color={SILVER} bold>{deviceInfo.userCode}</Text>
                  </Box>
                  {deviceInfo.verificationUri && (
                    <Box>
                      <Text color={DIM}>URL:  </Text>
                      <Text color={SILVER}>{deviceInfo.verificationUri}</Text>
                    </Box>
                  )}
                </Box>
              )}
              {authUrl && !deviceInfo && (
                <Box flexDirection="column" marginTop={1}>
                  <Text color={DIM}>If the browser didn't open, visit:</Text>
                  <Text color={SILVER}>{authUrl}</Text>
                </Box>
              )}
              <Box marginTop={1}><Text color={DIM}>Press Esc to cancel.</Text></Box>
            </>
          )}
        </>
      )}

      {/* Step 4: 输入 API Key */}
      {step === 'apikey' && (
        <>
          <Box>
            <Text color={DIM}>{'Provider:  '}</Text>
            <Text color={SILVER}>{providerLabel}</Text>
          </Box>
          <Box marginBottom={1}>
            <Text color={DIM}>{'Model:     '}</Text>
            <Text color={SILVER}>{model}</Text>
          </Box>
          <Box>
            <Text color={SILVER}>{'API Key:   '}</Text>
            <TextInput
              value={apiKey}
              onChange={setApiKey}
              mask="*"
              enablePaste
              placeholder={t('loginApiKeyPlaceholder')}
              onSubmit={(val) => {
                if (val.trim()) onDone({ provider, model, apiKey: val.trim() })
              }}
            />
          </Box>
          <Box marginTop={1}>
            <Text color={DIM}>{t('saveHint')}</Text>
          </Box>
        </>
      )}
    </Box>
  )
}

// ─── 成功提示（在历史中显示） ─────────────────────────────────────────────────

export function formatLoginSuccess(result: LoginResult): string {
  // codex has no API key (OAuth credentials in ~/.astraea/auth.json); show a separate notice.
  if (result.provider === 'codex') {
    return `✓ ${t('loginSavedTitle')}\n  Provider: ${result.provider}\n  Model:    ${result.model}\n  Auth:     ChatGPT subscription (OAuth → ~/.astraea/auth.json)`
  }
  const masked = result.apiKey.length > 8
    ? result.apiKey.slice(0, 4) + '***' + result.apiKey.slice(-4)
    : '***'
  return `✓ ${t('loginSavedTitle')}\n  Provider: ${result.provider}\n  Model:    ${result.model}\n  API Key:  ${masked}`
}
