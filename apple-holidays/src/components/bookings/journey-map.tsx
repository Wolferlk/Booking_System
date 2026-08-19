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
  ImageOff, ChevronLeft, ChevronRight, RefreshCw, Compass, SlidersHorizontal, Hand,
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

/**
 * The vehicle that carries guests *into* a stop of this kind — what actually
 * rides the route on the map. Keyed by the destination's kind, because a leg's
 * mode is decided by where it is going: you fly to an airport, coach to a tour,
 * board a boat for a cruise.
 */
const VEHICLE: Record<StopKind, string> = {
  arrival:    '\u2708\uFE0F',
  departure:  '\u2708\uFE0F',
  flight:     '\u2708\uFE0F',
  transfer:   '\uD83D\uDE97',
  city:       '\uD83D\uDE95',
  tour:       '\uD83D\uDE8C',
  attraction: '\uD83D\uDE90',
  cultural:   '\uD83D\uDE90',
  nature:     '\uD83D\uDE99',
  beach:      '\uD83D\uDE99',
  cruise:     '\uD83D\uDEA2',
  leisure:    '\uD83D\uDE97',
  hotel:      '\uD83D\uDE97',
}

/**
 * True when travel from `a` to `b` heads west.
 *
 * Emoji vehicles are drawn facing one way by the font, so a westbound car would
 * otherwise reverse into its destination. Mirroring the glyph is more legible
 * than rotating it, which turns a car upside-down on a southbound leg.
 */
function headingWest(a: LatLng, b: LatLng) {
  return b[1] < a[1]
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

// ─── Skin ────────────────────────────────────────────────────────────────

/**
 * The two surfaces this panel lives on.
 *
 * Operations sits on a white card; both traveller portals are dark glass. Only
 * the chrome changes — the pins, the route and the vehicle are identical,
 * because those carry the meaning and a guest and a file handler are reading
 * the same journey.
 */
type Skin = {
  shell: string; glass: string; glassSolid: string; btn: string
  title: string; body: string; muted: string; chip: string
  sheet: string; sheetTitle: string; sheetBody: string; sheetMuted: string
  strong: string; hairline: string
  skeleton: string; skelBar: string; skelBarAlt: string; grab: string
}

const SKIN: Record<'light' | 'dark', Skin> = {
  light: {
    shell:      'border-slate-200 bg-slate-50',
    glass:      'bg-white/88 ring-slate-900/5',
    glassSolid: 'bg-white/90 ring-slate-900/5',
    btn:        'bg-white/90 text-slate-600 hover:text-slate-900 ring-slate-900/5',
    title:      'text-slate-900',
    body:       'text-slate-600',
    muted:      'text-slate-400',
    chip:       'text-slate-700',
    sheet:      'bg-white/97 ring-slate-900/10',
    sheetTitle: 'text-slate-900',
    sheetBody:  'text-slate-600',
    sheetMuted: 'text-slate-400',
    strong:     'text-slate-800',
    hairline:   'border-slate-100',
    skeleton:   'from-slate-100 to-slate-200',
    skelBar:    'bg-slate-200',
    skelBarAlt: 'bg-slate-100',
    grab:       'bg-slate-900/15 hover:bg-slate-900/30',
  },
  dark: {
    shell:      'border-white/10 bg-slate-950',
    glass:      'bg-slate-900/80 ring-white/10',
    glassSolid: 'bg-slate-900/85 ring-white/10',
    btn:        'bg-slate-900/80 text-slate-300 hover:text-white ring-white/10',
    title:      'text-white',
    body:       'text-slate-300',
    muted:      'text-slate-500',
    chip:       'text-slate-200',
    sheet:      'bg-slate-950/95 ring-white/10',
    sheetTitle: 'text-white',
    sheetBody:  'text-slate-300',
    sheetMuted: 'text-slate-500',
    strong:     'text-slate-100',
    hairline:   'border-white/10',
    skeleton:   'from-slate-900 to-slate-800',
    skelBar:    'bg-white/10',
    skelBarAlt: 'bg-white/5',
    grab:       'bg-white/25 hover:bg-white/50',
  },
}

/**
 * Phone-sized viewport. Drives behaviour, not styling — anything that can be a
 * responsive class already is one; this is for the things that cannot be, like
 * whether the detail card should be draggable or which way it should slide in.
 */
function useIsMobile() {
  const [mobile, setMobile] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 639px)')
    const sync = () => setMobile(mq.matches)
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])
  return mobile
}

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

/* The route is drawn as three stacked strokes: a soft white halo that lifts it
   off busy tiles, a solid coloured spine, and a dashed overlay that crawls
   forward so the direction of travel reads even when the map is still. */
.jm-route-halo{stroke-linecap:round;stroke-linejoin:round}
.jm-route-base{stroke-linecap:round;stroke-linejoin:round}
.jm-route{stroke-dasharray:2 14;stroke-linecap:round;animation:jm-crawl 1s linear infinite}
@keyframes jm-crawl{to{stroke-dashoffset:-16}}

