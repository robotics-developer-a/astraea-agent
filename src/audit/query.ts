// 审计查询 + 渲染（供 /audit 命令）。
//
// /audit             → 本会话的 allow/deny 决定（默认只展示最近 N 条，超出给分页提示）
// /audit --project   → 本项目所有会话
// /audit --deny      → 只看拒绝（--allow 同理）
// /audit --reason <type> → 按 DecisionReason type 过滤（rule/redline/mode/user/fail-closed/…）
// /audit --all       → 不分页，铺全部记录
// /audit --limit N   → 自定义分页条数

import { join } from 'node:path'
import { existsSync, readdirSync } from 'node:fs'
import { Chalk } from 'chalk'
import chalk from 'chalk'
import { projectDir } from '../services/transcript/transcript.js'
import { readAudit, auditPath, filterAudit, type AuditFilter } from './record.js'
import { stringDisplayWidth, clampLineWidth } from '../utils/termWidth.js'
import { VERDICT_COLOR } from '../ui/theme.js'
import type { AuditRecord, DecisionReasonType } from './types.js'

export interface AuditQuery {
  scope: 'session' | 'project'
  filter: AuditFilter
  /** 分页条数（默认 DEFAULT_LIMIT）；--all 时为 null（不分页）。 */
  limit: number | null
}

/** 默认只展示最近 30 条，避免一屏铺不下又被 live frame 擦越界（见 App.tsx preformatted 渲染）。 */
export const DEFAULT_AUDIT_LIMIT = 30

export function parseAuditArgs(args: string | undefined): AuditQuery {
  const tokens = (args ?? '').trim().split(/\s+/).filter(Boolean)
  const q: AuditQuery = { scope: 'session', filter: {}, limit: DEFAULT_AUDIT_LIMIT }
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]
    if (t === '--project') q.scope = 'project'
    else if (t === '--deny') q.filter.behavior = 'deny'
    else if (t === '--allow') q.filter.behavior = 'allow'
    else if (t === '--all') q.limit = null
    else if (t === '--limit') {
      const n = Number(tokens[++i])
      if (Number.isFinite(n) && n > 0) q.limit = Math.floor(n)
    } else if (t === '--reason') {
      const v = tokens[++i]
      if (v) q.filter.reasonType = v as DecisionReasonType
    }
  }
  return q
}

/** 当前会话的审计记录（按过滤器）。sessionId 为 null（未开会话）时返回 []。 */
export function loadSessionAudit(cwd: string, sessionId: string | null, filter: AuditFilter): AuditRecord[] {
  if (!sessionId) return []
  return filterAudit(readAudit(auditPath(cwd, sessionId)), filter)
}

/** 本项目所有会话的审计记录，按时间升序合并。 */
export function loadProjectAudit(cwd: string, filter: AuditFilter): AuditRecord[] {
  const dir = projectDir(cwd)
  if (!existsSync(dir)) return []
  const out: AuditRecord[] = []
  for (const f of readdirSync(dir)) {
    if (f.endsWith('.audit.jsonl')) out.push(...readAudit(join(dir, f)))
  }
  out.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0))
  return filterAudit(out, filter)
}

// ── 表格渲染 ────────────────────────────────────────────────────────────────
// 输出是「预格式化」文本（App.tsx 走 preformatted 角色逐行透传，不过 markdown），所以这里
// 直接用 chalk 上色 + 盒线字符画框。每行宽度严格 ≤ 终端列宽（target 列按余量截断），
// 保证落进 <Static> 不软折行，也不会被 live frame 的擦除算错行数。

interface Col {
  header: string
  align: 'left' | 'right'
  /** 取一条记录的「纯文本」单元格（上色前），用于算列宽。 */
  cell: (r: AuditRecord) => string
  /** 上色（可选）；不传则原样。入参是已按列宽 pad 过的纯文本。 */
  paint?: (c: InstanceType<typeof Chalk>, padded: string, r: AuditRecord) => string
  /** 弹性列（target）：吃掉剩余宽度，按显示宽度截断。 */
  flex?: boolean
  /** 固定/最大列宽上限（非 flex 列收口，避免 target 之外的列吃光宽度）。 */
  max?: number
}

function termCols(): number {
  const c = process.stdout?.columns
  return Math.max(40, (typeof c === 'number' && c > 0 ? c : 80) - 1)
}

