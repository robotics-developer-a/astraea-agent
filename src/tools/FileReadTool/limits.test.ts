// 方案 A / §A.1 / §5-#4 / §5-#5: Read 闸门的纯函数
import { test, expect } from 'bun:test'
import {
  computeReadMaxTokens,
  checkFileSize,
  checkTokenBudget,
  looksBinary,
  READ_TOKEN_FLOOR,
  READ_TOKEN_CEIL,
} from './limits'

// ── §A.1 模型自适应单读上限 ──────────────────────────────────────────────
test('computeReadMaxTokens: 小窗口命中 FLOOR', () => {
  expect(computeReadMaxTokens(8_000)).toBe(READ_TOKEN_FLOOR)   // 8000*0.06=480 → 4000
  expect(computeReadMaxTokens(32_000)).toBe(READ_TOKEN_FLOOR)  // 1920 → 4000
})

test('computeReadMaxTokens: 中等窗口取比例值', () => {
  expect(computeReadMaxTokens(128_000)).toBe(7_680)
  expect(computeReadMaxTokens(256_000)).toBe(15_360)
})

test('computeReadMaxTokens: 超大窗口命中 CEIL', () => {
  expect(computeReadMaxTokens(1_000_000)).toBe(READ_TOKEN_CEIL) // 60000 → 25000
})

// ── 体积闸门（含 §5-#4：硬上限不被 limit 绕过）────────────────────────────
test('checkFileSize: 小文件放行', () => {
  expect(checkFileSize(100, false)).toBeNull()
})

test('checkFileSize: 超软上限且无 limit → 报错', () => {
  expect(checkFileSize(300_000, false)).not.toBeNull()
})

test('checkFileSize: 传了 limit 可绕过软上限', () => {
  expect(checkFileSize(300_000, true)).toBeNull()
})

test('§5-#4: 超硬上限即使传 limit 也报错', () => {
  expect(checkFileSize(60 * 1024 * 1024, true)).not.toBeNull()
  expect(checkFileSize(60 * 1024 * 1024, false)).not.toBeNull()
})

// ── 输出 token 闸门 ──────────────────────────────────────────────────────
test('checkTokenBudget: 超预算报错、未超放行', () => {
  expect(checkTokenBudget(30_000, 7_680)).not.toBeNull()
  expect(checkTokenBudget(5_000, 7_680)).toBeNull()
})

// ── §5-#5: 二进制嗅探（NUL 字节）──────────────────────────────────────────
test('looksBinary: 含 NUL 字节 → true；纯文本 → false', () => {
  expect(looksBinary('abc\u0000def')).toBe(true)
  expect(looksBinary('plain text 中文')).toBe(false)
})
