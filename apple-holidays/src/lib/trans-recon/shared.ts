/**
 * Trans-Reconsultation — the half-month transport sheet each country desk used
 * to keep in Excel ("Malaysia 16th to 30th September 2026.xlsx"), built from the
 * MC Report instead of typed.
 *
 * One sheet per country per half month (1st–15th, 16th–end). Its lines start
 * as MC Report movements; the desk types the rate it is paying, the system puts
 * the booking's own P&L line beside it, and Accounts approves or refuses each
 * line from the Accounts system — which reads and writes these same two tables
 * (`trans_recon_sheets`, `trans_recon_lines`) on its `ops` connection.
 *
 * Everything in this file is pure so the page, the API and the export agree on
 * the arithmetic. The Accounts side (TransReconService.php) repeats
 * `computeSheet` line for line — change one, change both.
 */

export const RECON_COUNTRIES = ['MALAYSIA', 'SINGAPORE', 'VIETNAM', 'SRILANKA'] as const
export type ReconCountry = (typeof RECON_COUNTRIES)[number]

export const RECON_COUNTRY_META: Record<ReconCountry, { label: string; flag: string; currency: string; prefix: string }> = {
  MALAYSIA:  { label: 'Malaysia',  flag: '🇲🇾', currency: 'MYR', prefix: 'MY' },
  SINGAPORE: { label: 'Singapore', flag: '🇸🇬', currency: 'SGD', prefix: 'SG' },
  VIETNAM:   { label: 'Vietnam',   flag: '🇻🇳', currency: 'VND', prefix: 'VN' },
  SRILANKA:  { label: 'Sri Lanka', flag: '🇱🇰', currency: 'LKR', prefix: 'IS' },
}

export const RECON_CURRENCIES = ['MYR', 'SGD', 'USD', 'VND', 'LKR', 'INR', 'EUR'] as const

export type SheetStatus = 'DRAFT' | 'SUBMITTED' | 'LOCKED'
export type ApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED'
export type LineSource = 'MC' | 'MANUAL'
/** AUTO = guessed by the matcher, MANUAL = picked on the page, EXCEL = named in the desk's workbook. */
export type PnlMatch = 'AUTO' | 'MANUAL' | 'EXCEL' | 'NONE'

/** The fields a desk can type over. A typed field is never overwritten by a refresh. */
export const EDITABLE_FIELDS = [
  'serviceDate', 'tourNo', 'guestName', 'pax', 'pickUp', 'dropOff', 'time', 'details', 'rateText', 'remarks',
] as const
export type EditableField = (typeof EDITABLE_FIELDS)[number]

export const NOT_INSTALLED =
  'Trans-Reconsultation is not set up on this database yet — run prisma/sql/apply-trans-recon.sh.'

export const CAN_EDIT_ROLES = ['GT_USER', 'GT_VN_USER', 'GT_TE_USER', 'TE_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN']
/** Accounts reads the sheet here too; approving it happens in the Accounts system. */
export const CAN_VIEW_ROLES = [...CAN_EDIT_ROLES, 'AC_USER']
export const canViewRecon = (role: string) => CAN_VIEW_ROLES.includes(role)
export const canEditRecon = (role: string) => CAN_EDIT_ROLES.includes(role)

// ── Period ──────────────────────────────────────────────────────────────────

export type Half = 1 | 2

export interface Period { year: number; month: number; half: Half; start: string; end: string }

const pad = (n: number) => String(n).padStart(2, '0')
const lastDay = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate()

export function periodOf(year: number, month: number, half: Half): Period {
  const end = half === 1 ? 15 : lastDay(year, month)
  return {
    year, month, half,
    start: `${year}-${pad(month)}-${half === 1 ? '01' : '16'}`,
    end:   `${year}-${pad(month)}-${pad(end)}`,
  }
}

export function periodForDate(iso: string): Period {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  return periodOf(y, m, d <= 15 ? 1 : 2)
}

const ordinal = (n: number) => {
  const s = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th'
  return `${n}${s}`
}

/** "Malaysia 16th to 30th September 2026" — the name the desk gave its workbooks. */
export function sheetTitle(country: ReconCountry, p: Period): string {
  const month = new Date(Date.UTC(p.year, p.month - 1, 1)).toLocaleString('en-GB', { month: 'long', timeZone: 'UTC' })
  const from = Number(p.start.slice(8, 10)), to = Number(p.end.slice(8, 10))
  return `${RECON_COUNTRY_META[country].label} ${ordinal(from)} to ${ordinal(to)} ${month} ${p.year}`
}

