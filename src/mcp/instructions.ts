// MCP 服务器指令注入
// 参考 claude-code-main/src/constants/prompts.ts:583 · getMcpInstructions()
//
// 设计要点：
// - 同步函数：从内存快照读取，不触发网络 I/O
// - 截断保护：每个服务器的 instructions 限制在 4000 字符内
// - 静默跳过 pending/failed 状态的服务器（不把不可用服务器暴露给模型）
// - 调用方需将此 section 标记为 uncachedSection（DANGEROUS_UNCACHED）

import type { MCPServerConnection, ConnectedMCPServer } from './types'

export type { MCPServerConnection, ConnectedMCPServer }

const MAX_INSTRUCTIONS_CHARS = 4000

export function getMcpInstructions(
  clients: readonly MCPServerConnection[],
): string | null {
  const blocks: string[] = []

  for (const client of clients) {
    if (client.type !== 'connected') continue
    if (!client.instructions?.trim()) continue

    const raw = client.instructions
    const safe =
      raw.length > MAX_INSTRUCTIONS_CHARS
        ? raw.slice(0, MAX_INSTRUCTIONS_CHARS) + '\n[...truncated]'
        : raw

    blocks.push(`## ${client.name}\n${safe}`)
  }

  return blocks.length > 0 ? blocks.join('\n\n') : null
}

// McpConnectionManager 管理 MCP 服务器连接的完整生命周期。
// 使用 AbortController 模式确保断开时精确清理监听器，防止泄漏。
export class McpConnectionManager {
  private readonly clients = new Map<string, MCPServerConnection>()
  private readonly cleanupFns = new Map<string, () => void>()

  async connect(config: {
    name: string
    command: string
    args: string[]
  }): Promise<void> {
    this.clients.set(config.name, { type: 'pending', name: config.name })

    const controller = new AbortController()

    try {
      const transport = await spawnMcpTransport(config, controller.signal)
      const capabilities = await transport.initialize()

      this.clients.set(config.name, {
        type: 'connected',
        name: config.name,
        instructions: capabilities.instructions,
        tools: capabilities.tools,
      })

      transport.onDisconnect(() => {
        if (!controller.signal.aborted) {
          // 服务器断开但未被主动清理：标记为不可用，getMcpInstructions 会跳过它
          this.clients.set(config.name, { type: 'failed', name: config.name, error: 'disconnected' })
        }
      })

      this.cleanupFns.set(config.name, () => {
        controller.abort()
        transport.close()
        this.clients.delete(config.name)
        this.cleanupFns.delete(config.name)
      })
    } catch (error) {
      this.clients.set(config.name, {
        type: 'failed',
        name: config.name,
        error: String(error),
      })
    }
  }

  getClients(): readonly MCPServerConnection[] {
    return Object.freeze([...this.clients.values()])
  }

  disconnect(name: string): void {
    this.cleanupFns.get(name)?.()
  }

  disconnectAll(): void {
    for (const cleanup of this.cleanupFns.values()) cleanup()
  }
}

// ─── Stub：由真实 MCP 传输层替换 ────────────────────────────────────────────
async function spawnMcpTransport(
  _config: { command: string; args: string[] },
  _signal: AbortSignal,
): Promise<{
  initialize: () => Promise<{ instructions?: string; tools: import('./types').MCPTool[] }>
  onDisconnect: (fn: () => void) => void
  close: () => void
}> {
  throw new Error('spawnMcpTransport: not implemented — replace with real MCP transport')
}
