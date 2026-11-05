'use client'

/**
 * Full-screen takeovers for the Command Center — the same three moments /view
 * celebrates (a new booking, a traveller alert, a file-handler flight/cancel),
 * restyled for the glass board. Each runs a countdown and dismisses itself; a
 * tap dismisses early.
 */

import { useEffect, useState, type ReactNode } from 'react'
import { PartyPopper, AlertTriangle, Plane, ShieldAlert, Quote } from 'lucide-react'
import { CountryFlag } from '@/components/ui/country-flag'
import { countryOf } from './theme'
import type { FHEvent, LiveBooking, TEAlert } from './types'

export type Takeover =
  | { kind: 'booking'; booking: LiveBooking }
  | { kind: 'alert'; alert: TEAlert }
  | { kind: 'fh'; event: FHEvent }

const DURATION: Record<Takeover['kind'], number> = { booking: 25, alert: 45, fh: 20 }

// ── Sounds ───────────────────────────────────────────────────────────────────
let ctxRef: AudioContext | null = null
function ctx() {
  const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
  ctxRef ??= new AC()
  if (ctxRef.state === 'suspended') ctxRef.resume()
  return ctxRef
}
export function chime() {
  try {
    const c = ctx()
    ;[880, 1108.73, 1318.51, 1760].forEach((f, i) => {
      const o = c.createOscillator(), g = c.createGain()
      o.type = 'triangle'; o.frequency.value = f
      const t = c.currentTime + i * 0.11
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.25, t + 0.03); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5)
      o.connect(g); g.connect(c.destination); o.start(t); o.stop(t + 0.55)
    })
  } catch { /* no audio */ }
}
export function siren() {
  try {
    const c = ctx(), t0 = c.currentTime
    for (let i = 0; i < 3; i++) {
      ;[[880, t0 + i * 0.5], [660, t0 + i * 0.5 + 0.25]].forEach(([f, t]) => {
        const o = c.createOscillator(), g = c.createGain()
        o.type = 'sawtooth'; o.frequency.value = f
        g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.3, t + 0.03); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.24)
        o.connect(g); g.connect(c.destination); o.start(t); o.stop(t + 0.26)
      })
    }
  } catch { /* no audio */ }
}

function Field({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-[.62rem] uppercase tracking-[.24em] mb-1" style={{ color: 'var(--ink3)' }}>{label}</p>
      <p className="text-xl font-extrabold truncate" style={{ color: 'var(--head)' }}>{value}</p>
    </div>
  )
}

