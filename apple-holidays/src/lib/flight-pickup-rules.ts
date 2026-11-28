/**
 * Airport pickup timing rules — how far before a departure the hotel pickup
 * is, and how long after a landing the arrivals meeting is.
 *
 * These used to be a hard-coded "3 hours" in agenda-flight-link.ts. The desk
 * wanted to change them without a deploy (an early-season airport queue, a
 * domestic hop that does not need three hours), so they now live in one
 * `system_settings` row, edited on Settings → Airport Pickup Timings, and every
 * reader — the agenda editor, the PDF, the Word file, AI generation — reads the
 * same row.
 *
 * Pure: no prisma import, so the client-side agenda page can use it too.
 */

import { airport, airportByName } from './ops-geo'

/** The `system_settings` key. One JSON value, so one save moves every rule. */
export const FLIGHT_PICKUP_KEY = 'flight_pickup_rules'

/** Which flights at that airport an exception covers. */
export type AirportRuleScope = 'all' | 'domestic' | 'international'

/**
 * A city / airport with its own timing — Phu Quoc is a small field where an
 * hour is plenty, SGN international needs more than the general rule. Matched
 * against the flight's airport (and the row's airport text as a fallback), so
 * "PQC", "pqc airport", "Phu Quoc International Airport" all hit the same row.
 */
export interface AirportPickupOverride {
  /** Stable id for the settings list. */
  id: string
  /** IATA code ("PQC"), or '' when the place was typed by name only. */
  code: string
  /** City the airport serves ("Phu Quoc"), or the typed name for an unknown place. */
  city: string
  scope: AirportRuleScope
  /** Minutes before take-off the hotel pickup is. Null = use the general rule. */
  departureMin: number | null
  /** Minutes after landing the guests meet the driver. Null = use the general rule. */
  arrivalMin: number | null
}

export interface FlightPickupRules {
  /** Minutes before an international departure the hotel pickup is. */
  departureIntlMin: number
  /** Minutes before a domestic departure the hotel pickup is. */
  departureDomesticMin: number
  /** Minutes after an international landing the guests meet the driver. */
  arrivalIntlMin: number
  /** Minutes after a domestic landing the guests meet the driver. */
  arrivalDomesticMin: number
  /**
   * Snap suggested times to a clean clock step (0 = exact). Departure pickups
   * round *earlier* and arrival meetings round *later*, so rounding can only
   * ever add slack, never take it away.
   */
  roundToMin: number
  /**
   * When flight details are added or corrected after the chart was built, fill
   * the airport rows whose meeting time is still EMPTY from these rules (see
   * lib/agenda-flight-time-sync.ts). A time someone typed is never touched.
   */
  autoFillBlank: boolean
  /**
   * Also move a time that this auto-fill wrote itself when the flight changes
   * again, as long as nobody has edited it since. Off by default: the desk asked
   * for empty times only.
   */
  retimeAutoFilled: boolean
  /**
   * City / airport exceptions. Checked before the international / domestic
   * figures above; a scoped exception (domestic only, international only) wins
   * over an all-flights one for the same airport.
   */
  airportOverrides: AirportPickupOverride[]
}

/**
 * The shipped defaults — the numbers the desk already worked to
 * (Generating_Agenda_conditions.md): three hours before any departure,
 * 45 minutes after an international landing, 30 after a domestic one.
 */
export const DEFAULT_FLIGHT_PICKUP_RULES: FlightPickupRules = {
  departureIntlMin: 180,
  departureDomesticMin: 180,
  arrivalIntlMin: 45,
  arrivalDomesticMin: 30,
  roundToMin: 0,
  autoFillBlank: true,
  retimeAutoFilled: false,
  airportOverrides: [],
}

export const DEPARTURE_MIN_RANGE = { min: 30, max: 480 } as const
export const ARRIVAL_MIN_RANGE = { min: 0, max: 180 } as const
export const ROUND_STEPS = [0, 5, 15, 30] as const
/** Plenty for every airport we fly through; stops a runaway list bloating the JSON row. */
export const MAX_AIRPORT_OVERRIDES = 60

