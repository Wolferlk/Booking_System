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

/**
 * Structured, machine-readable breakdown parsed out of a PNL item's
 * `item_details` JSON. Every field is optional because the accounts DB emits
 * different shapes per line type (entrance ticket, KM travel, per-night, flat
 * transfer, …). Persisted verbatim inside the saved snapshot so the UI can keep
 * offering rich display + KM editing without re-reading the PNL.
 */
export interface LineDetailMeta {
  remarks?: string
  calculation_type?: string        // 'RATE' | 'TRANSFER' | 'PACKAGE' | …
  unit_type?: string               // 'KM' | 'NIGHT' | …
  // KM × rate (travel / fuel mileage)
  km?: number                      // resolved distance (from distance_days when unit is KM)
  rate?: number
  distance_days?: number
  // per-night (driver accommodation / hotels)
  nights?: number
  // adult/child ticket breakdown (entrance / lunch)
  adult_count?: number
  child_count?: number
  adult_rate?: number
  child_rate?: number
  adult_entrance?: number
  child_entrance?: number
  pax?: number
  day?: number
  // flat transfer
  transfer_amount?: number
  package?: string
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
  /** Parsed structured breakdown of `detail` — powers rich display + KM editing. */
  meta?: LineDetailMeta
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

/**
 * Robustly unwrap an `item_details` value into a plain object. The accounts DB
 * frequently double-encodes this field (a JSON string *inside* a JSON string),
 * which is why the naïve parser used to leak raw `"{\"remarks\":…}"` blobs onto
 * the sheet. Handles: already-object, single-encoded string, double-encoded
 * string. Returns null when the value isn't a JSON object.
 */
export function parseDetailObject(d: unknown): Record<string, unknown> | null {
  if (d == null) return null
  if (typeof d === 'object' && !Array.isArray(d)) return d as Record<string, unknown>
  if (typeof d !== 'string') return null
  let parsed: unknown = d.trim()
  if (!parsed) return null
  for (let i = 0; i < 2 && typeof parsed === 'string'; i++) {
    try { parsed = JSON.parse(parsed) } catch { return null }
  }
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : null
}

function numOrUndef(v: unknown): number | undefined {
  if (v == null || v === '') return undefined
  const n = typeof v === 'number' ? v : parseFloat(String(v))
  return Number.isFinite(n) ? n : undefined
}

/** Extract a structured {@link LineDetailMeta} from a PNL item's details field. */
export function extractDetailMeta(d: unknown): LineDetailMeta {
  const o = parseDetailObject(d)
  if (!o) {
    // Not JSON — keep any plain string as free-text remarks.
    const raw = typeof d === 'string' ? d.trim() : ''
    return raw ? { remarks: raw } : {}
  }

  const remarksRaw = o.remarks ?? o.remark ?? o.note ?? o.details
  const unit_type  = typeof o.unit_type === 'string' ? o.unit_type : undefined
  const distance_days = numOrUndef(o.distance_days)
  const rate       = numOrUndef(o.rate)
  const isKm       = (unit_type ?? '').toUpperCase() === 'KM'

  const meta: LineDetailMeta = {
    remarks:          typeof remarksRaw === 'string' && remarksRaw.trim() ? remarksRaw.trim() : undefined,
    calculation_type: typeof o.calculation_type === 'string' ? o.calculation_type : undefined,
    unit_type,
    distance_days,
    rate,
    km:               isKm ? distance_days : undefined,
    nights:           numOrUndef(o.nights),
    adult_count:      numOrUndef(o.adult_count),
    child_count:      numOrUndef(o.child_count),
    adult_rate:       numOrUndef(o.adult_rate),
    child_rate:       numOrUndef(o.child_rate),
    adult_entrance:   numOrUndef(o.adult_entrance),
    child_entrance:   numOrUndef(o.child_entrance),
    pax:              numOrUndef(o.pax),
    day:              numOrUndef(o.day),
    transfer_amount:  numOrUndef(o.transfer_amount),
    package:          typeof o.Package === 'string' ? o.Package
                      : typeof o.package === 'string' ? o.package : undefined,
  }

  // Strip undefined keys so persisted snapshots stay lean.
  ;(Object.keys(meta) as (keyof LineDetailMeta)[]).forEach(k => {
    if (meta[k] === undefined) delete meta[k]
  })
  return meta
}

/** True when a line carries an editable KM × rate breakdown. */
export function hasKmRate(meta: LineDetailMeta | undefined): meta is LineDetailMeta & { km: number; rate: number } {
  return !!meta && meta.km != null && meta.rate != null
}

function fmtNum(n: number, max = 2): string {
  return n.toLocaleString('en-US', { maximumFractionDigits: max })
}

/**
 * Human-readable one-line summary of a structured detail. Prefers the explicit
 * numeric breakdown (KM × rate, per-night, adult/child) over the free-text
 * remarks so the sheet reads cleanly instead of dumping raw JSON.
 */
export function formatDetailMeta(meta: LineDetailMeta | undefined): string {
  if (!meta) return ''

  if (hasKmRate(meta)) {
    return `${fmtNum(meta.km)} KM × ${fmtNum(meta.rate, 4)} / KM`
  }
  if (meta.nights != null && meta.nights > 0) {
    return `${fmtNum(meta.nights)} night${meta.nights === 1 ? '' : 's'}`
  }
  if (meta.adult_count != null || meta.child_count != null) {
    const parts: string[] = []
    if (meta.adult_count) parts.push(`Adult ${fmtNum(meta.adult_count)}${meta.adult_rate != null ? ` × ${fmtNum(meta.adult_rate)}` : ''}`)
    if (meta.child_count) parts.push(`Child ${fmtNum(meta.child_count)}${meta.child_rate != null ? ` × ${fmtNum(meta.child_rate)}` : ''}`)
    if (parts.length) return parts.join(' + ')
  }
  if (meta.transfer_amount != null && meta.transfer_amount > 0) {
    return `Transfer ${fmtNum(meta.transfer_amount)}`
  }
  return meta.remarks ?? ''
}

/** Best-effort readable detail string from the item_details JSON/string field. */
export function pnlItemDetail(item: PnlItemLike): string {
  const meta = extractDetailMeta(item.item_details)
  return formatDetailMeta(meta) || meta.remarks || ''
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
 *  "Travel - 800 KM (0.2364 per KM)". Returns nulls when not parseable. Kept as
 *  a fallback for legacy snapshot lines that predate structured `meta`. */
export function parseTravelDetail(detail: string): { km: number | null; rate: number | null } {
  const kmMatch   = detail.match(/([\d,]+(?:\.\d+)?)\s*km/i)
  const rateMatch = detail.match(/([\d,]+(?:\.\d+)?)\s*per\s*km/i)
  const km   = kmMatch   ? num(kmMatch[1].replace(/,/g, ''))   : null
  const rate = rateMatch ? num(rateMatch[1].replace(/,/g, '')) : null
  return { km, rate }
}

/** Best-effort KM×rate meta for a line, preferring structured `meta`, else
 *  parsing the legacy free-text detail. Returns null when not a KM line. */
export function resolveKmRate(line: Pick<DriverLogLine, 'detail' | 'meta'>): { km: number; rate: number } | null {
  if (hasKmRate(line.meta)) return { km: line.meta.km, rate: line.meta.rate }
  const parsed = parseTravelDetail(line.detail ?? '')
  if (parsed.km != null && parsed.rate != null) return { km: parsed.km, rate: parsed.rate }
  return null
}

/**
 * Apply an edited KM count (and optionally rate) to a travel line: recomputes
 * the amount (km × rate) and refreshes both the structured meta and the
 * human-readable detail string so display, PDF and totals all stay consistent.
 */
export function applyKmEdit(line: DriverLogLine, km: number, rate?: number): DriverLogLine {
  const current = resolveKmRate(line)
  const r = rate != null ? rate : (current?.rate ?? 0)
  const k = Number.isFinite(km) ? km : 0
  const amount = round2(k * r)
  const meta: LineDetailMeta = {
    ...(line.meta ?? {}),
    unit_type: line.meta?.unit_type ?? 'KM',
    km: k,
    distance_days: k,
    rate: r,
    remarks: `Travel - ${fmtNum(k)} KM (${fmtNum(r, 4)} per KM)`,
  }
  return { ...line, amount, meta, detail: formatDetailMeta(meta) }
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
    const meta     = extractDetailMeta(item.item_details)
    return {
      id:       String(item.id ?? `pnl-${i}`),
      category,
      label:    name,
      detail:   formatDetailMeta(meta) || meta.remarks || '',
      amount:   round2(num(item.amount_original)),
      source:   'pnl' as const,
      meta:     Object.keys(meta).length ? meta : undefined,
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
