/**
 * The driver advance, as the Apple Accounts system describes it.
 *
 * These types mirror the payload SlDriverAdvanceApiController returns; they
 * exist so the OPS board and its API route agree on a shape, not so OPS can
 * compute anything. Every figure here was derived by the accounts system and is
 * rendered verbatim — see `accounts-api.ts` for why that boundary matters.
 *
 * All `*_lkr` figures are Sri Lankan rupees, which is the currency a driver is
 * actually handed. The plain `amount` / `obligation` pair is the costed currency
 * underneath (usually USD) and is only worth showing when no rupee rate could
 * be resolved for the booking's lines.
 */

/** Which section of the booking a figure belongs to. */
export type DriverAdvanceCategory = 'TRANSPORT' | 'ATTRACTION' | 'OTHERS' | 'HOTEL' | 'MEALS'

/** Where a booking stands between "nothing paid" and "settled". */
export type DriverAdvanceStage = 'advance_due' | 'rest_due' | 'settled' | 'empty'

/** Why a board cell has no figure, or that it does. */
export type DriverAdvanceState = 'ok' | 'no_pnl' | 'no_lines' | 'error' | 'unavailable'

/** One row of the board column. */
export interface DriverAdvanceSummary {
  /** The reference OPS asked about — the key the board matches cells on. */
  reference: string
  found: boolean
  state: DriverAdvanceState
  message: string | null

  record_id?: number
  is_number?: string | null
  control_number?: string | null

  /** The envelope in force, override included. What the cell prints. */
  amount_lkr?: number | null
  /** What the rule alone says, before any human edit. */
  computed_lkr?: number | null
  /** Everything the in-scope sections will cost by the end of the tour. */
  obligation_lkr?: number | null
  paid_lkr?: number | null
  /** Still to hand over before the driver leaves. */
  outstanding_lkr?: number | null
  rate?: number | null
  rate_available?: boolean

  currency?: string
  amount?: number | null
  obligation?: number | null

  stage?: DriverAdvanceStage
  stage_label?: string
  progress?: number
  line_count?: number
  sections?: { code: DriverAdvanceCategory; label: string; lkr: number }[]
  /** A human fixed this figure in place of the computed one. */
  edited?: boolean
  /** The P&L is approved, so Payable 1.0 will actually release this. */
  payable?: boolean
  pnl_approval?: 'pending' | 'approved' | 'rejected'
  is_cancelled?: boolean
  travel_start_date?: string | null
  travel_end_date?: string | null
  allocated_to?: string | null
  updated_at?: string | null

  /**
   * When the accounts system last computed this figure.
   *
   * Always shown rather than hidden: the advance is derived on the accounts
   * side by a scheduled job, so a figure here is minutes old by construction
   * and the board should say so instead of implying it is live.
   */
  computed_at?: string | null
}

/** One section's contribution, and what it would contribute if switched on. */
export interface DriverAdvanceSection {
  code: DriverAdvanceCategory
  label: string
  included: boolean
  optional: boolean
  line_count: number
  held_count: number
  total: number
  lkr_total: number
  paid: number
  lkr_paid: number
  balance: number
  contribution: number
  contribution_lkr: number
  advance_share: number
  advance_share_lkr: number
  basis: 'advance' | 'full'
  /** Plain-English statement of the rule, e.g. "30% advance less LKR 3,000.00 held back". */
  basis_note: string
}

/** One payable line inside the envelope. */
export interface DriverAdvanceLine {
  line_key: string | null
  payable_id: number | null
  category: DriverAdvanceCategory
  category_label: string
  activity_name: string
  supplier_name: string | null
  currency: string
  status: string
  rate: number | null
  rate_fixed: boolean
  actual_amount: number
  paid_amount: number
  balance: number
  lkr_amount: number | null
  lkr_balance: number | null
  /** What this line is worth when the envelope is filled (transport is pro-rated). */
  advance_weight: number
  driver_advance_paid: number
  driver_rest_paid: number
}

/** A line on hold — costed, but not in the envelope until it is released. */
export interface DriverAdvanceHeldLine {
  line_key: string | null
  category: DriverAdvanceCategory
  category_label: string
  activity_name: string
  actual_amount: number
  lkr_amount: number
}

/** One release of money to the driver. */
export interface DriverAdvancePayment {
  ref: string | null
  stage: 'driver_advance' | 'driver_rest'
  stage_label: string
  date: string | null
  currency: string
  amount: number
  amount_lkr: number
  rate: number | null
  line_count: number
  reference: string | null
  remarks: string | null
  recorded_by: string | null
  receipt_ref: string
}

