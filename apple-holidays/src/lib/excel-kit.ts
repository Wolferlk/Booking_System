/**
 * The house style for every Excel file ops sends or downloads.
 *
 * The daily report's workbook set the shape — a dashboard tab first, then one
 * population per tab, each one naming itself, saying how it was counted and
 * carrying its own totals — and the weekly, Ops Board and MC workbooks are
 * built on the same parts so a reader learns the layout once.
 *
 * What the kit adds over a plain sheet:
 *
 *  - **Data tabs** (`addTable`): row 1 names it, row 2 explains it, row 3
 *    carries its totals, row 4 is the frozen, filterable header, data from
 *    row 5. A live `SUBTOTAL` row under the data re-adds itself when a reader
 *    filters, so a filtered sheet never shows a stale total.
 *  - **In-cell visuals**: data bars on volume columns and colour scales on
 *    matrices, written as conditional formats so they follow edits and sorts.
 *  - **Breakdowns** (`addBreakdown`): one row per group with its share of the
 *    whole and a bar, the pivot a manager would otherwise build by hand.
 *  - **Heatmaps** (`addMatrix`): two dimensions crossed, totals both ways.
 *  - **Canvas** (`Canvas`): a free-layout sheet for dashboards — banner, KPI
 *    tiles, section titles, small tables and a linked tab index.
 *
 * Isomorphic on purpose: nothing here touches Node or the DOM at import time,
 * so the reports runner uses it on the server and the board pages use it in
 * the browser.
 */
import ExcelJS from 'exceljs'

export { ExcelJS }

// ─── Palette ──────────────────────────────────────────────────────────────────

export const P = {
  deep: 'FF134E4A',
  brand: 'FF0F766E',
  brandWash: 'FFE6F4F1',
  indigo: 'FF4F46E5',
  indigoWash: 'FFEEF2FF',
  green: 'FF059669',
  blue: 'FF0284C7',
  blueWash: 'FFE0F2FE',
  b2b: 'FF2563EB',
  b2bWash: 'FFEFF6FF',
  b2c: 'FF7C3AED',
  b2cWash: 'FFF5F3FF',
  amber: 'FFD97706',
  amberWash: 'FFFEF3C7',
  hotelWash: 'FFFFFBEB',
  orange: 'FFEA580C',
  pink: 'FFDB2777',
  red: 'FFDC2626',
  redWash: 'FFFEE2E2',
  okWash: 'FFD1FAE5',
  okInk: 'FF065F46',
  warnWash: 'FFFEF3C7',
  warnInk: 'FF92400E',
  badWash: 'FFFEE2E2',
  badInk: 'FF991B1B',
  naInk: 'FF94A3B8',
  ink: 'FF0F172A',
  body: 'FF334155',
  muted: 'FF64748B',
  line: 'FFE2E8F0',
  zebra: 'FFF8FAFC',
  header: 'FF1E293B',
  cancelled: 'FFF1F5F9',
  pendingWash: 'FFFFF7ED',
  white: 'FFFFFFFF',
}

/** Categorical colours for tabs and series, in a fixed order. */
export const SERIES = [P.brand, P.indigo, P.blue, P.amber, P.b2c, P.green, P.pink, P.orange, P.red, P.muted]

export const FONT = 'Calibri'
export const DATE_FMT = 'dd mmm yyyy'
export const STAMP_FMT = 'dd mmm yyyy hh:mm'
const THIN = { style: 'thin' as const, color: { argb: P.line } }

// ─── Small helpers ────────────────────────────────────────────────────────────

export const fill = (argb: string): ExcelJS.Fill => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } })

/** `yyyy-mm-dd` → a real date cell. Empty stays empty rather than 1900-01-00. */
export function day(iso: string | null | undefined): Date | null {
  if (!iso) return null
  const t = Date.parse(`${String(iso).slice(0, 10)}T00:00:00Z`)
  return isNaN(t) ? null : new Date(t)
}

export function stamp(iso: string | null | undefined): Date | null {
  if (!iso) return null
  const t = Date.parse(iso)
  return isNaN(t) ? null : new Date(t)
}

export const yes = (b: boolean) => (b ? 'Yes' : 'No')

/** Excel sheet names: ≤31 chars, none of []:*?/\ */
export function sheetName(s: string): string {
  return s.replace(/[[\]:*?/\\]/g, ' ').slice(0, 31)
}

