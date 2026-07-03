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
        'Ambiguous tasks → Counsel automatically. /goal: dynamic graphs, per-step criteria, sourced evidence. Stronger shell, MCP, network safety.',
        'DeepSeek models are now V4 Flash / Pro. Run /login to sign in again.',
        'Todo and task capabilities are greatly improved in the latest version.',
        'low',
      ])
    } finally {
      RECENT_UPDATES.splice(0, RECENT_UPDATES.length, ...original)
    }
  })

  test('developer-maintained eligible notices never exceed five', () => {
    expect(getRecentUpdates(pkg.version, 'en').length).toBeLessThanOrEqual(5)
  })

  test('the current version ships a dedicated welcome notice as the first item', () => {
    // 语义断言而非硬编码文案：每次发版必须为 pkg.version 增加专属条目，且它排在首位。
    const dedicated = RECENT_UPDATES.find(u => u.version === pkg.version)
    expect(dedicated).toBeDefined()
    const updates = getRecentUpdates(pkg.version, 'en')
    expect(updates[0]).toBe(dedicated!.messages.en)
  })
})
