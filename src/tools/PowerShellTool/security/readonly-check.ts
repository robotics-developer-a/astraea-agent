// PowerShell 只读命令识别 —— 可靠性审计 PR-3(T8)
//
// 背景:PowerShellTool 此前 isReadOnly 恒为 false,导致 Windows 上的子代理
// (isInteractive=false → fail-closed)连 Get-ChildItem 都被拒,子代理完全不可用。
// 与 Bash 的 readonly-check 同定位:保守白名单,识别不出就当写命令走权限闸,
// 绝不把写操作误判为只读(fail-closed)。

// 只读动词前缀(PowerShell 动词语义:Get/Test/Measure/Resolve/Compare 均无副作用)
const READONLY_CMDLET_PREFIXES = [
  'get-', 'test-', 'measure-', 'resolve-', 'compare-', 'find-',
]

// 只读的具体 cmdlet / 别名 / 外部命令(管道中段常见的纯变换)
const READONLY_COMMANDS = new Set([
  // 常用别名
  'ls', 'dir', 'gci', 'cat', 'gc', 'type', 'pwd', 'gl', 'echo', 'hostname', 'whoami',
  // 纯变换/输出 cmdlet(不落盘)
  'select-object', 'select-string', 'sort-object', 'group-object',
  'format-table', 'format-list', 'format-wide', 'out-string', 'out-host',
  'convertto-json', 'convertfrom-json', 'convertto-csv', 'convertfrom-csv',
  'split-path', 'join-path',
  // 只读别名
  'select', 'sort', 'group', 'ft', 'fl', 'fw', 'sls',
])

/**
 * 保守判定一条 PowerShell 命令是否只读。
 * 拒绝一切复合结构(分号/换行/重定向/子表达式/scriptblock/调用运算符),
 * 然后要求管道每一段的首 token 都命中只读集合。
 */
export function isReadOnlyPowerShellCommand(command: string): boolean {
  const trimmed = command.trim()
  if (!trimmed) return false

  // 复合执行/求值/重定向/scriptblock 一律不算只读:
  //   ; \n  → 多语句     > >> < → 重定向      & . → 调用运算符
  //   $( )  → 子表达式   ` → 转义/续行         { } → scriptblock(Where/ForEach 可执行任意代码)
  if (/[;\r\n><&{}`]/.test(trimmed)) return false
  if (trimmed.includes('$(')) return false

  // 管道每段独立判定
  for (const segment of trimmed.split('|')) {
    const first = segment.trim().split(/\s+/)[0]?.toLowerCase() ?? ''
    if (!first) return false
    const inSet = READONLY_COMMANDS.has(first)
    const hasPrefix = READONLY_CMDLET_PREFIXES.some(p => first.startsWith(p))
    if (!inSet && !hasPrefix) return false
  }

  return true
}
