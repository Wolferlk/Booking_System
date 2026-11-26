/**
 * MC Excel Feed — the planner. Pure: no Prisma, no Graph, no clock.
 *
 * Given what the sheet holds now and what OPS says, decide — cell by cell —
 * what to write, and (for the two-way columns) what to send back to OPS. The
 * executor (sync.ts) only carries the plan out; the preview shows the very same
 * plan without carrying it out.
 *
 * Rules, in the order they matter:
 *   1. OPS columns are written from OPS. Desk columns are never in any write.
 *   2. Two-way columns (Meeting Time, Driver Details) are a three-way merge
 *      against the value both sides agreed on at the last sync ("base"):
 *        only OPS changed   → Excel is updated
 *        only Excel changed → OPS is updated (write-back; its own switch)
 *        both changed       → a conflict: neither side is touched, a person settles it
 *      A cell the desk blanked never clears OPS — the OPS value is put back.
 *      A two-way cell is only ever written on its own (never as part of an OPS
 *      run), so writing OPS columns can never overwrite a desk edit in it.
 *   3. A row is never deleted. A movement that left OPS keeps its row and gets
 *      "Removed in OPS"; a row the desk deleted is not put back unless asked.
 *   4. Rows follow their movement across chart saves (new ids): aliases first,
 *      then content (same booking + date + To/From/service), then position.
 *   5. Implausible plans are not trusted: mass flags and mass write-backs are
 *      held back with a warning.
 */
import {
  cellKey, cellToYmd, colLetter, driverKey, driverText, excelText, FEED_COLUMNS, INACTIVE_STATUSES, normHeader,
  OPS_KEYS, REQUIRED_KEYS, splitDriverText, STATUS, timeCell, timeKey, toSerial, TWO_WAY_KEYS,
  type FeedCellValue, type FeedCounts, type FeedRow, type PlanSample, type TwoWayKey,
} from './shared'

// ── Header ───────────────────────────────────────────────────────────────────

export interface HeaderMap {
  /** column key → 0-based column index on the sheet */
  cols: Record<string, number>
  missing: string[]
  /** OPS / two-way columns missing — never written until the header has them. */
  missingOps: string[]
  missingRequired: string[]
  duplicateHeaders: string[]
}

export function mapHeader(header: unknown[]): HeaderMap {
  const cols: Record<string, number> = {}
  const duplicateHeaders: string[] = []
  header.forEach((h, i) => {
    const raw = String(h ?? '').trim()
    const n = raw === '#' ? '#' : normHeader(raw)
    if (!n) return
    const col = FEED_COLUMNS.find(c => c.aliases.includes(n))
    if (!col) return
    if (cols[col.key] !== undefined) { duplicateHeaders.push(raw); return }
    cols[col.key] = i
  })
  const missing = FEED_COLUMNS.filter(c => cols[c.key] === undefined).map(c => c.key)
  return {
    cols,
    missing,
    missingOps: missing.filter(k => FEED_COLUMNS.find(c => c.key === k)!.source !== 'desk'),
    missingRequired: REQUIRED_KEYS.filter(k => cols[k] === undefined),
    duplicateHeaders,
  }
}

/** The header is the first of the top 10 rows that names the Agenda Line ID and VN Number columns. */
export function findHeaderRow(grid: unknown[][]): number {
  for (let r = 0; r < Math.min(10, grid.length); r++) {
    const m = mapHeader(grid[r] ?? [])
    if (m.cols.lineId !== undefined && m.cols.ref !== undefined) return r
  }
  return -1
}

// ── Cell values ──────────────────────────────────────────────────────────────

export const DATE_FORMAT = 'ddd dd mmm yyyy'

/** Per-sheet values that do not depend on the movement. */
export interface CellContext { bandFormula: string }

/**
 * "#": the booking's running number on this sheet. ROW()-relative INDEX, so it
 * stays right when rows are inserted, sorted or filtered — and its odd / even
 * drives the two booking colours.
 */
