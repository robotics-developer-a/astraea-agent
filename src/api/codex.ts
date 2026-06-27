// Codex（ChatGPT 订阅）流式适配器 —— OpenAI Responses API，非 chat/completions。
//
// 与 src/api/openai.ts 的结构一致（streamMessageCodex → withIdleWatchdog + linkAbort），
// 但有三处根本不同：
//   ① 认证走 OAuth（getValidAccessToken），不是 API Key；用裸 fetch，不经 OpenAI SDK。
//   ② 端点是 chatgpt.com/backend-api/codex/responses（Responses API），请求/SSE 形状不同。
//   ③ 需要 codex 专属请求头（chatgpt-account-id / originator / OpenAI-Beta）。
//
// 简化（v1）：我们请求 reasoning.encrypted_content，但暂不把它回灌到后续轮次的 input。
// 多轮加密推理连续性留作后续跟进项（见 plan 的 follow-ups）。

import { config } from '../config'
import type { Message, StreamEvent, StopReason } from '../types/message'
import type { StreamOptions } from './anthropic'
import type { ToolSchema } from '../tools/Tool'
import { resolveAppliedEffort } from './reasoningEffort'
import { withIdleWatchdog, linkAbort } from './idleWatchdog'
import { getValidAccessToken, clearCodexTokenCache } from '../auth/codexAuth'
import {
  CODEX_RESPONSES_URL,
  ORIGINATOR,
  buildUserAgent,
} from '../auth/codexConstants'

// gpt-5.x / o 系是推理模型，给它们下发 reasoning 参数。
function isReasoningModel(model: string): boolean {
  return /^o\d/i.test(model) || /^gpt-5/i.test(model)
}

// 没有缓存的 SDK client —— 仅清内存里的 token 缓存，确保重新登录后生效。
export function resetCodexClient(): void {
  clearCodexTokenCache()
}

// ─── 消息转换：Anthropic 风格块 → Responses API input 项 ─────────────────────
// 这是最易出错的一块。Responses 的 input 是「item」数组，角色/工具调用各有专属 type。
type ResponsesInputItem = Record<string, unknown>

export function convertMessagesToInput(messages: Message[]): ResponsesInputItem[] {
  const items: ResponsesInputItem[] = []
  for (const msg of messages) {
    if (msg.role === 'user') {
      if (typeof msg.content === 'string') {
        items.push({
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: msg.content }],
        })
        continue
      }
      for (const block of msg.content) {
        if (block.type === 'tool_result') {
          const output = typeof block.content === 'string'
            ? block.content
            : block.content.map((b) => b.text).join('')
          items.push({
            type: 'function_call_output',
            call_id: block.tool_use_id,
            output,
          })
        } else {
          items.push({
            type: 'message',
            role: 'user',
            content: [{ type: 'input_text', text: block.text }],
          })
        }
      }
    } else {
      // assistant
      for (const block of msg.content) {
        if (block.type === 'text') {
          if (!block.text) continue
          items.push({
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: block.text }],
          })
        } else if (block.type === 'tool_use') {
          items.push({
            type: 'function_call',
            call_id: block.id,
            name: block.name,
            arguments: JSON.stringify(block.input),
          })
        }
      }
    }
  }
  return items
}

// 工具：Responses API 是扁平结构（不像 chat/completions 把字段塞进嵌套 function 对象）。
export function convertTools(tools: ToolSchema[] | undefined): ResponsesInputItem[] | undefined {
  if (!tools?.length) return undefined
  return tools.map((t) => ({
    type: 'function',
    name: t.name,
    description: t.description,
    parameters: t.input_schema,
  }))
}

// reasoning 参数：仅推理模型下发。effort 走 /reason 链；max → high 安全降级。
export function buildReasoningParam(model: string): { effort: string; summary: 'auto' } | undefined {
  if (!isReasoningModel(model)) return undefined
  const applied = resolveAppliedEffort()
  if (!applied) return undefined
  const effort = applied === 'max' ? 'high' : applied
  return { effort, summary: 'auto' }
}

