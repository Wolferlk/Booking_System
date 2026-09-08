/**
 * The Driver Settlement Register — the Sri Lankan "Final Settlement" workbook,
 * as a screen.
 *
 * ---- What this is ----
 *
 * The desk has kept the rest payments to Sri Lankan chauffeurs in one
 * spreadsheet for years: a row per finished tour, gathered into numbered bulks,
 * with what the transport actually cost, what was advanced, what is therefore
 * still payable, what the tour was budgeted at, and the excess or shortage
 * between the two. This file is that sheet's vocabulary — the row, the columns,
 * the filters and the arithmetic — so the register screen, its API and its
 * download all describe a settlement with the same words.
 *
 * ---- What it is not ----
 *
 * A second costing. Every rupee here arrives already decided: the obligation
 * and the advance come off the accounts system's driver-advance snapshot (via
 * `sl-drive-log.ts`, which is the module that reads them), and the desk's
 * corrections come off `sl_transport_settlement_requests`. This file adds
 * exactly three things the workbook has and neither database had: the bulk a
 * tour is settled in, what it is being settled for, and the budget its variance
 * is measured against. Nothing here recomputes an advance, and nothing here
 * pays anybody — the register raises a request and Payable 1.0 releases the
 * money, the same boundary `sl-transport-actuals.ts` describes at length.
 *
 * ---- The variance, precisely ----
 *
 *   balance payable      total transport cost − advance already handed over
 *   excess / (shortage)  budgeted cost − total transport cost
 *   variance %           excess ÷ budgeted cost
 *
 * A positive excess is money the tour did not spend. A negative one — printed
 * in brackets, as the workbook prints it — is an overrun the desk has to answer
 * for. Where no budget was entered the row has no variance at all rather than a
 * variance against zero, which would read as a 100% overrun on every untouched
 * booking.
 */

import { dayKey, daysBetween, shiftDay, type DriveLogQuery, type DriveLogRow } from './sl-drive-log'
import {
  COST_TYPE_LABEL, type ActualsStatus, type SettlementCostType,
} from './sl-transport-actuals'

// ── Row ───────────────────────────────────────────────────────────────────────

/**
 * Where a booking stands in the register.
 *
 *   unrecorded  nobody has opened it — it is running on the derived figures.
 *   draft       figures or a bulk entered here, not sent to accounts.
 *   pending     submitted; the accounts team has it.
 *   recorded    accounts released the rest payment against it.
 *   rejected    accounts sent it back with a reason.
 *   cancelled   the desk withdrew its submission.
 */
export type RegisterState = 'unrecorded' | ActualsStatus

export const REGISTER_STATE_LABEL: Record<RegisterState, string> = {
  unrecorded: 'Not recorded',
  draft:      'Draft',
  pending:    'With accounts',
  recorded:   'Settled',
  rejected:   'Sent back',
  cancelled:  'Withdrawn',
}

export const REGISTER_STATE_TONE: Record<RegisterState, string> = {
  unrecorded: 'text-slate-400 border-slate-600/40 bg-slate-700/20',
  draft:      'text-amber-300 border-amber-500/30 bg-amber-500/10',
  pending:    'text-sky-300 border-sky-500/30 bg-sky-500/10',
  recorded:   'text-emerald-300 border-emerald-500/30 bg-emerald-500/10',
  rejected:   'text-rose-300 border-rose-500/30 bg-rose-500/10',
  cancelled:  'text-violet-300 border-violet-500/30 bg-violet-500/10',
}

/** One line of the workbook. */
export interface RegisterRow {
  bookingId: string
  bookingRef: string
  /** The workbook's "Tour" column — the IS number, the booking ref as a fallback. */
  tour: string
  isNumber: string | null
  cntlNumber: string | null
  clientName: string | null

  /** `yyyy-mm-dd`, and the same day split for the workbook's Y / M / D columns. */
  date: string
  year: number | null
  month: number | null
  day: number | null

  /** The workbook's "Chauffeur". Null when the file was never allocated. */
  chauffeur: string | null
  chauffeurPhone: string | null
  vendorName: string | null
  /** "A/C Name" — the agent the tour was sold through. */
  acName: string | null

  pax: number
  nights: number | null
  fileHandler: string | null

  bulkNo: string | null
  costType: SettlementCostType | null
  costTypeLabel: string | null

  currency: string
  /** False when no LKR rate resolved — the figures are then the costed currency. */
  lkrAvailable: boolean

