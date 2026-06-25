// Astraea floating selection panel.
//
// A borderless, always-on-top NSPanel hosting a WKWebView that loads the local
// selection bridge UI in embedded mode. It appears near the mouse cursor over
// whatever app the user is in, behaves like a Spotlight-style command palette
// (ESC or click-away dismisses it), and never steals the foreground app's space.
//
// Usage: astraea-panel "http://127.0.0.1:8765/?draft=<id>&embedded=1"

import Cocoa
import WebKit

// Borderless panels refuse key focus by default; override so the user can type.
final class KeyablePanel: NSPanel {
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { true }
}

// Transparent strip over the top bar that lets the user drag the whole window.
final class DragView: NSView {
    override var mouseDownCanMoveWindow: Bool { true }
}

final class AppController: NSObject, NSApplicationDelegate, NSWindowDelegate,
    WKNavigationDelegate {

    private let urlString: String
    private var panel: KeyablePanel!
    private var webView: WKWebView!
    private var heightTimer: Timer?
    private var lastHeight: CGFloat = 0

    private let width: CGFloat = 400
    private var height: CGFloat = 96

    init(urlString: String) {
        self.urlString = urlString
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        let config = WKWebViewConfiguration()
        let userContent = config.userContentController
        userContent.add(WeakScriptMessageHandler(panel: self), name: "astraeaClose")

        let rect = NSRect(x: 0, y: 0, width: width, height: height)
        webView = WKWebView(frame: rect, configuration: config)
        webView.navigationDelegate = self
        // Transparent webview: the white box (with its own rounded corners) is
        // drawn by the web UI, and the panel shadow hugs those opaque pixels. We
        // deliberately do NOT mask the webview to a rounded rect — that mask
        // clipped the title text sitting on the top-left border corner.
        webView.setValue(false, forKey: "drawsBackground")
        webView.wantsLayer = true

        panel = KeyablePanel(
            contentRect: rect,
            styleMask: [.borderless, .nonactivatingPanel, .fullSizeContentView],
            backing: .buffered,
            defer: false
        )
        panel.level = .floating
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = true
        panel.isMovableByWindowBackground = true

        // Host the webview in a container and lay a transparent drag strip over the
        // top bar (as a sibling above the webview, so it actually receives clicks),
        // leaving the ✕ button at the top-right free.
        let container = NSView(frame: rect)
        webView.frame = container.bounds
        webView.autoresizingMask = [.width, .height]
        container.addSubview(webView)

        // A strip over the title (legend) line lets the user grab and move the
        // whole window. It is tall enough to be an easy drag target, yet stops
        // above the input row and short of the right edge so the textarea and the
        // "esc ✕" close button below/beside it stay clickable.
        let dragBar = DragView(frame: NSRect(x: 0, y: height - 30, width: width - 78, height: 30))
        dragBar.autoresizingMask = [.width, .minYMargin]
        container.addSubview(dragBar)

        panel.contentView = container
        panel.delegate = self

        positionNearMouse()

        if let url = URL(string: urlString) {
            webView.load(URLRequest(url: url))
        }

        NSApp.activate(ignoringOtherApps: true)
        panel.makeKeyAndOrderFront(nil)

        // ESC or ⌘W closes the palette. Global monitor works even when panel
        // loses key window state (e.g. user clicked another app).
        NSEvent.addGlobalMonitorForEvents(matching: .keyDown) { [weak self] event in
            if event.keyCode == 53 || (event.keyCode == 13 && event.modifierFlags.contains(.command)) {
                self?.closePanel()
            }
        }
    }

    private func positionNearMouse() {
        let mouse = NSEvent.mouseLocation
        let screen = NSScreen.screens.first { NSMouseInRect(mouse, $0.frame, false) }
            ?? NSScreen.main
        let visible = screen?.visibleFrame
            ?? NSRect(x: 0, y: 0, width: 1440, height: 900)

        var x = mouse.x + 12
        var y = mouse.y - height - 12
        if x + width > visible.maxX { x = visible.maxX - width - 12 }
        if x < visible.minX { x = visible.minX + 12 }
        if y < visible.minY { y = visible.minY + 12 }
        if y + height > visible.maxY { y = visible.maxY - height - 12 }
        panel.setFrameOrigin(NSPoint(x: x, y: y))
    }

    // Web UI -> native bridge ("close" button inside the panel).
    // Once the page is loaded, poll its content height and keep the window fitted
    // to it. evaluateJavaScript is far more reliable here than web -> native
    // postMessage, so the window tracks the reply as it expands.
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        heightTimer?.invalidate()
        heightTimer = Timer.scheduledTimer(withTimeInterval: 0.2, repeats: true) { [weak self] _ in
            self?.syncHeight()
        }
        syncHeight()
    }

    private func syncHeight() {
        let js = "document.documentElement.scrollHeight + ':' + (window.__astraeaClose ? 1 : 0)"
        webView.evaluateJavaScript(js) { [weak self] result, _ in
            guard let self = self, let value = result as? String else { return }
            let parts = value.split(separator: ":")
            if parts.count == 2, parts[1] == "1" {
                self.closePanel()
                return
            }
            guard let raw = parts.first, let height = Double(raw) else { return }
            let h = CGFloat(height)
            if abs(h - self.lastHeight) > 1 {
                self.lastHeight = h
                self.resize(toContentHeight: h)
            }
        }
    }

    // Grow/shrink the window to fit the content, anchored at its top edge, so the
    // reply expands downward and only scrolls once it would exceed the screen.
    private func resize(toContentHeight contentHeight: CGFloat) {
        guard let screen = panel.screen ?? NSScreen.main else { return }
        let visible = screen.visibleFrame
        let target = min(max(contentHeight, 60), visible.height - 24)

        var frame = panel.frame
        let top = frame.maxY
        frame.size.height = target
        frame.origin.y = max(top - target, visible.minY + 12)
        height = target
        panel.setFrame(frame, display: true, animate: false)
    }

    fileprivate func closePanel() {
        NSApp.terminate(nil)
    }
}

// WKUserContentController retains its message handlers, which would normally
// create a retain cycle (panel → webView → config → userContentController → handler).
// We avoid the cycle by using a wrapper object that stores a WeakBox reference to the
// panel, so the panel can be freed.
final class WeakScriptMessageHandler: NSObject, WKScriptMessageHandler {
    private weak var panel: AppController?

    init(panel: AppController) {
        self.panel = panel
    }

    func userContentController(_ userContentController: WKUserContentController,
                               didReceive message: WKScriptMessage) {
        if message.name == "astraeaClose" {
            panel?.closePanel()
        }
    }
}

let arguments = CommandLine.arguments
let target = arguments.count > 1 ? arguments[1] : "http://127.0.0.1:8765/?embedded=1"

let app = NSApplication.shared
app.setActivationPolicy(.accessory) // no Dock icon / menu bar takeover
let controller = AppController(urlString: target)
app.delegate = controller
app.run()
