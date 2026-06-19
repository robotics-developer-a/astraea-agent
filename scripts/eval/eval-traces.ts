#!/usr/bin/env bun
// ─────────────────────────────────────────────────────────────────────────────
// LLM-as-a-judge：评估 Phoenix 里 astraea 的真实 trace（路径 A 实现）
//
// 闭环：getSpans 拉 span → phoenix-evals 让 LLM 打分 → logSpanAnnotations 回写。
// 分数以 annotation 形式挂在 Phoenix UI 每个 span 旁（不改原始 span）。
// 文档：Astraea Development/v1.0/Bridge/LLM-as-a-judge-评估trace.md
//
// 依赖（已装）：@arizeai/phoenix-client @arizeai/phoenix-evals @ai-sdk/openai
//
// 用法：
//   export OPENAI_API_KEY=sk-...          # 裁判模型（与 astraea 运行 provider 无关）
//   bun run scripts/eval/eval-traces.ts                      # dry-run，只打印不回写
//   bun run scripts/eval/eval-traces.ts --write             # 评完回写 Phoenix
//   bun run scripts/eval/eval-traces.ts --kind=TOOL --eval=correctness --limit=30 --write
//   bun run scripts/eval/eval-traces.ts --trace=<traceId> --kind=ALL          # 只评某一条 trace（一轮）
//
// 选项：
//   --project=<name>   默认 astraea
//   --trace=<id>[,<id>] 只评指定 trace（从 Phoenix UI 复制 trace id）；留空 = 项目级最近 N 个 span
//   --kind=LLM|TOOL|AGENT|ALL   评哪类 span（默认 LLM；AGENT 根 span 暂无 output，会被跳过）
//   --last-only        每条 trace 只评最后一个 LLM span（≈ 最终答案）；隐含 kind=LLM
//   --eval=correctness|conciseness|refusal|actionability|ticketRetrievalEval   评估器（默认 correctness）
//                       actionability       = 自定义「可执行性」，rubric 在 scripts/eval/evaluators/actionability.ts
//                       ticketRetrievalEval = 自定义「机票检索准确度」，rubric 在 scripts/eval/evaluators/ticketRetrievalEval.ts
//   --limit=<n>        拉取上限（默认 50）
//   --model=<id>       裁判模型（默认 gpt-4o）
//   --write            真正回写 Phoenix（不加 = dry-run）
// ─────────────────────────────────────────────────────────────────────────────

import { createClient } from '@arizeai/phoenix-client'
import { getSpans, logSpanAnnotations } from '@arizeai/phoenix-client/spans'
import {
  createCorrectnessEvaluator,
  createConcisenessEvaluator,
  createRefusalEvaluator,
} from '@arizeai/phoenix-evals/llm/index'
import { openai } from '@ai-sdk/openai'
import { createTicketRetrievalEvaluator } from './evaluators/ticketRetrievalEval'
import { createActionabilityEvaluator } from './evaluators/actionability'

// ── 解析参数 ──────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2)
const opt = (k: string, d: string): string => {
  const a = argv.find((x) => x.startsWith(`--${k}=`))
  return a ? a.slice(k.length + 3) : d
}
const flag = (k: string): boolean => argv.includes(`--${k}`)

const project = opt('project', 'astraea')
const traceArg = opt('trace', '') // 只评指定 trace（逗号分隔多条）；留空 = 项目级最近 N 个 span
const kind = opt('kind', 'LLM').toUpperCase() // LLM | TOOL | AGENT | ALL
const evalName = opt('eval', 'correctness')
const limit = Number(opt('limit', '50'))
const modelId = opt('model', 'gpt-4o')
const maxChars = Number(opt('maxchars', '12000')) // 裁判输入/输出上限，防超模型 context window
const write = flag('write')
const lastOnly = flag('last-only') // 每条 trace 只评最后一个 LLM span（≈ 最终答案）；隐含 kind=LLM

// span 的 input/output 可能极大（完整对话、截图 base64），截断后再喂裁判
const clip = (s: string): string =>
  s.length > maxChars ? `${s.slice(0, maxChars)}\n…[truncated ${s.length - maxChars} chars]` : s

if (!process.env.OPENAI_API_KEY) {
  console.error('✗ 未设 OPENAI_API_KEY（裁判模型需要）。在 .env 或 export 后重试。')
  process.exit(1)
}

