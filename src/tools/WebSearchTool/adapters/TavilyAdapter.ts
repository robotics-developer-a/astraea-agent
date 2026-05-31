// Tavily 适配器 — 专为 LLM Agent 设计的搜索 API
// 免费额度：1,000 次/月，无需信用卡
// 注册：https://tavily.com
// 启用：export TAVILY_API_KEY=your_key
import type { WebSearchAdapter, SearchResult, SearchOptions } from './types.js'

interface TavilyResult {
  title: string
  url: string
  content: string
  score: number
}

interface TavilyResponse {
  results: TavilyResult[]
}

export class TavilyAdapter implements WebSearchAdapter {
  readonly name = 'tavily'

  async search(query: string, options?: SearchOptions): Promise<SearchResult[]> {
    const apiKey = process.env.TAVILY_API_KEY
    if (!apiKey) throw new Error('TAVILY_API_KEY 环境变量未设置')

    const body: Record<string, unknown> = {
      api_key: apiKey,
      query,
      max_results: 10,
      search_depth: 'basic',
    }
    if (options?.allowedDomains?.length) body['include_domains'] = options.allowedDomains
    if (options?.blockedDomains?.length) body['exclude_domains'] = options.blockedDomains

    const response = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      signal: options?.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    if (!response.ok) throw new Error(`Tavily API 返回 ${response.status}`)

    const data = await response.json() as TavilyResponse
    return data.results.map(r => ({
      title: r.title,
      url: r.url,
      snippet: r.content,
    }))
  }
}