/** 1 → A, 27 → AA. */
export function colLetter(n: number): string {
  let s = ''
  while (n > 0) {
    const m = (n - 1) % 26
    s = String.fromCharCode(65 + m) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}

/** Whole days from a to b, both `yyyy-mm-dd`. Null when either is missing. */
export function daysBetween(a: string | null | undefined, b: string | null | undefined): number | null {
  if (!a || !b) return null
  const d = Math.round((Date.parse(`${b.slice(0, 10)}T00:00:00Z`) - Date.parse(`${a.slice(0, 10)}T00:00:00Z`)) / 86_400_000)
  return isNaN(d) ? null : d
}

/** Every `yyyy-mm-dd` from a to b inclusive (capped so a bad range cannot run away). */
export function dateRange(from: string, to: string, cap = 400): string[] {
  const out: string[] = []
  let t = Date.parse(`${from}T00:00:00Z`)
  const end = Date.parse(`${to}T00:00:00Z`)
  if (isNaN(t) || isNaN(end)) return out
  while (t <= end && out.length < cap) {
    out.push(new Date(t).toISOString().slice(0, 10))
    t += 86_400_000
  }
  return out
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** `2026-10-13` → "Tue 13 Oct". */
export function shortDay(iso: string): string {
  const t = Date.parse(`${iso.slice(0, 10)}T00:00:00Z`)
  if (isNaN(t)) return iso
  const d = new Date(t)
  return `${WEEKDAYS[d.getUTCDay()]} ${String(d.getUTCDate()).padStart(2, '0')} ${MONTHS[d.getUTCMonth()]}`
}

export function pct(part: number, whole: number): number | null {
  return whole ? part / whole : null
}

/** Group rows by a key, keeping first-seen order. */
export function groupBy<T>(rows: T[], key: (r: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>()
  for (const r of rows) {
    const k = key(r)
    const arr = m.get(k)
    if (arr) arr.push(r)
    else m.set(k, [r])
  }
  return m
}

// ─── Workbook ─────────────────────────────────────────────────────────────────

export function newWorkbook(title: string, created?: Date): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'AppleHolidays Operations'
  wb.created = created ?? new Date()
  wb.title = title
  // Opens on the first tab with the window maximised.
  wb.views = [{ x: 0, y: 0, width: 28000, height: 16000, firstSheet: 0, activeTab: 0, visibility: 'visible' }]
  // Totals are live formulas; recalculate on open so they never show stale.
  wb.calcProperties = { fullCalcOnLoad: true }
  return wb
}

export async function workbookBuffer(wb: ExcelJS.Workbook): Promise<ArrayBuffer> {
  return (await wb.xlsx.writeBuffer()) as ArrayBuffer
}

/** Browser only: build the file and hand it to the viewer as a download. */
export async function downloadWorkbook(wb: ExcelJS.Workbook, filename: string): Promise<void> {
  const buf = await workbookBuffer(wb)
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

const PAGE: Partial<ExcelJS.PageSetup> = {
  orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9,
  margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.3, footer: 0.3 },
}

function footer(ws: ExcelJS.Worksheet) {
  ws.headerFooter.oddFooter = '&L&8AppleHolidays Operations&C&8&A&R&8Page &P of &N'
}

// ─── Conditional formats ──────────────────────────────────────────────────────

let priority = 1

/**
 * A bar inside each cell, scaled to the column.
 *
 * Solid, not gradient, on purpose: ExcelJS 4.4 only writes the x14 extension a
 * data bar needs when `gradient` is false — a gradient bar is written with a
 * dangling `<x14:id/>` that Excel can flag as a damaged file.
 */
export function dataBar(ws: ExcelJS.Worksheet, ref: string, argb: string) {
  ws.addConditionalFormatting({
    ref,
    rules: [{
      type: 'dataBar', priority: priority++, gradient: false, border: false, minLength: 0, maxLength: 100, showValue: true,
      cfvo: [{ type: 'min' }, { type: 'max' }], color: { argb },
    } as unknown as ExcelJS.ConditionalFormattingRule],
  })
}

/** White → colour heat over a range. */
export function heat(ws: ExcelJS.Worksheet, ref: string, argb: string = P.brand) {
  ws.addConditionalFormatting({
    ref,
    rules: [{
      type: 'colorScale', priority: priority++,
      cfvo: [{ type: 'min' }, { type: 'max' }],
      color: [{ argb: P.white }, { argb }],
    } as unknown as ExcelJS.ConditionalFormattingRule],
  })
}

/** Red → amber → green for a 0–1 share column. */
export function traffic(ws: ExcelJS.Worksheet, ref: string) {
  ws.addConditionalFormatting({
    ref,
    rules: [{
      type: 'colorScale', priority: priority++,
      cfvo: [{ type: 'num', value: 0 }, { type: 'num', value: 0.6 }, { type: 'num', value: 1 }],
      color: [{ argb: 'FFFCA5A5' }, { argb: 'FFFDE68A' }, { argb: 'FF6EE7B7' }],
    } as unknown as ExcelJS.ConditionalFormattingRule],
  })
}

// ─── Column model ─────────────────────────────────────────────────────────────

export type Kind = 'text' | 'int' | 'num' | 'date' | 'stamp' | 'money' | 'state' | 'flag' | 'yes' | 'source' | 'pct' | 'link'

export interface Col<T> {
  header: string
  width: number
  kind?: Kind
  value: (r: T) => unknown
  /** Text columns that hold sentences wrap instead of overflowing. */
  wrap?: boolean
  /** Live footer: SUBTOTAL so it re-adds when the sheet is filtered. */
  total?: 'sum' | 'avg' | 'count'
  /** In-cell bar, scaled to the column. */
  bar?: string
  /** Colour scale over the column. */
  heat?: string
  /** Per-cell colour override, e.g. a negative variance in red. */
  tone?: (r: T) => 'good' | 'warn' | 'bad' | null
}

export interface TableSpec<T> {
  name: string
  title: string
  description: string
  tab: string
  cols: Col<T>[]
  rows: T[]
  /** Short totals line printed in row 3. */
  totals?: string
  /** Rows to tint as a whole, e.g. cancelled files. */
  rowTint?: (r: T) => string | null
  /** Strike the row through (a cancelled file). */
  strike?: (r: T) => boolean
  empty?: string
  /** One line for the Overview index. */
  what?: string
  /** Columns to keep visible while scrolling right. Default 1. */
  freezeCols?: number
}

const STATE_COLORS: Record<string, [string, string]> = {
  Done: [P.okWash, P.okInk], Yes: [P.okWash, P.okInk], Ready: [P.okWash, P.okInk],
  Allocated: [P.okWash, P.okInk], Completed: [P.okWash, P.okInk], Approved: [P.okWash, P.okInk],
  Accepted: [P.okWash, P.okInk], Pass: [P.okWash, P.okInk], 'On track': [P.okWash, P.okInk], Good: [P.okWash, P.okInk],
  Assigned: [P.okWash, P.okInk], Balanced: [P.okWash, P.okInk],
  Partial: [P.warnWash, P.warnInk], 'Part-allocated': [P.warnWash, P.warnInk], Requested: [P.warnWash, P.warnInk],
  Sent: [P.warnWash, P.warnInk], 'Due today': [P.warnWash, P.warnInk], Medium: [P.warnWash, P.warnInk],
  Warning: [P.warnWash, P.warnInk], Watch: [P.blueWash, P.blue], 'Cancel pending': [P.warnWash, P.warnInk],
  'Awaiting approval': [P.warnWash, P.warnInk], Low: [P.blueWash, P.blue],
  Pending: [P.badWash, P.badInk], No: [P.badWash, P.badInk], 'Not ready': [P.badWash, P.badInk],
  'Not requested': [P.badWash, P.badInk], 'Not sent': [P.badWash, P.badInk], Late: [P.badWash, P.badInk],
  Overdue: [P.badWash, P.badInk], High: [P.badWash, P.badInk], Critical: [P.badWash, P.badInk],
  'Needs allocation': [P.badWash, P.badInk], Unassigned: [P.badWash, P.badInk], Short: [P.badWash, P.badInk],
  Cancelled: [P.badWash, P.badInk], Declined: [P.badWash, P.badInk], Missing: [P.badWash, P.badInk],
}

export function styleState(cell: ExcelJS.Cell, word: string) {
  const hit = STATE_COLORS[word]
  if (hit) {
    cell.fill = fill(hit[0])
    cell.font = { name: FONT, size: 10, bold: true, color: { argb: hit[1] } }
  } else if (word === 'N/A' || word === '' || word === '—') {
    cell.font = { name: FONT, size: 10, color: { argb: P.naInk } }
  }
  cell.alignment = { horizontal: 'center', vertical: 'top' }
}

const TONE: Record<'good' | 'warn' | 'bad', string> = { good: P.okInk, warn: P.warnInk, bad: P.badInk }

/** Banner + description + totals line, merged across the table width. */
export function sheetHead(ws: ExcelJS.Worksheet, width: number, title: string, description: string, totals: string | undefined, generated: string, accent: string = P.deep) {
  width = Math.max(width, 4)
  ws.mergeCells(1, 1, 1, width)
  const t = ws.getCell(1, 1)
  t.value = title
  t.font = { name: FONT, size: 16, bold: true, color: { argb: P.white } }
  t.fill = fill(accent)
  t.alignment = { vertical: 'middle', indent: 1 }
  ws.getRow(1).height = 32

  ws.mergeCells(2, 1, 2, width)
  const d = ws.getCell(2, 1)
  d.value = description
  d.font = { name: FONT, size: 10, italic: true, color: { argb: P.muted } }
  d.fill = fill(P.brandWash)
  d.alignment = { vertical: 'middle', wrapText: true, indent: 1 }
  ws.getRow(2).height = Math.min(90, 18 + Math.ceil(description.length / Math.max(60, width * 11)) * 14)

  ws.mergeCells(3, 1, 3, width)
  const s = ws.getCell(3, 1)
  s.value = totals ? `${totals}   ·   ${generated}` : generated
  s.font = { name: FONT, size: 10, bold: true, color: { argb: P.brand } }
  s.alignment = { vertical: 'middle', indent: 1 }
  ws.getRow(3).height = 20
}

function headerCell(cell: ExcelJS.Cell, text: string, numeric: boolean, bg: string = P.header) {
  cell.value = text
  cell.font = { name: FONT, size: 10, bold: true, color: { argb: P.white } }
  cell.fill = fill(bg)
  cell.alignment = { vertical: 'middle', horizontal: numeric ? 'center' : 'left', wrapText: true }
  cell.border = { bottom: { style: 'medium', color: { argb: P.brand } } }
}

/** Writes one typed, styled value. Shared by tables and the canvas. */
export function writeCell(cell: ExcelJS.Cell, raw: unknown, kind: Kind = 'text', opts: { wrap?: boolean; tint?: string | null; bold?: boolean } = {}) {
  if (kind === 'date') cell.value = day(raw as string)
  else if (kind === 'stamp') cell.value = stamp(raw as string)
  else if (kind === 'int' || kind === 'num' || kind === 'money' || kind === 'pct') cell.value = typeof raw === 'number' && isFinite(raw) ? raw : null
  else if (kind === 'link' && raw && typeof raw === 'object') cell.value = raw as ExcelJS.CellHyperlinkValue
  else cell.value = raw === null || raw === undefined ? '' : String(raw)

  cell.font = { name: FONT, size: 10, bold: !!opts.bold, color: { argb: P.body } }
  cell.alignment = { vertical: 'top', wrapText: !!opts.wrap }
  cell.border = { bottom: THIN }
  if (opts.tint) cell.fill = fill(opts.tint)

  switch (kind) {
    case 'date': cell.numFmt = DATE_FMT; cell.alignment = { horizontal: 'center', vertical: 'top' }; break
    case 'stamp': cell.numFmt = STAMP_FMT; cell.alignment = { horizontal: 'center', vertical: 'top' }; break
    case 'int': cell.numFmt = '#,##0'; cell.alignment = { horizontal: 'right', vertical: 'top' }; break
    case 'num': cell.numFmt = Number.isInteger(cell.value) ? '#,##0' : '#,##0.0'; cell.alignment = { horizontal: 'right', vertical: 'top' }; break
    case 'money': cell.numFmt = '#,##0.00'; cell.alignment = { horizontal: 'right', vertical: 'top' }; break
    case 'pct': cell.numFmt = '0%'; cell.alignment = { horizontal: 'right', vertical: 'top' }; break
    case 'state': case 'flag': styleState(cell, String(cell.value ?? '')); break
    case 'yes':
      // One of two acceptable routes: green when in, plain when not — its
      // absence alone is not a problem worth colouring red.
      cell.alignment = { horizontal: 'center', vertical: 'top' }
      cell.font = cell.value === 'Yes'
        ? { name: FONT, size: 10, bold: true, color: { argb: P.okInk } }
        : { name: FONT, size: 10, color: { argb: P.naInk } }
      break
    case 'source': {
      const b2c = cell.value === 'B2C'
      if (cell.value) {
        cell.fill = fill(b2c ? P.b2cWash : P.b2bWash)
        cell.font = { name: FONT, size: 10, bold: true, color: { argb: b2c ? P.b2c : P.b2b } }
      }
      cell.alignment = { horizontal: 'center', vertical: 'top' }
      break
    }
    case 'link':
      cell.font = { name: FONT, size: 10, underline: true, color: { argb: P.blue } }
      break
  }
}

const SUBTOTAL_FN = { sum: 109, avg: 101, count: 103 } as const

export function addTable<T>(wb: ExcelJS.Workbook, spec: TableSpec<T>, generated: string): ExcelJS.Worksheet {
  const ws = wb.addWorksheet(sheetName(spec.name), {
    properties: { tabColor: { argb: spec.tab } },
    views: [{ state: 'frozen', xSplit: spec.freezeCols ?? 1, ySplit: 4, showGridLines: false, zoomScale: 95 }],
    pageSetup: { ...PAGE, printTitlesRow: '4:4' },
  })
  footer(ws)
  const width = spec.cols.length
  sheetHead(ws, width, spec.title, spec.description, spec.totals, generated)
  spec.cols.forEach((c, i) => { ws.getColumn(i + 1).width = c.width })

  const head = ws.getRow(4)
  spec.cols.forEach((c, i) => headerCell(head.getCell(i + 1), c.header, !!c.kind && c.kind !== 'text'))
  head.height = 30

  if (!spec.rows.length) {
    ws.mergeCells(5, 1, 5, Math.max(width, 4))
    const e = ws.getCell(5, 1)
    e.value = spec.empty ?? 'Nothing in this population for the period.'
    e.font = { name: FONT, size: 11, italic: true, color: { argb: P.muted } }
    e.alignment = { horizontal: 'center', vertical: 'middle' }
    e.fill = fill(P.zebra)
    ws.getRow(5).height = 28
    return ws
  }

  spec.rows.forEach((r, ri) => {
    const row = ws.getRow(5 + ri)
    const tint = spec.rowTint?.(r) ?? (ri % 2 ? P.zebra : null)
    const struck = spec.strike?.(r) ?? false
    spec.cols.forEach((c, ci) => {
      const cell = row.getCell(ci + 1)
      writeCell(cell, c.value(r), c.kind, { wrap: c.wrap, tint })
      const tone = c.tone?.(r)
      if (tone) cell.font = { name: FONT, size: 10, bold: true, color: { argb: TONE[tone] } }
      if (ci === 0) cell.font = { name: FONT, size: 10, bold: true, color: { argb: P.ink } }
      if (struck && (!c.kind || c.kind === 'text' || ci === 0)) cell.font = { ...cell.font, strike: true, color: { argb: P.muted } }
    })
  })

  const first = 5
  const last = 4 + spec.rows.length
  ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: last, column: width } }

  spec.cols.forEach((c, i) => {
    const L = colLetter(i + 1)
    if (c.bar) dataBar(ws, `${L}${first}:${L}${last}`, c.bar)
    if (c.heat) heat(ws, `${L}${first}:${L}${last}`, c.heat)
  })

  // Live totals: SUBTOTAL ignores rows a filter has hidden, so the footer always
  // describes what the reader is looking at.
  if (spec.cols.some(c => c.total)) {
    const tr = ws.getRow(last + 2)
    spec.cols.forEach((c, i) => {
      const cell = tr.getCell(i + 1)
      const L = colLetter(i + 1)
      cell.fill = fill(P.brandWash)
      cell.border = { top: { style: 'medium', color: { argb: P.brand } } }
      cell.font = { name: FONT, size: 10, bold: true, color: { argb: P.deep } }
      if (i === 0) {
        cell.value = 'Total (follows filters)'
        cell.alignment = { vertical: 'middle' }
      } else if (c.total) {
        // The cached result is what a viewer that does not recalculate shows.
        const nums = spec.rows.map(r => c.value(r)).filter((v): v is number => typeof v === 'number' && isFinite(v))
        const sum = nums.reduce((a, b) => a + b, 0)
        const result = c.total === 'sum' ? sum : c.total === 'avg' ? (nums.length ? sum / nums.length : 0) : nums.length
        cell.value = { formula: `SUBTOTAL(${SUBTOTAL_FN[c.total]},${L}${first}:${L}${last})`, result }
        cell.numFmt = c.kind === 'money' ? '#,##0.00' : c.total === 'avg' || c.kind === 'num' ? '#,##0.0' : c.kind === 'pct' ? '0%' : '#,##0'
        cell.alignment = { horizontal: 'right', vertical: 'middle' }
      }
    })
    tr.height = 22
  }
  return ws
}

