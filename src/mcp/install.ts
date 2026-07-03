// `astraea mcp install <github>` 内核 —— 从 git 仓库拉取 MCP server 代码并注册。
// 参考 claude-code-main/src/utils/plugins/{parseMarketplaceInput,pluginLoader}.ts。
//
// 流程：解析源 → git clone --depth 1 到 ~/.astraea/mcp/<name>/ → 跑仓库自带 install 钩子
//       → 读仓库根 .astraea-mcp.json（CC 兼容 mcpServers，用 ${MCP_DIR} 指向克隆目录）
//       → 用现有 addMcpServer 写 stdio 配置（绝对路径）→ 交给 astraea 现有启动管线。
// 与 claude code 一致：github 简写补 https + .git；支持 #ref / @ref 指定分支或 tag。

import { existsSync, readFileSync, rmSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { execFileSync, execSync } from 'node:child_process'
import type { McpServerConfig, McpScope } from './types'
import { addMcpServer } from './config'
import { mcpInstallRoot } from '../plugins/directories'

/** 仓库根 .astraea-mcp.json 的形态（CC 兼容 mcpServers + 可选 install 钩子）。 */
export interface InstallManifest {
  name?: string
  /** 克隆后在仓库目录里执行一次的 shell 命令（如建 venv 装依赖）。 */
  install?: string
  mcpServers: Record<string, { command: string; args?: string[]; env?: Record<string, string> }>
}

/** 命令/参数/env 里用 ${MCP_DIR} 指代克隆目录绝对路径。 */
export const MCP_DIR_PLACEHOLDER = '${MCP_DIR}'
export const INSTALL_MANIFEST_FILE = '.astraea-mcp.json'

export interface GitSource {
  url: string
  name: string
  ref?: string
}

/** 把用户输入解析成 { 克隆 url, 派生 name, 可选 ref }，无法识别返回 { error }。 */
export function parseGitSource(input: string): GitSource | { error: string } {
  const trimmed = input.trim()
  if (!trimmed) return { error: 'empty source' }

  // ① git SSH：user@host:owner/repo(.git)?(#ref)?
  const ssh = trimmed.match(/^([a-zA-Z0-9._-]+@[^:]+:.+?)(?:\.git)?(?:#(.+))?$/)
  if (ssh && trimmed.includes('@') && trimmed.includes(':') && !trimmed.startsWith('http')) {
    const url = ssh[1]! + '.git'
    return withName({ url, ...(ssh[2] ? { ref: ssh[2] } : {}) })
  }

  // ② http(s) URL
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    const [base, ref] = splitRef(trimmed)
    const url = base.endsWith('.git') ? base : `${base}.git`
    return withName({ url, ...(ref ? { ref } : {}) })
  }

  // ③ github 简写 owner/repo(#ref|@ref)?
  if (/^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+(?:[#@].+)?$/.test(trimmed)) {
    const m = trimmed.match(/^([^#@]+)(?:[#@](.+))?$/)!
    const repo = m[1]!
    const url = `https://github.com/${repo}.git`
    return withName({ url, ...(m[2] ? { ref: m[2] } : {}) })
  }

  return { error: `unrecognized git source: ${input}` }
}

/** 读仓库根的 .astraea-mcp.json；无文件返回 null，非法返回 { error }。 */
export function readInstallManifest(dir: string): InstallManifest | { error: string } | null {
  const path = join(dir, INSTALL_MANIFEST_FILE)
  if (!existsSync(path)) return null
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
    const servers = raw['mcpServers']
    if (!servers || typeof servers !== 'object') {
      return { error: `${INSTALL_MANIFEST_FILE} missing "mcpServers"` }
    }
    return {
      ...(typeof raw['name'] === 'string' ? { name: raw['name'] } : {}),
      ...(typeof raw['install'] === 'string' ? { install: raw['install'] } : {}),
      mcpServers: servers as InstallManifest['mcpServers'],
    }
  } catch (err) {
    return { error: `invalid ${INSTALL_MANIFEST_FILE}: ${String(err)}` }
  }
}

/** 把 ${MCP_DIR} 换成克隆目录绝对路径。 */
function subst(s: string, cloneDir: string): string {
  return s.split(MCP_DIR_PLACEHOLDER).join(cloneDir)
}

/**
 * manifest.mcpServers → McpServerConfig[]：${MCP_DIR} 展开成绝对路径，
 * 合入 -e 传入的 env 覆盖（用户 env 优先于 manifest 里的默认 env）。
 */
export function manifestToConfigs(
  manifest: Pick<InstallManifest, 'mcpServers'>,
  cloneDir: string,
  scope: McpScope,
  envOverride?: Record<string, string>,
): McpServerConfig[] {
  return Object.entries(manifest.mcpServers).map(([name, s]) => {
    const env = { ...(s.env ?? {}), ...(envOverride ?? {}) }
    const substEnv = Object.fromEntries(
      Object.entries(env).map(([k, v]) => [k, subst(String(v), cloneDir)]),
    )
    return {
      name,
      transport: 'stdio' as const,
      command: subst(s.command, cloneDir),
      args: (s.args ?? []).map(a => subst(a, cloneDir)),
      ...(Object.keys(substEnv).length ? { env: substEnv } : {}),
      scope,
    }
  })
}

// ─── 编排：拉取 + 注册 ───────────────────────────────────────────────────────

export interface InstallOptions {
  source: string
  name?: string
  scope?: McpScope
  /** -e 传入的 env 覆盖，并入每个 server 的 env。 */
  env?: Record<string, string>
  /** 无 manifest 时用 `-- <command> <args...>` 显式指定启动命令。 */
  explicit?: { command: string; args: string[] }
  /** 写 scope 文件用的工作目录（默认 process.cwd()）。 */
  cwd?: string
}

export interface InstallDeps {
  /** git clone；默认真·gitClone。测试可注入本地拷贝。 */
  clone?: (url: string, target: string, ref?: string) => void
  /** 执行仓库 install 钩子；默认在克隆目录里跑 shell。 */
  runHook?: (dir: string, cmd: string) => void
  /** 克隆根目录覆盖（默认 mcpInstallRoot()）。 */
  mcpRoot?: string
}

/** git clone --depth 1 [--branch ref]（仿 claude code pluginLoader.gitClone）。 */
export function gitClone(url: string, target: string, ref?: string): void {
  const args = ['clone', '--depth', '1', '--recurse-submodules', '--shallow-submodules']
  if (ref) args.push('--branch', ref)
  args.push(url, target)
  execFileSync('git', args, { stdio: 'inherit' })
}

function defaultRunHook(dir: string, cmd: string): void {
  execSync(cmd, { cwd: dir, stdio: 'inherit' })
}

/**
 * 从 git 拉取一个 MCP server 并注册进 astraea 配置。
 * 步骤：解析源 → 克隆到 <mcpRoot>/<name> → 跑 install 钩子 → 定启动命令
 *       （仓库 .astraea-mcp.json 优先，否则 --explicit）→ addMcpServer 写 stdio 配置。
 */
export function installMcpFromGit(
  opts: InstallOptions,
  deps: InstallDeps = {},
): { installed: string[]; dir: string } | { error: string } {
  const parsed = parseGitSource(opts.source)
  if ('error' in parsed) return parsed

  const name = opts.name || parsed.name
  const scope: McpScope = opts.scope ?? 'local'
  const root = deps.mcpRoot ?? mcpInstallRoot()
  const dir = join(root, name)
  const clone = deps.clone ?? gitClone
  const runHook = deps.runHook ?? defaultRunHook

  // 重装：先清空目标目录，避免残留旧代码
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true })
  mkdirSync(dirname(dir), { recursive: true })

  try {
    clone(parsed.url, dir, parsed.ref)
  } catch (err) {
    return { error: `git clone failed: ${String(err)}` }
  }

  const manifest = readInstallManifest(dir)
  if (manifest && 'error' in manifest) {
    rmSync(dir, { recursive: true, force: true })
    return manifest
  }

  // install 钩子（建 venv / 装依赖等），在克隆目录里执行
  const hook = manifest?.install
  if (hook) {
    try {
      runHook(dir, hook)
    } catch (err) {
      return { error: `install hook failed: ${String(err)}` }
    }
  }

  // 确定要注册的 server 配置
  let configs: McpServerConfig[]
  if (manifest) {
    configs = manifestToConfigs(manifest, dir, scope, opts.env)
  } else if (opts.explicit) {
    configs = [{
      name,
      transport: 'stdio',
      command: opts.explicit.command.split(MCP_DIR_PLACEHOLDER).join(dir),
      args: opts.explicit.args.map(a => a.split(MCP_DIR_PLACEHOLDER).join(dir)),
      ...(opts.env && Object.keys(opts.env).length ? { env: opts.env } : {}),
      scope,
    }]
  } else {
    return {
      error: `no ${INSTALL_MANIFEST_FILE} in repo and no explicit command given. `
        + `Provide launch command: astraea mcp install ${opts.source} --name <n> -- <command> <args...>`,
    }
  }

  const installed: string[] = []
  for (const cfg of configs) {
    try {
      addMcpServer(cfg, opts.cwd)
      installed.push(cfg.name)
    } catch (err) {
      return { error: `register "${cfg.name}" failed: ${String(err)}` }
    }
  }
  return { installed, dir }
}

/** 从 fragment 里切出 #ref。 */
function splitRef(s: string): [string, string | undefined] {
  const hash = s.indexOf('#')
  return hash >= 0 ? [s.slice(0, hash), s.slice(hash + 1)] : [s, undefined]
}

/** 从 url 末段派生 name（去掉 .git）。 */
function withName(src: Omit<GitSource, 'name'>): GitSource {
  const last = src.url.replace(/\.git$/, '').replace(/[/:]$/, '').split(/[/:]/).pop() || 'mcp'
  return { ...src, name: last }
}
