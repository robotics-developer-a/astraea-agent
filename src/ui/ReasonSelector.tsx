// ReasonSelector — ←→ direction-key slider for /reason effort selection
// Replaces manual typing of "low|medium|high|max|auto", zero token cost.
//
// Interaction:
//   ←→    slide between options
//   Enter confirm selection, Esc cancel
//   DeepSeek V4: medium enables thinking; high/max also upgrade to deepseek-v4-pro

import React from 'react'
import { Box, Text } from 'ink'
import { INDIGO } from './theme'

export interface ReasonOption {
  value: string
  label: string
  description: string
  deepseekNote?: string // shown inline when selected + provider=deepseek
}

export const REASON_OPTIONS: ReasonOption[] = [
  {
    value: 'auto',
    label: 'auto',
    description: 'follow env / provider default — no reasoning knob sent',
  },
  {
    value: 'low',
    label: 'low',
    description: 'light reasoning',
  },
  {
    value: 'medium',
    label: 'medium',
    description: 'balanced reasoning',
    deepseekNote: '→ enables V4 thinking',
  },
  {
    value: 'high',
    label: 'high',
    description: 'strong reasoning',
    deepseekNote: '→ thinking + upgrades to deepseek-v4-pro',
  },
  {
    value: 'max',
    label: 'max',
    description: 'strongest reasoning (this session only — not persisted)',
    deepseekNote: '→ max thinking + deepseek-v4-pro',
  },
]

interface ReasonSelectorProps {
  selectedIndex: number
  provider: string
}

export function ReasonSelector({ selectedIndex, provider }: ReasonSelectorProps) {
  const isDeepSeek = provider === 'deepseek'
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={INDIGO}
      paddingX={1}
      paddingY={0}
      marginBottom={1}
    >
      <Text bold color={INDIGO}>
        Select reasoning effort
      </Text>
      <Text color="gray" dimColor>↑↓ slide  Enter confirm  Esc cancel</Text>
      <Box flexDirection="column" marginTop={1}>
        {REASON_OPTIONS.map((opt, i) => {
          const isSelected = i === selectedIndex
          const showNote = isDeepSeek && isSelected && opt.deepseekNote
          return (
            <Box key={opt.value}>
              <Text color={isSelected ? 'white' : 'gray'} bold={isSelected}>
                {isSelected ? ' ❯ ' : '   '}
              </Text>
              <Text
                color={isSelected ? INDIGO : 'white'}
                bold={isSelected}
              >
                {opt.label.padEnd(8)}
              </Text>
              <Text color={isSelected ? 'white' : 'gray'} dimColor={!isSelected}>
                {'— '}{opt.description}
              </Text>
              {showNote && (
                <Text color="yellow">{'  '}{opt.deepseekNote}</Text>
              )}
            </Box>
          )
        })}
      </Box>
    </Box>
  )
}
