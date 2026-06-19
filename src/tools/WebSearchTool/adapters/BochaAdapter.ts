// 博查 Bocha AI Search 适配器 — 国产联网搜索 API，专为 LLM/Agent 设计
// 国内直连，无需代理；按量付费，价格便宜，返回结果自带 summary。
// 注册/获取 Key：https://open.bochaai.com
// 启用：export BOCHA_API_KEY=sk-xxx（或用 /internet 向导配置）
import type { WebSearchAdapter, SearchResult, SearchOptions } from './types.js'

interface BochaWebPage {
  name: string
  url: string
  snippet?: string
  summary?: string
}

interface BochaResponse {
  code: number
  msg?: string
  data?: {
    webPages?: { value?: BochaWebPage[] }
  }
}

export class BochaAdapter implements WebSearchAdapter {
  readonly name = 'bocha'

  async search(query: string, options?: SearchOptions): Promise<SearchResult[]> {
    const apiKey = process.env.BOCHA_API_KEY
    if (!apiKey) throw new Error('BOCHA_API_KEY 环境变量未设置')

    const response = await fetch('https://api.bochaai.com/v1/web-search', {
      method: 'POST',
      signal: options?.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query, summary: true, count: 10 }),
    })

    if (!response.ok) throw new Error(`博查 Bocha API 返回 ${response.status}`)

    const data = await response.json() as BochaResponse
    if (data.code !== 200) throw new Error(`博查 Bocha API 错误：${data.msg ?? data.code}`)

    const results: SearchResult[] = (data.data?.webPages?.value ?? []).map(r => ({
      title: r.name,
      url: r.url,
      // summary 是博查为 LLM 生成的长摘要，优先用；退回 snippet。
      snippet: r.summary || r.snippet,
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
