// Exa 适配器 — 神经语义搜索，适合研究型查询
// 免费额度：1,000 次/月
// 注册：https://exa.ai
// 启用：export EXA_API_KEY=your_key
import type { WebSearchAdapter, SearchResult, SearchOptions } from './types.js'

interface ExaResult {
  title?: string
  url: string
  highlights?: string[]
}

interface ExaResponse {
  results: ExaResult[]
}

export class ExaAdapter implements WebSearchAdapter {
  readonly name = 'exa'

  async search(query: string, options?: SearchOptions): Promise<SearchResult[]> {
    const apiKey = process.env.EXA_API_KEY
    if (!apiKey) throw new Error('EXA_API_KEY 环境变量未设置')

    const body: Record<string, unknown> = {
      query,
      numResults: 10,
      contents: { highlights: { numSentences: 2, highlightsPerUrl: 1 } },
    }
    if (options?.allowedDomains?.length) body['includeDomains'] = options.allowedDomains
    if (options?.blockedDomains?.length) body['excludeDomains'] = options.blockedDomains

    const response = await fetch('https://api.exa.ai/search', {
      method: 'POST',
      signal: options?.signal,
      headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    if (!response.ok) throw new Error(`Exa API 返回 ${response.status}`)

    const data = await response.json() as ExaResponse
    return data.results.map(r => ({
      title: r.title ?? r.url,
      url: r.url,
      snippet: r.highlights?.[0],
    }))
  }
}
