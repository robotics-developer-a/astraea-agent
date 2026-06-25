import { resolve } from 'node:path'

// Shared client helpers for talking to the local selection bridge.
//
// INTENT: Both the macOS companion (`open-selection-companion.ts`) and the
// `astraea selection` CLI subcommand need the same three things — know the
// bridge URL, ask whether it is alive, and lazily auto-start it in the
// background if it is not. Centralizing them here keeps the "open the UI also
// starts the service" behavior identical no matter which entry point fires.

const DEFAULT_PORT = 8765

export function bridgeUrl(): string {
  if (process.env.ASTRAEA_SELECTION_BRIDGE_URL) {
    return process.env.ASTRAEA_SELECTION_BRIDGE_URL.replace(/\/$/, '')
  }
  const port = process.env.ASTRAEA_SELECTION_BRIDGE_PORT ?? String(DEFAULT_PORT)
  return `http://127.0.0.1:${port}`
}

export async function isBridgeHealthy(timeoutMs = 800): Promise<boolean> {
  try {
    const response = await fetch(`${bridgeUrl()}/health`, {
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!response.ok) return false
    const data = (await response.json()) as { ok?: boolean; service?: string }
    return data.ok === true && data.service === 'astraea-selection-bridge'
  } catch {
    return false
  }
}

// Idempotent: returns immediately if the bridge already answers /health,
// otherwise spawns a detached bridge process and waits until it is reachable.
export async function ensureBridgeRunning(
  options: { quiet?: boolean } = {},
): Promise<void> {
  if (await isBridgeHealthy()) return

  if (!options.quiet) {
    console.error('[selection] bridge not running — starting it in the background…')
  }

  const root = `${import.meta.dir}/../..`
  const entry = `${root}/src/services/run-local-selection-bridge.ts`

  // Re-spawn with the same Bun binary that is running this process, so it works
  // even when PATH is bare (e.g. launched from a macOS Shortcut). Detach fully:
  // the bridge must outlive the short-lived command that triggered it.
  const proc = Bun.spawn([process.execPath, 'run', entry], {
    cwd: root,
    stdin: 'ignore',
    stdout: 'ignore',
    stderr: 'ignore',
    env: { ...process.env },
  })
  proc.unref()

  const deadline = Date.now() + 8_000
  while (Date.now() < deadline) {
    await Bun.sleep(150)
    if (await isBridgeHealthy()) return
  }

  throw new Error(
    'Selection bridge did not become healthy in time. Try running it manually with: bun run bridge:selection',
  )
}

// The shell command a global keyboard shortcut should run to open the panel.
export function selectionOpenCommand(): string {
  const entry = resolve(import.meta.dir, 'open-selection-companion.ts')
  return `${process.execPath} run ${entry}`
}

// Platform-aware instructions for binding a global keyboard shortcut. Shared by
// the CLI `astraea selection setup` and the REPL `/selection setup`.
export function selectionSetupInstructions(): string {
  const cmd = selectionOpenCommand()

  if (process.platform === 'win32') {
    return [
      'Bind the floating selection UI to a global keyboard shortcut on Windows:',
      '',
      'Option A — AutoHotkey (most flexible):',
      '  Install AutoHotkey v2, then add this to a .ahk script and run it:',
      '',
      `    ^!Space::Run '${cmd}', , 'Hide'`,
      '',
      '  (Ctrl+Alt+Space here — change the hotkey to taste.)',
      '',
      'Option B — Windows shortcut hotkey:',
      '  1. Create a shortcut (.lnk) on your Desktop whose Target is:',
      `       ${cmd}`,
      '  2. Right-click it → Properties → set the "Shortcut key" field',
      '     (e.g. Ctrl+Alt+S), then click OK.',
      '',
      'Then: select text in any app and press your hotkey — a clean Edge/Chrome',
      'app window pops up with the selection pre-filled. The bridge service',
      'auto-starts in the background the first time.',
      '',
      'Verify the service:  astraea selection status',
      'Force a plain browser tab:  set ASTRAEA_SELECTION_UI=browser',
    ].join('\n')
  }

  if (process.platform === 'darwin') {
    return [
      'Set up the floating selection UI with a macOS keyboard shortcut:',
      '',
      '1. Open the macOS Shortcuts app.',
      '2. Create a new shortcut and add the "Run Shell Script" action.',
      '3. Set the shell script to:',
      '',
      `     ${cmd}`,
      '',
      '   (This is exactly what `astraea selection open` runs. The bridge service',
      '    auto-starts in the background the first time the shortcut fires.)',
      '',
      '4. Assign a keyboard shortcut, e.g. Option + Space.',
      '5. On first run, grant Accessibility permission when macOS prompts',
      '   (System Settings → Privacy & Security → Accessibility).',
      '',
      'Then: select text in any app and press your shortcut — the floating panel',
      'pops up next to the cursor with the selection pre-filled.',
      '',
      'Verify the service:  astraea selection status',
      'Fall back to a browser tab:  set ASTRAEA_SELECTION_UI=browser',
    ].join('\n')
  }

  // Linux / other.
  return [
    'Bind the floating selection UI to a global keyboard shortcut on Linux:',
    '',
    '1. Make sure wl-clipboard (Wayland) or xclip (X11) is installed.',
    '2. In your desktop\'s keyboard settings, add a custom shortcut that runs:',
    '',
    `     ${cmd}`,
    '',
    '3. Assign a key combo (e.g. Super + Space).',
    '',
    'Then: select text in any app and press your shortcut — the companion opens',
    'in your browser with the selection pre-filled. The bridge auto-starts the',
    'first time.',
    '',
    'Verify the service:  astraea selection status',
  ].join('\n')
}

// Asks a running bridge to shut itself down (POST /shutdown). Returns true if a
// bridge was running and is now down, false if none was running.
export async function stopBridge(): Promise<boolean> {
  if (!(await isBridgeHealthy())) return false

  try {
    await fetch(`${bridgeUrl()}/shutdown`, {
      method: 'POST',
      signal: AbortSignal.timeout(1500),
    })
  } catch {
    // The server exits mid-response, so the connection may drop — that is the
    // expected outcome, not an error. We confirm via a follow-up health check.
  }

  // Give the process a moment to release the port, then verify it is gone.
  for (let i = 0; i < 10; i++) {
    await Bun.sleep(80)
    if (!(await isBridgeHealthy())) return true
  }
  return false
}
