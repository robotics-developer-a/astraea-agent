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
import { spawnSync } from 'node:child_process'
import { statSync } from 'node:fs'
import { buildTool } from '../Tool'
import type { Tool, ToolCallResult, ToolContext } from '../Tool'
import { readStreamBounded } from '../BashTool/executor/readStreamBounded.js'

// INTENT: 默认 250 条限制来自上下文窗口预算分析
// content 模式下 250 行约 2000-5000 token，是单次工具调用的合理上限
const DEFAULT_HEAD_LIMIT = 250

// INTENT: 与 BashTool 的 shell.ts 同量级——防止极端匹配量把内存/上下文吃爆
const MAX_STDOUT_BYTES = 10 * 1024 * 1024
const MAX_STDERR_BYTES = 1 * 1024 * 1024

// INTENT: VCS 目录统一排除，避免 .git/ 内容污染搜索结果
const VCS_DIRS = ['.git', '.svn', '.hg', '.bzr', '_darcs']

// INTENT: ripgrep 路径，优先系统 PATH，macOS Homebrew 后备。这里仍用 spawnSync——
// 只在模块加载时跑一次 `--version`（毫秒级），不是每次搜索都执行，不会阻塞 REPL。
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
): { items: T[]; truncated: boolean; appliedLimit?: number } {
  const effective = limit ?? DEFAULT_HEAD_LIMIT
  const sliced = items.slice(offset, offset + effective)
  return {
    items: sliced,
    truncated: sliced.length < items.length - offset,
    appliedLimit: sliced.length < items.length - offset ? effective : undefined,
  }
}

