// 轻量 i18n —— 模块单例 + 字符串目录，覆盖「少量高频 UI」（设计见 /grill-me 讨论）。
// 风格对齐 config / sessionMode 的模块单例：组件 import { t }，App 在切换时
// setLocale() + bump configVersion（重渲 live 区）+ wipeStatic（重渲 Static/welcome）。
//
// 持久化：仅在用户显式 /language 选择时写入 settings.json.language；
// 未设置则每次启动按系统 locale 探测（不冻结）。
import { getSettings } from '../settings'

export type Locale = 'en' | 'de' | 'fr' | 'es' | 'zh' | 'ko'

export interface LocaleMeta {
  id: Locale
  nativeName: string   // 选择器里显示的本地语言名
  replyName: string    // 注入系统提示「Always respond in X」用的英文语言名
}

export const LOCALES: LocaleMeta[] = [
  { id: 'en', nativeName: 'English',  replyName: 'English' },
  { id: 'de', nativeName: 'Deutsch',  replyName: 'German' },
  { id: 'fr', nativeName: 'Français', replyName: 'French' },
  { id: 'es', nativeName: 'Español',  replyName: 'Spanish' },
  { id: 'zh', nativeName: '中文',      replyName: 'Chinese' },
  { id: 'ko', nativeName: '한국어',    replyName: 'Korean' },
]

const SUPPORTED = new Set<string>(LOCALES.map(l => l.id))

// ─── 系统 locale 探测 ─────────────────────────────────────────────────────────
// Intl 在三端（mac/Linux/Windows）都返回 BCP-47（如 "en-US" / "zh-CN"）；
// 退回 LANG/LC_* 环境变量。取主语言子标签映射到受支持集合，否则英文兜底。
export function detectLocale(): Locale {
  let raw = ''
  try { raw = Intl.DateTimeFormat().resolvedOptions().locale || '' } catch { /* ignore */ }
  if (!raw) raw = process.env.LANG || process.env.LC_ALL || process.env.LC_MESSAGES || ''
  const prefix = raw.toLowerCase().split(/[-_.]/)[0] ?? ''
  return SUPPORTED.has(prefix) ? (prefix as Locale) : 'en'
}

// ─── 当前 locale（模块单例）────────────────────────────────────────────────────
function initialLocale(): Locale {
  const fromSettings = getSettings().language
  if (fromSettings && SUPPORTED.has(fromSettings)) return fromSettings as Locale
  return detectLocale()
}

let _locale: Locale = initialLocale()

export function getLocale(): Locale { return _locale }
export function setLocale(locale: Locale): void { _locale = locale }

/** 当前 locale 对应、注入系统提示词的回复语言名（如 "Chinese"）。 */
export function replyLanguageName(): string {
  return LOCALES.find(l => l.id === _locale)?.replyName ?? 'English'
}

// ─── /language 命令解析 ──────────────────────────────────────────────────────
// 把一条已 trim 的输入解析成 /language 的动作意图（流式/非流式两处共用，避免逻辑漂移）：
//   '/language'          → { kind: 'wizard' }                弹向导
//   '/language en'       → { kind: 'switch', locale: 'en' }  直接切（大小写不敏感、容忍空白）
//   '/language xx'       → { kind: 'wizard' }                未知码 → 退回向导
//   其它（非 /language） → null
export type LanguageCommand = { kind: 'wizard' } | { kind: 'switch'; locale: Locale }
export function resolveLanguageCommand(trimmed: string): LanguageCommand | null {
  if (trimmed !== '/language' && !trimmed.startsWith('/language ')) return null
  const arg = trimmed.slice('/language'.length).trim().toLowerCase()
  const target = LOCALES.find(l => l.id === arg)
  return target ? { kind: 'switch', locale: target.id } : { kind: 'wizard' }
}

