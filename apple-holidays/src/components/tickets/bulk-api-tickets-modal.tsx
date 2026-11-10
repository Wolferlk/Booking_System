'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import {
  Zap, Loader2, CalendarDays, CheckCircle2, AlertCircle, MinusCircle, Square,
  RotateCcw, Search, Plane, MapPin, Ticket as TicketIcon, ExternalLink,
} from 'lucide-react'
import Modal from '@/components/ui/modal'
import { formatDate } from '@/lib/utils'

/**
 * Bulk "Create Tickets from API" — pick a travel date (or a short range), see
 * every booking travelling then, and run the same create-only button on each.
 *
 * The run is driven from the browser: one POST /api/bookings/[ref]/as-tickets
 * per booking, two at a time. That keeps each request inside the Lambda limit,
 * lets the desk watch every booking finish, and stop half-way without leaving
 * anything half-written (each booking is its own create-only call).
 */

type Mode = 'arriving' | 'travelling'
type RunState = 'idle' | 'queued' | 'running' | 'done' | 'nothing' | 'failed' | 'skipped'

interface DayBooking {
  bookingRef: string
  isNumber: string | null
  agent: string | null
  status: string
  arrivalDate: string
  departureDate: string
  operationCountry: string | null
  pax: number
  ticketCount: number
}

interface RowResult {
  state: RunState
  created?: number
  existed?: number
  notRequested?: number
  placed?: number
  source?: string
  message?: string
}

const CONCURRENCY = 2

