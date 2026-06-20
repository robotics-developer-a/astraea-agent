// AstraeaIntro — two-phase boot animation.
//
// Phase 1 (wordmark): a silver shine sweeps left→right across the indigo
// "Astraea" wordmark exactly once (~1s). It does NOT call onDone on finish —
// the wordmark settles to solid indigo and we advance to phase 2.
// Phase 2 (figure): a silver band sweeps top→bottom revealing the goddess
// symbol-art row by row (~60ms/row). When the last row lands → onDone().
// The caller then commits the settled card into <Static> (see App.tsx boot phase).
//
// Lives in the live (non-Static) region only while booting — never repaints after.
// Skippable: any keypress finishes immediately. Narrow terminals skip the
// wordmark phase (start at figure); too narrow even for the goddess → onDone now.

import React, { useEffect, useRef, useState } from 'react'
import { useInput, useStdout, Box } from 'ink'
import { AstraeaWordmark, WORDMARK_WIDTH, fitsWordmark } from './AstraeaWordmark'
import { AstraeaGoddess, GODDESS_HEIGHT, GODDESS_WIDTH } from './AstraeaGoddess'

const TICK_MS = 40          // wordmark frame interval
const STEP = 3              // columns the shine advances per frame
const BAND = 8              // lead/trail padding so the band fully enters & exits
const START = -BAND
const FIGURE_TICK_MS = 60   // goddess reveal: one row per frame (~1.5s total)

type Phase = 'wordmark' | 'figure'

export function AstraeaIntro({ onDone }: { onDone: () => void }): React.ReactNode {
  const { stdout } = useStdout()
  const columns = stdout?.columns ?? 80
  const wordmarkFits = fitsWordmark(columns)
  const goddessFits = columns >= GODDESS_WIDTH

  // 窄屏（字标放不下）直接从女神揭示开始；字标放得下则先扫字标。
  const [phase, setPhase] = useState<Phase>(wordmarkFits ? 'wordmark' : 'figure')

  const [pos, setPos] = useState(START)
  const posRef = useRef(START)
  const [shown, setShown] = useState(0)
  const shownRef = useRef(0)
  const doneRef = useRef(false)

  const finish = () => {
    if (doneRef.current) return
    doneRef.current = true
    onDone()
  }

  // Phase 1: 字标横扫。扫完不 onDone，切到 figure（字标转常驻靛蓝）。
  useEffect(() => {
    if (phase !== 'wordmark') return
    const id = setInterval(() => {
      posRef.current += STEP
      if (posRef.current > WORDMARK_WIDTH + BAND) {
        clearInterval(id)
        setPhase('figure')
        return
      }
      setPos(posRef.current)
    }, TICK_MS)
    return () => clearInterval(id)
  }, [phase])

  // Phase 2: 女神自上而下逐行揭示（band = 当前点亮的前沿行）。
  useEffect(() => {
    if (phase !== 'figure') return
    // 连女神都放不下 → 不阻塞 boot，立即收尾。
    if (!goddessFits) { finish(); return }
    const id = setInterval(() => {
      shownRef.current += 1
      if (shownRef.current >= GODDESS_HEIGHT) {
        setShown(GODDESS_HEIGHT)
        clearInterval(id)
        finish()
        return
      }
      setShown(shownRef.current)
    }, FIGURE_TICK_MS)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, goddessFits])

  // Any keypress skips the intro.
  useInput(() => finish())

  if (phase === 'figure' && !goddessFits) return null

  return (
    <Box flexDirection="column" alignItems="center">
      {phase === 'wordmark'
        ? <AstraeaWordmark shineCenter={pos} />
        : <AstraeaWordmark />}
      {phase === 'figure' && goddessFits && (
        <AstraeaGoddess reveal={{ shown, band: shown - 1 }} />
      )}
    </Box>
  )
}