  /** What the whole transport package comes to. The desk's figure wins. */
  totalCost: number | null
  /** Of the advance, what has actually been handed over. */
  advancePaid: number | null
  /** Total cost − advance paid. What the driver is still owed. */
  balancePayable: number | null
  /** Of that, what accounts has already released. */
  restPaid: number | null
  /** Balance payable − rest paid. What a settlement run would move. */
  restOutstanding: number | null

  budgetedCost: number | null
  /** Budget − total. Positive is a saving, negative an overrun. */
  excess: number | null
  /** Excess ÷ budget, as a percentage. Null when there is no budget. */
  variancePct: number | null

  /** True when the total cost is the desk's assertion rather than the derivation. */
  costOverridden: boolean
  /** The derived total, kept alongside so the screen can show what was corrected. */
  derivedTotalCost: number | null

  state: RegisterState
  /** The P&L is approved, so accounts can actually release against this row. */
  payable: boolean
  approval: 'pending' | 'approved' | 'rejected'
  /** True once nothing is left to pay on this booking. */
  settled: boolean

  remarks: string | null
  note: string | null
  decisionNote: string | null
  recordedBatchRef: string | null
  recordedAt: string | null
  submittedAt: string | null

  /** The accounts P&L record, so a row can be opened on the Payable 1.0 side. */
  recordId: number | null
  /** Why a row carries no money, when it carries none. */
  message: string | null
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const round2 = (n: number) => Math.round(n * 100) / 100

/**
 * One Drive Log row as a register line.
 *
 * Pure rearrangement: not one figure below is computed from a rate, a
 * percentage or a P&L line. `effective` has already decided whether the desk's
 * correction or the accounts system's derivation is the total, and this only
 * subtracts what has been paid from it and measures it against the budget.
 */
export function toRegisterRow(row: DriveLogRow): RegisterRow {
  const a = row.actuals
  const s = row.settlement

  const totalCost   = row.effective.totalCost
  const advancePaid = s.advancePaid
  const restPaid    = s.restPaid

  // The workbook's balance is measured against what actually left the building,
  // not against the advance the rule says was due: a driver who was handed less
  // than his envelope is still owed the difference, and a row that hid that
  // would send him away short.
  const balancePayable = isNum(totalCost)
    ? round2(totalCost - (advancePaid ?? 0))
    : null

  const restOutstanding = isNum(balancePayable)
    ? round2(Math.max(0, balancePayable - (restPaid ?? 0)))
    : null

  const budgetedCost = a?.budgetedCost ?? null
  const excess = isNum(budgetedCost) && isNum(totalCost) ? round2(budgetedCost - totalCost) : null
  const variancePct = isNum(excess) && isNum(budgetedCost) && budgetedCost !== 0
    ? round2((excess / budgetedCost) * 100)
    : null

  const [year, month, day] = splitDay(row.arrivalDate)

  return {
    bookingId:  row.bookingId,
    bookingRef: row.bookingRef,
    tour:       row.isNumber || row.bookingRef,
    isNumber:   row.isNumber,
    cntlNumber: row.cntlNumber,
    clientName: row.clientName,

    date: row.arrivalDate,
    year, month, day,

    chauffeur:      row.driver?.name ?? null,
    chauffeurPhone: row.driver?.phone ?? null,
    vendorName:     row.driver?.vendorName ?? null,
    acName:         row.agent,

    pax:         row.pax,
    nights:      row.nights,
    fileHandler: row.fileHandler,

    bulkNo:        a?.bulkNo ?? null,
    costType:      a?.costType ?? null,
    costTypeLabel: a?.costType ? COST_TYPE_LABEL[a.costType] : null,

    currency:     s.currency,
    lkrAvailable: s.lkrAvailable,

    totalCost,
    advancePaid,
    balancePayable,
    restPaid,
    restOutstanding,

    budgetedCost,
    excess,
    variancePct,

    costOverridden:   row.effective.costOverridden,
    derivedTotalCost: s.totalCost,

    state:    a ? a.status : 'unrecorded',
    payable:  s.payable,
    approval: s.approval,
    settled:  a?.status === 'recorded' || (isNum(restOutstanding) && restOutstanding < 0.01),

    remarks:          a?.remarks ?? null,
    note:             a?.note ?? null,
    decisionNote:     a?.decisionNote ?? null,
    recordedBatchRef: a?.recordedBatchRef ?? null,
    recordedAt:       a?.recordedAt ?? null,
    submittedAt:      a?.submittedAt ?? null,

    recordId: s.recordId,
    message:  s.message,
  }
}

/** `2026-08-11` → `[2026, 8, 11]`, the workbook's three pivot columns. */
export function splitDay(day: string | null): [number | null, number | null, number | null] {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day ?? '')
  if (!m) return [null, null, null]
  return [Number(m[1]), Number(m[2]), Number(m[3])]
}

