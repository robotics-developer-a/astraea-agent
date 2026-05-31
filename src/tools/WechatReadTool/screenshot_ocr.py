#!/usr/bin/env python3
"""
WeChat screenshot + OCR reader.
Input  (stdin): JSON {"contact":"...", "target_date":"YYYY-MM-DD", "max_scrolls":30}
Output (stdout): JSON {"messages":[...], "reached_target": bool} | {"error":"..."}

Flow:
  1. Activate WeChat, navigate to contact via search
  2. Click chat area to focus it
  3. Loop: screenshot → OCR → check oldest timestamp → scroll up
  4. Stop when target_date found or max_scrolls reached
  5. All temp PNG files deleted before exit
"""
import sys, json, subprocess, time, tempfile, os, re, signal
from datetime import datetime, date, timedelta

ABORT_FILE = '/tmp/.wechat_read_abort'

def _handle_stop(signum, frame):
    # SIGTERM (parent kill) 或 SIGINT (Ctrl+C 经进程组传来) → 立即干净退出。
    raise SystemExit(0)

signal.signal(signal.SIGTERM, _handle_stop)
signal.signal(signal.SIGINT, _handle_stop)


def _check_abort():
    """Cooperative stop: if the abort file exists, exit cleanly right now.
    Called at every input point so navigation/scrolling can't keep running."""
    if os.path.exists(ABORT_FILE):
        try: os.unlink(ABORT_FILE)
        except OSError: pass
        raise SystemExit(0)

# ── macOS imports ──────────────────────────────────────────────────────────────
import Quartz
from Quartz import (
    CGWindowListCopyWindowInfo, kCGWindowListOptionOnScreenOnly,
    kCGWindowListExcludeDesktopElements, kCGNullWindowID,
    CGWindowListCreateImage, kCGWindowImageDefault, CGRectInfinite,
    CGImageCreateWithImageInRect, CGRectMake,
    CGImageDestinationCreateWithURL, CGImageDestinationAddImage,
    CGImageDestinationFinalize,
    CGEventCreateMouseEvent, CGEventPost, kCGHIDEventTap,
    kCGEventLeftMouseDown, kCGEventLeftMouseUp, CGPoint,
    CGEventCreateScrollWheelEvent2, kCGScrollEventUnitPixel,
    CGDisplayBounds, CGMainDisplayID, CGImageGetWidth, CGImageGetHeight,
)
import CoreFoundation as CF
import AppKit
import Vision


# ── Helpers ────────────────────────────────────────────────────────────────────

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


# WeChat 的 bundle id 是稳定标识；App 显示名可能是 "WeChat" / "Weixin" / "微信"，
# 用名字 activate/open 在部分系统上会失败，必须用 bundle id。
WECHAT_BUNDLE = 'com.tencent.xinWeChat'


class WeChatNotFront(Exception):
    """微信无法被带到最前——此时绝不能发送任何键鼠事件（会打到别的 App）。"""


def is_wechat_frontmost() -> bool:
    """True if WeChat is the active (frontmost) app — i.e. clicks and scroll
    events will actually land on it, not on whatever is behind it."""
    try:
        app = AppKit.NSWorkspace.sharedWorkspace().frontmostApplication()
        if app is None:
            return False
        bid  = app.bundleIdentifier() or ''
        name = app.localizedName() or ''
        return 'xinWeChat' in bid or 'WeChat' in name or 'Weixin' in name
    except Exception:
        return False


def activate_wechat():
    """用 bundle id 唤起/启动微信（比按名字更可靠）。"""
    subprocess.run(['open', '-b', WECHAT_BUNDLE], capture_output=True)
    subprocess.run(['osascript', '-e', f'tell application id "{WECHAT_BUNDLE}" to activate'],
                   capture_output=True)


def ensure_wechat_visible() -> bool:
    """确保微信主窗口可见且为最前台。最多等 ~10 秒，返回是否成功。"""
    activate_wechat()
    for _ in range(10):
        time.sleep(1.0)
        if find_wechat_window() and is_wechat_frontmost():
            return True
    # 窗口出现但不是最前（极少见）也算可用，交给后续 guard_front 再确认
    return find_wechat_window() is not None


