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
    priority: 95,
    persistent: false,
    messages: {
      en: 'Ambiguous tasks now enter Counsel automatically. /goal supports dynamic task graphs, per-step acceptance criteria, and source-backed evidence. Stronger shell, MCP, and network safety.',
      zh: '模糊任务现在会自动进入 Counsel；/goal 支持动态任务图、逐步验收标准和带来源的证据记录。Shell、MCP 和网络安全也得到加强。',
      de: 'Unklare Aufgaben wechseln jetzt automatisch in Counsel. /goal unterstützt dynamische Aufgabengraphen, Abnahmekriterien pro Schritt und belegte Nachweise. Verbesserter Shell-, MCP- und Netzwerkschutz.',
      fr: 'Les tâches ambiguës passent désormais automatiquement en mode Counsel. /goal prend en charge les graphes de tâches dynamiques, les critères par étape et les preuves sourcées. Sécurité Shell, MCP et réseau renforcée.',
      es: 'Las tareas ambiguas ahora entran automáticamente en Counsel. /goal admite grafos de tareas dinámicos, criterios por paso y evidencias con fuente. Seguridad mejorada para Shell, MCP y red.',
      ko: '모호한 작업은 이제 자동으로 Counsel에 진입합니다. /goal은 동적 작업 그래프, 단계별 승인 기준, 출처가 있는 증거를 지원합니다. Shell, MCP, 네트워크 보안이 강화되었습니다.',
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
]

export function getRecentUpdates(version: string, locale: Locale): string[] {
  return RECENT_UPDATES
    .filter(update => update.version === version || update.persistent)
    .sort((a, b) => b.priority - a.priority)
    .map(update => update.messages[locale])
}
