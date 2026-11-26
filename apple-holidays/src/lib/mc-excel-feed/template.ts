/**
 * MC Excel Feed — the dropdown-ready layout, built with exceljs.
 *
 * Graph's Excel REST surface can write values and formats but cannot add data
 * validation, so the dropdowns live in this file layout:
 *
 *   <tab>   the header (OPS columns teal, desk columns amber, a note on each
 *           saying who owns it), frozen, filtered, and list dropdowns on rows
 *           2…20000 for Location, Service Type, Meal Plan, B2B/B2C and the desk's
 *           Type of Car / QC / Tickets / Meal Preference. Free typing is still
 *           allowed — a dropdown offers, it never refuses.
 *   Lists   the dropdown values. OPS-owned lists (agenda values) on the left;
 *           desk lists on the right are seeded once and are the desk's to edit.
 *
 * Used three ways: uploaded into an EMPTY workbook ("Set up workbook"), offered
 * as a download (template), and as the "OPS copy" download with every row.
 */
import ExcelJS from 'exceljs'
import { MEAL_PLAN_OPTIONS, VIETNAM_LOCATIONS } from '@/lib/agenda-suggestions'
import { SERVICE_TYPE_LABELS } from '@/lib/service-types'
import { FEED_COLUMNS, type FeedRow, type ListKey } from './shared'
import { desiredCell } from './plan'

export const LISTS_TAB = 'Lists'
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

const colLetter = (i: number) => {
  let n = i + 1, s = ''
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26) }
  return s
}

const TEAL = 'FF0F766E'
const AMBER = 'FFFDE68A'

export async function buildFeedWorkbook(opts: { tabName: string; lists?: ListValues; rows?: FeedRow[] }): Promise<Buffer> {
  const book = new ExcelJS.Workbook()
  book.creator = 'OPS — MC Excel Feed'
  book.created = new Date()

  const sheet = book.addWorksheet(opts.tabName, { views: [{ state: 'frozen', ySplit: 1, xSplit: 0 }] })
  const listsSheet = book.addWorksheet(LISTS_TAB)

  // Header
  sheet.columns = FEED_COLUMNS.map(c => ({ key: c.key, width: c.width }))
  const header = sheet.getRow(1)
  FEED_COLUMNS.forEach((c, i) => {
    const cell = header.getCell(i + 1)
    cell.value = c.header
    const ops = c.source === 'ops'
    cell.font = { bold: true, color: { argb: ops ? 'FFFFFFFF' : 'FF78350F' } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ops ? TEAL : AMBER } }
    cell.alignment = { vertical: 'middle', wrapText: true }
    cell.note = ops ? `Filled by OPS — ${c.hint}. Change it in OPS; edits here are replaced on the next sync.` : 'Desk column — OPS never writes here.'
  })
  header.height = 30
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: FEED_COLUMNS.length } }

  // Lists + dropdowns
  const lists = buildLists(opts.lists)
  lists.forEach((l, i) => {
    const col = i + 1
    const head = listsSheet.getCell(1, col)
    head.value = l.title
    head.font = { bold: true, color: { argb: l.owner === 'ops' ? 'FFFFFFFF' : 'FF78350F' } }
    head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: l.owner === 'ops' ? TEAL : AMBER } }
    head.note = l.owner === 'ops' ? 'From OPS (agenda values).' : 'The desk\'s list — add or change values here and the dropdown follows.'
    l.values.forEach((v, r) => { listsSheet.getCell(r + 2, col).value = v })
    listsSheet.getColumn(col).width = Math.min(40, Math.max(14, ...l.values.map(v => v.length + 2)))
    // Room for the desk to add values: the dropdown reads 300 rows.
    const source = `${LISTS_TAB}!$${colLetter(i)}$2:$${colLetter(i)}$${Math.max(300, l.values.length + 50)}`
    const target = FEED_COLUMNS.findIndex(c => c.list === l.key)
    if (target < 0) return
    const letter = colLetter(target)
    ;(sheet as unknown as { dataValidations: { add: (a: string, v: ExcelJS.DataValidation) => void } }).dataValidations.add(
      `${letter}2:${letter}${VALIDATION_ROWS}`,
      { type: 'list', allowBlank: true, formulae: [source], showErrorMessage: false, showInputMessage: false },
    )
  })
  listsSheet.views = [{ state: 'frozen', ySplit: 1 }]

  // Rows (the OPS copy)
  for (const f of opts.rows ?? []) {
    const values = FEED_COLUMNS.map(c => {
      if (c.source !== 'ops') return null
      if (c.kind === 'date') {
        const ymd = c.key === 'arrival' ? f.arrival : f.date
        return ymd ? new Date(`${ymd}T00:00:00.000Z`) : null
      }
      const v = desiredCell(f, c.key).value
      return typeof v === 'string' ? v.replace(/^'/, '') : v
    })
    const row = sheet.addRow(values)
    FEED_COLUMNS.forEach((c, i) => { if (c.kind === 'date') row.getCell(i + 1).numFmt = 'dd-mmm-yyyy' })
    if (f.status === 'Booking cancelled') row.font = { color: { argb: 'FF9CA3AF' }, italic: true }
  }
  FEED_COLUMNS.forEach((c, i) => {
    if (c.key === 'description' || c.key === 'to' || c.key === 'from') sheet.getColumn(i + 1).alignment = { wrapText: true, vertical: 'top' }
  })

  const out = await book.xlsx.writeBuffer()
  return Buffer.from(out as ArrayBuffer)
}
