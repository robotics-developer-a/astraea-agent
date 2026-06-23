// ConfirmSelector — 权限确认的方向键选择器（覆盖输入框）
// 设计同 ModeSelector：用户只需 ↑↓ 移动 + Enter 确认，不再输入 y/n/a/d。
// 由 confirmBridge 驱动（工具执行中 requestConfirm → App 渲染本组件 → resolveConfirm）。

import React from 'react'
import { Box, Text, useWindowSize } from 'ink'
import type { ConfirmResult } from '../tools/BashTool/permissions/confirmBridge'
import { AMBER } from './theme'
import { t } from '../i18n'
import { clampLineWidth } from '../utils/termWidth'

export interface ConfirmChoice {
  label: string
  description: string
  result: ConfirmResult
}

// Bash/PowerShell：四个选项与原 y/n/a/d 一一对应（Always = 落盘 per-command 规则）
export const CONFIRM_CHOICES: ConfirmChoice[] = [
  { label: 'Yes',          description: 'run once',              result: { proceed: true,  remember: null } },
  { label: 'No',           description: 'cancel this command',   result: { proceed: false, remember: null } },
  { label: 'Always allow', description: 'save an allow rule',    result: { proceed: true,  remember: 'always-allow' } },
  { label: 'Always deny',  description: 'save a deny rule',      result: { proceed: false, remember: 'always-deny' } },
]

// 文件写（FileWrite/FileEdit）：对齐 CC 的 acceptEdits — 「本会话全允许」即切到 cruise 模式
// （会话内存，不落盘 per-file 规则；红线敏感路径仍会把 allow 降级回 ask）。
export const FILE_CONFIRM_CHOICES: ConfirmChoice[] = [
  { label: 'Yes',             description: 'write once',                result: { proceed: true,  remember: null } },
  { label: 'Yes, all edits',  description: 'session edits -> cruise',   result: { proceed: true,  remember: 'session-cruise' } },
  { label: 'No',              description: 'cancel this write',         result: { proceed: false, remember: null } },
]

export const ACTION_CONFIRM_CHOICES: ConfirmChoice[] = [
  { label: 'Yes', description: 'perform this external action once', result: { proceed: true, remember: null } },
  { label: 'No', description: 'cancel this external action', result: { proceed: false, remember: null } },
]

/** 按确认来源返回对应的选项集。'file' → 文件写三选项；其余（含 undefined）→ Bash 四选项。 */
export function getConfirmChoices(kind?: 'bash' | 'file' | 'action'): ConfirmChoice[] {
  return kind === 'file' ? FILE_CONFIRM_CHOICES : kind === 'action' ? ACTION_CONFIRM_CHOICES : CONFIRM_CHOICES
}

interface ConfirmSelectorProps {
  command: string
  description?: string
  selectedIndex: number
  kind?: 'bash' | 'file' | 'action'
  columns?: number
}

export function ConfirmSelector({ command, description, selectedIndex, kind, columns: columnsProp }: ConfirmSelectorProps) {
  const { columns } = useWindowSize()
  const outerWidth = Math.max(42, (columnsProp ?? columns ?? process.stdout.columns ?? 80) - 1)
  const contentWidth = Math.max(1, outerWidth - 4) // border left/right + paddingX
  // 命令过长时截断显示（真实命令仍按原值执行）
  const shownCommand = clampLineWidth(command.length > 200 ? command.slice(0, 200) + '…' : command, contentWidth)
  const choices = getConfirmChoices(kind)
  const labelWidth = Math.max(...choices.map(c => c.label.length)) + 2
  return (
    <Box
      flexDirection="column"
      width={outerWidth}
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
        <Text color="gray" dimColor>{clampLineWidth(t('navHint'), contentWidth)}</Text>
      </Box>
      <Box flexDirection="column" marginTop={1}>
        {choices.map((choice, i) => {
          const isSelected = i === selectedIndex
          const descriptionWidth = Math.max(1, contentWidth - 3 - labelWidth - 2)
          return (
            <Box key={choice.label}>
              <Text color={isSelected ? 'white' : 'gray'} bold={isSelected}>
                {isSelected ? ' ❯ ' : '   '}
              </Text>
              <Text color={isSelected ? AMBER : 'gray'} bold={isSelected}>
                {choice.label.padEnd(labelWidth)}
              </Text>
              <Text color={isSelected ? 'white' : 'gray'} dimColor={!isSelected}>
                {'— '}{clampLineWidth(choice.description, descriptionWidth)}
              </Text>
            </Box>
          )
        })}
      </Box>
    </Box>
  )
}
