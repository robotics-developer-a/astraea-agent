// Custom gateway adapter — OpenAI Chat Completions or Anthropic Messages style.
// For third-party / self-hosted endpoints (right.codes, Azure proxies, LiteLLM, …).
// Config: PROVIDER=custom + CUSTOM_BASE_URL / CUSTOM_API_KEY / CUSTOM_MODEL / CUSTOM_API_STYLE.

import Anthropic from '@anthropic-ai/sdk'
import { config, normalizeBaseUrl } from '../config'
import type { Message, StreamEvent } from '../types/message'
import type { StreamOptions } from './anthropic'
import { streamMessageAnthropicWithClient } from './anthropic'
import { streamMessageOpenAIWithEndpoint } from './openai'
import {
  resolveAppliedEffort,
  deepseekIsV4,
  deepseekResolveModel,
  deepseekThinkingParam,
} from './reasoningEffort'

export function streamMessageCustom(
  messages: Message[],
  options: StreamOptions = {},
): AsyncGenerator<StreamEvent> {
  const c = config.custom
  const baseUrl = normalizeBaseUrl(c.baseUrl)
  if (!baseUrl) {
    throw new Error('CUSTOM_BASE_URL is empty — set it in ~/.astraea/.env or via /login → Custom')
  }
  if (!c.model) {
    throw new Error('CUSTOM_MODEL is empty — set it in ~/.astraea/.env or via /login → Custom')
  }

  if (c.apiStyle === 'anthropic') {
    const client = new Anthropic({
      apiKey: c.apiKey || 'no-key',
      baseURL: baseUrl,
      defaultHeaders: { 'X-Agent': 'Astraea/1.0' },
    })
    return streamMessageAnthropicWithClient(client, messages, options, {
      model: c.model,
      maxTokens: c.maxTokens,
    })
  }

  // OpenAI-compatible Chat Completions against the custom base URL (never Anthropic official).
  // DeepSeek-named models on a custom gateway still get V4 thinking knobs when applicable.
  const configuredModel = options.model ?? c.model
  const applied = resolveAppliedEffort()
  const isDeepSeek = deepseekIsV4(configuredModel) || /^deepseek/i.test(configuredModel)
  const effectiveModel = isDeepSeek
    ? deepseekResolveModel(applied, configuredModel)
    : configuredModel
  const extraParams =
    isDeepSeek && deepseekIsV4(configuredModel)
      ? (deepseekThinkingParam(applied) as Record<string, unknown>)
      : undefined

  return streamMessageOpenAIWithEndpoint(
    messages,
    { ...options, model: effectiveModel },
    {
      apiKey: c.apiKey || 'no-key',
      baseUrl,
      model: effectiveModel,
      maxTokens: c.maxTokens,
      skipEnvReasoningFallback: true,
      extraParams,
    },
  )
}