def guard_front() -> bool:
    """发送任何键鼠事件前调用：确认微信确实在最前。
    不在最前 → 尝试唤起 → 再次确认。返回 True 才允许发送输入。"""
    if is_wechat_frontmost():
        return True
    activate_wechat()
    time.sleep(0.6)
    return is_wechat_frontmost()


def require_front():
    """guard_front 的断言版：失败直接抛 WeChatNotFront，调用方据此中止且不发任何事件。"""
    if not guard_front():
        raise WeChatNotFront()


def ensure_wechat_front(prev_bounds: dict) -> dict | None:
    """Guarantee WeChat is frontmost and return its CURRENT bounds.

    The user may move, resize, or minimize WeChat mid-run. If we kept acting on
    stale coordinates we'd crop the wrong screen region or send scroll/clicks to
    whatever window is now there (e.g. a browser). Re-activates WeChat when it
    isn't frontmost, RE-VERIFIES frontmost, and returns fresh bounds. Returns
    None if it can't be confirmed frontmost, so the caller stops instead of
    misfiring into another window."""
    win = find_wechat_window()
    if win is not None and is_wechat_frontmost():
        return win.get('kCGWindowBounds', prev_bounds)
    activate_wechat()
    time.sleep(0.6)
    win = find_wechat_window()
    if win is None or not is_wechat_frontmost():
        return None                      # 没能确认在最前 → 不要再发事件
    return win.get('kCGWindowBounds', prev_bounds)


def get_scale():
    try:
        img = CGWindowListCreateImage(CGRectInfinite, kCGWindowListOptionOnScreenOnly,
                                       kCGNullWindowID, kCGWindowImageDefault)
        logical_w = CGDisplayBounds(CGMainDisplayID()).size.width
        pixel_w   = CGImageGetWidth(img)
        return pixel_w / logical_w if logical_w > 0 else 2.0
    except Exception:
        return 2.0


def screenshot_bounds(bounds: dict, scale: float, out_path: str) -> bool:
    img = CGWindowListCreateImage(CGRectInfinite, kCGWindowListOptionOnScreenOnly,
                                   kCGNullWindowID, kCGWindowImageDefault)
    if img is None:
        return False
    wx = int(bounds['X'] * scale)
    wy = int(bounds['Y'] * scale)
    ww = int(bounds['Width']  * scale)
    wh = int(bounds['Height'] * scale)
    cropped = CGImageCreateWithImageInRect(img, CGRectMake(wx, wy, ww, wh))
    if cropped is None:
        return False
    url  = CF.CFURLCreateFromFileSystemRepresentation(None, out_path.encode(), len(out_path.encode()), False)
    dest = CGImageDestinationCreateWithURL(url, 'public.png', 1, None)
    if dest is None:
        return False
    CGImageDestinationAddImage(dest, cropped, None)
    return bool(CGImageDestinationFinalize(dest))


def _make_request() -> 'Vision.VNRecognizeTextRequest':
    req = Vision.VNRecognizeTextRequest.alloc().init()
    req.setRecognitionLanguages_(['zh-Hans', 'zh-Hant', 'en-US'])
    req.setRecognitionLevel_(Vision.VNRequestTextRecognitionLevelAccurate)
    req.setUsesLanguageCorrection_(True)
    return req

def ocr_image(path: str) -> list[str]:
    url     = AppKit.NSURL.fileURLWithPath_(path)
    request = _make_request()
    handler = Vision.VNImageRequestHandler.alloc().initWithURL_options_(url, {})
    handler.performRequests_error_([request], None)
    return [obs.topCandidates_(1)[0].string().strip()
            for obs in (request.results() or [])
            if obs.topCandidates_(1)[0].string().strip()]

