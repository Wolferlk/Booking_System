'use client'

/**
 * The right-hand pane of the WhatsApp inbox: the whole trip behind the open chat,
 * so the desk can answer a guest without leaving the conversation.
 *
 * The shell slides in once; everything inside is keyed by phone, because it all
 * belongs to one chat and a send dialog must never outlive the chat it opened for.
 * It unmounts with no exit animation: inside AnimatePresence the exit never
 * finished here, which left a closed panel on screen.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { AnimatePresence, motion } from 'framer-motion'
import {
  AlertTriangle, AudioLines, BedDouble, CalendarClock, CarFront, Check, ChevronDown, Compass, Copy, Download, ExternalLink,
  Globe, LayoutGrid, Loader2, Mail, MapPin, MessageCircle, Package, Phone, PhoneCall, Plane, RefreshCw,
  Route, Send, Star, Ticket, UserRound, Users, Utensils, X,
} from 'lucide-react'
import { toast } from 'sonner'
import { STATUS_COLORS, STATUS_LABELS } from '@/lib/state-machine'
import { countryFlag, countryLabel } from '@/lib/country-detection'
import { normalizeUploadUrl } from '@/lib/upload-path'
import type {
  ChatRole, TripAgendaDay, TripContext, TripContextResponse, TripMovement, TripPerson, TripPersonKind,
} from '@/lib/whatsapp-trip-context'
import {
  CallRecordingPlayer, FeedbackClassBadge, KIND_META, OUTCOME_LABEL, SENTIMENT_META, TranscriptChat,
  fmtDate as fmtCallDate, type TranscriptRecord,
} from '@/components/te/transcript-shared'
import { AgendaSendDialog, PortalSendDialog } from '@/components/whatsapp-inbox/trip-send'

type Section = 'overview' | 'itinerary' | 'agenda' | 'guests' | 'flights' | 'stays' | 'package' | 'team' | 'tickets' | 'calls'

const SECTIONS: { key: Section; label: string; icon: typeof Plane }[] = [
  { key: 'overview',  label: 'Trip',    icon: LayoutGrid },
  { key: 'itinerary', label: 'Days',    icon: Compass },
  { key: 'agenda',    label: 'Agenda',  icon: Route },
  { key: 'guests',    label: 'Guests',  icon: Users },
  { key: 'flights',   label: 'Flights', icon: Plane },
  { key: 'stays',     label: 'Stays',   icon: BedDouble },
  { key: 'package',   label: 'Package', icon: Package },
  { key: 'team',      label: 'Drivers', icon: CarFront },
  { key: 'tickets',   label: 'Tickets', icon: Ticket },
  { key: 'calls',     label: 'AI Calls', icon: AudioLines },
]

const ROLE_LABEL: Record<ChatRole, string> = { GUEST: 'Guest chat', AGENT: 'Agent chat', FILED: 'Linked chat' }

// Dates here are calendar days, so they format in UTC or a desk west of the trip reads the day before.
const dayFmt = (day: string, opts: Intl.DateTimeFormatOptions) =>
  new Date(`${day}T00:00:00.000Z`).toLocaleDateString('en-GB', { timeZone: 'UTC', ...opts })
const shortDay = (day: string) => dayFmt(day, { day: 'numeric', month: 'short' })
const longDay = (day: string) => dayFmt(day, { weekday: 'short', day: 'numeric', month: 'short' })
const digits = (raw: string | null | undefined) => (raw ?? '').replace(/\D/g, '')

interface PanelProps {
  phone: string
  /** The booking the chat header shows, once the thread has loaded. */
  bookingRef: string | null
  /** False until the thread has answered — the ref above isn't known before that. */
  ready: boolean
  contactName: string | null
  windowOpen: boolean | null
  onClose: () => void
  onOpenChat: (phone: string) => void
  onSent: () => void
}

export function TripPanel(props: PanelProps) {
  return (
    <>
      <motion.button
        aria-label="Close trip panel"
        onClick={props.onClose}
        className="fixed inset-0 z-30 hidden bg-slate-950/30 backdrop-blur-[1px] max-[1239px]:block"
        initial={{ opacity: 0 }} animate={{ opacity: 1 }}
      />
      <motion.aside
        aria-label="Trip details"
        initial={{ opacity: 0, x: 28 }} animate={{ opacity: 1, x: 0 }}
        transition={{ type: 'spring', stiffness: 420, damping: 38 }}
        className="flex h-full w-[432px] shrink-0 flex-col border-l border-slate-200/80 bg-[#f5f7f6] max-[1239px]:fixed max-[1239px]:inset-y-0 max-[1239px]:right-0 max-[1239px]:z-40 max-[1239px]:shadow-2xl max-[860px]:w-full"
      >
        <ChatTrip key={props.phone} {...props} />
      </motion.aside>
    </>
  )
}

