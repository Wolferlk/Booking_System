'use client'

/**
 * Driver / vendor side of the WhatsApp trip panel. Shown when the open chat is
 * a driver (drivers table or tagged driver sends) or a vehicle vendor:
 *
 *   Driver → profile + photo, driver-app status, live day, current trip,
 *            upcoming trips, past trips with guest feedback, vehicle photos.
 *   Vendor → profile, fleet (drivers + app status), vehicles with photos,
 *            today's / upcoming jobs, past jobs with guest feedback.
 *
 * Read-only; data from /api/whatsapp/partner (lib/whatsapp-partner-context.ts).
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { AnimatePresence, motion } from 'framer-motion'
import {
  AlertTriangle, BedDouble, Bell, BellOff, CalendarClock, CarFront, Check, ChevronDown, ClipboardCheck, ExternalLink,
  History, BadgeCheck, ImageOff, Mail, MapPin, MessageCircle, MessageSquareQuote, Navigation, PauseCircle,
  Phone, RefreshCw, Smartphone, Star, UserRound, Users, X,
} from 'lucide-react'
import { STATUS_COLORS, STATUS_LABELS } from '@/lib/state-machine'
import { countryFlag, countryLabel } from '@/lib/country-detection'
import type { OperationCountry } from '@prisma/client'
import type {
  DriverProfile, FeedbackStats, PartnerApp, PartnerFeedback, PartnerProfile, PartnerResponse, PartnerTrip,
  PartnerVehicle, VendorProfile,
} from '@/lib/whatsapp-partner-context'
import type { FeedbackRating } from '@prisma/client'

type DriverSection = 'profile' | 'now' | 'upcoming' | 'past' | 'vehicle'
type VendorSection = 'profile' | 'now' | 'upcoming' | 'past' | 'fleet' | 'vehicles'
type Section = DriverSection | VendorSection

const DRIVER_SECTIONS: { key: DriverSection; label: string; icon: typeof CarFront }[] = [
  { key: 'profile',  label: 'Profile',  icon: UserRound },
  { key: 'now',      label: 'Now',      icon: Navigation },
  { key: 'upcoming', label: 'Upcoming', icon: CalendarClock },
  { key: 'past',     label: 'Past',     icon: History },
  { key: 'vehicle',  label: 'Vehicle',  icon: CarFront },
]
const VENDOR_SECTIONS: { key: VendorSection; label: string; icon: typeof CarFront }[] = [
  { key: 'profile',  label: 'Vendor',   icon: UserRound },
  { key: 'now',      label: 'Today',    icon: Navigation },
  { key: 'upcoming', label: 'Upcoming', icon: CalendarClock },
  { key: 'past',     label: 'Past',     icon: History },
  { key: 'fleet',    label: 'Drivers',  icon: Users },
  { key: 'vehicles', label: 'Vehicles', icon: CarFront },
]

// Calendar days format in UTC so a desk west of the trip doesn't read the day before.
const dayFmt = (day: string, opts: Intl.DateTimeFormatOptions) =>
  new Date(`${day}T00:00:00.000Z`).toLocaleDateString('en-GB', { timeZone: 'UTC', ...opts })
const shortDay = (day: string) => dayFmt(day, { day: 'numeric', month: 'short' })
const longDay = (day: string) => dayFmt(day, { weekday: 'short', day: 'numeric', month: 'short' })
const stamp = (iso: string) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
const flagOf = (c: string) => countryFlag(c as OperationCountry)
const labelOf = (c: string) => countryLabel(c as OperationCountry)
const digits = (raw: string | null | undefined) => (raw ?? '').replace(/\D/g, '')

function ago(iso: string | null | undefined): string {
  if (!iso) return 'never'
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  if (s < 86_400) return `${Math.floor(s / 3600)} h ago`
  const d = Math.floor(s / 86_400)
  return d === 1 ? 'yesterday' : d < 30 ? `${d} days ago` : new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

const RATING_META: Record<FeedbackRating, { label: string; tone: string }> = {
  EXCELLENT: { label: 'Excellent', tone: 'bg-emerald-100 text-emerald-800' },
  GOOD:      { label: 'Good',      tone: 'bg-teal-50 text-teal-700' },
  AVERAGE:   { label: 'Average',   tone: 'bg-amber-100 text-amber-800' },
  POOR:      { label: 'Poor',      tone: 'bg-rose-100 text-rose-700' },
}

const STATE_META: Record<string, { label: string; tone: string }> = {
  NEEDS_DRIVER:  { label: 'Needs driver',  tone: 'bg-rose-100 text-rose-700' },
  NEEDS_VEHICLE: { label: 'Needs vehicle', tone: 'bg-amber-100 text-amber-800' },
  READY:         { label: 'Ready',         tone: 'bg-emerald-50 text-emerald-700' },
  LIVE:          { label: 'On the road',   tone: 'bg-emerald-500 text-white' },
  DONE:          { label: 'Done',          tone: 'bg-slate-100 text-slate-600' },
}

const PAUSE_LABEL: Record<string, string> = {
  MEAL: 'Meal break', FUEL: 'Fuel stop', GUEST_STOP: 'Guest stop', REST: 'Rest', PRAYER: 'Prayer',
  VEHICLE: 'Vehicle issue', PERSONAL: 'Personal', OTHER: 'Paused',
}

// ── Data ────────────────────────────────────────────────────────────────────

export function usePartner(phone: string, enabled: boolean) {
  const [data, setData] = useState<PartnerResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(enabled)
  const [version, setVersion] = useState(0)

  useEffect(() => {
    if (!enabled) return
    const ctrl = new AbortController()
    const timer = setTimeout(async () => {
      setLoading(true)
      try {
        const res = await fetch(`/api/whatsapp/partner?phone=${encodeURIComponent(phone)}`, { signal: ctrl.signal })
        const json = await res.json()
        if (json.success) { setData(json.data); setError(null) } else setError(json.error ?? 'Could not load this profile')
      } catch (err) {
        if ((err as Error)?.name === 'AbortError') return
        setError('Could not load this profile')
      }
      setLoading(false)
    }, 180)
    return () => { clearTimeout(timer); ctrl.abort() }
  }, [phone, enabled, version])

  const refresh = useCallback(() => setVersion(v => v + 1), [])
  return { data, error, loading, refresh }
}

// ── Panel ───────────────────────────────────────────────────────────────────

export function PartnerPanel({ phone, state, onOpenChat }: {
  phone: string
  state: ReturnType<typeof usePartner>
  onOpenChat: (phone: string) => void
}) {
  const { data, error, loading, refresh } = state
  const profiles = useMemo(() => data?.profiles ?? [], [data])
  const [pickedId, setPickedId] = useState<string | null>(null)
  const [section, setSection] = useState<Section>('profile')
  const [photo, setPhoto] = useState<{ url: string; label: string } | null>(null)
  const profile = profiles.find(p => p.id === pickedId) ?? profiles[0] ?? null

  // A driver on the road opens on "Now"; everyone else on their profile.
  const autoKey = profile ? `${profile.kind}:${profile.id}` : ''
  useEffect(() => {
    if (!profile) return
    if (profile.kind === 'DRIVER' && (profile.live || profile.current)) setSection('now')
    else setSection('profile')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoKey])

  const sections = profile?.kind === 'VENDOR' ? VENDOR_SECTIONS : DRIVER_SECTIONS
  const counts: Partial<Record<Section, number>> = !profile ? {} : profile.kind === 'DRIVER' ? {
    now: profile.current ? 1 : 0,
    upcoming: profile.upcoming.length,
    past: profile.past.length,
    vehicle: (profile.vehicle ? 1 : 0) + profile.checks.length,
  } : {
    now: profile.current.length,
    upcoming: profile.upcoming.length,
    past: profile.past.length,
    fleet: profile.drivers.length,
    vehicles: profile.vehicles.length,
  }
  const live = profile?.kind === 'DRIVER' ? !!profile.live : profile?.kind === 'VENDOR' ? profile.stats.liveNow > 0 : false

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* profile header */}
      <div className="relative z-10 flex h-[56px] shrink-0 items-center gap-2 border-b border-slate-200/70 bg-white/90 px-3 backdrop-blur">
        <div className="min-w-0 flex-1 px-1">
          <p className="truncate text-[13.5px] font-extrabold tracking-tight text-slate-900">
            {profile ? profile.name : 'Driver / vendor'}
          </p>
          <p className="truncate text-[10.5px] font-semibold text-slate-400">
            {profile?.kind === 'DRIVER' ? `Driver${profile.vendor ? ` · ${profile.vendor.name}` : ''}` : profile ? 'Vehicle vendor' : loading ? 'Loading…' : ''}
          </p>
        </div>
        <button title="Refresh" aria-label="Refresh" onClick={refresh} className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-slate-800">
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
        {profile && (
          <Link
            href={profile.kind === 'DRIVER' ? '/dashboard/ground/drivers' : '/dashboard/ground/vendors'}
            target="_blank"
            title={profile.kind === 'DRIVER' ? 'Open the drivers list' : 'Open the vendors list'}
            className="grid h-8 w-8 place-items-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
          >
            <ExternalLink className="h-4 w-4" />
          </Link>
        )}
      </div>

      {profiles.length > 1 && (
        <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-slate-200/70 bg-white/70 px-3 py-1.5">
          {profiles.map(p => (
            <button
              key={`${p.kind}:${p.id}`}
              onClick={() => setPickedId(p.id)}
              className={`shrink-0 rounded-full px-2.5 py-1 text-[10.5px] font-bold transition ${p.id === profile?.id ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
            >
              {p.kind === 'DRIVER' ? 'Driver' : 'Vendor'} · {p.name}
            </button>
          ))}
        </div>
      )}

      {!profile ? (
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {loading || (!data && !error) ? (
            <div className="space-y-3">
              <div className="h-48 animate-pulse rounded-3xl bg-slate-200/80" />
              <div className="h-24 animate-pulse rounded-2xl bg-slate-200/60" />
              <div className="h-20 animate-pulse rounded-2xl bg-slate-200/40" />
            </div>
          ) : (
            <Blank
              icon={error ? AlertTriangle : CarFront}
              title={error ? 'Could not load this profile' : 'Not in the drivers or vendors list'}
              text={error ?? 'This number is tagged as a driver from automatic sends, but no driver or vendor in Ground → Drivers / Vendors has it. Add the number there to see their trips and vehicle here.'}
              action={error ? { label: 'Try again', onClick: refresh } : undefined}
            />
          )}
        </div>
      ) : (
        <div className="flex min-h-0 flex-1">
          <nav aria-label="Profile sections" className="flex w-[66px] shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-slate-200/70 bg-white/70 px-1.5 py-2">
            {sections.map(s => {
              const Icon = s.icon
              const on = section === s.key
              const n = counts[s.key]
              const dim = n === 0
              return (
                <button key={s.key} onClick={() => setSection(s.key)} aria-current={on ? 'page' : undefined} className="relative flex shrink-0 flex-col items-center gap-0.5 rounded-xl py-1.5">
                  {on && <motion.span layoutId="partner-rail" className="absolute inset-0 rounded-xl bg-gradient-to-b from-[#0c3b30] to-[#0a2b24] shadow-md shadow-emerald-950/25" transition={{ type: 'spring', stiffness: 500, damping: 38 }} />}
                  <Icon className={`relative h-[18px] w-[18px] ${on ? 'text-amber-300' : dim ? 'text-slate-300' : 'text-slate-500'}`} />
                  <span className={`relative text-[9.5px] font-bold ${on ? 'text-white' : dim ? 'text-slate-300' : 'text-slate-500'}`}>{s.label}</span>
                  {s.key === 'now' && live && !on && <span className="absolute right-1.5 top-1 h-2 w-2 animate-pulse rounded-full bg-emerald-500 ring-2 ring-white" title="On the road now" />}
                  {!!n && !on && !(s.key === 'now' && live) && <span className="absolute right-1 top-0.5 min-w-[14px] rounded-full bg-slate-200 px-1 text-center text-[8.5px] font-bold leading-[14px] text-slate-600">{n}</span>}
                </button>
              )
            })}
          </nav>

          <div className="min-w-0 flex-1 overflow-y-auto px-3 py-3">
            <AnimatePresence mode="wait" initial={false}>
              <motion.div key={`${profile.kind}:${profile.id}:${section}`} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.14 }}>
                {profile.kind === 'DRIVER'
                  ? <DriverBody p={profile} section={section as DriverSection} jump={setSection} onPhoto={setPhoto} />
                  : <VendorBody p={profile} section={section as VendorSection} jump={setSection} onPhoto={setPhoto} onOpenChat={onOpenChat} activePhone={phone} />}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      )}

      <AnimatePresence>
        {photo && (
          <motion.div
            className="fixed inset-0 z-[60] grid place-items-center bg-slate-950/80 p-6 backdrop-blur-sm"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={() => setPhoto(null)}
          >
            <button aria-label="Close photo" className="absolute right-5 top-5 grid h-10 w-10 place-items-center rounded-full bg-white/10 text-white hover:bg-white/20"><X className="h-5 w-5" /></button>
            <motion.figure initial={{ scale: 0.94 }} animate={{ scale: 1 }} className="max-h-full max-w-3xl" onClick={e => e.stopPropagation()}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={photo.url} alt={photo.label} className="max-h-[80vh] rounded-2xl object-contain shadow-2xl" />
              <figcaption className="mt-2 flex items-center justify-between gap-3 text-[12px] font-semibold text-white/80">
                <span>{photo.label}</span>
                <a href={photo.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-white">Open original <ExternalLink className="h-3.5 w-3.5" /></a>
              </figcaption>
            </motion.figure>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

type PhotoFn = (p: { url: string; label: string }) => void

// ── Driver ──────────────────────────────────────────────────────────────────

function DriverBody({ p, section, jump, onPhoto }: { p: DriverProfile; section: DriverSection; jump: (s: Section) => void; onPhoto: PhotoFn }) {
  if (section === 'profile') {
    return (
      <div className="space-y-3">
        <DriverHero p={p} onPhoto={onPhoto} />
        <AppCard app={p.app} />
        {p.live && <LiveCard p={p} onClick={() => jump('now')} />}
        <div className="grid grid-cols-4 gap-1.5">
          <Stat value={p.stats.tripsDone} label="Trips done" hint="last 120 days" onClick={() => jump('past')} />
          <Stat value={p.stats.upcoming} label="Upcoming" onClick={() => jump('upcoming')} />
          <Stat value={p.stats.kmOnApp ? p.stats.kmOnApp.toLocaleString() : '—'} label="Km on app" />
          <Stat value={positiveText(p.stats.feedback.driverRated, p.stats.feedback.driverPositive)} label="Guest rating" hint={`${p.stats.feedback.driverRated} rated`} onClick={() => jump('past')} />
        </div>
        {p.current ? (
          <button onClick={() => jump('now')} className="block w-full text-left"><TripMini t={p.current} label="On this trip now" /></button>
        ) : p.upcoming[0] ? (
          <button onClick={() => jump('upcoming')} className="block w-full text-left"><TripMini t={p.upcoming[0]} label="Next trip" /></button>
        ) : null}
        <FeedbackSummary stats={p.stats.feedback} />
        <Card>
          <Row icon={Phone} label="WhatsApp / phone" value={p.phone} />
          {p.email && <Row icon={Mail} label="Email" value={p.email} />}
          {p.licenseNo && <Row icon={BadgeCheck} label="Licence" value={p.licenseNo} />}
          {p.country && <Row icon={MapPin} label="Country" value={`${flagOf(p.country)} ${labelOf(p.country)}`} />}
          {p.vendor && <Row icon={Users} label="Vendor" value={`${p.vendor.name}${p.vendor.phone ? ` · ${p.vendor.phone}` : ''}`} />}
          <Row icon={CalendarClock} label="Registered" value={new Date(p.joinedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })} />
        </Card>
      </div>
    )
  }

  if (section === 'now') {
    return (
      <div className="space-y-3">
        <Title aside={longDay(p.today)}>Right now</Title>
        {p.live ? <LiveCard p={p} /> : (
          <Card className="flex items-center gap-2.5 text-[12px] text-slate-500">
            <Smartphone className="h-4 w-4 shrink-0 text-slate-400" />
            {p.app.status === 'ON_APP' ? 'No day running on the driver app right now.' : 'Not tracked — this driver is not using the driver app.'}
          </Card>
        )}
        {p.current
          ? <TripCard t={p.current} today={p.today} open />
          : <Blank icon={Navigation} title="Not on a trip today" text={p.upcoming[0] ? `Next: ${p.upcoming[0].fileNo} from ${longDay(p.upcoming[0].startDate)}.` : 'No upcoming trips are assigned either.'} />}
      </div>
    )
  }

  if (section === 'upcoming') {
    return (
      <div className="space-y-2">
        <Title aside={`${p.upcoming.length} trip${p.upcoming.length === 1 ? '' : 's'}`}>Upcoming trips</Title>
        {p.upcoming.length ? p.upcoming.map((t, i) => <TripCard key={t.bookingRef} t={t} today={p.today} open={i === 0} />)
          : <Blank icon={CalendarClock} title="Nothing assigned" text="No movements or Sri Lanka allocations ahead for this driver." />}
      </div>
    )
  }

  if (section === 'past') {
    return (
      <div className="space-y-2">
        <Title aside="last 120 days">Past tours & feedback</Title>
        <FeedbackSummary stats={p.stats.feedback} />
        {p.past.length ? p.past.map(t => <PastCard key={t.bookingRef} t={t} />)
          : <Blank icon={History} title="No past tours" text="No completed trips in the last 120 days." />}
      </div>
    )
  }

  // vehicle
  return (
    <div className="space-y-3">
      <Title>Vehicle</Title>
      {p.vehicle ? <VehicleCard v={p.vehicle} onPhoto={onPhoto} /> : <Blank icon={CarFront} title="No vehicle linked" text="Link a vehicle to this driver in Ground → Drivers." />}
      <Title aside={p.checks.length ? `${p.checks.length} latest` : undefined}>App vehicle checks</Title>
      {p.checks.length ? p.checks.map(c => (
        <Card key={c.id}>
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-[12px] font-bold text-slate-800"><ClipboardCheck className="h-3.5 w-3.5 text-slate-400" /> {stamp(c.createdAt)}</span>
            <span className={`rounded-full px-2 py-0.5 text-[9.5px] font-bold ${c.status === 'APPROVED' ? 'bg-emerald-100 text-emerald-800' : c.status === 'REJECTED' ? 'bg-rose-100 text-rose-700' : 'bg-amber-100 text-amber-800'}`}>{c.status}</span>
          </div>
          {c.photos.length ? (
            <div className="grid grid-cols-3 gap-1.5">
              {c.photos.map(ph => <Thumb key={ph.label} url={ph.url} label={ph.label} onPhoto={onPhoto} small />)}
            </div>
          ) : <p className="text-[11px] text-slate-400">No photos on this check.</p>}
          {(c.odometer != null || c.reviewNote) && (
            <p className="mt-2 text-[11px] text-slate-500">
              {c.odometer != null && <span className="font-semibold">Odometer {c.odometer.toLocaleString()} km</span>}
              {c.odometer != null && c.reviewNote && ' · '}
              {c.reviewNote}
            </p>
          )}
        </Card>
      )) : <p className="px-1 text-[11.5px] text-slate-400">{p.app.status === 'ON_APP' ? 'No vehicle checks sent from the app yet.' : 'Vehicle checks come from the driver app — this driver is not on it.'}</p>}
    </div>
  )
}

function DriverHero({ p, onPhoto }: { p: DriverProfile; onPhoto: PhotoFn }) {
  return (
    <div className="relative overflow-hidden rounded-3xl bg-[#0a2b24] p-4 text-white shadow-xl shadow-emerald-950/20">
      <div className="pointer-events-none absolute -right-12 -top-14 h-44 w-44 rounded-full bg-amber-400/25 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-16 -left-10 h-44 w-44 rounded-full bg-emerald-400/20 blur-3xl" />
      <div className="relative flex items-center gap-3.5">
        <button
          onClick={() => p.photoUrl && onPhoto({ url: p.photoUrl, label: p.name })}
          className={`shrink-0 ${p.photoUrl ? 'cursor-zoom-in' : 'cursor-default'}`}
          aria-label={p.photoUrl ? 'View driver photo' : undefined}
        >
          <PhotoOrInitials url={p.photoUrl} name={p.name} size={76} className="rounded-2xl ring-2 ring-amber-300/60" />
        </button>
        <div className="min-w-0">
          <p className="text-[10.5px] font-bold uppercase tracking-[0.14em] text-emerald-200/80">
            {p.country ? `${flagOf(p.country)} ${labelOf(p.country)} driver` : 'Driver'}
          </p>
          <p className="mt-0.5 truncate text-[19px] font-extrabold leading-tight tracking-tight" title={p.name}>{p.name}</p>
          <p className="mt-0.5 truncate text-[11.5px] font-semibold text-amber-300">
            {p.live ? 'On the road now' : p.current ? `On tour · ${p.current.fileNo}` : p.upcoming[0] ? `Next trip ${shortDay(p.upcoming[0].startDate)}` : 'No trip assigned'}
          </p>
          <div className="mt-1.5 flex flex-wrap gap-1">
            <span className={`rounded-full px-2 py-0.5 text-[9.5px] font-bold ring-1 ${p.isActive ? 'bg-emerald-400/15 text-emerald-200 ring-emerald-300/30' : 'bg-rose-400/15 text-rose-200 ring-rose-300/30'}`}>{p.isActive ? 'Active' : 'Inactive'}</span>
            {p.vehicle && <span className="rounded-full bg-white/10 px-2 py-0.5 text-[9.5px] font-bold text-white/90 ring-1 ring-white/15">{p.vehicle.plateNo}</span>}
          </div>
        </div>
      </div>
    </div>
  )
}

function AppCard({ app }: { app: PartnerApp }) {
  const meta = {
    ON_APP:     { title: 'Using the Aahaas Driver app', tone: 'bg-emerald-50 ring-emerald-200 text-emerald-800', dot: 'bg-emerald-500' },
    CODE_SENT:  { title: 'Sign-in code sent — not signed in yet', tone: 'bg-amber-50 ring-amber-200 text-amber-800', dot: 'bg-amber-500' },
    NOT_JOINED: { title: 'Not using the driver app', tone: 'bg-slate-50 ring-slate-200 text-slate-600', dot: 'bg-slate-400' },
  }[app.status]
  const platform = app.platform ? (app.platform.toLowerCase() === 'ios' ? 'iPhone' : app.platform.toLowerCase() === 'android' ? 'Android' : app.platform) : null
  return (
    <div className={`rounded-2xl p-3 ring-1 ${meta.tone}`}>
      <p className="flex items-center gap-2 text-[12.5px] font-bold">
        <Smartphone className="h-4 w-4 shrink-0" />
        <span className="min-w-0 flex-1">{meta.title}</span>
        <span className={`h-2 w-2 shrink-0 rounded-full ${meta.dot}`} />
      </p>
      {app.status === 'ON_APP' ? (
        <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 pl-6 text-[11px] font-medium opacity-80">
          <span>Last seen {ago(app.lastSeenAt ?? app.lastLoginAt)}</span>
          {platform && <span>{platform}{app.appVersion ? ` · v${app.appVersion}` : ''}</span>}
          <span className="inline-flex items-center gap-1">{app.push ? <><Bell className="h-3 w-3" /> Notifications on</> : <><BellOff className="h-3 w-3" /> No notifications</>}</span>
        </div>
      ) : (
        <p className="mt-1 pl-6 text-[11px] font-medium opacity-80">
          {app.status === 'CODE_SENT' && app.codeSentAt ? `Code sent ${ago(app.codeSentAt)}. ` : ''}
          Trips, live location and vehicle checks are only tracked once they sign in.
        </p>
      )}
    </div>
  )
}

function LiveCard({ p, onClick }: { p: DriverProfile; onClick?: () => void }) {
  const l = p.live!
  const stale = l.lastPingAt ? Date.now() - new Date(l.lastPingAt).getTime() > 20 * 60_000 : true
  const body = (
    <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-emerald-500 to-emerald-700 p-3 text-white shadow-md shadow-emerald-700/25">
      <p className="flex items-center gap-2 text-[12.5px] font-extrabold">
        <span className="relative flex h-2.5 w-2.5"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white/70" /><span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-white" /></span>
        {l.pause ? (PAUSE_LABEL[l.pause.reason] ?? 'Paused') : 'Day running on the app'}
        <span className="ml-auto font-mono text-[11px] font-bold text-emerald-100">{l.fileNo ?? l.bookingRef}</span>
      </p>
      <div className="mt-2 grid grid-cols-3 gap-2 text-center">
        <div><p className="text-[15px] font-extrabold">{l.km}</p><p className="text-[9.5px] font-semibold uppercase text-emerald-100">km today</p></div>
        <div><p className="text-[15px] font-extrabold">{new Date(l.startedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</p><p className="text-[9.5px] font-semibold uppercase text-emerald-100">started</p></div>
        <div><p className={`text-[15px] font-extrabold ${stale ? 'text-amber-200' : ''}`}>{l.lastPingAt ? ago(l.lastPingAt).replace(' ago', '') : '—'}</p><p className="text-[9.5px] font-semibold uppercase text-emerald-100">last GPS</p></div>
      </div>
      {l.pause && <p className="mt-2 flex items-center gap-1 text-[11px] font-semibold text-emerald-50"><PauseCircle className="h-3.5 w-3.5" /> Since {ago(l.pause.since)}</p>}
      {l.lat != null && l.lng != null && (
        <a
          href={`https://www.google.com/maps?q=${l.lat},${l.lng}`}
          target="_blank" rel="noreferrer"
          onClick={e => e.stopPropagation()}
          className="mt-2 inline-flex items-center gap-1 rounded-lg bg-white/15 px-2 py-1 text-[11px] font-bold hover:bg-white/25"
        >
          <MapPin className="h-3.5 w-3.5" /> Last location on map
        </a>
      )}
    </div>
  )
  return onClick ? <button onClick={onClick} className="block w-full text-left">{body}</button> : body
}

// ── Vendor ──────────────────────────────────────────────────────────────────

function VendorBody({ p, section, jump, onPhoto, onOpenChat, activePhone }: {
  p: VendorProfile; section: VendorSection; jump: (s: Section) => void; onPhoto: PhotoFn
  onOpenChat: (phone: string) => void; activePhone: string
}) {
  if (section === 'profile') {
    return (
      <div className="space-y-3">
        <div className="relative overflow-hidden rounded-3xl bg-[#1e1b4b] p-4 text-white shadow-xl shadow-indigo-950/20">
          <div className="pointer-events-none absolute -right-12 -top-14 h-44 w-44 rounded-full bg-amber-400/25 blur-3xl" />
          <p className="relative text-[10.5px] font-bold uppercase tracking-[0.14em] text-indigo-200/80">
            {p.country ? `${flagOf(p.country)} ${labelOf(p.country)} · ` : ''}Vehicle vendor
          </p>
          <p className="relative mt-0.5 truncate text-[19px] font-extrabold leading-tight tracking-tight">{p.name}</p>
          <p className="relative mt-0.5 text-[11.5px] font-semibold text-amber-300">
            {p.stats.liveNow ? `${p.stats.liveNow} driver${p.stats.liveNow === 1 ? '' : 's'} on the road now` : `${p.stats.upcoming} trip${p.stats.upcoming === 1 ? '' : 's'} ahead`}
          </p>
          <div className="relative mt-1.5 flex flex-wrap gap-1">
            <span className={`rounded-full px-2 py-0.5 text-[9.5px] font-bold ring-1 ${p.isActive ? 'bg-emerald-400/15 text-emerald-200 ring-emerald-300/30' : 'bg-rose-400/15 text-rose-200 ring-rose-300/30'}`}>{p.isActive ? 'Active' : 'Inactive'}</span>
            <span className="rounded-full bg-white/10 px-2 py-0.5 text-[9.5px] font-bold text-white/90 ring-1 ring-white/15">{p.isRegistered ? 'Vendor portal account' : 'No portal account'}</span>
          </div>
        </div>
        <div className="grid grid-cols-4 gap-1.5">
          <Stat value={p.stats.drivers} label="Drivers" hint={`${p.stats.onApp} on app`} onClick={() => jump('fleet')} />
          <Stat value={p.stats.vehicles} label="Vehicles" onClick={() => jump('vehicles')} />
          <Stat value={p.stats.upcoming} label="Trips ahead" onClick={() => jump('upcoming')} />
          <Stat value={positiveText(p.stats.feedback.driverRated, p.stats.feedback.driverPositive)} label="Guest rating" hint={`${p.stats.feedback.driverRated} rated`} onClick={() => jump('past')} />
        </div>
        {p.stats.needsAction > 0 && (
          <button onClick={() => jump('upcoming')} className="flex w-full items-center gap-2 rounded-2xl bg-rose-50 p-3 text-left text-[12px] font-bold text-rose-700 ring-1 ring-rose-200">
            <AlertTriangle className="h-4 w-4 shrink-0" /> {p.stats.needsAction} trip{p.stats.needsAction === 1 ? '' : 's'} still need a driver or vehicle
          </button>
        )}
        <FeedbackSummary stats={p.stats.feedback} />
        <Card>
          {p.whatsappPhone && <Row icon={MessageCircle} label="WhatsApp" value={p.whatsappPhone} />}
          {p.phone && <Row icon={Phone} label="Phone" value={p.phone} />}
          {p.email && <Row icon={Mail} label="Email" value={p.email} />}
          {p.address && <Row icon={MapPin} label="Address" value={p.address} />}
        </Card>
      </div>
    )
  }

  if (section === 'now') {
    return (
      <div className="space-y-2">
        <Title aside={longDay(p.today)}>Running today</Title>
        {p.current.length ? p.current.map(t => <TripCard key={`${t.bookingRef}:${t.startDate}:${t.legs[0]?.time ?? ''}`} t={t} today={p.today} open />)
          : <Blank icon={Navigation} title="Nothing running today" text={p.upcoming[0] ? `Next: ${p.upcoming[0].fileNo} on ${longDay(p.upcoming[0].startDate)}.` : 'No trips assigned ahead either.'} />}
      </div>
    )
  }

  if (section === 'upcoming') {
    return (
      <div className="space-y-2">
        <Title aside={`${p.upcoming.length}`}>Upcoming trips</Title>
        {p.upcoming.length ? p.upcoming.map(t => <TripCard key={`${t.bookingRef}:${t.startDate}:${t.legs[0]?.time ?? ''}`} t={t} today={p.today} />)
          : <Blank icon={CalendarClock} title="Nothing ahead" text="No trips are given to this vendor yet." />}
      </div>
    )
  }

  if (section === 'past') {
    return (
      <div className="space-y-2">
        <Title aside="last 120 days">Past tours & feedback</Title>
        <FeedbackSummary stats={p.stats.feedback} />
        {p.past.length ? p.past.map(t => <PastCard key={`${t.bookingRef}:${t.startDate}:${t.legs[0]?.time ?? ''}`} t={t} />)
          : <Blank icon={History} title="No past tours" text="No completed trips in the last 120 days." />}
      </div>
    )
  }

  if (section === 'fleet') {
    return (
      <div className="space-y-2">
        <Title aside={`${p.stats.onApp}/${p.stats.drivers} on app`}>Drivers</Title>
        {p.drivers.length ? p.drivers.map(d => (
          <Card key={d.id} className={d.isActive ? '' : 'opacity-60'}>
            <div className="flex items-center gap-2.5">
              <PhotoOrInitials url={d.photoUrl} name={d.name} size={42} className="rounded-xl" onClick={d.photoUrl ? () => onPhoto({ url: d.photoUrl!, label: d.name }) : undefined} />
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1.5 truncate text-[12.5px] font-bold text-slate-800">
                  {d.name}
                  {d.live && <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-emerald-500" title="On the road now" />}
                </p>
                <p className="truncate text-[11px] text-slate-400">{d.phone}{d.vehiclePlate ? ` · ${d.vehiclePlate}` : ''}</p>
              </div>
              {digits(d.phone).length >= 7 && !digits(d.phone).endsWith(activePhone.slice(-9)) && (
                <button onClick={() => onOpenChat(digits(d.phone))} title="Open their chat" className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-emerald-50 text-emerald-700 hover:bg-emerald-100">
                  <MessageCircle className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            <div className="mt-2 flex flex-wrap gap-1">
              <AppChip status={d.app?.status ?? 'NOT_JOINED'} lastSeenAt={d.app?.lastSeenAt ?? null} />
              {d.live && <Chip tone="emerald">Live · {d.live.bookingRef} · {d.live.km} km</Chip>}
              {d.nextTrip && <Chip tone="blue">Next {shortDay(d.nextTrip.date)} · {d.nextTrip.fileNo}</Chip>}
              {!!d.upcomingTrips && <Chip>{d.upcomingTrips} upcoming</Chip>}
              {!d.isActive && <Chip tone="rose">Inactive</Chip>}
            </div>
          </Card>
        )) : <Blank icon={Users} title="No drivers" text="This vendor has not added any drivers." />}
      </div>
    )
  }

  // vehicles
  return (
    <div className="space-y-2">
      <Title aside={`${p.vehicles.length}`}>Vehicles</Title>
      {p.vehicles.length ? p.vehicles.map(v => <VehicleCard key={v.id} v={v} onPhoto={onPhoto} />)
        : <Blank icon={CarFront} title="No vehicles" text="This vendor has not added any vehicles." />}
    </div>
  )
}

// ── Trips ───────────────────────────────────────────────────────────────────

function TripMini({ t, label }: { t: PartnerTrip; label: string }) {
  return (
    <Card className="transition hover:ring-slate-300">
      <p className="text-[9.5px] font-bold uppercase tracking-wider text-slate-400">{label}</p>
      <div className="mt-1 flex items-center gap-2">
        <span className="text-[17px] leading-none">{t.country ? flagOf(t.country) : '🌍'}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-extrabold text-slate-900"><span className="font-mono">{t.fileNo}</span>{t.leadGuest ? ` · ${t.leadGuest}` : ''}</span>
          <span className="block truncate text-[11px] text-slate-500">
            {shortDay(t.startDate)}{t.endDate !== t.startDate ? ` → ${shortDay(t.endDate)}` : ''}
            {t.dayNo ? ` · Day ${t.dayNo} of ${t.dayCount}` : ''} · {paxText(t.pax)}
          </span>
        </span>
      </div>
    </Card>
  )
}

function TripCard({ t, today, open: startOpen = false }: { t: PartnerTrip; today: string; open?: boolean }) {
  const [open, setOpen] = useState(startOpen)
  const byDay = useMemo(() => {
    const m = new Map<string, PartnerTrip['legs']>()
    for (const l of t.legs) m.set(l.date, [...(m.get(l.date) ?? []), l])
    return Array.from(m.entries())
  }, [t.legs])
  const hotelOn = (date: string) => t.hotels.find(h => h.date === date)

  return (
    <Card className={t.phase === 'now' ? 'ring-emerald-300' : ''}>
      <button onClick={() => setOpen(o => !o)} className="flex w-full items-start gap-2 text-left">
        <span className="mt-0.5 text-[17px] leading-none">{t.country ? flagOf(t.country) : '🌍'}</span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="truncate font-mono text-[13px] font-extrabold text-slate-900">{t.fileNo}</span>
            {t.state && <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-bold ${STATE_META[t.state]?.tone ?? ''}`}>{STATE_META[t.state]?.label ?? t.state}</span>}
            {!t.state && t.status && <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-bold ${STATUS_COLORS[t.status]}`}>{STATUS_LABELS[t.status]}</span>}
          </span>
          <span className="block truncate text-[11.5px] font-semibold text-slate-700">{t.leadGuest ?? t.title ?? 'Lead guest not set'}</span>
          <span className="block truncate text-[11px] text-slate-400">
            {shortDay(t.startDate)}{t.endDate !== t.startDate ? ` → ${shortDay(t.endDate)}` : ''}
            {t.dayNo ? ` · Day ${t.dayNo} of ${t.dayCount}` : t.dayCount > 1 ? ` · ${t.dayCount} days` : ''}
            {' · '}{paxText(t.pax)}
          </span>
        </span>
        <ChevronDown className={`mt-1 h-4 w-4 shrink-0 text-slate-400 transition ${open ? 'rotate-180' : ''}`} />
      </button>

      <div className="mt-2 flex flex-wrap gap-1">
        <Chip tone="violet">{t.mode === 'ROUND_TRIP' ? 'Whole tour' : `${t.legCount} movement${t.legCount === 1 ? '' : 's'}`}</Chip>
        {t.vehicle && <Chip>{t.vehicle}</Chip>}
        {t.driver && <Chip tone="amber">{t.driver.name}</Chip>}
        {t.appSession && <Chip tone="emerald">App · {t.appSession.km} km</Chip>}
      </div>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="mt-2.5 space-y-2 border-t border-slate-100 pt-2.5">
              {byDay.length ? byDay.map(([date, legs]) => {
                const hotel = hotelOn(date)
                const isToday = date === today
                return (
                  <div key={date} className={`rounded-xl p-2 ${isToday ? 'bg-emerald-50 ring-1 ring-emerald-200' : 'bg-slate-50'}`}>
                    <p className={`mb-1 text-[10.5px] font-bold uppercase tracking-wide ${isToday ? 'text-emerald-700' : 'text-slate-500'}`}>{longDay(date)}{isToday ? ' · today' : ''}</p>
                    <ul className="space-y-1">
                      {legs.map((l, i) => (
                        <li key={i} className={`flex gap-2 text-[11.5px] ${l.noDriverNeeded ? 'text-slate-400' : 'text-slate-700'}`}>
                          <span className="w-[38px] shrink-0 font-mono text-[10.5px] font-bold text-slate-500">{l.time || '—'}</span>
                          <span className="min-w-0 flex-1">
                            <span className="font-semibold">{l.route}</span>
                            {l.noDriverNeeded && <span className="ml-1 text-[10px]">(no driver)</span>}
                            {(l.driverName || l.vehiclePlate) && <span className="block text-[10.5px] text-slate-400">{[l.driverName, l.vehiclePlate].filter(Boolean).join(' · ')}</span>}
                            {l.details && <span className="line-clamp-2 block text-[10.5px] text-slate-400">{l.details}</span>}
                          </span>
                        </li>
                      ))}
                      {!legs.length && <li className="text-[11px] text-slate-400">No movements planned yet.</li>}
                    </ul>
                    {hotel && <p className="mt-1 flex items-center gap-1 text-[10.5px] text-slate-500"><BedDouble className="h-3 w-3" /> {hotel.name}{hotel.city ? `, ${hotel.city}` : ''}</p>}
                  </div>
                )
              }) : <p className="text-[11px] text-slate-400">No movements on the agenda yet.</p>}
              {t.specialNotes && <p className="rounded-xl bg-amber-50 p-2 text-[11px] text-amber-800"><span className="font-bold">Note: </span>{t.specialNotes}</p>}
              <OpenBooking bookingRef={t.bookingRef} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </Card>
  )
}

function PastCard({ t }: { t: PartnerTrip }) {
  const f = t.feedback
  return (
    <Card>
      <div className="flex items-start gap-2">
        <span className="mt-0.5 text-[16px] leading-none">{t.country ? flagOf(t.country) : '🌍'}</span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[12.5px] font-extrabold text-slate-900"><span className="font-mono">{t.fileNo}</span>{t.leadGuest ? <span className="font-semibold text-slate-600"> · {t.leadGuest}</span> : null}</p>
          <p className="truncate text-[11px] text-slate-400">
            {shortDay(t.startDate)}{t.endDate !== t.startDate ? ` → ${shortDay(t.endDate)}` : ''} · {paxText(t.pax)}
            {t.mode === 'MOVEMENTS' && t.legs[0] ? ` · ${t.legs[0].route}` : ''}
          </p>
        </div>
        <Link href={`/dashboard/bookings/${t.bookingRef}`} target="_blank" title="Open booking" className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700">
          <ExternalLink className="h-3.5 w-3.5" />
        </Link>
      </div>
      <div className="mt-2 flex flex-wrap gap-1">
        {t.driver && <Chip tone="amber">{t.driver.name}</Chip>}
        {t.appSession && <Chip tone="emerald">App · {t.appSession.km} km{t.appSession.feedbackStatus === 'SUBMITTED' ? ' · feedback taken' : ''}</Chip>}
      </div>
      {f ? (
        <div className="mt-2 space-y-1.5 rounded-xl bg-slate-50 p-2">
          <div className="flex flex-wrap gap-1">
            {f.driver && <RatingChip label="Driver" r={f.driver} />}
            {f.vehicle && <RatingChip label="Vehicle" r={f.vehicle} />}
            {f.overall && <RatingChip label="Overall" r={f.overall} />}
            {f.callRating != null && <Stars n={f.callRating} />}
          </div>
          {f.remarks && <Quote text={f.remarks} who="Guest form" />}
          {f.callComment && <Quote text={f.callComment} who="TE call" />}
        </div>
      ) : <p className="mt-2 text-[11px] text-slate-400">No guest feedback on this tour.</p>}
    </Card>
  )
}

function OpenBooking({ bookingRef }: { bookingRef: string }) {
  return (
    <Link href={`/dashboard/bookings/${bookingRef}`} target="_blank" className="inline-flex items-center gap-1 rounded-lg bg-slate-900 px-2.5 py-1.5 text-[11px] font-bold text-white transition hover:bg-slate-700">
      Open booking <ExternalLink className="h-3 w-3" />
    </Link>
  )
}

// ── Vehicles ────────────────────────────────────────────────────────────────

function VehicleCard({ v, onPhoto }: { v: PartnerVehicle; onPhoto: PhotoFn }) {
  const name = [v.brand, v.model].filter(Boolean).join(' ') || v.type
  return (
    <Card className={v.isActive ? '' : 'opacity-60'}>
      <div className="grid grid-cols-2 gap-1.5">
        <Thumb url={v.photoOutside} label={`${v.plateNo} · outside`} onPhoto={onPhoto} />
        <Thumb url={v.photoInside} label={`${v.plateNo} · inside`} onPhoto={onPhoto} />
      </div>
      <div className="mt-2 flex items-center gap-2">
        <span className="rounded-md bg-amber-300 px-1.5 py-0.5 font-mono text-[11.5px] font-extrabold text-slate-900 ring-1 ring-amber-500/40">{v.plateNo}</span>
        <span className="min-w-0 flex-1 truncate text-[12px] font-bold text-slate-800">{name}</span>
      </div>
      <div className="mt-1.5 flex flex-wrap gap-1">
        <Chip>{v.type}</Chip>
        <Chip>{v.capacity} seats</Chip>
        {v.driverName && <Chip tone="amber">{v.driverName}</Chip>}
        {!!v.upcomingTrips && <Chip tone="blue">{v.upcomingTrips} upcoming</Chip>}
        {!v.isActive && <Chip tone="rose">Inactive</Chip>}
      </div>
    </Card>
  )
}

function Thumb({ url, label, onPhoto, small }: { url: string | null; label: string; onPhoto: PhotoFn; small?: boolean }) {
  const [broken, setBroken] = useState(false)
  if (!url || broken) {
    return (
      <div className={`grid place-items-center rounded-xl bg-slate-100 text-slate-300 ${small ? 'aspect-square' : 'aspect-[4/3]'}`}>
        <span className="flex flex-col items-center gap-0.5 text-[9.5px] font-semibold"><ImageOff className="h-4 w-4" /> {small ? label : 'No photo'}</span>
      </div>
    )
  }
  return (
    <button onClick={() => onPhoto({ url, label })} className={`group relative overflow-hidden rounded-xl bg-slate-100 ${small ? 'aspect-square' : 'aspect-[4/3]'}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt={label} loading="lazy" onError={() => setBroken(true)} className="h-full w-full object-cover transition group-hover:scale-105" />
      <span className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/60 to-transparent px-1.5 pb-1 pt-3 text-left text-[9.5px] font-bold capitalize text-white">{label}</span>
    </button>
  )
}

// ── Feedback ────────────────────────────────────────────────────────────────

function positiveText(rated: number, positiveN: number) {
  return rated ? `${Math.round((positiveN / rated) * 100)}%` : '—'
}

function FeedbackSummary({ stats }: { stats: FeedbackStats }) {
  if (!stats.driverRated && !stats.vehicleRated && !stats.callRated) return null
  return (
    <Card>
      <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-400"><MessageSquareQuote className="h-3.5 w-3.5" /> Guest feedback · past tours</p>
      <div className="grid grid-cols-3 gap-2 text-center">
        <FeedbackTile label="Driver" value={positiveText(stats.driverRated, stats.driverPositive)} hint={`${stats.driverRated} rated`} />
        <FeedbackTile label="Vehicle" value={positiveText(stats.vehicleRated, stats.vehiclePositive)} hint={`${stats.vehicleRated} rated`} />
        <FeedbackTile label="TE calls" value={stats.callAverage != null ? `${stats.callAverage}/5` : '—'} hint={`${stats.callRated} rated`} />
      </div>
      <p className="mt-1.5 text-[10px] text-slate-400">% = Excellent or Good on the guest feedback form.</p>
    </Card>
  )
}

function FeedbackTile({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-xl bg-slate-50 py-1.5">
      <p className="text-[15px] font-extrabold text-slate-900">{value}</p>
      <p className="text-[10px] font-bold text-slate-500">{label}</p>
      <p className="text-[9.5px] text-slate-400">{hint}</p>
    </div>
  )
}

function RatingChip({ label, r }: { label: string; r: FeedbackRating }) {
  const m = RATING_META[r]
  return <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${m.tone}`}>{label}: {m.label}</span>
}

function Stars({ n }: { n: number }) {
  return (
    <span className="inline-flex items-center gap-0.5 rounded-full bg-white px-1.5 py-0.5 ring-1 ring-slate-200" title={`TE call rating ${n}/5`}>
      {[1, 2, 3, 4, 5].map(i => <Star key={i} className={`h-3 w-3 ${i <= n ? 'fill-amber-400 text-amber-400' : 'text-slate-300'}`} />)}
    </span>
  )
}

function Quote({ text, who }: { text: string; who: string }) {
  return (
    <p className="border-l-2 border-amber-300 pl-2 text-[11.5px] italic leading-snug text-slate-600">
      “{text}” <span className="not-italic text-[10px] font-semibold text-slate-400">— {who}</span>
    </p>
  )
}

// ── Small pieces ────────────────────────────────────────────────────────────

function paxText(p: { adults: number; children: number }) {
  return `${p.adults} adult${p.adults === 1 ? '' : 's'}${p.children ? `, ${p.children} child${p.children === 1 ? '' : 'ren'}` : ''}`
}

function PhotoOrInitials({ url, name, size, className = '', onClick }: { url: string | null; name: string; size: number; className?: string; onClick?: () => void }) {
  const [broken, setBroken] = useState(false)
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]?.toUpperCase()).join('') || '?'
  const inner = url && !broken ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={url} alt={name} onError={() => setBroken(true)} className={`object-cover ${className}`} style={{ width: size, height: size }} />
  ) : (
    <span className={`grid place-items-center bg-gradient-to-br from-amber-300 to-orange-500 font-extrabold text-white ${className}`} style={{ width: size, height: size, fontSize: size * 0.34 }}>{initials}</span>
  )
  return onClick ? <button onClick={onClick} className="shrink-0 cursor-zoom-in">{inner}</button> : <span className="shrink-0">{inner}</span>
}

function AppChip({ status, lastSeenAt }: { status: string; lastSeenAt: string | null }) {
  if (status === 'ON_APP') return <Chip tone="emerald"><Check className="h-3 w-3" /> On app · {ago(lastSeenAt)}</Chip>
  if (status === 'CODE_SENT') return <Chip tone="amber">Code sent</Chip>
  return <Chip>Not on app</Chip>
}

function Stat({ value, label, hint, onClick }: { value: React.ReactNode; label: string; hint?: string; onClick?: () => void }) {
  const body = (
    <>
      <p className="text-[16px] font-extrabold leading-tight text-slate-900">{value}</p>
      <p className="text-[9.5px] font-bold uppercase tracking-wide text-slate-500">{label}</p>
      {hint && <p className="text-[9px] text-slate-400">{hint}</p>}
    </>
  )
  const cls = 'rounded-2xl bg-white px-1 py-2 text-center shadow-[0_1px_2px_rgba(15,23,42,0.05)] ring-1 ring-slate-200/70'
  return onClick ? <button onClick={onClick} className={`${cls} transition hover:ring-slate-300`}>{body}</button> : <div className={cls}>{body}</div>
}

function Row({ icon: Icon, label, value }: { icon: typeof Phone; label: string; value: string }) {
  return (
    <div className="flex items-start gap-2 border-b border-slate-100 py-1.5 last:border-0">
      <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
      <span className="w-[92px] shrink-0 text-[11px] font-semibold text-slate-400">{label}</span>
      <span className="min-w-0 flex-1 break-words text-[12px] font-semibold text-slate-700">{value}</span>
    </div>
  )
}

function Title({ children, aside }: { children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <div className="mb-1 flex items-center justify-between gap-2 px-0.5">
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

function Blank({ icon: Icon, title, text, action }: { icon: typeof Phone; title: string; text: string; action?: { label: string; onClick: () => void } }) {
  return (
    <div className="rounded-3xl border border-dashed border-slate-300/80 px-5 py-8 text-center">
      <Icon className="mx-auto mb-2.5 h-7 w-7 text-slate-300" />
      <p className="text-[13px] font-bold text-slate-600">{title}</p>
      <p className="mx-auto mt-1 max-w-[260px] text-[11.5px] leading-relaxed text-slate-400">{text}</p>
      {action && <button onClick={action.onClick} className="mt-3 rounded-xl bg-slate-900 px-3 py-1.5 text-[11.5px] font-bold text-white">{action.label}</button>}
    </div>
  )
}

