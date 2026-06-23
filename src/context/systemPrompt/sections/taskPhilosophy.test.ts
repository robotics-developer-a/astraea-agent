import { expect, test } from 'bun:test'
import { getTaskPhilosophySection } from './taskPhilosophy'

test('TodoWrite principle requires criteria, verification, and evidence refs', () => {
  const section = getTaskPhilosophySection()

  expect(section).toContain('acceptanceCriteria')
  expect(section).toContain('verificationCommand')
  expect(section).toContain('evidenceRefs')
  expect(section).toContain('verifiedAt')
})