function ChatTrip({ phone, bookingRef, ready, contactName, windowOpen, onClose, onOpenChat, onSent }: PanelProps) {
  const [data, setData] = useState<TripContextResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [pickedRef, setPickedRef] = useState<string | null>(null)
  const [section, setSection] = useState<Section>('overview')
  const [switcherOpen, setSwitcherOpen] = useState(false)
  const [dialog, setDialog] = useState<'portal' | 'agenda' | null>(null)
  const [version, setVersion] = useState(0)
  const scrollRef = useRef<HTMLDivElement>(null)

  const ref = pickedRef ?? bookingRef

  useEffect(() => {
    if (!ready) return
    const ctrl = new AbortController()
    // Alt+↓ through the list shouldn't load every chat it passes over.
    const timer = setTimeout(async () => {
      setLoading(true)
      try {
        const q = new URLSearchParams({ phone })
        if (ref) q.set('ref', ref)
        const res = await fetch(`/api/whatsapp/booking-context?${q}`, { signal: ctrl.signal })
        const json = await res.json()
        if (json.success) { setData(json.data); setError(null) } else setError(json.error ?? 'Could not load this trip')
      } catch (err) {
        if ((err as Error)?.name === 'AbortError') return
        setError('Could not load this trip')
      }
      setLoading(false)
    }, 180)
    return () => { clearTimeout(timer); ctrl.abort() }
  }, [phone, ref, ready, version])

  useEffect(() => { scrollRef.current?.scrollTo({ top: 0 }) }, [section, data?.trip?.bookingRef])

  const trip = data?.trip ?? null
  const linked = data?.linked ?? []
  const current = linked.find(l => l.bookingRef === trip?.bookingRef)
  const name = contactName || `+${phone}`
  const refresh = () => setVersion(v => v + 1)
  const afterSend = () => { refresh(); onSent() }

  const counts: Partial<Record<Section, number>> = trip ? {
    itinerary: trip.itinerary.length,
    agenda:    trip.agenda.reduce((n, d) => n + d.items.length, 0),
    guests:    trip.passengers.length,
    flights:   trip.flights.length,
    stays:     trip.stays.length,
    package:   trip.notes.length,
    team:      trip.people.length,
    tickets:   trip.tickets.length,
  } : {}

  return (
    <>
        {/* header */}
        <div className="relative z-20 flex h-[60px] shrink-0 items-center gap-2 border-b border-slate-200/70 bg-white/90 px-3 backdrop-blur">
          {trip ? (
            <button
              onClick={() => linked.length > 1 && setSwitcherOpen(o => !o)}
              className={`flex min-w-0 flex-1 items-center gap-2 rounded-xl px-2 py-1 text-left transition ${linked.length > 1 ? 'hover:bg-slate-100' : 'cursor-default'}`}
              title={linked.length > 1 ? 'Switch booking' : undefined}
            >
              <span className="text-[19px] leading-none">{trip.operationCountry ? countryFlag(trip.operationCountry) : '🌍'}</span>
              <span className="min-w-0">
                <span className="flex items-center gap-1 text-[13.5px] font-extrabold tracking-tight text-slate-900">
                  <span className="truncate font-mono">{trip.isNumber ?? trip.bookingRef}</span>
                  {linked.length > 1 && <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-slate-400 transition ${switcherOpen ? 'rotate-180' : ''}`} />}
                </span>
                <span className="block truncate text-[10.5px] font-semibold text-slate-400">
                  {current ? ROLE_LABEL[current.chatRole] : 'Linked chat'}
                  {linked.length > 1 ? ` · ${linked.length} bookings` : ''}
                </span>
              </span>
            </button>
          ) : (
            <p className="min-w-0 flex-1 px-2 text-[13.5px] font-extrabold tracking-tight text-slate-900">Trip details</p>
          )}
          <HeaderBtn title="Refresh" onClick={refresh}><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /></HeaderBtn>
          {trip && (
            <Link href={`/dashboard/bookings/${trip.bookingRef}`} target="_blank" title="Open booking" className="grid h-8 w-8 place-items-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-slate-800">
              <ExternalLink className="h-4 w-4" />
            </Link>
          )}
          <HeaderBtn title="Close panel" onClick={onClose}><X className="h-4 w-4" /></HeaderBtn>

          <AnimatePresence>
            {switcherOpen && (
              <motion.div
                initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
                className="absolute left-3 right-3 top-[56px] max-h-80 overflow-y-auto rounded-2xl bg-white p-1.5 shadow-2xl ring-1 ring-black/5"
              >
                {linked.map(l => (
                  <button
                    key={l.bookingRef}
                    onClick={() => { setPickedRef(l.bookingRef); setSwitcherOpen(false); setSection('overview') }}
                    className={`flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition hover:bg-slate-50 ${l.bookingRef === trip?.bookingRef ? 'bg-emerald-50' : ''}`}
                  >
                    <span className="text-base leading-none">{l.operationCountry ? countryFlag(l.operationCountry) : '🌍'}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12.5px] font-bold text-slate-800">{l.isNumber ?? l.bookingRef}{l.leadName ? ` · ${l.leadName}` : ''}</span>
                      <span className="block truncate text-[11px] text-slate-400">{shortDay(l.arrivalDate)} → {shortDay(l.departureDate)} · {ROLE_LABEL[l.chatRole]}</span>
                    </span>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[9.5px] font-bold ${STATUS_COLORS[l.status]}`}>{STATUS_LABELS[l.status]}</span>
                  </button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* body */}
        {!trip ? (
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {loading || !data && !error ? <PanelSkeleton /> : (
              <Blank
                icon={error ? AlertTriangle : Compass}
                title={error ? 'Could not load this trip' : data?.restricted ? 'Outside your country' : 'No booking on this chat'}
                text={error ?? (data?.restricted
                  ? 'This chat belongs to a booking your login cannot open.'
                  : 'This number is not on any booking, and none of its messages are filed under one. Add it to the booking’s contacts and the trip shows up here.')}
                action={error ? { label: 'Try again', onClick: refresh } : undefined}
              />
            )}
          </div>
        ) : (
          <>
            <div className="flex min-h-0 flex-1">
              <nav aria-label="Trip sections" className="flex w-[66px] shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-slate-200/70 bg-white/70 px-1.5 py-2">
                {SECTIONS.map(s => {
                  const Icon = s.icon
                  const on = section === s.key
                  const n = counts[s.key]
                  const dim = n === 0
                  return (
                    <button
                      key={s.key}
                      onClick={() => setSection(s.key)}
                      aria-current={on ? 'page' : undefined}
                      className="relative flex shrink-0 flex-col items-center gap-0.5 rounded-xl py-1.5"
                    >
                      {on && <motion.span layoutId="trip-rail" className="absolute inset-0 rounded-xl bg-gradient-to-b from-[#0c3b30] to-[#0a2b24] shadow-md shadow-emerald-950/25" transition={{ type: 'spring', stiffness: 500, damping: 38 }} />}
                      <Icon className={`relative h-[18px] w-[18px] ${on ? 'text-amber-300' : dim ? 'text-slate-300' : 'text-slate-500'}`} />
                      <span className={`relative text-[9.5px] font-bold ${on ? 'text-white' : dim ? 'text-slate-300' : 'text-slate-500'}`}>{s.label}</span>
                      {!!n && !on && <span className="absolute right-1 top-0.5 min-w-[14px] rounded-full bg-slate-200 px-1 text-center text-[8.5px] font-bold leading-[14px] text-slate-600">{n}</span>}
                    </button>
                  )
                })}
              </nav>

              <div ref={scrollRef} className="min-w-0 flex-1 overflow-y-auto px-3 py-3">
                <AnimatePresence mode="wait" initial={false}>
                  <motion.div key={`${trip.bookingRef}:${section}`} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.14 }}>
                    {section === 'overview'  && <Overview trip={trip} jump={setSection} onOpenChat={onOpenChat} phone={phone} />}
                    {section === 'itinerary' && <Itinerary trip={trip} />}
                    {section === 'agenda'    && <Agenda trip={trip} />}
                    {section === 'guests'    && <Guests trip={trip} onOpenChat={onOpenChat} phone={phone} />}
                    {section === 'flights'   && <Flights trip={trip} />}
                    {section === 'stays'     && <Stays trip={trip} />}
                    {section === 'package'   && <PackageNotes trip={trip} />}
                    {section === 'team'      && <Team trip={trip} onOpenChat={onOpenChat} />}
                    {section === 'tickets'   && <Tickets trip={trip} />}
                    {section === 'calls'     && <Calls trip={trip} />}
                  </motion.div>
                </AnimatePresence>
              </div>
            </div>

            {/* send dock */}
            <div className="flex shrink-0 gap-2 border-t border-slate-200/70 bg-white/90 p-2.5 backdrop-blur">
              {trip.can.sendPortal && (
                <motion.button
                  whileTap={{ scale: 0.97 }}
                  onClick={() => setDialog('portal')}
                  className="flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-2xl bg-gradient-to-r from-[#0f4a3a] to-[#0b6b52] py-2.5 text-[12.5px] font-bold text-white shadow-md shadow-emerald-900/20 transition hover:brightness-110"
                >
                  <Globe className="h-4 w-4 text-amber-300" /> Send client portal
                </motion.button>
              )}
              <motion.button
                whileTap={{ scale: 0.97 }}
                disabled={!trip.agenda.length}
                title={trip.agenda.length ? undefined : 'This booking has no agenda yet'}
                onClick={() => setDialog('agenda')}
                className="flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-2xl bg-gradient-to-r from-amber-400 to-orange-500 py-2.5 text-[12.5px] font-bold text-white shadow-md shadow-amber-500/25 transition hover:brightness-105 disabled:opacity-40 disabled:shadow-none"
              >
                <Send className="h-4 w-4" /> Send agenda
              </motion.button>
            </div>
          </>
        )}

      <AnimatePresence>
        {trip && dialog === 'portal' && (
          <PortalSendDialog trip={trip} phone={phone} contactName={name} onClose={() => setDialog(null)} onSent={afterSend} />
        )}
        {trip && dialog === 'agenda' && (
          <AgendaSendDialog trip={trip} phone={phone} contactName={name} windowOpen={windowOpen} onClose={() => setDialog(null)} onSent={afterSend} />
        )}
      </AnimatePresence>
    </>
  )
}