export function cellContext(header: HeaderMap, headerRow: number): CellContext {
  const band = header.cols.band
  const ref = header.cols.ref
  if (band === undefined || ref === undefined) return { bandFormula: '' }
  const A = colLetter(band)
  const R = colLetter(ref)
  const first = headerRow + 1
  return {
    bandFormula: `=IF(ROW()<=${first},1,IF(INDEX($${R}:$${R},ROW())=INDEX($${R}:$${R},ROW()-1),INDEX($${A}:$${A},ROW()-1),INDEX($${A}:$${A},ROW()-1)+1))`,
  }
}

/** Text that Excel would turn into a number or date if written plainly ("2203856209750", "12/01"). */
const looksNumeric = (s: string) => /^[\d\s.,/:-]+$/.test(s) && /\d/.test(s)

/** The value OPS writes for one one-way column of one movement. */
export function desiredCell(row: FeedRow, key: string, ctx: CellContext = { bandFormula: '' }): { value: FeedCellValue; format: string; compare: string } {
  const col = FEED_COLUMNS.find(c => c.key === key)!
  if (col.kind === 'formula') return { value: ctx.bandFormula, format: '0', compare: '#formula' }
  if (col.kind === 'date') {
    const ymd = key === 'arrival' ? row.arrival : row.date
    const serial = toSerial(ymd)
    return { value: serial ?? '', format: DATE_FORMAT, compare: ymd }
  }
  const raw = (row as unknown as Record<string, unknown>)[key]
  if (typeof raw === 'number') return { value: raw, format: 'General', compare: cellKey(raw) }
  const s = String(raw ?? '')
  const value = looksNumeric(s) ? `'${s}` : excelText(s)
  return { value, format: 'General', compare: cellKey(s) }
}

/** What OPS holds for a two-way column, as an Excel cell and as a compare key. */
export function twoWayCell(row: FeedRow, key: TwoWayKey): { value: FeedCellValue; format: string; key: string; shown: string } {
  if (key === 'meetingTime') {
    const c = timeCell(row.meetingTime ?? '')
    return { ...c, key: timeKey(row.meetingTime), shown: row.meetingTime ?? '' }
  }
  const text = driverText(row.driverName ?? '', row.driverPhone ?? '')
  return { value: looksNumeric(text) ? `'${text}` : excelText(text), format: 'General', key: driverKey(row.driverName ?? '', row.driverPhone ?? ''), shown: text }
}

/** The compare key of what the sheet holds in a two-way column. */
export function sheetTwoWayKey(key: TwoWayKey, v: unknown): { key: string; shown: string } {
  if (key === 'meetingTime') { const k = timeKey(v); return { key: k, shown: typeof v === 'number' ? k : cellKey(v) } }
  const text = cellKey(v)
  const d = splitDriverText(text)
  return { key: driverKey(d.name, d.phone), shown: text }
}

function sameCell(key: string, sheet: unknown, want: { compare: string }): boolean {
  const col = FEED_COLUMNS.find(c => c.key === key)!
  if (col.kind === 'formula') return typeof sheet === 'number' && sheet >= 1
  if (col.kind === 'date') return (cellToYmd(sheet) ?? '') === want.compare
  return cellKey(sheet) === want.compare
}

export type TwoWayDecision = 'same' | 'toExcel' | 'toOps' | 'conflict'

/** The three-way merge for one two-way cell. Pure and exported for tests. */
export function decideTwoWay(opsKey: string, xlKey: string, base: string | undefined): TwoWayDecision {
  if (opsKey === xlKey) return 'same'
  if (base === undefined) {
    // Never synced: an empty side takes the other's value; two different values are a conflict.
    if (!xlKey) return 'toExcel'
    if (!opsKey) return 'toOps'
    return 'conflict'
  }
  const opsChanged = opsKey !== base
  const xlChanged = xlKey !== base
  if (!xlChanged) return 'toExcel'
  // The desk blanked the cell: a blank never clears OPS — the OPS value goes back.
  if (!opsChanged) return xlKey ? 'toOps' : 'toExcel'
  return 'conflict'
}

