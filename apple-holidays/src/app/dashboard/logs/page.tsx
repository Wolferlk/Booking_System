'use client'

/**
 * Booking Logs — every change on every booking, searchable.
 * Section by section: guest contact, passengers, flights, accommodation,
 * overview & status, movement chart (drivers, vendors, guides) and daily
 * messages (with why a send failed). Data: GET /api/logs (read-only).
 */
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  History, Search, X, AlertTriangle, Loader2, RefreshCw, Calendar, User, Hash, Inbox,
  LayoutGrid, Phone, Users, Plane, BedDouble, Route, MessageCircle, FileText,
} from 'lucide-react'
import Header from '@/components/layout/header'
import { LogTimeline } from '@/components/logs/log-timeline'
import type { LogEntry, LogSection } from '@/lib/booking-logs'

const SECTIONS: { id: LogSection | ''; label: string; Icon: typeof History }[] = [
  { id: '', label: 'All', Icon: LayoutGrid },
  { id: 'overview', label: 'Overview & status', Icon: FileText },
  { id: 'contact', label: 'Guest contact', Icon: Phone },
  { id: 'passengers', label: 'Passengers', Icon: Users },
  { id: 'flights', label: 'Flights', Icon: Plane },
  { id: 'accommodation', label: 'Accommodation', Icon: BedDouble },
  { id: 'agenda', label: 'Movement chart', Icon: Route },
  { id: 'messages', label: 'Daily messages', Icon: MessageCircle },
]

const isoDay = (d: Date) => d.toISOString().slice(0, 10)

export default function LogsPage() {
  return (
    <Suspense fallback={null}>
      <LogsView />
    </Suspense>
  )
}

