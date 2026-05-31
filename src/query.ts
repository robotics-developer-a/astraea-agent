// ★ 核心 Query 循环 — Agent 的 think → act → observe → repeat
// 参考源码: claude-code-main/src/query.ts (queryLoop, 第 281-1732 行)
//
// 原版的复杂特性（compaction、fallback model、stop hooks、并发工具执行）
// 全部省略，只保留最核心的 while(true) Agent 循环

import { streamMessage } from './api/stream'
import type { StreamEvent } from './types/message'
import {
  type AssistantMessage,
  type TextBlock,
  type ToolResultBlock,
  type ToolUseBlock,
  type UserMessage,
} from './types/message'
import type { Tool, ToolSchema, ToolContext } from './tools/Tool'
import { findTool } from './tools/registry'
import { getMode } from './state/sessionMode'
import { yieldMissingToolResultBlocks } from './utils/messages'
import {
  getSystemContext,
  getUserContext,
  appendSystemContext,
  prependUserContext,
} from './context/session-preamble'

import {
  createBudgetTracker,
  recordTurnTokens,
  checkTokenBudget,
} from './utils/token-budget'

import { drainNotifications, hasPendingNotifications } from './services/notification-queue'
import { hasRunningAgents } from './services/agent-state'

// ─────────────────────────── 事件类型 ───────────────────────────────────────

// QueryEvent 是 StreamEvent 的超集：增加了 turn_start、tool_result、budget_stop
export type QueryEvent =
  | StreamEvent
  | { type: 'turn_start'; turn: number }
  | { type: 'tool_progress'; id: string; name: string; chunk: string }
  | { type: 'tool_result'; id: string; name: string; input: Record<string, unknown>; output: string; isError: boolean }
  | { type: 'max_turns_reached'; maxTurns: number }
  | { type: 'budget_stop'; reason: 'budget_reached' | 'diminishing_returns'; totalTokens: number }
  | { type: 'done'; messages: (UserMessage | AssistantMessage)[] }

// ─────────────────────────── 参数类型 ───────────────────────────────────────

export interface QueryOptions {
  system?: string
  maxTurns?: number          // 默认 10，防无限循环
  enablePromptCaching?: boolean
  cwd?: string               // 用于 session preamble 的工作目录（默认 process.cwd()）
  tokenBudget?: number | null  // 输出 token 预算上限（null = 无限制）
  agentId?: string             // 用于调试追踪哪个 agent 触发了停止
}

// ─────────────────────────── 主函数 ─────────────────────────────────────────