export const GrepTool = buildTool({
  name: 'Grep',
  description: `Search file contents using ripgrep. Supports three output modes:
- files_with_matches (default): list of matching file paths, sorted by modification time (most recent first)
- content: matching lines with context
- count: number of matches per file

Examples:
  pattern="TODO"                          → all files containing TODO
  pattern="export.*Tool" type="ts"       → TypeScript files exporting Tool
  pattern="isReadOnly" output="content"  → show matching lines
  pattern="handleLogin" output="content" context_lines=3 → matching lines with 3 lines of context on each side`,
  isReadOnly: () => true,
  isConcurrencySafe: () => true,
  inputSchema: {
    type: 'object',
    properties: {
      pattern: {
        type: 'string',
        description: 'Regex pattern to search for (ripgrep syntax)',
      },
      path: {
        type: 'string',
        description: 'Directory or file to search (default: cwd)',
      },
      output: {
        type: 'string',
        enum: ['files_with_matches', 'content', 'count'],
        description: 'Output mode (default: files_with_matches)',
      },
      case_sensitive: {
        type: 'boolean',
        description: 'Case-sensitive search (default: false)',
      },
      type: {
        type: 'string',
        description: 'File type filter, e.g. "ts", "py", "json" (ripgrep --type)',
      },
      head_limit: {
        type: 'number',
        description: `Max results to return (default: ${DEFAULT_HEAD_LIMIT})`,
      },
      context_lines: {
        type: 'number',
        description: 'Lines of context to show before AND after each match (content mode only, ripgrep -C). Default: 0.',
      },
    },
    required: ['pattern'],
  },

  async call(input, ctx: ToolContext): Promise<ToolCallResult> {
    const pattern      = input['pattern']        as string
    const searchPath   = input['path']           as string | undefined
    const outputMode   = (input['output']        as string | undefined) ?? 'files_with_matches'
    const caseSens     = (input['case_sensitive'] as boolean | undefined) ?? false
    const fileType     = input['type']           as string | undefined
    const headLimit    = input['head_limit']     as number | undefined
    const contextLines = input['context_lines']  as number | undefined

    const cwd = process.cwd()
    const basePath = searchPath ? resolve(cwd, searchPath) : cwd

    // ── 构建 ripgrep 参数 ───────────────────────────────────────────
    const args: string[] = ['--no-heading', '--no-messages']
    if (!caseSens) args.push('--ignore-case')
    if (fileType)  args.push('--type', fileType)
    for (const d of VCS_DIRS) args.push('--glob', `!${d}`)

    if (outputMode === 'files_with_matches') {
      args.push('--files-with-matches')
    } else if (outputMode === 'count') {
      args.push('--count')
    } else {
      args.push('--line-number')
      if (contextLines && contextLines > 0) args.push('--context', String(contextLines))
    }

    args.push('--', pattern, basePath)

    // ── 执行 ripgrep（异步 spawn，不阻塞事件循环；大仓库慢搜索时 REPL 仍可响应按键/ESC）──
    let proc: Bun.Subprocess<'ignore', 'pipe', 'pipe'>
    try {
      proc = Bun.spawn([RG_PATH, ...args], { stdout: 'pipe', stderr: 'pipe' })
    } catch (err: unknown) {
      return { output: `ripgrep not found: ${String(err)}`, isError: true }
    }

    // ESC / 轮次中止 → 直接杀掉还在跑的 ripgrep 进程，不用等它自己跑完
    const abortHandler = () => proc.kill()
    ctx.abortSignal?.addEventListener('abort', abortHandler, { once: true })

    const exited = proc.exited
    const [stdout, stderr] = await Promise.all([
      readStreamBounded(proc.stdout, exited, MAX_STDOUT_BYTES),
      readStreamBounded(proc.stderr, exited, MAX_STDERR_BYTES),
    ])
    const exitCode = await exited
    ctx.abortSignal?.removeEventListener('abort', abortHandler)

    if (ctx.abortSignal?.aborted) {
      return { output: 'Grep search cancelled.', isError: true }
    }

    // ripgrep 退出码：0=有匹配，1=无匹配（非错误），其余=真错误（如正则语法错、路径不存在）
    if (exitCode !== 0 && exitCode !== 1) {
      return { output: `ripgrep error: ${stderr.trim() || `exit code ${exitCode}`}`, isError: true }
    }

    const lines = stdout.split('\n').filter(Boolean)

    if (lines.length === 0) {
      return { output: `No matches found for: ${pattern}` }
    }

    // ── 输出格式化 ────────────────────────────────────────────────
    if (outputMode === 'files_with_matches') {
      // 按 mtime 降序排（最近修改的文件最相关）
      const withMtime = lines.map(f => {
        try { return { f, mt: statSync(f).mtimeMs } } catch { return { f, mt: 0 } }
      })
      withMtime.sort((a, b) => b.mt - a.mt)
      const sorted = withMtime.map(x => relative(cwd, x.f) || x.f)
      const { items, truncated, appliedLimit } = applyHeadLimit(sorted, headLimit)
      const suffix = truncated ? `\n(truncated at ${appliedLimit} results)` : ''
      return { output: items.join('\n') + suffix }
    }

    const { items, truncated, appliedLimit } = applyHeadLimit(lines, headLimit)
    const suffix = truncated ? `\n(truncated at ${appliedLimit} results)` : ''
    return { output: items.join('\n') + suffix }
  },

  renderResult(input, output, isError) {
    if (isError) return null
    if (output.startsWith('No matches found')) return ['No matches found']
    const lines = output.split('\n').filter(Boolean)
    const truncated = /^\(truncated at /.test(lines.at(-1) ?? '')
    const body = truncated ? lines.slice(0, -1) : lines
    const mode = (input['output'] as string | undefined) ?? 'files_with_matches'
    // content 模式下 --context 会插入非匹配的上下文行（"path-lineno-text"）和 "--" 分组分隔符；
    // 只数真正的匹配行（ripgrep 用 "path:lineno:text" 标记），避免上下文行把计数灌水。
    const n = mode === 'content' ? body.filter(l => /:\d+:/.test(l)).length : body.length
    const noun = mode === 'content' ? 'matches' : 'files'
    return [`Found ${n} ${noun}${truncated ? ' (truncated)' : ''}`]
  },
})
