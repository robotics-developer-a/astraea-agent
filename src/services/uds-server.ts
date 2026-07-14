// UDS Server — 跨进程通信的 Socket 服务端
// 每个 Astraea 进程启动时创建，用于接收来自其他进程的消息
// macOS/Linux: Unix Domain Socket; Windows: TCP loopback

import { mkdirSync, writeFileSync, unlinkSync, readdirSync, existsSync } from 'fs'
import { homedir, platform } from 'os'
import { join } from 'path'
import { enqueueNotification } from './notification-queue'
import { pushPendingMessage } from './agent-state'
import { restoreTerminal } from '../utils/terminalGuard'

const IS_WIN = platform() === 'win32'

export const SESSION_DIR = join(homedir(), '.astraea', 'sessions')

/** Resolved address — UDS path on Unix, "127.0.0.1:PORT" on Windows */
export let SOCKET_PATH: string

let _listener: { stop(closeActiveConnections?: boolean): void | Promise<void> } | undefined
let _port: number | undefined
const SESSION_FILE = join(SESSION_DIR, `${process.pid}.json`)

let _started = false

export function startUDSServer(): void {
  if (_started) return
  _started = true

  mkdirSync(SESSION_DIR, { recursive: true })

  interface ConnState { buf: string }

  if (IS_WIN) {
    _listener = Bun.listen<ConnState>({
      hostname: '127.0.0.1',
      port: 0,
      socket: {
        open(socket) { socket.data = { buf: '' } },
        data(socket, raw) {
          socket.data.buf += typeof raw === 'string' ? raw : new TextDecoder().decode(raw)
          const lines = socket.data.buf.split('\n')
          socket.data.buf = lines.pop() ?? ''
          for (const line of lines) {
            const trimmed = line.trim()
            if (!trimmed) continue
            try {
              const msg = JSON.parse(trimmed) as { to?: string; message: string }
              handleIncoming(msg)
            } catch {}
          }
        },
        error() {},
      },
    })
    _port = (_listener as any).port as number
    SOCKET_PATH = `127.0.0.1:${_port}`
  } else {
    SOCKET_PATH = `/tmp/astraea-${process.pid}.sock`
    try { unlinkSync(SOCKET_PATH) } catch {}

    _listener = Bun.listen<ConnState>({
      unix: SOCKET_PATH,
      socket: {
        open(socket) { socket.data = { buf: '' } },
        data(socket, raw) {
          socket.data.buf += typeof raw === 'string' ? raw : new TextDecoder().decode(raw)
          const lines = socket.data.buf.split('\n')
          socket.data.buf = lines.pop() ?? ''
          for (const line of lines) {
            const trimmed = line.trim()
            if (!trimmed) continue
            try {
              const msg = JSON.parse(trimmed) as { to?: string; message: string }
              handleIncoming(msg)
            } catch {}
          }
        },
        error() {},
      },
    })
  }

  writeFileSync(SESSION_FILE, JSON.stringify({
    pid: process.pid,
    socket: SOCKET_PATH,
    startedAt: new Date().toISOString(),
  }))

  const cleanup = () => {
    if (!IS_WIN) {
      try { unlinkSync(SOCKET_PATH) } catch {}
    }
    try { unlinkSync(SESSION_FILE) } catch {}
    try { _listener?.stop() } catch {}
  }
  process.on('exit', cleanup)
  // INTENT: This server is embedded in the Ink REPL. Registering a signal listener
  // suppresses the runtime's default terminate-on-signal, so after cleaning up our
  // socket we must restore the terminal (raw mode / cursor) and exit ourselves with
  // the conventional 128+signo code — otherwise `kill` could no longer stop the REPL.
  const onSignal = (code: number) => () => {
    cleanup()
    restoreTerminal()
    process.exit(code)
  }
  process.on('SIGINT', onSignal(130))
  process.on('SIGTERM', onSignal(143))
}

function handleIncoming(msg: { to?: string; message: string }): void {
  if (msg.to?.startsWith('task:')) {
    pushPendingMessage(msg.to.slice(5), msg.message)
  } else {
    enqueueNotification(msg.message)
  }
}

// ─── Peer discovery ──────────────────────────────────────────────────────────

export interface PeerInfo {
  pid: number
  socket: string
  alive: boolean
}

