'use client'

/**
 * Pre-checking — the D-10 Hotel Reconfirmation queue.
 *
 * Every hotel stay across every live booking, ordered by how late it is.
 * Two ways to read it:
 *
 *  - **Board** groups stays into the four urgency lanes, which is how the
 *    morning stand-up works: clear the red lane, then the amber one.
 *  - **List** is the flat worklist for grinding through a single lane.
 *
 * The strip along the top is a 30-day D-10 horizon: one bar per day, height by
 * volume, coloured by how much of that day is still unconfirmed. It answers
 * "what is coming at me" before anyone has read a single row.
 */

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import {
  AlertTriangle, CalendarClock, CheckCircle2, ClipboardCheck, Columns3,
  Download, Link2Off, Loader2, PhoneOff, RefreshCw, Rows3, Search, X,
} from 'lucide-react'
import Button from '@/components/ui/button'
import { cn } from '@/lib/utils'
import StayCard from '@/components/precheck/stay-card'
import HotelResolverModal from '@/components/precheck/hotel-resolver-modal'
import { STATUS_META, STATUS_ORDER, URGENCY_META, fmtDay } from '@/components/precheck/precheck-ui'
import type { PrecheckStay, QueueStats, Urgency } from '@/lib/precheck-shared'

const COUNTRIES = [
  { value: '',                   label: 'All countries' },
  { value: 'SRILANKA',           label: 'Sri Lanka' },
  { value: 'VIETNAM',            label: 'Vietnam' },
  { value: 'SINGAPORE',          label: 'Singapore' },
  { value: 'MALAYSIA',           label: 'Malaysia' },
  { value: 'SINGAPORE_MALAYSIA', label: 'Singapore & Malaysia' },
]

const HORIZONS = [14, 30, 60, 90, 180]

/** Lanes shown on the board, in the order they must be cleared. */
const LANES: Array<{ id: Urgency; blurb: string }> = [
  { id: 'OVERDUE',   blurb: 'Past the D-10 deadline — chase today' },
  { id: 'DUE_TODAY', blurb: 'D-10 falls today' },
  { id: 'DUE_SOON',  blurb: 'D-10 within three days' },
  { id: 'UPCOMING',  blurb: 'Not yet due' },
]

