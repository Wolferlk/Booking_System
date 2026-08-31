'use client'

/**
 * Driver Brief — the booking, read to a driver one screen at a time.
 *
 * This is a *presenter*, not a panel. It is opened with a driver already on the
 * phone, so every design decision here serves being read aloud rather than
 * being scanned: one idea per screen, the phone number set in a size legible
 * from arm's length across a desk, and a running order fixed to the shape of
 * that conversation — who you are driving with, who the guests are, when they
 * land, where they sleep, where you take them, what is already paid for.
 *
 * The motion is not decoration. Slides carry direction so the officer never
 * loses their place mid-sentence, the progress rail says how much of the call
 * is left, and each slide's contents stagger in so the eye lands on the first
 * line before the rest arrives — read-aloud pacing, not a reveal effect.
 *
 * Money appears nowhere by construction: the payload this renders excludes
 * rates, advances and P&L, because a driver can see this screen.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { toast } from 'sonner'
import {
  X, ChevronLeft, ChevronRight, Phone, Copy, Check, CarFront, User, Users,
  Plane, PlaneTakeoff, PlaneLanding, BedDouble, MapPin, Ticket, StickyNote,
  Sparkles, Loader2, AlertTriangle, CalendarDays, Clock, Utensils,
  BadgeCheck, ShieldQuestion, RefreshCw, Route, MessageSquareQuote,
  CircleCheck, CircleDashed, Coffee, Baby, ArrowRight,
} from 'lucide-react'
import JourneyMap from '@/components/bookings/journey-map'
import { cn, formatDate, readApiResponse } from '@/lib/utils'

// ─── Types (mirror src/lib/driver-brief.ts) ──────────────────────────────

type SlideId = 'driver' | 'overview' | 'flights' | 'hotels' | 'movements' | 'tickets' | 'notes'

interface BriefVehicle {
  type: string; plateNo: string; brand: string | null; model: string | null
  capacity: number | null; photoInside: string | null; photoOutside: string | null
}
interface BriefDriver {
  id: string | null; name: string; phone: string | null; photoUrl: string | null
  email: string | null; licenseNo: string | null; isActive: boolean; country: string | null
  vehicle: BriefVehicle | null; vendorName: string | null; vendorPhone: string | null
  role: 'primary' | 'movement'; dates: string[]; movementCount: number
  vehiclePlate: string | null; vehicleType: string | null
}
interface BriefFlight {
  id: string; flightNo: string; date: string; airline: string | null
  fromApt: string; depTime: string; toApt: string; arrTime: string
  notes: string | null; kind: 'arrival' | 'departure' | 'internal'
}
interface BriefHotel {
  id: string; hotel: string; city: string; checkIn: string; checkOut: string
  nights: number; roomType: string | null; mealType: string | null
  address: string | null; contact: string | null; ownArrangement: boolean
}
interface BriefMovement {
  id: string; date: string; dayNo: number; location: string
  fromPoint: string | null; toPoint: string | null; details: string | null
  serviceType: string; serviceLabel: string; timeFrom: string | null; timeTo: string | null
  meetingTime: string | null; mealPlan: string | null; noDriverNeeded: boolean
  driverName: string | null; driverPhone: string | null
  guideName: string | null; guidePhone: string | null
  notes: string | null; ticketCount: number
}
interface BriefTicket {
  id: string; type: string; category: string | null; qty: number; status: string
  activated: boolean; supplier: string | null; reference: string | null
  notes: string | null; date: string | null; location: string | null
}
interface BriefPassenger {
  name: string; type: string; isLead: boolean; contact: string | null
  passportNo: string | null; nationality: string | null
}
interface BriefAi {
  headline: string
  sections: { slide: SlideId; points: string[] }[]
  watchOuts: string[]
  questions: string[]
  generatedAt: string
}
interface BriefRecord {
  status: 'pending' | 'in_progress' | 'completed'
  notes: string
  slidesSeen: Record<string, boolean>
  startedAt: string | null
  completedAt: string | null
  briefedByName: string | null
  driverName: string | null
}
export interface DriverBriefPayload {
  bookingRef: string; isNumber: string | null; cntlNumber: string | null
  agent: string | null; fileHandler: string | null; status: string
  country: string | null; tourDestination: string | null
  arrivalDate: string; departureDate: string; nights: number; daysToArrival: number
  paxAdults: number; paxChildren: number
  contactPhone: string | null; contactEmail: string | null
  importantNotes: string | null; hotelOnly: boolean
  passengers: BriefPassenger[]; leadName: string | null
  drivers: BriefDriver[]; primaryDriver: BriefDriver | null
  flights: BriefFlight[]; hotels: BriefHotel[]
  movements: BriefMovement[]; tickets: BriefTicket[]
  unassignedDates: string[]
  brief: BriefRecord
  ai: BriefAi | null
}

// ─── Slide catalogue ─────────────────────────────────────────────────────

interface SlideMeta {
  id: SlideId
  label: string
  icon: React.FC<{ className?: string }>
  /** Accent colour, as raw hex so it works in gradients and in Leaflet HTML. */
  hex: string
  /** Hidden when the booking carries nothing for it — never show an empty screen. */
  applies: (p: DriverBriefPayload) => boolean
}

const SLIDES: SlideMeta[] = [
  { id: 'driver',    label: 'Your Driver',   icon: CarFront,  hex: '#10b981', applies: () => true },
  { id: 'overview',  label: 'The Guests',    icon: Users,     hex: '#6366f1', applies: () => true },
  { id: 'flights',   label: 'Flights',       icon: Plane,     hex: '#8b5cf6', applies: p => p.flights.length > 0 },
  { id: 'hotels',    label: 'Hotels',        icon: BedDouble, hex: '#f97316', applies: p => p.hotels.length > 0 },
  { id: 'movements', label: 'The Route',     icon: Route,     hex: '#06b6d4', applies: p => p.movements.length > 0 },
  { id: 'tickets',   label: 'Tickets',       icon: Ticket,    hex: '#eab308', applies: p => p.tickets.length > 0 },
  { id: 'notes',     label: 'Sign Off',      icon: StickyNote, hex: '#22c55e', applies: () => true },
]

// ─── Small helpers ───────────────────────────────────────────────────────

const d = (v: string | null | undefined) => (v ? formatDate(v, 'EEE dd MMM') : '—')
const dLong = (v: string | null | undefined) => (v ? formatDate(v, 'EEE dd MMM yyyy') : '—')

/** Digits only, "+" preserved — what `tel:` wants and what a human dials. */
function telHref(phone: string) {
  return `tel:${phone.replace(/[^\d+]/g, '')}`
}

/** "0771234567" → "077 123 4567". Grouped so it can be read out loud. */
function spacedPhone(phone: string) {
  const clean = phone.replace(/\s+/g, '')
  const m = clean.match(/^(\+?\d{1,3})?(\d{2,3})(\d{3})(\d{3,4})$/)
  return m ? [m[1], m[2], m[3], m[4]].filter(Boolean).join(' ') : clean
}

function initials(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase()
}

// ─── Motion presets ──────────────────────────────────────────────────────

const SLIDE_VARIANTS = {
  enter: (dir: number) => ({ opacity: 0, x: dir > 0 ? 60 : -60, scale: 0.985 }),
  center: { opacity: 1, x: 0, scale: 1 },
  exit:   (dir: number) => ({ opacity: 0, x: dir > 0 ? -60 : 60, scale: 0.985 }),
}

/** Children stagger in top-to-bottom, at reading pace rather than UI pace. */
const LIST = { show: { transition: { staggerChildren: 0.06, delayChildren: 0.08 } } }
const ITEM = {
  hidden: { opacity: 0, y: 14 },
  show:   { opacity: 1, y: 0, transition: { type: 'spring' as const, stiffness: 320, damping: 30 } },
}

// ─── Shared chrome ───────────────────────────────────────────────────────

