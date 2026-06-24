import { afterEach, expect, test } from 'bun:test'
import { config } from '../config'
import {
  buildSmallModelSystemPrompt,
  openAICompatibleStructuredParams,
  shouldRetryStructuredJson,
  smallModelName,
} from './query-model'

const originalDeepSeekModel = config.deepseek.model

afterEach(() => {
  config.deepseek.model = originalDeepSeekModel
  delete process.env.DEEPSEEK_SMALL_MODEL
})

test('DeepSeek small model defaults to v4 flash even when the main model is pro', () => {
  config.deepseek.model = 'deepseek-v4-pro'

  expect(smallModelName('deepseek')).toBe('deepseek-v4-flash')
})

test('DeepSeek small model can be overridden explicitly', () => {
  process.env.DEEPSEEK_SMALL_MODEL = 'deepseek-v4-pro'

  expect(smallModelName('deepseek')).toBe('deepseek-v4-pro')
})

test('structuredResponse json adds JSON object response_format for OpenAI-compatible providers', () => {
  expect(openAICompatibleStructuredParams({ structuredResponse: 'json' })).toEqual({
    response_format: { type: 'json_object' },
  })
  expect(openAICompatibleStructuredParams()).toEqual({})
})

test('structuredResponse json reinforces JSON-only output in the system prompt for every provider', () => {
  expect(buildSmallModelSystemPrompt('base', { structuredResponse: 'json' })).toContain('valid JSON')
  expect(buildSmallModelSystemPrompt(undefined, { structuredResponse: 'json' })).toContain('valid JSON')
  expect(buildSmallModelSystemPrompt('base')).toBe('base')
})

test('structuredResponse json retries empty or invalid JSON and accepts JSON objects or arrays', () => {
  expect(shouldRetryStructuredJson('', { structuredResponse: 'json' })).toBe(true)
  expect(shouldRetryStructuredJson('not json', { structuredResponse: 'json' })).toBe(true)
  expect(shouldRetryStructuredJson('{"ok":true}', { structuredResponse: 'json' })).toBe(false)
  expect(shouldRetryStructuredJson('[{"ok":true}]', { structuredResponse: 'json' })).toBe(false)
  expect(shouldRetryStructuredJson('not json')).toBe(false)
})
