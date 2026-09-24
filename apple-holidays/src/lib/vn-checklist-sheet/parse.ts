/**
 * Parse the desk's checklist workbook into tours and payment lines.
 *
 * Pure: a Buffer in, plain objects out. No database, no Graph — so it can be
 * run against a downloaded copy of the file to check what a sync would store.
 *
 * Layout of a "Checklist YYYY" tab (row 1 is the header, row 3 carries the
 * house rate under "Total VND"):
 *
 *   VN42199 | MMT        | 3 | 10 October | 04/10 | 09/10 | 6 | HCM | 393 | ... | 25500 revenue ...   <- header row
 *   VN42199 | 496565CNTL |   |            |       |       |   |     | Full-Day Mekong ... | VN Lotus | SIC | ... <- line (col B = agent's ref)
 *   VN42199 |            |   |            |       |       |   |     | Saigon Sky Deck ... |          | Trans | ...
 *
 * Things the file does that this handles on purpose:
 *   - Columns are found by header TEXT, not position, so a column the desk
 *     inserts later does not silently shift every figure.
 *   - A tour's rows are not always contiguous, and the desk sometimes leaves
 *     the header row BELOW its lines while editing. Lines are grouped by the
 *     tour code on their own row, never by "the last header seen".
 *   - Pre-filled blank rows (tour code + Total estimate 0, nothing else) are
 *     skipped, not stored as empty lines.
 *   - Dates are Excel serials; MONTH is sometimes a serial, sometimes text.
 *   - Money cells are formulas; xlsx returns Excel's cached result, which is
 *     what the desk sees. Float noise (13200000.000000002) is rounded away.
 */
import { createHash } from 'node:crypto'
import * as XLSX from 'xlsx'
import { paidBucketOf, refsInCode, refKeyOf, type PaidBucket } from './shared'

export interface ParsedLine {
  position: number
  sheetTab: string
  sheetRow: number
  details: string
  vendor: string | null
  code: string | null
  dates: string | null
  qcStatus: string | null
  unitPrice: number | null
  quan1: number | null
  quan2: number | null
  totalEstimateVnd: number | null
  paidRaw: string | null
  paidBucket: PaidBucket
  incurred: string | null
  note: string | null
}

export interface ParsedTour {
  tourCode: string
  refs: string[]
  refKey: string
  primaryRef: string | null
  agent: string | null
  agentRef: string | null
  pax: number | null
  monthLabel: string | null
  arrivalDate: string | null     // yyyy-mm-dd
  departureDate: string | null
  days: number | null
  itinerary: string | null
  quotedUsd: number | null
  revenueUsd: number | null
  totalVnd: number | null
  totalEstimateVnd: number | null
  pnlIncurredVnd: number | null
  profitMargin: number | null
  exchangeRate: number | null
  sheetTab: string
  sheetRow: number
  lines: ParsedLine[]
  /** sha1 of everything above except sheet positions — "did the desk change it". */
  contentHash: string
}

export interface ParseResult {
  tabs: string[]
  allTabs: string[]
  tours: ParsedTour[]
  lineCount: number
  warnings: string[]
}

type Cell = string | number | boolean | Date | null

/** Header text → field. Matched on a normalised form (lower-case, letters and digits only). */
const HEADER_FIELDS: [RegExp, keyof ColumnMap][] = [
  [/^tourcode$/, 'tourCode'],
  [/^agent$/, 'agent'],
  [/^noofpax$/, 'pax'],
  [/^month$/, 'month'],
  [/^arrival$/, 'arrival'],
  [/^departure$/, 'departure'],
  [/^noofdays?$/, 'days'],
  [/^itinerary$/, 'itinerary'],
  [/^detailsforpayment$/, 'details'],
  [/^vendors?$/, 'vendor'],
  [/^code$/, 'code'],
  [/^dates?$/, 'dates'],
  [/^status/, 'qc'],
  [/^unitprice$/, 'unitPrice'],
  [/^quan1$/, 'quan1'],
  [/^quan2$/, 'quan2'],
  [/^totalestimate$/, 'totalEstimate'],
  [/^paid$/, 'paid'],
  [/^incurred/, 'incurred'],
  [/^note$/, 'note'],
  [/^revenue/, 'revenueUsd'],
  [/^totalvnd$/, 'totalVnd'],
  [/^pnl/, 'pnl'],
  [/^profitmargin$/, 'margin'],
]