// ─── 字符串目录 ────────────────────────────────────────────────────────────────
// key 为稳定标识；缺失时回退英文，再回退 key 本身。{name} 占位由 t() 第二参替换。
type Dict = Record<string, string>

const EN: Dict = {
  // 通用导航
  navHint: '↑↓ move  Enter confirm  Esc cancel',
  saveHint: 'Enter save  Esc cancel',
  labelProvider: 'Provider:',
  labelModel: 'Model:',
  labelApiKey: 'API Key:',
  // Welcome 卡片
  wEpithet: 'Goddess of the Stars',
  wTagline1: 'You speak, I understand · You imagine, I assist · You build, I\'m here.',
  wTagline2: 'Order is not constraint — it\'s the foundation of freedom.',
  wTagline3: 'Building a better life, together.',
  wModel: 'model',
  wDir: 'dir',
  wTools: 'tools',
  wRecentUpdates: 'Recent updates',
  wFooter: 'message · Ctrl+C exit',
  // /login 向导
  loginTitleSuffix: '— configure provider',
  loginSelectProvider: 'Select provider:',
  loginSelectModel: 'Select model:',
  loginSelectCredential: 'Choose API credentials:',
  loginReuseApiKey: 'Reuse current API Key',
  loginReuseApiKeyHint: 'keep the configured key',
  loginNewApiKey: 'Use a new API Key',
  loginNewApiKeyHint: 'replace the configured key',
  loginApiKeyPlaceholder: 'type then press Enter to save (paste supported)...',
  loginSavedTitle: 'Configuration saved',
  // /internet 向导
  netTitleSuffix: '— configure web search',
  netCurrent: 'Current: ',
  netConfigured: ' (configured)',
  netNotConfigured: 'not configured — web search unavailable',
  netSelect: 'Select a search provider:',
  netGetKey: 'Get key:  ',
  netApiKeyPlaceholder: 'paste API key then press Enter to save...',
  netSavedTitle: 'Web search configured',
  netSavedHint: 'Saved to ~/.astraea/.env (applies to all projects). I can search the web now.',
  // /language 向导
  langTitleSuffix: '— choose language',
  langSelect: 'Select UI & reply language:',
  langSavedTitle: 'Language switched',
  // 搜索 provider 提示（/internet）
  provHintBocha: 'China-direct · built for AI · recommended',
  provHintZhipu: 'China-direct · reuse Zhipu key',
  provHintTavily: '1,000/mo · proxy needed',
  provHintBrave: '2,000/mo · proxy needed',
  provHintExa: 'semantic search · proxy needed',
  // 模型提示（/login）
  mStrongest: 'most capable',
  mRecommended: 'recommended',
  mFast: 'fast',
  mDsFlash: 'V4 flash · cheap & fast · 1M ctx',
  mDsPro: 'V4 pro · deep reasoning · 1M ctx',
  mDsChat: 'legacy alias (retires 2026-07-24)',
  mDsReasoner: 'legacy R1 alias (retires 2026-07-24)',
  mKimiK2: 'flagship agentic · 256K',
  mKimiTurbo: 'faster k2 · high throughput',
  mKimiLatest: 'auto-updating latest',
  mMoonshot128: 'classic · 128K context',
  mGpt55: 'most capable · 128K output',
  mGpt54: 'recommended · value',
  mGpt54mini: 'fast · subtasks',
  mGpt53spark: 'codex spark · agentic',
  mGpt4o: 'legacy · balanced',
  mO3: 'legacy · reasoning',
  // /help
  helpCommands: 'Commands',
  helpSkills: 'Skills',
  // 杂项
  todoAllDone: 'All tasks complete',
  todoPaused: 'paused — {n} task(s) still open',
  todoAllDoneN: 'All {n} task(s) complete',
  turnLimit: '⚠ Reached the {n}-turn limit; the task may be unfinished. Press Enter or say "continue" to keep going.',
  // /goal 进度面板 + 实时提示（GoalPanel / GoalHint）
  goalActive: 'running',
  goalNextTurn: 'awaiting next turn',
  goalLabel: 'goal',
  goalTurnRunning: 'turn {n} in progress',
  goalTurnsEvaluated: '{n} turn(s) evaluated',
  goalCap: 'cap {n}',
  goalElapsed: 'elapsed',
  goalLastVerdict: 'last verdict',
  goalAwaitingFirst: '(awaiting first evaluation)',
  goalHintTitle: '◎ /goal: set a "done" condition, and Astraea loops on its own until it\'s met.',
  goalHintGoodLabel: 'good for',
  goalHintGood: '— work a command can verify, pass/fail obvious (make tests pass, clear errors, typecheck clean)',
  goalHintBadLabel: 'avoid',
  goalHintBad: '— fuzzy, taste-based work ("write it elegantly", "make it work") → easily misjudged, invites shortcuts',
  goalHintTip: 'Tip: bake "which command verifies it, what output you expect" into the goal — the more concrete, the better.',
}