function clampInt(v: unknown, lo: number, hi: number, fallback: number): number {
  const n = Math.round(Number(v))
  if (!Number.isFinite(n)) return fallback
  return Math.min(hi, Math.max(lo, n))
}

function clampOrNull(v: unknown, lo: number, hi: number): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = Math.round(Number(v))
  if (!Number.isFinite(n)) return null
  return Math.min(hi, Math.max(lo, n))
}

const SCOPES: AirportRuleScope[] = ['all', 'domestic', 'international']

/** Lower-case words only — the one normaliser for every name match below. */
const norm = (s: string | null | undefined) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

/** Airport words that never identify *which* airport. */
const AIRPORT_NOISE = /\b(international|intl|airport|airfield|aerodrome|apt|terminal|domestic)\b/gi

/** "phu  quoc" → "Phu Quoc". Codes stay upper-case. */
function titleCase(s: string): string {
  return s.replace(/\s+/g, ' ').trim().replace(/\b([a-z])([a-z]*)/gi, (_, a: string, b: string) => a.toUpperCase() + b.toLowerCase())
}

/** One key per airport + scope, so the same airport cannot be listed twice for the same flights. */
export function overrideKey(o: Pick<AirportPickupOverride, 'code' | 'city' | 'scope'>): string {
  return `${o.code || norm(o.city)}|${o.scope}`
}

function parseOverrides(v: unknown): AirportPickupOverride[] {
  if (!Array.isArray(v)) return []
  const out: AirportPickupOverride[] = []
  const seen = new Set<string>()
  for (const raw of v) {
    if (!raw || typeof raw !== 'object') continue
    const r = raw as Record<string, unknown>
    const code = /^[A-Za-z]{3}$/.test(String(r.code ?? '').trim()) ? String(r.code).trim().toUpperCase() : ''
    const city = String(r.city ?? '').replace(/\s+/g, ' ').trim().slice(0, 60)
    if (!code && norm(city).length < 2) continue
    const scope = SCOPES.includes(r.scope as AirportRuleScope) ? (r.scope as AirportRuleScope) : 'all'
    const o: AirportPickupOverride = {
      id: String(r.id ?? '').slice(0, 40) || `${code || norm(city).replace(/ /g, '-')}-${scope}`,
      code,
      city,
      scope,
      departureMin: clampOrNull(r.departureMin, DEPARTURE_MIN_RANGE.min, DEPARTURE_MIN_RANGE.max),
      arrivalMin: clampOrNull(r.arrivalMin, ARRIVAL_MIN_RANGE.min, ARRIVAL_MIN_RANGE.max),
    }
    const key = overrideKey(o)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(o)
    if (out.length >= MAX_AIRPORT_OVERRIDES) break
  }
  return out
}

/** "PQC Airport", or "Mui Ne Airport" for a place typed by name only. */
export function overrideLabel(o: Pick<AirportPickupOverride, 'code' | 'city'>): string {
  return `${o.code || o.city} Airport`
}

export interface ResolvedAirportInput {
  code: string
  city: string
  country: string | null
  /** True when the airport is in the gazetteer (ops-geo). */
  known: boolean
}

/**
 * Turn whatever the desk typed into an airport: "pqc", "PQC Airport",
 * "sgn airport", "Phu Quoc", "noi bai", "Hue". Case, spacing and airport words
 * do not matter. A 3-letter code the gazetteer does not know is kept as a code;
 * anything else unknown is kept as a name and matched by name.
 */
