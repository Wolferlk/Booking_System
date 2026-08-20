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
  CalendarDays, ArrowRight, BedDouble, Utensils, Plane, PlaneTakeoff, PlaneLanding,
  Gauge, ZoomIn, ZoomOut, RotateCw, Crosshair, ArrowDownRight, ArrowUpRight,
} from 'lucide-react'
import { cn, formatDate, readApiResponse } from '@/lib/utils'
import {
  DEFAULT_JM_SETTINGS, JM_SPEED_STEPS, clampSpeed, dwellDurationMs,
  legDurationMs, speedLabel, type JourneyMapSettings,
} from '@/lib/journey-map-settings'
import 'leaflet/dist/leaflet.css'

// ─── Types (mirror src/lib/journey-map.ts) ───────────────────────────────

type StopKind =
  | 'arrival' | 'departure' | 'transfer' | 'flight'
  | 'tour' | 'attraction' | 'beach' | 'nature'
  | 'cultural' | 'city' | 'cruise' | 'hotel' | 'leisure'

/**
 * How the guests move on a leg. Present only on the movement-chart map — the
 * itinerary rows carry no service type, so there is nothing to say.
 */
interface Transport {
  mode: 'private' | 'sic' | 'flight' | 'own' | 'ticket' | 'hotel' | 'meal'
  label: string
  short: string
  emoji: string
  hex: string
}

/**
 * A booked sector, resolved to two real airports (see src/lib/agenda-journey.ts).
 * `internal` is the one the movement chart cannot express — an airport-to-airport
 * hop between two destinations on the same file.
 */
interface FlightInfo {
  id: string
  flightNo: string
  airline: string | null
  date: string
  fromApt: string
  toApt: string
  fromName: string | null
  toName: string | null
  fromCity: string | null
  toCity: string | null
  fromLat: number | null
  fromLng: number | null
  toLat: number | null
  toLng: number | null
  depTime: string | null
  arrTime: string | null
  sector: 'inbound' | 'internal' | 'outbound'
  km: number | null
  durationMin: number | null
}

type FlightRole = 'sector' | 'to-airport' | 'from-airport'

interface StopHotel {
  name: string
  city: string | null
  lat: number | null
  lng: number | null
  checkIn: boolean
  /** What was booked in the room, where the file records it. */
  roomType?: string | null
  mealType?: string | null
  nights?: number | null
  checkInDate?: string | null
  checkOutDate?: string | null
}

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

  /** ── Movement-chart only (see src/lib/agenda-journey.ts) ── */
  fromPlace?: string | null
  toPlace?: string | null
  fromLat?: number | null
  fromLng?: number | null
  moveKm?: number | null
  transport?: Transport
  timeFrom?: string | null
  timeTo?: string | null
  meetingTime?: string | null
  mealPlan?: string | null
  legOfDay?: number
  legsThatDay?: number
  hotel?: StopHotel | null
  /** OSRM-encoded driving line from the previous stop into this one. */
  roadPath?: string | null
  roadKm?: number | null
  roadMin?: number | null
  flight?: FlightInfo | null
  flightRole?: FlightRole | null
  /** Woven in from the flight list; never a row on the movement chart. */
  synthetic?: boolean
}

interface JourneyHotel {
  id: string; hotel: string; city: string
  checkIn: string; checkOut: string; nights: number
  roomType?: string | null; mealType?: string | null
  lat: number | null; lng: number | null
}

/**
 * A real place on the route — somewhere the guests actually stand.
 *
 * The movement chart is a list of *movements*: "Noi Bai Airport → Hanoi Anise
 * Hotel". Read as a strip of cards that is the trip told as a list of car
 * journeys, and the same hotel prints twice — once as the end of the transfer
 * in and once as the start of the transfer out. This is the other reading of
 * the very same rows: the ordered places, each carrying how the guests arrive,
 * when they leave again, and what is booked for them there.
 */
interface Place {
  id: string
  /** 1-based position along the route — the number printed on pin and card. */
  seq: number
  name: string
  city: string | null
  country: string | null
  lat: number
  lng: number
  kind: StopKind
  dayNo: number
  date: string | null
  /** The movement that ends here. Null at the very first place. */
  arrive: JourneyStop | null
  /** The movement that leaves here. Null at the very last place. */
  depart: JourneyStop | null
  hotel: StopHotel | null
  /** The booked sector this place is an end of, and which end it is. */
  flight: FlightInfo | null
  flightEnd: 'from' | 'to' | null
}

interface Journey {
  stops: JourneyStop[]
  hotels: JourneyHotel[]
  countries: string[]
  totalKm: number
  degraded: boolean
  /** Which source built the route. Absent on the older itinerary payload. */
  basis?: 'agenda' | 'itinerary'
  dayCount?: number
  flights?: FlightInfo[]
  totalRoadKm?: number
  totalDriveMin?: number
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
/** The plane glyph, named because the riders check for it before rotating. */
const PLANE = '\u2708\uFE0F'

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

/**
 * What rides into a stop.
 *
 * The movement chart knows the booked service — a seat-in-coach transfer runs a
 * coach, a private transfer runs a car — so when that is on the stop it wins.
 * The itinerary map has no service type and falls back to guessing from the
 * destination's kind.
 */
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
function arc(a: LatLng, b: LatLng, segments = 28, lift = 1): LatLng[] {
  const [y1, x1] = a
  const [y2, x2] = b
  const dx = x2 - x1
  const dy = y2 - y1
  const dist = Math.hypot(dx, dy)
  if (dist < 1e-6) return [a, b]

  // Bow height scales with leg length but is capped, so a 1 000 km hop and a
  // 20 km transfer both stay readable rather than one ballooning off-screen.
  // `lift` is how much further a leg arches: a flight is drawn well clear of
  // the road network so it reads as air rather than as a very long drive.
  const bow = Math.min(dist * 0.18 * lift, 1.6 * lift)
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

/**
 * Compass bearing a → b in degrees, for pointing a vehicle down its own leg.
 * Screen-space rather than great-circle: the map is what the reader sees, and
 * over a single sector the two differ by less than the glyph's own width.
 */
function bearingDeg(a: LatLng, b: LatLng): number {
  return (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI
}

// ─── Places ──────────────────────────────────────────────────────────────

/** Angle wrapped into (-180, 180] so a bearing never accumulates to 900°. */
function normalizeAngle(deg: number): number {
  let d = deg % 360
  if (d > 180) d -= 360
  if (d <= -180) d += 360
  return d
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

/** Two names for the same place — "Hanoi Anise Hotel" and "Hanoi Anise Hotel & Spa". */
function sameName(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = norm(a ?? ''), y = norm(b ?? '')
  if (!x || !y) return false
  return x === y || (x.length > 5 && y.length > 5 && (x.includes(y) || y.includes(x)))
}

/**
 * Whether two ends of consecutive movements are in fact the same place.
 *
 * Coordinates first, because the same hotel geocoded from two differently
 * spelled rows lands within a few hundred metres. Names are only allowed to
 * merge points that are already close: "Hanoi" and "Hanoi Anise Hotel" are the
 * same string family but 6 km and one card apart.
 */
function samePlace(
  a: { lat: number; lng: number; name: string },
  b: { lat: number; lng: number; name: string },
): boolean {
  const d = Math.hypot(a.lat - b.lat, a.lng - b.lng)
  if (d < 0.0035) return true            // ~350 m
  return d < 0.03 && sameName(a.name, b.name)
}

/**
 * What kind of place a movement was collected from.
 *
 * Only the destination of a row carries a kind — the chart classifies what the
 * guests are going to do, never where they were picked up. The origin has to be
 * read off the row around it: the far end of a sector is an airport, a pickup
 * from the hotel of the night is that hotel, and everything else is a place in
 * a town.
 */
function originKind(stop: JourneyStop): StopKind {
  const name = (stop.fromPlace ?? '').toLowerCase()
  if (stop.flightRole === 'sector' || stop.flightRole === 'from-airport') return 'flight'
  if (/\bairport\b|\bintl\b|international air/.test(name)) return 'flight'
  if (/\bhotel\b|resort|villa|\bspa\b|lodge|\binn\b|homestay/.test(name)) return 'hotel'
  if (stop.hotel && sameName(stop.hotel.name, stop.fromPlace)) return 'hotel'
  return 'city'
}

/**
 * The movement rows, re-read as the ordered places they connect.
 *
 * Each row contributes up to two places — where it collects from and where it
 * drops off — and consecutive rows that meet at the same point collapse into
 * one card carrying both halves: how the guests arrived, and how they leave
 * again. A row whose pickup point is somewhere the previous row did not end
 * (the arrival airport at the start of a file, most often) opens a place of its
 * own, which is how the departure airport of the inbound sector finally gets
 * onto the map at all.
 */
function buildPlaces(stops: JourneyStop[]): Place[] {
  const out: Place[] = []
  let cursor: Place | null = null

  const add = (p: Omit<Place, 'id' | 'seq'>) => {
    if (cursor && samePlace(cursor, p)) {
      if (!cursor.arrive && p.arrive) cursor.arrive = p.arrive
      if (!cursor.depart && p.depart) cursor.depart = p.depart
      if (!cursor.hotel && p.hotel) cursor.hotel = p.hotel
      if (!cursor.flight && p.flight) { cursor.flight = p.flight; cursor.flightEnd = p.flightEnd }
      if (!cursor.city && p.city) cursor.city = p.city
      if (!cursor.country && p.country) cursor.country = p.country
      if (!cursor.date && p.date) cursor.date = p.date
      if (!cursor.dayNo && p.dayNo) cursor.dayNo = p.dayNo
      // A named kind beats the guessed one an origin node gets.
      if (cursor.kind === 'city' && p.kind !== 'city') cursor.kind = p.kind
      // The longer, more specific spelling wins the label.
      if (p.name.length > cursor.name.length && sameName(cursor.name, p.name)) cursor.name = p.name
      return
    }
    const next = { ...p, id: '', seq: 0 } as Place
    out.push(next)
    cursor = next
  }

  stops.forEach(stop => {
    // Where this movement collects from.
    if (stop.fromPlace && stop.fromLat != null && stop.fromLng != null) {
      add({
        name: stop.fromPlace,
        city: stop.city ?? null,
        country: stop.country ?? null,
        lat: stop.fromLat,
        lng: stop.fromLng,
        kind: originKind(stop),
        dayNo: stop.dayNo,
        date: stop.date,
        arrive: null,
        depart: stop,
        hotel: stop.hotel && sameName(stop.hotel.name, stop.fromPlace) ? stop.hotel : null,
        flight: stop.flight ?? null,
        flightEnd: stop.flight ? 'from' : null,
      })
    } else if (cursor && !(cursor as Place).depart) {
      // No pickup point on the row: the guests leave from wherever the last
      // row put them, which is exactly what the previous card already says.
      ;(cursor as Place).depart = stop
    }

    // Where it drops them off — always a place, and always this row's own kind.
    add({
      name: stop.toPlace || stop.place,
      city: stop.city ?? null,
      country: stop.country ?? null,
      lat: stop.lat,
      lng: stop.lng,
      kind: stop.kind,
      dayNo: stop.dayNo,
      date: stop.date,
      arrive: stop,
      depart: null,
      hotel: stop.hotel ?? null,
      flight: stop.flight ?? null,
      flightEnd: stop.flight ? (stop.flightRole === 'from-airport' ? 'to' : stop.flightRole === 'to-airport' ? 'from' : 'to') : null,
    })
  })

  return out.map((p, i) => ({ ...p, id: `place-${i}-${p.arrive?.id ?? p.depart?.id ?? 'x'}`, seq: i + 1 }))
}

/**
 * What rides into a place.
 *
 * The movement chart knows the booked service — a seat-in-coach transfer runs a
 * coach, a private transfer runs a car — so when that is on the arriving row it
 * wins. The itinerary map has no service type and falls back to guessing from
 * the place's own kind.
 */
function vehicleForPlace(place: Place | undefined): string {
  return place?.arrive?.transport?.emoji ?? VEHICLE[place?.kind ?? 'transfer'] ?? '\uD83D\uDE97'
}

/** The hover card on a pin. Raw HTML — Leaflet tooltips take no React. */
function placeTooltip(p: Place): string {
  const rows: string[] = [
    `<strong>${p.seq}. ${escapeHtml(p.name)}</strong>`,
    p.city && !sameName(p.city, p.name) ? escapeHtml(p.city) : '',
    p.dayNo > 0 ? `<em>Day ${p.dayNo}${p.date ? ` \u00b7 ${escapeHtml(formatDate(p.date))}` : ''}</em>` : '',
  ]
  if (p.flight) {
    rows.push(
      `\u2708\uFE0F ${escapeHtml(p.flight.flightNo)} ${escapeHtml(p.flight.fromApt)} \u2192 ${escapeHtml(p.flight.toApt)}` +
      ` ${escapeHtml(p.flight.depTime ?? '--:--')}\u2013${escapeHtml(p.flight.arrTime ?? '--:--')}`,
    )
  } else if (p.arrive?.transport) {
    rows.push(
      `${p.arrive.transport.emoji} Arrives by ${escapeHtml(p.arrive.transport.label)}` +
      (p.arrive.roadKm ? ` \u00b7 ${p.arrive.roadKm.toLocaleString()} km` : ''),
    )
  }
  if (p.hotel) {
    rows.push(
      `\uD83C\uDFE8 ${escapeHtml(truncate(p.hotel.name, 40))}` +
      (p.hotel.roomType ? `<br/><span style="opacity:.75">${escapeHtml(p.hotel.roomType)}</span>` : ''),
    )
  }
  return rows.filter(Boolean).join('<br/>')
}

/**
 * Decodes an OSRM/Google encoded polyline (precision 5).
 *
 * The server sends the driving line encoded because a routed 300 km leg is a
 * few hundred bytes this way and tens of kilobytes as an array of pairs — on
 * every leg of every payload.
 */
function decodePolyline(encoded: string): LatLng[] {
  const out: LatLng[] = []
  let i = 0, lat = 0, lng = 0
  while (i < encoded.length) {
    let shift = 0, result = 0, b: number
    do { b = encoded.charCodeAt(i++) - 63; result |= (b & 0x1f) << shift; shift += 5 } while (b >= 0x20)
    lat += (result & 1) ? ~(result >> 1) : result >> 1
    shift = 0; result = 0
    do { b = encoded.charCodeAt(i++) - 63; result |= (b & 0x1f) << shift; shift += 5 } while (b >= 0x20)
    lng += (result & 1) ? ~(result >> 1) : result >> 1
    out.push([lat / 1e5, lng / 1e5])
  }
  return out
}

/**
 * Normalised cumulative length of a polyline, cached per array.
 *
 * Everything that moves along a path — the traveller, the idle rider, the
 * sector planes, the lit trail — is positioned by a 0..1 parameter. Before the
 * roads arrived every leg was an arc of exactly 29 points, so walking by point
 * index and walking by distance were the same thing. A routed leg can carry
 * two hundred points over the distance an arc covers in 29, and walking by
 * index makes the coach crawl through every road and skate across every arc.
 */
const lengthCache = new WeakMap<LatLng[], number[]>()
function cumulative(points: LatLng[]): number[] {
  const hit = lengthCache.get(points)
  if (hit) return hit
  const run = [0]
  for (let i = 1; i < points.length; i++) {
    run.push(run[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]))
  }
  const total = run[run.length - 1] || 1
  const norm = run.map(v => v / total)
  lengthCache.set(points, norm)
  return norm
}

/** Total length of a polyline in degrees — used to weight the leg boundaries. */
function polylineLength(points: LatLng[]): number {
  let sum = 0
  for (let i = 1; i < points.length; i++) {
    sum += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1])
  }
  return sum
}

/** Index of the last vertex at or before `t` along the path. */
function indexAt(points: LatLng[], t: number): number {
  const cum = cumulative(points)
  let lo = 0, hi = cum.length - 1
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1
    if (cum[mid] <= t) lo = mid; else hi = mid
  }
  return lo
}