// ─── Breakdown (group-by with share and bars) ────────────────────────────────

export interface Measure<T> {
  header: string
  width?: number
  kind?: 'int' | 'num' | 'money' | 'pct'
  value: (rows: T[]) => number | null
  /** Draw a bar in this column. */
  bar?: string
  /** Red → green colour on a 0–1 share. */
  traffic?: boolean
  /** Sum in the footer (default for ints). */
  total?: boolean
}

export interface BreakdownSpec<T> {
  name: string
  title: string
  description: string
  tab: string
  what?: string
  rows: T[]
  keyHeader: string
  keyWidth?: number
  key: (r: T) => string
  measures: Measure<T>[]
  /** Which measure the "Share" column is taken from. Default the first. */
  shareOf?: number
  /** Extra text columns per group, after the measures. */
  notes?: { header: string; width?: number; value: (rows: T[]) => string }[]
  /** Group order; default by the share measure, descending. */
  sort?: (a: [string, T[]], b: [string, T[]]) => number
  empty?: string
}

export function addBreakdown<T>(wb: ExcelJS.Workbook, spec: BreakdownSpec<T>, generated: string): ExcelJS.Worksheet {
  const groups = Array.from(groupBy(spec.rows, r => spec.key(r) || '—'))
  const shareIdx = spec.shareOf ?? 0
  const sm = spec.measures[shareIdx]
  const whole = sm.value(spec.rows) ?? 0
  groups.sort(spec.sort ?? ((a, b) => (sm.value(b[1]) ?? 0) - (sm.value(a[1]) ?? 0) || a[0].localeCompare(b[0])))

  type G = [string, T[]]
  const cols: Col<G>[] = [
    { header: spec.keyHeader, width: spec.keyWidth ?? 28, value: g => g[0] },
    ...spec.measures.map((m, i): Col<G> => ({
      header: m.header, width: m.width ?? 12, kind: m.kind ?? 'int',
      value: g => m.value(g[1]),
      bar: m.bar ?? (i === shareIdx ? SERIES[0] : undefined),
      total: (m.total ?? ((m.kind ?? 'int') === 'int' || m.kind === 'money')) ? 'sum' : undefined,
    })),
    { header: `Share of ${sm.header.toLowerCase()}`, width: 11, kind: 'pct', value: g => (whole ? (sm.value(g[1]) ?? 0) / whole : null), total: 'sum' },
    ...(spec.notes ?? []).map((n): Col<G> => ({ header: n.header, width: n.width ?? 36, wrap: true, value: g => n.value(g[1]) })),
  ]
  const ws = addTable<G>(wb, {
    name: spec.name, title: spec.title, description: spec.description, tab: spec.tab,
    totals: `${groups.length} ${spec.keyHeader.toLowerCase()}${groups.length === 1 ? '' : 's'} · ${whole.toLocaleString('en-US')} ${sm.header.toLowerCase()}`,
    cols, rows: groups, empty: spec.empty,
  }, generated)

  // Shares coloured by the traffic scale where a measure asked for it.
  spec.measures.forEach((m, i) => {
    if (!m.traffic || !groups.length) return
    const L = colLetter(i + 2)
    traffic(ws, `${L}5:${L}${4 + groups.length}`)
  })
  return ws
}

