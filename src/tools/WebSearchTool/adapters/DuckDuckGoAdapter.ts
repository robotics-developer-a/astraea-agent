// DuckDuckGo 适配器 — 免费，无需 API Key，作为默认搜索后端
// API 端点: https://api.duckduckgo.com/?q=...&format=json&no_html=1
import type { WebSearchAdapter, SearchResult, SearchOptions } from './types.js'

interface DDGResponse {
  RelatedTopics?: Array<{
    Text?: string
    FirstURL?: string
    Topics?: Array<{ Text?: string; FirstURL?: string }>
  }>
  AbstractText?: string
  AbstractURL?: string
  AbstractTitle?: string
}

export class DuckDuckGoAdapter implements WebSearchAdapter {
  readonly name = 'duckduckgo'

  async search(query: string, options?: SearchOptions): Promise<SearchResult[]> {
    const params = new URLSearchParams({
      q: query,
      format: 'json',
      no_html: '1',
      skip_disambig: '1',
    })

    const response = await fetch(`https://api.duckduckgo.com/?${params}`, {
      signal: options?.signal,
      headers: { 'User-Agent': 'Astraea/1.0 (AI Assistant)' },
    })

    if (!response.ok) {
      throw new Error(`DuckDuckGo API 返回 ${response.status}`)
    }

    const data = await response.json() as DDGResponse
    const results: SearchResult[] = []

    // 优先提取摘要（如果有）
    if (data.AbstractText && data.AbstractURL) {
      results.push({
        title: data.AbstractTitle ?? query,
        url: data.AbstractURL,
        snippet: data.AbstractText,
      })
    }

    // 提取关联主题
    for (const topic of data.RelatedTopics ?? []) {
      // 有些 topic 是嵌套的 Topics 数组
      if (topic.Topics) {
        for (const sub of topic.Topics) {
          if (sub.FirstURL && sub.Text) {
            results.push({ title: sub.Text.split(' - ')[0] ?? sub.Text, url: sub.FirstURL, snippet: sub.Text })
          }
        }
        continue
      }
      if (topic.FirstURL && topic.Text) {
        results.push({ title: topic.Text.split(' - ')[0] ?? topic.Text, url: topic.FirstURL, snippet: topic.Text })
      }
    }

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
