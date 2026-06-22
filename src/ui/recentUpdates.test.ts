import { describe, expect, test } from 'bun:test'
import pkg from '../../package.json' with { type: 'json' }
import type { Locale } from '../i18n'
import { getRecentUpdates, RECENT_UPDATES } from './recentUpdates'

const LOCALES: Locale[] = ['en', 'de', 'fr', 'es', 'zh', 'ko']

describe('recent updates', () => {
  test('provides non-empty copy for all six locales', () => {
    for (const update of RECENT_UPDATES) {
      for (const locale of LOCALES) {
        expect(update.messages[locale].trim().length).toBeGreaterThan(0)
      }
    }
  })

  test('shows persistent notices across versions', () => {
    expect(getRecentUpdates('0.9.27', 'en')).toContain(
      'DeepSeek models are now V4 Flash / Pro. Run /login to sign in again.',
    )
  })

  test('sorts eligible notices by descending priority', () => {
    const original = [...RECENT_UPDATES]
    try {
      RECENT_UPDATES.push(
        {
          version: '0.9.27',
          priority: 10,
          persistent: false,
          messages: Object.fromEntries(LOCALES.map(locale => [locale, 'low'])) as Record<Locale, string>,
        },
        {
          version: '0.9.27',
          priority: 200,
          persistent: false,
          messages: Object.fromEntries(LOCALES.map(locale => [locale, 'high'])) as Record<Locale, string>,
        },
      )
      expect(getRecentUpdates('0.9.27', 'en')).toEqual([
        'high',
        'DeepSeek models are now V4 Flash / Pro. Run /login to sign in again.',
        'Ambiguous tasks → Counsel automatically. /goal: dynamic graphs, per-step criteria, sourced evidence. Stronger shell, MCP, network safety.',
        'low',
      ])
    } finally {
      RECENT_UPDATES.splice(0, RECENT_UPDATES.length, ...original)
    }
  })

  test('developer-maintained eligible notices never exceed three', () => {
    expect(getRecentUpdates(pkg.version, 'en').length).toBeLessThanOrEqual(3)
  })

  test('/goal task-accuracy update is the second welcome notice', () => {
    const updates = getRecentUpdates(pkg.version, 'en')
    expect(updates[1]).toContain('/goal')
  })
})
