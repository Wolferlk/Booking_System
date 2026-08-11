/**
 * Reads Sri Lankan driver advances straight out of the accounts database.
 *
 * Both systems live on one MySQL instance, so this is a plain SELECT on
 * `sl_driver_advance_snapshots` — no HTTP, no second service to be up.
 *
 * ---- Why a snapshot table and not the real thing ----
 *
 * A driver advance is *derived*, not stored: the accounts system rebuilds it on
 * every read from the booking's payable lines, the configured advance
 * percentage, the LKR held back per booking, the live rate and any human
 * override. There is no column anywhere holding the answer, and reproducing
 * that rule here would mean two implementations of the arithmetic that decides
 * what cash a driver is handed — agreeing today, drifting apart the first time
 * either side changed.
 *
 * So the accounts system computes it with its own code
 * (`sl:driver-advance-snapshot`, every ten minutes) and writes the result down,
 * and this module reads what it wrote. `computed_at` comes back with every row
 * and the board shows it, so a figure never pretends to be more current than it
 * is.
 *
 * Read-only, like every other accounts-DB access from OPS. Nothing here writes.
 */
import mysql from 'mysql2/promise'
import { accountsQuery } from './accounts-db'
import type { DriverAdvanceDetail, DriverAdvanceSummary } from './driver-advance'

// ── Reference keys ────────────────────────────────────────────────────────────

/**
 * Letters and digits only, upper-cased.
 *
 * Must stay character-for-character identical to the accounts system's
 * `PnlReferenceResolver::keyFor()`, which is what stamped `is_key` and
 * `control_key` onto the rows this module matches against. The placeholders are
 * the ones its extractors write when they cannot read a number.
 */
