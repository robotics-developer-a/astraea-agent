<div align="center">
<img src="./assets/banner.svg" alt="Astraea" width="700"/>

### An Agent of Order and Precision

![screenshot](./assets/screenshot.png)

**Astraea** is a terminal-native AI coding agent that resolves disorder — it doesn't just write code, it imposes structure on any problem that arrives with ambiguity, inefficiency, or unchecked complexity.

Built from the ground up on [**Bun**](https://bun.com), with a React Ink TUI, multi-provider model support, sub-agents, scheduling, and a permission system you can actually trust.

<br>
<p align="center">
  <a href="https://astraea-community.vercel.app/">
    <img src="./assets/community-card.svg" alt="Community docs" width="640"/>
  </a>
</p>
<br>

<p>
  <img alt="Runtime" src="https://img.shields.io/badge/runtime-Bun-000000?logo=bun&logoColor=white">
  <img alt="Language" src="https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white">
  <img alt="UI" src="https://img.shields.io/badge/TUI-React%20Ink-61DAFB?logo=react&logoColor=black">
  <img alt="Providers" src="https://img.shields.io/badge/providers-Anthropic%20·%20DeepSeek%20·%20OpenAI%20·%20Kimi%20·%20Ollama%20·%20Custom-7C3AED">
  <img alt="License" src="https://img.shields.io/badge/license-Private-lightgrey">
</p>

</div>

---

## Supported Model Providers

Astraea works with a growing set of model providers. Pick the one that fits your needs — cloud or local, paid or free.

<br>
<table align="center" border="0" cellspacing="0" cellpadding="16">
<tr>
<td align="center" width="140">
  <img src="./assets/anthropic.svg" height="120" alt="Anthropic"><br><br>
  <strong>Anthropic</strong><br>
  <sub>Claude</sub>
</td>
<td align="center" width="140">
  <img src="./assets/deepseek.svg" height="120" alt="DeepSeek"><br><br>
  <strong>DeepSeek</strong><br>
  <sub>High quality, low cost</sub>
</td>
<td align="center" width="140">
  <img src="./assets/openai.svg" height="120" alt="OpenAI"><br><br>
  <strong>OpenAI</strong><br>
  <sub>GPT-5.5 &amp; friends</sub>
</td>
<td align="center" width="140">
  <img src="./assets/kimi.svg" height="120" alt="Kimi"><br><br>
  <strong>Kimi</strong><br>
  <sub>Moonshot AI</sub>
</td>
</tr>
</table>

In addition to the above, Astraea supports:

- **Ollama** — fully local models (no API key)
- **OpenAI Codex** — ChatGPT subscription via OAuth (`PROVIDER=codex`, `/login`)
- **Custom gateway** — any **OpenAI-compatible** or **Anthropic-compatible** endpoint (e.g. right.codes, LiteLLM, Azure proxies): set base URL, API key, model id, and connection style via `/login` → *Custom gateway* or `CUSTOM_*` env vars

---

## 1 · Introduction

In Greek mythology, **Astraea** was the goddess of justice and innocence — the last immortal to walk among humans during the Golden Age. When the world fell into chaos, she did not abandon it out of despair; she stayed until the very end, imposing order on disorder. She ascended not because she gave up, but because she had done everything that could be done.

**Astraea** the agent inherits that mission. It is a general-purpose AI agent for any task with high logical density — software engineering, system design, contract analysis, decision decomposition, research, process planning, or any domain where clear reasoning and verified facts outperform intuition. It operates through structured reasoning: it reaches for a tool before it speculates, and follows a defined path before it improvises.

It runs in your terminal as either a **persistent REPL** (multi-turn, React Ink UI) or a **single-shot CLI** (great for pipes and scripts), and can run **headless** as a scheduled daemon.

### Why Astraea

| | |
|---|---|
| **Multi-provider** | **Anthropic**, **DeepSeek**, **OpenAI**, **Kimi**, **Ollama**, **Codex** (OAuth), and **custom** gateways (OpenAI- or Anthropic-style base URL + key + model). |
| **Five session modes** | `default` · `orbit` (read-only planning) · `cruise` (auto-accept edits) · `forge` (bypass prompts) · `counsel` (confirm direction first). |
| **Permission system** | A mode × behavior matrix with hard **red-lines** that can never be bypassed — auto-approve the safe, always gate the dangerous. |
| **Rich tool suite** | Files, shell (Bash + PowerShell), web (fetch / search / headless browser), LSP, MCP resources, and skills. |
| **Extensible** | Drop-in **skills** (`SKILL.md`), **MCP** servers (stdio / http / sse), and installable **plugins** that bundle both — see [§4](#4--skills-mcp--plugins). |
| **Sub-agents** | Spawn worker agents, message peers, and fan out complex work — coordination tools included. |
| **Vigil scheduling** | Schedule one-off or recurring agent tasks that run headless via a background daemon. |
| **Memory & compaction** | Project-scoped file memory (`~/.astraea/projects/…/memory/`), prompt-cache-aware injection, and automatic context compaction. |
| **Agent harness** | `AGENTS.md` + `feature_list.json` + `./init.sh` so coding agents start, verify, and hand off cleanly. |
| **WeChat integration** | Read and write WeChat conversations through driven automation. |
| **Web search** | Pluggable providers — configure interactively with `/internet`. China-direct **Bocha** & **Zhipu** (no proxy), plus **Tavily**, **Brave**, and **Exa** semantic search. |
| **Multilingual UI** | Switch the interface *and* reply language with `/language` — English, German, French, Spanish, Chinese, Korean. Auto-detects your system locale on first run; hot-applies with no restart. |

---

## 2 · Quick Install

Astraea runs on [Bun](https://bun.com) (v1.3+). Choose your platform below.

### macOS / Linux

Install Bun:

```bash
curl -fsSL https://bun.sh/install | bash
```

Clone and install dependencies:

```bash
git clone https://github.com/anxelswanz/astraea-agent.git astraea
# or via SSH
# git clone git@github.com:anxelswanz/astraea-agent.git astraea
cd astraea
bun install
```

Register the global `astraea` command (one-time). This symlinks the CLI into `~/.bun/bin`, which Bun's installer adds to your `PATH`:

```bash
bun link
```

Now you can launch Astraea from anywhere by typing `astraea`. (Prefer not to link? You can always run it in-place with `bun run repl` — see [Getting Started](#3--getting-started).)

### Windows

Requires **Windows 10 (1809+)** or **Windows 11**. Open **PowerShell** and install Bun:

```powershell
powershell -c "irm bun.sh/install.ps1|iex"
```

Alternatively, install via [Scoop](https://scoop.sh):

```powershell
scoop install bun
```

Clone and install dependencies:

```powershell
git clone https://github.com/anxelswanz/astraea-agent.git astraea
cd astraea
bun install
```

Register the global `astraea` command:

```powershell
bun link
```

Now you can launch Astraea from any directory by typing `astraea` in PowerShell. (Prefer not to link? Run in-place with `bun run repl`.)

> For a detailed Windows guide, see [WINDOWS.md](./WINDOWS.md).

### Configure provider

Astraea needs an **AI model provider** to function (this is the brain that powers it). Copy the example config file:

```bash
cp .env.example .env
```

#### What is an "API key"?

An **API key** is a secret token (a long string like `sk-ant-xxxxxxxxxxxxx`) that proves you have access to an AI service. Think of it like a password for an AI account.

You get one for free (or with a free trial balance) by signing up at a provider's website. Common providers:

| Provider | Powers | Where to get a key |
|----------|--------|--------------------|
| **Anthropic (Claude)** | Official Claude API (default if `PROVIDER` unset) | [console.anthropic.com](https://console.anthropic.com) → API Keys → Create key |
| **DeepSeek** | Strong, very low cost (V4 flash/pro) | [platform.deepseek.com](https://platform.deepseek.com) → API Keys |
| **OpenAI (GPT)** | GPT / o-series via API | [platform.openai.com](https://platform.openai.com) → API Keys |
| **Kimi (Moonshot)** | Long-context Moonshot models | [platform.moonshot.cn](https://platform.moonshot.cn) → API Keys |
| **OpenAI Codex** | ChatGPT **subscription** (OAuth, no API key file) | `/login` → OpenAI Codex (browser or device code) |
| **Ollama** | Fully **local**, runs on your own machine | **No key needed** — install [ollama.com](https://ollama.com) and pull a model |
| **Custom gateway** | Any OpenAI- or Anthropic-compatible proxy (right.codes, LiteLLM, …) | Your gateway’s key + base URL + model id |

> **Security:** Never commit API keys to git. The `.env` file is already in `.gitignore`. Prefer `~/.astraea/.env` (global) so all Astraea projects reuse keys without risk: `mkdir -p ~/.astraea`.

#### Step 1 — Pick an AI model provider

**Easiest:** launch Astraea and run **`/login`** — pick provider, model, paste key (or OAuth for Codex). For a custom gateway, choose **Custom gateway** → connection style → base URL → model → key. Saved live to `~/.astraea/.env`.

**Manual:** edit `.env` (or `~/.astraea/.env`) and set **exactly one** active `PROVIDER`. Remove the `#` in front of the lines you need:

```bash
# ── Anthropic (Claude) — default if PROVIDER is omitted ──
# ANTHROPIC_API_KEY=sk-ant-xxxxxxxxxxxxx
# ANTHROPIC_MODEL=claude-sonnet-4-6

# ── DeepSeek ──
# PROVIDER=deepseek
# DEEPSEEK_API_KEY=sk-xxxxxxxxxxxxx
# DEEPSEEK_MODEL=deepseek-v4-flash

# ── OpenAI (GPT) ──
# PROVIDER=openai
# OPENAI_API_KEY=sk-xxxxxxxxxxxxx
# OPENAI_MODEL=gpt-4o
# OPENAI_BASE_URL=https://api.openai.com/v1   # optional proxy

# ── Kimi (Moonshot) ──
# PROVIDER=kimi
# KIMI_API_KEY=sk-xxxxxxxxxxxxx
# KIMI_MODEL=kimi-k2-0905-preview

# ── Ollama — local, no API key ──
# PROVIDER=ollama
# OLLAMA_MODEL=qwen2.5:7b
# OLLAMA_BASE_URL=http://localhost:11434/v1

# ── Codex — ChatGPT subscription (token in ~/.astraea/auth.json via /login) ──
# PROVIDER=codex
# CODEX_MODEL=gpt-5.4

# ── Custom gateway (OpenAI- or Anthropic-compatible) ──
# PROVIDER=custom
# CUSTOM_BASE_URL=https://api.example.com/v1   # OpenAI style usually ends with /v1
# CUSTOM_API_KEY=sk-xxxxxxxxxxxxx
# CUSTOM_MODEL=deepseek-v4-flash               # exact id your gateway expects
# CUSTOM_API_STYLE=openai                      # openai | anthropic
# CUSTOM_MAX_TOKENS=16384
# CUSTOM_CONTEXT_WINDOW=128000
```

Check the active channel anytime with **`/model`** (provider, model, endpoint, max tokens; for custom, also API style). The system prompt Environment section must match this — Astraea should not claim to be Claude (or any other brand) unless that is the configured model.

#### Step 2 (optional) — Enable web search

Astraea can search the internet for you — useful for research, checking documentation, reading news, or fetching real-time information. This requires a **web search API** (a specialized search engine designed for AI agents to call programmatically).

**Easiest way:** Launch Astraea and type `/internet` in the REPL — it walks you through picking a provider and pasting the key. Saved automatically.

**Manual way:** Add one of the following to `.env` (or `~/.astraea/.env` for global reuse):

```bash
# ══════════════════════════════════════════════════════
# 🇨🇳 China-direct — NO proxy/VPN required
# ══════════════════════════════════════════════════════

# 博查 (Bocha) — recommended for users in mainland China
# What it does: general-purpose web search, purpose-built for AI agents
# Pricing: pay-as-you-go (free starting balance, very cheap)
# How to get a key: https://open.bochaai.com → 注册 → API Key
BOCHA_API_KEY=sk-xxxxxxxxxxxxx

# 智谱 (BigModel / Zhipu) — reuse an existing Zhipu account
# What it does: general web search + news search
# Pricing: included with Zhipu API usage
# How to get a key: https://open.bigmodel.cn → API Keys
# ZHIPU_API_KEY=xxxxxxxxxxxxx
# ZHIPU_SEARCH_ENGINE=search_std    # optional: search_std (default) | search_pro

# ══════════════════════════════════════════════════════
# 🌐 Global — may need a proxy in mainland China
# ══════════════════════════════════════════════════════

# Tavily — purpose-built search engine for AI agents
# What it does: returns clean, extracted content (no raw HTML), designed for RAG/Agent
# Free tier: 1,000 requests/month, no credit card required
# How to get a key: https://app.tavily.com → Sign up → copy "API Key" (starts with tvly-)
TAVILY_API_KEY=tvly-xxxxxxxxxxxxx

# Brave Search — from the creators of Brave browser
# What it does: independent, privacy-respecting web search index
# Free tier: 2,000 requests/month
# How to get a key: https://brave.com/search/api/ → Get started → copy key (starts with BSA-)
# BRAVE_SEARCH_API_KEY=BSA-xxxxxxxxxxxxx

# Exa — semantic search engine, great for deep research
# What it does: understands intent, not just keywords — "find recent articles about …"
# Free tier: 1,000 requests/month
# How to get a key: https://dashboard.exa.ai → API Keys → Create
# EXA_API_KEY=xxxxxxxxxxxxx
```

Astraea auto-detects which key you have. Detection order: **Bocha → Zhipu → Brave → Tavily → Exa** — configure just one and it works.

---

## 3 · Getting Started

### Launch the interactive REPL

The primary way to use Astraea — a persistent, multi-turn React Ink UI. If you ran `bun link` during install, just type:

```bash
astraea
```

Otherwise, run it in-place from the project directory:

```bash
bun run repl
# or directly
bun run src/repl.tsx
```

You'll see the active provider and model printed on startup, then a prompt. Just start talking:

```
astraea › refactor src/query.ts to extract the streaming loop into its own module
```

### In-REPL configuration

You can configure everything interactively — no need to hand-edit `.env`. On **first launch** (no provider key yet), Astraea walks you through two steps automatically: **`/login`** to pick a model provider, then **`/language`** to choose your language. Afterwards, these slash commands are available anytime:

| Command | What it does |
|---------|--------------|
| `/login` | Choose provider + model (including **Custom gateway**: style, base URL, model, key) or Codex OAuth. Saved and applied live. |
| `/model` | Show active provider, model, endpoint, max tokens (and custom API style). Zero tokens — local config only. |
| `/internet` | Choose a web-search provider (Bocha · Zhipu · Tavily · Brave · Exa) and paste the key. Saved to `~/.astraea/.env`. |
| `/language` | Switch UI + reply language (English · Deutsch · Français · Español · 中文 · 한국어). Applies instantly, no restart. Also accepts a direct arg, e.g. `/language en`. |
| `/reason` | Set reasoning effort: `low` · `medium` · `high` · `max` · `auto`. Maps to Anthropic thinking / OpenAI `reasoning_effort` / DeepSeek V4 thinking knobs. `auto` clears the override. `max` is session-only. |
| `/selection` | Floating selection UI — `/selection start` (launch bridge), `/selection open` (capture + open panel now), `/selection stop`, `/selection status`, `/selection setup` (keyboard-shortcut instructions). Auto-starts the bridge in the background on first use. |
| `/init [focus]` | Scan the current repo and create/update AGENTS.md and AGENTS.local.md project instructions. Walks you through setting up project skills. Accepts an optional focus hint. |
| `/usage` | Show session token usage and estimated cost in USD. Breaks down input, output, and prompt-cache tokens per model/provider, with a total and cost. Helps you monitor spending across a session. |
| `/help` | List all available commands and skills. |

> Type `/` to open the command picker with inline autocomplete.

### One-shot CLI

Ask a single question and get a single answer — ideal for scripts and pipes:

```bash
# direct argument
bun run src/cli.ts "explain what src/services/compact does"

# pipe mode
echo "summarize the changes on this branch" | bun run src/cli.ts
```

### Session modes

Switch how much autonomy Astraea has. Each mode trades convenience for caution:

| Mode | Behavior |
|------|----------|
| `default` | Standard prompts — asks before writing files or running shell commands. |
| `orbit` | **Read-only planning.** Writes are blocked; Astraea reads, searches, and presents a plan for approval. |
| `cruise` | File writes auto-approved; shell still asks. |
| `forge` | Auto-accepts all changes, skipping prompts — red-lines still block. |
| `counsel` | Confirms direction with you (AI-driven questionnaire) before executing. |

### Scheduled & headless tasks (Vigil)

Run the scheduler daemon, which executes recurring agent tasks in the background:

```bash
bun run src/cli.ts --daemon          # start the scheduling daemon
```

Tasks are dispatched as isolated headless agents — no UI, full tool access.

### WeChat automation

```bash
bun run setup:wechat                 # one-time setup
bun run wechat:stop                  # signal the reader to stop at the next checkpoint
```

### Project scripts

| Command | Description |
|---------|-------------|
| `bun run repl` | Launch the interactive Ink REPL |
| `bun run cli` | Run the single-shot CLI |
| `bun test` | Run the test suite (`bun:test`) |
| `bun run typecheck` | Type-check with `tsc --noEmit` |

---

## 4 · Skills, MCP & Plugins

Astraea has three ways to extend what it can do. They are independent subsystems that converge on the same internal pipelines — a skill from a plugin and a skill you hand-wrote become the *same* object; an MCP server from a plugin and one you added by hand flow through the *same* config merge.

> **Mental model:** the **skill system** owns all skills and the **MCP system** owns all MCP servers. Plugins are just one *supplier* that delivers skills/servers into those systems — exactly equal to dropping a file yourself.

### 4.1 Skills — Markdown operating manuals

A **skill** is a folder containing a `SKILL.md` file. When invoked, its content is injected as instructions for the model to follow. Skills live in:

| Scope | Path | Precedence |
|-------|------|------------|
| user | `~/.astraea/skills/<name>/SKILL.md` | **wins** on name clash |
| project | `<repo>/.astraea/skills/<name>/SKILL.md` | overridden by user |

**SOP — add a skill:**

```bash
mkdir -p .astraea/skills/code-review
$EDITOR .astraea/skills/code-review/SKILL.md
```

```markdown
---
description: review a diff for bugs and security issues   # required — the only common field
when_to_use: when the user asks for a code review         # optional, appended in the menu
allowed-tools: [Read, Grep, Bash]                          # optional, additive permissions
argument-hint: "[path]"                                    # optional, shown in the slash picker
model: claude-opus-4-8                                     # optional, per-invocation model override
---

# Code Review
Walk the diff, flag correctness bugs first, then security, then style…
```

> The folder name **is** the skill name. Only `<name>/SKILL.md` is recognized — a bare `.md` file is skipped.

**SOP — invoke a skill** (two entrances, same result):

| Entrance | How | Gated by |
|----------|-----|----------|
| **You** | type `/code-review [args]` in the REPL (autocompletes after `/`) | `user-invocable: false` hides it |
| **The model** | it picks from a 1-line "skill menu" injected each turn (progressive disclosure) and calls the `Skill` tool itself | `disable-model-invocation: true` hides it |

On invocation, the skill's `allowed-tools` and `model` apply to that turn only.

### 4.2 MCP — external tools via the Model Context Protocol

MCP servers give the model **real callable tools** (read a database, query Sentry, …). They run as isolated processes/connections; their tools appear to the model as `mcp__<server>__<tool>`.

**SOP — add a server** with `astraea mcp add`:

```bash
# Remote (HTTP) — needs --transport http; second arg is a URL
astraea mcp add --transport http sentry https://mcp.sentry.dev/mcp

# Remote + static auth header
astraea mcp add --transport http corridor https://app.corridor.dev/api/mcp \
  -H "Authorization: Bearer $TOKEN"

# Local (stdio is the default; everything after -- is the subprocess command)
astraea mcp add filesystem npx -- -y @modelcontextprotocol/server-filesystem /path
```

| Flag | Meaning |
|------|---------|
| `--transport / -t` | `stdio` (local, default) · `http` · `sse` (remote) |
| `-e KEY=val` | environment variable for a **stdio** subprocess |
| `-H "Header: val"` | auth header for a **remote** server |
| `--scope` | `local` (default) · `project` · `user` |

```bash
astraea mcp list            # show configured servers
astraea mcp remove sentry   # delete one
```

Inside the REPL, `/mcp` shows live connection status. Config is stored per scope: project → `.mcp.json` (commit it), user → `~/.astraea/settings.json`, local → `.astraea/settings.local.json`.

> **Restart to apply.** Servers connect at startup; changing config means restarting the session. Remote auth is static headers only in v1 (no OAuth yet).

### 4.3 Plugins — package & distribute skills + MCP

A **plugin** bundles skills and MCP servers into one installable, versioned unit. Distribution follows a *marketplace* model: a plugin always lives on a "shelf" (`marketplace.json`), and `install` only installs shelf items. v1 supports **local directory** marketplaces (offline).

**SOP — make & install a local plugin:**

```
my-shelf/
├── .astraea-plugin/marketplace.json     # the shelf: lists plugins
└── db-tools/                            # the plugin
    ├── .astraea-plugin/plugin.json      # manifest
    └── skills/query-db/SKILL.md         # auto-detected; no need to declare it
```

```jsonc
// my-shelf/.astraea-plugin/marketplace.json
{ "name": "my-shelf",
  "plugins": [ { "name": "db-tools", "source": "./db-tools" } ] }
```

```jsonc
// my-shelf/db-tools/.astraea-plugin/plugin.json
{ "name": "db-tools", "version": "0.3.0",
  "mcpServers": { "pg": { "type": "http", "url": "https://pg.example/mcp" } } }
// skills/ is detected by convention — declaring "skills" is optional
```

```bash
astraea plugin marketplace add ./my-shelf   # subscribe to the shelf
astraea plugin install db-tools             # materialize into the versioned cache
# the plugin's skills join the skill menu; its MCP servers connect on next start
```

**Lifecycle** (state is separated — files vs. the enabled flag):

```bash
astraea plugin list                 # installed plugins
astraea plugin disable db-tools     # flip a boolean — keeps files
astraea plugin enable  db-tools
astraea plugin uninstall db-tools   # remove record + cached files
astraea plugin marketplace list     # subscribed shelves
```

Inside the REPL, `/plugin` shows installed plugins and shelves. Plugins are stored under `~/.astraea/plugins/` (relocate with `ASTRAEA_PLUGINS_DIR`). When a plugin's skill or server clashes with one you wrote by hand, **yours wins** (`manual > plugin`).

> v1 wires plugin **skills + mcpServers** only. Remote marketplaces (git/npm), auto-update, and other contribution types are planned. **Restart to apply** install/enable changes.

---

## Architecture at a glance

```
src/
├── cli.ts / repl.tsx      # entry points — single-shot CLI & Ink REPL
├── cli/                   # `astraea mcp …` / `astraea plugin …` subcommands
├── query.ts               # the agent loop (streaming, tool dispatch, framework rails)
├── api/                   # provider clients & streaming (incl. custom gateway)
├── config.ts              # PROVIDER + per-provider / CUSTOM_* env, activeModel()
├── context/               # system prompt builder, session preamble, memory injection
│   └── systemPrompt/      #   layered, prompt-cache-aware sections
├── commands/              # unified command table (built-ins + skills) + skill menu
├── skills/                # SKILL.md loader, frontmatter, progressive disclosure
├── tools/                 # the full tool suite (Bash, File*, Web*, Task*, Vigil*, Wechat*, …)
├── services/              # compaction, transcript, eclipse, cron-daemon
├── state/                 # session mode, micro-compact state, goal state
├── memory/                # persistent file-based memory
├── mcp/                   # Model Context Protocol — transports, config, dynamic tool registry
├── plugins/               # local plugins — manifest, marketplace, materialize, lifecycle
└── ui/                    # React Ink components (LoginWizard, panels, …)
```

### Agent harness (for coding agents working on this repo)

| File | Purpose |
|------|---------|
| [`AGENTS.md`](./AGENTS.md) | Startup path, working rules, definition of done |
| [`feature_list.json`](./feature_list.json) | Feature status (source of truth) |
| [`progress.md`](./progress.md) | Session continuity log |
| [`session-handoff.md`](./session-handoff.md) | Multi-session handoff |
| [`init.sh`](./init.sh) | Baseline verification: `bun run typecheck` + `bun test` |

```bash
./init.sh   # run before claiming work done
```

User-facing product docs stay in this **README**; agent workflow lives in **AGENTS.md**. When behavior changes (providers, CLI, env vars), **update both** if users or agents would otherwise be misled.

---

<div align="center">

*Astraea — resolving disorder, one verified fact at a time.*

</div>
