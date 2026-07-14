// AskUserQuestion fail-closed 收口测试(可靠性审计 PR-4,T10)
// 此前无人值守时 fail-open 返回「自行判断」,模型会替用户拍板方向性决策;
// 现在与 fileWriteGate/BashTool 对齐:非交互一律 isError,并指示保守路径。
import { test, expect, describe } from 'bun:test'
import { AskUserQuestionTool } from './index'

const questions = [{ question: '继续吗?', options: [{ label: 'Yes' }, { label: 'No' }] }]

describe('AskUserQuestion fail-closed', () => {
  test('isInteractive=false → isError,指示保守路径,绝不「自行判断」', async () => {
    const r = await AskUserQuestionTool.call({ questions }, { mode: 'default', isInteractive: false })
    expect(r.isError).toBe(true)
    expect(r.output).toContain('fail-closed')
    expect(r.output).not.toContain('best judgment')
  })

  test('isInteractive 未设定(undefined)按 false 处理', async () => {
    const r = await AskUserQuestionTool.call({ questions }, { mode: 'default' })
    expect(r.isError).toBe(true)
    expect(r.output).toContain('fail-closed')
  })

  test('交互会话但无监听者(问题被清空/退订)→ isError,不默认任何选项', async () => {
    // bridge 无 listener 时 ask() 返回 '' —— 交互路径下同样不得替用户拍板
    const r = await AskUserQuestionTool.call({ questions }, { mode: 'default', isInteractive: true })
    expect(r.isError).toBe(true)
    expect(r.output).toContain('dismissed')
  })

  test('无有效问题仍是非错误提示(入参问题,与 fail-closed 无关)', async () => {
    const r = await AskUserQuestionTool.call({}, { mode: 'default', isInteractive: false })
    expect(r.isError).toBeFalsy()
    expect(r.output).toContain('No valid question')
  })
})
