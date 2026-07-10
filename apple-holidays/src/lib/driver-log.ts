/**
 * Driver Log (Sri Lanka) — "Driver Advance Sheet"
 *
 * Turns a booking's linked Accounts-PNL line items into two driver-facing
 * advances that the ground team hands to the driver before a tour starts:
 *
 *   • TOUR advance  = Lunch + Entrance tickets
 *   • FUEL advance  = Driver Accommodation + Travel (KM × Rate) + Water Bottles
 *
 * Bata and Guide Fee are explicitly excluded from BOTH advances (they are settled
 * separately and never advanced to the driver). Anything that is neither a tour
 * nor a fuel component (Paging, tour transfers, hotels, …) is surfaced as an
 * "other" bucket so nothing silently disappears, but it is not advanced.
 *
 * Each advance total is multiplied by a configurable percentage (set per country
 * in Settings) to get the actual cash amount advanced. Everything here is pure —
 * no DB, no I/O — so it can run on the server (API / scheduler) and be unit-reasoned.
 */

// ── Categories ──────────────────────────────────────────────────────────────

export type DriverLogCategory =
  | 'TOUR_LUNCH'
  | 'TOUR_ENTRANCE'
  | 'FUEL_ACCOMMODATION'
  | 'FUEL_TRAVEL'
  | 'FUEL_WATER'
  | 'EXCLUDED'   // Bata / Guide Fee — never advanced
  | 'OTHER'      // counted for visibility, not part of any advance

export const TOUR_CATEGORIES: DriverLogCategory[] = ['TOUR_LUNCH', 'TOUR_ENTRANCE']
export const FUEL_CATEGORIES: DriverLogCategory[] = ['FUEL_ACCOMMODATION', 'FUEL_TRAVEL', 'FUEL_WATER']

export const CATEGORY_LABEL: Record<DriverLogCategory, string> = {
  TOUR_LUNCH:         'Lunch',
  TOUR_ENTRANCE:      'Entrance Ticket',
  FUEL_ACCOMMODATION: 'Driver Accommodation',
  FUEL_TRAVEL:        'Travel (KM × Rate)',
  FUEL_WATER:         'Water Bottles',
  EXCLUDED:           'Excluded (Bata / Guide Fee)',
  OTHER:              'Other',
}

// ── Shapes ──────────────────────────────────────────────────────────────────

/** Minimal subset of an Accounts-PNL line item this module needs. Mirrors the
 *  `cachedItems` JSON stored on ExternalPnlLink (see external-pnl-panel.tsx). */
export interface PnlItemLike {
  id?: number | string | null
  type?: string | null
  credit_type?: string | null
  hotel_name?: string | null
  transport_name?: string | null
  service_name?: string | null
  currency?: string | null
  amount_original?: number | string | null
  item_details?: unknown
}

export interface DriverLogLine {
  /** Stable id — reused from the PNL item when available, else generated. */
  id: string
  category: DriverLogCategory
  label: string
  detail: string
  amount: number
  /** 'pnl' = derived from a PNL line item, 'manual' = added/edited by a user. */
  source: 'pnl' | 'manual'
}

