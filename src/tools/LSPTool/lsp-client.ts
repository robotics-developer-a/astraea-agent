// LSP JSON-RPC over stdio 客户端
// 参考: astraea-trace-and-build / LSPTool 教学文档
//
// LSP 传输协议（Content-Length framing over stdio）:
//   发送: "Content-Length: <N>\r\n\r\n<JSON-RPC-body>"
//   接收: 解析 Content-Length 头，读取对应字节数的 JSON 体
//
// INTENT: 自行实现 framing 协议，不依赖外部 LSP 客户端库，
// 保持零额外依赖，且 Bun 的 spawn API 适合简单 stdio 流操作

import { spawn, type ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'

export interface JsonRpcMessage {
  jsonrpc: '2.0'
  id?: number | string
  method?: string
  params?: unknown
  result?: unknown
  error?: { code: number; message: string; data?: unknown }
}

export class LspClient extends EventEmitter {
  private process: ChildProcess
  private nextId = 1
  private pending = new Map<number | string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()
  private buffer = ''

  constructor(command: string, args: string[], cwd: string) {
    super()
    // INTENT: 直接启动语言服务器进程，通过 stdio 通信
    // 不使用 shell 包装，避免信号处理复杂性
    this.process = spawn(command, args, {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    this.process.stdout!.setEncoding('utf8')
    this.process.stdout!.on('data', (chunk: string) => this._onData(chunk))
    this.process.stderr!.on('data', (chunk: Buffer) => {
      // 语言服务器的 stderr 是调试日志，静默收集
      this.emit('log', chunk.toString())
    })
    this.process.on('exit', (code) => {
      this.emit('exit', code)
      // 拒绝所有待处理请求
      for (const [, { reject }] of this.pending) {
        reject(new Error(`Language server exited with code ${code}`))
      }
      this.pending.clear()
    })
    this.process.on('error', (err) => {
      this.emit('error', err)
      for (const [, { reject }] of this.pending) {
        reject(err)
      }
      this.pending.clear()
    })
  }

  // INTENT: Content-Length framing — LSP 协议规定的 stdio 帧格式
  // 每条 JSON-RPC 消息前必须有 "Content-Length: <N>\r\n\r\n" 头
  private _send(message: JsonRpcMessage): void {
    const body = JSON.stringify(message)
    const header = `Content-Length: ${Buffer.byteLength(body, 'utf8')}\r\n\r\n`
    this.process.stdin!.write(header + body)
  }

  // INTENT: 增量解析 Content-Length 帧
  // stdout 是字节流，单次 data 事件可能包含多条消息或消息的一部分
  private _onData(chunk: string): void {
    this.buffer += chunk

    while (true) {
      // 查找头部结束标志
      const headerEnd = this.buffer.indexOf('\r\n\r\n')
      if (headerEnd < 0) break

      const header = this.buffer.slice(0, headerEnd)
      const match = header.match(/Content-Length:\s*(\d+)/i)
      if (!match) {
        // 非预期格式，丢弃到下一个头部开始
        this.buffer = this.buffer.slice(headerEnd + 4)
        continue
      }

      const contentLength = parseInt(match[1]!, 10)
      const bodyStart = headerEnd + 4

      // 检查是否已收到完整消息体
      if (this.buffer.length < bodyStart + contentLength) break

      const body = this.buffer.slice(bodyStart, bodyStart + contentLength)
      this.buffer = this.buffer.slice(bodyStart + contentLength)

      try {
        const msg = JSON.parse(body) as JsonRpcMessage
        this._handleMessage(msg)
      } catch {
        // JSON 解析失败，跳过这条消息
      }
    }
  }

  private _handleMessage(msg: JsonRpcMessage): void {
    if (msg.id !== undefined && this.pending.has(msg.id)) {
      const { resolve, reject } = this.pending.get(msg.id)!
      this.pending.delete(msg.id)

      if (msg.error) {
        reject(new Error(`LSP error ${msg.error.code}: ${msg.error.message}`))
      } else {
        resolve(msg.result)
      }
    } else if (msg.method) {
      // 服务器发起的通知（如 textDocument/publishDiagnostics）
      this.emit('notification', msg)
    }
  }

  // 发送 JSON-RPC 请求，返回 Promise<result>
  request(method: string, params: unknown, timeoutMs = 30_000): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = this.nextId++
      this.pending.set(id, { resolve, reject })

      const timer = setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id)
          reject(new Error(`LSP request timed out: ${method}`))
        }
      }, timeoutMs)

      // 清理计时器避免内存泄漏
      this.pending.set(id, {
        resolve: (v) => { clearTimeout(timer); resolve(v) },
        reject: (e) => { clearTimeout(timer); reject(e) },
      })

      this._send({ jsonrpc: '2.0', id, method, params })
    })
  }

  // 发送通知（无需响应）
  notify(method: string, params: unknown): void {
    this._send({ jsonrpc: '2.0', method, params })
  }

  isAlive(): boolean {
    return this.process.exitCode === null && !this.process.killed
  }

  kill(): void {
    this.process.kill()
  }
}
