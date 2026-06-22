// 只读命令识别 — 文档 §4"读写权限自动识别"
// 只读命令无需用户确认，直接放行

// 基础只读命令集（不带危险 flag 时）
const READONLY_COMMANDS = new Set([
  // 文件查看
  'cat', 'less', 'more', 'head', 'tail', 'bat',
  // 目录列举
  'ls', 'la', 'dir', 'tree', 'du', 'fd',
  // 文本处理（只读模式）
  'grep', 'egrep', 'fgrep', 'rg', 'ag',
  'cut', 'sort', 'uniq', 'wc', 'tr',
  // 系统信息
  'ps', 'pstree', 'top', 'htop', 'df', 'free',
  'lsof', 'netstat', 'ss', 'ip', 'ifconfig',
  'uname', 'hostname', 'uptime', 'who', 'w',
  // 工具
  'echo', 'printf', 'pwd', 'date', 'cal',
  'which', 'whereis', 'type',
  'printenv',
  // JSON/文本处理（无文件写入）
  'jq', 'yq', 'xmllint',
  // 纯 DNS / 网络状态查询；HTTP 工具可上传本地数据，不属于只读。
  'dig', 'nslookup', 'ping', 'traceroute',
  // 代码搜索
  'ripgrep', 'ack',
  // 帮助
  'man', 'help', 'info',
  // 其他
  'file', 'stat', 'md5sum', 'sha256sum', 'xxd', 'od',
  'diff', 'cmp', 'comm',
])

// git 的只读子命令
const GIT_READONLY_SUBCOMMANDS = new Set([
  'log', 'diff', 'show', 'status', 'branch', 'tag',
  'ls-files', 'ls-tree', 'describe',
  'shortlog', 'rev-parse', 'cat-file', 'blame',
  'config --list', 'config --get',
])

// 会写入文件的危险 flag（这些 flag 让只读命令变成写入命令）
const WRITE_FLAGS = new Set([
  '-i',          // sed -i, perl -i（原地修改）
  '--in-place',
  '-o',          // grep -o, curl -o
  '--output',
  '-O',          // wget -O, curl -O
  '--write-out', // curl --write-out（写文件）
  '-f',          // jq -f（加载外部脚本）
  '--from-file',
  '--exec',      // find --exec
  '-exec',
])

// 检查 flag 列表中是否有写入 flag
function hasWriteFlag(args: string[]): boolean {
  return args.some((arg) => {
    if (WRITE_FLAGS.has(arg)) return true
    // 处理 --output=file 形式
    if (arg.startsWith('--output=') || arg.startsWith('-o=')) return true
    return false
  })
}

export function isReadOnlyCommand(command: string): boolean {
  const trimmed = command.trim()

  // 拒绝复合执行和 shell 求值：基础命令即使只读，子命令也可以写入或外传数据。
  if (/[|>&;\r\n]/.test(trimmed) || /\$\(|`|<\(|>\(/.test(trimmed)) return false

  const parts = trimmed.split(/\s+/)
  const cmd = parts[0] ?? ''
  const args = parts.slice(1)

  // git 特殊处理
  if (cmd === 'git') {
    const subCmd = args[0] ?? ''
    if (!GIT_READONLY_SUBCOMMANDS.has(subCmd)) return false
    return !hasWriteFlag(args.slice(1))
  }

  // bun / node / python 等运行时命令一律不算只读
  const RUNTIMES = new Set(['node', 'bun', 'python', 'python3', 'ruby', 'perl', 'php', 'go', 'cargo', 'make', 'cmake'])
  if (RUNTIMES.has(cmd)) return false

  // sed -i 是写操作
  if (cmd === 'sed' && (args.includes('-i') || args.some((a) => a.startsWith('-i')))) return false

  if (!READONLY_COMMANDS.has(cmd)) return false

  return !hasWriteFlag(args)
}
