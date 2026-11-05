'use client'

/**
 * Command Center map — where the operation physically is, right now.
 *
 * City pins sized by pax on the ground (one pin per city, never per guest),
 * today's drives as animated dashed arcs, and today's flights as violet arcs
 * with a plane riding each airborne sector at its real progress. The camera
 * tours: all countries, then each country with groups on the ground, then back.
 *
 * Leaflet is imported inside the effect so it never reaches the server bundle,
 * on Esri's Dark Gray Canvas tiles — keyless and already dark, so no CSS
 * inversion of a light map. (CARTO's basemaps now demand an API key.)
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import type { Map as LeafletMap, LayerGroup } from 'leaflet'
import { countryFocus } from '@/lib/ops-geo'
import { countryOf } from './theme'
import type { MapCity, MapFlight, MapLeg } from './types'
import 'leaflet/dist/leaflet.css'

type L = typeof import('leaflet')

const TOUR_MS = 12_000
const TILE = 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}'
const ATTR = 'Tiles &copy; Esri &mdash; Esri, HERE, Garmin, &copy; OpenStreetMap contributors'

/** A gentle quadratic arc between two points — reads as a route, not a ruler line. */
function arc(a: { lat: number; lng: number }, b: { lat: number; lng: number }, bend = 0.22, n = 40): [number, number][] {
  const mx = (a.lat + b.lat) / 2, my = (a.lng + b.lng) / 2
  const dx = b.lat - a.lat, dy = b.lng - a.lng
  const cx = mx - dy * bend, cy = my + dx * bend
  return Array.from({ length: n + 1 }, (_, i) => {
    const t = i / n, u = 1 - t
    return [u * u * a.lat + 2 * u * t * cx + t * t * b.lat, u * u * a.lng + 2 * u * t * cy + t * t * b.lng]
  })
}

function bearing(p: [number, number], q: [number, number]) {
  return (Math.atan2(q[1] - p[1], q[0] - p[0]) * 180) / Math.PI
}

const PLANE = (deg: number, color: string) =>
  `<div style="transform:translate(-50%,-50%) rotate(${deg}deg);filter:drop-shadow(0 0 6px ${color})">
     <svg width="22" height="22" viewBox="0 0 24 24" fill="${color}"><path d="M21 16v-2l-8-5V3.5a1.5 1.5 0 0 0-3 0V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5z"/></svg>
   </div>`