// ── Cell formats ────────────────────────────────────────────────────────────

/** "4+1+1INF" — adults, then children, then infants, the way the desk writes it. */
export function formatPax(adults: number, children: number, infants: number): string {
  let s = String(Math.max(0, adults || 0))
  if (children > 0) s += `+${children}`
  if (infants > 0) s += `+${infants}INF`
  return s
}

/** Head count for a pax cell ("4+1+1INF" → 6). */
export function paxCount(text: string | null | undefined): number | null {
  const nums = String(text ?? '').match(/\d+/g)
  return nums ? nums.reduce((s, n) => s + Number(n), 0) : null
}

/**
 * The desk types rates the way it thinks about them: "200+100", "100+58 DNR",
 * "700 + 15 placard", "1,200", and in Vietnam "1.200.000". Every number in the
 * cell is a part of the total, so the total is their sum; the text is kept as
 * typed so nobody loses the breakdown.
 */
export function parseRate(text: string | null | undefined): number | null {
  let s = String(text ?? '').trim()
  if (!s) return null
  // Thousands separators: "1,200" / "1.200.000" (but not a decimal "12.50").
  s = s.replace(/(\d),(?=\d{3}\b)/g, '$1')
  // A single dot stays a decimal point — "12.50" is twelve and a half.
  s = s.replace(/\b(\d{1,3}(?:\.\d{3}){2,})\b/g, m => m.replace(/\./g, ''))
  const nums = s.match(/\d+(?:\.\d+)?/g)
  if (!nums) return null
  const total = nums.reduce((sum, n) => sum + Number(n), 0)
  return Number.isFinite(total) ? Math.round(total * 100) / 100 : null
}

/** "07:30", "7:30 PM", "1930" → minutes after midnight, for ordering a day. */
export function timeMinutes(t: string | null | undefined): number {
  const s = String(t ?? '').trim().toUpperCase()
  const m = s.match(/(\d{1,2})[:.h]?(\d{2})?\s*(AM|PM)?/)
  if (!m) return 24 * 60 + 1
  let h = Number(m[1]); const min = Number(m[2] ?? 0)
  if (m[3] === 'PM' && h < 12) h += 12
  if (m[3] === 'AM' && h === 12) h = 0
  return h > 23 ? 24 * 60 + 1 : h * 60 + min
}

// ── Lines and the arithmetic ────────────────────────────────────────────────

export interface ReconLine {
  id: string
  position: number
  source: LineSource
  agendaItemId: string | null
  bookingRef: string | null
  serviceDate: string
  tourNo: string | null
  guestName: string | null
  pax: string | null
  pickUp: string | null
  dropOff: string | null
  time: string | null
  details: string | null
  mcDescription: string | null
  serviceType: string | null
  vendorName: string | null
  mcDriverRate: number | null
  mcRateCurrency: string | null
  pnlLineItemId: string | null
  pnlDescription: string | null
  pnlCategory: string | null
  pnlValue: number | null
  pnlCurrency: string | null
  pnlMatch: PnlMatch
  pnlScore: number | null
  rateText: string | null
  rate: number | null
  remarks: string | null
  editedFields: string[]
  bookingCancelled: boolean
  mcMissing: boolean
  isRemoved: boolean
  approvalStatus: ApprovalStatus
  approvalNote: string | null
  approvedRate: number | null
  approvedByName: string | null
  approvedAt: string | null
  importedFrom: string | null
  importRow: number | null
  updatedByName: string | null
  updatedAt: string | null
  /**
   * Who drives it and which Accounts supplier (Suppliers Manage) is paid for
   * it — kept in trans_recon_line_parties, so absent on a database where that
   * table has not been created yet. Filled from the MC Report on a refresh
   * unless set on the sheet (driverEdited / supplierEdited).
   */
  driverName?: string | null
  supplierSource?: ReconSupplierSource | null
  supplierId?: number | null
  supplierName?: string | null
  supplierCountry?: string | null
  driverEdited?: boolean
  supplierEdited?: boolean
}

/** Same names as the Accounts system's payable_supplier_links.supplier_source. */
export type ReconSupplierSource = 'supplier_bank' | 'driver'

