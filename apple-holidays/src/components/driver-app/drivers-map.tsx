'use client'

/**
 * Driver App live map — a pin per driver currently on the road, and the GPS
 * route of the selected driver-day. Leaflet is imported inside the effect so it
 * never reaches the server render (same approach as live-ops-map.tsx).
 */
import { useEffect, useRef } from 'react'
import type { Map as LeafletMap, LayerGroup } from 'leaflet'
import 'leaflet/dist/leaflet.css'

export interface MapDriver {
  dayId: string
  name: string
  lat: number
  lng: number
  silent: boolean
  label: string
}

export default function DriversMap({
  drivers, track, selected, onSelect,
}: {
  drivers: MapDriver[]
  track: { lat: number; lng: number }[] | null
  selected: string | null
  onSelect: (dayId: string) => void
}) {
  const el = useRef<HTMLDivElement>(null)
  const map = useRef<LeafletMap | null>(null)
  const layer = useRef<LayerGroup | null>(null)
  const L = useRef<typeof import('leaflet') | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const leaflet = await import('leaflet')
      if (cancelled || !el.current || map.current) return
      L.current = leaflet
      map.current = leaflet.map(el.current, { zoomControl: true }).setView([7.8731, 80.7718], 7)
      leaflet.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap', maxZoom: 18,
      }).addTo(map.current)
      layer.current = leaflet.layerGroup().addTo(map.current)
      draw()
    })()
    return () => { cancelled = true; map.current?.remove(); map.current = null }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(draw, [drivers, track, selected]) // eslint-disable-line react-hooks/exhaustive-deps

  function draw() {
    const leaflet = L.current
    if (!leaflet || !map.current || !layer.current) return
    layer.current.clearLayers()
    const bounds: [number, number][] = []
    if (track && track.length > 1) {
      const line = track.map(p => [p.lat, p.lng] as [number, number])
      leaflet.polyline(line, { color: '#e11d48', weight: 4, opacity: 0.8 }).addTo(layer.current)
      bounds.push(...line)
    }
    for (const d of drivers) {
      const isSel = d.dayId === selected
      const color = d.silent ? '#f59e0b' : '#10b981'
      const icon = leaflet.divIcon({
        className: '',
        html: `<div style="background:${color};color:#fff;border:3px solid ${isSel ? '#111' : '#fff'};border-radius:9999px;padding:2px 8px;font:600 11px system-ui;white-space:nowrap;box-shadow:0 2px 6px rgba(0,0,0,.3)">🚗 ${d.name.split(' ')[0]}</div>`,
        iconAnchor: [20, 12],
      })
      leaflet.marker([d.lat, d.lng], { icon }).addTo(layer.current).bindTooltip(d.label).on('click', () => onSelect(d.dayId))
      bounds.push([d.lat, d.lng])
    }
    if (bounds.length) map.current.fitBounds(bounds, { padding: [40, 40], maxZoom: 13 })
  }

  return <div ref={el} className="h-[420px] w-full rounded-xl border border-slate-200 overflow-hidden z-0" />
}
