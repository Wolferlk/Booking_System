/**
 * MC Excel Feed — the planner. Pure: no Prisma, no Graph, no clock.
 *
 * Given what the sheet holds now and what OPS says, decide — cell by cell —
 * what to write. The executor (sync.ts) only carries the plan out, and the
 * preview shows the very same plan without carrying it out.
 *
 * Rules, in the order they matter:
 *   1. Only OPS columns are ever written. A desk column is not in any write,
 *      not even as a blank — the runs below are built from OPS columns only.
 *   2. A row is never deleted. A movement that left OPS keeps its row (and the
 *      desk's notes on it) and gets "Removed in OPS" in OPS Status.
 *   3. A row the desk deleted is not put back (it was written before — the
 *      per-booking `written` set remembers), unless asked to restore.
 *   4. Rows are re-attached to their movement when a chart save gave it a new
 *      id: first through the ids the save recorded (aliases), then by content
 *      (same booking + date, then To/From/service), then by position in the day.
 *   5. A plan that would flag an implausible share of the sheet as removed is
 *      not trusted: the flags are skipped and a warning is raised instead.
 */
import {
  cellKey, cellToYmd, excelText, FEED_COLUMNS, INACTIVE_STATUSES, normHeader, OPS_KEYS, REQUIRED_KEYS, STATUS, toSerial,
  type FeedCellValue, type FeedCounts, type FeedRow, type PlanSample,
} from './shared'

// ── Header ───────────────────────────────────────────────────────────────────

export interface HeaderMap {
  /** column key → 0-based column index on the sheet */
  cols: Record<string, number>
  /** Feed columns with no header on the sheet. */
  missing: string[]
  /** OPS columns missing — never written until the header has them. */
  missingOps: string[]
  /** Required columns missing — no sync can run. */
  missingRequired: string[]
  /** Header cells that appear twice (first one wins). */
  duplicateHeaders: string[]
}

export function mapHeader(header: unknown[]): HeaderMap {
  const cols: Record<string, number> = {}
  const duplicateHeaders: string[] = []
  header.forEach((h, i) => {
    const n = normHeader(h)
    if (!n) return
    const col = FEED_COLUMNS.find(c => c.aliases.includes(n))
    if (!col) return
    if (cols[col.key] !== undefined) { duplicateHeaders.push(String(h)); return }
    cols[col.key] = i
  })
  const missing = FEED_COLUMNS.filter(c => cols[c.key] === undefined).map(c => c.key)
  return {
    cols,
    missing,
    missingOps: missing.filter(k => OPS_KEYS.includes(k)),
    missingRequired: REQUIRED_KEYS.filter(k => cols[k] === undefined),
    duplicateHeaders,
  }
}

/** The header is the first of the top 10 rows that names the Agenda Line ID column. */
export function findHeaderRow(grid: unknown[][]): number {
  for (let r = 0; r < Math.min(10, grid.length); r++) {
    const m = mapHeader(grid[r] ?? [])
    if (m.cols.lineId !== undefined && m.cols.ref !== undefined) return r
  }
  return -1
}

// ── Cell values ──────────────────────────────────────────────────────────────

export const DATE_FORMAT = 'dd-mmm-yyyy'

/** Text that Excel would turn into a number or date if written plainly ("2203856209750", "12/01"). */
const looksNumeric = (s: string) => /^[\d\s.,/:-]+$/.test(s) && /\d/.test(s)

/** The value OPS writes for one column of one movement. */
export function desiredCell(row: FeedRow, key: string): { value: FeedCellValue; format: string; compare: string } {
  const col = FEED_COLUMNS.find(c => c.key === key)!
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

/** Does the sheet already hold what OPS would write? */
function sameCell(key: string, sheet: unknown, want: { compare: string }): boolean {
  const col = FEED_COLUMNS.find(c => c.key === key)!
  if (col.kind === 'date') return (cellToYmd(sheet) ?? '') === want.compare
  return cellKey(sheet) === want.compare
}

// ── Plan ─────────────────────────────────────────────────────────────────────

export interface PlanInput {
  header: HeaderMap
  /** 1-based sheet row of the header. */
  headerRow: number
  /** Data rows below the header: rows[i] is sheet row headerRow + 1 + i. */
  rows: unknown[][]
  /** The feed, in the order the sheet should read. */
  feed: FeedRow[]
  /** bookingRef → line ids on the sheet (or deliberately deleted from it) after the last sync. */
  written: Map<string, Set<string>>
  /** Agenda line id carried by a chart save: old id → new id. */
  alias: Map<string, string>
  placement: 'sorted' | 'append'
  /** Put back rows the desk deleted. */
  restoreDeleted: boolean
  greyInactive: boolean
}

export interface RowWrite {
  /** 1-based sheet rows, inclusive. Before any insert of this plan (updates) or after (insert blocks). */
  firstRow: number
  lastRow: number
  /** 0-based column indexes, inclusive — always a run of OPS columns only. */
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
  /** Why nothing may be written (missing required columns, an empty feed…). */
  blocked: string | null
  updates: RowWrite[]
  inserts: InsertBlock[]
  /** Rows to grey out / back to normal (1-based, pre-insert). */
  grey: number[]
  ungrey: number[]
  counts: FeedCounts
  samples: PlanSample[]
  warnings: string[]
  /** The per-booking written sets to store once the plan has been carried out. */
  nextWritten: Map<string, string[]>
  lastDataRow: number
  /** OPS column runs: contiguous OPS-column ranges on this sheet (0-based, inclusive). */
  runs: { first: number; last: number; keys: string[] }[]
}

const MAX_SAMPLES = 60

/** Contiguous stretches of OPS columns on this sheet. A desk column always breaks a run. */
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
  row: number            // 1-based sheet row
  cells: unknown[]
  lineId: string
  bookingRef: string | null
  date: string | null
  arrival: string | null
  status: string
}

