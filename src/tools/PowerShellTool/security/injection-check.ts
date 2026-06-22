// PowerShell 安全线 — Bash injection-check 的 Windows/PowerShell 对偶。
//
// 设计参照 claude-code-main 的 powershellSecurity.ts + dangerousCmdlets.ts：
//   • Claude Code 把命令喂给 pwsh 的 [Language.Parser]::ParseInput 得到 AST，
//     再跑 24 个 validator——能精确识别别名(iex/iwr/ii)、缩写参数(-e=-EncodedCommand)、
//     替代连字符(en/em-dash、/)、引号/反引号、splatting 等。
//   • 本模块不引入 pwsh-parse 硬依赖（与 Astraea 既有的正则版 Bash 检查保持同构），
//     改用「正则 + 别名表 + 缩写展开 + 连字符归一」尽量逼近其覆盖面。AST 化为后续工作。
//
// 沿用 Claude Code 的三档语义（关键差异：危险命令默认 ask 而非静默放行）：
//   block —— 无合法用途的破坏性操作，永远拒绝（对照 Bash 的 HARD_BLOCK）
//   ask   —— 任意代码执行 / 下载执行 / 持久化 / 提权等，强制用户确认（不可被 allow 规则静默放行）
//   pass  —— 放行，交由权限规则裁决
//
// checkId 段位与 Bash 错开：PowerShell 专用从 100 起，便于日志区分来源。

export type PsBehavior = 'block' | 'ask' | 'pass'

export interface SecurityResult {
  behavior: PsBehavior
  /** 向后兼容：safe === (behavior !== 'block')。旧调用点读 .safe 仍可用。 */
  safe: boolean
  reason?: string
  checkId?: number
}

// ── 连字符归一 ────────────────────────────────────────────────────────
// PowerShell 的 tokenizer(SpecialCharacters.IsDash) 把 en-dash/em-dash/horizontal-bar
// 都当作 `-`；powershell.exe 还接受 `/`。攻击者借此绕过 `-` 匹配。统一并入字符类。
const DASH = '[-\\u2013\\u2014\\u2015]'

/**
 * 生成「长参数任意无歧义前缀」的正则片段。
 * 例如 flag('encodedcommand', 3) 匹配 -enc / -enco / … / -encodedcommand。
 * 对照 Claude Code 的 commandHasArgAbbreviation。
 */
function flag(full: string, min: number): string {
  const alts: string[] = []
  for (let i = min; i <= full.length; i++) alts.push(full.slice(0, i))
  return `${DASH}(?:${alts.join('|')})\\b`
}

const rx = (body: string) => new RegExp(body, 'i')

// ── BLOCK：无合法用途的破坏性操作，永远拒绝 ──────────────────────────
const BLOCK_PATTERNS: Array<{ pattern: RegExp; id: number; msg: string }> = [
  // ID 17（与 Bash 同义）：控制字符（不可见注入，排除 \t \n \r）
  { pattern: /[\x00-\x08\x0b\x0c\x0e-\x1f]/, id: 17, msg: 'control characters' },
  // ID 18（与 Bash 同义）：Unicode 空白伪装（NBSP U+00A0 / EN-EM空格 U+2002-3 /
  //   全角空格 U+3000 / 零宽空格 U+200B / BOM U+FEFF）
  { pattern: /[   ​　﻿]/, id: 18, msg: 'unicode whitespace spoofing' },
  // ID 101：关闭 Defender 实时防护
  { pattern: rx(`Set-MpPreference\\b[^\\n]*${flag('disablerealtimemonitoring', 8)}|Set-MpPreference\\b[^\\n]*-Disable(IOAVProtection|ScriptScanning|BehaviorMonitoring)`), id: 101, msg: 'disabling Microsoft Defender protection' },
  // ID 102：添加 Defender 排除项（恶意软件常用规避）
  { pattern: /Add-MpPreference\b[^\n]*-Exclusion(Path|Process|Extension)/i, id: 102, msg: 'adding a Microsoft Defender exclusion' },
  // ID 103：磁盘销毁
  { pattern: /\b(Format-Volume|Clear-Disk|Initialize-Disk)\b/i, id: 103, msg: 'destructive disk operation' },
  // ID 104：递归强删盘符根目录（Remove-Item C:\ -Recurse -Force / rm 别名）
  { pattern: rx(`\\b(Remove-Item|ri|rm|del|erase|rd|rmdir)\\b[^\\n]*${flag('recurse', 4)}[^\\n]*${flag('force', 2)}[^\\n]*['"]?[a-zA-Z]:[\\\\/]?['"]?(\\s|$)`), id: 104, msg: 'recursive force-delete of a drive root' },
]

