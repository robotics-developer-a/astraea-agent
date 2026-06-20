#!/usr/bin/env bun
// REPL 入口 — 启动 React Ink 交互式 UI，支持多轮持续对话
// 用法: bun run repl
//      bun run src/repl.tsx

import { render } from 'ink'
import React from 'react'
import { App } from './ui/App'
import { listTools } from './tools/registry'
import { initTitle } from './utils/terminalTitle'

// 管理子命令：`astraea mcp …` / `astraea plugin …`（全局 bin 指向本文件）。
// 在渲染 REPL 之前拦截，跑完即退，不进 Ink UI。
const argv = process.argv.slice(2)
if (argv[0] === 'mcp') {
  const { runMcpCommand } = await import('./cli/mcpCommand')
  await runMcpCommand(argv.slice(1))
  process.exit(0)
}
if (argv[0] === 'plugin') {
  const { runPluginCommand } = await import('./cli/pluginCommand')
  await runPluginCommand(argv.slice(1))
  process.exit(0)
}

// 缺 API Key 不再阻塞启动，也不打印 provider 横幅——照常进 UI，由 App 自动弹 /login 向导
// 引导配置（见 App 的 showLogin 初值）。

// 在 render 之前就把窗口标题设好，消除「挂载前那一瞬终端显示启动命令
// （bun ~/.bun/bin/astraea）」的闪现。App 挂载后的 effect 会再确认一次（幂等）。
initTitle()

// render() 接管终端（raw mode），返回 waitUntilExit() Promise
const { waitUntilExit } = render(<App />)

waitUntilExit()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    process.stderr.write(`Fatal error: ${err instanceof Error ? err.message : String(err)}\n`)
    process.exit(1)
  })