function SlideShell({
  meta, kicker, title, subtitle, children,
}: {
  meta: SlideMeta
  kicker?: string
  title: string
  subtitle?: React.ReactNode
  children: React.ReactNode
}) {
  const Icon = meta.icon
  return (
    <div className="h-full flex flex-col min-h-0">
      <motion.div
        initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
        className="flex items-center gap-3 px-6 md:px-10 pt-6 pb-4 flex-shrink-0"
      >
        <span
          className="w-11 h-11 rounded-2xl grid place-items-center flex-shrink-0 border"
          style={{ background: `${meta.hex}1f`, borderColor: `${meta.hex}44`, color: meta.hex }}
        >
          <Icon className="w-5 h-5" />
        </span>
        <div className="min-w-0">
          {kicker && (
            <p className="text-[10px] font-black tracking-[0.18em] uppercase" style={{ color: meta.hex }}>
              {kicker}
            </p>
          )}
          <h2 className="text-xl md:text-2xl font-black text-white truncate">{title}</h2>
          {subtitle && <div className="text-slate-400 text-xs mt-0.5">{subtitle}</div>}
        </div>
      </motion.div>
      <div className="flex-1 min-h-0 overflow-y-auto px-6 md:px-10 pb-8 brief-scroll">
        {children}
      </div>
    </div>
  )
}

/**
 * The spoken half of the slide.
 *
 * Deliberately styled as speech rather than as a note: the officer reads these
 * lines out, so they sit in a quote block in the accent colour and nothing else
 * on the screen competes with them.
 */
function SayThis({ points, hex, loading }: { points: string[]; hex: string; loading?: boolean }) {
  if (loading) {
    return (
      <div className="rounded-2xl border border-slate-700/50 bg-slate-900/50 p-4 flex items-center gap-2.5 text-slate-400 text-xs">
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
        Writing what to say…
      </div>
    )
  }
  if (!points.length) return null
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}
      className="rounded-2xl border p-4 md:p-5"
      style={{ background: `${hex}0f`, borderColor: `${hex}33` }}
    >
      <p className="flex items-center gap-1.5 text-[10px] font-black tracking-[0.16em] uppercase mb-3" style={{ color: hex }}>
        <MessageSquareQuote className="w-3.5 h-3.5" /> Say this
      </p>
      <motion.ul variants={LIST} initial="hidden" animate="show" className="space-y-2.5">
        {points.map((pt, i) => (
          <motion.li key={i} variants={ITEM} className="flex gap-2.5 text-sm text-slate-100 leading-relaxed">
            <span className="mt-[7px] w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: hex }} />
            <span>{pt}</span>
          </motion.li>
        ))}
      </motion.ul>
    </motion.div>
  )
}

function Field({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div>
      <p className="text-[10px] font-bold tracking-wider uppercase text-slate-500">{label}</p>
      <p className={cn('text-sm text-slate-100 font-semibold mt-0.5', mono && 'font-mono')}>{value || '—'}</p>
    </div>
  )
}

function Chip({ children, hex }: { children: React.ReactNode; hex: string }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-bold border"
      style={{ background: `${hex}1a`, borderColor: `${hex}3d`, color: hex }}
    >
      {children}
    </span>
  )
}

// ─── Slide 1 · The driver ────────────────────────────────────────────────

/**
 * The screen the call opens on.
 *
 * Everything here is sized for the one thing that happens next: somebody picks
 * up a handset and dials. The number is the largest element on the page, spaced
 * into readable groups, and the instruction under it is written as the sentence
 * the officer says out loud — not as a UI label — because that sentence *is* the
 * step. The photo is large for the same reason a photo is on a driver's licence:
 * the desk is about to talk about a person, and half of them have similar names.
 */
