#!/usr/bin/env bun
/**
 * astraea setup wechat — 一次性配置微信读取权限
 * 用法：bun run setup:wechat
 *
 * 自动完成：安装 Python 依赖
 * 需要用户手动完成（macOS 强制）：开启辅助功能 + 屏幕录制权限
 */

const c = {
  green:  (s: string) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  red:    (s: string) => `\x1b[31m${s}\x1b[0m`,
  bold:   (s: string) => `\x1b[1m${s}\x1b[0m`,
  dim:    (s: string) => `\x1b[2m${s}\x1b[0m`,
}

function ok(msg: string)   { console.log(`  ${c.green('✓')} ${msg}`) }
function fail(msg: string) { console.log(`  ${c.red('✗')} ${msg}`) }
function step(msg: string) { console.log(`\n${c.bold(msg)}`) }
function info(msg: string) { console.log(`  ${c.dim(msg)}`) }

function waitEnter(prompt: string): string {
  process.stdout.write(prompt)
  const buf = Buffer.alloc(4)
  require('fs').readSync(0, buf, 0, 4, null)
  return buf.toString().trim()
}

function openSystemSettings(url: string) {
  Bun.spawnSync(['open', url], { stdout: 'inherit', stderr: 'inherit' })
}

// ── Step 1: 自动安装 Python 包 ─────────────────────────────────────────────
async function installPythonPackage(): Promise<boolean> {
  step('Step 1/3  安装 pyobjc（自动）')

  const check = Bun.spawnSync(['python3', '-c', 'import AppKit, Quartz, Vision'], { stderr: 'pipe' })
  if (check.exitCode === 0) {
    ok('pyobjc 已安装，跳过')
    return true
  }

  info('正在安装 pyobjc（macOS 系统框架绑定）…')
  const install = Bun.spawnSync(
    ['pip3', 'install', 'pyobjc', '--quiet'],
    { stdout: 'inherit', stderr: 'inherit' },
  )
  if (install.exitCode !== 0) {
    fail('安装失败，请确认已安装 Python 3.10+：python3 --version')
    return false
  }

  ok('pyobjc 安装完成')
  return true
}

// ── Step 2: 辅助功能权限 ──────────────────────────────────────────────────
async function checkAccessibility(): Promise<boolean> {
  step('Step 2/3  辅助功能（Accessibility）权限')
  info('用于：模拟鼠标点击和键盘输入，导航到目标联系人')
  console.log()
  console.log(`  ${c.yellow('正在打开系统设置…')}`)

  openSystemSettings('x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility')

  console.log()
  console.log(`  请在打开的页面中：`)
  console.log(`  ${c.bold('找到 Terminal → 打开右侧开关')}`)
  console.log(`  （如果列表里没有 Terminal，点左下角 + 手动添加）`)
  console.log()

  const ans = waitEnter('  完成后按 Enter 继续，跳过输入 s > ')
  if (ans.toLowerCase() === 's') {
    console.log(`  ${c.yellow('!')} 跳过，稍后在系统设置中手动开启`)
  } else {
    ok('辅助功能权限已确认')
  }
  return true
}

// ── Step 3: 屏幕录制权限 ──────────────────────────────────────────────────
async function checkScreenRecording(): Promise<boolean> {
  step('Step 3/3  屏幕录制（Screen Recording）权限')
  info('用于：截取微信窗口画面进行 OCR 识别')
  console.log()
  console.log(`  ${c.yellow('正在打开系统设置…')}`)

  openSystemSettings('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture')

  console.log()
  console.log(`  请在打开的页面中：`)
  console.log(`  ${c.bold('找到 Terminal → 打开右侧开关')}`)
  console.log(`  （如果列表里没有 Terminal，点左下角 + 手动添加）`)
  console.log()

  const ans = waitEnter('  完成后按 Enter 继续，跳过输入 s > ')
  if (ans.toLowerCase() === 's') {
    console.log(`  ${c.yellow('!')} 跳过，稍后在系统设置中手动开启`)
  } else {
    ok('屏幕录制权限已确认')
  }
  return true
}

// ── Main ──────────────────────────────────────────────────────────────────
async function main() {
  console.log()
  console.log(c.bold('Astraea — 微信聊天记录读取配置'))
  console.log(c.dim('截图 + OCR 方案，无需 API，本地运行'))
  console.log()
  console.log(`  ${c.dim('Step 1 全自动完成')}`)
  console.log(`  ${c.dim('Step 2-3 需要在系统设置中点两下（macOS 隐私保护，无法绕过）')}`)

  for (const fn of [installPythonPackage, checkAccessibility, checkScreenRecording]) {
    if (!await fn()) {
      console.log()
      console.log(c.red('配置未完成，修复后重新运行：'))
      console.log(c.bold('  bun run setup:wechat'))
      process.exit(1)
    }
  }

  console.log()
  console.log(c.green(c.bold('✓ 配置完成！')))
  console.log()
  console.log('现在可以在 Astraea 中说：')
  console.log(`  ${c.bold('"帮我整理和李嘉俊的微信聊天记录"')}`)
  console.log(`  ${c.bold('"每天晚上 10 点总结今天的微信工作消息"')}`)
  console.log()
}

main().catch(err => {
  console.error(c.red(`\n错误：${err.message ?? err}`))
  process.exit(1)
})
