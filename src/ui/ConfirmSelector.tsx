// ConfirmSelector — 权限确认的方向键选择器（覆盖输入框）
// 设计同 ModeSelector：用户只需 ↑↓ 移动 + Enter 确认，不再输入 y/n/a/d。
// 由 confirmBridge 驱动（工具执行中 requestConfirm → App 渲染本组件 → resolveConfirm）。

import React from 'react'
import { Box, Text } from 'ink'
import type { ConfirmResult } from '../tools/BashTool/permissions/confirmBridge'

export interface ConfirmChoice {
  label: string
  description: string
  result: ConfirmResult
}

// 四个选项与原 y/n/a/d 一一对应
export const CONFIRM_CHOICES: ConfirmChoice[] = [
  { label: 'Yes',          description: 'run once',              result: { proceed: true,  remember: null } },
  { label: 'No',           description: 'cancel this command',   result: { proceed: false, remember: null } },
  { label: 'Always allow', description: 'save an allow rule',    result: { proceed: true,  remember: 'always-allow' } },
  { label: 'Always deny',  description: 'save a deny rule',      result: { proceed: false, remember: 'always-deny' } },
]

const AMBER = '#D99A2B'

interface ConfirmSelectorProps {
  command: string
  description?: string
  selectedIndex: number
}

export function ConfirmSelector({ command, description, selectedIndex }: ConfirmSelectorProps) {
  // 命令过长时截断显示（真实命令仍按原值执行）
  const shownCommand = command.length > 200 ? command.slice(0, 200) + '…' : command
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={AMBER}
      paddingX={1}
      paddingY={0}
      marginBottom={1}
    >
      <Text bold color={AMBER}>Astraea wants to run:</Text>
      <Text color="yellow">{shownCommand}</Text>
      {description && (
        <Text color="gray" dimColor>{description}</Text>
      )}
      <Box marginTop={1}>
        <Text color="gray" dimColor>↑↓ move  Enter confirm  Esc cancel</Text>
      </Box>
      <Box flexDirection="column" marginTop={1}>
        {CONFIRM_CHOICES.map((choice, i) => {
          const isSelected = i === selectedIndex
          return (
            <Box key={choice.label}>
              <Text color={isSelected ? 'white' : 'gray'} bold={isSelected}>
                {isSelected ? ' ❯ ' : '   '}
              </Text>
              <Text color={isSelected ? AMBER : 'gray'} bold={isSelected}>
                {choice.label.padEnd(14)}
              </Text>
              <Text color={isSelected ? 'white' : 'gray'} dimColor={!isSelected}>
                {'— '}{choice.description}
              </Text>
            </Box>
          )
        })}
      </Box>
    </Box>
  )
}
