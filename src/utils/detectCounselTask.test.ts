import { describe, expect, test } from 'bun:test'
import { detectCounselTask } from './detectLongTask'

describe('detectCounselTask', () => {
  test('enters counsel for a short task with a subjective outcome', () => {
    expect(detectCounselTask('把这个 UI 设计得美观一些')).toEqual({
      counsel: true,
      reason: 'ambiguous',
    })
  })

  test('enters counsel for an underspecified improvement request', () => {
    expect(detectCounselTask('优化一下这个页面')).toEqual({
      counsel: true,
      reason: 'ambiguous',
    })
  })

  test('does not enter counsel for an informational question', () => {
    expect(detectCounselTask('请解释这个函数是怎么工作的')).toEqual({
      counsel: false,
      reason: null,
    })
  })

  test('does not enter counsel when the requested outcome is concrete', () => {
    expect(detectCounselTask('修复登录表单：邮箱为空时显示必填错误，并添加回归测试')).toEqual({
      counsel: false,
      reason: null,
    })
  })

  test('keeps the existing long-task signal', () => {
    expect(detectCounselTask('重构会话存储模块')).toEqual({
      counsel: true,
      reason: 'keyword',
    })
  })
})
