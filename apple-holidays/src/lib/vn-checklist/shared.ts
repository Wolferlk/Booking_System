/**
 * Vietnam booking checklist — the desk's per-booking costing sheet.
 *
 * One row per thing a vendor is paid for (details for payment, vendor, code,
 * unit price, quan1 x quan2, paid), and four figures at the foot:
 *
 *     Total estimate   sum of the rows, in VND           — what the trip COSTS
 *     Total VND        revenue USD x the booking's rate   — what it SOLD for
 *     PNL incurred     Total VND - Total estimate         — the PROFIT in dong
 *     Profit margin    PNL incurred / Total VND
 *
 * These are the Accounts "Checklist VN" definitions word for word (see
 * ChecklistVnService.php), so OPS and Accounts read one sheet the same way.
 * "PNL incurred" is the profit, not the cost, despite the name.
 *
 * Safe to import from the browser: constants, types and pure maths only.
 */

/** Accounts' Checklist VN house rate — the fallback when a booking has none. */
export const DEFAULT_VND_RATE = 25500

/** Who can open the checklist. Same roles as the P&L button, plus GT_VN_USER. */
export const CHECKLIST_ROLES = ['BT_USER', 'AC_USER', 'TE_USER', 'GT_VN_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN'] as const
/** Who can change it. TE reads only. */
export const CHECKLIST_EDIT_ROLES = ['BT_USER', 'AC_USER', 'GT_VN_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN'] as const

export const canViewChecklist = (role: string | null | undefined) => (CHECKLIST_ROLES as readonly string[]).includes(String(role))
export const canEditChecklist = (role: string | null | undefined) => (CHECKLIST_EDIT_ROLES as readonly string[]).includes(String(role))

export const CHECKLIST_NOT_INSTALLED =
  'The Vietnam checklist is not set up on this database yet — run prisma/sql/apply-vn-booking-checklist.sh'

export type ChecklistStatus = 'DRAFT' | 'CHECKED' | 'FINAL'
export type PaidStatus = 'UNPAID' | 'PARTIAL' | 'PAID'
export type UnitCurrency = 'VND' | 'USD'