// ── Small pieces ────────────────────────────────────────────────────────────

function HeaderBtn({ title, onClick, children }: { title: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button title={title} aria-label={title} onClick={onClick} className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-slate-800">
      {children}
    </button>
  )
}

function PanelSkeleton() {
  return (
    <div className="space-y-3">
      <div className="h-56 animate-pulse rounded-3xl bg-slate-200/80" />
      <div className="h-28 animate-pulse rounded-2xl bg-slate-200/60" />
      <div className="h-20 animate-pulse rounded-2xl bg-slate-200/40" />
    </div>
  )
}

function Blank({ icon: Icon, title, text, action }: {
  icon: typeof Plane; title: string; text: string; action?: { label: string; onClick: () => void }
}) {
  return (
    <div className="rounded-3xl border border-dashed border-slate-300/80 px-5 py-9 text-center">
      <Icon className="mx-auto mb-2.5 h-7 w-7 text-slate-300" />
      <p className="text-[13px] font-bold text-slate-600">{title}</p>
      <p className="mx-auto mt-1 max-w-[260px] text-[11.5px] leading-relaxed text-slate-400">{text}</p>
      {action && <button onClick={action.onClick} className="mt-3 rounded-xl bg-slate-900 px-3 py-1.5 text-[11.5px] font-bold text-white">{action.label}</button>}
    </div>
  )
}

function Title({ children, aside }: { children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <div className="mb-2.5 flex items-center justify-between gap-2 px-0.5">
      <h3 className="text-[15px] font-extrabold tracking-tight text-slate-900">{children}</h3>
      {aside && <span className="shrink-0 text-[11px] font-semibold text-slate-400">{aside}</span>}
    </div>
  )
}