/** The point `t` of the way along a polyline, measured by distance. */
function walk(points: LatLng[], t: number): LatLng {
  if (points.length === 0) return [0, 0]
  if (t <= 0) return points[0]
  if (t >= 1) return points[points.length - 1]
  const cum = cumulative(points)
  const lo = indexAt(points, t)
  const hi = Math.min(lo + 1, points.length - 1)
  const span = cum[hi] - cum[lo]
  const f = span > 0 ? (t - cum[lo]) / span : 0
  const a = points[lo], b = points[hi]
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]
}

// ─── Injected map CSS ────────────────────────────────────────────────────

const MAP_CSS = `
/* Leaflet gives its panes z-index 400-700 and this panel's own overlays sit at
   500-600. A plain position:relative does not open a stacking context, so all
   of that used to compete directly with the app chrome — the sticky page header
   (z-20) and the fixed sidebar (z-40) — and the map painted straight over both.
   Isolating the wrapper keeps every one of those z-indices private to the panel;
   fullscreen still rises above the chrome, but on the wrapper's own z-index. */
.jm-wrap{isolation:isolate;--jm-rot:0deg;--jm-unrot:0deg;--jm-bleed:0px}

/* The surface that turns.
   Only the tiles and the markers rotate; the panel's own chrome is laid over
   the frame outside this element, so the controls, the strip and the drawer
   stay square while the map underneath them faces any direction. A rotated
   square leaves four triangles of nothing in the corners, so the rotor is
   oversized by --jm-bleed — but only while the map is actually turned, or
   every map would pay for tiles nobody can see. */
.jm-rotor{position:absolute;inset:var(--jm-bleed);transform:rotate(var(--jm-rot));transform-origin:50% 50%;will-change:transform}

/* Everything that is a *label* rather than a piece of the map spins back the
   other way, so a rotated map still has upright pins and readable names. */
.jm-pin-inner,.jm-hotel-tag,.jm-ride,.jm-plane-inner{transform:rotate(var(--jm-unrot))}
.jm-hotel-tag{transform-origin:11px 11px}
.jm-compass{display:inline-flex;transition:transform .25s ease}

/* The fly-through's own frame. Off entirely when nothing is playing — a
   vignette on a still map is just a dirty screen. */
.jm-vignette{opacity:0;transition:opacity .5s ease;
  background:radial-gradient(120% 85% at 50% 50%,transparent 45%,rgba(2,6,23,.42) 100%)}
.jm-playing .jm-vignette{opacity:1}

.jm-hud-pulse{animation:jm-hud-pulse 1.5s ease-in-out infinite}
@keyframes jm-hud-pulse{0%,100%{opacity:1;box-shadow:0 0 0 0 rgba(59,130,246,.55)}50%{opacity:.65;box-shadow:0 0 0 6px rgba(59,130,246,0)}}
.jm-play-on{box-shadow:0 0 0 0 rgba(59,130,246,.55);animation:jm-play-ring 1.9s ease-out infinite}
@keyframes jm-play-ring{0%{box-shadow:0 0 0 0 rgba(59,130,246,.5)}70%{box-shadow:0 0 0 14px rgba(59,130,246,0)}100%{box-shadow:0 0 0 0 rgba(59,130,246,0)}}

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
.jm-pin:hover .jm-pin-inner{transform:rotate(var(--jm-unrot)) scale(1.16) translateY(-2px);z-index:900}
/* The place's own number along the route — the one thing a strip of pins has
   to make obvious, and a repeated day number never did. */
.jm-pin-seq{position:absolute;bottom:-6px;left:-7px;min-width:17px;height:17px;padding:0 4px;border-radius:9999px;background:#fff;color:#0f172a;
  font-size:9.5px;font-weight:900;line-height:17px;text-align:center;box-shadow:0 1px 4px rgba(15,23,42,.35),0 0 0 1.5px rgba(15,23,42,.9)}
/* Already driven through: still on the map, no longer the story. */
.jm-pin-done .jm-pin-dot{filter:saturate(.55) brightness(.92)}
.jm-pin-done .jm-pin-ring{opacity:.2}

/* Active pin: a slow radar pulse. Only ever one on the map at a time, so it
   reads as "you are here" rather than as decoration. */
.jm-pin-active .jm-pin-inner{transform:rotate(var(--jm-unrot)) scale(1.22) translateY(-3px)}
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
.jm-hotel-inner{width:22px;height:22px;flex:0 0 22px;border-radius:7px;display:flex;align-items:center;justify-content:center;background:#ea580c;
  box-shadow:0 2px 8px rgba(15,23,42,.28),0 0 0 2px rgba(255,255,255,.9);opacity:.92}
/* Named stay marker (movement-chart map). The tag is centred on the pin and
   sized by its own text, so a long hotel name never shifts the anchor. */
.jm-hotel-tag{position:absolute;top:0;left:0;display:flex;align-items:center;gap:5px;white-space:nowrap}
.jm-hotel-name{font-size:10px;font-weight:700;color:#7c2d12;background:rgba(255,255,255,.92);border-radius:6px;padding:2px 6px;
  box-shadow:0 1px 4px rgba(15,23,42,.18);letter-spacing:.1px}

/* ── Internal flight sectors ─────────────────────────────────────────────
   The one leg on the chart that nobody drives. Drawn over the road route
   rather than instead of it: a wide halo wide enough to bury the blue spine
   underneath, a violet corridor whose dashes stream towards the destination,
   and a thin white spark running the same line at a different rate so the
   corridor shimmers instead of marching. */
.jm-air-halo{stroke-linecap:round;stroke-linejoin:round}
.jm-air{stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:15 11;animation:jm-air-stream 1.5s linear infinite;filter:drop-shadow(0 0 7px rgba(124,58,237,.55))}
@keyframes jm-air-stream{to{stroke-dashoffset:-26}}
.jm-air-spark{stroke-dasharray:1 24;stroke-linecap:round;animation:jm-air-spark 1.15s linear infinite}
@keyframes jm-air-spark{to{stroke-dashoffset:-50}}
/* The contrail the plane pulls behind it, fading back along the corridor. */
.jm-contrail{stroke-linecap:round;filter:drop-shadow(0 0 7px rgba(196,181,253,.95))}

.jm-plane{background:none!important;border:none!important}
.jm-plane-inner{position:relative;width:46px;height:46px;display:flex;align-items:center;justify-content:center}
.jm-plane-glow{position:absolute;width:40px;height:40px;border-radius:50%;background:radial-gradient(circle,rgba(167,139,250,.62),transparent 70%);animation:jm-glow 1.6s ease-in-out infinite}
/* Rotated by the script to the leg's own bearing. The emoji is drawn pointing
   up-right, so the transform carries a -45° correction. */
.jm-plane-emoji{position:relative;font-size:25px;line-height:1;filter:drop-shadow(0 3px 6px rgba(76,29,149,.55));transform-origin:50% 50%}
/* Sits outside the rotation, so the flight number stays readable on a
   southbound sector instead of printing upside-down. */
.jm-plane-tag{position:absolute;top:32px;left:50%;transform:translateX(-50%);white-space:nowrap;font-size:9px;font-weight:800;letter-spacing:.3px;
  color:#5b21b6;background:rgba(255,255,255,.95);border-radius:9999px;padding:1px 6px;box-shadow:0 1px 5px rgba(76,29,149,.3)}

/* The sector's own pin keeps a slow ring running even when nothing is
   selected — one inter-flight among twenty road transfers has to be findable
   without hunting for it. */
.jm-pin-air .jm-pin-ring{animation:jm-pulse 2.6s cubic-bezier(0,.55,.45,1) infinite}
.jm-air-code{position:absolute;top:31px;left:50%;transform:translateX(-50%);white-space:nowrap;font-size:8.5px;font-weight:900;letter-spacing:.5px;
  color:#fff;background:linear-gradient(135deg,#6d28d9,#4f46e5);border-radius:9999px;padding:1.5px 6px;
  box-shadow:0 2px 6px rgba(76,29,149,.42),0 0 0 1.5px rgba(255,255,255,.88)}

/* The sector's card in the day strip is a boarding pass, and the little plane
   on it taxis the dotted line between the two airport codes. */
.jm-pass-track{position:relative;display:flex;align-items:center;height:12px}
.jm-pass-plane{position:absolute;left:0;animation:jm-pass-fly 2.8s ease-in-out infinite}
@keyframes jm-pass-fly{
  0%{left:0;opacity:0}
  14%{opacity:1}
  86%{opacity:1}
  100%{left:calc(100% - 9px);opacity:0}
}

/* One scrollbar treatment for every scrolling surface in the panel — the day
   strip, the mobile legend row and the drawer body. The platform default is a
   14px opaque gutter, which on a floating glass card reads as a seam. */
.jm-strip,.jm-scroll{scrollbar-width:thin;scrollbar-color:rgba(148,163,184,.45) transparent}
.jm-strip::-webkit-scrollbar,.jm-scroll::-webkit-scrollbar{width:6px;height:6px}
.jm-strip::-webkit-scrollbar-thumb,.jm-scroll::-webkit-scrollbar-thumb{background:rgba(148,163,184,.45);border-radius:9999px}
.jm-strip::-webkit-scrollbar-thumb:hover,.jm-scroll::-webkit-scrollbar-thumb:hover{background:rgba(100,116,139,.7)}
.jm-strip::-webkit-scrollbar-track,.jm-scroll::-webkit-scrollbar-track{background:transparent}
/* The drawer scrolls under its own hero image, so the bar must not start at
   the very top edge and cut across the photo's rounded corner. */
.jm-scroll{scrollbar-gutter:stable}

@media (prefers-reduced-motion:reduce){
  .jm-route{animation:none}
  .jm-pin-active .jm-pin-ring{animation:none}
  .jm-ride-emoji,.jm-ride-glow{animation:none}
  .jm-air,.jm-air-spark,.jm-pin-air .jm-pin-ring,.jm-plane-glow,.jm-pass-plane{animation:none}
  .jm-hud-pulse,.jm-play-on{animation:none}
}
`

/** Marker HTML for a vehicle riding the route. */
function riderHtml(vehicle: string, idle: boolean) {
  return `<div class="jm-ride${idle ? ' jm-ride-idle' : ''}">` +
    `<span class="jm-ride-glow"></span>` +
    `<span class="jm-ride-emoji">${vehicle}</span>` +
    `</div>`
}

/** Marker HTML for the plane that flies an internal sector. */
function planeHtml(flightNo: string) {
  return `<div class="jm-plane-inner">` +
    `<span class="jm-plane-glow"></span>` +
    `<span class="jm-plane-emoji">\u2708\uFE0F</span>` +
    (flightNo ? `<span class="jm-plane-tag">${escapeHtml(flightNo)}</span>` : '') +
    `</div>`
}

/**
 * Repaints a rider in place rather than rebuilding its icon.
 *
 * `marker.setIcon()` swaps the whole DOM node, which restarts the bob and glow
 * keyframes — at 60fps that reads as a stutter rather than a drive. Mutating
 * the glyph and its transform keeps the animation continuous across a leg change.
 */
function paintRider(marker: LeafletMarker | null, vehicle: string, flip: boolean, bearing?: number) {
  const el = marker?.getElement()?.querySelector<HTMLElement>('.jm-ride-emoji')
  if (!el) return
  if (el.textContent !== vehicle) el.textContent = vehicle
  // A plane banks along its bearing — it is drawn pointing up-right, hence the
  // 45° correction. Everything on wheels is mirrored instead: rotating a car
  // turns it upside-down on a southbound leg.
  const t = bearing != null ? `rotate(${bearing - 45}deg)` : flip ? 'scaleX(-1)' : 'scaleX(1)'
  if (el.style.transform !== t) el.style.transform = t
}

/** The lit stretch of route behind a rider at `t` along the path. */
function trailSlice(path: LatLng[], t: number, span = 0.07): LatLng[] {
  if (path.length < 2) return path
  const from = Math.max(0, t - span)
  const start = indexAt(path, from)
  const end = indexAt(path, t)
  // The head and tail are interpolated onto the ends, so the lit stretch is the
  // same length whether it is crossing a dense routed leg or a sparse arc.
  return [walk(path, from), ...path.slice(start + 1, end + 1), walk(path, t)]
}

// ─── Component ───────────────────────────────────────────────────────────

/**
 * One height that reads well in both homes: a tall column on the operations
 * page, and a phone screen in the traveller portal, where a fixed pixel height
 * either wastes the screen or pushes the rest of the trip below the fold.
 */
const MAP_HEIGHT = 'h-[68vh] min-h-[400px] max-h-[calc(100vh-7rem)] sm:h-[560px] xl:h-[720px]'

/**
 * How much of the panel the open detail drawer owns.
 *
 * Half, so the map keeps the other half and you can see the stop you are
 * reading about — capped, because a true half of an ultrawide fullscreen is a
 * 900px column of body text nobody can scan. The map chrome dodges the same
 * measurement (as `--jm-card`), so the two can never disagree about the seam.
 */
