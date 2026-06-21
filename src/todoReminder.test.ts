// 周期性 TodoWrite 提醒的判定逻辑（query.ts shouldRemindTodo）。
// 阈值：连续 10 轮没用过 TodoWrite，且距上次提醒也已 10 轮 → 该提醒。
import { test, expect } from 'bun:test'
import { shouldRemindTodo } from './query'

test('从未用过：第 9 轮不提醒，第 10 轮提醒', () => {
  expect(shouldRemindTodo(9, 0, 0)).toBe(false)
  expect(shouldRemindTodo(10, 0, 0)).toBe(true)
})

test('本轮刚用过（活跃游标=当前轮）→ 不提醒', () => {
  expect(shouldRemindTodo(15, 15, 0)).toBe(false)
})

test('用过后又过 10 轮 → 再次提醒', () => {
  // 第 3 轮用过 → 第 12 轮还差一点，第 13 轮到点
  expect(shouldRemindTodo(12, 3, 0)).toBe(false)
  expect(shouldRemindTodo(13, 3, 0)).toBe(true)
})

test('刚提醒过 → 至少隔 10 轮才再提醒（防刷屏）', () => {
  // 一直没用过(activity=0)，但上次提醒在第 10 轮：第 19 轮不提醒，第 20 轮才提醒
  expect(shouldRemindTodo(19, 0, 10)).toBe(false)
  expect(shouldRemindTodo(20, 0, 10)).toBe(true)
})

test('简单短任务（< 10 轮）永不触发 → 阈值本身就是过滤器', () => {
  for (let t = 1; t < 10; t++) {
    expect(shouldRemindTodo(t, 0, 0)).toBe(false)
  }
})
