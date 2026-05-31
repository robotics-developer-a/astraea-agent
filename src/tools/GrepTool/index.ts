// GrepTool — 文件内容正则搜索（封装 ripgrep）
// 参考: astraea-trace-and-build / GrepTool 教学文档
//
// 三种输出模式:
//   files_with_matches — 返回匹配的文件路径列表（按 mtime 排序）
//   content            — 返回匹配行的内容
//   count              — 返回每个文件的匹配计数
//
// 设计要点:
//   - 参数数组而非字符串拼接，防止 shell 注入
//   - 默认 250 条 head_limit 保护上下文窗口
//   - files_with_matches 模式按 mtime 降序排列（最近修改最相关）
//   - 条件字段输出：仅在截断时携带 appliedLimit，零信息字段不出现

import { resolve, relative } from 'node:path'
import { statSync, existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import type { Tool, ToolCallResult } from '../Tool'

// INTENT: 默认 250 条限制来自上下文窗口预算分析
// content 模式下 250 行约 2000-5000 token，是单次工具调用的合理上限
const DEFAULT_HEAD_LIMIT = 250

// INTENT: VCS 目录统一排除，避免 .git/ 内容污染搜索结果
const VCS_DIRS = ['.git', '.svn', '.hg', '.bzr', '_darcs']

// INTENT: ripgrep 路径，优先系统 PATH，macOS Homebrew 后备
function getRipgrepPath(): string {
  for (const p of [
    'rg',
    '/opt/homebrew/bin/rg',
    '/usr/local/bin/rg',
    '/usr/bin/rg',
  ]) {
    try {
      const r = spawnSync(p, ['--version'], { encoding: 'utf8' })
      if (r.status === 0) return p
    } catch { /* try next */ }
  }
  return 'rg'
}

const RG_PATH = getRipgrepPath()

function applyHeadLimit<T>(
  items: T[],
  limit: number | undefined,
  offset = 0,
): { items: T[]; appliedLimit: number | undefined } {
  // INTENT: 显式 0 是"我确认我要无限结果"的逃生阀
  // 区别于"未指定"（应用默认 250）—— 两种"缺少值"语义不同
  if (limit === 0) return { items: items.slice(offset), appliedLimit: undefined }

  const effectiveLimit = limit ?? DEFAULT_HEAD_LIMIT
  const sliced = items.slice(offset, offset + effectiveLimit)

  // INTENT: appliedLimit 仅在实际截断时出现，避免向 LLM 传递零信息字段
  return {
    items: sliced,
    appliedLimit: items.length - offset > effectiveLimit ? effectiveLimit : undefined,
  }
}

function toRelativePath(absPath: string): string {
  const rel = relative(process.cwd(), absPath)
  return rel.startsWith('..') ? absPath : rel
}

function runRipgrep(args: string[], cwd: string): { lines: string[]; error?: string } {
  // INTENT: 参数数组传递给子进程，每个 token 独立，不经过 shell 解析
  const result = spawnSync(RG_PATH, args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 50 * 1024 * 1024, // 50MB stdout buffer
  })

  if (result.error) {
    return { lines: [], error: result.error.message }
  }

  // ripgrep exit code: 0=match found, 1=no match, 2=error
  if (result.status === 2) {
    return { lines: [], error: result.stderr?.trim() || 'ripgrep error' }
  }

  const stdout = result.stdout || ''
  const lines = stdout.split('\n').filter((l) => l.length > 0)
  return { lines }
}