// ── Filters ───────────────────────────────────────────────────────────────────

export type RegisterBulkFilter    = 'all' | 'in_bulk' | 'no_bulk'
export type RegisterStateFilter   = 'all' | RegisterState
export type RegisterCostFilter    = 'all' | 'unset' | SettlementCostType
/**
 * The variance bands the desk actually asks for.
 *
 *   excess     the tour came in under budget.
 *   shortage   it came in over — the rows that need an explanation.
 *   on_budget  within a rupee either way.
 *   unbudgeted no budget entered, so no variance can be stated.
 */
export type RegisterVarianceFilter = 'all' | 'excess' | 'shortage' | 'on_budget' | 'unbudgeted'
export type RegisterPaymentFilter  = 'all' | 'rest_due' | 'settled' | 'overpaid'
export type RegisterGroupBy        = 'none' | 'bulk' | 'chauffeur' | 'agent' | 'month'
export type RegisterSortField =
  | 'date' | 'tour' | 'bulk' | 'chauffeur' | 'agent' | 'cost' | 'advance'
  | 'balance' | 'budget' | 'excess' | 'variancePct'
export type RegisterSortDir = 'asc' | 'desc'

export interface RegisterFilters {
  search: string
  bulk: RegisterBulkFilter
  /** A single bulk number, when the desk has drilled into one. */
  bulkNo: string
  costType: RegisterCostFilter
  state: RegisterStateFilter
  variance: RegisterVarianceFilter
  payment: RegisterPaymentFilter
  chauffeur: string
  agent: string
  /** Rupee bounds on the balance payable. Null means unbounded. */
  minBalance: number | null
  maxBalance: number | null
  /** Only rows whose P&L accounts has approved — the ones that can actually be paid. */
  approvedOnly: boolean
  /** Hide the rows nothing is owed on. */
  openOnly: boolean
  groupBy: RegisterGroupBy
  sortBy: RegisterSortField
  sortDir: RegisterSortDir
}

export const EMPTY_FILTERS: RegisterFilters = {
  search: '', bulk: 'all', bulkNo: '', costType: 'all', state: 'all',
  variance: 'all', payment: 'all', chauffeur: '', agent: '',
  minBalance: null, maxBalance: null, approvedOnly: false, openOnly: false,
  groupBy: 'none', sortBy: 'date', sortDir: 'asc',
}

const has = (hay: string | null | undefined, needle: string) =>
  (hay ?? '').toLowerCase().includes(needle)

/** Every filter, applied in one pass. Pure — the screen and the download share it. */
export function applyRegisterFilters(rows: RegisterRow[], f: RegisterFilters): RegisterRow[] {
  const q = f.search.trim().toLowerCase()
  const bulkNo = f.bulkNo.trim().toUpperCase()
  const chauffeur = f.chauffeur.trim().toLowerCase()
  const agent = f.agent.trim().toLowerCase()

  return rows.filter(r => {
    if (q && !(
      has(r.tour, q) || has(r.bookingRef, q) || has(r.cntlNumber, q) ||
      has(r.clientName, q) || has(r.chauffeur, q) || has(r.acName, q) ||
      has(r.bulkNo, q) || has(r.remarks, q) || has(r.recordedBatchRef, q)
    )) return false

    if (f.bulk === 'in_bulk' && !r.bulkNo) return false
    if (f.bulk === 'no_bulk' && r.bulkNo) return false
    if (bulkNo && (r.bulkNo ?? '') !== bulkNo) return false

    if (f.costType === 'unset' && r.costType) return false
    if (f.costType !== 'all' && f.costType !== 'unset' && r.costType !== f.costType) return false

    if (f.state !== 'all' && r.state !== f.state) return false

    if (f.variance !== 'all') {
      if (f.variance === 'unbudgeted') {
        if (r.excess !== null) return false
      } else if (r.excess === null) {
        return false
      } else if (f.variance === 'excess'    && r.excess <= 0.009) {
        return false
      } else if (f.variance === 'shortage'  && r.excess >= -0.009) {
        return false
      } else if (f.variance === 'on_budget' && Math.abs(r.excess) > 0.009) {
        return false
      }
    }

    if (f.payment !== 'all') {
      const out = r.restOutstanding
      if (f.payment === 'rest_due' && !(isNum(out) && out > 0.009)) return false
      if (f.payment === 'settled'  && !r.settled) return false
      if (f.payment === 'overpaid' && !(isNum(r.balancePayable) && isNum(r.restPaid)
        && r.restPaid - r.balancePayable > 0.009)) return false
    }

    if (chauffeur && !has(r.chauffeur, chauffeur) && !has(r.vendorName, chauffeur)) return false
    if (agent && !has(r.acName, agent)) return false

    if (f.minBalance !== null && !(isNum(r.balancePayable) && r.balancePayable >= f.minBalance)) return false
    if (f.maxBalance !== null && !(isNum(r.balancePayable) && r.balancePayable <= f.maxBalance)) return false

    if (f.approvedOnly && !r.payable) return false
    if (f.openOnly && !(isNum(r.restOutstanding) && r.restOutstanding > 0.009)) return false

    return true
  })
}

