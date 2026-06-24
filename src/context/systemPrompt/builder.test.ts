import { beforeEach, expect, test } from 'bun:test'
import { getSystemPrompt } from './builder'
import { clearSectionCache } from './sections'

beforeEach(() => {
  clearSectionCache()
})

test('DeepSeek cache-friendly prompt keeps stable memory instructions before volatile environment info', async () => {
  const prompt = await getSystemPrompt({
    modelId: 'deepseek-v4-flash',
    enabledTools: new Set(['Read', 'Grep', 'Bash']),
    cwd: process.cwd(),
  })

  const memoryIndex = prompt.indexOf('# auto memory')
  const environmentIndex = prompt.indexOf('# Environment')

  expect(memoryIndex).toBeGreaterThan(-1)
  expect(environmentIndex).toBeGreaterThan(-1)
  expect(memoryIndex).toBeLessThan(environmentIndex)
})
