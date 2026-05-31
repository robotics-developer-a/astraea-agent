// WebSearchTool 适配器接口契约
// 所有搜索后端必须实现此接口，工具核心代码只依赖此接口
export interface SearchResult {
  title: string
  url: string
  snippet?: string
}

export interface SearchOptions {
  allowedDomains?: string[]
  blockedDomains?: string[]
  signal?: AbortSignal
}

export interface WebSearchAdapter {
  readonly name: string
  search(query: string, options?: SearchOptions): Promise<SearchResult[]>
}
