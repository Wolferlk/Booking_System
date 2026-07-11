'use client'

import { useEffect, useState, useCallback, useRef, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { Plane, Users, Sparkles, TrendingUp, CalendarClock, Globe2, PartyPopper, Volume2, VolumeX } from 'lucide-react'
import { CountryFlag } from '@/components/ui/country-flag'

// ── Animations ──────────────────────────────────────────────────────────────
const CSS = `
*{box-sizing:border-box}
@keyframes vFloat   { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-22px)} }
@keyframes vDrift   { 0%{transform:translate(0,0)} 100%{transform:translate(60px,-40px)} }
@keyframes vPop     { 0%{opacity:0;transform:scale(.7)} 60%{transform:scale(1.06)} 100%{opacity:1;transform:scale(1)} }
@keyframes vSlideUp { from{opacity:0;transform:translateY(34px)} to{opacity:1;transform:translateY(0)} }
@keyframes vSlideIn { 0%{opacity:0;transform:translateX(60px) scale(.92)} 100%{opacity:1;transform:translateX(0) scale(1)} }
@keyframes vSlideOut{ 0%{opacity:1;transform:translateX(0) scale(1)} 100%{opacity:0;transform:translateX(-60px) scale(.92)} }
@keyframes vGlow    { 0%,100%{box-shadow:0 0 24px 2px rgba(234,179,8,.25)} 50%{box-shadow:0 0 60px 12px rgba(234,179,8,.55)} }
@keyframes vRing    { 0%,100%{opacity:.5;transform:scale(1)} 50%{opacity:1;transform:scale(1.05)} }
@keyframes vPulse   { 0%,100%{opacity:.55} 50%{opacity:1} }
@keyframes vShine   { 0%{background-position:-200% 0} 100%{background-position:200% 0} }
@keyframes vBounceIn{ 0%{opacity:0;transform:translateY(-60px) scale(.85)} 55%{transform:translateY(10px) scale(1.03)} 100%{opacity:1;transform:translateY(0) scale(1)} }
@keyframes vConfetti{ 0%{transform:translateY(-10vh) rotate(0)} 100%{transform:translateY(110vh) rotate(720deg)} }
@keyframes vProgress{ from{width:100%} to{width:0%} }
@keyframes vWiggle  { 0%,100%{transform:rotate(0)} 25%{transform:rotate(-9deg)} 75%{transform:rotate(9deg)} }
.v-float{animation:vFloat 7s ease-in-out infinite}
.v-drift{animation:vDrift 22s ease-in-out infinite alternate}
.v-pop{animation:vPop .6s cubic-bezier(.34,1.56,.64,1) both}
.v-up{animation:vSlideUp .55s ease-out both}
.v-glow{animation:vGlow 3.2s ease-in-out infinite}
.v-wiggle{animation:vWiggle 2.5s ease-in-out infinite}
.v-shine{background:linear-gradient(100deg,transparent 20%,rgba(255,255,255,.14) 45%,transparent 70%);background-size:200% 100%;animation:vShine 4.5s linear infinite}
`

// ── Country meta ─────────────────────────────────────────────────────────────
const COUNTRY_META: Record<string, { label: string; emoji: string; accent: string; ring: string; grad: string }> = {
  VIETNAM:            { label: 'Vietnam',       emoji: '🇻🇳', accent: '#ef4444', ring: 'rgba(239,68,68,.5)',  grad: 'from-red-500/25 to-rose-600/5' },
  SRILANKA:           { label: 'Sri Lanka',     emoji: '🇱🇰', accent: '#f59e0b', ring: 'rgba(245,158,11,.5)', grad: 'from-amber-500/25 to-yellow-600/5' },
  SINGAPORE:          { label: 'Singapore',     emoji: '🇸🇬', accent: '#ec4899', ring: 'rgba(236,72,153,.5)', grad: 'from-pink-500/25 to-fuchsia-600/5' },
  MALAYSIA:           { label: 'Malaysia',      emoji: '🇲🇾', accent: '#22c55e', ring: 'rgba(34,197,94,.5)',  grad: 'from-green-500/25 to-emerald-600/5' },
  SINGAPORE_MALAYSIA: { label: 'SG & Malaysia', emoji: '🌏', accent: '#3b82f6', ring: 'rgba(59,130,246,.5)', grad: 'from-blue-500/25 to-indigo-600/5' },
  ALL:                { label: 'Multi-Country', emoji: '🌐', accent: '#a78bfa', ring: 'rgba(167,139,250,.5)', grad: 'from-violet-500/25 to-purple-600/5' },
}
const ORDER = ['VIETNAM', 'SRILANKA', 'SINGAPORE', 'MALAYSIA', 'SINGAPORE_MALAYSIA', 'ALL']

// ── Config ───────────────────────────────────────────────────────────────────
const POLL_MS         = 20_000  // data refresh
const SPOTLIGHT_MS    = 5_000   // country spotlight rotation
const ALERT_DURATION  = 30      // seconds each new-booking alert stays

interface Booking {
  id: string; bookingRef: string; agent: string | null; operationCountry: string | null
  paxAdults: number; paxChildren: number; arrivalDate: string; departureDate: string; createdAt: string
}
interface ViewData {
  generatedAt: string
  totals: { totalBookings: number; ongoingToday: number; upcoming: number; paxOnTour: number }
  byCountry: { ongoing: Record<string, number>; upcoming: Record<string, number>; lifetime: Record<string, number> }
  recentBookings: Booking[]
}

// ── Animated counter ─────────────────────────────────────────────────────────
function Counter({ target, dur = 1200 }: { target: number; dur?: number }) {
  const [v, setV] = useState(0)
  const from = useRef(0)
  useEffect(() => {
    const start = from.current, t0 = performance.now()
    const run = (now: number) => {
      const p = Math.min((now - t0) / dur, 1)
      const eased = 1 - Math.pow(1 - p, 3)
      setV(Math.round(start + (target - start) * eased))
      if (p < 1) requestAnimationFrame(run); else from.current = target
    }
    requestAnimationFrame(run)
  }, [target, dur])
  return <>{v.toLocaleString()}</>
}

function metaOf(c: string) { return COUNTRY_META[c] ?? COUNTRY_META.ALL }

// ── Floating background ──────────────────────────────────────────────────────
function Background() {
  return (
    <div className="fixed inset-0 pointer-events-none overflow-hidden">
      {[[340, '-5%', '6%', 'rgba(234,179,8,.05)', 90, 24], [520, '12%', '-6%', 'rgba(99,102,241,.05)', 120, 30], [380, '58%', '72%', 'rgba(16,185,129,.045)', 100, 26], [300, '68%', '4%', 'rgba(239,68,68,.045)', 80, 20]].map(([s, top, left, c, b, d], i) => (
        <div key={i} className="absolute rounded-full v-drift" style={{ width: s as number, height: s as number, top: top as string, left: left as string, background: c as string, filter: `blur(${b}px)`, animationDuration: `${d}s`, animationDelay: `${i * 3}s` }} />
      ))}
      <div className="absolute inset-0 opacity-[.025]" style={{ backgroundImage: 'linear-gradient(rgba(255,255,255,.08) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.08) 1px,transparent 1px)', backgroundSize: '60px 60px' }} />
      <div className="absolute inset-0" style={{ background: 'radial-gradient(ellipse 80% 50% at 50% 0%,rgba(234,179,8,.05) 0%,transparent 70%)' }} />
    </div>
  )
}

// ── New-booking alert (30s, with sound) ──────────────────────────────────────
function BookingAlert({ booking, onDismiss }: { booking: Booking; onDismiss: () => void }) {
  const [left, setLeft] = useState(ALERT_DURATION)
  useEffect(() => {
    const id = setInterval(() => setLeft(c => { if (c <= 1) { onDismiss(); return 0 } return c - 1 }), 1000)
    return () => clearInterval(id)
  }, [onDismiss])
  const m = metaOf(booking.operationCountry ?? 'ALL')
  const pax = booking.paxAdults + booking.paxChildren
  const fmt = (d: string) => { try { return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) } catch { return d } }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center" onClick={onDismiss}
      style={{ background: 'rgba(2,6,16,.86)', backdropFilter: 'blur(14px)', animation: 'vPop .35s ease-out both' }}>
      {/* confetti */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        {Array.from({ length: 40 }).map((_, i) => (
          <span key={i} className="absolute top-0 rounded-sm" style={{
            left: `${(i * 2.5) % 100}%`, width: 8, height: 12,
            background: [m.accent, '#facc15', '#22c55e', '#ec4899', '#3b82f6'][i % 5],
            animation: `vConfetti ${2.6 + (i % 5) * .5}s linear ${(i % 10) * .15}s infinite`,
          }} />
        ))}
      </div>
      {/* pulsing rings */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        {[280, 420, 560, 700].map((s, i) => (
          <div key={i} className="absolute rounded-full border" style={{ width: s, height: s, borderColor: m.ring, animation: `vRing ${2 + i * .4}s ease-in-out infinite`, animationDelay: `${i * .25}s` }} />
        ))}
      </div>

      <div className="relative w-full max-w-2xl mx-6" onClick={e => e.stopPropagation()} style={{ animation: 'vBounceIn .6s cubic-bezier(.34,1.56,.64,1) both' }}>
        <div className="relative rounded-[2rem] border-2 overflow-hidden v-glow" style={{ borderColor: m.ring, background: 'linear-gradient(150deg,rgba(6,10,22,.98),rgba(14,20,38,.98))' }}>
          <div className="v-shine absolute inset-0 pointer-events-none" />
          {/* header */}
          <div className="px-8 py-5 flex items-center gap-4 border-b" style={{ borderColor: m.ring, background: `${m.accent}14` }}>
            <PartyPopper className="w-8 h-8 v-wiggle" style={{ color: m.accent }} />
            <div>
              <p className="text-[11px] font-black uppercase tracking-[.4em]" style={{ color: m.accent }}>New Booking In!</p>
              <p className="text-2xl font-black text-white leading-tight">{booking.bookingRef}</p>
            </div>
            <span className="ml-auto text-6xl v-float">{m.emoji}</span>
          </div>
          {/* body */}
          <div className="px-8 py-7 grid grid-cols-2 gap-6">
            <Field label="Destination" value={m.label} />
            <Field label="Travellers" value={`${pax} pax`} />
            <Field label="Agent" value={booking.agent || '—'} />
            <Field label="Arrival" value={fmt(booking.arrivalDate)} />
          </div>
          {/* countdown */}
          <div className="h-1.5 w-full bg-white/5">
            <div className="h-full" style={{ background: m.accent, animation: `vProgress ${ALERT_DURATION}s linear forwards` }} />
          </div>
          <p className="text-center text-[10px] text-slate-500 py-2 tracking-widest uppercase">Auto-closes in {left}s · tap to dismiss</p>
        </div>
      </div>
    </div>
  )
}
function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-[.25em] text-slate-500 mb-1">{label}</p>
      <p className="text-xl font-bold text-white truncate">{value}</p>
    </div>
  )
}

