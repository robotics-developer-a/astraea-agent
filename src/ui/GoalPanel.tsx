// GoalPanel —— /goal 激活期间常驻输入框上方的实时进度面板。
//
// 设计意图：进度信息（已用时间 / 已完成轮数 / 当前第几轮 / token 消耗 / 上轮判定）
// 原本散在历史流里，跑起来后要往回翻才看得到。这个面板把它们钉成一块常驻区，
// 随时一眼可知"现在到哪了"。数据全部来自 getActiveGoal() 单例，不新增埋点；
// 由父组件的 goalTick（每秒 tick + 状态变化）驱动重渲染，故无自身定时器。

import React from 'react'
import { Box, Text } from 'ink'
import { getActiveGoal, GOAL_MAX_TURNS, GOAL_MAX_TOKEN_SPEND } from '../state/goalState'
import { STATUS_COLOR } from './theme'

const INDIGO = '#6A5ACD'

// 毫秒 → "1h 2m 3s" / "2m 3s" / "3s"
function fmtDuration(ms: number): string {
  const s = Math.floor(ms / 1000)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  return [h ? `${h}h` : '', m || h ? `${m}m` : '', `${sec}s`].filter(Boolean).join(' ')
}

// 单行截断目标条件，避免长条件把面板撑成一大片。
function truncate(s: string, n: number): string {
  const oneLine = s.replace(/\s+/g, ' ').trim()
  return oneLine.length > n ? oneLine.slice(0, n - 1) + '…' : oneLine
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
      <Text bold color={INDIGO}>◎ /goal {running ? '进行中' : '待下一轮'}</Text>

      <Box>
        <Text color="gray">目标  </Text>
        <Text color="white">{truncate(goal.condition, 64)}</Text>
      </Box>

      <Box>
        <Text color={nearTurnCap ? STATUS_COLOR.pending : 'white'}>
          {running ? `第 ${currentTurn} 轮进行中` : `已评估 ${evaluated} 轮`}
        </Text>
        {running && <Text color="gray">  ·  已评估 {evaluated} 轮</Text>}
        <Text color={nearTurnCap ? STATUS_COLOR.pending : 'gray'}>  ·  上限 {GOAL_MAX_TURNS}</Text>
      </Box>

      <Box>
        <Text color="gray">已用 </Text>
        <Text color="white">{fmtDuration(Date.now() - goal.startedAt)}</Text>
        <Text color="gray">   ·   token </Text>
        <Text color={nearTokenCap ? STATUS_COLOR.pending : 'white'}>{goal.tokenSpend.toLocaleString()}</Text>
      </Box>

      <Box>
        <Text color="gray">上轮判定  </Text>
        <Text color="gray" dimColor>{goal.lastReason ?? '（待首次评估）'}</Text>
      </Box>
    </Box>
  )
}
