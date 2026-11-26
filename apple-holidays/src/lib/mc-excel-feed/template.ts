/**
 * MC Excel Feed — the OPS layout, built with exceljs.
 *
 * Graph's Excel REST surface can write values and formats but cannot add data
 * validation or conditional formatting, so both live in this file layout:
 *
 *   <tab>    row 1  — dark banner: title, the "last synced" stamp (OPS rewrites
 *                     it every sync) and the colour legend.
 *            row 2  — the header, coloured by owner: OPS teal, desk amber,
 *                     both-ways violet; each with a note saying who owns it.
 *            rows 3+ — two booking colours from the "#" column (odd / even
 *                     booking), a divider line where each booking starts,
 *                     today's movements highlighted, status colours, removed /
 *                     cancelled rows greyed. All by conditional formatting, so it
 *                     follows inserts, sorting and filters on its own.
 *            Dropdowns (free typing still allowed) and frozen panes.
 *   Lists    the dropdown values — OPS lists on the left, desk lists to edit.
 *   Read me  how the sheet works.
 *
 * Uploaded into an EMPTY workbook ("Prepare sheet"), offered as the Template
 * download, and as the "OPS copy" download with every row filled in.
 */
import ExcelJS from 'exceljs'
import { MEAL_PLAN_OPTIONS, VIETNAM_LOCATIONS } from '@/lib/agenda-suggestions'
import { SERVICE_TYPE_LABELS } from '@/lib/service-types'
import { colLetter, FEED_COLUMNS, LAYOUT_NAME, PALETTE, STAMP_NAME, STATUS, type FeedRow, type ListKey } from './shared'
import { cellContext, DATE_FORMAT, desiredCell, mapHeader, twoWayCell } from './plan'

export const LISTS_TAB = 'Lists'
export const README_TAB = 'Read me'
export const HEADER_ROW = 2
export const VALIDATION_ROWS = 20_000

export interface ListValues {
  locations?: string[]
  serviceTypes?: string[]
  mealPlans?: string[]
}

const uniq = (xs: string[]) => Array.from(new Set(xs.map(x => x.trim()).filter(Boolean)))

export function buildLists(extra: ListValues = {}): { key: ListKey; title: string; owner: 'ops' | 'desk'; values: string[] }[] {
  return [
    { key: 'channel', title: 'B2B / B2C', owner: 'ops', values: ['B2B', 'B2C'] },
    { key: 'serviceType', title: 'Service Type', owner: 'ops', values: uniq([...Object.values(SERVICE_TYPE_LABELS), ...(extra.serviceTypes ?? [])]) },
    { key: 'mealPlan', title: 'Meal Plan', owner: 'ops', values: uniq([...MEAL_PLAN_OPTIONS.map(o => o.value), ...(extra.mealPlans ?? [])]) },
    { key: 'location', title: 'Location', owner: 'ops', values: uniq([...VIETNAM_LOCATIONS, ...(extra.locations ?? [])]).sort((a, b) => a.localeCompare(b)) },
    { key: 'car', title: 'Type of Car', owner: 'desk', values: ['4 Seater', '7 Seater', '16 Seater', '29 Seater', '35 Seater', '45 Seater', 'Limousine', 'Luxury Car'] },
    { key: 'qc', title: 'QC Checked', owner: 'desk', values: ['Yes', 'No', 'Pending'] },
    { key: 'tickets', title: 'TICKETS', owner: 'desk', values: ['Booked', 'Issued', 'Pending', 'Not required'] },
    { key: 'mealPref', title: 'Meal Preference', owner: 'desk', values: ['Veg', 'Non-Veg', 'Jain', 'Vegan', 'Eggetarian', 'Halal', 'No preference'] },
  ]
}

const argb = (hex: string) => `FF${hex.replace('#', '').toUpperCase()}`
const solid = (hex: string): ExcelJS.Fill => ({ type: 'pattern', pattern: 'solid', fgColor: { argb: argb(hex) } })
const cfFill = (hex: string): ExcelJS.Fill => ({ type: 'pattern', pattern: 'solid', bgColor: { argb: argb(hex) } })
const FONT = 'Calibri'

type CfAdder = { addConditionalFormatting: (cf: { ref: string; rules: unknown[] }) => void }
type DvAdder = { dataValidations: { add: (a: string, v: ExcelJS.DataValidation) => void } }

