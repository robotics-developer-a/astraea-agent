// 工具间共享的文件读取状态
// 参考 claude-code-main 中通过 ToolUseContext 传递的 readFileState
//
// 设计：模块级单例，FileReadTool 写入，FileWriteTool 读取校验。
// key: resolve() 后的绝对路径（防止相对/绝对路径不一致导致 miss）

import { resolve } from 'node:path'
import { statSync } from 'node:fs'

export interface ReadRecord {
  mtimeMs: number   // 读取时的文件 mtime（毫秒）
  isPartial: boolean  // 是否只读了部分内容（有 offset 或 limit）
}

const _state = new Map<string, ReadRecord>()

/** 规范化路径，统一 key 格式 */
export function normalizePath(filePath: string): string {
  return resolve(filePath)
}

/** FileReadTool 读取成功后调用：记录当前 mtime */
export function recordRead(filePath: string, isPartial: boolean): void {
  const fullPath = normalizePath(filePath)
  try {
    const { mtimeMs } = statSync(fullPath)
    _state.set(fullPath, { mtimeMs, isPartial })
  } catch {
    // 文件不存在时忽略（新建文件场景）
  }
}

/** FileWriteTool 写入成功后调用：用新 mtime 更新状态，避免下次写入被误判 */
export function recordWrite(filePath: string): void {
  const fullPath = normalizePath(filePath)
  try {
    const { mtimeMs } = statSync(fullPath)
    _state.set(fullPath, { mtimeMs, isPartial: false })
  } catch {
    // 写入后 stat 失败不影响主流程
  }
}

/**
 * FileWriteTool 写入前校验：
 * - 文件不存在 → 允许（新建）
 * - 文件存在但从未读过 → 拒绝
 * - 文件存在但读后被修改（mtime 变化）→ 拒绝
 * - 文件存在但只读了部分内容 → 拒绝（可能覆盖未见内容）
 *
 * 返回 null 表示允许写入，返回字符串表示拒绝原因。
 */
export function validateWrite(filePath: string): string | null {
  const fullPath = normalizePath(filePath)

  let currentMtime: number
  try {
    currentMtime = statSync(fullPath).mtimeMs
  } catch {
    // 文件不存在 → 新建，不需要先读
    return null
  }

  // 文件存在，检查是否读过
  const record = _state.get(fullPath)
  if (!record) {
    return `File has not been read yet. Read it first before writing to it.`
  }

  // 检查是否只读了部分内容
  if (record.isPartial) {
    return `File was only partially read (with offset or limit). Read the full file before writing.`
  }

  // 检查 mtime：读后文件是否被外部修改
  if (currentMtime > record.mtimeMs) {
    return `File has been modified since last read. Read it again before writing.`
  }

  return null
}