// ─── Matrix (heatmap) ─────────────────────────────────────────────────────────

export interface MatrixSpec {
  name: string
  title: string
  description: string
  tab: string
  what?: string
  rowHeader: string
  rows: string[]
  cols: { key: string; label: string }[]
  value: (row: string, col: string) => number
  color?: string
  colWidth?: number
  rowWidth?: number
}

export function addMatrix(wb: ExcelJS.Workbook, spec: MatrixSpec, generated: string): ExcelJS.Worksheet {
  const ws = wb.addWorksheet(sheetName(spec.name), {
    properties: { tabColor: { argb: spec.tab } },
    views: [{ state: 'frozen', xSplit: 1, ySplit: 4, showGridLines: false }],
    pageSetup: PAGE,
  })
  footer(ws)
  const width = spec.cols.length + 2
  const grand = spec.rows.reduce((s, r) => s + spec.cols.reduce((t, c) => t + spec.value(r, c.key), 0), 0)
  sheetHead(ws, width, spec.title, spec.description, `${spec.rows.length} rows × ${spec.cols.length} columns · ${grand.toLocaleString('en-US')} in all`, generated)
  ws.getColumn(1).width = spec.rowWidth ?? 26
  for (let i = 0; i < spec.cols.length; i++) ws.getColumn(i + 2).width = spec.colWidth ?? 10
  ws.getColumn(width).width = 11

  const head = ws.getRow(4)
  headerCell(head.getCell(1), spec.rowHeader, false)
  spec.cols.forEach((c, i) => headerCell(head.getCell(i + 2), c.label, true))
  headerCell(head.getCell(width), 'Total', true, P.deep)
  head.height = 34

  if (!spec.rows.length) {
    ws.mergeCells(5, 1, 5, width)
    const e = ws.getCell(5, 1)
    e.value = 'Nothing to cross in this window.'
    e.font = { name: FONT, size: 11, italic: true, color: { argb: P.muted } }
    e.alignment = { horizontal: 'center' }
    return ws
  }

  spec.rows.forEach((r, ri) => {
    const row = ws.getRow(5 + ri)
    writeCell(row.getCell(1), r, 'text', { bold: true })
    row.getCell(1).font = { name: FONT, size: 10, bold: true, color: { argb: P.ink } }
    spec.cols.forEach((c, ci) => {
      const v = spec.value(r, c.key)
      const cell = row.getCell(ci + 2)
      writeCell(cell, v || null, 'int')
      cell.alignment = { horizontal: 'center', vertical: 'middle' }
      cell.border = { bottom: THIN, right: THIN }
    })
    const L = colLetter(width - 1)
    const t = row.getCell(width)
    t.value = { formula: `SUM(B${5 + ri}:${L}${5 + ri})`, result: spec.cols.reduce((a, c) => a + spec.value(r, c.key), 0) }
    t.numFmt = '#,##0'
    t.font = { name: FONT, size: 10, bold: true, color: { argb: P.deep } }
    t.fill = fill(P.brandWash)
    t.alignment = { horizontal: 'center' }
  })
  const lastRow = 4 + spec.rows.length
  const tr = ws.getRow(lastRow + 1)
  tr.getCell(1).value = 'Total'
  for (let ci = 2; ci <= width; ci++) {
    const L = colLetter(ci)
    const cell = tr.getCell(ci)
    const result = ci === width ? grand : spec.rows.reduce((a, r) => a + spec.value(r, spec.cols[ci - 2].key), 0)
    cell.value = { formula: `SUM(${L}5:${L}${lastRow})`, result }
    cell.numFmt = '#,##0'
    cell.alignment = { horizontal: 'center' }
  }
  for (let ci = 1; ci <= width; ci++) {
    const cell = tr.getCell(ci)
    cell.font = { name: FONT, size: 10, bold: true, color: { argb: P.white } }
    cell.fill = fill(P.deep)
  }
  heat(ws, `B5:${colLetter(width - 1)}${lastRow}`, spec.color ?? P.brand)
  dataBar(ws, `${colLetter(width)}5:${colLetter(width)}${lastRow}`, spec.color ?? P.brand)
  return ws
}

