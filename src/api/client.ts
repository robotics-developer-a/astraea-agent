// Anthropic SDK 客户端初始化
// 参考源码: claude-code-main/src/services/api/client.ts

import Anthropic from '@anthropic-ai/sdk'
import { config } from '../config'

let _client: Anthropic | null = null

export function getClient(): Anthropic {
  if (!_client) {
    _client = new Anthropic({
      apiKey: config.anthropic.apiKey,
      defaultHeaders: { 'X-Agent': 'Astraea/1.0' },
    })
  }
  return _client
}

export function resetAnthropicClient(): void {
  _client = null
}