// ── Plan ─────────────────────────────────────────────────────────────────────

export type BaseEntry = { t?: string; d?: string }
const BASE_FIELD: Record<TwoWayKey, 't' | 'd'> = { meetingTime: 't', driver: 'd' }

export interface Writeback {
  lineId: string
  bookingRef: string
  field: TwoWayKey
  /** What OPS holds now (compare-and-set: applied only if OPS still holds it). */
  opsMeetingTime: string
  opsDriver: { name: string; phone: string }
  /** What Excel says. */
  meetingTime: string
  driver: { name: string; phone: string }
  xlKey: string
  baseBefore: string | undefined
  label: string
  date: string
}

export interface PlanInput {
  header: HeaderMap
  /** 1-based sheet row of the header. */
  headerRow: number
  /** Data rows below the header: rows[i] is sheet row headerRow + 1 + i. */
  rows: unknown[][]
  feed: FeedRow[]
  /** bookingRef → line ids on the sheet (or deliberately deleted from it) after the last sync. */
  written: Map<string, Set<string>>
  /** Agenda line id carried by a chart save: old id → new id. */
  alias: Map<string, string>
  /** Two-way values agreed at the last sync, by the line id the sheet row carried. */
  base?: Map<string, BaseEntry>
  placement: 'sorted' | 'append'
  restoreDeleted: boolean
  greyInactive: boolean
  /** Excel → OPS switched on. */
  writeBack?: boolean
  /** Send a write-back batch larger than the safety limit (a person looked at it). */
  allowBulkWriteBack?: boolean
}

export interface RowWrite {
  /** 1-based sheet rows, inclusive (pre-insert numbering for updates). */
  firstRow: number
  lastRow: number
  /** 0-based column indexes, inclusive — an OPS run, or a single two-way / status cell. */
  firstCol: number
  lastCol: number
  values: FeedCellValue[][]
  formats: string[][]
}

export interface InsertBlock {
  /** New rows go directly below this sheet row (pre-insert numbering). */
  after: number
  feed: FeedRow[]
  /** True when the block lands below the last used row — no shifting needed. */
  atEnd: boolean
}

export interface FeedPlan {
  ok: boolean
  blocked: string | null
  updates: RowWrite[]
  inserts: InsertBlock[]
  writebacks: Writeback[]
  grey: number[]
  ungrey: number[]
  counts: FeedCounts
  samples: PlanSample[]
  warnings: string[]
  nextWritten: Map<string, string[]>
  /** Two-way base to store after the plan, by (new) line id — assumes every write-back succeeds. */
  nextBase: Map<string, BaseEntry>
  lastDataRow: number
  headerRow: number
  runs: { first: number; last: number; keys: string[] }[]
  ctx: CellContext
}

const MAX_SAMPLES = 60
export const WRITEBACK_LIMIT = 60

/** Contiguous stretches of one-way OPS columns on this sheet. A desk or two-way column always breaks a run. */
export function opsRuns(header: HeaderMap): { first: number; last: number; keys: string[] }[] {
  const byIndex = new Map<number, string>()
  for (const key of OPS_KEYS) {
    const i = header.cols[key]
    if (i !== undefined) byIndex.set(i, key)
  }
  const indexes = Array.from(byIndex.keys()).sort((a, b) => a - b)
  const runs: { first: number; last: number; keys: string[] }[] = []
  for (const i of indexes) {
    const last = runs[runs.length - 1]
    if (last && last.last === i - 1) { last.last = i; last.keys.push(byIndex.get(i)!) }
    else runs.push({ first: i, last: i, keys: [byIndex.get(i)!] })
  }
  return runs
}

const norm = (v: unknown) => cellKey(v).toLowerCase().replace(/\s+/g, ' ')

