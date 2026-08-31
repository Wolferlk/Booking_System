'use client'

/**
 * Live Ops Map — the operation as it stands right now, drawn on real geography.
 *
 * The hero's numbers say *how many*. Only a map says *where* — that the twelve
 * files on the ground are actually four in Kandy, three crossing to Ella and
 * five sitting in Colombo, and that the sector currently in the air is ninety
 * minutes from landing on top of them. That is the picture a duty manager reads
 * in one glance and cannot assemble from a list.
 *
 * Same stack and the same bargain as the booking journey map: Leaflet against
 * CARTO's OpenStreetMap raster tiles — free, keyless, no per-view billing — and
 * Leaflet itself imported inside the effect so it never reaches the server
 * bundle or the dashboard's first payload.
 *
 * Everything drawn here is derived from /api/dashboard/live-ops. This component
 * reads; it never writes.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import type { Map as LeafletMap, Layer as LeafletLayer } from 'leaflet'
import { Loader2, Layers, Maximize2, Minimize2, Locate } from 'lucide-react'
import { countryFocus } from '@/lib/ops-geo'
import { cn } from '@/lib/utils'
import 'leaflet/dist/leaflet.css'

type LeafletNS = typeof import('leaflet')

// ─── Shapes (mirror the live-ops route) ──────────────────────────────────

export interface LiveFlight {
  id: string
  flightNo: string
  airline: string | null
  bookingRef: string | null
  countryLabel: string | null
  pax: number
  cancelled: boolean
  depTime: string | null
  arrTime: string | null
  depMin: number | null
  arrMin: number | null
  direction: 'arrival' | 'departure' | 'internal' | 'other'
  phase: 'scheduled' | 'airborne' | 'landed' | 'unknown'
  from: { iata: string; city: string | null; lat: number | null; lng: number | null }
  to: { iata: string; city: string | null; lat: number | null; lng: number | null }
}

export interface LiveOnGround {
  bookingRef: string
  countryLabel: string | null
  lead: string | null
  pax: number
  dayNo: number
  totalDays: number
  arrivingToday: boolean
  departingToday: boolean
  pin: { name: string; lat: number; lng: number } | null
  leg: { from: { name: string; lat: number; lng: number }; to: { name: string; lat: number; lng: number } } | null
  movement: {
    to: string | null
    driver: string | null
    vehicleType: string | null
    vehicleKind: string
    needsDriver: boolean
    leisure: boolean
  } | null
}

interface Props {
  country: string
  onGround: LiveOnGround[]
  flights: LiveFlight[]
  /** Server clock, minutes past midnight, advanced locally between refreshes. */
  nowMinutes: number
  loading?: boolean
  className?: string
}

// ─── Arc geometry ────────────────────────────────────────────────────────

type LatLng = [number, number]

/**
 * A flight path as a curve rather than a straight line.
 *
 * Two sectors between the same pair of cities drawn as straight lines sit on top
 * of each other and read as one. Bowing each path perpendicular to its own
 * midpoint separates them, and it is also simply what a reader expects a flight
 * to look like. The bow scales with distance so a Colombo–Male hop does not
 * balloon across the Indian Ocean.
 */
function arc(a: LatLng, b: LatLng, lift = 0.18): LatLng[] {
  const [y1, x1] = a
  const [y2, x2] = b
  const mx = (x1 + x2) / 2
  const my = (y1 + y2) / 2
  const dx = x2 - x1
  const dy = y2 - y1
  const dist = Math.hypot(dx, dy)
  // Control point pushed off the midpoint, always to the same side, so parallel
  // sectors curve consistently instead of crossing each other.
  const cx = mx - dy * lift
  const cy = my + dx * lift
  const steps = Math.max(24, Math.min(72, Math.round(dist * 6)))
  const out: LatLng[] = []
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    const u = 1 - t
    out.push([
      u * u * y1 + 2 * u * t * cy + t * t * y2,
      u * u * x1 + 2 * u * t * cx + t * t * x2,
    ])
  }
  return out
}

