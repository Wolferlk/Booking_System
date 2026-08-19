'use client'

/**
 * Journey Map — the booking's itinerary as a route on a real map.
 *
 * The itinerary list next to this panel answers "what happens on day 4". It
 * cannot answer "how far apart are these days", "are we crossing the country
 * twice", or "where is this place" — questions an operator asks constantly when
 * reading a file for the first time. This panel answers those.
 *
 * Mapping stack is deliberately dependency-light and free: Leaflet against
 * OpenStreetMap-derived raster tiles (CARTO / OpenTopoMap), no API key, no
 * account, no per-view billing. Leaflet is loaded on demand inside the effect
 * so it never enters the server bundle or the initial page payload.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  Map as LeafletMap, Marker as LeafletMarker,
  Polyline as LeafletPolyline, TileLayer as LeafletTileLayer,
} from 'leaflet'

type LeafletNS = typeof import('leaflet')
import { AnimatePresence, motion } from 'framer-motion'
import {
  Loader2, Play, Pause, RotateCcw, Maximize2, Minimize2, Layers,
  X, Sparkles, Clock, Lightbulb, MapPin, Route, Navigation,
  ImageOff, ChevronLeft, ChevronRight, RefreshCw, Compass,
} from 'lucide-react'
import { cn, formatDate, readApiResponse } from '@/lib/utils'
import 'leaflet/dist/leaflet.css'

// ─── Types (mirror src/lib/journey-map.ts) ───────────────────────────────

type StopKind =
  | 'arrival' | 'departure' | 'transfer' | 'flight'
  | 'tour' | 'attraction' | 'beach' | 'nature'
  | 'cultural' | 'city' | 'cruise' | 'hotel' | 'leisure'

interface JourneyStop {
  id: string
  dayNo: number
  date: string | null
  title: string
  description: string | null
  place: string
  city: string | null
  country: string | null
  kind: StopKind
  lat: number
  lng: number
  source: 'osm' | 'model'
  legKm: number | null
}

interface JourneyHotel {
  id: string; hotel: string; city: string
  checkIn: string; checkOut: string; nights: number
  lat: number | null; lng: number | null
}

interface Journey {
  stops: JourneyStop[]
  hotels: JourneyHotel[]
  countries: string[]
  totalKm: number
  degraded: boolean
}

interface ActivityBrief {
  place: string
  headline: string
  summary: string
  highlights: string[]
  bestTime: string | null
  tips: string[]
  images: string[]
}

// ─── Kind vocabulary ─────────────────────────────────────────────────────

/**
 * One row per kind: the pin colour and the glyph drawn inside it. Paths are
 * plain 24×24 stroke geometry so the same string works in a Leaflet DivIcon
 * (raw HTML, no React) and in the legend chips.
 */
const KIND: Record<StopKind, { label: string; hex: string; glow: string; path: string; circles?: string }> = {
  arrival:    { label: 'Arrival',     hex: '#059669', glow: '16,185,129',  path: 'M12 3v13M6 11l6 6 6-6M3 22h18' },
  departure:  { label: 'Departure',   hex: '#e11d48', glow: '244,63,94',   path: 'M12 19V6M6 12l6-6 6 6M3 22h18' },
  transfer:   { label: 'Transfer',    hex: '#0284c7', glow: '14,165,233',  path: 'M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2M7 17h10', circles: '<circle cx="7" cy="17" r="2"/><circle cx="17" cy="17" r="2"/>' },
  flight:     { label: 'Flight',      hex: '#4f46e5', glow: '99,102,241',  path: 'M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z' },
  tour:       { label: 'Tour',        hex: '#d97706', glow: '245,158,11',  path: 'M16.2 7.8l-2.1 6.4-6.4 2.1 2.1-6.4 6.4-2.1z', circles: '<circle cx="12" cy="12" r="9.5"/>' },
  attraction: { label: 'Attraction',  hex: '#c026d3', glow: '217,70,239',  path: 'M12 2.5l2.9 5.9 6.5.9-4.7 4.6 1.1 6.5-5.8-3.1-5.8 3.1 1.1-6.5L2.6 9.3l6.5-.9L12 2.5z' },
  beach:      { label: 'Beach',       hex: '#0891b2', glow: '6,182,212',   path: 'M2 7c.6.5 1.2 1 2.5 1C7 8 7 6 9.5 6c2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1M2 13c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1M2 19c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1' },
  nature:     { label: 'Nature',      hex: '#16a34a', glow: '34,197,94',   path: 'M8 3l4 8 5-5 5 15H2L8 3z' },
  cultural:   { label: 'Cultural',    hex: '#7c3aed', glow: '139,92,246',  path: 'M3 22h18M6 18v-7M10 18v-7M14 18v-7M18 18v-7M12 2.5L21 8H3l9-5.5z' },
  city:       { label: 'City',        hex: '#475569', glow: '100,116,139', path: 'M6 22V3h12v19M10 7h.01M14 7h.01M10 11h.01M14 11h.01M10 15h.01M14 15h.01M10 22v-3h4v3' },
  cruise:     { label: 'Cruise',      hex: '#2563eb', glow: '59,130,246',  path: 'M2 20a6 6 0 0 0 3-1 6 6 0 0 0 6 0 6 6 0 0 0 6 0 6 6 0 0 0 3 1M4 18l-1.5-6.5a1 1 0 0 1 .6-1.2L12 7l8.9 3.3a1 1 0 0 1 .6 1.2L20 18M12 7V3H8' },
  hotel:      { label: 'Hotel',       hex: '#ea580c', glow: '249,115,22',  path: 'M2 20v-8a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v8M2 16h20M6 10V6a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v4' },
  leisure:    { label: 'Leisure',     hex: '#ca8a04', glow: '234,179,8',   path: 'M12 4V2M12 22v-2M4 12H2M22 12h-2M5.6 5.6L4.2 4.2M19.8 19.8l-1.4-1.4M5.6 18.4l-1.4 1.4M19.8 4.2l-1.4 1.4', circles: '<circle cx="12" cy="12" r="4.5"/>' },
}