const ZH: Dict = {
  navHint: '↑↓ 移动  Enter 确认  Esc 取消',
  saveHint: 'Enter 保存  Esc 取消',
  labelProvider: 'Provider:',
  labelModel: 'Model:',
  labelApiKey: 'API Key:',
  wEpithet: '星之女神',
  wTagline1: '你说，我懂 · 你想，我助 · 你造，我在。',
  wTagline2: '秩序不是束缚——它是自由的根基。',
  wTagline3: '一起，把生活建得更好。',
  wModel: '模型',
  wDir: '目录',
  wTools: '工具',
  wRecentUpdates: '最近更新',
  wFooter: '输入消息 · Ctrl+C 退出',
  loginTitleSuffix: '— 配置 Provider',
  loginSelectProvider: '选择 Provider:',
  loginSelectModel: '选择 Model:',
  loginSelectCredential: '选择 API 凭据:',
  loginReuseApiKey: '复用当前 API Key',
  loginReuseApiKeyHint: '保留已配置的 Key',
  loginNewApiKey: '使用新的 API Key',
  loginNewApiKeyHint: '替换已配置的 Key',
  loginApiKeyPlaceholder: '输入后按 Enter 保存（支持粘贴）...',
  loginSavedTitle: '配置已保存',
  netTitleSuffix: '— 配置联网搜索',
  netCurrent: '当前: ',
  netConfigured: '（已配置）',
  netNotConfigured: '未配置 — 联网搜索不可用',
  netSelect: '选择搜索 Provider:',
  netGetKey: '获取 Key:  ',
  netApiKeyPlaceholder: '粘贴 API Key 后按 Enter 保存...',
  netSavedTitle: '联网搜索已配置',
  netSavedHint: '已保存到 ~/.astraea/.env，所有项目生效。现在可以让我联网搜索了。',
  langTitleSuffix: '— 选择语言',
  langSelect: '选择界面与回复语言:',
  langSavedTitle: '语言已切换',
  provHintBocha: '国内直连 · 专为 AI 设计 · 推荐',
  provHintZhipu: '国内直连 · 可复用智谱 Key',
  provHintTavily: '1,000次/月 · 需代理',
  provHintBrave: '2,000次/月 · 需代理',
  provHintExa: '语义搜索 · 需代理',
  mStrongest: '最强',
  mRecommended: '推荐',
  mFast: '快速',
  mDsFlash: 'V4 flash · 便宜快 · 1M 上下文',
  mDsPro: 'V4 pro · 深度推理 · 1M 上下文',
  mDsChat: '旧别名（2026-07-24 下线）',
  mDsReasoner: '旧 R1 别名（2026-07-24 下线）',
  mKimiK2: '旗舰 agentic · 256K',
  mKimiTurbo: '更快的 k2 · 高吞吐',
  mKimiLatest: '自动更新最新版',
  mMoonshot128: '经典 · 128K 上下文',
  mGpt55: '最强 · 128K 输出',
  mGpt54: '推荐 · 性价比',
  mGpt54mini: '快速 · 子任务',
  mGpt53spark: 'codex spark · 智能体',
  mGpt4o: '旧 · 均衡',
  mO3: '旧 · 推理',
  helpCommands: '命令',
  helpSkills: '技能',
  todoAllDone: '所有任务已完成',
  todoPaused: '已暂停 — 还有 {n} 个任务未完成',
  todoAllDoneN: '已完成全部 {n} 个任务',
  turnLimit: '⚠ 已达单轮上限 {n} 轮，任务可能未完成。直接回车或补一句"继续"即可接着跑。',
  goalActive: '进行中',
  goalNextTurn: '待下一轮',
  goalLabel: '目标',
  goalTurnRunning: '第 {n} 轮进行中',
  goalTurnsEvaluated: '已评估 {n} 轮',
  goalCap: '上限 {n}',
  goalElapsed: '已用',
  goalLastVerdict: '上轮判定',
  goalAwaitingFirst: '（待首次评估）',
  goalHintTitle: '◎ /goal：定个"做完的标准"，Astraea 自己反复干到达标才停。',
  goalHintGoodLabel: '好用',
  goalHintGood: '—— 标准能用命令验证、对错一目了然的活（把测试跑通、清掉报错、类型检查通过）',
  goalHintBadLabel: '别用',
  goalHintBad: '—— 靠"感觉"、说不清算不算完成的活（"写优雅""功能能用"）→ 易被误判，甚至走捷径',
  goalHintTip: '诀窍：把"用哪条命令验证、期望看到什么"写进目标，越具体越靠谱。',
}