export const GrepTool: Tool = {
  name: 'Grep',
  description: `Search file contents using regular expressions (powered by ripgrep).

Output modes:
  files_with_matches (default) — list files containing the pattern (sorted by recency)
  content                      — show matching lines with line numbers
  count                        — show match count per file

Usage examples:
  pattern="useState"                         → find files using useState
  pattern="function\\s+\\w+" glob="*.ts"    → TypeScript function definitions
  pattern="TODO|FIXME" output_mode="content" → show all todo lines
  pattern="import React" path="src/"         → scoped to a directory

Results are paginated at 250 by default. Use head_limit=0 for unlimited (caution with large repos).`,

  isReadOnly: true,

  inputSchema: {
    type: 'object',
    properties: {
      pattern: {
        type: 'string',
        description: 'Regular expression to search for',
      },
      path: {
        type: 'string',
        description: 'Directory or file to search (default: current working directory)',
      },
      glob: {
        type: 'string',
        description: 'File glob filter, e.g. "*.ts" or "src/**/*.tsx"',
      },
      output_mode: {
        type: 'string',
        enum: ['files_with_matches', 'content', 'count'],
        description: 'Output mode (default: files_with_matches)',
      },
      '-i': {
        type: 'boolean',
        description: 'Case-insensitive matching',
      },
      '-n': {
        type: 'boolean',
        description: 'Show line numbers (content mode only)',
      },
      head_limit: {
        type: 'number',
        description: 'Max results to return (default: 250, 0 = unlimited)',
      },
      offset: {
        type: 'number',
        description: 'Skip the first N results (for pagination)',
      },
    },
    required: ['pattern'],
  },

  async call(input, _ctx: import("../Tool.js").ToolContext): Promise<ToolCallResult> {
    const pattern = input['pattern'] as string
    const searchPath = input['path'] as string | undefined
    const globFilter = input['glob'] as string | undefined
    const outputMode = (input['output_mode'] as string | undefined) ?? 'files_with_matches'
    const caseInsensitive = Boolean(input['-i'])
    const headLimit = input['head_limit'] as number | undefined
    const offset = (input['offset'] as number | undefined) ?? 0

    const cwd = searchPath ? resolve(searchPath) : process.cwd()

    // ── 路径验证 ──────────────────────────────────────────────────────────
    if (searchPath && !existsSync(cwd)) {
      return { output: `Path does not exist: ${searchPath}`, isError: true }
    }

    // ── 构建 ripgrep 参数数组（防 shell 注入）────────────────────────────
    const args: string[] = ['--hidden', '--max-columns', '500']

    // INTENT: VCS 目录统一排除，避免 .git/ 内容污染代码搜索结果
    for (const dir of VCS_DIRS) {
      args.push('--glob', `!${dir}`)
      args.push('--glob', `!${dir}/**`)
    }

    if (caseInsensitive) args.push('--ignore-case')

    if (outputMode === 'files_with_matches') {
      args.push('--files-with-matches')
    } else if (outputMode === 'count') {
      args.push('--count')
    } else {
      // content 模式：带行号
      args.push('--line-number')
    }

    if (globFilter) {
      args.push('--glob', globFilter)
    }

    // INTENT: 以 - 开头的模式会被 ripgrep 解析为选项，用 -e 显式标记为模式字符串
    if (pattern.startsWith('-')) {
      args.push('-e', pattern)
    } else {
      args.push(pattern)
    }

    // ── 执行搜索 ──────────────────────────────────────────────────────────
    const { lines, error } = runRipgrep(args, cwd)

    if (error) {
      return { output: `Search error: ${error}`, isError: true }
    }

    if (lines.length === 0) {
      return { output: 'No matches found' }
    }

    // ── files_with_matches 模式：mtime 排序 + 分页 ──────────────────────
    if (outputMode === 'files_with_matches') {
      // INTENT: 按修改时间排序而非字母顺序
      // 最近编辑的文件与当前任务的相关性最高，是廉价的相关性代理指标
      const withMtime = lines.map((filePath) => {
        let mtime = 0
        try {
          // ripgrep 返回相对路径（相对于 cwd），需要 resolve 后才能 stat
          const abs = resolve(cwd, filePath)
          mtime = statSync(abs).mtimeMs
        } catch { /* file might have been deleted, mtime=0 sinks it */ }
        return { filePath, mtime }
      })

      withMtime.sort((a, b) => b.mtime - a.mtime)
      const sorted = withMtime.map((x) => x.filePath)

      const { items, appliedLimit } = applyHeadLimit(sorted, headLimit, offset)
      const filenames = items.map((p) => toRelativePath(resolve(cwd, p)))

      const parts: string[] = [
        `Found ${sorted.length} file${sorted.length === 1 ? '' : 's'}\n`,
        filenames.join('\n'),
      ]
      if (appliedLimit !== undefined) {
        parts.push(`\n(Results truncated at ${appliedLimit}. Use offset or a more specific pattern.)`)
      }
      if (offset > 0) {
        parts.push(`\n(Showing results ${offset + 1}–${offset + items.length})`)
      }

      return { output: parts.join('') }
    }

    // ── content 模式：行内容 + 路径前缀转相对路径 ───────────────────────
    if (outputMode === 'content') {
      // ripgrep content 行格式: "path/to/file:LINE:content"
      const normalised = lines.map((line) => {
        // 只转换路径前缀，不破坏冒号分隔的内容
        const match = line.match(/^([^:]+):(.*)$/)
        if (match) {
          const rel = toRelativePath(resolve(cwd, match[1]!))
          return `${rel}:${match[2]}`
        }
        return line
      })

      const { items: limitedLines, appliedLimit } = applyHeadLimit(normalised, headLimit, offset)

      const parts: string[] = [limitedLines.join('\n')]
      if (appliedLimit !== undefined) {
        parts.push(`\n(Results truncated at ${appliedLimit} lines. Use offset or head_limit=0 for more.)`)
      }

      return { output: parts.join('') }
    }

    // ── count 模式：file:count 汇总 ──────────────────────────────────────
    // ripgrep -c 格式: "path:N"
    const withCount = lines.map((line) => {
      const lastColon = line.lastIndexOf(':')
      if (lastColon < 0) return { path: line, count: 0 }
      const filePath = line.slice(0, lastColon)
      const count = parseInt(line.slice(lastColon + 1), 10) || 0
      return { path: toRelativePath(resolve(cwd, filePath)), count }
    })

    withCount.sort((a, b) => b.count - a.count)

    const { items, appliedLimit } = applyHeadLimit(withCount, headLimit, offset)
    const totalMatches = withCount.reduce((sum, x) => sum + x.count, 0)

    const countLines = items.map((x) => `${x.path}: ${x.count}`)
    const parts: string[] = [
      `Total matches: ${totalMatches} across ${withCount.length} file${withCount.length === 1 ? '' : 's'}\n`,
      countLines.join('\n'),
    ]
    if (appliedLimit !== undefined) {
      parts.push(`\n(Results truncated at ${appliedLimit} files.)`)
    }

    return { output: parts.join('') }
  },
}
