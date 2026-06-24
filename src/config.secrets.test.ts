import { afterEach, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { config, saveConfigToEnv, saveLoginConfigToEnvFiles, updateProviderConfig } from './config'
import { resolveAppliedEffort } from './api/reasoningEffort'
import { setSessionEffort, unsetSessionEffort } from './state/reasoningEffort'

const originalProvider = config.provider
const originalDeepSeekKey = config.deepseek.apiKey
const originalDeepSeekModel = config.deepseek.model

afterEach(() => {
  config.provider = originalProvider
  config.deepseek.apiKey = originalDeepSeekKey
  config.deepseek.model = originalDeepSeekModel
  delete process.env.ASTRAEA_REASONING_EFFORT
  unsetSessionEffort()
})

test('provider secrets are written to a private explicit destination', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'astraea-secrets-'))
  const destination = join(dir, '.env')

  await saveConfigToEnv(destination)

  expect(readFileSync(destination, 'utf8')).toContain('ANTHROPIC_API_KEY=')
  expect(statSync(destination).mode & 0o777).toBe(0o600)
})

test('/login updates project env overrides as well as the global env', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'astraea-login-env-'))
  const globalDestination = join(dir, 'global.env')
  const projectDestination = join(dir, 'project.env')
  writeFileSync(projectDestination, 'PROVIDER=deepseek\nDEEPSEEK_MODEL=deepseek-reasoner\n')
  config.provider = 'deepseek'
  config.deepseek.apiKey = 'sk-test'
  config.deepseek.model = 'deepseek-v4-pro'

  await saveLoginConfigToEnvFiles(globalDestination, projectDestination)

  expect(readFileSync(globalDestination, 'utf8')).toContain('DEEPSEEK_MODEL=deepseek-v4-pro')
  expect(readFileSync(projectDestination, 'utf8')).toContain('DEEPSEEK_MODEL=deepseek-v4-pro')
  expect(statSync(globalDestination).mode & 0o777).toBe(0o600)
  expect(statSync(projectDestination).mode & 0o777).toBe(0o600)
})

test('/login model switch clears stale session reasoning so the selected model wins', () => {
  config.provider = 'deepseek'
  config.deepseek.apiKey = 'sk-test'
  config.deepseek.model = 'deepseek-v4-pro'
  setSessionEffort('high')

  const changed = updateProviderConfig('deepseek', 'deepseek-v4-flash', 'sk-test')

  expect(changed).toBe(true)
  expect(config.deepseek.model).toBe('deepseek-v4-flash')
  expect(resolveAppliedEffort()).toBeUndefined()
})

test('/login model switch clears env reasoning override so the selected model wins over everything', () => {
  process.env.ASTRAEA_REASONING_EFFORT = 'high'
  config.provider = 'deepseek'
  config.deepseek.apiKey = 'sk-test'
  config.deepseek.model = 'deepseek-v4-pro'

  const changed = updateProviderConfig('deepseek', 'deepseek-v4-flash', 'sk-test')

  expect(changed).toBe(true)
  expect(config.deepseek.model).toBe('deepseek-v4-flash')
  expect(resolveAppliedEffort()).toBeUndefined()
})
