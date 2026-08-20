/**
 * The Drive Log — one line per Sri Lankan booking showing what the transport
 * cost, what the driver has actually been handed, and what is still owed.
 *
 * ---- What this file is, and is not ----
 *
 * It is the *vocabulary*: the row shape, the settlement arithmetic, the filter
 * parsing and the formatting. It is pure — no Prisma, no MySQL, no React — so
 * the screen, the API, the spreadsheet and the PDF all classify and total a
 * booking with the same code and can never disagree about what "balance
 * payable" means. `sl-drive-log-server.ts` does the fetching; this decides what
 * the fetched numbers mean.
 *
 * It is *not* a second implementation of the driver advance. Every rupee here
 * was derived by the accounts system (SlDriverAdvanceService, via the snapshot
 * table) and is re-arranged, never recomputed: the split below is addition and
 * subtraction over figures that arrived already decided. See
 * `accounts-driver-advance-db.ts` for why that boundary is drawn where it is.
 *
 * ---- The five money columns, and where each comes from ----
 *
 *   Total transport cost   the whole obligation to the driver by the end of the
 *                          tour — `obligation`. Balance payable + driver advance
 *                          by construction, which is how the desk describes it.
 *   Driver advance         the envelope handed over at the start — `effective`,
 *                          the override included when a human fixed it.
 *   Balance payable        the rest payment: total − advance.
 *   Actual paid balance    of that rest payment, what the accounts team has
 *                          actually released — `rest_paid`.
 *   Transport P/L          total − (advance paid + rest paid). Positive means
 *                          money still to leave the building; negative means the
 *                          driver has been paid more than the booking costed.
 *
 * The advance *amount* and the advance *paid* are different numbers and the log
 * keeps them apart on purpose — an unapproved P&L shows a full envelope and
 * nothing paid, which is exactly the row the desk is looking for.
 *
 * ---- Currency ----
 *
 * Rupees, because rupees are what a driver is handed. A booking whose lines
 * carry no usable LKR rate has no rupee figure at all rather than a converted
 * guess: `lkrAvailable` is false, the native pair is carried alongside, and
 * every total on the screen says how many rows it had to leave out.
 */

import type {
  DriverAdvanceCategory, DriverAdvanceDetail, DriverAdvanceStage, DriverAdvanceSummary,
} from './driver-advance'
import type { InvoicePaymentState, InvoicePaymentSummary } from './accounts-invoice-db'

// ── Constants ─────────────────────────────────────────────────────────────────

/**
 * The default window: arrivals two days out.
 *
 * The desk works ahead of the driver, not alongside him. An advance has to be
 * counted, approved and handed over before the guest lands, so the day the log
 * opens on is the day whose envelopes have to be settled *now* — D+2, not
 * today, which is already too late to act on.
 */
export const DEFAULT_ARRIVAL_OFFSET_DAYS = 2

/** The operations timezone. "Today" is a Sri Lankan day, not a server one. */
export const OPS_TIMEZONE = 'Asia/Colombo'

/** Hard ceiling on rows in one request — matches the payload parse budget. */
export const MAX_ROWS = 400

const DAY_MS = 86_400_000

// ── Query ─────────────────────────────────────────────────────────────────────

export type DriveLogDateField = 'arrivalDate' | 'departureDate'
export type DriveLogStage     = 'all' | 'advance_due' | 'rest_due' | 'settled' | 'uncosted'
export type DriveLogApproval  = 'all' | 'approved' | 'pending'
export type DriveLogDriver    = 'all' | 'assigned' | 'unassigned'
export type DriveLogSortField =
  | 'arrival' | 'isNumber' | 'driver' | 'invoice' | 'cost' | 'advance' | 'balance' | 'profit'
export type DriveLogSortDir   = 'asc' | 'desc'
export type DriveLogView      = 'day' | 'driver'