const DE: Dict = {
  navHint: '↑↓ bewegen  Enter bestätigen  Esc abbrechen',
  saveHint: 'Enter speichern  Esc abbrechen',
  labelProvider: 'Anbieter:',
  labelModel: 'Modell:',
  labelApiKey: 'API-Schlüssel:',
  wEpithet: 'Göttin der Sterne',
  wTagline1: 'Du sprichst, ich verstehe · Du träumst, ich helfe · Du baust, ich bin da.',
  wTagline2: 'Ordnung ist kein Zwang — sie ist das Fundament der Freiheit.',
  wTagline3: 'Gemeinsam ein besseres Leben gestalten.',
  wModel: 'Modell',
  wDir: 'Verz.',
  wTools: 'Tools',
  wRecentUpdates: 'Letzte Updates',
  wFooter: 'Nachricht · Ctrl+C beenden',
  loginTitleSuffix: '— Anbieter konfigurieren',
  loginSelectProvider: 'Anbieter wählen:',
  loginSelectModel: 'Modell wählen:',
  loginSelectCredential: 'API-Zugang wählen:',
  loginReuseApiKey: 'Aktuellen API Key verwenden',
  loginReuseApiKeyHint: 'konfigurierten Key behalten',
  loginNewApiKey: 'Neuen API Key verwenden',
  loginNewApiKeyHint: 'konfigurierten Key ersetzen',
  loginApiKeyPlaceholder: 'eingeben, dann Enter zum Speichern (Einfügen möglich)...',
  loginSavedTitle: 'Konfiguration gespeichert',
  netTitleSuffix: '— Websuche konfigurieren',
  netCurrent: 'Aktuell: ',
  netConfigured: ' (konfiguriert)',
  netNotConfigured: 'nicht konfiguriert — Websuche nicht verfügbar',
  netSelect: 'Suchanbieter wählen:',
  netGetKey: 'Schlüssel: ',
  netApiKeyPlaceholder: 'API-Schlüssel einfügen, dann Enter zum Speichern...',
  netSavedTitle: 'Websuche konfiguriert',
  netSavedHint: 'In ~/.astraea/.env gespeichert (gilt für alle Projekte). Ich kann jetzt im Web suchen.',
  langTitleSuffix: '— Sprache wählen',
  langSelect: 'UI- und Antwortsprache wählen:',
  langSavedTitle: 'Sprache gewechselt',
  provHintBocha: 'China-direkt · für KI gebaut · empfohlen',
  provHintZhipu: 'China-direkt · Zhipu-Key wiederverwenden',
  provHintTavily: '1.000/Mon · Proxy nötig',
  provHintBrave: '2.000/Mon · Proxy nötig',
  provHintExa: 'semantische Suche · Proxy nötig',
  helpCommands: 'Befehle',
  helpSkills: 'Skills',
  todoAllDone: 'Alle Aufgaben erledigt',
  todoPaused: 'pausiert — {n} Aufgabe(n) noch offen',
  todoAllDoneN: 'Alle {n} Aufgabe(n) erledigt',
  turnLimit: '⚠ {n}-Runden-Limit erreicht; die Aufgabe ist evtl. unvollständig. Enter drücken oder „weiter" sagen, um fortzufahren.',
  goalActive: 'läuft',
  goalNextTurn: 'wartet auf nächste Runde',
  goalLabel: 'Ziel',
  goalTurnRunning: 'Runde {n} läuft',
  goalTurnsEvaluated: '{n} Runde(n) ausgewertet',
  goalCap: 'Limit {n}',
  goalElapsed: 'Dauer',
  goalLastVerdict: 'letztes Urteil',
  goalAwaitingFirst: '(noch keine Auswertung)',
  goalHintTitle: '◎ /goal: Definiere ein „Fertig"-Kriterium, und Astraea arbeitet selbstständig, bis es erfüllt ist.',
  goalHintGoodLabel: 'geeignet',
  goalHintGood: '— Arbeit, die ein Befehl prüfen kann, richtig/falsch eindeutig (Tests bestehen, Fehler beseitigen, Typecheck sauber)',
  goalHintBadLabel: 'ungeeignet',
  goalHintBad: '— vages, gefühlsbasiertes Ziel („elegant schreiben", „soll funktionieren") → leicht fehlbeurteilt, lädt zu Abkürzungen ein',
  goalHintTip: 'Tipp: Schreib „welcher Befehl es prüft, welche Ausgabe du erwartest" ins Ziel — je konkreter, desto besser.',
}

