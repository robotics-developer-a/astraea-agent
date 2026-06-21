// 测试夹具：组装一个最小有效 PDF（每页一行文字，xref 偏移在组装时实算）。
// 仅供 *.test.ts 使用，让 PDF 抽取走真实 unpdf 解析而非 mock。
export function buildTestPdf(pageTexts: string[]): Uint8Array {
  const enc = new TextEncoder()
  let body = '%PDF-1.4\n'
  const offsets: number[] = []
  const obj = (s: string) => { offsets.push(body.length); body += s }
  const nPages = pageTexts.length
  const pageObjStart = 3
  const kids = pageTexts.map((_, i) => `${pageObjStart + i * 2} 0 R`).join(' ')
  obj(`1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n`)
  obj(`2 0 obj<</Type/Pages/Kids[${kids}]/Count ${nPages}>>endobj\n`)
  pageTexts.forEach((t, i) => {
    const pageNum = pageObjStart + i * 2
    const contentNum = pageNum + 1
    obj(`${pageNum} 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents ${contentNum} 0 R/Resources<</Font<</F1 ${pageObjStart + nPages * 2} 0 R>>>>>>endobj\n`)
    const stream = `BT /F1 24 Tf 72 700 Td (${t}) Tj ET`
    obj(`${contentNum} 0 obj<</Length ${stream.length}>>stream\n${stream}\nendstream endobj\n`)
  })
  const fontNum = pageObjStart + nPages * 2
  obj(`${fontNum} 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\n`)
  const xrefStart = body.length
  const total = offsets.length + 1
  let xref = `xref\n0 ${total}\n0000000000 65535 f \n`
  for (const o of offsets) xref += String(o).padStart(10, '0') + ' 00000 n \n'
  body += xref
  body += `trailer<</Size ${total}/Root 1 0 R>>\nstartxref\n${xrefStart}\n%%EOF`
  return enc.encode(body)
}
