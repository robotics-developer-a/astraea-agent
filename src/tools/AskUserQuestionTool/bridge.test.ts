import { expect, test } from 'bun:test'
import {
  answer,
  ask,
  cancelAllQuestions,
  getPending,
  hasPending,
  onQuestion,
} from './bridge'

const q = (question: string) => [{ question, options: [{ label: 'yes' }, { label: 'no' }] }]

// 主 agent 与后台 sub-agent 共享本 bridge，提问可能并发到达。
// 单槽位实现会让后到的覆盖先到的，先到的 Promise 永远悬挂 → 工具卡死。
test('concurrent questions are answered one by one, none is lost', async () => {
  const shown: string[] = []
  const unsubscribe = onQuestion(pq => { shown.push(pq.questions[0]!.question) })
  try {
    const first = ask(q('first?'))
    const second = ask(q('second?'))

    expect(shown).toEqual(['first?'])
    expect(getPending()?.questions[0]?.question).toBe('first?')

    answer('A')
    // 队头回答后，下一个问题自动推送给 UI
    expect(shown).toEqual(['first?', 'second?'])
    expect(getPending()?.questions[0]?.question).toBe('second?')

    answer('B')
    expect(hasPending()).toBe(false)

    await expect(first).resolves.toBe('A')
    await expect(second).resolves.toBe('B')
  } finally {
    unsubscribe()
  }
})

test('cancelAllQuestions resolves every queued ask with an empty answer', async () => {
  const unsubscribe = onQuestion(() => {})
  try {
    const a = ask(q('a?'))
    const b = ask(q('b?'))
    cancelAllQuestions()
    expect(hasPending()).toBe(false)
    await expect(a).resolves.toBe('')
    await expect(b).resolves.toBe('')
  } finally {
    unsubscribe()
  }
})

test('last UI unsubscribe resolves orphaned questions instead of hanging them', async () => {
  const unsubscribe = onQuestion(() => {})
  const pending = ask(q('orphan?'))
  unsubscribe()
  await expect(pending).resolves.toBe('')
  expect(hasPending()).toBe(false)
})
