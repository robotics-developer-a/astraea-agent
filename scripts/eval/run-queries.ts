#!/usr/bin/env bun
// ─────────────────────────────────────────────────────────────────────────────
// 批量把 data/queries.jsonl 里的 query 喂给 Astraea，产生一批 trace 进 Phoenix。
// 之后再用 eval-traces.ts --eval=actionability 评这些 trace。
//
// 前提：PHOENIX_ENABLED=1（你已在 settings.json 永久开启）+ Phoenix server 在跑。
//      每条 query 会真实调用 Astraea 的 provider（DeepSeek 等），有 token 花费和耗时。
//
// 用法（在 astraea 项目根目录运行）：
//   bun run scripts/eval/run-queries.ts                 # 跑全部
//   bun run scripts/eval/run-queries.ts --limit=5       # 先跑前 5 条试水
//   bun run scripts/eval/run-queries.ts --category=web  # 只跑某类
//   bun run scripts/eval/run-queries.ts --dry           # 只列出要跑的，不真跑
//
// Astraea 操作的项目 = 本脚本的 cwd（默认 astraea 自己的仓库）。想让它在别的项目里跑，
// 就 cd 到那个项目再用绝对路径调本脚本。
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const argv = process.argv.slice(2)
const opt = (k: string, d = '') => {
  const a = argv.find((x) => x.startsWith(`--${k}=`))
  return a ? a.slice(k.length + 3) : d
}
const flag = (k: string) => argv.includes(`--${k}`)

const root = resolve(import.meta.dir, '..', '..') // astraea 项目根
const cliPath = resolve(root, 'src', 'cli.ts')
const dataPath = resolve(import.meta.dir, 'data', 'queries.jsonl')

type Q = { id: string; category: string; query: string }
const all: Q[] = readFileSync(dataPath, 'utf8')
  .split('\n')
  .filter((l) => l.trim())
  .map((l) => JSON.parse(l))

const category = opt('category')
const limit = Number(opt('limit', String(all.length)))
const dry = flag('dry')

let queries = category ? all.filter((q) => q.category === category) : all
queries = queries.slice(0, limit)

console.log(`将运行 ${queries.length} 条 query${category ? `（category=${category}）` : ''}，cwd=${process.cwd()}`)
if (process.env.PHOENIX_ENABLED !== '1') {
  console.log('⚠️ 当前 shell 没有 PHOENIX_ENABLED=1；若 settings.json 已配则无妨，否则不会产生 trace。')
}
if (dry) {
  for (const q of queries) console.log(`  [${q.id}] (${q.category}) ${q.query}`)
  console.log('\n（--dry）未真跑。去掉 --dry 即开始。')
  process.exit(0)
}

let ok = 0
let fail = 0
for (const [idx, q] of queries.entries()) {
  console.log(`\n━━ [${idx + 1}/${queries.length}] ${q.id} (${q.category}) ━━`)
  console.log(`Q: ${q.query}`)
  const proc = Bun.spawn(['bun', 'run', cliPath, q.query], {
    cwd: root,
    stdout: 'inherit',
    stderr: 'inherit',
    env: { ...process.env },
  })
  const code = await proc.exited
  if (code === 0) ok++
  else {
    fail++
    console.error(`  ✗ ${q.id} 退出码 ${code}`)
  }
}

console.log(`\n完成：成功 ${ok}，失败 ${fail}。去 Phoenix（localhost:6006）看新 trace，然后：`)
console.log(`  bun run scripts/eval/eval-traces.ts --last-only --eval=actionability --limit=100        # 预览`)
console.log(`  bun run scripts/eval/eval-traces.ts --last-only --eval=actionability --limit=100 --write # 回写`)
