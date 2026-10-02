/**
 * The operations board, as the daily mail prints it.
 *
 * The desk asked for the morning mail to carry the same picture they read on
 * `/dashboard/accounts/reports` — on ground, arrivals, departures and the five
 * check cards — twice: once for **today** and once for the **next 7 days**
 * (today through D+6), each broken down by sales channel, with Hotel Only and
 * Cancelled files counted on their own lines instead of folded in.
 *
 * ## One fetch, two views
 *
 * `collectOpsDay()` is the board's own loader, so every rule — what counts as
 * on ground, how a check is graded, what a cancelled or Hotel Only file is — is
 * the board's rule, not a copy of it. It is asked once, for the seven-day
 * window; today is cut from those rows. Because both views start on the same
 * day, a row's day-of-tour is identical in both and only the arrival / departure
 * flags need re-deriving for the single day.
 *
 * ## Counting rules (the board's)
 *
 *  - **Live** files are every file not cancelled. On ground, arrivals,
 *    departures, the checks and "fully ready" are all counted over live files.
 *  - **Hotel Only** files are live — the guest is in the country — and are a
 *    subset of the live count. Their checks read N/A and leave the denominators.
 *  - **Cancelled** files are listed and counted apart, never inside any other
 *    figure. "Cancellation pending" files are still live until accounts decides.
 *  - **Test** files are included, as on the board's default view, and counted so
 *    a reader can see how many there were.
 *  - A check card's numerator is DONE + PARTIAL ("work in hand"), its
 *    denominator excludes N/A — exactly the ring on the board.
 *
 * Read-only. Never allowed to sink the report: a failure returns
 * `available: false` and the mail prints a one-line note in place of the section.
 */
import type { ReadinessState } from '@/lib/booking-readiness'
import { bookingSourceOf, type BookingSource } from '@/lib/booking-source'
import { inSelectedCountries } from './booking-lines'
import { collectOpsDay, type OpsDayRow } from './ops-day-data'
import { callState, reconfirmState } from './ops-board-states'
import { formatReportDate, shiftDate, type ReportWindow } from './report-window'

// ─── Types ────────────────────────────────────────────────────────────────────

export type BoardCheckKey = 'reconfirm' | 'calls' | 'driver' | 'tickets' | 'qc'

export interface BoardCheck {
  key: BoardCheckKey
  label: string
  hint: string
  done: number
  partial: number
  pending: number
  na: number
  /** done + partial + pending — N/A rows are out of scope. */
  scope: number
  /** done + partial — the board ring's numerator. */
  covered: number
  /** The same pair, per channel. */
  b2b: { covered: number; scope: number; pending: number }
  b2c: { covered: number; scope: number; pending: number }
}

/** One line of the channel / Hotel Only / Cancelled breakdown. */
export interface BoardSegment {
  key: 'B2B' | 'B2C' | 'LIVE' | 'HOTEL_ONLY' | 'CANCEL_PENDING' | 'CANCELLED' | 'TEST'
  label: string
  /** True for the lines that are a subset of LIVE, or outside it entirely. */
  aside: boolean
  files: number
  pax: number
  arrivals: number
  departures: number
  b2b: number
  b2c: number
}

export interface BoardCountry {
  country: string
  label: string
  files: number
  pax: number
  b2b: number
  b2c: number
  hotelOnly: number
  cancelled: number
}

export interface BoardDay {
  date: string
  onGround: number
  pax: number
  arrivals: number
  arrivalPax: number
  departures: number
  departurePax: number
  b2b: number
  b2c: number
  hotelOnly: number
  cancelled: number
  ready: number
  /** Live, non-Hotel-Only files with no driver on any transfer yet. */
  driverPending: number
  /** Live files arriving this day whose reconfirmation has not started. */
  reconfirmPending: number
}

/** A board row with the derived fields the mail and workbook print. */
export interface BoardRow extends OpsDayRow {
  source: BookingSource
  reconfirmState: ReadinessState
  callState: ReadinessState
  /** On the ground on the first day of the window (today). */
  onToday: boolean
  arrivesToday: boolean
  departsToday: boolean
}

export interface BoardView {
  from: string
  to: string
  days: number
  label: string
  onGround: { files: number; pax: number; b2b: number; b2c: number }
  arrivals: { files: number; pax: number; b2b: number; b2c: number }
  departures: { files: number; pax: number; b2b: number; b2c: number }
  live: number
  ready: number
  hotelOnly: number
  cancelled: number
  cancelPending: number
  testFiles: number
  d10: { breached: number; unexplained: number }
  segments: BoardSegment[]
  checks: BoardCheck[]
  byCountry: BoardCountry[]
  /** Every row in the view, cancelled included, arrival order. */
  rows: BoardRow[]
}

