import { test, expect, afterEach } from 'bun:test'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, cpSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseGitSource, readInstallManifest, manifestToConfigs, installMcpFromGit } from './install'
import { loadMcpServers } from './config'

const tmps: string[] = []
function tmp(prefix = 'astraea-install-'): string {
  const d = mkdtempSync(join(tmpdir(), prefix))
  tmps.push(d)
  return d
}
afterEach(() => { while (tmps.length) rmSync(tmps.pop()!, { recursive: true, force: true }) })

test('parseGitSource: github shorthand owner/repo → https .git url + name', () => {
  const r = parseGitSource('anxelswanz/hai_mcp')
  expect(r).toEqual({ url: 'https://github.com/anxelswanz/hai_mcp.git', name: 'hai_mcp' })
})

test('parseGitSource: github shorthand with @ref / #ref', () => {
  expect(parseGitSource('anxelswanz/hai_mcp@v1.2')).toEqual({
    url: 'https://github.com/anxelswanz/hai_mcp.git', name: 'hai_mcp', ref: 'v1.2',
  })
  expect(parseGitSource('anxelswanz/hai_mcp#main')).toEqual({
    url: 'https://github.com/anxelswanz/hai_mcp.git', name: 'hai_mcp', ref: 'main',
  })
})

test('parseGitSource: https url passthrough, appends .git', () => {
  expect(parseGitSource('https://github.com/anxelswanz/hai_mcp')).toEqual({
    url: 'https://github.com/anxelswanz/hai_mcp.git', name: 'hai_mcp',
  })
  expect(parseGitSource('https://github.com/anxelswanz/hai_mcp.git#dev')).toEqual({
    url: 'https://github.com/anxelswanz/hai_mcp.git', name: 'hai_mcp', ref: 'dev',
  })
})

test('parseGitSource: git ssh url', () => {
  expect(parseGitSource('git@github.com:anxelswanz/hai_mcp.git')).toEqual({
    url: 'git@github.com:anxelswanz/hai_mcp.git', name: 'hai_mcp',
  })
})

test('parseGitSource: unrecognized → error', () => {
  const r = parseGitSource('not a url')
  expect('error' in r).toBe(true)
})

test('readInstallManifest: absent → null; present → parsed', () => {
  const dir = tmp()
  expect(readInstallManifest(dir)).toBeNull()
  writeFileSync(join(dir, '.astraea-mcp.json'), JSON.stringify({
    name: 'haiq-logs',
    install: 'python3 -m venv .venv',
    mcpServers: { 'haiq-logs': { command: '${MCP_DIR}/.venv/bin/python', args: ['${MCP_DIR}/server.py'] } },
  }))
  const m = readInstallManifest(dir)
  expect(m && 'mcpServers' in m).toBe(true)
})

// 造一个"远端仓库"夹具目录，含 .astraea-mcp.json（供 fake clone 拷贝）。
function fixtureRepo(): string {
  const repo = tmp('astraea-repo-')
  writeFileSync(join(repo, 'server.py'), '# fake mcp server\n')
  writeFileSync(join(repo, '.astraea-mcp.json'), JSON.stringify({
    name: 'haiq-logs',
    install: 'echo installing',
    mcpServers: {
      'haiq-logs': {
        command: '${MCP_DIR}/.venv/bin/python',
        args: ['${MCP_DIR}/server.py'],
        env: { LOG_ROOT: '/haiq_logs' },
      },
    },
  }))
  return repo
}

