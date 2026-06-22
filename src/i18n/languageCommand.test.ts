import { test, expect } from 'bun:test'
import { resolveLanguageCommand } from './index'

test('bare /language opens the wizard', () => {
  expect(resolveLanguageCommand('/language')).toEqual({ kind: 'wizard' })
})

test('/language <valid-code> switches directly', () => {
  expect(resolveLanguageCommand('/language en')).toEqual({ kind: 'switch', locale: 'en' })
  expect(resolveLanguageCommand('/language zh')).toEqual({ kind: 'switch', locale: 'zh' })
})

test('language code is case-insensitive and trimmed', () => {
  expect(resolveLanguageCommand('/language   KO  ')).toEqual({ kind: 'switch', locale: 'ko' })
})

test('/language <unknown-code> falls back to the wizard', () => {
  expect(resolveLanguageCommand('/language xx')).toEqual({ kind: 'wizard' })
})

test('non-language input is not a language command', () => {
  expect(resolveLanguageCommand('/model')).toBeNull()
  expect(resolveLanguageCommand('/languagex')).toBeNull()
  expect(resolveLanguageCommand('hello /language')).toBeNull()
})
