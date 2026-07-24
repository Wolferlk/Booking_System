'use client'

import { useEffect, useState, useCallback, useRef, Suspense } from 'react'
import { Plane, Users, Sparkles, TrendingUp, CalendarClock, Globe2, PartyPopper, Volume2, VolumeX, Bot, ShieldAlert, AlertTriangle, Quote } from 'lucide-react'
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
@keyframes vKenBurns{ 0%{transform:scale(1.08) translate(0,0)} 100%{transform:scale(1.22) translate(-2%,-2%)} }
@keyframes vFadeImg { 0%{opacity:0;transform:scale(1.14)} 100%{opacity:1;transform:scale(1.08)} }
@keyframes vFlip    { 0%{opacity:0;transform:rotateX(-90deg)} 100%{opacity:1;transform:rotateX(0)} }
@keyframes vScan    { 0%{transform:translateY(-100%)} 100%{transform:translateY(400%)} }
@keyframes vAlarm   { 0%,100%{box-shadow:0 0 30px 4px rgba(239,68,68,.35)} 50%{box-shadow:0 0 90px 20px rgba(239,68,68,.85)} }
@keyframes vSiren   { 0%,100%{opacity:.35} 50%{opacity:1} }
@keyframes vShake   { 0%,100%{transform:translateX(0)} 20%{transform:translateX(-8px)} 40%{transform:translateX(8px)} 60%{transform:translateX(-5px)} 80%{transform:translateX(5px)} }
@keyframes vMarquee { 0%{transform:translateX(0)} 100%{transform:translateX(-50%)} }
.v-float{animation:vFloat 7s ease-in-out infinite}
.v-drift{animation:vDrift 22s ease-in-out infinite alternate}
.v-pop{animation:vPop .6s cubic-bezier(.34,1.56,.64,1) both}
.v-up{animation:vSlideUp .55s ease-out both}
.v-glow{animation:vGlow 3.2s ease-in-out infinite}
.v-wiggle{animation:vWiggle 2.5s ease-in-out infinite}
.v-shine{background:linear-gradient(100deg,transparent 20%,rgba(255,255,255,.14) 45%,transparent 70%);background-size:200% 100%;animation:vShine 4.5s linear infinite}
.v-alarm{animation:vAlarm 1.1s ease-in-out infinite}
.v-shake{animation:vShake .5s ease-in-out}
`

// ── Country meta ─────────────────────────────────────────────────────────────
const IMG_VN = 'https://images5.alphacoders.com/390/thumb-1920-390620.jpg'
const IMG_LK = 'https://wallpapercat.com/w/full/7/d/5/639844-3000x1686-desktop-hd-sri-lanka-wallpaper.jpg'
const IMG_SG = 'https://www.bookmytaxi.my/wp-content/uploads/2018/01/the-merlion-singapore-wallpaper.jpg'
const IMG_MY = 'https://4kwallpapers.com/images/wallpapers/petronas-towers-kuala-lumpur-malaysia-cityscape-night-3840x2160-2109.jpg'

const COUNTRY_META: Record<string, { label: string; emoji: string; accent: string; ring: string; grad: string; image: string }> = {
  VIETNAM:            { label: 'Vietnam',       emoji: '🇻🇳', accent: '#ef4444', ring: 'rgba(239,68,68,.5)',  grad: 'from-red-500/25 to-rose-600/5',      image: IMG_VN },
  SRILANKA:           { label: 'Sri Lanka',     emoji: '🇱🇰', accent: '#f59e0b', ring: 'rgba(245,158,11,.5)', grad: 'from-amber-500/25 to-yellow-600/5',  image: IMG_LK },
  SINGAPORE:          { label: 'Singapore',     emoji: '🇸🇬', accent: '#ec4899', ring: 'rgba(236,72,153,.5)', grad: 'from-pink-500/25 to-fuchsia-600/5',  image: IMG_SG },
  MALAYSIA:           { label: 'Malaysia',      emoji: '🇲🇾', accent: '#22c55e', ring: 'rgba(34,197,94,.5)',  grad: 'from-green-500/25 to-emerald-600/5', image: IMG_MY },
  SINGAPORE_MALAYSIA: { label: 'SG & Malaysia', emoji: '🌏', accent: '#3b82f6', ring: 'rgba(59,130,246,.5)', grad: 'from-blue-500/25 to-indigo-600/5',   image: IMG_SG },
  ALL:                { label: 'Multi-Country', emoji: '🌐', accent: '#a78bfa', ring: 'rgba(167,139,250,.5)', grad: 'from-violet-500/25 to-purple-600/5', image: IMG_VN },
}
// SINGAPORE_MALAYSIA is intentionally excluded from the display rotation — those
// bookings still count toward the headline totals, just no combined card.
const ORDER = ['VIETNAM', 'SRILANKA', 'SINGAPORE', 'MALAYSIA', 'ALL']
const ALL_IMAGES = [IMG_VN, IMG_LK, IMG_SG, IMG_MY]

// ── Config ───────────────────────────────────────────────────────────────────
const POLL_MS         = 120_000 // data refresh — every 2 minutes
const ALERT_POLL_MS   = 30_000  // traveller-alert refresh — every 30 seconds
const SPOTLIGHT_MS    = 5_000   // country spotlight rotation
const ALERT_DURATION  = 30      // seconds each new-booking alert stays
const CRITICAL_DURATION = 45    // seconds each new traveller-alert popup stays
const FH_POLL_MS      = 20_000  // file-handler event refresh — every 20 seconds
const FH_DURATION     = 22      // seconds each file-handler popup stays

interface Booking {
  id: string; bookingRef: string; agent: string | null; operationCountry: string | null
  paxAdults: number; paxChildren: number; arrivalDate: string; departureDate: string; createdAt: string
}
interface TEAlert {
  id: number; booking_ref: string | null; customer_name: string | null
  call_kind: string | null; category: string | null; severity: string | null
  title: string | null; details: string | null; customer_quote: string | null; at: string | null
}
const SEV: Record<string, { label: string; accent: string; ring: string; chip: string }> = {
  high:   { label: 'HIGH',   accent: '#ef4444', ring: 'rgba(239,68,68,.6)',  chip: 'bg-red-500/15 text-red-300 border-red-500/40' },
  medium: { label: 'MEDIUM', accent: '#f59e0b', ring: 'rgba(245,158,11,.6)', chip: 'bg-amber-500/15 text-amber-300 border-amber-500/40' },
  low:    { label: 'LOW',    accent: '#eab308', ring: 'rgba(234,179,8,.55)', chip: 'bg-yellow-500/15 text-yellow-300 border-yellow-500/40' },
}
const sevOf = (s?: string | null) => SEV[s ?? 'medium'] ?? SEV.medium
const KIND_LABEL: Record<string, string> = { check_in: 'On-tour check-in', reconfirm: 'Reconfirmation', post_tour: 'Post-tour', campaign: 'Custom call' }
const CATEGORY_LABEL: Record<string, string> = { complaint: 'Complaint', change_request: 'Change request', safety: 'Safety', low_rating: 'Low rating' }
interface ViewData {
  generatedAt: string
  totals: { totalBookings: number; ongoingToday: number; upcoming: number; paxOnTour: number; arrivalFlightsToday: number; flightsToday: number }
  byCountry: { ongoing: Record<string, number>; upcoming: Record<string, number>; lifetime: Record<string, number> }
  recentBookings: Booking[]
}
interface FHEvent {
  id: string; action: 'FLIGHT_ADDED' | 'FLIGHT_UPDATED' | 'CANCEL_REQUESTED'
  fileHandlerName: string; bookingRef: string | null; isNumber: string | null
  operationCountry: string | null; details: string | null; createdAt: string
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

// ── File-handler event alert (flight added / cancellation requested) ──────────
// A boarding-pass styled popup for flights (emerald, a plane races across the
// runway) and a red alert for cancellations — deliberately distinct from the
// cheerful new-booking confetti and the traveller-alert siren.
function FileHandlerAlert({ event, onDismiss }: { event: FHEvent; onDismiss: () => void }) {
  const [left, setLeft] = useState(FH_DURATION)
  useEffect(() => {
    const id = setInterval(() => setLeft(c => { if (c <= 1) { onDismiss(); return 0 } return c - 1 }), 1000)
    return () => clearInterval(id)
  }, [onDismiss])

  const m = metaOf(event.operationCountry ?? 'ALL')
  const isCancel = event.action === 'CANCEL_REQUESTED'
  const accent   = isCancel ? '#ef4444' : '#10b981'
  const ring     = isCancel ? 'rgba(239,68,68,.55)' : 'rgba(16,185,129,.5)'
  const title    = isCancel ? 'Cancellation Requested' : event.action === 'FLIGHT_UPDATED' ? 'Flight Details Updated' : 'Flight Details Added'
  const eyebrow  = isCancel ? 'File Handler · Action Needed' : 'File Handler · Boarding Pass'

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center" onClick={onDismiss}
      style={{ background: 'rgba(2,6,16,.86)', backdropFilter: 'blur(14px)', animation: 'vPop .35s ease-out both' }}>
      <style>{`
        @keyframes fhFly    { 0%{transform:translateX(-46vw) translateY(6px) rotate(-4deg)} 100%{transform:translateX(46vw) translateY(-14px) rotate(-4deg)} }
        @keyframes fhTrail  { 0%,100%{opacity:.25} 50%{opacity:.7} }
        @keyframes fhStamp  { 0%{opacity:0;transform:scale(2) rotate(-18deg)} 55%{opacity:1;transform:scale(.9) rotate(-12deg)} 100%{opacity:1;transform:scale(1) rotate(-12deg)} }
      `}</style>

      {/* runway plane sweeping across for flight events, siren pulses for cancel */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        {isCancel
          ? [280, 440, 600, 760].map((s, i) => (
              <div key={i} className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border-2"
                style={{ width: s, height: s, borderColor: ring, animation: `vRing ${1.6 + i * .3}s ease-in-out infinite`, animationDelay: `${i * .2}s` }} />
            ))
          : (
            <div className="absolute top-1/2 left-1/2" style={{ animation: 'fhFly 3.4s ease-in-out infinite alternate' }}>
              <Plane className="w-16 h-16" style={{ color: accent, filter: `drop-shadow(0 0 18px ${ring})` }} />
              <div className="absolute top-1/2 right-full w-40 h-1 rounded-full" style={{ background: `linear-gradient(90deg,transparent,${accent})`, animation: 'fhTrail 1.4s ease-in-out infinite' }} />
            </div>
          )}
      </div>

      <div className="relative w-full max-w-2xl mx-6" onClick={e => e.stopPropagation()} style={{ animation: 'vBounceIn .6s cubic-bezier(.34,1.56,.64,1) both' }}>
        <div className="relative rounded-[2rem] border-2 overflow-hidden v-glow" style={{ borderColor: ring, background: 'linear-gradient(150deg,rgba(6,10,22,.98),rgba(14,20,38,.98))' }}>
          <div className="v-shine absolute inset-0 pointer-events-none" />

          {/* header */}
          <div className="px-8 py-5 flex items-center gap-4 border-b" style={{ borderColor: ring, background: `${accent}14` }}>
            {isCancel ? <ShieldAlert className="w-8 h-8 v-wiggle" style={{ color: accent }} /> : <Plane className="w-8 h-8 v-wiggle" style={{ color: accent }} />}
            <div className="min-w-0">
              <p className="text-[11px] font-black uppercase tracking-[.35em]" style={{ color: accent }}>{eyebrow}</p>
              <p className="text-2xl font-black text-white leading-tight truncate">{title}</p>
            </div>
            <span className="ml-auto text-6xl v-float select-none">{isCancel ? '🛑' : '✈️'}</span>
          </div>

          {/* boarding-pass body */}
          <div className="relative px-8 py-7 grid grid-cols-2 gap-6">
            <Field label="Booking Ref" value={event.bookingRef || '—'} />
            <Field label="Destination" value={m.label} />
            <Field label="File Handler" value={event.fileHandlerName} />
            <Field label={event.isNumber ? 'IS Number' : 'When'} value={event.isNumber || new Date(event.createdAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })} />
            {event.details && (
              <div className="col-span-2">
                <p className="text-[10px] uppercase tracking-[.25em] text-slate-500 mb-1">Details</p>
                <p className="text-base font-semibold text-white/90">{event.details}</p>
              </div>
            )}
            {/* diagonal stamp */}
            <div className="absolute right-6 bottom-4 px-3 py-1 rounded-md border-2 font-black uppercase tracking-widest text-sm select-none"
              style={{ color: accent, borderColor: accent, animation: 'fhStamp .7s ease-out both', opacity: .9 }}>
              {isCancel ? 'To Accounts' : 'Confirmed'}
            </div>
          </div>

          {/* countdown */}
          <div className="h-1.5 w-full bg-white/5">
            <div className="h-full" style={{ background: accent, animation: `vProgress ${FH_DURATION}s linear forwards` }} />
          </div>
          <p className="text-center text-[10px] text-slate-500 py-2 tracking-widest uppercase">Auto-closes in {left}s · tap to dismiss</p>
        </div>
      </div>
    </div>
  )
}

// ── Crossfading photo stack (all preloaded, only opacity animates) ───────────
function PhotoLayers({ images, active, kenBurns = false, blur = 0 }: { images: string[]; active: string; kenBurns?: boolean; blur?: number }) {
  return (
    <div className="absolute inset-0">
      {images.map(src => {
        const on = src === active
        return (
          <div key={src} className="absolute inset-0 bg-cover bg-center transition-opacity duration-[1200ms] ease-out"
            style={{ backgroundImage: `url(${src})`, opacity: on ? 1 : 0, filter: blur ? `blur(${blur}px)` : undefined, transform: blur ? 'scale(1.1)' : undefined, animation: on && kenBurns ? 'vKenBurns 14s ease-out both' : 'none' }} />
        )
      })}
    </div>
  )
}

// ── Country spotlight (rotates one country at a time, full-bleed photo) ───────
function Spotlight({ country, data, allCountries }: { country: string; data: ViewData; allCountries: string[] }) {
  const m = metaOf(country)
  const ongoing  = data.byCountry.ongoing[country]  ?? 0
  const upcoming = data.byCountry.upcoming[country] ?? 0
  const lifetime = data.byCountry.lifetime[country] ?? 0

  // Distinct photos across the visible countries — crossfade without remounting.
  const layers = Array.from(new Set(allCountries.map(c => metaOf(c).image)))

  return (
    <div className="relative h-full rounded-3xl border-2 overflow-hidden shadow-2xl" style={{ borderColor: m.ring, boxShadow: `0 0 60px -10px ${m.ring}` }}>
      <PhotoLayers images={layers} active={m.image} kenBurns />
      {/* ── Readability overlays ── */}
      <div className="absolute inset-0" style={{ background: 'linear-gradient(180deg,rgba(3,7,17,.35) 0%,rgba(3,7,17,.55) 45%,rgba(3,7,17,.92) 100%)' }} />
      <div className="absolute inset-0" style={{ background: `linear-gradient(135deg,${m.accent}22 0%,transparent 55%)` }} />
      <div className="v-shine absolute inset-0 pointer-events-none" />
      {/* scan line */}
      <div className="absolute inset-x-0 h-24 pointer-events-none" style={{ background: `linear-gradient(180deg,transparent,${m.ring},transparent)`, animation: 'vScan 6s linear infinite', opacity: .25 }} />

      {/* ── Foreground content ── */}
      <div key={country} className="relative h-full flex flex-col p-8" style={{ animation: 'vSlideIn .7s cubic-bezier(.34,1.56,.64,1) both' }}>
        <div className="flex items-center gap-4">
          <span className="rounded-2xl overflow-hidden border-2 border-white/25 shadow-xl v-float"><CountryFlag country={country} className="w-16 h-11" /></span>
          <div>
            <p className="text-[11px] uppercase tracking-[.4em] text-white/70 flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: m.accent, animation: 'vPulse 1.2s ease-in-out infinite' }} /> Now Spotlighting
            </p>
            <h2 className="text-5xl font-black text-white drop-shadow-lg">{m.label}</h2>
          </div>
          <span className="ml-auto text-5xl v-float select-none drop-shadow-lg">{m.emoji}</span>
        </div>

        <div className="mt-auto">
          <p className="text-[12px] uppercase tracking-[.3em] text-white/70 mb-1">On Tour Today</p>
          <div className="text-[9rem] leading-none font-black tabular-nums text-white" style={{ textShadow: `0 0 50px ${m.accent}, 0 4px 20px rgba(0,0,0,.6)` }}>
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
    <div className="rounded-2xl bg-black/35 border border-white/15 px-4 py-3" style={{ backdropFilter: 'blur(8px)' }}>
      <div className="flex items-center gap-1.5 mb-0.5" style={{ color: accent }}>{icon}<span className="text-[10px] uppercase tracking-[.2em] text-white/70">{label}</span></div>
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

// ── AI Call Bots availability (UI only — random 7–12, changes over time) ─────
function AiCallBots() {
  const [n, setN] = useState(9)
  useEffect(() => {
    const tick = () => {
      // gentle ±1 wander, clamped to 7–12, so it feels alive not jumpy
      setN(prev => {
        const step = [-1, 0, 1, 1, -1][Math.floor(Math.random() * 5)]
        return Math.min(12, Math.max(7, prev + step))
      })
    }
    const id = setInterval(tick, 4000 + Math.random() * 4000)
    return () => clearInterval(id)
  }, [])
  return (
    <div className="relative rounded-2xl border border-emerald-400/30 overflow-hidden bg-gradient-to-br from-emerald-500/15 to-teal-600/5 px-4 py-3">
      <div className="v-shine absolute inset-0 pointer-events-none" />
      <div className="flex items-center gap-3">
        <div className="relative w-11 h-11 rounded-xl bg-emerald-500/20 border border-emerald-400/30 flex items-center justify-center shrink-0">
          <Bot className="w-6 h-6 text-emerald-300 v-wiggle" />
          <span className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-emerald-400 border-2 border-[#071018]" style={{ animation: 'vPulse 1s ease-in-out infinite' }} />
        </div>
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-[.25em] text-emerald-300/80">AI Call Bots Ready</p>
          <p className="text-2xl font-black text-white leading-none">
            <span key={n} style={{ display: 'inline-block', animation: 'vPop .5s cubic-bezier(.34,1.56,.64,1) both' }}>{n}</span>
            <span className="text-sm font-medium text-white/50"> / 12 online</span>
          </p>
        </div>
        <div className="ml-auto flex gap-1 items-end h-8">
          {[0, 1, 2, 3].map(i => (
            <span key={i} className="w-1.5 rounded-full bg-emerald-400/70" style={{ height: `${30 + ((n + i) % 4) * 18}%`, animation: `vPulse ${0.8 + i * 0.2}s ease-in-out infinite` }} />
          ))}
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

// ── Critical traveller-alert popup (full-screen, alarming) ───────────────────
function CriticalAlert({ alert, onDismiss }: { alert: TEAlert; onDismiss: () => void }) {
  const [left, setLeft] = useState(CRITICAL_DURATION)
  useEffect(() => {
    const id = setInterval(() => setLeft(c => { if (c <= 1) { onDismiss(); return 0 } return c - 1 }), 1000)
    return () => clearInterval(id)
  }, [onDismiss])
  const s = sevOf(alert.severity)
  const meta: string[] = []
  if (alert.booking_ref) meta.push(alert.booking_ref)
  if (alert.customer_name) meta.push(alert.customer_name)
  if (alert.call_kind) meta.push(KIND_LABEL[alert.call_kind] ?? alert.call_kind)
  if (alert.category) meta.push(CATEGORY_LABEL[alert.category] ?? alert.category)

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center" onClick={onDismiss}
      style={{ background: 'rgba(20,2,2,.88)', backdropFilter: 'blur(14px)', animation: 'vPop .3s ease-out both' }}>
      {/* pulsing red rings */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        {[300, 460, 620, 780].map((sz, i) => (
          <div key={i} className="absolute rounded-full border" style={{ width: sz, height: sz, borderColor: s.ring, animation: `vRing ${1.6 + i * .35}s ease-in-out infinite`, animationDelay: `${i * .2}s` }} />
        ))}
      </div>

      <div className="relative w-full max-w-2xl mx-6" onClick={e => e.stopPropagation()} style={{ animation: 'vBounceIn .55s cubic-bezier(.34,1.56,.64,1) both' }}>
        <div className="relative rounded-[2rem] border-2 overflow-hidden v-alarm" style={{ borderColor: s.ring, background: 'linear-gradient(150deg,rgba(28,6,6,.98),rgba(38,10,12,.98))' }}>
          {/* header */}
          <div className="px-8 py-5 flex items-center gap-4 border-b" style={{ borderColor: s.ring, background: `${s.accent}18` }}>
            <AlertTriangle className="w-9 h-9" style={{ color: s.accent, animation: 'vSiren 1s ease-in-out infinite' }} />
            <div className="min-w-0">
              <p className="text-[11px] font-black uppercase tracking-[.4em]" style={{ color: s.accent }}>Traveller Alert · Action Needed</p>
              <p className="text-2xl font-black text-white leading-tight truncate">{alert.title ?? CATEGORY_LABEL[alert.category ?? ''] ?? 'Issue reported on tour'}</p>
            </div>
            <span className={`ml-auto shrink-0 text-[11px] font-black px-3 py-1 rounded-full border ${s.chip}`}>{s.label}</span>
          </div>
          {/* body */}
          <div className="px-8 py-6 space-y-4">
            <p className="text-sm font-semibold tracking-wide" style={{ color: '#fca5a5' }}>{meta.join('  ·  ')}</p>
            {alert.details && <p className="text-lg text-white/90 leading-snug">{alert.details}</p>}
            {alert.customer_quote && (
              <p className="text-base text-white/70 italic flex items-start gap-2 leading-snug">
                <Quote className="w-5 h-5 mt-0.5 shrink-0 text-white/30" />
                <span>&ldquo;{alert.customer_quote}&rdquo;</span>
              </p>
            )}
          </div>
          {/* countdown */}
          <div className="h-1.5 w-full bg-white/5">
            <div className="h-full" style={{ background: s.accent, animation: `vProgress ${CRITICAL_DURATION}s linear forwards` }} />
          </div>
          <p className="text-center text-[10px] text-red-300/70 py-2 tracking-widest uppercase">Auto-closes in {left}s · tap to dismiss</p>
        </div>
      </div>
    </div>
  )
}

// ── Standing traveller-alerts bar (all open alerts, scrolling ticker) ────────
function AlertsBar({ alerts }: { alerts: TEAlert[] }) {
  const highCount = alerts.filter(a => a.severity === 'high').length
  // Duplicate the list so the marquee loops seamlessly (translateX -50%).
  const loop = alerts.length > 0 ? [...alerts, ...alerts] : []
  return (
    <div className="shrink-0 rounded-2xl border overflow-hidden flex items-stretch"
      style={{ borderColor: highCount ? 'rgba(239,68,68,.5)' : 'rgba(245,158,11,.4)', background: highCount ? 'rgba(40,8,10,.55)' : 'rgba(40,26,6,.45)' }}>
      {/* label */}
      <div className="shrink-0 flex items-center gap-2.5 px-5 py-3 border-r" style={{ borderColor: 'rgba(255,255,255,.08)', background: highCount ? 'rgba(239,68,68,.14)' : 'rgba(245,158,11,.12)' }}>
        <ShieldAlert className="w-5 h-5" style={{ color: highCount ? '#f87171' : '#fbbf24', animation: highCount ? 'vSiren 1s ease-in-out infinite' : 'none' }} />
        <div className="leading-none">
          <p className="text-[9px] uppercase tracking-[.3em] text-white/60">Traveller Alerts</p>
          <p className="text-lg font-black tabular-nums" style={{ color: highCount ? '#fca5a5' : '#fcd34d' }}>{alerts.length} <span className="text-[11px] font-semibold text-white/50">open{highCount ? ` · ${highCount} high` : ''}</span></p>
        </div>
      </div>
      {/* scrolling ticker */}
      <div className="relative flex-1 overflow-hidden flex items-center">
        {alerts.length === 0 ? (
          <p className="px-5 text-sm text-emerald-300/80">All quiet — no open traveller alerts right now.</p>
        ) : (
          <div className="flex items-center gap-8 whitespace-nowrap px-6" style={{ animation: `vMarquee ${Math.max(22, loop.length * 5)}s linear infinite` }}>
            {loop.map((a, i) => {
              const s = sevOf(a.severity)
              return (
                <span key={`${a.id}-${i}`} className="inline-flex items-center gap-2 text-sm">
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ background: s.accent }} />
                  {a.booking_ref && <span className="font-mono font-bold text-white/85">{a.booking_ref}</span>}
                  <span className="text-white/70">{a.title ?? a.details ?? CATEGORY_LABEL[a.category ?? ''] ?? 'Issue reported'}</span>
                  <span className={`text-[9px] font-black px-1.5 py-0.5 rounded-full border ${s.chip}`}>{s.label}</span>
                </span>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Main ─────────────────────────────────────────────────────────────────────
function ViewDashboard() {
  const [data, setData]   = useState<ViewData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [now, setNow]     = useState(new Date())
  const [spotlightIdx, setSpotlightIdx] = useState(0)
  const [soundOn, setSoundOn] = useState(true)

  // new-booking alert queue
  const [alert, setAlert] = useState<Booking | null>(null)
  const queueRef = useRef<Booking[]>([])
  const seenRef  = useRef<Set<string> | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const soundOnRef = useRef(true)
  useEffect(() => { soundOnRef.current = soundOn }, [soundOn])

  // traveller-alert state (standing list + critical popup for new ones)
  const [alerts, setAlerts] = useState<TEAlert[]>([])
  const [critical, setCritical] = useState<TEAlert | null>(null)
  const critQueueRef = useRef<TEAlert[]>([])
  const seenAlertsRef = useRef<Set<number> | null>(null)

  // file-handler event state (flight added / cancellation requested popups)
  const [fhEvent, setFhEvent] = useState<FHEvent | null>(null)
  const fhQueueRef = useRef<FHEvent[]>([])
  const seenFhRef  = useRef<Set<string> | null>(null)

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

  // Harsh alarm for traveller alerts — a repeating two-tone siren, unmistakably
  // different from the cheerful new-booking chime.
  const alarm = useCallback(() => {
    if (!soundOnRef.current) return
    try {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      const ctx = audioCtxRef.current ?? (audioCtxRef.current = new AC())
      if (ctx.state === 'suspended') ctx.resume()
      const t0 = ctx.currentTime
      // 3 sweeps of a high→low two-tone wail.
      for (let i = 0; i < 3; i++) {
        const base = t0 + i * 0.5
        ;[[880, base], [660, base + 0.25]].forEach(([f, t]) => {
          const osc = ctx.createOscillator(), gain = ctx.createGain()
          osc.type = 'sawtooth'; osc.frequency.value = f
          gain.gain.setValueAtTime(0, t)
          gain.gain.linearRampToValueAtTime(0.32, t + 0.03)
          gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.24)
          osc.connect(gain); gain.connect(ctx.destination)
          osc.start(t); osc.stop(t + 0.26)
        })
      }
    } catch { /* audio not available */ }
  }, [])

  const pumpCritical = useCallback(() => {
    setCritical(cur => { if (cur) return cur; const next = critQueueRef.current.shift() ?? null; if (next) alarm(); return next })
  }, [alarm])

  // File-handler popups: a cheerful chime for flights, the harsh siren for cancels.
  const pumpFh = useCallback(() => {
    setFhEvent(cur => {
      if (cur) return cur
      const next = fhQueueRef.current.shift() ?? null
      if (next) { next.action === 'CANCEL_REQUESTED' ? alarm() : chime() }
      return next
    })
  }, [alarm, chime])

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/public/view-dashboard', { cache: 'no-store' })
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
  }, [pump])

  const loadAlerts = useCallback(async () => {
    try {
      const res = await fetch('/api/public/te-alerts', { cache: 'no-store' })
      const j = await res.json()
      const rows: TEAlert[] = j?.alerts ?? []
      // Sort high → medium → low, then newest first.
      const rank = (a: TEAlert) => (a.severity === 'high' ? 3 : a.severity === 'medium' ? 2 : 1)
      rows.sort((a, b) => rank(b) - rank(a) || new Date(b.at ?? 0).getTime() - new Date(a.at ?? 0).getTime())

      // Raise a critical popup for brand-new alerts (skip the first load so a
      // freshly-opened screen doesn't alarm on the whole backlog).
      if (seenAlertsRef.current === null) {
        seenAlertsRef.current = new Set(rows.map(a => a.id))
      } else {
        const fresh = rows.filter(a => !seenAlertsRef.current!.has(a.id))
        fresh.reverse().forEach(a => { seenAlertsRef.current!.add(a.id); critQueueRef.current.push(a) })
        if (fresh.length) pumpCritical()
      }
      setAlerts(rows)
    } catch { /* keep last known alerts — never break the screen */ }
  }, [pumpCritical])

  const loadFhEvents = useCallback(async () => {
    try {
      const res = await fetch('/api/public/filehandler-events', { cache: 'no-store' })
      const j = await res.json()
      const rows: FHEvent[] = j?.data?.events ?? []
      // Skip the first load so a freshly-opened screen doesn't replay the backlog.
      if (seenFhRef.current === null) {
        seenFhRef.current = new Set(rows.map(e => e.id))
      } else {
        const fresh = rows.filter(e => !seenFhRef.current!.has(e.id))
        fresh.reverse().forEach(e => { seenFhRef.current!.add(e.id); fhQueueRef.current.push(e) })
        if (fresh.length) pumpFh()
      }
    } catch { /* never break the screen */ }
  }, [pumpFh])

  useEffect(() => { load(); const id = setInterval(load, POLL_MS); return () => clearInterval(id) }, [load])
  useEffect(() => { loadAlerts(); const id = setInterval(loadAlerts, ALERT_POLL_MS); return () => clearInterval(id) }, [loadAlerts])
  useEffect(() => { loadFhEvents(); const id = setInterval(loadFhEvents, FH_POLL_MS); return () => clearInterval(id) }, [loadFhEvents])
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
  const dismissCritical = useCallback(() => { setCritical(null); setTimeout(pumpCritical, 400) }, [pumpCritical])
  const dismissFh = useCallback(() => { setFhEvent(null); setTimeout(pumpFh, 400) }, [pumpFh])

  const activeMeta = metaOf(spotCountry)

  return (
    <div className="fixed inset-0 overflow-hidden text-white" style={{ background: 'radial-gradient(ellipse at top,#0a1020,#030711 60%)', fontFamily: 'ui-sans-serif,system-ui' }}>
      <style>{CSS}</style>

      {/* ── Futuristic full-screen backdrop: the spotlighted country's photo, blurred & darkened ── */}
      {data && (
        <div className="fixed inset-0 pointer-events-none">
          <PhotoLayers images={ALL_IMAGES} active={activeMeta.image} blur={9} />
          <div className="absolute inset-0" style={{ background: 'linear-gradient(180deg,rgba(3,7,17,.82),rgba(3,7,17,.9) 55%,rgba(3,7,17,.97))' }} />
          <div className="absolute inset-0 transition-colors duration-[1500ms]" style={{ background: `radial-gradient(ellipse 70% 60% at 50% 30%, ${activeMeta.accent}22, transparent 70%)` }} />
        </div>
      )}
      <Background />
      {/* Preload destination photos so the spotlight crossfades are instant */}
      <div className="hidden" aria-hidden>{ALL_IMAGES.map(src => <img key={src} src={src} alt="" />)}</div>

      {alert && <BookingAlert booking={alert} onDismiss={dismissAlert} />}
      {critical && <CriticalAlert alert={critical} onDismiss={dismissCritical} />}
      {fhEvent && <FileHandlerAlert event={fhEvent} onDismiss={dismissFh} />}

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
              <p className="text-sm text-slate-500 mt-2">This screen reloads automatically — it will reconnect on its own.</p>
            </div>
          </div>
        )}

        {data && (
          <>
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
                <div className="flex items-center gap-4 mt-3">
                  <span className="inline-flex items-center gap-1.5 text-slate-300"><Users className="w-4 h-4 text-brand-400" /><span className="text-base font-bold"><Counter target={data.totals.paxOnTour} /> pax on the ground</span></span>
                  <span className="w-px h-4 bg-white/15" />
                  <span className="inline-flex items-center gap-1.5 text-slate-300"><Plane className="w-4 h-4 text-sky-400 v-float" /><span className="text-base font-bold"><Counter target={data.totals.arrivalFlightsToday} /> arrival flights today</span></span>
                </div>
              </div>
              {/* Mid: total (big) + upcoming & arrival flights (always visible) */}
              <div className="flex flex-col gap-5 shrink-0">
                <HeadStat label="Total Bookings" value={data.totals.totalBookings} tone="#22c55e" icon={<TrendingUp className="w-6 h-6" />} big />
                <div className="grid grid-cols-2 gap-5">
                  <HeadStat label="Upcoming Tours" value={data.totals.upcoming} tone="#3b82f6" icon={<CalendarClock className="w-6 h-6" />} />
                  <HeadStat label="Arrival Flights" value={data.totals.arrivalFlightsToday} tone="#38bdf8" icon={<Plane className="w-6 h-6" />} />
                </div>
              </div>
            </div>

            {/* MIDDLE — rotating country spotlight */}
            <div className="min-h-0"><Spotlight country={spotCountry} data={data} allCountries={spotCountries} /></div>

            {/* RIGHT — small per-country tiles */}
            <div className="flex flex-col gap-4 min-h-0">
              <AiCallBots />
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
          <AlertsBar alerts={alerts} />
          </>
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