export function streamMessageCodex(
  messages: Message[],
  options: StreamOptions = {},
): AsyncGenerator<StreamEvent> {
  const body = buildCodexRequestBody(messages, options)

  const linked = linkAbort(options.abortSignal)
  return withIdleWatchdog({
    stream: streamRawCodex(body, linked.signal),
    abort: linked.abort,
    // Responses API 只有流式形态（无 stream:false 等价），故看门狗超时后的兜底就是
    // 用 fallbackSignal 重发一次同样的流式请求（半开连接多为瞬时，重连通常即恢复）。
    fallback: () => streamRawCodex(body, linked.fallbackSignal),
  })
}

export function buildCodexRequestBody(
  messages: Message[],
  options: StreamOptions = {},
): Record<string, unknown> {
  const model = options.model ?? config.codex.model
  const body: Record<string, unknown> = {
    model,
    store: false,
    stream: true,
    max_output_tokens: options.maxTokens ?? config.codex.maxTokens,
    ...(options.system ? { instructions: options.system } : {}),
    input: convertMessagesToInput(messages),
    tool_choice: 'auto',
    parallel_tool_calls: true,
    include: ['reasoning.encrypted_content'],
  }
  const tools = convertTools(options.tools)
  if (tools) body.tools = tools
  const reasoning = buildReasoningParam(model)
  if (reasoning) body.reasoning = reasoning

  return body
}

// ─── SSE 解析 ────────────────────────────────────────────────────────────────
// Responses API 以 SSE 推送：每个事件由 `event:` 与 `data:` 行组成，事件间用空行分隔。
// 没有 SDK 替我们解析，手写一个 ReadableStream 读取器。

