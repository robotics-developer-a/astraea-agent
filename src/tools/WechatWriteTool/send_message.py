#!/usr/bin/env python3
"""
WeChat message sender via macOS keyboard simulation.
Input  (stdin): JSON {"contact":"...", "message":"..."}
Output (stdout): JSON {"sent":true, "contact":"...", "message_length":N} | {"error":"..."}

Flow:
  1. Activate WeChat, ensure window visible
  2. Cmd+F search → type contact → Down+Enter to navigate
  3. Click the input box at the bottom of the chat area
  4. Paste message via clipboard (handles Chinese characters)
  5. Press Enter to send
"""
import sys, json, subprocess, time, signal

ABORT_FILE = '/tmp/.wechat_write_abort'

def _handle_sigterm(signum, frame):
    raise SystemExit(0)

signal.signal(signal.SIGTERM, _handle_sigterm)

# ── macOS imports ──────────────────────────────────────────────────────────────
import Quartz
from Quartz import (
    CGWindowListCopyWindowInfo, kCGWindowListOptionOnScreenOnly,
    kCGWindowListExcludeDesktopElements, kCGNullWindowID,
    CGEventCreateMouseEvent, CGEventPost, kCGHIDEventTap,
    kCGEventLeftMouseDown, kCGEventLeftMouseUp, CGPoint,
)


# ── WeChat window helpers ──────────────────────────────────────────────────────

def find_wechat_window():
    windows = CGWindowListCopyWindowInfo(
        kCGWindowListOptionOnScreenOnly | kCGWindowListExcludeDesktopElements,
        kCGNullWindowID,
    )
    for w in windows:
        owner = w.get('kCGWindowOwnerName', '')
        if ('WeChat' in owner or 'Weixin' in owner) and w.get('kCGWindowLayer', 99) <= 0:
            return w
    return None


def ensure_wechat_visible() -> bool:
    subprocess.run(['osascript', '-e', 'tell application "WeChat" to activate'], capture_output=True)
    time.sleep(1.0)
    if find_wechat_window():
        return True
    subprocess.run(['open', '-a', 'WeChat'], capture_output=True)
    for _ in range(8):
        time.sleep(1.0)
        if find_wechat_window():
            return True
    return False


def mouse_click(x: float, y: float):
    pt = CGPoint(x, y)
    down = CGEventCreateMouseEvent(None, kCGEventLeftMouseDown, pt, 0)
    up   = CGEventCreateMouseEvent(None, kCGEventLeftMouseUp,   pt, 0)
    CGEventPost(kCGHIDEventTap, down)
    time.sleep(0.05)
    CGEventPost(kCGHIDEventTap, up)
    time.sleep(0.1)


# ── Navigation ─────────────────────────────────────────────────────────────────

def navigate_to_contact(contact: str):
    """Cmd+F → paste contact name → Down+Enter to open the conversation."""
    # Open search
    subprocess.run(['osascript', '-e', '''tell application "System Events"
        tell process "WeChat"
            keystroke "f" using command down
        end tell
    end tell'''], capture_output=True)
    time.sleep(0.5)

    # Set clipboard and paste (handles Chinese characters safely)
    escaped = contact.replace('\\', '\\\\').replace('"', '\\"')
    subprocess.run(['osascript', '-e', f'set the clipboard to "{escaped}"'], capture_output=True)
    subprocess.run(['osascript', '-e', '''tell application "System Events"
        tell process "WeChat"
            keystroke "v" using command down
        end tell
    end tell'''], capture_output=True)
    time.sleep(0.8)

    # Down arrow to select first result, Enter to open
    subprocess.run(['osascript', '-e', '''tell application "System Events"
        tell process "WeChat"
            key code 125
            delay 0.3
            key code 36
        end tell
    end tell'''], capture_output=True)
    time.sleep(0.8)


# ── Input box + send ───────────────────────────────────────────────────────────

def click_input_box(bounds: dict):
    """Click the message input area (bottom-right 92% of the window)."""
    cx = bounds['X'] + bounds['Width']  * 0.55
    cy = bounds['Y'] + bounds['Height'] * 0.92
    mouse_click(cx, cy)
    time.sleep(0.2)


def send_via_clipboard(message: str):
    """Paste message from clipboard then press Enter to send."""
    escaped = message.replace('\\', '\\\\').replace('"', '\\"')
    subprocess.run(['osascript', '-e', f'set the clipboard to "{escaped}"'], capture_output=True)
    time.sleep(0.2)
    subprocess.run(['osascript', '-e', '''tell application "System Events"
        tell process "WeChat"
            keystroke "v" using command down
        end tell
    end tell'''], capture_output=True)
    time.sleep(0.3)
    # Press Enter to send
    subprocess.run(['osascript', '-e', '''tell application "System Events"
        tell process "WeChat"
            key code 36
        end tell
    end tell'''], capture_output=True)
    time.sleep(0.3)


# ── Main ───────────────────────────────────────────────────────────────────────

def main():
    raw = sys.stdin.read().strip()
    try:
        args = json.loads(raw)
    except Exception as e:
        print(json.dumps({'error': f'Invalid JSON input: {e}'}))
        sys.exit(1)

    contact = args.get('contact', '').strip()
    message = args.get('message', '').strip()

    if not contact:
        print(json.dumps({'error': 'contact is required'}))
        sys.exit(1)
    if not message:
        print(json.dumps({'error': 'message is required'}))
        sys.exit(1)

    if not ensure_wechat_visible():
        print(json.dumps({'error': 'Could not bring WeChat to foreground. Is WeChat installed?'}))
        sys.exit(1)

    win = find_wechat_window()
    if not win:
        print(json.dumps({'error': 'WeChat window not found after activation.'}))
        sys.exit(1)

    bounds = win.get('kCGWindowBounds', {})

    navigate_to_contact(contact)
    click_input_box(bounds)
    send_via_clipboard(message)

    print(json.dumps({
        'sent': True,
        'contact': contact,
        'message_length': len(message),
    }))


if __name__ == '__main__':
    main()