/* The lit stretch of road just behind the vehicle. */
.jm-trail{stroke-linecap:round;filter:drop-shadow(0 0 5px rgba(245,158,11,.85))}

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
.jm-ride{position:relative;width:40px;height:40px;display:flex;align-items:center;justify-content:center}
.jm-ride-glow{position:absolute;width:34px;height:34px;border-radius:50%;background:radial-gradient(circle,rgba(245,158,11,.55),transparent 70%);animation:jm-glow 1.6s ease-in-out infinite}
.jm-ride-emoji{position:relative;font-size:25px;line-height:1;filter:drop-shadow(0 3px 5px rgba(15,23,42,.45));animation:jm-bob 1.1s ease-in-out infinite;transition:transform .3s ease}
.jm-ride-idle .jm-ride-emoji{font-size:21px;opacity:.92}
.jm-ride-idle .jm-ride-glow{width:26px;height:26px;opacity:.7}
@keyframes jm-bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-3.5px)}}
@keyframes jm-glow{0%,100%{transform:scale(.85);opacity:.55}50%{transform:scale(1.15);opacity:.9}}

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
  .jm-ride-emoji,.jm-ride-glow{animation:none}
}
`

/** Marker HTML for a vehicle riding the route. */
function riderHtml(vehicle: string, idle: boolean) {
  return `<div class="jm-ride${idle ? ' jm-ride-idle' : ''}">` +
    `<span class="jm-ride-glow"></span>` +
    `<span class="jm-ride-emoji">${vehicle}</span>` +
    `</div>`
}

/**
 * Repaints a rider in place rather than rebuilding its icon.
 *
 * `marker.setIcon()` swaps the whole DOM node, which restarts the bob and glow
 * keyframes — at 60fps that reads as a stutter rather than a drive. Mutating
 * the glyph and its transform keeps the animation continuous across a leg change.
 */
function paintRider(marker: LeafletMarker | null, vehicle: string, flip: boolean) {
  const el = marker?.getElement()?.querySelector<HTMLElement>('.jm-ride-emoji')
  if (!el) return
  if (el.textContent !== vehicle) el.textContent = vehicle
  const t = flip ? 'scaleX(-1)' : 'scaleX(1)'
  if (el.style.transform !== t) el.style.transform = t
}

/** The lit stretch of route behind a rider at `t` along the path. */
function trailSlice(path: LatLng[], t: number, span = 0.07): LatLng[] {
  const end = Math.round(t * (path.length - 1))
  const start = Math.max(0, end - Math.round(span * path.length))
  return path.slice(start, Math.max(end + 1, start + 2))
}

// ─── Component ───────────────────────────────────────────────────────────

/**
 * One height that reads well in both homes: a tall column on the operations
 * page, and a phone screen in the traveller portal, where a fixed pixel height
 * either wastes the screen or pushes the rest of the trip below the fold.
 */
const MAP_HEIGHT = 'h-[68vh] min-h-[400px] max-h-[calc(100vh-7rem)] sm:h-[560px] xl:h-[720px]'

const LEG_MS = 1500      // time to fly one leg during playback
const DWELL_MS = 1100    // pause on each stop during playback

export interface JourneyMapProps {
  bookingRef: string
  className?: string
  /**
   * Signed portal-link token. Its presence is what makes this the traveller's
   * map: the token-gated public endpoints, guest-voiced copy, and no operator
   * affordances like the rebuild button.
   */
  portalToken?: string
  theme?: 'light' | 'dark'
}

export default function JourneyMap({ bookingRef, className, portalToken, theme = 'light' }: JourneyMapProps) {
  const guest = !!portalToken
  const skin: Skin = SKIN[theme]
  const isMobile = useIsMobile()
  const [journey, setJourney] = useState<Journey | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  // Two separate ideas, deliberately not one. `activeId` is which stop the map
  // is looking at — playback moves it constantly. `selectedId` is the far
  // heavier "the user asked to read about this one", which opens the detail
  // card and spends a model call. Merging them made the fly-through open a
  // card on every stop, covering the very map it was flying over.
  const [activeId, setActiveId] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [hiddenKinds, setHiddenKinds] = useState<Set<StopKind>>(new Set())
  const [basemap, setBasemap] = useState<BasemapId>(theme === 'dark' ? 'midnight' : 'voyager')
  const [showLayers, setShowLayers] = useState(false)
  const [showLegend, setShowLegend] = useState(false)
  /**
   * Whether the map gets to own touch gestures.
   *
   * On a phone this panel sits inside a scrolling trip page, and Leaflet's
   * dragging handler swallows every vertical swipe that starts over the map —
   * the reader gets stuck panning Sri Lanka instead of scrolling to their
   * hotels. Off by default on touch, so a swipe scrolls the page while pins,
   * the day strip and the fly-through all still work; "Explore" hands the
   * gestures over when panning is actually what someone wants.
   */
  const [interactive, setInteractive] = useState(true)
  const [fullscreen, setFullscreen] = useState(false)
  const [playing, setPlaying] = useState(false)
  // Leaflet arrives via a dynamic import, so the map exists a tick after the
  // effects that draw on it first run. Storing readiness in state (rather than
  // only on the ref) is what re-runs those effects once there is a map to draw
  // on — a ref assignment inside the async callback renders nothing.
  const [mapReady, setMapReady] = useState(false)
  const [progress, setProgress] = useState(1)   // 0..1 along the whole route

  const containerRef = useRef<HTMLDivElement | null>(null)
  // Read inside `flyTo`, which must stay referentially stable for the playback
  // effect — refs let it see current state without re-triggering the animation.
  const cardOpenRef = useRef(false)
  /** True only when the card is the right-hand drawer, not the bottom sheet. */
  const sideCardRef = useRef(false)
  const mapRef = useRef<LeafletMap | null>(null)
  // The Leaflet module handle, populated by the dynamic import in the mount
  // effect. `typeof import(...)` is a type-only reference, so nothing is pulled
  // into the bundle here.
  const LRef = useRef<LeafletNS | null>(null)
  const tileRef = useRef<LeafletTileLayer | null>(null)
  const routeRef = useRef<{ halo: LeafletPolyline; base: LeafletPolyline; live: LeafletPolyline } | null>(null)
  const trailRef = useRef<LeafletPolyline | null>(null)
  const idleRiderRef = useRef<LeafletMarker | null>(null)
  const idleRafRef = useRef<number | null>(null)
  const pinsRef = useRef<Map<string, LeafletMarker>>(new Map())
  const hotelPinsRef = useRef<LeafletMarker[]>([])
  const travellerRef = useRef<LeafletMarker | null>(null)
  const rafRef = useRef<number | null>(null)
  const stripRef = useRef<HTMLDivElement | null>(null)

  const stops = useMemo(() => journey?.stops ?? [], [journey])
  useEffect(() => { cardOpenRef.current = selectedId != null }, [selectedId])
  useEffect(() => { sideCardRef.current = fullscreen && !isMobile }, [fullscreen, isMobile])
  // Touch devices start locked; fullscreen is an explicit request to explore.
  useEffect(() => { setInteractive(!isMobile || fullscreen) }, [isMobile, fullscreen])
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
      const url = portalToken
        ? `/api/public/journey-map/${bookingRef}?t=${encodeURIComponent(portalToken)}`
        : `/api/bookings/${bookingRef}/journey-map${refresh ? '?refresh=1' : ''}`
      const res = await fetch(url)
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
  }, [bookingRef, portalToken])

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
      setMapReady(true)
    })()

    return () => { cancelled = true }
  }, [stops, basemap])

  // Tear the map down only when the component itself goes away.
  useEffect(() => () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    if (idleRafRef.current) cancelAnimationFrame(idleRafRef.current)
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
  }, [basemap, mapReady])

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
    // Halo → spine → crawling dashes. Three strokes rather than one, because a
    // single thin line disappears into the road network on a street basemap.
    const halo = L.polyline(geometry.flat, {
      className: 'jm-route-halo',
      color: dark ? '#0f172a' : '#ffffff',
      weight: 10, opacity: dark ? 0.55 : 0.9,
    }).addTo(map)
    const base = L.polyline(geometry.flat, {
      className: 'jm-route-base',
      color: dark ? '#38bdf8' : '#1d4ed8',
      weight: 4.5, opacity: 0.92,
    }).addTo(map)
    const live = L.polyline(geometry.flat, {
      className: 'jm-route',
      color: '#ffffff',
      weight: 2.4, opacity: 0.95,
    }).addTo(map)
    // The glowing stretch of road just behind whichever vehicle is riding.
    const trail = L.polyline([], {
      className: 'jm-trail',
      color: '#f59e0b',
      weight: 5.5, opacity: 0.95,
    }).addTo(map)
    routeRef.current = { halo, base, live }
    trailRef.current = trail

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
      halo.remove(); base.remove(); live.remove(); trail.remove()
      trailRef.current = null
      pins.forEach(x => x.remove()); pins.clear()
      hotelPins.forEach(x => x.remove())
    }
  }, [stops, geometry, journey?.hotels, basemap, mapReady])

  // ── Selection / hover / filter styling ─────────────────────────────────

  useEffect(() => {
    const active = hoveredId ?? selectedId ?? activeId
    pinsRef.current.forEach((marker, id) => {
      const el = marker.getElement()
      if (!el) return
      const stop = stops.find(s => s.id === id)
      el.classList.toggle('jm-pin-active', id === active)
      el.classList.toggle('jm-pin-dim', !!stop && hiddenKinds.has(stop.kind))
    })
  }, [hoveredId, selectedId, activeId, hiddenKinds, stops])

  // ── Playback ───────────────────────────────────────────────────────────

  /**
   * Fly to a stop, biasing the centre so the pin lands in the part of the map
   * the detail card is not covering — up and out of the bottom sheet on a
   * narrow panel, left of the side drawer in fullscreen. Without this the pin
   * you just clicked ends up underneath the card describing it.
   */
  const flyTo = useCallback((s: JourneyStop, zoom?: number) => {
    const L = LRef.current, map = mapRef.current
    if (!L || !map) return
    const z = zoom ?? Math.max(map.getZoom(), 9)
    const size = map.getSize()
    const card = cardOpenRef.current

    let target = L.latLng(s.lat, s.lng)
    if (card) {
      const pt = map.project(target, z)
      if (sideCardRef.current) pt.x += size.x * 0.16   // side drawer on the right
      else pt.y += size.y * 0.22                        // bottom sheet
      target = map.unproject(pt, z)
    }
    map.flyTo(target, z, { duration: 1.05 })
  }, [])

  useEffect(() => {
    if (!playing || stops.length < 2) return
    const L = LRef.current, map = mapRef.current
    if (!L || !map) return

    // Restart from the top when replaying a finished run.
    let legIndex = progress >= 0.999 ? 0 : Math.floor(progress * (stops.length - 1))
    let phase: 'dwell' | 'travel' = 'dwell'
    let phaseStart = performance.now()

    setActiveId(stops[legIndex].id)
    flyTo(stops[legIndex], 9)

    const traveller = L.marker([stops[legIndex].lat, stops[legIndex].lng], {
      icon: L.divIcon({
        className: 'jm-traveller',
        html: riderHtml(VEHICLE[stops[legIndex].kind] ?? '\uD83D\uDE97', false),
        iconSize: [40, 40], iconAnchor: [20, 20],
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

        const here = walk(geometry.flat, legT)
        traveller.setLatLng(here)
        // The vehicle is chosen by where this leg is heading, and mirrored so
        // it always faces the way it is travelling.
        const dest = stops[Math.min(legIndex + 1, stops.length - 1)]
        paintRider(
          traveller,
          VEHICLE[dest.kind] ?? '\uD83D\uDE97',
          headingWest([stops[legIndex].lat, stops[legIndex].lng], [dest.lat, dest.lng]),
        )
        trailRef.current?.setLatLngs(trailSlice(geometry.flat, legT))

        if (t >= 1) {
          legIndex += 1
          if (legIndex >= stops.length - 1) {
            setProgress(1)
            setActiveId(stops[stops.length - 1].id)
            flyTo(stops[stops.length - 1], 9)
            setPlaying(false)
            return
          }
          setActiveId(stops[legIndex].id)
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
      trailRef.current?.setLatLngs([])
    }
    // `progress` is read once to decide where to resume; re-running on every
    // frame would restart the animation, so it is deliberately not a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, stops, geometry, flyTo, mapReady])

  /**
   * The idle ride: when nothing is playing, a vehicle drives the finished route
   * on a slow loop, trailing a lit stretch of road behind it.
   *
   * This is what makes the route legible at a glance. A static polyline between
   * seven pins does not tell you which end is day one; a car pulling away from
   * Sigiriya towards Kandy does, without anyone pressing anything.
   */
  useEffect(() => {
    if (playing || stops.length < 2 || geometry.flat.length === 0) return
    const L = LRef.current, map = mapRef.current
    if (!L || !map) return
    if (typeof window !== 'undefined' &&
        window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return

    const rider = L.marker(geometry.flat[0], {
      icon: L.divIcon({
        className: 'jm-traveller',
        html: riderHtml(VEHICLE[stops[1]?.kind ?? 'transfer'] ?? '\uD83D\uDE97', true),
        iconSize: [40, 40], iconAnchor: [20, 20],
      }),
      zIndexOffset: 1100,
      interactive: false,
    }).addTo(map)
    idleRiderRef.current = rider

    // One lap covers every leg at a steady pace, then rests briefly at the end
    // before restarting, so the loop reads as a journey rather than a treadmill.
    const lapMs = Math.max(6000, (stops.length - 1) * 2600)
    const restMs = 1400
    const start = performance.now()

    const tick = (now: number) => {
      const cycle = (now - start) % (lapMs + restMs)
      const t = Math.min(cycle / lapMs, 1)

      rider.setLatLng(walk(geometry.flat, t))
      const legIndex = Math.min(Math.floor(t * (stops.length - 1)), stops.length - 2)
      const from = stops[legIndex]
      const to = stops[legIndex + 1]
      paintRider(rider, VEHICLE[to.kind] ?? '\uD83D\uDE97', headingWest([from.lat, from.lng], [to.lat, to.lng]))
      trailRef.current?.setLatLngs(trailSlice(geometry.flat, t))

      idleRafRef.current = requestAnimationFrame(tick)
    }
    idleRafRef.current = requestAnimationFrame(tick)

    return () => {
      if (idleRafRef.current) cancelAnimationFrame(idleRafRef.current)
      rider.remove()
      idleRiderRef.current = null
      trailRef.current?.setLatLngs([])
    }
  }, [playing, stops, geometry, mapReady])

  /** Draw only the travelled portion while playing; the whole route otherwise. */
  useEffect(() => {
    const route = routeRef.current
    if (!route || geometry.flat.length === 0) return
    const upto = Math.max(2, Math.round(progress * (geometry.flat.length - 1)) + 1)
    const travelled = geometry.flat.slice(0, upto)
    // The halo stays whole so the road ahead is still readable; the coloured
    // spine and its dashes fill in behind the vehicle as it drives.
    route.base.setLatLngs(travelled)
    route.live.setLatLngs(travelled)
  }, [progress, geometry, mapReady])

  // ── Fullscreen ─────────────────────────────────────────────────────────

  /**
   * Keep Leaflet's idea of its own size honest.
   *
   * Leaflet only lays tiles out for the size it believes it has, and it learns
   * that size once. Entering fullscreen resizes the container over ~300ms of
   * animation, so a single delayed `invalidateSize()` either fires mid-flight
   * and locks in a half-size viewport, or fires late and leaves grey gaps —
   * which is exactly the blank fullscreen map. Observing the element instead
   * re-lays the tiles on every frame of the resize, and also covers the
   * sidebar collapsing and the browser window changing.
   */
  useEffect(() => {
    const el = containerRef.current
    const map = mapRef.current
    if (!el || !map || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => map.invalidateSize({ animate: false }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [mapReady])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    for (const h of [map.dragging, map.touchZoom, map.doubleClickZoom] as const) {
      interactive ? h.enable() : h.disable()
    }
  }, [interactive, mapReady])

  useEffect(() => {
    const L = LRef.current, map = mapRef.current
    if (!L || !map) return
    // Fullscreen is a deliberate "I am reading the map now" mode, so the wheel
    // becomes a zoom there and goes back to scrolling the page on exit.
    fullscreen ? map.scrollWheelZoom.enable() : map.scrollWheelZoom.disable()
    // The aspect ratio changes a lot between a 540px column and the viewport,
    // so a route framed for one is badly framed for the other.
    const id = setTimeout(() => {
      map.invalidateSize({ animate: false })
      if (stops.length > 0 && !cardOpenRef.current) {
        map.flyToBounds(L.latLngBounds(stops.map(s => [s.lat, s.lng] as LatLng)),
          { padding: [64, 64], maxZoom: 11, duration: 0.6 })
      }
    }, 340)
    return () => clearTimeout(id)
  }, [fullscreen, mapReady, stops])

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
  }, [stops, mapReady])

  useEffect(() => {
    if (!fullscreen) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setFullscreen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [fullscreen])

  // Keep the day strip tracking the selected stop during playback.
  useEffect(() => {
    const focus = selectedId ?? activeId
    if (!focus || !stripRef.current) return
    stripRef.current.querySelector<HTMLElement>(`[data-day-id="${cssEscape(focus)}"]`)
      ?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' })
  }, [selectedId, activeId])

  const fitAll = useCallback(() => {
    const L = LRef.current, map = mapRef.current
    if (!L || !map || stops.length === 0) return
    map.flyToBounds(L.latLngBounds(stops.map(s => [s.lat, s.lng] as LatLng)), { padding: [56, 56], maxZoom: 11, duration: 0.9 })
  }, [stops])

  const selectStop = useCallback((s: JourneyStop) => {
    setPlaying(false)
    setActiveId(s.id)
    setSelectedId(s.id)
    // The card animates in over ~250ms; re-framing after it has taken up its
    // space is what actually keeps the pin visible.
    cardOpenRef.current = true
    flyTo(s, 10)
    setTimeout(() => flyTo(s, 10), 280)
  }, [flyTo])

  // ── Render ─────────────────────────────────────────────────────────────

  const dark = BASEMAPS.find(b => b.id === basemap)?.dark ?? false

  if (loading) return <JourneyShell className={className} skin={skin}><MapSkeleton skin={skin} /></JourneyShell>

  if (error || !journey || stops.length === 0) {
    return (
      <JourneyShell className={className} skin={skin}>
        <div className="h-[420px] sm:h-[520px] flex flex-col items-center justify-center gap-3 text-center px-8">
          <div className={cn('w-12 h-12 rounded-2xl flex items-center justify-center', theme === 'dark' ? 'bg-white/5' : 'bg-slate-100')}>
            <Compass className={cn('w-6 h-6', skin.muted)} />
          </div>
          <p className={cn('text-sm font-medium', skin.strong)}>
            {guest
              ? 'Your map is on its way'
              : error ? 'The journey map could not be built' : 'No mappable places on this itinerary'}
          </p>
          <p className={cn('text-xs max-w-xs', skin.body)}>
            {guest
              ? 'We will plot your route here as soon as your day-by-day plan is confirmed.'
              : error ?? 'The itinerary days do not name a place we can pin. Add a location to the day titles and rebuild.'}
          </p>
          {!guest && (
            <button
              onClick={() => void load(true)}
              className="mt-1 inline-flex items-center gap-1.5 text-xs font-semibold text-brand-600 hover:text-brand-700"
            >
              <RefreshCw className={cn('w-3.5 h-3.5', refreshing && 'animate-spin')} /> Rebuild map
            </button>
          )}
        </div>
      </JourneyShell>
    )
  }

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: MAP_CSS }} />
      {fullscreen && <div className="fixed inset-0 z-[59] bg-slate-950/70 backdrop-blur-sm" onClick={() => setFullscreen(false)} />}

      {/* No framer `layout` prop here on purpose: animating the box size
          scales its children, and a scaled Leaflet pane renders as smeared or
          missing tiles for the length of the animation. The container snaps to
          its new size and the ResizeObserver above re-lays the tiles. */}
      <div
        className={cn(
          'jm-wrap group relative overflow-hidden border shadow-card flex flex-col',
          dark ? 'border-white/10 bg-slate-950' : skin.shell,
          fullscreen
            ? 'fixed inset-0 sm:inset-4 z-[60] rounded-none sm:rounded-2xl shadow-2xl'
            : cn('rounded-2xl', className),
        )}
      >
        {/* ── The map ── */}
        <div
          ref={containerRef}
          // Taller than a typical card: the bottom sheet takes 58% when a stop
          // is open, and what is left has to still read as a map.
          className={cn(
            'w-full',
            fullscreen ? 'flex-1 min-h-0' : MAP_HEIGHT,
            // Belt and braces with `dragging.disable()`: tells the browser it
            // may scroll the page from a gesture that starts here.
            !interactive && 'touch-pan-y',
          )}
        />

        {/* ── Top-left: what this journey is ── */}
        <div className="pointer-events-none absolute top-3 left-3 z-[500] flex flex-col gap-2">
          <motion.div
            initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
            className={cn('pointer-events-auto rounded-xl backdrop-blur-md shadow-lg ring-1 px-2.5 py-1.5 sm:px-3 sm:py-2', skin.glass)}
          >
            <div className="flex items-center gap-1.5 text-[9px] sm:text-[10px] font-bold uppercase tracking-wider text-brand-500">
              <Route className="w-3 h-3" /> {guest ? 'Your journey' : 'Journey'}
            </div>
            <p className={cn('text-[13px] sm:text-sm font-semibold leading-tight mt-0.5', skin.title)}>
              {journey.countries.join(' · ') || 'Route'}
            </p>
            <div className={cn('flex items-center gap-2.5 sm:gap-3 mt-1 sm:mt-1.5 text-[10px] sm:text-[11px]', skin.body)}>
              <span className="inline-flex items-center gap-1"><MapPin className={cn('w-3 h-3', skin.muted)} />{stops.length} stops</span>
              <span className="inline-flex items-center gap-1"><Navigation className={cn('w-3 h-3', skin.muted)} />{journey.totalKm.toLocaleString()} km</span>
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
            className={cn(
              'pointer-events-auto gap-1',
              // A wrapped legend eats a phone's map. On mobile it collapses
              // behind the filter button and opens as one scrolling row.
              'hidden sm:flex sm:flex-wrap sm:max-w-[230px]',
              showLegend && '!flex max-w-[calc(100vw-6rem)] overflow-x-auto jm-strip flex-nowrap sm:flex-wrap',
            )}
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
                    'inline-flex flex-shrink-0 items-center gap-1 rounded-full px-2 py-[3px] text-[10px] font-semibold',
                    'backdrop-blur-md shadow ring-1 transition-all hover:scale-105', skin.glass,
                    off && 'opacity-45 saturate-0',
                  )}
                  title={off ? `Show ${k.label}` : `Hide ${k.label}`}
                >
                  <span className="w-2 h-2 rounded-full" style={{ background: k.hex }} />
                  <span className={skin.chip}>{k.label}</span>
                  <span className={skin.muted}>{count}</span>
                </button>
              )
            })}
          </motion.div>
        </div>

        {/* ── Top-right: controls ── */}
        <div className="absolute top-3 right-3 z-[500] flex items-center gap-1.5">
          {!fullscreen && (
            <button
              onClick={() => setInteractive(v => !v)}
              className={cn(
                'sm:hidden inline-flex items-center gap-1 h-9 px-2.5 rounded-lg text-[10px] font-bold shadow-lg ring-1 backdrop-blur-md transition-all active:scale-95',
                interactive ? 'bg-brand-500 text-white ring-brand-400/40' : skin.btn,
              )}
            >
              <Hand className="w-3.5 h-3.5" />
              {interactive ? 'Done' : 'Explore'}
            </button>
          )}
          {/* Filters live behind a button on phones, where the legend would
              otherwise cover a third of the map. */}
          <div className="sm:hidden">
            <IconBtn label="Filter stops" skin={skin} onClick={() => setShowLegend(v => !v)} active={showLegend}>
              <SlidersHorizontal className="w-4 h-4" />
            </IconBtn>
          </div>
          <div className="relative">
            <IconBtn label="Basemap" skin={skin} onClick={() => setShowLayers(v => !v)} active={showLayers}><Layers className="w-4 h-4" /></IconBtn>
            <AnimatePresence>
              {showLayers && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.94, y: -6 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.94, y: -6 }}
                  className={cn('absolute right-0 mt-1.5 w-36 rounded-xl backdrop-blur-md shadow-xl ring-1 p-1', skin.glassSolid)}
                >
                  {BASEMAPS.map(b => (
                    <button
                      key={b.id}
                      onClick={() => { setBasemap(b.id); setShowLayers(false) }}
                      className={cn(
                        'w-full text-left px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors',
                        basemap === b.id
                          ? 'bg-brand-500/15 text-brand-500'
                          : cn(skin.body, theme === 'dark' ? 'hover:bg-white/10' : 'hover:bg-slate-100'),
                      )}
                    >
                      {b.label}
                    </button>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
          <IconBtn label="Fit route" skin={skin} onClick={fitAll}><Compass className="w-4 h-4" /></IconBtn>
          {!guest && (
            <IconBtn label="Rebuild from itinerary" skin={skin} onClick={() => void load(true)}>
              <RefreshCw className={cn('w-4 h-4', refreshing && 'animate-spin')} />
            </IconBtn>
          )}
          <IconBtn label={fullscreen ? 'Exit fullscreen (Esc)' : 'Fullscreen'} skin={skin} onClick={() => setFullscreen(v => !v)}>
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
                  'w-12 h-12 sm:w-11 sm:h-11 rounded-full flex items-center justify-center shadow-lg ring-1 ring-white/40 transition-all',
                  'bg-gradient-to-br from-brand-500 to-brand-600 text-white hover:scale-105 active:scale-95',
                  'disabled:opacity-40 disabled:hover:scale-100',
                )}
                title={playing ? 'Pause the fly-through' : 'Fly through the journey'}
              >
                {playing ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5 ml-0.5" />}
              </button>
              {progress < 1 && !playing && (
                <button
                  onClick={() => { setProgress(1); setActiveId(null); setSelectedId(null); fitAll() }}
                  className={cn('w-12 h-8 sm:w-11 sm:h-7 rounded-full backdrop-blur-md shadow ring-1 flex items-center justify-center', skin.btn)}
                  title="Reset"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Scroll-snapped on touch so a flick lands on a day rather than
                between two. */}
            <div ref={stripRef} className="jm-strip flex-1 flex gap-1.5 overflow-x-auto pb-1.5 snap-x snap-mandatory">
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
                      'group/day flex-shrink-0 w-[132px] sm:w-[124px] snap-center text-left rounded-xl px-2.5 py-2 transition-all duration-200',
                      'backdrop-blur-md shadow ring-1 hover:-translate-y-0.5 hover:shadow-lg active:scale-95',
                      skin.glassSolid,
                      on && 'ring-2 !ring-brand-500 -translate-y-0.5 shadow-lg',
                    )}
                  >
                    <div className="flex items-center gap-1.5">
                      <span
                        className="w-5 h-5 rounded-md flex items-center justify-center flex-shrink-0"
                        style={{ background: k.hex }}
                        dangerouslySetInnerHTML={{ __html: glyphSvg(s.kind, 11) }}
                      />
                      <span className={cn('text-[10px] font-extrabold', skin.title)}>D{s.dayNo}</span>
                      {s.date && <span className={cn('text-[9px] truncate', skin.muted)}>{formatDate(s.date)}</span>}
                    </div>
                    <p className={cn('mt-1 text-[11px] font-semibold leading-tight line-clamp-2', skin.strong)}>{s.place}</p>
                    {s.legKm != null && s.legKm > 0 && (
                      <p className={cn('mt-0.5 text-[9px]', skin.muted)}>{s.legKm.toLocaleString()} km from D{stops[stops.indexOf(s) - 1]?.dayNo}</p>
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
              variant={fullscreen && !isMobile ? 'side' : 'sheet'}
              skin={skin}
              guest={guest}
              portalToken={portalToken}
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
          <div className="absolute bottom-[86px] left-3 z-[500] rounded-lg bg-amber-500/15 backdrop-blur ring-1 ring-amber-400/30 px-2.5 py-1.5 text-[10px] text-amber-600 max-w-[220px]">
            Some days could not be placed precisely — pins are approximate.
          </div>
        )}
      </div>
    </>
  )
}

// ─── Activity drawer ─────────────────────────────────────────────────────

/**
 * The pin's detail card.
 *
 * It floats over the map rather than pushing layout, but never over all of it:
 * inside the booking page the panel is only ~540px wide, so a full-height side
 * drawer swallowed the entire map and left the route it was describing
 * invisible. There it rises as a bottom sheet capped at 58% of the height,
 * with `flyTo` biasing the pin up into the half that stays clear.
 *
 * Content is researched on first open and cached server-side by place.
 */
function ActivityDrawer({ bookingRef, stop, variant, skin, guest, portalToken, onClose, onPrev, onNext }: {
  bookingRef: string
  stop: JourneyStop
  skin: Skin
  guest: boolean
  portalToken?: string
  /** 'sheet' rises from the bottom and leaves the map's top half readable;
   *  'side' is the fullscreen layout, where there is width to spare. */
  variant: 'sheet' | 'side'
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
        const url = portalToken
          ? `/api/public/journey-map/${bookingRef}/activity?t=${encodeURIComponent(portalToken)}`
          : `/api/bookings/${bookingRef}/journey-map/activity`
        const res = await fetch(url, {
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
  }, [bookingRef, portalToken, stop.place, stop.title, stop.city, stop.country])

  const k = KIND[stop.kind] ?? KIND.tour
  const images = (brief?.images ?? []).filter(u => !broken.has(u))
  const hero = images[Math.min(imgIndex, Math.max(images.length - 1, 0))]

  const sheet = variant === 'sheet'

  return (
    <motion.div
      initial={sheet ? { y: '104%' } : { x: '104%', opacity: 0.4 }}
      animate={sheet ? { y: 0 } : { x: 0, opacity: 1 }}
      exit={sheet ? { y: '104%' } : { x: '104%', opacity: 0.2 }}
      transition={{ type: 'spring', stiffness: 320, damping: 34 }}
      // A sheet you can flick away is how every other card on a phone behaves;
      // asking for a precise tap on a small close button is not.
      drag={sheet ? 'y' : false}
      dragConstraints={{ top: 0, bottom: 0 }}
      dragElastic={{ top: 0, bottom: 0.5 }}
      onDragEnd={(_, info) => { if (info.offset.y > 90 || info.velocity.y > 550) onClose() }}
      className={cn(
        'absolute z-[600] backdrop-blur-xl shadow-2xl ring-1 flex flex-col', skin.sheet,
        sheet
          ? 'left-0 right-0 bottom-0 max-h-[62%] rounded-t-2xl overflow-hidden touch-pan-y'
          : 'top-0 right-0 bottom-0 w-full sm:w-[380px]',
      )}
    >
      {sheet && (
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute top-1.5 left-1/2 -translate-x-1/2 z-10 w-10 h-1.5 rounded-full bg-white/70 hover:bg-white"
        />
      )}

      {/* Hero */}
      <div
        className={cn('relative flex-shrink-0 overflow-hidden', sheet ? 'h-32' : 'h-44')}
        style={{ background: `linear-gradient(140deg, ${k.hex}, ${shade(k.hex, -32)})` }}
      >
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
      <div className="flex-1 overflow-y-auto px-4 py-3.5 space-y-4 overscroll-contain">
        <div>
          <p className={cn('text-[10px] uppercase tracking-wider font-bold mb-1', skin.sheetMuted)}>
            {guest ? 'On your plan' : 'On the itinerary'}
          </p>
          <p className={cn('text-[12.5px] font-medium leading-snug', skin.strong)}>{stop.title}</p>
          {stop.legKm != null && stop.legKm > 0 && (
            <p className={cn('mt-1.5 inline-flex items-center gap-1 text-[10px] rounded-full px-2 py-0.5', skin.sheetBody, skin.glassSolid)}>
              <Navigation className="w-3 h-3" /> {stop.legKm.toLocaleString()} km from the previous stop
            </p>
          )}
        </div>

        {loading && <BriefSkeleton skin={skin} />}

        {!loading && failed && (
          <p className={cn('text-xs', skin.sheetMuted)}>
            {guest
              ? 'We could not load the details for this stop just now — please try again in a moment.'
              : 'The destination brief could not be loaded. The pin and route above are unaffected.'}
          </p>
        )}

        {!loading && brief && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
            {brief.headline && (
              <p className={cn('text-[13px] font-semibold flex items-start gap-1.5', skin.sheetTitle)}>
                <Sparkles className="w-3.5 h-3.5 text-brand-500 flex-shrink-0 mt-0.5" />
                {brief.headline}
              </p>
            )}
            {brief.summary && <p className={cn('text-[12.5px] leading-relaxed', skin.sheetBody)}>{brief.summary}</p>}

            {brief.highlights.length > 0 && (
              <div>
                <p className={cn('text-[10px] uppercase tracking-wider font-bold mb-1.5', skin.sheetMuted)}>Highlights</p>
                <ul className="space-y-1.5">
                  {brief.highlights.map((h, i) => (
                    <motion.li
                      key={h}
                      initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.05 * i }}
                      className={cn('flex items-start gap-2 text-[12px]', skin.sheetBody)}
                    >
                      <span className="mt-1.5 w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: k.hex }} />
                      {h}
                    </motion.li>
                  ))}
                </ul>
              </div>
            )}

            {brief.bestTime && (
              <div className="flex items-start gap-2 rounded-xl bg-sky-500/10 ring-1 ring-sky-400/25 px-3 py-2">
                <Clock className="w-3.5 h-3.5 text-sky-500 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-[10px] uppercase tracking-wider font-bold text-sky-500">Best time</p>
                  <p className={cn('text-[12px]', skin.sheetBody)}>{brief.bestTime}</p>
                </div>
              </div>
            )}

            {brief.tips.length > 0 && (
              <div className="rounded-xl bg-amber-500/10 ring-1 ring-amber-400/25 px-3 py-2.5">
                <p className="text-[10px] uppercase tracking-wider font-bold text-amber-500 mb-1.5 flex items-center gap-1">
                  <Lightbulb className="w-3 h-3" /> {guest ? 'Good to know' : 'Operator notes'}
                </p>
                <ul className="space-y-1">
                  {brief.tips.map(t => (
                    <li key={t} className={cn('text-[12px] leading-snug flex gap-1.5', skin.sheetBody)}>
                      <span className="text-amber-500">›</span>{t}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {images.length > 1 && (
              <div>
                <p className={cn('text-[10px] uppercase tracking-wider font-bold mb-1.5', skin.sheetMuted)}>Photos</p>
                <div className="grid grid-cols-4 gap-1.5">
                  {images.map((u, i) => (
                    <button
                      key={u}
                      onClick={() => setImgIndex(i)}
                      className={cn(
                        'aspect-square rounded-lg overflow-hidden ring-1 transition-all hover:scale-105 active:scale-95',
                        i === imgIndex ? 'ring-2 ring-brand-500' : 'ring-black/10',
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

            <p className={cn('text-[9.5px] pt-1 border-t', skin.sheetMuted, skin.hairline)}>
              Researched live from the open web · photos from Wikimedia Commons &amp; Wikipedia
            </p>
          </motion.div>
        )}
      </div>
    </motion.div>
  )
}

// ─── Small pieces ────────────────────────────────────────────────────────

function JourneyShell({ children, className, skin }: {
  children: React.ReactNode; className?: string; skin: Skin
}) {
  return (
    <div className={cn('overflow-hidden rounded-2xl border shadow-card', skin.shell, className)}>
      {children}
    </div>
  )
}

function MapSkeleton({ skin }: { skin: Skin }) {
  return (
    <div className={cn(MAP_HEIGHT, 'relative overflow-hidden bg-gradient-to-br', skin.skeleton)}>
      <div className="absolute inset-0 animate-pulse">
        {/* A faint suggestion of a route, so the loading state reads as a map. */}
        <svg viewBox="0 0 400 300" className="w-full h-full opacity-40">
          <path d="M60 240 Q 120 120 190 170 T 340 70" fill="none" stroke="#94a3b8" strokeWidth="2.5" strokeDasharray="6 10" strokeLinecap="round" />
          {[[60, 240], [190, 170], [340, 70]].map(([cx, cy]) => (
            <circle key={`${cx}`} cx={cx} cy={cy} r="9" fill="#cbd5e1" stroke="#94a3b8" strokeWidth="2" />
          ))}
        </svg>
      </div>
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-6 text-center">
        <Loader2 className={cn('w-6 h-6 animate-spin', skin.muted)} />
        <p className={cn('text-xs font-medium', skin.body)}>Plotting the journey…</p>
        <p className={cn('text-[10px]', skin.muted)}>Reading each day and locating it on the map</p>
      </div>
    </div>
  )
}

function BriefSkeleton({ skin }: { skin: Skin }) {
  return (
    <div className="space-y-2.5 animate-pulse">
      <div className={cn('h-3 rounded w-2/3', skin.skelBar)} />
      <div className={cn('h-2.5 rounded w-full', skin.skelBarAlt)} />
      <div className={cn('h-2.5 rounded w-11/12', skin.skelBarAlt)} />
      <div className={cn('h-2.5 rounded w-3/4', skin.skelBarAlt)} />
      <div className={cn('h-16 rounded-xl mt-3', skin.skelBarAlt)} />
    </div>
  )
}

function IconBtn({ children, onClick, label, active, skin }: {
  children: React.ReactNode; onClick: () => void; label: string; active?: boolean; skin: Skin
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      // 36px on touch, 32px on pointer devices — small enough not to crowd the
      // map, large enough to hit with a thumb.
      className={cn(
        'w-9 h-9 sm:w-8 sm:h-8 rounded-lg flex items-center justify-center shadow-lg ring-1 backdrop-blur-md transition-all hover:scale-105 active:scale-95',
        active ? 'bg-brand-500 text-white ring-brand-400/40' : skin.btn,
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
