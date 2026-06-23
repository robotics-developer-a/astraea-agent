import { expect, test } from 'bun:test'
import { getTaskPhilosophySection } from './taskPhilosophy'

test('TodoWrite principle requires criteria, verification, and evidence refs', () => {
  const section = getTaskPhilosophySection()

  expect(section).toContain('acceptanceCriteria')
  expect(section).toContain('verificationCommand')
  expect(section).toContain('evidenceRefs')
  expect(section).toContain('verifiedAt')
})

test('web verification guidance avoids unnecessary WebBrowser use for static content', () => {
  const section = getTaskPhilosophySection()

  expect(section).toContain('Use WebBrowserTool when visual rendering or interaction matters')
  expect(section).toContain('Prefer WebFetch for static pages')
  expect(section).toContain('Keep visual checks bounded')
  expect(section).not.toContain('opening it in WebBrowserTool before declaring done is MANDATORY')
})