function resolveAlias(id: string, alias: Map<string, string>): string {
  let cur = id
  for (let i = 0; i < 25 && alias.has(cur); i++) {
    const next = alias.get(cur)!
    if (next === cur) break
    cur = next
  }
  return cur
}

const label = (r: Pick<FeedRow, 'from' | 'to' | 'location'>) =>
  [r.from, r.to].filter(Boolean).join(' → ').replace(/\n/g, ', ').slice(0, 140) || r.location || '—'

interface SheetLine {
  row: number
  cells: unknown[]
  lineId: string
  bookingRef: string | null
  date: string | null
  arrival: string | null
  status: string
}

type Piece = { row: number; first: number; last: number; values: FeedCellValue[]; formats: string[] }

/** Stack pieces of the same columns on consecutive rows into one write. */
function coalesce(pieces: Piece[]): RowWrite[] {
  const out: RowWrite[] = []
  const sorted = [...pieces].sort((a, b) => a.first - b.first || a.last - b.last || a.row - b.row)
  for (const p of sorted) {
    const w = out[out.length - 1]
    if (w && w.firstCol === p.first && w.lastCol === p.last && w.lastRow === p.row - 1 && w.values.length < 400) {
      w.lastRow = p.row; w.values.push(p.values); w.formats.push(p.formats)
    } else {
      out.push({ firstRow: p.row, lastRow: p.row, firstCol: p.first, lastCol: p.last, values: [p.values], formats: [p.formats] })
    }
  }
  return out
}

