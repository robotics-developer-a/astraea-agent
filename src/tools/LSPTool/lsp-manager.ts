// LSP 语言服务器管理器
// 参考: astraea-trace-and-build / LSPTool 教学文档
//
// 职责:
//   - 按文件扩展名选择并启动对应的语言服务器进程
//   - 管理 LSP 初始化生命周期（initialize → initialized 握手）
//   - 追踪已打开的文件（textDocument/didOpen）
//   - 提供统一的 sendRequest() 接口给 LSPTool 调用
//
// 设计要点:
//   - 每个工作区目录一个服务器实例（按 rootUri 键控）
//   - 等待初始化完成后才接受业务请求（Initialization Fence 模式）
//   - 文件打开状态追踪，避免重复 didOpen

import { resolve, extname } from 'node:path'
import { existsSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { homedir, platform } from 'node:os'
import { LspClient } from './lsp-client'

const IS_WIN = platform() === 'win32'

export type InitStatus = 'pending' | 'ready' | 'failed'

interface ServerInstance {
  client: LspClient
  status: InitStatus
  readyPromise: Promise<void>
  openFiles: Set<string>  // 已发送 didOpen 的绝对路径集合
}

// INTENT: 语言服务器注册表 — 按文件扩展名映射到启动命令
// 每项: [command, args[], 支持的扩展名[]]
// 优先级从高到低（第一个匹配的服务器被使用）
const SERVER_CONFIGS: Array<{
  extensions: string[]
  command: string
  args: string[]
}> = [
  {
    extensions: ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts'],
    command: 'typescript-language-server',
    args: ['--stdio'],
  },
  {
    extensions: ['.py'],
    command: 'pyright-langserver',
    args: ['--stdio'],
  },
  {
    extensions: ['.py'],
    command: 'pylsp',
    args: [],
  },
  {
    extensions: ['.go'],
    command: 'gopls',
    args: ['serve'],
  },
  {
    extensions: ['.rs'],
    command: 'rust-analyzer',
    args: [],
  },
]

// INTENT: 探测语言服务器是否可执行（在 PATH 或项目 node_modules/.bin 中）
function findExecutable(command: string, projectRoot: string): string | null {
  // Windows 上可执行文件带后缀（.cmd 是 npm 包装脚本，.exe 是原生），逐个探测。
  const localNames = IS_WIN ? [`${command}.cmd`, `${command}.exe`, command] : [command]

  // 1. 项目本地 node_modules/.bin（Bun/npm 安装的）
  for (const name of localNames) {
    const localBin = resolve(projectRoot, 'node_modules', '.bin', name)
    if (existsSync(localBin)) return localBin
  }

  // 2. Bun 全局 bin（用 homedir() 而非 $HOME——Windows 上没有 HOME，家目录是 USERPROFILE）
  const home = homedir()
  for (const name of localNames) {
    const bunBin = resolve(home, '.bun', 'bin', name)
    if (existsSync(bunBin)) return bunBin
  }

  // 3. 系统 PATH：Windows 用 `where`，Unix 用 `which`（`which` 在 Windows 不存在）
  try {
    const { spawnSync } = require('node:child_process') as typeof import('node:child_process')
    const result = spawnSync(IS_WIN ? 'where' : 'which', [command], { encoding: 'utf8' })
    if (result.status === 0 && result.stdout.trim()) {
      // `where` 可能多行命中，取第一行
      return result.stdout.trim().split(/\r?\n/)[0]!.trim()
    }
  } catch { /* ignore */ }

  return null
}

function getServerConfig(filePath: string, projectRoot: string) {
  const ext = extname(filePath).toLowerCase()
  for (const config of SERVER_CONFIGS) {
    if (config.extensions.includes(ext)) {
      const executable = findExecutable(config.command, projectRoot)
      if (executable) {
        return { executable, args: config.args }
      }
    }
  }
  return null
}

class LspManager {
  private servers = new Map<string, ServerInstance>()

  // INTENT: getOrCreate 确保每个项目根目录只有一个服务器实例
  // 多次调用 sendRequest 不会重复启动服务器
  private async getServer(filePath: string, projectRoot: string): Promise<ServerInstance | null> {
    const serverConfig = getServerConfig(filePath, projectRoot)
    if (!serverConfig) return null

    const key = `${serverConfig.executable}::${projectRoot}`

    if (this.servers.has(key)) {
      const instance = this.servers.get(key)!
      // 如果服务器已崩溃，移除并重建
      if (!instance.client.isAlive() && instance.status !== 'pending') {
        this.servers.delete(key)
      } else {
        return instance
      }
    }

    // 启动新的服务器实例
    const client = new LspClient(serverConfig.executable, serverConfig.args, projectRoot)

    let resolveReady!: () => void
    let rejectReady!: (e: Error) => void
    const readyPromise = new Promise<void>((res, rej) => {
      resolveReady = res
      rejectReady = rej
    })

    const instance: ServerInstance = {
      client,
      status: 'pending',
      readyPromise,
      openFiles: new Set(),
    }
    this.servers.set(key, instance)

    // 服务器崩溃时清理
    client.on('exit', () => {
      if (instance.status === 'pending') {
        rejectReady(new Error('Language server exited before initialization'))
        instance.status = 'failed'
      }
    })

    // INTENT: LSP 握手协议 — initialize → initialized
    // 服务器需要先收到 initialize 请求，响应后再收到 initialized 通知才进入就绪状态
    try {
      await client.request('initialize', {
        processId: process.pid,
        clientInfo: { name: 'astraea', version: '1.0.0' },
        rootUri: pathToFileURL(projectRoot).href,
        capabilities: {
          textDocument: {
            synchronization: { didOpen: true, didClose: true, didChange: { syncKind: 1 } },
            definition: { dynamicRegistration: false },
            references: { dynamicRegistration: false },
            hover: { dynamicRegistration: false },
            documentSymbol: { dynamicRegistration: false, hierarchicalDocumentSymbolSupport: true },
            implementation: { dynamicRegistration: false },
            callHierarchy: { dynamicRegistration: false },
          },
          workspace: {
            symbol: { dynamicRegistration: false },
            workspaceFolders: true,
          },
        },
        workspaceFolders: [{ uri: pathToFileURL(projectRoot).href, name: 'workspace' }],
      }, 15_000)

      // 发送 initialized 通知（不等待响应）
      client.notify('initialized', {})

      instance.status = 'ready'
      resolveReady()
    } catch (err) {
      instance.status = 'failed'
      rejectReady(err instanceof Error ? err : new Error(String(err)))
    }

    return instance
  }

  // INTENT: Initialization Fence — 等待服务器初始化完成再处理业务请求
  // 语言服务器启动和索引项目需要 1-10 秒，不能假设立即就绪
  async waitForReady(filePath: string, projectRoot: string): Promise<ServerInstance | null> {
    const instance = await this.getServer(filePath, projectRoot)
    if (!instance) return null

    await instance.readyPromise
    return instance
  }

  async isFileOpen(filePath: string, projectRoot: string): Promise<boolean> {
    const instance = await this.getServer(filePath, projectRoot)
    return instance?.openFiles.has(resolve(filePath)) ?? false
  }

  // INTENT: textDocument/didOpen 前置 — LSP 协议要求先通知服务器文件内容
  // 工具内部自动处理，调用方不需要手动 open 文件
  async openFile(filePath: string, content: string, projectRoot: string): Promise<void> {
    const instance = await this.waitForReady(filePath, projectRoot)
    if (!instance) return

    const absPath = resolve(filePath)
    if (instance.openFiles.has(absPath)) return

    const ext = extname(filePath).toLowerCase()
    const languageId = extToLanguageId(ext)

    instance.client.notify('textDocument/didOpen', {
      textDocument: {
        uri: pathToFileURL(absPath).href,
        languageId,
        version: 1,
        text: content,
      },
    })
    instance.openFiles.add(absPath)
  }

  async sendRequest(
    filePath: string,
    method: string,
    params: unknown,
    projectRoot: string,
  ): Promise<unknown> {
    const instance = await this.waitForReady(filePath, projectRoot)
    if (!instance) return undefined

    return instance.client.request(method, params, 30_000)
  }

  getSupportedExtensions(): string[] {
    return SERVER_CONFIGS.flatMap((c) => c.extensions)
  }
}

function extToLanguageId(ext: string): string {
  const map: Record<string, string> = {
    '.ts': 'typescript', '.tsx': 'typescriptreact',
    '.js': 'javascript', '.jsx': 'javascriptreact',
    '.mjs': 'javascript', '.cjs': 'javascript',
    '.mts': 'typescript', '.cts': 'typescript',
    '.py': 'python', '.go': 'go', '.rs': 'rust',
    '.java': 'java', '.c': 'c', '.cpp': 'cpp',
    '.cs': 'csharp', '.rb': 'ruby', '.php': 'php',
  }
  return map[ext] ?? 'plaintext'
}

// 单例 manager
let _manager: LspManager | null = null

export function getLspManager(): LspManager {
  if (!_manager) _manager = new LspManager()
  return _manager
}
