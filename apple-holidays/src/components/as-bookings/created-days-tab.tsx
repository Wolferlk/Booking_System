'use client'

/**
 * Created by Day — the intake histogram, and the bookings behind each column.
 *
 * Every other view of intake in this system is a single number: the daily
 * report's "72 bookings created yesterday", the count on the All Bookings
 * header. A number on its own can only be believed or disbelieved. This view
 * exists so it can be *checked*: click the column and the IS numbers that make
 * it up are listed underneath, ready to be read against AppleSystem.
 *
 * Which is why it opens on yesterday rather than today. Today is still filling
 * up and its count means nothing yet; yesterday is the finished day, the one
 * the morning report quotes and the one anybody arriving at this screen came to
 * reconcile.
 *
 * The days are Colombo days, from `booking-date-window.ts` — the same business
 * day the report anchors to. That is not decoration: this view is only useful
 * if its columns can be compared with the report without arithmetic.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import {
  BarChart3, Loader2, AlertTriangle, Search, X, Copy, Check,
  Users, CalendarDays, ExternalLink, Ban, TrendingUp, ChevronLeft, ChevronRight,
} from 'lucide-react'
import { toast } from 'sonner'
import { Card } from '@/components/ui/card'
import { readApiResponse } from '@/lib/utils'
import { countryLabel, countryStyle } from './shared'

// ── Shapes (mirror /api/bookings/created-daily) ───────────────────────────────

interface DayCell { date: string; count: number; pax: number; cancelled: number }

interface CreatedBooking {
  id: string
  ref: string
  isNumber: string | null
  agent: string | null
  status: string
  cancelled: boolean
  country: string
  source: 'B2B' | 'B2C'
  createdAt: string
  day: string
  arrivalDate: string | null
  pax: number
}

interface CreatedDailyData {
  timezone: string
  from: string
  to: string
  today: string
  yesterday: string
  truncated: boolean
  days: DayCell[]
  bookings: CreatedBooking[]
}

// ── Date helpers (calendar arithmetic only — never `new Date()` on a day) ─────

/** Parsed as UTC so the label never slides a day on a westward browser clock. */
function dayDate(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`)
}

function fmtDay(date: string, opts: Intl.DateTimeFormatOptions): string {
  return dayDate(date).toLocaleDateString('en-GB', { timeZone: 'UTC', ...opts })
}

function isWeekend(date: string): boolean {
  const wd = dayDate(date).getUTCDay()
  return wd === 0 || wd === 6
}

function fmtTime(iso: string, timeZone: string): string {
  return new Date(iso).toLocaleTimeString('en-GB', {
    timeZone, hour: '2-digit', minute: '2-digit',
  })
}

// ── Range presets ─────────────────────────────────────────────────────────────

type PresetKey = '7' | '14' | '30' | 'month' | 'custom'

const PRESETS: { key: PresetKey; label: string }[] = [
  { key: '7',     label: 'Last 7 days' },
  { key: '14',    label: 'Last 14 days' },
  { key: '30',    label: 'Last 30 days' },
  { key: 'month', label: 'This month' },
]

const COUNTRIES = ['VIETNAM', 'SRILANKA', 'SINGAPORE', 'MALAYSIA'] as const

/** The chart's plot height. Fixed, so a quiet week and a busy one are comparable. */
const PLOT_PX = 170

export default function CreatedDaysTab() {
  const [data, setData]       = useState<CreatedDailyData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)

  // Filters — one row above the chart.
  const [preset, setPreset]   = useState<PresetKey>('14')
  const [from, setFrom]       = useState('')
  const [to, setTo]           = useState('')
  const [country, setCountry] = useState('')
  const [source, setSource]   = useState('')
  const [search, setSearch]   = useState('')

  /** `null` until the first load, then pinned to yesterday. */
  const [selected, setSelected] = useState<string | null>(null)
  const [hovered, setHovered]   = useState<string | null>(null)
  const [copied, setCopied]     = useState(false)

  // The selection is only auto-set once. After that it is the user's, and a
  // filter change must not yank them back to yesterday mid-investigation.
  const pinned = useRef(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (preset === 'custom') {
        if (from) params.set('from', from)
        if (to)   params.set('to', to)
      } else {
        params.set('preset', preset)
      }
      if (country) params.set('country', country)
      if (source)  params.set('source', source)
      if (search)  params.set('search', search)

      const res  = await fetch(`/api/bookings/created-daily?${params}`)
      const json = await readApiResponse<CreatedDailyData>(res)
      if (!json.success || !json.data) {
        setError(json.error ?? 'Could not load created bookings')
        return
      }
      setError(null)
      setData(json.data)
      if (!pinned.current) {
        pinned.current = true
        setSelected(json.data.yesterday)
      }
    } catch {
      setError('Network error loading created bookings')
    } finally {
      setLoading(false)
    }
  }, [preset, from, to, country, source, search])

  // Presets are resolved server-side, where "last 7 days" can mean seven
  // Colombo days — a browser in another timezone would name a different week.
  useEffect(() => {
    if (preset === 'custom') { void load(); return }
    const id = setTimeout(() => { void load() }, search ? 350 : 0)
    return () => clearTimeout(id)
  }, [load, preset, search])

  const days = useMemo(() => data?.days ?? [], [data])
  const max  = Math.max(1, ...days.map(d => d.count))
  const total = days.reduce((n, d) => n + d.count, 0)
  const busiest = days.reduce<DayCell | null>((best, d) => (!best || d.count > best.count ? d : best), null)
  const average = days.length ? total / days.length : 0

  const selectedCell = days.find(d => d.date === selected) ?? null
  const dayBookings  = useMemo(
    () => (data?.bookings ?? []).filter(b => b.day === selected),
    [data, selected],
  )

  /** Arrow keys walk the columns — the fastest way to scan a week for the odd one out. */
  const step = useCallback((delta: number) => {
    if (!selected || days.length === 0) return
    const i = days.findIndex(d => d.date === selected)
    const next = days[Math.min(days.length - 1, Math.max(0, (i === -1 ? days.length - 1 : i) + delta))]
    if (next) setSelected(next.date)
  }, [selected, days])

  const copyIsNumbers = useCallback(async () => {
    const list = dayBookings.map(b => b.isNumber || b.ref).join('\n')
    if (!list) return
    try {
      await navigator.clipboard.writeText(list)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
      toast.success(`${dayBookings.length} reference${dayBookings.length === 1 ? '' : 's'} copied`)
    } catch {
      toast.error('Could not copy to the clipboard')
    }
  }, [dayBookings])

  const clearFilters = () => {
    setCountry(''); setSource(''); setSearch('')
  }
  const filtered = !!(country || source || search)

  // Labels thin out rather than overlap once the range is long.
  const labelEvery = days.length > 45 ? 7 : days.length > 24 ? 3 : days.length > 16 ? 2 : 1

  return (
    <div className="space-y-5">

      {/* ── Filters — one row above the chart ──────────────────────────── */}
      <Card className="p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <CalendarDays className="w-4 h-4 text-slate-400 shrink-0 mr-0.5" />
          {PRESETS.map(p => (
            <button
              key={p.key}
              onClick={() => setPreset(p.key)}
              className={`px-3 py-1 rounded-full text-xs font-semibold border transition-colors ${
                preset === p.key
                  ? 'bg-brand-600 text-white border-brand-600'
                  : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
              }`}
            >
              {p.label}
            </button>
          ))}

          <span className="text-xs text-slate-300 mx-1">|</span>

          <input
            type="date"
            value={from}
            onChange={e => { setFrom(e.target.value); setPreset('custom') }}
            className="form-input text-sm py-1.5 w-36"
            aria-label="Range start"
          />
          <span className="text-xs text-slate-400">→</span>
          <input
            type="date"
            value={to}
            onChange={e => { setTo(e.target.value); setPreset('custom') }}
            className="form-input text-sm py-1.5 w-36"
            aria-label="Range end"
          />

          {loading && <Loader2 className="w-4 h-4 text-brand-500 animate-spin ml-1" />}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Narrow by IS number, ref or agent…"
              className="form-input pl-9 pr-9 text-sm py-1.5"
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded text-slate-400 hover:text-slate-600"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <select
            value={country}
            onChange={e => setCountry(e.target.value)}
            className="form-select text-sm py-1.5 w-44"
            aria-label="Country"
          >
            <option value="">All countries</option>
            {COUNTRIES.map(c => <option key={c} value={c}>{countryLabel(c)}</option>)}
          </select>

          <select
            value={source}
            onChange={e => setSource(e.target.value)}
            className="form-select text-sm py-1.5 w-40"
            aria-label="Sales channel"
          >
            <option value="">All sources</option>
            <option value="B2B">B2B — Agents</option>
            <option value="B2C">B2C — Aahaas</option>
          </select>

          {filtered && (
            <button
              onClick={clearFilters}
              className="text-xs font-medium text-slate-500 hover:text-slate-700 px-2 py-1.5"
            >
              Clear filters
            </button>
          )}
        </div>
      </Card>

      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-700">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          {error}
        </div>
      )}

      {data?.truncated && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-800">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          This range holds more bookings than one pass returns, so the columns
          below are a subset — narrow the range before reading them as totals.
        </div>
      )}

      {/* ── The histogram ─────────────────────────────────────────────── */}
      <Card className="p-4 sm:p-5 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="flex items-center gap-2 font-semibold text-slate-800">
              <BarChart3 className="w-4 h-4 text-brand-500" />
              Bookings created per day
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              {data ? `${fmtDay(data.from, { day: '2-digit', month: 'short' })} → ${fmtDay(data.to, { day: '2-digit', month: 'short' })}` : '—'}
              {data && <span className="ml-1.5 text-slate-300">· {data.timezone} days</span>}
              {' · click a column to open it'}
            </p>
          </div>

          <div className="flex items-center gap-4 text-right">
            <div>
              <div className="text-xl font-bold text-slate-800 tabular-nums leading-none">{total}</div>
              <div className="text-[10px] uppercase tracking-wide text-slate-400 mt-1">In range</div>
            </div>
            <div>
              <div className="text-xl font-bold text-slate-800 tabular-nums leading-none">{average.toFixed(1)}</div>
              <div className="text-[10px] uppercase tracking-wide text-slate-400 mt-1">Per day</div>
            </div>
            <div>
              <div className="text-xl font-bold text-slate-800 tabular-nums leading-none">{busiest?.count ?? 0}</div>
              <div className="text-[10px] uppercase tracking-wide text-slate-400 mt-1">
                Busiest{busiest && busiest.count > 0 ? ` · ${fmtDay(busiest.date, { day: '2-digit', month: 'short' })}` : ''}
              </div>
            </div>
          </div>
        </div>

        {/* Plot. One series, so no legend — the heading names it. The dashed
            rule is the daily average, which is what makes a column read as
            "a heavy day" rather than just "a column". */}
        <div className="relative" style={{ paddingTop: 14 }}>
          {days.length > 0 && average > 0 && (
            <div
              className="absolute inset-x-0 border-t border-dashed border-slate-300 pointer-events-none z-0"
              style={{ bottom: 26 + (average / max) * PLOT_PX }}
            >
              <span className="absolute right-0 -top-4 text-[10px] font-medium text-slate-400 bg-white px-1">
                avg {average.toFixed(1)}
              </span>
            </div>
          )}

          <div className="flex items-end gap-[2px] relative z-10" style={{ height: PLOT_PX + 26 }}>
            {days.length === 0 && !loading && (
              <p className="text-sm text-slate-400 self-center mx-auto">No days in this range.</p>
            )}

            {days.map((d, i) => {
              const isSel  = d.date === selected
              const isHov  = d.date === hovered
              const height = d.count === 0 ? 2 : Math.max(4, (d.count / max) * PLOT_PX)
              const live   = d.count > 0

              return (
                <button
                  key={d.date}
                  onClick={() => setSelected(d.date)}
                  onMouseEnter={() => setHovered(d.date)}
                  onMouseLeave={() => setHovered(null)}
                  onKeyDown={e => {
                    if (e.key === 'ArrowLeft')  { e.preventDefault(); step(-1) }
                    if (e.key === 'ArrowRight') { e.preventDefault(); step(1) }
                  }}
                  aria-pressed={isSel}
                  aria-label={`${fmtDay(d.date, { weekday: 'long', day: 'numeric', month: 'long' })}: ${d.count} bookings created`}
                  className={`group relative flex-1 min-w-0 flex flex-col justify-end items-stretch h-full rounded-t-md transition-colors ${
                    isWeekend(d.date) ? 'bg-slate-50' : ''
                  } ${isSel ? '' : 'hover:bg-slate-50'}`}
                >
                  {/* Tooltip */}
                  {isHov && (
                    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 z-20 whitespace-nowrap rounded-lg bg-slate-900 px-2.5 py-1.5 text-[11px] text-white shadow-lg pointer-events-none">
                      <span className="font-semibold">{fmtDay(d.date, { weekday: 'short', day: '2-digit', month: 'short' })}</span>
                      <span className="mx-1.5 text-slate-500">·</span>
                      {d.count} booking{d.count === 1 ? '' : 's'}
                      {d.pax > 0 && <span className="text-slate-400"> · {d.pax} pax</span>}
                      {d.cancelled > 0 && <span className="text-rose-300"> · {d.cancelled} cancelled</span>}
                    </div>
                  )}

                  {/* Value — only where it earns its place: the selected day,
                      the busiest day, and whatever is under the cursor. */}
                  {live && (isSel || isHov || d.count === max) && (
                    <span className={`absolute left-0 right-0 text-[10px] font-bold tabular-nums text-center ${
                      isSel ? 'text-brand-700' : 'text-slate-500'
                    }`} style={{ bottom: height + 28 }}>
                      {d.count}
                    </span>
                  )}

                  {/* The mark. 2px gap between bars comes from the parent gap;
                      the rounded end is anchored to the baseline. */}
                  <span
                    className={`block rounded-t-[4px] mx-[1px] transition-all ${
                      !live      ? 'bg-slate-200'
                      : isSel    ? 'bg-brand-600'
                      : isHov    ? 'bg-brand-500'
                      :            'bg-brand-400'
                    }`}
                    style={{ height }}
                  />

                  {/* Day label */}
                  <span className={`h-[26px] pt-1 text-[10px] leading-tight truncate ${
                    isSel ? 'font-bold text-brand-700' : 'text-slate-400'
                  }`}>
                    {i % labelEvery === 0 || isSel ? (
                      <>
                        {fmtDay(d.date, { day: '2-digit' })}
                        <span className="hidden sm:block text-[9px] opacity-70">
                          {fmtDay(d.date, { month: 'short' })}
                        </span>
                      </>
                    ) : ''}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      </Card>

      {/* ── The day, opened up ─────────────────────────────────────────── */}
      <Card className="p-4 sm:p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1">
              <button
                onClick={() => step(-1)}
                disabled={!selected}
                className="p-1.5 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-40"
                aria-label="Previous day"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                onClick={() => step(1)}
                disabled={!selected}
                className="p-1.5 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-40"
                aria-label="Next day"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>

            <div>
              <h3 className="font-semibold text-slate-800 flex items-center gap-2">
                {selected ? fmtDay(selected, { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' }) : 'No day selected'}
                {data && selected === data.yesterday && (
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-brand-50 text-brand-700 border border-brand-200">
                    Yesterday
                  </span>
                )}
                {data && selected === data.today && (
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                    Today · still filling
                  </span>
                )}
              </h3>
              <p className="text-xs text-slate-400 mt-0.5 flex flex-wrap items-center gap-x-2.5">
                <span className="font-semibold text-slate-600 tabular-nums">
                  {selectedCell?.count ?? 0} booking{(selectedCell?.count ?? 0) === 1 ? '' : 's'} created
                </span>
                {!!selectedCell?.pax && (
                  <span className="inline-flex items-center gap-1"><Users className="w-3 h-3" />{selectedCell.pax} pax</span>
                )}
                {!!selectedCell?.cancelled && (
                  <span className="inline-flex items-center gap-1 text-rose-500">
                    <Ban className="w-3 h-3" />{selectedCell.cancelled} since cancelled
                  </span>
                )}
                {!!selectedCell?.count && average > 0 && (
                  <span className="inline-flex items-center gap-1">
                    <TrendingUp className="w-3 h-3" />
                    {selectedCell.count >= average ? '+' : ''}
                    {(selectedCell.count - average).toFixed(1)} vs average
                  </span>
                )}
              </p>
            </div>
          </div>

          {dayBookings.length > 0 && (
            <button
              onClick={copyIsNumbers}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 text-xs font-semibold text-slate-600 hover:bg-slate-50"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
              Copy {dayBookings.length} reference{dayBookings.length === 1 ? '' : 's'}
            </button>
          )}
        </div>

        {dayBookings.length === 0 ? (
          <p className="text-sm text-slate-400 py-6 text-center">
            {loading ? 'Loading…'
              : selected ? 'No bookings were created on this day' + (filtered ? ' under the current filters.' : '.')
              : 'Pick a column above.'}
          </p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2">
            {dayBookings.map(b => (
              <Link
                key={b.id}
                href={`/dashboard/bookings/${encodeURIComponent(b.ref)}`}
                className="group flex items-center gap-2.5 rounded-xl border border-slate-200 px-3 py-2 hover:border-brand-300 hover:bg-brand-50/40 transition-colors"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className={`font-mono text-sm font-bold ${
                      b.cancelled ? 'text-slate-400 line-through' : 'text-slate-800'
                    }`}>
                      {b.isNumber || b.ref}
                    </span>
                    <ExternalLink className="w-3 h-3 text-slate-300 opacity-0 group-hover:opacity-100 transition-opacity" />
                  </div>
                  <p className="text-[11px] text-slate-400 truncate">
                    {b.agent || 'No agent'}
                    {b.arrivalDate && <span> · arrives {fmtDay(b.arrivalDate, { day: '2-digit', month: 'short' })}</span>}
                  </p>
                </div>

                <div className="flex flex-col items-end gap-1 shrink-0">
                  <span className={`px-1.5 py-0.5 rounded text-[10px] border ${countryStyle(b.country)}`}>
                    {countryLabel(b.country)}
                  </span>
                  <span className="text-[10px] text-slate-400 tabular-nums">
                    {data ? fmtTime(b.createdAt, data.timezone) : ''}
                    {b.pax > 0 && <span className="ml-1">· {b.pax} pax</span>}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}