const cmpText = (a: string | null, b: string | null) =>
  (a ?? '').localeCompare(b ?? '', undefined, { numeric: true, sensitivity: 'base' })

/** Nulls sort last in both directions — a missing figure is not a small one. */
const cmpNum = (a: number | null, b: number | null, dir: number) => {
  if (a === null && b === null) return 0
  if (a === null) return 1
  if (b === null) return -1
  return (a - b) * dir
}

export function sortRegisterRows(rows: RegisterRow[], f: RegisterFilters): RegisterRow[] {
  const dir = f.sortDir === 'desc' ? -1 : 1

  return [...rows].sort((a, b) => {
    switch (f.sortBy) {
      case 'tour':        return cmpText(a.tour, b.tour) * dir
      case 'bulk':        return cmpText(a.bulkNo, b.bulkNo) * dir
      case 'chauffeur':   return cmpText(a.chauffeur, b.chauffeur) * dir
      case 'agent':       return cmpText(a.acName, b.acName) * dir
      case 'cost':        return cmpNum(a.totalCost, b.totalCost, dir)
      case 'advance':     return cmpNum(a.advancePaid, b.advancePaid, dir)
      case 'balance':     return cmpNum(a.balancePayable, b.balancePayable, dir)
      case 'budget':      return cmpNum(a.budgetedCost, b.budgetedCost, dir)
      case 'excess':      return cmpNum(a.excess, b.excess, dir)
      case 'variancePct': return cmpNum(a.variancePct, b.variancePct, dir)
      default:            return (cmpText(a.date, b.date) || cmpText(a.tour, b.tour)) * dir
    }
  })
}

// ── Totals ────────────────────────────────────────────────────────────────────

export interface RegisterTotals {
  rows: number
  pax: number
  totalCost: number
  advancePaid: number
  balancePayable: number
  restPaid: number
  restOutstanding: number
  budgetedCost: number
  excess: number
  /** Excess ÷ budget over the rows that carry a budget. */
  variancePct: number | null
  /** How many rows carry a budget at all — a total is only honest if it says so. */
  budgeted: number
  settled: number
  pending: number
  /** Rows whose figures are in the costed currency because no rupee rate resolved. */
  noRate: number
}

export function registerTotals(rows: RegisterRow[]): RegisterTotals {
  const t: RegisterTotals = {
    rows: rows.length, pax: 0,
    totalCost: 0, advancePaid: 0, balancePayable: 0, restPaid: 0, restOutstanding: 0,
    budgetedCost: 0, excess: 0, variancePct: null, budgeted: 0,
    settled: 0, pending: 0, noRate: 0,
  }

  for (const r of rows) {
    t.pax += r.pax
    if (isNum(r.totalCost))       t.totalCost += r.totalCost
    if (isNum(r.advancePaid))     t.advancePaid += r.advancePaid
    if (isNum(r.balancePayable))  t.balancePayable += r.balancePayable
    if (isNum(r.restPaid))        t.restPaid += r.restPaid
    if (isNum(r.restOutstanding)) t.restOutstanding += r.restOutstanding
    if (isNum(r.budgetedCost))  { t.budgetedCost += r.budgetedCost; t.budgeted += 1 }
    if (isNum(r.excess))          t.excess += r.excess
    if (r.settled)                t.settled += 1
    if (r.state === 'pending')    t.pending += 1
    if (!r.lkrAvailable)          t.noRate += 1
  }

  for (const k of ['totalCost', 'advancePaid', 'balancePayable', 'restPaid',
                   'restOutstanding', 'budgetedCost', 'excess'] as const) {
    t[k] = round2(t[k])
  }

  t.variancePct = t.budgetedCost !== 0 ? round2((t.excess / t.budgetedCost) * 100) : null
  return t
}