export interface DriveLogQuery {
  dateField: DriveLogDateField
  /** Inclusive `yyyy-mm-dd` bounds. Always resolved — never null by the time it leaves parse. */
  from: string
  to: string
  search: string
  stage: DriveLogStage
  approval: DriveLogApproval
  driver: DriveLogDriver
  /** Only rows with something still owed, or overpaid — the ones that need a decision. */
  openOnly: boolean
  /** Hotel-only files carry no driver and no transport; off by default. */
  includeHotelOnly: boolean
  sortBy: DriveLogSortField
  sortDir: DriveLogSortDir
}

const DATE_FIELDS: DriveLogDateField[] = ['arrivalDate', 'departureDate']
const STAGES:      DriveLogStage[]     = ['all', 'advance_due', 'rest_due', 'settled', 'uncosted']
const APPROVALS:   DriveLogApproval[]  = ['all', 'approved', 'pending']
const DRIVERS:     DriveLogDriver[]    = ['all', 'assigned', 'unassigned']
const SORT_FIELDS: DriveLogSortField[] = [
  'arrival', 'isNumber', 'driver', 'invoice', 'cost', 'advance', 'balance', 'profit',
]

/** `yyyy-mm-dd` for a calendar day in `tz`, whatever zone the server runs in. */
export function dayKey(at: Date = new Date(), tz: string = OPS_TIMEZONE): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(at)
}

/** `yyyy-mm-dd`, `days` whole days after `from`. */
export function shiftDay(from: string, days: number): string {
  const at = Date.parse(`${from}T00:00:00Z`)
  if (Number.isNaN(at)) return from
  return new Date(at + days * DAY_MS).toISOString().slice(0, 10)
}

