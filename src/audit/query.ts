// 审计查询 + 渲染（供 /audit 命令）。
//
// /audit             → 本会话的 allow/deny 决定
// /audit --project   → 本项目所有会话
// /audit --deny      → 只看拒绝（--allow 同理）
// /audit --reason <type> → 按 DecisionReason type 过滤（rule/redline/mode/user/fail-closed/…）

import { join } from 'node:path'
import { existsSync, readdirSync } from 'node:fs'
import { projectDir } from '../services/transcript/transcript.js'
import { readAudit, auditPath, filterAudit, type AuditFilter } from './record.js'
import type { AuditRecord, DecisionReasonType } from './types.js'

export interface AuditQuery {
  scope: 'session' | 'project'
  filter: AuditFilter
}

export function parseAuditArgs(args: string | undefined): AuditQuery {
  const tokens = (args ?? '').trim().split(/\s+/).filter(Boolean)
  const q: AuditQuery = { scope: 'session', filter: {} }
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]
    if (t === '--project') q.scope = 'project'
    else if (t === '--deny') q.filter.behavior = 'deny'
    else if (t === '--allow') q.filter.behavior = 'allow'
    else if (t === '--reason') {
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

export function formatAuditTable(records: AuditRecord[], scope: 'session' | 'project'): string {
  const scopeLabel = scope === 'project' ? 'this project' : 'this session'
  if (records.length === 0) {
    return `No permission decisions recorded for ${scopeLabel} yet.`
  }
  const header = `**Permission audit — ${scopeLabel} (${records.length} decision${records.length === 1 ? '' : 's'}):**`
  const rows = records.map((r) => {
    const time = new Date(r.ts).toLocaleTimeString('en-GB') // HH:MM:SS
    const marker = r.behavior === 'allow' ? '⟦ok⟧ ' : '⟦err⟧'
    const tool = r.tool.padEnd(9)
    const reason = r.reason.type.padEnd(13)
    const target = r.target.length > 60 ? r.target.slice(0, 57) + '…' : r.target
    return `  ${time}  ${marker} ${tool} ${reason} ${target}`
  })
  return [header, '', ...rows].join('\n')
}