function DriverSlide({ p, meta, ai, aiLoading }: {
  p: DriverBriefPayload; meta: SlideMeta; ai: string[]; aiLoading: boolean
}) {
  const [copied, setCopied] = useState(false)
  const driver = p.primaryDriver
  const others = p.drivers.filter(x => x !== driver)
  const reduce = useReducedMotion()

  const copy = useCallback(async (v: string) => {
    try {
      await navigator.clipboard.writeText(v)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch { toast.error('Could not copy') }
  }, [])

  if (!driver) {
    return (
      <SlideShell meta={meta} kicker="Step 1 of the brief" title="No driver allocated yet">
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-6 text-center">
          <AlertTriangle className="w-10 h-10 text-amber-400 mx-auto mb-3" />
          <p className="text-amber-200 font-bold">This file has nobody to brief.</p>
          <p className="text-amber-200/70 text-sm mt-1.5 max-w-md mx-auto">
            {p.hotelOnly
              ? 'It is a Hotel Only booking — accommodation only, so no transport is sold and no driver is required.'
              : 'Allocate a driver on the Sri Lanka allocation board or the movement chart, then reopen this brief.'}
          </p>
        </div>
      </SlideShell>
    )
  }

  const vehicleLine = driver.vehicle
    ? [driver.vehicle.brand, driver.vehicle.model].filter(Boolean).join(' ') || driver.vehicle.type
    : driver.vehicleType
  const plate = driver.vehicle?.plateNo ?? driver.vehiclePlate

  return (
    <SlideShell
      meta={meta}
      kicker="Step 1 of the brief"
      title="Your driver on this file"
      subtitle={<>Confirm you have the right person before you say anything else.</>}
    >
      <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] gap-6 items-start">
        {/* ── Identity card ───────────────────────────────────────────── */}
        <motion.div
          variants={LIST} initial="hidden" animate="show"
          className="relative rounded-3xl border border-emerald-500/25 bg-gradient-to-b from-emerald-500/[0.12] via-slate-900/60 to-slate-900/80 p-6 md:p-8 overflow-hidden"
        >
          {/* Slow halo behind the portrait — the only ambient motion on the deck,
              and it stops entirely for reduced-motion viewers. */}
          {!reduce && (
            <motion.div
              aria-hidden
              className="absolute -top-24 -right-16 w-64 h-64 rounded-full blur-3xl"
              style={{ background: 'radial-gradient(circle, rgba(16,185,129,0.28), transparent 70%)' }}
              animate={{ scale: [1, 1.15, 1], opacity: [0.55, 0.85, 0.55] }}
              transition={{ duration: 7, repeat: Infinity, ease: 'easeInOut' }}
            />
          )}

          <div className="relative flex flex-col items-center text-center">
            <motion.div
              variants={ITEM}
              className="relative mb-5"
            >
              {!reduce && (
                <motion.span
                  aria-hidden
                  className="absolute inset-0 rounded-full border-2 border-emerald-400/40"
                  animate={{ scale: [1, 1.18], opacity: [0.6, 0] }}
                  transition={{ duration: 2.4, repeat: Infinity, ease: 'easeOut' }}
                />
              )}
              <div className="w-40 h-40 md:w-48 md:h-48 rounded-full overflow-hidden border-4 border-emerald-400/60 shadow-[0_0_60px_-12px_rgba(16,185,129,0.8)] bg-slate-800 grid place-items-center">
                {driver.photoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={driver.photoUrl} alt={driver.name} className="w-full h-full object-cover" />
                ) : (
                  <span className="text-5xl font-black text-emerald-300/80">{initials(driver.name)}</span>
                )}
              </div>
              <span className={cn(
                'absolute bottom-2 right-2 px-2 py-0.5 rounded-full text-[10px] font-black border backdrop-blur',
                driver.isActive
                  ? 'bg-emerald-500/25 border-emerald-400/50 text-emerald-200'
                  : 'bg-red-500/25 border-red-400/50 text-red-200',
              )}>
                {driver.isActive ? 'ACTIVE' : 'INACTIVE'}
              </span>
            </motion.div>

            <motion.h3 variants={ITEM} className="text-3xl md:text-5xl font-black text-white leading-tight tracking-tight">
              {driver.name}
            </motion.h3>

            {driver.phone && (
              <motion.a
                variants={ITEM}
                href={telHref(driver.phone)}
                className="mt-2 block text-2xl md:text-4xl font-black font-mono text-emerald-300 hover:text-emerald-200 transition-colors tracking-wider"
              >
                {spacedPhone(driver.phone)}
              </motion.a>
            )}

            <motion.div variants={ITEM} className="flex flex-wrap justify-center gap-2 mt-4">
              <Chip hex="#10b981">
                {driver.role === 'primary' ? <BadgeCheck className="w-3 h-3" /> : <Route className="w-3 h-3" />}
                {driver.role === 'primary' ? 'Allocated driver' : 'Movement chart driver'}
              </Chip>
              {vehicleLine && <Chip hex="#38bdf8"><CarFront className="w-3 h-3" />{vehicleLine}</Chip>}
              {plate && <Chip hex="#a78bfa">{plate}</Chip>}
              {driver.vehicle?.capacity ? <Chip hex="#f472b6"><Users className="w-3 h-3" />{driver.vehicle.capacity} seats</Chip> : null}
              {driver.movementCount > 0 && (
                <Chip hex="#facc15"><CalendarDays className="w-3 h-3" />{driver.movementCount} movement{driver.movementCount === 1 ? '' : 's'}</Chip>
              )}
            </motion.div>

            <motion.div variants={ITEM} className="grid grid-cols-2 gap-4 w-full mt-6 pt-6 border-t border-slate-700/50 text-left">
              <Field label="Licence No" value={driver.licenseNo} mono />
              <Field label="Vendor" value={driver.vendorName} />
              <Field label="Email" value={driver.email} />
              <Field label="Covers" value={
                driver.dates.length
                  ? `${d(driver.dates[0])} → ${d(driver.dates[driver.dates.length - 1])}`
                  : 'Whole file'
              } />
            </motion.div>
          </div>
        </motion.div>

        {/* ── The instruction ─────────────────────────────────────────── */}
        <div className="space-y-4">
          {driver.phone && (
            <motion.div
              initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }}
              transition={{ type: 'spring', stiffness: 260, damping: 24 }}
              className="relative rounded-3xl border-2 border-emerald-400/40 bg-gradient-to-br from-emerald-500/20 to-emerald-600/5 p-6 md:p-7 overflow-hidden"
            >
              <div className="flex items-center gap-2 text-emerald-300 mb-3">
                {!reduce ? (
                  <motion.span
                    animate={{ rotate: [0, -14, 12, -8, 0] }}
                    transition={{ duration: 1.4, repeat: Infinity, repeatDelay: 2.6 }}
                    className="inline-flex"
                  ><Phone className="w-5 h-5" /></motion.span>
                ) : <Phone className="w-5 h-5" />}
                <span className="text-[10px] font-black tracking-[0.2em] uppercase">Do this now</span>
              </div>

              {/* The literal sentence the officer follows. Written as speech on
                  purpose — a label reading "Call driver" gets skimmed past. */}
              <p className="text-lg md:text-2xl font-bold text-white leading-snug">
                Get your phone and dial to{' '}
                <span className="text-emerald-300">{driver.name}</span>, phone number is{' '}
                <span className="font-mono text-emerald-300 whitespace-nowrap">{spacedPhone(driver.phone)}</span>.
              </p>

              <div className="flex flex-wrap gap-2.5 mt-5">
                <a
                  href={telHref(driver.phone)}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-emerald-950 font-black text-sm transition-colors"
                >
                  <Phone className="w-4 h-4" /> Dial {driver.name.split(' ')[0]}
                </a>
                <button
                  onClick={() => copy(driver.phone!)}
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-slate-600/60 text-slate-200 hover:bg-slate-800 font-bold text-sm transition-colors"
                >
                  {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                  {copied ? 'Copied' : 'Copy number'}
                </button>
                <a
                  href={`https://wa.me/${driver.phone.replace(/\D/g, '')}`}
                  target="_blank" rel="noreferrer"
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-green-600/50 text-green-300 hover:bg-green-600/10 font-bold text-sm transition-colors"
                >
                  WhatsApp
                </a>
              </div>
            </motion.div>
          )}

          <SayThis points={ai} hex={meta.hex} loading={aiLoading} />

          {/* ── Everybody else on the file ───────────────────────────── */}
          {others.length > 0 && (
            <motion.div
              variants={LIST} initial="hidden" animate="show"
              className="rounded-2xl border border-slate-700/50 bg-slate-900/50 p-5"
            >
              <p className="text-[10px] font-black tracking-[0.16em] uppercase text-slate-400 mb-3">
                Also driving this file — {others.length} other{others.length === 1 ? '' : 's'}
              </p>
              <div className="space-y-2.5">
                {others.map(o => (
                  <motion.div
                    key={`${o.id ?? o.name}-${o.phone ?? ''}`} variants={ITEM}
                    className="flex items-center gap-3 rounded-xl border border-slate-700/40 bg-slate-800/40 p-3"
                  >
                    <div className="w-11 h-11 rounded-full overflow-hidden bg-slate-700 grid place-items-center flex-shrink-0 border border-slate-600">
                      {o.photoUrl
                        // eslint-disable-next-line @next/next/no-img-element
                        ? <img src={o.photoUrl} alt={o.name} className="w-full h-full object-cover" />
                        : <span className="text-xs font-black text-slate-300">{initials(o.name)}</span>}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-bold text-white truncate">{o.name}</p>
                      <p className="text-[11px] text-slate-400 font-mono">{o.phone ? spacedPhone(o.phone) : 'no number on file'}</p>
                      {o.dates.length > 0 && (
                        <p className="text-[11px] text-slate-500 mt-0.5">
                          {o.dates.length === 1 ? d(o.dates[0]) : `${d(o.dates[0])} → ${d(o.dates[o.dates.length - 1])}`}
                          {' · '}{o.movementCount} movement{o.movementCount === 1 ? '' : 's'}
                          {o.vehiclePlate ? ` · ${o.vehiclePlate}` : ''}
                        </p>
                      )}
                    </div>
                    {o.phone && (
                      <a href={telHref(o.phone)} className="p-2 rounded-lg border border-slate-600/50 text-slate-300 hover:text-emerald-300 hover:border-emerald-500/40 transition-colors">
                        <Phone className="w-3.5 h-3.5" />
                      </a>
                    )}
                  </motion.div>
                ))}
              </div>
            </motion.div>
          )}
        </div>
      </div>
    </SlideShell>
  )
}

// ─── Slide 2 · The guests ────────────────────────────────────────────────

