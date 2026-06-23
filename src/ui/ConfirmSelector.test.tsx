import React from 'react'
import { test, expect } from 'bun:test'
import { render } from 'ink-testing-library'
import stringWidth from 'string-width'
import { ConfirmSelector } from './ConfirmSelector'

const strip = (s?: string) => (s ?? '').replace(/\x1b\[[0-9;]*m/g, '')

test('file confirmation stays within a narrow terminal without wrapped choice rows', () => {
  ;(process.stdout as { columns?: number }).columns = 80
  const { lastFrame } = render(
    <ConfirmSelector
      kind="file"
      selectedIndex={1}
      columns={80}
      command="edit /Users/ronghuizhong/Documents/project/astraea/astraea/src/ui/WelcomePanel.tsx"
    />,
  )

  const frame = strip(lastFrame() ?? '')
  const rows = frame.split('\n').filter(Boolean)

  expect(rows.every(row => stringWidth(row) <= 80)).toBe(true)
  expect(frame).toContain('Yes, all edits')
  expect(frame).toContain('session edits -> cruise')
  expect(frame).not.toContain('Yes, all edits (cruise)')
  expect(rows.filter(row => row.includes('session edits -> cruise'))).toHaveLength(1)
})
