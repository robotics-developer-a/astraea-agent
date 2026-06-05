// Pre/PostCompact shell hooks 执行器（设计文档 §5.1/§5.3）。
//
// 契约：用户在 settings.json 配 shell 命令；harness 在压缩前/后执行。
//   PreCompact：stdin 收 {trigger, customInstructions}；stdout 合并进摘要指令。
//   PostCompact：stdin 收 {trigger, summary}；纯副作用，stdout 忽略。
// 原则——非致命：超时 / 报错 / 非零退出一律丢弃输出，压缩照常进行（绝不能被脚本卡死）。

import { getSettings } from '../../settings'

const DEFAULT_TIMEOUT_MS = 10_000

function hookTimeout(): number {
  const t = getSettings().hooks?.timeoutMs
  return Number.isFinite(t) && (t as number) > 0 ? (t as number) : DEFAULT_TIMEOUT_MS
}

// 跑一条 hook 命令：stdin 喂 JSON，捕获 stdout；任何异常都吞掉返回 ''（非致命）。
// 导出以便单测（不依赖 settings）。
export async function runHookCommand(
  cmd: string,
  payload: unknown,
  timeoutMs: number,
): Promise<string> {
  let proc: ReturnType<typeof Bun.spawn>
  try {
    proc = Bun.spawn(['/bin/sh', '-c', cmd], {
      stdin: Buffer.from(JSON.stringify(payload)),
      stdout: 'pipe',
      stderr: 'ignore',
      cwd: process.cwd(),
      env: process.env,
    })
  } catch {
    return '' // spawn 失败 → 非致命
  }

  // 用 race 绑定等待：超时即放弃读取并 best-effort kill，不等 stdout 关闭。
  // （kill 只能杀 sh，孙子进程如 sleep 可能仍占着 stdout，所以超时路径不能 await text()。）
  const readText = new Response(proc.stdout as ReadableStream<Uint8Array>).text().catch(() => '')
  const timeout = new Promise<null>(res => setTimeout(() => res(null), timeoutMs))
  const winner = await Promise.race([readText, timeout])

  if (winner === null) {
    try { proc.kill('SIGKILL') } catch { /* already gone */ }
    void proc.exited.catch(() => {})
    return '' // 超时 → 非致命
  }

  await proc.exited.catch(() => {})
  if (proc.exitCode !== 0) return '' // 非零退出 → 丢弃输出
  return winner
}

function runHook(cmd: string, payload: unknown): Promise<string> {
  return runHookCommand(cmd, payload, hookTimeout())
}

/**
 * 压缩前 hook。返回要合并进摘要指令的文本（hook 的 stdout）；未配置或失败则返回 ''。
 */
export async function runPreCompactHook(
  trigger: 'auto' | 'manual',
  customInstructions: string | undefined,
): Promise<string> {
  const cmd = getSettings().hooks?.preCompact
  if (!cmd?.trim()) return ''
  const out = await runHook(cmd, { trigger, customInstructions: customInstructions ?? '' })
  return out.trim()
}

/**
 * 压缩后 hook。纯副作用（通知 / 同步），stdout 忽略；未配置则直接返回。
 * 有界（受 timeout 限制）地 await，确保副作用执行完成。
 */
export async function runPostCompactHook(
  trigger: 'auto' | 'manual',
  summary: string,
): Promise<void> {
  const cmd = getSettings().hooks?.postCompact
  if (!cmd?.trim()) return
  await runHook(cmd, { trigger, summary })
}