export async function discoverPeers(): Promise<PeerInfo[]> {
  const peers: PeerInfo[] = []

  let files: string[] = []
  try { files = readdirSync(SESSION_DIR).filter(f => f.endsWith('.json')) } catch {}

  for (const file of files) {
    try {
      const data = JSON.parse(await Bun.file(join(SESSION_DIR, file)).text()) as {
        pid: number
        socket: string
      }
      if (data.pid === process.pid) continue

      // OS-level liveness check
      let alive = false
      try { process.kill(data.pid, 0); alive = true } catch {}

      if (!alive) {
        try { unlinkSync(join(SESSION_DIR, file)) } catch {}
        continue
      }

      // App-level socket liveness check
      alive = IS_WIN ? await pingTcp(data.socket) : (existsSync(data.socket) && await pingUds(data.socket))
      peers.push({ pid: data.pid, socket: data.socket, alive })
    } catch {}
  }

  return peers
}

async function pingUds(socketPath: string): Promise<boolean> {
  return new Promise(resolve => {
    const timer = setTimeout(() => resolve(false), 800)
    Bun.connect<{ done: boolean }>({
      unix: socketPath,
      socket: {
        open(s) { s.data = { done: false }; clearTimeout(timer); resolve(true); s.end() },
        data() {},
        close() {},
        error() { clearTimeout(timer); resolve(false) },
      },
    }).catch(() => { clearTimeout(timer); resolve(false) })
  })
}

function splitHostPort(addr: string): { host: string; port: number } {
  const i = addr.lastIndexOf(':')
  if (i === -1) return { host: addr, port: NaN }
  return { host: addr.slice(0, i), port: Number(addr.slice(i + 1)) }
}

async function pingTcp(addr: string): Promise<boolean> {
  const { host, port } = splitHostPort(addr)
  return new Promise(resolve => {
    const timer = setTimeout(() => resolve(false), 800)
    Bun.connect<{ done: boolean }>({
      hostname: host,
      port,
      socket: {
        open(s) { s.data = { done: false }; clearTimeout(timer); resolve(true); s.end() },
        data() {},
        close() {},
        error() { clearTimeout(timer); resolve(false) },
      },
    }).catch(() => { clearTimeout(timer); resolve(false) })
  })
}

// ─── Send to remote socket ──────────────────────────────────────────────

// 发送超时：对端 accept 后不关闭连接时,Promise 此前会永不 resolve,把整个 turn 卡死。
// close 事件是唯一的 resolve 点,所以必须有墙钟兜底 + 调用方 AbortSignal(ESC 可取消)。
const SEND_TIMEOUT_MS = 10_000

export async function sendToSocket(
  socketPath: string,
  to: string | undefined,
  message: string,
  signal?: AbortSignal,
): Promise<void> {
  const frame = JSON.stringify({ to, message }) + '\n'

  if (IS_WIN || socketPath.includes(':')) {
    const { host, port } = splitHostPort(socketPath)
    await tcpSend(host, port, frame, signal)
  } else {
    await udsSend(socketPath, frame, signal)
  }
}

interface SendConnectOptions {
  unix?: string
  hostname?: string
  port?: number
}

// udsSend/tcpSend 共用的带超时发送:open 即写完就 end,等对端 close 才算送达;
// 超时/中止时主动断开连接并 reject,绝不无限等待。
function sendFrame(connectOpts: SendConnectOptions, frame: string, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let settled = false
    let sock: { end(): void } | null = null
    const cleanup = () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
    }
    const finish = (fn: () => void) => {
      if (settled) return
      settled = true
      cleanup()
      fn()
    }
    const dropConnection = () => { try { sock?.end() } catch { /* already closed */ } }
    const timer = setTimeout(() => {
      dropConnection()
      finish(() => reject(new Error(`send timed out after ${SEND_TIMEOUT_MS}ms — peer did not close the connection`)))
    }, SEND_TIMEOUT_MS)
    const onAbort = () => {
      dropConnection()
      finish(() => reject(new Error('send aborted')))
    }
    signal?.addEventListener('abort', onAbort, { once: true })

    Bun.connect<{ sent: boolean }>({
      ...(connectOpts as { unix: string }),
      socket: {
        open(s) { sock = s; s.data = { sent: false }; s.write(frame); s.end(); s.data.sent = true },
        data() {},
        close() { finish(resolve) },
        error(_, err) { finish(() => reject(err)) },
      },
    }).then(s => { sock = s }).catch(err => finish(() => reject(err)))
  })
}

function udsSend(socketPath: string, frame: string, signal?: AbortSignal): Promise<void> {
  return sendFrame({ unix: socketPath }, frame, signal)
}

function tcpSend(host: string, port: number, frame: string, signal?: AbortSignal): Promise<void> {
  return sendFrame({ hostname: host, port }, frame, signal)
}
