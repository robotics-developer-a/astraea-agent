import { test, expect, beforeAll, afterAll } from 'bun:test'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { normalizeDraggedPath } from './dragPath'

// 在真实临时目录里造几个文件，因为 normalizeDraggedPath 用 existsSync 作为强信号。
let dir: string
let plain: string
let spaced: string
let parened: string

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'dragpath-'))
  plain = join(dir, 'photo.png')
  spaced = join(dir, 'My Photos.png')
  parened = join(dir, 'shot (1).png')
  for (const f of [plain, spaced, parened]) writeFileSync(f, 'x')
})

afterAll(() => rmSync(dir, { recursive: true, force: true }))

const isWin = process.platform === 'win32'

test('裸绝对路径原样还原', () => {
  expect(normalizeDraggedPath(plain)).toBe(plain)
})

test('终端在末尾补的空格被去掉', () => {
  expect(normalizeDraggedPath(plain + ' ')).toBe(plain)
})

test('macOS 反斜杠转义的空格被还原（含空格的路径加单引号）', () => {
  if (isWin) return
  const dragged = spaced.replace(/ /g, '\\ ') // /tmp/.../My\ Photos.png
  expect(normalizeDraggedPath(dragged)).toBe(`'${spaced}'`)
})

test('macOS 反斜杠转义的括号被还原', () => {
  if (isWin) return
  const dragged = parened.replace(/ /g, '\\ ').replace(/\(/g, '\\(').replace(/\)/g, '\\)')
  expect(normalizeDraggedPath(dragged)).toBe(`'${parened}'`)
})

test('双引号包裹的路径被去引号（Windows 拖入风格）', () => {
  expect(normalizeDraggedPath(`"${spaced}"`)).toBe(`'${spaced}'`)
})

test('普通文本不被当成路径', () => {
  expect(normalizeDraggedPath('hello world this is a sentence')).toBeNull()
})

test('不存在的绝对路径不被当成拖入文件', () => {
  expect(normalizeDraggedPath(join(dir, 'nope-not-here.png'))).toBeNull()
})

test('相对路径不被当成拖入文件', () => {
  expect(normalizeDraggedPath('./photo.png')).toBeNull()
})

test('多行粘贴不被当成路径', () => {
  expect(normalizeDraggedPath(`${plain}\nmore text`)).toBeNull()
})

test('一次拖入多个文件用空格连接', () => {
  if (isWin) return
  const dragged = `${plain} ${spaced.replace(/ /g, '\\ ')}`
  expect(normalizeDraggedPath(dragged)).toBe(`${plain} '${spaced}'`)
})

test('空字符串返回 null', () => {
  expect(normalizeDraggedPath('')).toBeNull()
  expect(normalizeDraggedPath('   ')).toBeNull()
})
