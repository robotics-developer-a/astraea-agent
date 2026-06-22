import { expect, test } from 'bun:test'
import { getToolRulesSection } from './toolRules'

test('task guidance teaches dependencies criteria and evidence provenance', () => {
  const prompt = getToolRulesSection(new Set(['TaskCreate']))

  expect(prompt).toContain('dependencies')
  expect(prompt).toContain('acceptance criteria')
  expect(prompt).toContain('evidence')
  expect(prompt).toContain('confidence')
  expect(prompt).toContain('assumptions')
})
