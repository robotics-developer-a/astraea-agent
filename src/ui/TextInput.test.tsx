// TextInput 行为回归测试 —— 锁定 Windows「粘贴只显示一个字符」修复。
//
// 核心场景：终端把粘贴拆成一串「单字符 stdin chunk」连续送来时，输入框必须逐个累加，
// 而不是每个字符都从空串第 0 位重插、最后只剩最后一个。详见 TextInput.tsx 顶部注释。

import React, { useState } from 'react'
import { test, expect } from 'bun:test'
import { render } from 'ink-testing-library'
import TextInput from './TextInput'

// 去掉 ANSI 转义，方便对可见文本做断言。
const strip = (s: string | undefined) =>
  (s ?? '').replace(/\[[0-9;]*m/g, '')

const tick = () => new Promise((r) => setTimeout(r, 20))

// 受控包装：TextInput 是受控组件，必须由父组件把 onChange 的值回灌。
function Controlled({ onSubmit }: { onSubmit?: (v: string) => void }) {
  const [value, setValue] = useState('')
  return (
    <TextInput value={value} onChange={setValue} onSubmit={onSubmit} showCursor={false} />
  )
}

test('逐字符输入会累加（普通打字）', async () => {
  const { stdin, lastFrame } = render(<Controlled />)
  for (const ch of 'hello') {
    stdin.write(ch)
    await tick()
  }
  expect(strip(lastFrame())).toContain('hello')
})

test('一串单字符 chunk 连续到达也能累加，不会只剩最后一个字符（Windows 粘贴根因）', async () => {
  const { stdin, lastFrame } = render(<Controlled />)
  // 同步连发，模拟 Windows 不开 bracketed-paste 时把粘贴拆成单字符的情形。
  for (const ch of 'sk-ant-12345') {
    stdin.write(ch)
  }
  await tick()
  const text = strip(lastFrame())
  expect(text).toContain('sk-ant-12345')
  expect(text).not.toBe('5') // 旧 bug 的表现：只剩最后一个字符
})

test('单个多字符 chunk（无括号粘贴时整段到达）整体插入', async () => {
  const { stdin, lastFrame } = render(<Controlled />)
  stdin.write('hello world')
  await tick()
  expect(strip(lastFrame())).toContain('hello world')
})

// 受控包装：开启 enablePaste + 真实光标，用于验证「粘贴落在光标处」。
function PasteControlled({ transformPaste }: { transformPaste?: (raw: string) => string | null }) {
  const [value, setValue] = useState('')
  return (
    <TextInput value={value} onChange={setValue} enablePaste transformPaste={transformPaste} />
  )
}

// bracketed-paste 序列：ESC[200~ <text> ESC[201~
const bracketed = (text: string) => `\x1b[200~${text}\x1b[201~`
const LEFT = '\x1b[D'

test('粘贴插到光标处，而非追加到末尾', async () => {
  const { stdin, lastFrame } = render(<PasteControlled />)
  for (const ch of 'ab') { stdin.write(ch); await tick() }
  stdin.write(LEFT) // 光标移到 a 与 b 之间
  await tick()
  stdin.write(bracketed('XY'))
  await tick()
  expect(strip(lastFrame())).toContain('aXYb')
})

test('transformPaste 钩子转换后的文本插到光标处', async () => {
  const { stdin, lastFrame } = render(
    <PasteControlled transformPaste={() => '[token]'} />,
  )
  for (const ch of 'ab') { stdin.write(ch); await tick() }
  stdin.write(LEFT)
  await tick()
  stdin.write(bracketed('a very long original paste'))
  await tick()
  expect(strip(lastFrame())).toContain('a[token]b')
})

test('回车触发 onSubmit，带上当前完整值', async () => {
  const box = { value: '' }
  const { stdin } = render(<Controlled onSubmit={(v) => { box.value = v }} />)
  for (const ch of 'done') {
    stdin.write(ch)
    await tick()
  }
  stdin.write('\r')
  await tick()
  expect(box.value).toBe('done')
})