function LogsView() {
  const sp = useSearchParams()
  const router = useRouter()
  const [q, setQ] = useState(sp.get('q') ?? '')
  const [ref, setRef] = useState(sp.get('ref') ?? '')
  const [actor, setActor] = useState(sp.get('actor') ?? '')
  const [section, setSection] = useState<LogSection | ''>((sp.get('section') as LogSection) ?? '')
  const [from, setFrom] = useState(sp.get('from') ?? (sp.get('ref') ? '' : isoDay(new Date(Date.now() - 7 * 86_400_000))))
  const [to, setTo] = useState(sp.get('to') ?? '')
  const [failedOnly, setFailedOnly] = useState(sp.get('failed') === '1')

  const [entries, setEntries] = useState<LogEntry[]>([])
  const [next, setNext] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [more, setMore] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const params = useMemo(() => {
    const p = new URLSearchParams()
    if (q.trim()) p.set('q', q.trim())
    if (ref.trim()) p.set('ref', ref.trim().toUpperCase())
    if (actor.trim()) p.set('actor', actor.trim())
    if (section) p.set('section', section)
    if (from) p.set('from', from)
    if (to) p.set('to', to)
    if (failedOnly) p.set('failed', '1')
    return p
  }, [q, ref, actor, section, from, to, failedOnly])

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const j = await (await fetch(`/api/logs?${params}`)).json()
      if (!j.success) throw new Error(j.error ?? 'Could not load logs')
      setEntries(j.data.entries); setNext(j.data.nextBefore)
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not load logs') } finally { setLoading(false) }
  }, [params])

  // Debounced reload + keep the URL shareable.
  useEffect(() => {
    const t = setTimeout(() => {
      void load()
      router.replace(`/dashboard/logs${params.toString() ? `?${params}` : ''}`, { scroll: false })
    }, 350)
    return () => clearTimeout(t)
  }, [load, params, router])

  const loadMore = async () => {
    if (!next) return
    setMore(true)
    try {
      const p = new URLSearchParams(params); p.set('before', next)
      const j = await (await fetch(`/api/logs?${p}`)).json()
      if (j.success) { setEntries(cur => [...cur, ...j.data.entries]); setNext(j.data.nextBefore) }
    } finally { setMore(false) }
  }

  const stats = useMemo(() => ({
    total: entries.length,
    failed: entries.filter(e => e.tone === 'fail' || e.tone === 'skip').length,
    bookings: new Set(entries.map(e => e.bookingRef).filter(Boolean)).size,
    people: new Set(entries.map(e => e.actor).filter(Boolean)).size,
  }), [entries])

  const clearAll = () => { setQ(''); setRef(''); setActor(''); setSection(''); setFrom(isoDay(new Date(Date.now() - 7 * 86_400_000))); setTo(''); setFailedOnly(false) }
  const quickRange = (days: number) => { setFrom(isoDay(new Date(Date.now() - days * 86_400_000))); setTo('') }

  return (
    <div className="min-h-screen bg-slate-50/60">
      <Header title="Booking Logs" subtitle="Who changed what, when — and why a message did not go out" />

      <div className="mx-auto max-w-6xl space-y-5 px-4 py-6 sm:px-8">
        {/* Search hero */}
        <div className="relative overflow-hidden rounded-2xl border border-indigo-100 bg-gradient-to-br from-indigo-600 via-indigo-500 to-violet-500 p-5 text-white shadow-lg shadow-indigo-500/20">
          <History aria-hidden className="pointer-events-none absolute -right-6 -top-6 h-40 w-40 text-white/10" />
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-indigo-100">Search the logs</p>
          <div className="relative mt-2">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-indigo-300" />
            <input value={q} onChange={e => setQ(e.target.value)} autoFocus
              placeholder="Booking ref, driver, hotel, flight, phone, reason…"
              className="h-12 w-full rounded-xl border-0 bg-white pl-11 pr-10 text-[15px] text-slate-800 shadow-inner placeholder:text-slate-400 focus:outline-none focus:ring-4 focus:ring-white/40" />
            {q && (
              <button type="button" onClick={() => setQ('')} className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-1 text-slate-400 hover:bg-slate-100">
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          <div className="relative mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Field Icon={Hash} placeholder="Booking ref" value={ref} onChange={setRef} />
            <Field Icon={User} placeholder="Person" value={actor} onChange={setActor} />
            <DateField label="From" value={from} onChange={setFrom} />
            <DateField label="To" value={to} onChange={setTo} />
          </div>

          <div className="relative mt-3 flex flex-wrap items-center gap-2 text-[12px]">
            {[['Today', 0], ['7 days', 7], ['30 days', 30], ['90 days', 90]].map(([l, d]) => (
              <button key={l} type="button" onClick={() => quickRange(d as number)}
                className="rounded-full bg-white/15 px-3 py-1 font-medium text-white hover:bg-white/25">{l}</button>
            ))}
            <button type="button" onClick={() => setFailedOnly(v => !v)}
              className={`inline-flex items-center gap-1 rounded-full px-3 py-1 font-semibold transition ${failedOnly ? 'bg-rose-500 text-white shadow' : 'bg-white/15 text-white hover:bg-white/25'}`}>
              <AlertTriangle className="h-3.5 w-3.5" /> Failed / not sent only
            </button>
            <button type="button" onClick={clearAll} className="ml-auto rounded-full px-3 py-1 text-indigo-100 hover:bg-white/15">Clear</button>
          </div>
        </div>

        {/* Section pills */}
        <div className="flex gap-2 overflow-x-auto pb-1">
          {SECTIONS.map(s => (
            <button key={s.id || 'all'} type="button" onClick={() => setSection(s.id)}
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12.5px] font-medium transition ${
                section === s.id ? 'border-indigo-600 bg-indigo-600 text-white shadow-sm' : 'border-slate-200 bg-white text-slate-600 hover:border-indigo-200 hover:text-indigo-700'}`}>
              <s.Icon className="h-3.5 w-3.5" /> {s.label}
            </button>
          ))}
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Entries" value={stats.total} sub={next ? 'more below' : 'loaded'} tone="indigo" />
          <Stat label="Failed / not sent" value={stats.failed} sub="with a reason" tone={stats.failed ? 'rose' : 'slate'} />
          <Stat label="Bookings" value={stats.bookings} sub="touched" tone="teal" />
          <Stat label="People" value={stats.people} sub="made changes" tone="violet" />
        </div>

        {/* Timeline */}
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
          <div className="mb-4 flex items-center gap-2">
            <h2 className="text-[14px] font-semibold text-slate-800">Activity</h2>
            {loading && <Loader2 className="h-4 w-4 animate-spin text-indigo-400" />}
            <button type="button" onClick={() => void load()} className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1 text-[12px] text-slate-600 hover:bg-slate-50">
              <RefreshCw className="h-3.5 w-3.5" /> Refresh
            </button>
          </div>

          {error ? (
            <p className="rounded-xl bg-rose-50 px-3 py-2 text-[13px] text-rose-700">{error}</p>
          ) : loading && entries.length === 0 ? (
            <div className="space-y-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="flex gap-3"><span className="h-6 w-6 animate-pulse rounded-full bg-slate-100" /><span className="h-16 flex-1 animate-pulse rounded-xl bg-slate-50" /></div>
              ))}
            </div>
          ) : entries.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-16 text-center">
              <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-50 text-slate-300"><Inbox className="h-7 w-7" /></span>
              <p className="text-[14px] font-medium text-slate-600">No log entries match</p>
              <p className="text-[12px] text-slate-400">Try a wider date range or a different search.</p>
            </div>
          ) : (
            <>
              <LogTimeline entries={entries} showRef showSection={!section} />
              {next && (
                <button type="button" onClick={loadMore} disabled={more}
                  className="mt-5 flex w-full items-center justify-center gap-1.5 rounded-xl border border-slate-200 py-2.5 text-[13px] font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-60">
                  {more && <Loader2 className="h-4 w-4 animate-spin" />} Load older
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function Field({ Icon, placeholder, value, onChange }: { Icon: typeof Hash; placeholder: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="relative">
      <Icon className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-indigo-200" />
      <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        className="h-9 w-full rounded-lg border border-white/20 bg-white/10 pl-8 pr-2 text-[13px] text-white placeholder:text-indigo-200 focus:bg-white/20 focus:outline-none" />
    </label>
  )
}

function DateField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="relative flex h-9 items-center gap-1.5 rounded-lg border border-white/20 bg-white/10 px-2.5 text-[12px] text-indigo-100">
      <Calendar className="h-3.5 w-3.5 shrink-0 text-indigo-200" />
      <span className="shrink-0">{label}</span>
      <input type="date" value={value} onChange={e => onChange(e.target.value)}
        className="min-w-0 flex-1 bg-transparent text-[12.5px] text-white [color-scheme:dark] focus:outline-none" />
    </label>
  )
}

const STAT_TONE = {
  indigo: 'from-indigo-50 text-indigo-700',
  rose: 'from-rose-50 text-rose-700',
  teal: 'from-teal-50 text-teal-700',
  violet: 'from-violet-50 text-violet-700',
  slate: 'from-slate-50 text-slate-600',
} as const

function Stat({ label, value, sub, tone }: { label: string; value: number; sub: string; tone: keyof typeof STAT_TONE }) {
  return (
    <div className={`rounded-2xl border border-slate-200 bg-gradient-to-br to-white p-4 shadow-sm ${STAT_TONE[tone]}`}>
      <p className="text-[10.5px] font-bold uppercase tracking-[0.14em] opacity-70">{label}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums">{value}</p>
      <p className="text-[11px] text-slate-400">{sub}</p>
    </div>
  )
}