// ── Country spotlight (rotates one country at a time) ────────────────────────
function Spotlight({ country, data }: { country: string; data: ViewData }) {
  const m = metaOf(country)
  const ongoing  = data.byCountry.ongoing[country]  ?? 0
  const upcoming = data.byCountry.upcoming[country] ?? 0
  const lifetime = data.byCountry.lifetime[country] ?? 0
  return (
    <div key={country} className={`relative h-full rounded-3xl border-2 overflow-hidden bg-gradient-to-br ${m.grad}`}
      style={{ borderColor: m.ring, animation: 'vSlideIn .6s cubic-bezier(.34,1.56,.64,1) both' }}>
      <div className="v-shine absolute inset-0 pointer-events-none" />
      <div className="absolute -right-6 -bottom-6 text-[11rem] leading-none opacity-20 v-float select-none">{m.emoji}</div>
      <div className="relative h-full flex flex-col p-8">
        <div className="flex items-center gap-4">
          <span className="rounded-2xl overflow-hidden border border-white/15 shadow-lg"><CountryFlag country={country} className="w-16 h-11" /></span>
          <div>
            <p className="text-[11px] uppercase tracking-[.4em] text-slate-400">Now Spotlighting</p>
            <h2 className="text-4xl font-black text-white">{m.label}</h2>
          </div>
        </div>
        <div className="mt-auto">
          <p className="text-[12px] uppercase tracking-[.3em] text-slate-400 mb-1">On Tour Today</p>
          <div className="text-[8rem] leading-none font-black tabular-nums" style={{ color: m.accent, textShadow: `0 0 40px ${m.ring}` }}>
            <Counter target={ongoing} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 mt-6">
          <MiniStat label="Upcoming" value={upcoming} accent={m.accent} icon={<CalendarClock className="w-4 h-4" />} />
          <MiniStat label="All-Time" value={lifetime} accent={m.accent} icon={<TrendingUp className="w-4 h-4" />} />
        </div>
      </div>
    </div>
  )
}
function MiniStat({ label, value, accent, icon }: { label: string; value: number; accent: string; icon: React.ReactNode }) {
  return (
    <div className="rounded-2xl bg-white/5 border border-white/10 px-4 py-3">
      <div className="flex items-center gap-1.5 text-slate-400 mb-0.5" style={{ color: accent }}>{icon}<span className="text-[10px] uppercase tracking-[.2em] text-slate-400">{label}</span></div>
      <p className="text-3xl font-black text-white tabular-nums"><Counter target={value} /></p>
    </div>
  )
}

