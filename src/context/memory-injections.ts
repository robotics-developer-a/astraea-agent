// 记忆注入（Memory Injections）
// 参考：02-记忆注入-Memory-Injections.md · Step 3 MVA
//
// ARCHITECTURAL INTENT:
// Memory injection loads project-scoped memory files and injects them as
// a cached system prompt section. Two core invariants:
// 1. ISOLATION: Each project gets its own memory directory (slug-based path).
// 2. BOUNDS: Both line count and byte count are hard-capped before injection.

import * as fs from 'node:fs/promises'
import * as path from 'node:path'

const MAX_MEMORY_LINES = 200
const MAX_MEMORY_BYTES = 25_000

// ─── Path Isolation ──────────────────────────────────────────────────────────

// Full path → slug prevents two projects named "app" from sharing memory.
// Example: /home/alice/work/my-app → "home-alice-work-my-app"
function cwdToSlug(cwd: string): string {
  return cwd
    .replace(/^\//, '')
    .replace(/\//g, '-')
    .replace(/[^a-zA-Z0-9-_]/g, '_')
}

function getMemoryDir(cwd: string): string {
  const slug = cwdToSlug(cwd)
  return path.join(process.env.HOME!, '.claude', 'projects', slug, 'memory')
}

// ─── Content Truncation ──────────────────────────────────────────────────────

type TruncationResult = {
  content: string
  wasLineTruncated: boolean
  wasByteTruncated: boolean
}

function truncateEntrypointContent(raw: string): TruncationResult {
  let content = raw
  let wasLineTruncated = false
  let wasByteTruncated = false

  const lines = content.split('\n')
  if (lines.length > MAX_MEMORY_LINES) {
    content = lines.slice(0, MAX_MEMORY_LINES).join('\n')
    wasLineTruncated = true
  }

  // Buffer.byteLength handles multi-byte UTF-8 correctly (CJK = 3 bytes each).
  if (Buffer.byteLength(content, 'utf8') > MAX_MEMORY_BYTES) {
    const buf = Buffer.from(content, 'utf8').subarray(0, MAX_MEMORY_BYTES)
    content = buf.toString('utf8')
    wasByteTruncated = true
  }

  return { content, wasLineTruncated, wasByteTruncated }
}

// ─── @include Resolution ─────────────────────────────────────────────────────

type VisitedSet = Set<string>

// Resolves @include directives with cycle detection via a visited set.
// Silently skips missing files and circular references to avoid crashing.
async function resolveIncludes(filePath: string, visited: VisitedSet): Promise<string> {
  const absPath = path.resolve(filePath)

  if (visited.has(absPath)) return '' // Cycle detected — break silently.
  visited.add(absPath)

  let content: string
  try {
    content = await fs.readFile(absPath, 'utf8')
  } catch {
    return ''
  }

  const lines = content.split('\n')
  const resolved: string[] = []

  for (const line of lines) {
    if (line.startsWith('@include ')) {
      const includePath = line.slice(9).trim()
      const includeAbs = path.resolve(path.dirname(absPath), includePath)
      // Pass the SAME visited set so A→B→C→A cycles are detected correctly.
      resolved.push(await resolveIncludes(includeAbs, visited))
    } else {
      resolved.push(line)
    }
  }

  return resolved.join('\n')
}

// ─── Main Entry Point ─────────────────────────────────────────────────────────

// Returns null when no memory exists — callers omit the section entirely.
export async function loadMemoryPrompt(cwd: string): Promise<string | null> {
  const memDir = getMemoryDir(cwd)

  try {
    await fs.mkdir(memDir, { recursive: true })
  } catch {
    // Permission denied or other fs error — proceed to readdir anyway.
  }

  let entries: string[]
  try {
    entries = await fs.readdir(memDir)
  } catch {
    return null
  }

  const mdFiles = entries.filter(f => f.endsWith('.md')).sort()
  if (mdFiles.length === 0) return null

  const blocks: string[] = []

  for (const file of mdFiles) {
    const filePath = path.join(memDir, file)

    // Each file gets its own VisitedSet so independent files can share a
    // common @include without triggering a false cycle detection.
    const rawContent = await resolveIncludes(filePath, new Set())
    if (!rawContent.trim()) continue

    const { content, wasLineTruncated, wasByteTruncated } = truncateEntrypointContent(rawContent)
    const note = wasLineTruncated || wasByteTruncated
      ? '\n[...content truncated due to size limits]'
      : ''

    blocks.push(`### ${file}\n${content}${note}`)
  }

  return blocks.length > 0 ? blocks.join('\n\n') : null
}