export function resolveAirportInput(text: string | null | undefined): ResolvedAirportInput | null {
  const raw = String(text ?? '').replace(/\s+/g, ' ').trim()
  if (!raw) return null
  const bare = raw.replace(AIRPORT_NOISE, ' ').replace(/[^A-Za-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()
  if (!bare) return null
  const fromRef = (ref: { iata: string; city: string; country: string }): ResolvedAirportInput =>
    ({ code: ref.iata, city: ref.city, country: ref.country, known: true })

  // A known code on its own: "pqc", "PQC Airport".
  if (/^[a-z]{3}$/i.test(bare) && airport(bare)) return fromRef(airport(bare)!)
  // A code written next to a name: "Phu Quoc (PQC)".
  const tagged = raw.match(/\b([A-Z]{3})\b/g)?.map(c => airport(c)).find(Boolean)
  if (tagged) return fromRef(tagged)
  // A proper name or a city: "noi bai", "Phu Quoc", "Hue".
  const named = airportByName(raw) ?? airportByName(`${bare} airport`)
  if (named) return fromRef(named)
  // An airport we do not carry, typed as a code: "BMV".
  if (/^[a-z]{3}$/i.test(bare)) return { code: bare.toUpperCase(), city: '', country: null, known: false }
  return { code: '', city: titleCase(bare), country: null, known: false }
}

/**
 * Does this airport text name the exception's airport? Text is a flight's
 * airport column ("PQC", "Phu Quoc Intl") or a row's airport point
 * ("Phu Quoc Airport"). Codes match only as whole tokens written in capitals
 * (or as the whole text), so "Tan Son Nhat" never hits a "SON" code.
 */
export function overrideMatches(o: Pick<AirportPickupOverride, 'code' | 'city'>, text: string | null | undefined): boolean {
  const t = String(text ?? '').trim()
  if (!t) return false
  if (o.code) {
    if (t.toUpperCase() === o.code) return true
    if (new RegExp(`(^|[^A-Za-z])${o.code}([^A-Za-z]|$)`).test(t)) return true
    if (airportByName(t)?.iata === o.code) return true
  }
  const city = norm(o.city)
  if (city.length >= 3 && ` ${norm(t)} `.includes(` ${city} `)) return true
  return false
}

export interface AirportOverrideHit {
  override: AirportPickupOverride
  minutes: number
  label: string
}

/**
 * The exception that applies to a departure pickup or an arrival meeting, or
 * null for the general rule. `texts` are tried in order — the flight's airport
 * column first, then the row's own airport point.
 */
export function findAirportOverride(
  rules: Pick<FlightPickupRules, 'airportOverrides'>,
  role: 'departure' | 'arrival',
  international: boolean,
  texts: Array<string | null | undefined>,
): AirportOverrideHit | null {
  const list = rules.airportOverrides ?? []
  if (list.length === 0) return null
  const wanted = international ? 'international' : 'domestic'
  let fallback: AirportOverrideHit | null = null
  for (const text of texts) {
    if (!text || !String(text).trim()) continue
    for (const o of list) {
      const minutes = role === 'departure' ? o.departureMin : o.arrivalMin
      if (minutes === null || minutes === undefined) continue
      if (o.scope !== 'all' && o.scope !== wanted) continue
      if (!overrideMatches(o, text)) continue
      const hit = { override: o, minutes, label: overrideLabel(o) }
      if (o.scope === wanted) return hit
      fallback ??= hit
    }
    if (fallback) return fallback
  }
  return null
}

/**
 * The exceptions as prompt lines for AI generation ('' when there are none).
 * The generated times are re-checked through linkFlight afterwards, so this
 * only keeps the model's prose in step with the times it gets.
 */
export function airportExceptionText(rules: Pick<FlightPickupRules, 'airportOverrides'>): string {
  const lines = (rules.airportOverrides ?? [])
    .filter(o => o.departureMin !== null || o.arrivalMin !== null)
    .map(o => {
      const who = o.code && o.city ? `${o.code} (${o.city})` : (o.code || o.city)
      const scope = o.scope === 'all' ? 'all flights' : `${o.scope} flights only`
      const bits = [
        o.departureMin !== null ? `departure pickup = depTime − ${durationWords(o.departureMin)}` : '',
        o.arrivalMin !== null ? `arrival meeting = arrTime + ${durationWords(o.arrivalMin)}` : '',
      ].filter(Boolean).join('; ')
      return `    - ${who} airport, ${scope}: ${bits}`
    })
  if (lines.length === 0) return ''
  return `\n  AIRPORT EXCEPTIONS (use these instead of the figures above for that airport):\n${lines.join('\n')}`
}

/**
 * Free-typed duration → minutes: "75", "1h", "1h 15m", "1:15", "1.5h",
 * "90 min", "2 hrs 30". Null when nothing readable.
 */
export function parseDurationInput(text: string | null | undefined): number | null {
  const s = String(text ?? '').trim().toLowerCase()
  if (!s) return null
  const clock = /^(\d{1,2}):(\d{2})$/.exec(s)
  if (clock) return Number(clock[1]) * 60 + Number(clock[2])
  const hm = /^(?:(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hour|hours))?\s*(?:(\d+)\s*(?:m|min|mins|minute|minutes)?)?$/.exec(s)
  if (hm && (hm[1] || hm[2])) {
    // A bare number is minutes; a number after hours is the minutes part.
    return Math.round(Number(hm[1] ?? 0) * 60) + Number(hm[2] ?? 0)
  }
  return null
}

/** Read the rules from the stored JSON; anything missing or broken falls back to the default. */
export function parseFlightPickupRules(raw: string | null | undefined): FlightPickupRules {
  const d = DEFAULT_FLIGHT_PICKUP_RULES
  let obj: Record<string, unknown> = {}
  try {
    const parsed = raw ? JSON.parse(raw) : null
    if (parsed && typeof parsed === 'object') obj = parsed as Record<string, unknown>
  } catch { /* fall through to defaults */ }
  const round = Number(obj.roundToMin)
  return {
    departureIntlMin:     clampInt(obj.departureIntlMin,     DEPARTURE_MIN_RANGE.min, DEPARTURE_MIN_RANGE.max, d.departureIntlMin),
    departureDomesticMin: clampInt(obj.departureDomesticMin, DEPARTURE_MIN_RANGE.min, DEPARTURE_MIN_RANGE.max, d.departureDomesticMin),
    arrivalIntlMin:       clampInt(obj.arrivalIntlMin,       ARRIVAL_MIN_RANGE.min,   ARRIVAL_MIN_RANGE.max,   d.arrivalIntlMin),
    arrivalDomesticMin:   clampInt(obj.arrivalDomesticMin,   ARRIVAL_MIN_RANGE.min,   ARRIVAL_MIN_RANGE.max,   d.arrivalDomesticMin),
    roundToMin: (ROUND_STEPS as readonly number[]).includes(round) ? round : d.roundToMin,
    autoFillBlank: typeof obj.autoFillBlank === 'boolean' ? obj.autoFillBlank : d.autoFillBlank,
    retimeAutoFilled: typeof obj.retimeAutoFilled === 'boolean' ? obj.retimeAutoFilled : d.retimeAutoFilled,
    airportOverrides: parseOverrides(obj.airportOverrides),
  }
}

/** 180 → "3 hrs", 150 → "2 hrs 30 min", 45 → "45 min", 60 → "1 hr". */
export function durationLabel(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  const hrs = h === 0 ? '' : `${h} ${h === 1 ? 'hr' : 'hrs'}`
  if (!m) return hrs || '0 min'
  return hrs ? `${hrs} ${m} min` : `${m} min`
}

/** Same, spelled out for guest-facing sentences: "3 hours", "2 hours 30 minutes". */
export function durationWords(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  const hrs = h === 0 ? '' : `${h} ${h === 1 ? 'hour' : 'hours'}`
  const mins = m === 0 ? '' : `${m} ${m === 1 ? 'minute' : 'minutes'}`
  return [hrs, mins].filter(Boolean).join(' ') || '0 minutes'
}

/**
 * "HH:MM" shifted by `delta` minutes, snapped to `roundTo` in the direction
 * that adds slack. Null when the result leaves the same day — a 01:30
 * departure has no same-day pickup, and a same-day time would be a lie.
 */
export function shiftClock(
  time: string | null | undefined, delta: number, roundTo = 0,
): string | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(time ?? '').trim())
  if (!m) return null
  let total = Number(m[1]) * 60 + Number(m[2]) + delta
  if (roundTo > 0) {
    total = delta < 0
      ? Math.floor(total / roundTo) * roundTo
      : Math.ceil(total / roundTo) * roundTo
  }
  if (total < 0 || total >= 24 * 60) return null
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}
