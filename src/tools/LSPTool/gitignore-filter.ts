// gitignore 过滤器 — 移除 LSP 结果中的 node_modules / 构建产物路径
// 参考: LSPTool 教学文档 Step 2 收获 4「噪音过滤后置」
//
// INTENT: 语言服务器不区分"项目代码"和"依赖/构建产物"
// node_modules 里的定义在技术上正确，但对 LLM 理解业务代码毫无价值
// 使用 git check-ignore 批量过滤，50 个路径/批（避免命令行过长）

import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

interface LspLocation { uri: string; range: unknown }

const BATCH_SIZE = 50

// INTENT: git check-ignore 批量检查路径是否被 .gitignore 覆盖
// 被忽略的路径对 LLM 代码理解无价值，过滤掉减少噪音
export async function filterGitIgnoredLocations(
  locations: LspLocation[],
  cwd: string,
): Promise<LspLocation[]> {
  if (locations.length === 0) return locations

  // 提取路径
  const paths = locations.map((loc) => {
    try {
      return fileURLToPath(loc.uri)
    } catch {
      return loc.uri
    }
  })

  const ignoredPaths = new Set<string>()

  // 分批执行 git check-ignore
  for (let i = 0; i < paths.length; i += BATCH_SIZE) {
    const batch = paths.slice(i, i + BATCH_SIZE)
    const result = spawnSync('git', ['check-ignore', '--stdin', '-z'], {
      input: batch.join('\0') + '\0',
      cwd,
      encoding: 'utf8',
    })

    if (result.status === 0 && result.stdout) {
      // git check-ignore -z 输出以 null 字节分隔的被忽略路径
      for (const ignored of result.stdout.split('\0')) {
        if (ignored) ignoredPaths.add(resolve(ignored))
      }
    }
  }

  // 额外：快速过滤明显的噪音路径（node_modules、dist、build 等）
  const NOISE_PATTERNS = [
    '/node_modules/',
    '/.git/',
    '/dist/',
    '/build/',
    '/.next/',
    '/out/',
  ]

  return locations.filter((loc) => {
    let filePath: string
    try {
      filePath = fileURLToPath(loc.uri)
    } catch {
      return true // 非文件 URI，保留
    }

    const abs = resolve(filePath)

    // git check-ignore 判定为忽略
    if (ignoredPaths.has(abs)) return false

    // 路径中包含已知噪音目录
    for (const pattern of NOISE_PATTERNS) {
      if (abs.includes(pattern)) return false
    }

    return true
  })
}
