// 标题栏摘要的「后台精炼」（grill 决议 Q2/Q3/Q7）。
//
// 任务一开始，terminalTitle.titleStartTask 已用用户原话「即时」填好标题；这里再用主模型 +
// 极小预算异步生成一句「动词开头的极短短语」，跟随回复语言，回填替换（titleUpgradeSummary）。
//
// 设计取舍：
//   · 直调 streamMessage（不走 query、无工具、不进 autocompact），输入只有用户这一条消息 →
//     极便宜（maxTokens≈32），且不会触发嵌套压缩。
//   · fire-and-forget：失败 / 中止一律吞掉返回 null，保留即时输入版标题，绝不阻塞或报错给用户。
//   · 走统一收口 streamMessage，所以这次小调用会被 recordUsage 计进 /usage（每轮几十 token，
//     已与用户确认可接受）。

import { streamMessage } from '../api/stream'
import { createUserMessage } from '../types/message'
import { replyLanguageName } from '../i18n'

const TITLE_SUMMARY_MAX_TOKENS = 32

export async function generateTitleSummary(
  promptText: string,
  signal?: AbortSignal,
): Promise<string | null> {
  const lang = replyLanguageName()
  const system =
    `You write an ultra-short task label for a terminal title bar. ` +
    `Read the user's request and reply with ONE imperative phrase that starts with a verb, ` +
    `at most 6 words. No quotes, no trailing punctuation, no preamble, no explanation. ` +
    `Write it in ${lang}.`
  try {
    let out = ''
    for await (const ev of streamMessage([createUserMessage(promptText)], {
      system,
      maxTokens: TITLE_SUMMARY_MAX_TOKENS,
      abortSignal: signal,
    })) {
      if (ev.type === 'text') out += ev.text
    }
    // 收尾清洗：折单行 + 剥首尾引号/句号（中英文标点都剥）。
    const clean = out
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/^["'「『（(]+/, '')
      .replace(/["'」』）)。.!！?？]+$/, '')
      .trim()
    return clean || null
  } catch {
    return null   // 失败 / 中止 → 保留即时输入版标题
  }
}
