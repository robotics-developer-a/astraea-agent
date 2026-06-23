import { test, expect } from 'bun:test'
import { executeBash } from './shell.js'

// 回归：命令启动脱离的常驻子进程并继承 stdout 管道时，旧实现会死等 EOF 永久卡死。
// 现在应在前台进程退出 + grace 后及时返回，且不杀掉常驻子进程。
test('启动占住 stdout 的后台进程后应及时返回而非卡死', async () => {
  // sleep 5 继承了 stdout 管道并在后台常驻；前台 echo 立即退出。
  const t0 = Date.now()
  const result = await executeBash({
    command: 'sleep 5 & echo started',
    timeout: 60_000, // 远大于 sleep 5：若仍卡死，会等到 sleep 自己结束才返回
  })
  const elapsed = Date.now() - t0

  expect(result.stdout).toContain('started')
  // 不该等到后台 sleep 5 结束（>5s）；exited + grace 后应秒回。
  expect(elapsed).toBeLessThan(3000)
}, 10_000)

test('普通命令的输出与退出码不受影响', async () => {
  const result = await executeBash({ command: 'echo hello && exit 7' })
  expect(result.stdout.trim()).toBe('hello')
  expect(result.exitCode).toBe(7)
})
