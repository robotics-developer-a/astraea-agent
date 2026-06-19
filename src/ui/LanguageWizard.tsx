// /language 交互式选择向导 — 单步：方向键选语言 → Enter 确认。
// 与 /login /internet 同构（配置外部能力的 wizard 家族）。
import React, { useState } from 'react'
import { Box, Text, useInput } from 'ink'
import { LOCALES, getLocale, t } from '../i18n'
import type { Locale } from '../i18n'

const INDIGO = '#6A5ACD'
const SILVER = '#C8D8FF'
const DIM = '#7A8AAA'

interface Props {
  onDone: (locale: Locale | null) => void
}

export function LanguageWizard({ onDone }: Props): React.ReactNode {
  const current = getLocale()
  const initialIdx = Math.max(0, LOCALES.findIndex(l => l.id === current))
  const [idx, setIdx] = useState(initialIdx)

  useInput((_, key) => {
    if (key.escape) { onDone(null); return }
    if (key.upArrow) setIdx(i => Math.max(0, i - 1))
    else if (key.downArrow) setIdx(i => Math.min(LOCALES.length - 1, i + 1))
    else if (key.return) onDone(LOCALES[idx]!.id)
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
      <Box marginBottom={1}>
        <Text color={INDIGO} bold>✦ </Text>
        <Text color={SILVER} bold>Astraea /language</Text>
        <Text color={DIM}> {t('langTitleSuffix')}</Text>
      </Box>

      <Text color={SILVER}>{t('langSelect')}</Text>
      <Box flexDirection="column" marginY={1}>
        {LOCALES.map((l, i) => (
          <Box key={l.id}>
            <Text color={i === idx ? INDIGO : DIM}>{i === idx ? '❯ ' : '  '}</Text>
            <Text color={i === idx ? SILVER : DIM} bold={i === idx}>{l.nativeName.padEnd(12)}</Text>
            <Text color={DIM}>{l.id === current ? '●' : ''}</Text>
          </Box>
        ))}
      </Box>
      <Text color={DIM}>{t('navHint')}</Text>
    </Box>
  )
}

export function formatLanguageSuccess(locale: Locale): string {
  const meta = LOCALES.find(l => l.id === locale)
  return `✓ ${t('langSavedTitle')} — ${meta?.nativeName ?? locale}`
}
