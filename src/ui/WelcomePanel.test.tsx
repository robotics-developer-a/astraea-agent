// WelcomePanel 格式/UI 验收 —— 锁定用户最担心的破版：
//   边框闭合、model/dir/tools 表三列对齐、字标/女神 gate、女神揭示稳定、中英文。
// 用 ink-testing-library 的 render + strip()（去 ANSI），string-width 量真实显示列宽，
// 经 columns 接缝在多个终端宽度下断言。

import React from 'react'
import { test, expect, afterEach, describe } from 'bun:test'
import { render } from 'ink-testing-library'
import stringWidth from 'string-width'
import { WelcomePanel } from './WelcomePanel'
import { AstraeaGoddess, GODDESS_HEIGHT } from './AstraeaGoddess'
import { t, setLocale, type Locale } from '../i18n'

const strip = (s?: string) => (s ?? '').replace(/\[[0-9;]*m/g, '')

// 去 ANSI 后拆成非空行（边框/内容行）。
const lines = (frame: string) =>
  strip(frame).split('\n').filter((l) => l.trim().length > 0)

// 取首尾边框行（断言非空，避免 noUncheckedIndexedAccess 的 undefined）。
const borderRows = (ls: string[]): [string, string] => {
  const first = ls[0]
  const last = ls[ls.length - 1]
  if (first === undefined || last === undefined) throw new Error('empty frame')
  return [first, last]
}

const renderPanel = (columns: number) =>
  render(
    <WelcomePanel
      columns={columns}
      version="9.9.9"
      cwd="/x/y/astraea"
      model="deepseek-chat"
      tools={['Bash', 'Read', 'Edit', 'Grep']}
    />,
  )

const WIDTHS = [100, 58, 40]

afterEach(() => setLocale('en'))

// 跨语言跑验收项 1–3。
for (const locale of ['zh', 'en'] as Locale[]) {
  describe(`WelcomePanel [${locale}]`, () => {
    test('1. 边框闭合：首行 ╭…╮、末行 ╰…╯，首尾等宽', () => {
      setLocale(locale)
      for (const W of WIDTHS) {
        const { lastFrame } = renderPanel(W)
        const [first, last] = borderRows(lines(lastFrame() ?? ''))
        expect(first.startsWith('╭')).toBe(true)
        expect(first.endsWith('╮')).toBe(true)
        expect(last.startsWith('╰')).toBe(true)
        expect(last.endsWith('╯')).toBe(true)
        // 女神/字标/标语都不撑破边框 → 顶底边等宽。
        expect(stringWidth(first)).toBe(stringWidth(last))
      }
    })

    test('2. 表格对齐：model/dir/tools 三行 key 起始列一致、value 起始列一致', () => {
      setLocale(locale)
      for (const W of WIDTHS) {
        const { lastFrame } = renderPanel(W)
        const ls = lines(lastFrame() ?? '')
        const rowFor = (label: string) => ls.find((l) => l.includes(label))!
        const mRow = rowFor(t('wModel'))
        const dRow = rowFor(t('wDir'))
        const tRow = rowFor(t('wTools'))
        expect(mRow).toBeDefined()
        expect(dRow).toBeDefined()
        expect(tRow).toBeDefined()

        // key 起始列：去 ANSI 行里 label 首字符的列索引（string-width 量前缀）。
        const keyCol = (line: string, label: string) =>
          stringWidth(line.slice(0, line.indexOf(label)))
        const kM = keyCol(mRow, t('wModel'))
        const kD = keyCol(dRow, t('wDir'))
        const kT = keyCol(tRow, t('wTools'))
        expect(kD).toBe(kM)
        expect(kT).toBe(kM)

        // value 起始列：key 列 + padEnd(7) 的显示宽。三行同一 wrapper、同一 padEnd → 同列。
        const valCol = (line: string, value: string) =>
          stringWidth(line.slice(0, line.indexOf(value)))
        const vM = valCol(mRow, 'deepseek-chat')
        const vD = valCol(dRow, '/x/y/astraea')
        const vT = valCol(tRow, 'Bash')
        expect(vD).toBe(vM)
        expect(vT).toBe(vM)
      }
    })

    test('3. 内容完整 + 字标/女神 gate', () => {
      setLocale(locale)

      // 宽屏 100：字标 + 女神都在。
      {
        const frame = strip(renderPanel(100).lastFrame() ?? '')
        expect(frame).toContain('v9.9.9')
        expect(frame).toContain(t('wEpithet'))
        expect(frame).toContain(t('wTagline1'))
        expect(frame).toContain(t('wTagline2'))
        expect(frame).toContain(t('wTagline3'))
        expect(frame).toContain('astraea website:')
        expect(frame).toContain('https://astraea-community.vercel.app/')
        expect(frame).toContain(t('wFooter'))
        expect(frame).toContain('╗')             // 字标 figlet 专属角字符（女神无）
        expect(frame).toContain('▔▔▔▔')          // 女神底座符号
      }

      // 临界 58：女神在、字标不在（58 < WORDMARK_WIDTH+5=61，>= GODDESS_WIDTH+5=43）。
      {
        const frame = strip(renderPanel(58).lastFrame() ?? '')
        expect(frame).toContain('▔▔▔▔')          // 女神仍在
        expect(frame).not.toContain('╗')         // 字标已跳过
      }

      // 窄 40：字标/女神皆无，边框仍闭合（验 b/c gate）。
      {
        const { lastFrame } = renderPanel(40)
        const frame = strip(lastFrame() ?? '')
        expect(frame).not.toContain('╗')
        expect(frame).not.toContain('▔▔▔▔')
        const [first, last] = borderRows(lines(lastFrame() ?? ''))
        expect(first.startsWith('╭')).toBe(true)
        expect(first.endsWith('╮')).toBe(true)
        expect(last.startsWith('╰')).toBe(true)
        expect(last.endsWith('╯')).toBe(true)
        expect(stringWidth(first)).toBe(stringWidth(last))
      }
    })
  })
}

describe('AstraeaGoddess reveal', () => {
  test('4. 揭示恒输出 GODDESS_HEIGHT 行；undefined 时全行有内容', () => {
    for (const k of [5, 25]) {
      const { lastFrame } = render(
        <AstraeaGoddess reveal={{ shown: k, band: k - 1 }} />,
      )
      const all = strip(lastFrame() ?? '').split('\n')
      // 末尾可能有 ink 收尾空行，取前 GODDESS_HEIGHT 行衡量高度恒定。
      expect(all.length).toBeGreaterThanOrEqual(GODDESS_HEIGHT)
      const block = all.slice(0, GODDESS_HEIGHT)
      expect(block.length).toBe(GODDESS_HEIGHT)
    }

    // reveal 为 undefined → 全行有内容（无空白占位）。
    const { lastFrame } = render(<AstraeaGoddess />)
    const block = strip(lastFrame() ?? '').split('\n').slice(0, GODDESS_HEIGHT)
    expect(block.length).toBe(GODDESS_HEIGHT)
    for (const line of block) {
      expect(line.trim().length).toBeGreaterThan(0)
    }
  })
})

describe('WelcomePanel recent updates', () => {
  test('shows the localized DeepSeek migration notice on every launch', () => {
    const expected = {
      en: ['Recent updates', 'DeepSeek models are now V4 Flash / Pro. Run /login to sign in again.'],
      de: ['Letzte Updates', 'DeepSeek-Modelle sind jetzt V4 Flash / Pro. Führe /login aus, um dich erneut anzumelden.'],
      fr: ['Mises à jour récentes', 'Les modèles DeepSeek sont maintenant V4 Flash / Pro. Lancez /login pour vous reconnecter.'],
      es: ['Actualizaciones recientes', 'Los modelos DeepSeek ahora son V4 Flash / Pro. Ejecuta /login para volver a iniciar sesión.'],
      zh: ['最近更新', 'DeepSeek 模型已升级为 V4 Flash / Pro，请运行 /login 重新登录。'],
      ko: ['최근 업데이트', 'DeepSeek 모델이 V4 Flash / Pro로 변경되었습니다. /login을 실행해 다시 로그인하세요.'],
    } as const

    for (const locale of ['en', 'de', 'fr', 'es', 'zh', 'ko'] as const) {
      setLocale(locale)
      const frame = strip(renderPanel(100).lastFrame() ?? '')
      expect(frame).toContain(expected[locale][0])
      expect(frame).toContain(expected[locale][1])
    }
  })

  test('keeps the bordered panel intact when the notice wraps', () => {
    setLocale('de')
    for (const width of WIDTHS) {
      const { lastFrame } = renderPanel(width)
      const [first, last] = borderRows(lines(lastFrame() ?? ''))
      expect(stringWidth(first)).toBe(stringWidth(last))
      expect(first.endsWith('╮')).toBe(true)
      expect(last.endsWith('╯')).toBe(true)
    }
  })
})