function OverviewSlide({ p, meta, ai, aiLoading }: {
  p: DriverBriefPayload; meta: SlideMeta; ai: string[]; aiLoading: boolean
}) {
  const pax = p.paxAdults + p.paxChildren
  return (
    <SlideShell
      meta={meta}
      kicker="Step 2 of the brief"
      title={p.leadName ? `${p.leadName} + party` : 'The guest party'}
      subtitle={<>{p.bookingRef}{p.isNumber ? ` · IS ${p.isNumber}` : ''}{p.agent ? ` · ${p.agent}` : ''}</>}
    >
      <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-6 items-start">
        <motion.div variants={LIST} initial="hidden" animate="show" className="space-y-4">
          {/* Headline numbers — the four facts a driver repeats back. */}
          <motion.div variants={ITEM} className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: 'Guests',  value: String(pax),            sub: `${p.paxAdults} adult${p.paxAdults === 1 ? '' : 's'}${p.paxChildren ? ` · ${p.paxChildren} child` : ''}`, hex: '#6366f1' },
              { label: 'Nights',  value: String(p.nights),        sub: `${p.movements.length} movements`, hex: '#06b6d4' },
              { label: 'Arrives', value: formatDate(p.arrivalDate, 'dd MMM'),   sub: formatDate(p.arrivalDate, 'EEEE'),   hex: '#22c55e' },
              { label: 'Departs', value: formatDate(p.departureDate, 'dd MMM'), sub: formatDate(p.departureDate, 'EEEE'), hex: '#f97316' },
            ].map(s => (
              <div key={s.label} className="rounded-2xl border p-4" style={{ background: `${s.hex}12`, borderColor: `${s.hex}30` }}>
                <p className="text-[10px] font-black tracking-wider uppercase" style={{ color: s.hex }}>{s.label}</p>
                <p className="text-2xl font-black text-white mt-1 leading-none">{s.value}</p>
                <p className="text-[11px] text-slate-400 mt-1">{s.sub}</p>
              </div>
            ))}
          </motion.div>

          {/* Named guests. A driver greeting the lead by name is the single
              cheapest thing that makes a file go well. */}
          <motion.div variants={ITEM} className="rounded-2xl border border-slate-700/50 bg-slate-900/50 p-5">
            <p className="text-[10px] font-black tracking-[0.16em] uppercase text-slate-400 mb-3">Who is travelling</p>
            <div className="grid sm:grid-cols-2 gap-2">
              {p.passengers.length === 0 && <p className="text-sm text-slate-500">No passenger names on file.</p>}
              {p.passengers.map((g, i) => (
                <div key={`${g.name}-${i}`} className="flex items-center gap-2.5 rounded-xl border border-slate-700/40 bg-slate-800/40 px-3 py-2">
                  <span className={cn('w-7 h-7 rounded-full grid place-items-center flex-shrink-0 text-[10px] font-black',
                    g.isLead ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/40' : 'bg-slate-700/60 text-slate-300')}>
                    {g.type === 'CHILD' || g.type === 'INFANT' ? <Baby className="w-3.5 h-3.5" /> : initials(g.name)}
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-white truncate">{g.name}</p>
                    <p className="text-[10px] text-slate-500">
                      {g.isLead ? 'Lead guest · ' : ''}{g.type.toLowerCase()}{g.nationality ? ` · ${g.nationality}` : ''}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </motion.div>

          <motion.div variants={ITEM} className="grid sm:grid-cols-2 gap-4 rounded-2xl border border-slate-700/50 bg-slate-900/50 p-5">
            <Field label="Guest contact" value={p.contactPhone} mono />
            <Field label="File handler" value={p.fileHandler} />
            <Field label="Destination" value={p.tourDestination} />
            <Field label="CNTL" value={p.cntlNumber} mono />
          </motion.div>
        </motion.div>

        <div className="space-y-4">
          <SayThis points={ai} hex={meta.hex} loading={aiLoading} />
          {p.importantNotes && (
            <motion.div
              initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}
              className="rounded-2xl border border-amber-500/30 bg-amber-500/[0.08] p-5"
            >
              <p className="flex items-center gap-1.5 text-[10px] font-black tracking-[0.16em] uppercase text-amber-300 mb-2">
                <AlertTriangle className="w-3.5 h-3.5" /> Important notes on the file
              </p>
              <p className="text-sm text-amber-100/90 whitespace-pre-wrap leading-relaxed">{p.importantNotes}</p>
            </motion.div>
          )}
        </div>
      </div>
    </SlideShell>
  )
}

// ─── Slide 3 · Flights ───────────────────────────────────────────────────

/**
 * Sectors drawn as a route rather than listed as rows.
 *
 * The driver's question about a flight is never "what is the flight number" —
 * it is "what time am I standing at arrivals". So each sector is drawn as a
 * departure, a line, and an arrival, with the two clock times as the largest
 * type on the card and an animated aircraft travelling the line so the
 * direction is unmistakable at a glance.
 */
function FlightsSlide({ p, meta, ai, aiLoading }: {
  p: DriverBriefPayload; meta: SlideMeta; ai: string[]; aiLoading: boolean
}) {
  const reduce = useReducedMotion()
  const KIND: Record<BriefFlight['kind'], { label: string; hex: string; icon: React.FC<{ className?: string }> }> = {
    arrival:   { label: 'Arrival — you meet this one', hex: '#22c55e', icon: PlaneLanding },
    departure: { label: 'Departure — you drop for this one', hex: '#f97316', icon: PlaneTakeoff },
    internal:  { label: 'Internal sector', hex: '#8b5cf6', icon: Plane },
  }

  return (
    <SlideShell
      meta={meta} kicker="Step 3 of the brief" title="Flights"
      subtitle={`${p.flights.length} sector${p.flights.length === 1 ? '' : 's'} on this file`}
    >
      <div className="grid lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] gap-6 items-start">
        <motion.div variants={LIST} initial="hidden" animate="show" className="space-y-3">
          {p.flights.map(f => {
            const k = KIND[f.kind]
            const KIcon = k.icon
            return (
              <motion.div
                key={f.id} variants={ITEM}
                className="rounded-2xl border p-5 relative overflow-hidden"
                style={{ background: `${k.hex}0d`, borderColor: `${k.hex}33` }}
              >
                <div className="flex items-center justify-between gap-3 mb-4">
                  <span className="inline-flex items-center gap-1.5 text-[10px] font-black tracking-wider uppercase" style={{ color: k.hex }}>
                    <KIcon className="w-3.5 h-3.5" /> {k.label}
                  </span>
                  <span className="text-[11px] text-slate-400 font-semibold">{dLong(f.date)}</span>
                </div>

                <div className="flex items-center gap-3">
                  <div className="text-left min-w-[68px]">
                    <p className="text-2xl md:text-3xl font-black text-white font-mono leading-none">{f.depTime || '--:--'}</p>
                    <p className="text-xs font-bold text-slate-300 mt-1">{f.fromApt}</p>
                  </div>

                  <div className="flex-1 relative h-8 flex items-center">
                    <div className="w-full h-px" style={{ background: `linear-gradient(90deg, ${k.hex}00, ${k.hex}99, ${k.hex}00)` }} />
                    {!reduce ? (
                      <motion.span
                        aria-hidden className="absolute" style={{ color: k.hex }}
                        animate={{ left: ['2%', '92%'], opacity: [0, 1, 1, 0] }}
                        transition={{ duration: 3.6, repeat: Infinity, ease: 'linear' }}
                      ><Plane className="w-4 h-4" /></motion.span>
                    ) : (
                      <Plane className="w-4 h-4 absolute left-1/2 -translate-x-1/2" style={{ color: k.hex }} />
                    )}
                  </div>

                  <div className="text-right min-w-[68px]">
                    <p className="text-2xl md:text-3xl font-black text-white font-mono leading-none">{f.arrTime || '--:--'}</p>
                    <p className="text-xs font-bold text-slate-300 mt-1">{f.toApt}</p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 mt-4 pt-4 border-t border-slate-700/40">
                  <Chip hex={k.hex}>{f.flightNo}</Chip>
                  {f.airline && <span className="text-[11px] text-slate-400">{f.airline}</span>}
                  {f.notes && <span className="text-[11px] text-slate-400 italic">· {f.notes}</span>}
                </div>
              </motion.div>
            )
          })}
        </motion.div>
        <SayThis points={ai} hex={meta.hex} loading={aiLoading} />
      </div>
    </SlideShell>
  )
}

// ─── Slide 4 · Hotels ────────────────────────────────────────────────────

function HotelsSlide({ p, meta, ai, aiLoading }: {
  p: DriverBriefPayload; meta: SlideMeta; ai: string[]; aiLoading: boolean
}) {
  return (
    <SlideShell
      meta={meta} kicker="Step 4 of the brief" title="Where they sleep"
      subtitle={`${p.hotels.length} stay${p.hotels.length === 1 ? '' : 's'} · ${p.nights} night${p.nights === 1 ? '' : 's'}`}
    >
      <div className="grid lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] gap-6 items-start">
        <motion.div variants={LIST} initial="hidden" animate="show" className="space-y-3">
          {p.hotels.map((h, i) => (
            <motion.div key={h.id} variants={ITEM} className="flex gap-4 rounded-2xl border border-orange-500/25 bg-orange-500/[0.07] p-5">
              {/* Night counter doubles as the stay's position in the trip. */}
              <div className="flex flex-col items-center flex-shrink-0">
                <span className="w-12 h-12 rounded-2xl bg-orange-500/20 border border-orange-500/40 grid place-items-center text-orange-300 font-black">
                  {i + 1}
                </span>
                <span className="text-[10px] font-bold text-orange-300/70 mt-1.5">{h.nights}N</span>
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-lg font-black text-white leading-tight">{h.hotel}</p>
                <p className="text-sm text-orange-200/80 font-semibold flex items-center gap-1 mt-0.5">
                  <MapPin className="w-3.5 h-3.5" /> {h.city}
                </p>
                <div className="flex flex-wrap gap-2 mt-3">
                  <Chip hex="#f97316"><CalendarDays className="w-3 h-3" />{d(h.checkIn)} → {d(h.checkOut)}</Chip>
                  {h.mealType && <Chip hex="#22c55e"><Utensils className="w-3 h-3" />{h.mealType}</Chip>}
                  {h.roomType && <Chip hex="#94a3b8"><BedDouble className="w-3 h-3" />{h.roomType}</Chip>}
                  {h.ownArrangement && <Chip hex="#eab308">Own arrangement</Chip>}
                </div>
                {(h.address || h.contact) && (
                  <p className="text-[11px] text-slate-400 mt-3 leading-relaxed">
                    {h.address}{h.address && h.contact ? ' · ' : ''}
                    {h.contact && <span className="font-mono">{h.contact}</span>}
                  </p>
                )}
              </div>
            </motion.div>
          ))}
        </motion.div>
        <SayThis points={ai} hex={meta.hex} loading={aiLoading} />
      </div>
    </SlideShell>
  )
}

// ─── Slide 5 · The route ─────────────────────────────────────────────────

/**
 * The day-by-day, beside the real map.
 *
 * Two halves that answer two different questions and are deliberately not
 * merged: the rail answers "what happens on day four", the map answers "how far
 * apart are these days and are we crossing the country twice". The map is the
 * booking's existing agenda-sourced journey — same route the ops team already
 * trusts — reused here rather than redrawn, so a brief can never disagree with
 * the movement chart.
 */
function MovementsSlide({ p, meta, ai, aiLoading }: {
  p: DriverBriefPayload; meta: SlideMeta; ai: string[]; aiLoading: boolean
}) {
  const [active, setActive] = useState<string | null>(p.movements[0]?.id ?? null)
  const current = p.movements.find(m => m.id === active) ?? p.movements[0] ?? null
  const railRef = useRef<HTMLDivElement>(null)

  // Days grouped so a two-movement day reads as one day, which is how the
  // driver thinks about it.
  const days = useMemo(() => {
    const map = new Map<string, BriefMovement[]>()
    for (const m of p.movements) {
      const list = map.get(m.date) ?? []
      list.push(m)
      map.set(m.date, list)
    }
    return Array.from(map.entries())
  }, [p.movements])

  return (
    <SlideShell
      meta={meta} kicker="Step 5 of the brief" title="The route, day by day"
      subtitle={
        p.unassignedDates.length > 0
          ? <span className="text-amber-400 font-semibold">{p.unassignedDates.length} movement(s) still have no driver</span>
          : `${days.length} day${days.length === 1 ? '' : 's'} · ${p.movements.length} movements`
      }
    >
      <div className="grid lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.15fr)] gap-6 items-start">
        {/* ── Day rail ─────────────────────────────────────────────── */}
        <div ref={railRef} className="space-y-2.5">
          <motion.div variants={LIST} initial="hidden" animate="show" className="space-y-2.5">
            {days.map(([date, items]) => (
              <motion.div key={date} variants={ITEM}>
                <p className="text-[10px] font-black tracking-[0.16em] uppercase text-slate-500 mb-1.5 pl-1">
                  Day {items[0].dayNo} · {dLong(date)}
                </p>
                <div className="space-y-2">
                  {items.map(m => {
                    const isActive = m.id === current?.id
                    return (
                      <button
                        key={m.id}
                        onClick={() => setActive(m.id)}
                        className={cn(
                          'w-full text-left rounded-xl border p-3 transition-all',
                          isActive
                            ? 'border-cyan-400/60 bg-cyan-500/10 shadow-[0_0_0_1px_rgba(34,211,238,0.25)]'
                            : 'border-slate-700/50 bg-slate-900/50 hover:border-slate-600 hover:bg-slate-800/50',
                        )}
                      >
                        <div className="flex items-start gap-2.5">
                          <span className={cn(
                            'w-8 h-8 rounded-lg grid place-items-center flex-shrink-0 text-xs font-black',
                            m.noDriverNeeded
                              ? 'bg-slate-700/60 text-slate-400'
                              : m.driverName ? 'bg-cyan-500/20 text-cyan-300' : 'bg-amber-500/20 text-amber-300',
                          )}>
                            {m.noDriverNeeded ? <Coffee className="w-3.5 h-3.5" /> : m.dayNo}
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className={cn('text-sm font-bold truncate', isActive ? 'text-cyan-200' : 'text-white')}>
                              {m.location}
                            </p>
                            {(m.fromPoint || m.toPoint) && (
                              <p className="text-[11px] text-slate-400 flex items-center gap-1 truncate mt-0.5">
                                {m.fromPoint} {m.toPoint && <ArrowRight className="w-3 h-3 flex-shrink-0" />} {m.toPoint}
                              </p>
                            )}
                            <p className="text-[10px] text-slate-500 mt-1">
                              {m.serviceLabel}
                              {m.timeFrom ? ` · ${m.timeFrom}` : ''}
                              {m.noDriverNeeded ? ' · free day, do not turn up' : ''}
                              {!m.noDriverNeeded && !m.driverName ? ' · no driver yet' : ''}
                            </p>
                          </div>
                        </div>
                      </button>
                    )
                  })}
                </div>
              </motion.div>
            ))}
          </motion.div>
        </div>

        {/* ── Map + the selected day in full ───────────────────────── */}
        <div className="space-y-4 lg:sticky lg:top-0">
          <div className="rounded-2xl overflow-hidden border border-slate-700/50">
            <JourneyMap bookingRef={p.bookingRef} source="agenda" theme="dark" />
          </div>

          <AnimatePresence mode="wait">
            {current && (
              <motion.div
                key={current.id}
                initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }}
                transition={{ duration: 0.25 }}
                className="rounded-2xl border border-cyan-500/30 bg-cyan-500/[0.07] p-5"
              >
                <p className="text-[10px] font-black tracking-[0.16em] uppercase text-cyan-300 mb-2">
                  Day {current.dayNo} · {dLong(current.date)}
                </p>
                <p className="text-xl font-black text-white leading-tight">{current.location}</p>
                {(current.fromPoint || current.toPoint) && (
                  <p className="text-sm text-cyan-100/80 flex items-center gap-1.5 mt-1">
                    <MapPin className="w-3.5 h-3.5" />{current.fromPoint || '—'}
                    <ArrowRight className="w-3.5 h-3.5" />{current.toPoint || '—'}
                  </p>
                )}
                <div className="flex flex-wrap gap-2 mt-3">
                  <Chip hex="#06b6d4">{current.serviceLabel}</Chip>
                  {current.meetingTime && <Chip hex="#22c55e"><Clock className="w-3 h-3" />Meet {current.meetingTime}</Chip>}
                  {current.timeFrom && <Chip hex="#94a3b8"><Clock className="w-3 h-3" />{current.timeFrom}{current.timeTo ? `–${current.timeTo}` : ''}</Chip>}
                  {current.mealPlan && <Chip hex="#f97316"><Utensils className="w-3 h-3" />{current.mealPlan}</Chip>}
                  {current.ticketCount > 0 && <Chip hex="#eab308"><Ticket className="w-3 h-3" />{current.ticketCount} ticket(s)</Chip>}
                  {current.driverName && <Chip hex="#10b981"><CarFront className="w-3 h-3" />{current.driverName}</Chip>}
                  {current.guideName && <Chip hex="#a78bfa"><User className="w-3 h-3" />{current.guideName}</Chip>}
                  {current.noDriverNeeded && <Chip hex="#64748b"><Coffee className="w-3 h-3" />Free / hotel-only day</Chip>}
                </div>
                {current.details && (
                  <p className="text-sm text-slate-300 mt-3 leading-relaxed whitespace-pre-wrap">{current.details}</p>
                )}
                {current.notes && (
                  <p className="text-[12px] text-cyan-200/70 mt-2 italic">Assignment note: {current.notes}</p>
                )}
              </motion.div>
            )}
          </AnimatePresence>

          <SayThis points={ai} hex={meta.hex} loading={aiLoading} />
        </div>
      </div>
    </SlideShell>
  )
}

