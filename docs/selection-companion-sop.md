# Astraea Selection Companion SOP

## 0. Quick Start (recommended)

One command does everything — it auto-starts the bridge service in the
background if it is not already running, then captures the selection and pops
the floating panel:

```sh
astraea selection            # alias of: astraea selection open
```

Bind that command to a macOS keyboard shortcut and you are done — there is no
separate "keep this terminal open" step. To print the exact Shortcuts setup:

```sh
astraea selection setup
```

Other subcommands:

```sh
astraea selection start      # keep the bridge running in the foreground
astraea selection status     # check whether the bridge is reachable
```

The sections below document the underlying pieces (still valid if you prefer to
run them manually).

## 1. Start the Local Bridge

Run this from the Astraea project:

```sh
bun run bridge:selection
```

Keep this process running. It serves the command panel at:

```text
http://127.0.0.1:8765
```

> Tip: `astraea selection open` (or the macOS Shortcut bound to it) auto-starts
> this bridge on demand, so this manual step is optional.

## 2. Use the Command Panel Directly

Open:

```text
http://127.0.0.1:8765
```

Paste or edit the selected text on the left, type the command at the bottom, then send it.

## 3. Use the Native Floating Panel (macOS)

After the bridge is running, select text in any app and run:

```sh
bun run bridge:selection:open
```

On macOS this captures the selection and pops a small white/indigo **floating
panel** (a borderless always-on-top `NSPanel` hosting the companion UI) right
next to the cursor — no browser tab. The selection is pre-filled; just type a
command and press send. Press `Esc`, click the `✕`, or click outside the panel
to dismiss it.

- The Swift panel (`macos/AstraeaPanel.swift`) is compiled once via `swiftc`
  into `macos/.build/astraea-panel` and re-used afterwards (rebuilt only when the
  source changes). This needs Xcode command line tools (`xcode-select --install`).
- To fall back to the old browser-tab behavior, set `ASTRAEA_SELECTION_UI=browser`.

For a real keyboard shortcut:

1. Open macOS Shortcuts.
2. Create a new shortcut.
3. Add "Run Shell Script".
4. Set the command to (run `astraea selection setup` to get this line with the
   correct absolute paths filled in for your machine):

```sh
/opt/homebrew/bin/bun run /path/to/astraea/src/services/open-selection-companion.ts
```

   This is exactly what `astraea selection open` runs; the bridge service
   auto-starts in the background the first time the shortcut fires, so you no
   longer need to keep `bun run bridge:selection` open separately.

   If Bun is installed somewhere else, replace `/opt/homebrew/bin/bun` with the
   path from `which bun`.

5. Assign a keyboard shortcut, such as `Option Space`.
6. Grant Accessibility permission if macOS asks for it.

## 4. Use Browser Right Click

Chrome / Edge:

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Click "Load unpacked".
4. Select:

```text
extensions/astraea-selection
```

Then select text on a webpage, right click, and choose "Ask Astraea".

## 5. Current Boundaries

- `astraea selection open` is self-healing: it auto-starts the bridge service in
  the background before opening the panel, so a single keyboard shortcut is all
  the user needs to bind.
- macOS global shortcut now opens a native floating panel (no browser tab).
- Browser right click still works through the extension (opens the browser companion).
- Native right click in arbitrary apps should be added later through a macOS Service
  (Quick Action) that calls `bridge:selection:open`.
