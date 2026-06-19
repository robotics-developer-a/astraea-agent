// 智谱 BigModel Web Search 适配器 — 国产联网搜索 API
// 国内直连，无需代理；很多用户已有智谱 Key，可直接复用。
// 注册/获取 Key：https://open.bigmodel.cn
// 启用：export ZHIPU_API_KEY=xxx（或用 /internet 向导配置）
// 引擎档位可选：ZHIPU_SEARCH_ENGINE=search_std（默认）| search_pro
import type { WebSearchAdapter, SearchResult, SearchOptions } from './types.js'

interface ZhipuResultItem {
  title?: string
  link?: string
  content?: string
}

interface ZhipuResponse {
  search_result?: ZhipuResultItem[]
  error?: { message?: string }
}

export class ZhipuAdapter implements WebSearchAdapter {
  readonly name = 'zhipu'

  async search(query: string, options?: SearchOptions): Promise<SearchResult[]> {
    const apiKey = process.env.ZHIPU_API_KEY
    if (!apiKey) throw new Error('ZHIPU_API_KEY 环境变量未设置')

    const engine = process.env.ZHIPU_SEARCH_ENGINE || 'search_std'
    const response = await fetch('https://open.bigmodel.cn/api/paas/v4/web_search', {
      method: 'POST',
      signal: options?.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ search_engine: engine, search_query: query }),
    })

    if (!response.ok) throw new Error(`智谱 BigModel API 返回 ${response.status}`)

    const data = await response.json() as ZhipuResponse
    if (data.error?.message) throw new Error(`智谱 BigModel API 错误：${data.error.message}`)

    const results: SearchResult[] = (data.search_result ?? [])
      .map(r => ({
        title: r.title ?? r.link ?? '',
        url: r.link ?? '',
        snippet: r.content,
      }))
      .filter(r => r.url)
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