// ─── Slide 6 · Tickets ───────────────────────────────────────────────────

function TicketsSlide({ p, meta, ai, aiLoading }: {
  p: DriverBriefPayload; meta: SlideMeta; ai: string[]; aiLoading: boolean
}) {
  // Grouped by day because that is when the driver needs them in his hand.
  const grouped = useMemo(() => {
    const map = new Map<string, BriefTicket[]>()
    for (const t of p.tickets) {
      const key = t.date ?? 'unscheduled'
      const list = map.get(key) ?? []
      list.push(t)
      map.set(key, list)
    }
    return Array.from(map.entries()).sort((a, b) => (a[0] === 'unscheduled' ? 1 : b[0] === 'unscheduled' ? -1 : a[0].localeCompare(b[0])))
  }, [p.tickets])

  const inactive = p.tickets.filter(t => !t.activated).length

  return (
    <SlideShell
      meta={meta} kicker="Step 6 of the brief" title="What is already paid for"
      subtitle={
        inactive > 0
          ? <span className="text-amber-400 font-semibold">{inactive} ticket(s) not activated yet — do not send him to the gate on these</span>
          : `${p.tickets.length} ticket${p.tickets.length === 1 ? '' : 's'} on this file`
      }
    >
      <div className="grid lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] gap-6 items-start">
        <motion.div variants={LIST} initial="hidden" animate="show" className="space-y-4">
          {grouped.map(([date, items]) => (
            <motion.div key={date} variants={ITEM}>
              <p className="text-[10px] font-black tracking-[0.16em] uppercase text-slate-500 mb-2">
                {date === 'unscheduled' ? 'Not tied to a day' : dLong(date)}
              </p>
              <div className="space-y-2">
                {items.map(t => (
                  <div key={t.id} className="flex items-center gap-3 rounded-xl border border-yellow-500/25 bg-yellow-500/[0.06] p-3.5">
                    <span className="w-10 h-10 rounded-xl bg-yellow-500/15 border border-yellow-500/30 grid place-items-center text-yellow-300 flex-shrink-0">
                      <Ticket className="w-4 h-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-bold text-white truncate">{t.type}</p>
                      <p className="text-[11px] text-slate-400 truncate">
                        {t.qty} pax{t.location ? ` · ${t.location}` : ''}{t.supplier ? ` · ${t.supplier}` : ''}
                        {t.reference ? ` · ref ${t.reference}` : ''}
                      </p>
                    </div>
                    <span className={cn(
                      'px-2 py-1 rounded-lg text-[10px] font-black border flex-shrink-0',
                      t.activated
                        ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300'
                        : 'bg-amber-500/15 border-amber-500/30 text-amber-300',
                    )}>
                      {t.activated ? 'ACTIVE' : 'NOT ACTIVE'}
                    </span>
                  </div>
                ))}
              </div>
            </motion.div>
          ))}
        </motion.div>
        <SayThis points={ai} hex={meta.hex} loading={aiLoading} />
      </div>
    </SlideShell>
  )
}

