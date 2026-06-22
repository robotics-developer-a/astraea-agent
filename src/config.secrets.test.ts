import { expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { saveConfigToEnv } from './config'

test('provider secrets are written to a private explicit destination', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'astraea-secrets-'))
  const destination = join(dir, '.env')

  await saveConfigToEnv(destination)

  expect(readFileSync(destination, 'utf8')).toContain('ANTHROPIC_API_KEY=')
  expect(statSync(destination).mode & 0o777).toBe(0o600)
})
