/**
 * Driver App — turning raw GPS breadcrumbs into "km driven".
 *
 * A phone in a moving car reports a point every few seconds, and a phone on a
 * hotel table reports the same spot wandering ±30 m. Summing raw hops counts
 * that wander as driving, so each hop is filtered:
 *
 *   * accuracy worse than MAX_ACCURACY_M   → ignored (cell-tower fix)
 *   * hop shorter than MIN_HOP_M           → ignored (parked jitter)
 *   * short hop while the phone reports it is standing still → ignored
 *   * hop implying > MAX_SPEED_KMH         → ignored (GPS jump / teleport)
 *
 * The filter only ever drops points from the sum; every point is still stored
 * so the route can be redrawn.
 */

export const MAX_ACCURACY_M = 65
export const MIN_HOP_M = 25
export const MAX_SPEED_KMH = 180
/** Below this reported speed (m/s) the car is standing; hops under STILL_HOP_M are wander. */
export const STILL_SPEED_MS = 1
export const STILL_HOP_M = 100

export interface GeoPoint {
  lat: number
  lng: number
  accuracy?: number | null
  speed?: number | null
  /** epoch ms */
  t: number
}

export function haversineM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6_371_000
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)))
}

export function isValidPoint(p: GeoPoint): boolean {
  return Number.isFinite(p.lat) && Number.isFinite(p.lng)
    && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180
    && !(p.lat === 0 && p.lng === 0)
    && Number.isFinite(p.t)
}

/** An untimed anchor (the start-of-day position) counts a first hop up to this far. */
export const START_SNAP_M = 2_000

export interface Anchor { lat: number; lng: number; /** epoch ms; null = start-of-day position, time unknown */ t: number | null }

function plausible(a: { lat: number; lng: number; t: number }, b: GeoPoint): boolean {
  const hours = Math.max((b.t - a.t) / 3_600_000, 1 / 3600)
  return haversineM(a, b) / 1000 / hours <= MAX_SPEED_KMH
}

/**
 * Adds a sorted batch onto a running anchor. Returns metres to add, the new
 * anchor (the last point that counted) and `pending` — the last point that was
 * rejected as too fast.
 *
 * The speed check is against the anchor's own time, not the last ping, so a
 * GPS gap (tunnel, phone locked) is measured over the real elapsed time. And a
 * "jump" that the next point agrees with is real, not a glitch: the anchor
 * moves there, so one bad hop can never freeze the count for the rest of the day.
 */
export function accumulate(
  anchor: Anchor | null,
  points: GeoPoint[],
  pending: GeoPoint | null = null,
): { addM: number; anchor: Anchor | null; pending: GeoPoint | null } {
  let addM = 0
  let a = anchor
  let pend = pending
  for (const p of points) {
    if (p.accuracy != null && p.accuracy > MAX_ACCURACY_M) continue
    if (!a) { a = { lat: p.lat, lng: p.lng, t: p.t }; continue }
    const d = haversineM(a, p)
    if (d < MIN_HOP_M) continue
    if (p.speed != null && p.speed >= 0 && p.speed < STILL_SPEED_MS && d < STILL_HOP_M) continue
    if (a.t == null) {
      // Start position: its time is the server's, not the phone's — no speed check.
      if (d <= START_SNAP_M) addM += d
      a = { lat: p.lat, lng: p.lng, t: p.t }; pend = null
      continue
    }
    if (plausible({ lat: a.lat, lng: a.lng, t: a.t }, p)) {
      addM += d
      a = { lat: p.lat, lng: p.lng, t: p.t }; pend = null
    } else if (pend && pend.t < p.t && plausible(pend, p)) {
      const after = haversineM(pend, p)
      if (after >= MIN_HOP_M) addM += after
      a = { lat: p.lat, lng: p.lng, t: p.t }; pend = null
    } else {
      pend = p
    }
  }
  return { addM, anchor: a, pending: pend }
}