function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-2xl bg-white p-3 shadow-[0_1px_2px_rgba(15,23,42,0.05)] ring-1 ring-slate-200/70 ${className}`}>{children}</div>
}

function Chip({ children, tone = 'slate' }: { children: React.ReactNode; tone?: 'slate' | 'emerald' | 'amber' | 'rose' | 'blue' | 'violet' }) {
  const tones = {
    slate: 'bg-slate-100 text-slate-600', emerald: 'bg-emerald-50 text-emerald-700', amber: 'bg-amber-50 text-amber-700',
    rose: 'bg-rose-50 text-rose-600', blue: 'bg-blue-50 text-blue-700', violet: 'bg-violet-50 text-violet-700',
  }
  return <span className={`inline-flex max-w-full items-center gap-1 truncate rounded-full px-2 py-0.5 text-[10px] font-bold ${tones[tone]}`}>{children}</span>
}

/** Call + open-chat buttons for a contact. Only real-looking numbers get a chat button. */
function ContactActions({ raw, activePhone, onOpenChat }: { raw: string | null; activePhone?: string; onOpenChat?: (phone: string) => void }) {
  const number = digits(raw)
  if (number.length < 7) return null
  return (
    <span className="flex shrink-0 gap-1">
      <a href={`tel:+${number}`} title={`Call +${number}`} aria-label={`Call +${number}`} className="grid h-7 w-7 place-items-center rounded-lg bg-slate-100 text-slate-600 transition hover:bg-slate-200">
        <Phone className="h-3.5 w-3.5" />
      </a>
      {onOpenChat && number !== activePhone && (
        <button onClick={() => onOpenChat(number)} title="Open their chat" aria-label={`Open chat with +${number}`} className="grid h-7 w-7 place-items-center rounded-lg bg-emerald-50 text-emerald-700 transition hover:bg-emerald-100">
          <MessageCircle className="h-3.5 w-3.5" />
        </button>
      )}
    </span>
  )
}

// ── Overview ────────────────────────────────────────────────────────────────

function phaseLine(t: TripContext) {
  if (t.phase === 'upcoming') return t.daysToGo === 1 ? 'Arrives tomorrow' : `Arrives in ${t.daysToGo} days`
  if (t.phase === 'ended') return 'Trip completed'
  return `On tour · Day ${t.tripDay} of ${t.tripDays}`
}

/** The trip as a boarding pass; the plane sits at today's point on the route. */
function BoardingPass({ t }: { t: TripContext }) {
  const progress = t.phase === 'upcoming' ? 0 : t.phase === 'ended' ? 1 : (t.tripDay - 0.5) / t.tripDays
  const [x0, y0, cx, cy, x1, y1] = [10, 50, 150, -14, 290, 50]
  const at = (p: number) => ({
    x: (1 - p) ** 2 * x0 + 2 * (1 - p) * p * cx + p ** 2 * x1,
    y: (1 - p) ** 2 * y0 + 2 * (1 - p) * p * cy + p ** 2 * y1,
  })
  const plane = at(progress)
  const angle = Math.atan2(
    2 * (1 - progress) * (cy - y0) + 2 * progress * (y1 - cy),
    2 * (1 - progress) * (cx - x0) + 2 * progress * (x1 - cx),
  ) * 180 / Math.PI
  const arc = `M${x0} ${y0} Q${cx} ${cy} ${x1} ${y1}`
  const pax = [
    `${t.pax.adults} adult${t.pax.adults === 1 ? '' : 's'}`,
    t.pax.children ? `${t.pax.children} child${t.pax.children === 1 ? '' : 'ren'}` : '',
    t.pax.infants ? `${t.pax.infants} infant${t.pax.infants === 1 ? '' : 's'}` : '',
  ].filter(Boolean).join(', ')

  return (
    <div className="relative overflow-hidden rounded-3xl bg-[#0a2b24] text-white shadow-xl shadow-emerald-950/20">
      <div className="pointer-events-none absolute -right-12 -top-14 h-44 w-44 rounded-full bg-amber-400/25 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-16 -left-10 h-44 w-44 rounded-full bg-emerald-400/20 blur-3xl" />

      <div className="relative px-4 pb-3 pt-3.5">
        <div className="flex items-center justify-between gap-2">
          <p className="truncate text-[10.5px] font-bold uppercase tracking-[0.14em] text-emerald-200/80">
            {t.destination || (t.operationCountry ? countryLabel(t.operationCountry) : 'Trip')}
          </p>
          <span className="shrink-0 rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-bold text-amber-200 ring-1 ring-white/15">{STATUS_LABELS[t.status]}</span>
        </div>
        <p className="mt-1 truncate text-[19px] font-extrabold leading-tight tracking-tight" title={t.leadName ?? undefined}>{t.leadName ?? 'Lead guest not set'}</p>
        <p className="mt-0.5 text-[11.5px] font-semibold text-amber-300">{phaseLine(t)}</p>

        <svg viewBox="0 0 300 62" className="mt-2 w-full" role="img" aria-label={phaseLine(t)}>
          <defs><clipPath id="trip-done"><rect x="0" y="-20" width={plane.x} height="90" /></clipPath></defs>
          <path d={arc} fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth="1.5" strokeDasharray="2 5" strokeLinecap="round" />
          <path d={arc} fill="none" stroke="#fbbf24" strokeWidth="2" strokeLinecap="round" clipPath="url(#trip-done)" />
          <circle cx={x0} cy={y0} r="3.5" fill="#fbbf24" />
          <circle cx={x1} cy={y1} r="3.5" fill={t.phase === 'ended' ? '#fbbf24' : 'rgba(255,255,255,0.35)'} />
          <g transform={`translate(${plane.x} ${plane.y}) rotate(${angle})`}>
            <circle r="11" fill="#fbbf24" opacity="0.18" />
            <path d="M-8 -6 L10 0 L-8 6 L-4 0 Z" fill="#fff" />
          </g>
        </svg>

        <div className="-mt-1 flex items-end justify-between">
          <div>
            <p className="text-[9.5px] font-bold uppercase tracking-wider text-white/50">Arrival</p>
            <p className="text-[13px] font-bold">{longDay(t.arrivalDate)}</p>
          </div>
          <div className="text-right">
            <p className="text-[9.5px] font-bold uppercase tracking-wider text-white/50">Departure</p>
            <p className="text-[13px] font-bold">{longDay(t.departureDate)}</p>
          </div>
        </div>
      </div>

      {/* tear line */}
      <div className="relative">
        <span className="absolute -left-2.5 -top-2.5 h-5 w-5 rounded-full bg-[#f5f7f6]" />
        <span className="absolute -right-2.5 -top-2.5 h-5 w-5 rounded-full bg-[#f5f7f6]" />
        <div className="mx-4 border-t border-dashed border-white/25" />
      </div>

      <div className="relative grid grid-cols-3 gap-2 px-4 py-2.5">
        <Stub label="File" value={t.isNumber ?? t.bookingRef} mono />
        <Stub label="Nights" value={String(t.nights)} />
        <Stub label="Guests" value={pax} small />
      </div>
    </div>
  )
}

function Stub({ label, value, mono, small }: { label: string; value: string; mono?: boolean; small?: boolean }) {
  return (
    <div className="min-w-0">
      <p className="text-[9px] font-bold uppercase tracking-wider text-white/50">{label}</p>
      <p title={value} className={`truncate font-bold ${small ? 'text-[11px] leading-5' : 'text-[13px]'} ${mono ? 'font-mono' : ''}`}>{value}</p>
    </div>
  )
}

function Overview({ trip: t, jump, onOpenChat, phone }: { trip: TripContext; jump: (s: Section) => void; onOpenChat: (p: string) => void; phone: string }) {
  const focusDay = t.phase === 'ended' ? null : t.agenda.find(d => d.date >= t.today) ?? null
  const isToday = focusDay?.date === t.today
  const stay = t.stays.find(s => s.current)
  const bought = t.tickets.filter(k => k.status === 'PURCHASED' || k.status === 'PAID').length

  const tiles: { section: Section; icon: typeof Plane; value: string; label: string; warn?: boolean }[] = [
    { section: 'team',    icon: CarFront, value: `${t.coverage.covered}/${t.coverage.total}`, label: 'Drivers set', warn: t.coverage.covered < t.coverage.total },
    { section: 'flights', icon: Plane,    value: String(t.flights.length), label: 'Flights' },
    { section: 'stays',   icon: BedDouble, value: String(t.stays.length),  label: 'Hotels' },
    { section: 'tickets', icon: Ticket,   value: t.tickets.length ? `${bought}/${t.tickets.length}` : '0', label: 'Tickets', warn: bought < t.tickets.length },
  ]

  return (
    <div className="space-y-2.5">
      <BoardingPass t={t} />

      {t.specialOccasions && (
        <div className="flex items-start gap-2 rounded-2xl bg-gradient-to-r from-rose-50 to-amber-50 px-3 py-2 ring-1 ring-rose-100">
          <Star className="mt-0.5 h-3.5 w-3.5 shrink-0 fill-amber-400 text-amber-400" />
          <p className="text-[11.5px] font-semibold leading-snug text-slate-700">{t.specialOccasions}</p>
        </div>
      )}

      <div className="grid grid-cols-4 gap-1.5">
        {tiles.map(tile => {
          const Icon = tile.icon
          return (
            <button key={tile.section} onClick={() => jump(tile.section)} className="rounded-2xl bg-white px-1 py-2 text-center ring-1 ring-slate-200/70 transition hover:-translate-y-0.5 hover:shadow-md">
              <Icon className={`mx-auto h-3.5 w-3.5 ${tile.warn ? 'text-amber-500' : 'text-emerald-600'}`} />
              <p className="mt-0.5 text-[14px] font-extrabold leading-tight text-slate-900">{tile.value}</p>
              <p className="truncate text-[9.5px] font-semibold text-slate-400">{tile.label}</p>
            </button>
          )
        })}
      </div>

      {focusDay && (
        <Card>
          <div className="mb-2 flex items-center justify-between">
            <p className="flex items-center gap-1.5 text-[12.5px] font-extrabold text-slate-900">
              {isToday && (
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-70" />
                  <span className="relative h-2 w-2 rounded-full bg-emerald-500" />
                </span>
              )}
              {isToday ? 'Today' : 'Next up'}
              <span className="font-semibold text-slate-400">· {longDay(focusDay.date)}</span>
            </p>
            <button onClick={() => jump('agenda')} className="text-[11px] font-bold text-emerald-700 hover:underline">Full agenda</button>
          </div>
          <div className="space-y-2">
            {focusDay.items.map(i => <MovementRow key={i.id} m={i} />)}
          </div>
        </Card>
      )}

      {stay && (
        <Card className="flex items-center gap-2.5">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-blue-50 text-blue-600"><BedDouble className="h-4 w-4" /></span>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Staying tonight</p>
            <p className="truncate text-[12.5px] font-bold text-slate-800">{stay.hotel}</p>
          </div>
          <ContactActions raw={stay.contact} />
        </Card>
      )}

      <Card className="space-y-2">
        <ContactRow role="Guest" name={t.leadName} raw={t.guestContact.whatsapp || t.guestContact.phone} email={t.guestContact.email} phone={phone} onOpenChat={onOpenChat} />
        {(t.agent || t.agentContact.whatsapp || t.agentContact.phone || t.agentContact.email) && (
          <ContactRow role="Agent" name={t.agent} raw={t.agentContact.whatsapp || t.agentContact.phone} email={t.agentContact.email} phone={phone} onOpenChat={onOpenChat} />
        )}
        {(t.fileHandler || t.language || t.cntlNumber || t.dealName) && (
          <div className="flex flex-wrap gap-1 border-t border-slate-100 pt-2">
            {t.fileHandler && <Chip>Handler: {t.fileHandler}</Chip>}
            {t.language && <Chip>Language: {t.language}</Chip>}
            {t.cntlNumber && <Chip>CNTL {t.cntlNumber}</Chip>}
            {t.dealName && <Chip>{t.dealName}</Chip>}
          </div>
        )}
      </Card>

      <button
        onClick={() => { navigator.clipboard?.writeText(t.portal.url); toast.success('Portal link copied') }}
        className="flex w-full items-center gap-2.5 rounded-2xl bg-white px-3 py-2.5 text-left ring-1 ring-slate-200/70 transition hover:bg-emerald-50/50"
      >
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-emerald-50 text-emerald-700"><Globe className="h-4 w-4" /></span>
        <span className="min-w-0 flex-1">
          <span className="block text-[12.5px] font-bold text-slate-800">Client portal</span>
          <span className="block truncate text-[11px] text-slate-400">
            {t.portal.reminderSentAt ? `Ready-to-travel sent ${fmtCallDate(t.portal.reminderSentAt)}`
              : t.portal.welcomeSentAt ? `Welcome sent ${fmtCallDate(t.portal.welcomeSentAt)}`
              : 'Not sent to the guest yet'}
          </span>
        </span>
        <Copy className="h-3.5 w-3.5 shrink-0 text-slate-400" />
      </button>
    </div>
  )
}

function ContactRow({ role, name, raw, email, phone, onOpenChat }: {
  role: string; name: string | null; raw: string | null; email: string | null; phone: string; onOpenChat: (p: string) => void
}) {
  return (
    <div className="flex items-center gap-2">
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{role}</p>
        <p className="truncate text-[12.5px] font-bold text-slate-800">{name || '—'}</p>
        {raw && <p className="truncate text-[11px] text-slate-500">{raw}</p>}
        {email && <a href={`mailto:${email}`} className="flex items-center gap-1 truncate text-[11px] text-slate-500 hover:text-emerald-700"><Mail className="h-3 w-3 shrink-0" /><span className="truncate">{email}</span></a>}
      </div>
      <ContactActions raw={raw} activePhone={phone} onOpenChat={onOpenChat} />
    </div>
  )
}

// ── Itinerary ───────────────────────────────────────────────────────────────

function Itinerary({ trip: t }: { trip: TripContext }) {
  const [open, setOpen] = useState<string | null>(() => (t.itinerary.find(d => d.date === t.today) ?? t.itinerary[0])?.id ?? null)
  if (!t.itinerary.length) return <><Title>Itinerary</Title><Blank icon={Compass} title="No itinerary yet" text="Days appear here once the tour confirmation is read." /></>

  return (
    <>
      <Title aside={`${t.itinerary.length} days`}>Itinerary</Title>
      <ol className="relative space-y-1.5 pl-[30px] before:absolute before:bottom-3 before:left-[13px] before:top-3 before:w-px before:bg-gradient-to-b before:from-emerald-300 before:to-amber-300">
        {t.itinerary.map(d => {
          const isOpen = open === d.id
          const today = d.date === t.today
          const past = d.date < t.today
          const body = d.description || d.inclusions || d.exclusions
          return (
            <li key={d.id} className="relative">
              <span className={`absolute -left-[30px] top-2 grid h-[27px] w-[27px] place-items-center rounded-full text-[10.5px] font-extrabold ring-4 ring-[#f5f7f6] ${today ? 'bg-amber-400 text-amber-950' : past ? 'bg-emerald-600 text-white' : 'bg-white text-slate-600 shadow-sm'}`}>
                {past ? <Check className="h-3.5 w-3.5" /> : d.dayNo}
              </span>
              <div className={`overflow-hidden rounded-2xl bg-white ring-1 ${today ? 'ring-amber-300' : 'ring-slate-200/70'}`}>
                <button onClick={() => setOpen(isOpen ? null : d.id)} disabled={!body} className="flex w-full items-start gap-2 px-3 py-2 text-left">
                  <span className="min-w-0 flex-1">
                    <span className="block text-[10.5px] font-bold text-slate-400">{longDay(d.date)}{today ? ' · Today' : ''}</span>
                    <span className="block text-[12.5px] font-bold leading-snug text-slate-800">{d.title}</span>
                  </span>
                  {body && <ChevronDown className={`mt-1 h-3.5 w-3.5 shrink-0 text-slate-400 transition ${isOpen ? 'rotate-180' : ''}`} />}
                </button>
                <AnimatePresence initial={false}>
                  {isOpen && body && (
                    <motion.div initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }} className="overflow-hidden">
                      <div className="space-y-1.5 px-3 pb-2.5 text-[11.5px] leading-relaxed text-slate-600">
                        {d.description && <p className="whitespace-pre-line">{d.description}</p>}
                        {d.inclusions && <p className="whitespace-pre-line"><span className="font-bold text-emerald-700">Includes: </span>{d.inclusions}</p>}
                        {d.exclusions && <p className="whitespace-pre-line"><span className="font-bold text-rose-600">Excludes: </span>{d.exclusions}</p>}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </li>
          )
        })}
      </ol>
    </>
  )
}

