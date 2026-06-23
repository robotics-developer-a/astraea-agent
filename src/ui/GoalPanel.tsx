// GoalPanel —— /goal 激活期间常驻输入框上方的实时进度面板。
//
// 设计意图：进度信息（已用时间 / 已完成轮数 / 当前第几轮 / token 消耗 / 上轮判定）
// 原本散在历史流里，跑起来后要往回翻才看得到。这个面板把它们钉成一块常驻区，
// 随时一眼可知"现在到哪了"。数据全部来自 getActiveGoal() 单例，不新增埋点；
// 由父组件的 goalTick（每秒 tick + 状态变化）驱动重渲染，故无自身定时器。

import React from 'react'
import { Box, Text } from 'ink'
import { getActiveGoal, GOAL_MAX_TURNS, GOAL_MAX_TOKEN_SPEND } from '../state/goalState'
import { STATUS_COLOR, INDIGO } from './theme'
import { t } from '../i18n'

// 毫秒 → "1h 2m 3s" / "2m 3s" / "3s"
function fmtDuration(ms: number): string {
  const s = Math.floor(ms / 1000)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  return [h ? `${h}h` : '', m || h ? `${m}m` : '', `${sec}s`].filter(Boolean).join(' ')
}

// 面板只显示一句摘要，避免大段 pasted goal 把常驻区撑满；完整 condition 仍保留给 evaluator。
export function summarizeGoalConditionForDisplay(s: string, max = 64): string {
  const oneLine = s.replace(/\s+/g, ' ').trim()
  if (oneLine.length <= max) return oneLine

  const firstSentence = oneLine.match(/^.*?[.!?。！？](?:\s|$)/)?.[0]?.trim()
  const summary = firstSentence || oneLine
  return summary.length > max ? summary.slice(0, max - 1).trimEnd() + '…' : summary
}

// ── GoalHint ──────────────────────────────────────────────────────────────────
// 实时使用提示：用户**正在输入** /goal（敲下空格、或正在打条件）时立刻浮出，
// 不必等回车。和 SlashHint 一起钉在输入框上方，随 inputValue 变化即时显隐。
// 触发：input 正好是 "/goal" 或以 "/goal " 开头（即已进入"输条件"阶段）。

/** 当前输入是否在编排 /goal 命令（用于决定是否浮出实时提示）。 */
export function isComposingGoal(input: string): boolean {
  const t = input.trimStart()
  return t === '/goal' || t.startsWith('/goal ')
}

export function GoalHint({ input }: { input: string }) {
  if (!isComposingGoal(input)) return null
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={INDIGO}
      paddingX={1}
      paddingY={0}
      marginBottom={1}
    >
      <Text bold color={INDIGO}>{t('goalHintTitle')}</Text>
      <Box>
        <Text color={STATUS_COLOR.success}>{'  '}{t('goalHintGoodLabel')} </Text>
        <Text color="gray">{t('goalHintGood')}</Text>
      </Box>
      <Box>
        <Text color={STATUS_COLOR.error}>{'  '}{t('goalHintBadLabel')} </Text>
        <Text color="gray">{t('goalHintBad')}</Text>
      </Box>
      <Text color="gray" dimColor>{'  '}{t('goalHintTip')}</Text>
    </Box>
  )
}

interface GoalPanelProps {
  /** 主 Agent 是否正在流式运行（决定显示"第 N 轮进行中"还是"待下一轮"）。
   *  本组件未 memo，App 每次 goalTick setState 都会带它重渲读取最新单例，故无需 tick 入参。 */
  running: boolean
}

export function GoalPanel({ running }: GoalPanelProps) {
  const goal = getActiveGoal()
  if (!goal) return null

  const evaluated = goal.turnsEvaluated
  // 进行中那一轮 = 已评估 + 1。
  const currentTurn = evaluated + 1
  const nearTurnCap = evaluated >= GOAL_MAX_TURNS - 8
  const nearTokenCap = goal.tokenSpend >= GOAL_MAX_TOKEN_SPEND * 0.8
  const warn = nearTurnCap || nearTokenCap

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={warn ? STATUS_COLOR.pending : INDIGO}
      paddingX={1}
      paddingY={0}
      marginBottom={1}
    >
      <Text bold color={INDIGO}>◎ /goal {running ? t('goalActive') : t('goalNextTurn')}</Text>

      <Box>
        <Text color="gray">{t('goalLabel')}  </Text>
        <Text color="white">{summarizeGoalConditionForDisplay(goal.condition, 64)}</Text>
      </Box>

      <Box>
        <Text color={nearTurnCap ? STATUS_COLOR.pending : 'white'}>
          {running ? t('goalTurnRunning', { n: currentTurn }) : t('goalTurnsEvaluated', { n: evaluated })}
        </Text>
        {running && <Text color="gray">  ·  {t('goalTurnsEvaluated', { n: evaluated })}</Text>}
        <Text color={nearTurnCap ? STATUS_COLOR.pending : 'gray'}>  ·  {t('goalCap', { n: GOAL_MAX_TURNS })}</Text>
      </Box>

      <Box>
        <Text color="gray">{t('goalElapsed')} </Text>
        <Text color="white">{fmtDuration(Date.now() - goal.startedAt)}</Text>
        <Text color="gray">   ·   token </Text>
        <Text color={nearTokenCap ? STATUS_COLOR.pending : 'white'}>{goal.tokenSpend.toLocaleString()}</Text>
      </Box>

      <Box>
        <Text color="gray">{t('goalLastVerdict')}  </Text>
        <Text color="gray" dimColor>{goal.lastReason ?? t('goalAwaitingFirst')}</Text>
      </Box>
    </Box>
  )
}
