import { expect, test } from 'bun:test'
import { join } from 'node:path'
import { resolveExportPath } from './export'

test('resolveExportPath uses current folder and default filename when no args', () => {
  const out = resolveExportPath(undefined, '/workspace/app', () => true, '2026-06-24-120000')
  expect(out).toBe('/workspace/app/conversation-2026-06-24-120000.md')
})

test('resolveExportPath respects absolute file path', () => {
  const out = resolveExportPath('/tmp/chat-log', '/workspace/app', () => false, '2026-06-24-120000')
  expect(out).toBe('/tmp/chat-log.md')
})

test('resolveExportPath treats existing directory as export folder', () => {
  const dir = join('/tmp', 'exports')
  const out = resolveExportPath(dir, '/workspace/app', p => p === dir, '2026-06-24-120000')
  expect(out).toBe('/tmp/exports/conversation-2026-06-24-120000.md')
})
