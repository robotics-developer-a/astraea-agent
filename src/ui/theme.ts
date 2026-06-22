// 状态色矩阵（State Matrix）—— 终端状态的语义化单一来源。
//
// 人对颜色的语义感知是本能的：用一致的三色把 Agent 状态「翻译」成颜色，能极大降低
// 用户的认知负载。改一处即可全局换肤；Web 端如需复用，沿用同名语义映射到 CSS 颜色即可。
//
//   success —— 深绿：安全、已落盘（工具成功、测试通过、任务交付）。"这部分改动已进盘，别担心。"
//   pending —— 深黄：进行中 / 等待 / 需用户介入（思考中、调用收费 API、待授权）。"我在动，请关注。"
//   error   —— 深红：报错 / 中断 / 防御触发（工具失败、编译失败、Guardrail、用户主动 /stop）。"出事了，已暂停。"
//
// 用深色 hex 而非 ANSI 具名色（绿/黄/红默认偏亮），与深色终端背景更好融合。

export type AgentStatus = 'success' | 'pending' | 'error'

// Ink <Text color> 接受 hex 颜色。集中在此 → 全局唯一真相源。
export const STATUS_COLOR: Record<AgentStatus, string> = {
  success: '#2e7d32',
  pending: '#f9a825',
  error: '#c62828',
}

// 单个工具调用状态 → 语义颜色（ToolBatch 调用头用）。
//   running → 黄（进行中）  done → 绿（已落盘）  error → 红（失败）
export function toolStatusColor(status: 'running' | 'done' | 'error'): string {
  if (status === 'error') return STATUS_COLOR.error
  if (status === 'running') return STATUS_COLOR.pending
  return STATUS_COLOR.success
}

// Astraea 自述结论（verdict）的语义色 —— 与工具/状态行的色彩一致。
// 全部用深色 hex，统一视觉风格。
//   ok   —— 深绿：成功 / 通过 / 全部解决（"这一轮交付了，放心。"）
//   warn —— 深黄：有遗留 / 待用户操作 / 未做完（"做完 X，还剩 Y，要我接着做吗？"）
//   err  —— 深红：失败 / 报错 / 中断（"测试 fail，已暂停。"）
export const VERDICT_COLOR = {
  ok: '#2e7d32',
  warn: '#f9a825',
  err: '#c62828',
} as const

export type VerdictKind = keyof typeof VERDICT_COLOR

// 状态行拆分：marker（含尾随空格） | 首个提醒词 | 余下补充文字。
// 克制上色规则：仅「第一个提醒词」按状态色上色，marker 与补充文字一律留白
// （与工具名、verdict 同一规则 —— 颜色只点睛一个词，不铺满整行）。
//   「■ Error. Request was aborted.」→ { marker:'■ ', keyword:'Error', rest:'. Request was aborted.' }
//   「◌ /stop — nothing is running.」 → { marker:'◌ ', keyword:'/stop', rest:' — nothing is running.' }
//   「■ cancelled」                    → { marker:'■ ', keyword:'cancelled', rest:'' }
// marker 限定为「单个符号 + 空白」（■ / ◌ 等），从而 "/stop" 这类以 / 开头的提醒词不被误吞。
export function splitStatusLine(text: string): { marker: string; keyword: string; rest: string } {
  const m = text.match(/^([^\w\s/]\s+)?(\S+?)(?=[\s.。！!？?,，:：]|$)([\s\S]*)$/)
  if (!m) return { marker: '', keyword: text, rest: '' }
  return { marker: m[1] ?? '', keyword: m[2] ?? '', rest: m[3] ?? '' }
}

// ── 品牌强调色（Brand Palette）──────────────────────────────────────────────
// Astraea 的视觉基调色。与上方语义状态色同源、同样集中于此 → 全局唯一真相源。
// 此前这几个色散落在 14+ 组件里各自 `const INDIGO = …`，已出现色偏（QuestionPanel
// 误用了另一支靛蓝 #7C6FF0、两处 amber 取值不一）。改一处即可全局换肤。
//
// 与语义色的分工：状态/结论用 STATUS_COLOR / VERDICT_COLOR（绿黄红，表"安全/进行/出错"）；
// 品牌装饰用下面这组（表"这是 Astraea"，不承载状态语义）。两者职责不同，勿混。
export const INDIGO = '#6A5ACD' // 品牌主色：女神字标、✦ Astraea 头、面板边框
export const SILVER = '#C8D8FF' // 星辉高光：闪烁星符、欢迎页副色
export const AMBER  = '#D99A2B' // 交互强调：权限确认 / 回滚选择器（非 pending 状态色）
export const DEEP   = '#1A0F40' // 用户消息底色（与 AstraeaGoddess 同款深品牌色）

// 折叠组的聚合颜色：任一失败 → 红；否则任一在跑 → 黄；全部完成 → 绿。
export function aggregateStatusColor(
  statuses: Array<'running' | 'done' | 'error'>,
): string {
  if (statuses.some(s => s === 'error')) return STATUS_COLOR.error
  if (statuses.some(s => s === 'running')) return STATUS_COLOR.pending
  return STATUS_COLOR.success
}