export const CHECKLIST_STATUSES: { value: ChecklistStatus; label: string; tone: string }[] = [
  { value: 'DRAFT',   label: 'Draft',   tone: 'bg-slate-100 text-slate-600 ring-slate-200' },
  { value: 'CHECKED', label: 'Checked', tone: 'bg-sky-50 text-sky-700 ring-sky-200' },
  { value: 'FINAL',   label: 'Final',   tone: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
]

/** The Vietnam sheet's own codes (Accounts / product workbook), plus the two the desk adds by hand. */
export const CHECKLIST_CODES = ['Trans', 'Ticket', 'SIC', 'Day Cruise', 'Guide fee', 'F&B', 'Hotel', 'Cruise', 'Flight', 'Other'] as const

export interface ChecklistItem {
  id: string
  position: number
  serviceDate: string | null   // yyyy-mm-dd
  description: string
  vendor: string | null
  code: string | null
  unitPrice: number
  unitCurrency: UnitCurrency
  quan1: number
  quan2: number
  totalOverrideVnd: number | null
  paidStatus: PaidStatus
  paidVnd: number | null
  paidAt: string | null
  paidByName: string | null
  source: 'MANUAL' | 'CATALOG' | 'INCLUDE'
  productKey: string | null
  note: string | null
  updatedByName?: string | null
}

export interface ChecklistHeader {
  bookingRef: string
  status: ChecklistStatus
  note: string | null
  /** What a person typed; null = live value. */
  revenueUsdOverride: number | null
  exchangeRateOverride: number | null
  checkedByName: string | null
  checkedAt: string | null
  updatedByName: string | null
  updatedAt: string | null
}

/** The live values the overrides fall back to. */
export interface ChecklistLive {
  revenueUsd: number | null
  revenueSource: 'PNL' | 'QUOTED' | null
  exchangeRate: number
  /** The booking's own P&L cost in USD — the tally the sheet is checked against. */
  pnlCostUsd: number | null
  pnlRevenueUsd: number | null
  pax: { adults: number; children: number }
}

export interface ChecklistBookingInfo {
  bookingRef: string
  agent: string | null
  cntlNumber: string | null
  isNumber: string | null
  arrivalDate: string | null
  departureDate: string | null
  status: string
  cancelled: boolean
  currency: string
}

export interface ChecklistPayload {
  installed: boolean
  exists: boolean
  booking: ChecklistBookingInfo
  header: ChecklistHeader
  items: ChecklistItem[]
  live: ChecklistLive
}

// ─── Maths ──────────────────────────────────────────────────────────────────

const n = (v: unknown) => {
  const x = typeof v === 'number' ? v : Number(String(v ?? '').replace(/[,\s₫$]/g, ''))
  return Number.isFinite(x) ? x : 0
}
const r2 = (v: number) => Math.round(v * 100) / 100

/** unit x quan1 x quan2, converted to VND at `rate` when the unit is USD. */
export function computedTotalVnd(item: Pick<ChecklistItem, 'unitPrice' | 'unitCurrency' | 'quan1' | 'quan2'>, rate: number): number {
  const base = n(item.unitPrice) * n(item.quan1) * n(item.quan2)
  return r2(item.unitCurrency === 'USD' ? base * rate : base)
}

/** The row's Total estimate: the typed total if there is one, else the product. */
export function itemTotalVnd(item: ChecklistItem, rate: number): number {
  return item.totalOverrideVnd !== null && item.totalOverrideVnd !== undefined
    ? r2(n(item.totalOverrideVnd))
    : computedTotalVnd(item, rate)
}

/** VND already paid on the row. PAID with no amount means the whole total. */
export function itemPaidVnd(item: ChecklistItem, rate: number): number {
  if (item.paidStatus === 'PAID') return item.paidVnd ?? itemTotalVnd(item, rate)
  if (item.paidStatus === 'PARTIAL') return n(item.paidVnd)
  return 0
}

export interface ChecklistTotals {
  rate: number
  revenueUsd: number | null
  /** Sum of the rows — cost. Null when there are no rows (UNKNOWN cost, not zero). */
  totalEstimateVnd: number | null
  /** Revenue USD x rate. */
  totalVnd: number | null
  /** Total VND - Total estimate — the profit in dong. */
  pnlIncurredVnd: number | null
  /** PNL incurred / Total VND, 0–1. */
  profitMargin: number | null
  costUsd: number | null
  profitUsd: number | null
  paidVnd: number
  outstandingVnd: number
  paidCount: number
  itemCount: number
  /** Cost vs the booking's own P&L cost, in USD (positive = sheet costs more). */
  pnlDiffUsd: number | null
  byCode: { code: string; totalVnd: number; count: number }[]
  byVendor: { vendor: string; totalVnd: number; paidVnd: number; count: number }[]
}

export function effectiveRate(header: Pick<ChecklistHeader, 'exchangeRateOverride'>, live: Pick<ChecklistLive, 'exchangeRate'>): number {
  const r = header.exchangeRateOverride ?? live.exchangeRate
  return r && r > 0 ? r : DEFAULT_VND_RATE
}

export function computeTotals(header: ChecklistHeader, items: ChecklistItem[], live: ChecklistLive): ChecklistTotals {
  const rate = effectiveRate(header, live)
  const revenueUsd = header.revenueUsdOverride ?? live.revenueUsd

  let cost = 0, paid = 0, paidCount = 0
  const codes = new Map<string, { totalVnd: number; count: number }>()
  const vendors = new Map<string, { totalVnd: number; paidVnd: number; count: number }>()
  for (const it of items) {
    const t = itemTotalVnd(it, rate)
    const p = itemPaidVnd(it, rate)
    cost += t
    paid += p
    if (it.paidStatus === 'PAID') paidCount++
    const c = (it.code || 'Other').trim()
    const ce = codes.get(c) ?? { totalVnd: 0, count: 0 }
    ce.totalVnd += t; ce.count++; codes.set(c, ce)
    const v = (it.vendor || '—').trim() || '—'
    const ve = vendors.get(v) ?? { totalVnd: 0, paidVnd: 0, count: 0 }
    ve.totalVnd += t; ve.paidVnd += p; ve.count++; vendors.set(v, ve)
  }

  const costed = items.length > 0
  const totalEstimateVnd = costed ? r2(cost) : null
  const totalVnd = revenueUsd !== null ? r2(revenueUsd * rate) : null
  const pnlIncurredVnd = costed && totalVnd !== null ? r2(totalVnd - cost) : null
  const profitMargin = pnlIncurredVnd !== null && totalVnd && totalVnd > 0 ? pnlIncurredVnd / totalVnd : null
  const costUsd = costed ? r2(cost / rate) : null

  return {
    rate,
    revenueUsd,
    totalEstimateVnd,
    totalVnd,
    pnlIncurredVnd,
    profitMargin,
    costUsd,
    profitUsd: pnlIncurredVnd !== null ? r2(pnlIncurredVnd / rate) : null,
    paidVnd: r2(paid),
    outstandingVnd: r2(Math.max(cost - paid, 0)),
    paidCount,
    itemCount: items.length,
    pnlDiffUsd: costUsd !== null && live.pnlCostUsd !== null ? r2(costUsd - live.pnlCostUsd) : null,
    byCode: Array.from(codes, ([code, v]) => ({ code, ...v })).sort((a, b) => b.totalVnd - a.totalVnd),
    byVendor: Array.from(vendors, ([vendor, v]) => ({ vendor, ...v })).sort((a, b) => b.totalVnd - a.totalVnd),
  }
}

// ─── Formatting ─────────────────────────────────────────────────────────────

export function fmtVnd(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—'
  const s = Math.round(Math.abs(v)).toLocaleString('en-US')
  return v < 0 ? `(${s})` : s
}

export function fmtUsd(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—'
  const s = Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return v < 0 ? `-$${s}` : `$${s}`
}

export function fmtPct(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—'
  return `${(v * 100).toFixed(1)}%`
}

/** Margin colour band: red under water, amber thin, green healthy. */
export function marginTone(m: number | null): 'neg' | 'thin' | 'ok' | 'none' {
  if (m === null) return 'none'
  if (m < 0) return 'neg'
  if (m < 0.1) return 'thin'
  return 'ok'
}

export function parseNum(v: unknown): number {
  return n(v)
}