export default function OpsMap({ cities, legs, flights }: { cities: MapCity[]; legs: MapLeg[]; flights: MapFlight[] }) {
  const wrap = useRef<HTMLDivElement>(null)
  const mapRef = useRef<LeafletMap | null>(null)
  const libRef = useRef<L | null>(null)
  const layerRef = useRef<LayerGroup | null>(null)
  const [ready, setReady] = useState(false)
  const [focus, setFocus] = useState('ALL')

  // Countries worth flying to: the ones with somebody on the ground.
  const stops = useMemo(() => {
    const seen = new Set<string>()
    cities.forEach(c => c.country && c.country !== 'SINGAPORE_MALAYSIA' && seen.add(c.country))
    return ['ALL', ...Array.from(seen)]
  }, [cities])

  // ── Boot ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    let dead = false
    ;(async () => {
      const Lf = (await import('leaflet')) as unknown as L
      if (dead || !wrap.current || mapRef.current) return
      libRef.current = Lf
      const f = countryFocus('ALL')
      const map = Lf.map(wrap.current, {
        zoomControl: false, attributionControl: true, scrollWheelZoom: false, dragging: false,
        doubleClickZoom: false, boxZoom: false, keyboard: false, touchZoom: false,
        zoomSnap: 0.25, fadeAnimation: true,
      })
      map.fitBounds(f.bounds, { padding: [20, 20] })
      Lf.tileLayer(TILE, { attribution: ATTR, maxZoom: 16 }).addTo(map)
      layerRef.current = Lf.layerGroup().addTo(map)
      mapRef.current = map
      setReady(true)
    })()
    return () => { dead = true; mapRef.current?.remove(); mapRef.current = null }
  }, [])

  // Leaflet measures its box once; the grid cell settles after first paint.
  useEffect(() => {
    if (!ready || !wrap.current) return
    const ro = new ResizeObserver(() => mapRef.current?.invalidateSize())
    ro.observe(wrap.current)
    return () => ro.disconnect()
  }, [ready])

  // ── Camera tour ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!ready) return
    let i = 0
    const id = setInterval(() => { i = (i + 1) % stops.length; setFocus(stops[i]) }, TOUR_MS)
    return () => clearInterval(id)
  }, [ready, stops])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    map.flyToBounds(countryFocus(focus).bounds, { padding: [30, 30], duration: 2.2, maxZoom: focus === 'SINGAPORE' ? 10 : 8 })
  }, [focus])

  // ── Draw ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    const Lf = libRef.current, group = layerRef.current
    if (!ready || !Lf || !group) return
    group.clearLayers()

    // Flights first so pins sit on top.
    for (const f of flights) {
      const pts = arc(f.from, f.to, 0.28, 60)
      const live = f.phase === 'airborne'
      Lf.polyline(pts, {
        color: live ? '#c084fc' : f.phase === 'landed' ? '#64708f' : '#7c8ce0',
        weight: live ? 2.4 : 1.4, opacity: live ? .95 : .55,
        className: live ? 'cc-arc' : undefined, dashArray: f.phase === 'scheduled' ? '3 7' : undefined,
      }).addTo(group)
      if (live) {
        const k = Math.min(pts.length - 2, Math.max(0, Math.round(f.progress * (pts.length - 1))))
        Lf.marker(pts[k], {
          icon: Lf.divIcon({ html: PLANE(bearing(pts[k], pts[k + 1]) , '#e9d5ff'), iconSize: [0, 0], className: '' }),
          interactive: false,
        }).addTo(group)
      }
    }

    for (const l of legs) {
      const hex = countryOf(l.country).hex
      Lf.polyline(arc(l.from, l.to, 0.18), { color: hex, weight: 1.5 + Math.min(3, l.groups), opacity: .85, className: 'cc-arc' }).addTo(group)
    }

    const maxPax = Math.max(1, ...cities.map(c => c.pax))
    cities.forEach((c, idx) => {
      const hex = countryOf(c.country).hex
      const size = Math.round(12 + Math.sqrt(c.pax / maxPax) * 26)
      const label = idx < 14 ? `<div class="lbl">${c.name} · ${c.groups}</div>` : ''
      Lf.marker([c.lat, c.lng], {
        icon: Lf.divIcon({
          className: '',
          iconSize: [0, 0],
          html: `<div class="cc-pin" style="width:${size}px;height:${size}px">
                   <div class="ping" style="background:${hex}55;animation-delay:${(idx % 6) * .35}s"></div>
                   <div class="core" style="width:${size * .55}px;height:${size * .55}px;background:${hex};box-shadow:0 0 18px ${hex}"></div>
                   ${label}
                 </div>`,
        }),
        interactive: false,
        zIndexOffset: c.pax,
      }).addTo(group)
    })
  }, [ready, cities, legs, flights])

  const f = countryFocus(focus)
  return (
    <div className="cc-map absolute inset-0">
      <div ref={wrap} className="absolute inset-0" />
      {/* vignette so the map melts into the panel */}
      <div className="absolute inset-0 pointer-events-none" style={{ boxShadow: 'inset 0 0 80px 30px rgba(6,10,22,.85)' }} />
      <div className="absolute left-4 bottom-4 z-[500] pointer-events-none cc-in" key={focus}>
        <p className="text-[10px] uppercase tracking-[.3em]" style={{ color: 'var(--ink3)' }}>Camera</p>
        <p className="text-xl font-extrabold" style={{ color: focus === 'ALL' ? 'var(--head)' : countryOf(focus).hex }}>{f.label}</p>
      </div>
    </div>
  )
}
