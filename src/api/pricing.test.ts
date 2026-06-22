import { test, expect } from 'bun:test'
import { computeCost, lookupPrice, CACHE_READ_MULT, CACHE_WRITE_MULT } from './pricing'

test('Anthropic Opus 4.8 priced at $5/$25 per MTok', () => {
  // 1M input + 1M output = $5 + $25 = $30
  const { usd, local } = computeCost('claude-opus-4-8', 'anthropic', {
    input: 1_000_000, output: 1_000_000, cacheRead: 0, cacheCreation: 0,
  })
  expect(local).toBe(false)
  expect(usd).toBeCloseTo(30, 6)
})

test('cache read bills 0.1x, cache write 1.25x of input price', () => {
  // 1M cache_read at $5 base → $5 * 0.1 = $0.50; 1M cache_creation → $5 * 1.25 = $6.25
  const { usd } = computeCost('claude-opus-4-8', 'anthropic', {
    input: 0, output: 0, cacheRead: 1_000_000, cacheCreation: 1_000_000,
  })
  expect(CACHE_READ_MULT).toBe(0.1)
  expect(CACHE_WRITE_MULT).toBe(1.25)
  expect(usd).toBeCloseTo(0.5 + 6.25, 6)
})

test('ollama (local) is free regardless of model id', () => {
  const { usd, local } = computeCost('qwen2.5:7b', 'ollama', {
    input: 5_000_000, output: 2_000_000, cacheRead: 0, cacheCreation: 0,
  })
  expect(local).toBe(true)
  expect(usd).toBe(0)
})

test('unknown non-local model is unpriced (null), not guessed', () => {
  const { usd, local } = computeCost('some-future-gpt', 'openai', {
    input: 1_000_000, output: 1_000_000, cacheRead: 0, cacheCreation: 0,
  })
  expect(local).toBe(false)
  expect(usd).toBeNull()
})

test('prefix match handles dated-snapshot suffixes', () => {
  expect(lookupPrice('claude-haiku-4-5-20251001')).toEqual({ inputPerMTok: 1, outputPerMTok: 5 })
})

// ── AC1: provider-aware cache multipliers ──

test('OpenAI cached input billed 0.5x of input price', () => {
  // gpt-4o input $2.50/MTok → 1M cache_read = $2.50 * 0.5 = $1.25
  const { usd, local } = computeCost('gpt-4o', 'openai', {
    input: 0, output: 0, cacheRead: 1_000_000, cacheCreation: 0,
  })
  expect(local).toBe(false)
  expect(usd).toBeCloseTo(1.25, 6)
})

test('DeepSeek cache-hit billed 0.25x of input price', () => {
  // deepseek-chat input $0.27/MTok → 1M cache_read = $0.27 * 0.25 = $0.0675
  const { usd } = computeCost('deepseek-chat', 'deepseek', {
    input: 0, output: 0, cacheRead: 1_000_000, cacheCreation: 0,
  })
  expect(usd).toBeCloseTo(0.0675, 6)
})

test('OpenAI & DeepSeek cache-WRITE (creation) costs $0 (no write surcharge)', () => {
  // cache_creation should add nothing for either provider (cacheWriteMult: 0)
  const openai = computeCost('gpt-4o', 'openai', {
    input: 0, output: 0, cacheRead: 0, cacheCreation: 1_000_000,
  })
  expect(openai.usd).toBeCloseTo(0, 6)
  const deepseek = computeCost('deepseek-chat', 'deepseek', {
    input: 0, output: 0, cacheRead: 0, cacheCreation: 1_000_000,
  })
  expect(deepseek.usd).toBeCloseTo(0, 6)
})

// ── DeepSeek V4: flash / pro 定价 ──

test('DeepSeek V4 flash priced at $0.14/$0.28 per MTok', () => {
  const { usd, local } = computeCost('deepseek-v4-flash', 'deepseek', {
    input: 1_000_000, output: 1_000_000, cacheRead: 0, cacheCreation: 0,
  })
  expect(local).toBe(false)
  expect(usd).toBeCloseTo(0.14 + 0.28, 6)
})

test('DeepSeek V4 pro priced at $0.435/$0.87 per MTok', () => {
  const { usd } = computeCost('deepseek-v4-pro', 'deepseek', {
    input: 1_000_000, output: 1_000_000, cacheRead: 0, cacheCreation: 0,
  })
  expect(usd).toBeCloseTo(0.435 + 0.87, 6)
})

test('DeepSeek V4 cache-hit: flash $0.0028/MTok, pro $0.003625/MTok; no write surcharge', () => {
  const flash = computeCost('deepseek-v4-flash', 'deepseek', {
    input: 0, output: 0, cacheRead: 1_000_000, cacheCreation: 1_000_000,
  })
  expect(flash.usd).toBeCloseTo(0.0028, 6) // cacheRead 命中价，写入 $0
  const pro = computeCost('deepseek-v4-pro', 'deepseek', {
    input: 0, output: 0, cacheRead: 1_000_000, cacheCreation: 1_000_000,
  })
  expect(pro.usd).toBeCloseTo(0.003625, 6)
})

test('Anthropic cache multipliers unchanged (0.1 read / 1.25 write) via per-model defaults', () => {
  // Anthropic entries omit cacheReadMult/cacheWriteMult → fall back to module constants.
  const { usd } = computeCost('claude-opus-4-8', 'anthropic', {
    input: 0, output: 0, cacheRead: 1_000_000, cacheCreation: 1_000_000,
  })
  // $5 base → read $5*0.1=$0.50, write $5*1.25=$6.25
  expect(usd).toBeCloseTo(0.5 + 6.25, 6)
})