export function TakeoverLayer({ item, onDone }: { item: Takeover; onDone: () => void }) {
  const total = DURATION[item.kind]
  const [left, setLeft] = useState(total)
  useEffect(() => {
    const id = setInterval(() => setLeft(s => (s <= 1 ? 0 : s - 1)), 1000)
    return () => clearInterval(id)
  }, [])
  useEffect(() => { if (left === 0) onDone() }, [left, onDone])

  let accent = '#22d3ee', eyebrow = '', title: ReactNode = '', icon: ReactNode = null, body: ReactNode = null, stamp = '', critical = false
  let country: string | null = null

  if (item.kind === 'booking') {
    const b = item.booking
    const m = countryOf(b.operationCountry)
    country = b.operationCountry
    accent = m.hex; eyebrow = 'New booking just landed'; title = b.bookingRef; stamp = 'Welcome aboard'
    icon = <PartyPopper className="w-9 h-9" />
    const fmt = (d: string) => new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
    body = (
      <div className="grid grid-cols-2 gap-6">
        <Field label="Destination" value={m.label} />
        <Field label="Travellers" value={`${b.paxAdults + b.paxChildren} pax`} />
        <Field label="Agent" value={b.agent || 'Direct'} />
        <Field label="Travel dates" value={`${fmt(b.arrivalDate)} → ${fmt(b.departureDate)}`} />
      </div>
    )
  } else if (item.kind === 'alert') {
    const a = item.alert
    critical = true
    accent = a.severity === 'low' ? '#ffc857' : a.severity === 'medium' ? '#ffb547' : '#ff4d6d'
    eyebrow = `Traveller alert · ${(a.severity ?? 'medium').toUpperCase()}`
    title = a.title ?? 'Issue reported on tour'; stamp = 'Action needed'
    icon = <AlertTriangle className="w-9 h-9" style={{ animation: 'ccPulse .9s infinite' }} />
    body = (
      <div className="space-y-3">
        <p className="text-sm font-bold" style={{ color: '#fca5a5' }}>{[a.booking_ref, a.customer_name, a.category].filter(Boolean).join('  ·  ')}</p>
        {a.details && <p className="text-lg leading-snug" style={{ color: 'var(--head)' }}>{a.details}</p>}
        {a.customer_quote && <p className="italic flex gap-2" style={{ color: 'var(--ink)' }}><Quote className="w-5 h-5 shrink-0 opacity-40" />&ldquo;{a.customer_quote}&rdquo;</p>}
      </div>
    )
  } else {
    const e = item.event
    const cancel = e.action === 'CANCEL_REQUESTED'
    country = e.operationCountry
    critical = cancel
    accent = cancel ? '#ff4d6d' : '#2ee59d'
    eyebrow = cancel ? 'File handler · cancellation' : 'File handler · boarding pass'
    title = cancel ? 'Cancellation requested' : e.action === 'FLIGHT_UPDATED' ? 'Flight details updated' : 'Flight details added'
    stamp = cancel ? 'To accounts' : 'Confirmed'
    icon = cancel ? <ShieldAlert className="w-9 h-9" /> : <Plane className="w-9 h-9" />
    body = (
      <div className="grid grid-cols-2 gap-6">
        <Field label="Booking" value={e.bookingRef || '—'} />
        <Field label="Destination" value={countryOf(e.operationCountry).label} />
        <Field label="File handler" value={e.fileHandlerName} />
        <Field label={e.isNumber ? 'IS number' : 'When'} value={e.isNumber || new Date(e.createdAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })} />
        {e.details && <div className="col-span-2"><Field label="Details" value={<span className="text-base font-semibold whitespace-normal">{e.details}</span>} /></div>}
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center" onClick={onDone}
      style={{ background: critical ? 'rgba(24,4,8,.88)' : 'rgba(4,7,16,.86)', backdropFilter: 'blur(16px)', animation: 'ccFade .3s ease-out both' }}>
      {item.kind === 'booking' && (
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          {Array.from({ length: 46 }).map((_, i) => (
            <span key={i} className="absolute top-0 rounded-sm" style={{
              left: `${(i * 2.2) % 100}%`, width: 8, height: 12,
              background: [accent, '#ffc857', '#2ee59d', '#c084fc', '#22d3ee'][i % 5],
              animation: `ccConfetti ${2.6 + (i % 5) * .5}s linear ${(i % 10) * .15}s infinite`,
            }} />
          ))}
        </div>
      )}
      {[300, 460, 620, 780].map((s, i) => (
        <div key={s} className="absolute left-1/2 top-1/2 rounded-full border pointer-events-none"
          style={{ width: s, height: s, borderColor: `${accent}77`, animation: `ccRing ${1.8 + i * .35}s ease-in-out ${i * .2}s infinite` }} />
      ))}

      <div className="relative w-full max-w-3xl mx-6 cc-panel" onClick={e => e.stopPropagation()}
        style={{ borderColor: `${accent}aa`, borderWidth: 2, animation: `ccScale .5s cubic-bezier(.34,1.56,.64,1) both${critical ? ', ccSiren 1.1s ease-in-out infinite' : ''}`, background: 'linear-gradient(150deg,rgba(10,15,30,.97),rgba(20,28,52,.97))' }}>
        <div className="cc-sweep" />
        <div className="px-8 py-6 flex items-center gap-4 border-b" style={{ borderColor: `${accent}55`, background: `${accent}14` }}>
          <span style={{ color: accent }}>{icon}</span>
          <div className="min-w-0">
            <p className="text-[.7rem] font-extrabold uppercase tracking-[.36em]" style={{ color: accent }}>{eyebrow}</p>
            <p className="text-3xl font-extrabold truncate" style={{ color: 'var(--head)' }}>{title}</p>
          </div>
          {country && <span className="ml-auto rounded-lg overflow-hidden border border-white/25 shadow-xl" style={{ animation: 'ccFloat 4s ease-in-out infinite' }}><CountryFlag country={country} className="w-20 h-14" /></span>}
        </div>
        <div className="relative px-8 py-7">
          {body}
          <div className="absolute right-6 bottom-7 px-3 py-1 rounded-md border-2 font-extrabold uppercase tracking-widest text-sm -rotate-12" style={{ color: accent, borderColor: accent, opacity: .85 }}>{stamp}</div>
        </div>
        <div className="h-1.5 w-full" style={{ background: 'rgba(255,255,255,.05)' }}>
          <div className="h-full" style={{ background: accent, animation: `ccShrink ${total}s linear forwards` }} />
        </div>
        <p className="text-center text-[.62rem] py-2 tracking-[.3em] uppercase" style={{ color: 'var(--ink3)' }}>Closes in {left}s · tap to dismiss</p>
      </div>
    </div>
  )
}
