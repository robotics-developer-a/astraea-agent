// validateInput 单元测试 + 「10 个曾裸断言穿透的工具」缺参回归
import { test, expect, describe } from 'bun:test'
import { validateToolInput } from './validateInput'

const schema = (props: Record<string, unknown>, required?: string[]) => ({
  type: 'object' as const,
  properties: props,
  required,
})

describe('required 缺失', () => {
  test('缺必填参数 → 报参数名 + schema 片段', () => {
    const err = validateToolInput(
      'Demo',
      schema({ file_path: { type: 'string', description: 'abs path' } }, ['file_path']),
      {},
    )
    expect(err).toContain('Invalid input for Demo')
    expect(err).toContain('"file_path" is required but missing')
    expect(err).toContain('Expected schema:')
  })

  test('必填齐全 → 通过', () => {
    const err = validateToolInput(
      'Demo',
      schema({ a: { type: 'string' } }, ['a']),
      { a: 'x' },
    )
    expect(err).toBeNull()
  })

  test('多个缺失最多报 3 条', () => {
    const err = validateToolInput(
      'Demo',
      schema({ a: {}, b: {}, c: {}, d: {} }, ['a', 'b', 'c', 'd']),
      {},
    )!
    expect(err.match(/is required/g)!.length).toBe(3)
  })
})

describe('type 检查', () => {
  test.each([
    ['string', 42, 'number'],
    ['number', 'x', 'string'],
    ['boolean', 'true', 'string'],
    ['array', 'not-array', 'string'],
    ['object', [1], 'array'],
    ['object', null, 'null'],
  ])('声明 %s 传入 %p → 报类型错误', (type, value, got) => {
    const err = validateToolInput('Demo', schema({ p: { type } }), { p: value })
    expect(err).toContain(`"p" must be of type ${type}`)
    expect(err).toContain(`got ${got}`)
  })

  test('integer 拒绝小数', () => {
    expect(validateToolInput('Demo', schema({ n: { type: 'integer' } }), { n: 1.5 })).toContain('integer')
    expect(validateToolInput('Demo', schema({ n: { type: 'integer' } }), { n: 2 })).toBeNull()
  })

  test('number 拒绝 NaN', () => {
    expect(validateToolInput('Demo', schema({ n: { type: 'number' } }), { n: NaN })).toContain('"n"')
  })

  test('union type 任一匹配即通过', () => {
    const s = schema({ p: { type: ['string', 'number'] } })
    expect(validateToolInput('Demo', s, { p: 'x' })).toBeNull()
    expect(validateToolInput('Demo', s, { p: 1 })).toBeNull()
    expect(validateToolInput('Demo', s, { p: true })).toContain('string | number')
  })
})

describe('enum 检查', () => {
  const s = schema({ mode: { type: 'string', enum: ['read', 'write'] } })
  test('非法枚举 → 列出允许值', () => {
    const err = validateToolInput('Demo', s, { mode: 'delete' })
    expect(err).toContain('"read", "write"')
    expect(err).toContain('"delete"')
  })
  test('合法枚举通过', () => {
    expect(validateToolInput('Demo', s, { mode: 'read' })).toBeNull()
  })
})

describe('数组 items 与嵌套对象', () => {
  const todosSchema = schema(
    {
      todos: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            status: { type: 'string', enum: ['pending', 'done'] },
          },
          required: ['id'],
        },
      },
    },
    ['todos'],
  )

  test('null 元素 → 定位到下标', () => {
    const err = validateToolInput('Demo', todosSchema, { todos: [{ id: '1' }, null] })
    expect(err).toContain('"todos[1]"')
    expect(err).toContain('got null')
  })

  test('元素缺必填 → 定位到 todos[i].id', () => {
    const err = validateToolInput('Demo', todosSchema, { todos: [{ status: 'pending' }] })
    expect(err).toContain('"todos[0].id" is required')
  })

  test('元素枚举非法 → 定位到字段', () => {
    const err = validateToolInput('Demo', todosSchema, { todos: [{ id: '1', status: 'bogus' }] })
    expect(err).toContain('todos[0].status')
  })

  test('合法嵌套通过', () => {
    expect(validateToolInput('Demo', todosSchema, { todos: [{ id: '1', status: 'done' }] })).toBeNull()
  })

  test('items 仅声明标量类型也校验', () => {
    const s = schema({ tags: { type: 'array', items: { type: 'string' } } })
    expect(validateToolInput('Demo', s, { tags: ['a', 1] })).toContain('"tags[1]"')
    expect(validateToolInput('Demo', s, { tags: ['a', 'b'] })).toBeNull()
  })
})

