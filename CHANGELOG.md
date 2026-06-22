# Changelog

本文件记录 Astraea 的版本变更，遵循 [Keep a Changelog](https://keepachangelog.com/) 与
[语义化版本 SemVer](https://semver.org/lang/zh-CN/)。

版本号的权威来源是 `package.json` 的 `version` 字段；UI 显示（`src/ui/App.tsx` 的 `VERSION`）
直接读取它，请勿在别处硬编码版本号。

> **1.0.0 发布门槛**（达成后才从 0.x 升到 1.0 并打首个 `git tag v1.0.0`）：

## [0.9.32] - 2026-06-23

### 新增
- **任务完成终端通知（Dock 弹跳 / 任务栏闪 / 通知中心横幅）**：参考 claude-code 的 notifier，
  本轮任务干净收尾或报错时向真终端 `/dev/tty` 写一声响铃 `BEL`(\x07) 外加各家终端的原生富通知
  OSC，提示用户「去看一眼」。机制天然不打扰——macOS 只在终端**不在前台**时才把 Dock 图标点亮成
  红色角标「1」，Windows Terminal 也只在后台闪任务栏；用户正盯着看时几乎无感。
  - `auto` 通道按终端自动选：iTerm2/WezTerm→OSC 9、kitty→OSC 99、ghostty→OSC 777、
    Apple Terminal 及其余→纯响铃 `BEL`；Windows 统一走 `BEL`。
  - tmux/screen 下 OSC 富通知用 DCS 包裹透传，但 `BEL` 保持裸写（触发 tmux 的 bell-action）。
  - 可在 `~/.astraea/settings.json` 配 `notify`：`enabled`(默认 true) / `channel`(默认 auto) /
    `minDurationMs`(仅当本轮耗时 ≥ 此值才响，默认 0) / `sound`(富通知是否额外补一声响铃，默认 false)。
  - 新增 `src/utils/terminalNotify.ts`（复用 `terminalTitle.ts` 的 `/dev/tty` 直写基建）与
    单测 `terminalNotify.test.ts`。

## [0.9.31] - 2026-06-23

### 修复
- **粘贴多行/中文导致输入框错行、光标卡死**：未开 bracketed-paste 的终端（部分 macOS 终端）
  会把整段粘贴当作一次 `useInput` 事件、`input` 里直接带换行送来，绕过了 `usePaste` 的折叠通道，
  裸 `\n` + 宽字符落进缓冲区——Ink 按列宽换行、伪光标按码点定位，两套坐标对不上，重绘错行、
  光标看着无法右移。现在 `TextInput` 在按键插入分支识别「像粘贴」的 chunk（含换行或超长），
  改走 `handlePaste` → `transformPaste` 折叠成 `[Pasted text]` 占位符再插到光标处；无
  `transformPaste` 的字段（`/login`、`/internet` 的 Key 框）则把换行折成空格，确保单行输入框
  里永不出现裸 `\n`。

## [0.9.30] - 2026-06-23

### 优化
- **意图行提权（开工前先出声）**：系统提示 `voiceTone` 段把“工具调用前先输出一句意图行”从深埋的
  `Acting out loud` 子条目提为顶层高优先小节 `Open with intent`，并把“用户看不到工具调用、
  沉默=卡死”的因果理由抬到显眼位置。同时消除与“conclusion first / do not emit text”的冲突——
  意图行在每个工具轮强制、永不算“不适用”。修复 Astraea 收到任务后直接 grep/glob 不出声、
  读起来像卡死的问题。仍不输出“收到/明白/我现在开始”类问候：那一句陈述目标，而非确认收到。

## [0.9.29] - 2026-06-22

### 优化
- **Recent updates 缩短**：v0.9.28 更新消息精简，英文从 21 词缩至 15 词，其余五语同步缩短。
- **命令高亮泛化**：WelcomePanel 中所有 `/command` 引用自动染琥珀黄（之前仅 `/login` 有高亮），
  对齐系统提示全部命令高亮的规范。

## [0.9.28] - 2026-06-22

### 新增
- **模糊任务自动进入 Counsel**：在原有长任务检测之上，识别“把 UI 设计得美观一些”、
  “优化一下这个页面”等缺少可验收目标的请求，自动切入先问后做的 Counsel 双闸流程；
  信息查询和目标具体的修复任务不误触发。
- **/goal 动态任务图与逐步验收（Task Graph）**：TaskCreate / TaskUpdate 支持声明依赖、
  验收标准（acceptanceCriteria）和带来源的证据（evidence）。上游失败或证据失效时，
  只沿依赖边传播 `invalidated`，独立任务不受影响。添加 `blocked` / `invalidated` 状态，
  循环依赖就地拒绝、验收标准更改时清空旧证据。
- **证据与目标双轨验收**：每步的证据包含 criterionId、claim、source、confidence、
  assumptions 五项——完成闸门逐条检查，缺失则保持原状态并返回原因。
  `/goal` 负责整体终验，Task Graph 负责逐步验收。

### 安全
- **Shell 只读分类收紧**：`curl` / `wget` / `find` / `awk` / `env` / `command` / `git fetch` /
  `git stash` 及命令替换不再绕过权限确认，阻止本地文件外传和隐式写入。
- **项目与插件 MCP 不再静默自启动**：避免打开不可信仓库时直接执行 `.mcp.json`
  里的 stdio 命令。明确信任时可设置 `ASTRAEA_TRUST_PROJECT_MCP=1`。
- **凭据改为全局私有存储**：`/login` 不再把 Provider Key 写入项目 `.env`，改写
  `~/.astraea/.env`；secrets、MCP 本地配置、权限配置、transcript、审计日志和调度任务
  统一强制 `0600`。
- **网络与外部动作防护**：WebFetch 在初始请求和每次重定向前拒绝回环、私网、
  link-local 与云元数据 IP；WebBrowser `click` / `type` 改为外部副作用，非 Forge 需一次性
  确认，无人值守时 fail-closed。
- **路径与审计防护**：写入红线检查会沿现存父目录解析 symlink，防止通过普通别名修改
  `.git` / `.astraea` / shell 启动文件；审计落盘前脱敏 API Key、Bearer 与 token 参数。

### 测试
- 新增模糊任务判定、Shell 外传/隐式写入、MCP 启动信任、secrets 文件权限、
  SSRF 私网拦截、浏览器副作用、symlink 红线和审计脱敏回归覆盖。

## [0.9.27] - 2026-06-22

### 新增
- **REPL Welcome 新增 Recent updates**：每次进入 REPL 时，在 Welcome 卡片内部展示开发者精选的
  本地更新通知。记录包含所属版本、数字优先级和 `persistent` 生命周期；当前版本消息与跨版本重要
  消息合并后按优先级降序展示，优先级字段不暴露给用户。首条持续通知提醒 DeepSeek 模型已迁移到
  V4 Flash / Pro，并引导用户运行 `/login` 重新登录。
- **更新通知支持全部六种界面语言**：English、Deutsch、Français、Español、中文、한국어 均提供
  标题与正文；没有有效通知时整块隐藏。

### 测试
- 新增更新数据契约与 Welcome UI 验收：覆盖六语言完整性、跨版本持续展示、优先级排序、开发者维护
  的最多三条约束，以及 40 / 58 / 100 列终端下的边框闭合与自然换行。

## [0.9.26] - 2026-06-22

### 新增
- **DeepSeek V4 适配（原生 thinking 旋钮）**：DeepSeek V4 取消了独立的 `reasoner` 模型 id，改为
  同一 model 通过 `thinking.type`（`enabled`/`disabled`）开关思考、`reasoning_effort`（`high`/`max`）
  调推理深度，CoT 仍走独立 `reasoning_content`（不占 `max_tokens` 预算）。`reasoningEffort.ts` 新增
  三个纯函数 + 共用解析：
  - `deepseekIsV4(model)` — 是否 `deepseek-v4-*`，决定走 thinking 参数还是旧的换模型逻辑。
  - `deepseekResolveModel(effort, configured)` — 本次请求实际 model id，UI 显示与 API 调用共用同一解析。
    V4 下 `high`/`max` 自动升 `deepseek-v4-pro`，其余保持 configured；旧别名沿用 `medium+ → deepseek-reasoner`。
  - `deepseekThinkingParam(effort)` — V4 思考控制参数（`auto`/`low` 关思考；`medium`/`high` 开+`high`；`max` 开+`max`）。
- **默认模型切到 `deepseek-v4-flash`**：便宜快（$0.14/$0.28 per MTok）、1M 上下文。`/reason` 的 `medium`
  在当前模型开思考，`high`/`max` 自动升 `deepseek-v4-pro`（$0.435/$0.87、深度推理）。
- **定价登记 V4**：`deepseek-v4-flash` / `deepseek-v4-pro` 加入 `pricing.ts`，cache-hit 倍率极低、无写入费。
- **LoginWizard 模型选单**新增 V4 flash/pro 两项，旧别名 `deepseek-chat`/`deepseek-reasoner` 标注「2026-07-24 下线」。

### 变更
- **品牌色集中到 `theme.ts`**：此前 `INDIGO`/`SILVER`/`AMBER`/`DEEP` 散落在 14+ 组件各自 `const … = …`，
  已出现色偏（`QuestionPanel` 误用 `#7C6FF0`、两处 amber 取值不一）。统一为 `theme.ts` 唯一真相源，
  各组件改为 `import { … } from './theme'`，改一处即可全局换肤。
- DeepSeek 默认上下文窗口 128K → 1M（`DEEPSEEK_CONTEXT_WINDOW` 仍可覆盖）。
- `ReasonSelector` 的 DeepSeek 提示语改为 V4 行为：`medium → enables V4 thinking`，`high`/`max` 追加「upgrades to deepseek-v4-pro」。
- 旧别名 `deepseek-chat`/`deepseek-reasoner` 在 2026-07-24 前经 `DEEPSEEK_MODEL` 仍可用，走向后兼容路径（保留 `deepseekEffectiveModel` / `deepseekReasoningDirective`）。

## [0.9.25] - 2026-06-22

### 新增
- **流式空闲看门狗（Stream Idle Watchdog）+ 非流式 fallback**：SDK 的请求超时只覆盖初始
  `fetch()`，不覆盖流式 body——一旦中转代理把连接悄悄掐断（半开连接），裸 `for await` 会无限
  挂起，headless / `-p` 模式下无人按 ESC 即永久卡死。新增 `src/api/idleWatchdog.ts`：在每个
  chunk 之间起 `setTimeout`，超过 `ASTRAEA_STREAM_IDLE_TIMEOUT_MS`（默认 90s）没收到新事件即
  主动 abort 流式请求，并用同参数非流式重试一次（`messages.create` / `chat.completions.create`
  `stream:false`），把整条响应映射成等价 `StreamEvent`。覆盖全部 5 个 provider（anthropic /
  openai / deepseek / kimi / ollama）。
  - 关键语义：外部 ESC 与看门狗超时都能 abort SDK 流，但**只有看门狗超时路径触发 fallback**；
    外部 abort 仍走 `query.ts` 既有 `AbortError` 分支，不进 fallback。
  - 各适配器统一拆成 `streamRaw*`（内层真实流式）+ `fallback*`（非流式兜底），共用同一份请求参数。
  - `src/config.ts` 新增 `streamIdleTimeoutMs`（`ASTRAEA_STREAM_IDLE_TIMEOUT_MS` 覆盖，默认 90000）。

## [0.9.24] - 2026-06-22

### 修复 / 改进
- **修复 Vigil 一次性/周期任务确认点 Yes 仍被取消**：`VigilOnceTool` / `VigilScheduleTool`
  此前对 `askOne()` 回传值整串做 `startsWith('y')` 判定。但确认面板经 `formatAnswers()`
  返回的是 `"[header] <question>\n→ <选项 label>"` 整段多行文本，以 `[` 开头，永远不以
  `y` 开头——导致无论点 Yes 还是 No 都落进取消分支（模型转述为「已取消调度」），任务从未真正
  调度。改为只取 `→` 之后的实选项再判定（与 `ExitOrbitModeTool` 既有做法一致）。

## [0.9.23] - 2026-06-22

### 修复 / 改进
- **清理 `/language` 残留的 Language 系统提示段**：`getSystemPrompt()` 此前接受 `language`
  参数并往动态段里注入一条 "Always respond in {language}" 指令。实测模型已能准确匹配用户输入
  语言回复，无需额外指令干预；撤掉后系统提示减少 ~20 行变易段，缓存前缀稍收缩。
- **移除 App.tsx 无用的 `replyLanguageName()` 调用**：该函数仍在 `titleSummary.ts` 使用，
  App 这边调用它的结果却从未用过（`language` 参数不再传），删除残余调用。
- **voiceTone 措辞微调**：`Pick the language` → `Always respond in the language`，直指行为。
- **`.gitignore` 排除 Cursor 框架文件**：`.agents/`、`.codex/`、`AGENTS.md` 含 API key 等
  敏感配置，防止误提交。

## [0.9.22] - 2026-06-22

### 修复 / 改进
- **`/audit` 改为带框彩色表格 + mode 列 + 分页（解决"显示不全"）**：原 `/audit` 输出走
  markdown 渲染，`mode` / `reason.detail` 从不展示、target 被**硬截 60 字符**、`⟦ok⟧/⟦err⟧`
  标记因不在段首而**不上色**。现新增 `LocalCommandResult` 的 `'preformatted'` 类型（逐行原样
  透传、绕开 markdown，由 App.tsx 的 `preformatted` 历史角色逐行渲染、ANSI 保真），`/audit`
  改输出**盒线表格**：列含 Time / Result(绿/红上色) / Tool / Reason / **Mode** / Target，整表
  宽度自适应终端、target 按余量省略号截断（不再硬截）。新增分页：默认只铺最近 30 条，
  `--all` 铺全部、`--limit N` 自定义，超出时标题提示 "showing last N, use /audit --all"。
- **流式输出时 REPL 不再"跳到最顶"——live frame 高度封顶在视口内**：Astraea 边出 token
  边重绘的「进行中」帧，一旦比终端还高，Ink 的逐行擦除会越界、把 `<Static>` 已落地内容
  顶飞、视口猛跳到缓冲区最顶（用户往回滚时尤其明显）。现给页脚预留 `FOOTER_RESERVE` 行后，
  把「流式预览 + 在途工具批」总高压在剩余预算内：工具批只渲染最近若干次调用（更早的本轮
  结束统一落进 `<Static>`，用一行 `⋯ N earlier tool calls above` 占位，不丢信息），预览在有
  工具批时相应收窄。帧高不超过视口 → 不再越界擦除 → 回滚时可自由滑动。

## [0.9.21] - 2026-06-22

### 修复 / 改进
- **文件写「本会话全允许」接通 cruise 模式（对齐 Claude Code 的 acceptEdits）**：此前
  FileWrite/FileEdit 的确认框沿用 Bash 的四选项（Yes / No / Always allow / Always deny），
  但 `fileWriteGate` 只读 `confirm.proceed`、**完全无视 `confirm.remember`**，导致 "Always
  allow / deny" 是**死选项**——选了不持久化、也不改任何行为。根因比"漏读字段"更深：Claude
  Code 对文件写**根本不提供跨 session 持久化**，它的 "Yes, allow all edits this session" 本质
  是 `setMode('acceptEdits')`（纯会话内存），而 cruise 正是 Astraea 对 acceptEdits 的命名。
  - **确认框按来源分流**：`ConfirmRequest` 新增 `kind`（`'bash' | 'file'`）。文件写改用专属
    三选项 **Yes / Yes, all edits (cruise) / No**，去掉无落盘机制对应的 Always allow/deny；
    Bash/PowerShell 仍是原四选项。
  - **选「本会话全允许」→ 切 cruise**：`ConfirmResult.remember` 新增 `'session-cruise'`；
    `fileWriteGate` 命中后 `setMode('cruise')`（会话内存，不落盘 per-file 规则）。即便当前是
    红线敏感路径也可安全切——cruise 下普通写自动放行，但敏感写仍被红线降级为 ask 再次询问，
    切 cruise 不会绕过红线。
  - **可见反馈**：切换后 App 落一条 `cruise` 模式横幅 + 同步状态行，明确告知用户模式已切换；
    `setMode` 由 gate 统一负责（兼顾无 UI 的 readline 回退路径），UI 仅做展示，避免抢在审计
    判定前改写 `getMode()`。
  - **审计打通**：`AuditRecord.remember` 新增 `'session-cruise'`，该决策记为
    `user / switch to cruise`，与 DecisionReason 体系一致。
  - 新增 `fileWriteGate.cruise.test.ts`（切模式 / kind=file / 普通 Yes 不切模式 三例）。

## [0.9.20] - 2026-06-22

### 修复
- **Orbit 模式计划展示与审批的四个缺陷**：用户在一次纯只读调查里误触 Orbit 模式，暴露出
  计划呈现/审批流程的四个真实问题。根因都指向同一处设计——`ExitOrbitMode` 复用通用的
  AskUserQuestion 通道（`askOne`），把 25 行的计划**纯文本**预览塞进 `Question.question`
  字段。
  - **① 计划不以 Markdown 渲染**：计划预览经 `QuestionPanel` 用纯 `<Text>{q.question}>` 输出，
    没有走 markdown。**修复**：`Question` 新增可选 `planBody`；`ExitOrbitMode` 改用 `ask` 携带
    完整计划，App 的 `onQuestion` 订阅在收到带 `planBody` 的问题时，先把计划正文作为一条
    持久化的 assistant 历史条目落进 `<Static>`——assistant 条目本就走 `renderMarkdown`，于是
    计划以格式化 markdown 呈现。
  - **② 按 ESC 计划整个消失**：ESC 关闭待答问题时只 `setPendingQuestion(null)+answer('')`，而
    审批面板是计划在屏幕上的**唯一**副本，于是计划凭空消失（文件其实已存盘）。**修复**：因为
    计划已先落进永久的 `<Static>` 历史，无论面板被 Enter 提交还是 ESC 关掉，计划都留在屏幕上；
    ESC 路径无需改动，`answer('')` 仍正确地让会话留在 Orbit 以便修订。
  - **③ 计划没讲清要执行什么**：工具描述与 orbit 系统提示段都未要求「要执行的步骤」。**修复**：
    `ExitOrbitMode` 描述与 `builder.ts` 的 `orbitModeSection` 均要求计划按
    Context → Steps to execute → Files to change → Verification 结构化，明确告知用户批准后会发生什么。
  - **④ 误入 Orbit 模式**：`EnterOrbitMode` 描述只说「探索并设计方案」，未排除只读场景，导致
    模型连「检查一下 X」这类纯问答也进 Orbit。**修复**：描述加上明确的「只读问题/调查/解释类
    请求直接作答、不要进 Orbit」约束。
  - **顺带修掉一个潜伏 bug**：审批判定 `answer.includes('approve')` 会因问题正文本身含
    "Approve" 而对两个选项都判为通过；改为只解析 `→` 之后真正选中的选项 label。
  - 涉及文件：`src/tools/AskUserQuestionTool/bridge.ts`、`src/tools/ExitOrbitModeTool/index.ts`、
    `src/tools/EnterOrbitModeTool/index.ts`、`src/ui/App.tsx`、`src/ui/QuestionPanel.tsx`、
    `src/context/systemPrompt/builder.ts`。

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