const SIDE_CARD_W = 'min(50%, 560px)'

/** Where a viewer's own speed choice is remembered, per browser. */
const SPEED_KEY = 'jm.speed'

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
  /**
   * Which route to draw.
   *
   * `agenda` reads the AI-generated movement chart — real pickup and drop-off
   * points, the booked service type, and the hotel of the night. `itinerary`
   * is the older marketing-prose route. They are different questions, so this
   * is a choice the page makes, never a fallback: an agenda-sourced panel on a
   * file with no movement chart says so rather than quietly drawing the
   * itinerary instead.
   */
  source?: 'agenda' | 'itinerary'
}

export default function JourneyMap({
  bookingRef, className, portalToken, theme = 'light', source = 'itinerary',
}: JourneyMapProps) {
  const agenda = source === 'agenda'
  const guest = !!portalToken
  const skin: Skin = SKIN[theme]
  const isMobile = useIsMobile()
  const [journey, setJourney] = useState<Journey | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  /**
   * How the fly-through behaves, as set once for everyone on the admin config
   * page. Starts at the built-in defaults so the map animates correctly even
   * if the read fails — an animation is never worth failing a panel over.
   */
  const [settings, setSettings] = useState<JourneyMapSettings>(DEFAULT_JM_SETTINGS)
  /** This viewer's own override of the shared pace. Null means "use the setting". */
  const [speedOverride, setSpeedOverride] = useState<number | null>(null)

  // Two separate ideas, deliberately not one. `activeId` is which place the map
  // is looking at — playback moves it constantly. `selectedId` is the far
  // heavier "the user asked to read about this one", which opens the detail
  // card and spends a model call. Merging them made every click of the
  // fly-through open a card, covering the very map it was flying over — the
  // cinematic mode below re-couples them on purpose, once per arrival.
  const [activeId, setActiveId] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [hiddenKinds, setHiddenKinds] = useState<Set<StopKind>>(new Set())
  const [basemap, setBasemap] = useState<BasemapId>(theme === 'dark' ? 'midnight' : 'voyager')
  const [showLayers, setShowLayers] = useState(false)
  const [showLegend, setShowLegend] = useState(false)
  const [showSpeed, setShowSpeed] = useState(false)
  /**
   * Whether the map gets to own touch gestures.
   *
   * On a phone this panel sits inside a scrolling trip page, and Leaflet's
   * dragging handler swallows every vertical swipe that starts over the map —
   * the reader gets stuck panning Sri Lanka instead of scrolling to their
   * hotels. Off by default on touch, so a swipe scrolls the page while pins,
   * the day strip and the fly-through all still work; "Explore", fullscreen
   * and pressing play all hand the gestures over, which is every moment
   * someone is actually reading the map rather than the page around it.
   */
  const [interactive, setInteractive] = useState(true)
  const [fullscreen, setFullscreen] = useState(false)
  const [playing, setPlaying] = useState(false)
  /**
   * The viewer took the camera off the vehicle — pinched, dragged or zoomed
   * mid-flight. Playback carries on; the camera simply stops chasing until
   * they ask for it back, because a camera that snaps home half a second after
   * every gesture cannot be steered at all.
   */
  const [freeLook, setFreeLook] = useState(false)
  /** Map bearing in degrees, from a two-finger twist or the rotate buttons. */
  const [rotation, setRotation] = useState(0)
  /**
   * Which day the fly-through covers. Null is the whole file.
   *
   * A twenty-day route played end to end is a screensaver: by the time it
   * reaches the day you were asked about you have watched nineteen you were
   * not. Scoping it to one day makes it answer a question — what does Day 4
   * actually involve, and what is carrying them through it.
   */
  const [playDay, setPlayDay] = useState<number | null>(null)
  const [showDays, setShowDays] = useState(false)
  // Leaflet arrives via a dynamic import, so the map exists a tick after the
  // effects that draw on it first run. Storing readiness in state (rather than
  // only on the ref) is what re-runs those effects once there is a map to draw
  // on — a ref assignment inside the async callback renders nothing.
  const [mapReady, setMapReady] = useState(false)
  const [progress, setProgress] = useState(1)   // 0..1 along the whole route

  const frameRef = useRef<HTMLDivElement | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  // Read inside `flyTo`, which must stay referentially stable for the playback
  // effect — refs let it see current state without re-triggering the animation.
  const cardOpenRef = useRef(false)
  /** True when the card is the right-hand drawer, not the bottom sheet. */
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
  /** Frame handle for the looping sector planes — cancelled on unmount. */
  const planeRafRef = useRef<number | null>(null)
  const pinsRef = useRef<Map<string, LeafletMarker>>(new Map())
  const hotelPinsRef = useRef<LeafletMarker[]>([])
  const travellerRef = useRef<LeafletMarker | null>(null)
  const rafRef = useRef<number | null>(null)
  const stripRef = useRef<HTMLDivElement | null>(null)
  /** Read inside the two-finger handler, which must not re-bind on every degree. */
  const rotationRef = useRef(0)

  // The animation loop runs for the length of a run and must not restart when
  // one of these changes — a restarting fly-through jumps back to the first
  // stop. It reads them off refs instead, so a mid-flight speed change is
  // picked up on the very next frame.
  const speed = speedOverride ?? settings.speed
  const speedRef = useRef(speed)
  const cinematicRef = useRef(settings.cinematic)
  const autoOpenRef = useRef(settings.autoOpen)
  const followZoomRef = useRef(settings.followZoom)
  const freeLookRef = useRef(false)
  const playingRef = useRef(false)
  useEffect(() => { speedRef.current = speed }, [speed])
  useEffect(() => { cinematicRef.current = settings.cinematic }, [settings.cinematic])
  useEffect(() => { autoOpenRef.current = settings.autoOpen }, [settings.autoOpen])
  useEffect(() => { followZoomRef.current = settings.followZoom }, [settings.followZoom])
  useEffect(() => { freeLookRef.current = freeLook }, [freeLook])
  useEffect(() => { playingRef.current = playing }, [playing])

  const stops = useMemo(() => journey?.stops ?? [], [journey])

  /**
   * The route as places, not as movements.
   *
   * Everything below — the pins, the card strip, the fly-through — is keyed on
   * this rather than on the raw movement rows. See `buildPlaces`: a chart of
   * eight transfers is really nine places, and it is the places a traveller
   * recognises.
   */
  const places = useMemo(() => buildPlaces(stops), [stops])

  useEffect(() => { cardOpenRef.current = selectedId != null }, [selectedId])
  useEffect(() => { sideCardRef.current = !isMobile }, [isMobile])
  // Touch devices start locked; fullscreen and playback are both explicit
  // "I am reading the map now" moments, so both hand the gestures over.
  useEffect(() => { setInteractive(!isMobile || fullscreen || playing) }, [isMobile, fullscreen, playing])

  const selected = useMemo(() => places.find(p => p.id === selectedId) ?? null, [places, selectedId])
  /**
   * The right half is spoken for. Every piece of map chrome pulls back into the
   * left half while it is, so nothing an operator needs is hiding behind the
   * card — the panel reads as two columns, map and story, rather than as a
   * card dropped on top of a map.
   */
  const sideOpen = !!selected && !isMobile

  /**
   * The transport mix of the whole chart — "6 private, 3 SIC, 1 flight".
   * Empty on the itinerary map, which has no booked service types.
   */
  const modeCounts = useMemo(() => {
    const m = new Map<string, { t: NonNullable<JourneyStop['transport']>; count: number }>()
    stops.forEach(s => {
      if (!s.transport) return
      const hit = m.get(s.transport.mode)
      if (hit) hit.count += 1
      else m.set(s.transport.mode, { t: s.transport, count: 1 })
    })
    return Array.from(m.entries()).sort((a, b) => b[1].count - a[1].count)
  }, [stops])

  const kindCounts = useMemo(() => {
    const m = new Map<StopKind, number>()
    places.forEach(p => m.set(p.kind, (m.get(p.kind) ?? 0) + 1))
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1])
  }, [places])

  /**
   * Per-leg arcs, the flattened path the traveller walks, and — separately —
   * the sector legs.
   *
   * The sectors are pulled out because they are drawn as an air corridor over
   * the top of the road route and flown by their own plane. They stay in the
   * flattened path too: the fly-through has to cross them like any other leg,
   * it just crosses them in a plane.
   */
  const geometry = useMemo(() => {
    const legs: LatLng[][] = []
    const routed: boolean[] = []

    for (let i = 0; i < places.length - 1; i++) {
      const from: LatLng = [places[i].lat, places[i].lng]
      const to = places[i + 1]
      // The movement that ends at `to` is the one that knows how this leg is
      // travelled and which road it takes.
      const via = to.arrive
      const air = via?.flightRole === 'sector'

      // A driven leg follows the real road network. The routed line starts at
      // the nearest road rather than at the pin, so the pins are stitched onto
      // both ends — that short connector is the walk to the vehicle, and
      // without it the route visibly detaches from the stop it serves.
      const road = !air && via?.roadPath ? decodePolyline(via.roadPath) : null
      if (road && road.length > 1) {
        legs.push([from, ...road, [to.lat, to.lng]])
        routed.push(true)
        continue
      }

      // No road, or a flown sector: the bowed arc, as before. A flight arches
      // much further so it reads as air rather than as a very long drive.
      legs.push(arc(from, [to.lat, to.lng], air ? 44 : 28, air ? 1.9 : 1))
      routed.push(false)
    }

    const flat: LatLng[] = []
    legs.forEach((leg, i) => flat.push(...(i === 0 ? leg : leg.slice(1))))

    // Where each place falls along the flattened path, as a 0..1 fraction of
    // its length. Legs are nothing alike — a routed road carries two hundred
    // points over the distance an arc covers in 29 — so playback needs the real
    // boundaries to know when it has arrived.
    const lens = legs.map(polylineLength)
    const total = lens.reduce((a, b) => a + b, 0) || 1
    const bounds: number[] = [0]
    lens.forEach(l => bounds.push(bounds[bounds.length - 1] + l / total))
    bounds[bounds.length - 1] = 1

    const sectors = legs
      .map((path, i) => ({ path, place: places[i + 1] }))
      .filter(x => x.place?.arrive?.flightRole === 'sector' && x.place.flight)

    return { legs, flat, sectors, bounds, routed }
  }, [places])

  /**
   * The booked sectors that made it onto the map, and how many of them are the
   * ones the movement chart could never show.
   */
  const flightStats = useMemo(() => {
    const drawn = stops.filter(s => s.flightRole === 'sector' && s.flight).map(s => s.flight!)
    return { drawn, inter: drawn.filter(f => f.sector === 'internal').length }
  }, [stops])

  /** Every day number on the route, in order. */
  const dayNumbers = useMemo(
    () => Array.from(new Set(places.map(p => p.dayNo).filter(d => d > 0))).sort((a, b) => a - b),
    [places],
  )

  /**
   * The stretch of the route a run covers, as place indices.
   *
   * A day's run starts one place *before* its first — the movement into a day's
   * opening place is that day's first leg, and starting on the place itself
   * would skip the very transfer the day begins with.
   */
  const playRange = useMemo(() => {
    const whole = { start: 0, end: Math.max(places.length - 1, 0) }
    if (playDay == null) return whole
    const idx = places.reduce<number[]>((acc, p, i) => (p.dayNo === playDay ? [...acc, i] : acc), [])
    if (idx.length === 0) return whole
    return { start: Math.max(0, idx[0] - 1), end: idx[idx.length - 1] }
  }, [playDay, places])

  /** Which place the vehicle is at or heading for, derived from `progress`. */
  const legIndexNow = useMemo(() => {
    const b = geometry.bounds
    if (b.length < 2) return 0
    const last = Math.max(b.length - 2, 0)
    const i = b.findIndex(x => x > progress)
    // Nothing ahead of `progress` means the route is finished, which is the
    // last leg — not the first, which is what a bare `findIndex` - 1 gives.
    return i < 0 ? last : Math.min(Math.max(i - 1, 0), last)
  }, [progress, geometry])

  // ── Data ───────────────────────────────────────────────────────────────

  const load = useCallback(async (refresh = false) => {
    refresh ? setRefreshing(true) : setLoading(true)
    setError(null)
    try {
      const base = agenda ? 'agenda-journey' : 'journey-map'
      const url = portalToken
        ? `/api/public/${base}/${bookingRef}?t=${encodeURIComponent(portalToken)}`
        : `/api/bookings/${bookingRef}/${base}${refresh ? '?refresh=1' : ''}`
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
  }, [bookingRef, portalToken, agenda])

  useEffect(() => { void load() }, [load])

  /** The shared animation settings, and this browser's own speed override. */
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch('/api/public/journey-map-settings')
        const json = await readApiResponse<JourneyMapSettings>(res)
        if (!cancelled && json.success && json.data) setSettings({ ...DEFAULT_JM_SETTINGS, ...json.data })
      } catch { /* the built-in pace is a perfectly good fallback */ }
    })()
    try {
      const saved = window.localStorage.getItem(SPEED_KEY)
      if (saved) setSpeedOverride(clampSpeed(Number(saved)))
    } catch { /* private browsing */ }
    return () => { cancelled = true }
  }, [])

  const pickSpeed = useCallback((next: number | null) => {
    setSpeedOverride(next)
    try {
      if (next == null) window.localStorage.removeItem(SPEED_KEY)
      else window.localStorage.setItem(SPEED_KEY, String(next))
    } catch { /* private browsing */ }
  }, [])

  // ── Map lifecycle ──────────────────────────────────────────────────────

  useEffect(() => {
    if (!containerRef.current || places.length === 0 || mapRef.current) return
    let cancelled = false

    ;(async () => {
      const L = (await import('leaflet')).default
      if (cancelled || !containerRef.current || mapRef.current) return
      LRef.current = L

      const map = L.map(containerRef.current, {
        zoomControl: false,
        attributionControl: true,
        // The panel sits mid-page, so a wheel over it must scroll the booking
        // rather than zoom. Fullscreen and playback re-enable it below.
        scrollWheelZoom: false,
        worldCopyJump: true,
        zoomSnap: 0.25,
      })
      map.getContainer().style.outline = 'none'
      mapRef.current = map

      const bm = BASEMAPS.find(b => b.id === basemap) ?? BASEMAPS[0]
      tileRef.current = L.tileLayer(bm.url, { attribution: bm.attr, maxZoom: 18, subdomains: 'abcd' }).addTo(map)

      map.fitBounds(L.latLngBounds(places.map(p => [p.lat, p.lng] as LatLng)), { padding: [56, 56], maxZoom: 11 })
      setTimeout(() => map.invalidateSize(), 120)
      setMapReady(true)
    })()

    return () => { cancelled = true }
  }, [places, basemap])

  // Tear the map down only when the component itself goes away.
  useEffect(() => () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    if (idleRafRef.current) cancelAnimationFrame(idleRafRef.current)
    if (planeRafRef.current) cancelAnimationFrame(planeRafRef.current)
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
    if (!L || !map || places.length === 0) return

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

    // Hotels sit under the place pins — context, not the subject of the panel.
    // A stay whose own pin is already on the route is skipped: the place card
    // says everything the tag would, and the two overlapping read as two hotels.
    ;(journey?.hotels ?? []).forEach(h => {
      if (h.lat == null || h.lng == null) return
      if (places.some(p => p.kind === 'hotel' && Math.abs(p.lat - h.lat!) < 0.004 && Math.abs(p.lng - h.lng!) < 0.004)) return
      const icon = L.divIcon({
        className: 'jm-hotel',
        html: agenda
          ? `<div class="jm-hotel-tag" title="${escapeHtml(h.hotel)}">` +
            `<span class="jm-hotel-inner">${glyphSvg('hotel', 12)}</span>` +
            `<span class="jm-hotel-name">${escapeHtml(truncate(h.hotel, 26))}</span>` +
            `</div>`
          : `<div class="jm-hotel-inner" title="${escapeHtml(h.hotel)}">${glyphSvg('hotel', 12)}</div>`,
        iconSize: [22, 22], iconAnchor: [11, 11],
      })
      const m = L.marker([h.lat, h.lng], { icon, zIndexOffset: -400, riseOnHover: true })
        .addTo(map)
        .bindTooltip(
          `<strong>${escapeHtml(h.hotel)}</strong><br/>${h.nights} night${h.nights === 1 ? '' : 's'} · ${escapeHtml(h.city)}` +
          (h.roomType ? `<br/>${escapeHtml(h.roomType)}` : ''),
          { direction: 'top', offset: [0, -10], opacity: 0.95 },
        )
      hotelPins.push(m)
    })

    places.forEach((p, i) => {
      const k = KIND[p.kind] ?? KIND.tour
      const apt = p.flight ? (p.flightEnd === 'from' ? p.flight.fromApt : p.flight.toApt) : null
      const icon = L.divIcon({
        className: 'jm-pin',
        html:
          `<div class="jm-pin-inner${p.flight ? ' jm-pin-air' : ''}">` +
          `<span class="jm-pin-ring" style="box-shadow:0 0 0 8px rgba(${k.glow},.45)"></span>` +
          `<span class="jm-pin-dot" style="background:linear-gradient(145deg,${k.hex},${shade(k.hex, -18)})">${glyphSvg(p.kind)}</span>` +
          // The place's own number along the route. The pin used to carry the
          // day, which repeats four times on a busy day and tells you nothing
          // about the order the four happen in.
          `<span class="jm-pin-seq">${p.seq}</span>` +
          (p.dayNo > 0 ? `<span class="jm-pin-day">D${p.dayNo}</span>` : '') +
          // An airport wears its code: on a map of twenty transfers, "HAN" is
          // the thing an operator is scanning for.
          (apt ? `<span class="jm-air-code">${escapeHtml(apt)}</span>` : '') +
          `</div>`,
        iconSize: [38, 38], iconAnchor: [19, 19],
      })
      const m = L.marker([p.lat, p.lng], { icon, zIndexOffset: p.flight ? 700 + i : i, riseOnHover: true })
        .addTo(map)
        .bindTooltip(placeTooltip(p), { direction: 'top', offset: [0, -20], opacity: 0.96 })
      m.on('click', () => setSelectedId(p.id))
      m.on('mouseover', () => setHoveredId(p.id))
      m.on('mouseout', () => setHoveredId(null))
      pins.set(p.id, m)
    })

    return () => {
      halo.remove(); base.remove(); live.remove(); trail.remove()
      trailRef.current = null
      pins.forEach(x => x.remove()); pins.clear()
      hotelPins.forEach(x => x.remove())
    }
  }, [places, geometry, journey?.hotels, basemap, mapReady, agenda])

  // ── Internal flight sectors ────────────────────────────────────────────

  /**
   * The air corridor.
   *
   * A sector between two destinations on the same file — Ho Chi Minh to Da Nang
   * — has no movement chart row, so before this the route either jumped the gap
   * or drew a 600 km road leg nobody drives. It is now its own arc, drawn *over*
   * the road route rather than instead of it: a halo wide enough to bury the
   * blue spine underneath, a violet corridor whose dashes stream towards the
   * destination, and a thin white spark running the same line at a different
   * rate so it shimmers rather than marching.
   *
   * Stays drawn during the fly-through — the leg does not stop being a flight
   * because someone pressed play.
   */
  useEffect(() => {
    const L = LRef.current, map = mapRef.current
    if (!L || !map || geometry.sectors.length === 0) return

    const dark = BASEMAPS.find(b => b.id === basemap)?.dark
    const lines = geometry.sectors.flatMap(({ path }) => [
      L.polyline(path, {
        className: 'jm-air-halo',
        color: dark ? '#312e81' : '#ede9fe',
        weight: 12, opacity: dark ? 0.85 : 0.95,
      }).addTo(map),
      L.polyline(path, { className: 'jm-air', color: '#7c3aed', weight: 3.8, opacity: 0.96 }).addTo(map),
      L.polyline(path, { className: 'jm-air-spark', color: '#ffffff', weight: 2.1, opacity: 0.9 }).addTo(map),
    ])

    return () => lines.forEach(l => l.remove())
  }, [geometry, basemap, mapReady])

  /**
   * The plane that flies the corridor, on a loop, trailing a contrail.
   *
   * Same job as the idle rider on the road route: a static violet line does not
   * say which end is Ho Chi Minh. Suspended during the fly-through, where the
   * traveller already crosses this leg in a plane of its own — two planes on
   * one arc reads as two flights.
   */
  useEffect(() => {
    const L = LRef.current, map = mapRef.current
    if (!L || !map || playing || geometry.sectors.length === 0) return

    const planes = geometry.sectors.map(({ path, place }) => ({
      path,
      contrail: L.polyline([], { className: 'jm-contrail', color: '#c4b5fd', weight: 5, opacity: 0.9 }).addTo(map),
      marker: L.marker(path[0], {
        icon: L.divIcon({
          className: 'jm-plane',
          html: planeHtml(place.flight?.flightNo ?? ''),
          iconSize: [46, 46], iconAnchor: [23, 23],
        }),
        zIndexOffset: 1500,
        interactive: false,
      }).addTo(map),
    }))

    const teardown = () => planes.forEach(p => { p.marker.remove(); p.contrail.remove() })

    // The corridor above is pure CSS and still reads with motion turned off —
    // the plane just parks mid-route instead of flying laps.
    if (typeof window !== 'undefined' &&
        window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      planes.forEach(p => p.marker.setLatLng(walk(p.path, 0.5)))
      return teardown
    }

    // The idle loops answer to the same speed control as the fly-through, so
    // turning the animation down turns *all* of it down rather than leaving a
    // plane tearing across a map somebody slowed on purpose.
    const rate = clampSpeed(speed)
    const CRUISE_MS = 5200 / rate
    const REST_MS = 1000 / rate
    const start = performance.now()

    const tick = (now: number) => {
      const cycle = (now - start) % (CRUISE_MS + REST_MS)
      const landed = cycle > CRUISE_MS
      const t = Math.min(cycle / CRUISE_MS, 1)

      planes.forEach(p => {
        p.marker.setLatLng(walk(p.path, t))
        const el = p.marker.getElement() as HTMLElement | null
        if (el) {
          // Rest at the gate rather than snapping back to the runway.
          el.style.transition = 'opacity .45s ease'
          el.style.opacity = landed ? '0' : '1'
          const glyph = el.querySelector<HTMLElement>('.jm-plane-emoji')
          if (glyph) {
            // Sampled either side of the plane, so the nose still points down
            // the arc at both ends — where one side has nothing beyond it.
            const bearing = bearingDeg(
              walk(p.path, Math.max(t - 0.015, 0)),
              walk(p.path, Math.min(t + 0.015, 1)),
            )
            // The emoji is drawn pointing up-right, hence the 45° correction.
            glyph.style.transform = `rotate(${bearing - 45}deg)`
          }
        }
        p.contrail.setLatLngs(landed ? [] : trailSlice(p.path, t, 0.34))
      })

      planeRafRef.current = requestAnimationFrame(tick)
    }
    planeRafRef.current = requestAnimationFrame(tick)

    return () => {
      if (planeRafRef.current) cancelAnimationFrame(planeRafRef.current)
      planeRafRef.current = null
      teardown()
    }
  }, [geometry, mapReady, playing, speed])

  // ── Selection / hover / filter styling ─────────────────────────────────

  useEffect(() => {
    const active = hoveredId ?? selectedId ?? activeId
    pinsRef.current.forEach((marker, id) => {
      const el = marker.getElement()
      if (!el) return
      const place = places.find(p => p.id === id)
      el.classList.toggle('jm-pin-active', id === active)
      el.classList.toggle('jm-pin-dim', !!place && hiddenKinds.has(place.kind))
      // Every place the vehicle has already been through is marked done, so a
      // paused fly-through still reads as a journey with a past and a future.
      el.classList.toggle('jm-pin-done', !!place && place.seq - 1 < legIndexNow && progress < 1)
    })
  }, [hoveredId, selectedId, activeId, hiddenKinds, places, legIndexNow, progress])

  // ── Playback ───────────────────────────────────────────────────────────

  /**
   * The camera target for a point, biased so it lands in the part of the map
   * the detail card is not covering — up and out of the bottom sheet on a
   * narrow panel, left of the side drawer in fullscreen. Without this the pin
   * you just clicked ends up underneath the card describing it.
   */
  const biased = useCallback((lat: number, lng: number, zoom: number) => {
    const L = LRef.current, map = mapRef.current
    if (!L || !map) return null
    let target = L.latLng(lat, lng)
    if (cardOpenRef.current) {
      const pt = map.project(target, zoom)
      // The side drawer takes the right half, so the point has to land in the
      // middle of the left half — a quarter of the width off centre — or the
      // very place being described sits underneath the card describing it.
      if (sideCardRef.current) pt.x += map.getSize().x * 0.25
      else pt.y += map.getSize().y * 0.22                        // bottom sheet
      target = map.unproject(pt, zoom)
    }
    return target
  }, [])

  const flyTo = useCallback((lat: number, lng: number, zoom?: number, duration = 1.05) => {
    const map = mapRef.current
    if (!map) return
    const z = zoom ?? Math.max(map.getZoom(), 9)
    const target = biased(lat, lng, z)
    if (target) map.flyTo(target, z, { duration })
  }, [biased])

  /**
   * The fly-through.
   *
   * Two things changed here and they are the whole point of the mode. The
   * camera *rides with the vehicle* — panned onto it every frame at a real
   * street-level zoom rather than cutting between stops from altitude — and on
   * arrival it pushes in on the place and opens its card, so the answer to
   * "what is this" is on screen at the moment the guests get there.
   *
   * Both are abandoned the instant the viewer touches the map: `freeLook`
   * leaves the animation running and hands the camera back.
   */
  useEffect(() => {
    if (!playing || places.length < 2) return
    const L = LRef.current, map = mapRef.current
    if (!L || !map) return

    const { bounds } = geometry
    const { start, end } = playRange
    if (end <= start) { setPlaying(false); return }

    // Resume where the run was paused, but only inside the stretch this run
    // covers — a day run always begins at that day's own first leg.
    const resumed = progress > bounds[start] && progress < bounds[end]
      ? Math.max(start, bounds.findIndex(b => b > progress) - 1)
      : start
    let legIndex = resumed
    let phase: 'dwell' | 'travel' = 'dwell'
    let phaseStart = performance.now()
    /** While a scripted camera move is in flight, the follow keeps its hands off. */
    let settleUntil = performance.now() + 1200

    const arrivalZoom = () => Math.min(followZoomRef.current + 1.4, 16)

    setProgress(bounds[legIndex])
    setActiveId(places[legIndex].id)
    if (autoOpenRef.current) setSelectedId(places[legIndex].id)
    flyTo(places[legIndex].lat, places[legIndex].lng, cinematicRef.current ? arrivalZoom() : 9, 1.2)

    const traveller = L.marker([places[legIndex].lat, places[legIndex].lng], {
      icon: L.divIcon({
        className: 'jm-traveller',
        html: riderHtml(vehicleForPlace(places[legIndex + 1] ?? places[legIndex]), false),
        iconSize: [40, 40], iconAnchor: [20, 20],
      }),
      zIndexOffset: 1200,
    }).addTo(map)
    travellerRef.current = traveller

    const tick = (now: number) => {
      const elapsed = now - phaseStart
      const rate = speedRef.current
      const cinematic = cinematicRef.current && !freeLookRef.current

      if (phase === 'dwell') {
        if (elapsed >= dwellDurationMs(rate)) {
          phase = 'travel'
          phaseStart = now
          // Pull back out of the arrival push-in to the travelling altitude,
          // then let the follow take over once the move has landed.
          if (cinematic) {
            flyTo(places[legIndex].lat, places[legIndex].lng, followZoomRef.current, 0.7)
            settleUntil = now + 720
          }
        }
      } else {
        const span = (bounds[legIndex + 1] ?? 1) - bounds[legIndex]
        const t = Math.min(elapsed / legDurationMs(rate, span), 1)
        // Each leg gets its own stretch of the path and a duration weighted by
        // how much of the route it is, so arriving at `t === 1` is arriving at
        // the place — however long the road between them turned out to be.
        const legT = bounds[legIndex] + t * span
        setProgress(legT)

        const here = walk(geometry.flat, legT)
        traveller.setLatLng(here)
        // The vehicle is whatever the chart booked for this leg — a coach for
        // seat-in-coach, a car for a private transfer, a plane for a sector —
        // and it is turned to face the way it is going.
        const from = places[legIndex]
        const dest = places[Math.min(legIndex + 1, places.length - 1)]
        const vehicle = vehicleForPlace(dest)
        paintRider(
          traveller,
          vehicle,
          headingWest([from.lat, from.lng], [dest.lat, dest.lng]),
          // A plane banks along its arc; a car would look wrong upside-down on
          // a southbound leg, so it is mirrored instead.
          vehicle === PLANE ? bearingDeg(walk(geometry.flat, Math.max(legT - 0.004, 0)), here) : undefined,
        )
        trailRef.current?.setLatLngs(trailSlice(geometry.flat, legT))

        // The camera rides along. `panTo` without animation is the only way to
        // track at 60fps — Leaflet's animated moves queue up and the vehicle
        // slides off the far edge while the map is still easing to where it was.
        if (cinematic && now > settleUntil) {
          const target = biased(here[0], here[1], map.getZoom())
          if (target) map.panTo(target, { animate: false })
        }

        if (t >= 1) {
          legIndex += 1
          const done = legIndex >= end
          const at = places[done ? end : legIndex]
          setProgress(bounds[done ? end : legIndex])
          setActiveId(at.id)
          // The arrival: push in on the place and open its card. This is the
          // question the fly-through exists to answer — where are they now,
          // and what is this place.
          if (autoOpenRef.current) setSelectedId(at.id)
          if (cinematic) {
            flyTo(at.lat, at.lng, arrivalZoom(), 0.95)
            settleUntil = now + 1000
          } else {
            flyTo(at.lat, at.lng, 9)
          }
          if (done) { setPlaying(false); return }
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
  }, [playing, places, geometry, playRange, flyTo, biased, mapReady])

  /**
   * The idle ride: when nothing is playing, a vehicle drives the finished route
   * on a slow loop, trailing a lit stretch of road behind it.
   *
   * This is what makes the route legible at a glance. A static polyline between
   * seven pins does not tell you which end is day one; a car pulling away from
   * Sigiriya towards Kandy does, without anyone pressing anything.
   */
  useEffect(() => {
    if (playing || places.length < 2 || geometry.flat.length === 0) return
    const L = LRef.current, map = mapRef.current
    if (!L || !map) return
    if (typeof window !== 'undefined' &&
        window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return

    const rider = L.marker(walk(geometry.flat, geometry.bounds[playRange.start]), {
      icon: L.divIcon({
        className: 'jm-traveller',
        html: riderHtml(vehicleForPlace(places[playRange.start + 1] ?? places[playRange.start]), true),
        iconSize: [40, 40], iconAnchor: [20, 20],
      }),
      zIndexOffset: 1100,
      interactive: false,
    }).addTo(map)
    idleRiderRef.current = rider

    // One lap covers the chosen stretch at a steady pace, then rests briefly at
    // the end before restarting, so the loop reads as a journey rather than a
    // treadmill. With a day picked it laps that day only — the same scope the
    // fly-through uses, so the two never disagree about what is being shown.
    const { start: fromPlace, end: toPlace } = playRange
    const t0 = geometry.bounds[fromPlace]
    const t1 = geometry.bounds[toPlace]
    if (!(t1 > t0)) return () => { rider.remove(); idleRiderRef.current = null }

    const rate = clampSpeed(speed)
    const lapMs = Math.max(6000, (toPlace - fromPlace) * 2600) / rate
    const restMs = 1400 / rate
    const start = performance.now()

    const tick = (now: number) => {
      const cycle = (now - start) % (lapMs + restMs)
      const t = t0 + (t1 - t0) * Math.min(cycle / lapMs, 1)

      rider.setLatLng(walk(geometry.flat, t))
      // Which leg the rider is on has to be read off the real boundaries: legs
      // are no longer interchangeable now that some are routed roads.
      const legIndex = Math.min(
        Math.max(geometry.bounds.findIndex(b => b > t) - 1, fromPlace),
        toPlace - 1,
      )
      const from = places[legIndex]
      const to = places[legIndex + 1]
      if (!from || !to) { idleRafRef.current = requestAnimationFrame(tick); return }
      const vehicle = vehicleForPlace(to)
      paintRider(
        rider,
        vehicle,
        headingWest([from.lat, from.lng], [to.lat, to.lng]),
        vehicle === PLANE
          ? bearingDeg(walk(geometry.flat, Math.max(t - 0.004, t0)), walk(geometry.flat, t))
          : undefined,
      )
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
  }, [playing, places, geometry, playRange, mapReady, speed])

  /** Draw only the travelled portion while playing; the whole route otherwise. */
  useEffect(() => {
    const route = routeRef.current
    if (!route || geometry.flat.length === 0) return
    const upto = Math.max(2, indexAt(geometry.flat, progress) + 1)
    const travelled = [...geometry.flat.slice(0, upto), walk(geometry.flat, progress)]
    // The halo stays whole so the road ahead is still readable; the coloured
    // spine and its dashes fill in behind the vehicle as it drives.
    route.base.setLatLngs(travelled)
    route.live.setLatLngs(travelled)
  }, [progress, geometry, mapReady])

  // ── Camera hand-over ───────────────────────────────────────────────────

  /**
   * Any real gesture over the map during playback takes the camera off the
   * vehicle. Bound to raw input rather than to Leaflet's `movestart`, which
   * the fly-through's own camera moves would trip on every leg.
   */
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const grab = () => { if (playingRef.current) setFreeLook(true) }
    el.addEventListener('pointerdown', grab, { passive: true })
    el.addEventListener('wheel', grab, { passive: true })
    el.addEventListener('touchstart', grab, { passive: true })
    return () => {
      el.removeEventListener('pointerdown', grab)
      el.removeEventListener('wheel', grab)
      el.removeEventListener('touchstart', grab)
    }
  }, [mapReady])

  /**
   * Two fingers: pinch to zoom, twist to rotate.
   *
   * Leaflet does the pinch itself, and has no idea what a bearing is. Rather
   * than reimplement its touch stack, this reads the *angle* between the same
   * two fingers Leaflet is already reading the distance between, and spins the
   * whole map surface with a CSS rotation — the two gestures ride the same
   * touch without either handler knowing about the other. Nothing is
   * `preventDefault`ed here, so taps on pins still land.
   */
  useEffect(() => {
    const el = containerRef.current
    if (!el || !interactive) return

    let startAngle: number | null = null
    let startRotation = 0
    let twisting = false

    const angleOf = (t: TouchList) =>
      (Math.atan2(t[1].clientY - t[0].clientY, t[1].clientX - t[0].clientX) * 180) / Math.PI

    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 2) { startAngle = null; twisting = false; return }
      startAngle = angleOf(e.touches)
      startRotation = rotationRef.current
      twisting = false
    }
    const onMove = (e: TouchEvent) => {
      if (e.touches.length !== 2 || startAngle == null) return
      let delta = angleOf(e.touches) - startAngle
      if (delta > 180) delta -= 360
      if (delta < -180) delta += 360
      // A deliberate twist, not the wobble in every pinch. Once past the
      // threshold the rotation tracks the fingers exactly, with the dead zone
      // subtracted so it does not jump 12° the moment it engages.
      if (!twisting) {
        if (Math.abs(delta) < 12) return
        twisting = true
        startAngle += delta > 0 ? 12 : -12
        delta += delta > 0 ? -12 : 12
      }
      setRotation(normalizeAngle(startRotation + delta))
    }
    const onEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) { startAngle = null; twisting = false }
    }

    el.addEventListener('touchstart', onStart, { passive: true })
    el.addEventListener('touchmove', onMove, { passive: true })
    el.addEventListener('touchend', onEnd, { passive: true })
    el.addEventListener('touchcancel', onEnd, { passive: true })
    return () => {
      el.removeEventListener('touchstart', onStart)
      el.removeEventListener('touchmove', onMove)
      el.removeEventListener('touchend', onEnd)
      el.removeEventListener('touchcancel', onEnd)
    }
  }, [interactive, mapReady])

  useEffect(() => { rotationRef.current = rotation }, [rotation])

  /** Hand the camera back to the vehicle, wherever it has got to. */
  const recenter = useCallback(() => {
    setFreeLook(false)
    const here = geometry.flat.length > 1 ? walk(geometry.flat, progress) : null
    if (here) flyTo(here[0], here[1], Math.max(mapRef.current?.getZoom() ?? 12, followZoomRef.current), 0.8)
  }, [geometry, progress, flyTo])

  const zoomBy = useCallback((delta: number) => {
    const map = mapRef.current
    if (!map) return
    if (playingRef.current) setFreeLook(true)
    map.setZoom(map.getZoom() + delta, { animate: true })
  }, [])

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
   * sidebar collapsing, the rotation bleed, and the browser window changing.
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
    // Fullscreen and playback are both deliberate "I am reading the map now"
    // modes, so the wheel becomes a zoom in either and goes back to scrolling
    // the page on exit.
    fullscreen || playing ? map.scrollWheelZoom.enable() : map.scrollWheelZoom.disable()
  }, [fullscreen, playing, mapReady])

  useEffect(() => {
    const L = LRef.current, map = mapRef.current
    if (!L || !map) return
    // The aspect ratio changes a lot between a 540px column and the viewport,
    // so a route framed for one is badly framed for the other.
    const id = setTimeout(() => {
      map.invalidateSize({ animate: false })
      if (places.length > 0 && !cardOpenRef.current && !playingRef.current) {
        map.flyToBounds(L.latLngBounds(places.map(p => [p.lat, p.lng] as LatLng)),
          { padding: [64, 64], maxZoom: 11, duration: 0.6 })
      }
    }, 340)
    return () => clearTimeout(id)
  }, [fullscreen, mapReady, places])

  /**
   * Framing follows the chosen day.
   *
   * Picking Day 4 out of a twenty-day file and then hunting for it on a map of
   * the whole country is the work the picker was meant to remove.
   */
  useEffect(() => {
    const L = LRef.current, map = mapRef.current
    if (!L || !map || playDay == null) return
    const onDay = places.slice(playRange.start, playRange.end + 1)
    if (onDay.length === 0) return
    map.flyToBounds(L.latLngBounds(onDay.map(p => [p.lat, p.lng] as LatLng)),
      { padding: [72, 72], maxZoom: 12, duration: 0.8 })
  }, [playDay, playRange, places, mapReady])

  /** Re-frame the route after a rebuild brings back a different set of pins. */
  const fittedRef = useRef<string>('')
  useEffect(() => {
    const L = LRef.current, map = mapRef.current
    if (!L || !map || places.length === 0) return
    const signature = places.map(p => `${p.lat.toFixed(3)},${p.lng.toFixed(3)}`).join('|')
    if (fittedRef.current === signature) return
    if (fittedRef.current !== '') {
      map.flyToBounds(L.latLngBounds(places.map(p => [p.lat, p.lng] as LatLng)), { padding: [56, 56], maxZoom: 11, duration: 0.9 })
    }
    fittedRef.current = signature
  }, [places, mapReady])

  useEffect(() => {
    if (!fullscreen) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setFullscreen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [fullscreen])

  // Keep the place strip tracking whichever card the map is on.
  useEffect(() => {
    const focus = selectedId ?? activeId
    if (!focus || !stripRef.current) return
    stripRef.current.querySelector<HTMLElement>(`[data-place-id="${cssEscape(focus)}"]`)
      ?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' })
  }, [selectedId, activeId])

  const fitAll = useCallback(() => {
    const L = LRef.current, map = mapRef.current
    if (!L || !map || places.length === 0) return
    setFreeLook(false)
    map.flyToBounds(L.latLngBounds(places.map(p => [p.lat, p.lng] as LatLng)), { padding: [56, 56], maxZoom: 11, duration: 0.9 })
  }, [places])

  const selectPlace = useCallback((p: Place) => {
    setPlaying(false)
    setActiveId(p.id)
    setSelectedId(p.id)
    // The card animates in over ~250ms; re-framing after it has taken up its
    // space is what actually keeps the pin visible.
    cardOpenRef.current = true
    flyTo(p.lat, p.lng, 12)
    setTimeout(() => flyTo(p.lat, p.lng, 12), 280)
  }, [flyTo])

  /**
   * Play, and on the traveller's own portal go fullscreen with it.
   *
   * The trip page is a long scroll on a phone; a fly-through playing inside a
   * 40%-tall card in the middle of it is a thumbnail of a film. Fullscreen for
   * the length of the run is the whole difference between a decoration and
   * something a guest actually watches.
   */
  const togglePlay = useCallback(() => {
    setPlaying(prev => {
      const next = !prev
      if (next) {
        setFreeLook(false)
        if (settings.portalFullscreen && (guest || isMobile)) setFullscreen(true)
      }
      return next
    })
  }, [guest, isMobile, settings.portalFullscreen])

  // ── Render ─────────────────────────────────────────────────────────────

  const dark = BASEMAPS.find(b => b.id === basemap)?.dark ?? false

  if (loading) return <JourneyShell className={className} skin={skin}><MapSkeleton skin={skin} /></JourneyShell>

  if (error || !journey || places.length === 0) {
    return (
      <JourneyShell className={className} skin={skin}>
        <div className="h-[420px] sm:h-[520px] flex flex-col items-center justify-center gap-3 text-center px-8">
          <div className={cn('w-12 h-12 rounded-2xl flex items-center justify-center', theme === 'dark' ? 'bg-white/5' : 'bg-slate-100')}>
            <Compass className={cn('w-6 h-6', skin.muted)} />
          </div>
          <p className={cn('text-sm font-medium', skin.strong)}>
            {guest
              ? 'Your map is on its way'
              : error ? 'The journey map could not be built'
              : agenda ? 'No mappable movements yet'
              : 'No mappable places on this itinerary'}
          </p>
          <p className={cn('text-xs max-w-xs', skin.body)}>
            {guest
              ? 'We will plot your route here as soon as your day-by-day plan is confirmed.'
              : error ?? (agenda
                ? 'This map is drawn from the movement chart. Generate the agenda — or give its rows a From and To point — and it will plot itself.'
                : 'The itinerary days do not name a place we can pin. Add a location to the day titles and rebuild.')}
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

  const nextPlace = places[Math.min(legIndexNow + 1, places.length - 1)]
  const legNow = nextPlace?.arrive ?? null

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: MAP_CSS }} />
      {fullscreen && <div className="fixed inset-0 z-[59] bg-slate-950/70 backdrop-blur-sm" onClick={() => setFullscreen(false)} />}

      {/* No framer `layout` prop here on purpose: animating the box size
          scales its children, and a scaled Leaflet pane renders as smeared or
          missing tiles for the length of the animation. The container snaps to
          its new size and the ResizeObserver above re-lays the tiles. */}
      <div
        // `--jm-card` is how much of the panel the open side drawer owns. The
        // drawer sets its own width from it and every piece of map chrome keeps
        // clear of it, so the two can never disagree about where the seam is.
        // `--jm-rot` is the map's bearing, and `--jm-unrot` its inverse, which
        // every pin and label uses to stay upright inside a rotated map.
        style={{
          '--jm-card': sideOpen ? SIDE_CARD_W : '0px',
          '--jm-rot': `${rotation}deg`,
          '--jm-unrot': `${-rotation}deg`,
          // A rotated square leaves triangles of nothing in the corners, so the
          // map surface is oversized while the map is turned — and only while.
          '--jm-bleed': rotation === 0 ? '0px' : '-22%',
        } as React.CSSProperties}
        className={cn(
          'jm-wrap group relative overflow-hidden border shadow-card flex flex-col',
          dark ? 'border-white/10 bg-slate-950' : skin.shell,
          playing && 'jm-playing',
          fullscreen
            ? 'fixed inset-0 sm:inset-4 z-[60] rounded-none sm:rounded-2xl shadow-2xl'
            : cn('rounded-2xl', className),
        )}
      >
        {/* ── The map ──
            The frame is the clip; the rotor inside it is what actually turns,
            so the chrome laid over the top never rotates with the tiles. */}
        <div
          ref={frameRef}
          className={cn(
            'relative w-full overflow-hidden',
            fullscreen ? 'flex-1 min-h-0' : MAP_HEIGHT,
            // Belt and braces with `dragging.disable()`: tells the browser it
            // may scroll the page from a gesture that starts here.
            !interactive && 'touch-pan-y',
          )}
        >
          <div className="jm-rotor">
            <div ref={containerRef} className="w-full h-full" />
          </div>
          {/* A vignette that only shows during the fly-through. It is what
              makes the mode read as a film rather than as a map that has
              started moving on its own. */}
          <div className="jm-vignette pointer-events-none absolute inset-0 z-[450]" />
        </div>

        {/* ── Top-left: what this journey is ── */}
        <div className="pointer-events-none absolute top-3 left-3 z-[500] flex flex-col gap-2">
          <motion.div
            initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
            // Capped on a phone so the transport chips wrap inside the card
            // instead of growing it under the controls in the top-right.
            className={cn(
              'pointer-events-auto rounded-xl backdrop-blur-md shadow-lg ring-1 px-2.5 py-1.5 sm:px-3 sm:py-2',
              'max-w-[60vw] sm:max-w-none', skin.glass,
            )}
          >
            <div className="flex items-center gap-1.5 text-[9px] sm:text-[10px] font-bold uppercase tracking-wider text-brand-500">
              <Route className="w-3 h-3" />
              {guest ? 'Your journey' : agenda ? 'Movement chart' : 'Journey'}
            </div>
            <p className={cn('text-[13px] sm:text-sm font-semibold leading-tight mt-0.5', skin.title)}>
              {journey.countries.join(' · ') || 'Route'}
            </p>
            <div className={cn('flex items-center gap-2.5 sm:gap-3 mt-1 sm:mt-1.5 text-[10px] sm:text-[11px]', skin.body)}>
              {agenda && journey.dayCount ? (
                <span className="inline-flex items-center gap-1"><CalendarDays className={cn('w-3 h-3', skin.muted)} />{journey.dayCount} days</span>
              ) : null}
              <span className="inline-flex items-center gap-1">
                <MapPin className={cn('w-3 h-3', skin.muted)} />
                {places.length} place{places.length === 1 ? '' : 's'}
              </span>
              {/* Road distance where the legs actually routed, straight-line
                  where they could not — the arc's number was never a distance
                  anybody drives. */}
              <span
                className="inline-flex items-center gap-1"
                title={journey.totalRoadKm ? 'Driving distance along the routed legs' : 'Straight-line distance'}
              >
                <Navigation className={cn('w-3 h-3', skin.muted)} />
                {(journey.totalRoadKm || journey.totalKm).toLocaleString()} km
              </span>
              {!!journey.totalDriveMin && (
                <span className="inline-flex items-center gap-1" title="Free-flow driving time — no traffic, no stops">
                  <Clock className={cn('w-3 h-3', skin.muted)} />{fmtDrive(journey.totalDriveMin)} drive
                </span>
              )}
              {journey.hotels.length > 0 && (
                <span className="inline-flex items-center gap-1">
                  <span className="w-2 h-2 rounded-[3px] bg-orange-500" />{journey.hotels.length} stays
                </span>
              )}
              {/* The sectors flown between destinations on this same file. The
                  chart never books them, so without this the map's own leg
                  count would quietly disagree with the route it is drawing. */}
              {flightStats.drawn.length > 0 && (
                <span
                  className="inline-flex items-center gap-1 font-semibold text-violet-500"
                  title={flightStats.drawn
                    .map(f => `${f.flightNo} ${f.fromApt}→${f.toApt} (${f.sector})`)
                    .join(' · ')}
                >
                  <Plane className="w-3 h-3" />
                  {flightStats.drawn.length} flight{flightStats.drawn.length === 1 ? '' : 's'}
                  {flightStats.inter > 0 && (
                    <span className={skin.muted}>· {flightStats.inter} inter</span>
                  )}
                </span>
              )}
            </div>

            {/* How the guests actually travel across the whole file, counted.
                On a chart that is half private cars and half seat-in-coach this
                is the first thing an operator wants off the map. */}
            {modeCounts.length > 0 && (
              <div className="flex flex-wrap items-center gap-1 mt-1.5">
                {modeCounts.slice(0, 4).map(([mode, { t, count }]) => (
                  <span
                    key={mode}
                    title={`${t.label} — ${count} movement${count === 1 ? '' : 's'}`}
                    className={cn(
                      'inline-flex items-center gap-1 rounded-full pl-1 pr-1.5 py-[1px] text-[9px] sm:text-[10px] font-bold ring-1',
                      theme === 'dark' ? 'bg-white/10 ring-white/15' : 'bg-white/70 ring-slate-900/10',
                    )}
                    style={{ color: t.hex }}
                  >
                    <span className="text-[11px] leading-none">{t.emoji}</span>
                    {t.short}
                    <span className={skin.muted}>{count}</span>
                  </span>
                ))}
              </div>
            )}
          </motion.div>

          {/* Legend doubles as a filter — click a kind to fade it out. */}
          <motion.div
            initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.18 }}
            className={cn(
              'pointer-events-auto gap-1',
              // A wrapped legend eats a phone's map. On mobile it collapses
              // behind the filter button and opens as one scrolling row.
              'hidden sm:flex sm:flex-wrap sm:max-w-[230px]',
              playing && 'sm:hidden',
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

        {/* ── Now playing: what the vehicle is doing, while it does it ── */}
        <AnimatePresence>
          {playing && nextPlace && (
            <motion.div
              initial={{ opacity: 0, y: -10, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -10, scale: 0.97 }}
              className="pointer-events-none absolute top-3 left-1/2 -translate-x-1/2 z-[520] w-[min(92%,420px)]"
              style={{ marginLeft: 'calc(var(--jm-card) / -2)' }}
            >
              <div className={cn('jm-hud rounded-2xl backdrop-blur-xl shadow-2xl ring-1 px-3 py-2', skin.glassSolid)}>
                <div className="flex items-center gap-2">
                  <span className="jm-hud-pulse w-2 h-2 rounded-full bg-brand-500 flex-shrink-0" />
                  <span className={cn('text-[9.5px] font-black uppercase tracking-[0.14em]', skin.muted)}>
                    Leg {Math.min(legIndexNow + 1, places.length - 1)} of {places.length - 1}
                  </span>
                  {legNow?.transport && (
                    <span
                      className="inline-flex items-center gap-1 rounded-full px-1.5 py-[1px] text-[9px] font-bold leading-none"
                      style={{ background: `${legNow.transport.hex}22`, color: legNow.transport.hex }}
                    >
                      <span className="text-[10px] leading-none">{legNow.transport.emoji}</span>
                      {legNow.transport.short}
                    </span>
                  )}
                  <span className={cn('ml-auto text-[9.5px] font-bold tabular-nums', skin.muted)}>
                    {speedLabel(speed)}
                  </span>
                </div>
                <p className={cn('mt-0.5 text-[13px] font-bold leading-tight truncate', skin.title)}>
                  {nextPlace.name}
                </p>
                <div className={cn('mt-0.5 flex items-center gap-2.5 text-[10px]', skin.body)}>
                  {nextPlace.date && (
                    <span className="inline-flex items-center gap-1"><CalendarDays className="w-3 h-3" />{formatDate(nextPlace.date)}</span>
                  )}
                  {legNow?.roadKm ? (
                    <span className="inline-flex items-center gap-1"><Navigation className="w-3 h-3" />{legNow.roadKm.toLocaleString()} km</span>
                  ) : legNow?.moveKm ? (
                    <span className="inline-flex items-center gap-1"><Navigation className="w-3 h-3" />{legNow.moveKm.toLocaleString()} km</span>
                  ) : null}
                  {legNow?.roadMin ? (
                    <span className="inline-flex items-center gap-1"><Clock className="w-3 h-3" />{fmtDrive(legNow.roadMin)}</span>
                  ) : null}
                </div>
                <div className={cn('mt-1.5 h-1 rounded-full overflow-hidden', theme === 'dark' ? 'bg-white/10' : 'bg-slate-900/10')}>
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-brand-400 to-brand-600 transition-[width] duration-150"
                    style={{ width: `${Math.round(progress * 100)}%` }}
                  />
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Top-right: controls ── */}
        <div
          className="absolute top-3 z-[500] flex items-center gap-1.5 transition-[right] duration-300"
          style={{ right: 'calc(var(--jm-card) + 0.75rem)' }}
        >
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
            <IconBtn label="Filter places" skin={skin} onClick={() => setShowLegend(v => !v)} active={showLegend}>
              <SlidersHorizontal className="w-4 h-4" />
            </IconBtn>
          </div>
          {/* Which day the fly-through covers. A twenty-day route played end
              to end is a screensaver; one day is an answer. */}
          {dayNumbers.length > 1 && (
            <div className="relative">
              <button
                onClick={() => setShowDays(v => !v)}
                title="Choose which day the fly-through covers"
                className={cn(
                  'h-9 sm:h-8 px-2 rounded-lg inline-flex items-center gap-1 text-[11px] font-bold shadow-lg ring-1 backdrop-blur-md transition-all hover:scale-105 active:scale-95',
                  playDay != null || showDays ? 'bg-brand-500 text-white ring-brand-400/40' : skin.btn,
                )}
              >
                <CalendarDays className="w-4 h-4" />
                {playDay == null ? 'All' : `D${playDay}`}
              </button>
              <AnimatePresence>
                {showDays && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.94, y: -6 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.94, y: -6 }}
                    className={cn('jm-scroll absolute right-0 mt-1.5 w-44 max-h-64 overflow-y-auto rounded-xl backdrop-blur-md shadow-xl ring-1 p-1', skin.glassSolid)}
                  >
                    <button
                      onClick={() => { setPlayDay(null); setShowDays(false) }}
                      className={cn(
                        'w-full text-left px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-colors',
                        playDay == null
                          ? 'bg-brand-500/15 text-brand-500'
                          : cn(skin.body, theme === 'dark' ? 'hover:bg-white/10' : 'hover:bg-slate-100'),
                      )}
                    >
                      All days
                    </button>
                    {dayNumbers.map(d => {
                      const first = places.find(x => x.dayNo === d)
                      const legs = places.filter(x => x.dayNo === d).length
                      return (
                        <button
                          key={d}
                          onClick={() => { setPlayDay(d); setShowDays(false) }}
                          className={cn(
                            'w-full flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-colors',
                            playDay === d
                              ? 'bg-brand-500/15 text-brand-500'
                              : cn(skin.body, theme === 'dark' ? 'hover:bg-white/10' : 'hover:bg-slate-100'),
                          )}
                        >
                          <span>Day {d}</span>
                          {first?.date && <span className={cn('text-[10px] truncate', skin.muted)}>{formatDate(first.date)}</span>}
                          <span className={cn('ml-auto text-[10px]', skin.muted)}>{legs}</span>
                        </button>
                      )
                    })}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}

          {/* Speed. The shared default comes from the settings page; this is
              the viewer's own override, remembered in their browser. */}
          <div className="relative">
            <button
              onClick={() => setShowSpeed(v => !v)}
              title="Playback speed"
              className={cn(
                'h-9 sm:h-8 px-2 rounded-lg inline-flex items-center gap-1 text-[11px] font-bold shadow-lg ring-1 backdrop-blur-md transition-all hover:scale-105 active:scale-95',
                showSpeed || speedOverride != null ? 'bg-brand-500 text-white ring-brand-400/40' : skin.btn,
              )}
            >
              <Gauge className="w-4 h-4" />
              {speedLabel(speed)}
            </button>
            <AnimatePresence>
              {showSpeed && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.94, y: -6 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.94, y: -6 }}
                  className={cn('absolute right-0 mt-1.5 w-40 rounded-xl backdrop-blur-md shadow-xl ring-1 p-1', skin.glassSolid)}
                >
                  <p className={cn('px-2.5 pt-1 pb-1.5 text-[9px] font-bold uppercase tracking-wider', skin.muted)}>
                    Fly-through speed
                  </p>
                  {JM_SPEED_STEPS.map(s => (
                    <button
                      key={s}
                      onClick={() => { pickSpeed(s); setShowSpeed(false) }}
                      className={cn(
                        'w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-colors',
                        Math.abs(speed - s) < 1e-6
                          ? 'bg-brand-500/15 text-brand-500'
                          : cn(skin.body, theme === 'dark' ? 'hover:bg-white/10' : 'hover:bg-slate-100'),
                      )}
                    >
                      {speedLabel(s)}
                      <span className={cn('ml-auto text-[9.5px] font-medium', skin.muted)}>
                        {s < 1 ? 'slower' : s > 1 ? 'faster' : 'normal'}
                      </span>
                    </button>
                  ))}
                  <button
                    onClick={() => { pickSpeed(null); setShowSpeed(false) }}
                    className={cn('w-full text-left px-2.5 py-1.5 mt-0.5 rounded-lg text-[10.5px] font-semibold border-t', skin.muted, skin.hairline)}
                  >
                    Use the saved default ({speedLabel(settings.speed)})
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
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
            <IconBtn label={agenda ? 'Rebuild from movement chart' : 'Rebuild from itinerary'} skin={skin} onClick={() => void load(true)}>
              <RefreshCw className={cn('w-4 h-4', refreshing && 'animate-spin')} />
            </IconBtn>
          )}
          <IconBtn label={fullscreen ? 'Exit fullscreen (Esc)' : 'Fullscreen'} skin={skin} onClick={() => setFullscreen(v => !v)}>
            {fullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </IconBtn>
        </div>

        {/* ── Right rail: zoom and bearing ──
            Always there, playback included: the camera riding with the vehicle
            is a default, not a cage, and someone watching a coach come into
            Kandy should be able to pull in closer without stopping the film. */}
        <div
          className="absolute z-[500] top-1/2 -translate-y-1/2 flex flex-col items-center gap-1.5 transition-[right] duration-300"
          style={{ right: 'calc(var(--jm-card) + 0.75rem)' }}
        >
          <IconBtn label="Zoom in" skin={skin} onClick={() => zoomBy(1)}><ZoomIn className="w-4 h-4" /></IconBtn>
          <IconBtn label="Zoom out" skin={skin} onClick={() => zoomBy(-1)}><ZoomOut className="w-4 h-4" /></IconBtn>
          <IconBtn label="Rotate left" skin={skin} onClick={() => setRotation(r => normalizeAngle(r - 15))}>
            <RotateCcw className="w-4 h-4" />
          </IconBtn>
          <IconBtn label="Rotate right" skin={skin} onClick={() => setRotation(r => normalizeAngle(r + 15))}>
            <RotateCw className="w-4 h-4" />
          </IconBtn>
          {rotation !== 0 && (
            <button
              onClick={() => setRotation(0)}
              title="Face north"
              className={cn(
                'w-9 h-9 sm:w-8 sm:h-8 rounded-lg flex items-center justify-center shadow-lg ring-1 backdrop-blur-md transition-all hover:scale-105 active:scale-95',
                skin.btn,
              )}
            >
              <span className="jm-compass" style={{ transform: `rotate(${rotation}deg)` }}>
                <Navigation className="w-4 h-4 text-rose-500" />
              </span>
            </button>
          )}
        </div>

        {/* The camera is the viewer's now — offered back, never taken. */}
        <AnimatePresence>
          {playing && freeLook && (
            <motion.button
              initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }}
              onClick={recenter}
              className="absolute z-[520] bottom-[124px] left-1/2 -translate-x-1/2 inline-flex items-center gap-1.5 rounded-full bg-brand-500 text-white px-3 py-1.5 text-[11px] font-bold shadow-xl ring-1 ring-white/30 active:scale-95"
              style={{ marginLeft: 'calc(var(--jm-card) / -2)' }}
            >
              <Crosshair className="w-3.5 h-3.5" /> Follow the vehicle
            </motion.button>
          )}
        </AnimatePresence>

        {/* ── Bottom: playback + place strip ── */}
        <div
          className={cn(
            'absolute bottom-0 left-0 z-[500] p-3 pt-10 transition-[right] duration-300',
            'bg-gradient-to-t from-slate-900/45 via-slate-900/10 to-transparent',
          )}
          style={{ right: 'var(--jm-card)' }}
        >
          <div className="flex items-end gap-2">
            <div className="flex flex-col gap-1.5">
              <button
                onClick={togglePlay}
                disabled={places.length < 2}
                className={cn(
                  'jm-play w-12 h-12 sm:w-11 sm:h-11 rounded-full flex items-center justify-center shadow-lg ring-1 ring-white/40 transition-all',
                  'bg-gradient-to-br from-brand-500 to-brand-600 text-white hover:scale-105 active:scale-95',
                  'disabled:opacity-40 disabled:hover:scale-100',
                  playing && 'jm-play-on',
                )}
                title={playing
                  ? 'Pause the fly-through'
                  : playDay != null ? `Fly through Day ${playDay}` : 'Fly through the journey'}
              >
                {playing ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5 ml-0.5" />}
              </button>
              {progress < 1 && !playing && (
                <button
                  onClick={() => { setProgress(1); setActiveId(null); setSelectedId(null); setPlayDay(null); fitAll() }}
                  className={cn('w-12 h-8 sm:w-11 sm:h-7 rounded-full backdrop-blur-md shadow ring-1 flex items-center justify-center', skin.btn)}
                  title="Reset"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* One card per *place*, in the order the guests reach them —
                see `buildPlaces`. Scroll-snapped on touch so a flick lands on a
                place rather than between two. */}
            <div ref={stripRef} className="jm-strip flex-1 flex gap-1.5 overflow-x-auto pb-1.5 snap-x snap-mandatory">
              {places.map(p => (
                <PlaceCard
                  key={p.id}
                  place={p}
                  skin={skin}
                  theme={theme}
                  agenda={agenda}
                  selected={p.id === selectedId}
                  active={p.id === activeId}
                  passed={p.seq - 1 < legIndexNow && progress < 1}
                  onSelect={() => selectPlace(p)}
                  onHover={setHoveredId}
                />
              ))}
            </div>
          </div>
        </div>

        {/* ── Detail drawer ── */}
        <AnimatePresence>
          {selected && (
            <ActivityDrawer
              key={selected.id}
              bookingRef={bookingRef}
              place={selected}
              variant={isMobile ? 'sheet' : 'side'}
              skin={skin}
              guest={guest}
              portalToken={portalToken}
              onClose={() => setSelectedId(null)}
              onPrev={() => {
                const i = places.findIndex(p => p.id === selected.id)
                if (i > 0) selectPlace(places[i - 1])
              }}
              onNext={() => {
                const i = places.findIndex(p => p.id === selected.id)
                if (i < places.length - 1) selectPlace(places[i + 1])
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

// ─── The place card ──────────────────────────────────────────────────────

/**
 * One place, as a card in the bottom strip.
 *
 * This used to be one card per movement — "Hanoi Anise Hotel → Train Street" —
 * which reads as a list of car journeys and prints the same hotel twice. A card
 * is now a *place*, numbered in the order it is reached, and it carries the
 * three things somebody actually asks about it: how they get there, when, and
 * what is booked for them once they arrive.
 */
function PlaceCard({ place, skin, theme, agenda, selected, active, passed, onSelect, onHover }: {
  place: Place
  skin: Skin
  theme: 'light' | 'dark'
  agenda: boolean
  selected: boolean
  active: boolean
  passed: boolean
  onSelect: () => void
  onHover: (id: string | null) => void
}) {
  const k = KIND[place.kind] ?? KIND.tour
  const arrive = place.arrive
  const flight = place.flight
  const hotel = place.hotel
  // The hotel block is only worth the height where the stay *is* this place —
  // on a sightseeing stop it would repeat the same hotel on eight cards.
  const stayHere = hotel && (place.kind === 'hotel' || sameName(hotel.name, place.name))
  const km = arrive?.roadKm ?? arrive?.moveKm ?? null
  const arriveAt = arrive?.timeTo ?? (flight && place.flightEnd === 'to' ? flight.arrTime : null)
  const leaveAt = place.depart?.timeFrom ?? place.depart?.meetingTime
    ?? (flight && place.flightEnd === 'from' ? flight.depTime : null)

  return (
    <button
      data-place-id={place.id}
      onClick={onSelect}
      onMouseEnter={() => onHover(place.id)}
      onMouseLeave={() => onHover(null)}
      className={cn(
        'jm-card group/place relative flex-shrink-0 snap-center text-left rounded-2xl p-2.5 transition-all duration-200',
        'backdrop-blur-md shadow ring-1 hover:-translate-y-1 hover:shadow-xl active:scale-95',
        agenda ? 'w-[206px] sm:w-[196px]' : 'w-[168px] sm:w-[160px]',
        skin.glassSolid,
        flight && 'ring-violet-400/60',
        passed && 'opacity-60 saturate-[.7]',
        active && !selected && 'ring-2 ring-brand-400/70',
        selected && 'ring-2 !ring-brand-500 -translate-y-1 shadow-xl',
      )}
    >
      {/* The order along the route, which is the one thing a strip of cards
          has to make obvious and a repeated day number never did. */}
      <span
        className="jm-card-seq absolute -top-1 -left-1 w-5 h-5 rounded-full flex items-center justify-center text-[9.5px] font-black text-white shadow"
        style={{ background: k.hex }}
      >
        {place.seq}
      </span>

      <div className="flex items-center gap-1.5 pl-3">
        <span
          className="w-5 h-5 rounded-md flex items-center justify-center flex-shrink-0"
          style={{ background: k.hex }}
          dangerouslySetInnerHTML={{ __html: glyphSvg(place.kind, 11) }}
        />
        {place.dayNo > 0 && (
          <span className={cn('text-[10px] font-extrabold', skin.title)}>D{place.dayNo}</span>
        )}
        {place.date && <span className={cn('text-[9px] truncate', skin.muted)}>{formatDate(place.date)}</span>}
      </div>

      <p className={cn('mt-1.5 text-[12px] font-bold leading-tight line-clamp-2', skin.title)}>
        {place.name}
      </p>
      {place.city && !sameName(place.city, place.name) && (
        <p className={cn('text-[9.5px] truncate', skin.muted)}>{place.city}</p>
      )}

      {/* When they are here. Two times, because "arrives 10:50, leaves 12:30"
          is the shape of a stop and a single clock is the shape of a row. */}
      {(arriveAt || leaveAt) && (
        <div className={cn('mt-1 flex items-center gap-1.5 text-[9.5px] font-semibold tabular-nums', skin.body)}>
          {arriveAt && (
            <span className="inline-flex items-center gap-0.5" title="Arrives">
              <ArrowDownRight className="w-2.5 h-2.5 text-emerald-500" />{arriveAt}
            </span>
          )}
          {leaveAt && (
            <span className="inline-flex items-center gap-0.5" title="Leaves">
              <ArrowUpRight className="w-2.5 h-2.5 text-rose-500" />{leaveAt}
            </span>
          )}
        </div>
      )}

      {/* How they got here. A sector reads as a boarding pass: no vehicle, no
          pickup point, no driver — a flight number and two airport codes. */}
      {flight ? (
        <div className="mt-1.5 rounded-xl px-1.5 py-1 bg-gradient-to-r from-violet-500/15 to-indigo-500/15 ring-1 ring-violet-500/30">
          <div className="flex items-center justify-between gap-1">
            <span className="text-[9.5px] font-black tracking-wide text-violet-500">{flight.flightNo}</span>
            {flight.airline && (
              <span className={cn('text-[8.5px] truncate max-w-[86px]', skin.muted)}>{flight.airline}</span>
            )}
          </div>
          <div className="mt-0.5 flex items-center gap-1.5">
            <div>
              <p className={cn('text-[11px] font-black leading-none', place.flightEnd === 'from' ? skin.title : skin.muted)}>{flight.fromApt}</p>
              <p className={cn('text-[8.5px] tabular-nums leading-tight', skin.muted)}>{flight.depTime ?? '--:--'}</p>
            </div>
            <div className="jm-pass-track flex-1">
              <span className="block w-full border-t border-dashed border-violet-400/70" />
              <Plane className="jm-pass-plane w-2.5 h-2.5 text-violet-500 rotate-90" />
            </div>
            <div className="text-right">
              <p className={cn('text-[11px] font-black leading-none', place.flightEnd === 'to' ? skin.title : skin.muted)}>{flight.toApt}</p>
              <p className={cn('text-[8.5px] tabular-nums leading-tight', skin.muted)}>{flight.arrTime ?? '--:--'}</p>
            </div>
          </div>
          <p className={cn('mt-0.5 flex items-center gap-1 text-[8.5px] font-semibold', skin.muted)}>
            {place.flightEnd === 'from'
              ? <><PlaneTakeoff className="w-2.5 h-2.5" /> Departs from here</>
              : <><PlaneLanding className="w-2.5 h-2.5" /> Lands here</>}
            {flight.durationMin != null && <span>· {fmtDrive(flight.durationMin)}</span>}
            {flight.km != null && <span>· {flight.km.toLocaleString()} km</span>}
          </p>
        </div>
      ) : arrive?.transport ? (
        <div className="mt-1.5 flex flex-wrap items-center gap-1">
          <span
            className="inline-flex items-center gap-1 rounded-full px-1.5 py-[1px] text-[9px] font-bold leading-none"
            style={{ background: `${arrive.transport.hex}1f`, color: arrive.transport.hex }}
            title={`Arrives by ${arrive.transport.label}`}
          >
            <span className="text-[10px] leading-none">{arrive.transport.emoji}</span>
            {arrive.transport.short}
          </span>
          {km != null && km > 0 && (
            <span className={cn('text-[9px] tabular-nums', skin.muted)} title={arrive.roadKm ? 'By road' : 'Straight line'}>
              {km.toLocaleString()} km{arrive.roadMin ? ` · ${fmtDrive(arrive.roadMin)}` : ''}
            </span>
          )}
        </div>
      ) : null}

      {/* What is booked for them here — the room, not just the hotel name. */}
      {stayHere && hotel ? (
        <div className={cn('mt-1.5 pt-1.5 border-t', skin.hairline)}>
          <p className={cn('flex items-center gap-1 text-[9.5px] font-bold truncate', skin.strong)}>
            <BedDouble className="w-2.5 h-2.5 flex-shrink-0 text-orange-500" />
            <span className="truncate">{hotel.roomType || (hotel.checkIn ? 'Check in' : 'Overnight')}</span>
            {hotel.nights ? <span className={skin.muted}>· {hotel.nights}n</span> : null}
          </p>
          {(hotel.mealType || arrive?.mealPlan) && (
            <p className={cn('flex items-center gap-1 text-[9px] truncate', skin.muted)}>
              <Utensils className="w-2.5 h-2.5 flex-shrink-0" />
              <span className="truncate">{hotel.mealType || arrive?.mealPlan}</span>
            </p>
          )}
        </div>
      ) : hotel ? (
        <p className={cn('mt-1.5 flex items-center gap-1 text-[9px] truncate', skin.muted)}>
          <BedDouble className="w-2.5 h-2.5 flex-shrink-0 text-orange-500" />
          <span className="truncate">{hotel.name}</span>
        </p>
      ) : null}

      {/* A hairline that fills as the vehicle crosses the leg into this place. */}
      <span
        className={cn(
          'absolute left-2.5 right-2.5 bottom-1 h-[2px] rounded-full transition-opacity',
          active ? 'opacity-100' : 'opacity-0',
          theme === 'dark' ? 'bg-brand-400' : 'bg-brand-500',
        )}
      />
    </button>
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
function ActivityDrawer({ bookingRef, place, variant, skin, guest, portalToken, onClose, onPrev, onNext }: {
  bookingRef: string
  place: Place
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

  // The movement that brought them here is what describes the place; where
  // there is none — the very first place on a file — the one that takes them
  // away is the only row that mentions it at all.
  const anchor = place.arrive ?? place.depart
  const flight = place.flight
  const hotel = place.hotel
  const stayHere = hotel && (place.kind === 'hotel' || sameName(hotel.name, place.name))

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
            place: place.name, title: anchor?.title ?? place.name,
            city: place.city, country: place.country,
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
  }, [bookingRef, portalToken, place.name, place.city, place.country, anchor?.title])

  const k = KIND[place.kind] ?? KIND.tour
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
      // Sized from the shared constant, not from `--jm-card`: the variable
      // drops to zero the moment the stop is deselected, and a card that
      // shrinks to nothing rather than sliding away reads as a glitch.
      style={sheet ? undefined : { width: SIDE_CARD_W }}
      className={cn(
        'absolute z-[600] backdrop-blur-xl shadow-2xl ring-1 flex flex-col', skin.sheet,
        sheet
          ? 'left-0 right-0 bottom-0 max-h-[62%] rounded-t-2xl overflow-hidden touch-pan-y'
          // Half the panel, and the map keeps the other half — the whole point
          // of reading a stop is seeing where it is while you read it. Capped
          // on very wide screens, where a true half would be a 900px-wide
          // column of body text nobody can scan.
          : 'top-0 right-0 bottom-0 rounded-l-2xl overflow-hidden',
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
              alt={place.name}
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
            <span dangerouslySetInnerHTML={{ __html: glyphSvg(place.kind, 11) }} />
            {place.dayNo > 0 ? `Day ${place.dayNo} · ` : ''}{k.label}
          </span>
          <div className="flex items-center gap-1">
            <DrawerBtn onClick={onPrev} label="Previous day"><ChevronLeft className="w-4 h-4" /></DrawerBtn>
            <DrawerBtn onClick={onNext} label="Next day"><ChevronRight className="w-4 h-4" /></DrawerBtn>
            <DrawerBtn onClick={onClose} label="Close"><X className="w-4 h-4" /></DrawerBtn>
          </div>
        </div>

        <div className="absolute bottom-2.5 left-3 right-3">
          <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-white/85 text-slate-900 text-[10px] font-black align-middle mr-1.5">
            {place.seq}
          </span>
          <h4 className="inline text-white font-bold text-[17px] leading-tight drop-shadow align-middle">{place.name}</h4>
          <p className="text-white/80 text-[11px] mt-0.5 flex items-center gap-1.5">
            <MapPin className="w-3 h-3" />
            {[place.city, place.country].filter(Boolean).join(', ') || '—'}
            {place.date && <><span className="opacity-50">·</span>{formatDate(place.date)}</>}
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
      <div className="jm-scroll flex-1 overflow-y-auto px-4 py-3.5 space-y-4 overscroll-contain">
        {/* The place, as it is booked.
            Three questions in the order anyone asks them: how do they get
            here, what is waiting for them when they do, and how do they leave
            again. All three come off the movement chart, so they sit above the
            researched write-up rather than under it. */}

        {/* The booked sector, as its ticket reads. */}
        {flight && (
          <div className="rounded-xl ring-1 ring-violet-500/30 overflow-hidden bg-gradient-to-br from-violet-500/12 to-indigo-500/12">
            <div className="flex items-center justify-between gap-2 px-3 pt-2.5 pb-2">
              <span className="inline-flex items-center gap-1.5 text-[11px] font-black tracking-wide text-violet-500">
                <Plane className="w-3.5 h-3.5" />
                {flight.flightNo}
                {flight.airline && (
                  <span className={cn('font-medium tracking-normal', skin.sheetMuted)}>{flight.airline}</span>
                )}
              </span>
              <span className={cn('text-[9.5px] font-bold uppercase tracking-wider', skin.sheetMuted)}>
                {flight.sector === 'internal' ? 'Inter-flight'
                  : flight.sector === 'inbound' ? 'Arrival flight' : 'Departure flight'}
              </span>
            </div>

            <div className="flex items-end gap-2 px-3 pb-2.5">
              <div className="min-w-0">
                <p className={cn('text-[19px] font-black leading-none tracking-tight', place.flightEnd === 'from' ? skin.sheetTitle : skin.sheetMuted)}>{flight.fromApt}</p>
                <p className={cn('text-[11px] font-bold tabular-nums mt-0.5', skin.sheetBody)}>{flight.depTime ?? '--:--'}</p>
                <p className={cn('text-[9.5px] truncate max-w-[110px]', skin.sheetMuted)}>{flight.fromCity ?? flight.fromName ?? ''}</p>
              </div>
              <div className="jm-pass-track flex-1 mb-4">
                <span className="block w-full border-t border-dashed border-violet-400/70" />
                <Plane className="jm-pass-plane w-3 h-3 text-violet-500 rotate-90" />
              </div>
              <div className="min-w-0 text-right">
                <p className={cn('text-[19px] font-black leading-none tracking-tight', place.flightEnd === 'to' ? skin.sheetTitle : skin.sheetMuted)}>{flight.toApt}</p>
                <p className={cn('text-[11px] font-bold tabular-nums mt-0.5', skin.sheetBody)}>{flight.arrTime ?? '--:--'}</p>
                <p className={cn('text-[9.5px] truncate max-w-[110px] ml-auto', skin.sheetMuted)}>{flight.toCity ?? flight.toName ?? ''}</p>
              </div>
            </div>

            <div className={cn('flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 border-t border-violet-500/20 text-[10px]', skin.sheetMuted)}>
              <span className="inline-flex items-center gap-1"><CalendarDays className="w-3 h-3" />{formatDate(flight.date)}</span>
              {flight.durationMin != null && (
                <span className="inline-flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  {Math.floor(flight.durationMin / 60)}h {String(flight.durationMin % 60).padStart(2, '0')}m
                </span>
              )}
              {flight.km != null && (
                <span className="inline-flex items-center gap-1"><Navigation className="w-3 h-3" />{flight.km.toLocaleString()} km</span>
              )}
            </div>

            <p className={cn('px-3 pb-2.5 text-[10px] leading-snug', skin.sheetMuted)}>
              {place.flightEnd === 'from'
                ? (guest ? 'Your flight leaves from here.' : 'The sector departs this airport.')
                : (guest ? 'You land here.' : 'The sector lands at this airport.')}
              {anchor?.flightRole === 'sector' && !guest &&
                ' Drawn from the booking’s flight list — the movement chart has no row for a sector, so this leg is map-only.'}
            </p>
          </div>
        )}

        {/* Getting here. */}
        {place.arrive && place.arrive.flightRole !== 'sector' && place.arrive.transport && (
          <div className={cn('rounded-xl ring-1 p-3', skin.glassSolid)}>
            <div className="flex items-center justify-between gap-2 mb-2">
              <span className={cn('text-[9px] uppercase tracking-wider font-bold', skin.sheetMuted)}>
                {guest ? 'Getting here' : 'Movement in'}
              </span>
              {(place.arrive.timeFrom || place.arrive.meetingTime) && (
                <span className={cn('inline-flex items-center gap-1 text-[10px] font-semibold tabular-nums', skin.sheetMuted)}>
                  <Clock className="w-3 h-3" />
                  {place.arrive.timeFrom ?? place.arrive.meetingTime}
                  {place.arrive.timeTo ? `–${place.arrive.timeTo}` : ''}
                </span>
              )}
            </div>

            <div className="flex items-center gap-2">
              <span
                className="inline-flex items-center gap-1.5 rounded-full px-2 py-[3px] text-[10px] font-bold leading-none flex-shrink-0"
                style={{ background: `${place.arrive.transport.hex}1f`, color: place.arrive.transport.hex }}
              >
                <span className="text-[12px] leading-none">{place.arrive.transport.emoji}</span>
                {place.arrive.transport.label}
              </span>
              <span className={cn('min-w-0 text-[11.5px] font-semibold leading-snug truncate', skin.sheetBody)}>
                from {place.arrive.fromPlace || '—'}
              </span>
            </div>

            {place.arrive.roadKm != null && place.arrive.roadKm > 0 ? (
              <p className={cn('mt-2 inline-flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[10px]', skin.sheetMuted)}>
                <span className="inline-flex items-center gap-1">
                  <Navigation className="w-3 h-3" /> {place.arrive.roadKm.toLocaleString()} km by road
                </span>
                {place.arrive.roadMin ? (
                  <span className="inline-flex items-center gap-1" title="Free-flow — no traffic, no stops">
                    <Clock className="w-3 h-3" /> about {fmtDrive(place.arrive.roadMin)} driving
                  </span>
                ) : null}
              </p>
            ) : place.arrive.moveKm != null && place.arrive.moveKm > 0 ? (
              <p className={cn('mt-2 inline-flex items-center gap-1 text-[10px]', skin.sheetMuted)}>
                <Navigation className="w-3 h-3" /> about {place.arrive.moveKm.toLocaleString()} km on this leg
              </p>
            ) : null}
          </div>
        )}

        {/* Staying here. The room and the board, not just the hotel's name —
            "Deluxe Double, half board, 2 nights" is what was actually sold. */}
        {stayHere && hotel && (
          <div className="rounded-xl ring-1 ring-orange-500/25 bg-gradient-to-br from-orange-500/10 to-amber-500/10 p-3">
            <div className="flex items-center justify-between gap-2 mb-1.5">
              <span className="inline-flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider text-orange-500">
                <BedDouble className="w-3.5 h-3.5" />
                {hotel.checkIn ? (guest ? 'Check in' : 'Check-in tonight') : (guest ? 'Your stay' : 'Overnight')}
              </span>
              {hotel.nights ? (
                <span className={cn('text-[10px] font-bold', skin.sheetMuted)}>
                  {hotel.nights} night{hotel.nights === 1 ? '' : 's'}
                </span>
              ) : null}
            </div>
            <p className={cn('text-[13px] font-bold leading-snug', skin.sheetTitle)}>{hotel.name}</p>
            {hotel.city && <p className={cn('text-[10px]', skin.sheetMuted)}>{hotel.city}</p>}
            <div className="mt-2 flex flex-wrap gap-1.5">
              {hotel.roomType && (
                <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-[2px] text-[10px] font-semibold ring-1', skin.glassSolid, skin.sheetBody)}>
                  <BedDouble className="w-3 h-3 text-orange-500" />{hotel.roomType}
                </span>
              )}
              {(hotel.mealType || place.arrive?.mealPlan) && (
                <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-[2px] text-[10px] font-semibold ring-1', skin.glassSolid, skin.sheetBody)}>
                  <Utensils className="w-3 h-3 text-emerald-500" />{hotel.mealType || place.arrive?.mealPlan}
                </span>
              )}
              {hotel.checkInDate && hotel.checkOutDate && (
                <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-[2px] text-[10px] font-semibold ring-1', skin.glassSolid, skin.sheetBody)}>
                  <CalendarDays className="w-3 h-3" />
                  {formatDate(hotel.checkInDate)} – {formatDate(hotel.checkOutDate)}
                </span>
              )}
            </div>
          </div>
        )}

        {/* Leaving again — the other half of a place, and the half a strip of
            movement cards could never show without printing it twice. */}
        {place.depart && (
          <div className={cn('rounded-xl ring-1 p-3', skin.glassSolid)}>
            <div className="flex items-center justify-between gap-2 mb-2">
              <span className={cn('text-[9px] uppercase tracking-wider font-bold', skin.sheetMuted)}>
                {guest ? 'Leaving here' : 'Movement out'}
              </span>
              {(place.depart.timeFrom || place.depart.meetingTime) && (
                <span className={cn('inline-flex items-center gap-1 text-[10px] font-semibold tabular-nums', skin.sheetMuted)}>
                  <Clock className="w-3 h-3" />
                  {place.depart.meetingTime ? `Meet ${place.depart.meetingTime}` : place.depart.timeFrom}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {place.depart.transport && (
                <span
                  className="inline-flex items-center gap-1.5 rounded-full px-2 py-[3px] text-[10px] font-bold leading-none flex-shrink-0"
                  style={{ background: `${place.depart.transport.hex}1f`, color: place.depart.transport.hex }}
                >
                  <span className="text-[12px] leading-none">{place.depart.transport.emoji}</span>
                  {place.depart.transport.short}
                </span>
              )}
              <ArrowRight className={cn('w-3.5 h-3.5 flex-shrink-0', skin.sheetMuted)} />
              <span className={cn('min-w-0 text-[11.5px] font-bold leading-snug truncate', skin.sheetTitle)}>
                {place.depart.toPlace || place.depart.place}
              </span>
            </div>
          </div>
        )}

        <div>
          <p className={cn('text-[10px] uppercase tracking-wider font-bold mb-1', skin.sheetMuted)}>
            {anchor?.flightRole === 'sector'
              ? (guest ? 'Your flight' : 'Flight sector')
              : anchor?.transport
                ? (guest ? 'What happens' : 'On the movement chart')
                : (guest ? 'On your plan' : 'On the itinerary')}
          </p>
          <p className={cn('text-[12.5px] font-medium leading-snug', skin.strong)}>
            {anchor?.description?.trim() || anchor?.title || place.name}
          </p>
          {!anchor?.transport && anchor?.legKm != null && anchor.legKm > 0 && (
            <p className={cn('mt-1.5 inline-flex items-center gap-1 text-[10px] rounded-full px-2 py-0.5', skin.sheetBody, skin.glassSolid)}>
              <Navigation className="w-3 h-3" /> {anchor.legKm.toLocaleString()} km from the previous place
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

/** 195 → "3h 15m", 45 → "45m". Free-flow driving time, never traffic. */
function fmtDrive(min: number): string {
  const h = Math.floor(min / 60)
  const m = min % 60
  return h > 0 ? `${h}h ${m > 0 ? `${m}m` : ''}`.trim() : `${m}m`
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