export async function* query(
  initialMessages: (UserMessage | AssistantMessage)[],
  tools: Tool[],
  options: QueryOptions = {},
): AsyncGenerator<QueryEvent> {
  const maxTurns = options.maxTurns ?? 10
  const cwd = options.cwd ?? process.cwd()
  const budget = options.tokenBudget ?? null
  const agentId = options.agentId ?? 'default'

  // 每个 query() 调用创建独立的 tracker，防止跨调用（父/子 agent）间的 token 计数污染
  let tracker = createBudgetTracker(agentId)

  // 把 Tool[] 转成 API 需要的 ToolSchema[]
  const toolSchemas: ToolSchema[] = tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.inputSchema,
  }))

  // ── Session Preamble ──────────────────────────────────────────────────────
  // Both calls are memoized at Promise level — safe to call concurrently and
  // multiple times; the underlying I/O runs exactly once per process lifetime.
  const [sysCtx, userCtx] = await Promise.all([
    getSystemContext(),
    getUserContext(cwd),
  ])

  const system = appendSystemContext(options.system ?? '', sysCtx)

  // State: 每轮追加 assistantMessage + toolResultMessage
  // Prepend <system-reminder> with claudeMd + date before the user's first message.
  let messages: (UserMessage | AssistantMessage)[] = prependUserContext(
    [...initialMessages],
    userCtx,
  )
  let turnCount = 1

  while (true) {
    yield { type: 'turn_start', turn: turnCount }

    // ── 1. 调用模型，收集流式事件 ──────────────────────────────────────────
    const contentBlocks: (TextBlock | ToolUseBlock)[] = []
    const toolUseBlocks: ToolUseBlock[] = []
    let turnOutputTokens = 0

    // assistantMessage 在流结束前先设为 null，用于错误恢复
    let assistantMessage: AssistantMessage | null = null

    try {
      for await (const event of streamMessage(messages, {
        system,
        enablePromptCaching: options.enablePromptCaching,
        tools: toolSchemas.length > 0 ? toolSchemas : undefined,
      })) {
        // 透传给上层（CLI 渲染）
        yield event

        // 同时收集内容，用于构建 AssistantMessage
        if (event.type === 'text') {
          const last = contentBlocks.at(-1)
          if (last?.type === 'text') {
            // 合并相邻的 text block
            last.text += event.text
          } else {
            contentBlocks.push({ type: 'text', text: event.text })
          }
        } else if (event.type === 'tool_use') {
          const block: ToolUseBlock = {
            type: 'tool_use',
            id: event.id,
            name: event.name,
            input: event.input,
          }
          contentBlocks.push(block)
          toolUseBlocks.push(block)
        } else if (event.type === 'message_stop') {
          turnOutputTokens = event.usage.output_tokens
        }
      }
    } catch (err: unknown) {
      // API 调用出错：如果已经收到了带 tool_use 的 assistant 消息，
      // 需要补齐 tool_result，否则下次 API 调用会因不配对而报 400
      if (toolUseBlocks.length > 0) {
        const partialAssistant: AssistantMessage = { role: 'assistant', content: contentBlocks }
        const errorMsg = `API error during tool execution: ${String(err)}`
        const errorResults = [...yieldMissingToolResultBlocks(partialAssistant, errorMsg)]
        // 追加到历史，让调用方知道这轮中断了
        messages = [...messages, partialAssistant, ...errorResults]
      }
      throw err
    }

    // ── 2. 构建 AssistantMessage ───────────────────────────────────────────
    assistantMessage = {
      role: 'assistant',
      content: contentBlocks,
    }

    // ── 2a. 更新预算追踪器并检查是否达到停止条件 ──────────────────────────
    tracker = recordTurnTokens(tracker, turnOutputTokens)
    const budgetDecision = checkTokenBudget(tracker, budget)
    if (budgetDecision.action === 'stop') {
      yield {
        type: 'budget_stop',
        reason: budgetDecision.reason,
        totalTokens: tracker.lastGlobalTurnTokens,
      }
      yield { type: 'done' as const, messages: [...messages, assistantMessage] }
      return
    }

    // ── 3. 无工具调用 → 检查是否有后台 Agent 仍在运行 ─────────────────────
    if (toolUseBlocks.length === 0) {
      const immediateNotifs = drainNotifications()

      if (immediateNotifs.length > 0) {
        // Notifications arrived during this turn — feed them to the model
        const waitMsg: UserMessage = {
          role: 'user',
          content: immediateNotifs.map(n => ({ type: 'text' as const, text: n })),
        }
        messages = [...messages, assistantMessage, waitMsg]
        if (turnCount >= maxTurns) {
          yield { type: 'max_turns_reached', maxTurns }
          yield { type: 'done' as const, messages }
          return
        }
        turnCount++
        continue
      }

      if (hasRunningAgents()) {
        // Agents still running but no notifications yet — poll without calling model
        // This avoids burning tokens while idle-waiting
        while (hasRunningAgents() && !hasPendingNotifications()) {
          await Bun.sleep(200)
        }
        // Re-enter the loop: notifications are now available (or agents finished)
        const freshNotifs = drainNotifications()
        if (freshNotifs.length > 0) {
          const waitMsg: UserMessage = {
            role: 'user',
            content: freshNotifs.map(n => ({ type: 'text' as const, text: n })),
          }
          messages = [...messages, assistantMessage, waitMsg]
          if (turnCount >= maxTurns) {
            yield { type: 'max_turns_reached', maxTurns }
            yield { type: 'done' as const, messages }
            return
          }
          turnCount++
          continue
        }
      }

      yield { type: 'done' as const, messages: [...messages, assistantMessage] }
      return
    }

    // ── 4. 执行所有工具调用（有 callStream 的工具顺序执行并 yield 进度，其余并行）────
    const toolResultBlocks: ToolResultBlock[] = []

    // 每轮工具执行前构建 ctx（mode 在执行过程中可能由 EnterOrbitMode/ExitOrbitMode 改变，
    // 因此在这里读取快照；单个工具调用内 mode 不变）
    const toolCtx: ToolContext = {
      mode: getMode(),
      agentId: options.agentId,
      abortSignal: undefined,
    }

    // 分流式 vs 普通工具
    const streamingBlocks = toolUseBlocks.filter(b => !!findTool(b.name)?.callStream)
    const normalBlocks    = toolUseBlocks.filter(b => !findTool(b.name)?.callStream)

    // 普通工具并行执行（无进度事件）
    const normalResults = await Promise.all(
      normalBlocks.map(async (toolUse) => {
        const tool = findTool(toolUse.name)
        if (!tool) return { toolUse, output: `Tool not found: "${toolUse.name}"`, isError: true }
        // EnterOrbitMode / ExitOrbitMode 改变模式后，后续工具拿到更新后的 mode
        const ctx: ToolContext = { ...toolCtx, mode: getMode() }
        try {
          const result = await tool.call(toolUse.input, ctx)
          return { toolUse, output: result.output, isError: result.isError ?? false }
        } catch (err: unknown) {
          return { toolUse, output: `Tool execution error: ${String(err)}`, isError: true }
        }
      }),
    )

    // 流式工具顺序执行，每个 chunk 都 yield tool_progress
    const streamingResults: Array<{ toolUse: typeof toolUseBlocks[0]; output: string; isError: boolean }> = []
    for (const toolUse of streamingBlocks) {
      const tool = findTool(toolUse.name)!
      const ctx: ToolContext = { ...toolCtx, mode: getMode() }
      let output: string
      let isError: boolean
      try {
        const gen = tool.callStream!(toolUse.input, ctx)
        let next: IteratorResult<string, import('./tools/Tool.js').ToolCallResult>
        do {
          next = await gen.next()
          if (!next.done && next.value) {
            yield { type: 'tool_progress', id: toolUse.id, name: toolUse.name, chunk: next.value }
          }
        } while (!next.done)
        output = next.value.output
        isError = next.value.isError ?? false
      } catch (err: unknown) {
        output = `Tool execution error: ${String(err)}`
        isError = true
      }
      streamingResults.push({ toolUse, output, isError })
    }

    // 按原始顺序合并结果并 yield tool_result
    const allResults = [...normalResults, ...streamingResults].sort(
      (a, b) => toolUseBlocks.indexOf(a.toolUse) - toolUseBlocks.indexOf(b.toolUse),
    )

    for (const { toolUse, output, isError } of allResults) {
      yield { type: 'tool_result', id: toolUse.id, name: toolUse.name, input: toolUse.input, output, isError }
      toolResultBlocks.push({
        type: 'tool_result',
        tool_use_id: toolUse.id,
        content: output,
        is_error: isError || undefined,
      })
    }

    // Build user message: tool_results + any pending task_notifications as text blocks
    const pendingNotifs = drainNotifications()
    const extraTextBlocks: TextBlock[] = pendingNotifs.map(n => ({ type: 'text', text: n }))

    // ── 5. 把 assistant + tool_results 追加到历史，进入下一轮 ──────────────
    const toolResultMessage: UserMessage = {
      role: 'user',
      content: [...toolResultBlocks, ...extraTextBlocks],
    }

    messages = [...messages, assistantMessage, toolResultMessage]

    // ── 6. maxTurns 保护 ───────────────────────────────────────────────────
    if (turnCount >= maxTurns) {
      yield { type: 'max_turns_reached', maxTurns }
      yield { type: 'done' as const, messages }
      return
    }

    turnCount++
  }
}
