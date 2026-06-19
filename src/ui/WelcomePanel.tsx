import React from 'react'
import { Box, Text, useStdout } from 'ink'
import { AstraeaSprite } from './AstraeaSprite'
import { AstraeaWordmark, fitsWordmark } from './AstraeaWordmark'
import { t } from '../i18n'

const INDIGO = '#6A5ACD'
const SILVER = '#C8D8FF'
const DIM = '#7A8AAA'

interface Props {
  version: string
  cwd: string
  model: string
  tools: string[]
}

export function WelcomePanel({ version, cwd, model, tools }: Props): React.ReactNode {
  const { stdout } = useStdout()
  const columns = stdout?.columns ?? 80
  // 渲染宽度留 1 列：占满整行（=columns）的边框/Box 在 Windows 终端会自动换行，
  // 多占一行物理行，导致 Ink 重绘错位、卡片被撑歪/重影（issue「Windows 表格格式有问题」）。
  // 仅用于实际绘制；twoCol / fitsWordmark 这类布局判断仍用真实 columns。
  const panelW = Math.max(1, columns - 1)

  const twoCol = columns >= 64

  const toolLine = tools.slice(0, 3).join(', ') + (tools.length > 3 ? ' …' : '')
  const truncCwd = cwd.length > 38 ? '…' + cwd.slice(cwd.length - 37) : cwd

  // Left panel is 24 terminal cols wide (sprite is ~9 wide, subtitle is "星之女神 · AI" = 14 wide)
  const LEFT_W = 24

  return (
    <Box flexDirection="column">
      {/* 启动扫光动画的"定格"——银色扫过后留下的纯靛蓝大字标识，常驻在卡片上方。 */}
      {fitsWordmark(columns) && (
        <Box marginBottom={1}>
          <AstraeaWordmark />
        </Box>
      )}

      {/* 整圈边框统一交给 Ink 绘制（borderStyle=round → ╭╮╰╯）。
          以前上下边框是手绘 Text、左右边框由 Ink Box 画，两者用不同的宽度度量
          （我们的 String.length vs Ink 的 string-width）。在 Windows 终端上，
          sprite/标语里的歧义宽字符（✦ ★ ⊙ ✧ ⋆ · — …）两套度量不一致，导致顶/底
          边角与侧边 │ 落在不同列、顶边被画短、卡片错位。让 Ink 独占整圈边框后，
          四角与四边由同一套度量定位，必定闭合对齐。 */}
      <Box
        borderStyle="round"
        borderColor={INDIGO}
        flexDirection={twoCol ? 'row' : 'column'}
        paddingX={1}
        paddingY={1}
        width={panelW}
      >
        {/* Left panel: sprite + subtitle */}
        <Box
          flexDirection="column"
          alignItems="center"
          justifyContent="center"
          width={twoCol ? LEFT_W : undefined}
          minHeight={7}
          flexShrink={0}
        >
          <AstraeaSprite />
          <Box marginTop={1} flexDirection="column" alignItems="center">
            <Text color={SILVER} bold>Astraea <Text color={DIM} dimColor>{`v${version}`}</Text></Text>
            <Text color={INDIGO} dimColor>{'· ✦ · ✧ · ✦ ·'}</Text>
            <Text color={DIM}>{t('wEpithet')}</Text>
          </Box>
        </Box>

        {/* Vertical divider */}
        {twoCol && (
          <Box
            height="100%"
            borderStyle="single"
            borderColor={INDIGO}
            borderDimColor
            borderTop={false}
            borderBottom={false}
            borderLeft={false}
            marginX={1}
          />
        )}

        {/* Right panel */}
        {twoCol && (
          <Box flexDirection="column" justifyContent="center" paddingLeft={1} gap={0}>
            <Box flexDirection="column" marginBottom={1}>
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
            <Box marginTop={1}>
              <Text color={DIM} dimColor>{'✦ ' + t('wFooter')}</Text>
            </Box>
          </Box>
        )}
      </Box>
    </Box>
  )
}