/** The point `t` (0→1) of the way along a path, measured by segment length. */
function pointAt(path: LatLng[], t: number): LatLng {
  if (path.length === 0) return [0, 0]
  if (path.length === 1) return path[0]
  const clamped = Math.max(0, Math.min(1, t))
  const lens: number[] = []
  let total = 0
  for (let i = 1; i < path.length; i++) {
    total += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1])
    lens.push(total)
  }
  if (total === 0) return path[0]
  const target = clamped * total
  for (let i = 0; i < lens.length; i++) {
    if (lens[i] >= target) {
      const prev = i === 0 ? 0 : lens[i - 1]
      const f = lens[i] === prev ? 0 : (target - prev) / (lens[i] - prev)
      const p = path[i]
      const q = path[i + 1]
      return [p[0] + (q[0] - p[0]) * f, p[1] + (q[1] - p[1]) * f]
    }
  }
  return path[path.length - 1]
}

/** Screen bearing in degrees, for pointing an icon along its own path. */
function bearingAt(path: LatLng[], t: number): number {
  const a = pointAt(path, Math.max(0, t - 0.02))
  const b = pointAt(path, Math.min(1, t + 0.02))
  return (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI
}

const DIRECTION_HEX: Record<LiveFlight['direction'], string> = {
  arrival:   '#34d399',
  departure: '#fbbf24',
  internal:  '#a78bfa',
  other:     '#60a5fa',
}

const VEHICLE_GLYPH: Record<string, string> = {
  car: '🚗', suv: '🚙', van: '🚐', minibus: '🚌', bus: '🚌', coach: '🚍', other: '🚐',
}

// ─── Injected styles ─────────────────────────────────────────────────────
//
// Leaflet draws into its own DOM, outside React and outside Tailwind's scan, so
// the marker and path animations have to be real CSS. Scoped under .lom- so
// nothing here can reach the booking journey map or any other Leaflet instance.

const MAP_CSS = `
.lom-wrap .leaflet-container{background:#070c1a;font-family:inherit}
.lom-wrap .leaflet-control-attribution{font-size:9px;background:rgba(2,6,23,.6);color:#94a3b8;border-radius:6px 0 0 0;padding:1px 6px}
.lom-wrap .leaflet-control-attribution a{color:#cbd5e1}
.lom-wrap .leaflet-tile-pane{filter:saturate(0.85) brightness(1.05)}

@keyframes lomDash{to{stroke-dashoffset:-1000}}
.lom-air{stroke-dasharray:1 9;stroke-linecap:round;animation:lomDash 9s linear infinite}
.lom-road{stroke-dasharray:5 7;animation:lomDash 22s linear infinite}

@keyframes lomPulse{0%{transform:scale(.6);opacity:.85}70%{transform:scale(2.6);opacity:0}100%{transform:scale(2.6);opacity:0}}
.lom-pin{position:relative;display:grid;place-items:center}
.lom-pin-ring{position:absolute;inset:0;border-radius:9999px;border:2px solid currentColor;animation:lomPulse 2.8s ease-out infinite}
.lom-pin-ring.d2{animation-delay:.9s}
.lom-pin-core{position:relative;border-radius:9999px;display:grid;place-items:center;
  font-weight:800;color:#04121f;box-shadow:0 0 0 2px rgba(255,255,255,.55),0 6px 18px rgba(0,0,0,.45)}

.lom-plane{display:grid;place-items:center;filter:drop-shadow(0 0 6px rgba(255,255,255,.55))}
@keyframes lomBob{0%,100%{transform:translateY(0)}50%{transform:translateY(-2px)}}
.lom-plane svg{animation:lomBob 2.4s ease-in-out infinite}

.lom-apt{width:8px;height:8px;border-radius:9999px;background:#0ea5e9;box-shadow:0 0 0 2px rgba(255,255,255,.4),0 0 10px 2px rgba(14,165,233,.85)}
.lom-apt-label{font-size:9px;font-weight:800;letter-spacing:.08em;color:#e2e8f0;text-shadow:0 1px 3px #000;white-space:nowrap;transform:translate(10px,-8px)}

.lom-veh{font-size:15px;line-height:1;filter:drop-shadow(0 2px 4px rgba(0,0,0,.6))}
@keyframes lomDrive{0%{transform:translateX(-1px)}50%{transform:translateX(1px)}100%{transform:translateX(-1px)}}
.lom-veh span{display:block;animation:lomDrive 1.1s ease-in-out infinite}

.lom-wrap .leaflet-tooltip{background:rgba(2,6,23,.92);border:1px solid rgba(148,163,184,.35);color:#e2e8f0;
  font-size:11px;border-radius:8px;box-shadow:0 8px 22px rgba(0,0,0,.5);padding:5px 8px}
.lom-wrap .leaflet-tooltip::before{display:none}
`

/**
 * Keyless OSM tiles only.
 *
 * CARTO's basemap CDN now watermarks anonymous traffic with "API KEY
 * REQUIRED", so Night is the plain OSM raster inverted in CSS instead of a
 * hosted dark style.
 */
const BASEMAPS = [
  {
    id: 'night',
    label: 'Night',
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    filter: 'invert(1) hue-rotate(180deg) brightness(.9) contrast(1.06) saturate(.6)',
  },
  {
    id: 'terrain',
    label: 'Terrain',
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    filter: 'saturate(.85) brightness(1.02)',
  },
] as const

const OSM_ATTR =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'

/** Night is a CSS inversion, so the filter rides on the tile pane. */
function paintTiles(map: LeafletMap, filter: string) {
  const pane = map.getPane('tilePane')
  if (pane) pane.style.filter = filter
}

export default function LiveOpsMap({
  country, onGround, flights, nowMinutes, loading, className,
}: Props) {
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<LeafletMap | null>(null)
  const LRef = useRef<LeafletNS | null>(null)
  const tileRef = useRef<LeafletLayer | null>(null)
  const drawnRef = useRef<LeafletLayer[]>([])
  const [ready, setReady] = useState(false)
  const [basemap, setBasemap] = useState<(typeof BASEMAPS)[number]['id']>('night')
  const [expanded, setExpanded] = useState(false)

  const focus = useMemo(() => countryFocus(country), [country])

  /**
   * Pins are per *place*, not per file. Six bookings sitting in Kandy tonight is
   * one dot reading "6 · 21 pax" — six overlapping dots is just a smudge.
   */
  const clusters = useMemo(() => {
    const map = new Map<string, {
      name: string; lat: number; lng: number
      pax: number; refs: LiveOnGround[]
      arriving: number; departing: number
    }>()
    for (const g of onGround) {
      if (!g.pin) continue
      const key = g.pin.name
      const row = map.get(key) ?? {
        name: g.pin.name, lat: g.pin.lat, lng: g.pin.lng,
        pax: 0, refs: [], arriving: 0, departing: 0,
      }
      row.pax += g.pax
      row.refs.push(g)
      if (g.arrivingToday) row.arriving++
      if (g.departingToday) row.departing++
      map.set(key, row)
    }
    return Array.from(map.values()).sort((a, b) => b.pax - a.pax)
  }, [onGround])

  const drawableFlights = useMemo(
    () => flights.filter(f =>
      f.from.lat != null && f.from.lng != null && f.to.lat != null && f.to.lng != null && !f.cancelled,
    ),
    [flights],
  )

  // ── Boot Leaflet once ──────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const L = (await import('leaflet')) as unknown as LeafletNS
      if (cancelled || !wrapRef.current || mapRef.current) return

      const map = L.map(wrapRef.current, {
        zoomControl: false,
        attributionControl: true,
        scrollWheelZoom: false,
        worldCopyJump: true,
      }).setView([focus.center.lat, focus.center.lng], focus.zoom)

      L.control.zoom({ position: 'bottomright' }).addTo(map)
      tileRef.current = L.tileLayer(BASEMAPS[0].url, {
        attribution: OSM_ATTR, maxZoom: 19, subdomains: 'abc',
      }).addTo(map)
      paintTiles(map, BASEMAPS[0].filter)

      LRef.current = L
      mapRef.current = map
      setReady(true)
    })()
    return () => {
      cancelled = true
      mapRef.current?.remove()
      mapRef.current = null
      LRef.current = null
    }
    // Boot only — the focus effect below handles every later country change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Basemap switch ─────────────────────────────────────────────────────
  useEffect(() => {
    const L = LRef.current
    const map = mapRef.current
    if (!L || !map) return
    const bm = BASEMAPS.find(b => b.id === basemap) ?? BASEMAPS[0]
    if (tileRef.current) map.removeLayer(tileRef.current)
    tileRef.current = L.tileLayer(bm.url, {
      attribution: OSM_ATTR, maxZoom: 19, subdomains: 'abc',
    }).addTo(map)
    paintTiles(map, bm.filter)
  }, [basemap, ready])

  // ── Frame the selected country ─────────────────────────────────────────
  //
  // A single-country user must never see the other countries' geography: the
  // map is bounded to their operation, not merely centred on it.
  useEffect(() => {
    const L = LRef.current
    const map = mapRef.current
    if (!L || !map) return
    const b = L.latLngBounds(focus.bounds[0], focus.bounds[1])
    map.flyToBounds(b, { padding: [28, 28], duration: 0.9, maxZoom: country === 'SINGAPORE' ? 12 : 8 })
  }, [focus, country, ready])

  // ── Redraw everything the data says ────────────────────────────────────
  useEffect(() => {
    const L = LRef.current
    const map = mapRef.current
    if (!L || !map) return

    for (const layer of drawnRef.current) map.removeLayer(layer)
    drawnRef.current = []
    const keep = (layer: LeafletLayer) => { drawnRef.current.push(layer); return layer }

    // ── Flight arcs ──
    const airportsSeen = new Set<string>()
    for (const f of drawableFlights) {
      const a: LatLng = [f.from.lat!, f.from.lng!]
      const b: LatLng = [f.to.lat!, f.to.lng!]
      const path = arc(a, b)
      const hex = DIRECTION_HEX[f.direction]
      const flown = f.phase === 'landed'

      keep(L.polyline(path, {
        color: hex, weight: flown ? 4 : 6, opacity: flown ? 0.10 : 0.18, lineCap: 'round',
      }).addTo(map))
      keep(L.polyline(path, {
        className: f.phase === 'airborne' ? 'lom-air' : undefined,
        color: hex, weight: 2, opacity: flown ? 0.28 : 0.9, dashArray: flown ? '3 6' : undefined,
      }).addTo(map))

      // Where the aircraft is on that arc. Scheduled sits at the gate, landed
      // sits at the stand — only an airborne sector moves.
      const t =
        f.phase === 'airborne' && f.depMin != null && f.arrMin != null && f.arrMin > f.depMin
          ? Math.max(0.02, Math.min(0.98, (nowMinutes - f.depMin) / (f.arrMin - f.depMin)))
          : f.phase === 'landed' ? 1
          : 0
      const pos = pointAt(path, t)
      const rot = bearingAt(path, t) + 90

      const label = `<b>${f.flightNo}</b> ${f.from.iata} → ${f.to.iata}` +
        `<br/>${f.depTime ?? '—'} – ${f.arrTime ?? '—'} · ${f.pax} pax` +
        (f.bookingRef ? `<br/><span style="opacity:.7">${f.bookingRef}</span>` : '')

      const plane = L.marker(pos, {
        icon: L.divIcon({
          className: '',
          html: `<div class="lom-plane" style="color:${hex}">
            <svg width="20" height="20" viewBox="0 0 24 24" style="transform:rotate(${rot}deg)"
              fill="${f.phase === 'airborne' ? hex : 'rgba(148,163,184,.85)'}">
              <path d="M21 16v-2l-8-5V3.5A1.5 1.5 0 0 0 11.5 2 1.5 1.5 0 0 0 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5z"/>
            </svg></div>`,
          iconSize: [20, 20], iconAnchor: [10, 10],
        }),
        zIndexOffset: 600,
      }).addTo(map)
      plane.bindTooltip(label, { direction: 'top', offset: [0, -8], sticky: true })
      keep(plane)

      // Airport dots, once each however many sectors touch them.
      for (const end of [f.from, f.to]) {
        if (airportsSeen.has(end.iata)) continue
        airportsSeen.add(end.iata)
        keep(L.marker([end.lat!, end.lng!], {
          icon: L.divIcon({
            className: '',
            html: `<div class="lom-apt"></div><div class="lom-apt-label">${end.iata}</div>`,
            iconSize: [8, 8], iconAnchor: [4, 4],
          }),
          zIndexOffset: 200,
        }).addTo(map).bindTooltip(`${end.iata}${end.city ? ` · ${end.city}` : ''}`, { direction: 'top' }))
      }
    }

    // ── Today's drives ──
    for (const g of onGround) {
      if (!g.leg || !g.movement || g.movement.leisure) continue
      const path = arc([g.leg.from.lat, g.leg.from.lng], [g.leg.to.lat, g.leg.to.lng], 0.10)
      keep(L.polyline(path, {
        className: 'lom-road', color: '#38bdf8', weight: 2, opacity: 0.55,
      }).addTo(map))

      const glyph = VEHICLE_GLYPH[g.movement.vehicleKind] ?? '🚐'
      const assigned = !!g.movement.driver
      const veh = L.marker(pointAt(path, 0.55), {
        icon: L.divIcon({
          className: '',
          html: `<div class="lom-veh" style="opacity:${assigned ? 1 : 0.55}"><span>${glyph}</span></div>`,
          iconSize: [18, 18], iconAnchor: [9, 9],
        }),
        zIndexOffset: 500,
      }).addTo(map)
      veh.bindTooltip(
        `<b>${g.bookingRef}</b> · ${g.pax} pax<br/>${g.leg.from.name} → ${g.leg.to.name}` +
        `<br/><span style="opacity:.75">${g.movement.driver ?? 'Driver not assigned'}` +
        `${g.movement.vehicleType ? ` · ${g.movement.vehicleType}` : ''}</span>`,
        { direction: 'top', offset: [0, -6] },
      )
      keep(veh)
    }

    // ── Guests on the ground ──
    for (const c of clusters) {
      // Dot area tracks headcount, so a 40-pax town reads bigger than a 4-pax one
      // without the biggest pin swallowing the map.
      const size = Math.round(Math.max(26, Math.min(52, 22 + Math.sqrt(c.pax) * 5)))
      const hex = c.arriving > 0 ? '#34d399' : c.departing > 0 ? '#fbbf24' : '#facc15'
      const pin = L.marker([c.lat, c.lng], {
        icon: L.divIcon({
          className: '',
          html: `<div class="lom-pin" style="width:${size}px;height:${size}px;color:${hex}">
              <div class="lom-pin-ring"></div>
              <div class="lom-pin-ring d2"></div>
              <div class="lom-pin-core" style="width:${size * 0.62}px;height:${size * 0.62}px;
                background:${hex};font-size:${size * 0.3}px">${c.pax}</div>
            </div>`,
          iconSize: [size, size], iconAnchor: [size / 2, size / 2],
        }),
        zIndexOffset: 400,
      }).addTo(map)

      const lines = c.refs.slice(0, 6).map(r =>
        `<div style="opacity:.85">${r.bookingRef} · ${r.pax} pax · Day ${r.dayNo}/${r.totalDays}` +
        `${r.arrivingToday ? ' · <span style="color:#34d399">arrives today</span>' : ''}` +
        `${r.departingToday ? ' · <span style="color:#fbbf24">departs today</span>' : ''}</div>`,
      ).join('')
      pin.bindTooltip(
        `<b>${c.name}</b> — ${c.pax} pax · ${c.refs.length} file${c.refs.length === 1 ? '' : 's'}<br/>${lines}` +
        (c.refs.length > 6 ? `<div style="opacity:.6">+${c.refs.length - 6} more</div>` : ''),
        { direction: 'top', offset: [0, -8] },
      )
      keep(pin)
    }
  }, [clusters, drawableFlights, onGround, nowMinutes, ready])

  // Leaflet measures its container on creation; growing the box needs a nudge.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const t = setTimeout(() => map.invalidateSize(), 260)
    return () => clearTimeout(t)
  }, [expanded])

  const recenter = () => {
    const L = LRef.current
    const map = mapRef.current
    if (!L || !map) return
    map.flyToBounds(L.latLngBounds(focus.bounds[0], focus.bounds[1]), { padding: [28, 28], duration: 0.8 })
  }

  return (
    <div
      className={cn(
        'lom-wrap relative rounded-2xl overflow-hidden border border-white/10 bg-[#070c1a] transition-[height] duration-300',
        expanded ? 'h-[560px]' : 'h-[360px]',
        className,
      )}
    >
      <style dangerouslySetInnerHTML={{ __html: MAP_CSS }} />
      <div ref={wrapRef} className="absolute inset-0" />

      {(!ready || loading) && (
        <div className="absolute inset-0 z-[500] grid place-items-center bg-[#070c1a]/80 backdrop-blur-sm">
          <div className="flex items-center gap-2 text-slate-300 text-xs font-semibold">
            <Loader2 className="w-4 h-4 animate-spin" /> Plotting live operations…
          </div>
        </div>
      )}

      {/* Controls float above the tiles — Leaflet's own panes stop at z-index 400. */}
      <div className="absolute top-3 right-3 z-[500] flex items-center gap-1.5">
        <button
          onClick={() => setBasemap(b => (b === 'night' ? 'terrain' : 'night'))}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-900/70 hover:bg-slate-900 border border-white/10 text-[11px] font-semibold text-slate-200 backdrop-blur transition-colors"
          title="Switch basemap"
        >
          <Layers className="w-3.5 h-3.5" />
          {BASEMAPS.find(b => b.id === basemap)?.label}
        </button>
        <button
          onClick={recenter}
          className="p-1.5 rounded-lg bg-slate-900/70 hover:bg-slate-900 border border-white/10 text-slate-200 backdrop-blur transition-colors"
          title="Recentre"
        >
          <Locate className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => setExpanded(e => !e)}
          className="p-1.5 rounded-lg bg-slate-900/70 hover:bg-slate-900 border border-white/10 text-slate-200 backdrop-blur transition-colors"
          title={expanded ? 'Shrink map' : 'Expand map'}
        >
          {expanded ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
        </button>
      </div>

      {/* Legend */}
      <div className="absolute bottom-3 left-3 z-[500] flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2 rounded-xl bg-slate-900/70 border border-white/10 backdrop-blur text-[10px] font-semibold text-slate-300">
        <span className="flex items-center gap-1.5"><i className="w-2 h-2 rounded-full bg-yellow-400" /> Pax on ground</span>
        <span className="flex items-center gap-1.5"><i className="w-2 h-2 rounded-full bg-emerald-400" /> Arrival</span>
        <span className="flex items-center gap-1.5"><i className="w-2 h-2 rounded-full bg-amber-400" /> Departure</span>
        <span className="flex items-center gap-1.5"><i className="w-2 h-2 rounded-full bg-violet-400" /> Domestic sector</span>
        <span className="flex items-center gap-1.5"><span className="text-xs leading-none">🚐</span> Vehicle on the road</span>
      </div>
    </div>
  )
}