test('installMcpFromGit: clone → run hook → register resolved stdio config', () => {
  const repo = fixtureRepo()
  const mcpRoot = tmp('astraea-mcproot-')
  const cwd = tmp('astraea-cwd-')
  const hookRuns: Array<{ dir: string; cmd: string }> = []

  const res = installMcpFromGit(
    { source: 'anxelswanz/hai_mcp', scope: 'local', env: { SSH_HOST: '10.0.0.1' }, cwd },
    {
      mcpRoot,
      clone: (_url, target) => { cpSync(repo, target, { recursive: true }) },
      runHook: (dir, cmd) => { hookRuns.push({ dir, cmd }) },
    },
  )

  expect('error' in res).toBe(false)
  // install 钩子在克隆目录里跑过一次
  expect(hookRuns).toEqual([{ dir: join(mcpRoot, 'hai_mcp'), cmd: 'echo installing' }])
  // 代码真的落到了克隆目录
  expect(existsSync(join(mcpRoot, 'hai_mcp', 'server.py'))).toBe(true)
  // 配置已写入 local scope，且 ${MCP_DIR} 展开成绝对路径、env 已并入
  const servers = loadMcpServers(cwd)
  expect(servers).toHaveLength(1)
  const s = servers[0]!
  expect(s.name).toBe('haiq-logs')
  expect(s.transport).toBe('stdio')
  if (s.transport === 'stdio') {
    expect(s.command).toBe(join(mcpRoot, 'hai_mcp', '.venv/bin/python'))
    expect(s.args).toEqual([join(mcpRoot, 'hai_mcp', 'server.py')])
    expect(s.env).toEqual({ LOG_ROOT: '/haiq_logs', SSH_HOST: '10.0.0.1' })
  }
})

test('installMcpFromGit: no manifest + no explicit command → error, nothing registered', () => {
  const repo = tmp('astraea-repo-bare-')
  writeFileSync(join(repo, 'server.py'), '# no manifest\n')
  const mcpRoot = tmp('astraea-mcproot-')
  const cwd = tmp('astraea-cwd-')

  const res = installMcpFromGit(
    { source: 'anxelswanz/hai_mcp', scope: 'local', cwd },
    { mcpRoot, clone: (_u, t) => cpSync(repo, t, { recursive: true }), runHook: () => {} },
  )
  expect('error' in res).toBe(true)
  expect(loadMcpServers(cwd)).toHaveLength(0)
})

test('installMcpFromGit: explicit -- command when no manifest', () => {
  const repo = tmp('astraea-repo-explicit-')
  writeFileSync(join(repo, 'server.py'), '# explicit\n')
  const mcpRoot = tmp('astraea-mcproot-')
  const cwd = tmp('astraea-cwd-')

  const res = installMcpFromGit(
    {
      source: 'anxelswanz/hai_mcp', scope: 'local', cwd,
      name: 'haiq-logs',
      explicit: { command: 'python3', args: ['${MCP_DIR}/server.py'] },
      env: { LOG_ROOT: '/haiq_logs' },
    },
    { mcpRoot, clone: (_u, t) => cpSync(repo, t, { recursive: true }), runHook: () => {} },
  )
  expect('error' in res).toBe(false)
  const servers = loadMcpServers(cwd)
  expect(servers).toHaveLength(1)
  const s = servers[0]!
  if (s.transport === 'stdio') {
    expect(s.command).toBe('python3')
    expect(s.args).toEqual([join(mcpRoot, 'haiq-logs', 'server.py')])
  }
})

test('manifestToConfigs: substitutes ${MCP_DIR} to abs paths + merges env override', () => {
  const cloneDir = '/home/u/.astraea/mcp/hai_mcp'
  const manifest = {
    mcpServers: {
      'haiq-logs': {
        command: '${MCP_DIR}/.venv/bin/python',
        args: ['${MCP_DIR}/server.py'],
        env: { LOG_ROOT: '/haiq_logs' },
      },
    },
  }
  const configs = manifestToConfigs(manifest, cloneDir, 'local', { SSH_HOST: '10.0.0.1' })
  expect(configs).toEqual([{
    name: 'haiq-logs',
    transport: 'stdio',
    command: '/home/u/.astraea/mcp/hai_mcp/.venv/bin/python',
    args: ['/home/u/.astraea/mcp/hai_mcp/server.py'],
    env: { LOG_ROOT: '/haiq_logs', SSH_HOST: '10.0.0.1' },
    scope: 'local',
  }])
})