const FR: Dict = {
  navHint: '↑↓ déplacer  Entrée confirmer  Échap annuler',
  saveHint: 'Entrée enregistrer  Échap annuler',
  labelProvider: 'Fournisseur :',
  labelModel: 'Modèle :',
  labelApiKey: 'Clé API :',
  wEpithet: 'Déesse des étoiles',
  wTagline1: 'Tu parles, je comprends · Tu imagines, j\'assiste · Tu construis, je suis là.',
  wTagline2: 'L\'ordre n\'est pas une contrainte — c\'est le fondement de la liberté.',
  wTagline3: 'Construire une vie meilleure, ensemble.',
  wModel: 'modèle',
  wDir: 'dossier',
  wTools: 'outils',
  wRecentUpdates: 'Mises à jour récentes',
  wFooter: 'message · Ctrl+C quitter',
  loginTitleSuffix: '— configurer le fournisseur',
  loginSelectProvider: 'Choisir le fournisseur :',
  loginSelectModel: 'Choisir le modèle :',
  loginSelectCredential: 'Choisir les identifiants API :',
  loginReuseApiKey: 'Réutiliser la clé API actuelle',
  loginReuseApiKeyHint: 'conserver la clé configurée',
  loginNewApiKey: 'Utiliser une nouvelle clé API',
  loginNewApiKeyHint: 'remplacer la clé configurée',
  loginApiKeyPlaceholder: 'saisir puis Entrée pour enregistrer (collage possible)...',
  loginSavedTitle: 'Configuration enregistrée',
  netTitleSuffix: '— configurer la recherche web',
  netCurrent: 'Actuel : ',
  netConfigured: ' (configuré)',
  netNotConfigured: 'non configuré — recherche web indisponible',
  netSelect: 'Choisir un fournisseur de recherche :',
  netGetKey: 'Obtenir : ',
  netApiKeyPlaceholder: 'collez la clé API puis Entrée pour enregistrer...',
  netSavedTitle: 'Recherche web configurée',
  netSavedHint: 'Enregistré dans ~/.astraea/.env (vaut pour tous les projets). Je peux chercher sur le web.',
  langTitleSuffix: '— choisir la langue',
  langSelect: 'Choisir la langue de l\'UI et des réponses :',
  langSavedTitle: 'Langue changée',
  provHintBocha: 'Chine-direct · conçu pour l\'IA · recommandé',
  provHintZhipu: 'Chine-direct · réutiliser la clé Zhipu',
  provHintTavily: '1 000/mois · proxy requis',
  provHintBrave: '2 000/mois · proxy requis',
  provHintExa: 'recherche sémantique · proxy requis',
  helpCommands: 'Commandes',
  helpSkills: 'Compétences',
  todoAllDone: 'Toutes les tâches terminées',
  todoPaused: 'en pause — {n} tâche(s) encore ouverte(s)',
  todoAllDoneN: 'Les {n} tâche(s) terminées',
  turnLimit: '⚠ Limite de {n} tours atteinte ; la tâche est peut-être inachevée. Appuyez sur Entrée ou dites « continuer ».',
  goalActive: 'en cours',
  goalNextTurn: 'en attente du prochain tour',
  goalLabel: 'objectif',
  goalTurnRunning: 'tour {n} en cours',
  goalTurnsEvaluated: '{n} tour(s) évalué(s)',
  goalCap: 'limite {n}',
  goalElapsed: 'écoulé',
  goalLastVerdict: 'dernier verdict',
  goalAwaitingFirst: '(première évaluation à venir)',
  goalHintTitle: '◎ /goal : définissez un critère de « fini », et Astraea boucle seule jusqu\'à l\'atteindre.',
  goalHintGoodLabel: 'adapté',
  goalHintGood: '— un travail qu\'une commande peut vérifier, réussite/échec évident (faire passer les tests, éliminer les erreurs, typecheck propre)',
  goalHintBadLabel: 'à éviter',
  goalHintBad: '— objectif flou, basé sur le ressenti (« écrire élégamment », « que ça marche ») → facile à mal juger, invite aux raccourcis',
  goalHintTip: 'Astuce : inscrivez « quelle commande le vérifie, quelle sortie vous attendez » dans l\'objectif — plus c\'est concret, mieux c\'est.',
}

