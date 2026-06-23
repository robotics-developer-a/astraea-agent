// SpreadsheetTool — structured .xlsx reader/writer.
//
// INTENT: Keep spreadsheet semantics out of the generic text Read/Write tools.
// Excel workbooks are ZIP packages of XML parts; treating them as strings loses
// workbook structure and can corrupt files. This tool exposes a small structured
// surface that models sheets and cells directly.

import { basename, dirname, join } from 'node:path'
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { buildTool } from '../Tool'
import type { ToolCallResult, ToolContext } from '../Tool'
import { checkWritePermission } from '../fileWriteGate'
import { validateWrite, recordWrite } from '../readFileState'
import { recordRead } from '../readFileState'
import { captureFile } from '../../services/rewind/checkpointStore'

type CellValue = string | number | boolean | null

interface SheetData {
  name: string
  rows: CellValue[][]
}

interface WorkbookData {
  sheets: SheetData[]
}

export const SpreadsheetTool = buildTool({
  name: 'Spreadsheet',
  description: `Read and write Excel .xlsx spreadsheets as structured tables.

Use this for .xlsx files instead of Read/Write/Edit. Read returns sheet names and Markdown table previews.
Write creates or overwrites a simple .xlsx workbook from rows. Legacy .xls is not supported.`,
  isReadOnly: input => String(input['action'] ?? 'read') === 'read',
  isConcurrencySafe: input => String(input['action'] ?? 'read') === 'read',
  inputSchema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['read', 'write'],
        description: 'read to inspect an .xlsx workbook, write to create/overwrite one',
      },
      file_path: {
        type: 'string',
        description: 'Path to the .xlsx file',
      },
      sheet: {
        type: 'string',
        description: 'Sheet name to read or write. Defaults to the first sheet for read, Sheet1 for write.',
      },
      rows: {
        type: 'array',
        description: 'For write: 2D array of cell values, e.g. [["Name","Qty"],["A",3]]',
      },
      limit_rows: {
        type: 'number',
        description: 'For read: maximum rows to show per sheet preview (default 50, max 200)',
      },
      limit_cols: {
        type: 'number',
        description: 'For read: maximum columns to show per sheet preview (default 20, max 50)',
      },
    },
    required: ['action', 'file_path'],
  },

  async call(input, ctx): Promise<ToolCallResult> {
    const action = String(input['action'] ?? 'read')
    const filePath = String(input['file_path'] ?? '')
    if (!filePath) return { output: 'file_path is required.', isError: true }

    if (filePath.toLowerCase().endsWith('.xls')) {
      return {
        output: 'Legacy .xls workbooks are not supported. Save or convert the file as .xlsx first.',
        isError: true,
      }
    }
    if (!filePath.toLowerCase().endsWith('.xlsx')) {
      return { output: 'Spreadsheet only supports .xlsx files.', isError: true }
    }

    if (action === 'read') {
      return readWorkbookTool(filePath, input)
    }
    if (action === 'write') {
      return writeWorkbookTool(filePath, input, ctx)
    }
    return { output: `Unknown Spreadsheet action: ${action}`, isError: true }
  },

  renderResult(input, output, isError) {
    if (isError) return null
    const action = String(input['action'] ?? 'read')
    const filePath = String(input['file_path'] ?? '')
    if (action === 'read') return [`Spreadsheet read ← ${filePath}`]
    return [`Spreadsheet written → ${filePath}`, ...output.split('\n').slice(0, 3)]
  },
})