// ─── Canvas: a free-layout dashboard sheet ────────────────────────────────────

export interface Tile {
  label: string
  value: string | number
  note?: string
  color: string
}

export interface LineOpts {
  bold?: boolean
  bg?: string
  color?: string
  labelColor?: string
  /** Column numbers (1-based) holding a 0–1 share, coloured by threshold. */
  pctCols?: number[]
  /** Column numbers whose positive value is bad and gets red. */
  alarmCols?: number[]
  /** Column numbers holding a signed change, green up / red down. */
  deltaCols?: number[]
  /** Kinds per column, defaults to int for numbers. */
  kinds?: (Kind | undefined)[]
}

export class Canvas {
  ws: ExcelJS.Worksheet
  r = 1
  readonly W: number

  constructor(wb: ExcelJS.Workbook, name: string, opts: { tab?: string; width?: number; firstCol?: number; colWidth?: number } = {}) {
    this.W = opts.width ?? 12
    this.ws = wb.addWorksheet(sheetName(name), {
      properties: { tabColor: { argb: opts.tab ?? P.deep } },
      views: [{ showGridLines: false }],
      pageSetup: PAGE,
    })
    footer(this.ws)
    for (let i = 1; i <= this.W; i++) this.ws.getColumn(i).width = opts.colWidth ?? 13
    this.ws.getColumn(1).width = opts.firstCol ?? 42
  }

