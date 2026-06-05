// ThinkingIndicator — Astraea 思考中的动态指示器
//
// 取代静态的 "✦ Thinking..."：每次思考都从一句随机的、星之女神主题的短语开始，
// 思考期间短语会缓慢轮换，前导星符也会闪烁 —— 既优雅又不单调。

import React, { useEffect, useState } from 'react'
import { Text } from 'ink'

const INDIGO = '#6A5ACD'
const SILVER = '#C8D8FF'

// 星之女神（掌管星辰与正义）主题的"工作中"短语 —— 思考时轮换，避免静态感。
const PHRASES: string[] = [
  'Consulting the stars',
  'Charting the constellations',
  'Reading the night sky',
  'Aligning the heavens',
  'Weighing the scales',
  'Gathering starlight',
  'Tracing the zodiac',
  'Listening to the dark',
  'Summoning clarity',
  'Threading the cosmos',
  'Calling on Virgo',
  'Letting the stars settle',
  'Measuring the moment',
  'Turning it over',
  'Drawing the constellation',
  'Tilting toward the light',
]

// 前导星符的闪烁帧 —— 一圈缓慢的微光。
const STARS = ['✦', '✧', '⋆', '✩', '⋆', '✧']

const TICK_MS = 140          // 帧间隔
const TICKS_PER_PHRASE = 16  // 约 2.2s 换一句

export function ThinkingIndicator(): React.ReactNode {
  // 随机起始短语：每次进入"思考"都焕然一新。
  const [startIdx] = useState(() => Math.floor(Math.random() * PHRASES.length))
  const [tick, setTick] = useState(0)

  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), TICK_MS)
    return () => clearInterval(id)
  }, [])

  const star = STARS[tick % STARS.length]
  const phrase = PHRASES[(startIdx + Math.floor(tick / TICKS_PER_PHRASE)) % PHRASES.length]
  const dots = '.'.repeat(tick % 4)

  return (
    <Text>
      <Text color={SILVER}>{star} </Text>
      <Text color={INDIGO} italic>{phrase}</Text>
      <Text color={INDIGO} dimColor>{dots}</Text>
    </Text>
  )
}
