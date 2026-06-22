import React from 'react'
import { afterEach, expect, test } from 'bun:test'
import { render } from 'ink-testing-library'
import { config } from '../config'
import { LoginWizard, type LoginResult } from './LoginWizard'

const DOWN = '\u001B[B'
const ENTER = '\r'
const tick = () => new Promise(resolve => setTimeout(resolve, 10))
const strip = (value?: string) => (value ?? '').replace(/\x1b\[[0-9;]*m/g, '')

const originalDeepSeekKey = config.deepseek.apiKey

afterEach(() => {
  config.deepseek.apiKey = originalDeepSeekKey
})

async function selectDeepSeekPro(stdin: { write: (value: string) => void }): Promise<void> {
  stdin.write(DOWN)
  await tick()
  stdin.write(ENTER)
  await tick()
  stdin.write(DOWN)
  await tick()
  stdin.write(ENTER)
  await tick()
}

test('configured provider offers to reuse its current API key when switching models', async () => {
  config.deepseek.apiKey = 'sk-existing-deepseek'
  let result: LoginResult | null | undefined
  const { stdin, lastFrame } = render(<LoginWizard onDone={value => { result = value }} />)

  await selectDeepSeekPro(stdin)

  expect(result).toBeUndefined()
  stdin.write(ENTER)
  await tick()
  expect(result).toEqual({
    provider: 'deepseek',
    model: 'deepseek-v4-pro',
    apiKey: 'sk-existing-deepseek',
  })
})

test('configured provider can replace its current API key', async () => {
  config.deepseek.apiKey = 'sk-existing-deepseek'
  let result: LoginResult | null | undefined
  const { stdin } = render(<LoginWizard onDone={value => { result = value }} />)

  await selectDeepSeekPro(stdin)
  stdin.write(DOWN)
  await tick()
  stdin.write(ENTER)
  await tick()
  stdin.write('sk-new-deepseek')
  await tick()
  stdin.write(ENTER)
  await tick()

  expect(result).toEqual({
    provider: 'deepseek',
    model: 'deepseek-v4-pro',
    apiKey: 'sk-new-deepseek',
  })
})

test('provider without an API key skips reuse choice and requests a new key', async () => {
  config.deepseek.apiKey = ''
  const { stdin, lastFrame } = render(<LoginWizard onDone={() => {}} />)

  await selectDeepSeekPro(stdin)

  const frame = strip(lastFrame())
  expect(frame).not.toContain('Reuse current API Key')
  expect(frame).not.toContain('Use a new API Key')
  expect(frame).toContain('API Key:')
})
