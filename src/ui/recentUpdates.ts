import type { Locale } from '../i18n'

export interface RecentUpdate {
  version: string
  priority: number
  persistent: boolean
  messages: Record<Locale, string>
}

export const RECENT_UPDATES: RecentUpdate[] = [
  {
    version: '0.9.26',
    priority: 100,
    persistent: true,
    messages: {
      en: 'DeepSeek models are now V4 Flash / Pro. Run /login to sign in again.',
      zh: 'DeepSeek 模型已升级为 V4 Flash / Pro，请运行 /login 重新登录。',
      de: 'DeepSeek-Modelle sind jetzt V4 Flash / Pro. Führe /login aus, um dich erneut anzumelden.',
      fr: 'Les modèles DeepSeek sont maintenant V4 Flash / Pro. Lancez /login pour vous reconnecter.',
      es: 'Los modelos DeepSeek ahora son V4 Flash / Pro. Ejecuta /login para volver a iniciar sesión.',
      ko: 'DeepSeek 모델이 V4 Flash / Pro로 변경되었습니다. /login을 실행해 다시 로그인하세요.',
    },
  },
]

export function getRecentUpdates(version: string, locale: Locale): string[] {
  return RECENT_UPDATES
    .filter(update => update.version === version || update.persistent)
    .sort((a, b) => b.priority - a.priority)
    .map(update => update.messages[locale])
}
