'use client'

/**
 * Personal trip board — the page behind each driver's / vendor's morning link.
 * No login: the signed `?t=` token in the URL is the only key, verified on
 * every call by /api/public/driver-board.
 *
 * Mobile first — drivers open this from WhatsApp on a phone.
 */

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import {
  AlertTriangle, CalendarDays, Car, CheckCircle2, ChevronDown, Clock, Hand, Hourglass,
  Loader2, MapPin, RefreshCw, Route, ShieldCheck, Sparkles, Users, X, Zap,
} from 'lucide-react'
import { CountryFlag } from '@/components/ui/country-flag'
import { cn } from '@/lib/utils'
import {
  CLAIM_STATUS_META, fmtDaysAway, fmtTripDay,
  type ClaimView, type DaCountry, type OpenTrip,
} from '@/lib/driver-auto/shared'

type BoardTrip = OpenTrip & { myRequestId: string | null; busy: boolean; fits: boolean | null }

interface Board {
  party: { name: string; type: 'DRIVER' | 'VENDOR'; vehicle: string | null; capacity: number | null }
  today: string
  horizonDays: number
  setupRequired: boolean
  countries: { country: DaCountry; label: string; unit: 'BOOKING' | 'MOVEMENT'; requireApproval: boolean; trips: BoardTrip[] }[]
  claims: ClaimView[]
  myTrips: { bookingRef: string; leadGuest: string | null; pax: number; startDate: string; endDate: string; legs: { date: string; time: string | null; route: string }[] }[]
  generatedAt: string
}

type View = 'open' | 'requests' | 'mine'

const TONE: Record<string, string> = {
  amber: 'bg-amber-100 text-amber-800',
  emerald: 'bg-emerald-100 text-emerald-800',
  rose: 'bg-rose-100 text-rose-700',
  slate: 'bg-slate-100 text-slate-600',
}

export default function DriverBoardPage() {
  return (
    <Suspense fallback={<Screen><div className="grid min-h-[60vh] place-items-center"><Loader2 className="h-7 w-7 animate-spin text-emerald-400" /></div></Screen>}>
      <DriverBoard />
    </Suspense>
  )
}