export interface OpsBoardDigest {
  available: boolean
  error?: string
  today: BoardView | null
  week: (BoardView & { perDay: BoardDay[] }) | null
  /** False when the TE call tables could not be read — the call cards are partial. */
  callDataAvailable: boolean
  truncated: boolean
}

// ─── Vocabulary ───────────────────────────────────────────────────────────────

/** The board's own labels and hints, so the mail reads like the screen. */
export const BOARD_CHECKS: { key: BoardCheckKey; label: string; hint: string; pick: (r: BoardRow) => ReadinessState }[] = [
  { key: 'reconfirm', label: 'Reconfirmation', hint: 'Client confirm or pre-tour call', pick: r => r.reconfirmState },
  { key: 'calls', label: 'Call Requests', hint: 'WhatsApp permission to call the guest', pick: r => r.callState },
  { key: 'driver', label: 'Driver / Vendor', hint: 'Every transfer has a driver or vendor', pick: r => r.driver.state },
  { key: 'tickets', label: 'Tickets Issued', hint: 'Every active ticket purchased or paid', pick: r => r.tickets.state },
  { key: 'qc', label: 'QC1 / QC2', hint: 'Both quality rounds signed off', pick: r => r.qc.state },
]

export const WEEK_DAYS = 7

// ─── Derivation ───────────────────────────────────────────────────────────────

function sumPax(rows: BoardRow[]): number {
  return rows.reduce((s, r) => s + r.pax, 0)
}

function bySource(rows: BoardRow[]) {
  return {
    files: rows.length,
    pax: sumPax(rows),
    b2b: rows.filter(r => r.source === 'B2B').length,
    b2c: rows.filter(r => r.source === 'B2C').length,
  }
}

function tallyCheck(live: BoardRow[], def: (typeof BOARD_CHECKS)[number]): BoardCheck {
  const counts: Record<ReadinessState, number> = { DONE: 0, PARTIAL: 0, PENDING: 0, NA: 0 }
  const ch = {
    B2B: { covered: 0, scope: 0, pending: 0 },
    B2C: { covered: 0, scope: 0, pending: 0 },
  }
  for (const r of live) {
    const s = def.pick(r)
    counts[s] += 1
    if (s === 'NA') continue
    ch[r.source].scope += 1
    if (s === 'PENDING') ch[r.source].pending += 1
    else ch[r.source].covered += 1
  }
  return {
    key: def.key, label: def.label, hint: def.hint,
    done: counts.DONE, partial: counts.PARTIAL, pending: counts.PENDING, na: counts.NA,
    scope: counts.DONE + counts.PARTIAL + counts.PENDING,
    covered: counts.DONE + counts.PARTIAL,
    b2b: ch.B2B, b2c: ch.B2C,
  }
}

function segment(
  key: BoardSegment['key'], label: string, aside: boolean, rows: BoardRow[],
  isArr: (r: BoardRow) => boolean, isDep: (r: BoardRow) => boolean,
): BoardSegment {
  return {
    key, label, aside,
    files: rows.length,
    pax: sumPax(rows),
    arrivals: rows.filter(isArr).length,
    departures: rows.filter(isDep).length,
    b2b: rows.filter(r => r.source === 'B2B').length,
    b2c: rows.filter(r => r.source === 'B2C').length,
  }
}