async function readWorkbookTool(filePath: string, input: Record<string, unknown>): Promise<ToolCallResult> {
  if (!existsSync(filePath)) return { output: `File not found: ${filePath}`, isError: true }

  let workbook: WorkbookData
  try {
    workbook = await readXlsx(filePath)
  } catch (err) {
    return { output: `Failed to read .xlsx workbook: ${String(err)}`, isError: true }
  }

  const wantedSheet = typeof input['sheet'] === 'string' ? String(input['sheet']).trim() : ''
  const selected = wantedSheet
    ? workbook.sheets.filter(s => s.name === wantedSheet)
    : workbook.sheets.slice(0, 3)

  if (selected.length === 0) {
    return {
      output: `Sheet not found: ${wantedSheet}. Available sheets: ${workbook.sheets.map(s => s.name).join(', ')}`,
      isError: true,
    }
  }

  const limitRows = clampNumber(input['limit_rows'], 50, 1, 200)
  const limitCols = clampNumber(input['limit_cols'], 20, 1, 50)
  const parts = [`Workbook: ${basename(filePath)}`, `Sheets: ${workbook.sheets.map(s => s.name).join(', ')}`]

  for (const sheet of selected) {
    parts.push('', `Sheet: ${sheet.name}`, markdownTable(sheet.rows, limitRows, limitCols))
  }

  recordRead(filePath, false)
  return { output: parts.join('\n') }
}

async function writeWorkbookTool(
  filePath: string,
  input: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolCallResult> {
  const rows = normalizeRows(input['rows'])
  if (rows.length === 0) {
    return { output: 'rows must be a non-empty 2D array.', isError: true }
  }

  const gate = await checkWritePermission(filePath, ctx, 'write')
  if (!gate.proceed) return { output: gate.rejection!, isError: true }

  if (existsSync(filePath)) {
    const rejection = validateWrite(filePath)
    if (rejection) return { output: rejection, isError: true }
  }

  const sheetName = sanitizeSheetName(String(input['sheet'] ?? 'Sheet1'))
  try {
    captureFile(filePath)
    await writeSimpleXlsx(filePath, { sheets: [{ name: sheetName, rows }] })
    recordWrite(filePath)
    return {
      output: [
        `Written workbook: ${filePath}`,
        `Sheet: ${sheetName}`,
        `Rows: ${rows.length}`,
        `Columns: ${Math.max(...rows.map(r => r.length))}`,
      ].join('\n'),
    }
  } catch (err) {
    return { output: `Failed to write .xlsx workbook: ${String(err)}`, isError: true }
  }
}

async function readXlsx(filePath: string): Promise<WorkbookData> {
  const workbookXml = await unzipText(filePath, 'xl/workbook.xml')
  const relsXml = await unzipText(filePath, 'xl/_rels/workbook.xml.rels')
  const sharedStringsXml = await unzipOptionalText(filePath, 'xl/sharedStrings.xml')

  const rels = parseRelationships(relsXml)
  const sharedStrings = sharedStringsXml ? parseSharedStrings(sharedStringsXml) : []
  const sheetRefs = parseWorkbookSheets(workbookXml)

  const sheets: SheetData[] = []
  for (const ref of sheetRefs) {
    const target = rels.get(ref.rId)
    if (!target) continue
    const normalizedTarget = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\.\//, '')}`
    const sheetXml = await unzipText(filePath, normalizedTarget)
    sheets.push({ name: ref.name, rows: parseWorksheetRows(sheetXml, sharedStrings) })
  }

  if (sheets.length === 0) throw new Error('No worksheets found.')
  return { sheets }
}

async function writeSimpleXlsx(filePath: string, workbook: WorkbookData): Promise<void> {
  const temp = mkdtempSync(join(tmpdir(), 'astraea-xlsx-'))
  try {
    mkdirSync(join(temp, '_rels'), { recursive: true })
    mkdirSync(join(temp, 'xl', '_rels'), { recursive: true })
    mkdirSync(join(temp, 'xl', 'worksheets'), { recursive: true })
    mkdirSync(dirname(filePath), { recursive: true })

    const sheet = workbook.sheets[0]!
    writeFileSync(join(temp, '[Content_Types].xml'), contentTypesXml(), 'utf8')
    writeFileSync(join(temp, '_rels', '.rels'), rootRelsXml(), 'utf8')
    writeFileSync(join(temp, 'xl', 'workbook.xml'), workbookXml(sheet.name), 'utf8')
    writeFileSync(join(temp, 'xl', '_rels', 'workbook.xml.rels'), workbookRelsXml(), 'utf8')
    writeFileSync(join(temp, 'xl', 'styles.xml'), stylesXml(), 'utf8')
    writeFileSync(join(temp, 'xl', 'worksheets', 'sheet1.xml'), worksheetXml(sheet.rows), 'utf8')

    await runZip(temp, filePath)
  } finally {
    rmSync(temp, { recursive: true, force: true })
  }
}

async function unzipText(zipPath: string, entry: string): Promise<string> {
  const proc = Bun.spawn(['unzip', '-p', zipPath, entry], { stdout: 'pipe', stderr: 'pipe' })
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  if (code !== 0) throw new Error(stderr.trim() || `Missing zip entry ${entry}`)
  return stdout
}

async function unzipOptionalText(zipPath: string, entry: string): Promise<string | null> {
  try {
    return await unzipText(zipPath, entry)
  } catch {
    return null
  }
}

async function runZip(cwd: string, outputPath: string): Promise<void> {
  const proc = Bun.spawn(['zip', '-qr', outputPath, '.'], { cwd, stdout: 'pipe', stderr: 'pipe' })
  const [stderr, code] = await Promise.all([new Response(proc.stderr).text(), proc.exited])
  if (code !== 0) throw new Error(stderr.trim() || 'zip failed')
}

function parseRelationships(xml: string): Map<string, string> {
  const rels = new Map<string, string>()
  for (const m of xml.matchAll(/<Relationship\b([^>]*)\/?>/g)) {
    const attrs = parseAttrs(m[1] ?? '')
    const id = attrs.get('Id')
    const target = attrs.get('Target')
    if (id && target) rels.set(id, target)
  }
  return rels
}

function parseWorkbookSheets(xml: string): Array<{ name: string; rId: string }> {
  const sheets: Array<{ name: string; rId: string }> = []
  for (const m of xml.matchAll(/<sheet\b([^>]*)\/?>/g)) {
    const attrs = parseAttrs(m[1] ?? '')
    const name = attrs.get('name')
    const rId = attrs.get('r:id')
    if (name && rId) sheets.push({ name: decodeXml(name), rId })
  }
  return sheets
}

function parseSharedStrings(xml: string): string[] {
  const strings: string[] = []
  for (const m of xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)) {
    const text = [...(m[1] ?? '').matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)]
      .map(t => decodeXml(t[1] ?? ''))
      .join('')
    strings.push(text)
  }
  return strings
}