export function buildPlan(input: PlanInput): FeedPlan {
  const { header, headerRow, rows, feed, written, alias } = input
  const c = header.cols
  const counts: FeedCounts = {
    feedRows: feed.length, sheetRows: 0, added: 0, updatedRows: 0, updatedCells: 0, rekeyed: 0,
    markedInactive: 0, deletedInExcel: 0, duplicates: 0, unchanged: 0,
  }
  const samples: PlanSample[] = []
  const warnings: string[] = []
  const sample = (s: PlanSample) => { if (samples.filter(x => x.kind === s.kind).length < MAX_SAMPLES) samples.push(s) }
  const runs = opsRuns(header)

  const empty = (blocked: string): FeedPlan => ({
    ok: false, blocked, updates: [], inserts: [], grey: [], ungrey: [], counts, samples, warnings,
    nextWritten: new Map(), lastDataRow: headerRow, runs,
  })
  if (header.missingRequired.length) {
    const names = header.missingRequired.map(k => FEED_COLUMNS.find(x => x.key === k)!.header)
    return empty(`The header row has no ${names.join(', ')} column — press "Prepare sheet" (or add the header) first`)
  }

  // Booking lookup: the sheet shows the IS number; either spelling finds the booking.
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
    lines.push({
      row, cells, lineId, bookingRef, date, arrival,
      status: c.status !== undefined ? cellKey(cells[c.status]) : '',
    })
  })
  counts.sheetRows = lines.length
  if (counts.duplicates) warnings.push(`${counts.duplicates} row(s) repeat an Agenda Line ID already on the sheet (a copied row?) — only the first is kept in step; the copies are left alone`)

  if (!feed.length && lines.length > 20) {
    return empty('OPS returned no movements while the sheet holds many — refusing to flag every row as removed. Check the start date and countries.')
  }

  // ── Match sheet rows to movements ─────────────────────────────────────────
  const matched = new Map<number, FeedRow>()     // sheet row → feed row
  const claimed = new Set<string>()               // feed line ids already matched
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

  // By content, within the same booking and date.
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
  // Same number of unmatched rows and movements on a day: pair them in order.
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

  // ── Updates for matched rows, flags for the rest ──────────────────────────
  type RowChange = { row: number; values: Map<string, { value: FeedCellValue; format: string }>; changedKeys: Set<string> }
  const changes: RowChange[] = []
  const grey: number[] = []
  const ungrey: number[] = []

  for (const l of lines) {
    const f = matched.get(l.row)
    if (!f) continue
    const values = new Map<string, { value: FeedCellValue; format: string }>()
    const changedKeys = new Set<string>()
    const diffs: { column: string; from: string; to: string }[] = []
    for (const key of OPS_KEYS) {
      if (c[key] === undefined) continue
      const want = desiredCell(f, key)
      values.set(key, { value: want.value, format: want.format })
      if (!sameCell(key, l.cells[c[key]], want)) {
        changedKeys.add(key)
        diffs.push({ column: FEED_COLUMNS.find(x => x.key === key)!.header, from: cellKey(l.cells[c[key]]).slice(0, 120), to: want.compare.slice(0, 120) })
      }
    }
    if (rekeyedRows.has(l.row)) {
      counts.rekeyed++
      sample({ kind: 'rekey', row: l.row, bookingRef: f.bookingRef, date: f.date, label: label(f), changes: diffs })
    }
    if (!changedKeys.size) { counts.unchanged++; continue }
    changes.push({ row: l.row, values, changedKeys })
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

  // Rows whose movement is gone.
  const toFlag: { l: SheetLine; status: string }[] = []
  for (const l of lines) {
    if (matched.has(l.row)) continue
    const status = STATUS.removed
    if (l.status === status) continue
    toFlag.push({ l, status })
  }
  const flagLimit = Math.max(20, Math.ceil(lines.length * 0.3))
  if (toFlag.length > flagLimit && c.status !== undefined) {
    warnings.push(`${toFlag.length} sheet rows no longer match an OPS movement — more than looks right for one sync, so none were flagged. Check the start date / countries, then run again.`)
  } else if (c.status !== undefined) {
    for (const { l, status } of toFlag) {
      const v = desiredCell({ status } as FeedRow, 'status')
      changes.push({ row: l.row, values: new Map([['status', { value: v.value, format: v.format }]]), changedKeys: new Set(['status']) })
      counts.markedInactive++
      if (input.greyInactive && !INACTIVE_STATUSES.includes(l.status)) grey.push(l.row)
      const known = l.bookingRef && bookingsInFeed.has(l.bookingRef)
      sample({
        kind: 'inactive', row: l.row, bookingRef: l.bookingRef ?? '?', date: l.date ?? '',
        label: `${c.to !== undefined ? cellKey(l.cells[c.to]).slice(0, 100) || '—' : '—'}${known ? '' : ' · booking not in the feed (arrival moved / country / deleted)'}`,
      })
    }
  }

  // ── Coalesce updates into block writes over OPS runs only ─────────────────
  const updates: RowWrite[] = []
  changes.sort((a, b) => a.row - b.row)
  for (const run of runs) {
    let block: { first: number; last: number; values: FeedCellValue[][]; formats: string[][] } | null = null
    const flush = () => {
      if (block) updates.push({ firstRow: block.first, lastRow: block.last, firstCol: run.first, lastCol: run.last, values: block.values, formats: block.formats })
      block = null
    }
    for (const ch of changes) {
      if (!run.keys.some(k => ch.changedKeys.has(k))) { flush(); continue }
      // A status-only flag carries no other values: write just that cell.
      const onlyStatus = ch.values.size === 1 && ch.values.has('status')
      if (onlyStatus) {
        flush()
        const col = c.status
        const v = ch.values.get('status')!
        updates.push({ firstRow: ch.row, lastRow: ch.row, firstCol: col, lastCol: col, values: [[v.value]], formats: [[v.format]] })
        continue
      }
      const vals = run.keys.map(k => ch.values.get(k)?.value ?? '')
      const fmts = run.keys.map(k => ch.values.get(k)?.format ?? 'General')
      const b = block as { first: number; last: number; values: FeedCellValue[][]; formats: string[][] } | null
      if (b && b.last === ch.row - 1 && b.values.length < 400) { b.last = ch.row; b.values.push(vals); b.formats.push(fmts) }
      else { flush(); block = { first: ch.row, last: ch.row, values: [vals], formats: [fmts] } }
    }
    flush()
  }

  // ── New rows ──────────────────────────────────────────────────────────────
  const deleted: FeedRow[] = []
  const toInsert: FeedRow[] = []
  // A tab with no feed rows at all was cleared or replaced as a whole — that is a
  // fresh start, not thousands of individual deletions.
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
    .sort((a, b) => b[0] - a[0])                               // bottom-up: earlier anchors keep their numbers
    .map(([after, fs]) => ({ after, feed: fs, atEnd: after >= lastDataRow }))
  for (const b of inserts) for (const f of b.feed) {
    counts.added++
    sample({ kind: 'add', row: b.after + 1, bookingRef: f.bookingRef, date: f.date, label: label(f) })
  }

  // ── What the sheet holds after this plan, per booking ─────────────────────
  const nextWritten = new Map<string, string[]>()
  const add = (ref: string, id: string) => { (nextWritten.get(ref) ?? nextWritten.set(ref, []).get(ref)!).push(id) }
  matched.forEach(f => add(f.bookingRef, f.lineId))
  for (const f of toInsert) add(f.bookingRef, f.lineId)
  for (const f of deleted) add(f.bookingRef, f.lineId)

  return {
    ok: true, blocked: null, updates, inserts, grey, ungrey, counts, samples, warnings,
    nextWritten, lastDataRow, runs,
  }
}

/** The cell blocks for an insert block's rows, starting at sheet row `firstRow`. */
export function insertWrites(block: InsertBlock, firstRow: number, header: HeaderMap): RowWrite[] {
  return opsRuns(header).map(run => ({
    firstRow, lastRow: firstRow + block.feed.length - 1, firstCol: run.first, lastCol: run.last,
    values: block.feed.map(f => run.keys.map(k => desiredCell(f, k).value)),
    formats: block.feed.map(f => run.keys.map(k => desiredCell(f, k).format)),
  }))
}
