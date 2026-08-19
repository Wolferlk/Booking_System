/**
 * Road routing — the line a car or coach actually drives between two stops.
 *
 * The journey map used to draw every leg as a bowed arc. An arc is honest about
 * *which* two places a movement connects and dishonest about everything else:
 * it crosses reservoirs, cuts through the middle of a national park, and makes
 * a four-hour mountain transfer look like a short hop. An operator reading a
 * file wants the road — where the coach actually goes, how long it is, and
 * roughly how long it takes.
 *
 * The engine is a public OSRM instance: free, no key, no account, same bargain
 * as the Nominatim geocoder this module sits next to. Set `OSRM_URL` to point
 * at a self-hosted one.
 *
 * Three rules, all of them about never becoming a dependency:
 *   • Never throws. A routing outage falls the leg back to its arc.
 *   • Never blocks the panel. The whole batch runs under one deadline, and
 *     legs that miss it simply stay arcs.
 *   • Geometry is returned as an OSRM-encoded polyline string, not as an
 *     array of points — a 300 km leg is a few hundred bytes rather than tens
 *     of kilobytes on every payload.
 */

const OSRM = (process.env.OSRM_URL || 'https://router.project-osrm.org').replace(/\/+$/, '')

export interface RoadLeg {
  /** Encoded polyline, precision 5 — decode on the client. */
  geometry: string
  /** Driving distance in km, rounded. */
  km: number
  /** Driving time in minutes, rounded. Free-flow: OSRM knows no traffic. */
  minutes: number
}

export type LatLng = { lat: number; lng: number }

/**
 * Process-wide cache of routed legs.
 *
 * Coordinates are rounded to ~11 m before they become a key: the same hotel
 * resolved twice can differ in the fifth decimal, and re-routing Colombo →
 * Sigiriya for a difference no map can draw is a wasted second.
 */
const cache = new Map<string, RoadLeg | null>()

function key(a: LatLng, b: LatLng): string {
  const r = (n: number) => n.toFixed(4)
  return `${r(a.lat)},${r(a.lng)}>${r(b.lat)},${r(b.lng)}`
}

/**
 * One leg, driving profile. Returns null when there is no road between the two
 * points — an island hop, a cross-water leg, or an engine that is simply down.
 */
export async function roadLeg(a: LatLng, b: LatLng, timeoutMs = 5000): Promise<RoadLeg | null> {
  const k = key(a, b)
  if (cache.has(k)) return cache.get(k)!

  try {
    // `simplified` is the right overview for a map drawn at country zoom: full
    // geometry resolves every kerb of a roundabout nobody will ever see.
    const url = `${OSRM}/route/v1/driving/${a.lng},${a.lat};${b.lng},${b.lat}` +
      '?overview=simplified&geometries=polyline&alternatives=false&steps=false'
    const res = await fetch(url, {
      headers: { 'User-Agent': 'AppleHolidays-Ops/1.0 (+https://aahaas.com)' },
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!res.ok) { cache.set(k, null); return null }
    const j = await res.json()
    const r = Array.isArray(j?.routes) ? j.routes[0] : null
    const geometry = typeof r?.geometry === 'string' ? r.geometry : ''
    const km = Number(r?.distance)
    const sec = Number(r?.duration)
    if (!geometry || !Number.isFinite(km) || !Number.isFinite(sec)) { cache.set(k, null); return null }

    const out: RoadLeg = {
      geometry,
      km: Math.round(km / 1000),
      minutes: Math.round(sec / 60),
    }
    cache.set(k, out)
    return out
  } catch {
    cache.set(k, null)
    return null
  }
}

/**
 * Routes many legs under one wall-clock deadline.
 *
 * Concurrency is capped because the public engine is a shared courtesy, and the
 * deadline is what keeps a slow engine from turning a twenty-stop file into a
 * twenty-second page load: whatever has not come back in time resolves to null
 * and draws as an arc, which is exactly what the map did before this existed.
 * Cached legs are answered without touching the network, so the deadline
 * effectively only ever applies to a cold file.
 */
export async function roadLegs(
  pairs: ({ from: LatLng; to: LatLng } | null)[],
  { concurrency = 4, deadlineMs = 12_000 } = {},
): Promise<(RoadLeg | null)[]> {
  const out: (RoadLeg | null)[] = new Array(pairs.length).fill(null)
  const expiry = Date.now() + deadlineMs
  let next = 0

  const worker = async () => {
    for (;;) {
      const i = next++
      if (i >= pairs.length) return
      const p = pairs[i]
      if (!p) continue
      const left = expiry - Date.now()
      // A cached leg is free, so it is still worth asking for after the
      // deadline has passed — only the network call is given up on.
      if (left <= 0) {
        const k = key(p.from, p.to)
        out[i] = cache.get(k) ?? null
        continue
      }
      out[i] = await roadLeg(p.from, p.to, Math.min(5000, left))
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, pairs.length) }, worker))
  return out
}