async function* streamRawCodex(
  body: Record<string, unknown>,
  signal: AbortSignal,
): AsyncGenerator<StreamEvent> {
  const { access, accountId } = await getValidAccessToken()

  const resp = await fetch(CODEX_RESPONSES_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${access}`,
      'chatgpt-account-id': accountId,
      originator: ORIGINATOR,
      'OpenAI-Beta': 'responses=experimental',
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      'User-Agent': buildUserAgent(),
    },
    body: JSON.stringify(body),
    signal,
  })

  if (resp.status === 401) {
    throw new Error('Codex request unauthorized (401) — session may be expired. Run /login.')
  }
  if (!resp.ok || !resp.body) {
    const text = await resp.text().catch(() => '')
    throw new Error(`Codex request failed (${resp.status}): ${text.slice(0, 300)}`)
  }

  yield* parseCodexSSE(resp.body)
}

// Responses API SSE 解析（独立导出，便于对捕获的 fixture 做单测）。
// 输入是 response.body 的 ReadableStream<Uint8Array>，产出与其它适配器同构的 StreamEvent。
export async function* parseCodexSSE(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<StreamEvent> {
  // function_call 累积缓冲：call_id → { name, args }
  const toolCalls = new Map<string, { name: string; args: string }>()
  let inputTokens = 0
  let outputTokens = 0
  let cacheReadTokens = 0
  let stopReason: StopReason = 'end_turn'

  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  // 单个 SSE 事件块 → StreamEvent（可能 0 或多个）。复用于循环内与流尾 flush。
  async function* handleEvent(rawEvent: string): AsyncGenerator<StreamEvent> {
      let dataStr = ''
      for (const line of rawEvent.split('\n')) {
        if (line.startsWith('data:')) {
          dataStr += line.slice(5).trimStart()
        }
        // event: 行类型也藏在 data 的 "type" 字段里，这里以 data 为准。
      }
      if (!dataStr || dataStr === '[DONE]') return

      let data: Record<string, unknown>
      try {
        data = JSON.parse(dataStr)
      } catch {
        return // 残缺 JSON（理论上不会，事件以空行边界切分）
      }

      const type = data.type as string | undefined
      if (!type) return

      // 正文文本增量
      if (type === 'response.output_text.delta') {
        const delta = data.delta as string | undefined
        if (delta) yield { type: 'text', text: delta }
        return
      }

      // 推理摘要 / 推理正文增量 → thinking（仅作心跳，不回灌历史）
      if (type === 'response.reasoning_summary_text.delta' || type === 'response.reasoning_text.delta') {
        const delta = data.delta as string | undefined
        if (delta) yield { type: 'thinking', text: delta }
        return
      }

      // 新增 output item：可能是 function_call（登记 call_id + name）
      if (type === 'response.output_item.added') {
        const item = data.item as Record<string, unknown> | undefined
        if (item?.type === 'function_call') {
          const callId = (item.call_id as string) || (item.id as string) || ''
          if (callId) {
            toolCalls.set(callId, { name: (item.name as string) || '', args: '' })
          }
        }
        return
      }

      // function_call 入参增量
      if (type === 'response.function_call_arguments.delta') {
        const callId = (data.call_id as string) || (data.item_id as string) || ''
        const delta = data.delta as string | undefined
        if (callId && delta != null) {
          const buf = toolCalls.get(callId) ?? { name: '', args: '' }
          buf.args += delta
          toolCalls.set(callId, buf)
        }
        return
      }

      // output item 完成：function_call 落地 → emit tool_use
      if (type === 'response.output_item.done') {
        const item = data.item as Record<string, unknown> | undefined
        if (item?.type === 'function_call') {
          const callId = (item.call_id as string) || (item.id as string) || ''
          const buf = toolCalls.get(callId)
          // 完整 arguments 优先取 item.arguments；否则用累积的增量。
          const argsStr = (item.arguments as string) ?? buf?.args ?? ''
          const name = (item.name as string) || buf?.name || ''
          let input: Record<string, unknown> = {}
          let incomplete = false
          try { input = argsStr ? JSON.parse(argsStr) : {} } catch { incomplete = true }
          yield { type: 'tool_use', id: callId, name, input, incomplete }
          if (callId) toolCalls.delete(callId)
          stopReason = 'tool_use'
        }
        return
      }

      // 完成事件：读 usage + 判定 stopReason
      if (type === 'response.completed' || type === 'response.incomplete') {
        const response = data.response as Record<string, unknown> | undefined
        const usage = response?.usage as Record<string, unknown> | undefined
        if (usage) {
          inputTokens = (usage.input_tokens as number) ?? 0
          outputTokens = (usage.output_tokens as number) ?? 0
          const details = usage.input_tokens_details as Record<string, unknown> | undefined
          cacheReadTokens = (details?.cached_tokens as number) ?? 0
        }
        if (type === 'response.incomplete') {
          const reason = (response?.incomplete_details as Record<string, unknown> | undefined)?.reason
          if (reason === 'max_output_tokens') stopReason = 'max_tokens'
        }
        return
      }

      // 错误事件
      if (type === 'response.failed' || type === 'error') {
        const response = data.response as Record<string, unknown> | undefined
        const err = (response?.error ?? data.error) as Record<string, unknown> | undefined
        const message = (err?.message as string) || 'Codex stream error'
        throw new Error(`Codex: ${message}`)
      }
  }

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    // 以空行分隔事件块；逐个完整事件处理。
    let sep: number
    while ((sep = buffer.indexOf('\n\n')) !== -1) {
      const rawEvent = buffer.slice(0, sep)
      buffer = buffer.slice(sep + 2)
      yield* handleEvent(rawEvent)
    }
  }
  // 流结束：处理残留缓冲里最后一个未以空行收尾的事件（如 response.completed）。
  if (buffer.trim()) yield* handleEvent(buffer)

  yield {
    type: 'message_stop',
    usage: {
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      cache_read_input_tokens: cacheReadTokens,
    },
    stopReason,
  }
}