// ── Grouping ──────────────────────────────────────────────────────────────────

export interface RegisterGroup {
  key: string
  label: string
  rows: RegisterRow[]
  totals: RegisterTotals
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/**
 * The rows under their subtotals.
 *
 * `none` still returns one group, so the screen renders a single code path
 * rather than branching between a grouped table and a flat one.
 */
export function groupRegisterRows(rows: RegisterRow[], by: RegisterGroupBy): RegisterGroup[] {
  if (by === 'none') {
    return [{ key: 'all', label: 'All rows', rows, totals: registerTotals(rows) }]
  }

  const buckets = new Map<string, { label: string; rows: RegisterRow[] }>()

  for (const r of rows) {
    let key: string
    let label: string

    if (by === 'bulk') {
      key = r.bulkNo ?? ''
      label = r.bulkNo ? `Bulk ${r.bulkNo}` : 'Not in a bulk'
    } else if (by === 'chauffeur') {
      key = r.chauffeur ?? r.vendorName ?? ''
      label = key || 'No chauffeur allocated'
    } else if (by === 'agent') {
      key = r.acName ?? ''
      label = key || 'No agent'
    } else {
      key = r.year && r.month ? `${r.year}-${String(r.month).padStart(2, '0')}` : ''
      label = r.year && r.month ? `${MONTHS[r.month - 1]} ${r.year}` : 'Undated'
    }

    const bucket = buckets.get(key) ?? { label, rows: [] }
    bucket.rows.push(r)
    buckets.set(key, bucket)
  }

  return Array.from(buckets.entries())
    // The unbucketed rows go last whatever they are called — "Not in a bulk"
    // is not a bulk, and sorting it in among the numbered ones hides it.
    .sort(([a], [b]) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b, undefined, { numeric: true })))
    .map(([key, b]) => ({ key, label: b.label, rows: b.rows, totals: registerTotals(b.rows) }))
}

/** Every bulk number in hand, for the filter's dropdown. */
export function bulkNumbers(rows: RegisterRow[]): string[] {
  return Array.from(new Set(rows.map(r => r.bulkNo).filter((b): b is string => !!b)))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
}

// ── Formatting ────────────────────────────────────────────────────────────────

/** "104,859.00", or an em dash. Never a zero standing in for "unknown". */
export function amount(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—'
  return v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/** The workbook's convention: a negative figure is printed in brackets. */
export function bracketed(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—'
  return v < 0 ? `(${amount(Math.abs(v))})` : amount(v)
}

export function percent(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—'
  return `${v < 0 ? '(' : ''}${Math.abs(v).toFixed(2)}%${v < 0 ? ')' : ''}`
}

/** "11/Aug/2026" — the date exactly as the workbook writes it. */
export function workbookDate(day: string | null): string {
  const [y, m, d] = splitDay(day)
  if (!y || !m || !d) return '—'
  return `${String(d).padStart(2, '0')}/${MONTHS[m - 1]}/${y}`
}

// ── The window ────────────────────────────────────────────────────────────────

/**
 * How far back the register opens.
 *
 * The Drive Log looks forward — an advance has to be counted before the guest
 * lands. The register looks back: a rest payment is settled after the tour has
 * finished, so the useful default is the month just gone, not the day after
 * tomorrow.
 */
export const DEFAULT_LOOKBACK_DAYS = 45

export interface RegisterQuery extends RegisterFilters {
  dateField: 'arrivalDate' | 'departureDate'
  from: string
  to: string
}

const isDayKey = (v: string | null): v is string => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v)

const numberOrNull = (v: string | null): number | null => {
  if (v === null || v.trim() === '') return null
  const n = Number(v.replace(/,/g, ''))
  return Number.isFinite(n) && n >= 0 ? n : null
}

/**
 * The filters off a query string, everything hostile clamped.
 *
 * The 92-day ceiling is the Drive Log's and is kept deliberately: each row
 * costs a JSON parse of an accounts payload, and an unbounded window is the one
 * way to make this screen expensive. A desk settling a wider span works it a
 * bulk at a time, which is how the workbook has always been worked anyway.
 */