def ocr_image_with_boxes(path: str) -> list[tuple[str, float, float]]:
    """Returns list of (text, center_x_norm, center_y_norm).
    Vision uses bottom-left origin, we convert to top-left."""
    url     = AppKit.NSURL.fileURLWithPath_(path)
    request = _make_request()
    handler = Vision.VNImageRequestHandler.alloc().initWithURL_options_(url, {})
    handler.performRequests_error_([request], None)
    results = []
    for obs in (request.results() or []):
        text = obs.topCandidates_(1)[0].string().strip()
        if not text:
            continue
        bb = obs.boundingBox()   # NSRect, origin is bottom-left, y up
        cx = bb.origin.x + bb.size.width  / 2
        # flip y to top-left origin
        cy = 1.0 - (bb.origin.y + bb.size.height / 2)
        results.append((text, cx, cy))
    return results


def mouse_click(x: float, y: float):
    p = CGPoint(x, y)
    CGEventPost(kCGHIDEventTap, CGEventCreateMouseEvent(None, kCGEventLeftMouseDown, p, 0))
    time.sleep(0.05)
    CGEventPost(kCGHIDEventTap, CGEventCreateMouseEvent(None, kCGEventLeftMouseUp, p, 0))


def scroll_up(x: float, y: float, pixels: int = 800):
    # Move mouse over chat area (no click) then scroll up
    import Quartz as Q
    p = Q.CGPoint(x, y)
    move_ev = Q.CGEventCreateMouseEvent(None, Q.kCGEventMouseMoved, p, 0)
    Q.CGEventPost(Q.kCGHIDEventTap, move_ev)
    time.sleep(0.05)
    ev = CGEventCreateScrollWheelEvent2(None, kCGScrollEventUnitPixel, 1, pixels, 0, 0)
    CGEventPost(kCGHIDEventTap, ev)


def type_text(text: str):
    safe = text.replace('\\', '\\\\').replace('"', '\\"')
    subprocess.run(
        ['osascript', '-e', f'tell application "System Events" to keystroke "{safe}"'],
        capture_output=True,
    )


def key_code(code: int):
    subprocess.run(
        ['osascript', '-e', f'tell application "System Events" to key code {code}'],
        capture_output=True,
    )


# ── Timestamp parsing ──────────────────────────────────────────────────────────
# WeChat date separators in OCR text (sparse — one per day boundary):
#   "5月30日"  "5月30日 10:30"  "今天"  "昨天"  "前天"  "2026年5月28日"
#   "星期三 10:30"  "周三"  — week-relative, no explicit date

_WEEKDAY = {'一': 0, '二': 1, '三': 2, '四': 3, '五': 4, '六': 5, '日': 6, '天': 6}

def parse_date_from_line(line: str, today: date) -> date | None:
    """Parse a single WeChat date-separator line into a concrete date.
    Robust to year boundaries: a bare 月/日 in the future maps to last year."""
    # 2026年5月28日 — explicit year, unambiguous
    m = re.search(r'(\d{4})年\s*(\d{1,2})月\s*(\d{1,2})日', line)
    if m:
        try: return date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
        except ValueError: return None

    # 5月28日 — no year → pick the most recent year that isn't in the future
    m = re.search(r'(\d{1,2})月\s*(\d{1,2})日', line)
    if m:
        mo, d = int(m.group(1)), int(m.group(2))
        for yr in (today.year, today.year - 1):
            try: cand = date(yr, mo, d)
            except ValueError: continue
            if cand <= today + timedelta(days=1):
                return cand
        return None

    if '今天' in line: return today
    if '昨天' in line: return today - timedelta(days=1)
    if '前天' in line: return today - timedelta(days=2)

    # 星期三 / 周三 — most recent past day with that weekday
    m = re.search(r'(?:星期|周)\s*([一二三四五六日天])', line)
    if m:
        wd = _WEEKDAY.get(m.group(1))
        if wd is not None:
            return today - timedelta(days=(today.weekday() - wd) % 7)
    return None


def crossed_target(lines: list[str], target_date: date, today: date) -> bool:
    """True once any separator strictly older than target appears — proves the
    entire [target, today] window now sits above it and has been captured."""
    for line in lines:
        d = parse_date_from_line(line, today)
        if d is not None and d < target_date:
            return True
    return False


