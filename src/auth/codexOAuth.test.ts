import { test, expect } from 'bun:test'
import { createHash } from 'crypto'
import { generateVerifier, challengeS256, randomState } from './codexOAuth'

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

test('challengeS256 is the base64url SHA-256 of the verifier (RFC 7636)', () => {
  const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'
  const expected = base64url(createHash('sha256').update(verifier).digest())
  expect(challengeS256(verifier)).toBe(expected)
})

test('generateVerifier yields a base64url string with no padding', () => {
  const v = generateVerifier()
  expect(v).toMatch(/^[A-Za-z0-9_-]+$/)
  // 32 random bytes → 43 base64url chars (no padding).
  expect(v.length).toBe(43)
})

test('verifier and state are unique per call', () => {
  expect(generateVerifier()).not.toBe(generateVerifier())
  expect(randomState()).not.toBe(randomState())
})