const ES: Dict = {
  navHint: '↑↓ mover  Enter confirmar  Esc cancelar',
  saveHint: 'Enter guardar  Esc cancelar',
  labelProvider: 'Proveedor:',
  labelModel: 'Modelo:',
  labelApiKey: 'Clave API:',
  wEpithet: 'Diosa de las estrellas',
  wTagline1: 'Tú hablas, yo entiendo · Tú imaginas, yo ayudo · Tú creas, yo estoy aquí.',
  wTagline2: 'El orden no es una atadura — es la base de la libertad.',
  wTagline3: 'Construyendo juntos una vida mejor.',
  wModel: 'modelo',
  wDir: 'dir',
  wTools: 'herram.',
  wRecentUpdates: 'Actualizaciones recientes',
  wFooter: 'mensaje · Ctrl+C salir',
  loginTitleSuffix: '— configurar proveedor',
  loginSelectProvider: 'Elegir proveedor:',
  loginSelectModel: 'Elegir modelo:',
  loginSelectCredential: 'Elegir credenciales API:',
  loginReuseApiKey: 'Reutilizar la API Key actual',
  loginReuseApiKeyHint: 'mantener la clave configurada',
  loginNewApiKey: 'Usar una nueva API Key',
  loginNewApiKeyHint: 'reemplazar la clave configurada',
  loginApiKeyPlaceholder: 'escribe y pulsa Enter para guardar (pegar permitido)...',
  loginSavedTitle: 'Configuración guardada',
  netTitleSuffix: '— configurar búsqueda web',
  netCurrent: 'Actual: ',
  netConfigured: ' (configurado)',
  netNotConfigured: 'sin configurar — búsqueda web no disponible',
  netSelect: 'Elegir un proveedor de búsqueda:',
  netGetKey: 'Obtener: ',
  netApiKeyPlaceholder: 'pega la clave API y pulsa Enter para guardar...',
  netSavedTitle: 'Búsqueda web configurada',
  netSavedHint: 'Guardado en ~/.astraea/.env (aplica a todos los proyectos). Ya puedo buscar en la web.',
  langTitleSuffix: '— elegir idioma',
  langSelect: 'Elegir idioma de la interfaz y respuestas:',
  langSavedTitle: 'Idioma cambiado',
  provHintBocha: 'China-directo · hecho para IA · recomendado',
  provHintZhipu: 'China-directo · reutiliza clave Zhipu',
  provHintTavily: '1.000/mes · requiere proxy',
  provHintBrave: '2.000/mes · requiere proxy',
  provHintExa: 'búsqueda semántica · requiere proxy',
  helpCommands: 'Comandos',
  helpSkills: 'Habilidades',
  todoAllDone: 'Todas las tareas completadas',
  todoPaused: 'en pausa — {n} tarea(s) aún abierta(s)',
  todoAllDoneN: 'Las {n} tarea(s) completadas',
  turnLimit: '⚠ Se alcanzó el límite de {n} turnos; la tarea puede estar incompleta. Pulsa Enter o di «continuar».',
  goalActive: 'en curso',
  goalNextTurn: 'esperando el próximo turno',
  goalLabel: 'objetivo',
  goalTurnRunning: 'turno {n} en curso',
  goalTurnsEvaluated: '{n} turno(s) evaluado(s)',
  goalCap: 'límite {n}',
  goalElapsed: 'transcurrido',
  goalLastVerdict: 'último veredicto',
  goalAwaitingFirst: '(primera evaluación pendiente)',
  goalHintTitle: '◎ /goal: define un criterio de «terminado» y Astraea itera sola hasta cumplirlo.',
  goalHintGoodLabel: 'adecuado',
  goalHintGood: '— trabajo que un comando puede verificar, acierto/fallo evidente (que pasen las pruebas, eliminar errores, typecheck limpio)',
  goalHintBadLabel: 'evitar',
  goalHintBad: '— objetivo difuso, basado en sensación («escríbelo con elegancia», «que funcione») → fácil de malinterpretar, invita a atajos',
  goalHintTip: 'Consejo: incluye «qué comando lo verifica, qué salida esperas» en el objetivo — cuanto más concreto, mejor.',
}

