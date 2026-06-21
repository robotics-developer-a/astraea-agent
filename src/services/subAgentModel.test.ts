// §5-#12: map/摘要类子 agent 可走小模型省钱（orchestrator 通过 Agent({model:'small'}) 选）
import { test, expect } from 'bun:test'
import { resolveSubAgentModel } from './run-sub-agent'
import { smallModelName } from '../api/query-model'

test("model:'small' → 解析到当前 provider 的小模型", () => {
  expect(resolveSubAgentModel('small')).toBe(smallModelName())
})

test('不传 / default → undefined（streamMessage 用默认主模型）', () => {
  expect(resolveSubAgentModel(undefined)).toBeUndefined()
  expect(resolveSubAgentModel('default')).toBeUndefined()
})