// ─── Slide 7 · Sign off ──────────────────────────────────────────────────

/**
 * The only slide that writes anything.
 *
 * Two halves, in the order the call ends: first the questions to put *back* to
 * the driver — a brief nobody checked is a brief nobody had — then the note of
 * what actually came out of it, then the sign-off. Completion is a button a
 * person presses, never a side effect of reaching the last slide, because the
 * record exists to say a human did this.
 */
function NotesSlide({
  p, meta, ai, aiLoading, notes, setNotes, seen, onComplete, onReopen, saving,
}: {
  p: DriverBriefPayload; meta: SlideMeta; ai: BriefAi | null; aiLoading: boolean
  notes: string; setNotes: (v: string) => void
  seen: Record<string, boolean>
  onComplete: () => void; onReopen: () => void; saving: boolean
}) {
  const applicable = SLIDES.filter(s => s.id !== 'notes' && s.applies(p))
  const read = applicable.filter(s => seen[s.id]).length
  const done = p.brief.status === 'completed'

  return (
    <SlideShell
      meta={meta} kicker="Last step" title="Anything to note, then sign it off"
      subtitle={`${read} of ${applicable.length} screens read${p.primaryDriver ? ` · ${p.primaryDriver.name}` : ''}`}
    >
      <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-6 items-start">
        <motion.div variants={LIST} initial="hidden" animate="show" className="space-y-4">
          {/* Coverage — which screens were actually read, not merely opened. */}
          <motion.div variants={ITEM} className="rounded-2xl border border-slate-700/50 bg-slate-900/50 p-5">
            <p className="text-[10px] font-black tracking-[0.16em] uppercase text-slate-400 mb-3">Brief coverage</p>
            <div className="grid grid-cols-2 gap-2">
              {applicable.map(s => {
                const Icon = s.icon
                const ok = !!seen[s.id]
                return (
                  <div key={s.id} className={cn(
                    'flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-semibold',
                    ok ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
                       : 'border-slate-700/50 bg-slate-800/40 text-slate-400',
                  )}>
                    {ok ? <CircleCheck className="w-3.5 h-3.5 flex-shrink-0" /> : <CircleDashed className="w-3.5 h-3.5 flex-shrink-0" />}
                    <Icon className="w-3.5 h-3.5 flex-shrink-0 opacity-60" />
                    <span className="truncate">{s.label}</span>
                  </div>
                )
              })}
            </div>
          </motion.div>

          <motion.div variants={ITEM}>
            <label className="text-[10px] font-black tracking-[0.16em] uppercase text-slate-400 mb-2 block">
              Note from the call
            </label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={8}
              placeholder="What the driver asked, what he already knew, what he was told to watch for, anything he cannot do…"
              className="w-full rounded-2xl border border-slate-700/60 bg-slate-900/70 p-4 text-sm text-slate-100 placeholder:text-slate-600 focus:border-emerald-500/50 focus:outline-none focus:ring-1 focus:ring-emerald-500/30 resize-y"
            />
            <p className="text-[11px] text-slate-500 mt-1.5">Saved with the brief. Kept even if the file is later re-allocated.</p>
          </motion.div>

          <motion.div variants={ITEM} className="flex flex-wrap items-center gap-3">
            {done ? (
              <>
                <span className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 font-bold text-sm">
                  <BadgeCheck className="w-4 h-4" />
                  Briefed{p.brief.briefedByName ? ` by ${p.brief.briefedByName}` : ''}
                  {p.brief.completedAt ? ` · ${formatDate(p.brief.completedAt, 'dd MMM HH:mm')}` : ''}
                </span>
                <button
                  onClick={onReopen} disabled={saving}
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-slate-600/60 text-slate-300 hover:bg-slate-800 font-semibold text-sm transition-colors disabled:opacity-50"
                >
                  <RefreshCw className="w-3.5 h-3.5" /> Reopen brief
                </button>
              </>
            ) : (
              <button
                onClick={onComplete} disabled={saving}
                className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-emerald-950 font-black text-sm transition-colors disabled:opacity-60"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <BadgeCheck className="w-4 h-4" />}
                Mark driver brief complete
              </button>
            )}
          </motion.div>
        </motion.div>

        <div className="space-y-4">
          {aiLoading && <SayThis points={[]} hex={meta.hex} loading />}
          {ai?.watchOuts?.length ? (
            <motion.div
              initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
              className="rounded-2xl border border-red-500/30 bg-red-500/[0.08] p-5"
            >
              <p className="flex items-center gap-1.5 text-[10px] font-black tracking-[0.16em] uppercase text-red-300 mb-3">
                <AlertTriangle className="w-3.5 h-3.5" /> What goes wrong on this file
              </p>
              <ul className="space-y-2.5">
                {ai.watchOuts.map((w, i) => (
                  <li key={i} className="flex gap-2.5 text-sm text-red-100/90 leading-relaxed">
                    <span className="mt-[7px] w-1.5 h-1.5 rounded-full bg-red-400 flex-shrink-0" />{w}
                  </li>
                ))}
              </ul>
            </motion.div>
          ) : null}

          {ai?.questions?.length ? (
            <motion.div
              initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
              className="rounded-2xl border border-violet-500/30 bg-violet-500/[0.08] p-5"
            >
              <p className="flex items-center gap-1.5 text-[10px] font-black tracking-[0.16em] uppercase text-violet-300 mb-3">
                <ShieldQuestion className="w-3.5 h-3.5" /> Ask him back
              </p>
              <ul className="space-y-2.5">
                {ai.questions.map((q, i) => (
                  <li key={i} className="flex gap-2.5 text-sm text-violet-100/90 leading-relaxed">
                    <span className="mt-[7px] w-1.5 h-1.5 rounded-full bg-violet-400 flex-shrink-0" />{q}
                  </li>
                ))}
              </ul>
            </motion.div>
          ) : null}

          {p.unassignedDates.length > 0 && (
            <div className="rounded-2xl border border-amber-500/30 bg-amber-500/[0.08] p-5">
              <p className="flex items-center gap-1.5 text-[10px] font-black tracking-[0.16em] uppercase text-amber-300 mb-2">
                <AlertTriangle className="w-3.5 h-3.5" /> Still unallocated
              </p>
              <p className="text-sm text-amber-100/90">
                {p.unassignedDates.length} movement(s) have no driver: {p.unassignedDates.map(x => d(x)).join(', ')}.
              </p>
            </div>
          )}
        </div>
      </div>
    </SlideShell>
  )
}

