/**
 * MC Report — the per-country columns and the booking context shown beside a
 * movement. Browser-safe: no database in here, so the page and the API share
 * one definition of which country gets which column.
 *
 * Stored per movement in `agenda_mc_details` (see src/lib/mc-details.ts):
 *   Sri Lanka          → Package Cost, Budget KM, Actual KM
 *   Singapore/Malaysia → Budget Transfer
 *   every destination  → Special Request (movement-level)
 *
 * Read from the booking and never typed on the report:
 *   Sri Lanka          → Flight details, Vehicle Type
 *   every destination  → Meal Preference, booking-level special requests
 */

export type McFieldKey = 'packageCost' | 'budgetKm' | 'actualKm' | 'budgetTransfer' | 'specialRequest'

export type McDetails = Partial<Record<McFieldKey, number | string | null>> & {
  currency?: string | null
  updatedByName?: string | null
  updatedAt?: string | null
}

export const SPECIAL_REQUEST_MAX = 500

const SG_MY = ['SINGAPORE', 'MALAYSIA', 'SINGAPORE_MALAYSIA']

export const MC_FIELD_META: Record<McFieldKey, {
  label: string
  kind: 'money' | 'km' | 'text'
  /** null = every destination. */
  countries: string[] | null
}> = {
  packageCost:    { label: 'Package Cost',    kind: 'money', countries: ['SRILANKA'] },
  budgetKm:       { label: 'Budget KM',       kind: 'km',    countries: ['SRILANKA'] },
  actualKm:       { label: 'Actual KM',       kind: 'km',    countries: ['SRILANKA'] },
  budgetTransfer: { label: 'Budget Transfer', kind: 'money', countries: SG_MY },
  specialRequest: { label: 'Special Request', kind: 'text',  countries: null },
}

export const MC_FIELD_KEYS = Object.keys(MC_FIELD_META) as McFieldKey[]

export function isMcField(v: unknown): v is McFieldKey {
  return typeof v === 'string' && v in MC_FIELD_META
}

export function isSriLanka(country: string | null | undefined): boolean {
  return country === 'SRILANKA'
}

export function isSgMy(country: string | null | undefined): boolean {
  return !!country && SG_MY.includes(country)
}

export function mcFieldApplies(field: McFieldKey, country: string | null | undefined): boolean {
  const c = MC_FIELD_META[field].countries
  return c === null || (!!country && c.includes(country))
}

/**
 * The currency a desk figure is in. Legacy SINGAPORE_MALAYSIA files are told
 * apart by their ref prefix, the same rule the country filter uses.
 */
export function mcCurrencyFor(country: string | null | undefined, bookingRef: string): string {
  if (country === 'SRILANKA')  return 'LKR'
  if (country === 'SINGAPORE') return 'SGD'
  if (country === 'MALAYSIA')  return 'MYR'
  if (country === 'SINGAPORE_MALAYSIA') return /^MY/i.test(bookingRef) ? 'MYR' : 'SGD'
  return 'USD'
}

/** Parse a typed figure: blank → null, "1,250.5" → 1250.5, junk → NaN. */
export function parseMcNumber(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : NaN
  const s = String(raw).replace(/[,\s]/g, '').replace(/km$/i, '')
  if (!s) return null
  const n = Number(s)
  return Number.isFinite(n) ? n : NaN
}

// ── Flights ───────────────────────────────────────────────────────────────────

export type McFlight = {
  flightNo: string
  date:     string          // yyyy-mm-dd
  fromApt:  string
  toApt:    string
  depTime:  string
  arrTime:  string
  airline:  string | null
  /** ARR = into the destination, DEP = out of it, INT = internal / unknown. */
  direction: 'ARR' | 'DEP' | 'INT'
}

// Sri Lanka's international airports — how a flight on a same-day arrive/depart
// file (or a date typo) is still told apart.
const SL_AIRPORTS = /\b(CMB|HRI|BIA|colombo|katunayake|bandaranaike|mattala)\b/i

export function flightDirection(
  f: { date: string; fromApt: string; toApt: string },
  arrival: string, departure: string,
): McFlight['direction'] {
  if (SL_AIRPORTS.test(f.toApt) && !SL_AIRPORTS.test(f.fromApt)) return 'ARR'
  if (SL_AIRPORTS.test(f.fromApt) && !SL_AIRPORTS.test(f.toApt)) return 'DEP'
  if (f.date === arrival && f.date !== departure) return 'ARR'
  if (f.date === departure && f.date !== arrival) return 'DEP'
  return 'INT'
}

// ── Meal preferences ─────────────────────────────────────────────────────────

export type McMealPref = { label: string; count: number; names: string[] }

// Values that mean "no preference" — not worth a chip on every row.
const NO_PREF = /^(none|nil|no|n\/?a|normal|regular|standard|-+|—)$/i

/** "Veg ×2 · Halal ×1" — passengers grouped by their stated preference. */
export function summariseMealPrefs(passengers: { name: string; mealPreference: string | null }[]): McMealPref[] {
  const byLabel = new Map<string, McMealPref>()
  for (const p of passengers) {
    const raw = (p.mealPreference ?? '').replace(/\s+/g, ' ').trim()
    if (!raw || NO_PREF.test(raw)) continue
    const key = raw.toLowerCase()
    const e = byLabel.get(key)
    if (e) { e.count += 1; e.names.push(p.name) }
    else byLabel.set(key, { label: raw, count: 1, names: [p.name] })
  }
  return Array.from(byLabel.values()).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
}

export function mealPrefsText(prefs: McMealPref[] | null | undefined): string {
  return (prefs ?? []).map(m => `${m.label}${m.count > 1 ? ` ×${m.count}` : ''}`).join(', ')
}

// ── Booking-level special requests ───────────────────────────────────────────

export type McBookingRequest = { source: string; text: string }

export function bookingRequestsText(reqs: McBookingRequest[] | null | undefined): string {
  return (reqs ?? []).map(r => `${r.source}: ${r.text}`).join(' | ')
}
