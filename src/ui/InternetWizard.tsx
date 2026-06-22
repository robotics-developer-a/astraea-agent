// /internet 交互式配置向导 — 选择搜索 provider → 粘贴 API Key → 自动保存
// 结构对仗 /login（LoginWizard）：login 配"大脑"(LLM)，internet 配"眼睛"(联网搜索)。
import React, { useState } from 'react'
import { Box, Text, useInput } from 'ink'
import TextInput from './TextInput'
import { SEARCH_PROVIDERS, activeSearchProvider } from '../config'
import { t } from '../i18n'
import { INDIGO, SILVER } from './theme'

const DIM = '#7A8AAA'
const GREEN = '#5AF78E'

// ─── 类型 ────────────────────────────────────────────────────────────────────

export interface InternetResult {
  provider: string   // SearchProviderMeta.id
  apiKey: string
}

interface Props {
  onDone: (result: InternetResult | null) => void
}

type Step = 'provider' | 'apikey'

// ─── 子组件：列表选择行 ────────────────────────────────────────────────────────

function ListRow({ label, hint, active }: { label: string; hint: string; active: boolean }) {
  return (
    <Box>
      <Text color={active ? INDIGO : DIM}>{active ? '❯ ' : '  '}</Text>
      <Text color={active ? SILVER : DIM} bold={active}>{label.padEnd(16)}</Text>
      <Text color={DIM}>{hint}</Text>
    </Box>
  )
}

// ─── 向导主体 ─────────────────────────────────────────────────────────────────

export function InternetWizard({ onDone }: Props): React.ReactNode {
  const [step, setStep] = useState<Step>('provider')
  const [providerIdx, setProviderIdx] = useState(0)
  const [apiKey, setApiKey] = useState('')

  const chosen = SEARCH_PROVIDERS[providerIdx]!
  const current = activeSearchProvider()

  useInput((_, key) => {
    // ESC 始终取消
    if (key.escape) {
      onDone(null)
      return
    }

    // apikey 步骤：只处理 ESC，其余交给 TextInput
    if (step === 'apikey') return

    if (key.upArrow) {
      setProviderIdx(i => Math.max(0, i - 1))
    } else if (key.downArrow) {
      setProviderIdx(i => Math.min(SEARCH_PROVIDERS.length - 1, i + 1))
    } else if (key.return) {
      setApiKey('')
      setStep('apikey')
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
        <Text color={SILVER} bold>Astraea /internet</Text>
        <Text color={DIM}> {t('netTitleSuffix')}</Text>
      </Box>

      {/* 当前状态提示 */}
      <Box marginBottom={1}>
        <Text color={DIM}>{t('netCurrent')}</Text>
        <Text color={current ? GREEN : DIM}>
          {current ? `${current.label}${t('netConfigured')}` : t('netNotConfigured')}
        </Text>
      </Box>

      {/* Step 1: 选择 Provider */}
      {step === 'provider' && (
        <>
          <Text color={SILVER}>{t('netSelect')}</Text>
          <Box flexDirection="column" marginY={1}>
            {SEARCH_PROVIDERS.map((p, i) => (
              <ListRow key={p.id} label={p.label} hint={t(p.hintKey)} active={i === providerIdx} />
            ))}
          </Box>
          <Text color={DIM}>{t('navHint')}</Text>
        </>
      )}

      {/* Step 2: 输入 API Key */}
      {step === 'apikey' && (
        <>
          <Box>
            <Text color={DIM}>{'Provider:  '}</Text>
            <Text color={SILVER}>{chosen.label}</Text>
          </Box>
          <Box marginBottom={1}>
            <Text color={DIM}>{t('netGetKey')}</Text>
            <Text color={INDIGO}>{chosen.signupUrl}</Text>
          </Box>
          <Box>
            <Text color={SILVER}>{'API Key:   '}</Text>
            <TextInput
              value={apiKey}
              onChange={setApiKey}
              mask="*"
              enablePaste
              placeholder={t('netApiKeyPlaceholder')}
              onSubmit={(val) => {
                if (val.trim()) onDone({ provider: chosen.id, apiKey: val.trim() })
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

export function formatInternetSuccess(result: InternetResult): string {
  const meta = SEARCH_PROVIDERS.find(p => p.id === result.provider)
  const masked = result.apiKey.length > 8
    ? result.apiKey.slice(0, 4) + '***' + result.apiKey.slice(-4)
    : '***'
  return [
    `✓ ${t('netSavedTitle')}`,
    `  Provider: ${meta?.label ?? result.provider}`,
    `  API Key:  ${masked}`,
    `  ${t('netSavedHint')}`,
  ].join('\n')
}
