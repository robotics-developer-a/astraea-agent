// 方案 B: PDF → 文字层抽取 + 按页分块（纯 JS，走 unpdf/pdf.js，无原生依赖、Bun 可用）
// 当前所有 provider 仅纯文本 chat，故走「抽取文字层」而非「PDF→图片」路线。
import { extractText, getDocumentProxy } from 'unpdf'

export const PDF_MAX_PAGES_PER_READ = 20

type PagesResult = { pages: number[] } | { error: string }

// 解析 pages 参数（如 "3" / "1-5"）→ 1-based 页号列表。不传则第 1 页起、上限 20 页。
export function parsePagesParam(pages: string | undefined, totalPages: number): PagesResult {
  if (pages === undefined) {
    const end = Math.min(PDF_MAX_PAGES_PER_READ, totalPages)
    return { pages: Array.from({ length: end }, (_, i) => i + 1) }
  }
  const t = pages.trim()
  let list: number[]
  const range = /^(\d+)-(\d+)$/.exec(t)
  const single = /^(\d+)$/.exec(t)
  if (range) {
    const a = Number(range[1]); const b = Number(range[2])
    if (a < 1 || b < a) return { error: `Invalid page range "${pages}" (use e.g. "1-5").` }
    list = Array.from({ length: b - a + 1 }, (_, i) => a + i)
  } else if (single) {
    const n = Number(single[1])
    if (n < 1) return { error: `Invalid page "${pages}".` }
    list = [n]
  } else {
    return { error: `Invalid pages "${pages}". Use a single page ("3") or a range ("1-5").` }
  }
  if (list.length > PDF_MAX_PAGES_PER_READ) {
    return { error: `Too many pages (${list.length} > ${PDF_MAX_PAGES_PER_READ} per read). Request at most ${PDF_MAX_PAGES_PER_READ} pages, then continue with the next range.` }
  }
  const oob = list.find(n => n > totalPages)
  if (oob !== undefined) return { error: `Page ${oob} out of range (PDF has ${totalPages} pages).` }
  return { pages: list }
}

function pagesLabel(pages: number[]): string {
  if (pages.length === 0) return ''
  if (pages.length === 1) return String(pages[0])
  const contiguous = pages.every((p, i) => i === 0 || p === pages[i - 1]! + 1)
  return contiguous ? `${pages[0]}-${pages[pages.length - 1]}` : pages.join(',')
}

// 带页码锚点的输出，便于模型续读与定位。
export function formatPdfOutput(path: string, pages: number[], totalPages: number, texts: string[]): string {
  const body = pages.map((p, i) => `--- Page ${p} ---\n${texts[i] ?? ''}`).join('\n\n')
  return `<pdf path="${path}" pages="${pagesLabel(pages)}" total_pages="${totalPages}">\n${body}\n</pdf>`
}

// 逐页抽取文字层。texts 为全部页（caller 自行切片）。
export async function extractPdfText(bytes: Uint8Array): Promise<{ totalPages: number; texts: string[] }> {
  const doc = await getDocumentProxy(bytes)
  const { text } = await extractText(doc, { mergePages: false })
  return { totalPages: doc.numPages, texts: Array.isArray(text) ? text : [text] }
}