/** Whole days between two day keys, positive when `to` is later. */
export function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`)
  const b = Date.parse(`${to}T00:00:00Z`)
  if (Number.isNaN(a) || Number.isNaN(b)) return 0
  return Math.round((b - a) / DAY_MS)
}

const isDayKey = (v: string | null): v is string => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v)

/**
 * Reads the filters off a query string, clamping anything hostile.
 *
 * An absent window is not "everything": it is the default D+2 day. A window
 * wider than a quarter is trimmed to one — every row costs a JSON parse of the
 * accounts payload, and an unbounded date range is the one way to make this
 * screen expensive.
 */
export function parseDriveLogQuery(sp: URLSearchParams, now = new Date()): DriveLogQuery {
  const today   = dayKey(now)
  const fallback = shiftDay(today, DEFAULT_ARRIVAL_OFFSET_DAYS)

  const rawFrom = sp.get('from')
  const rawTo   = sp.get('to')

  let from = isDayKey(rawFrom) ? rawFrom : fallback
  let to   = isDayKey(rawTo)   ? rawTo   : (isDayKey(rawFrom) ? rawFrom : fallback)

  if (daysBetween(from, to) < 0) [from, to] = [to, from]
  if (daysBetween(from, to) > 92) to = shiftDay(from, 92)

  const pick = <T extends string>(v: string | null, allowed: T[], fallbackValue: T): T =>
    allowed.includes((v ?? '') as T) ? (v as T) : fallbackValue

  return {
    dateField: pick(sp.get('dateField'), DATE_FIELDS, 'arrivalDate'),
    from,
    to,
    search:    (sp.get('search') ?? '').trim().slice(0, 120),
    stage:     pick(sp.get('stage'),    STAGES,      'all'),
    approval:  pick(sp.get('approval'), APPROVALS,   'all'),
    driver:    pick(sp.get('driver'),   DRIVERS,     'all'),
    openOnly:  sp.get('openOnly') === '1',
    includeHotelOnly: sp.get('hotelOnly') === '1',
    sortBy:    pick(sp.get('sortBy'), SORT_FIELDS, 'arrival'),
    sortDir:   sp.get('sortDir') === 'desc' ? 'desc' : 'asc',
  }
}

/** The filters back as a query string — the screen, both downloads and the URL share one. */
export function driveLogSearchParams(q: DriveLogQuery): URLSearchParams {
  const sp = new URLSearchParams({
    dateField: q.dateField, from: q.from, to: q.to,
    stage: q.stage, approval: q.approval, driver: q.driver,
    sortBy: q.sortBy, sortDir: q.sortDir,
  })
  if (q.search) sp.set('search', q.search)
  if (q.openOnly) sp.set('openOnly', '1')
  if (q.includeHotelOnly) sp.set('hotelOnly', '1')
  return sp
}

/** "21 Aug 2026" or "21 – 28 Aug 2026" — the window, for a heading. */
export function windowLabel(q: DriveLogQuery): string {
  const field = q.dateField === 'arrivalDate' ? 'Arrival' : 'Departure'
  return q.from === q.to
    ? `${field} ${formatDay(q.from)}`
    : `${field} ${formatDay(q.from)} → ${formatDay(q.to)}`
}

// ── Settlement ────────────────────────────────────────────────────────────────

/** Why a row has no money on it, or that it does. */
export type SettlementState =
  | 'ok'          // costed, figures present
  | 'no_pnl'      // the accounts system has never seen this booking
  | 'no_lines'    // it has the booking but has not costed it
  | 'cancelled'   // the booking is off; the envelope no longer applies
  | 'unavailable' // the accounts database could not be read

/**
 * The money on one booking, in the shape the columns are printed in.
 *
 * Every field is nullable and every consumer must handle that: "not costed yet"
 * is a normal, frequent answer for a booking two days out, and a zero would
 * read as "nothing owed" when the truth is "nobody has priced it".
 */
export interface DriveLogSettlement {
  state: SettlementState
  message: string | null

  /** The currency the figures below are in — LKR when a rate resolved. */
  currency: string
  /** False when no LKR rate could be resolved, so the figures are the costed currency. */
  lkrAvailable: boolean
  /** USD → LKR, when known. Used to state the invoice in rupees for comparison. */
  rate: number | null

  /** Balance payable + driver advance. */
  totalCost: number | null
  /** The envelope in force, human override included. */
  advance: number | null
  /** What the rule alone says, before any override. */
  computedAdvance: number | null
  /** The rest payment: total − advance. */
  balancePayable: number | null
  /** Of the envelope, what has been handed over. */
  advancePaid: number | null
  /** Of the rest payment, what the accounts team has released. */
  restPaid: number | null
  /** advancePaid + restPaid. */
  paid: number | null
  /** totalCost − paid. Positive: still owed. Negative: overpaid. */
  profitLoss: number | null
  /** 0–100, how much of the obligation has been released. */
  progress: number

  stage: DriverAdvanceStage | null
  /** A human fixed the advance in place of the computed figure. */
  edited: boolean
  /** The P&L is approved, so Payable 1.0 will actually release the money. */
  payable: boolean
  approval: 'pending' | 'approved' | 'rejected'
  lineCount: number
  /** Transport lines alone, out of the whole envelope. */
  transportCost: number | null
  sections: { code: DriverAdvanceCategory; label: string; amount: number }[]
  /** How many releases have been recorded against this booking. */
  paymentCount: number
  /** When the accounts system last rebuilt these figures. Shown, never hidden. */
  computedAt: string | null
  /** The accounts record, so a row can be opened on the Payable 1.0 side. */
  recordId: number | null
}

const clamp0 = (n: number) => (Number.isFinite(n) ? Math.max(0, n) : 0)
const isNum  = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/** A settlement carrying nothing but a reason. */
export function emptySettlement(state: SettlementState, message: string | null): DriveLogSettlement {
  return {
    state, message,
    currency: 'LKR', lkrAvailable: false, rate: null,
    totalCost: null, advance: null, computedAdvance: null, balancePayable: null,
    advancePaid: null, restPaid: null, paid: null, profitLoss: null, progress: 0,
    stage: null, edited: false, payable: false, approval: 'pending', lineCount: 0,
    transportCost: null, sections: [], paymentCount: 0, computedAt: null, recordId: null,
  }
}

/**
 * The five money columns, from what the accounts system wrote down.
 *
 * `detail` is the stored calculation and is preferred wherever it exists: only
 * it records the advance/rest *split* of what has been paid, which is the whole
 * point of the log. Without it the split is reconstructed from the summary
 * columns — the outstanding figures are the same subtraction run the other way
 * — so a row whose payload failed to parse degrades to slightly coarser numbers
 * rather than to blanks.
 */
export function deriveSettlement(
  summary: DriverAdvanceSummary | null,
  detail: DriverAdvanceDetail | null,
): DriveLogSettlement {
  if (!summary) {
    return emptySettlement('unavailable', 'The accounts database could not be reached.')
  }
  if (summary.state === 'no_pnl') {
    return emptySettlement('no_pnl', summary.message ?? 'No P&L record in the accounts system yet.')
  }
  if (summary.state === 'unavailable' || summary.state === 'error') {
    return emptySettlement('unavailable', summary.message ?? 'The accounts database could not be reached.')
  }

  const base = emptySettlement('ok', null)
  base.approval  = summary.pnl_approval ?? 'pending'
  base.payable   = Boolean(summary.payable)
  base.edited    = Boolean(summary.edited)
  base.lineCount = summary.line_count ?? 0
  base.computedAt = summary.computed_at ?? null
  base.recordId   = summary.record_id ?? null
  base.rate       = summary.rate ?? null

  if (summary.is_cancelled) {
    return {
      ...base,
      state: 'cancelled',
      message: 'This booking is cancelled — no advance is payable.',
    }
  }
  if (summary.state === 'no_lines') {
    return {
      ...base,
      state: 'no_lines',
      message: summary.message ?? 'The accounts system has this booking but has not costed it yet.',
    }
  }

  // Rupees when a rate resolved, the costed currency otherwise. The two are
  // never mixed inside one row — a half-converted total is worse than a stated
  // "no rate".
  const lkrOk = detail ? Boolean(detail.lkr?.available) : Boolean(summary.rate_available)
  const src   = detail
    ? (lkrOk ? detail.lkr : detail)
    : null

  const totalCost = detail
    ? (isNum(src?.obligation) ? src!.obligation : null)
    : (lkrOk ? summary.obligation_lkr ?? null : summary.obligation ?? null)

  const advance = detail
    ? (isNum(src?.effective) ? src!.effective : null)
    : (lkrOk ? summary.amount_lkr ?? null : summary.amount ?? null)

  const computedAdvance = detail
    ? (isNum(src?.computed) ? src!.computed : null)
    : (lkrOk ? summary.computed_lkr ?? null : null)

  // The split. From the payload directly; otherwise the advance minus what is
  // still outstanding on it, and the remainder of everything paid.
  let advancePaid: number | null = null
  let restPaid: number | null = null

  if (detail) {
    const a = (src as { advance_paid?: number | null })?.advance_paid
    const r = (src as { rest_paid?: number | null })?.rest_paid
    advancePaid = isNum(a) ? a : null
    restPaid    = isNum(r) ? r : null
  } else if (lkrOk && isNum(summary.amount_lkr)) {
    const outstanding = summary.outstanding_lkr
    advancePaid = isNum(outstanding) ? clamp0(summary.amount_lkr - outstanding) : null
    restPaid = isNum(summary.paid_lkr) && advancePaid !== null
      ? clamp0(summary.paid_lkr - advancePaid)
      : null
  }

  const paid = advancePaid === null && restPaid === null
    ? (lkrOk ? summary.paid_lkr ?? null : null)
    : (advancePaid ?? 0) + (restPaid ?? 0)

  const balancePayable = isNum(totalCost) && isNum(advance) ? clamp0(totalCost - advance) : null
  const profitLoss     = isNum(totalCost) && isNum(paid) ? totalCost - paid : null

  const transport = detail?.transport ?? null
  const transportCost = transport
    ? (lkrOk && isNum(transport.lkr_total) ? transport.lkr_total : transport.total ?? null)
    : null

  return {
    ...base,
    state: 'ok',
    message: null,
    currency: lkrOk ? 'LKR' : (detail?.currency ?? summary.currency ?? 'USD'),
    lkrAvailable: lkrOk,
    totalCost,
    advance,
    computedAdvance,
    balancePayable,
    advancePaid,
    restPaid,
    paid,
    profitLoss,
    progress: isNum(totalCost) && totalCost > 0 && isNum(paid)
      ? Math.min(100, Math.round((paid / totalCost) * 100))
      : (summary.progress ?? 0),
    stage: summary.stage ?? detail?.stage ?? null,
    transportCost,
    sections: (detail?.sections ?? [])
      .filter(s => s.included)
      .map(s => ({
        code: s.code,
        label: s.label,
        amount: lkrOk && isNum(s.contribution_lkr) ? s.contribution_lkr : s.contribution,
      })),
    paymentCount: detail?.history?.length ?? 0,
  }
}

// ── Rows ──────────────────────────────────────────────────────────────────────

export interface DriveLogVehicle {
  id: string | null
  type: string | null
  plateNo: string | null
  brand: string | null
  model: string | null
  capacity: number | null
}

/** Bank details, as the driver registered them. Only what a transfer needs. */
export interface DriveLogBank {
  name: string | null
  branch: string | null
  code: string | null
  holder: string | null
  accountNo: string | null
}

export interface DriveLogDriverInfo {
  id: string | null
  name: string
  phone: string | null
  photoUrl: string | null
  isActive: boolean
  licenseNo: string | null
  vehicle: DriveLogVehicle | null
  vendorName: string | null
  bank: DriveLogBank | null
  /**
   * Where the name came from — the allocation row, or a movement on the chart.
   *
   * Worth showing: a file driven by a name typed onto one movement has not been
   * allocated in the normal sense, and the desk treats the two differently.
   */
  source: 'allocation' | 'movement' | 'vendor'
}

export interface DriveLogInvoice {
  state: InvoicePaymentState
  message: string | null
  invoiceNumber: string | null
  currency: string
  /** Face value of the current revision. */
  amount: number | null
  paid: number | null
  balance: number | null
  paidPercent: number | null
  revision: number | null
  revisionCount: number | null
  invoiceDate: string | null
  lastPaymentAt: string | null
}

export interface DriveLogRow {
  bookingId: string
  bookingRef: string
  isNumber: string | null
  cntlNumber: string | null
  clientName: string | null
  agent: string | null
  fileHandler: string | null

  /** `yyyy-mm-dd`. Arrival is a calendar day, not an instant. */
  arrivalDate: string
  departureDate: string | null
  nights: number | null
  pax: number

  status: string
  hotelOnly: boolean
  /** Days from today to arrival, negative once the tour has started. */
  daysToArrival: number

  driver: DriveLogDriverInfo | null
  invoice: DriveLogInvoice | null
  settlement: DriveLogSettlement
}

/** One booking's invoice, flattened to what the column prints. */
export function toDriveLogInvoice(s: InvoicePaymentSummary | null | undefined): DriveLogInvoice | null {
  if (!s) return null
  return {
    state: s.state,
    message: s.message ?? null,
    invoiceNumber: s.invoiceNumber ?? null,
    currency: s.currency ?? 'USD',
    amount: s.invoiceValue ?? null,
    paid: s.paidAmount ?? null,
    balance: s.balanceAmount ?? null,
    paidPercent: s.paidPercent ?? null,
    revision: s.revision ?? null,
    revisionCount: s.revisionCount ?? null,
    invoiceDate: s.invoiceDate ?? null,
    lastPaymentAt: s.lastPaymentAt ?? null,
  }
}

// ── Filtering and sorting ─────────────────────────────────────────────────────

/**
 * The filters that cannot be pushed into SQL.
 *
 * Stage and approval live in the accounts snapshot, which is a different
 * database from the bookings — so the window and the text search narrow the
 * rows in Prisma, and the money filters are applied here once both halves are
 * in hand.
 */
export function applyDriveLogFilters(rows: DriveLogRow[], q: DriveLogQuery): DriveLogRow[] {
  return rows.filter(r => {
    const s = r.settlement

    if (!q.includeHotelOnly && r.hotelOnly) return false

    if (q.stage !== 'all') {
      if (q.stage === 'uncosted') {
        if (s.state === 'ok') return false
      } else if (s.state !== 'ok' || s.stage !== q.stage) {
        return false
      }
    }

    if (q.approval === 'approved' && s.approval !== 'approved') return false
    if (q.approval === 'pending'  && s.approval === 'approved') return false

    if (q.driver === 'assigned'   && !r.driver) return false
    if (q.driver === 'unassigned' && r.driver)  return false

    // "Open" is anything the desk still has to act on: money owed, money
    // overpaid, or a booking nobody has costed. A settled row is finished.
    if (q.openOnly) {
      const open = s.state !== 'ok' || (isNum(s.profitLoss) && Math.abs(s.profitLoss) >= 0.01)
      if (!open) return false
    }

    return true
  })
}

/** Sorts in place-safe fashion; nulls always sort last, whichever direction. */
export function sortDriveLogRows(rows: DriveLogRow[], q: DriveLogQuery): DriveLogRow[] {
  const dir = q.sortDir === 'desc' ? -1 : 1

  const value = (r: DriveLogRow): string | number | null => {
    switch (q.sortBy) {
      case 'isNumber': return r.isNumber ?? r.bookingRef
      case 'driver':   return r.driver?.name.toLowerCase() ?? null
      case 'invoice':  return r.invoice?.amount ?? null
      case 'cost':     return r.settlement.totalCost
      case 'advance':  return r.settlement.advance
      case 'balance':  return r.settlement.balancePayable
      case 'profit':   return r.settlement.profitLoss
      default:         return r.arrivalDate
    }
  }

  return [...rows].sort((a, b) => {
    const av = value(a)
    const bv = value(b)
    if (av === null && bv === null) return a.bookingRef.localeCompare(b.bookingRef)
    if (av === null) return 1
    if (bv === null) return -1
    if (typeof av === 'number' && typeof bv === 'number') {
      return av === bv ? a.bookingRef.localeCompare(b.bookingRef) : (av - bv) * dir
    }
    const cmp = String(av).localeCompare(String(bv))
    return cmp === 0 ? a.bookingRef.localeCompare(b.bookingRef) : cmp * dir
  })
}

// ── Totals ────────────────────────────────────────────────────────────────────

export interface DriveLogTotals {
  rows: number
  /** Rows carrying rupee figures — the ones the money totals are built from. */
  costedRows: number
  /** Rows the accounts system has not costed, or could not be read. */
  uncostedRows: number
  /** Rows whose figures are in a currency other than LKR, so left out of the totals. */
  noRateRows: number

  invoiceUsd: number
  /** Rows whose invoice is in some currency other than USD, so left out above. */
  invoiceOtherCcy: number

  totalCost: number
  advance: number
  balancePayable: number
  advancePaid: number
  restPaid: number
  paid: number
  profitLoss: number

  settled: number
  advanceDue: number
  restDue: number
  unapproved: number
  unassigned: number
  /** Rows where more has been paid than the booking costed. */
  overpaid: number
}

/** The strip along the top of the screen, and the banner on both downloads. */
export function driveLogTotals(rows: DriveLogRow[]): DriveLogTotals {
  const t: DriveLogTotals = {
    rows: rows.length, costedRows: 0, uncostedRows: 0, noRateRows: 0,
    invoiceUsd: 0, invoiceOtherCcy: 0,
    totalCost: 0, advance: 0, balancePayable: 0, advancePaid: 0, restPaid: 0, paid: 0, profitLoss: 0,
    settled: 0, advanceDue: 0, restDue: 0, unapproved: 0, unassigned: 0, overpaid: 0,
  }

  for (const r of rows) {
    const s = r.settlement

    if (!r.driver) t.unassigned++
    if (s.state === 'ok' && s.approval !== 'approved') t.unapproved++

    if (r.invoice?.amount != null) {
      if ((r.invoice.currency ?? 'USD') === 'USD') t.invoiceUsd += r.invoice.amount
      else t.invoiceOtherCcy++
    }

    if (s.state !== 'ok') { t.uncostedRows++; continue }
    if (!s.lkrAvailable)  { t.noRateRows++;   continue }

    t.costedRows++
    t.totalCost      += s.totalCost      ?? 0
    t.advance        += s.advance        ?? 0
    t.balancePayable += s.balancePayable ?? 0
    t.advancePaid    += s.advancePaid    ?? 0
    t.restPaid       += s.restPaid       ?? 0
    t.paid           += s.paid           ?? 0
    t.profitLoss     += s.profitLoss     ?? 0

    if (s.stage === 'settled')     t.settled++
    if (s.stage === 'advance_due') t.advanceDue++
    if (s.stage === 'rest_due')    t.restDue++
    if (isNum(s.profitLoss) && s.profitLoss < -0.01) t.overpaid++
  }

  return t
}

// ── Grouping ──────────────────────────────────────────────────────────────────

export interface DriveLogGroup {
  key: string
  label: string
  sublabel: string | null
  rows: DriveLogRow[]
  totals: DriveLogTotals
}

/**
 * The rows under a heading — by arrival day, or by driver.
 *
 * By driver is not cosmetic: it is the view the accounts desk pays from, since
 * one transfer settles every booking a driver is carrying that week, and the
 * subtotal under his name is the figure that goes on the slip.
 */
export function groupDriveLogRows(rows: DriveLogRow[], view: DriveLogView): DriveLogGroup[] {
  const groups = new Map<string, DriveLogRow[]>()

  for (const r of rows) {
    const key = view === 'driver'
      ? (r.driver ? `d:${r.driver.id ?? r.driver.name.toLowerCase()}` : 'd:—')
      : `a:${r.arrivalDate}`
    const list = groups.get(key)
    if (list) list.push(r)
    else groups.set(key, [r])
  }

  return Array.from(groups.entries()).map(([key, list]) => {
    if (view === 'driver') {
      const d = list[0].driver
      return {
        key,
        label: d?.name ?? 'No driver allocated',
        sublabel: d
          ? [d.phone, d.vehicle?.plateNo, d.vehicle?.type].filter(Boolean).join(' · ') || null
          : `${list.length} booking${list.length === 1 ? '' : 's'} with nobody assigned`,
        rows: list,
        totals: driveLogTotals(list),
      }
    }
    return {
      key,
      label: formatDay(key.slice(2)),
      sublabel: `${list.length} booking${list.length === 1 ? '' : 's'}`,
      rows: list,
      totals: driveLogTotals(list),
    }
  })
}

// ── Formatting ────────────────────────────────────────────────────────────────

/** "21 Aug 2026". */
export function formatDay(day: string | null | undefined): string {
  if (!day) return '—'
  const at = Date.parse(`${day.slice(0, 10)}T00:00:00Z`)
  if (Number.isNaN(at)) return String(day)
  return new Date(at).toLocaleDateString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC',
  })
}

/** "24,341.10" — money, always to the cent, because this is cash. */
export function amount(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  return value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/** "LKR 24,341.10". */
export function withCcy(value: number | null | undefined, currency = 'LKR'): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  return `${currency} ${amount(value)}`
}

/** "in 2 days" / "arrives today" / "day 3 of tour". */
export function arrivalLabel(days: number): string {
  if (days === 0) return 'arrives today'
  if (days === 1) return 'arrives tomorrow'
  if (days > 1)   return `in ${days} days`
  if (days === -1) return 'arrived yesterday'
  return `arrived ${Math.abs(days)} days ago`
}

export const STAGE_LABEL: Record<DriverAdvanceStage, string> = {
  advance_due: 'Advance due',
  rest_due:    'Rest due',
  settled:     'Settled',
  empty:       'Nothing to pay',
}

/** The colour a settlement reads in. One mapping, so no two surfaces disagree. */
export const SETTLEMENT_TONE: Record<SettlementState, string> = {
  ok:          'text-emerald-300 border-emerald-500/30 bg-emerald-500/10',
  no_pnl:      'text-slate-400 border-slate-600/40 bg-slate-700/20',
  no_lines:    'text-amber-300 border-amber-500/30 bg-amber-500/10',
  cancelled:   'text-rose-300 border-rose-500/30 bg-rose-500/10',
  unavailable: 'text-orange-300 border-orange-500/30 bg-orange-500/10',
}

export const SETTLEMENT_LABEL: Record<SettlementState, string> = {
  ok:          'Costed',
  no_pnl:      'No P&L',
  no_lines:    'Not costed',
  cancelled:   'Cancelled',
  unavailable: 'Accounts unreachable',
}