function parseWorksheetRows(xml: string, sharedStrings: string[]): CellValue[][] {
  const rows: CellValue[][] = []
  for (const rowMatch of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const rowCells: CellValue[] = []
    for (const cellMatch of (rowMatch[1] ?? '').matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
      const attrs = parseAttrs(cellMatch[1] ?? '')
      const ref = attrs.get('r') ?? ''
      const col = ref ? columnIndex(ref.replace(/\d+$/, '')) : rowCells.length
      while (rowCells.length < col) rowCells.push('')
      rowCells[col] = parseCellValue(cellMatch[2] ?? '', attrs.get('t'), sharedStrings)
    }
    rows.push(trimTrailing(rowCells))
  }
  return rows
}

function parseCellValue(xml: string, type: string | undefined, sharedStrings: string[]): CellValue {
  if (type === 'inlineStr') {
    return [...xml.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map(m => decodeXml(m[1] ?? '')).join('')
  }
  const v = xml.match(/<v\b[^>]*>([\s\S]*?)<\/v>/)?.[1] ?? ''
  if (type === 's') return sharedStrings[Number(v)] ?? ''
  if (type === 'b') return v === '1'
  if (v === '') return ''
  const n = Number(v)
  return Number.isFinite(n) ? n : decodeXml(v)
}

function parseAttrs(raw: string): Map<string, string> {
  const attrs = new Map<string, string>()
  for (const m of raw.matchAll(/([:\w-]+)="([^"]*)"/g)) {
    attrs.set(m[1]!, m[2]!)
  }
  return attrs
}