// ── Agenda ──────────────────────────────────────────────────────────────────

function MovementRow({ m }: { m: TripMovement }) {
  const route = m.from && m.to ? `${m.from} → ${m.to}` : m.to || m.from || m.location
  return (
    <div className="flex gap-2.5">
      <div className="w-[58px] shrink-0 pt-px text-[10.5px] font-extrabold leading-tight text-slate-700">{m.time || (m.leisure ? 'Leisure' : '—')}</div>
      <div className="min-w-0 flex-1">
        <p className="text-[12px] font-semibold leading-snug text-slate-800">{route}</p>
        {m.details && <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-slate-500">{m.details}</p>}
        <div className="mt-1 flex flex-wrap gap-1">
          <Chip tone="blue">{m.service}</Chip>
          {m.meal && <Chip tone="emerald"><Utensils className="h-2.5 w-2.5" />{m.meal}</Chip>}
          {m.driver?.name && <Chip><CarFront className="h-2.5 w-2.5" />{m.driver.name}</Chip>}
          {m.guide && <Chip tone="violet"><UserRound className="h-2.5 w-2.5" />{m.guide}</Chip>}
          {!m.driver?.name && m.vendor && <Chip>{m.vendor}</Chip>}
          {m.needsCover && <Chip tone="amber"><AlertTriangle className="h-2.5 w-2.5" />No driver yet</Chip>}
        </div>
      </div>
    </div>
  )
}

function AgendaDay({ d, today }: { d: TripAgendaDay; today: boolean }) {
  return (
    <div data-today={today || undefined}>
      <p className={`sticky top-[-12px] z-[2] -mx-0.5 mb-1.5 flex items-center gap-1.5 rounded-lg bg-[#f5f7f6]/95 px-1 py-1 text-[11.5px] font-extrabold backdrop-blur ${today ? 'text-amber-600' : 'text-slate-500'}`}>
        <CalendarClock className="h-3.5 w-3.5" /> {longDay(d.date)}{today ? ' · Today' : ''}
      </p>
      <Card className={`space-y-2.5 ${today ? 'ring-amber-300' : ''}`}>
        {d.items.map(i => <MovementRow key={i.id} m={i} />)}
      </Card>
    </div>
  )
}

function Agenda({ trip: t }: { trip: TripContext }) {
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    box.current?.querySelector('[data-today]')?.scrollIntoView({ block: 'start' })
  }, [])
  if (!t.agenda.length) return <><Title>Agenda</Title><Blank icon={Route} title="No agenda yet" text="Movements appear here once the movement chart is generated." /></>
  return (
    <div ref={box}>
      <Title aside={<Link href={`/dashboard/bookings/${t.bookingRef}/agenda`} target="_blank" className="text-emerald-700 hover:underline">Open chart</Link>}>Agenda</Title>
      <div className="space-y-3">
        {t.agenda.map(d => <AgendaDay key={d.date} d={d} today={d.date === t.today} />)}
      </div>
    </div>
  )
}

