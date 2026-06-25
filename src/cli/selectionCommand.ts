// `astraea selection …` 子命令 —— floating selection UI 的命令行入口。
//
//   astraea selection            捕获选区 + 弹浮窗面板（没跑就自动后台拉起 bridge）
//   astraea selection open       同上（显式别名，给 macOS 快捷指令绑定用）
//   astraea selection start      前台常驻 bridge 服务（保持终端打开）
//   astraea selection status     查询 bridge 健康状态
//   astraea selection setup      打印 macOS 快捷指令配置说明
//
// 设计要点：绑到快捷指令的 `open` 命令是「自愈」的 —— 打开 UI 前会自动检测并
// 后台拉起服务，所以用户只需绑这一个命令，不必再手动常驻 bridge。

import {
  bridgeUrl,
  isBridgeHealthy,
  stopBridge,
  selectionSetupInstructions,
} from '../services/selection-bridge-client'

export async function runSelectionCommand(argv: string[]): Promise<void> {
  const sub = argv[0]
  switch (sub) {
    case undefined:
    case 'open':
      return cmdOpen()
    case 'start':
    case 'serve':
      return cmdStart()
    case 'stop':
      return cmdStop()
    case 'status':
      return cmdStatus()
    case 'setup':
    case 'help':
      return cmdSetup()
    default:
      console.error(`Unknown subcommand: ${sub}`)
      printUsage()
      process.exit(1)
  }
}

function printUsage(): void {
  console.error('Usage: astraea selection <open|start|stop|status|setup>')
  console.error('  astraea selection [open]   capture selection + show floating panel (auto-starts the bridge)')
  console.error('  astraea selection start    keep the bridge running in the foreground')
  console.error('  astraea selection stop     stop the running bridge service')
  console.error('  astraea selection status   check whether the bridge is reachable')
  console.error('  astraea selection setup    print macOS Shortcuts setup instructions')
}

async function cmdOpen(): Promise<void> {
  const { runOpenCompanion } = await import('../services/open-selection-companion')
  await runOpenCompanion()
}

async function cmdStart(): Promise<void> {
  if (await isBridgeHealthy()) {
    console.error(`[selection] bridge already running at ${bridgeUrl()}`)
    return
  }
  const { assertConfig } = await import('../config')
  const { createLocalSelectionBridge } = await import('../services/local-selection-bridge')
  assertConfig()
  const server = createLocalSelectionBridge()
  console.error(`[selection] bridge listening on http://${server.hostname}:${server.port}`)
  console.error('[selection] keep this process running, or bind the keyboard shortcut to: astraea selection open')
  // Keep the foreground process alive — Bun.serve does not block on its own.
  await new Promise(() => {})
}

async function cmdStop(): Promise<void> {
  const stopped = await stopBridge()
  if (stopped) {
    console.error('[selection] ✓ bridge stopped')
  } else {
    console.error('[selection] bridge was not running')
  }
}

async function cmdStatus(): Promise<void> {
  const healthy = await isBridgeHealthy()
  if (healthy) {
    console.error(`[selection] ✓ bridge healthy at ${bridgeUrl()}`)
  } else {
    console.error(`[selection] ✗ bridge not reachable at ${bridgeUrl()}`)
    console.error('[selection]   start it with: astraea selection start   (or it auto-starts on: astraea selection open)')
    process.exit(1)
  }
}

function cmdSetup(): void {
  console.error(selectionSetupInstructions())
}
