# Changelog

本文件记录 Astraea 的版本变更，遵循 [Keep a Changelog](https://keepachangelog.com/) 与
[语义化版本 SemVer](https://semver.org/lang/zh-CN/)。

版本号的权威来源是 `package.json` 的 `version` 字段；UI 显示（`src/ui/App.tsx` 的 `VERSION`）
直接读取它，请勿在别处硬编码版本号。

> **1.0.0 发布门槛**（达成后才从 0.x 升到 1.0 并打首个 `git tag v1.0.0`）：

## [0.9.19] - 2026-06-22

### 新增
- **结构化权限审计追踪（DecisionReason）**：此前每个权限决定只是 `'allow'|'ask'|'deny'`
  一个字符串，出安全问题只能翻日志猜「是模式拒的、规则拒的、还是红线降级的」，没有证据链。
  新增 `src/audit/`，给每条 allow/deny 决定打上**结构化原因**，事后可逐条追查。
  - **7 种 DecisionReason type**（1:1 映射代码里的真实决策出口）：`hard-block`（injection-check
    命令层硬拦）、`rule`（config/DEFAULT_RULES 命中，detail 记命中的 pattern）、`redline`
    （敏感路径把 allow 降级为 ask 所致）、`mode`（forge/cruise 放行、orbit deny 兜底）、
    `user`（交互式 y/n/a/d 选择）、`fail-closed`（无人在场 ask→deny）、`memory-exempt`
    （记忆子树写豁免）。
  - **落盘**：独立 `~/.astraea/projects/<cwd>/<sessionId>.audit.jsonl`，与 transcript 并列、
    复用 projectDir、沿用 30 天清理。一行一条 JSON：`ts/sessionId/tool/target/behavior/
    reason{type,detail}/mode/interactive/remember`（target 原文不脱敏，与既有隐私模型一致）。
  - **fire-and-forget**：写审计失败只 stderr 警告，绝不阻塞工具执行。
  - **接入**：`BashTool`（resolveShellPermission + 两处 hard-block 出口）与 `fileWriteGate`
    各自在决策出口构造 reason 汇入单一 `recordDecision()` sink；read-only 短路不入账（避免洪水）。
  - **查询**：新增 `/audit` 命令——默认列本会话决定，`--project` 扩到本项目所有会话，
    `--allow|--deny` 与 `--reason <type>` 过滤；`⟦ok⟧/⟦err⟧` 标记区分放行/拒绝。
  - SOP 见《权限和安全/权限决策审计追踪-DecisionReason与查询SOP.md》；新增 25 条单测。
- **PowerShell / Windows 安全线**：此前 `PowerShellTool` 只有 5 条内联 `BLOCKED_PATTERNS`，
  缺少与 Bash 对等的注入/危险 cmdlet 防线。新增 `PowerShellTool/security/injection-check.ts`，
  **设计参照 Claude Code 的 `powershellSecurity.ts` + `dangerousCmdlets.ts`**（其 24 个
  AST validator）。Claude Code 走 pwsh AST，本模块为与 Astraea 既有正则版 Bash 检查同构、
  且不引入 pwsh-parse 硬依赖，改用「正则 + 别名表 + 缩写展开 + 连字符归一」逼近覆盖面（AST 化为后续工作）。
  - **三档语义**（沿用 Claude Code，关键差异：危险命令默认 `ask` 而非静默放行）：
    - `block` —— 无合法用途的破坏性操作，永远拒绝：控制字符、Unicode 空白伪装、关闭
      Defender 实时防护、Defender 排除项、磁盘销毁、递归强删盘符根目录。
    - `ask` —— 任意代码执行 / 下载执行 / 持久化 / 提权等 **强制用户确认，且不可被 allow
      规则静默放行**：下载即执行链、`Invoke-Expression`、`-EncodedCommand` 混淆、嵌套 pwsh、
      远程下载器（含 certutil/bitsadmin LOLBAS）、`Add-Type`、`New-Object`、`Invoke-Item`、
      计划任务 / 服务 / 注册表持久化、`ForEach-Object -MemberName`、`Start-Process -Verb RunAs`、
      `-ExecutionPolicy Bypass`、隐藏窗口、进程/服务终止、别名/变量劫持、WMI/CIM 进程派生、
      模块加载、环境变量篡改、子表达式 `$()`/调用运算符、停止解析符 `--%`、高危 .NET 反射类型。
    - `pass` —— 放行，交由权限规则裁决。
  - **逼近 AST 的鲁棒性**：别名表（`iex`/`iwr`/`irm`/`ii`/`%`/`saps`…）、参数缩写展开
    （`-e`=`-EncodedCommand`、`-v`=`-Verb`、`-w`=`-WindowStyle`、`-m`=`-MemberName`…）、
    替代连字符归一（en/em-dash、horizontal-bar）。
  - checkId 段位从 100 起，与 Bash 段位错开，便于日志区分来源。
- 接入 `PowerShellTool/index.ts`（替换原 `checkPsSecurity`）：`block` 直接报错并带 `check #NNN`；
  `ask` 即使命中 allow 规则也强制 `confirmWithUser`（危险 cmdlet 永不被静默自动放行，对齐 Claude Code）。
- 同步更新 `redlines.ts` 分层安全注释；新增 56 条单测覆盖三档语义、别名/缩写/连字符及正常命令放行。

## [0.9.17] - 2026-06-21

### 修复
- **任务追踪纪律（长任务防漏做）**：此前整条链路没有任何机制推动模型建/维护 TodoWrite——
  系统提示从不提它、Query 循环无周期提醒，唯一的收尾 nudge 又只在「清单已有未完成项」时触发，
  而清单恒为空 → 永不触发（死结）。结果在 30+ 工具调用的长任务里，模型会丢子任务、偏离最初的
  多部分请求、无计划漂移。两处修复：
  - **系统提示新增 Principle 5 — Plan and track multi-step work**（`taskPhilosophy.ts`）：
    3+ 可分步骤 / 跨多文件 / 长跑任务先用 TodoWrite 列计划，单点小修不做仪式；同时只一个
    in_progress，验证完成即翻 completed，不批量收尾。
  - **Query 循环新增周期提醒**（`query.ts`）：抽出纯函数 `shouldRemindTodo`，连续 10 轮没用过
    TodoWrite（且距上次提醒也已 10 轮）即注入一条 `<system-reminder>` 轻推；解开旧死结，从
    「有未完成项才提醒」改为「该用却没用就提醒」。10 轮阈值本身就是过滤器——简单任务到不了 10
    轮，不会被打扰。对照 Claude Code `TODO_REMINDER_CONFIG`。

## [0.9.18] - 2026-06-21

### 修复
- **/goal 无参回车无反应**：`/goal` 的 slash `enterAction` 原为 `complete`，回车只把输入补成
  `/goal ` 后 return，吞掉了状态展示。改为 `execute`（对齐 `/reason`）——`/goal` 回车即显示当前
  目标状态 + 使用场景提示。
- **/goal 实时使用提示（GoalHint）**：输入 `/goal` 或敲下空格 `/goal ` 起，提示框即时浮在输入框
  上方（不必等回车）；新增 `isComposingGoal` 判定 + `GoalHint` 组件，与 SlashHint 并列。
- **/goal 设定后短暂空白像卡死**：set 时质量门 `assessGoalVerifiability` 是 1~2s 网络调用，原先
  `await` 在「清空输入→开跑」之间，期间无任何输出。改为先即时显示 set 确认并立即开跑（StreamStatus
  的耗时·token·短语状态行随即出现），质量门退为后台并发，模糊时异步补提醒。
- **去掉模式切换 banner**：切换模式不再在 scrollback 里刷 `── switched to X ──` 横幅（渲染处
  `return null`）；当前模式仍由输入框 `ModeInputFrame` 边框标签持续可见。

### 变更
- **/goal 无参状态文本去掉「预设快捷」行**：不再展示 `/goal test · lint · typecheck · build`
  那行（预设功能本身保留可用）。

## [0.9.16] - 2026-06-21

### 修复
- **Bash 输出对模型截断（防上下文爆炸）**：`BashTool.formatResult` 此前把 stdout 原样塞回
  给模型，模型可见侧没有任何字符上限——执行器的 64MB 字节闸只防进程 OOM，那个 `MAX=40` 行
  截断又只作用于终端 UI（`renderResult`）。结果一次 `cat 大文件` / 安装日志 / `find /` /
  大 JSON 就能把几十万 token 灌进上下文，触发 reactive compaction 或 413 溢出，把细粒度上下
  文一刀切毁掉，还烧 token、淹没模型。现新增 `truncateForModel`：stdout 限 30000 字符、
  stderr 限 10000 字符，超限保留**头部 + 尾部**（构建/测试日志的失败摘要常在末尾）、中间挖
  掉并标注省略字符数。对照 Claude Code 的 `maxResultSizeChars: 30000`。

## [0.9.15] - 2026-06-21

### 新增
- **/goal 实时进度面板（GoalPanel）**：目标激活期间常驻输入框上方，一眼可知「现在到
  哪了」——目标条件、第 N 轮进行中 · 已评估 M 轮 · 上限 40、已用时间 · token 消耗、上轮
  judgement。逼近 turn/token 上限时边框与对应行转橙提示。随每秒 `goalTick` 刷新。
- **/goal 使用场景提示**：`/goal` 无参或回看已达成记录时，附通俗版「什么样的目标能用」
  说明——好用（能用命令验证、对错一目了然）vs 别用（靠感觉、说不清算不算完成，易被误判
  或诱发走捷径）。
- **/goal 预设模板**：`/goal test|lint|typecheck|build` 一键展开为自带「出示证据」要求的
  规范、可验证条件，省事且天然把用户推向可验证写法。
- **/goal token 天花板**：`GOAL_MAX_TOKEN_SPEND`（50 万输出 token）作为 turn 上限之外的
  第二维硬闸，防少数 turn 内跑飞的循环烧光成本。
- **/goal 停滞检测**：连续 3 轮 evaluator 给出「实质相同」的理由（去数字归一化后相等）即
  判定卡死，提前交还控制权，而非闷头跑满 40 turn。

### 变更
- **/goal 反「改靶子」审查**：evaluator 新增 ANTI-CHEAT 规则——若 agent 通过注释/删除/skip
  测试、放宽断言、关掉 lint/type 规则、mock 掉被测逻辑或弱化验证命令来「过关」，一律判未
  达成并在理由里点名可疑改动；续跑指令同步明令「只修真问题，不得弱化验证」。堵住目标收敛
  型 agent 的 reward-hacking 系统性漏洞。
- **/goal set 时质量门**（非阻断）：设定非预设目标时先用小快模型判可验证性，模糊则提醒并
  给出含验证命令/期望输出的改写建议，但仍按用户原意继续。
- **goal_exhausted 事件**扩展 `cause`（turns/tokens/stall），UI 按原因显示不同停止文案。

## [0.9.10] - 2026-06-21

### 修复
- **换题即清场 Tasks 面板**：ESC / `/stop` 中断后保留 todo（用户仍能看），但用户一旦
  发起「下一个任务」就把上一个任务残留的 Tasks/todo 抹掉，不再赖在新任务里。实现：
  中断时置 `interruptedRef`，下一次 `runConversation` 起跑时清空所有命名空间的 todo
  （模型若仍需规划会在本轮重发 TodoWrite）。

### 变更
- **工具调用头的 marker ⏺ 恢复上色**：`⏺ WebSearch(…)` 的 `⏺` 与工具名一同按状态色
  上色（作状态锚点），仅括号内参数/计数留白。微调 v0.9.8 里「marker 全部留白」的尺度。

## [0.9.8] - 2026-06-21

### 变更
- **克制上色：颜色只点睛「一个词」，不再铺满整行/整句**。统一三处渲染规则——
  状态行（`■ Error.` / `■ cancelled` / `◌ /stop …`）只把「第一个提醒词」按状态色
  上色，marker 与补充文字留白；工具调用头（`⏺ Read(…)` / `Bash` / 折叠组 `Name ×N`）
  只给「工具名」上红/绿/黄，括号内路径与计数留白；verdict 结论行只给「首句或首词」
  （`完成` / `All done.` / `全部 … 已解决。`）上色，后续路径与补充文字留白。
- **错误回执去冒号**：`■ Error: …` 改为 `■ Error. …`。
- 新增 `splitStatusLine`（`src/ui/theme.ts`）与 `splitVerdictHead`（`src/utils/markdown.ts`）
  两个纯函数承载上述拆分逻辑。

## [0.9.6] - 2026-06-21

### 新增
- **拖文件进 REPL 自动还原绝对路径**（macOS / Linux / Windows）：把文件从访达 /
  资源管理器拖进输入框时，终端会把路径当作一段「粘贴」塞进来。新增
  `src/utils/dragPath.ts` 识别这类粘贴并还原成干净的绝对路径后插入（末尾补空格）：
  去掉 Windows 拖入的双引号包裹、还原 macOS/Linux 的 shell 反斜杠转义（`My\ Photos`
  → `My Photos`）、去掉终端补的首尾空格；用「文件确实存在」(`existsSync`) 作为强信号，
  避免把普通文本误判成路径。含空格的路径自动包单引号；支持一次拖入多个文件（空格连接）。
  接入点在 `App.tsx` 的 `ingestPaste`，识别失败则原样回退到普通粘贴逻辑。思路对齐
  Claude Code 的 `imagePaste`（`removeOuterQuotes` + `stripBackslashEscapes`），泛化到任意文件。

## [0.9.4] - 2026-06-21

### 新增
- **`/rewind` 会话回滚**：对话历史与文件双轨回退。`/rewind` 开方向键选择器（琥珀色，
  区别于 `/resume` 的靛蓝）、`/rewind N` 直接回到第 N 回合之前。回滚窗口内取最早的
  改动前态还原 Write/Edit 改过的文件（当时新建的文件会被删除）。检查点单例做对话长度
  记录 + 文件 copy-on-write 快照；transcript 新增 `rewind` 行类型，`loadSessionMessages`
  改为折叠式重放，正确处理 `compact` 与 `rewind` 标记的任意交错。
  - v1 边界：仅捕获 Write/Edit；Bash 的 `rm`/`mv`/重定向不在范围（需 P3 shadow-git）。
- **Kimi（Moonshot AI）provider**：OpenAI 兼容接入，`PROVIDER=kimi`（或 `moonshot`）启用，
  `/login` 可选。默认 `kimi-k2-0905-preview`、`https://api.moonshot.cn/v1`（海外用
  `KIMI_BASE_URL` 切 `api.moonshot.ai/v1`）。usage 缓存拆分、价目、tracing、transcript 全打通。
- **`/reload-plugins` 热重载**：无需重启即可让新加的 skill / 插件生效——重扫 user/project/plugin
  三来源 skill 目录并清命令表缓存，下一条消息即生效。（插件 MCP server 连接仍需重启）

### 修复
- **skill 资源路径解析**：skill 多为全局安装（`~/.astraea/skills/<name>`），与 cwd 无关，
  Windows 上甚至跨盘符。此前注入 SKILL.md 正文时既不展开 `<SKILL_ROOT>` 占位符、也不告知
  skill 绝对目录，导致模型把 `references/x.md` 等相对资源错按 cwd 解析 → 文件找不到。现于
  `getPrompt()` 展开 `<SKILL_ROOT>` 为绝对路径并在顶部声明 skill 目录，要求相对资源按它解析。

## [0.9.0] - 2026-06-19

首个对外标定版本，纠正长期占位的 `0.1.0`（该值从未随功能更新）。v1.0 的 RC 高度：
设计 ~85% 已实现，但项目仍 private、内部接口仍在演进，故停留在 0.x。

### 已具备
- 40+ 内置工具：文件 / Shell / Web / Task / MCP / 子 agent 协调
- 完整 ReAct 查询循环（多轮流式 + /goal 自驱 Stop-hook）
- 多 Provider：Anthropic / OpenAI / DeepSeek / Ollama + 自适应重试
- 四层上下文压缩：snipping / microcompact / eclipse 折叠 / autocompact
- 文件级持久记忆系统：抽取 / 召回 / 注入
- 5 模式 × 行为权限矩阵 + 红线 + AI 命令分类器
- Skills / Plugins(本地市场) / MCP(stdio·http·sse) 三套体系
- Phoenix 可观测性（span 生命周期 + 离线 eval）
- 196 个测试文件