function PrecheckQueue() {
  const searchParams = useSearchParams()

  const [rows, setRows] = useState<PrecheckStay[]>([])
  const [stats, setStats] = useState<QueueStats | null>(null)
  const [generatedAt, setGeneratedAt] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [resolving, setResolving] = useState<PrecheckStay | null>(null)

  // Filters
  const [search, setSearch] = useState(searchParams.get('q') ?? '')
  const [country, setCountry] = useState('')
  const [horizon, setHorizon] = useState(60)
  const [statusFilter, setStatusFilter] = useState<string[]>([])
  const [urgencyFilter, setUrgencyFilter] = useState<Urgency[]>([])
  const [onlyProblems, setOnlyProblems] = useState(false)
  const [view, setView] = useState<'board' | 'list'>('board')

  const searchRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ horizon: String(horizon) })
      if (country) params.set('country', country)
      if (statusFilter.length > 0) params.set('status', statusFilter.join(','))
      if (urgencyFilter.length > 0) params.set('urgency', urgencyFilter.join(','))

      const res = await fetch(`/api/precheck/queue?${params}`)
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      setRows(json.data.rows as PrecheckStay[])
      setStats(json.data.stats as QueueStats)
      setGeneratedAt(json.data.generatedAt as string)
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [country, horizon, statusFilter, urgencyFilter])

  useEffect(() => { void load() }, [load])

  // Search is applied client-side: the queue is already in memory, and typing
  // should not cost a round trip per keystroke on a list this size.
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter(r => {
      if (onlyProblems && !(r.unmatched || r.noContact || r.status === 'ISSUE' || r.status === 'DISCREPANCY')) return false
      if (!q) return true
      return [r.bookingRef, r.isNumber, r.agent, r.leadGuest, r.hotelName, r.city, r.confirmationNumber]
        .filter(Boolean).join(' ').toLowerCase().includes(q)
    })
  }, [rows, search, onlyProblems])

  // `/` focuses search from anywhere on the page.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '/' && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') {
        e.preventDefault()
        searchRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Keep the open modal on the freshest copy of its stay.
  useEffect(() => {
    if (!resolving) return
    const fresh = rows.find(r => r.stayKey === resolving.stayKey)
    if (fresh && fresh !== resolving) setResolving(fresh)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows])

  const byLane = useMemo(() => {
    const m: Record<string, PrecheckStay[]> = {}
    for (const lane of LANES) m[lane.id] = []
    m.SETTLED = []
    for (const r of visible) (m[r.urgency] ??= []).push(r)
    return m
  }, [visible])

  const exportCsv = useCallback(() => {
    const header = [
      'Booking Reference', 'IS Number', 'Guest', 'Hotel', 'City', 'Status',
      'Hotel Confirmation No', 'Check-in', 'Check-out', 'Nights', 'Room Type',
      'Room Category', 'Room Count', 'Meal', 'Adults', 'Children', 'CWB', 'CNB',
      'Hotel Phone', 'Hotel WhatsApp', 'D-10 Due', 'Urgency', 'Last Checked', 'Attempts',
    ]
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
    const lines = [header.map(esc).join(',')]
    for (const r of visible) {
      lines.push([
        r.bookingRef, r.isNumber, r.leadGuest, r.hotelName, r.city,
        STATUS_META[r.status]?.label ?? r.status, r.confirmationNumber,
        fmtDay(r.checkIn), fmtDay(r.checkOut), r.nights, r.roomType,
        r.roomCategory, r.roomCount, r.mealType, r.adults, r.children, r.cwb, r.cnb,
        r.hotel?.phone, r.hotel?.whatsapp, fmtDay(r.dueAt),
        URGENCY_META[r.urgency]?.label ?? r.urgency,
        r.lastCheckedAt ? fmtDay(r.lastCheckedAt) : '', r.attempts,
      ].map(esc).join(','))
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `pre-checking-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }, [visible])

  const toggle = <T extends string>(list: T[], v: T, set: (l: T[]) => void) =>
    set(list.includes(v) ? list.filter(x => x !== v) : [...list, v])

  return (
    <div className="space-y-4 pb-16">
      {/* ── Hero ────────────────────────────────────────────────────────── */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-5 text-white">
        <div className="absolute -right-10 -top-10 h-44 w-44 rounded-full bg-amber-500/10 blur-3xl" />
        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="flex items-center gap-2 text-xl font-bold">
              <ClipboardCheck className="w-5 h-5 text-amber-400" />
              Pre-checking
            </h1>
            <p className="mt-1 max-w-2xl text-xs text-slate-300">
              Hotel reconfirmation queue. Every stay is confirmed with the property ten days before
              the guest checks in — this is what is due, what is late, and what we still cannot reach.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="secondary" onClick={exportCsv} icon={<Download className="w-3.5 h-3.5" />}>
              Export CSV
            </Button>
            <Button size="sm" variant="secondary" onClick={() => void load()}
                    icon={<RefreshCw className={cn('w-3.5 h-3.5', loading && 'animate-spin')} />}>
              Refresh
            </Button>
          </div>
        </div>

        {/* KPI strip */}
        {stats && (
          <div className="relative mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            <Kpi label="Overdue"     value={stats.overdue}   tone="rose"    icon={AlertTriangle}
                 active={urgencyFilter.includes('OVERDUE')} onClick={() => toggle(urgencyFilter, 'OVERDUE' as Urgency, setUrgencyFilter)} />
            <Kpi label="Due today"   value={stats.dueToday}  tone="amber"   icon={CalendarClock}
                 active={urgencyFilter.includes('DUE_TODAY')} onClick={() => toggle(urgencyFilter, 'DUE_TODAY' as Urgency, setUrgencyFilter)} />
            <Kpi label="Due in 3d"   value={stats.dueSoon}   tone="yellow"  icon={CalendarClock}
                 active={urgencyFilter.includes('DUE_SOON')} onClick={() => toggle(urgencyFilter, 'DUE_SOON' as Urgency, setUrgencyFilter)} />
            <Kpi label="Confirmed"   value={stats.confirmed} tone="emerald" icon={CheckCircle2} />
            <Kpi label="Unmatched"   value={stats.unmatched} tone="slate"   icon={Link2Off} />
            <Kpi label="No contact"  value={stats.noContact} tone="rose"    icon={PhoneOff} />
          </div>
        )}

        {stats && (
          <div className="relative mt-3">
            <div className="flex items-center justify-between text-[10px] font-semibold text-slate-400 mb-1">
              <span>Reconfirmation completion, stays inside the D-10 window</span>
              <span className="tabular-nums text-slate-200">{stats.completion}%</span>
            </div>
            <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
              <div className="h-full rounded-full bg-gradient-to-r from-amber-400 to-emerald-400 transition-all duration-700"
                   style={{ width: `${stats.completion}%` }} />
            </div>
          </div>
        )}
      </div>

      {/* ── D-10 horizon ────────────────────────────────────────────────── */}
      <HorizonStrip rows={visible} />

      {/* ── Filters ─────────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-slate-200 bg-white p-3 space-y-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[14rem]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              ref={searchRef}
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search IS number, booking ref, guest, hotel…   (press /)"
              className="w-full rounded-lg border border-slate-300 py-2 pl-9 pr-8 text-sm focus:border-brand-500 focus:ring-2 focus:ring-brand-500"
            />
            {search && (
              <button onClick={() => setSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700">
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          <select value={country} onChange={e => setCountry(e.target.value)}
                  className="rounded-lg border border-slate-300 px-2.5 py-2 text-xs font-medium focus:ring-2 focus:ring-brand-500">
            {COUNTRIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>

          <select value={horizon} onChange={e => setHorizon(Number(e.target.value))}
                  className="rounded-lg border border-slate-300 px-2.5 py-2 text-xs font-medium focus:ring-2 focus:ring-brand-500">
            {HORIZONS.map(h => <option key={h} value={h}>Next {h} days</option>)}
          </select>

          <button
            onClick={() => setOnlyProblems(p => !p)}
            className={cn(
              'rounded-lg border px-2.5 py-2 text-xs font-semibold transition-colors',
              onlyProblems ? 'border-rose-300 bg-rose-50 text-rose-700' : 'border-slate-300 bg-white text-slate-500 hover:bg-slate-50',
            )}
            title="Only stays that are unmatched, unreachable, or flagged with an issue"
          >
            Needs attention
          </button>

          <div className="flex rounded-lg border border-slate-300 overflow-hidden">
            {([['board', Columns3], ['list', Rows3]] as const).map(([v, Icon]) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={cn('px-2.5 py-2', view === v ? 'bg-slate-900 text-white' : 'bg-white text-slate-400 hover:text-slate-700')}
                title={v === 'board' ? 'Board by urgency' : 'Flat list'}
              >
                <Icon className="w-4 h-4" />
              </button>
            ))}
          </div>
        </div>

        {/* Status chips */}
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mr-1">Status</span>
          {STATUS_ORDER.map(s => {
            const m = STATUS_META[s]
            const active = statusFilter.includes(s)
            return (
              <button
                key={s}
                onClick={() => toggle(statusFilter, s as string, setStatusFilter)}
                className={cn(
                  'rounded-full border px-2 py-0.5 text-[10px] font-semibold transition-colors',
                  active ? m.chip : 'border-slate-200 bg-white text-slate-400 hover:bg-slate-50',
                )}
              >
                {m.label}
              </button>
            )
          })}
          {(statusFilter.length > 0 || urgencyFilter.length > 0 || onlyProblems) && (
            <button
              onClick={() => { setStatusFilter([]); setUrgencyFilter([]); setOnlyProblems(false) }}
              className="ml-1 text-[10px] font-semibold text-slate-400 hover:text-rose-600"
            >
              Clear filters
            </button>
          )}
          <span className="ml-auto text-[10px] text-slate-400">
            {visible.length} stay{visible.length === 1 ? '' : 's'}
            {generatedAt && ` · as of ${new Date(generatedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`}
          </span>
        </div>
      </div>

      {/* ── Body ────────────────────────────────────────────────────────── */}
      {loading && rows.length === 0 && (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-slate-400">
          <Loader2 className="w-4 h-4 animate-spin" /> Building the reconfirmation queue…
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
          <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <div>
            <div className="font-semibold">Could not load the queue</div>
            <div className="text-xs text-rose-600">{error}</div>
          </div>
        </div>
      )}

      {!loading && !error && visible.length === 0 && (
        <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 py-16 text-center">
          <CheckCircle2 className="mx-auto w-8 h-8 text-emerald-400" />
          <p className="mt-2 text-sm font-semibold text-slate-700">Nothing to reconfirm</p>
          <p className="text-xs text-slate-400">No hotel stay matches these filters in the next {horizon} days.</p>
        </div>
      )}

      {view === 'list' && visible.length > 0 && (
        <div className="space-y-2">
          {visible.map(stay => (
            <StayCard key={stay.stayKey} stay={stay} showBooking onChanged={load} onResolveHotel={setResolving} />
          ))}
        </div>
      )}

      {view === 'board' && visible.length > 0 && (
        <div className="space-y-4">
          {LANES.map(lane => {
            const laneRows = byLane[lane.id] ?? []
            if (laneRows.length === 0) return null
            const m = URGENCY_META[lane.id]
            return (
              <section key={lane.id}>
                <div className="mb-2 flex items-center gap-2">
                  <span className={cn('h-4 w-1 rounded-full', m.bar)} />
                  <h2 className="text-sm font-bold text-slate-800">{m.label}</h2>
                  <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-500">
                    {laneRows.length}
                  </span>
                  <span className="text-[11px] text-slate-400">{lane.blurb}</span>
                </div>
                <div className="space-y-2">
                  {laneRows.map(stay => (
                    <StayCard key={stay.stayKey} stay={stay} showBooking onChanged={load} onResolveHotel={setResolving} />
                  ))}
                </div>
              </section>
            )
          })}

          {(byLane.SETTLED ?? []).length > 0 && (
            <details className="rounded-xl border border-slate-200 bg-white">
              <summary className="cursor-pointer px-4 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-50">
                Settled — {byLane.SETTLED.length} stay{byLane.SETTLED.length === 1 ? '' : 's'} confirmed or not required
              </summary>
              <div className="space-y-2 p-3 pt-0">
                {byLane.SETTLED.map(stay => (
                  <StayCard key={stay.stayKey} stay={stay} showBooking onChanged={load} onResolveHotel={setResolving} />
                ))}
              </div>
            </details>
          )}
        </div>
      )}

      {resolving && (
        <HotelResolverModal open stay={resolving} onClose={() => setResolving(null)} onSaved={load} />
      )}
    </div>
  )
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function Kpi({
  label, value, tone, icon: Icon, active, onClick,
}: {
  label: string
  value: number
  tone: 'rose' | 'amber' | 'yellow' | 'emerald' | 'slate'
  icon: typeof AlertTriangle
  active?: boolean
  onClick?: () => void
}) {
  const accent = {
    rose: 'text-rose-400', amber: 'text-amber-400', yellow: 'text-yellow-300',
    emerald: 'text-emerald-400', slate: 'text-slate-400',
  }[tone]

  return (
    <button
      onClick={onClick}
      disabled={!onClick}
      className={cn(
        'rounded-xl border p-2.5 text-left transition-colors',
        active ? 'border-white/40 bg-white/15' : 'border-white/10 bg-white/5',
        onClick ? 'hover:bg-white/10 cursor-pointer' : 'cursor-default',
      )}
    >
      <div className="flex items-center gap-1.5">
        <Icon className={cn('w-3.5 h-3.5', accent)} />
        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-300">{label}</span>
      </div>
      <div className={cn('mt-0.5 text-2xl font-bold tabular-nums', value > 0 ? 'text-white' : 'text-slate-500')}>
        {value}
      </div>
    </button>
  )
}

/**
 * 30-day D-10 horizon.
 *
 * One bar per day of due dates: height scales with how many stays fall due
 * that day, and the filled portion is what is already confirmed. Red columns
 * to the left are the backlog; a tall unfilled column ahead is next week's
 * problem, visible before it becomes one.
 */
function HorizonStrip({ rows }: { rows: PrecheckStay[] }) {
  const days = useMemo(() => {
    const today = new Date()
    today.setUTCHours(0, 0, 0, 0)
    const buckets: Array<{ date: Date; total: number; done: number; overdue: number }> = []

    for (let i = -3; i < 28; i++) {
      buckets.push({ date: new Date(today.getTime() + i * 86_400_000), total: 0, done: 0, overdue: 0 })
    }

    for (const r of rows) {
      const due = new Date(r.dueAt)
      due.setUTCHours(0, 0, 0, 0)
      const idx = Math.round((due.getTime() - today.getTime()) / 86_400_000) + 3
      if (idx < 0 || idx >= buckets.length) continue
      buckets[idx].total++
      if (r.status === 'CONFIRMED' || r.status === 'NOT_REQUIRED') buckets[idx].done++
      else if (r.urgency === 'OVERDUE') buckets[idx].overdue++
    }
    return buckets
  }, [rows])

  const max = Math.max(1, ...days.map(d => d.total))
  if (days.every(d => d.total === 0)) return null

  const todayIdx = 3

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
          D-10 horizon · next four weeks
        </h3>
        <div className="flex items-center gap-3 text-[9px] text-slate-400">
          <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-emerald-400" /> confirmed</span>
          <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-rose-400" /> overdue</span>
          <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-slate-300" /> pending</span>
        </div>
      </div>

      <div className="flex items-end gap-[3px] h-20 overflow-x-auto">
        {days.map((d, i) => {
          const h = d.total === 0 ? 3 : Math.max(8, Math.round((d.total / max) * 72))
          const donePct = d.total === 0 ? 0 : (d.done / d.total) * 100
          const overduePct = d.total === 0 ? 0 : (d.overdue / d.total) * 100
          const isToday = i === todayIdx
          return (
            <div key={i} className="flex flex-1 min-w-[10px] flex-col items-center gap-1">
              <div
                className={cn('relative w-full rounded-sm overflow-hidden bg-slate-200', isToday && 'ring-2 ring-amber-400 ring-offset-1')}
                style={{ height: h }}
                title={`${d.date.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', timeZone: 'UTC' })} — ${d.total} due, ${d.done} confirmed${d.overdue ? `, ${d.overdue} overdue` : ''}`}
              >
                <div className="absolute bottom-0 w-full bg-emerald-400" style={{ height: `${donePct}%` }} />
                <div className="absolute top-0 w-full bg-rose-400" style={{ height: `${overduePct}%` }} />
              </div>
              <span className={cn('text-[8px] tabular-nums', isToday ? 'font-bold text-amber-600' : 'text-slate-400')}>
                {isToday ? 'today' : d.date.getUTCDate()}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/**
 * `useSearchParams` forces this tree into client rendering; the Suspense
 * boundary is what lets Next build the route without bailing on the whole page.
 */
export default function PrecheckPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center gap-2 py-24 text-sm text-slate-400">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading Pre-checking…
      </div>
    }>
      <PrecheckQueue />
    </Suspense>
  )
}
