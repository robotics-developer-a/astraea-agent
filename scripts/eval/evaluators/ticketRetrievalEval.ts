// ─────────────────────────────────────────────────────────────────────────────
// 自定义评估器：机票检索准确度（ticketRetrievalEval）
//
// 判「agent 检索/提取的机票是否精准匹配用户约束」。由 eval-traces.ts 的 --eval=ticketRetrievalEval 调用。
//
// ✍️ 你要改的只有下面两处：
//    ① CHOICES   —— 分数档（label → 分数）
//    ② PROMPT_TEMPLATE —— 评分标准（rubric），用 {{input}} 和 {{output}} 两个变量
//
// 变量从哪来（由 eval-traces.ts 自动填）：
//    {{input}}  = 这条 span 的 input.value   （来自 astraea 会话、经 Phoenix 记录）
//    {{output}} = 这条 span 的 output.value
//    —— 配 --last-only 时，input/output 取每条 trace「最后一个 LLM span」(≈ 最终答案)
// ─────────────────────────────────────────────────────────────────────────────

import { createClassificationEvaluator } from '@arizeai/phoenix-evals/llm/index'

// ① 分数档：label → 分数。可改名/改分/增删档（如只要 yes/no 就写 { yes:1, no:0 }）。
export const CHOICES = {
  completed: 1,
  partial: 0.5,
  failed: 0,
}

// ② ✍️ 在这里写你的 promptTemplate（rubric）。必须用 {{input}} 和 {{output}}。
//    label 要输出 CHOICES 的某个 key（如 completed）。
//    ⚠️ 想让 Phoenix 显示理由，就在 rubric 里要求模型「说明判断依据」——
//       别写"只输出一个词/不要其它文字"，否则 explanation 会是空的。
//       （explanation 和 label 是两个独立的结构化字段，模型会分别填。）
export const PROMPT_TEMPLATE = `
你是一个极其严格的机票检索与数据提取评估专家。

你的任务是：对比【用户请求】中的硬性约束，检查【助手最终回应】中的机票数据是否完全精准匹配。

【用户请求】
{{input}}

【助手最终回应】
{{output}}

【评审核心标准】：
1. 提取用户请求中的：出发地、目的地、日期、具体时间/航班号。
2. 检查助手回应中提供的机票：
   - 如果用户指定了具体时间（如 8:15），助手必须精准找到该时间的机票。如果助手机票的时间不匹配（例如漏掉了8:15，却推荐了10点），视为 partial。
   - 如果完全找不到该时间的机票，但助手明确告知“没有该班次”并提供了替代方案，视为 partial。
   - 如果答非所问、错漏了日期或城市，视为 failed。

【label 取值（三选一）】：
- completed：完全精准找到了符合用户所有时间、日期、地点约束的机票（100%精准）。
- partial：找到了相关机票，但时间不完全匹配（如用户要8:15却给了10点）、或者只满足了部分条件、或者明确告知无此班次并推荐了邻近航班。
- failed：日期或城市错误、完全没有找到任何机票数据、答非所问、或明确拒绝服务。

label 输出 completed / partial / failed 之一；并在 explanation 里用一两句话说明判断依据：命中/缺失了哪些约束（出发地 / 目的地 / 日期 / 具体时间或航班号）。
`.trim()


// 工厂：接收裁判模型（由 eval-traces.ts 按 --model 传入），构造评估器。无需改动。
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createTicketRetrievalEvaluator(model: any) {
  // choices 是自定义形状，phoenix-evals 的泛型较严，脚本里用 as any 绕过（运行时正常）
  return createClassificationEvaluator({
    model,
    choices: CHOICES,
    promptTemplate: PROMPT_TEMPLATE,
    // 想加 system prompt 可在这里加： system: "..."
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any)
}
