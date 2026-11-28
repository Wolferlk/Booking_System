'use client'

/**
 * Agenda Edit Report — which movement charts were saved or edited, by whom,
 * how many times and when last. A summary over the Booking Logs (the same rows
 * the per-booking "Logs" button shows); each booking expands to its full agenda
 * timeline. Data: GET /api/logs/agenda-report (read-only).
 */
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  Route, Search, User, Hash, Calendar, Loader2, RefreshCw, Download, ChevronDown, ChevronRight,
  Save, Pencil, UserCheck, Bot, Users, FileText, ExternalLink, History, AlertTriangle,
} from 'lucide-react'
import Header from '@/components/layout/header'
import { LogTimeline } from '@/components/logs/log-timeline'
import type { LogEntry } from '@/lib/booking-logs'

interface PersonRow { name: string; saves: number; edits: number; assigns: number; auto: number; total: number; bookings: number; lastAt: string }
interface BookingRow {
  bookingRef: string; leadGuest: string | null; arrivalDate: string | null; country: string | null; status: string | null
  saves: number; edits: number; assigns: number; auto: number; total: number
  people: { name: string; n: number }[]
  lastAt: string; lastBy: string; lastSummary: string; firstAt: string
}
interface Report {
  from: string; to: string; clamped: boolean; truncated: boolean; includeAuto: boolean
  totals: { bookings: number; people: number; saves: number; edits: number; assigns: number; auto: number }
  byDay: { date: string; n: number }[]
  people: PersonRow[]
  bookings: BookingRow[]
}

const isoDay = (d: Date) => d.toISOString().slice(0, 10)
const when = (iso: string) => new Date(iso).toLocaleString(undefined, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
const initials = (n: string) => n.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]?.toUpperCase()).join('') || '?'

export default function AgendaReportPage() {
  return (
    <Suspense fallback={null}>
      <AgendaReport />
    </Suspense>
  )
}