// ── Small per-country tile ───────────────────────────────────────────────────
function CountryTile({ country, data, active }: { country: string; data: ViewData; active: boolean }) {
  const m = metaOf(country)
  const ongoing = data.byCountry.ongoing[country] ?? 0
  const upcoming = data.byCountry.upcoming[country] ?? 0
  return (
    <div className={`relative rounded-2xl border overflow-hidden bg-gradient-to-br ${m.grad} transition-all duration-500`}
      style={{ borderColor: active ? m.accent : 'rgba(255,255,255,.08)', transform: active ? 'scale(1.04)' : 'scale(1)', boxShadow: active ? `0 0 30px ${m.ring}` : 'none' }}>
      <div className="p-4">
        <div className="flex items-center gap-2 mb-3">
          <CountryFlag country={country} className="w-7 h-5 rounded" />
          <span className="text-sm font-bold text-white truncate">{m.label}</span>
          <span className="ml-auto w-2 h-2 rounded-full" style={{ background: m.accent, animation: active ? 'vPulse 1.2s ease-in-out infinite' : 'none' }} />
        </div>
        <div className="flex items-end justify-between">
          <div>
            <p className="text-[9px] uppercase tracking-[.2em] text-slate-400">Today</p>
            <p className="text-4xl font-black tabular-nums" style={{ color: m.accent }}><Counter target={ongoing} /></p>
          </div>
          <div className="text-right">
            <p className="text-[9px] uppercase tracking-[.2em] text-slate-400">Upcoming</p>
            <p className="text-xl font-bold text-white/80 tabular-nums">{upcoming}</p>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Headline stat card ───────────────────────────────────────────────────────
function HeadStat({ label, value, icon, tone, big }: { label: string; value: number; icon: React.ReactNode; tone: string; big?: boolean }) {
  return (
    <div className="relative rounded-3xl border border-white/10 overflow-hidden bg-white/[.04] px-6 py-5">
      <div className="absolute -right-4 -top-4 opacity-10" style={{ color: tone }}>
        <div className="w-24 h-24 flex items-center justify-center">{icon}</div>
      </div>
      <div className="flex items-center gap-2 mb-1" style={{ color: tone }}>{icon}<span className="text-[11px] uppercase tracking-[.28em] text-slate-400">{label}</span></div>
      <p className={`${big ? 'text-7xl' : 'text-5xl'} font-black text-white tabular-nums`} style={{ textShadow: `0 0 30px ${tone}55` }}><Counter target={value} /></p>
    </div>
  )
}

// ── Main ─────────────────────────────────────────────────────────────────────
function ViewDashboard() {
  const params = useSearchParams()
  const token = params.get('token') ?? ''

  const [data, setData]   = useState<ViewData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [now, setNow]     = useState(new Date())
  const [spotlightIdx, setSpotlightIdx] = useState(0)
  const [soundOn, setSoundOn] = useState(true)

  // alert queue
  const [alert, setAlert] = useState<Booking | null>(null)
  const queueRef = useRef<Booking[]>([])
  const seenRef  = useRef<Set<string> | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const soundOnRef = useRef(true)
  useEffect(() => { soundOnRef.current = soundOn }, [soundOn])

  const chime = useCallback(() => {
    if (!soundOnRef.current) return
    try {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      const ctx = audioCtxRef.current ?? (audioCtxRef.current = new AC())
      if (ctx.state === 'suspended') ctx.resume()
      const notes = [880, 1108.73, 1318.51] // A5 · C#6 · E6 — a bright major arpeggio
      notes.forEach((f, i) => {
        const osc = ctx.createOscillator(), gain = ctx.createGain()
        osc.type = 'triangle'; osc.frequency.value = f
        const t = ctx.currentTime + i * 0.13
        gain.gain.setValueAtTime(0, t)
        gain.gain.linearRampToValueAtTime(0.28, t + 0.03)
        gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.5)
        osc.connect(gain); gain.connect(ctx.destination)
        osc.start(t); osc.stop(t + 0.55)
      })
    } catch { /* audio not available */ }
  }, [])

  const pump = useCallback(() => {
    setAlert(cur => { if (cur) return cur; const next = queueRef.current.shift() ?? null; if (next) chime(); return next })
  }, [chime])

  const load = useCallback(async () => {
    if (!token) { setError('Missing access token in the link.'); return }
    try {
      const res = await fetch(`/api/public/view-dashboard?token=${encodeURIComponent(token)}`, { cache: 'no-store' })
      const j = await res.json()
      if (!res.ok || !j?.data) { setError(j?.error || 'Unable to load dashboard.'); return }
      setError(null)
      const d = j.data as ViewData

      // Detect brand-new bookings for the alert popups.
      if (seenRef.current === null) {
        seenRef.current = new Set(d.recentBookings.map(b => b.id)) // first load: no spam
      } else {
        const fresh = d.recentBookings.filter(b => !seenRef.current!.has(b.id))
        fresh.reverse().forEach(b => { seenRef.current!.add(b.id); queueRef.current.push(b) })
        if (fresh.length) pump()
      }
      setData(d)
    } catch { setError('Network error — retrying…') }
  }, [token, pump])

  useEffect(() => { load(); const id = setInterval(load, POLL_MS); return () => clearInterval(id) }, [load])
  useEffect(() => { const id = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(id) }, [])

  // Which countries actually have data (any bucket) — keeps the screen relevant.
  const activeCountries = ORDER.filter(c =>
    (data?.byCountry.ongoing[c] ?? 0) + (data?.byCountry.upcoming[c] ?? 0) + (data?.byCountry.lifetime[c] ?? 0) > 0,
  )
  const spotCountries = activeCountries.length ? activeCountries : ['VIETNAM']

  useEffect(() => {
    const id = setInterval(() => setSpotlightIdx(i => (i + 1) % spotCountries.length), SPOTLIGHT_MS)
    return () => clearInterval(id)
  }, [spotCountries.length])
  const spotCountry = spotCountries[spotlightIdx % spotCountries.length]

  const dismissAlert = useCallback(() => { setAlert(null); setTimeout(pump, 400) }, [pump])

  return (
    <div className="fixed inset-0 overflow-hidden text-white" style={{ background: 'radial-gradient(ellipse at top,#0a1020,#030711 60%)', fontFamily: 'ui-sans-serif,system-ui' }}>
      <style>{CSS}</style>
      <Background />

      {alert && <BookingAlert booking={alert} onDismiss={dismissAlert} />}

      <div className="relative h-full flex flex-col p-6 gap-5">
        {/* Header */}
        <header className="flex items-center gap-4 shrink-0">
          <div className="w-12 h-12 rounded-2xl bg-brand-500/15 border border-brand-500/30 flex items-center justify-center v-float">
            <Sparkles className="w-6 h-6 text-brand-400" />
          </div>
          <div>
            <h1 className="text-2xl font-black tracking-tight leading-none">Apple Holidays <span className="text-brand-400">· Live Ops</span></h1>
            <p className="text-[11px] uppercase tracking-[.35em] text-slate-500">Real-time booking floor</p>
          </div>
          <div className="ml-auto flex items-center gap-4">
            <button onClick={() => { setSoundOn(s => !s); chime() }} className="w-10 h-10 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center text-slate-300 hover:text-white">
              {soundOn ? <Volume2 className="w-5 h-5" /> : <VolumeX className="w-5 h-5" />}
            </button>
            <div className="text-right">
              <p className="text-3xl font-black tabular-nums leading-none">{now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</p>
              <p className="text-[11px] text-slate-500">{now.toLocaleDateString('en-GB', { weekday: 'long', day: '2-digit', month: 'long' })}</p>
            </div>
            <span className="flex items-center gap-2 text-emerald-400 text-[11px] font-bold uppercase tracking-widest">
              <span className="w-2 h-2 rounded-full bg-emerald-400" style={{ animation: 'vPulse 1.2s ease-in-out infinite' }} />Live
            </span>
          </div>
        </header>

        {error && !data && (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center v-pop">
              <Globe2 className="w-16 h-16 text-slate-600 mx-auto mb-4" />
              <p className="text-xl font-bold text-slate-300">{error}</p>
              <p className="text-sm text-slate-500 mt-2">Generate a fresh link from Admin → Config → Live Screen Dashboard.</p>
            </div>
          </div>
        )}

        {data && (
          <div className="flex-1 grid grid-cols-3 gap-5 min-h-0">
            {/* LEFT — big ongoing + headline stats */}
            <div className="flex flex-col gap-5 min-h-0">
              {/* Large: today ongoing all countries */}
              <div className="relative rounded-3xl border-2 border-brand-500/40 overflow-hidden bg-gradient-to-br from-brand-500/15 to-transparent v-glow flex flex-col items-center justify-center py-6">
                <div className="v-shine absolute inset-0 pointer-events-none" />
                <div className="flex items-center gap-2 text-brand-400 mb-2"><Plane className="w-5 h-5 v-wiggle" /><span className="text-[12px] uppercase tracking-[.35em] text-slate-300">On Tour Today · All Countries</span></div>
                <div className="text-[10rem] leading-none font-black text-white tabular-nums" style={{ textShadow: '0 0 60px rgba(234,179,8,.5)' }}>
                  <Counter target={data.totals.ongoingToday} />
                </div>
                <div className="flex items-center gap-2 text-slate-300 mt-2"><Users className="w-4 h-4 text-brand-400" /><span className="text-lg font-bold"><Counter target={data.totals.paxOnTour} /> travellers on the ground</span></div>
              </div>
              {/* Mid: total + upcoming (always visible) */}
              <div className="grid grid-cols-1 gap-5 shrink-0">
                <HeadStat label="Total Bookings" value={data.totals.totalBookings} tone="#22c55e" icon={<TrendingUp className="w-6 h-6" />} big />
                <HeadStat label="Upcoming Tours" value={data.totals.upcoming} tone="#3b82f6" icon={<CalendarClock className="w-6 h-6" />} />
              </div>
            </div>

            {/* MIDDLE — rotating country spotlight */}
            <div className="min-h-0"><Spotlight country={spotCountry} data={data} /></div>

            {/* RIGHT — small per-country tiles */}
            <div className="flex flex-col gap-4 min-h-0">
              <p className="text-[11px] uppercase tracking-[.35em] text-slate-500 flex items-center gap-2"><Globe2 className="w-4 h-4" />Every Destination</p>
              <div className="grid grid-cols-1 gap-3 overflow-hidden">
                {spotCountries.map(c => (
                  <CountryTile key={c} country={c} data={data} active={c === spotCountry} />
                ))}
              </div>
              <div className="mt-auto rounded-2xl bg-white/[.03] border border-white/8 px-4 py-3">
                <p className="text-[10px] uppercase tracking-[.25em] text-slate-500 mb-2">Latest Arrival</p>
                {data.recentBookings[0] ? (
                  <div className="flex items-center gap-3">
                    <CountryFlag country={data.recentBookings[0].operationCountry} className="w-7 h-5 rounded" />
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-white truncate">{data.recentBookings[0].bookingRef}</p>
                      <p className="text-[11px] text-slate-400 truncate">{data.recentBookings[0].agent || 'Direct'} · {data.recentBookings[0].paxAdults + data.recentBookings[0].paxChildren} pax</p>
                    </div>
                  </div>
                ) : <p className="text-sm text-slate-500">—</p>}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default function Page() {
  return (
    <Suspense fallback={<div className="fixed inset-0 bg-[#030711]" />}>
      <ViewDashboard />
    </Suspense>
  )
}