// ── Guests ──────────────────────────────────────────────────────────────────

function Guests({ trip: t, onOpenChat, phone }: { trip: TripContext; onOpenChat: (p: string) => void; phone: string }) {
  if (!t.passengers.length) return <><Title>Passengers</Title><Blank icon={Users} title="No passengers yet" text="Names appear here once the tour confirmation is read." /></>
  return (
    <>
      <Title aside={`${t.passengers.length} on file`}>Passengers</Title>
      <div className="space-y-1.5">
        {t.passengers.map(p => (
          <Card key={p.id} className="flex items-center gap-2.5 !py-2.5">
            <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full text-[12px] font-extrabold ${p.isLead ? 'bg-gradient-to-br from-amber-300 to-amber-500 text-amber-950' : 'bg-slate-100 text-slate-500'}`}>
              {p.name.trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase()}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[12.5px] font-bold text-slate-800" title={p.name}>{p.name}</p>
              <div className="mt-0.5 flex flex-wrap gap-1">
                {p.isLead && <Chip tone="amber">Lead</Chip>}
                <Chip>{p.type.charAt(0) + p.type.slice(1).toLowerCase()}{p.age != null ? ` · ${p.age}` : ''}</Chip>
                {p.nationality && <Chip>{p.nationality}</Chip>}
                {p.mealPreference && <Chip tone="emerald"><Utensils className="h-2.5 w-2.5" />{p.mealPreference}</Chip>}
              </div>
            </div>
            <ContactActions raw={p.contact} activePhone={phone} onOpenChat={onOpenChat} />
          </Card>
        ))}
      </div>
    </>
  )
}

// ── Flights ─────────────────────────────────────────────────────────────────

function Flights({ trip: t }: { trip: TripContext }) {
  if (!t.flights.length) return <><Title>Flights</Title><Blank icon={Plane} title="No flights on file" text="This booking has no flight details yet." /></>
  return (
    <>
      <Title aside={`${t.flights.length} sector${t.flights.length === 1 ? '' : 's'}`}>Flights</Title>
      <div className="space-y-2">
        {t.flights.map(f => (
          <div key={f.id} className="overflow-hidden rounded-2xl bg-white ring-1 ring-slate-200/70">
            <div className="flex items-center justify-between gap-2 bg-slate-900 px-3 py-1.5 text-white">
              <span className="truncate text-[11.5px] font-bold"><span className="font-mono">{f.flightNo}</span>{f.airline ? ` · ${f.airline}` : ''}</span>
              <span className={`shrink-0 text-[10.5px] font-semibold ${f.date === t.today ? 'text-amber-300' : 'text-white/60'}`}>{f.date === t.today ? 'Today' : longDay(f.date)}</span>
            </div>
            <div className="flex items-center gap-2 px-3 py-2.5">
              <div className="min-w-0">
                <p className="truncate font-mono text-[19px] font-extrabold leading-none tracking-tight text-slate-900">{f.fromApt}</p>
                <p className="mt-1 text-[11.5px] font-bold text-slate-500">{f.depTime}</p>
              </div>
              <div className="flex min-w-[40px] flex-1 items-center gap-1 text-emerald-500">
                <span className="h-px flex-1 border-t border-dashed border-slate-300" />
                <Plane className="h-3.5 w-3.5 rotate-45" />
                <span className="h-px flex-1 border-t border-dashed border-slate-300" />
              </div>
              <div className="min-w-0 text-right">
                <p className="truncate font-mono text-[19px] font-extrabold leading-none tracking-tight text-slate-900">{f.toApt}</p>
                <p className="mt-1 text-[11.5px] font-bold text-slate-500">{f.arrTime}</p>
              </div>
            </div>
            {f.notes && <p className="border-t border-dashed border-slate-200 px-3 py-1.5 text-[11px] text-slate-500">{f.notes}</p>}
          </div>
        ))}
      </div>
    </>
  )
}

// ── Stays ───────────────────────────────────────────────────────────────────

function Stays({ trip: t }: { trip: TripContext }) {
  if (!t.stays.length) return <><Title>Accommodation</Title><Blank icon={BedDouble} title="No hotels on file" text="This booking has no accommodation yet." /></>
  return (
    <>
      <Title aside={`${t.stays.reduce((n, s) => n + s.nights, 0)} nights`}>Accommodation</Title>
      <div className="space-y-2">
        {t.stays.map(s => (
          <Card key={s.id} className={s.current ? '!ring-2 !ring-emerald-400' : ''}>
            <div className="flex items-start gap-2.5">
              <div className="w-[46px] shrink-0 rounded-xl bg-gradient-to-b from-blue-500 to-indigo-700 py-1.5 text-center text-white">
                <p className="text-[16px] font-extrabold leading-none">{s.nights}</p>
                <p className="mt-0.5 text-[8.5px] font-bold uppercase tracking-wide text-white/75">night{s.nights === 1 ? '' : 's'}</p>
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[12.5px] font-bold leading-snug text-slate-800">{s.hotel}</p>
                <p className="flex items-center gap-1 text-[11px] text-slate-500"><MapPin className="h-3 w-3 shrink-0" />{s.city}</p>
                <p className="mt-0.5 text-[11px] font-semibold text-slate-600">{shortDay(s.checkIn)} → {shortDay(s.checkOut)}</p>
              </div>
            </div>
            {(s.current || s.roomType || s.mealType || s.ownArrangement) && (
              <div className="mt-2 flex flex-wrap gap-1">
                {s.current && <Chip tone="emerald">Staying now</Chip>}
                {s.roomType && <Chip>{s.roomType}</Chip>}
                {s.mealType && <Chip tone="emerald"><Utensils className="h-2.5 w-2.5" />{s.mealType}</Chip>}
                {s.ownArrangement && <Chip tone="amber">Own arrangement</Chip>}
              </div>
            )}
            {(s.address || s.contact) && (
              <div className="mt-2 border-t border-slate-100 pt-1.5 text-[11px] leading-snug text-slate-500">
                {s.address && <p>{s.address}</p>}
                {s.contact && <p className="font-semibold text-slate-600">{s.contact}</p>}
              </div>
            )}
          </Card>
        ))}
      </div>
    </>
  )
}

// ── Package & notes ─────────────────────────────────────────────────────────

function PackageNotes({ trip: t }: { trip: TripContext }) {
  const [open, setOpen] = useState<string | null>(t.notes[0]?.key ?? null)
  if (!t.notes.length) return <><Title>Package &amp; notes</Title><Blank icon={Package} title="No package notes" text="Inclusions, terms and client requests appear here once they are on the booking." /></>
  return (
    <>
      <Title>Package &amp; notes</Title>
      <div className="space-y-1.5">
        {t.notes.map(n => {
          const isOpen = open === n.key
          const important = n.key === 'clientRequest' || n.key === 'importantNotes'
          return (
            <div key={n.key} className={`overflow-hidden rounded-2xl bg-white ring-1 ${important ? 'ring-amber-200' : 'ring-slate-200/70'}`}>
              <button onClick={() => setOpen(isOpen ? null : n.key)} aria-expanded={isOpen} className="flex w-full items-center gap-2 px-3 py-2.5 text-left">
                <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${important ? 'bg-amber-400' : 'bg-emerald-400'}`} />
                <span className="min-w-0 flex-1 truncate text-[12.5px] font-bold text-slate-800">{n.label}</span>
                <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-slate-400 transition ${isOpen ? 'rotate-180' : ''}`} />
              </button>
              <AnimatePresence initial={false}>
                {isOpen && (
                  <motion.div initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }} className="overflow-hidden">
                    <p className="whitespace-pre-line break-words px-3 pb-3 text-[11.5px] leading-relaxed text-slate-600">{n.text}</p>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )
        })}
      </div>
    </>
  )
}

// ── Drivers & team ──────────────────────────────────────────────────────────

const KIND_LOOK: Record<TripPersonKind, { label: string; icon: typeof Plane; tone: string }> = {
  DRIVER: { label: 'Driver',      icon: CarFront,   tone: 'from-emerald-500 to-teal-700' },
  GUIDE:  { label: 'Guide',       icon: UserRound,  tone: 'from-violet-500 to-indigo-700' },
  VENDOR: { label: 'Tour vendor', icon: Compass,    tone: 'from-amber-400 to-orange-600' },
}

function PersonCard({ p, onOpenChat }: { p: TripPerson; onOpenChat: (phone: string) => void }) {
  const look = KIND_LOOK[p.kind]
  const Icon = look.icon
  const days = p.dates.length === 1 ? shortDay(p.dates[0]) : `${p.dates.length} days · ${shortDay(p.dates[0])} → ${shortDay(p.dates[p.dates.length - 1])}`
  return (
    <Card className={p.onToday ? '!ring-2 !ring-emerald-400' : ''}>
      <div className="flex items-center gap-2.5">
        <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-gradient-to-br text-white ${look.tone}`}><Icon className="h-[18px] w-[18px]" /></span>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{look.label}{p.onToday ? ' · Today' : ''}</p>
          <p className="truncate text-[12.5px] font-bold text-slate-800" title={p.name}>{p.name}</p>
          {p.phone && <p className="truncate text-[11px] text-slate-500">{p.phone}</p>}
        </div>
        <ContactActions raw={p.phone} onOpenChat={onOpenChat} />
      </div>
      <div className="mt-2 flex flex-wrap gap-1">
        <Chip tone="blue">{days}</Chip>
        {p.vehicles.map(v => <Chip key={v}><CarFront className="h-2.5 w-2.5" />{v}</Chip>)}
        {p.company && <Chip>{p.company}</Chip>}
      </div>
    </Card>
  )
}

function Team({ trip: t, onOpenChat }: { trip: TripContext; onOpenChat: (p: string) => void }) {
  return (
    <>
      <Title aside={t.coverage.total ? `${t.coverage.covered}/${t.coverage.total} movements covered` : undefined}>Drivers &amp; contacts</Title>
      {t.people.length === 0 && !t.chauffeurContact ? (
        <Blank icon={CarFront} title="Nobody assigned yet" text="Drivers, guides and vendors appear here once they are allocated on the movement chart." />
      ) : (
        <div className="space-y-2">
          {t.people.map(p => <PersonCard key={p.key} p={p} onOpenChat={onOpenChat} />)}
          {t.chauffeurContact && (
            <Card>
              <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Chauffeur note</p>
              <p className="mt-0.5 whitespace-pre-line text-[11.5px] leading-relaxed text-slate-600">{t.chauffeurContact}</p>
            </Card>
          )}
        </div>
      )}
    </>
  )
}

// ── Tickets ─────────────────────────────────────────────────────────────────

const TICKET_TONE: Record<string, 'emerald' | 'amber' | 'slate'> = { PURCHASED: 'emerald', PAID: 'emerald', DRAFT: 'slate' }

function Tickets({ trip: t }: { trip: TripContext }) {
  if (!t.tickets.length) return <><Title>Tickets</Title><Blank icon={Ticket} title="No tickets yet" text="Bought and planned tickets appear here with their files." /></>
  return (
    <>
      <Title aside={<Link href={`/dashboard/bookings/${t.bookingRef}/tickets`} target="_blank" className="text-emerald-700 hover:underline">Manage</Link>}>Tickets</Title>
      <div className="space-y-2">
        {t.tickets.map(k => {
          const file = normalizeUploadUrl(k.fileUrl)
          return (
            <div key={k.id} className="flex overflow-hidden rounded-2xl bg-white ring-1 ring-slate-200/70">
              <div className="min-w-0 flex-1 p-3">
                <p className="truncate text-[12.5px] font-bold text-slate-800">{k.label}</p>
                {(k.location || k.date) && (
                  <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-slate-500">{[k.date && shortDay(k.date), k.location].filter(Boolean).join(' · ')}</p>
                )}
                <div className="mt-1.5 flex flex-wrap gap-1">
                  <Chip tone={TICKET_TONE[k.status] ?? 'amber'}>{k.status.charAt(0) + k.status.slice(1).toLowerCase().replace(/_/g, ' ')}</Chip>
                  {k.supplier && <Chip>{k.supplier}</Chip>}
                  {k.reference && <Chip tone="blue">Ref {k.reference}</Chip>}
                </div>
              </div>
              <div className="relative flex w-[58px] shrink-0 flex-col items-center justify-center gap-0.5 border-l border-dashed border-slate-300 bg-slate-50">
                <span className="absolute -left-1.5 -top-1.5 h-3 w-3 rounded-full bg-[#f5f7f6] ring-1 ring-slate-200/70" />
                <span className="absolute -bottom-1.5 -left-1.5 h-3 w-3 rounded-full bg-[#f5f7f6] ring-1 ring-slate-200/70" />
                <span className="text-[15px] font-extrabold leading-none text-slate-800">×{k.qty}</span>
                {file ? (
                  <a href={file} target="_blank" rel="noopener noreferrer" title={k.fileName ?? 'Open ticket'} className="mt-1 inline-flex items-center gap-0.5 rounded-lg bg-emerald-600 px-1.5 py-1 text-[9.5px] font-bold text-white transition hover:bg-emerald-700">
                    <Download className="h-3 w-3" /> Open
                  </a>
                ) : <span className="text-[9px] font-semibold text-slate-400">No file</span>}
              </div>
            </div>
          )
        })}
      </div>
    </>
  )
}

// ── AI calls ────────────────────────────────────────────────────────────────

function CallCard({ rec }: { rec: TranscriptRecord }) {
  const [open, setOpen] = useState(false)
  const meta = KIND_META[rec.kind]
  const Icon = meta.icon
  const sentiment = rec.sentiment ? SENTIMENT_META[rec.sentiment] : null
  const change = typeof rec.detail.requested_change === 'string' ? rec.detail.requested_change : null
  const issues = typeof rec.detail.issues === 'string' ? rec.detail.issues : null

  return (
    <Card>
      <div className="flex items-center gap-2">
        <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-xl ${meta.solid}`}><Icon className="h-4 w-4 text-white" /></span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[12.5px] font-bold text-slate-800">{meta.short}{rec.kind === 'on_tour' && rec.day_no != null ? ` · Day ${rec.day_no}` : ''}</p>
          <p className="text-[10.5px] text-slate-400">{fmtCallDate(rec.at)}</p>
        </div>
        {rec.rating != null && <span className="inline-flex items-center gap-0.5 text-[12px] font-extrabold text-amber-500"><Star className="h-3 w-3 fill-amber-400 text-amber-400" />{rec.rating}/10</span>}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1">
        <FeedbackClassBadge rec={rec} />
        {sentiment && <Chip>{sentiment.emoji} {sentiment.label}</Chip>}
        {rec.outcome && <Chip>{OUTCOME_LABEL[rec.outcome] ?? rec.outcome}</Chip>}
      </div>
      {rec.summary && <p className="mt-2 text-[11.5px] leading-relaxed text-slate-600">{rec.summary}</p>}
      {change && <p className="mt-2 rounded-xl bg-amber-50 px-2.5 py-1.5 text-[11.5px] leading-snug text-amber-800"><span className="font-bold">Requested change: </span>{change}</p>}
      {issues && <p className="mt-2 rounded-xl bg-rose-50 px-2.5 py-1.5 text-[11.5px] leading-snug text-rose-700"><span className="font-bold">Issue: </span>{issues}</p>}
      {rec.conversation_id && <div className="mt-2.5"><CallRecordingPlayer conversationId={rec.conversation_id} /></div>}
      {rec.transcript_turns > 0 && (
        <>
          <button onClick={() => setOpen(o => !o)} aria-expanded={open} className="mt-2 inline-flex items-center gap-1 text-[11px] font-bold text-violet-600 hover:underline">
            <ChevronDown className={`h-3 w-3 transition ${open ? 'rotate-180' : ''}`} />
            {open ? 'Hide transcript' : `Read transcript (${rec.transcript_turns})`}
          </button>
          {open && <div className="mt-2 rounded-xl bg-slate-50 p-2 ring-1 ring-slate-100"><TranscriptChat transcript={rec.transcript} conversationId={rec.conversation_id} /></div>}
        </>
      )}
    </Card>
  )
}

function Calls({ trip: t }: { trip: TripContext }) {
  const [records, setRecords] = useState<TranscriptRecord[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  const load = useCallback((signal: AbortSignal) => {
    setError(null)
    fetch(`/api/te/transcripts?ref=${encodeURIComponent(t.bookingRef)}&limit=100`, { signal })
      .then(r => r.json())
      .then(json => {
        if (json.success) setRecords(json.data.records ?? [])
        else setError(json.error ?? 'Could not load the calls')
      })
      .catch(err => { if (err?.name !== 'AbortError') setError('Could not load the calls') })
  }, [t.bookingRef])

  useEffect(() => {
    if (!t.can.viewCalls) return
    const ctrl = new AbortController()
    load(ctrl.signal)
    return () => ctrl.abort()
  }, [load, attempt, t.can.viewCalls])

  const tally = useMemo(() => {
    const n = { good: 0, warning: 0, bad: 0 }
    for (const r of records ?? []) if (r.feedback_class in n) n[r.feedback_class as keyof typeof n] += 1
    return n
  }, [records])

  if (!t.can.viewCalls) return <><Title>AI calls</Title><Blank icon={PhoneCall} title="Not available on your login" text="AI call feedback is open to the booking, ground and travel-experience teams." /></>
  if (error) return <><Title>AI calls</Title><Blank icon={AlertTriangle} title="Could not load the calls" text={error} action={{ label: 'Try again', onClick: () => setAttempt(a => a + 1) }} /></>
  if (!records) return <><Title>AI calls</Title><div className="grid place-items-center py-10"><Loader2 className="h-5 w-5 animate-spin text-violet-400" /></div></>
  if (!records.length) return <><Title>AI calls</Title><Blank icon={PhoneCall} title="No AI calls yet" text="Reconfirmation, on-tour and post-tour calls appear here with their recordings." /></>

  return (
    <>
      <Title aside={`${records.length} call${records.length === 1 ? '' : 's'}`}>AI calls</Title>
      {(tally.good + tally.warning + tally.bad > 0) && (
        <div className="mb-2 flex gap-1">
          {tally.good > 0 && <Chip tone="emerald">{tally.good} good</Chip>}
          {tally.warning > 0 && <Chip tone="amber">{tally.warning} warning</Chip>}
          {tally.bad > 0 && <Chip tone="rose">{tally.bad} bad</Chip>}
        </div>
      )}
      <div className="space-y-2">
        {records.map(r => <CallCard key={r.uid} rec={r} />)}
      </div>
    </>
  )
}

