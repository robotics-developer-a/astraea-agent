// 轻量一次性非流式 AI 调用 — 专供工具内部的二次处理（如 WebFetch 内容提炼）
//
// 小模型选择策略（与 best-practices 的 queryHaiku 对齐）：
//   anthropic → claude-haiku-4-5-20251001（最快最廉价）
//   openai    → gpt-4o-mini（同等定位的 OpenAI 轻量模型）
//   deepseek  → deepseek-v4-flash（ctx-agent / map 阶段默认 Flash，不随主模型升 Pro）
//   kimi      → 使用配置的 kimi 模型（无更小模型）
//   ollama    → 使用配置的本地模型

import OpenAI from 'openai'
import { config } from '../config'
import { getClient } from './client'
import { isReasoningModel } from './openai'

const ANTHROPIC_SMALL_MODEL = 'claude-haiku-4-5-20251001'
const OPENAI_SMALL_MODEL = 'gpt-4o-mini'
const DEEPSEEK_SMALL_MODEL = 'deepseek-v4-flash'
// Codex subscription has no separately-priced small model, so pick a cheaper mini tier. Overridable via env beyond CODEX_MODEL.
const CODEX_SMALL_MODEL = 'gpt-5.4-mini'
const STRUCTURED_JSON_SYSTEM_HINT =
  'Return ONLY valid JSON. Do not wrap it in markdown fences, do not add prose, and do not leave the response empty.'

export interface QuerySmallModelOptions {
  structuredResponse?: 'json'
}

function deepseekSmallModelName(): string {
  return process.env.DEEPSEEK_SMALL_MODEL?.trim() || DEEPSEEK_SMALL_MODEL
}

// 当前激活 provider 的小模型名（与上面策略一致）。供子 agent map 阶段省钱用（§5-#12）。
export function smallModelName(provider = config.provider): string {
  switch (provider) {
    case 'anthropic': return ANTHROPIC_SMALL_MODEL
    case 'openai': return OPENAI_SMALL_MODEL
    case 'deepseek': return deepseekSmallModelName()
    case 'kimi': return config.kimi.model
    case 'codex': return CODEX_SMALL_MODEL
    default: return config.ollama.model
  }
}

export function buildSmallModelSystemPrompt(
  systemPrompt?: string,
  options: QuerySmallModelOptions = {},
): string | undefined {
  if (options.structuredResponse !== 'json') return systemPrompt
  return [systemPrompt, STRUCTURED_JSON_SYSTEM_HINT].filter(Boolean).join('\n\n')
}

export function openAICompatibleStructuredParams(
  options: QuerySmallModelOptions = {},
): { response_format?: { type: 'json_object' } } {
  return options.structuredResponse === 'json'
    ? { response_format: { type: 'json_object' } }
    : {}
}

export function shouldRetryStructuredJson(
  text: string,
  options: QuerySmallModelOptions = {},
): boolean {
  if (options.structuredResponse !== 'json') return false
  const trimmed = text.trim()
  if (!trimmed) return true
  try {
    JSON.parse(trimmed)
    return false
  } catch {
    return true
  }
}

export async function querySmallModel(
  userPrompt: string,
  signal?: AbortSignal,
  systemPrompt?: string,
  options: QuerySmallModelOptions = {},
): Promise<string> {
  const provider = config.provider
  const effectiveSystemPrompt = buildSmallModelSystemPrompt(systemPrompt, options)

  if (provider === 'anthropic') {
    const client = getClient()
    const runAnthropic = () => client.messages.create(
      {
        model: ANTHROPIC_SMALL_MODEL,
        max_tokens: 4096,
        ...(effectiveSystemPrompt ? { system: effectiveSystemPrompt } : {}),
        messages: [{ role: 'user', content: userPrompt }],
      },
      signal ? { signal } : undefined,
    )
    const first = await runAnthropic()
    const firstBlock = first.content[0]
    const firstText = firstBlock && 'text' in firstBlock ? firstBlock.text : ''
    if (!shouldRetryStructuredJson(firstText, options)) return firstText
    const retry = await runAnthropic()
    const retryBlock = retry.content[0]
    return retryBlock && 'text' in retryBlock ? retryBlock.text : firstText
  }

  // Codex (ChatGPT subscription) — not chat/completions; reuse the codex streaming adapter and accumulate text.
  if (provider === 'codex') {
    const { streamMessageCodex } = await import('./codex')
    const run = async (): Promise<string> => {
      let text = ''
      for await (const ev of streamMessageCodex(
        [{ role: 'user', content: userPrompt }],
        {
          ...(effectiveSystemPrompt ? { system: effectiveSystemPrompt } : {}),
          model: CODEX_SMALL_MODEL,
          maxTokens: 4096,
          ...(signal ? { abortSignal: signal } : {}),
        },
      )) {
        if (ev.type === 'text') text += ev.text
      }
      return text
    }
    const firstText = await run()
    if (!shouldRetryStructuredJson(firstText, options)) return firstText
    return run()
  }

  // OpenAI-compatible providers (openai, deepseek, kimi, ollama)
  const clientCfg =
    provider === 'openai'
      ? { baseURL: config.openai.baseUrl, apiKey: config.openai.apiKey, model: OPENAI_SMALL_MODEL }
      : provider === 'deepseek'
      ? { baseURL: config.deepseek.baseUrl, apiKey: config.deepseek.apiKey, model: deepseekSmallModelName() }
      : provider === 'kimi'
      ? { baseURL: config.kimi.baseUrl, apiKey: config.kimi.apiKey, model: config.kimi.model }
      : { baseURL: config.ollama.baseUrl, apiKey: 'ollama', model: config.ollama.model }

  const openaiClient = new OpenAI({ baseURL: clientCfg.baseURL, apiKey: clientCfg.apiKey, maxRetries: 5 })
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = []
  if (effectiveSystemPrompt) messages.push({ role: 'system', content: effectiveSystemPrompt })
  messages.push({ role: 'user', content: userPrompt })

  const tokenLimit = isReasoningModel(clientCfg.model)
    ? { max_completion_tokens: 4096 }
    : { max_tokens: 4096 }
  const runOpenAICompatible = () => openaiClient.chat.completions.create(
    { model: clientCfg.model, ...tokenLimit, ...openAICompatibleStructuredParams(options), messages },
    signal ? { signal } : undefined,
  )
  const first = await runOpenAICompatible()
  const firstText = first.choices[0]?.message?.content ?? ''
  if (!shouldRetryStructuredJson(firstText, options)) return firstText
  const retry = await runOpenAICompatible()
  return retry.choices[0]?.message?.content ?? firstText
}