// ── ASK：危险但有合法场景，强制确认（不可被 allow 规则静默放行）──────
// 注意：顺序即优先级——更具体的「下载即执行」放在通用 iex/下载之前，报错信息更精准。
const ASK_PATTERNS: Array<{ pattern: RegExp; id: number; msg: string }> = [
  // ID 110：下载即执行链（download cradle）—— 下载器 + iex 同现
  { pattern: rx(`\\b(iwr|curl|wget|Invoke-WebRequest|Invoke-RestMethod|irm)\\b[^\\n]*\\|[^\\n]*\\b(iex|Invoke-Expression)\\b|Net\\.WebClient\\b[^\\n]*\\.DownloadString\\s*\\(`), id: 110, msg: 'downloads and executes remote code (download cradle)' },
  // ID 111：Invoke-Expression / iex —— 等价 eval
  { pattern: /\b(iex|Invoke-Expression)\b/i, id: 111, msg: 'Invoke-Expression executes arbitrary code (eval)' },
  // ID 112：-EncodedCommand / -enc base64 混淆（绕过命令行审计）。min 前缀 -enc
  //   足以无歧义；更短的 -e/-ec 只在嵌套 pwsh 场景出现，已由 ID 113 兜住。
  { pattern: rx(flag('encodedcommand', 3)), id: 112, msg: 'base64 -EncodedCommand obfuscation' },
  // ID 113：嵌套 PowerShell 进程（无法静态分析子进程将执行什么）
  { pattern: /\b(pwsh|powershell)(\.exe)?\b/i, id: 113, msg: 'spawns a nested PowerShell process which cannot be validated' },
  // ID 114：远程下载器（LOLBAS / 下载副作用）
  { pattern: /\b(Invoke-WebRequest|iwr|Invoke-RestMethod|irm|Start-BitsTransfer)\b|\.Download(String|File|Data)\s*\(/i, id: 114, msg: 'downloads remote content' },
  // ID 115：certutil -urlcache / bitsadmin /transfer（经典下载 LOLBAS）
  { pattern: rx(`\\bcertutil(\\.exe)?\\b[^\\n]*[-/]urlcache\\b|\\bbitsadmin(\\.exe)?\\b[^\\n]*/transfer\\b`), id: 115, msg: 'downloads a file via certutil/bitsadmin (LOLBAS)' },
  // ID 116：Add-Type —— 运行期编译并加载 .NET 代码
  { pattern: /\bAdd-Type\b/i, id: 116, msg: 'compiles and loads .NET code (Add-Type)' },
  // ID 117：New-Object —— COM / .NET 对象（WScript.Shell、Net.WebClient 等执行原语）
  { pattern: /\bNew-Object\b/i, id: 117, msg: 'instantiates a COM/.NET object with execution capabilities (New-Object)' },
  // ID 118：Invoke-Item / ii —— 用默认处理器打开文件，可执行任意程序
  { pattern: /\b(Invoke-Item|ii)\b/i, id: 118, msg: 'opens a file with its default handler (Invoke-Item) — RCE on executables' },
  // ID 119：计划任务持久化
  { pattern: rx(`\\b(Register-ScheduledTask|New-ScheduledTask|New-ScheduledTaskAction|Set-ScheduledTask|Register-ScheduledJob)\\b|\\bschtasks(\\.exe)?\\b[^\\n]*[-/](create|change)\\b`), id: 119, msg: 'creates or modifies a scheduled task (persistence)' },
  // ID 120：服务创建持久化
  { pattern: /\bNew-Service\b|\bsc(\.exe)?\b\s+create\b/i, id: 120, msg: 'creates a service (persistence)' },
  // ID 121：注册表持久化 / 直接写注册表
  { pattern: /CurrentVersion\\(Run|RunOnce|RunServices)\b|\breg(\.exe)?\b\s+(add|delete|import)\b/i, id: 121, msg: 'modifies the registry (Run-key persistence / reg.exe)' },
  // ID 122：ForEach-Object -MemberName —— 按字符串名调用方法（Get-Process | % -Member Kill）。
  //   `%` 非单词字符，不能靠 \b，单列。-m 在 ForEach-Object 上无歧义，min 取 1。
  { pattern: rx(`(?:\\bForEach-Object\\b|\\bforeach\\b|%)[^\\n]*${flag('membername', 1)}`), id: 122, msg: 'ForEach-Object -MemberName invokes methods by name (unvalidatable)' },
  // ID 123：Start-Process -Verb RunAs —— UAC 提权。-v 在 Start-Process 上指向 -Verb，min 取 1。
  { pattern: rx(`\\b(Start-Process|saps|start)\\b[^\\n]*${flag('verb', 1)}[^\\n:]*[:\\s]['"\`]*runas`), id: 123, msg: 'requests elevated privileges (Start-Process -Verb RunAs)' },
  // ID 124：ExecutionPolicy 绕过
  { pattern: rx(`${flag('executionpolicy', 2)}\\s+['"\`]*(Bypass|Unrestricted)\\b`), id: 124, msg: 'ExecutionPolicy bypass' },
  // ID 125：隐藏窗口（常见恶意启动器特征）。-w hidden 是高频恶意写法，min 取 1。
  { pattern: rx(`${flag('windowstyle', 1)}\\s+['"\`]*Hidden\\b`), id: 125, msg: 'hidden window' },
  // ID 126：进程/服务终止
  { pattern: /\b(Stop-Process|Stop-Service|spps|spsv|taskkill)\b/i, id: 126, msg: 'process/service termination' },
  // ID 127：别名/变量劫持（Set-Alias 改命令解析、Set-Variable 投毒 $PSDefaultParameterValues）
  { pattern: /\b(Set-Alias|New-Alias|sal|nal|Set-Variable|New-Variable|sv|nv)\b/i, id: 127, msg: 'alias/variable manipulation can hijack future command resolution' },
  // ID 128：WMI/CIM 进程派生（Start-Process 等价物，绕过常规检查）
  { pattern: /\b(Invoke-WmiMethod|iwmi|Invoke-CimMethod)\b/i, id: 128, msg: 'can spawn arbitrary processes via WMI/CIM' },
  // ID 129：模块/脚本加载（.psm1 顶层体即执行；Install/Save 从任意源下载）
  { pattern: /\b(Import-Module|ipmo|Install-Module|Save-Module|Update-Module|Install-Script|Save-Script)\b/i, id: 129, msg: 'loads/installs a module or script which can execute arbitrary code' },
  // ID 130：环境变量篡改
  { pattern: /\$env:\w+\s*=[^=]|\bSet-Item\b[^\n]*env:|\$env:PATH\s*=[^=]/i, id: 130, msg: 'environment variable manipulation' },
  // ID 131：子表达式 $() / 调用运算符 &(...)（隐藏命令执行）
  { pattern: /\$\(|&\s*\(/, id: 131, msg: 'subexpression $() or call operator on a subexpression' },
  // ID 132：停止解析符 --%（其后内容不再被解析/校验）
  { pattern: /--%/, id: 132, msg: 'stop-parsing token (--%) defeats static analysis' },
  // ID 133：递归强制删除（非根目录）
  { pattern: rx(`\\b(Remove-Item|ri|rm|del)\\b[^\\n]*${flag('recurse', 4)}[^\\n]*${flag('force', 2)}`), id: 133, msg: 'recursive force-delete' },
  // ID 134：高危 .NET 类型字面量 / 反射（CLM 白名单外）
  { pattern: /\[\s*(System\.)?(Reflection\.Assembly|Runtime\.InteropServices|Diagnostics\.Process|Net\.Sockets|IO\.Pipes|Runtime\.InteropServices\.Marshal)/i, id: 134, msg: '.NET type access outside the safe (ConstrainedLanguage) allowlist' },
]

export function checkCommandSecurity(command: string): SecurityResult {
  for (const { pattern, id, msg } of BLOCK_PATTERNS) {
    if (pattern.test(command)) return { behavior: 'block', safe: false, reason: msg, checkId: id }
  }
  for (const { pattern, id, msg } of ASK_PATTERNS) {
    if (pattern.test(command)) return { behavior: 'ask', safe: true, reason: msg, checkId: id }
  }
  return { behavior: 'pass', safe: true }
}

// 兼容旧调用点的别名（PowerShellTool/index.ts 原 checkPsSecurity）。
export const checkPowerShellSecurity = checkCommandSecurity
