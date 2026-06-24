import { dirname, isAbsolute, join, resolve } from 'node:path'
import { mkdirSync, statSync, writeFileSync } from 'node:fs'
import { getAuditSession } from '../audit/record'
import { sessionPath, loadSessionMessages } from '../services/transcript/transcript'
import { config } from '../config'
import type { LocalCommandResult } from './types'
import type { TextBlock, ToolUseBlock, ToolResultBlock } from '../types/message'

function activeModel(): string {
  switch (config.provider) {
    case 'deepseek': return config.deepseek.model
    case 'kimi':     return config.kimi.model
    case 'ollama':   return config.ollama.model
    case 'openai':   return config.openai.model
    default:         return config.anthropic.model
  }
}

function stripSystemReminders(text: string): string {
  return text.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').trim()
}

function formatTimestamp(): string {
  const now = new Date()
  const y = now.getFullYear()
  const mo = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  const h = String(now.getHours()).padStart(2, '0')
  const mi = String(now.getMinutes()).padStart(2, '0')
  const s = String(now.getSeconds()).padStart(2, '0')
  return `${y}-${mo}-${d}-${h}${mi}${s}`
}

export function resolveExportPath(
  args: string | undefined,
  cwd: string,
  isDirectory: (path: string) => boolean = path => {
    try { return statSync(path).isDirectory() } catch { return false }
  },
  timestamp: string = formatTimestamp(),
): string {
  const fallback = `conversation-${timestamp}.md`
  const raw = args?.trim()
  if (!raw) return join(cwd, fallback)

  const target = isAbsolute(raw) ? raw : resolve(cwd, raw)
  if (isDirectory(target)) return join(target, fallback)
  return target.endsWith('.md') ? target : `${target}.md`
}

function toolResultSummary(block: ToolResultBlock): string {
  const content = typeof block.content === 'string'
    ? block.content
    : block.content.map(b => ('text' in b ? b.text : '')).join('')
  const preview = content.length > 300 ? content.slice(0, 300) + '…' : content
  return `${block.is_error ? '[error] ' : ''}${preview}`
}

function toolInputSummary(input: Record<string, unknown>): string {
  const str = JSON.stringify(input)
  return str.length > 300 ? str.slice(0, 300) + '…' : str
}

export async function exportConversation(args: string | undefined): Promise<LocalCommandResult> {
  const sessionId = getAuditSession()
  if (!sessionId) {
    return { type: 'text', value: 'No active session to export.' }
  }

  const cwd = process.cwd()
  const path = sessionPath(cwd, sessionId)

  let messages
  try {
    messages = loadSessionMessages(path)
  } catch {
    return { type: 'text', value: 'Could not read transcript file.' }
  }

  if (messages.length === 0) {
    return { type: 'text', value: 'Nothing to export — conversation is empty.' }
  }

  const lines: string[] = []
  lines.push('# Astraea Conversation Export')
  lines.push('')
  lines.push(`- **Date:** ${new Date().toLocaleString()}`)
  lines.push(`- **Provider:** ${config.provider}`)
  lines.push(`- **Model:** ${activeModel()}`)
  lines.push(`- **Session:** \`${sessionId}\``)
  lines.push('')
  lines.push('---')
  lines.push('')

  for (const msg of messages) {
    if (msg.role === 'user') {
      if (typeof msg.content === 'string') {
        lines.push('## User')
        lines.push('')
        lines.push(stripSystemReminders(msg.content))
        lines.push('')
      } else {
        const texts: string[] = []
        const results: ToolResultBlock[] = []
        for (const block of msg.content) {
          if (block.type === 'text') {
            texts.push(block.text)
          } else if (block.type === 'tool_result') {
            results.push(block)
          }
        }
        if (texts.length > 0) {
          const combined = texts.join('\n')
          const clean = stripSystemReminders(combined)
          if (clean) {
            lines.push('## User')
            lines.push('')
            lines.push(clean)
            lines.push('')
          }
        }
        for (const r of results) {
          lines.push('### Tool Result')
          lines.push('')
          lines.push('```')
          lines.push(toolResultSummary(r))
          lines.push('```')
          lines.push('')
        }
      }
    } else {
      lines.push('## Astraea')
      lines.push('')
      for (const block of msg.content) {
        if (block.type === 'text') {
          lines.push((block as TextBlock).text)
          lines.push('')
        } else if (block.type === 'tool_use') {
          const tu = block as ToolUseBlock
          lines.push(`> **Tool:** \`${tu.name}\``)
          lines.push('> ')
          lines.push('> ```json')
          lines.push(`> ${toolInputSummary(tu.input)}`)
          lines.push('> ```')
          lines.push('')
        }
      }
    }
  }

  const markdown = lines.join('\n')

  const filepath = resolveExportPath(args, cwd)
  try {
    mkdirSync(dirname(filepath), { recursive: true })
    writeFileSync(filepath, markdown, 'utf-8')
    return { type: 'text', value: `Exported ${messages.length} messages to **${filepath}**` }
  } catch (e) {
    return { type: 'text', value: `Failed to write export file: ${e instanceof Error ? e.message : 'Unknown error'}` }
  }
}
