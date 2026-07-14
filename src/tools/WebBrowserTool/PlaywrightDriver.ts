// PlaywrightDriver — BrowserDriver 的 Playwright 实现
// 懒加载：首次 createPlaywrightDriver() 调用时才导入 playwright，
// 避免在 playwright 未安装时启动报错。

import type { BrowserDriver } from './index.js'

const MAX_CONTENT_CHARS = 8000

// String-form evaluate avoids needing "dom" in tsconfig lib — runs in browser context.
const EXTRACT_TEXT_SCRIPT = `(() => {
  const clone = document.body.cloneNode(true);
  clone.querySelectorAll('script,style,noscript').forEach(el => el.remove());
  return (clone.innerText || clone.textContent || '').trim().slice(0, ${MAX_CONTENT_CHARS});
})()`

async function extractText(page: import('playwright').Page): Promise<string> {
  return page.evaluate(EXTRACT_TEXT_SCRIPT) as Promise<string>
}

export async function createPlaywrightDriver(): Promise<BrowserDriver> {
  // Dynamic import — 未安装时 throw，调用方捕获并降级
  const { chromium } = await import('playwright')

  let browser: import('playwright').Browser | null = null
  let page: import('playwright').Page | null = null
  let available = false

  // launch 自带超时:二进制损坏/系统资源耗尽时 launch 可能长挂,30s 内起不来就报错
  const LAUNCH_TIMEOUT_MS = 30_000

  async function ensurePage(): Promise<import('playwright').Page> {
    if (!browser || !browser.isConnected()) {
      browser = await chromium.launch({ headless: true, timeout: LAUNCH_TIMEOUT_MS })
    }
    if (!page || page.isClosed()) {
      page = await browser.newPage()
    }
    return page
  }

  try {
    // Smoke-test: launch browser to confirm binaries exist
    browser = await chromium.launch({ headless: true, timeout: LAUNCH_TIMEOUT_MS })
    page = await browser.newPage()
    available = true
  } catch {
    available = false
  }

  return {
    isAvailable: () => available,

    async navigate(url) {
      const p = await ensurePage()
      await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 })
      const title = await p.title()
      const content = (await extractText(p)).slice(0, MAX_CONTENT_CHARS)
      return { title, url: p.url(), content }
    },

    async screenshot() {
      const p = await ensurePage()
      const buf = await p.screenshot({ type: 'png', fullPage: false })
      return buf.toString('base64')
    },

    async click(selector) {
      const p = await ensurePage()
      await p.click(selector, { timeout: 5000 })
      await p.waitForLoadState('domcontentloaded')
      const title = await p.title()
      const content = (await extractText(p)).slice(0, MAX_CONTENT_CHARS)
      return { title, url: p.url(), content }
    },

    async type(selector, text) {
      const p = await ensurePage()
      await p.fill(selector, text, { timeout: 5000 })
      const title = await p.title()
      const content = (await extractText(p)).slice(0, MAX_CONTENT_CHARS)
      return { title, url: p.url(), content }
    },

    async scroll() {
      const p = await ensurePage()
      await p.evaluate('window.scrollBy(0, window.innerHeight)')
      const title = await p.title()
      const content = (await extractText(p)).slice(0, MAX_CONTENT_CHARS)
      return { title, url: p.url(), content }
    },

    // 工具层动作超时后调用:关掉当前 page,在途操作立即 reject;
    // browser 实例保留,下一次 ensurePage 会重开新页,不用付重新 launch 的成本。
    async dispose() {
      const p = page
      page = null
      if (p && !p.isClosed()) {
        try { await p.close() } catch { /* already closing */ }
      }
    },
  }
}
