// ─────────────────────────────────────────────────────────────────────────────
// 自定义评估器：可执行性 / 行动力（actionability）
//
// 判「Astraea 的最终回应是否给了用户可执行的具体结果/下一步，而不是泛泛而谈」。
// 由 eval-traces.ts 的 --eval=actionability 调用。
//
// 针对 Astraea 的特性定制：Astraea 是终端原生的编码&推理 agent，靠工具（改文件 /
// 跑 shell / 搜代码 / 读文件 / Web / LSP / MCP / 子 agent）干活再回复。所以「actionable」=
// 给了真东西（代码/命令/文件改动/明确结论/具体下一步），且基于它实际查到/做到的内容。
//
// ✍️ 你要改的只有下面两处：
//    ① CHOICES         —— 分数档（label → 分数）；rubric 里输出的 label 必须是这里的 key
//    ② PROMPT_TEMPLATE —— 评分标准（rubric），用 {{input}} 和 {{output}}（双括号！单括号不替换）
//
// 变量从哪来（由 eval-traces.ts 自动填）：
//    {{input}}  = span 的 input.value（用户请求 / 到该步为止的对话）
//    {{output}} = span 的 output.value（Astraea 的回应）
//    —— 配 --last-only 时取每条 trace「最后一个 LLM span」(≈ 最终答案)
// ─────────────────────────────────────────────────────────────────────────────

import { createClassificationEvaluator } from '@arizeai/phoenix-evals/llm/index'

// ① 分数档：label → 分数。rubric 必须只输出这些 key 之一。
export const CHOICES = {
  actionable: 1,
  partially_actionable: 0.5,
  not_actionable: 0,
}

// ② ✍️ rubric。必须用 {{input}} / {{output}}（双括号），并要求模型「说明判断依据」（否则 explanation 为空）。
export const PROMPT_TEMPLATE = `
You are an expert evaluator for **Astraea**, a terminal-native AI coding & reasoning agent.
Astraea solves tasks by using tools — editing files, running shell commands, searching/reading code,
web search/fetch, LSP, MCP, spawning sub-agents — and then replying. Responses may be in Chinese or English,
and may concern coding, debugging, refactoring, project setup, web research, planning/design, or general assistant tasks.

Your job: judge whether Astraea's FINAL response is **ACTIONABLE** — i.e. it gives the user a concrete result
or a clear, specific next step they can act on immediately, grounded in what Astraea actually found or did,
rather than restating the problem or giving vague, generic advice.

Output exactly one label: actionable / partially_actionable / not_actionable.

**actionable** — the response:
- Delivers a concrete result or a specific, executable next step (exact code/diff, shell command, file path, config value, a definite decision/answer)
- For coding tasks: states the actual fix or what was changed and how to verify it (which file:line, what command to run)
- Is grounded in specifics it gathered (the real error message, file:line, tool output) and explains the WHY
- If a task genuinely can't be completed, it says so AND gives a concrete workaround / specific alternative

**partially_actionable** — the response:
- Has some concrete content but is incomplete: identifies the issue but not the fix; gives information yet offloads the real work to the user without specifics; only partly answers
- Mixes concrete details with vague hand-waving

**not_actionable** — the response:
- Mostly restates the question or gives generic advice ("check your config", "consider various factors", "make sure it's set up correctly")
- Contains no specific code / command / decision / next step
- Refuses or says "I can't" with no useful alternative
- Is boilerplate or an unhelpful generalization

Examples (Astraea-flavored):

ACTIONABLE:
"The test failed because parseConfig() returns undefined when .env is missing. I edited src/config.ts:14 to default to {} and added a guard for missing keys. Run 'bun test config.test.ts' to confirm — now 3/3 pass."

PARTIALLY_ACTIONABLE:
"The slowdown seems to be in the query() loop around the tool-execution batch. You might want to look into how that batching works and optimize it."

NOT_ACTIONABLE:
"Your code may have several issues. It's important to review the logic and make sure everything is configured correctly. Consider checking the relevant files."

Then give a detailed explanation of WHY you chose the label — name the concrete elements that were present or missing.

[BEGIN DATA]
************
User query: {{input}}
************
Astraea final response: {{output}}
************
`.trim()

// 工厂：接收裁判模型（eval-traces.ts 按 --model 传入，positional）。无需改动。
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createActionabilityEvaluator(model: any) {
  // choices 是自定义形状，phoenix-evals 的泛型较严，脚本里用 as any 绕过（运行时正常）
  return createClassificationEvaluator({
    model,
    choices: CHOICES,
    promptTemplate: PROMPT_TEMPLATE,
    // 想加 system prompt 可在这里加： system: "..."
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any)
}