export interface ReconSheet {
  id: string
  country: ReconCountry
  periodYear: number
  periodMonth: number
  half: Half
  periodStart: string
  periodEnd: string
  title: string
  currency: string
  fxRates: Record<string, number>
  status: SheetStatus
  note: string | null
  accountsNote: string | null
  createdByName: string | null
  submittedAt: string | null
  submittedByName: string | null
  lockedAt: string | null
  lockedByName: string | null
  lastSyncedAt: string | null
  lastImportAt: string | null
  lastImportFile: string | null
  lastImportBy: string | null
  updatedByName: string | null
  updatedAt: string | null
}

export interface LineFigures {
  /** The P&L value converted into the sheet currency (null when no FX for it). */
  pnlConverted: number | null
  /** This line's part of its P&L line, when several movements share one. */
  pnlShare: number | null
  /** How many live lines point at the same P&L line. */
  sharedBy: number
  /** Rate − P&L share. Positive means the sheet pays more than the P&L allowed. */
  difference: number | null
  /** Why there is no difference to show. */
  gap: 'NO_RATE' | 'NO_PNL' | 'NO_FX' | null
}

export interface SheetTotals {
  lines: number
  rated: number
  matched: number
  totalRate: number
  totalPnl: number
  /** Rate on lines that have a P&L line to compare with. */
  matchedRate: number
  difference: number
  unmatchedRate: number
  over: number
  under: number
  approved: number
  rejected: number
  pending: number
  approvedRate: number
  cancelled: number
  removed: number
}

const round2 = (n: number) => Math.round(n * 100) / 100

export function fxFor(fxRates: Record<string, number>, from: string | null, to: string): number | null {
  const f = String(from ?? '').toUpperCase()
  if (!f || f === to.toUpperCase()) return 1
  const r = Number(fxRates?.[f])
  return Number.isFinite(r) && r > 0 ? r : null
}

/** A line counts towards the sheet when it is neither struck off nor on a cancelled file. */
export const isLive = (l: Pick<ReconLine, 'isRemoved' | 'bookingCancelled'>) => !l.isRemoved && !l.bookingCancelled

/**
 * Per-line figures and sheet totals.
 *
 * A P&L usually prices transport once for several movements ("Private
 * transfers as per itinerary"), so comparing every movement with the whole P&L
 * line would report the same overspend five times. Lines that share a P&L line
 * split its value — in proportion to their rates when every one of them is
 * rated, equally otherwise — so the differences of a group add up to the
 * group's real difference and the sheet total is never double counted.
 */
export function computeSheet(lines: ReconLine[], currency: string, fxRates: Record<string, number>) {
  const live = lines.filter(isLive)
  const groups = new Map<string, ReconLine[]>()
  for (const l of live) {
    if (!l.pnlLineItemId || l.pnlValue == null) continue
    const g = groups.get(l.pnlLineItemId); if (g) g.push(l); else groups.set(l.pnlLineItemId, [l])
  }

  const figures = new Map<string, LineFigures>()
  for (const l of lines) {
    const fx = l.pnlValue != null ? fxFor(fxRates, l.pnlCurrency, currency) : null
    const pnlConverted = l.pnlValue != null && fx != null ? round2(l.pnlValue * fx) : null
    const group = l.pnlLineItemId ? groups.get(l.pnlLineItemId) : undefined
    let pnlShare: number | null = pnlConverted
    const sharedBy = group && isLive(l) ? group.length : 1
    if (pnlConverted != null && group && group.length > 1 && isLive(l)) {
      const allRated = group.every(g => g.rate != null && g.rate > 0)
      const sum = group.reduce((s, g) => s + (g.rate ?? 0), 0)
      pnlShare = allRated && sum > 0 ? round2(pnlConverted * (l.rate! / sum)) : round2(pnlConverted / group.length)
    }
    const gap: LineFigures['gap'] = l.rate == null ? 'NO_RATE'
      : l.pnlValue == null ? 'NO_PNL'
      : pnlConverted == null ? 'NO_FX' : null
    figures.set(l.id, {
      pnlConverted, pnlShare, sharedBy,
      difference: gap ? null : round2(l.rate! - (pnlShare ?? 0)),
      gap,
    })
  }

  const t: SheetTotals = {
    lines: live.length, rated: 0, matched: 0, totalRate: 0, totalPnl: 0, matchedRate: 0, difference: 0,
    unmatchedRate: 0, over: 0, under: 0, approved: 0, rejected: 0, pending: 0, approvedRate: 0,
    cancelled: lines.filter(l => !l.isRemoved && l.bookingCancelled).length,
    removed: lines.filter(l => l.isRemoved).length,
  }
  const countedGroups = new Set<string>()
  for (const l of live) {
    const f = figures.get(l.id)!
    if (l.rate != null) { t.rated++; t.totalRate += l.rate }
    if (l.pnlValue != null) t.matched++
    if (f.pnlConverted != null) {
      const key = l.pnlLineItemId ?? `line:${l.id}`
      if (!countedGroups.has(key)) { countedGroups.add(key); t.totalPnl += f.pnlConverted }
    }
    if (f.difference != null) {
      t.matchedRate += l.rate!
      t.difference += f.difference
      if (f.difference > 0.005) t.over++
      else if (f.difference < -0.005) t.under++
    } else if (l.rate != null) {
      t.unmatchedRate += l.rate
    }
    if (l.approvalStatus === 'APPROVED') { t.approved++; t.approvedRate += l.approvedRate ?? l.rate ?? 0 }
    else if (l.approvalStatus === 'REJECTED') t.rejected++
    else t.pending++
  }
  for (const k of ['totalRate', 'totalPnl', 'matchedRate', 'difference', 'unmatchedRate', 'approvedRate'] as const) t[k] = round2(t[k])
  return { figures, totals: t }
}