export function parseRegisterQuery(sp: URLSearchParams, now = new Date()): RegisterQuery {
  const today = dayKey(now)

  const rawFrom = sp.get('from')
  const rawTo   = sp.get('to')

  let from = isDayKey(rawFrom) ? rawFrom : shiftDay(today, -DEFAULT_LOOKBACK_DAYS)
  let to   = isDayKey(rawTo)   ? rawTo   : today

  if (daysBetween(from, to) < 0) [from, to] = [to, from]
  if (daysBetween(from, to) > 92) to = shiftDay(from, 92)

  const pick = <T extends string>(v: string | null, allowed: readonly T[], fallback: T): T =>
    allowed.includes((v ?? '') as T) ? (v as T) : fallback

  return {
    dateField: pick(sp.get('dateField'), ['arrivalDate', 'departureDate'] as const, 'arrivalDate'),
    from,
    to,
    search:    (sp.get('search') ?? '').trim().slice(0, 120),
    bulk:      pick(sp.get('bulk'), ['all', 'in_bulk', 'no_bulk'] as const, 'all'),
    bulkNo:    (sp.get('bulkNo') ?? '').trim().slice(0, 32),
    costType:  pick(sp.get('costType'),
      ['all', 'unset', 'transport', 'transport_entrance', 'transfer'] as const, 'all'),
    state:     pick(sp.get('state'),
      ['all', 'unrecorded', 'draft', 'pending', 'recorded', 'rejected', 'cancelled'] as const, 'all'),
    variance:  pick(sp.get('variance'),
      ['all', 'excess', 'shortage', 'on_budget', 'unbudgeted'] as const, 'all'),
    payment:   pick(sp.get('payment'), ['all', 'rest_due', 'settled', 'overpaid'] as const, 'all'),
    chauffeur: (sp.get('chauffeur') ?? '').trim().slice(0, 120),
    agent:     (sp.get('agent') ?? '').trim().slice(0, 120),
    minBalance: numberOrNull(sp.get('minBalance')),
    maxBalance: numberOrNull(sp.get('maxBalance')),
    approvedOnly: sp.get('approvedOnly') === '1',
    openOnly:     sp.get('openOnly') === '1',
    groupBy:   pick(sp.get('groupBy'),
      ['none', 'bulk', 'chauffeur', 'agent', 'month'] as const, 'none'),
    sortBy:    pick(sp.get('sortBy'),
      ['date', 'tour', 'bulk', 'chauffeur', 'agent', 'cost', 'advance',
       'balance', 'budget', 'excess', 'variancePct'] as const, 'date'),
    sortDir:   sp.get('sortDir') === 'desc' ? 'desc' : 'asc',
  }
}

/** The filters back as a query string — screen, download and URL share one. */
export function registerSearchParams(q: RegisterQuery): URLSearchParams {
  const sp = new URLSearchParams({
    dateField: q.dateField, from: q.from, to: q.to,
    bulk: q.bulk, costType: q.costType, state: q.state, variance: q.variance,
    payment: q.payment, groupBy: q.groupBy, sortBy: q.sortBy, sortDir: q.sortDir,
  })
  if (q.search) sp.set('search', q.search)
  if (q.bulkNo) sp.set('bulkNo', q.bulkNo)
  if (q.chauffeur) sp.set('chauffeur', q.chauffeur)
  if (q.agent) sp.set('agent', q.agent)
  if (q.minBalance !== null) sp.set('minBalance', String(q.minBalance))
  if (q.maxBalance !== null) sp.set('maxBalance', String(q.maxBalance))
  if (q.approvedOnly) sp.set('approvedOnly', '1')
  if (q.openOnly) sp.set('openOnly', '1')
  return sp
}

/**
 * The Drive Log query behind a register window.
 *
 * The register never asks the fetch layer to filter: every narrowing it offers
 * is about figures that only exist once the accounts decorations have landed,
 * so the window is fetched whole and `applyRegisterFilters` does the rest. What
 * is set here is only what the fetch itself needs — which bookings, over which
 * days, in which order.
 */
export function toDriveLogQuery(q: RegisterQuery): DriveLogQuery {
  return {
    dateField: q.dateField,
    from: q.from,
    to: q.to,
    search: '',
    stage: 'all',
    approval: 'all',
    driver: 'all',
    actuals: 'all',
    openOnly: false,
    // A hotel-only file has no transport and therefore no settlement; it is
    // excluded here rather than filtered out later so it never counts towards
    // the row ceiling.
    includeHotelOnly: false,
    sortBy: 'arrival',
    sortDir: 'asc',
  }
}
