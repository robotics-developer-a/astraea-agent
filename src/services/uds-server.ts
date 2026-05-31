// UDS Server — 跨进程通信的 Unix Domain Socket 服务端
// 每个 Astraea 进程启动时创建，用于接收来自其他进程的消息

import { mkdirSync, writeFileSync, unlinkSync, readdirSync, existsSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { enqueueNotification } from './notification-queue'
import { pushPendingMessage } from './agent-state'

export const SESSION_DIR = join(homedir(), '.astraea', 'sessions')
export const SOCKET_PATH = `/tmp/astraea-${process.pid}.sock`
const SESSION_FILE = join(SESSION_DIR, `${process.pid}.json`)

let _started = false

export function startUDSServer(): void {
  if (_started) return
  _started = true

  mkdirSync(SESSION_DIR, { recursive: true })
  try { unlinkSync(SOCKET_PATH) } catch {}

  // Per-connection state for line-buffering NDJSON
  interface ConnState { buf: string }

  Bun.listen<ConnState>({
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

  writeFileSync(SESSION_FILE, JSON.stringify({
    pid: process.pid,
    socket: SOCKET_PATH,
    startedAt: new Date().toISOString(),
  }))

  const cleanup = () => {
    try { unlinkSync(SOCKET_PATH) } catch {}
    try { unlinkSync(SESSION_FILE) } catch {}
  }
  process.on('exit', cleanup)
  process.on('SIGINT', () => { cleanup(); process.exit(0) })
  process.on('SIGTERM', () => { cleanup(); process.exit(0) })
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
      alive = existsSync(data.socket) && await pingSocket(data.socket)
      peers.push({ pid: data.pid, socket: data.socket, alive })
    } catch {}
  }

  return peers
}

async function pingSocket(socketPath: string): Promise<boolean> {
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

// ─── Send to remote UDS socket ───────────────────────────────────────────────

export async function sendToSocket(
  socketPath: string,
  to: string | undefined,
  message: string,
): Promise<void> {
  const frame = JSON.stringify({ to, message }) + '\n'
  await new Promise<void>((resolve, reject) => {
    Bun.connect<{ sent: boolean }>({
      unix: socketPath,
      socket: {
        open(s) { s.data = { sent: false }; s.write(frame); s.end(); s.data.sent = true },
        data() {},
        close() { resolve() },
        error(_, err) { reject(err) },
      },
    }).catch(reject)
  })
}
