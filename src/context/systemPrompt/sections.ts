// Section 缓存基础设施
// 参考 claude-code-main/src/constants/systemPromptSections.ts
//
// 设计：
//   - systemPromptSection()  → 计算一次，缓存至 clearSectionCache()
//   - uncachedSection()      → 每轮强制重计算（破坏 prompt cache，慎用）
//   - clearSectionCache()    → 在 /clear 或会话重置时调用

type ComputeFn = () => string | null | Promise<string | null>

export type SystemPromptSection = {
  name: string
  compute: ComputeFn
  cacheBreak: boolean
}

// 会话级缓存：计算一次，clearSectionCache() 前不再重算
const _cache = new Map<string, string | null>()

/** 常规动态段：结果缓存至 /clear */
export function systemPromptSection(
  name: string,
  compute: ComputeFn,
): SystemPromptSection {
  return { name, compute, cacheBreak: false }
}

/**
 * 每轮强制重计算的段。
 * 警告：会破坏 prompt cache，每次 cache miss 额外消耗约 20K token 重新编码。
 * 必须提供 reason，说明为何无法缓存。
 */
export function uncachedSection(
  name: string,
  compute: ComputeFn,
  _reason: string,
): SystemPromptSection {
  return { name, compute, cacheBreak: true }
}

/** 解析所有 section，返回字符串数组（null 段被过滤掉） */
export async function resolveSections(
  sections: SystemPromptSection[],
): Promise<(string | null)[]> {
  return Promise.all(
    sections.map(async s => {
      if (!s.cacheBreak && _cache.has(s.name)) {
        return _cache.get(s.name) ?? null
      }
      const value = await s.compute()
      _cache.set(s.name, value)
      return value
    }),
  )
}

/** 清空缓存（在 /clear、/login 换模型、或会话重置时调用） */
export function clearSectionCache(): void {
  _cache.clear()
}

/** 删掉单个 section 缓存（env_info 随 modelId 变，必须在重算前 invalidate）。 */
export function invalidateSection(name: string): void {
  _cache.delete(name)
}
