#!/usr/bin/env bun

import { bridgeUrl, ensureBridgeRunning } from './selection-bridge-client'

// Capture the current selection, stash it as a draft on the bridge, then pop the
// floating panel pre-filled with it. The bridge is auto-started if it is not
// already running, so a single keyboard shortcut is enough — no separate
// "keep this terminal open" step.
export async function runOpenCompanion(): Promise<void> {
  await ensureBridgeRunning()
  const selection = await captureSelectedText()
  const draft = await createDraft(selection)
  await openCompanion(draft.id)
}

export async function captureSelectedText(): Promise<string> {
  if (process.platform === 'darwin') return captureSelectedTextMac()
  if (process.platform === 'win32') return captureSelectedTextWindows()
  return captureSelectedTextLinux()
}

// macOS: copy the selection (⌘C via System Events), read it, then restore the
// previous clipboard so we don't clobber what the user had copied.
async function captureSelectedTextMac(): Promise<string> {
  const script = [
    'set oldClipboard to the clipboard',
    'tell application "System Events" to keystroke "c" using command down',
    'delay 0.12',
    'set selectedText to the clipboard as text',
    'set the clipboard to oldClipboard',
    'return selectedText',
  ]

  const proc = Bun.spawn(['osascript', ...script.flatMap(line => ['-e', line])], {
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])

  if (exitCode !== 0) {
    throw new Error(
      stderr.trim() ||
        'Could not read the selected text. macOS may need Accessibility permission for your terminal or shortcut runner.',
    )
  }

  return stdout.trim()
}

// Windows: mirror the macOS flow with PowerShell — save the clipboard, send
// Ctrl+C to the foreground app, read the copied selection, then restore. Runs
// hidden so it doesn't steal focus from the app the user selected text in.
async function captureSelectedTextWindows(): Promise<string> {
  const ps = [
    'Add-Type -AssemblyName System.Windows.Forms;',
    '$old = Get-Clipboard -Raw;',
    "[System.Windows.Forms.SendKeys]::SendWait('^c');",
    'Start-Sleep -Milliseconds 120;',
    '$sel = Get-Clipboard -Raw;',
    'if ($null -ne $old) { Set-Clipboard -Value $old };',
    'if ($null -ne $sel) { [Console]::Out.Write($sel) };',
  ].join(' ')

  const proc = Bun.spawn(
    ['powershell', '-NoProfile', '-WindowStyle', 'Hidden', '-Command', ps],
    { stdout: 'pipe', stderr: 'pipe' },
  )
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])

  if (exitCode !== 0) {
    throw new Error(
      stderr.trim() ||
        'Could not read the selected text on Windows (PowerShell failed).',
    )
  }

  return stdout.trim()
}

// Linux/X11/Wayland: the currently highlighted text already lives in the PRIMARY
// selection, so we can read it directly without sending a copy keystroke. Try
// the Wayland tool first, then X11.
async function captureSelectedTextLinux(): Promise<string> {
  for (const cmd of [['wl-paste', '-p', '-n'], ['xclip', '-o', '-selection', 'primary']]) {
    try {
      const proc = Bun.spawn(cmd, { stdout: 'pipe', stderr: 'ignore' })
      const [stdout, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        proc.exited,
      ])
      if (exitCode === 0 && stdout.trim()) return stdout.trim()
    } catch {
      // Tool not installed — try the next one.
    }
  }
  throw new Error(
    'Could not read the selected text on Linux. Install wl-clipboard (Wayland) or xclip (X11).',
  )
}

export async function createDraft(selection: string): Promise<{ id: string }> {
  const response = await fetch(`${bridgeUrl()}/draft`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      instruction: '',
      selection,
      source: {
        kind: 'app',
        app: 'macOS selection',
      },
    }),
  })
  const data = await response.json() as { ok?: boolean; id?: string; error?: string }
  if (!data.ok || !data.id) {
    throw new Error(data.error || 'Astraea selection bridge is not ready.')
  }
  return { id: data.id }
}