// ─── The deck ────────────────────────────────────────────────────────────

export interface DriverBriefModalProps {
  bookingRef: string
  open: boolean
  onClose: () => void
  /** Fired once the brief is signed off, so the page behind can refresh. */
  onCompleted?: () => void
}

export default function DriverBriefModal({ bookingRef, open, onClose, onCompleted }: DriverBriefModalProps) {
  const [payload, setPayload] = useState<DriverBriefPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [aiLoading, setAiLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  const [index, setIndex] = useState(0)
  const [dir, setDir] = useState(1)
  const [seen, setSeen] = useState<Record<string, boolean>>({})
  const [notes, setNotes] = useState('')

  // Progress is written back in the background, never in the render path: the
  // officer is mid-sentence and a save must not be able to interrupt the deck.
  const pendingRef = useRef<{ seen: Record<string, boolean>; notes: string } | null>(null)
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const slides = useMemo(
    () => (payload ? SLIDES.filter(s => s.applies(payload)) : []),
    [payload],
  )
  const meta = slides[index] ?? SLIDES[0]

  const aiFor = useCallback(
    (id: SlideId) => payload?.ai?.sections.find(s => s.slide === id)?.points ?? [],
    [payload],
  )

  // ── Load ────────────────────────────────────────────────────────────
  const load = useCallback(async (withAi: 'cached' | 'refresh' | 'none') => {
    setError(null)
    try {
      const qs = withAi === 'refresh' ? '?ai=refresh' : withAi === 'cached' ? '?ai=1' : ''
      const res = await fetch(`/api/bookings/${bookingRef}/driver-brief${qs}`)
      const json = await readApiResponse<DriverBriefPayload>(res)
      if (!json.success || !json.data) throw new Error(json.error ?? 'Could not load the brief')
      setPayload(json.data)
      setSeen(prev => ({ ...json.data!.brief.slidesSeen, ...prev }))
      setNotes(prev => (prev ? prev : json.data!.brief.notes))
      return json.data
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the brief')
      return null
    }
  }, [bookingRef])

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    setIndex(0)
    ;(async () => {
      // Data first, so the deck is on screen before the model is asked for
      // anything — somebody already has a driver on the line.
      const first = await load('none')
      if (cancelled) return
      setLoading(false)
      if (!first) return

      if (!first.ai) {
        setAiLoading(true)
        await load('cached')
        if (!cancelled) setAiLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [open, load])

  // ── Progress writes ─────────────────────────────────────────────────
  const queueSave = useCallback((next: { seen?: Record<string, boolean>; notes?: string }) => {
    pendingRef.current = {
      seen: { ...(pendingRef.current?.seen ?? {}), ...(next.seen ?? {}) },
      notes: next.notes ?? pendingRef.current?.notes ?? notes,
    }
    if (flushTimer.current) clearTimeout(flushTimer.current)
    flushTimer.current = setTimeout(async () => {
      const body = pendingRef.current
      pendingRef.current = null
      if (!body) return
      await fetch(`/api/bookings/${bookingRef}/driver-brief`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'progress', slidesSeen: body.seen, notes: body.notes }),
      }).catch(() => {/* a lost progress write is not worth interrupting a call */})
    }, 1200)
  }, [bookingRef, notes])

  // A slide counts as read once it has been on screen for a moment — long
  // enough to have been spoken, short enough not to punish a quick back-step.
  useEffect(() => {
    if (!open || loading || !meta) return
    const t = setTimeout(() => {
      setSeen(prev => {
        if (prev[meta.id]) return prev
        const next = { ...prev, [meta.id]: true }
        queueSave({ seen: next })
        return next
      })
    }, 1500)
    return () => clearTimeout(t)
  }, [open, loading, meta, queueSave])

  useEffect(() => () => { if (flushTimer.current) clearTimeout(flushTimer.current) }, [])

  const go = useCallback((delta: number) => {
    setIndex(i => {
      const next = Math.min(slides.length - 1, Math.max(0, i + delta))
      if (next !== i) setDir(delta)
      return next
    })
  }, [slides.length])

  const jump = useCallback((to: number) => {
    setIndex(i => { if (to !== i) setDir(to > i ? 1 : -1); return to })
  }, [])

  // ── Keyboard: the deck is driven one-handed while holding a phone ────
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT')) {
        if (e.key === 'Escape') t.blur()
        return
      }
      if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') { e.preventDefault(); go(1) }
      else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); go(-1) }
      else if (e.key === 'Escape') onClose()
      else if (e.key === 'Home') jump(0)
      else if (e.key === 'End') jump(slides.length - 1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, go, jump, onClose, slides.length])

  // Body scroll is locked while the deck is up — it is a presenter, not a panel.
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [open])

  const complete = useCallback(async () => {
    setSaving(true)
    try {
      const res = await fetch(`/api/bookings/${bookingRef}/driver-brief`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'complete', slidesSeen: seen, notes }),
      })
      const json = await readApiResponse(res)
      if (!json.success) throw new Error(json.error ?? 'Could not save')
      toast.success('Driver brief marked complete ✅')
      await load('none')
      onCompleted?.()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save the brief')
    } finally {
      setSaving(false)
    }
  }, [bookingRef, seen, notes, load, onCompleted])

  const reopen = useCallback(async () => {
    setSaving(true)
    try {
      const res = await fetch(`/api/bookings/${bookingRef}/driver-brief`, { method: 'DELETE' })
      const json = await readApiResponse(res)
      if (!json.success) throw new Error(json.error ?? 'Could not reopen')
      toast.success('Brief reopened')
      await load('none')
      onCompleted?.()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not reopen the brief')
    } finally {
      setSaving(false)
    }
  }, [bookingRef, load, onCompleted])

  const refreshAi = useCallback(async () => {
    setAiLoading(true)
    await load('refresh')
    setAiLoading(false)
  }, [load])

  if (!open) return null

  const progress = slides.length > 1 ? (index / (slides.length - 1)) * 100 : 100

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 z-[100] bg-slate-950/95 backdrop-blur-sm flex flex-col"
        role="dialog" aria-modal="true" aria-label={`Driver brief for ${bookingRef}`}
      >
        {/* Plain <style> rather than styled-jsx: nothing else in this app uses
            styled-jsx, and the deck should not be the reason it has to work. */}
        <style dangerouslySetInnerHTML={{ __html: `
          .brief-scroll::-webkit-scrollbar { width: 8px; }
          .brief-scroll::-webkit-scrollbar-thumb { background: rgba(100,116,139,.4); border-radius: 8px; }
          .brief-scroll::-webkit-scrollbar-track { background: transparent; }
        ` }} />

        {/* ── Top bar ──────────────────────────────────────────────── */}
        <div className="flex-shrink-0 border-b border-slate-800/80 bg-slate-950/80">
          <div className="flex items-center gap-3 px-4 md:px-8 py-3">
            <div className="min-w-0 flex-1 flex items-center gap-3">
              <span className="px-2.5 py-1 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-[10px] font-black tracking-wider">
                DRIVER BRIEF
              </span>
              <span className="font-black text-white truncate">{bookingRef}</span>
              {payload && (
                <span className="hidden md:inline text-xs text-slate-400 truncate">
                  {payload.leadName ?? '—'} · {payload.paxAdults + payload.paxChildren} pax ·{' '}
                  {d(payload.arrivalDate)} → {d(payload.departureDate)}
                  {payload.daysToArrival >= 0 ? ` · D-${payload.daysToArrival}` : ' · in progress'}
                </span>
              )}
              {payload?.brief.status === 'completed' && (
                <span className="hidden sm:inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-[10px] font-black">
                  <BadgeCheck className="w-3 h-3" /> BRIEFED
                </span>
              )}
            </div>

            <button
              onClick={refreshAi} disabled={aiLoading}
              className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-700/60 text-slate-300 hover:text-white hover:bg-slate-800 text-xs font-semibold transition-colors disabled:opacity-50"
              title="Rewrite the talking points"
            >
              {aiLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
              Talking points
            </button>
            <button onClick={onClose} className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors">
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* ── Chapter rail ───────────────────────────────────────── */}
          {slides.length > 0 && (
            <div className="relative px-4 md:px-8 pb-3">
              <div className="flex gap-1.5">
                {slides.map((s, i) => {
                  const Icon = s.icon
                  const active = i === index
                  return (
                    <button
                      key={s.id}
                      onClick={() => jump(i)}
                      className="group flex-1 min-w-0"
                      title={s.label}
                    >
                      <span
                        className={cn('block h-1 rounded-full transition-all',
                          i < index ? 'opacity-100' : active ? 'opacity-100' : 'opacity-25 bg-slate-600')}
                        style={i <= index ? { background: s.hex } : undefined}
                      />
                      <span className={cn(
                        'mt-1.5 hidden md:flex items-center justify-center gap-1 text-[10px] font-bold truncate transition-colors',
                        active ? 'text-white' : 'text-slate-500 group-hover:text-slate-300',
                      )}>
                        <Icon className="w-3 h-3 flex-shrink-0" />
                        <span className="truncate">{s.label}</span>
                        {seen[s.id] && <CircleCheck className="w-2.5 h-2.5 text-emerald-400 flex-shrink-0" />}
                      </span>
                    </button>
                  )
                })}
              </div>
              <motion.div
                aria-hidden
                className="absolute left-0 bottom-0 h-px bg-emerald-400/60"
                animate={{ width: `${progress}%` }}
                transition={{ type: 'spring', stiffness: 180, damping: 26 }}
              />
            </div>
          )}
        </div>

        {/* ── Stage ────────────────────────────────────────────────── */}
        <div className="flex-1 min-h-0 relative">
          {loading ? (
            <div className="h-full grid place-items-center text-slate-400">
              <div className="text-center">
                <Loader2 className="w-8 h-8 animate-spin mx-auto mb-3 text-emerald-400" />
                <p className="text-sm font-semibold">Building the brief…</p>
              </div>
            </div>
          ) : error ? (
            <div className="h-full grid place-items-center">
              <div className="text-center max-w-sm">
                <AlertTriangle className="w-10 h-10 text-red-400 mx-auto mb-3" />
                <p className="text-red-300 font-bold">{error}</p>
                <button onClick={() => { setLoading(true); load('none').finally(() => setLoading(false)) }}
                  className="mt-4 px-4 py-2 rounded-xl border border-slate-700 text-slate-300 hover:bg-slate-800 text-sm font-semibold">
                  Try again
                </button>
              </div>
            </div>
          ) : payload ? (
            <AnimatePresence mode="wait" custom={dir}>
              <motion.div
                key={meta.id}
                custom={dir}
                variants={SLIDE_VARIANTS}
                initial="enter" animate="center" exit="exit"
                transition={{ type: 'spring', stiffness: 300, damping: 32, opacity: { duration: 0.18 } }}
                className="absolute inset-0"
              >
                {meta.id === 'driver'    && <DriverSlide    p={payload} meta={meta} ai={aiFor('driver')}    aiLoading={aiLoading} />}
                {meta.id === 'overview'  && <OverviewSlide  p={payload} meta={meta} ai={aiFor('overview')}  aiLoading={aiLoading} />}
                {meta.id === 'flights'   && <FlightsSlide   p={payload} meta={meta} ai={aiFor('flights')}   aiLoading={aiLoading} />}
                {meta.id === 'hotels'    && <HotelsSlide    p={payload} meta={meta} ai={aiFor('hotels')}    aiLoading={aiLoading} />}
                {meta.id === 'movements' && <MovementsSlide p={payload} meta={meta} ai={aiFor('movements')} aiLoading={aiLoading} />}
                {meta.id === 'tickets'   && <TicketsSlide   p={payload} meta={meta} ai={aiFor('tickets')}   aiLoading={aiLoading} />}
                {meta.id === 'notes'     && (
                  <NotesSlide
                    p={payload} meta={meta} ai={payload.ai} aiLoading={aiLoading}
                    notes={notes}
                    setNotes={v => { setNotes(v); queueSave({ notes: v }) }}
                    seen={seen} onComplete={complete} onReopen={reopen} saving={saving}
                  />
                )}
              </motion.div>
            </AnimatePresence>
          ) : null}
        </div>

        {/* ── Footer ───────────────────────────────────────────────── */}
        {!loading && !error && payload && (
          <div className="flex-shrink-0 border-t border-slate-800/80 bg-slate-950/80 px-4 md:px-8 py-3 flex items-center gap-3">
            <button
              onClick={() => go(-1)} disabled={index === 0}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl border border-slate-700/60 text-slate-300 hover:bg-slate-800 text-sm font-semibold transition-colors disabled:opacity-30 disabled:hover:bg-transparent"
            >
              <ChevronLeft className="w-4 h-4" /> Back
            </button>

            <div className="flex-1 text-center">
              {payload.ai?.headline && index === 0 && (
                <p className="hidden lg:block text-xs text-slate-400 italic truncate px-4">“{payload.ai.headline}”</p>
              )}
              <p className="text-[11px] text-slate-500 font-semibold">
                {index + 1} / {slides.length}
                <span className="hidden sm:inline"> · use ← → to move</span>
              </p>
            </div>

            {index < slides.length - 1 ? (
              <button
                onClick={() => go(1)}
                className="inline-flex items-center gap-1.5 px-5 py-2 rounded-xl bg-white text-slate-900 hover:bg-slate-200 text-sm font-black transition-colors"
              >
                Next <ChevronRight className="w-4 h-4" />
              </button>
            ) : payload.brief.status !== 'completed' ? (
              <button
                onClick={complete} disabled={saving}
                className="inline-flex items-center gap-1.5 px-5 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-emerald-950 text-sm font-black transition-colors disabled:opacity-60"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <BadgeCheck className="w-4 h-4" />} Complete
              </button>
            ) : (
              <button onClick={onClose} className="px-5 py-2 rounded-xl border border-slate-700/60 text-slate-300 hover:bg-slate-800 text-sm font-bold">
                Close
              </button>
            )}
          </div>
        )}
      </motion.div>
    </AnimatePresence>
  )
}