function markdownTable(rows: CellValue[][], limitRows: number, limitCols: number): string {
  if (rows.length === 0) return '(empty sheet)'
  const shown = rows.slice(0, limitRows).map(r => r.slice(0, limitCols))
  const width = Math.max(1, ...shown.map(r => r.length))
  const normalized = shown.map(r => {
    const cells = [...r]
    while (cells.length < width) cells.push('')
    return cells.map(formatCell)
  })
  const header = normalized[0]!
  const body = normalized.slice(1)
  const lines = [
    `| ${header.join(' | ')} |`,
    `| ${header.map(() => '---').join(' | ')} |`,
    ...body.map(r => `| ${r.join(' | ')} |`),
  ]
  if (rows.length > limitRows) lines.push(`\n(showing ${limitRows} of ${rows.length} rows)`)
  return lines.join('\n')
}

function normalizeRows(raw: unknown): CellValue[][] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((row): row is unknown[] => Array.isArray(row))
    .map(row => row.map(cell => {
      if (cell === null || typeof cell === 'string' || typeof cell === 'number' || typeof cell === 'boolean') return cell
      return String(cell)
    }))
}

function worksheetXml(rows: CellValue[][]): string {
  const body = rows.map((row, rIdx) => {
    const cells = row.map((cell, cIdx) => cellXml(cell, `${columnName(cIdx)}${rIdx + 1}`)).join('')
    return `<row r="${rIdx + 1}">${cells}</row>`
  }).join('')
  return xmlDecl() + `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`
}

function cellXml(value: CellValue, ref: string): string {
  if (value === null || value === '') return `<c r="${ref}"/>`
  if (typeof value === 'number') return `<c r="${ref}"><v>${value}</v></c>`
  if (typeof value === 'boolean') return `<c r="${ref}" t="b"><v>${value ? 1 : 0}</v></c>`
  return `<c r="${ref}" t="inlineStr"><is><t>${escapeXml(value)}</t></is></c>`
}

function workbookXml(sheetName: string): string {
  return xmlDecl()
    + `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${escapeXml(sheetName)}" sheetId="1" r:id="rId1"/></sheets></workbook>`
}

function workbookRelsXml(): string {
  return xmlDecl()
    + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'
}

function rootRelsXml(): string {
  return xmlDecl()
    + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'
}

function contentTypesXml(): string {
  return xmlDecl()
    + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>'
}

function stylesXml(): string {
  return xmlDecl()
    + '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="1"><fill><patternFill patternType="none"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs></styleSheet>'
}

function xmlDecl(): string {
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
}

function sanitizeSheetName(name: string): string {
  const clean = name.replace(/[\[\]:*?/\\]/g, ' ').trim().slice(0, 31)
  return clean || 'Sheet1'
}

function columnIndex(name: string): number {
  let n = 0
  for (const ch of name.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64)
  return Math.max(0, n - 1)
}

function columnName(index: number): string {
  let n = index + 1
  let out = ''
  while (n > 0) {
    const r = (n - 1) % 26
    out = String.fromCharCode(65 + r) + out
    n = Math.floor((n - 1) / 26)
  }
  return out
}

function trimTrailing(row: CellValue[]): CellValue[] {
  let end = row.length
  while (end > 0 && (row[end - 1] === '' || row[end - 1] === null)) end--
  return row.slice(0, end)
}

function clampNumber(raw: unknown, fallback: number, min: number, max: number): number {
  const n = Number(raw)
  if (!Number.isFinite(n)) return fallback
  return Math.max(min, Math.min(max, Math.floor(n)))
}

function formatCell(value: CellValue): string {
  return String(value ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ')
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function decodeXml(text: string): string {
  return text
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}
