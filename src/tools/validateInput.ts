// 工具入口统一参数校验 —— 可靠性审计 PR-1
//
// 背景:Tool.ts 移除 Zod 后,工具普遍以 `input['x'] as T` 裸断言取参。模型传入
// 缺失必填 / 类型错误 / 非法枚举时,会穿透到执行层抛原始 TypeError,query.ts 只能
// 回传 `Tool execution error: TypeError: ...` —— 不含参数名与期望格式,模型无法自我修正。
//
// 本模块基于工具已有的 JSON Schema(inputSchema)做最小运行时校验,由 query.ts 在
// tool.call() 之前调用。校验失败返回「可自我修正」的结构化错误串(指出哪个参数、
// 期望什么),不进入 call()。
//
// 设计约束:
//   - 零依赖(不引入 ajv/zod)。inputSchema 结构简单,手写覆盖 required/type/enum/items 足够。
//   - 容错优先:MCP 工具的 schema 由 server 自报,可能不规范 —— 解析不了的部分一律放行,
//     绝不因校验器自身局限误杀合法调用。
//   - 未知字段不拒绝(与 Anthropic API 行为一致,additionalProperties 默认宽松)。

// 属性 schema 的最小结构(JSON Schema 子集,其余字段忽略)
interface PropSchema {
  type?: string | string[]
  enum?: unknown[]
  items?: PropSchema & { properties?: Record<string, unknown>; required?: string[] }
  properties?: Record<string, unknown>
  required?: string[]
}

const MAX_ERRORS = 3            // 最多报告 3 条,避免刷屏
const MAX_SCHEMA_SNIPPET = 200  // 错误里附带的 schema 片段长度上限

/**
 * 校验工具输入。返回 null = 通过;返回 string = 结构化错误消息(直接作为 isError 输出)。
 */
export function validateToolInput(
  toolName: string,
  schema: { type?: string; properties?: Record<string, unknown>; required?: string[] } | undefined,
  input: Record<string, unknown>,
): string | null {
  // 容错:schema 缺失 / 非 object 型 / properties 不是对象 → 放行(MCP 非标 schema)
  if (!schema || schema.type !== 'object') return null
  const props = schema.properties
  if (!props || typeof props !== 'object' || Array.isArray(props)) return null
  if (!input || typeof input !== 'object') {
    return `Invalid input for ${toolName}: input must be a JSON object.`
  }

  const errors: string[] = []

  // ── 1. required 缺失 ──────────────────────────────────────────────────────
  if (Array.isArray(schema.required)) {
    for (const key of schema.required) {
      if (typeof key !== 'string') continue
      if (input[key] === undefined) {
        const snippet = schemaSnippet(props[key])
        errors.push(
          `parameter "${key}" is required but missing.${snippet ? ` Expected schema: ${snippet}` : ''}`,
        )
        if (errors.length >= MAX_ERRORS) return formatErrors(toolName, errors)
      }
    }
  }

  // ── 2. 已提供参数的 type / enum / items 检查 ─────────────────────────────
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) continue
    const propRaw = props[key]
    // 未声明的字段(未知字段)与非对象 property schema(JSON Schema 允许 true/false)→ 放行
    if (!propRaw || typeof propRaw !== 'object' || Array.isArray(propRaw)) continue
    const prop = propRaw as PropSchema

    const err = validateValue(key, value, prop)
    if (err) {
      errors.push(err)
      if (errors.length >= MAX_ERRORS) break
    }
  }

  return errors.length > 0 ? formatErrors(toolName, errors) : null
}

// ── 单值校验(可递归进数组元素 / 嵌套对象)──────────────────────────────────
function validateValue(path: string, value: unknown, prop: PropSchema): string | null {
  // type 检查(支持 union type 数组;未声明 type 则跳过)
  if (prop.type !== undefined) {
    const types = Array.isArray(prop.type) ? prop.type : [prop.type]
    if (!types.some(t => matchesType(value, t))) {
      return (
        `parameter "${path}" must be of type ${types.join(' | ')}, got ${describeType(value)}.` +
        appendSnippet(prop)
      )
    }
  }

  // enum 检查
  if (Array.isArray(prop.enum) && prop.enum.length > 0 && !prop.enum.includes(value)) {
    return (
      `parameter "${path}" must be one of ${prop.enum.map(v => JSON.stringify(v)).join(', ')}, ` +
      `got ${JSON.stringify(truncateValue(value))}.`
    )
  }

  // 数组元素检查(items 是对象 schema 时)
  if (Array.isArray(value) && prop.items && typeof prop.items === 'object' && !Array.isArray(prop.items)) {
    for (let i = 0; i < value.length; i++) {
      const err = validateValue(`${path}[${i}]`, value[i], prop.items)
      if (err) return err // 一条数组只报第一个坏元素,足够定位
    }
  }

  // 嵌套对象检查(properties/required 存在时,浅递归一层层下去)
  if (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    prop.properties &&
    typeof prop.properties === 'object'
  ) {
    const obj = value as Record<string, unknown>
    if (Array.isArray(prop.required)) {
      for (const rk of prop.required) {
        if (typeof rk === 'string' && obj[rk] === undefined) {
          return `parameter "${path}.${rk}" is required but missing.${appendSnippet(
            (prop.properties[rk] ?? undefined) as PropSchema | undefined ?? {},
          )}`
        }
      }
    }
    for (const [ck, cv] of Object.entries(obj)) {
      if (cv === undefined) continue
      const childRaw = prop.properties[ck]
      if (!childRaw || typeof childRaw !== 'object' || Array.isArray(childRaw)) continue
      const err = validateValue(`${path}.${ck}`, cv, childRaw as PropSchema)
      if (err) return err
    }
  }

  return null
}

function matchesType(value: unknown, type: string): boolean {
  switch (type) {
    case 'string':  return typeof value === 'string'
    case 'number':  return typeof value === 'number' && !Number.isNaN(value)
    case 'integer': return typeof value === 'number' && Number.isInteger(value)
    case 'boolean': return typeof value === 'boolean'
    case 'array':   return Array.isArray(value)
    case 'object':  return value !== null && typeof value === 'object' && !Array.isArray(value)
    case 'null':    return value === null
    default:        return true // 未知 type 关键字 → 容错放行
  }
}

function describeType(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  return typeof value
}

function truncateValue(value: unknown): unknown {
  if (typeof value === 'string' && value.length > 60) return value.slice(0, 60) + '…'
  return value
}

function schemaSnippet(propRaw: unknown): string {
  if (!propRaw || typeof propRaw !== 'object') return ''
  try {
    const s = JSON.stringify(propRaw)
    return s.length > MAX_SCHEMA_SNIPPET ? s.slice(0, MAX_SCHEMA_SNIPPET) + '…' : s
  } catch {
    return ''
  }
}

function appendSnippet(prop: PropSchema): string {
  const s = schemaSnippet(prop)
  return s ? ` Expected schema: ${s}` : ''
}

function formatErrors(toolName: string, errors: string[]): string {
  const lines = errors.map(e => `  - ${e}`)
  return (
    `Invalid input for ${toolName} — the call was NOT executed. Fix the parameters and retry:\n` +
    lines.join('\n')
  )
}
