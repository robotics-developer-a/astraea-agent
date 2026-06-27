// Codex (ChatGPT subscription) streaming adapter — OpenAI Responses API, not chat/completions.
//
// Mirrors the structure of src/api/openai.ts (streamMessageCodex → withIdleWatchdog + linkAbort),
// but differs in three fundamental ways:
//   ① auth goes through OAuth (getValidAccessToken), not an API key; uses bare fetch, not the OpenAI SDK.
//   ② the endpoint is chatgpt.com/backend-api/codex/responses (Responses API), with different request/SSE shapes.
//   ③ it needs codex-specific request headers (chatgpt-account-id / originator / OpenAI-Beta).
//
// Simplification (v1): we request reasoning.encrypted_content but do not yet feed it back into the input on subsequent turns.
// Multi-turn encrypted reasoning continuity is left as a follow-up (see the plan's follow-ups).

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

// gpt-5.x / o-series are reasoning models; send them the reasoning param.
function isReasoningModel(model: string): boolean {
  return /^o\d/i.test(model) || /^gpt-5/i.test(model)
}

// No cached SDK client — just clear the in-memory token cache so a re-login takes effect.
export function resetCodexClient(): void {
  clearCodexTokenCache()
}

// ─── message conversion: Anthropic-style blocks → Responses API input items ─────────────────────
// This is the most error-prone part. The Responses input is an array of "items", and roles / tool calls each have their own type.
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

// tools: the Responses API is flat (unlike chat/completions, which nests the fields inside a function object).
export function convertTools(tools: ToolSchema[] | undefined): ResponsesInputItem[] | undefined {
  if (!tools?.length) return undefined
  return tools.map((t) => ({
    type: 'function',
    name: t.name,
    description: t.description,
    parameters: t.input_schema,
  }))
}

// reasoning param: only sent for reasoning models. effort follows the /reason chain; max → high safe downgrade.
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
    // The Responses API only has a streaming form (no stream:false equivalent), so the fallback after an idle-watchdog
    // timeout is to resend the same streaming request with fallbackSignal (half-open connections are usually transient, and a reconnect typically recovers).
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
    // The ChatGPT-backend Codex endpoint rejects max_output_tokens (400 "Unsupported parameter"),
    // so we deliberately don't send it — the backend applies its own output cap.
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

// ─── SSE parsing ────────────────────────────────────────────────────────────────
// The Responses API streams over SSE: each event is made of `event:` and `data:` lines, with a blank line between events.
// There's no SDK to parse it for us, so we hand-write a ReadableStream reader.

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

// Responses API SSE parsing (exported separately so captured fixtures can be unit-tested).
// Input is the ReadableStream<Uint8Array> from response.body; output is StreamEvent values, isomorphic to the other adapters.
export async function* parseCodexSSE(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<StreamEvent> {
  // function_call accumulation buffer: call_id → { name, args }
  const toolCalls = new Map<string, { name: string; args: string }>()
  let inputTokens = 0
  let outputTokens = 0
  let cacheReadTokens = 0
  let stopReason: StopReason = 'end_turn'

  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  // single SSE event block → StreamEvent (possibly 0 or more). Reused inside the loop and for the end-of-stream flush.
  async function* handleEvent(rawEvent: string): AsyncGenerator<StreamEvent> {
      let dataStr = ''
      for (const line of rawEvent.split('\n')) {
        if (line.startsWith('data:')) {
          dataStr += line.slice(5).trimStart()
        }
        // the event: line type is also carried in data's "type" field, so we treat data as authoritative.
      }
      if (!dataStr || dataStr === '[DONE]') return

      let data: Record<string, unknown>
      try {
        data = JSON.parse(dataStr)
      } catch {
        return // malformed JSON (shouldn't happen in theory, since events are split on blank-line boundaries)
      }

      const type = data.type as string | undefined
      if (!type) return

      // body text delta
      if (type === 'response.output_text.delta') {
        const delta = data.delta as string | undefined
        if (delta) yield { type: 'text', text: delta }
        return
      }

      // reasoning summary / reasoning body delta → thinking (heartbeat only, not fed back into history)
      if (type === 'response.reasoning_summary_text.delta' || type === 'response.reasoning_text.delta') {
        const delta = data.delta as string | undefined
        if (delta) yield { type: 'thinking', text: delta }
        return
      }

      // new output item: may be a function_call (register call_id + name)
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

      // function_call arguments delta
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

      // output item done: function_call finalized → emit tool_use
      if (type === 'response.output_item.done') {
        const item = data.item as Record<string, unknown> | undefined
        if (item?.type === 'function_call') {
          const callId = (item.call_id as string) || (item.id as string) || ''
          const buf = toolCalls.get(callId)
          // prefer the complete item.arguments; otherwise use the accumulated deltas.
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

      // completion event: read usage + determine stopReason
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

      // error event
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
    // split event blocks on blank lines; process each complete event one at a time.
    let sep: number
    while ((sep = buffer.indexOf('\n\n')) !== -1) {
      const rawEvent = buffer.slice(0, sep)
      buffer = buffer.slice(sep + 2)
      yield* handleEvent(rawEvent)
    }
  }
  // end of stream: handle the last event left in the buffer that didn't end with a blank line (e.g. response.completed).
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