function AgendaReport() {
  const sp = useSearchParams()
  const router = useRouter()
  const [from, setFrom] = useState(sp.get('from') ?? isoDay(new Date(Date.now() - 7 * 86_400_000)))
  const [to, setTo] = useState(sp.get('to') ?? '')
  const [actor, setActor] = useState(sp.get('actor') ?? '')
  const [ref, setRef] = useState(sp.get('ref') ?? '')
  const [auto, setAuto] = useState(sp.get('auto') === '1')
  const [filter, setFilter] = useState('')

  const [data, setData] = useState<Report | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState<string | null>(null)

  const params = useMemo(() => {
    const p = new URLSearchParams()
    if (from) p.set('from', from)
    if (to) p.set('to', to)
    if (actor.trim()) p.set('actor', actor.trim())
    if (ref.trim()) p.set('ref', ref.trim().toUpperCase())
    if (auto) p.set('auto', '1')
    return p
  }, [from, to, actor, ref, auto])

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const j = await (await fetch(`/api/logs/agenda-report?${params}`)).json()
      if (!j.success) throw new Error(j.error ?? 'Could not load the report')
      setData(j.data)
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not load the report') } finally { setLoading(false) }
  }, [params])

  useEffect(() => {
    const t = setTimeout(() => {
      void load()
      router.replace(`/dashboard/logs/agenda${params.toString() ? `?${params}` : ''}`, { scroll: false })
    }, 350)
    return () => clearTimeout(t)
  }, [load, params, router])

  const quickRange = (days: number) => { setFrom(isoDay(new Date(Date.now() - days * 86_400_000))); setTo('') }

  const rows = useMemo(() => {
    const f = filter.trim().toLowerCase()
    if (!data) return []
    if (!f) return data.bookings
    return data.bookings.filter(b =>
      b.bookingRef.toLowerCase().includes(f) ||
      (b.leadGuest ?? '').toLowerCase().includes(f) ||
      b.people.some(p => p.name.toLowerCase().includes(f)))
  }, [data, filter])

  function exportCsv() {
    if (!data) return
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
    const lines = [
      ['Booking', 'Lead guest', 'Arrival', 'Country', 'Status', 'Chart saves', 'Movement edits', 'Driver/vendor changes',
        ...(data.includeAuto ? ['Automatic'] : []), 'Edited by', 'Last edited by', 'Last edited at', 'Last change'].map(esc).join(','),
      ...rows.map(b => [
        b.bookingRef, b.leadGuest, b.arrivalDate, b.country, b.status, b.saves, b.edits, b.assigns,
        ...(data.includeAuto ? [b.auto] : []),
        b.people.map(p => `${p.name} (${p.n})`).join('; '), b.lastBy, new Date(b.lastAt).toLocaleString(), b.lastSummary,
      ].map(esc).join(',')),
    ]
    const blob = new Blob([`﻿${lines.join('\r\n')}`], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `agenda-edits_${data.from}_${data.to}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const t = data?.totals

  return (
    <div className="min-h-screen bg-slate-50/60">
      <Header title="Agenda Edit Report" subtitle="Which movement charts were edited and saved — and by whom" />

      <div className="mx-auto max-w-7xl space-y-5 px-4 py-6 sm:px-8">
        {/* Filters */}
        <div className="relative overflow-hidden rounded-2xl border border-indigo-100 bg-gradient-to-br from-indigo-600 via-indigo-500 to-violet-500 p-5 text-white shadow-lg shadow-indigo-500/20">
          <Route aria-hidden className="pointer-events-none absolute -right-6 -top-6 h-40 w-40 text-white/10" />
          <div className="relative flex flex-wrap items-center gap-2">
            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-indigo-100">Agenda edits</p>
            <Link href="/dashboard/logs?section=agenda" className="ml-auto inline-flex items-center gap-1 rounded-full bg-white/15 px-3 py-1 text-[12px] font-medium hover:bg-white/25">
              <History className="h-3.5 w-3.5" /> Full Booking Logs
            </Link>
          </div>
          <div className="relative mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Field Icon={User} placeholder="Person" value={actor} onChange={setActor} />
            <Field Icon={Hash} placeholder="Booking ref" value={ref} onChange={setRef} />
            <DateField label="From" value={from} onChange={setFrom} />
            <DateField label="To" value={to} onChange={setTo} />
          </div>
          <div className="relative mt-3 flex flex-wrap items-center gap-2 text-[12px]">
            {[['Today', 0], ['7 days', 7], ['30 days', 30], ['90 days', 90]].map(([l, d]) => (
              <button key={l} type="button" onClick={() => quickRange(d as number)}
                className="rounded-full bg-white/15 px-3 py-1 font-medium text-white hover:bg-white/25">{l}</button>
            ))}
            <button type="button" onClick={() => setAuto(v => !v)}
              className={`inline-flex items-center gap-1 rounded-full px-3 py-1 font-semibold transition ${auto ? 'bg-white text-indigo-700 shadow' : 'bg-white/15 text-white hover:bg-white/25'}`}>
              <Bot className="h-3.5 w-3.5" /> Include automatic changes
            </button>
          </div>
        </div>

        {data?.clamped && (
          <p className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-800">
            <AlertTriangle className="h-4 w-4" /> The report covers at most 92 days — showing {data.from} to {data.to}.
          </p>
        )}
        {data?.truncated && (
          <p className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-800">
            <AlertTriangle className="h-4 w-4" /> Very many entries in this range — only the most recent are counted. Narrow the dates for exact totals.
          </p>
        )}

        {/* Totals */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <Stat Icon={FileText} label="Bookings edited" value={t?.bookings} tone="indigo" />
          <Stat Icon={Users} label="People" value={t?.people} tone="violet" />
          <Stat Icon={Save} label="Chart saves" value={t?.saves} tone="teal" />
          <Stat Icon={Pencil} label="Movement edits" value={t?.edits} tone="sky" />
          <Stat Icon={UserCheck} label="Driver / vendor changes" value={t?.assigns} tone="amber" />
        </div>

        {/* By person */}
        <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center gap-2 border-b border-slate-100 px-5 py-3">
            <Users className="h-4 w-4 text-violet-500" />
            <h2 className="text-[14px] font-semibold text-slate-800">By person</h2>
            {loading && <Loader2 className="h-4 w-4 animate-spin text-indigo-400" />}
          </div>
          {!data || data.people.length === 0 ? (
            <p className="px-5 py-6 text-center text-[13px] text-slate-400">{loading ? 'Loading…' : 'Nobody edited an agenda in this range.'}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
                    <th className="px-5 py-2 font-semibold">Person</th>
                    <th className="px-3 py-2 text-right font-semibold">Bookings</th>
                    <th className="px-3 py-2 text-right font-semibold">Chart saves</th>
                    <th className="px-3 py-2 text-right font-semibold">Movement edits</th>
                    <th className="px-3 py-2 text-right font-semibold">Driver / vendor</th>
                    {data.includeAuto && <th className="px-3 py-2 text-right font-semibold">Automatic</th>}
                    <th className="px-5 py-2 text-right font-semibold">Last edit</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.people.map(p => (
                    <tr key={p.name} className="hover:bg-slate-50/70">
                      <td className="px-5 py-2">
                        <button type="button" onClick={() => setActor(p.name)} title="Show only this person"
                          className="inline-flex items-center gap-2 font-medium text-slate-800 hover:text-indigo-700">
                          <Avatar name={p.name} /> {p.name}
                        </button>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{p.bookings}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{p.saves}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{p.edits}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{p.assigns}</td>
                      {data.includeAuto && <td className="px-3 py-2 text-right tabular-nums">{p.auto}</td>}
                      <td className="px-5 py-2 text-right text-slate-500">{when(p.lastAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* By booking */}
        <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-5 py-3">
            <Route className="h-4 w-4 text-indigo-500" />
            <h2 className="text-[14px] font-semibold text-slate-800">Agendas edited</h2>
            <span className="text-[12px] text-slate-400">{rows.length}{filter ? ` of ${data?.bookings.length ?? 0}` : ''}</span>
            <div className="relative ml-auto">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Filter ref, guest, person…"
                className="h-8 w-56 rounded-lg border border-slate-200 pl-8 pr-2 text-[12.5px] focus:border-indigo-300 focus:outline-none" />
            </div>
            <button type="button" onClick={() => void load()} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1 text-[12px] text-slate-600 hover:bg-slate-50">
              <RefreshCw className="h-3.5 w-3.5" /> Refresh
            </button>
            <button type="button" onClick={exportCsv} disabled={!rows.length} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1 text-[12px] text-slate-600 hover:bg-slate-50 disabled:opacity-50">
              <Download className="h-3.5 w-3.5" /> Export CSV
            </button>
          </div>

          {error ? (
            <p className="m-5 rounded-xl bg-rose-50 px-3 py-2 text-[13px] text-rose-700">{error}</p>
          ) : !data ? (
            <div className="space-y-2 p-5">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-10 animate-pulse rounded-lg bg-slate-50" />)}</div>
          ) : rows.length === 0 ? (
            <p className="px-5 py-12 text-center text-[13px] text-slate-400">No agenda was edited in this range.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
                    <th className="w-8 px-2 py-2" />
                    <th className="px-3 py-2 font-semibold">Booking</th>
                    <th className="px-3 py-2 font-semibold">Arrival</th>
                    <th className="px-3 py-2 text-right font-semibold">Saves</th>
                    <th className="px-3 py-2 text-right font-semibold">Edits</th>
                    <th className="px-3 py-2 text-right font-semibold">Driver / vendor</th>
                    {data.includeAuto && <th className="px-3 py-2 text-right font-semibold">Auto</th>}
                    <th className="px-3 py-2 font-semibold">Edited by</th>
                    <th className="px-3 py-2 font-semibold">Last edited</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.map(b => (
                    <BookingLine key={b.bookingRef} b={b} includeAuto={data.includeAuto} from={data.from} to={data.to}
                      open={open === b.bookingRef} onToggle={() => setOpen(o => (o === b.bookingRef ? null : b.bookingRef))} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

function BookingLine({ b, includeAuto, open, onToggle, from, to }: {
  b: BookingRow; includeAuto: boolean; open: boolean; onToggle: () => void; from: string; to: string
}) {
  const [entries, setEntries] = useState<LogEntry[] | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open || entries) return
    setBusy(true)
    const p = new URLSearchParams({ ref: b.bookingRef, section: 'agenda', from, to, limit: '200' })
    fetch(`/api/logs?${p}`)
      .then(r => r.json())
      .then(j => setEntries(j.success ? j.data.entries : []))
      .catch(() => setEntries([]))
      .finally(() => setBusy(false))
  }, [open, entries, b.bookingRef, from, to])

  return (
    <>
      <tr className={`cursor-pointer hover:bg-slate-50/70 ${open ? 'bg-indigo-50/40' : ''}`} onClick={onToggle}>
        <td className="px-2 py-2 text-slate-400">{open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</td>
        <td className="px-3 py-2">
          <p className="font-mono font-semibold text-slate-800">{b.bookingRef}</p>
          {b.leadGuest && <p className="text-[11.5px] text-slate-500">{b.leadGuest}</p>}
        </td>
        <td className="px-3 py-2 text-slate-600">{b.arrivalDate ?? '—'}</td>
        <td className="px-3 py-2 text-right tabular-nums">{b.saves || '—'}</td>
        <td className="px-3 py-2 text-right tabular-nums">{b.edits || '—'}</td>
        <td className="px-3 py-2 text-right tabular-nums">{b.assigns || '—'}</td>
        {includeAuto && <td className="px-3 py-2 text-right tabular-nums">{b.auto || '—'}</td>}
        <td className="px-3 py-2">
          <div className="flex flex-wrap gap-1">
            {b.people.slice(0, 4).map(p => (
              <span key={p.name} className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[11.5px] text-slate-700">
                {p.name}<span className="text-slate-400">×{p.n}</span>
              </span>
            ))}
            {b.people.length > 4 && <span className="text-[11.5px] text-slate-400">+{b.people.length - 4}</span>}
          </div>
        </td>
        <td className="px-3 py-2">
          <p className="font-medium text-slate-700">{b.lastBy}</p>
          <p className="text-[11.5px] text-slate-400">{when(b.lastAt)}</p>
        </td>
        <td className="px-3 py-2 text-right" onClick={e => e.stopPropagation()}>
          <Link href={`/dashboard/bookings/${encodeURIComponent(b.bookingRef)}/agenda`} target="_blank"
            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-[12px] text-indigo-600 hover:bg-indigo-50">
            Agenda <ExternalLink className="h-3 w-3" />
          </Link>
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={includeAuto ? 10 : 9} className="bg-slate-50/60 px-6 py-4">
            {busy || !entries ? (
              <p className="flex items-center gap-2 text-[12.5px] text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading the agenda history…</p>
            ) : entries.length === 0 ? (
              <p className="text-[12.5px] text-slate-400">No detailed entries in this range.</p>
            ) : (
              <LogTimeline entries={entries} />
            )}
          </td>
        </tr>
      )}
    </>
  )
}

function Avatar({ name }: { name: string }) {
  return <span className="flex h-6 w-6 items-center justify-center rounded-full bg-indigo-100 text-[10px] font-bold text-indigo-700">{initials(name)}</span>
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
  violet: 'from-violet-50 text-violet-700',
  teal: 'from-teal-50 text-teal-700',
  sky: 'from-sky-50 text-sky-700',
  amber: 'from-amber-50 text-amber-700',
} as const

function Stat({ Icon, label, value, tone }: { Icon: typeof Hash; label: string; value: number | undefined; tone: keyof typeof STAT_TONE }) {
  return (
    <div className={`rounded-2xl border border-slate-200 bg-gradient-to-br to-white p-4 shadow-sm ${STAT_TONE[tone]}`}>
      <p className="flex items-center gap-1.5 text-[10.5px] font-bold uppercase tracking-[0.14em] opacity-70"><Icon className="h-3.5 w-3.5" /> {label}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums">{value ?? '—'}</p>
    </div>
  )
}
