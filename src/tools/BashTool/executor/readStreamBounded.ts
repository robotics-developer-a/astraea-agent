// 读取子进程管道，但以"进程已退出"为边界 —— 避免被脱离的孙进程占住句柄而永久卡死。
//
// 为什么需要：`new Response(proc.stdout).text()` 会一直读到管道 EOF。当命令启动了常驻
// 子进程（`node server.js &`、PowerShell 的 `Start-Process`、`nohup` 等），那个孙进程会
// 继承 stdout/stderr 的管道句柄；前台 shell 早已退出，但管道因孙进程仍占用而永不 EOF，
// 于是 `.text()` 永不返回、整个工具调用挂死（`proc.kill()` 只杀 shell，救不回来）。
//
// 解法：读取与 `exited` 赛跑。进程退出后只再给一个很短的 grace 窗口把残留缓冲排干，随后
// 主动 cancel reader 放弃句柄返回。我们【不】杀孙进程 —— 用户启动 server 就是要它常驻，
// 这里只是不再为它的管道空等。仍并发读取以避免管道写满导致的经典死锁。

const DEFAULT_GRACE_MS = 200

/**
 * 把流读成文本，但一旦 `exited` 完成 + grace 窗口结束就放弃（即使管道未 EOF）。
 * @param stream   子进程的 stdout / stderr
 * @param exited   `proc.exited`，标志前台进程已结束
 * @param maxBytes 累积上限，超过后停止追加（仍继续排空，防止死锁）
 * @param graceMs  进程退出后排干残留输出的宽限期
 */
export async function readStreamBounded(
  stream: ReadableStream<Uint8Array>,
  exited: Promise<unknown>,
  maxBytes: number,
  graceMs = DEFAULT_GRACE_MS,
): Promise<string> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let out = ''
  let length = 0
  let abandoned = false

  void exited.then(() => {
    const t = setTimeout(() => {
      abandoned = true
      void reader.cancel().catch(() => {})
    }, graceMs)
    // 别因为这个计时器把事件循环钉住
    ;(t as { unref?: () => void }).unref?.()
  })

  try {
    while (!abandoned) {
      const { done, value } = await reader.read()
      if (done) break
      if (length <= maxBytes) {
        out += decoder.decode(value, { stream: true })
        length += value.length
      }
    }
  } catch {
    // reader 被 cancel —— 正常的放弃路径
  }
  return out
}