const model = openai(modelId)
// 评估器是复杂泛型，脚本层用 any 即可（运行时返回 { label, score?, explanation? }）
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const EVALUATORS: Record<string, () => any> = {
  correctness: () => createCorrectnessEvaluator({ model }),
  conciseness: () => createConcisenessEvaluator({ model }),
  refusal: () => createRefusalEvaluator({ model }),
  actionability: () => createActionabilityEvaluator(model), // 自定义：rubric 见 ./evaluators/actionability.ts
  ticketRetrievalEval: () => createTicketRetrievalEvaluator(model), // 自定义：rubric 见 ./evaluators/ticketRetrievalEval.ts
}
const makeJudge = EVALUATORS[evalName]
if (!makeJudge) {
  console.error(`✗ 未知评估器 --eval=${evalName}，可选：${Object.keys(EVALUATORS).join(' / ')}`)
  process.exit(1)
}
const judge = makeJudge()

// ── ① 拉 span ────────────────────────────────────────────────────────────────
const baseUrl = process.env.PHOENIX_COLLECTOR_ENDPOINT ?? process.env.PHOENIX_HOST ?? 'http://localhost:6006'
const client = createClient({ options: { baseUrl } })

const traceIds = traceArg ? traceArg.split(',').map((s) => s.trim()).filter(Boolean) : undefined
const { spans } = await getSpans({
  client,
  project: { projectName: project },
  limit,
  ...(traceIds ? { traceIds } : {}),
})
// --last-only 时只看 LLM span（最终答案是 LLM 调用），忽略 --kind
const effectiveKind = lastOnly ? 'LLM' : kind
let targets = spans.filter(
  (s: any) =>
    (effectiveKind === 'ALL' || s.span_kind === effectiveKind) &&
    s.attributes?.['input.value'] != null &&
    s.attributes?.['output.value'] != null,
)

if (lastOnly) {
  // 按 trace 分组，每条 trace 只保留 start_time 最大的那个 LLM span（= 最后一次模型调用 ≈ 最终答案）
  const byTrace = new Map<string, any>()
  for (const s of targets as any[]) {
    const tid = s.context?.trace_id ?? ''
    const prev = byTrace.get(tid)
    if (!prev || String(s.start_time ?? '') > String(prev.start_time ?? '')) byTrace.set(tid, s)
  }
  targets = [...byTrace.values()]
}

const scope = traceIds ? `trace ${traceIds.join(', ')}` : `项目「${project}」`
const modeNote = lastOnly ? '，每 trace 仅最终答案(末个 LLM span)' : ''
console.log(
  `${scope}：拉到 ${spans.length} span，匹配 kind=${effectiveKind}${modeNote} 且有 input+output 的 ${targets.length} 个。\n` +
    `评估器=${evalName}，裁判=${modelId}，模式=${write ? '回写' : 'dry-run（加 --write 才写回）'}\n`,
)

// ── ② LLM 打分 + 攒 annotation ───────────────────────────────────────────────
const annotations: any[] = []
let i = 0
for (const s of targets as any[]) {
  i++
  const input = clip(String(s.attributes['input.value']))
  const output = clip(String(s.attributes['output.value']))
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let r: any
  try {
    r = await judge.evaluate({ input, output })
  } catch (e) {
    console.error(`  #${i} [skip] ${s.name}: ${String(e)}`)
    continue
  }
  console.log(`  #${i} ${s.span_kind} ${s.name}: ${r.label}${r.score != null ? ` (score=${r.score})` : ''}`)
  if (r.explanation) console.log(`       ↳ ${String(r.explanation).replace(/\s+/g, ' ').slice(0, 200)}`)
  annotations.push({
    spanId: s.context.span_id,
    name: evalName,
    label: r.label,
    ...(typeof r.score === 'number' ? { score: r.score } : {}),
    // explanation 是 Annotation 的原生字段（Phoenix UI 的 Explanation 显示的就是它）；放 metadata 里 UI 不显示
    ...(r.explanation ? { explanation: String(r.explanation) } : {}),
    annotatorKind: 'LLM' as const,
    identifier: evalName, // 同 span 同评估器 → 复评时更新而非重复
    metadata: { judge: modelId },
  })
}

// ── ③ 回写（仅 --write）──────────────────────────────────────────────────────
if (!annotations.length) {
  console.log('\n没有可评的 span（检查 --kind / --project，或该 project 暂无带 output 的 span）。')
} else if (write) {
  await logSpanAnnotations({ client, spanAnnotations: annotations, sync: true })
  console.log(`\n✓ 已回写 ${annotations.length} 条评分到 Phoenix —— 刷新 UI，分数挂在对应 span 上。`)
} else {
  console.log(`\n（dry-run）已评 ${annotations.length} 个 span，未回写。加 --write 写回 Phoenix。`)
}
