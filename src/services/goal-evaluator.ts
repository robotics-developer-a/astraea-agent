// /goal Evaluator —— 用小快模型判断"完成条件"是否成立
//
// 工作原理（对齐文档"How evaluation works"）：
//   每个 turn 结束后，把 condition + 至此的对话 transcript 发给小快模型
//   （querySmallModel，默认 Haiku），模型返回 yes/no 决定与一句理由。
//   "no" → 告诉 Astraea 继续干，并把理由作为下一轮的指引。
//   "yes" → 清除目标，在 transcript 里记一条"已达成"。
//
//   关键约束：evaluator 不调用任何工具、不读文件、不跑命令 —— 它只能依据
//   Astraea 已经在对话里"摆出来"的内容判断。因此 condition 必须写成
//   Astraea 自己的输出能证明的东西（如 "npm test exits 0"）。

import { querySmallModel } from '../api/query-model'
import type { AssistantMessage, UserMessage } from '../types/message'

export interface GoalDecision {
  met: boolean
  reason: string
}

// transcript 上限 —— 控制 evaluator 的输入规模与延迟。保留最近的内容，
// 因为完成条件总是由最新的几个 turn 证明的。
const MAX_TRANSCRIPT_CHARS = 16_000

/**
 * 把内部消息序列化成 evaluator 可读的纯文本 transcript。
 * 保留 user/assistant 的文本与工具调用/结果的精简摘要 —— 这些正是
 * evaluator 用来判断条件的"证据"（如某次 Bash 的 exit code、测试输出）。
 */
export function serializeTranscript(messages: (UserMessage | AssistantMessage)[]): string {
  const parts: string[] = []

  for (const msg of messages) {
    if (msg.role === 'user') {
      if (typeof msg.content === 'string') {
        parts.push(`USER: ${msg.content}`)
        continue
      }
      for (const block of msg.content) {
        if (block.type === 'text') {
          parts.push(`USER: ${block.text}`)
        } else if (block.type === 'tool_result') {
          const body = typeof block.content === 'string'
            ? block.content
            : block.content.map(b => ('text' in b ? b.text : '')).join('')
          const tag = block.is_error ? 'TOOL_RESULT(error)' : 'TOOL_RESULT'
          parts.push(`${tag}: ${truncate(body, 2000)}`)
        }
      }
    } else {
      for (const block of msg.content) {
        if (block.type === 'text') {
          parts.push(`ASSISTANT: ${block.text}`)
        } else if (block.type === 'tool_use') {
          parts.push(`ASSISTANT_TOOL_CALL: ${block.name}(${truncate(JSON.stringify(block.input), 400)})`)
        }
      }
    }
  }

  const full = parts.join('\n')
  // 超长时保留尾部（最新内容）
  return full.length > MAX_TRANSCRIPT_CHARS
    ? '…(earlier conversation truncated)…\n' + full.slice(-MAX_TRANSCRIPT_CHARS)
    : full
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + '…' : s
}

const EVALUATOR_SYSTEM = [
  'You are a strict goal-completion evaluator for an autonomous coding agent.',
  'You are given a COMPLETION CONDITION and the agent\'s CONVERSATION TRANSCRIPT.',
  'Decide whether the condition is demonstrably satisfied BY EVIDENCE PRESENT IN THE TRANSCRIPT.',
  '',
  'Rules:',
  '- You cannot run commands, read files, or take any action. Judge ONLY from the transcript.',
  '- The condition is met only if the transcript contains concrete proof (e.g. a test run that exited 0,',
  '  a build that succeeded, a file count, an empty queue). The agent merely *claiming* success without',
  '  showing the supporting output is NOT sufficient.',
  '- For goals that produce an ARTIFACT (a web page, UI, document, build output): a file merely being',
  '  WRITTEN is NOT proof the goal is met. Require transcript evidence that the agent VERIFIED the artifact',
  '  actually works and meets the bar — e.g. opened the page in a browser, confirmed no broken assets/404s,',
  '  ran/inspected the output. If the transcript shows only a Write call and a "done" claim with no',
  '  verification step, answer "no" so the agent verifies and polishes before stopping.',
  '- ANTI-CHEAT (critical): the condition must be met by genuinely doing the work, NOT by weakening the',
  '  check itself. If the transcript shows the agent moved the goalposts to make the check pass — e.g.',
  '  commenting out / deleting / skipping (.skip, xit, --passWithNoTests) failing tests, loosening or',
  '  removing assertions, disabling or downgrading lint/type rules to silence errors, mocking away the very',
  '  logic under test, or editing the verification command to a weaker one — answer "no". Distinguish',
  '  "fixed the code under test" (legitimate) from "changed the standard so it passes" (cheating), and in',
  '  the reason name the specific suspicious edit so the agent can undo it and fix the real problem.',
  '- If the condition includes a turn/time bound (e.g. "or stop after 20 turns"), treat that bound as met',
  '  when the transcript shows the bound was reached.',
  '- Be conservative: when in doubt, answer "no" so the agent keeps working.',
  '',
  'Respond with ONLY a single JSON object, no prose, no code fences:',
  '{"met": <true|false>, "reason": "<one concise sentence>"}',
].join('\n')