// ── Report breakdowns ───────────────────────────────────────────────────────

export interface Breakdown {
  key: string
  label: string
  sub: string | null
  lines: number
  rate: number
  pnl: number
  difference: number
  unmatched: number
  approved: number
  rejected: number
  pending: number
}

/**
 * Live lines grouped by `keyOf`. P&L is summed once per P&L line inside a
 * group, the same rule computeSheet uses for the sheet total.
 */
export function breakdown(
  lines: ReconLine[], figures: Map<string, LineFigures>,
  keyOf: (l: ReconLine) => { key: string; label: string; sub?: string | null },
): Breakdown[] {
  const out = new Map<string, Breakdown>()
  for (const l of lines.filter(isLive)) {
    const k = keyOf(l)
    let b = out.get(k.key)
    if (!b) {
      b = { key: k.key, label: k.label, sub: k.sub ?? null, lines: 0, rate: 0, pnl: 0, difference: 0, unmatched: 0, approved: 0, rejected: 0, pending: 0 }
      out.set(k.key, b)
    }
    const f = figures.get(l.id)
    b.lines++
    b.rate += l.rate ?? 0
    // The share, not the whole P&L line: a line shared by three movements is
    // counted once across them, whichever group each lands in.
    if (f?.pnlShare != null) b.pnl += f.pnlShare
    if (f?.difference != null) b.difference += f.difference
    else if (l.rate != null) b.unmatched += l.rate
    if (l.approvalStatus === 'APPROVED') b.approved++
    else if (l.approvalStatus === 'REJECTED') b.rejected++
    else b.pending++
  }
  return Array.from(out.values()).map(b => ({
    ...b, rate: round2(b.rate), pnl: round2(b.pnl), difference: round2(b.difference), unmatched: round2(b.unmatched),
  }))
}

export const byBooking = (l: ReconLine) => ({ key: l.tourNo || l.bookingRef || '—', label: l.tourNo || l.bookingRef || '—', sub: l.guestName })
export const byVendor = (l: ReconLine) => ({ key: (l.vendorName || 'Not assigned').toLowerCase(), label: l.vendorName || 'Not assigned' })
export const byDay = (l: ReconLine) => ({ key: l.serviceDate, label: l.serviceDate })
export const bySupplier = (l: ReconLine) => l.supplierId != null && l.supplierSource
  ? { key: `${l.supplierSource}:${l.supplierId}`, label: l.supplierName || `Supplier #${l.supplierId}`, sub: l.supplierSource === 'driver' ? 'driver payee' : null }
  : { key: 'none', label: 'No supplier picked', sub: null }

/** Default order on screen and in the export: day, then time, then tour. */
export function sortLines<T extends Pick<ReconLine, 'serviceDate' | 'time' | 'tourNo' | 'position'>>(lines: T[]): T[] {
  return [...lines].sort((a, b) =>
    a.serviceDate.localeCompare(b.serviceDate)
    || timeMinutes(a.time) - timeMinutes(b.time)
    || String(a.tourNo ?? '').localeCompare(String(b.tourNo ?? ''))
    || a.position - b.position)
}

export function fmtMoney(n: number | null | undefined, currency?: string, dp?: number): string {
  if (n == null || !Number.isFinite(n)) return '—'
  const digits = dp ?? (currency === 'VND' || currency === 'LKR' ? 0 : 2)
  const s = n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })
  return currency ? `${s} ${currency}` : s
}
