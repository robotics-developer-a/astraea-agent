// QuestionPanel — counsel 模式的多问题方向键面板（覆盖输入框）
//
// 交互：
//   ←→     在多道问题间切换（顶部标签页高亮）
//   ↑↓     在当前问题的选项间移动光标
//   Space  勾选/取消当前选项（多选 ☑/☐；单选 ●/○，选一个清其余）
//   Enter  确认当前问题 → 还有未答的题则跳到下一题，全部答完则提交
//   Esc    跳过整个面板
//
// 选项最后一行恒为「✎ 自填…」，进入自由文本（由 App 的输入框接管）。
// 推荐项由模型放在第一位且 label 自带「(推荐)」，此处无需特殊处理，仅高亮首项。

import React from 'react'
import { Box, Text } from 'ink'
import type { Question } from '../tools/AskUserQuestionTool/bridge'

const INDIGO = '#7C6FF0'
const GREEN = '#2e7d32'

export interface QuestionPanelProps {
  questions: Question[]
  qIndex: number              // 当前问题
  optCursor: number[]         // 每题光标行（可等于 options.length，即「自填」行）
  selections: number[][]      // 每题已选项索引
  freeTexts: string[]         // 每题自填文本（非空即视为已答）
}

function isAnswered(q: Question, sel: number[], ft: string): boolean {
  return sel.length > 0 || ft.trim().length > 0
}

export function QuestionPanel({ questions, qIndex, optCursor, selections, freeTexts }: QuestionPanelProps) {
  const q = questions[qIndex]
  if (!q) return null
  const cursor = optCursor[qIndex] ?? 0
  const sel = selections[qIndex] ?? []
  const ft = freeTexts[qIndex] ?? ''
  const otherRow = q.options.length

  return (
    <Box flexDirection="column" marginBottom={1} borderStyle="round" borderColor={INDIGO} paddingX={1}>
      {/* 标签页：多题时显示 Q 切换条 */}
      {questions.length > 1 && (
        <Box marginBottom={1}>
          {questions.map((qq, i) => {
            const active = i === qIndex
            const done = isAnswered(qq, selections[i] ?? [], freeTexts[i] ?? '')
            const label = qq.header || `Q${i + 1}`
            return (
              <Text key={i} color={active ? INDIGO : done ? GREEN : 'gray'} bold={active} dimColor={!active && !done}>
                {i > 0 ? '  ' : ''}{active ? '▸ ' : done ? '✓ ' : '  '}{label}
              </Text>
            )
          })}
        </Box>
      )}

      <Text bold color={INDIGO}>
        Astraea asks{questions.length > 1 ? ` (${qIndex + 1}/${questions.length})` : ''}:
      </Text>
      <Text>{q.question}</Text>
      {q.multiSelect && <Text color="gray" dimColor>multiple choice — Space to toggle</Text>}

      <Box flexDirection="column" marginTop={1}>
        {q.options.map((opt, i) => {
          const onCursor = i === cursor
          const checked = sel.includes(i)
          const box = q.multiSelect ? (checked ? '☑' : '☐') : (checked ? '●' : '○')
          return (
            <Box key={i}>
              <Text color={onCursor ? 'white' : 'gray'} bold={onCursor}>{onCursor ? ' ❯ ' : '   '}</Text>
              <Text color={checked ? GREEN : onCursor ? 'white' : 'gray'}>{box} </Text>
              <Text color={onCursor ? INDIGO : checked ? 'white' : 'gray'} bold={onCursor || checked}>
                {opt.label}
              </Text>
              {opt.description && (
                <Text color="gray" dimColor>{'  — '}{opt.description}</Text>
              )}
            </Box>
          )
        })}
        {/* 自填行 */}
        {(() => {
          const onCursor = cursor === otherRow
          const filled = ft.trim().length > 0
          return (
            <Box>
              <Text color={onCursor ? 'white' : 'gray'} bold={onCursor}>{onCursor ? ' ❯ ' : '   '}</Text>
              <Text color={onCursor ? INDIGO : filled ? 'white' : 'gray'} bold={onCursor} dimColor={!onCursor && !filled}>
                ✎ {filled ? ft : '自填…'}
              </Text>
            </Box>
          )
        })()}
      </Box>

      <Box marginTop={1}>
        <Text color="gray" dimColor>
          {questions.length > 1 ? '←→ question · ' : ''}↑↓ move · {q.multiSelect ? 'Space toggle · ' : 'Space pick · '}Enter confirm · Esc skip
        </Text>
      </Box>
    </Box>
  )
}
