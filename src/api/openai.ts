// OpenAI 流式适配器 — 使用 OpenAI 官方 API（api.openai.com/v1）
// 也可通过 OPENAI_BASE_URL 指向其他 OpenAI-compatible 端点（如 Azure、第三方中转）

import OpenAI from 'openai'
import { config } from '../config'
import type { Message, StreamEvent } from '../types/message'
import type { StreamOptions } from './anthropic'
import type { ToolSchema } from '../tools/Tool'

let _openaiClient: OpenAI | null = null

function getOpenAIClient(): OpenAI {
  if (!_openaiClient) {
    _openaiClient = new OpenAI({
      apiKey: config.openai.apiKey,
      baseURL: config.openai.baseUrl,
    })
  }
  return _openaiClient
}

export function resetOpenAIClient(): void {
  _openaiClient = null
}

export async function* streamMessageOpenAI(
  messages: Message[],
  options: StreamOptions = {},
): AsyncGenerator<StreamEvent> {
  const client = getOpenAIClient()

  const chatMessages: OpenAI.Chat.ChatCompletionMessageParam[] = []

  if (options.system) {
    chatMessages.push({ role: 'system', content: options.system })
  }

  for (const msg of messages) {
    if (msg.role === 'user') {
      if (typeof msg.content === 'string') {
        chatMessages.push({ role: 'user', content: msg.content })
      } else {
        for (const block of msg.content) {
          if (block.type === 'tool_result') {
            const content = typeof block.content === 'string'
              ? block.content
              : block.content.map((b) => b.text).join('')
            chatMessages.push({ role: 'tool', tool_call_id: block.tool_use_id, content })
          } else {
            chatMessages.push({ role: 'user', content: block.text })
          }
        }
      }
    } else {
      const textParts = msg.content.filter((b) => b.type === 'text')
      const toolUses = msg.content.filter((b) => b.type === 'tool_use')

      const toolCalls: OpenAI.Chat.ChatCompletionMessageToolCall[] = toolUses.map((b) => ({
        id: b.id,
        type: 'function' as const,
        function: { name: b.name, arguments: JSON.stringify(b.input) },
      }))

      chatMessages.push({
        role: 'assistant',
        content: textParts.map((b) => b.text).join('') || null,
        tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
      })
    }
  }

  const toolCallBuffers = new Map<number, { id: string; name: string; args: string }>()
  let inputTokens = 0
  let outputTokens = 0

  const openaiTools: OpenAI.Chat.ChatCompletionTool[] | undefined =
    options.tools?.map((t: ToolSchema) => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.input_schema,
      },
    }))

  const stream = await client.chat.completions.create({
    model: config.openai.model,
    max_tokens: config.openai.maxTokens,
    messages: chatMessages,
    stream: true,
    stream_options: { include_usage: true },
    ...(openaiTools?.length ? { tools: openaiTools, tool_choice: 'auto' } : {}),
  })

  for await (const chunk of stream) {
    const choice = chunk.choices[0]

    if (chunk.usage) {
      inputTokens = chunk.usage.prompt_tokens
      outputTokens = chunk.usage.completion_tokens
    }

    if (!choice) continue

    const delta = choice.delta

    if (delta.content) {
      yield { type: 'text', text: delta.content }
    }

    if (delta.tool_calls) {
      for (const tc of delta.tool_calls) {
        if (!toolCallBuffers.has(tc.index)) {
          toolCallBuffers.set(tc.index, { id: tc.id ?? '', name: tc.function?.name ?? '', args: '' })
        }
        const buf = toolCallBuffers.get(tc.index)!
        if (tc.id) buf.id = tc.id
        if (tc.function?.name) buf.name = tc.function.name
        if (tc.function?.arguments) buf.args += tc.function.arguments
      }
    }

    if (choice.finish_reason === 'tool_calls' || choice.finish_reason === 'stop') {
      for (const [, buf] of toolCallBuffers) {
        let input: Record<string, unknown> = {}
        try { input = JSON.parse(buf.args) } catch { /* partial */ }
        yield { type: 'tool_use', id: buf.id, name: buf.name, input }
      }
      toolCallBuffers.clear()

      yield {
        type: 'message_stop',
        usage: { input_tokens: inputTokens, output_tokens: outputTokens },
      }
      return
    }
  }
}
