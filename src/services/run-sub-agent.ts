// 子 Agent 执行引擎 — 独立上下文的 Claude 会话循环
// 与主 query.ts 同构，但额外支持：pending message 注入、输出 ring buffer、AbortController

import { streamMessage } from '../api/stream'
import type { UserMessage, AssistantMessage, TextBlock, ToolUseBlock, ToolResultBlock } from '../types/message'
import type { Tool, ToolSchema } from '../tools/Tool'
import {
  appendAgentOutput,
  drainPendingMessages,
  completeAgentTask,
  failAgentTask,
} from './agent-state'
import { enqueueAgentNotification } from './notification-queue'
import { acquireAgentSlot, releaseAgentSlot } from './agent-concurrency'
import { smallModelName } from '../api/query-model'

const MAX_TURNS = 30
// 失控保护(可靠性审计 T7):此前子 agent 只有 turn 数上限——provider 流挂起、或每 turn
// 都超长输出时,既烧钱又占并发槽。墙钟 + 输出 token 预算双闸,任一触发即终止并回报原因。
const MAX_WALL_CLOCK_MS = 10 * 60_000
const MAX_OUTPUT_TOKENS = 200_000

// §5-#12: 子 agent 模型选择。'small' → 当前 provider 的小模型（map/摘要省钱）；
// 其余 → undefined（streamMessage 用默认主模型）。orchestrator 经 Agent({model:'small'}) 选。
export function resolveSubAgentModel(hint: string | undefined): string | undefined {
  return hint === 'small' ? smallModelName() : undefined
}