  banner(kicker: string, title: string, subtitle: string) {
    const { ws, W } = this
    const put = (row: number, value: string, font: Partial<ExcelJS.Font>, bg: string, height: number, v: 'bottom' | 'middle') => {
      ws.mergeCells(row, 1, row, W)
      const c = ws.getCell(row, 1)
      c.value = value
      c.font = { name: FONT, ...font }
      c.fill = fill(bg)
      c.alignment = { vertical: v, indent: 1, wrapText: true }
      ws.getRow(row).height = height
    }
    put(1, kicker.toUpperCase(), { size: 10, bold: true, color: { argb: 'FFB2DFDB' } }, P.deep, 22, 'bottom')
    put(2, title, { size: 22, bold: true, color: { argb: P.white } }, P.deep, 36, 'middle')
    put(3, subtitle, { size: 10, color: { argb: 'FFCCFBF1' } }, P.brand, 30, 'middle')
    this.r = 5
  }

  /** KPI tiles, value over label over note. The first sits in the wide column. */
  tiles(tiles: Tile[]) {
    const { ws } = this
    const r = this.r
    tiles.forEach((t, i) => {
      const c0 = i === 0 ? 1 : 2 + (i - 1) * 2
      const c1 = i === 0 ? 1 : c0 + 1
      if (c1 > this.W) return
      for (const [row, val, font] of [
        [r, t.value, { name: FONT, size: 22, bold: true, color: { argb: t.color } }],
        [r + 1, t.label.toUpperCase(), { name: FONT, size: 9, bold: true, color: { argb: P.muted } }],
        [r + 2, t.note ?? '', { name: FONT, size: 9, color: { argb: P.naInk } }],
      ] as [number, string | number, Partial<ExcelJS.Font>][]) {
        if (c1 > c0) ws.mergeCells(row, c0, row, c1)
        const cell = ws.getCell(row, c0)
        cell.value = val
        cell.font = font
        cell.numFmt = '#,##0'
        cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: row === r + 2 }
        for (let k = c0; k <= c1; k++) ws.getCell(row, k).fill = fill(P.zebra)
      }
      for (let k = c0; k <= c1; k++) ws.getCell(r, k).border = { top: { style: 'thick', color: { argb: t.color } } }
    })
    ws.getRow(r).height = 34
    ws.getRow(r + 2).height = 26
    this.r += 4
  }

  title(text: string, sub?: string) {
    const { ws, W } = this
    ws.mergeCells(this.r, 1, this.r, W)
    const c = ws.getCell(this.r, 1)
    c.value = text
    c.font = { name: FONT, size: 13, bold: true, color: { argb: P.ink } }
    c.border = { bottom: { style: 'medium', color: { argb: P.brand } } }
    ws.getRow(this.r).height = 22
    this.r += 1
    if (sub) {
      ws.mergeCells(this.r, 1, this.r, W)
      const s = ws.getCell(this.r, 1)
      s.value = sub
      s.font = { name: FONT, size: 9, italic: true, color: { argb: P.muted } }
      s.alignment = { wrapText: true, vertical: 'top' }
      ws.getRow(this.r).height = Math.min(60, 14 + Math.ceil(sub.length / 160) * 13)
      this.r += 1
    }
  }

  header(cols: string[], colors?: (string | undefined)[]) {
    cols.forEach((h, i) => {
      const cell = this.ws.getCell(this.r, i + 1)
      cell.value = h
      cell.font = { name: FONT, size: 9, bold: true, color: { argb: P.white } }
      cell.fill = fill(colors?.[i] ?? P.header)
      cell.alignment = { horizontal: i ? 'center' : 'left', vertical: 'middle', wrapText: true, indent: i ? 0 : 1 }
    })
    this.ws.getRow(this.r).height = 28
    this.r += 1
  }

  line(vals: (string | number | null)[], opts: LineOpts = {}) {
    const row = this.r
    vals.forEach((v, i) => {
      const cell = this.ws.getCell(row, i + 1)
      const kind = opts.kinds?.[i]
      if (kind && kind !== 'text') writeCell(cell, v, kind)
      else cell.value = v
      cell.font = { name: FONT, size: 10, bold: opts.bold || i === 0, color: { argb: i === 0 ? (opts.labelColor ?? P.ink) : (opts.color ?? P.body) } }
      cell.alignment = { horizontal: i ? 'center' : 'left', vertical: 'middle', indent: i ? 0 : 1, wrapText: i === 0 }
      cell.border = { bottom: THIN }
      if (typeof v === 'number' && !kind) cell.numFmt = Number.isInteger(v) ? '#,##0' : '#,##0.0'
      if (opts.bg) cell.fill = fill(opts.bg)
    })
    for (const col of opts.pctCols ?? []) {
      const cell = this.ws.getCell(row, col)
      cell.numFmt = '0%'
      const v = typeof cell.value === 'number' ? cell.value : null
      if (v !== null) {
        const [bg, fg] = v >= 0.9 ? [P.okWash, P.okInk] : v >= 0.5 ? [P.warnWash, P.warnInk] : [P.badWash, P.badInk]
        cell.fill = fill(bg)
        cell.font = { name: FONT, size: 10, bold: true, color: { argb: fg } }
      }
    }
    for (const col of opts.alarmCols ?? []) {
      const cell = this.ws.getCell(row, col)
      if (typeof cell.value === 'number' && cell.value > 0) cell.font = { name: FONT, size: 10, bold: true, color: { argb: P.red } }
    }
    for (const col of opts.deltaCols ?? []) {
      const cell = this.ws.getCell(row, col)
      if (typeof cell.value === 'number' && cell.value !== 0) {
        cell.font = { name: FONT, size: 10, bold: true, color: { argb: cell.value > 0 ? P.okInk : P.badInk } }
        // Literal text in a number format must be quoted, or Excel rejects it.
        cell.numFmt = cell.numFmt?.includes('%') ? '"▲ "0%;"▼ "0%'
          : Number.isInteger(cell.value) ? '"▲ "#,##0;"▼ "#,##0' : '"▲ "#,##0.0;"▼ "#,##0.0'
      }
    }
    this.r += 1
  }

  /** A paragraph across the sheet. */
  note(text: string, color: string = P.muted) {
    const { ws, W } = this
    ws.mergeCells(this.r, 1, this.r, W)
    const c = ws.getCell(this.r, 1)
    c.value = text
    c.font = { name: FONT, size: 10, color: { argb: color } }
    c.alignment = { wrapText: true, vertical: 'top', indent: 1 }
    ws.getRow(this.r).height = Math.min(80, 16 + Math.ceil(text.length / 150) * 14)
    this.r += 1
  }

  /** A severity-coloured callout: label in col 1, text across the rest. */
  callout(severity: 'critical' | 'warning' | 'watch' | 'good', label: string, text: string) {
    const { ws, W } = this
    const [bg, fg] = severity === 'critical' ? [P.badWash, P.badInk]
      : severity === 'warning' ? [P.warnWash, P.warnInk]
        : severity === 'good' ? [P.okWash, P.okInk] : [P.blueWash, P.blue]
    const a = ws.getCell(this.r, 1)
    a.value = label
    a.font = { name: FONT, size: 10, bold: true, color: { argb: fg } }
    a.fill = fill(bg)
    a.alignment = { vertical: 'top', wrapText: true, indent: 1 }
    a.border = { left: { style: 'thick', color: { argb: fg } } }
    ws.mergeCells(this.r, 2, this.r, W)
    const b = ws.getCell(this.r, 2)
    b.value = text
    b.font = { name: FONT, size: 10, color: { argb: P.body } }
    b.fill = fill(bg)
    b.alignment = { vertical: 'top', wrapText: true }
    ws.getRow(this.r).height = Math.max(20, Math.min(70, 16 + Math.ceil(Math.max(text.length / 120, label.length / 40)) * 13))
    this.r += 1
  }

  /** Bars drawn in a range already written — e.g. a column of a small table. */
  bars(col: number, fromRow: number, toRow: number, argb: string) {
    if (toRow < fromRow) return
    const L = colLetter(col)
    dataBar(this.ws, `${L}${fromRow}:${L}${toRow}`, argb)
  }

  gap(n = 1) { this.r += n }

  /** The linked index of every other tab. */
  index(entries: { name: string; what: string; tab: string }[]) {
    this.title('In this workbook', 'Click a tab name to jump to it. Every data tab has filters on its header row and a live total underneath.')
    this.header(['Tab', 'What it holds'])
    for (const s of entries) {
      this.ws.mergeCells(this.r, 2, this.r, this.W)
      const a = this.ws.getCell(this.r, 1)
      a.value = { text: s.name, hyperlink: `#'${s.name}'!A1` }
      a.font = { name: FONT, size: 10, bold: true, underline: true, color: { argb: s.tab } }
      a.alignment = { indent: 1, vertical: 'middle' }
      const w = this.ws.getCell(this.r, 2)
      w.value = s.what
      w.font = { name: FONT, size: 10, color: { argb: P.body } }
      w.alignment = { vertical: 'middle', wrapText: true }
      a.border = { bottom: THIN }
      w.border = { bottom: THIN }
      this.r += 1
    }
  }
}

