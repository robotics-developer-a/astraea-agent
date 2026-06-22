// 审计落盘 sink（权限与安全总览 §结构化审计）
//
// 存储:独立 ~/.astraea/projects/<escapeCwd>/<sessionId>.audit.jsonl，与 transcript 并列、
//   复用 projectDir。一行一条 JSON，便于 /audit 命令与 jq 逆向查询。
// 失败模式:fire-and-forget——写审计失败只 stderr 警告，绝不阻塞工具执行（审计是观测，
//   不应反过来把用户正常操作卡死）。
// 保留期:沿用 transcript 的清理策略（housekeeping 扫 .audit.jsonl，见 isPersistenceEnabled）。

import { join } from 'node:path'
import { existsSync, readFileSync, mkdirSync } from 'node:fs'
import { projectDir, isPersistenceEnabled } from '../services/transcript/transcript.js'
import type { AuditRecord, DecisionInput, DecisionReasonType } from './types.js'
import { appendPrivateFile } from '../utils/privateFile.js'

// ── 进程级活动会话单例（镜像 sessionMode 的写法）─────────────────────────────
// ToolContext 不携带 sessionId，transcript 又只活在 App.tsx 的 ref 里，故用单例。
// 在 createTranscript/reopenTranscript 处由 App.tsx 调 setAuditSession 设定。
let activeSessionId: string | null = null

export function setAuditSession(sessionId: string | null): void {
  activeSessionId = sessionId
}

export function getAuditSession(): string | null {
  return activeSessionId
}

export function auditPath(cwd: string, sessionId: string): string {
  return join(projectDir(cwd), `${sessionId}.audit.jsonl`)
}

/** 追加一条记录（同步）。供 sink 与测试使用。 */
export function appendAuditLine(path: string, record: AuditRecord): void {
  appendPrivateFile(path, JSON.stringify(redactAuditRecord(record)) + '\n')
}

function redactAuditRecord(record: AuditRecord): AuditRecord {
  return {
    ...record,
    target: redactSecrets(record.target),
    reason: record.reason.detail
      ? { ...record.reason, detail: redactSecrets(record.reason.detail) }
      : record.reason,
  }
}

function redactSecrets(value: string): string {
  return value
    .replace(/\b([A-Z][A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD))=([^\s]+)/gi, '$1=[REDACTED]')
    .replace(/(\b(?:Authorization|Proxy-Authorization):\s*(?:Bearer|Basic)\s+)[^"'\s]+/gi, '$1[REDACTED]')
    .replace(/([?&](?:api[_-]?key|token|access_token|key)=)[^&\s"']+/gi, '$1[REDACTED]')
    .replace(/(--?(?:api[_-]?key|token|password|secret)\s+)[^\s"']+/gi, '$1[REDACTED]')
}

/** 读取并解析一个 audit 文件;缺失返回 []，损坏行跳过。 */
export function readAudit(path: string): AuditRecord[] {
  if (!existsSync(path)) return []
  const out: AuditRecord[] = []
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line.trim()) continue
    try {
      out.push(JSON.parse(line) as AuditRecord)
    } catch {
      // 损坏行（并发写截断等）跳过，不让一行坏数据毁掉整次查询
    }
  }
  return out
}

export interface AuditFilter {
  behavior?: 'allow' | 'deny'
  reasonType?: DecisionReasonType
}

export function filterAudit(records: AuditRecord[], f: AuditFilter): AuditRecord[] {
  return records.filter(
    (r) =>
      (!f.behavior || r.behavior === f.behavior) &&
      (!f.reasonType || r.reason.type === f.reasonType),
  )
}

/**
 * fire-and-forget sink:填充 ts + sessionId 后落盘。绝不抛错。
 * 无活动会话 / 持久化关闭时静默跳过。
 */
export function recordDecision(input: DecisionInput): void {
  try {
    if (!isPersistenceEnabled()) return
    const sessionId = activeSessionId
    if (!sessionId) return
    const cwd = process.cwd()
    const dir = projectDir(cwd)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    const record: AuditRecord = { ts: new Date().toISOString(), sessionId, ...input }
    appendAuditLine(auditPath(cwd, sessionId), record)
  } catch (err) {
    process.stderr.write(`[audit] failed to record decision: ${String(err)}\n`)
  }
}