def trim_to_window(lines: list[str], target_date: date, today: date) -> list[str]:
    """Keep only messages dated >= target_date.

    `lines` is chronological (oldest→newest). Date separators are monotonically
    increasing, so the window starts at the first separator >= target that has no
    older separator after it. Everything above that index is older → dropped.
    If we never crossed below target (short history), keep everything."""
    first_in_window = None
    saw_older = False
    for idx, line in enumerate(lines):
        d = parse_date_from_line(line, today)
        if d is None:
            continue
        if d < target_date:
            saw_older = True
            first_in_window = None        # reset — window begins after this
        elif first_in_window is None:
            first_in_window = idx
    if not saw_older or first_in_window is None:
        return lines                      # never overshot, or no usable separator
    return lines[first_in_window:]


def _jaccard(a: set, b: set) -> float:
    if not a and not b: return 1.0
    if not a or not b:  return 0.0
    return len(a & b) / len(a | b)


# ── Contact discovery ─────────────────────────────────────────────────────────

def get_recent_contacts(bounds: dict, scale: float, limit: int = 20) -> list[str]:
    """OCR 微信左侧聊天列表，返回最近联系人/群聊名字列表（按显示顺序）。
    只取侧边栏左 35% 区域、y > 10% 且 y < 95% 的文字；
    过滤掉纯时间戳、纯数字、极短噪声。
    """
    with tempfile.NamedTemporaryFile(suffix='.png', delete=False) as f:
        tmp = f.name
    try:
        screenshot_bounds(bounds, scale, tmp)
        boxes = ocr_image_with_boxes(tmp)
    finally:
        try: os.unlink(tmp)
        except OSError: pass

    TIME_PAT = re.compile(r'^\d{1,2}:\d{2}$|^(今天|昨天|\d+月\d+日|\d+/\d+)$')
    contacts: list[str] = []
    seen: set[str] = set()

    for text, cx, cy in boxes:
        if cx > 0.35 or cy < 0.10 or cy > 0.95:
            continue
        if TIME_PAT.match(text.strip()):
            continue
        if len(text.strip()) < 2:
            continue
        name = text.strip()
        if name not in seen:
            seen.add(name)
            contacts.append(name)
        if len(contacts) >= limit:
            break

    return contacts


# ── Navigation ─────────────────────────────────────────────────────────────────

