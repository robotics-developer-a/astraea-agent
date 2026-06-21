// 文件读取工具 — 只读，支持行范围
// 参考源码: claude-code-main/packages/builtin-tools/src/tools/FileReadTool/
import { buildTool } from '../Tool'
import type { Tool, ToolCallResult } from '../Tool'
import { recordRead } from '../readFileState'
import { estimateTextTokens } from '../../services/compact/compact'
import {
  checkFileSize,
  checkTokenBudget,
  readDefaultLineLimit,
  readMaxTokens,
} from './limits'

export const FileReadTool = buildTool({
  name: 'Read',
  description:
    'Read the contents of a file. Optionally specify line offset and limit to read a specific range. '
    + 'Large files are gated: read them in chunks via offset/limit, or use Grep/search to locate what you need.',
  isReadOnly: () => true,
  isConcurrencySafe: () => true,
  inputSchema: {
    type: 'object',
    properties: {
      file_path: {
        type: 'string',
        description: 'Absolute or relative path to the file',
      },
      offset: {
        type: 'number',
        description: '1-based line number to start reading from (optional)',
      },
      limit: {
        type: 'number',
        description: 'Number of lines to read (optional)',
      },
    },
    required: ['file_path'],
  },

  async call(input, _ctx: import("../Tool.js").ToolContext): Promise<ToolCallResult> {
    const filePath = input['file_path'] as string
    const offset = (input['offset'] as number | undefined) ?? 1
    const limit = input['limit'] as number | undefined

    try {
      const file = Bun.file(filePath)
      const exists = await file.exists()
      if (!exists) {
        return { output: `File not found: ${filePath}`, isError: true }
      }

      // ① 体积闸门（读前）：超软上限且无 limit、或超硬上限（含 §5-#4：limit 也绕不过）→ 抛短错误
      const sizeErr = checkFileSize(file.size, limit !== undefined)
      if (sizeErr) return { output: sizeErr, isError: true }

      const text = await file.text()
      const lines = text.split('\n')

      const startIdx = Math.max(0, offset - 1)
      // ② 默认行数上限：不传 limit 时只读前 N 行（而非全量）
      const effectiveLimit = limit ?? readDefaultLineLimit()
      const endIdx = Math.min(lines.length, startIdx + effectiveLimit)

      const slice = lines.slice(startIdx, endIdx)

      // ③ 输出 token 闸门（读后，模型自适应）：切片估算超上限 → 抛短错误，不返回内容
      const tokenErr = checkTokenBudget(estimateTextTokens(slice.join('\n')), readMaxTokens())
      if (tokenErr) return { output: tokenErr, isError: true }

      // 加行号前缀（参考源码的 cat -n 风格）
      const numbered = slice.map((line, i) => `${startIdx + i + 1}\t${line}`).join('\n')

      // 截断（还有后续行）时追加续读提示，引导模型用 offset 继续
      const truncated = endIdx < lines.length
      const output = truncated
        ? `${numbered}\n\n<system-reminder>File has more lines (showed ${startIdx + 1}-${endIdx} of ${lines.length}). Use offset=${endIdx + 1} to continue reading.</system-reminder>`
        : numbered

      // 记录本次读取：是否为部分读取（有 limit / offset>1 / 被默认上限截断）
      const isPartial = limit !== undefined || offset > 1 || truncated
      recordRead(filePath, isPartial)

      return { output }
    } catch (err: unknown) {
      return { output: String(err), isError: true }
    }
  },

  renderResult(input, output, isError) {
    if (isError) return null
    const filePath = input['file_path'] as string
    const lineCount = output.split('\n').length
    return [`Read ${lineCount} lines ← ${filePath}`]
  },
})