const KO: Dict = {
  navHint: '↑↓ 이동  Enter 확인  Esc 취소',
  saveHint: 'Enter 저장  Esc 취소',
  labelProvider: 'Provider:',
  labelModel: 'Model:',
  labelApiKey: 'API 키:',
  wEpithet: '별의 여신',
  wTagline1: '당신이 말하면 제가 이해하고 · 당신이 상상하면 제가 돕고 · 당신이 만들면 제가 함께합니다.',
  wTagline2: '질서는 속박이 아니라 — 자유의 토대입니다.',
  wTagline3: '함께 더 나은 삶을 만들어갑니다.',
  wModel: '모델',
  wDir: '경로',
  wTools: '도구',
  wRecentUpdates: '최근 업데이트',
  wFooter: '메시지 입력 · Ctrl+C 종료',
  loginTitleSuffix: '— Provider 설정',
  loginSelectProvider: 'Provider 선택:',
  loginSelectModel: 'Model 선택:',
  loginSelectCredential: 'API 인증 정보 선택:',
  loginReuseApiKey: '현재 API Key 재사용',
  loginReuseApiKeyHint: '설정된 Key 유지',
  loginNewApiKey: '새 API Key 사용',
  loginNewApiKeyHint: '설정된 Key 교체',
  loginApiKeyPlaceholder: '입력 후 Enter로 저장 (붙여넣기 지원)...',
  loginSavedTitle: '설정이 저장됨',
  netTitleSuffix: '— 웹 검색 설정',
  netCurrent: '현재: ',
  netConfigured: ' (설정됨)',
  netNotConfigured: '미설정 — 웹 검색 사용 불가',
  netSelect: '검색 Provider 선택:',
  netGetKey: '키 받기: ',
  netApiKeyPlaceholder: 'API 키를 붙여넣고 Enter로 저장...',
  netSavedTitle: '웹 검색이 설정됨',
  netSavedHint: '~/.astraea/.env에 저장됨 (모든 프로젝트에 적용). 이제 웹을 검색할 수 있습니다.',
  langTitleSuffix: '— 언어 선택',
  langSelect: 'UI 및 답변 언어 선택:',
  langSavedTitle: '언어가 변경됨',
  provHintBocha: '중국 직결 · AI 전용 · 추천',
  provHintZhipu: '중국 직결 · Zhipu 키 재사용',
  provHintTavily: '월 1,000회 · 프록시 필요',
  provHintBrave: '월 2,000회 · 프록시 필요',
  provHintExa: '시맨틱 검색 · 프록시 필요',
  helpCommands: '명령어',
  helpSkills: '스킬',
  todoAllDone: '모든 작업 완료',
  todoPaused: '일시중지됨 — {n}개 작업 미완료',
  todoAllDoneN: '{n}개 작업 모두 완료',
  turnLimit: '⚠ {n}턴 한도에 도달했습니다. 작업이 미완료일 수 있습니다. Enter를 누르거나 "계속"이라고 입력하세요.',
  goalActive: '진행 중',
  goalNextTurn: '다음 회차 대기',
  goalLabel: '목표',
  goalTurnRunning: '{n}회차 진행 중',
  goalTurnsEvaluated: '{n}회차 평가됨',
  goalCap: '상한 {n}',
  goalElapsed: '경과',
  goalLastVerdict: '지난 판정',
  goalAwaitingFirst: '(첫 평가 대기 중)',
  goalHintTitle: '◎ /goal: "완료 기준"을 정하면 Astraea가 충족될 때까지 스스로 반복합니다.',
  goalHintGoodLabel: '적합',
  goalHintGood: '— 명령으로 검증 가능하고 성공/실패가 분명한 작업 (테스트 통과, 오류 제거, 타입체크 통과)',
  goalHintBadLabel: '부적합',
  goalHintBad: '— 모호하고 감에 의존하는 작업 ("우아하게 작성", "동작하게") → 오판되기 쉽고 편법을 부름',
  goalHintTip: '팁: "어떤 명령으로 검증하는지, 어떤 출력을 기대하는지"를 목표에 넣으세요 — 구체적일수록 좋습니다.',
}

const CATALOG: Record<Locale, Dict> = { en: EN, zh: ZH, de: DE, fr: FR, es: ES, ko: KO }

/** 取当前 locale 的字符串；缺失回退英文，再回退 key。{name} 占位由 params 替换。 */
export function t(key: string, params?: Record<string, string | number>): string {
  let s = CATALOG[_locale]?.[key] ?? EN[key] ?? key
  if (params) for (const [k, v] of Object.entries(params)) s = s.split(`{${k}}`).join(String(v))
  return s
}