def navigate_to_contact(contact: str, bounds: dict, scale: float) -> dict:
    """
    确认微信在最前 → Escape → 点搜索框 → 输入名字 →
    Phase 1: Down+Enter 选中并 OCR 验证标题栏 →
    Phase 2 (fallback): OCR 搜索结果包围框 → 滚动点击。
    返回最新的窗口 bounds。微信不在最前则抛 WeChatNotFront（不发送任何事件）。
    """
    # 关键安全门：确认微信确实在最前并取最新坐标，否则中止——绝不向 Chrome 等窗口发事件。
    fresh = ensure_wechat_front(bounds)
    if fresh is None:
        raise WeChatNotFront()
    bounds = fresh

    key_code(53)  # Escape — dismiss any open overlay
    time.sleep(0.3)

    wx = bounds['X']
    wy = bounds['Y']
    ww = bounds['Width']
    wh = bounds['Height']

    def setup_search():
        _check_abort()
        require_front()                    # 每次输入前再次确认微信在最前
        mouse_click(wx + ww * 0.15, wy + 45)
        time.sleep(0.5)
        require_front()
        subprocess.run(
            ['osascript', '-e', 'tell application "System Events" to keystroke "a" using command down'],
            capture_output=True,
        )
        time.sleep(0.15)
        require_front()
        type_text(contact)
        time.sleep(1.5)  # wait for search results

    setup_search()

    def try_keyboard_select() -> bool:
        """Down+Enter selects the first search result; verify via OCR of chat header."""
        require_front()
        key_code(125)  # Down arrow — move selection to first result
        time.sleep(0.3)
        key_code(36)   # Enter — open it
        time.sleep(1.0)
        with tempfile.NamedTemporaryFile(suffix='.png', delete=False) as f:
            tmp = f.name
        try:
            screenshot_bounds(bounds, scale, tmp)
            boxes = ocr_image_with_boxes(tmp)
        finally:
            try: os.unlink(tmp)
            except OSError: pass
        # Contact name should appear in the chat header (right panel, top 20% of window).
        # Use cx_norm > 0.3 to include narrow-sidebar layouts.
        for text, cx_norm, cy_norm in boxes:
            if contact in text and cx_norm > 0.3 and cy_norm < 0.20:
                return True
        return False

    # Phase 1: keyboard-first — faster; works when WeChat highlights the right result
    if try_keyboard_select():
        return bounds

    # Phase 2: OCR + scroll fallback — re-enter search and scan results manually
    setup_search()

    sidebar_x = wx + ww * 0.15
    sidebar_y = wy + wh * 0.45

    def sidebar_scroll(direction: int, px: int = 300):
        """direction: +1 = up (older/top), -1 = down (newer/bottom)"""
        _check_abort()
        if not guard_front():
            raise WeChatNotFront()
        import Quartz as Q
        p = Q.CGPoint(sidebar_x, sidebar_y)
        Q.CGEventPost(Q.kCGHIDEventTap,
                      Q.CGEventCreateMouseEvent(None, Q.kCGEventMouseMoved, p, 0))
        time.sleep(0.05)
        ev = CGEventCreateScrollWheelEvent2(None, kCGScrollEventUnitPixel, 1,
                                            direction * px, 0, 0)
        CGEventPost(kCGHIDEventTap, ev)
        time.sleep(0.5)

    def try_find_and_click() -> bool:
        with tempfile.NamedTemporaryFile(suffix='.png', delete=False) as f:
            tmp = f.name
        try:
            screenshot_bounds(bounds, scale, tmp)
            boxes = ocr_image_with_boxes(tmp)
        finally:
            try: os.unlink(tmp)
            except OSError: pass

        for text, cx_norm, cy_norm in boxes:
            stripped = text.strip()
            # WeChat search results OCR can merge the name with a message preview:
            # "李嘉俊" (exact) or "李嘉俊（3）" or "李嘉俊 昨天来了" etc.
            # Accept exact match OR name followed by a non-name character.
            is_name_match = (
                stripped == contact
                or (stripped.startswith(contact)
                    and len(stripped) > len(contact)
                    and stripped[len(contact)] in ' \t（【[（「《')
            )
            if is_name_match and cx_norm < 0.35:
                screen_x = wx + cx_norm * ww
                screen_y = wy + cy_norm * wh
                if screen_y > wy + 70:
                    require_front()
                    mouse_click(screen_x, screen_y)
                    time.sleep(1.0)
                    return True
        return False

    # Step 1: scroll to top of search results
    for _ in range(5):
        sidebar_scroll(+1, 400)

    clicked = False

    # Step 2: scan downward, up to 6 pages
    for _ in range(6):
        if try_find_and_click():
            clicked = True
            break
        sidebar_scroll(-1, 250)  # scroll down to see more results

    if not clicked:
        # Last resort: press Enter on whatever WeChat has highlighted
        require_front()
        key_code(36)
        time.sleep(1.0)
        # Verify we landed on the right contact; warn if not (but continue anyway —
        # the scroll loop will collect whatever chat is open and the caller can check
        # the nav_verified field).
        with tempfile.NamedTemporaryFile(suffix='.png', delete=False) as f:
            _tmp = f.name
        try:
            screenshot_bounds(bounds, scale, _tmp)
            _boxes = ocr_image_with_boxes(_tmp)
        finally:
            try: os.unlink(_tmp)
            except OSError: pass
        nav_ok = any(contact in t and cx > 0.3 and cy < 0.20 for t, cx, cy in _boxes)
        if not nav_ok:
            # Could not confirm navigation — surface a warning via a special key
            # that WechatReadTool.ts will surface in the section meta.
            import sys as _sys
            _sys.stderr.write(f'[nav_warn] Could not confirm navigation to "{contact}" after last-resort Enter\n')

    return bounds


# ── Main ───────────────────────────────────────────────────────────────────────