describe('容错(绝不误杀)', () => {
  test('schema 缺失 / 非 object 型 → 放行', () => {
    expect(validateToolInput('Demo', undefined, { x: 1 })).toBeNull()
    expect(validateToolInput('Demo', { type: 'string' } as never, { x: 1 })).toBeNull()
  })
  test('properties 非对象 → 放行', () => {
    expect(validateToolInput('Demo', { type: 'object', properties: null } as never, { x: 1 })).toBeNull()
  })
  test('未知字段不拒绝', () => {
    expect(validateToolInput('Demo', schema({ a: { type: 'string' } }), { a: 'x', extra: 1 })).toBeNull()
  })
  test('property schema 为布尔(JSON Schema 合法)→ 放行', () => {
    expect(validateToolInput('Demo', schema({ a: true as never }), { a: 123 })).toBeNull()
  })
  test('未知 type 关键字 → 放行', () => {
    expect(validateToolInput('Demo', schema({ a: { type: 'weird' } }), { a: 1 })).toBeNull()
  })
})

// ── 回归:审计 D2=FAIL 的 10 个工具,缺必填时必须在入口被结构化拦截 ─────────────
describe('曾裸断言穿透的工具:缺参 → 结构化错误(不再是原始 TypeError)', () => {
  test('真实工具 schema 逐一验证', async () => {
    const { AgentTool } = await import('./AgentTool')
    const { FileEditTool } = await import('./FileEditTool')
    const { FileWriteTool } = await import('./FileWriteTool')
    const { LSPTool } = await import('./LSPTool')
    const { SendMessageTool } = await import('./SendMessageTool')
    const { ReviewArtifactTool } = await import('./ReviewArtifactTool')
    const { TaskCreateTool } = await import('./TaskCreateTool')
    const { VigilOnceTool } = await import('./VigilOnceTool')
    const { VigilScheduleTool } = await import('./VigilScheduleTool')
    const { VerifyOrbitExecutionTool } = await import('./VerifyOrbitExecutionTool')

    const cases: Array<[{ name: string; inputSchema: never }, string]> = [
      [AgentTool as never, 'prompt'],
      [FileEditTool as never, 'file_path'],
      [FileWriteTool as never, 'file_path'],
      [LSPTool as never, 'filePath'],
      [SendMessageTool as never, 'to'],
      [ReviewArtifactTool as never, 'artifact'],
      [TaskCreateTool as never, 'subject'],
      [VigilOnceTool as never, 'prompt'],
      [VigilScheduleTool as never, 'prompt'],
      [VerifyOrbitExecutionTool as never, 'plan_summary'],
    ]
    for (const [tool, param] of cases) {
      const err = validateToolInput(tool.name, tool.inputSchema, {})
      expect(err).not.toBeNull()
      expect(err).toContain(`"${param}"`)
      expect(err).toContain('NOT executed')
    }
  })

  test('TaskCreate: acceptanceCriteria 传字符串(曾致 normalizeCriteria 抛错)→ 类型错误', async () => {
    const { TaskCreateTool } = await import('./TaskCreateTool')
    const err = validateToolInput(TaskCreateTool.name, TaskCreateTool.inputSchema, {
      subject: 'x',
      acceptanceCriteria: 'not-an-array',
    })
    expect(err).toContain('"acceptanceCriteria" must be of type array')
  })

  test('ReviewArtifact: annotations 传数字(曾致 not-iterable 抛错)→ 类型错误', async () => {
    const { ReviewArtifactTool } = await import('./ReviewArtifactTool')
    const err = validateToolInput(ReviewArtifactTool.name, ReviewArtifactTool.inputSchema, {
      artifact: 'a.ts',
      annotations: 42,
    })
    expect(err).toContain('"annotations" must be of type array')
  })
})
