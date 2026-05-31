// 简化版 Tool interface
// 参考源码: claude-code-main/src/Tool.ts
//
// 原版依赖 Zod schema + React 渲染 + 权限系统，这里只保留运行所需的最小接口

import type { SessionMode } from '../state/sessionMode'

export interface ToolCallResult {
  output: string
  isError?: boolean
}

// 传给 Anthropic / OpenAI API 的 JSON Schema 格式
export interface ToolSchema {
  name: string
  description: string
  input_schema: {
    type: 'object'
    properties: Record<string, unknown>
    required?: string[]
  }
}

// ─── ToolContext ──────────────────────────────────────────────────────────────
// 每次工具调用时由 query.ts 注入的运行时上下文。
//
// 实现新工具时必须：
//   1. call(input, ctx: ToolContext) — 必填，不得省略
//   2. 根据 ctx.mode 决定行为：
//      - 'orbit'   → 写操作工具应返回 deny error
//      - 'forge'   → 跳过所有权限确认，直接执行
//      - 'counsel' → 工具本身无需感知，由 query.ts 层处理
//      - 'default' → 标准流程
//   3. callStream 同样需要接受 ctx 参数
//
// 参考实现：FileEditTool（orbit deny）、BashTool（forge skip confirm）
export interface ToolContext {
  mode: SessionMode
  agentId?: string
  abortSignal?: AbortSignal
}

export const DEFAULT_TOOL_CONTEXT: ToolContext = { mode: 'default' }

export interface Tool {
  name: string
  description: string
  inputSchema: ToolSchema['input_schema']
  isReadOnly: boolean
  call(input: Record<string, unknown>, ctx: ToolContext): Promise<ToolCallResult>
  /** Optional per-tool REPL result renderer. Return lines to display; null = use generic fallback. */
  renderResult?(input: Record<string, unknown>, output: string, isError: boolean): string[] | null
  /**
   * Optional streaming execution: yields output chunks as the tool runs,
   * then returns the final ToolCallResult. When present, query.ts uses this
   * instead of call() and emits tool_progress events per chunk.
   */
  callStream?(input: Record<string, unknown>, ctx: ToolContext): AsyncGenerator<string, ToolCallResult>
}