/** Everything the popup explains the figure with. */
export interface DriverAdvanceDetail {
  reference: string
  record_id: number
  is_number: string | null
  control_number: string | null
  client_name: string | null
  agent_name: string | null
  travel_start_date: string | null
  travel_end_date: string | null

  components: Record<DriverAdvanceCategory, boolean>
  transport_basis: 'advance' | 'full'
  /** The configured advance percentage, e.g. 30. */
  percent: number

  sections: DriverAdvanceSection[]
  lines: DriverAdvanceLine[]
  held_lines: DriverAdvanceHeldLine[]
  held_count: number
  line_count: number
  currency: string

  computed: number
  effective: number
  obligation: number
  paid: number
  advance_paid: number
  rest_paid: number
  other_paid: number
  advance_outstanding: number
  rest_outstanding: number
  outstanding: number
  stage: DriverAdvanceStage
  stage_label: string
  progress: number

  override: {
    amount_lkr: number
    reason: string | null
    by: string | null
    at: string | null
    /** How far the computed figure has moved since the override was set. */
    drift_lkr: number
    capped: boolean
  } | null

  notes: string | null
  updated_by: string | null
  updated_at: string | null

  lkr: {
    currency: 'LKR'
    available: boolean
    partial: boolean
    rate: number | null
    all_fixed: boolean
    computed: number
    effective: number
    obligation: number
    paid: number
    advance_paid: number | null
    rest_paid: number | null
    advance_outstanding: number | null
    rest_outstanding: number | null
    outstanding: number | null
  }

  transport: {
    total: number
    advance_due: number
    paid: number
    outstanding: number
    lkr_total: number | null
    lkr_advance_due: number | null
    deduction_lkr: number
    deduction_applied: boolean
  } | null

  pnl_approval: 'pending' | 'approved' | 'rejected'
  payable: boolean
  /** Whether the figures were rebuilt from the day's report or from stored ledger rows. */
  source: 'report' | 'ledger'
  configured: boolean
  allocation: { label?: string; assigned?: boolean } | null
  history: DriverAdvancePayment[]
}

// ── Presentation helpers, shared by the column and the popup ──────────────────

/** "LKR 24,341.10". Rupees are always shown to the cent — this is cash. */
export function lkr(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—'
  return `LKR ${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/**
 * "4 min ago" — how old a computed figure is.
 *
 * Coarse on purpose. The exact second a snapshot was written is noise; whether
 * it is minutes or hours old is the thing that decides whether to trust it.
 */
export function freshness(computedAt: string | null | undefined): string | null {
  if (!computedAt) return null

  // The accounts system stores UTC without a zone marker; MySQL hands it back
  // as "2026-08-11 17:04:22", which Date would otherwise read as local time.
  const iso = computedAt.includes('T') ? computedAt : `${computedAt.replace(' ', 'T')}Z`
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return null

  const mins = Math.max(0, Math.round((Date.now() - then) / 60_000))
  if (mins < 1)    return 'just now'
  if (mins < 60)   return `${mins} min ago`

  const hours = Math.round(mins / 60)
  if (hours < 24)  return `${hours} hour${hours === 1 ? '' : 's'} ago`

  const days = Math.round(hours / 24)
  return `${days} day${days === 1 ? '' : 's'} ago`
}

/** "USD 272.06" — the costed currency, for bookings with no rupee rate. */
export function money(value: number | null | undefined, currency = 'USD'): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—'
  return `${currency} ${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/** The colour a stage reads in — one mapping, so cell and popup never disagree. */
export const STAGE_TONE: Record<DriverAdvanceStage, string> = {
  advance_due: 'text-amber-300 border-amber-500/30 bg-amber-500/10',
  rest_due:    'text-sky-300 border-sky-500/30 bg-sky-500/10',
  settled:     'text-emerald-300 border-emerald-500/30 bg-emerald-500/10',
  empty:       'text-slate-400 border-slate-600/40 bg-slate-700/20',
}

export const CATEGORY_TONE: Record<DriverAdvanceCategory, string> = {
  TRANSPORT:  'text-violet-300 bg-violet-500/10 border-violet-500/25',
  ATTRACTION: 'text-teal-300 bg-teal-500/10 border-teal-500/25',
  OTHERS:     'text-slate-300 bg-slate-600/20 border-slate-500/25',
  HOTEL:      'text-pink-300 bg-pink-500/10 border-pink-500/25',
  MEALS:      'text-orange-300 bg-orange-500/10 border-orange-500/25',
}
