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

/** The `system_settings` key. One JSON value, so one save moves every rule. */
export const FLIGHT_PICKUP_KEY = 'flight_pickup_rules'

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
}

export const DEPARTURE_MIN_RANGE = { min: 30, max: 480 } as const
export const ARRIVAL_MIN_RANGE = { min: 0, max: 180 } as const
export const ROUND_STEPS = [0, 5, 15, 30] as const

function clampInt(v: unknown, lo: number, hi: number, fallback: number): number {
  const n = Math.round(Number(v))
  if (!Number.isFinite(n)) return fallback
  return Math.min(hi, Math.max(lo, n))
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
