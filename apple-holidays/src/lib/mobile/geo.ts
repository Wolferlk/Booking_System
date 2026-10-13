/**
 * Driver App — turning raw GPS breadcrumbs into "km driven".
 *
 * A phone in a moving car reports a point every few seconds, and a phone on a
 * hotel table reports the same spot wandering ±30 m. Summing raw hops counts
 * that wander as driving, so each hop is filtered:
 *
 *   * accuracy worse than MAX_ACCURACY_M   → ignored (cell-tower fix)
 *   * hop shorter than MIN_HOP_M           → ignored (parked jitter)
 *   * hop implying > MAX_SPEED_KMH         → ignored (GPS jump / teleport)
 *
 * The filter only ever drops points from the sum; every point is still stored
 * so the route can be redrawn.
 */

export const MAX_ACCURACY_M = 65
export const MIN_HOP_M = 25
export const MAX_SPEED_KMH = 180

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

/**
 * Adds a sorted batch onto a running anchor. Returns metres to add and the new
 * anchor (the last point that counted).
 */
export function accumulate(
  anchor: { lat: number; lng: number; t: number } | null,
  points: GeoPoint[],
): { addM: number; anchor: { lat: number; lng: number; t: number } | null } {
  let addM = 0
  let a = anchor
  for (const p of points) {
    if (p.accuracy != null && p.accuracy > MAX_ACCURACY_M) continue
    if (!a) { a = { lat: p.lat, lng: p.lng, t: p.t }; continue }
    const d = haversineM(a, p)
    if (d < MIN_HOP_M) continue
    const hours = Math.max((p.t - a.t) / 3_600_000, 1 / 3600)
    if (d / 1000 / hours > MAX_SPEED_KMH) continue
    addM += d
    a = { lat: p.lat, lng: p.lng, t: p.t }
  }
  return { addM, anchor: a }
}