function padTo(content: string, width: number, align: 'left' | 'right'): string {
  const pad = ' '.repeat(Math.max(0, width - stringDisplayWidth(content)))
  return align === 'right' ? pad + content : content + pad
}

export interface FormatOpts {
  /** 总记录数（用于分页提示）；不传则取 records.length。 */
  total?: number
  /** 实际分页上限（用于提示 "showing last N of M"）。 */
  limit?: number | null
  /** 表格总宽（列）；不传则按当前终端宽度。供测试注入固定宽度。 */
  width?: number
}

export function formatAuditTable(
  records: AuditRecord[],
  scope: 'session' | 'project',
  opts: FormatOpts = {},
): string {
  const scopeLabel = scope === 'project' ? 'this project' : 'this session'
  if (records.length === 0) {
    return `No permission decisions recorded for ${scopeLabel} yet.`
  }
  const c = new Chalk({ level: chalk.level > 0 ? chalk.level : 3 })
  const dim = (s: string) => c.dim(s)
  const totalWidth = opts.width ?? termCols()

  const cols: Col[] = [
    { header: 'Time', align: 'left', cell: r => new Date(r.ts).toLocaleTimeString('en-GB') },
    {
      header: 'Result',
      align: 'left',
      cell: r => (r.behavior === 'allow' ? '⟦ok⟧' : '⟦err⟧'),
      paint: (cc, padded, r) =>
        r.behavior === 'allow' ? cc.hex(VERDICT_COLOR.ok)(padded) : cc.hex(VERDICT_COLOR.err)(padded),
    },
    { header: 'Tool', align: 'left', cell: r => r.tool, max: 10 },
    { header: 'Reason', align: 'left', cell: r => r.reason.type, max: 13, paint: (cc, p) => cc.cyan(p) },
    { header: 'Mode', align: 'left', cell: r => r.mode, max: 8 },
    { header: 'Target', align: 'left', cell: r => r.target, flex: true },
  ]

  // 1) 非 flex 列：宽度 = max(表头, 数据)，收口到 max；flex 列（target）末算，吃掉剩余宽度。
  const sized = cols.map(col => {
    if (col.flex) return { col, width: stringDisplayWidth(col.header) } // 占位，下一步重算
    let w = stringDisplayWidth(col.header)
    for (const r of records) w = Math.max(w, stringDisplayWidth(col.cell(r)))
    return { col, width: col.max ? Math.min(w, col.max) : w }
  })
  // 框架开销 = 每列 "│ " + " "（2+1）+ 收尾 "│"。
  const overhead = cols.length * 3 + 1
  const fixedSum = sized.filter(s => !s.col.flex).reduce((a, s) => a + s.width, 0)
  for (const s of sized) {
    if (s.col.flex) s.width = Math.max(stringDisplayWidth(s.col.header), totalWidth - overhead - fixedSum)
  }

  const rule = (l: string, m: string, r: string) =>
    dim(l + sized.map(s => '─'.repeat(s.width + 2)).join(m) + r)

  // header=true → 表头行（整行加粗）；否则取 rec 的单元格并按列上色。
  const renderRow = (rec: AuditRecord | null): string => {
    const parts = sized.map(({ col, width }) => {
      const raw = rec ? col.cell(rec) : col.header
      // 超宽（含 flex 的 target）一律按显示宽度截断到列宽（不再硬截 60）；窄的留原文 pad。
      const clipped = stringDisplayWidth(raw) > width ? clampLineWidth(raw, width + 1) : raw
      const padded = padTo(clipped, width, col.align)
      if (!rec) return c.bold(padded)
      return col.paint ? col.paint(c, padded, rec) : padded
    })
    return dim('│ ') + parts.join(dim(' │ ')) + dim(' │')
  }

  const lines: string[] = []
  // 标题
  const total = opts.total ?? records.length
  let title = `Permission audit — ${scopeLabel} (${total} decision${total === 1 ? '' : 's'})`
  if (opts.limit != null && total > records.length) {
    title += `  ·  showing last ${records.length}, use /audit --all`
  }
  lines.push(c.bold(title))
  lines.push('')
  lines.push(rule('┌', '┬', '┐'))
  lines.push(renderRow(null)) // 表头
  lines.push(rule('├', '┼', '┤'))
  for (const r of records) lines.push(renderRow(r))
  lines.push(rule('└', '┴', '┘'))
  return lines.join('\n')
}
