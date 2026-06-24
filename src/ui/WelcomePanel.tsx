import React from 'react'
import { Box, Text, useStdout } from 'ink'
import { AstraeaWordmark, WORDMARK_WIDTH } from './AstraeaWordmark'
import { AstraeaGoddess, GODDESS_WIDTH } from './AstraeaGoddess'
import { getLocale, t } from '../i18n'
import { AMBER, INDIGO, SILVER } from './theme'
import { getRecentUpdates } from './recentUpdates'

const DIM = '#7A8AAA'

interface Props {
  version: string
  cwd: string
  model: string
  tools: string[]
  // 测试用接缝：显式传宽度可绕过 useStdout（App.tsx 不传 → 退回真实终端宽度）。
  columns?: number
}

export function WelcomePanel({ version, cwd, model, tools, columns: columnsProp }: Props): React.ReactNode {
  const { stdout } = useStdout()
  const columns = columnsProp ?? stdout?.columns ?? 80
  // 渲染宽度留 1 列：占满整行（=columns）的边框/Box 在 Windows 终端会自动换行，
  // 多占一行物理行，导致 Ink 重绘错位、卡片被撑歪/重影（issue「Windows 表格格式有问题」）。
  // 仅用于实际绘制；字标/女神的 gate 判断仍用真实 columns。
  const panelW = Math.max(1, columns - 1)

  // 框内可用宽 = columns - 5（左右边框 2 + padding 2 + panelW 让出的 1）。
  // 字标 56 宽、女神 38 宽：可用宽不足就跳过，否则撑破边框、四角换行错位。
  const showWordmark = columns >= WORDMARK_WIDTH + 5
  const showGoddess = columns >= GODDESS_WIDTH + 5

  const toolLine = tools.slice(0, 3).join(', ') + (tools.length > 3 ? ' …' : '')
  const truncCwd = cwd.length > 38 ? '…' + cwd.slice(cwd.length - 37) : cwd
  const recentUpdates = getRecentUpdates(version, getLocale())

  return (
    <Box flexDirection="column">
      {/* 整圈边框统一交给 Ink 绘制（borderStyle=round → ╭╮╰╯）。四角与四边由同一套
          string-width 度量定位，必定闭合对齐（不再混用 String.length 手绘上下边）。 */}
      <Box
        borderStyle="round"
        borderColor={INDIGO}
        flexDirection="column"
        alignItems="center"
        paddingX={1}
        paddingY={1}
        width={panelW}
      >
        {/* 字标移入框内、居中常驻（启动扫光动画的"定格"靛蓝大字标）。 */}
        {showWordmark && (
          <Box marginBottom={1}>
            <AstraeaWordmark />
          </Box>
        )}

        {/* 女神字符画（无 reveal → 常驻灰白态）；38×25 块，由本居中父级作为整体居中。 */}
        {showGoddess && (
          <Box marginBottom={1}>
            <AstraeaGoddess />
          </Box>
        )}

        <Text color={SILVER} bold>Astraea <Text color={DIM} dimColor>{`v${version}`}</Text></Text>
        <Text color={INDIGO} dimColor>{'· ✦ · ✧ · ✦ ·'}</Text>
        <Text color={DIM}>{t('wEpithet')}</Text>

        {/* 三条标语：各自一行、整组在 marginY 列盒内居中。 */}
        <Box flexDirection="column" alignItems="center" marginY={1}>
          <Box>
            <Text color={SILVER}>{'✦ '}</Text>
            <Text color={SILVER} italic>{t('wTagline1')}</Text>
          </Box>
          <Box>
            <Text color={INDIGO} dimColor>{'✧ '}</Text>
            <Text color={DIM} italic>{t('wTagline2')}</Text>
          </Box>
          <Box>
            <Text color={INDIGO} dimColor>{'⋆ '}</Text>
            <Text color={DIM}>{t('wTagline3')}</Text>
          </Box>
        </Box>

        {/* model/dir/tools 表 —— 破版根因修复 (a)：把三行包进【单个】
            flexDirection="column" wrapper（默认 alignItems="flex-start"）。
            这个 wrapper 作为【整体】被居中父级居中，行内 padEnd(7) 让 key/value 同列。
            绝不让三行各自作为居中父级的直接子节点——那样 alignItems="center" 会逐行
            各自居中，三行宽度不同 → 三个 key 落在不同列 = 用户最担心的破版。 */}
        <Box flexDirection="column">
          <Box>
            <Text color={DIM}>{t('wModel').padEnd(7)}</Text>
            <Text color={SILVER}>{model}</Text>
          </Box>
          <Box>
            <Text color={DIM}>{t('wDir').padEnd(7)}</Text>
            <Text>{truncCwd}</Text>
          </Box>
          <Box>
            <Text color={DIM}>{t('wTools').padEnd(7)}</Text>
            <Text color={DIM}>{toolLine}</Text>
          </Box>
        </Box>

        <Box marginTop={1}>
          <Text color={DIM}>{'astraea website: '}</Text>
          <Text color={INDIGO}>https://astraea-community.vercel.app/</Text>
        </Box>

        {recentUpdates.length > 0 && (
          <Box flexDirection="column" width="100%" marginTop={1}>
            <Text color={INDIGO}>{t('wRecentUpdates')}</Text>
            {recentUpdates.map((message, index) => {
              // 任意 /command 染琥珀黄，其余正文正常色。
              const parts = message.split(/(\/[a-z]+)/g)
              return (
                <Text key={`${index}-${message}`} color={SILVER}>
                  {'◇ '}
                  {parts.map((part, i) =>
                    part.startsWith('/') ? (
                      <Text key={i} color={AMBER}>{part}</Text>
                    ) : (
                      <React.Fragment key={i}>{part}</React.Fragment>
                    ),
                  )}
                </Text>
              )
            })}
          </Box>
        )}

        <Box marginTop={1}>
          <Text color={DIM} dimColor>{'✦ ' + t('wFooter')}</Text>
        </Box>
      </Box>
    </Box>
  )
}