interface ColumnMap {
  tourCode: number; agent: number; pax: number; month: number; arrival: number; departure: number
  days: number; itinerary: number; details: number; vendor: number; code: number; dates: number
  qc: number; unitPrice: number; quan1: number; quan2: number; totalEstimate: number; paid: number
  incurred: number; note: number; revenueUsd: number; totalVnd: number; pnl: number; margin: number
}

const REQUIRED: (keyof ColumnMap)[] = ['tourCode', 'agent', 'arrival', 'details', 'totalEstimate']

const norm = (v: unknown) => String(v ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')

/** Read the header row. Null when this tab is not a checklist tab. */
function mapColumns(header: Cell[]): ColumnMap | null {
  const map: Partial<ColumnMap> = {}
  header.forEach((h, i) => {
    const n = norm(h)
    if (!n) return
    for (const [re, field] of HEADER_FIELDS) {
      if (map[field] === undefined && re.test(n)) { map[field] = i; break }
    }
  })
  if (REQUIRED.some(f => map[f] === undefined)) return null
  return { ...Object.fromEntries(HEADER_FIELDS.map(([, f]) => [f, -1])), ...map } as ColumnMap
}

/** A tab is synced by default when it is named "Checklist 2026" and so on. */
export const isDefaultChecklistTab = (name: string) => /^checklist\s*\d{4}$/i.test(name.trim())

// ── Cell readers ─────────────────────────────────────────────────────────────

const at = (row: Cell[], i: number): Cell => (i < 0 ? null : row[i] ?? null)

function text(v: Cell, max = 191): string | null {
  if (v === null || v === undefined) return null
  const s = (v instanceof Date ? v.toISOString().slice(0, 10) : String(v))
    .replace(/[  -​]/g, ' ').replace(/\s+/g, ' ').trim()
  return s ? s.slice(0, max) : null
}

function num(v: Cell, decimals = 2): number | null {
  if (v === null || v === undefined || v === '') return null
  let n: number
  if (typeof v === 'number') n = v
  else if (typeof v === 'string') {
    const cleaned = v.replace(/[,\s₫$]/g, '')
    if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null
    n = Number(cleaned)
  } else return null
  if (!Number.isFinite(n)) return null
  const f = 10 ** decimals
  return Math.round(n * f) / f
}

/** Excel serial (46298) → '2026-10-04'. Accepts a Date too. Rejects anything outside 1990–2100. */
function isoDate(v: Cell): string | null {
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString().slice(0, 10)
  if (typeof v === 'number' && v > 32874 && v < 73051) {
    return new Date(Math.round((v - 25569) * 86_400_000)).toISOString().slice(0, 10)
  }
  if (typeof v === 'string') {
    const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(v.trim())
    if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
  }
  return null
}

function monthLabel(v: Cell): string | null {
  if (typeof v === 'number') {
    const d = isoDate(v)
    if (!d) return null
    const dt = new Date(`${d}T00:00:00Z`)
    return `${String(dt.getUTCMonth() + 1).padStart(2, '0')} ${dt.toLocaleString('en-GB', { month: 'long', timeZone: 'UTC' })}`
  }
  return text(v, 64)
}

/** Column L: "03-06/01", a serial, or blank. Serials become dd/mm. */
function datesCell(v: Cell): string | null {
  if (typeof v === 'number') {
    const d = isoDate(v)
    return d ? `${d.slice(8, 10)}/${d.slice(5, 7)}` : String(v)
  }
  return text(v)
}

const hashOf = (value: unknown) => createHash('sha1').update(JSON.stringify(value)).digest('hex')

// ── Parse ────────────────────────────────────────────────────────────────────

/** Tab names only — cheap, reads the workbook index without the sheets. */
export function listWorkbookTabs(buffer: Buffer): string[] {
  return XLSX.read(buffer, { type: 'buffer', bookSheets: true }).SheetNames
}

/**
 * @param wantedTabs tab names to read; empty = every "Checklist YYYY" tab.
 */
export function parseChecklistWorkbook(buffer: Buffer, wantedTabs: string[] = []): ParseResult {
  const allTabs = listWorkbookTabs(buffer)
  const warnings: string[] = []

  const lower = new Map(allTabs.map(t => [t.trim().toLowerCase(), t]))
  let tabs: string[]
  if (wantedTabs.length) {
    tabs = []
    for (const w of wantedTabs) {
      const found = lower.get(w.trim().toLowerCase())
      if (found) tabs.push(found)
      else warnings.push(`The workbook has no tab named "${w}"`)
    }
  } else {
    tabs = allTabs.filter(isDefaultChecklistTab)
  }
  if (!tabs.length) {
    throw new Error(`No checklist tab to read. The workbook's tabs are: ${allTabs.join(', ')}`)
  }

  const wb = XLSX.read(buffer, {
    type: 'buffer', dense: true, sheets: tabs,
    cellFormula: false, cellHTML: false, cellText: false, cellStyles: false,
  })

  type Draft = Omit<ParsedTour, 'contentHash' | 'refs' | 'refKey' | 'primaryRef'> & { headerSeen: boolean }
  const drafts = new Map<string, Draft>()
  const order: string[] = []
  let lineCount = 0
  let orphanLines = 0
  let dupHeaders = 0

  const draftFor = (code: string, tab: string, row: number): Draft => {
    let d = drafts.get(code)
    if (!d) {
      d = {
        tourCode: code, agent: null, agentRef: null, pax: null, monthLabel: null,
        arrivalDate: null, departureDate: null, days: null, itinerary: null,
        quotedUsd: null, revenueUsd: null, totalVnd: null, totalEstimateVnd: null,
        pnlIncurredVnd: null, profitMargin: null, exchangeRate: null,
        sheetTab: tab, sheetRow: row, lines: [], headerSeen: false,
      }
      drafts.set(code, d)
      order.push(code)
    }
    return d
  }

  const usedTabs: string[] = []

  for (const tab of tabs) {
    const ws = wb.Sheets[tab]
    if (!ws) continue
    const rows = XLSX.utils.sheet_to_json<Cell[]>(ws, { header: 1, raw: true, defval: null, blankrows: true })
    if (!rows.length) continue

    const cols = mapColumns(rows[0] ?? [])
    if (!cols) {
      warnings.push(`Tab "${tab}" skipped — its first row is not the checklist header (TOUR CODE, AGENT, ARRIVAL, DETAILS FOR PAYMENT, Total estimate)`)
      continue
    }
    usedTabs.push(tab)

    // The house rate sits under "Total VND" in the rows between the header and the data.
    let tabRate: number | null = null
    for (let i = 1; i < Math.min(rows.length, 5); i++) {
      const r = rows[i] ?? []
      if (text(at(r, cols.tourCode))) break
      const n = num(at(r, cols.totalVnd), 4)
      if (n && n > 1000 && n < 100000) { tabRate = n; break }
    }

    let lastCode: string | null = null

    for (let i = 1; i < rows.length; i++) {
      const r = rows[i] ?? []
      const sheetRow = i + 1
      let code = text(at(r, cols.tourCode))
      if (code && norm(code) === 'tourcode') continue   // a repeated header

      const details = at(r, cols.details)
      const arrival = isoDate(at(r, cols.arrival))
      const departure = isoDate(at(r, cols.departure))
      const agentText = text(at(r, cols.agent))
      const isHeader = Boolean(code) && Boolean(arrival || departure) && (Boolean(agentText) || num(at(r, cols.pax)) !== null)

      if (isHeader && code) {
        lastCode = code
        const d = draftFor(code, tab, sheetRow)
        if (d.headerSeen) { dupHeaders++; continue }   // keep the first; the desk is mid-copy
        d.headerSeen = true
        d.sheetTab = tab
        d.sheetRow = sheetRow
        d.agent = agentText
        d.pax = num(at(r, cols.pax), 0)
        d.monthLabel = monthLabel(at(r, cols.month))
        d.arrivalDate = arrival
        d.departureDate = departure
        d.days = num(at(r, cols.days), 0)
        d.itinerary = text(at(r, cols.itinerary), 500)
        d.quotedUsd = num(details)
        d.revenueUsd = num(at(r, cols.revenueUsd))
        d.totalVnd = num(at(r, cols.totalVnd))
        d.totalEstimateVnd = num(at(r, cols.totalEstimate))
        d.pnlIncurredVnd = num(at(r, cols.pnl))
        d.profitMargin = num(at(r, cols.margin), 6)
        d.exchangeRate = d.revenueUsd && d.totalVnd
          ? Math.round((d.totalVnd / d.revenueUsd) * 100) / 100
          : tabRate
        continue
      }

      const detailsText = typeof details === 'number' ? null : text(details, 5000)
      if (!detailsText) continue   // blank / pre-filled row

      if (!code) {
        // A line with its tour code cell left empty — it belongs to the block above.
        if (!lastCode) continue
        code = lastCode
        orphanLines++
      } else {
        lastCode = code
      }

      const d = draftFor(code, tab, sheetRow)
      // Column B on a line row is the agent's booking reference ("496565CNTL").
      if (agentText && !d.agentRef) d.agentRef = agentText
      const paidRaw = text(at(r, cols.paid))
      d.lines.push({
        position: d.lines.length,
        sheetTab: tab,
        sheetRow,
        details: detailsText,
        vendor: text(at(r, cols.vendor)),
        code: text(at(r, cols.code), 64),
        dates: datesCell(at(r, cols.dates)),
        qcStatus: text(at(r, cols.qc)),
        unitPrice: num(at(r, cols.unitPrice), 4),
        quan1: num(at(r, cols.quan1)),
        quan2: num(at(r, cols.quan2)),
        totalEstimateVnd: num(at(r, cols.totalEstimate)),
        paidRaw,
        paidBucket: paidBucketOf(paidRaw),
        incurred: text(at(r, cols.incurred)),
        note: text(at(r, cols.note), 2000),
      })
      lineCount++
    }
  }

  if (!usedTabs.length) throw new Error(warnings.join('; ') || 'No checklist tab could be read')
  if (orphanLines) warnings.push(`${orphanLines} line(s) had no tour code and were put under the tour above them`)
  if (dupHeaders) warnings.push(`${dupHeaders} tour(s) have a second header row — the first one was used`)

  const tours: ParsedTour[] = order.map(code => {
    const { headerSeen, ...d } = drafts.get(code)!
    if (!headerSeen) warnings.push(`${code}: payment lines but no header row`)
    const refs = refsInCode(code)
    // Positions are left out of the hash so rows inserted above a tour do not
    // make it "changed" — only what the desk typed in it does.
    const contentHash = hashOf({
      ...d, sheetTab: undefined, sheetRow: undefined,
      lines: d.lines.map(l => ({ ...l, sheetTab: undefined, sheetRow: undefined })),
    })
    return { ...d, refs, refKey: refKeyOf(refs), primaryRef: refs[0] ?? null, contentHash }
  })

  return { tabs: usedTabs, allTabs, tours, lineCount, warnings: warnings.slice(0, 40) }
}