export interface DriverLogComputation {
  currency: string
  tourPct: number
  fuelPct: number
  lines: DriverLogLine[]
  tourLines: DriverLogLine[]
  fuelLines: DriverLogLine[]
  otherLines: DriverLogLine[]
  excludedLines: DriverLogLine[]
  tourTotal: number        // Lunch + Entrance lines only
  otherTotal: number       // Other (now folded into the tour advance)
  tourAdvanceBase: number  // tourTotal + otherTotal — the base the tour % applies to
  fuelTotal: number
  tourAdvance: number
  fuelAdvance: number
  excludedTotal: number    // Bata + Guide Fee — never advanced, settled with the rest
  grandTotal: number       // tourAdvanceBase + fuelTotal
  grandAdvance: number     // tourAdvance + fuelAdvance
  restPayment: number      // grandTotal − grandAdvance + excludedTotal
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function num(v: number | string | null | undefined): number {
  if (v == null) return 0
  const n = typeof v === 'number' ? v : parseFloat(String(v))
  return Number.isFinite(n) ? n : 0
}

/** Resolve the display name of a PNL item (same precedence as the PNL panel). */
export function pnlItemName(item: PnlItemLike): string {
  return (item.hotel_name ?? item.transport_name ?? item.service_name ?? '').trim()
}

/** Best-effort readable detail string from the item_details JSON/string field. */
export function pnlItemDetail(item: PnlItemLike): string {
  const d = item.item_details
  if (d == null) return ''
  if (typeof d === 'string') {
    const raw = d.trim()
    try {
      const parsed = JSON.parse(raw)
      if (parsed && typeof parsed === 'object') {
        const o = parsed as Record<string, unknown>
        const r = o.remarks ?? o.remark ?? o.note ?? o.details
        if (typeof r === 'string' && r.trim()) return r.trim()
      }
    } catch { /* not JSON — fall through */ }
    return raw
  }
  if (typeof d === 'object') {
    const o = d as Record<string, unknown>
    const r = o.remarks ?? o.remark ?? o.note ?? o.details
    if (typeof r === 'string' && r.trim()) return r.trim()
  }
  return ''
}

// ── Classification ──────────────────────────────────────────────────────────

/**
 * Map a single PNL line item to a driver-log category. Order matters: the most
 * specific / highest-priority rules (exclusions first) win.
 */
export function classifyPnlItem(item: PnlItemLike): DriverLogCategory {
  const name = pnlItemName(item).toLowerCase()
  const type = (item.type ?? '').toLowerCase()

  // 1. Hard exclusions — never advanced to the driver.
  if (/\bbata\b/.test(name))            return 'EXCLUDED'
  if (/guide\s*fee/.test(name))         return 'EXCLUDED'

  // 2. Fuel components.
  if (/driver\s*accom/.test(name))      return 'FUEL_ACCOMMODATION'
  if (/water\s*bottle/.test(name))      return 'FUEL_WATER'
  // "Travel" line is the KM × rate fuel/mileage charge.
  if (/\btravel\b/.test(name))          return 'FUEL_TRAVEL'

  // 3. Tour components.
  if (/lunch/.test(name))               return 'TOUR_LUNCH'
  // Entrance tickets: PNL type ATTRACTION, or an explicit entrance/ticket name.
  if (type.includes('attraction') || /entrance|ticket/.test(name)) return 'TOUR_ENTRANCE'

  // 4. Everything else — visible, but not advanced.
  return 'OTHER'
}

/** Parse the KM and per-KM rate out of a Travel detail like
 *  "Travel - 800 KM (0.2364 per KM)". Returns nulls when not parseable. */
export function parseTravelDetail(detail: string): { km: number | null; rate: number | null } {
  const kmMatch   = detail.match(/([\d,]+(?:\.\d+)?)\s*km/i)
  const rateMatch = detail.match(/([\d,]+(?:\.\d+)?)\s*per\s*km/i)
  const km   = kmMatch   ? num(kmMatch[1].replace(/,/g, ''))   : null
  const rate = rateMatch ? num(rateMatch[1].replace(/,/g, '')) : null
  return { km, rate }
}

// ── Computation ─────────────────────────────────────────────────────────────

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

/**
 * The "Total Tour Package" PNL line is an aggregate of the whole package price
 * (every PNL carries one). It is never a driver-advanced cost — including it would
 * double-count against its own components — so it is dropped from the sheet entirely.
 */
export function isTotalTourPackage(item: PnlItemLike): boolean {
  return /total\s*tour\s*package/i.test(pnlItemName(item))
}

/** Build driver-log lines straight from a set of PNL items. */
export function linesFromPnlItems(items: PnlItemLike[]): DriverLogLine[] {
  return items.filter(item => !isTotalTourPackage(item)).map((item, i) => {
    const category = classifyPnlItem(item)
    const name     = pnlItemName(item) || CATEGORY_LABEL[category]
    return {
      id:       String(item.id ?? `pnl-${i}`),
      category,
      label:    name,
      detail:   pnlItemDetail(item),
      amount:   round2(num(item.amount_original)),
      source:   'pnl' as const,
    }
  })
}

/**
 * Aggregate driver-log lines into tour/fuel totals and advances.
 * `tourPct` / `fuelPct` are whole-number percentages (e.g. 50 = 50%).
 */
export function computeDriverLog(
  lines: DriverLogLine[],
  opts: { currency?: string; tourPct: number; fuelPct: number },
): DriverLogComputation {
  const tourPct = clampPct(opts.tourPct)
  const fuelPct = clampPct(opts.fuelPct)

  const tourLines     = lines.filter(l => TOUR_CATEGORIES.includes(l.category))
  const fuelLines     = lines.filter(l => FUEL_CATEGORIES.includes(l.category))
  const excludedLines = lines.filter(l => l.category === 'EXCLUDED')
  const otherLines    = lines.filter(l => l.category === 'OTHER')

  const tourTotal  = round2(tourLines.reduce((s, l) => s + num(l.amount), 0))
  const otherTotal = round2(otherLines.reduce((s, l) => s + num(l.amount), 0))
  const fuelTotal  = round2(fuelLines.reduce((s, l) => s + num(l.amount), 0))
  const excludedTotal = round2(excludedLines.reduce((s, l) => s + num(l.amount), 0))

  // "Other" is folded into the tour advance base — the tour % applies to it too.
  const tourAdvanceBase = round2(tourTotal + otherTotal)
  const tourAdvance = round2(tourAdvanceBase * (tourPct / 100))
  const fuelAdvance = round2(fuelTotal * (fuelPct / 100))

  const grandTotal   = round2(tourAdvanceBase + fuelTotal)
  const grandAdvance = round2(tourAdvance + fuelAdvance)
  // Balance left to settle after the advance, plus the never-advanced excluded items.
  const restPayment  = round2(grandTotal - grandAdvance + excludedTotal)

  return {
    currency: opts.currency ?? 'USD',
    tourPct,
    fuelPct,
    lines,
    tourLines,
    fuelLines,
    otherLines,
    excludedLines,
    tourTotal,
    otherTotal,
    tourAdvanceBase,
    fuelTotal,
    tourAdvance,
    fuelAdvance,
    excludedTotal,
    grandTotal,
    grandAdvance,
    restPayment,
  }
}

export function clampPct(v: number): number {
  if (!Number.isFinite(v)) return 0
  return Math.min(100, Math.max(0, v))
}

/** Pick a currency for the sheet — first non-empty item currency, else USD. */
export function pickCurrency(items: PnlItemLike[]): string {
  for (const it of items) {
    if (it.currency && it.currency.trim()) return it.currency.trim()
  }
  return 'USD'
}

// ── Persistence shape (stored as JSON in SystemSetting) ──────────────────────

export interface DriverLogSnapshot {
  currency: string
  tourPct: number
  fuelPct: number
  driverPhone: string | null
  lines: DriverLogLine[]
  notes: string
  autoSend: boolean
  waSentAt: string | null
  updatedBy: string | null
  updatedAt: string
}

export function settingKeyForBooking(bookingRef: string): string {
  return `driver_log_${bookingRef}`
}

// Global settings keys (percentages + master auto-send switch).
export const SETTING_TOUR_PCT        = 'driver_log_tour_advance_pct'
export const SETTING_FUEL_PCT        = 'driver_log_fuel_advance_pct'
export const SETTING_AUTO_SEND       = 'driver_log_auto_send_enabled'
export const SETTING_LAST_RUN_DATE   = 'driver_log_auto_send_last_run_date'

export const DEFAULT_TOUR_PCT = 100
export const DEFAULT_FUEL_PCT = 100