function glyphSvg(kind: StopKind, size = 15, color = '#fff') {
  const k = KIND[kind] ?? KIND.tour
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="${color}" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="${k.path}"/>${k.circles ?? ''}</svg>`
}

// ─── Basemaps (all free, no key) ─────────────────────────────────────────

const OSM_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'

const BASEMAPS = [
  {
    id: 'voyager', label: 'Voyager', dark: false,
    url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
    attr: `${OSM_ATTR} &copy; <a href="https://carto.com/attributions">CARTO</a>`,
  },
  {
    id: 'terrain', label: 'Terrain', dark: false,
    url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    attr: `${OSM_ATTR} &copy; <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)`,
  },
  {
    id: 'midnight', label: 'Midnight', dark: true,
    url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    attr: `${OSM_ATTR} &copy; <a href="https://carto.com/attributions">CARTO</a>`,
  },
] as const

type BasemapId = typeof BASEMAPS[number]['id']

// ─── Route geometry ──────────────────────────────────────────────────────

type LatLng = [number, number]

/**
 * A gently bowed leg between two stops.
 *
 * A straight segment between two pins reads as a wall, and consecutive legs
 * along the same corridor overlap into one indistinguishable stroke. Bowing
 * each leg perpendicular to its own bearing separates the outbound and return
 * halves of a loop itinerary, which is exactly the shape an operator is
 * scanning for.
 */
function arc(a: LatLng, b: LatLng, segments = 28): LatLng[] {
  const [y1, x1] = a
  const [y2, x2] = b
  const dx = x2 - x1
  const dy = y2 - y1
  const dist = Math.hypot(dx, dy)
  if (dist < 1e-6) return [a, b]

  // Bow height scales with leg length but is capped, so a 1 000 km hop and a
  // 20 km transfer both stay readable rather than one ballooning off-screen.
  const bow = Math.min(dist * 0.18, 1.6)
  const mx = (x1 + x2) / 2 - (dy / dist) * bow
  const my = (y1 + y2) / 2 + (dx / dist) * bow

  const pts: LatLng[] = []
  for (let i = 0; i <= segments; i++) {
    const t = i / segments
    const u = 1 - t
    pts.push([
      u * u * y1 + 2 * u * t * my + t * t * y2,
      u * u * x1 + 2 * u * t * mx + t * t * x2,
    ])
  }
  return pts
}

/** Cumulative length of a polyline in degrees, used to walk it evenly. */
function walk(points: LatLng[], t: number): LatLng {
  if (points.length === 0) return [0, 0]
  if (t <= 0) return points[0]
  if (t >= 1) return points[points.length - 1]
  const target = t * (points.length - 1)
  const i = Math.floor(target)
  const f = target - i
  const a = points[i]
  const b = points[Math.min(i + 1, points.length - 1)]
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]
}

// ─── Injected map CSS ────────────────────────────────────────────────────

const MAP_CSS = `
.jm-wrap .leaflet-container{background:transparent;font-family:inherit}
.jm-wrap .leaflet-control-attribution{font-size:9px;background:rgba(255,255,255,.72);backdrop-filter:blur(4px);border-radius:6px 0 0 0;padding:1px 6px}
.jm-wrap .leaflet-control-zoom{border:none!important;box-shadow:0 4px 16px rgba(15,23,42,.16)!important;border-radius:12px;overflow:hidden}
.jm-wrap .leaflet-control-zoom a{background:rgba(255,255,255,.94);color:#334155;border-color:rgba(148,163,184,.28);font-weight:600}
.jm-wrap .leaflet-control-zoom a:hover{background:#fff;color:#0f172a}

/* The travelled route: a dashed stroke that crawls forward, so the direction
   of travel is legible even when the map is completely still. */
.jm-route{stroke-dasharray:1 12;stroke-linecap:round;animation:jm-crawl 1.1s linear infinite}
@keyframes jm-crawl{to{stroke-dashoffset:-13}}
.jm-route-base{stroke-linecap:round}

.jm-pin{background:none!important;border:none!important}
.jm-pin-inner{position:relative;width:38px;height:38px;display:flex;align-items:center;justify-content:center;transform-origin:50% 50%;transition:transform .22s cubic-bezier(.34,1.56,.64,1)}
.jm-pin-ring{position:absolute;inset:0;border-radius:50%;opacity:.55}
.jm-pin-dot{position:relative;width:30px;height:30px;border-radius:50%;display:flex;align-items:center;justify-content:center;
  box-shadow:0 4px 12px rgba(15,23,42,.3),0 0 0 3px rgba(255,255,255,.92);cursor:pointer}
.jm-pin-day{position:absolute;top:-7px;right:-9px;min-width:19px;height:19px;padding:0 4px;border-radius:9999px;background:#0f172a;color:#fff;
  font-size:10px;font-weight:800;line-height:19px;text-align:center;box-shadow:0 0 0 2px #fff;letter-spacing:.2px}
.jm-pin:hover .jm-pin-inner{transform:scale(1.16) translateY(-2px);z-index:900}

/* Active pin: a slow radar pulse. Only ever one on the map at a time, so it
   reads as "you are here" rather than as decoration. */
.jm-pin-active .jm-pin-inner{transform:scale(1.22) translateY(-3px)}
.jm-pin-active .jm-pin-ring{animation:jm-pulse 1.9s cubic-bezier(0,.55,.45,1) infinite}
@keyframes jm-pulse{0%{transform:scale(.6);opacity:.7}70%{transform:scale(2.1);opacity:0}100%{opacity:0}}
.jm-pin-dim .jm-pin-inner{opacity:.22;filter:grayscale(1)}

.jm-traveller{background:none!important;border:none!important}
.jm-traveller-inner{width:34px;height:34px;border-radius:50%;display:flex;align-items:center;justify-content:center;
  background:linear-gradient(140deg,#0f172a,#334155);box-shadow:0 0 0 3px #fff,0 6px 18px rgba(15,23,42,.4);animation:jm-bob 1.4s ease-in-out infinite}
@keyframes jm-bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-3px)}}

.jm-hotel{background:none!important;border:none!important}
.jm-hotel-inner{width:22px;height:22px;border-radius:7px;display:flex;align-items:center;justify-content:center;background:#ea580c;
  box-shadow:0 2px 8px rgba(15,23,42,.28),0 0 0 2px rgba(255,255,255,.9);opacity:.92}

.jm-strip{scrollbar-width:thin;scrollbar-color:rgba(148,163,184,.5) transparent}
.jm-strip::-webkit-scrollbar{height:6px}
.jm-strip::-webkit-scrollbar-thumb{background:rgba(148,163,184,.5);border-radius:9999px}
.jm-strip::-webkit-scrollbar-track{background:transparent}

@media (prefers-reduced-motion:reduce){
  .jm-route{animation:none}
  .jm-pin-active .jm-pin-ring{animation:none}
  .jm-traveller-inner{animation:none}
}
`

// ─── Component ───────────────────────────────────────────────────────────

const LEG_MS = 1500      // time to fly one leg during playback
const DWELL_MS = 1100    // pause on each stop during playback

export default function JourneyMap({ bookingRef, className }: { bookingRef: string; className?: string }) {
  const [journey, setJourney] = useState<Journey | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [hiddenKinds, setHiddenKinds] = useState<Set<StopKind>>(new Set())
  const [basemap, setBasemap] = useState<BasemapId>('voyager')
  const [showLayers, setShowLayers] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [progress, setProgress] = useState(1)   // 0..1 along the whole route

  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<LeafletMap | null>(null)
  // The Leaflet module handle, populated by the dynamic import in the mount
  // effect. `typeof import(...)` is a type-only reference, so nothing is pulled
  // into the bundle here.
  const LRef = useRef<LeafletNS | null>(null)
  const tileRef = useRef<LeafletTileLayer | null>(null)
  const routeRef = useRef<{ base: LeafletPolyline; live: LeafletPolyline } | null>(null)
  const pinsRef = useRef<Map<string, LeafletMarker>>(new Map())
  const hotelPinsRef = useRef<LeafletMarker[]>([])
  const travellerRef = useRef<LeafletMarker | null>(null)
  const rafRef = useRef<number | null>(null)
  const stripRef = useRef<HTMLDivElement | null>(null)

  const stops = useMemo(() => journey?.stops ?? [], [journey])
  const selected = useMemo(() => stops.find(s => s.id === selectedId) ?? null, [stops, selectedId])

  const kindCounts = useMemo(() => {
    const m = new Map<StopKind, number>()
    stops.forEach(s => m.set(s.kind, (m.get(s.kind) ?? 0) + 1))
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1])
  }, [stops])

  /** Per-leg arcs plus the flattened path the traveller walks. */
  const geometry = useMemo(() => {
    const legs: LatLng[][] = []
    for (let i = 0; i < stops.length - 1; i++) {
      legs.push(arc([stops[i].lat, stops[i].lng], [stops[i + 1].lat, stops[i + 1].lng]))
    }
    const flat: LatLng[] = []
    legs.forEach((leg, i) => flat.push(...(i === 0 ? leg : leg.slice(1))))
    return { legs, flat }
  }, [stops])

  // ── Data ───────────────────────────────────────────────────────────────

  const load = useCallback(async (refresh = false) => {
    refresh ? setRefreshing(true) : setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/bookings/${bookingRef}/journey-map${refresh ? '?refresh=1' : ''}`)
      const json = await readApiResponse<Journey>(res)
      if (!json.success || !json.data) throw new Error(json.error || 'The journey map could not be loaded.')
      setJourney(json.data)
      setProgress(1)
    } catch (e) {
      setError((e as Error).message || 'The journey map could not be loaded.')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [bookingRef])

  useEffect(() => { void load() }, [load])

  // ── Map lifecycle ──────────────────────────────────────────────────────

  useEffect(() => {
    if (!containerRef.current || stops.length === 0 || mapRef.current) return
    let cancelled = false

    ;(async () => {
      const L = (await import('leaflet')).default
      if (cancelled || !containerRef.current || mapRef.current) return
      LRef.current = L

      const map = L.map(containerRef.current, {
        zoomControl: true,
        attributionControl: true,
        // The panel sits mid-page, so a wheel over it must scroll the booking
        // rather than zoom. Fullscreen re-enables it (see the effect below).
        scrollWheelZoom: false,
        worldCopyJump: true,
      })
      map.getContainer().style.outline = 'none'
      mapRef.current = map

      const bm = BASEMAPS.find(b => b.id === basemap) ?? BASEMAPS[0]
      tileRef.current = L.tileLayer(bm.url, { attribution: bm.attr, maxZoom: 18, subdomains: 'abcd' }).addTo(map)

      map.fitBounds(L.latLngBounds(stops.map(s => [s.lat, s.lng] as LatLng)), { padding: [56, 56], maxZoom: 11 })
      setTimeout(() => map.invalidateSize(), 120)
    })()

    return () => { cancelled = true }
  }, [stops, basemap])

  // Tear the map down only when the component itself goes away.
  useEffect(() => () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    mapRef.current?.remove()
    mapRef.current = null
  }, [])

  // ── Basemap switching ──────────────────────────────────────────────────

  useEffect(() => {
    const L = LRef.current, map = mapRef.current
    if (!L || !map) return
    const bm = BASEMAPS.find(b => b.id === basemap) ?? BASEMAPS[0]
    if (tileRef.current) map.removeLayer(tileRef.current)
    tileRef.current = L.tileLayer(bm.url, { attribution: bm.attr, maxZoom: 18, subdomains: 'abcd' }).addTo(map)
    tileRef.current.bringToBack()
  }, [basemap])

  // ── Route + markers ────────────────────────────────────────────────────

  useEffect(() => {
    const L = LRef.current, map = mapRef.current
    if (!L || !map || stops.length === 0) return

    const pins = pinsRef.current
    const hotelPins: LeafletMarker[] = []

    routeRef.current?.base.remove()
    routeRef.current?.live.remove()
    pins.forEach(m => m.remove())
    pins.clear()
    hotelPinsRef.current.forEach(m => m.remove())
    hotelPinsRef.current = hotelPins

    const dark = BASEMAPS.find(b => b.id === basemap)?.dark
    const base = L.polyline(geometry.flat, {
      className: 'jm-route-base',
      color: dark ? '#1e293b' : '#cbd5e1',
      weight: 5, opacity: 0.85,
    }).addTo(map)
    const live = L.polyline(geometry.flat, {
      className: 'jm-route',
      color: dark ? '#f8fafc' : '#0f172a',
      weight: 2.6, opacity: 0.95,
    }).addTo(map)
    routeRef.current = { base, live }

    // Hotels sit under the day pins — context, not the subject of the panel.
    ;(journey?.hotels ?? []).forEach(h => {
      if (h.lat == null || h.lng == null) return
      const icon = L.divIcon({
        className: 'jm-hotel',
        html: `<div class="jm-hotel-inner" title="${escapeHtml(h.hotel)}">${glyphSvg('hotel', 12)}</div>`,
        iconSize: [22, 22], iconAnchor: [11, 11],
      })
      const m = L.marker([h.lat, h.lng], { icon, zIndexOffset: -400, riseOnHover: true })
        .addTo(map)
        .bindTooltip(
          `<strong>${escapeHtml(h.hotel)}</strong><br/>${h.nights} night${h.nights === 1 ? '' : 's'} · ${escapeHtml(h.city)}`,
          { direction: 'top', offset: [0, -10], opacity: 0.95 },
        )
      hotelPins.push(m)
    })

    stops.forEach((s, i) => {
      const k = KIND[s.kind] ?? KIND.tour
      const icon = L.divIcon({
        className: 'jm-pin',
        html:
          `<div class="jm-pin-inner">` +
          `<span class="jm-pin-ring" style="box-shadow:0 0 0 8px rgba(${k.glow},.45)"></span>` +
          `<span class="jm-pin-dot" style="background:linear-gradient(145deg,${k.hex},${shade(k.hex, -18)})">${glyphSvg(s.kind)}</span>` +
          `<span class="jm-pin-day">D${s.dayNo}</span>` +
          `</div>`,
        iconSize: [38, 38], iconAnchor: [19, 19],
      })
      const m = L.marker([s.lat, s.lng], { icon, zIndexOffset: i, riseOnHover: true })
        .addTo(map)
        .bindTooltip(
          `<strong>Day ${s.dayNo} · ${escapeHtml(s.place)}</strong><br/>${escapeHtml(truncate(s.title, 70))}`,
          { direction: 'top', offset: [0, -20], opacity: 0.96 },
        )
      m.on('click', () => setSelectedId(s.id))
      m.on('mouseover', () => setHoveredId(s.id))
      m.on('mouseout', () => setHoveredId(null))
      pins.set(s.id, m)
    })

    return () => {
      base.remove(); live.remove()
      pins.forEach(x => x.remove()); pins.clear()
      hotelPins.forEach(x => x.remove())
    }
  }, [stops, geometry, journey?.hotels, basemap])

  // ── Selection / hover / filter styling ─────────────────────────────────

  useEffect(() => {
    const active = hoveredId ?? selectedId
    pinsRef.current.forEach((marker, id) => {
      const el = marker.getElement()
      if (!el) return
      const stop = stops.find(s => s.id === id)
      el.classList.toggle('jm-pin-active', id === active)
      el.classList.toggle('jm-pin-dim', !!stop && hiddenKinds.has(stop.kind))
    })
  }, [hoveredId, selectedId, hiddenKinds, stops])

  // ── Playback ───────────────────────────────────────────────────────────

  const flyTo = useCallback((s: JourneyStop, zoom?: number) => {
    const map = mapRef.current
    if (!map) return
    map.flyTo([s.lat, s.lng], zoom ?? Math.max(map.getZoom(), 9), { duration: 1.05 })
  }, [])

  useEffect(() => {
    if (!playing || stops.length < 2) return
    const L = LRef.current, map = mapRef.current
    if (!L || !map) return

    // Restart from the top when replaying a finished run.
    let legIndex = progress >= 0.999 ? 0 : Math.floor(progress * (stops.length - 1))
    let phase: 'dwell' | 'travel' = 'dwell'
    let phaseStart = performance.now()

    setSelectedId(stops[legIndex].id)
    flyTo(stops[legIndex], 9)

    const traveller = L.marker([stops[legIndex].lat, stops[legIndex].lng], {
      icon: L.divIcon({
        className: 'jm-traveller',
        html: `<div class="jm-traveller-inner">${glyphSvg('flight', 16)}</div>`,
        iconSize: [34, 34], iconAnchor: [17, 17],
      }),
      zIndexOffset: 1200,
    }).addTo(map)
    travellerRef.current = traveller

    const tick = (now: number) => {
      const elapsed = now - phaseStart

      if (phase === 'dwell') {
        if (elapsed >= DWELL_MS) { phase = 'travel'; phaseStart = now }
      } else {
        const t = Math.min(elapsed / LEG_MS, 1)
        const legT = (legIndex + t) / (stops.length - 1)
        setProgress(legT)
        traveller.setLatLng(walk(geometry.flat, legT))
        if (t >= 1) {
          legIndex += 1
          if (legIndex >= stops.length - 1) {
            setProgress(1)
            setSelectedId(stops[stops.length - 1].id)
            flyTo(stops[stops.length - 1], 9)
            setPlaying(false)
            return
          }
          setSelectedId(stops[legIndex].id)
          flyTo(stops[legIndex], 9)
          phase = 'dwell'
          phaseStart = now
        }
      }
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      traveller.remove()
      travellerRef.current = null
    }
    // `progress` is read once to decide where to resume; re-running on every
    // frame would restart the animation, so it is deliberately not a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, stops, geometry, flyTo])

  /** Draw only the travelled portion while playing; the whole route otherwise. */
  useEffect(() => {
    const route = routeRef.current
    if (!route || geometry.flat.length === 0) return
    const upto = Math.max(2, Math.round(progress * (geometry.flat.length - 1)) + 1)
    route.live.setLatLngs(geometry.flat.slice(0, upto))
  }, [progress, geometry])

  // ── Fullscreen ─────────────────────────────────────────────────────────

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    // Fullscreen is a deliberate "I am reading the map now" mode, so the wheel
    // becomes a zoom there and goes back to scrolling the page on exit.
    fullscreen ? map.scrollWheelZoom.enable() : map.scrollWheelZoom.disable()
    const id = setTimeout(() => map.invalidateSize(), 260)
    return () => clearTimeout(id)
  }, [fullscreen])

  /** Re-frame the route after a rebuild brings back a different set of pins. */
  const fittedRef = useRef<string>('')
  useEffect(() => {
    const L = LRef.current, map = mapRef.current
    if (!L || !map || stops.length === 0) return
    const signature = stops.map(s => `${s.lat.toFixed(3)},${s.lng.toFixed(3)}`).join('|')
    if (fittedRef.current === signature) return
    if (fittedRef.current !== '') {
      map.flyToBounds(L.latLngBounds(stops.map(s => [s.lat, s.lng] as LatLng)), { padding: [56, 56], maxZoom: 11, duration: 0.9 })
    }
    fittedRef.current = signature
  }, [stops])

  useEffect(() => {
    if (!fullscreen) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setFullscreen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [fullscreen])

  // Keep the day strip tracking the selected stop during playback.
  useEffect(() => {
    if (!selectedId || !stripRef.current) return
    stripRef.current.querySelector<HTMLElement>(`[data-day-id="${cssEscape(selectedId)}"]`)
      ?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' })
  }, [selectedId])

  const fitAll = useCallback(() => {
    const L = LRef.current, map = mapRef.current
    if (!L || !map || stops.length === 0) return
    map.flyToBounds(L.latLngBounds(stops.map(s => [s.lat, s.lng] as LatLng)), { padding: [56, 56], maxZoom: 11, duration: 0.9 })
  }, [stops])

  const selectStop = useCallback((s: JourneyStop) => {
    setPlaying(false)
    setSelectedId(s.id)
    flyTo(s, 10)
  }, [flyTo])

  // ── Render ─────────────────────────────────────────────────────────────

  const dark = BASEMAPS.find(b => b.id === basemap)?.dark ?? false

  if (loading) return <JourneyShell className={className}><MapSkeleton /></JourneyShell>

  if (error || !journey || stops.length === 0) {
    return (
      <JourneyShell className={className}>
        <div className="h-[420px] flex flex-col items-center justify-center gap-3 text-center px-8">
          <div className="w-12 h-12 rounded-2xl bg-slate-100 flex items-center justify-center">
            <Compass className="w-6 h-6 text-slate-400" />
          </div>
          <p className="text-sm font-medium text-slate-700">
            {error ? 'The journey map could not be built' : 'No mappable places on this itinerary'}
          </p>
          <p className="text-xs text-slate-500 max-w-xs">
            {error ?? 'The itinerary days do not name a place we can pin. Add a location to the day titles and rebuild.'}
          </p>
          <button
            onClick={() => void load(true)}
            className="mt-1 inline-flex items-center gap-1.5 text-xs font-semibold text-brand-600 hover:text-brand-700"
          >
            <RefreshCw className={cn('w-3.5 h-3.5', refreshing && 'animate-spin')} /> Rebuild map
          </button>
        </div>
      </JourneyShell>
    )
  }

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: MAP_CSS }} />
      {fullscreen && <div className="fixed inset-0 z-[59] bg-slate-950/70 backdrop-blur-sm" onClick={() => setFullscreen(false)} />}

      <motion.div
        layout
        className={cn(
          'jm-wrap group relative overflow-hidden rounded-2xl border shadow-card',
          dark ? 'border-slate-700 bg-slate-900' : 'border-slate-200 bg-slate-50',
          fullscreen ? 'fixed inset-3 sm:inset-6 z-[60] shadow-2xl' : className,
        )}
      >
        {/* ── The map ── */}
        <div
          ref={containerRef}
          className={cn('w-full transition-[height] duration-300', fullscreen ? 'h-full' : 'h-[520px]')}
        />

        {/* ── Top-left: what this journey is ── */}
        <div className="pointer-events-none absolute top-3 left-3 z-[500] flex flex-col gap-2">
          <motion.div
            initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
            className="pointer-events-auto rounded-xl bg-white/88 backdrop-blur-md shadow-lg ring-1 ring-slate-900/5 px-3 py-2"
          >
            <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-brand-600">
              <Route className="w-3 h-3" /> Journey
            </div>
            <p className="text-sm font-semibold text-slate-900 leading-tight mt-0.5">
              {journey.countries.join(' · ') || 'Route'}
            </p>
            <div className="flex items-center gap-3 mt-1.5 text-[11px] text-slate-600">
              <span className="inline-flex items-center gap-1"><MapPin className="w-3 h-3 text-slate-400" />{stops.length} stops</span>
              <span className="inline-flex items-center gap-1"><Navigation className="w-3 h-3 text-slate-400" />{journey.totalKm.toLocaleString()} km</span>
              {journey.hotels.length > 0 && (
                <span className="inline-flex items-center gap-1">
                  <span className="w-2 h-2 rounded-[3px] bg-orange-500" />{journey.hotels.length} stays
                </span>
              )}
            </div>
          </motion.div>

          {/* Legend doubles as a filter — click a kind to fade it out. */}
          <motion.div
            initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.18 }}
            className="pointer-events-auto flex flex-wrap gap-1 max-w-[230px]"
          >
            {kindCounts.map(([kind, count]) => {
              const k = KIND[kind] ?? KIND.tour
              const off = hiddenKinds.has(kind)
              return (
                <button
                  key={kind}
                  onClick={() => setHiddenKinds(prev => {
                    const next = new Set(prev)
                    next.has(kind) ? next.delete(kind) : next.add(kind)
                    return next
                  })}
                  className={cn(
                    'inline-flex items-center gap-1 rounded-full px-2 py-[3px] text-[10px] font-semibold',
                    'bg-white/88 backdrop-blur-md shadow ring-1 ring-slate-900/5 transition-all hover:scale-105',
                    off && 'opacity-45 saturate-0',
                  )}
                  title={off ? `Show ${k.label}` : `Hide ${k.label}`}
                >
                  <span className="w-2 h-2 rounded-full" style={{ background: k.hex }} />
                  <span className="text-slate-700">{k.label}</span>
                  <span className="text-slate-400">{count}</span>
                </button>
              )
            })}
          </motion.div>
        </div>

        {/* ── Top-right: controls ── */}
        <div className="absolute top-3 right-3 z-[500] flex items-center gap-1.5">
          <div className="relative">
            <IconBtn label="Basemap" onClick={() => setShowLayers(v => !v)} active={showLayers}><Layers className="w-4 h-4" /></IconBtn>
            <AnimatePresence>
              {showLayers && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.94, y: -6 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.94, y: -6 }}
                  className="absolute right-0 mt-1.5 w-36 rounded-xl bg-white/95 backdrop-blur-md shadow-xl ring-1 ring-slate-900/5 p-1"
                >
                  {BASEMAPS.map(b => (
                    <button
                      key={b.id}
                      onClick={() => { setBasemap(b.id); setShowLayers(false) }}
                      className={cn(
                        'w-full text-left px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors',
                        basemap === b.id ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-slate-100',
                      )}
                    >
                      {b.label}
                    </button>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
          <IconBtn label="Fit route" onClick={fitAll}><Compass className="w-4 h-4" /></IconBtn>
          <IconBtn label="Rebuild from itinerary" onClick={() => void load(true)}>
            <RefreshCw className={cn('w-4 h-4', refreshing && 'animate-spin')} />
          </IconBtn>
          <IconBtn label={fullscreen ? 'Exit fullscreen' : 'Fullscreen'} onClick={() => setFullscreen(v => !v)}>
            {fullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </IconBtn>
        </div>

        {/* ── Bottom: playback + day strip ── */}
        <div className="absolute bottom-0 inset-x-0 z-[500] p-3 pt-10 bg-gradient-to-t from-slate-900/45 via-slate-900/10 to-transparent">
          <div className="flex items-end gap-2">
            <div className="flex flex-col gap-1.5">
              <button
                onClick={() => setPlaying(p => !p)}
                disabled={stops.length < 2}
                className={cn(
                  'w-11 h-11 rounded-full flex items-center justify-center shadow-lg ring-1 ring-white/40 transition-all',
                  'bg-gradient-to-br from-brand-500 to-brand-600 text-white hover:scale-105 active:scale-95',
                  'disabled:opacity-40 disabled:hover:scale-100',
                )}
                title={playing ? 'Pause the fly-through' : 'Fly through the journey'}
              >
                {playing ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5 ml-0.5" />}
              </button>
              {progress < 1 && !playing && (
                <button
                  onClick={() => { setProgress(1); setSelectedId(null); fitAll() }}
                  className="w-11 h-7 rounded-full bg-white/90 backdrop-blur-md shadow ring-1 ring-slate-900/5 flex items-center justify-center text-slate-600 hover:text-slate-900"
                  title="Reset"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            <div ref={stripRef} className="jm-strip flex-1 flex gap-1.5 overflow-x-auto pb-1.5">
              {stops.map(s => {
                const k = KIND[s.kind] ?? KIND.tour
                const on = s.id === selectedId
                return (
                  <button
                    key={s.id}
                    data-day-id={s.id}
                    onClick={() => selectStop(s)}
                    onMouseEnter={() => setHoveredId(s.id)}
                    onMouseLeave={() => setHoveredId(null)}
                    className={cn(
                      'group/day flex-shrink-0 w-[124px] text-left rounded-xl px-2.5 py-2 transition-all duration-200',
                      'bg-white/90 backdrop-blur-md shadow ring-1 hover:-translate-y-0.5 hover:shadow-lg',
                      on ? 'ring-2 ring-brand-500 -translate-y-0.5 shadow-lg' : 'ring-slate-900/5',
                    )}
                  >
                    <div className="flex items-center gap-1.5">
                      <span
                        className="w-5 h-5 rounded-md flex items-center justify-center flex-shrink-0"
                        style={{ background: k.hex }}
                        dangerouslySetInnerHTML={{ __html: glyphSvg(s.kind, 11) }}
                      />
                      <span className="text-[10px] font-extrabold text-slate-900">D{s.dayNo}</span>
                      {s.date && <span className="text-[9px] text-slate-400 truncate">{formatDate(s.date)}</span>}
                    </div>
                    <p className="mt-1 text-[11px] font-semibold text-slate-800 leading-tight line-clamp-2">{s.place}</p>
                    {s.legKm != null && s.legKm > 0 && (
                      <p className="mt-0.5 text-[9px] text-slate-400">{s.legKm.toLocaleString()} km from D{stops[stops.indexOf(s) - 1]?.dayNo}</p>
                    )}
                  </button>
                )
              })}
            </div>
          </div>
        </div>

        {/* ── Detail drawer ── */}
        <AnimatePresence>
          {selected && (
            <ActivityDrawer
              key={selected.id}
              bookingRef={bookingRef}
              stop={selected}
              onClose={() => setSelectedId(null)}
              onPrev={() => {
                const i = stops.findIndex(s => s.id === selected.id)
                if (i > 0) selectStop(stops[i - 1])
              }}
              onNext={() => {
                const i = stops.findIndex(s => s.id === selected.id)
                if (i < stops.length - 1) selectStop(stops[i + 1])
              }}
            />
          )}
        </AnimatePresence>

        {journey.degraded && (
          <div className="absolute bottom-[86px] left-3 z-[500] rounded-lg bg-amber-50/95 backdrop-blur ring-1 ring-amber-200 px-2.5 py-1.5 text-[10px] text-amber-800 max-w-[220px]">
            Some days could not be placed precisely — pins are approximate.
          </div>
        )}
      </motion.div>
    </>
  )
}

// ─── Activity drawer ─────────────────────────────────────────────────────

/**
 * The pin's detail card. Slides over the map rather than pushing layout, so
 * the route stays visible behind it and the pin you clicked keeps its context.
 * Content is researched on first open and cached server-side by place.
 */
function ActivityDrawer({ bookingRef, stop, onClose, onPrev, onNext }: {
  bookingRef: string
  stop: JourneyStop
  onClose: () => void
  onPrev: () => void
  onNext: () => void
}) {
  const [brief, setBrief] = useState<ActivityBrief | null>(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [imgIndex, setImgIndex] = useState(0)
  const [broken, setBroken] = useState<Set<string>>(new Set())

  useEffect(() => {
    let cancelled = false
    setLoading(true); setFailed(false); setBrief(null); setImgIndex(0)
    ;(async () => {
      try {
        const res = await fetch(`/api/bookings/${bookingRef}/journey-map/activity`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            place: stop.place, title: stop.title, city: stop.city, country: stop.country,
          }),
        })
        const json = await readApiResponse<ActivityBrief>(res)
        if (!json.success || !json.data) throw new Error(json.error || 'brief unavailable')
        if (!cancelled) setBrief(json.data)
      } catch {
        if (!cancelled) setFailed(true)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [bookingRef, stop.place, stop.title, stop.city, stop.country])

  const k = KIND[stop.kind] ?? KIND.tour
  const images = (brief?.images ?? []).filter(u => !broken.has(u))
  const hero = images[Math.min(imgIndex, Math.max(images.length - 1, 0))]

  return (
    <motion.div
      initial={{ x: '104%', opacity: 0.4 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: '104%', opacity: 0.2 }}
      transition={{ type: 'spring', stiffness: 320, damping: 34 }}
      className="absolute top-0 right-0 bottom-0 z-[600] w-full sm:w-[368px] bg-white/97 backdrop-blur-xl shadow-2xl ring-1 ring-slate-900/10 flex flex-col"
    >
      {/* Hero */}
      <div className="relative h-44 flex-shrink-0 overflow-hidden" style={{ background: `linear-gradient(140deg, ${k.hex}, ${shade(k.hex, -32)})` }}>
        <AnimatePresence mode="wait">
          {hero ? (
            <motion.img
              key={hero}
              src={hero}
              alt={stop.place}
              initial={{ opacity: 0, scale: 1.08 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.5 }}
              onError={() => setBroken(prev => new Set(prev).add(hero))}
              className="absolute inset-0 w-full h-full object-cover"
            />
          ) : (
            <motion.div key="placeholder" className="absolute inset-0 flex items-center justify-center">
              {loading
                ? <Loader2 className="w-6 h-6 text-white/70 animate-spin" />
                : <ImageOff className="w-7 h-7 text-white/45" />}
            </motion.div>
          )}
        </AnimatePresence>

        <div className="absolute inset-0 bg-gradient-to-t from-slate-950/85 via-slate-950/25 to-slate-950/25" />

        <div className="absolute top-2.5 left-3 right-2.5 flex items-start justify-between gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white/22 backdrop-blur-md px-2.5 py-1 text-[10px] font-bold text-white ring-1 ring-white/30">
            <span dangerouslySetInnerHTML={{ __html: glyphSvg(stop.kind, 11) }} />
            Day {stop.dayNo} · {k.label}
          </span>
          <div className="flex items-center gap-1">
            <DrawerBtn onClick={onPrev} label="Previous day"><ChevronLeft className="w-4 h-4" /></DrawerBtn>
            <DrawerBtn onClick={onNext} label="Next day"><ChevronRight className="w-4 h-4" /></DrawerBtn>
            <DrawerBtn onClick={onClose} label="Close"><X className="w-4 h-4" /></DrawerBtn>
          </div>
        </div>

        <div className="absolute bottom-2.5 left-3 right-3">
          <h4 className="text-white font-bold text-[17px] leading-tight drop-shadow">{stop.place}</h4>
          <p className="text-white/80 text-[11px] mt-0.5 flex items-center gap-1.5">
            <MapPin className="w-3 h-3" />
            {[stop.city, stop.country].filter(Boolean).join(', ') || '—'}
            {stop.date && <><span className="opacity-50">·</span>{formatDate(stop.date)}</>}
          </p>
        </div>

        {images.length > 1 && (
          <div className="absolute bottom-1 right-3 flex gap-1">
            {images.slice(0, 5).map((u, i) => (
              <button
                key={u}
                onClick={() => setImgIndex(i)}
                className={cn('h-1 rounded-full transition-all', i === imgIndex ? 'w-4 bg-white' : 'w-1.5 bg-white/45 hover:bg-white/70')}
                aria-label={`Photo ${i + 1}`}
              />
            ))}
          </div>
        )}
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-4 py-3.5 space-y-4">
        <div>
          <p className="text-[10px] uppercase tracking-wider font-bold text-slate-400 mb-1">On the itinerary</p>
          <p className="text-[12.5px] text-slate-800 font-medium leading-snug">{stop.title}</p>
          {stop.legKm != null && stop.legKm > 0 && (
            <p className="mt-1.5 inline-flex items-center gap-1 text-[10px] text-slate-500 bg-slate-100 rounded-full px-2 py-0.5">
              <Navigation className="w-3 h-3" /> {stop.legKm.toLocaleString()} km from the previous stop
            </p>
          )}
        </div>

        {loading && <BriefSkeleton />}

        {!loading && failed && (
          <p className="text-xs text-slate-500">The destination brief could not be loaded. The pin and route above are unaffected.</p>
        )}

        {!loading && brief && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
            {brief.headline && (
              <p className="text-[13px] font-semibold text-slate-900 flex items-start gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-brand-500 flex-shrink-0 mt-0.5" />
                {brief.headline}
              </p>
            )}
            {brief.summary && <p className="text-[12.5px] text-slate-600 leading-relaxed">{brief.summary}</p>}

            {brief.highlights.length > 0 && (
              <div>
                <p className="text-[10px] uppercase tracking-wider font-bold text-slate-400 mb-1.5">Highlights</p>
                <ul className="space-y-1.5">
                  {brief.highlights.map((h, i) => (
                    <motion.li
                      key={h}
                      initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.05 * i }}
                      className="flex items-start gap-2 text-[12px] text-slate-700"
                    >
                      <span className="mt-1.5 w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: k.hex }} />
                      {h}
                    </motion.li>
                  ))}
                </ul>
              </div>
            )}

            {brief.bestTime && (
              <div className="flex items-start gap-2 rounded-xl bg-sky-50 ring-1 ring-sky-100 px-3 py-2">
                <Clock className="w-3.5 h-3.5 text-sky-500 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-[10px] uppercase tracking-wider font-bold text-sky-600">Best time</p>
                  <p className="text-[12px] text-sky-900">{brief.bestTime}</p>
                </div>
              </div>
            )}

            {brief.tips.length > 0 && (
              <div className="rounded-xl bg-amber-50 ring-1 ring-amber-100 px-3 py-2.5">
                <p className="text-[10px] uppercase tracking-wider font-bold text-amber-600 mb-1.5 flex items-center gap-1">
                  <Lightbulb className="w-3 h-3" /> Operator notes
                </p>
                <ul className="space-y-1">
                  {brief.tips.map(t => (
                    <li key={t} className="text-[12px] text-amber-900 leading-snug flex gap-1.5">
                      <span className="text-amber-400">›</span>{t}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {images.length > 1 && (
              <div>
                <p className="text-[10px] uppercase tracking-wider font-bold text-slate-400 mb-1.5">Photos</p>
                <div className="grid grid-cols-4 gap-1.5">
                  {images.map((u, i) => (
                    <button
                      key={u}
                      onClick={() => setImgIndex(i)}
                      className={cn(
                        'aspect-square rounded-lg overflow-hidden ring-1 transition-all hover:scale-105',
                        i === imgIndex ? 'ring-2 ring-brand-500' : 'ring-slate-200',
                      )}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={u} alt="" loading="lazy"
                        onError={() => setBroken(prev => new Set(prev).add(u))}
                        className="w-full h-full object-cover"
                      />
                    </button>
                  ))}
                </div>
              </div>
            )}

            <p className="text-[9.5px] text-slate-400 pt-1 border-t border-slate-100">
              Researched live from the open web · photos from Wikimedia Commons &amp; Wikipedia
            </p>
          </motion.div>
        )}
      </div>
    </motion.div>
  )
}

// ─── Small pieces ────────────────────────────────────────────────────────

function JourneyShell({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('overflow-hidden rounded-2xl border border-slate-200 bg-slate-50 shadow-card', className)}>
      {children}
    </div>
  )
}

function MapSkeleton() {
  return (
    <div className="h-[520px] relative overflow-hidden bg-gradient-to-br from-slate-100 to-slate-200">
      <div className="absolute inset-0 animate-pulse">
        {/* A faint suggestion of a route, so the loading state reads as a map. */}
        <svg viewBox="0 0 400 300" className="w-full h-full opacity-40">
          <path d="M60 240 Q 120 120 190 170 T 340 70" fill="none" stroke="#94a3b8" strokeWidth="2.5" strokeDasharray="6 10" strokeLinecap="round" />
          {[[60, 240], [190, 170], [340, 70]].map(([cx, cy]) => (
            <circle key={`${cx}`} cx={cx} cy={cy} r="9" fill="#cbd5e1" stroke="#94a3b8" strokeWidth="2" />
          ))}
        </svg>
      </div>
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
        <Loader2 className="w-6 h-6 text-slate-400 animate-spin" />
        <p className="text-xs font-medium text-slate-500">Plotting the itinerary…</p>
        <p className="text-[10px] text-slate-400">Reading each day and locating it on the map</p>
      </div>
    </div>
  )
}

function BriefSkeleton() {
  return (
    <div className="space-y-2.5 animate-pulse">
      <div className="h-3 bg-slate-200 rounded w-2/3" />
      <div className="h-2.5 bg-slate-100 rounded w-full" />
      <div className="h-2.5 bg-slate-100 rounded w-11/12" />
      <div className="h-2.5 bg-slate-100 rounded w-3/4" />
      <div className="h-16 bg-slate-100 rounded-xl mt-3" />
    </div>
  )
}

function IconBtn({ children, onClick, label, active }: {
  children: React.ReactNode; onClick: () => void; label: string; active?: boolean
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      className={cn(
        'w-8 h-8 rounded-lg flex items-center justify-center shadow-lg ring-1 ring-slate-900/5 backdrop-blur-md transition-all hover:scale-105 active:scale-95',
        active ? 'bg-brand-500 text-white' : 'bg-white/90 text-slate-600 hover:text-slate-900',
      )}
    >
      {children}
    </button>
  )
}

function DrawerBtn({ children, onClick, label }: { children: React.ReactNode; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      className="w-7 h-7 rounded-lg bg-white/22 backdrop-blur-md ring-1 ring-white/30 text-white flex items-center justify-center hover:bg-white/35 transition-colors"
    >
      {children}
    </button>
  )
}

// ─── Utilities ───────────────────────────────────────────────────────────

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string
  ))
}

function truncate(s: string, n: number) {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s
}

/** CSS.escape with a fallback — the ids are cuids, so this is belt-and-braces. */
function cssEscape(s: string) {
  return typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(s) : s.replace(/["\\]/g, '\\$&')
}

/** Darken (negative) or lighten (positive) a hex colour by a percentage. */
function shade(hex: string, pct: number) {
  const n = parseInt(hex.slice(1), 16)
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(v + (pct / 100) * 255)))
  return `#${((f(n >> 16) << 16) | (f((n >> 8) & 255) << 8) | f(n & 255)).toString(16).padStart(6, '0')}`
}
