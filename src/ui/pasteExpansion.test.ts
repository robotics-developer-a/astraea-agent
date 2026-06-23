import { test, expect } from 'bun:test'
import { expandPasteTokens } from './pasteExpansion'

test('expandPasteTokens expands submitted paste placeholders before slash command parsing', () => {
  const store = new Map<string, string>([
    ['[Pasted text #1 +3 lines]', 'line one\nline two\nline three'],
  ])

  const expanded = expandPasteTokens('/goal [Pasted text #1 +3 lines]', store)

  expect(expanded).toBe('/goal line one\nline two\nline three')
  expect(store.has('[Pasted text #1 +3 lines]')).toBe(false)
})