export function advanceKey(reference: string | null | undefined): string {
  const key = String(reference ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
  return ['', 'NA', 'NULL', 'NONE'].includes(key) ? '' : key
}

/**
 * The amendment base of a reference: `IS48447_R2/R2` and `VN40130R2` both
 * reduce to their base booking.
 *
 * Mirrors `GeneratedInvoice::parseInvoiceNumber()`. It matters in the other
 * direction from what you might expect — OPS usually holds the clean
 * `IS48447` while the accounts system holds the amended form — but the snapshot
 * writer already stores the *base* in `is_key`, so applying the same reduction
 * here keeps the two sides equal even when OPS is the one carrying a suffix.
 */
export function advanceBaseKey(reference: string | null | undefined): string {
  const raw = String(reference ?? '').trim()
  if (!raw) return ''

  const underscored = raw.match(/^(.+?)_R(\d{1,3})(?:[/_]R\d{1,3})?$/i)
  if (underscored) return advanceKey(underscored[1])

  const legacy = raw.match(/^(.+\d)R(\d{1,3})$/i)
  if (legacy) return advanceKey(legacy[1])

  return advanceKey(raw)
}

/** Every key one booking reference should be searched under. */
function keysFor(reference: string | null | undefined): string[] {
  return Array.from(new Set([advanceKey(reference), advanceBaseKey(reference)].filter(Boolean)))
}

// ── Row shape ─────────────────────────────────────────────────────────────────

/** The columns the board column needs — deliberately not `payload`. */
const SUMMARY_COLUMNS = `
  pnl_record_id, is_key, control_key, is_number, control_number,
  client_name, agent_name, travel_start_date, travel_end_date,
  amount_lkr, computed_lkr, obligation_lkr, paid_lkr,
  advance_outstanding_lkr, rest_outstanding_lkr,
  currency, amount, obligation, rate, lkr_available,
  stage, progress, line_count, edited, payable, pnl_approval, is_cancelled,
  source, computed_at
`

interface SnapshotRow extends mysql.RowDataPacket {
  pnl_record_id: number
  is_key: string | null
  control_key: string | null
  is_number: string | null
  control_number: string | null
  client_name: string | null
  agent_name: string | null
  // The shared accounts connection runs with dateStrings off, so anything
  // date-shaped arrives as a Date (parsed as UTC) rather than a string.
  travel_start_date: string | Date | null
  travel_end_date: string | Date | null
  amount_lkr: string | null
  computed_lkr: string | null
  obligation_lkr: string | null
  paid_lkr: string | null
  advance_outstanding_lkr: string | null
  rest_outstanding_lkr: string | null
  currency: string | null
  amount: string | null
  obligation: string | null
  rate: string | null
  lkr_available: number
  stage: string | null
  progress: string | null
  line_count: number
  edited: number
  payable: number
  pnl_approval: string | null
  is_cancelled: number
  source: string | null
  computed_at: string | Date | null
  payload?: string | null
}

/** MySQL hands DECIMAL back as a string; a money figure must not become NaN. */
function num(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/**
 * A timestamp as an ISO string, whichever shape the driver produced.
 *
 * The connection is configured with `timezone: 'Z'`, so a Date built from it is
 * already the correct instant and `toISOString()` is a lossless rendering of
 * it. A plain `YYYY-MM-DD` (a DATE column, when the driver does hand back a
 * string) is passed through untouched — it is a calendar day, not a moment,
 * and stamping a timezone on it would shift it.
 */
function dateStr(v: string | Date | null | undefined): string | null {
  if (!v) return null
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString()
  return String(v)
}

function toSummary(reference: string, r: SnapshotRow): DriverAdvanceSummary {
  // A row with no stage is a booking the accounts system knows but has not
  // costed yet — it has no payable lines to build an envelope from.
  if (!r.stage) {
    return {
      reference,
      found: true,
      state: 'no_lines',
      message: 'The accounts system has this booking but has not costed it yet.',
      record_id: r.pnl_record_id,
      is_number: r.is_number,
      control_number: r.control_number,
      pnl_approval: (r.pnl_approval as DriverAdvanceSummary['pnl_approval']) ?? 'pending',
      is_cancelled: Boolean(r.is_cancelled),
      computed_at: dateStr(r.computed_at),
    }
  }

  return {
    reference,
    found: true,
    state: 'ok',
    message: null,
    record_id: r.pnl_record_id,
    is_number: r.is_number,
    control_number: r.control_number,

    amount_lkr:      num(r.amount_lkr),
    computed_lkr:    num(r.computed_lkr),
    obligation_lkr:  num(r.obligation_lkr),
    paid_lkr:        num(r.paid_lkr),
    outstanding_lkr: num(r.advance_outstanding_lkr),
    rate:            num(r.rate),
    rate_available:  Boolean(r.lkr_available),

    currency:   r.currency ?? 'USD',
    amount:     num(r.amount),
    obligation: num(r.obligation),

    stage:      r.stage as DriverAdvanceSummary['stage'],
    progress:   num(r.progress) ?? 0,
    line_count: r.line_count,
    edited:     Boolean(r.edited),
    payable:    Boolean(r.payable),
    pnl_approval: (r.pnl_approval as DriverAdvanceSummary['pnl_approval']) ?? 'pending',
    is_cancelled: Boolean(r.is_cancelled),
    travel_start_date: dateStr(r.travel_start_date),
    travel_end_date:   dateStr(r.travel_end_date),
    computed_at: dateStr(r.computed_at),
  }
}

// ── Queries ───────────────────────────────────────────────────────────────────

/** What a booking is asked about under — IS number first, control number as backup. */
export interface AdvanceLookup { reference: string; controlNumber?: string | null }

/**
 * One row per requested booking, in one query.
 *
 * References the accounts system has never heard of come back as `no_pnl`
 * rather than being dropped: a board cell that says "no P&L in accounts" is
 * information, whereas a missing key renders as a spinner that never stops.
 */
export async function fetchDriverAdvances(lookups: AdvanceLookup[]): Promise<DriverAdvanceSummary[]> {
  if (lookups.length === 0) return []

  // Every key any caller might match on, in one IN list. Matching is done in JS
  // afterwards because a row can answer to two keys and a reference can be
  // satisfied by either of them — which is a join SQL would only make harder to
  // read, over a set this small.
  const allKeys = Array.from(new Set(
    lookups.flatMap(l => [...keysFor(l.reference), ...keysFor(l.controlNumber)]),
  ))

  if (allKeys.length === 0) {
    return lookups.map(l => ({
      reference: l.reference, found: false, state: 'no_pnl' as const,
      message: 'This booking has no reference to look up.',
    }))
  }

  const placeholders = allKeys.map(() => '?').join(',')
  const rows = await accountsQuery<SnapshotRow>(
    `SELECT ${SUMMARY_COLUMNS}
       FROM sl_driver_advance_snapshots
      WHERE is_key IN (${placeholders}) OR control_key IN (${placeholders})`,
    [...allKeys, ...allKeys],
  )

  const byKey = new Map<string, SnapshotRow>()
  for (const r of rows) {
    if (r.is_key) byKey.set(r.is_key, r)
    // The IS number is the stronger identifier, so a control-number key never
    // displaces one already claimed by an IS key.
    if (r.control_key && !byKey.has(r.control_key)) byKey.set(r.control_key, r)
  }

  return lookups.map(l => {
    for (const key of [...keysFor(l.reference), ...keysFor(l.controlNumber)]) {
      const row = byKey.get(key)
      if (row) return toSummary(l.reference, row)
    }

    return {
      reference: l.reference,
      found: false,
      state: 'no_pnl' as const,
      message: 'No P&L record for this booking in the accounts system yet.',
    }
  })
}

/** The whole envelope for one booking — sections, lines, override, history. */
export async function fetchDriverAdvanceDetail(
  lookup: AdvanceLookup,
): Promise<{ detail: DriverAdvanceDetail; computedAt: string | null } | { detail: null; reason: string }> {
  const keys = Array.from(new Set([...keysFor(lookup.reference), ...keysFor(lookup.controlNumber)]))
  if (keys.length === 0) return { detail: null, reason: 'This booking has no reference to look up.' }

  const placeholders = keys.map(() => '?').join(',')
  const rows = await accountsQuery<SnapshotRow>(
    `SELECT ${SUMMARY_COLUMNS}, payload
       FROM sl_driver_advance_snapshots
      WHERE is_key IN (${placeholders}) OR control_key IN (${placeholders})
      LIMIT 2`,
    [...keys, ...keys],
  )

  // Prefer the row matched on the IS key when two answer — see above.
  const row = rows.find(r => r.is_key && keys.includes(r.is_key)) ?? rows[0]

  if (!row) {
    return { detail: null, reason: 'No P&L record for this booking in the accounts system yet.' }
  }
  if (!row.payload) {
    return {
      detail: null,
      reason: 'The accounts system has this booking but has not costed it yet, so it has no driver advance.',
    }
  }

  let parsed: DriverAdvanceDetail
  try {
    parsed = JSON.parse(row.payload) as DriverAdvanceDetail
  } catch {
    return { detail: null, reason: 'The stored calculation for this booking could not be read.' }
  }

  return {
    detail: { ...parsed, reference: lookup.reference },
    computedAt: dateStr(row.computed_at),
  }
}