export async function runSubAgent(
  agentId: string,
  prompt: string,
  tools: Tool[],
  system: string,
  signal: AbortSignal,
  model?: string,
): Promise<void> {
  const startedAt = Date.now()
  let acquiredSlot = false

  // 墙钟信号与调用方 kill 信号合并:后续所有 aborted 检查与 streamMessage 都用 combined,
  // 流 stalled(无事件到达)时也能被墙钟从请求层掐断,不再依赖「有事件才检查」。
  const wallClock = AbortSignal.timeout(MAX_WALL_CLOCK_MS)
  const combined = AbortSignal.any([signal, wallClock])
  const wallClockExceeded = () => wallClock.aborted && !signal.aborted
  let outputTokens = 0
  let budgetExceeded = false

  try {
    await acquireAgentSlot() // §5-#8: 受全局并发上限约束，超额时在此排队
    acquiredSlot = true

    const toolSchemas: ToolSchema[] = tools.map(t => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema,
    }))

    let messages: (UserMessage | AssistantMessage)[] = [
      { role: 'user', content: prompt },
    ]

    let turnCount = 0
    let lastText = ''

    while (turnCount < MAX_TURNS) {
      if (combined.aborted || budgetExceeded) break

      // Inject any pending messages (sent via SendMessageTool from main agent)
      const pending = drainPendingMessages(agentId)
      if (pending.length > 0) {
        const last = messages[messages.length - 1]
        if (last?.role === 'user') {
          const content = typeof last.content === 'string'
            ? [{ type: 'text' as const, text: last.content }, ...pending.map(m => ({ type: 'text' as const, text: m }))]
            : [...last.content as TextBlock[], ...pending.map(m => ({ type: 'text' as const, text: m }))]
          messages = [...messages.slice(0, -1), { role: 'user', content }]
        } else {
          messages = [
            ...messages,
            { role: 'user', content: pending.map(m => ({ type: 'text' as const, text: m })) },
          ]
        }
      }

      turnCount++
      const contentBlocks: (TextBlock | ToolUseBlock)[] = []
      const toolUseBlocks: ToolUseBlock[] = []
      let turnText = ''

      for await (const event of streamMessage(messages, {
        system,
        tools: toolSchemas.length > 0 ? toolSchemas : undefined,
        abortSignal: combined,
        ...(model ? { model } : {}),
      })) {
        if (combined.aborted) break

        if (event.type === 'message_stop') {
          outputTokens += event.usage.output_tokens
          if (outputTokens > MAX_OUTPUT_TOKENS) budgetExceeded = true
        } else if (event.type === 'text') {
          turnText += event.text
          const last = contentBlocks.at(-1)
          if (last?.type === 'text') last.text += event.text
          else contentBlocks.push({ type: 'text', text: event.text })
          appendAgentOutput(agentId, event.text)
        } else if (event.type === 'tool_use') {
          const block: ToolUseBlock = {
            type: 'tool_use',
            id: event.id,
            name: event.name,
            input: event.input,
          }
          contentBlocks.push(block)
          toolUseBlocks.push(block)
          appendAgentOutput(agentId, `[tool: ${event.name}]`)
        }
      }

      if (combined.aborted) break

      if (turnText) lastText = turnText

      const assistantMessage: AssistantMessage = { role: 'assistant', content: contentBlocks }

      if (toolUseBlocks.length === 0) {
        // No tool calls → sub-agent is done
        break
      }

      // Execute tools serially (sub-agents don't need parallel tool execution)
      const toolResultBlocks: ToolResultBlock[] = []
      for (const toolUse of toolUseBlocks) {
        if (combined.aborted) break
        const tool = tools.find(t => t.name === toolUse.name)
        let output: string
        let isError = false
        if (!tool) {
          output = `Tool not found: "${toolUse.name}". Available: ${tools.map(t => t.name).join(', ')}`
          isError = true
        } else {
          try {
            // 子 agent 无交互 TTY：isInteractive:false → 工具遇 ask 一律 fail-closed deny，绝不挂起
            // （Permission & Safety Technical Spec §3.0）
            const res = await tool.call(toolUse.input, { mode: 'default', isInteractive: false, agentId, abortSignal: combined })
            output = res.output
            isError = res.isError ?? false
          } catch (err) {
            output = `Tool error: ${String(err)}`
            isError = true
          }
        }
        appendAgentOutput(agentId, `[tool_result: ${output.slice(0, 200)}]`)
        toolResultBlocks.push({
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content: output,
          is_error: isError || undefined,
        })
      }

      const toolResultMessage: UserMessage = { role: 'user', content: toolResultBlocks }
      messages = [...messages, assistantMessage, toolResultMessage]
    }

    if (signal.aborted) {
      enqueueAgentNotification(agentId, 'killed', undefined, undefined, Date.now() - startedAt)
      return
    }

    // 撞安全闸(墙钟/预算)→ 记 failed 并带明确原因,让 orchestrator 知道不是正常完成
    if (wallClockExceeded() || budgetExceeded) {
      const reason = budgetExceeded
        ? `Sub-agent exceeded output token budget (${MAX_OUTPUT_TOKENS} tokens) and was stopped. Partial result: ${lastText.slice(0, 500)}`
        : `Sub-agent exceeded wall-clock limit (${MAX_WALL_CLOCK_MS / 60_000} minutes) and was stopped. Partial result: ${lastText.slice(0, 500)}`
      if (failAgentTask(agentId, reason)) {
        enqueueAgentNotification(agentId, 'failed', undefined, reason, Date.now() - startedAt)
      }
      return
    }

    if (completeAgentTask(agentId, lastText)) {
      enqueueAgentNotification(agentId, 'completed', lastText, undefined, Date.now() - startedAt)
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (!signal.aborted) {
      // 墙钟触发时 streamMessage 会以 abort 错误冒泡到这里 —— 同样归因为超限而非普通失败
      const reason = wallClockExceeded()
        ? `Sub-agent exceeded wall-clock limit (${MAX_WALL_CLOCK_MS / 60_000} minutes): ${msg}`
        : msg
      if (failAgentTask(agentId, reason)) {
        enqueueAgentNotification(agentId, 'failed', undefined, reason, Date.now() - startedAt)
      }
    }
  } finally {
    if (acquiredSlot) releaseAgentSlot() // §5-#8: 任何退出路径都归还槽位
  }
}