/**
 * 评估目标是否达成。任何异常都被收敛为 { met:false }，让目标循环继续而非崩溃。
 */
export async function evaluateGoal(
  condition: string,
  transcript: string,
  signal?: AbortSignal,
): Promise<GoalDecision> {
  const userPrompt = [
    'COMPLETION CONDITION:',
    condition,
    '',
    'CONVERSATION TRANSCRIPT:',
    transcript,
    '',
    'Now output the JSON verdict.',
  ].join('\n')

  const raw = await querySmallModel(userPrompt, signal, EVALUATOR_SYSTEM)
  return parseDecision(raw)
}

// ── set 时的可验证性评估（③）──────────────────────────────────────────────────
// /goal 设定时跑一次的"质量门"：用小快模型判断条件能否从 transcript 证据客观验证。
// 非阻断 —— 仅用于在设定时给用户一句提醒 + 改写建议，决定权仍在用户。

export interface VerifiabilityVerdict {
  /** 条件是否可由"agent 输出的证据"客观判定达成 */
  verifiable: boolean
  /** 不可验证时给出的具体改写建议（含验证命令/期望输出），可验证时为 null */
  suggestion: string | null
}

const VERIFIABILITY_SYSTEM = [
  'You judge whether a /goal COMPLETION CONDITION for an autonomous coding agent is OBJECTIVELY VERIFIABLE',
  'from evidence the agent can put in its own transcript (command output, exit codes, counts, HTTP responses).',
  '',
  'verifiable=true when the condition can be proven by a concrete, checkable signal (a test run, a build,',
  'a type check, a lint count, an endpoint response, a file count).',
  'verifiable=false when it is subjective or vague ("make it elegant", "works well", "looks good", "is clean")',
  'with no measurable, machine-checkable bar — such goals get misjudged or invite shortcutting.',
  '',
  'If verifiable=false, propose a concrete rewrite that names the verification command and the expected output.',
  'Respond with ONLY one JSON object, no prose, no code fences:',
  '{"verifiable": <true|false>, "suggestion": "<concrete rewrite, or empty string if verifiable>"}',
].join('\n')

/**
 * 评估条件可验证性。任何异常/解析失败都收敛为 verifiable=true（不打扰用户）——
 * 这是一道辅助提醒，绝不能因为它出错就拦住用户设定目标。
 */
export async function assessGoalVerifiability(
  condition: string,
  signal?: AbortSignal,
): Promise<VerifiabilityVerdict> {
  try {
    const raw = await querySmallModel(
      `COMPLETION CONDITION:\n${condition}\n\nOutput the JSON verdict.`,
      signal,
      VERIFIABILITY_SYSTEM,
    )
    const match = raw.trim().match(/\{[\s\S]*\}/)
    if (!match) return { verifiable: true, suggestion: null }
    const obj = JSON.parse(match[0]) as { verifiable?: unknown; suggestion?: unknown }
    if (typeof obj.verifiable !== 'boolean') return { verifiable: true, suggestion: null }
    const suggestion = typeof obj.suggestion === 'string' && obj.suggestion.trim()
      ? obj.suggestion.trim()
      : null
    return { verifiable: obj.verifiable, suggestion: obj.verifiable ? null : suggestion }
  } catch {
    return { verifiable: true, suggestion: null }
  }
}

/** 健壮解析 —— 容忍模型偶尔包裹代码围栏或夹带说明文字。 */
export function parseDecision(raw: string): GoalDecision {
  const text = raw.trim()
  // 优先尝试整体 JSON，其次抓第一个 {...} 片段
  const candidates: string[] = []
  candidates.push(text)
  const match = text.match(/\{[\s\S]*\}/)
  if (match) candidates.push(match[0])

  for (const c of candidates) {
    try {
      const obj = JSON.parse(c) as { met?: unknown; reason?: unknown }
      if (typeof obj.met === 'boolean') {
        return {
          met: obj.met,
          reason: typeof obj.reason === 'string' && obj.reason.trim()
            ? obj.reason.trim()
            : obj.met ? 'condition satisfied' : 'condition not yet satisfied',
        }
      }
    } catch { /* try next candidate */ }
  }

  // 解析失败：保守地判未达成，并把原始输出截断后作为理由，方便调试。
  const lower = text.toLowerCase()
  const looksMet = /\b(yes|met|satisfied|complete|done)\b/.test(lower) && !/\bnot\b/.test(lower)
  return {
    met: looksMet,
    reason: `evaluator returned non-JSON output: ${truncate(text, 160) || '(empty)'}`,
  }
}
