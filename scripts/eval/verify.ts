#!/usr/bin/env bun
// ─────────────────────────────────────────────────────────────────────────────
// 程序化验证 harness（与 LLM-as-judge 互补）
//
// 对 data/verify-tasks.jsonl 里每个任务：
//   ① 建一个干净的隔离工作区（temp 目录）
//   ② 跑可选的 setup（如 git init）
//   ③ 把 astraea 当黑盒跑（headless = forge 自动放行 + 非交互，src/cli.ts 现成入口）
//   ④ 用确定性代码检查结果（跑 test / 比对文件输出 / 查关键串）→ pass/fail
//
// 不碰 astraea 核心 loop / 工具 / 桥接，纯脚本 harness。
//
// 用法（astraea 根目录）：
//   bun run scripts/eval/verify.ts                 # 跑全部
//   bun run scripts/eval/verify.ts --id=v-sum      # 只跑一个
//   bun run scripts/eval/verify.ts --keep          # 保留工作区供调试
//   bun run scripts/eval/verify.ts --timeout=180000
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { tmpdir } from 'node:os'

const argv = process.argv.slice(2)
const opt = (k: string, d = '') => {
  const a = argv.find((x) => x.startsWith(`--${k}=`))
  return a ? a.slice(k.length + 3) : d
}
const flag = (k: string) => argv.includes(`--${k}`)

const root = resolve(import.meta.dir, '..', '..') // astraea 项目根
const cliPath = resolve(root, 'src', 'cli.ts')
const tasksPath = resolve(import.meta.dir, 'data', 'verify-tasks.jsonl')
const reportPath = resolve(import.meta.dir, 'data', 'verify-report.json')

const onlyId = opt('id')
const keepWs = flag('keep')
const timeoutMs = Number(opt('timeout', '240000'))

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Check = any
type Task = { id: string; query: string; setup?: string[]; check: Check }

const tasks: Task[] = readFileSync(tasksPath, 'utf8')
  .split('\n')
  .filter((l) => l.trim())
  .map((l) => JSON.parse(l))
  .filter((t: Task) => !onlyId || t.id === onlyId)

/** 在 cwd 跑一条 shell 命令，返回退出码与输出。 */
async function sh(cmd: string, cwd: string): Promise<{ code: number; stdout: string; stderr: string }> {
  const p = Bun.spawn(['bash', '-c', cmd], { cwd, stdout: 'pipe', stderr: 'pipe' })
  const [stdout, stderr] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()])
  const code = await p.exited
  return { code, stdout, stderr }
}

/** 确定性检查：返回 pass + 简短理由。 */
async function runCheck(check: Check, ws: string, agentOutput: string): Promise<{ pass: boolean; detail: string }> {
  switch (check.type) {
    case 'output_contains': {
      if (check.all) {
        const miss = (check.all as string[]).filter((s) => !agentOutput.includes(s))
        return { pass: miss.length === 0, detail: miss.length ? `输出缺: ${miss.join(', ')}` : '输出含全部要求串' }
      }
      const hit = ((check.any as string[]) ?? []).filter((s) => agentOutput.includes(s))
      return { pass: hit.length > 0, detail: hit.length ? `命中: ${hit.join(', ')}` : `输出未含任一: ${(check.any ?? []).join(', ')}` }
    }
    case 'file_exists':
      return { pass: existsSync(join(ws, check.file)), detail: `${check.file} ${existsSync(join(ws, check.file)) ? '存在' : '不存在'}` }
    case 'file_runs': {
      if (!existsSync(join(ws, check.file))) return { pass: false, detail: `${check.file} 不存在` }
      const run = await sh(`bun ${check.file}`, ws)
      if (run.code !== 0) return { pass: false, detail: `运行 ${check.file} 退出码 ${run.code}: ${run.stderr.slice(0, 120)}` }
      const out = run.stdout.trim()
      if (check.expectedShell) {
        const exp = (await sh(check.expectedShell, ws)).stdout.trim()
        return { pass: out === exp, detail: out === exp ? `输出==期望(${exp})` : `输出"${out}"≠期望"${exp}"` }
      }
      if (check.contains) return { pass: out.includes(check.contains), detail: out.includes(check.contains) ? `输出含"${check.contains}"` : `输出"${out}"不含"${check.contains}"` }
      return { pass: true, detail: `${check.file} 正常运行` }
    }
    case 'shell': {
      const r = await sh(check.cmd, ws)
      const okExit = r.code === (check.expectExit ?? 0)
      const okContains = !check.outputContains || (r.stdout + r.stderr).includes(check.outputContains)
      return { pass: okExit && okContains, detail: `\`${check.cmd}\` 退出码 ${r.code}${check.outputContains ? `，含"${check.outputContains}"=${okContains}` : ''}` }
    }
    default:
      return { pass: false, detail: `未知 check.type=${check.type}` }
  }
}

console.log(`程序化验证：${tasks.length} 个任务，astraea 走 headless(forge) 黑盒执行。\n`)

const results: { id: string; pass: boolean; detail: string }[] = []
for (const t of tasks) {
  const ws = join(tmpdir(), `astraea-verify-${t.id}-${Date.now()}`)
  mkdirSync(ws, { recursive: true })
  let pass = false
  let detail = ''
  let agentOutput = ''
  try {
    // ② setup
    for (const cmd of t.setup ?? []) await sh(cmd, ws)
    // ③ headless 黑盒跑 astraea（forge 自动放行写/shell，非交互；结果写 .astraea-result.json）
    const resultFile = join(ws, '.astraea-result.json')
    const proc = Bun.spawn(['bun', 'run', cliPath, '--headless', '--task', t.id], {
      cwd: ws,
      env: {
        ...process.env,
        ASTRAEA_HEADLESS_PROMPT: t.query,
        ASTRAEA_RESULT_FILE: resultFile,
        ASTRAEA_HEADLESS_TIMEOUT_MS: String(timeoutMs),
      },
      stdout: 'ignore',
      stderr: 'ignore',
    })
    await proc.exited
    if (existsSync(resultFile)) {
      try {
        agentOutput = JSON.parse(readFileSync(resultFile, 'utf8')).output ?? ''
      } catch {
        /* ignore */
      }
    }
    // ④ 确定性检查
    ;({ pass, detail } = await runCheck(t.check, ws, agentOutput))
  } catch (e) {
    detail = `harness 错误: ${String(e)}`
  } finally {
    if (keepWs) detail += `  [ws: ${ws}]`
    else rmSync(ws, { recursive: true, force: true })
  }
  console.log(`${pass ? '✓ PASS' : '✗ FAIL'}  [${t.id}]  ${detail}`)
  results.push({ id: t.id, pass, detail })
}

const passed = results.filter((r) => r.pass).length
console.log(`\n── ${passed}/${results.length} 通过 ──`)
writeFileSync(reportPath, JSON.stringify({ ranAt: new Date().toISOString(), passed, total: results.length, results }, null, 2))
console.log(`报告写入 ${reportPath}`)
