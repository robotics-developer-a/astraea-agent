import { querySmallModel } from '../api/query-model'

export type CompletionVerdict =
  | 'complete'
  | 'waiting_for_user'
  | 'blocked'
  | 'unfulfilled_commitment'

export interface CompletionAssessment {
  verdict: CompletionVerdict
  reason: string
}

const COMPLETION_GUARD_SYSTEM = [
  'You guard the stopping point of an autonomous coding agent.',
  'Classify whether its latest tool-free assistant message may safely end the turn.',
  '',
  'Verdicts:',
  '- complete: the user asked for information only, or the requested work is demonstrably finished.',
  '- waiting_for_user: execution genuinely requires a user decision, confirmation, or missing input.',
  '- blocked: execution was attempted but cannot continue, and the message names the concrete blocker.',
  '- unfulfilled_commitment: the assistant says it is starting, continuing, or about to perform actions,',
  '  but the current turn contains no tool call and the actions are not complete.',
  '',
  'Distinguish an unconditional action promise from a conditional statement such as',
  '"if you confirm, I will push", which is waiting_for_user.',
  'Do not treat explanations, examples, recommendations, or hypothetical plans as commitments.',
  '',
  'Respond with ONLY one JSON object:',
  '{"verdict":"complete|waiting_for_user|blocked|unfulfilled_commitment","reason":"one concise sentence"}',
].join('\n')

export async function assessCompletion(input: {
  userText: string
  assistantText: string
  signal?: AbortSignal
}): Promise<CompletionAssessment> {
  try {
    const raw = await querySmallModel(
      [
        'LATEST USER REQUEST:',
        input.userText,
        '',
        'LATEST TOOL-FREE ASSISTANT MESSAGE:',
        input.assistantText,
        '',
        'Output the JSON verdict.',
      ].join('\n'),
      input.signal,
      COMPLETION_GUARD_SYSTEM,
      { structuredResponse: 'json' },
    )
    return parseCompletionAssessment(raw)
  } catch (error) {
    return {
      verdict: 'complete',
      reason: `completion guard unavailable: ${String(error)}`,
    }
  }
}

export function parseCompletionAssessment(raw: string): CompletionAssessment {
  const match = raw.trim().match(/\{[\s\S]*\}/)
  if (!match) return malformedAssessment(raw)

  try {
    const parsed = JSON.parse(match[0]) as { verdict?: unknown; reason?: unknown }
    if (!isCompletionVerdict(parsed.verdict)) return malformedAssessment(raw)
    return {
      verdict: parsed.verdict,
      reason: typeof parsed.reason === 'string' && parsed.reason.trim()
        ? parsed.reason.trim()
        : parsed.verdict,
    }
  } catch {
    return malformedAssessment(raw)
  }
}

export function buildCommitmentDirective(reason: string): string {
  return [
    '<system-reminder>',
    `You are ending the turn with an unfulfilled action commitment: ${reason}`,
    'Do not describe the plan again. Create or update structured task tracking when available,',
    'then immediately perform the promised actions with tools.',
    'If execution genuinely requires user input, ask for the exact missing decision.',
    'If execution is blocked, report the concrete failed action and its evidence.',
    '</system-reminder>',
  ].join('\n')
}

function malformedAssessment(raw: string): CompletionAssessment {
  return {
    verdict: 'complete',
    reason: `completion guard returned invalid output: ${raw.trim().slice(0, 160) || '(empty)'}`,
  }
}

function isCompletionVerdict(value: unknown): value is CompletionVerdict {
  return (
    value === 'complete' ||
    value === 'waiting_for_user' ||
    value === 'blocked' ||
    value === 'unfulfilled_commitment'
  )
}
