// LSP 结果格式化器
// 将 LSP 协议返回的结构化 JSON 转换为 LLM 可读的人类文本
// 参考: LSPTool 教学文档 Step 1 / formatResult()

import { fileURLToPath } from 'node:url'
import { relative } from 'node:path'

// LSP Location / LocationLink 类型
interface LspPosition { line: number; character: number }
interface LspRange { start: LspPosition; end: LspPosition }
interface LspLocation { uri: string; range: LspRange }
interface LspLocationLink { targetUri: string; targetRange: LspRange; targetSelectionRange: LspRange }
interface LspSymbol { name: string; kind: number; location?: LspLocation; range?: LspRange; uri?: string }
interface LspCallItem { name: string; uri: string; range: LspRange; detail?: string }
interface LspIncomingCall { from: LspCallItem; fromRanges: LspRange[] }
interface LspOutgoingCall { to: LspCallItem; fromRanges: LspRange[] }

// LSP Symbol Kind 数字到可读名称的映射
const SYMBOL_KIND: Record<number, string> = {
  1: 'File', 2: 'Module', 3: 'Namespace', 4: 'Package', 5: 'Class',
  6: 'Method', 7: 'Property', 8: 'Field', 9: 'Constructor', 10: 'Enum',
  11: 'Interface', 12: 'Function', 13: 'Variable', 14: 'Constant',
  15: 'String', 16: 'Number', 17: 'Boolean', 18: 'Array', 19: 'Object',
  20: 'Key', 21: 'Null', 22: 'EnumMember', 23: 'Struct', 24: 'Event',
  25: 'Operator', 26: 'TypeParameter',
}

function uriToPath(uri: string, cwd: string): string {
  try {
    const absPath = fileURLToPath(uri)
    const rel = relative(cwd, absPath)
    return rel.startsWith('..') ? absPath : rel
  } catch {
    return uri
  }
}

// INTENT: 0-based → 1-based 行列号转换，与编辑器显示保持一致
function pos(p: LspPosition): string {
  return `${p.line + 1}:${p.character + 1}`
}

function formatLocation(loc: LspLocation, cwd: string): string {
  return `${uriToPath(loc.uri, cwd)}:${pos(loc.range.start)}`
}

export function formatLspResult(operation: string, result: unknown, cwd: string): string {
  if (result === null || result === undefined) {
    return `No results for ${operation}`
  }

  // ── goToDefinition / goToImplementation ──────────────────────────────
  if (operation === 'goToDefinition' || operation === 'goToImplementation') {
    const locations = normalizeLocations(result)
    if (locations.length === 0) return 'No definition found'

    return locations
      .map((loc) => `${formatLocation(loc, cwd)}`)
      .join('\n')
  }

  // ── findReferences ───────────────────────────────────────────────────
  if (operation === 'findReferences') {
    const locations = normalizeLocations(result)
    if (locations.length === 0) return 'No references found'

    const lines = [`Found ${locations.length} reference${locations.length === 1 ? '' : 's'}:`]
    lines.push(...locations.map((loc) => `  ${formatLocation(loc, cwd)}`))
    return lines.join('\n')
  }

  // ── hover ────────────────────────────────────────────────────────────
  if (operation === 'hover') {
    if (!result || typeof result !== 'object') return 'No hover information'
    const hover = result as { contents?: unknown }
    const contents = hover.contents

    if (typeof contents === 'string') return contents
    if (Array.isArray(contents)) {
      return contents
        .map((c) => (typeof c === 'string' ? c : (c as { value?: string }).value ?? ''))
        .filter(Boolean)
        .join('\n')
    }
    if (typeof contents === 'object' && contents !== null) {
      return (contents as { value?: string }).value ?? JSON.stringify(contents)
    }
    return 'No hover information'
  }

  // ── documentSymbol ───────────────────────────────────────────────────
  if (operation === 'documentSymbol') {
    if (!Array.isArray(result) || result.length === 0) return 'No symbols found'

    const symbols = result as LspSymbol[]
    const lines = [`Found ${symbols.length} symbol${symbols.length === 1 ? '' : 's'}:`]
    for (const sym of symbols) {
      const kind = SYMBOL_KIND[sym.kind] ?? `Kind${sym.kind}`
      const loc = sym.location
        ? ` at ${uriToPath(sym.location.uri, cwd)}:${pos(sym.location.range.start)}`
        : sym.range ? ` at ${pos(sym.range.start)}` : ''
      lines.push(`  [${kind}] ${sym.name}${loc}`)
    }
    return lines.join('\n')
  }

  // ── workspaceSymbol ──────────────────────────────────────────────────
  if (operation === 'workspaceSymbol') {
    if (!Array.isArray(result) || result.length === 0) return 'No workspace symbols found'

    const symbols = result as LspSymbol[]
    const lines = [`Found ${symbols.length} symbol${symbols.length === 1 ? '' : 's'}:`]
    for (const sym of symbols) {
      const kind = SYMBOL_KIND[sym.kind] ?? `Kind${sym.kind}`
      const loc = sym.location ? ` — ${uriToPath(sym.location.uri, cwd)}:${pos(sym.location.range.start)}` : ''
      lines.push(`  [${kind}] ${sym.name}${loc}`)
    }
    return lines.join('\n')
  }

  // ── prepareCallHierarchy ─────────────────────────────────────────────
  if (operation === 'prepareCallHierarchy') {
    if (!Array.isArray(result) || result.length === 0) return 'No call hierarchy items found'

    const items = result as LspCallItem[]
    const lines = [`Found ${items.length} call hierarchy item${items.length === 1 ? '' : 's'}:`]
    for (const item of items) {
      const path = uriToPath(item.uri, cwd)
      lines.push(`  ${item.name} — ${path}:${pos(item.range.start)}`)
    }
    return lines.join('\n')
  }

  // ── incomingCalls ────────────────────────────────────────────────────
  if (operation === 'incomingCalls') {
    if (!Array.isArray(result) || result.length === 0) return 'No incoming calls found'

    const calls = result as LspIncomingCall[]
    const lines = [`${calls.length} caller${calls.length === 1 ? '' : 's'}:`]
    for (const call of calls) {
      const path = uriToPath(call.from.uri, cwd)
      const callSites = call.fromRanges.map((r) => pos(r.start)).join(', ')
      lines.push(`  ${call.from.name} — ${path} (calls at: ${callSites})`)
    }
    return lines.join('\n')
  }

  // ── outgoingCalls ────────────────────────────────────────────────────
  if (operation === 'outgoingCalls') {
    if (!Array.isArray(result) || result.length === 0) return 'No outgoing calls found'

    const calls = result as LspOutgoingCall[]
    const lines = [`Calls ${calls.length} function${calls.length === 1 ? '' : 's'}:`]
    for (const call of calls) {
      const path = uriToPath(call.to.uri, cwd)
      lines.push(`  ${call.to.name} — ${path}:${pos(call.to.range.start)}`)
    }
    return lines.join('\n')
  }

  // 未知操作：原样返回 JSON
  return JSON.stringify(result, null, 2)
}

// 统一处理 Location | Location[] | LocationLink[] 三种形态
function normalizeLocations(result: unknown): LspLocation[] {
  if (!result) return []
  if (Array.isArray(result)) {
    return result.map((item) => {
      // LocationLink 格式
      if ('targetUri' in item) {
        const link = item as LspLocationLink
        return { uri: link.targetUri, range: link.targetSelectionRange }
      }
      return item as LspLocation
    })
  }
  // 单个 Location
  return [result as LspLocation]
}