export function buildPlan(input: PlanInput): FeedPlan {
  const { header, headerRow, rows, feed, written, alias } = input
  const base = input.base ?? new Map<string, BaseEntry>()
  const c = header.cols
  const counts: FeedCounts = {
    feedRows: feed.length, sheetRows: 0, added: 0, updatedRows: 0, updatedCells: 0, rekeyed: 0,
    markedInactive: 0, deletedInExcel: 0, duplicates: 0, unchanged: 0, toOps: 0, toOpsWaiting: 0, conflicts: 0,
  }
  const samples: PlanSample[] = []
  const warnings: string[] = []
  const sample = (s: PlanSample) => { if (samples.filter(x => x.kind === s.kind).length < MAX_SAMPLES) samples.push(s) }
  const runs = opsRuns(header)
  const ctx = cellContext(header, headerRow)
  const twoWayCols = TWO_WAY_KEYS.filter(k => c[k] !== undefined)

  const empty = (blocked: string): FeedPlan => ({
    ok: false, blocked, updates: [], inserts: [], writebacks: [], grey: [], ungrey: [], counts, samples, warnings,
    nextWritten: new Map(), nextBase: new Map(), lastDataRow: headerRow, headerRow, runs, ctx,
  })
  if (header.missingRequired.length) {
    const names = header.missingRequired.map(k => FEED_COLUMNS.find(x => x.key === k)!.header)
    return empty(`The header row has no ${names.join(', ')} column — press "Prepare sheet" (or add the header) first`)
  }

  const refLookup = new Map<string, string>()
  for (const f of feed) {
    refLookup.set(f.bookingRef.toUpperCase(), f.bookingRef)
    if (f.ref) refLookup.set(f.ref.toUpperCase(), f.bookingRef)
  }
  const feedById = new Map(feed.map(f => [f.lineId, f]))
  const bookingsInFeed = new Set(feed.map(f => f.bookingRef))

  // ── Read the sheet ─────────────────────────────────────────────────────────
  let lastDataRow = headerRow
  const lines: SheetLine[] = []
  const seenIds = new Set<string>()
  const allRows: { row: number; bookingRef: string | null; date: string | null; arrival: string | null }[] = []
  rows.forEach((cells, i) => {
    const row = headerRow + 1 + i
    if (cells.some(v => cellKey(v) !== '')) lastDataRow = row
    const refText = cellKey(cells[c.ref]).toUpperCase()
    const bookingRef = refText ? (refLookup.get(refText) ?? refText) : null
    const date = cellToYmd(cells[c.date])
    const arrival = c.arrival !== undefined ? cellToYmd(cells[c.arrival]) : null
    if (bookingRef || date) allRows.push({ row, bookingRef, date, arrival })
    const lineId = cellKey(cells[c.lineId])
    if (!lineId) return
    if (seenIds.has(lineId)) { counts.duplicates++; return }
    seenIds.add(lineId)
    lines.push({ row, cells, lineId, bookingRef, date, arrival, status: c.status !== undefined ? cellKey(cells[c.status]) : '' })
  })
  counts.sheetRows = lines.length
  if (counts.duplicates) warnings.push(`${counts.duplicates} row(s) repeat an Agenda Line ID already on the sheet (a copied row?) — only the first is kept in step; the copies are left alone`)

  if (!feed.length && lines.length > 20) {
    return empty('OPS returned no movements while the sheet holds many — refusing to flag every row as removed. Check the start date and countries.')
  }

  // ── Match sheet rows to movements ─────────────────────────────────────────
  const matched = new Map<number, FeedRow>()
  const claimed = new Set<string>()
  const rekeyedRows = new Set<number>()

  for (const l of lines) {
    const f = feedById.get(l.lineId)
    if (f) { matched.set(l.row, f); claimed.add(f.lineId) }
  }
  for (const l of lines) {
    if (matched.has(l.row)) continue
    const target = resolveAlias(l.lineId, alias)
    const f = target !== l.lineId ? feedById.get(target) : undefined
    if (f && !claimed.has(f.lineId)) { matched.set(l.row, f); claimed.add(f.lineId); rekeyedRows.add(l.row) }
  }

  const orphans = lines.filter(l => !matched.has(l.row))
  const openByDay = new Map<string, FeedRow[]>()
  for (const f of feed) {
    if (claimed.has(f.lineId)) continue
    const k = `${f.bookingRef}|${f.date}`
    ;(openByDay.get(k) ?? openByDay.set(k, []).get(k)!).push(f)
  }
  const score = (l: SheetLine, f: FeedRow) => {
    let s = 0
    if (c.to !== undefined && norm(l.cells[c.to]) && norm(l.cells[c.to]) === norm(f.to)) s += 4
    if (c.from !== undefined && norm(l.cells[c.from]) && norm(l.cells[c.from]) === norm(f.from)) s += 2
    if (c.serviceType !== undefined && norm(l.cells[c.serviceType]) === norm(f.serviceType)) s += 1
    if (c.location !== undefined && norm(l.cells[c.location]) === norm(f.location)) s += 1
    return s
  }
  for (const l of orphans) {
    if (!l.bookingRef || !l.date) continue
    const pool = openByDay.get(`${l.bookingRef}|${l.date}`)
    if (!pool?.length) continue
    let best: FeedRow | null = null
    let bestScore = 0
    for (const f of pool) { const s = score(l, f); if (s > bestScore) { best = f; bestScore = s } }
    if (best && bestScore >= 4) {
      matched.set(l.row, best); claimed.add(best.lineId); rekeyedRows.add(l.row)
      pool.splice(pool.indexOf(best), 1)
    }
  }
  const leftByDay = new Map<string, SheetLine[]>()
  for (const l of orphans) {
    if (matched.has(l.row) || !l.bookingRef || !l.date) continue
    const k = `${l.bookingRef}|${l.date}`
    ;(leftByDay.get(k) ?? leftByDay.set(k, []).get(k)!).push(l)
  }
  for (const [k, ls] of Array.from(leftByDay.entries())) {
    const pool = openByDay.get(k)
    if (!pool?.length || pool.length !== ls.length) continue
    ls.sort((a, b) => a.row - b.row).forEach((l, i) => {
      const f = pool[i]
      matched.set(l.row, f); claimed.add(f.lineId); rekeyedRows.add(l.row)
    })
    pool.length = 0
  }

  // ── Matched rows: one-way updates + two-way merge ─────────────────────────
  const pieces: Piece[] = []
  const grey: number[] = []
  const ungrey: number[] = []
  const nextBase = new Map<string, BaseEntry>()
  const writebacks: Writeback[] = []
  const pendingToOps: { wb: Writeback; sample: PlanSample }[] = []

  for (const l of lines) {
    const f = matched.get(l.row)
    if (!f) continue
    const diffs: { column: string; from: string; to: string }[] = []
    const changedKeys = new Set<string>()
    const values = new Map<string, { value: FeedCellValue; format: string }>()
    for (const key of OPS_KEYS) {
      if (c[key] === undefined) continue
      const want = desiredCell(f, key, ctx)
      values.set(key, { value: want.value, format: want.format })
      if (!sameCell(key, l.cells[c[key]], want)) {
        changedKeys.add(key)
        if (key !== 'band') diffs.push({ column: FEED_COLUMNS.find(x => x.key === key)!.header, from: cellKey(l.cells[c[key]]).slice(0, 120), to: want.compare.slice(0, 120) })
      }
    }
    for (const run of runs) {
      if (!run.keys.some(k => changedKeys.has(k))) continue
      pieces.push({ row: l.row, first: run.first, last: run.last, values: run.keys.map(k => values.get(k)!.value), formats: run.keys.map(k => values.get(k)!.format) })
    }

    // Two-way cells
    const prevBase = base.get(l.lineId) ?? {}
    const entry: BaseEntry = {}
    for (const key of twoWayCols) {
      const ops = twoWayCell(f, key)
      const xl = sheetTwoWayKey(key, l.cells[c[key]])
      const baseKey = prevBase[BASE_FIELD[key]]
      const decision = decideTwoWay(ops.key, xl.key, baseKey)
      const column = FEED_COLUMNS.find(x => x.key === key)!.header
      if (decision === 'same') { entry[BASE_FIELD[key]] = ops.key; continue }
      if (decision === 'toExcel') {
        entry[BASE_FIELD[key]] = ops.key
        changedKeys.add(key)
        diffs.push({ column, from: xl.shown.slice(0, 120), to: ops.shown.slice(0, 120) })
        pieces.push({ row: l.row, first: c[key], last: c[key], values: [ops.value], formats: [ops.format] })
        continue
      }
      const s: PlanSample = {
        kind: decision === 'conflict' ? 'conflict' : 'toOps', row: l.row, bookingRef: f.bookingRef, date: f.date, label: label(f),
        changes: [{ column, from: ops.shown.slice(0, 120) || '—', to: xl.shown.slice(0, 120) || '—' }],
        field: key, sheetLineId: l.lineId, opsKey: ops.key, xlKey: xl.key,
      }
      if (baseKey !== undefined) entry[BASE_FIELD[key]] = baseKey
      if (decision === 'conflict') { counts.conflicts++; sample(s); continue }
      // Excel → OPS
      const waiting = !input.writeBack ? 'Excel → OPS is switched off'
        : key === 'driver' && f.driverLock ? `${f.driverLock} — no driver is written to this movement`
        : null
      if (waiting) { counts.toOpsWaiting++; sample({ ...s, waiting }); continue }
      const parsed = splitDriverText(xl.shown)
      const tk = timeKey(xl.shown)
      const wb: Writeback = {
        lineId: f.lineId, bookingRef: f.bookingRef, field: key,
        opsMeetingTime: f.meetingTime, opsDriver: { name: f.driverName, phone: f.driverPhone },
        meetingTime: /^\d{2}:\d{2}$/.test(tk) ? tk : xl.shown.slice(0, 100),
        driver: { name: parsed.name.slice(0, 120), phone: parsed.phone.slice(0, 40) },
        xlKey: xl.key, baseBefore: baseKey, label: label(f), date: f.date,
      }
      entry[BASE_FIELD[key]] = xl.key        // provisional — the executor reverts it if OPS refuses
      pendingToOps.push({ wb, sample: s })
    }
    nextBase.set(f.lineId, entry)

    if (rekeyedRows.has(l.row)) {
      counts.rekeyed++
      sample({ kind: 'rekey', row: l.row, bookingRef: f.bookingRef, date: f.date, label: label(f), changes: diffs })
    }
    if (!changedKeys.size) { counts.unchanged++; continue }
    counts.updatedRows++
    counts.updatedCells += changedKeys.size
    if (!rekeyedRows.has(l.row)) sample({ kind: 'update', row: l.row, bookingRef: f.bookingRef, date: f.date, label: label(f), changes: diffs })
    if (input.greyInactive) {
      const was = INACTIVE_STATUSES.includes(l.status)
      const now = INACTIVE_STATUSES.includes(f.status)
      if (now && !was) grey.push(l.row)
      if (was && !now) ungrey.push(l.row)
    }
  }

  // Write-backs: held back when implausibly many arrive at once.
  if (pendingToOps.length > WRITEBACK_LIMIT && !input.allowBulkWriteBack) {
    warnings.push(`${pendingToOps.length} Meeting Time / Driver changes came from the Excel at once — more than ${WRITEBACK_LIMIT} looks like a paste or a moved column, so none were sent to OPS. Check the preview, then use "Send all to OPS".`)
    for (const { wb, sample: s } of pendingToOps) {
      counts.toOpsWaiting++
      sample({ ...s, waiting: 'Held back — too many at once' })
      const e = nextBase.get(wb.lineId)!
      if (wb.baseBefore === undefined) delete e[BASE_FIELD[wb.field]]; else e[BASE_FIELD[wb.field]] = wb.baseBefore
    }
  } else {
    for (const { wb, sample: s } of pendingToOps) { counts.toOps++; writebacks.push(wb); sample(s) }
  }

  // Rows whose movement is gone.
  const toFlag = lines.filter(l => !matched.has(l.row) && l.status !== STATUS.removed)
  const flagLimit = Math.max(20, Math.ceil(lines.length * 0.3))
  if (toFlag.length > flagLimit && c.status !== undefined) {
    warnings.push(`${toFlag.length} sheet rows no longer match an OPS movement — more than looks right for one sync, so none were flagged. Check the start date / countries, then run again.`)
  } else if (c.status !== undefined) {
    const v = desiredCell({ status: STATUS.removed } as FeedRow, 'status')
    for (const l of toFlag) {
      pieces.push({ row: l.row, first: c.status, last: c.status, values: [v.value], formats: [v.format] })
      counts.markedInactive++
      if (input.greyInactive && !INACTIVE_STATUSES.includes(l.status)) grey.push(l.row)
      const known = l.bookingRef && bookingsInFeed.has(l.bookingRef)
      sample({
        kind: 'inactive', row: l.row, bookingRef: l.bookingRef ?? '?', date: l.date ?? '',
        label: `${c.to !== undefined ? cellKey(l.cells[c.to]).slice(0, 100) || '—' : '—'}${known ? '' : ' · booking not in the feed (arrival moved / country / deleted)'}`,
      })
    }
  }
  const updates = coalesce(pieces)

  // ── New rows ──────────────────────────────────────────────────────────────
  const deleted: FeedRow[] = []
  const toInsert: FeedRow[] = []
  const memory = lines.length === 0 ? new Map<string, Set<string>>() : written
  if (lines.length === 0 && written.size > 0) warnings.push('The tab holds no feed rows any more (cleared or replaced?) — it is filled again from the start')
  for (const f of feed) {
    if (claimed.has(f.lineId) || f.noInsert) continue
    const seen = memory.get(f.bookingRef)
    const wasWritten = seen ? (seen.has(f.lineId) || Array.from(seen).some(w => resolveAlias(w, alias) === f.lineId)) : false
    if (wasWritten && !input.restoreDeleted) {
      deleted.push(f)
      sample({ kind: 'deleted', row: null, bookingRef: f.bookingRef, date: f.date, label: label(f) })
      continue
    }
    toInsert.push(f)
  }
  counts.deletedInExcel = deleted.length
  if (deleted.length > 20 && deleted.length > feed.length * 0.3) {
    warnings.push(`${deleted.length} movements were deleted from the Excel by hand and are being left out. If that was not deliberate, use "Put back deleted rows".`)
  }

  const cmp = (a: [string, string], b: [string, string]) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0)
  const anchorOf = (f: FeedRow): number => {
    if (input.placement === 'append') return lastDataRow
    const own = allRows.filter(r => r.bookingRef === f.bookingRef)
    if (own.length) {
      const before = own.filter(r => r.date && r.date <= f.date)
      if (before.length) return Math.max(...before.map(r => r.row))
      return Math.min(...own.map(r => r.row)) - 1
    }
    const dated = allRows.filter(r => r.arrival && r.bookingRef)
    if (!dated.length) return lastDataRow
    const key: [string, string] = [f.arrival, f.bookingRef]
    const before = dated.filter(r => cmp([r.arrival!, r.bookingRef!], key) <= 0)
    if (before.length) return Math.max(...before.map(r => r.row))
    return Math.min(...dated.map(r => r.row)) - 1
  }
  const blocks = new Map<number, FeedRow[]>()
  for (const f of toInsert) {
    const at = Math.max(headerRow, Math.min(anchorOf(f), lastDataRow))
    ;(blocks.get(at) ?? blocks.set(at, []).get(at)!).push(f)
  }
  const inserts: InsertBlock[] = Array.from(blocks.entries())
    .sort((a, b) => b[0] - a[0])
    .map(([after, fs]) => ({ after, feed: fs, atEnd: after >= lastDataRow }))
  for (const b of inserts) for (const f of b.feed) {
    counts.added++
    sample({ kind: 'add', row: b.after + 1, bookingRef: f.bookingRef, date: f.date, label: label(f) })
    const entry: BaseEntry = {}
    for (const key of twoWayCols) entry[BASE_FIELD[key]] = twoWayCell(f, key).key
    nextBase.set(f.lineId, entry)
  }

  const nextWritten = new Map<string, string[]>()
  const add = (ref: string, id: string) => { (nextWritten.get(ref) ?? nextWritten.set(ref, []).get(ref)!).push(id) }
  matched.forEach(f => add(f.bookingRef, f.lineId))
  for (const f of toInsert) add(f.bookingRef, f.lineId)
  for (const f of deleted) add(f.bookingRef, f.lineId)

  return {
    ok: true, blocked: null, updates, inserts, writebacks, grey, ungrey, counts, samples, warnings,
    nextWritten, nextBase, lastDataRow, headerRow, runs, ctx,
  }
}

/** The cell blocks for an insert block's rows, starting at sheet row `firstRow`. */
export function insertWrites(block: InsertBlock, firstRow: number, header: HeaderMap, ctx: CellContext): RowWrite[] {
  const lastRow = firstRow + block.feed.length - 1
  const out: RowWrite[] = opsRuns(header).map(run => ({
    firstRow, lastRow, firstCol: run.first, lastCol: run.last,
    values: block.feed.map(f => run.keys.map(k => desiredCell(f, k, ctx).value)),
    formats: block.feed.map(f => run.keys.map(k => desiredCell(f, k, ctx).format)),
  }))
  for (const key of TWO_WAY_KEYS) {
    const col = header.cols[key]
    if (col === undefined) continue
    out.push({
      firstRow, lastRow, firstCol: col, lastCol: col,
      values: block.feed.map(f => [twoWayCell(f, key).value]),
      formats: block.feed.map(f => [twoWayCell(f, key).format]),
    })
  }
  return out
}