// ─── Assembly: a dashboard first, then every table in order ──────────────────

export type SheetJob =
  | { type: 'table'; spec: TableSpec<any> }
  | { type: 'breakdown'; spec: BreakdownSpec<any> }
  | { type: 'matrix'; spec: MatrixSpec }
  | { type: 'canvas'; spec: { name: string; tab: string; what?: string; width?: number; firstCol?: number; draw: (c: Canvas) => void } }

/** Collects tabs so the overview can index them before they are written. */
export class SheetPlan {
  jobs: SheetJob[] = []
  table<T>(spec: TableSpec<T> & { what: string }) { this.jobs.push({ type: 'table', spec }) }
  breakdown<T>(spec: BreakdownSpec<T> & { what: string }) { this.jobs.push({ type: 'breakdown', spec }) }
  matrix(spec: MatrixSpec & { what: string }) { this.jobs.push({ type: 'matrix', spec }) }
  /** A free-layout sheet — for mixed blocks that are not one population. */
  canvas(spec: { name: string; tab: string; what: string; width?: number; firstCol?: number; draw: (c: Canvas) => void }) { this.jobs.push({ type: 'canvas', spec }) }

  index(): { name: string; what: string; tab: string }[] {
    return this.jobs.map(j => ({ name: sheetName(j.spec.name), what: j.spec.what ?? '', tab: j.spec.tab }))
  }

  names(): string[] { return this.jobs.map(j => sheetName(j.spec.name)) }

  write(wb: ExcelJS.Workbook, generated: string) {
    for (const j of this.jobs) {
      if (j.type === 'table') addTable(wb, j.spec, generated)
      else if (j.type === 'breakdown') addBreakdown(wb, j.spec, generated)
      else if (j.type === 'matrix') addMatrix(wb, j.spec, generated)
      else j.spec.draw(new Canvas(wb, j.spec.name, { tab: j.spec.tab, width: j.spec.width, firstCol: j.spec.firstCol }))
    }
  }
}