export async function buildFeedWorkbook(opts: { tabName: string; lists?: ListValues; rows?: FeedRow[] }): Promise<Buffer> {
  const book = new ExcelJS.Workbook()
  book.creator = 'OPS — MC Excel Feed'
  book.created = new Date()

  const n = FEED_COLUMNS.length
  const last = colLetter(n - 1)
  const col = (key: string) => colLetter(FEED_COLUMNS.findIndex(c => c.key === key))
  const xFreeze = FEED_COLUMNS.findIndex(c => c.key === 'ref') + 1

  const sheet = book.addWorksheet(opts.tabName, {
    views: [{ state: 'frozen', ySplit: HEADER_ROW, xSplit: xFreeze, showGridLines: false }],
    properties: { defaultRowHeight: 18, tabColor: { argb: argb(PALETTE.ops) } },
  })
  const listsSheet = book.addWorksheet(LISTS_TAB, { properties: { tabColor: { argb: argb(PALETTE.desk) } } })
  const readme = book.addWorksheet(README_TAB, { properties: { tabColor: { argb: argb(PALETTE.both) } }, views: [{ showGridLines: false }] })

  // Column formats: new cells Graph writes into inherit them.
  FEED_COLUMNS.forEach((c, i) => {
    const column = sheet.getColumn(i + 1)
    column.width = c.width
    column.font = { name: FONT, size: 10, color: { argb: c.source === 'both' ? 'FF5B21B6' : 'FF1E293B' }, bold: c.source === 'both' }
    column.alignment = { vertical: 'middle', horizontal: c.kind === 'int' || c.kind === 'formula' ? 'center' : 'left' }
    if (c.kind === 'date') column.numFmt = DATE_FORMAT
    if (c.kind === 'time') column.numFmt = 'h:mm AM/PM'
    if (c.key === 'lineId') column.font = { name: FONT, size: 8, color: { argb: 'FF94A3B8' } }
    if (c.key === 'band') column.font = { name: FONT, size: 9, color: { argb: 'FF64748B' }, bold: true }
  })

  // Row 1 — banner
  const banner = sheet.getRow(1)
  banner.height = 30
  for (let i = 1; i <= n; i++) banner.getCell(i).fill = solid(PALETTE.banner)
  sheet.mergeCells('A1:F1')
  const title = sheet.getCell('A1')
  title.value = 'MOVEMENT CHART'
  title.font = { name: FONT, size: 15, bold: true, color: { argb: 'FFFFFFFF' } }
  title.alignment = { vertical: 'middle', indent: 1 }
  sheet.mergeCells('G1:P1')
  const stamp = sheet.getCell('G1')
  stamp.value = 'Filled from OPS — waiting for the first sync'
  stamp.font = { name: FONT, size: 10, italic: true, color: { argb: 'FF94A3B8' } }
  stamp.alignment = { vertical: 'middle' }
  sheet.mergeCells(`Q1:${last}1`)
  const legend = sheet.getCell('Q1')
  legend.value = {
    richText: [
      { text: '■ ', font: { name: FONT, size: 12, color: { argb: argb('#14B8A6') } } },
      { text: 'Filled by OPS     ', font: { name: FONT, size: 10, color: { argb: 'FFE2E8F0' } } },
      { text: '■ ', font: { name: FONT, size: 12, color: { argb: argb('#FBBF24') } } },
      { text: 'Typed by the desk     ', font: { name: FONT, size: 10, color: { argb: 'FFE2E8F0' } } },
      { text: '■ ', font: { name: FONT, size: 12, color: { argb: argb('#A78BFA') } } },
      { text: 'Both ways — edits here go back to OPS     ', font: { name: FONT, size: 10, color: { argb: 'FFE2E8F0' } } },
      { text: '▌', font: { name: FONT, size: 12, color: { argb: argb('#818CF8') } } },
      { text: '▌', font: { name: FONT, size: 12, color: { argb: argb('#6EE7B7') } } },
      { text: ' one colour per booking', font: { name: FONT, size: 10, color: { argb: 'FFE2E8F0' } } },
    ],
  }
  legend.alignment = { vertical: 'middle' }
  book.definedNames.add(`'${opts.tabName.replace(/'/g, "''")}'!$G$1`, STAMP_NAME)

  // Row 2 — header
  const header = sheet.getRow(HEADER_ROW)
  header.height = 34
  FEED_COLUMNS.forEach((c, i) => {
    const cell = header.getCell(i + 1)
    cell.value = c.header
    const bg = c.source === 'ops' ? PALETTE.ops : c.source === 'both' ? PALETTE.both : PALETTE.desk
    cell.fill = solid(bg)
    cell.font = { name: FONT, size: 10, bold: true, color: { argb: c.source === 'desk' ? argb(PALETTE.deskText) : 'FFFFFFFF' } }
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
    cell.border = { right: { style: 'thin', color: { argb: 'FFFFFFFF' } }, bottom: { style: 'medium', color: { argb: argb(PALETTE.banner) } } }
    cell.note = c.source === 'ops' ? `Filled by OPS — ${c.hint}. Change it in OPS; edits here are replaced on the next sync.`
      : c.source === 'both' ? `${c.hint}. If both sides change, OPS shows a conflict to settle.`
      : 'Typed by the desk — OPS never writes here.'
  })
  sheet.autoFilter = { from: { row: HEADER_ROW, column: 1 }, to: { row: HEADER_ROW, column: n } }

  // Conditional formatting (rows 3 … VALIDATION_ROWS)
  const first = HEADER_ROW + 1
  const area = `A${first}:${last}${VALIDATION_ROWS}`
  const A = col('band'), R = col('ref'), S = col('status'), D = col('date')
  const cf = sheet as unknown as CfAdder
  cf.addConditionalFormatting({
    ref: area,
    rules: [
      { type: 'expression', priority: 2, formulae: [`OR($${S}${first}="${STATUS.removed}",$${S}${first}="${STATUS.cancelled}")`],
        style: { font: { color: { argb: 'FF94A3B8' }, italic: true, strike: true }, fill: cfFill('#F8FAFC') } },
      { type: 'expression', priority: 3, formulae: [`AND($${R}${first}<>"",$${R}${first}<>$${R}${first - 1})`],
        style: { border: { top: { style: 'thin', color: { argb: 'FF475569' } } } } },
      { type: 'expression', priority: 4, formulae: [`AND(ISNUMBER($${A}${first}),ISODD($${A}${first}))`], style: { fill: cfFill(PALETTE.bandA) } },
      { type: 'expression', priority: 5, formulae: [`AND(ISNUMBER($${A}${first}),ISEVEN($${A}${first}))`], style: { fill: cfFill(PALETTE.bandB) } },
    ],
  })
  cf.addConditionalFormatting({
    ref: `${D}${first}:${D}${VALIDATION_ROWS}`,
    rules: [{ type: 'expression', priority: 1, formulae: [`AND(ISNUMBER($${D}${first}),INT($${D}${first})=TODAY())`],
      style: { font: { bold: true, color: { argb: 'FF92400E' } }, fill: cfFill('#FDE68A') } }],
  })
  const statusRange = `${S}${first}:${S}${VALIDATION_ROWS}`
  const statusRule = (text: string, color: string, priority: number) => ({
    type: 'expression', priority, formulae: [`$${S}${first}="${text}"`], style: { font: { bold: true, color: { argb: argb(color) } } },
  })
  cf.addConditionalFormatting({
    ref: statusRange,
    rules: [
      statusRule(STATUS.active, '#0F766E', 6), statusRule(STATUS.leisure, '#15803D', 7),
      statusRule(STATUS.hotelOnly, '#7C3AED', 8), statusRule(STATUS.cancelRequested, '#B45309', 9),
    ],
  })

  // Lists + dropdowns
  const lists = buildLists(opts.lists)
  const dv = sheet as unknown as DvAdder
  lists.forEach((l, i) => {
    const c = i + 1
    const head = listsSheet.getCell(1, c)
    head.value = l.title
    head.font = { name: FONT, bold: true, color: { argb: l.owner === 'ops' ? 'FFFFFFFF' : argb(PALETTE.deskText) } }
    head.fill = solid(l.owner === 'ops' ? PALETTE.ops : PALETTE.desk)
    head.alignment = { horizontal: 'center' }
    head.note = l.owner === 'ops' ? 'From OPS (agenda values).' : 'The desk\'s list — add or change values here and the dropdown follows.'
    l.values.forEach((v, r) => { listsSheet.getCell(r + 2, c).value = v })
    listsSheet.getColumn(c).width = Math.min(40, Math.max(14, ...l.values.map(v => v.length + 2)))
    const target = FEED_COLUMNS.findIndex(x => x.list === l.key)
    if (target < 0) return
    const letter = colLetter(i)
    const source = `${LISTS_TAB}!$${letter}$2:$${letter}$${Math.max(300, l.values.length + 50)}`
    const t = colLetter(target)
    dv.dataValidations.add(`${t}${first}:${t}${VALIDATION_ROWS}`, { type: 'list', allowBlank: true, formulae: [source], showErrorMessage: false, showInputMessage: false })
  })
  listsSheet.views = [{ state: 'frozen', ySplit: 1 }]
  book.definedNames.add(`${LISTS_TAB}!$Z$1`, LAYOUT_NAME)

  // Read me
  readme.getColumn(1).width = 3
  readme.getColumn(2).width = 26
  readme.getColumn(3).width = 90
  const line = (r: number, a: string, b: string, color?: string) => {
    const k = readme.getCell(r, 2); k.value = a; k.font = { name: FONT, bold: true, size: 10, color: { argb: color ? argb(color) : 'FF0F172A' } }
    const v = readme.getCell(r, 3); v.value = b; v.font = { name: FONT, size: 10, color: { argb: 'FF334155' } }; v.alignment = { wrapText: true, vertical: 'top' }
  }
  const t = readme.getCell('B2'); t.value = 'How this movement chart works'; t.font = { name: FONT, size: 16, bold: true, color: { argb: argb(PALETTE.banner) } }
  line(4, 'Teal columns', 'Filled by OPS from the booking and its agenda. Change them in OPS — an edit here is replaced on the next sync.', PALETTE.ops)
  line(5, 'Amber columns', 'Typed by the desk. OPS never writes in them, not even a blank.', '#B45309')
  line(6, 'Violet columns', 'Meeting Time and Driver Details go both ways: a change made in OPS comes here, a change typed here goes back to the agenda. If both sides change the same cell between syncs, OPS shows a conflict for a person to settle — neither side is overwritten.', PALETTE.both)
  line(7, 'Driver Details', 'Type "Name · phone" (e.g. Nguyen Van Hung · 0912 345 678). A blank cell never removes a driver from OPS. No WhatsApp is sent by this sheet.')
  line(8, 'Booking colours', 'Each booking gets one of two colours, alternating, with a line where it starts. The "#" column numbers the bookings — keep it.')
  line(9, 'Agenda Line ID', 'Ties the row to its OPS movement. Do not edit or clear it. When a chart is re-saved in OPS the row follows its movement, with everything typed on it.')
  line(10, 'Rows', 'OPS never deletes a row. A movement removed in OPS is greyed and marked "Removed in OPS". A row you delete is not put back.')
  line(11, 'Today', 'Movements dated today are highlighted in the Movement Date column.')
  line(12, 'Dropdowns', 'Location, Service Type and Meal Plan offer the agenda\'s values; Type of Car, QC, Tickets and Meal Preference read the Lists tab — edit those lists freely. Typing anything else is always allowed.')

  // Rows (the OPS copy)
  if (opts.rows?.length) {
    const ctx = cellContext(mapHeader(FEED_COLUMNS.map(c => c.header)), HEADER_ROW)
    opts.rows.forEach((f, i) => {
      const row = sheet.getRow(first + i)
      FEED_COLUMNS.forEach((c, j) => {
        const cell = row.getCell(j + 1)
        if (c.source === 'desk') return
        if (c.kind === 'formula') { cell.value = { formula: ctx.bandFormula.replace(/^=/, '') } as ExcelJS.CellFormulaValue; return }
        if (c.kind === 'date') {
          const ymd = c.key === 'arrival' ? f.arrival : f.date
          cell.value = ymd ? new Date(`${ymd}T00:00:00.000Z`) : null
          return
        }
        const v = c.source === 'both' ? twoWayCell(f, c.key as 'meetingTime' | 'driver').value : desiredCell(f, c.key).value
        cell.value = typeof v === 'string' ? (v.replace(/^'/, '') || null) : v
      })
    })
  }

  const out = await book.xlsx.writeBuffer()
  return Buffer.from(out as ArrayBuffer)
}
