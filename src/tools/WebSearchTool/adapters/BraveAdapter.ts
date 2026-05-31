// Brave Search 适配器 — 需要 BRAVE_SEARCH_API_KEY 环境变量
// 设置方式: export BRAVE_SEARCH_API_KEY=your_key
// 触发方式: export ASTRAEA_SEARCH_ADAPTER=brave
import type { WebSearchAdapter, SearchResult, SearchOptions } from './types.js'

interface BraveWebResult {
  title: string
  url: string
  description?: string
}

interface BraveResponse {
  web?: { results?: BraveWebResult[] }
}

export class BraveAdapter implements WebSearchAdapter {
  readonly name = 'brave'
  private readonly apiKey: string

  constructor() {
    const key = process.env.BRAVE_SEARCH_API_KEY
    if (!key) throw new Error('BRAVE_SEARCH_API_KEY 环境变量未设置')
    this.apiKey = key
  }

  async search(query: string, options?: SearchOptions): Promise<SearchResult[]> {
    const params = new URLSearchParams({ q: query, count: '10' })

    const response = await fetch(`https://api.search.brave.com/res/v1/web/search?${params}`, {
      signal: options?.signal,
      headers: {
        'X-Subscription-Token': this.apiKey,
        Accept: 'application/json',
      },
    })

    if (!response.ok) {
      throw new Error(`Brave Search API 返回 ${response.status}`)
    }

    const data = await response.json() as BraveResponse
    const results: SearchResult[] = (data.web?.results ?? []).map(r => ({
      title: r.title,
      url: r.url,
      snippet: r.description,
    }))

    return applyDomainFilter(results, options)
  }
}

function applyDomainFilter(results: SearchResult[], options?: SearchOptions): SearchResult[] {
  if (options?.allowedDomains?.length) {
    return results.filter(r => options.allowedDomains!.some(d => r.url.includes(d)))
  }
  if (options?.blockedDomains?.length) {
    return results.filter(r => !options.blockedDomains!.some(d => r.url.includes(d)))
  }
  return results
}