def main():
    raw  = sys.stdin.read().strip()
    args = json.loads(raw) if raw else {}

    # ── 特殊 action: list_contacts ─────────────────────────────────────────────
    if args.get('action') == 'list_contacts':
        if not ensure_wechat_visible():
            print(json.dumps({'error': 'Could not open WeChat.'})); sys.exit(1)
        window = find_wechat_window()
        bounds = window.get('kCGWindowBounds', {})
        scale  = get_scale()
        limit  = int(args.get('limit', 20))
        contacts = get_recent_contacts(bounds, scale, limit)
        print(json.dumps({'contacts': contacts}))
        return

    contact     = args.get('contact', '')
    target_str  = args.get('target_date', '')        # "YYYY-MM-DD"
    navigate    = args.get('navigate', bool(contact))
    today       = date.today()

    target_date: date | None = None
    if target_str:
        try:
            target_date = date.fromisoformat(target_str)
        except ValueError:
            pass

    # Default to 1 week ago when a contact is given but no cutoff date is specified,
    # so the scroll loop doesn't run indefinitely.
    if target_date is None and contact:
        target_date = today - timedelta(days=7)

    # Scroll budget is a SAFETY CAP, not the primary terminator (date-stop and
    # top-stop fire first). Scale it to the day span — ×3 gives ~3 screens/day
    # which is enough for active chats; hard ceiling keeps worst-case runtime
    # under ~2 min/contact even when OCR misses every date separator.
    if 'max_scrolls' in args:
        max_scrolls = int(args['max_scrolls'])
    elif target_date is not None:
        span = (today - target_date).days
        max_scrolls = min(90, max(20, span * 3))
    else:
        max_scrolls = 20

    if not ensure_wechat_visible():
        print(json.dumps({'error': '无法打开/前置微信窗口（等待 ~10s）。请确认微信已安装并已登录。'}))
        sys.exit(1)

    window = find_wechat_window()

    bounds = window.get('kCGWindowBounds', {})
    scale  = get_scale()

    if navigate and contact:
        try:
            bounds = navigate_to_contact(contact, bounds, scale) or bounds
        except WeChatNotFront:
            # 微信无法置于最前——绝不向其他窗口发送点击/键盘，直接安全退出。
            print(json.dumps({
                'error': '微信不在前台，已中止（未向其他窗口发送任何点击或键盘输入）。',
                'lost_focus': True,
            }, ensure_ascii=False))
            sys.exit(1)
        window = find_wechat_window() or window
        bounds = window.get('kCGWindowBounds', bounds)

    # Chat area center (right 2/3 of window, vertical center)
    wx = bounds['X']
    wy = bounds['Y']
    ww = bounds['Width']
    wh = bounds['Height']
    chat_cx = wx + ww * 0.65
    chat_cy = wy + wh * 0.5

    # Ensure WeChat is frontmost before the scroll loop — prevents events landing
    # on other windows. Abort safely if it can't be brought to front.
    if not guard_front():
        print(json.dumps({
            'error': '微信不在前台，已中止（未向其他窗口发送任何点击或键盘输入）。',
            'lost_focus': True,
        }, ensure_ascii=False))
        sys.exit(1)

    # Click the message input box (bottom of window) — safe, won't open images
    # Then press Escape in case an image was accidentally opened
    input_box_y = wy + wh - 40
    mouse_click(chat_cx, input_box_y)
    time.sleep(0.2)
    key_code(53)   # Escape — dismiss anything that opened
    time.sleep(0.2)

    # Write PID file so the user can abort cleanly: `touch /tmp/.wechat_read_abort`
    pid_path = f'/tmp/.wechat_read_{os.getpid()}.pid'
    try:
        with open(pid_path, 'w') as pf:
            pf.write(str(os.getpid()))
    except OSError:
        pid_path = None

    all_lines: list[str] = []
    tmp_files: list[str] = []
    reached_target = False
    hit_top = False
    lost_focus = False
    prev_set: set[str] | None = None   # detect when scroll has no effect (top of chat)
    no_change_count = 0
    date_drought = 0                   # consecutive screens with zero parseable dates

    def refocus() -> bool:
        """Re-assert WeChat as frontmost and refresh geometry before each action.
        Returns False if WeChat is gone (caller should stop)."""
        nonlocal bounds, chat_cx, chat_cy
        cur = ensure_wechat_front(bounds)
        if cur is None:
            return False
        if cur != bounds:                      # moved or resized → recompute targets
            bounds  = cur
            chat_cx = bounds['X'] + bounds['Width']  * 0.65
            chat_cy = bounds['Y'] + bounds['Height'] * 0.5
        return True

    try:
        for i in range(max_scrolls + 1):
            # Check abort signal between every scroll
            if os.path.exists(ABORT_FILE):
                os.unlink(ABORT_FILE)
                break

            # FOCUS GUARD (before screenshot): if the user moved/minimized WeChat,
            # bring it back and refresh bounds so we crop the right region.
            if not refocus():
                lost_focus = True
                break

            with tempfile.NamedTemporaryFile(suffix='.png', delete=False) as f:
                tmp_path = f.name
            tmp_files.append(tmp_path)

            if not screenshot_bounds(bounds, scale, tmp_path):
                break

            lines = ocr_image(tmp_path)
            # Chat-area lines only (skip short sidebar/name fragments) for the
            # top-of-chat fingerprint.
            chat_set = set(l for l in lines if len(l) > 6)

            # Parse all dates visible in the current screenshot
            screen_dates = [d for d in (parse_date_from_line(l, today) for l in lines) if d is not None]

            # Prepend older content (all_lines stays chronological: oldest→newest)
            all_lines = lines + all_lines

            # Stop if no target and only one screen requested
            if target_date is None:
                break

            # ── DATE STOP (three complementary conditions) ──────────────────────
            # (A) Accumulated check: any line older than target in the oldest 150
            #     accumulated lines. Primary stop condition (overshoot-then-trim).
            if crossed_target(all_lines[:150], target_date, today):
                reached_target = True
                break

            if screen_dates:
                date_drought = 0
                # (B) Screen-max check: the NEWEST date visible on the current
                #     screen is already older than the target window. This triggers
                #     when we're deep inside an old day and (A) missed the separator.
                if max(screen_dates) < target_date:
                    reached_target = True
                    break
            else:
                date_drought += 1
                # (C) Date drought: 8 consecutive screens with no parseable date
                #     means we're in a dense message region far past target. Stop.
                if date_drought >= 8:
                    reached_target = True
                    break

            # TOP STOP: Jaccard overlap tolerates OCR jitter between identical
            # screens (exact-string compare would miss the top on a single
            # misread character).
            if prev_set is not None and _jaccard(chat_set, prev_set) > 0.9:
                no_change_count += 1
                if no_change_count >= 2:
                    hit_top = True
                    break
            else:
                no_change_count = 0
            prev_set = chat_set

            if i < max_scrolls:
                # FOCUS GUARD (before scroll): the scroll event must land on
                # WeChat, never on a window the user switched to mid-run.
                if not refocus():
                    lost_focus = True
                    break
                scroll_up(chat_cx, chat_cy, pixels=300)
                time.sleep(0.6)

    finally:
        for p in tmp_files:
            try:
                os.unlink(p)
            except OSError:
                pass
        if pid_path:
            try:
                os.unlink(pid_path)
            except OSError:
                pass

    # Precise cutoff: trim everything older than target_date. Scrolling only had
    # to go FAR ENOUGH; this makes the date boundary exact regardless of overshoot.
    if target_date is not None:
        all_lines = trim_to_window(all_lines, target_date, today)

    # Deduplicate consecutive duplicate lines (OCR overlap between scrolls)
    deduped = []
    for line in all_lines:
        if not deduped or deduped[-1] != line:
            deduped.append(line)

    print(json.dumps({
        'messages': deduped,
        'text': '\n'.join(deduped),
        'reached_target': reached_target,
        'hit_top': hit_top,
        'lost_focus': lost_focus,
        'scroll_count': len(tmp_files) - 1,
    }, ensure_ascii=False))


if __name__ == '__main__':
    main()
