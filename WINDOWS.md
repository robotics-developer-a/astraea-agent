# Astraea on Windows

Astraea runs on **Windows 10 (1809+)** and **Windows 11**. Bun 1.1+ provides native Windows support — no WSL or Linux emulation required.

---

## 1 · Install Bun

Open **PowerShell** (run as Administrator) and run:

```powershell
powershell -c "irm bun.sh/install.ps1|iex"
```

Alternatively, install via [Scoop](https://scoop.sh):

```powershell
scoop install bun
```

Or via npm (requires Node.js):

```powershell
npm install -g bun
```

Verify the installation:

```powershell
bun --version
```

## 2 · Clone Astraea

```powershell
git clone https://github.com/anxelswanz/astraea-agent.git astraea
cd astraea
```

## 3 · Install dependencies

```powershell
bun install
```

## 4 · Register the global command

```powershell
bun link
```

This registers `astraea` globally. Now you can launch it from any directory by typing `astraea` in PowerShell.

> **Prefer not to link?** Run in-place with `bun run repl` from the project directory.

## 5 · Configure your provider

```powershell
copy .env.example .env
```

Edit `.env` with your preferred editor:

```
ANTHROPIC_API_KEY=sk-ant-xxxxxxxxxxxxx     # default
# PROVIDER=openai
# OPENAI_API_KEY=sk-xxxxxxxxxxxxx
# PROVIDER=ollama                          # fully local, no key needed
# OLLAMA_MODEL=qwen2.5:7b
```

> Personal API keys (search providers, etc.) can live in a global `~/.astraea/.env`. Create it with:
> ```powershell
> mkdir $env:USERPROFILE\.astraea -Force
> ```

Optional — enable web search (add to `~/.astraea/.env`):

```
TAVILY_API_KEY=tvly-xxx
# BRAVE_SEARCH_API_KEY=BSA-xxx
# EXA_API_KEY=xxx
```

---

## Usage

### Interactive REPL (recommended)

```powershell
astraea
```

Or in-place:

```powershell
bun run repl
```

### One-shot CLI

```powershell
bun run src/cli.ts "explain what src/services/compact does"
```

### Test & type-check

```powershell
bun test
bun run typecheck
```

---

## Notes

- **Shell**: All commands above use **PowerShell**. If you're using Command Prompt (cmd), replace `copy` with `copy` (same), and `mkdir` with `mkdir` (same) — core operations are identical. Bun commands (`bun install`, `bun link`, etc.) work in both.
- **Path**: `bun link` adds `astraea` to Bun's global bin directory, which is automatically on your `PATH` after Bun's installer completes. If `astraea` is not found after linking, restart your terminal.
- **TUI**: The React Ink REPL runs in Windows Terminal, PowerShell ISE, or any modern terminal emulator. For the best experience, use [Windows Terminal](https://apps.microsoft.com/detail/9n0dx20hk701).
- **WSL not required**: Bun runs natively on Windows since v1.1. If you prefer WSL, the [Linux instructions in README.md](./README.md#2--quick-install) apply within your WSL distribution.

---

*See [README.md](./README.md) for full documentation on session modes, skills, MCP, plugins, and architecture.*