function DriverBoard() {
  const { key } = useParams<{ key: string }>()
  const token = useSearchParams().get('t') ?? ''

  const [board, setBoard] = useState<Board | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState<View>('open')
  const [countryIdx, setCountryIdx] = useState(0)
  const [confirm, setConfirm] = useState<{ trip: BoardTrip; direct: boolean } | null>(null)
  const [flash, setFlash] = useState<{ ok: boolean; text: string } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/public/driver-board?key=${encodeURIComponent(key)}&t=${encodeURIComponent(token)}`, { cache: 'no-store' })
      const json = await res.json()
      if (!res.ok || !json.success) throw new Error(json.error || 'Could not load your board')
      setBoard(json.data as Board)
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [key, token])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    if (!flash) return
    const id = window.setTimeout(() => setFlash(null), 6000)
    return () => window.clearTimeout(id)
  }, [flash])

  const post = useCallback(async (payload: Record<string, unknown>) => {
    const res = await fetch('/api/public/driver-board', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, t: token, ...payload }),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok || !json.success) throw new Error(json.error || 'Something went wrong')
    return json as { message?: string; data: { mode?: 'pending' | 'assigned' } }
  }, [key, token])

  const block = board?.countries[countryIdx]
  const pending = board?.claims.filter(c => c.status === 'PENDING') ?? []

  const grouped = useMemo(() => {
    const m = new Map<string, BoardTrip[]>()
    for (const t of block?.trips ?? []) m.set(t.startDate, [...(m.get(t.startDate) ?? []), t])
    return Array.from(m.entries())
  }, [block])

  if (error && !board) {
    return (
      <Screen>
        <div className="mx-auto mt-24 max-w-sm rounded-3xl bg-white p-6 text-center shadow-xl">
          <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-rose-50"><AlertTriangle className="h-6 w-6 text-rose-500" /></span>
          <h1 className="mt-3 text-lg font-bold text-slate-900">Link not working</h1>
          <p className="mt-1 text-sm text-slate-500">{error}</p>
        </div>
      </Screen>
    )
  }

  if (!board) {
    return <Screen><div className="grid min-h-[60vh] place-items-center"><Loader2 className="h-7 w-7 animate-spin text-emerald-400" /></div></Screen>
  }

  const openCount = board.countries.reduce((n, c) => n + c.trips.length, 0)

  return (
    <Screen>
      {/* Header */}
      <header className="relative overflow-hidden px-5 pb-6 pt-7 text-white">
        <div className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-emerald-500/25 blur-3xl" />
        <div className="relative flex items-start justify-between">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-emerald-300">AppleHolidays · Trip board</div>
            <h1 className="mt-1 text-2xl font-bold">Hi {board.party.name.split(' ')[0]} 👋</h1>
            <p className="mt-0.5 text-sm text-slate-300">
              {board.party.vehicle ? <>{board.party.vehicle}{board.party.capacity ? ` · ${board.party.capacity} seats` : ''}</> : board.party.type === 'VENDOR' ? 'Vehicle vendor' : 'Driver'}
            </p>
          </div>
          <button onClick={() => void load()} aria-label="Refresh" className="grid h-10 w-10 place-items-center rounded-2xl bg-white/10 ring-1 ring-white/15 active:scale-95">
            <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
          </button>
        </div>

        <div className="relative mt-5 grid grid-cols-3 gap-2">
          <Stat value={openCount} label="Open trips" />
          <Stat value={pending.length} label="My requests" />
          <Stat value={board.myTrips.length} label="My trips" />
        </div>
      </header>

      {/* Sheet */}
      <main className="relative -mt-2 min-h-[60vh] rounded-t-[28px] bg-slate-50 px-4 pb-28 pt-4">
        {flash && (
          <div className={cn('mb-3 flex items-start gap-2 rounded-2xl px-4 py-3 text-sm font-medium',
            flash.ok ? 'bg-emerald-600 text-white' : 'bg-rose-600 text-white')}>
            {flash.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />}
            <span className="flex-1">{flash.text}</span>
            <button onClick={() => setFlash(null)}><X className="h-4 w-4 opacity-80" /></button>
          </div>
        )}

        {board.setupRequired && (
          <div className="mb-3 rounded-2xl bg-amber-100 px-4 py-3 text-xs text-amber-900">
            Requests are not switched on yet — you can look at the trips, and operations will let you know when you can request them here.
          </div>
        )}

        {/* Segmented control */}
        <div className="sticky top-2 z-10 mb-4 grid grid-cols-3 gap-1 rounded-2xl bg-white p-1 shadow-sm ring-1 ring-slate-200">
          {([['open', 'Open trips'], ['requests', 'Requests'], ['mine', 'My trips']] as const).map(([v, label]) => (
            <button key={v} onClick={() => setView(v)}
                    className={cn('rounded-xl py-2 text-[13px] font-semibold transition', view === v ? 'bg-slate-900 text-white shadow' : 'text-slate-500')}>
              {label}
            </button>
          ))}
        </div>

        {view === 'open' && (
          <>
            {board.countries.length > 1 && (
              <div className="mb-3 flex gap-2 overflow-x-auto">
                {board.countries.map((c, i) => (
                  <button key={c.country} onClick={() => setCountryIdx(i)}
                          className={cn('flex shrink-0 items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold ring-1',
                            i === countryIdx ? 'bg-slate-900 text-white ring-slate-900' : 'bg-white text-slate-600 ring-slate-200')}>
                    <CountryFlag country={c.country} className="h-3 w-4 rounded-[2px]" /> {c.label}
                    <span className="rounded-full bg-white/20 px-1.5">{c.trips.length}</span>
                  </button>
                ))}
              </div>
            )}

            {block && (
              <div className={cn('mb-4 flex items-start gap-3 rounded-2xl p-3.5 text-xs',
                block.requireApproval ? 'bg-white text-slate-600 ring-1 ring-slate-200' : 'bg-emerald-600 text-white')}>
                {block.requireApproval ? <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" /> : <Zap className="mt-0.5 h-4 w-4 shrink-0" />}
                <span>
                  {block.requireApproval
                    ? <>Tap <b>Request</b> on a trip you can drive. Operations will confirm, and you will get the details on WhatsApp.</>
                    : <>First come, first served — tap <b>Take trip</b> and it is yours straight away.</>}
                  {block.unit === 'BOOKING' && <> Each trip here is the <b>full tour</b>, start to end.</>}
                </span>
              </div>
            )}

            {grouped.length === 0 ? (
              <Empty icon={Sparkles} title="No open trips right now" text={`Every trip in the next ${board.horizonDays} days already has a driver. Check again tomorrow morning.`} />
            ) : grouped.map(([day, trips]) => (
              <section key={day} className="mb-5">
                <div className="mb-2 flex items-baseline gap-2 px-1">
                  <span className="text-sm font-bold text-slate-900">{fmtTripDay(day)}</span>
                  <span className={cn('text-[11px] font-semibold', trips[0].daysAway <= 1 ? 'text-rose-600' : 'text-slate-400')}>{fmtDaysAway(trips[0].daysAway)}</span>
                </div>
                <div className="space-y-3">
                  {trips.map(t => (
                    <DriverTripCard key={t.key} trip={t} direct={!block!.requireApproval} disabled={board.setupRequired}
                                    onAct={() => setConfirm({ trip: t, direct: !block!.requireApproval })}
                                    onWithdraw={async () => {
                                      try {
                                        const r = await post({ action: 'withdraw', claimId: t.myRequestId })
                                        setFlash({ ok: true, text: r.message ?? 'Request withdrawn.' })
                                      } catch (e) { setFlash({ ok: false, text: (e as Error).message }) }
                                      void load()
                                    }} />
                  ))}
                </div>
              </section>
            ))}
          </>
        )}

        {view === 'requests' && (
          board.claims.length === 0
            ? <Empty icon={Hand} title="No requests yet" text="Trips you request appear here with their status." />
            : <div className="space-y-2.5">
                {board.claims.map(c => {
                  const m = CLAIM_STATUS_META[c.status]
                  const s = c.snapshot
                  return (
                    <div key={c.id} className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-[13px] font-bold text-slate-900">{fmtTripDay(c.tripDate)}{c.tripEndDate && c.tripEndDate !== c.tripDate ? ` – ${fmtTripDay(c.tripEndDate)}` : ''}</div>
                          <div className="truncate text-xs text-slate-500">{s?.kind === 'BOOKING' ? s?.title : s?.route}</div>
                        </div>
                        <span className={cn('shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold', TONE[m.tone])}>{m.driverLabel}</span>
                      </div>
                      {c.decisionNote && c.status === 'REJECTED' && <p className="mt-2 rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-600">{c.decisionNote}</p>}
                      {c.status === 'PENDING' && (
                        <button className="mt-3 text-xs font-semibold text-rose-600"
                                onClick={async () => {
                                  try {
                                    const r = await post({ action: 'withdraw', claimId: c.id })
                                    setFlash({ ok: true, text: r.message ?? 'Request withdrawn.' })
                                  } catch (e) { setFlash({ ok: false, text: (e as Error).message }) }
                                  void load()
                                }}>
                          Withdraw request
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
        )}

        {view === 'mine' && (
          board.myTrips.length === 0
            ? <Empty icon={Car} title="No trips in the next 30 days" text="Trips confirmed to you show here with the full schedule." />
            : <div className="space-y-3">
                {board.myTrips.map(t => (
                  <div key={t.bookingRef} className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
                    <div className="flex items-center justify-between bg-slate-900 px-4 py-3 text-white">
                      <div>
                        <div className="text-[13px] font-bold">{t.bookingRef}</div>
                        <div className="text-[11px] text-slate-300">{fmtTripDay(t.startDate)}{t.endDate !== t.startDate ? ` – ${fmtTripDay(t.endDate)}` : ''}</div>
                      </div>
                      <div className="text-right text-[11px] text-slate-300">
                        {t.leadGuest && <div className="font-semibold text-white">{t.leadGuest}</div>}
                        <div>{t.pax} guest(s)</div>
                      </div>
                    </div>
                    <ol className="divide-y divide-slate-100">
                      {t.legs.map((l, i) => (
                        <li key={i} className="flex gap-3 px-4 py-2.5 text-xs">
                          <span className="w-14 shrink-0 font-semibold text-slate-700">{fmtTripDay(l.date).replace(/^\w+ /, '')}</span>
                          <span className="w-11 shrink-0 tabular-nums text-slate-400">{l.time ?? ''}</span>
                          <span className="min-w-0 text-slate-700">{l.route}</span>
                        </li>
                      ))}
                    </ol>
                  </div>
                ))}
              </div>
        )}

        <p className="mt-8 text-center text-[11px] text-slate-400">This page is personal to you — please do not share the link.</p>
      </main>

      {confirm && (
        <ConfirmSheet
          trip={confirm.trip}
          direct={confirm.direct}
          onClose={() => setConfirm(null)}
          onConfirm={async note => {
            try {
              const r = await post({ action: 'request', tripKey: confirm.trip.key, note })
              setFlash({ ok: true, text: r.message ?? 'Done.' })
              if (r.data.mode === 'assigned') setView('mine')
            } catch (e) {
              setFlash({ ok: false, text: (e as Error).message })
            }
            setConfirm(null)
            void load()
          }}
        />
      )}
    </Screen>
  )
}

// ── Pieces ───────────────────────────────────────────────────────────────────

function Screen({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-900 to-slate-900"><div className="mx-auto max-w-xl">{children}</div></div>
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div className="rounded-2xl bg-white/[0.07] px-3 py-2.5 ring-1 ring-white/10">
      <div className="text-xl font-bold tabular-nums">{value}</div>
      <div className="text-[10px] font-medium uppercase tracking-wider text-slate-400">{label}</div>
    </div>
  )
}

function Empty({ icon: Icon, title, text }: { icon: React.ComponentType<{ className?: string }>; title: string; text: string }) {
  return (
    <div className="mt-10 text-center">
      <span className="mx-auto grid h-14 w-14 place-items-center rounded-3xl bg-white shadow-sm ring-1 ring-slate-200"><Icon className="h-6 w-6 text-emerald-500" /></span>
      <div className="mt-3 text-sm font-bold text-slate-800">{title}</div>
      <div className="mx-auto mt-1 max-w-xs text-xs text-slate-500">{text}</div>
    </div>
  )
}

function DriverTripCard({ trip: t, direct, disabled, onAct, onWithdraw }: {
  trip: BoardTrip; direct: boolean; disabled: boolean; onAct: () => void; onWithdraw: () => void
}) {
  const [open, setOpen] = useState(false)
  const requested = !!t.myRequestId
  const blocked = direct && (t.busy || t.fits === false)

  return (
    <article className={cn('overflow-hidden rounded-3xl bg-white shadow-sm ring-1 transition', requested ? 'ring-2 ring-amber-400' : 'ring-slate-200')}>
      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              {t.kind === 'BOOKING' && <span className="rounded-full bg-slate-900 px-2 py-0.5 text-[10px] font-bold text-white">{t.days}-day tour</span>}
              {t.startTime && <span className="flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600"><Clock className="h-3 w-3" />{t.startTime}</span>}
            </div>
            <h3 className="mt-1.5 text-[15px] font-bold leading-snug text-slate-900">{t.title}</h3>
            <p className="mt-0.5 flex items-start gap-1 text-xs text-slate-500"><Route className="mt-0.5 h-3 w-3 shrink-0" />{t.route}</p>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-1.5 text-[11px]">
          <Pill icon={Users}>{t.pax} guest{t.pax === 1 ? '' : 's'}</Pill>
          {t.kind === 'BOOKING' && <Pill icon={CalendarDays}>{fmtTripDay(t.startDate).replace(/^\w+ /, '')} – {fmtTripDay(t.endDate).replace(/^\w+ /, '')}</Pill>}
          {t.kind === 'BOOKING' && t.cities.length > 0 && <Pill icon={MapPin}>{t.cities.length} places</Pill>}
          {t.busy && <span className="rounded-full bg-rose-50 px-2 py-1 font-semibold text-rose-600">You have a trip that day</span>}
          {t.fits === false && <span className="rounded-full bg-rose-50 px-2 py-1 font-semibold text-rose-600">Needs more seats</span>}
        </div>

        {t.legs.length > 1 && (
          <button onClick={() => setOpen(o => !o)} className="mt-3 flex items-center gap-1 text-xs font-semibold text-slate-500">
            <ChevronDown className={cn('h-4 w-4 transition-transform', open && 'rotate-180')} /> Day-by-day plan
          </button>
        )}
        {open && (
          <ol className="mt-2 space-y-1.5 border-l-2 border-emerald-200 pl-3">
            {t.legs.filter(l => l.driven).map(l => (
              <li key={l.agendaItemId} className="text-xs">
                <span className="font-semibold text-slate-700">{fmtTripDay(l.date)}</span>
                {l.time && <span className="ml-1 text-slate-400">{l.time}</span>}
                <div className="text-slate-500">{l.from || l.location}{l.to ? ` → ${l.to}` : ''}</div>
              </li>
            ))}
          </ol>
        )}
      </div>

      {requested ? (
        <div className="flex items-center justify-between bg-amber-50 px-4 py-3">
          <span className="flex items-center gap-1.5 text-xs font-semibold text-amber-800"><Hourglass className="h-3.5 w-3.5" /> Requested — waiting for approval</span>
          <button onClick={onWithdraw} className="text-xs font-semibold text-slate-500">Withdraw</button>
        </div>
      ) : (
        <button
          disabled={disabled || blocked}
          onClick={onAct}
          className={cn('flex w-full items-center justify-center gap-2 py-3.5 text-sm font-bold transition active:scale-[0.99] disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400',
            direct ? 'bg-emerald-600 text-white' : 'bg-slate-900 text-white')}
        >
          {direct ? <Zap className="h-4 w-4" /> : <Hand className="h-4 w-4" />}
          {blocked ? (t.busy ? 'You are busy on these dates' : 'Vehicle too small') : direct ? 'Take this trip' : 'Request this trip'}
        </button>
      )}
    </article>
  )
}

function Pill({ icon: Icon, children }: { icon: React.ComponentType<{ className?: string }>; children: React.ReactNode }) {
  return <span className="flex items-center gap-1 rounded-full bg-slate-100 px-2 py-1 font-semibold text-slate-600"><Icon className="h-3 w-3" />{children}</span>
}

function ConfirmSheet({ trip, direct, onClose, onConfirm }: { trip: BoardTrip; direct: boolean; onClose: () => void; onConfirm: (note: string) => Promise<void> }) {
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/60 backdrop-blur-sm" onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="w-full max-w-xl rounded-t-[28px] bg-white p-5 pb-8 shadow-2xl">
        <div className="mx-auto mb-4 h-1.5 w-10 rounded-full bg-slate-200" />
        <h2 className="text-lg font-bold text-slate-900">{direct ? 'Take this trip?' : 'Request this trip?'}</h2>
        <p className="mt-1 text-sm text-slate-500">
          {fmtTripDay(trip.startDate, { year: true })}{trip.days > 1 ? ` – ${fmtTripDay(trip.endDate, { year: true })}` : ''} · {trip.pax} guest(s)
        </p>
        <p className="mt-0.5 text-sm font-semibold text-slate-800">{trip.title}</p>
        <textarea value={note} onChange={e => setNote(e.target.value)} maxLength={500} rows={2}
                  placeholder="Note for operations (optional) — e.g. vehicle you will use"
                  className="mt-4 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500" />
        <p className="mt-2 text-xs text-slate-500">
          {direct ? 'The trip is assigned to you as soon as you confirm, and the details come on WhatsApp.' : 'Operations will review your request. You will get a WhatsApp message once it is approved.'}
        </p>
        <div className="mt-5 grid grid-cols-2 gap-2">
          <button onClick={onClose} className="rounded-2xl bg-slate-100 py-3.5 text-sm font-bold text-slate-700">Cancel</button>
          <button disabled={busy} onClick={async () => { setBusy(true); await onConfirm(note) }}
                  className={cn('flex items-center justify-center gap-2 rounded-2xl py-3.5 text-sm font-bold text-white disabled:opacity-60', direct ? 'bg-emerald-600' : 'bg-slate-900')}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} {direct ? 'Take it' : 'Send request'}
          </button>
        </div>
      </div>
    </div>
  )
}
