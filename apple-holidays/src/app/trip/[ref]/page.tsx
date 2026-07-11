'use client'

/**
 * Public customer trip portal — opened from the "Copy Portal Link" share link.
 * No login required; access is gated by the signed ?t= token validated server-side.
 * Mobile-first, animated, real-time (auto-refreshing) view of a customer's booking.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Calendar, Users, Plane, Hotel, MapPin, CreditCard, Phone, Car,
  Loader2, ChevronRight, Clock, CheckCircle2, AlertCircle, Lock,
  Ticket as TicketIcon, Download, Sparkles, Home, Baby, Utensils,
  ShieldAlert, Globe2, PartyPopper,
} from 'lucide-react'
import { differenceInDays, format } from 'date-fns'

// ─── Types ──────────────────────────────────────────────────────────────────
interface Assignment { driverName?: string; driverPhone?: string; vehicleType?: string; vehiclePlate?: string }
interface PortalData {
  bookingRef: string
  status: string
  arrivalDate: string
  departureDate: string
  paxAdults: number
  paxChildren: number
  paxInfants: number
  agent: string | null
  dealName: string | null
  tourDestination: string | null
  operationCountry: string | null
  languagePreference: string | null
  specialOccasions: string | null
  importantNotes: string | null
  packageIncludes: string | null
  packageExcludes: string | null
  valueAddedServices: string | null
  tips: string | null
  passengers: { id: string; name: string; type: string; isLead: boolean; nationality?: string | null; mealPreference?: string | null }[]
  flights: { id: string; flightNo: string; date: string; airline?: string; fromApt: string; depTime: string; toApt: string; arrTime: string }[]
  accommodations: { id: string; city: string; hotel: string; checkIn: string; checkOut: string; nights: number; roomType?: string; mealType?: string; address?: string; contact?: string }[]
  itinerary: { id: string; dayNo: number; date: string; title: string; description?: string; inclusions?: string; exclusions?: string }[]
  emergencyContacts: { id: string; name: string; phone?: string | null; role?: string | null }[]
  agenda: { items: { id: string; date: string; location: string; fromPoint?: string; toPoint?: string; details?: string; mealPlan?: string; meetingTime?: string; timeFrom?: string; timeTo?: string; serviceType: string; assignment?: Assignment | null }[] } | null
  tickets: { id: string; type: string; qty: number; supplier?: string; reference?: string; status: string; fileUrl?: string; fileName?: string; fileType?: string; agendaItem?: { date: string; location: string } | null }[]
  payments: { id: string; type: string; label?: string; amount: string; currency: string; status: string; method?: string; paidAt?: string; refNumber?: string }[]
}

type Tab = 'overview' | 'itinerary' | 'stays' | 'travel' | 'help'

// ─── Destination theming ────────────────────────────────────────────────────
const THEME: Record<string, { name: string; flag: string; emojis: string[]; from: string; via: string; to: string; accent: string; accentBg: string; accentText: string; accentBorder: string }> = {
  VIETNAM:            { name: 'Vietnam',           flag: '🇻🇳', emojis: ['🏯', '🛶', '⛩️', '🍜'], from: 'from-emerald-500', via: 'via-teal-500', to: 'to-cyan-600', accent: 'emerald', accentBg: 'bg-emerald-500/15', accentText: 'text-emerald-300', accentBorder: 'border-emerald-400/30' },
  SRILANKA:           { name: 'Sri Lanka',         flag: '🇱🇰', emojis: ['🐘', '🏝️', '🍃', '🛕'], from: 'from-amber-500', via: 'via-orange-500', to: 'to-rose-500', accent: 'amber', accentBg: 'bg-amber-500/15', accentText: 'text-amber-300', accentBorder: 'border-amber-400/30' },
  SINGAPORE:          { name: 'Singapore',         flag: '🇸🇬', emojis: ['🏙️', '🌃', '🦁', '🎡'], from: 'from-sky-500', via: 'via-indigo-500', to: 'to-violet-600', accent: 'sky', accentBg: 'bg-sky-500/15', accentText: 'text-sky-300', accentBorder: 'border-sky-400/30' },
  MALAYSIA:           { name: 'Malaysia',          flag: '🇲🇾', emojis: ['🏙️', '🌴', '🕌', '🍢'], from: 'from-blue-500', via: 'via-cyan-500', to: 'to-teal-500', accent: 'cyan', accentBg: 'bg-cyan-500/15', accentText: 'text-cyan-300', accentBorder: 'border-cyan-400/30' },
  SINGAPORE_MALAYSIA: { name: 'Singapore & Malaysia', flag: '🇸🇬', emojis: ['🏙️', '🌴', '🦁', '🎡'], from: 'from-sky-500', via: 'via-indigo-500', to: 'to-violet-600', accent: 'sky', accentBg: 'bg-sky-500/15', accentText: 'text-sky-300', accentBorder: 'border-sky-400/30' },
  DEFAULT:            { name: 'Your Trip',         flag: '🌏', emojis: ['✈️', '🏝️', '🌅', '🧳'], from: 'from-brand-500', via: 'via-indigo-500', to: 'to-purple-600', accent: 'brand', accentBg: 'bg-brand-500/15', accentText: 'text-brand-300', accentBorder: 'border-brand-400/30' },
}

const STATUS_COLOR: Record<string, string> = {
  CONFIRMED: 'bg-emerald-500/15 text-emerald-300 border-emerald-400/30',
  PENDING: 'bg-amber-500/15 text-amber-300 border-amber-400/30',
  PAID: 'bg-emerald-500/15 text-emerald-300 border-emerald-400/30',
  REJECTED: 'bg-rose-500/15 text-rose-300 border-rose-400/30',
}

function money(amount: number, currency = 'USD') {
  try { return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount) }
  catch { return `${currency} ${amount.toLocaleString()}` }
}

// ─── Small building blocks ──────────────────────────────────────────────────
function Section({ icon: Icon, title, emoji, children, accent }: { icon: React.ComponentType<{ className?: string }>; title: string; emoji?: string; children: React.ReactNode; accent: string }) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-40px' }}
      transition={{ duration: 0.4 }}
      className="mb-6"
    >
      <div className="flex items-center gap-2 mb-3">
        <Icon className={`w-4 h-4 ${accent}`} />
        <h3 className="text-sm font-bold text-white tracking-wide">{title}</h3>
        {emoji && <span className="text-base">{emoji}</span>}
      </div>
      {children}
    </motion.section>
  )
}

const card = 'rounded-2xl bg-white/[0.04] border border-white/10 backdrop-blur-sm'

// ─── Page ───────────────────────────────────────────────────────────────────
export default function CustomerTripPage() {
  const { ref } = useParams<{ ref: string }>()
  const search = useSearchParams()
  const token = search.get('t') ?? ''

  const [data, setData] = useState<PortalData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('overview')
  const [now, setNow] = useState(() => new Date())
  const [pulse, setPulse] = useState(false)
  const firstLoad = useRef(true)

  // Live clock for countdown feel
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(id)
  }, [])

  // Fetch + real-time auto-refresh every 30s
  useEffect(() => {
    let alive = true
    async function load() {
      try {
        const r = await fetch(`/api/public/portal/${ref}?t=${encodeURIComponent(token)}`, { cache: 'no-store' })
        const j = await r.json()
        if (!alive) return
        if (j.success) {
          setData(j.data)
          setError(null)
          if (!firstLoad.current) { setPulse(true); setTimeout(() => setPulse(false), 1500) }
        } else setError(j.error ?? 'Unable to load your trip')
      } catch {
        if (alive) setError('Network error — please check your connection')
      } finally {
        if (alive) { setLoading(false); firstLoad.current = false }
      }
    }
    load()
    const id = setInterval(load, 30_000)
    return () => { alive = false; clearInterval(id) }
  }, [ref, token])

  const theme = useMemo(() => THEME[data?.operationCountry ?? 'DEFAULT'] ?? THEME.DEFAULT, [data?.operationCountry])

  // ── Loading ──
  if (loading) return (
    <div className="min-h-[100dvh] bg-slate-950 flex items-center justify-center">
      <div className="text-center">
        <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1.2, ease: 'linear' }} className="inline-block">
          <Plane className="w-10 h-10 text-brand-400" />
        </motion.div>
        <motion.p animate={{ opacity: [0.4, 1, 0.4] }} transition={{ repeat: Infinity, duration: 1.6 }} className="text-slate-400 text-sm mt-4">
          Preparing your journey…
        </motion.p>
      </div>
    </div>
  )

  // ── Error / invalid link ──
  if (error || !data) return (
    <div className="min-h-[100dvh] bg-slate-950 flex flex-col items-center justify-center p-8 text-center">
      <motion.div initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="w-20 h-20 rounded-full bg-rose-500/10 border border-rose-500/20 flex items-center justify-center mb-5">
        <Lock className="w-9 h-9 text-rose-400" />
      </motion.div>
      <h2 className="text-white font-bold text-2xl mb-2">Link Unavailable</h2>
      <p className="text-slate-400 max-w-sm text-sm leading-relaxed">
        {error ?? 'This trip link is invalid or has expired. Please contact your travel consultant for a new link.'}
      </p>
    </div>
  )

  // ── Derived ──
  const arrival = new Date(data.arrivalDate)
  const departure = new Date(data.departureDate)
  const daysUntil = differenceInDays(arrival, now)
  const tripLen = Math.max(1, differenceInDays(departure, arrival))
  const inProgress = daysUntil <= 0 && differenceInDays(departure, now) >= 0
  const completed = differenceInDays(departure, now) < 0
  const totalNights = data.accommodations.reduce((s, a) => s + a.nights, 0)
  const cities = Array.from(new Set(data.accommodations.map(a => a.city)))
  const lead = data.passengers.find(p => p.isLead) ?? data.passengers[0]
  const totalPax = data.paxAdults + data.paxChildren + data.paxInfants
  const pendingPayments = data.payments.filter(p => p.status === 'PENDING')
  const totalPaid = data.payments.filter(p => ['CONFIRMED', 'PAID'].includes(p.status)).reduce((s, p) => s + Number(p.amount), 0)
  const drivers = data.agenda?.items.filter(i => i.assignment?.driverName) ?? []

  const TABS: { key: Tab; label: string; icon: React.ComponentType<{ className?: string }>; badge?: number }[] = [
    { key: 'overview', label: 'Home', icon: Home },
    { key: 'itinerary', label: 'Plan', icon: MapPin },
    { key: 'stays', label: 'Stays', icon: Hotel },
    { key: 'travel', label: 'Travel', icon: Plane },
    { key: 'help', label: 'Help', icon: Phone, badge: pendingPayments.length || undefined },
  ]

  const heroTitle = completed ? 'Trip Completed' : inProgress ? "You're Travelling!" : 'Countdown Begins'
  const heroEmoji = completed ? '🎊' : inProgress ? '🌴' : '🧳'

  return (
    <div className="min-h-[100dvh] bg-slate-950 text-white pb-28 selection:bg-brand-500/30">
      {/* ─── Animated hero ─── */}
      <div className="relative overflow-hidden">
        <div className={`absolute inset-0 bg-gradient-to-br ${theme.from} ${theme.via} ${theme.to} opacity-90`} />
        <div className="absolute inset-0 bg-[radial-gradient(120%_120%_at_50%_-20%,transparent_40%,rgba(2,6,23,0.85)_100%)]" />
        {/* Floating emojis */}
        {theme.emojis.map((e, i) => (
          <motion.span
            key={i}
            className="absolute text-4xl sm:text-5xl select-none pointer-events-none"
            style={{ left: `${12 + i * 24}%`, top: `${18 + (i % 2) * 40}%` }}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 0.35, y: [0, -14, 0] }}
            transition={{ delay: i * 0.25, duration: 4 + i, repeat: Infinity, ease: 'easeInOut' }}
          >
            {e}
          </motion.span>
        ))}

        <div className="relative max-w-2xl mx-auto px-5 pt-10 pb-8">
          {/* Live badge */}
          <div className="flex items-center justify-between mb-6">
            <motion.div initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/15 backdrop-blur border border-white/20">
              <span className="text-lg leading-none">{theme.flag}</span>
              <span className="text-xs font-bold tracking-wide">{data.tourDestination || theme.name}</span>
            </motion.div>
            <motion.div animate={{ opacity: pulse ? [1, 0.4, 1] : 1 }} className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/10 border border-white/15">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400" />
              </span>
              <span className="text-[10px] font-semibold text-white/90">LIVE</span>
            </motion.div>
          </div>

          {/* Greeting */}
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
            <p className="text-white/80 text-sm font-medium">Hello{lead ? `, ${lead.name.split(' ')[0]}` : ''} 👋</p>
            <h1 className="text-3xl sm:text-4xl font-black leading-tight mt-1 flex items-center gap-2">
              {heroTitle} <span>{heroEmoji}</span>
            </h1>
            <p className="text-white/70 text-sm mt-1.5">
              {format(arrival, 'dd MMM')} → {format(departure, 'dd MMM yyyy')} · {tripLen} day{tripLen !== 1 ? 's' : ''}
            </p>
          </motion.div>

          {/* Countdown */}
          <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.2, type: 'spring' }} className="mt-6 flex items-center gap-4">
            {!completed && (
              <div className="flex items-baseline gap-2">
                <span className="text-6xl font-black tabular-nums drop-shadow-lg">
                  {daysUntil > 0 ? daysUntil : inProgress ? differenceInDays(departure, now) : 0}
                </span>
                <div className="leading-tight">
                  <p className="text-white font-bold text-sm">days</p>
                  <p className="text-white/70 text-xs">{daysUntil > 0 ? 'to go' : 'remaining'}</p>
                </div>
              </div>
            )}
            {completed && <p className="text-lg font-bold text-white/90">We hope you had an amazing time! 💚</p>}
          </motion.div>
        </div>
      </div>

      {/* ─── Quick stats ─── */}
      <div className="max-w-2xl mx-auto px-5 -mt-4 relative z-10">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }} className="grid grid-cols-4 gap-2">
          {[
            { label: 'Guests', value: totalPax, icon: Users, e: '👥' },
            { label: 'Nights', value: totalNights, icon: Hotel, e: '🛏️' },
            { label: 'Cities', value: cities.length, icon: MapPin, e: '📍' },
            { label: 'Flights', value: data.flights.length, icon: Plane, e: '✈️' },
          ].map((s, i) => (
            <motion.div key={s.label} whileHover={{ y: -3 }} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 + i * 0.05 }} className={`${card} p-3 text-center`}>
              <div className="text-lg mb-0.5">{s.e}</div>
              <p className="text-xl font-black">{s.value}</p>
              <p className="text-[10px] text-slate-400 mt-0.5">{s.label}</p>
            </motion.div>
          ))}
        </motion.div>
      </div>

      {/* ─── Content ─── */}
      <div className="max-w-2xl mx-auto px-5 pt-6">
        <AnimatePresence mode="wait">
          <motion.div key={tab} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.25 }}>

            {/* ── OVERVIEW ── */}
            {tab === 'overview' && (
              <>
                {pendingPayments.length > 0 && (
                  <motion.button onClick={() => setTab('help')} whileTap={{ scale: 0.98 }} className="w-full flex items-center gap-3 p-4 mb-5 bg-amber-500/10 border border-amber-400/30 rounded-2xl text-left">
                    <AlertCircle className="w-5 h-5 text-amber-400 flex-shrink-0" />
                    <div className="flex-1">
                      <p className="text-sm font-bold text-amber-200">{pendingPayments.length} payment{pendingPayments.length > 1 ? 's' : ''} pending 💳</p>
                      <p className="text-xs text-amber-400/80">Tap to review your payments</p>
                    </div>
                    <ChevronRight className="w-4 h-4 text-amber-400" />
                  </motion.button>
                )}

                {data.specialOccasions && (
                  <motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} className="flex items-center gap-3 p-4 mb-5 rounded-2xl bg-gradient-to-r from-pink-500/15 to-purple-500/15 border border-pink-400/25">
                    <PartyPopper className="w-5 h-5 text-pink-300 flex-shrink-0" />
                    <p className="text-sm text-pink-100"><span className="font-bold">Celebrating:</span> {data.specialOccasions} 🎉</p>
                  </motion.div>
                )}

                {/* Travellers */}
                <Section icon={Users} title="Travellers" emoji="🧳" accent={theme.accentText}>
                  <div className="space-y-2">
                    {data.passengers.map((p, i) => (
                      <motion.div key={p.id} initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.05 }} className={`${card} flex items-center gap-3 p-3.5`}>
                        <div className={`w-10 h-10 rounded-full ${theme.accentBg} ${theme.accentBorder} border flex items-center justify-center ${theme.accentText} text-sm font-black flex-shrink-0`}>
                          {p.name.slice(0, 2).toUpperCase()}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-sm truncate">{p.name}</p>
                          <p className="text-xs text-slate-400 flex items-center gap-1.5">
                            <span className="capitalize">{p.type.toLowerCase()}</span>
                            {p.nationality && <><span className="text-slate-600">·</span>{p.nationality}</>}
                            {p.mealPreference && <><span className="text-slate-600">·</span><Utensils className="w-3 h-3" />{p.mealPreference}</>}
                          </p>
                        </div>
                        {p.isLead && <span className={`text-[10px] ${theme.accentBg} ${theme.accentText} px-2 py-0.5 rounded-full font-bold border ${theme.accentBorder}`}>Lead</span>}
                        {p.type === 'INFANT' && <Baby className="w-4 h-4 text-slate-500" />}
                      </motion.div>
                    ))}
                  </div>
                </Section>

                {/* What's included */}
                {(data.packageIncludes || data.valueAddedServices) && (
                  <Section icon={Sparkles} title="What's Included" emoji="✨" accent={theme.accentText}>
                    <div className={`${card} p-4 space-y-2`}>
                      {data.packageIncludes && <p className="text-sm text-slate-200 whitespace-pre-line leading-relaxed">{data.packageIncludes}</p>}
                      {data.valueAddedServices && (
                        <div className="pt-2 mt-1 border-t border-white/10">
                          <p className="text-xs font-bold text-emerald-300 mb-1">🎁 Value-added services</p>
                          <p className="text-sm text-slate-200 whitespace-pre-line leading-relaxed">{data.valueAddedServices}</p>
                        </div>
                      )}
                    </div>
                  </Section>
                )}

                {data.packageExcludes && (
                  <Section icon={AlertCircle} title="Not Included" accent="text-slate-400">
                    <div className={`${card} p-4`}>
                      <p className="text-sm text-slate-300 whitespace-pre-line leading-relaxed">{data.packageExcludes}</p>
                    </div>
                  </Section>
                )}

                {data.importantNotes && (
                  <Section icon={AlertCircle} title="Important Notes" emoji="📌" accent="text-amber-300">
                    <div className={`${card} p-4 border-amber-400/20 bg-amber-500/[0.06]`}>
                      <p className="text-sm text-amber-100/90 whitespace-pre-line leading-relaxed">{data.importantNotes}</p>
                    </div>
                  </Section>
                )}

                {/* Payments summary */}
                {data.payments.length > 0 && (
                  <Section icon={CreditCard} title="Payments" emoji="💳" accent={theme.accentText}>
                    <div className="grid grid-cols-2 gap-2 mb-3">
                      <div className={`${card} p-4 text-center`}>
                        <p className="text-[11px] text-slate-400 mb-1">Confirmed paid</p>
                        <p className="text-xl font-black text-emerald-400">{money(totalPaid)}</p>
                      </div>
                      <div className={`${card} p-4 text-center`}>
                        <p className="text-[11px] text-slate-400 mb-1">Transactions</p>
                        <p className="text-xl font-black">{data.payments.length}</p>
                      </div>
                    </div>
                    <div className="space-y-2">
                      {data.payments.map(p => (
                        <div key={p.id} className={`${card} p-3.5 flex items-center justify-between gap-3`}>
                          <div className="min-w-0">
                            <p className="font-semibold text-sm truncate">{p.label ?? p.type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}</p>
                            <div className="flex items-center gap-2 mt-1 flex-wrap">
                              <span className={`text-[10px] px-2 py-0.5 rounded-full border font-semibold ${STATUS_COLOR[p.status] ?? 'bg-slate-700/50 text-slate-300 border-slate-600'}`}>{p.status}</span>
                              {p.method && <span className="text-[11px] text-slate-500">{p.method}</span>}
                            </div>
                          </div>
                          <div className="text-right flex-shrink-0">
                            <p className="font-bold text-sm">{money(Number(p.amount), p.currency)}</p>
                            {p.paidAt && <p className="text-[11px] text-slate-500">{format(new Date(p.paidAt), 'dd MMM')}</p>}
                          </div>
                        </div>
                      ))}
                    </div>
                  </Section>
                )}
              </>
            )}

            {/* ── ITINERARY ── */}
            {tab === 'itinerary' && (
              <ItineraryView data={data} theme={theme} />
            )}

            {/* ── STAYS ── */}
            {tab === 'stays' && (
              <>
                {data.accommodations.length === 0 ? (
                  <Empty emoji="🏨" text="No accommodation added yet" sub="Your hotels will appear here once confirmed" />
                ) : (
                  <Section icon={Hotel} title="Your Hotels" emoji="🏨" accent={theme.accentText}>
                    <div className="space-y-3">
                      {data.accommodations.map((a, i) => (
                        <motion.div key={a.id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06 }} className={`${card} overflow-hidden`}>
                          <div className={`h-20 bg-gradient-to-br ${theme.from} ${theme.to} relative flex items-end p-3`}>
                            <div className="absolute inset-0 bg-black/20" />
                            <span className="absolute top-2 right-3 text-3xl opacity-60">🏨</span>
                            <div className="relative">
                              <p className="text-[11px] text-white/80 font-medium">📍 {a.city}</p>
                              <p className="font-black text-white leading-tight">{a.hotel}</p>
                            </div>
                          </div>
                          <div className="p-4">
                            <div className="flex items-center gap-2 text-xs text-slate-300 flex-wrap">
                              <span className="flex items-center gap-1"><Calendar className="w-3 h-3" />{format(new Date(a.checkIn), 'dd MMM')} → {format(new Date(a.checkOut), 'dd MMM')}</span>
                              <span className="text-slate-600">·</span>
                              <span className={`font-semibold ${theme.accentText}`}>{a.nights} night{a.nights !== 1 ? 's' : ''}</span>
                            </div>
                            <div className="flex items-center gap-2 mt-2 flex-wrap">
                              {a.roomType && <span className="text-[11px] px-2 py-0.5 rounded-full bg-white/5 border border-white/10 text-slate-300">🛏️ {a.roomType}</span>}
                              {a.mealType && <span className="text-[11px] px-2 py-0.5 rounded-full bg-white/5 border border-white/10 text-slate-300">🍽️ {a.mealType}</span>}
                            </div>
                            {a.address && <p className="text-xs text-slate-400 mt-2.5 flex items-start gap-1.5"><MapPin className="w-3 h-3 mt-0.5 flex-shrink-0" />{a.address}</p>}
                            {a.contact && (
                              <a href={`tel:${a.contact}`} className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-cyan-300 bg-cyan-500/10 border border-cyan-400/25 px-3 py-1.5 rounded-lg">
                                <Phone className="w-3 h-3" /> Call hotel
                              </a>
                            )}
                          </div>
                        </motion.div>
                      ))}
                    </div>
                  </Section>
                )}
              </>
            )}

            {/* ── TRAVEL (flights + tickets) ── */}
            {tab === 'travel' && (
              <>
                {data.flights.length > 0 && (
                  <Section icon={Plane} title="Flights" emoji="✈️" accent={theme.accentText}>
                    <div className="space-y-3">
                      {data.flights.map((f, i) => (
                        <motion.div key={f.id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06 }} className={`${card} p-4`}>
                          <div className="flex items-center justify-between mb-3">
                            <span className={`font-mono font-bold ${theme.accentText}`}>{f.flightNo}</span>
                            {f.airline && <span className="text-xs text-slate-400">{f.airline}</span>}
                            <span className="text-xs text-slate-500">{format(new Date(f.date), 'dd MMM yyyy')}</span>
                          </div>
                          <div className="flex items-center gap-3">
                            <div className="text-center">
                              <p className="text-2xl font-black">{f.fromApt}</p>
                              <p className="text-xs text-slate-400">{f.depTime}</p>
                            </div>
                            <div className="flex-1 flex items-center gap-1 relative">
                              <div className="h-px flex-1 bg-white/20" />
                              <motion.div animate={{ x: [-4, 4, -4] }} transition={{ repeat: Infinity, duration: 2.5 }}><Plane className="w-4 h-4 text-slate-400 rotate-90" /></motion.div>
                              <div className="h-px flex-1 bg-white/20" />
                            </div>
                            <div className="text-center">
                              <p className="text-2xl font-black">{f.toApt}</p>
                              <p className="text-xs text-slate-400">{f.arrTime}</p>
                            </div>
                          </div>
                        </motion.div>
                      ))}
                    </div>
                  </Section>
                )}

                {data.tickets.length > 0 && (
                  <Section icon={TicketIcon} title="Tickets & Vouchers" emoji="🎫" accent={theme.accentText}>
                    <div className="space-y-2">
                      {data.tickets.map(t => (
                        <div key={t.id} className={`${card} p-3.5 flex items-center gap-3`}>
                          <div className={`w-10 h-10 rounded-xl ${theme.accentBg} flex items-center justify-center flex-shrink-0`}>
                            <TicketIcon className={`w-5 h-5 ${theme.accentText}`} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="font-semibold text-sm truncate">{t.type.replace(/_/g, ' ')}{t.qty > 1 ? ` ×${t.qty}` : ''}</p>
                            <p className="text-xs text-slate-400 truncate">
                              {[t.supplier, t.agendaItem ? `${t.agendaItem.location}` : null].filter(Boolean).join(' · ') || t.reference || 'Confirmed'}
                            </p>
                          </div>
                          {t.fileUrl && (
                            <a href={t.fileUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-500/15 border border-emerald-400/25 text-emerald-300 text-xs font-semibold flex-shrink-0">
                              <Download className="w-3.5 h-3.5" /> Open
                            </a>
                          )}
                        </div>
                      ))}
                    </div>
                  </Section>
                )}

                {data.flights.length === 0 && data.tickets.length === 0 && (
                  <Empty emoji="✈️" text="No flights or tickets yet" sub="They'll show up here as your trip is finalised" />
                )}
              </>
            )}

            {/* ── HELP ── */}
            {tab === 'help' && (
              <>
                <div className={`p-4 mb-5 rounded-2xl bg-gradient-to-r ${theme.from} ${theme.to} bg-opacity-10`}>
                  <p className="text-sm font-bold text-white flex items-center gap-2">Need a hand? <Sparkles className="w-4 h-4" /></p>
                  <p className="text-xs text-white/85 mt-1">Your travel team is here for you throughout the trip. Reach out anytime.</p>
                </div>

                {drivers.length > 0 && (
                  <Section icon={Car} title="Your Drivers" emoji="🚗" accent={theme.accentText}>
                    <div className="space-y-2">
                      {drivers.map(item => (
                        <div key={item.id} className={`${card} flex items-center gap-3 p-3.5`}>
                          <div className="w-11 h-11 rounded-full bg-blue-500/15 border border-blue-400/25 flex items-center justify-center flex-shrink-0">
                            <Car className="w-5 h-5 text-blue-300" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="font-semibold text-sm truncate">{item.assignment!.driverName}</p>
                            <p className="text-xs text-slate-400 truncate">
                              {item.location} · {format(new Date(item.date), 'dd MMM')}
                              {item.assignment!.vehiclePlate && ` · ${item.assignment!.vehiclePlate}`}
                            </p>
                          </div>
                          {item.assignment!.driverPhone && (
                            <a href={`tel:${item.assignment!.driverPhone}`} className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-emerald-500/15 border border-emerald-400/25 text-emerald-300 text-xs font-semibold flex-shrink-0">
                              <Phone className="w-3.5 h-3.5" /> Call
                            </a>
                          )}
                        </div>
                      ))}
                    </div>
                  </Section>
                )}

                {data.emergencyContacts.length > 0 && (
                  <Section icon={ShieldAlert} title="Emergency Contacts" emoji="🆘" accent="text-rose-300">
                    <div className="space-y-2">
                      {data.emergencyContacts.map(c => (
                        <div key={c.id} className={`${card} flex items-center gap-3 p-3.5 border-rose-400/15`}>
                          <div className="w-10 h-10 rounded-full bg-rose-500/15 flex items-center justify-center flex-shrink-0">
                            <ShieldAlert className="w-5 h-5 text-rose-300" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="font-semibold text-sm truncate">{c.name}</p>
                            {c.role && <p className="text-xs text-slate-400">{c.role}</p>}
                          </div>
                          {c.phone && (
                            <a href={`tel:${c.phone}`} className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-rose-500/15 border border-rose-400/25 text-rose-200 text-xs font-semibold flex-shrink-0">
                              <Phone className="w-3.5 h-3.5" /> Call
                            </a>
                          )}
                        </div>
                      ))}
                    </div>
                  </Section>
                )}

                <Section icon={Globe2} title="Local Emergency Numbers" emoji="📞" accent="text-slate-300">
                  <div className={`${card} p-4 space-y-2 text-xs text-slate-300`}>
                    <EmergencyLine dot="bg-rose-400" label={`${theme.name} Emergency`} value={data.operationCountry === 'SRILANKA' ? '119 / 110' : data.operationCountry === 'VIETNAM' ? '113 / 114 / 115' : '999 / 995'} />
                    <EmergencyLine dot="bg-blue-400" label="Tourist Police" value={data.operationCountry === 'SRILANKA' ? '+94 11 242 1052' : data.operationCountry === 'VIETNAM' ? '+84 28 3822 6228' : '+65 6255 0000'} />
                  </div>
                </Section>

                {data.tips && (
                  <Section icon={Sparkles} title="Travel Tips" emoji="💡" accent={theme.accentText}>
                    <div className={`${card} p-4`}>
                      <p className="text-sm text-slate-200 whitespace-pre-line leading-relaxed">{data.tips}</p>
                    </div>
                  </Section>
                )}

                <div className="text-center py-8">
                  <p className="text-3xl mb-2">{theme.flag}</p>
                  <p className="text-xs text-slate-500">Booking <span className="font-mono text-slate-400">{data.bookingRef}</span></p>
                  <p className="text-[11px] text-slate-600 mt-1">Powered by AppleHolidays · Updates in real time</p>
                </div>
              </>
            )}

          </motion.div>
        </AnimatePresence>
      </div>

      {/* ─── Bottom tab bar ─── */}
      <div className="fixed bottom-0 inset-x-0 z-40">
        <div className="max-w-2xl mx-auto px-3 pb-3">
          <div className="flex items-center justify-around bg-slate-900/90 backdrop-blur-xl border border-white/10 rounded-2xl px-1 py-1.5 shadow-2xl shadow-black/50">
            {TABS.map(t => {
              const active = tab === t.key
              return (
                <button key={t.key} onClick={() => setTab(t.key)} className="relative flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-xl transition-colors">
                  {active && <motion.div layoutId="tabpill" className={`absolute inset-0 ${theme.accentBg} rounded-xl`} transition={{ type: 'spring', stiffness: 400, damping: 30 }} />}
                  <span className="relative">
                    <t.icon className={`w-5 h-5 transition-colors ${active ? theme.accentText : 'text-slate-500'}`} />
                    {t.badge ? <span className="absolute -top-1.5 -right-2 w-4 h-4 rounded-full bg-amber-500 text-[9px] font-bold flex items-center justify-center text-white">{t.badge}</span> : null}
                  </span>
                  <span className={`relative text-[10px] font-semibold transition-colors ${active ? 'text-white' : 'text-slate-500'}`}>{t.label}</span>
                </button>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Itinerary timeline ─────────────────────────────────────────────────────
function ItineraryView({ data, theme }: { data: PortalData; theme: (typeof THEME)[string] }) {
  const agendaItems = data.agenda?.items ?? []
  const useAgenda = agendaItems.length > 0

  if (!useAgenda && data.itinerary.length === 0) {
    return <Empty emoji="🗺️" text="Itinerary coming soon" sub="Your day-by-day plan will appear here once confirmed" />
  }

  return (
    <Section icon={MapPin} title="Day by Day" emoji="🗺️" accent={theme.accentText}>
      <div className="relative pl-2">
        <div className="absolute left-[22px] top-3 bottom-3 w-0.5 bg-gradient-to-b from-white/25 via-white/10 to-transparent" />
        <div className="space-y-3">
          {useAgenda
            ? agendaItems.map((item, i) => (
              <motion.div key={item.id} initial={{ opacity: 0, x: -12 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }} transition={{ delay: 0.03 * i }} className="flex gap-3">
                <div className={`relative z-10 flex-shrink-0 w-9 h-9 rounded-full ${theme.accentBg} ${theme.accentBorder} border flex items-center justify-center`}>
                  <span className={`text-xs font-black ${theme.accentText}`}>{i + 1}</span>
                </div>
                <div className={`${card} flex-1 min-w-0 p-4`}>
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <div className="min-w-0">
                      <p className="font-bold text-sm">{item.location}</p>
                      <p className="text-xs text-slate-400">{format(new Date(item.date), 'EEEE, dd MMM')}</p>
                    </div>
                    {item.mealPlan && <span className="text-[10px] bg-amber-500/15 text-amber-300 px-2 py-0.5 rounded-full font-semibold border border-amber-400/25 flex-shrink-0">🍽️ {item.mealPlan}</span>}
                  </div>
                  {(item.fromPoint || item.toPoint) && (
                    <div className="flex items-center gap-1.5 text-xs text-slate-300 my-2">
                      {item.fromPoint && <span className="text-slate-400">{item.fromPoint}</span>}
                      {item.fromPoint && <ChevronRight className="w-3 h-3 text-slate-600" />}
                      {item.toPoint && <span>{item.toPoint}</span>}
                    </div>
                  )}
                  {item.details && <p className="text-xs text-slate-400 leading-relaxed my-2 whitespace-pre-line">{item.details}</p>}
                  {(item.meetingTime || item.timeFrom) && (
                    <div className={`flex items-center gap-1.5 text-xs ${theme.accentText} font-medium`}>
                      <Clock className="w-3 h-3" /> {item.meetingTime ? `Meet at ${item.meetingTime}` : `${item.timeFrom}${item.timeTo ? ` – ${item.timeTo}` : ''}`}
                    </div>
                  )}
                  {item.assignment?.driverName && (
                    <div className="mt-3 flex items-center gap-3 bg-blue-500/[0.08] border border-blue-400/20 rounded-xl p-3">
                      <Car className="w-4 h-4 text-blue-300 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-blue-200 truncate">{item.assignment.driverName}</p>
                        <p className="text-[11px] text-slate-400 truncate">{[item.assignment.vehicleType, item.assignment.vehiclePlate].filter(Boolean).join(' · ')}</p>
                      </div>
                      {item.assignment.driverPhone && (
                        <a href={`tel:${item.assignment.driverPhone}`} className="w-8 h-8 rounded-lg bg-emerald-500/15 border border-emerald-400/25 flex items-center justify-center flex-shrink-0">
                          <Phone className="w-3.5 h-3.5 text-emerald-300" />
                        </a>
                      )}
                    </div>
                  )}
                </div>
              </motion.div>
            ))
            : data.itinerary.map((item, i) => (
              <motion.div key={item.id} initial={{ opacity: 0, x: -12 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }} transition={{ delay: 0.03 * i }} className="flex gap-3">
                <div className={`relative z-10 flex-shrink-0 w-9 h-9 rounded-full ${theme.accentBg} ${theme.accentBorder} border flex items-center justify-center`}>
                  <span className={`text-xs font-black ${theme.accentText}`}>{item.dayNo}</span>
                </div>
                <div className={`${card} flex-1 min-w-0 p-4`}>
                  <p className="font-bold text-sm">{item.title}</p>
                  <p className="text-xs text-slate-400">{format(new Date(item.date), 'EEEE, dd MMM')}</p>
                  {item.description && <p className="text-xs text-slate-400 leading-relaxed mt-2 whitespace-pre-line">{item.description}</p>}
                  {item.inclusions && <p className="text-xs text-emerald-300/90 mt-2">✅ {item.inclusions}</p>}
                </div>
              </motion.div>
            ))}
        </div>
      </div>
    </Section>
  )
}

function Empty({ emoji, text, sub }: { emoji: string; text: string; sub: string }) {
  return (
    <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="text-center py-16">
      <div className="text-5xl mb-3">{emoji}</div>
      <p className="text-slate-300 font-semibold">{text}</p>
      <p className="text-slate-500 text-xs mt-1">{sub}</p>
    </motion.div>
  )
}

function EmergencyLine({ dot, label, value }: { dot: string; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className={`w-1.5 h-1.5 rounded-full ${dot} flex-shrink-0`} />
      {label}: <span className="text-white font-mono ml-auto">{value}</span>
    </div>
  )
}
