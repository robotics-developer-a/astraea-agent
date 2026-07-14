// MCP 工具 → 原生 Tool —— 实现文档 §1.7（会话级动态注册表）。
// 每个 server 的工具包成 Astraea Tool，命名 mcp__<server>__<tool>，call → JSON-RPC tools/call。
// query() 循环不感知 MCP；findTool() 能解析这些工具就够了。

import { buildTool } from '../tools/Tool'
import type { Tool, ToolCallResult, ToolContext } from '../tools/Tool'
import type { ConnectedMcpClient } from './transport'
import { combineSignals } from '../utils/withTimeout'
import { withRetry } from '../utils/retry'

// 单次 MCP 工具调用的墙钟上限。第三方 server 收到 tools/call 后不回包时,
// 此前会无限 await 挂死整个 turn;现在超时/ESC 都会中止请求并回结构化错误。
const MCP_CALL_TIMEOUT_MS = 60_000

// ── 简单熔断器(PR-4,进程内状态,按 server 计)────────────────────────────────
// 连续 N 次传输层失败(异常,不含工具自身的 isError 语义错误)→ 熔断:冷却期内
// 快速失败并提示检查 /mcp,不再让每次调用都干等 60s 超时。冷却期满放行一次探测
// (half-open),成功即复位。
const BREAKER_THRESHOLD = 3
const BREAKER_COOLDOWN_MS = 60_000

interface BreakerState {
  consecutiveFailures: number
  openedAt: number
}

/** 命名空间前缀，避免与内置工具撞名。 */
export function mcpToolName(server: string, tool: string): string {
  return `mcp__${server}__${tool}`
}

/** 把一批已连接 server 的工具全部包成原生 Tool。 */
export function mcpToolsToNativeTools(clients: ConnectedMcpClient[]): Tool[] {
  const out: Tool[] = []
  for (const conn of clients) {
    // 熔断状态按 server 共享(同一 server 的所有工具走同一条传输通道)
    const breaker: BreakerState = { consecutiveFailures: 0, openedAt: 0 }
    for (const def of conn.tools) {
      const annotations = (def as unknown as { annotations?: { readOnlyHint?: boolean } }).annotations
      const readOnly = annotations?.readOnlyHint === true
      out.push(
        buildTool({
          name: mcpToolName(conn.name, def.name),
          description: def.description || `MCP tool ${def.name} from ${conn.name}`,
          inputSchema: def.inputSchema,
          // 无 readOnlyHint 时保守判写（orbit/counsel 下会被框架层拦截）。
          isReadOnly: () => readOnly,
          isConcurrencySafe: () => readOnly,
          async call(input: Record<string, unknown>, ctx: ToolContext): Promise<ToolCallResult> {
            // 熔断检查:冷却期内快速失败;期满放行一次探测(half-open)
            if (breaker.consecutiveFailures >= BREAKER_THRESHOLD) {
              const since = Date.now() - breaker.openedAt
              if (since < BREAKER_COOLDOWN_MS) {
                const waitS = Math.ceil((BREAKER_COOLDOWN_MS - since) / 1000)
                return {
                  output: `MCP server "${conn.name}" is degraded (${breaker.consecutiveFailures} consecutive failures) — call skipped, retry allowed in ${waitS}s. Check the server with /mcp or fix its configuration.`,
                  isError: true,
                }
              }
            }
            const attempt = () => conn.client.callTool(
              { name: def.name, arguments: input },
              undefined,
              // SDK 的 RequestOptions:signal 中止在途请求,timeout 双保险(默认 60s 之外显式声明)
              { signal: combineSignals(ctx.abortSignal, MCP_CALL_TIMEOUT_MS), timeout: MCP_CALL_TIMEOUT_MS },
            )
            try {
              // 只读工具幂等 → 瞬态错误重试一次;写工具可能有副作用,绝不自动重试
              const res = readOnly
                ? await withRetry(attempt, { retries: 1, signal: ctx.abortSignal, label: `MCP ${conn.name}/${def.name}` })
                : await attempt()
              // 传输层成功即复位熔断(res.isError 是工具自身的语义错误,不计入)
              breaker.consecutiveFailures = 0
              return { output: formatMcpResult(res), isError: res.isError === true }
            } catch (err) {
              breaker.consecutiveFailures++
              breaker.openedAt = Date.now()
              const degradedNote = breaker.consecutiveFailures >= BREAKER_THRESHOLD
                ? ` Server marked degraded after ${breaker.consecutiveFailures} consecutive failures — further calls will fast-fail for ${BREAKER_COOLDOWN_MS / 1000}s.`
                : ''
              return { output: `MCP tool error (${conn.name}/${def.name}): ${String(err)}.${degradedNote}`, isError: true }
            }
          },
        }),
      )
    }
  }
  return out
}

/** 把 callTool 的 content 块拍平成字符串。 */
function formatMcpResult(res: unknown): string {
  const content = (res as { content?: unknown }).content
  if (!Array.isArray(content)) return typeof res === 'string' ? res : JSON.stringify(res)
  const parts: string[] = []
  for (const block of content) {
    const b = block as { type?: string; text?: string; resource?: { text?: string; uri?: string } }
    if (b.type === 'text' && typeof b.text === 'string') parts.push(b.text)
    else if (b.type === 'resource' && b.resource?.text) parts.push(b.resource.text)
    else if (b.type === 'resource' && b.resource?.uri) parts.push(`[resource: ${b.resource.uri}]`)
    else parts.push(JSON.stringify(b))
  }
  return parts.join('\n') || '(empty result)'
}