function buildView(
  rows: BoardRow[], from: string, to: string,
  isArr: (r: BoardRow) => boolean, isDep: (r: BoardRow) => boolean,
): BoardView {
  const live = rows.filter(r => !r.cancelled)
  const cancelled = rows.filter(r => r.cancelled)
  const days = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1

  const countries = new Map<string, BoardCountry>()
  for (const r of rows) {
    const c = countries.get(r.country)
      ?? { country: r.country, label: r.countryLabel, files: 0, pax: 0, b2b: 0, b2c: 0, hotelOnly: 0, cancelled: 0 }
    if (r.cancelled) {
      c.cancelled += 1
    } else {
      c.files += 1
      c.pax += r.pax
      if (r.source === 'B2B') c.b2b += 1
      else c.b2c += 1
      if (r.hotelOnly) c.hotelOnly += 1
    }
    countries.set(r.country, c)
  }

  return {
    from, to, days,
    label: days === 1
      ? formatReportDate(from, { weekday: true })
      : `${formatReportDate(from, { weekday: true })} → ${formatReportDate(to, { weekday: true })}`,
    onGround: bySource(live),
    arrivals: bySource(live.filter(isArr)),
    departures: bySource(live.filter(isDep)),
    live: live.length,
    ready: live.filter(r => r.ready).length,
    hotelOnly: live.filter(r => r.hotelOnly).length,
    cancelled: cancelled.length,
    cancelPending: live.filter(r => r.cancelPending).length,
    testFiles: rows.filter(r => r.testFile).length,
    d10: {
      breached: live.filter(r => r.reconfirmBreached).length,
      unexplained: live.filter(r => r.reconfirmBreached && !r.reconfirmDelay).length,
    },
    segments: [
      segment('B2B', 'B2B — agent files', false, live.filter(r => r.source === 'B2B'), isArr, isDep),
      segment('B2C', 'B2C — Aahaas storefront', false, live.filter(r => r.source === 'B2C'), isArr, isDep),
      segment('LIVE', 'Live total (counted)', false, live, isArr, isDep),
      segment('HOTEL_ONLY', 'of which Hotel Only', true, live.filter(r => r.hotelOnly), isArr, isDep),
      segment('CANCEL_PENDING', 'of which cancellation pending', true, live.filter(r => r.cancelPending), isArr, isDep),
      segment('CANCELLED', 'Cancelled — not counted', true, cancelled, isArr, isDep),
    ],
    checks: BOARD_CHECKS.map(def => tallyCheck(live, def)),
    byCountry: Array.from(countries.values())
      .sort((a, b) => b.files - a.files || a.label.localeCompare(b.label)),
    rows,
  }
}

function perDay(rows: BoardRow[], from: string, days: number): BoardDay[] {
  const out: BoardDay[] = []
  for (let i = 0; i < days; i++) {
    const date = shiftDate(from, i)
    const on = rows.filter(r => r.arrivalDate <= date && r.departureDate >= date)
    const live = on.filter(r => !r.cancelled)
    const arr = live.filter(r => r.arrivalDate === date)
    const dep = live.filter(r => r.departureDate === date)
    out.push({
      date,
      onGround: live.length,
      pax: sumPax(live),
      arrivals: arr.length,
      arrivalPax: sumPax(arr),
      departures: dep.length,
      departurePax: sumPax(dep),
      b2b: live.filter(r => r.source === 'B2B').length,
      b2c: live.filter(r => r.source === 'B2C').length,
      hotelOnly: live.filter(r => r.hotelOnly).length,
      cancelled: on.length - live.length,
      ready: live.filter(r => r.ready).length,
      driverPending: live.filter(r => r.driver.state === 'PENDING').length,
      reconfirmPending: arr.filter(r => r.reconfirmState === 'PENDING').length,
    })
  }
  return out
}

// ─── Entry point ──────────────────────────────────────────────────────────────

/**
 * The pure half: board rows for `from` … `from + 6` in, both views out. Split
 * from the fetch so the render check can drive it with fixture rows.
 */
export function digestBoardRows(
  boardRows: OpsDayRow[],
  from: string,
  countries: string[],
  meta: { callDataAvailable: boolean; truncated: boolean },
): OpsBoardDigest {
  const to = shiftDate(from, WEEK_DAYS - 1)
  const rows: BoardRow[] = boardRows
    .filter(r => inSelectedCountries(r.country, countries))
    .map(r => ({
      ...r,
      source: bookingSourceOf(r.agent),
      reconfirmState: reconfirmState(r),
      callState: callState(r),
      onToday: r.arrivalDate <= from && r.departureDate >= from,
      arrivesToday: r.arrivalDate === from,
      departsToday: r.departureDate === from,
    }))

  const today = buildView(rows.filter(r => r.onToday), from, from, r => r.arrivesToday, r => r.departsToday)
  const week = buildView(rows, from, to, r => r.isArrival, r => r.isDeparture)

  return {
    available: true,
    today,
    week: { ...week, perDay: perDay(rows, from, WEEK_DAYS) },
    callDataAvailable: meta.callDataAvailable,
    truncated: meta.truncated,
  }
}

export async function collectOpsBoardDigest(
  window: ReportWindow,
  countries: string[],
): Promise<OpsBoardDigest> {
  const from = window.today
  const to = shiftDate(from, WEEK_DAYS - 1)

  try {
    const board = await collectOpsDay({ from, to, timezone: window.timezone })
    return digestBoardRows(board.rows, from, countries, {
      callDataAvailable: board.callDataAvailable && board.approvalDataAvailable,
      truncated: board.truncated,
    })
  } catch (error) {
    console.warn('[Reports] ops board digest failed:', error instanceof Error ? error.message : error)
    return {
      available: false,
      error: error instanceof Error ? error.message : String(error),
      today: null,
      week: null,
      callDataAvailable: false,
      truncated: false,
    }
  }
}