export async function openCompanion(draftId: string): Promise<void> {
  const ui = process.env.ASTRAEA_SELECTION_UI ?? 'panel'
  const draft = encodeURIComponent(draftId)

  // macOS: native borderless floating panel (embedded UI mode).
  if (process.platform === 'darwin' && ui !== 'browser') {
    await openFloatingPanel(`${bridgeUrl()}/?draft=${draft}&embedded=1`)
    return
  }

  // Windows: a Chromium "--app" window is the closest analogue to the native
  // panel — a clean, chrome-less floating window with no tabs/address bar.
  if (process.platform === 'win32' && ui !== 'browser') {
    await openWindowsAppWindow(`${bridgeUrl()}/?draft=${draft}`)
    return
  }

  // Everything else (mac browser mode, Linux, fallback): the default browser.
  await openInDefaultBrowser(`${bridgeUrl()}/?draft=${draft}`)
}

// Windows: try Edge, then Chrome, in "--app" window mode; fall back to whatever
// the default browser is. Edge ships on every Windows 10/11 install.
async function openWindowsAppWindow(url: string): Promise<void> {
  for (const browser of ['msedge', 'chrome']) {
    if (await tryStartWindows(browser, [`--app=${url}`, '--window-size=480,300'])) return
  }
  await openInDefaultBrowser(url)
}

async function tryStartWindows(program: string, args: string[]): Promise<boolean> {
  try {
    // `start "" prog ...` resolves prog via the App Paths registry and detaches.
    const proc = Bun.spawn(['cmd', '/c', 'start', '', program, ...args], {
      stdout: 'ignore',
      stderr: 'pipe',
    })
    const [stderr, exitCode] = await Promise.all([
      new Response(proc.stderr).text(),
      proc.exited,
    ])
    return exitCode === 0 && !/cannot find|not recognized/i.test(stderr)
  } catch {
    return false
  }
}

async function openInDefaultBrowser(url: string): Promise<void> {
  const cmd =
    process.platform === 'darwin'
      ? ['open', url]
      : process.platform === 'win32'
        ? ['cmd', '/c', 'start', '', url]
        : ['xdg-open', url]

  const proc = Bun.spawn(cmd, { stdout: 'ignore', stderr: 'pipe' })
  const [stderr, exitCode] = await Promise.all([
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  if (exitCode !== 0) {
    throw new Error(stderr.trim() || `Could not open ${url}`)
  }
}

// INTENT: Render the companion as a native floating overlay (NSPanel + WKWebView)
// instead of a browser tab, so the small white/indigo window hovers over the
// user's current app with the selection pre-filled — they only type a command
// and press send. The Swift source is compiled once and cached.
async function openFloatingPanel(url: string): Promise<void> {
  const root = `${import.meta.dir}/../..`
  const source = `${root}/macos/AstraeaPanel.swift`
  const binary = `${root}/macos/.build/astraea-panel`

  await ensurePanelBinary(source, binary)

  const proc = Bun.spawn([binary, url], { stdout: 'ignore', stderr: 'ignore' })
  proc.unref()
}

async function ensurePanelBinary(source: string, binary: string): Promise<void> {
  const sourceFile = Bun.file(source)
  const binaryFile = Bun.file(binary)

  const fresh =
    (await binaryFile.exists()) &&
    binaryFile.lastModified >= sourceFile.lastModified

  if (fresh) return

  const proc = Bun.spawn(
    ['swiftc', '-O', source, '-o', binary],
    { stdout: 'ignore', stderr: 'pipe' },
  )
  const [stderr, exitCode] = await Promise.all([
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  if (exitCode !== 0) {
    throw new Error(
      stderr.trim() ||
        'Could not build the Astraea floating panel (swiftc failed). Install Xcode command line tools, or set ASTRAEA_SELECTION_UI=browser.',
    )
  }
}

// Allow `bun run src/services/open-selection-companion.ts` (the bridge:selection:open
// script and the macOS Shortcut) to keep working as a direct entry point.
if (import.meta.main) {
  await runOpenCompanion()
}