function ymd(d: Date) {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
function addDays(s: string, n: number) {
  const d = new Date(`${s}T00:00:00`)
  d.setDate(d.getDate() + n)
  return ymd(d)
}

interface Props {
  open: boolean
  onClose: () => void
  /** Called after a run that created at least one ticket, to refresh the list. */
  onDone: () => void
  countryFilter?: string | null
}

export default function BulkApiTicketsModal({ open, onClose, onDone, countryFilter }: Props) {
  const today = ymd(new Date())
  const [from, setFrom] = useState(addDays(today, 1))
  const [to, setTo] = useState(addDays(today, 1))
  const [isRange, setIsRange] = useState(false)
  const [mode, setMode] = useState<Mode>('arriving')
  const [onlyEmpty, setOnlyEmpty] = useState(false)
  const [query, setQuery] = useState('')

  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [bookings, setBookings] = useState<DayBooking[]>([])
  const [truncated, setTruncated] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [results, setResults] = useState<Record<string, RowResult>>({})
  const [running, setRunning] = useState(false)
  const stopRef = useRef(false)

  const endDate = isRange ? to : from

  // ── load bookings for the chosen day(s) ───────────────────────────────────
  const load = useCallback(async () => {
    if (!from) return
    setLoading(true)
    setLoadError(null)
    setResults({})
    try {
      const qs = new URLSearchParams({ from, to: endDate, mode })
      if (countryFilter && countryFilter !== 'ALL') qs.set('country', countryFilter)
      const res = await fetch(`/api/tickets/from-api-day?${qs}`)
      const json = await res.json()
      if (!json.success) throw new Error(json.error || 'Could not load bookings')
      const list: DayBooking[] = json.data.bookings
      setBookings(list)
      setTruncated(!!json.data.truncated)
      setSelected(new Set(list.filter(b => b.status !== 'CANCELLED').map(b => b.bookingRef)))
    } catch (e) {
      setBookings([])
      setSelected(new Set())
      setLoadError(e instanceof Error ? e.message : 'Could not load bookings')
    } finally {
      setLoading(false)
    }
  }, [from, endDate, mode, countryFilter])

  useEffect(() => {
    if (open && !running) load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, from, endDate, mode, countryFilter])

  // ── derived ───────────────────────────────────────────────────────────────
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return bookings.filter(b => {
      if (onlyEmpty && b.ticketCount > 0) return false
      if (!q) return true
      return [b.bookingRef, b.isNumber, b.agent].some(v => v?.toLowerCase().includes(q))
    })
  }, [bookings, query, onlyEmpty])

  const runnable = visible.filter(b => b.status !== 'CANCELLED')
  const chosen = runnable.filter(b => selected.has(b.bookingRef))
  const allChosen = runnable.length > 0 && chosen.length === runnable.length

  const totals = useMemo(() => {
    const t = { done: 0, created: 0, existed: 0, notRequested: 0, placed: 0, failed: 0, nothing: 0, total: 0 }
    for (const r of Object.values(results)) {
      if (r.state === 'idle' || r.state === 'skipped') continue
      t.total++
      if (r.state === 'done' || r.state === 'nothing' || r.state === 'failed') t.done++
      if (r.state === 'failed') t.failed++
      if (r.state === 'nothing') t.nothing++
      t.created += r.created ?? 0
      t.existed += r.existed ?? 0
      t.notRequested += r.notRequested ?? 0
      t.placed += r.placed ?? 0
    }
    return t
  }, [results])

  const hasRun = totals.total > 0
  const failedRefs = Object.entries(results).filter(([, r]) => r.state === 'failed').map(([k]) => k)

  // ── run ───────────────────────────────────────────────────────────────────
  async function runOne(ref: string): Promise<number> {
    setResults(r => ({ ...r, [ref]: { state: 'running' } }))
    try {
      const res = await fetch(`/api/bookings/${encodeURIComponent(ref)}/as-tickets`, { method: 'POST' })
      const json = await res.json().catch(() => ({ success: false, error: `HTTP ${res.status}` }))
      if (!json.success) {
        // 404 "no quotation" and 422 "no costing" aren't failures of the run —
        // there is simply nothing to make tickets from.
        const nothing = res.status === 404 || res.status === 422
        setResults(r => ({ ...r, [ref]: { state: nothing ? 'nothing' : 'failed', message: json.error } }))
        return 0
      }
      const d = json.data ?? {}
      setResults(r => ({
        ...r,
        [ref]: {
          state: 'done',
          created: d.created ?? 0,
          existed: d.skipped ?? 0,
          notRequested: d.notRequested ?? 0,
          placed: d.placed ?? 0,
          source: d.source,
          message: json.message,
        },
      }))
      return (d.created ?? 0) + (d.placed ?? 0)
    } catch (e) {
      setResults(r => ({ ...r, [ref]: { state: 'failed', message: e instanceof Error ? e.message : 'Network error' } }))
      return 0
    }
  }

  async function run(refs: string[]) {
    if (!refs.length) return
    stopRef.current = false
    setRunning(true)
    setResults(r => {
      const next = { ...r }
      for (const ref of refs) next[ref] = { state: 'queued' }
      return next
    })

    const queue = [...refs]
    let createdAny = false
    const worker = async () => {
      while (queue.length && !stopRef.current) {
        const ref = queue.shift()!
        createdAny = (await runOne(ref)) > 0 || createdAny
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, refs.length) }, worker))

    // Anything still queued after Stop goes back to "skipped".
    setResults(r => {
      const next = { ...r }
      for (const ref of queue) next[ref] = { state: 'skipped', message: 'Stopped before this booking ran' }
      return next
    })
    setRunning(false)

    // Refresh the ticket counts beside each booking, keep the results.
    try {
      const qs = new URLSearchParams({ from, to: endDate, mode })
      if (countryFilter && countryFilter !== 'ALL') qs.set('country', countryFilter)
      const res = await fetch(`/api/tickets/from-api-day?${qs}`)
      const json = await res.json()
      if (json.success) setBookings(json.data.bookings)
    } catch { /* counts just stay as they were */ }

    if (createdAny) onDone()
    toast.success(stopRef.current ? 'Run stopped' : 'Bulk run finished')
  }

  function toggleAll() {
    setSelected(prev => {
      const next = new Set(prev)
      if (allChosen) runnable.forEach(b => next.delete(b.bookingRef))
      else runnable.forEach(b => next.add(b.bookingRef))
      return next
    })
  }

  function handleClose() {
    if (running && !confirm('A run is in progress. Stop it and close?')) return
    stopRef.current = true
    onClose()
  }

  const quick: { label: string; apply: () => void; active: boolean }[] = [
    { label: 'Today', apply: () => { setIsRange(false); setFrom(today) }, active: !isRange && from === today },
    { label: 'Tomorrow', apply: () => { setIsRange(false); setFrom(addDays(today, 1)) }, active: !isRange && from === addDays(today, 1) },
    { label: 'In 2 days', apply: () => { setIsRange(false); setFrom(addDays(today, 2)) }, active: !isRange && from === addDays(today, 2) },
    { label: 'In 3 days', apply: () => { setIsRange(false); setFrom(addDays(today, 3)) }, active: !isRange && from === addDays(today, 3) },
    {
      label: 'Next 7 days',
      apply: () => { setIsRange(true); setFrom(today); setTo(addDays(today, 6)) },
      active: isRange && from === today && to === addDays(today, 6),
    },
  ]

  const pct = hasRun ? Math.round((totals.done / totals.total) * 100) : 0

  // ── render ────────────────────────────────────────────────────────────────
  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Create Tickets from API — by travel date"
      size="4xl"
      footer={
        <div className="flex items-center justify-between w-full gap-3 flex-wrap">
          <p className="text-xs text-gray-500 max-w-md">
            Create-only: existing tickets are never changed. B2C store bookings read the store order instead of AppleSystem.
          </p>
          <div className="flex items-center gap-2">
            {running ? (
              <button onClick={() => { stopRef.current = true }} className="btn btn-secondary">
                <Square className="w-4 h-4" /> Stop after current
              </button>
            ) : (
              <>
                {failedRefs.length > 0 && (
                  <button onClick={() => run(failedRefs)} className="btn btn-secondary">
                    <RotateCcw className="w-4 h-4" /> Retry {failedRefs.length} failed
                  </button>
                )}
                <button onClick={handleClose} className="btn btn-secondary">Close</button>
                <button
                  onClick={() => run(chosen.map(b => b.bookingRef))}
                  disabled={!chosen.length || loading}
                  className="btn btn-primary disabled:opacity-50"
                >
                  <Zap className="w-4 h-4" />
                  Create for {chosen.length} booking{chosen.length !== 1 ? 's' : ''}
                </button>
              </>
            )}
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        {/* ── date picker ─────────────────────────────────────────────── */}
        <div className="rounded-xl border border-emerald-100 bg-gradient-to-br from-emerald-50 to-white p-4 space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <label className="block">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-emerald-800">
                {isRange ? 'From' : 'Travel date'}
              </span>
              <div className="relative mt-1">
                <CalendarDays className="w-4 h-4 text-emerald-600 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="date"
                  value={from}
                  disabled={running}
                  onChange={e => { setFrom(e.target.value); if (isRange && e.target.value > to) setTo(e.target.value) }}
                  className="input pl-8 w-44"
                />
              </div>
            </label>
            {isRange && (
              <label className="block">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-emerald-800">To</span>
                <input
                  type="date"
                  value={to}
                  min={from}
                  max={addDays(from, 30)}
                  disabled={running}
                  onChange={e => setTo(e.target.value)}
                  className="input mt-1 w-44"
                />
              </label>
            )}
            <label className="flex items-center gap-2 text-sm text-gray-600 pb-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={isRange}
                disabled={running}
                onChange={e => { setIsRange(e.target.checked); if (e.target.checked && to < from) setTo(from) }}
              />
              Date range
            </label>

            <div className="ml-auto inline-flex rounded-lg border border-gray-200 bg-white p-0.5 text-sm">
              {([
                ['arriving', 'Arriving', Plane, 'Bookings whose arrival date is on the chosen day(s)'],
                ['travelling', 'On tour', MapPin, 'Every booking in the country on the chosen day(s) — arrived on or before, leaving on or after'],
              ] as const).map(([key, label, Icon, title]) => (
                <button
                  key={key}
                  type="button"
                  title={title}
                  disabled={running}
                  onClick={() => setMode(key)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md transition ${
                    mode === key ? 'bg-emerald-600 text-white shadow-sm' : 'text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" /> {label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {quick.map(q => (
              <button
                key={q.label}
                type="button"
                disabled={running}
                onClick={q.apply}
                className={`px-2.5 py-1 rounded-full text-xs border transition ${
                  q.active
                    ? 'bg-emerald-600 border-emerald-600 text-white'
                    : 'bg-white border-gray-200 text-gray-600 hover:border-emerald-300'
                }`}
              >
                {q.label}
              </button>
            ))}
          </div>
        </div>

        {/* ── progress ────────────────────────────────────────────────── */}
        {hasRun && (
          <div className="rounded-xl border border-gray-200 p-3 space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium text-gray-700">
                {running ? <>Running… {totals.done} / {totals.total}</> : <>Finished {totals.done} / {totals.total}</>}
              </span>
              <span className="text-gray-500">{pct}%</span>
            </div>
            <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
              <div
                className={`h-full transition-all duration-300 ${totals.failed ? 'bg-amber-500' : 'bg-emerald-500'}`}
                style={{ width: `${pct}%` }}
              />
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 pt-1">
              <Stat label="Tickets created" value={totals.created} tone="emerald" />
              <Stat label="Already existed" value={totals.existed} tone="gray" />
              <Stat label="Not requested" value={totals.notRequested} tone="gray" />
              <Stat label="No quote / costing" value={totals.nothing} tone="gray" />
              <Stat label="Failed" value={totals.failed} tone={totals.failed ? 'red' : 'gray'} />
            </div>
            {totals.placed > 0 && (
              <p className="text-xs text-gray-500">+ {totals.placed} hotel / flight / traveller rows placed from B2C store orders.</p>
            )}
          </div>
        )}

        {/* ── list toolbar ────────────────────────────────────────────── */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="w-4 h-4 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Filter by booking ref, IS number or agent…"
              className="input pl-8 w-full"
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer select-none">
            <input type="checkbox" checked={onlyEmpty} onChange={e => setOnlyEmpty(e.target.checked)} />
            Only bookings with no tickets yet
          </label>
          <span className="text-xs text-gray-500">
            {bookings.length} booking{bookings.length !== 1 ? 's' : ''} {mode === 'arriving' ? 'arriving' : 'on tour'}
            {' '}{isRange ? `${formatDate(from)} – ${formatDate(to)}` : `on ${formatDate(from)}`}
          </span>
        </div>

        {/* ── list ────────────────────────────────────────────────────── */}
        <div className="rounded-xl border border-gray-200 overflow-hidden">
          <div className="max-h-[42vh] overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center gap-2 py-12 text-gray-500 text-sm">
                <Loader2 className="w-4 h-4 animate-spin" /> Loading bookings…
              </div>
            ) : loadError ? (
              <div className="flex items-center justify-center gap-2 py-12 text-red-600 text-sm">
                <AlertCircle className="w-4 h-4" /> {loadError}
              </div>
            ) : visible.length === 0 ? (
              <div className="py-12 text-center text-sm text-gray-500">
                <CalendarDays className="w-8 h-8 mx-auto mb-2 text-gray-300" />
                No bookings {mode === 'arriving' ? 'arriving' : 'on tour'} on this date.
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-[11px] uppercase tracking-wide text-gray-500 sticky top-0 z-10">
                  <tr>
                    <th className="w-10 px-3 py-2">
                      <input type="checkbox" checked={allChosen} disabled={running} onChange={toggleAll} />
                    </th>
                    <th className="text-left px-2 py-2">Booking</th>
                    <th className="text-left px-2 py-2">Travel</th>
                    <th className="text-center px-2 py-2">Pax</th>
                    <th className="text-center px-2 py-2">Tickets</th>
                    <th className="text-left px-2 py-2 w-[34%]">Result</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {visible.map(b => {
                    const cancelled = b.status === 'CANCELLED'
                    const r = results[b.bookingRef]
                    return (
                      <tr
                        key={b.bookingRef}
                        className={`${cancelled ? 'opacity-50' : ''} ${r?.state === 'running' ? 'bg-emerald-50/60' : ''}`}
                      >
                        <td className="px-3 py-2 text-center">
                          <input
                            type="checkbox"
                            disabled={cancelled || running}
                            checked={!cancelled && selected.has(b.bookingRef)}
                            onChange={() => setSelected(prev => {
                              const next = new Set(prev)
                              if (next.has(b.bookingRef)) next.delete(b.bookingRef)
                              else next.add(b.bookingRef)
                              return next
                            })}
                          />
                        </td>
                        <td className="px-2 py-2">
                          <Link
                            href={`/dashboard/bookings/${b.bookingRef}/tickets`}
                            target="_blank"
                            className="font-mono text-amber-700 hover:underline inline-flex items-center gap-1"
                          >
                            {b.bookingRef} <ExternalLink className="w-3 h-3" />
                          </Link>
                          <div className="text-xs text-gray-500 truncate max-w-[220px]">
                            {[b.isNumber && b.isNumber !== b.bookingRef ? b.isNumber : null, b.agent].filter(Boolean).join(' · ') || '—'}
                            {cancelled && <span className="ml-1 text-red-600 font-medium">Cancelled</span>}
                          </div>
                        </td>
                        <td className="px-2 py-2 text-xs text-gray-600 whitespace-nowrap">
                          {formatDate(b.arrivalDate)} → {formatDate(b.departureDate)}
                        </td>
                        <td className="px-2 py-2 text-center text-gray-700">{b.pax}</td>
                        <td className="px-2 py-2 text-center">
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs ${
                            b.ticketCount ? 'bg-purple-50 text-purple-700' : 'bg-gray-100 text-gray-500'
                          }`}>
                            <TicketIcon className="w-3 h-3" /> {b.ticketCount}
                          </span>
                        </td>
                        <td className="px-2 py-2"><ResultCell r={r} /></td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>
          {truncated && (
            <div className="px-3 py-2 text-xs text-amber-700 bg-amber-50 border-t border-amber-100">
              Showing the first 400 bookings — narrow the date range to see the rest.
            </div>
          )}
        </div>
      </div>
    </Modal>
  )
}

function Stat({ label, value, tone }: { label: string; value: number; tone: 'emerald' | 'gray' | 'red' }) {
  const color = tone === 'emerald' ? 'text-emerald-700' : tone === 'red' ? 'text-red-600' : 'text-gray-700'
  return (
    <div className="rounded-lg bg-gray-50 px-3 py-2">
      <div className={`text-lg font-semibold leading-none ${color}`}>{value}</div>
      <div className="text-[11px] text-gray-500 mt-1">{label}</div>
    </div>
  )
}

function ResultCell({ r }: { r?: RowResult }) {
  if (!r || r.state === 'idle') return <span className="text-xs text-gray-400">—</span>
  if (r.state === 'queued') return <span className="text-xs text-gray-400">Queued</span>
  if (r.state === 'running') {
    return <span className="text-xs text-emerald-700 inline-flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> Creating…</span>
  }
  if (r.state === 'skipped') return <span className="text-xs text-gray-400" title={r.message}>Not run</span>
  if (r.state === 'nothing') {
    return (
      <span className="text-xs text-gray-500 inline-flex items-start gap-1" title={r.message}>
        <MinusCircle className="w-3.5 h-3.5 mt-px shrink-0" /> <span className="line-clamp-2">{r.message || 'Nothing to create'}</span>
      </span>
    )
  }
  if (r.state === 'failed') {
    return (
      <span className="text-xs text-red-600 inline-flex items-start gap-1" title={r.message}>
        <AlertCircle className="w-3.5 h-3.5 mt-px shrink-0" /> <span className="line-clamp-2">{r.message || 'Failed'}</span>
      </span>
    )
  }
  const created = r.created ?? 0
  return (
    <span className="text-xs inline-flex items-start gap-1" title={r.message}>
      <CheckCircle2 className={`w-3.5 h-3.5 mt-px shrink-0 ${created ? 'text-emerald-600' : 'text-gray-400'}`} />
      <span className={created ? 'text-emerald-700' : 'text-gray-500'}>
        {created ? `${created} created` : 'Nothing new'}
        {r.existed ? ` · ${r.existed} existed` : ''}
        {r.placed ? ` · ${r.placed} placed` : ''}
        {r.source === 'b2c' ? ' · store' : ''}
      </span>
    </span>
  )
}
