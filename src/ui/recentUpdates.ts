import type { Locale } from '../i18n'

export interface RecentUpdate {
  version: string
  priority: number
  persistent: boolean
  messages: Record<Locale, string>
}

export const RECENT_UPDATES: RecentUpdate[] = [
  {
    version: '0.9.28',
    priority: 100,
    persistent: true,
    messages: {
      en: 'Ambiguous tasks → Counsel automatically. /goal: dynamic graphs, per-step criteria, sourced evidence. Stronger shell, MCP, network safety.',
      zh: '模糊任务 → Counsel；/goal 支持动态图、分步标准和可溯源证据。Shell、MCP、网络安全增强。',
      de: 'Unklare Aufgaben → Counsel. /goal: dynamische Graphen, Kriterien pro Schritt, belegte Nachweise. Verbesserter Shell-, MCP- und Netzwerkschutz.',
      fr: 'Tâches ambiguës → Counsel. /goal: graphes dynamiques, critères par étape, preuves sourcées. Sécurité Shell, MCP, réseau renforcée.',
      es: 'Tareas ambiguas → Counsel. /goal: grafos dinámicos, criterios por paso, evidencias con fuente. Seguridad Shell, MCP, red mejorada.',
      ko: '모호한 작업 → Counsel. /goal: 동적 그래프, 단계별 기준, 출처 증거. Shell, MCP, 네트워크 보안 강화.',
    },
  },
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
  {
    version: '0.9.29',
    priority: 95,
    persistent: true,
    messages: {
      en: 'Todo and task capabilities are greatly improved in the latest version.',
      zh: 'Todo 和 task 的能力在最新版本中显著提高。',
      de: 'Todo- und Task-Funktionen wurden in der neuesten Version erheblich verbessert.',
      fr: 'Les capacités de todo et task sont considérablement améliorées dans la dernière version.',
      es: 'Las capacidades de todo y task han mejorado significativamente en la última versión.',
      ko: '최신 버전에서 todo 및 task 기능이 크게 향상되었습니다.',
    },
  },
]

export function getRecentUpdates(version: string, locale: Locale): string[] {
  return RECENT_UPDATES
    .filter(update => update.version === version || update.persistent)
    .sort((a, b) => b.priority - a.priority)
    .map(update => update.messages[locale])
}
