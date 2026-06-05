// 压缩摘要 prompt —— 全量 9 段、单变体；<analysis> 草稿纸 + <summary> 正文（设计文档 §5.2/§7）。
//
// 反漂移核心都在这套 prompt 里：保留全部用户原话（第 6 段）、下一步附逐字引用（第 9 段）、
// 保留纠正反馈（第 4 段）。<analysis> 让模型先逐条过一遍对话提升保真度，落地时被剥掉，
// 只有 <summary> 进上下文。

const COMPACT_SYSTEM = [
  'You are summarizing a coding-assistant conversation so a fresh session can continue the work seamlessly.',
  'Be exhaustive and precise — this summary REPLACES the full conversation, so anything you omit is lost from the working context.',
  'First write your reasoning inside <analysis>...</analysis> (a scratchpad — go through the conversation point by point).',
  'Then write the structured summary inside <summary>...</summary>.',
  'Only the <summary> survives; the <analysis> is discarded.',
].join('\n')

// 9 段结构（本文档自含定义）。
const NINE_SECTIONS = `Inside <summary>, produce exactly these 9 sections:

1. Primary Request and Intent — capture ALL of the user's explicit requests and intent, in detail.
2. Key Technical Concepts — every important technology, stack, framework, and concept discussed.
3. Files and Code Sections — specific files viewed / modified / created, with key code snippets and why each matters. Pay special attention to the most recent messages.
4. Errors and Fixes — every error hit and how it was fixed, ESPECIALLY the user's corrective feedback (where the user told you to do it differently).
5. Problem Solving — problems solved and any ongoing troubleshooting.
6. All User Messages — list EVERY non-tool-result user message, verbatim. This is the key anchor for understanding user intent and feedback — do not paraphrase.
7. Pending Tasks — tasks explicitly requested but not yet done.
8. Current Work — what was being done right before this summary, with filenames and code snippets; focus on the most recent user/assistant messages.
9. Optional Next Step — the next step MUST be directly in line with the user's most recent explicit request and the task in progress. If the last task is finished, do not invent a new one. Include a VERBATIM quote of the most recent relevant conversation to ensure there is no drift in task interpretation.`

export function buildCompactSystemPrompt(): string {
  return COMPACT_SYSTEM
}

/**
 * 追加在对话末尾的 user 消息：要模型按 9 段产出摘要。
 * customInstructions 来自手动 /compact <指令> 或 PreCompact hook 的 stdout（设计文档 §5.1/§9）。
 */
export function buildCompactUserMessage(customInstructions?: string): string {
  const parts = [
    'Summarize the conversation so far so it can be continued in a fresh context window.',
    '',
    NINE_SECTIONS,
  ]
  const extra = customInstructions?.trim()
  if (extra) {
    parts.push(
      '',
      'Additional instructions for this summary (follow them):',
      extra,
    )
  }
  parts.push(
    '',
    'Write <analysis> first, then <summary>.',
  )
  return parts.join('\n')
}

/**
 * 从模型输出里剥掉 <analysis>，提取 <summary> 内容。
 * 容错：若没有 <summary> 标签，退而返回去掉 <analysis> 后的全文（trim）。
 */
export function extractSummary(raw: string): string {
  const withoutAnalysis = raw.replace(/<analysis>[\s\S]*?<\/analysis>/gi, '').trim()
  const match = withoutAnalysis.match(/<summary>([\s\S]*?)<\/summary>/i)
  if (match) return match[1]!.trim()
  // 没有闭合 <summary>：尝试取 <summary> 之后的全部（流被截断的情况）
  const open = withoutAnalysis.match(/<summary>([\s\S]*)$/i)
  if (open) return open[1]!.trim()
  return withoutAnalysis
}
