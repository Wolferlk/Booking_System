'use client'

/**
 * Confirm Booking Hotels — the Reservation desk's day view.
 *
 * One day at a time, across every property we hold: who arrives, who leaves,
 * and who stays on. Four tabs split the day into those movements; the date
 * strip picks the day; the country select and the IS-number search narrow it.
 *
 * Read-only. Nothing on this page writes to a booking, a reservation or a
 * reconfirmation — it is the morning worklist the desk confirms *from*.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Building2, CalendarDays, CheckCircle2, Circle, Download, Loader2,
  LogIn, LogOut, MoonStar, RefreshCw, Search, X,
} from 'lucide-react'
import Button from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { CountryFlag } from '@/components/ui/country-flag'
import { EmptyState, fmtDay } from '@/components/reservations/reservation-ui'
import { useCountryFilter } from '@/hooks/use-country-filter'
import {
  dayKeyFromToday, MOVEMENT_LABELS,
  type HotelMovementRow, type MovementCounts, type MovementFilter,
} from '@/lib/hotel-movements-shared'

const COUNTRIES = [
  { value: '',                   label: 'All countries' },
  { value: 'SRILANKA',           label: 'Sri Lanka' },
  { value: 'VIETNAM',            label: 'Vietnam' },
  { value: 'SINGAPORE',          label: 'Singapore' },
  { value: 'MALAYSIA',           label: 'Malaysia' },
  { value: 'SINGAPORE_MALAYSIA', label: 'Singapore & Malaysia' },
]

/** How the date is being chosen. `any` searches every date and needs a query. */
type DateMode = 'today' | 'tomorrow' | 'custom' | 'any'

const TABS: { key: MovementFilter; icon: React.ComponentType<{ className?: string }>; tone: string }[] = [
  { key: 'ALL',      icon: CalendarDays, tone: 'text-slate-500' },
  { key: 'CHECKIN',  icon: LogIn,        tone: 'text-emerald-600' },
  { key: 'CHECKOUT', icon: LogOut,       tone: 'text-amber-600' },
  { key: 'CONTINUE', icon: MoonStar,     tone: 'text-sky-600' },
]

const MOVEMENT_STYLES: Record<string, string> = {
  CHECKIN:  'bg-emerald-50 text-emerald-700 ring-emerald-200',
  CHECKOUT: 'bg-amber-50 text-amber-700 ring-amber-200',
  CONTINUE: 'bg-sky-50 text-sky-700 ring-sky-200',
}

const selectCls =
  'rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-brand-400'

const EMPTY_COUNTS: MovementCounts = { ALL: 0, CHECKIN: 0, CHECKOUT: 0, CONTINUE: 0 }

export default function ConfirmBookingHotelsPage() {
  // The sidebar's country selector is the desk-wide setting; this page starts
  // from it and lets the operator narrow further for this screen only.
  const { countryFilter } = useCountryFilter()

  const [rows, setRows] = useState<HotelMovementRow[]>([])
  const [counts, setCounts] = useState<MovementCounts>(EMPTY_COUNTS)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [dateMode, setDateMode] = useState<DateMode>('today')
  const [customDate, setCustomDate] = useState(() => dayKeyFromToday(0))
  const [movement, setMovement] = useState<MovementFilter>('ALL')
  const [country, setCountry] = useState('')
  const [search, setSearch] = useState('')
  const [includeOwn, setIncludeOwn] = useState(false)

  const searchRef = useRef<HTMLInputElement>(null)

  // Follow the sidebar selection. 'ALL' there means "do not narrow here".
  useEffect(() => {
    setCountry(countryFilter && countryFilter !== 'ALL' ? countryFilter : '')
  }, [countryFilter])

  /** yyyy-mm-dd being worked, or null in "every date" search mode. */
  const day = useMemo(() => {
    switch (dateMode) {
      case 'today':    return dayKeyFromToday(0)
      case 'tomorrow': return dayKeyFromToday(1)
      case 'custom':   return customDate
      case 'any':      return null
    }
  }, [dateMode, customDate])

  const needsSearch = dateMode === 'any' && !search.trim()

  const load = useCallback(async () => {
    if (needsSearch) {
      setRows([]); setCounts(EMPTY_COUNTS); setError(null); setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (day) params.set('date', day)
      if (country) params.set('country', country)
      if (search.trim()) params.set('q', search.trim())
      if (includeOwn) params.set('own', '1')

      const res = await fetch(`/api/reservations/confirm-hotels?${params}`)
      const json = await res.json()
      if (!json.success) throw new Error(json.error ?? 'Failed to load hotel movements')
      setRows(json.data.rows as HotelMovementRow[])
      setCounts(json.data.counts as MovementCounts)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load')
      setRows([]); setCounts(EMPTY_COUNTS)
    } finally {
      setLoading(false)
    }
  }, [day, country, search, includeOwn, needsSearch])

  // Typing must not cost a round trip per keystroke.
  useEffect(() => {
    const t = setTimeout(() => void load(), search ? 300 : 0)
    return () => clearTimeout(t)
  }, [load, search])

  // The movement tabs filter what is already in memory — no refetch.
  const visible = useMemo(
    () => (movement === 'ALL' ? rows : rows.filter(r => r.movement === movement)),
    [rows, movement],
  )

  // `/` focuses the IS-number search from anywhere on the page.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = document.activeElement?.tagName
      if (e.key === '/' && tag !== 'INPUT' && tag !== 'TEXTAREA') {
        e.preventDefault()
        searchRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const exportCsv = useCallback(() => {
    const header = [
      'Movement', 'IS Number', 'Booking Ref', 'Guest', 'Agent', 'Hotel', 'City',
      'Country', 'Check-in', 'Check-out', 'Nights', 'Rooms', 'Room Type', 'Meal',
      'Adults', 'Children', 'Infants', 'Reservation Status', 'Confirmation No',
      'Own Arrangement',
    ]
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
    const body = visible.map(r => [
      MOVEMENT_LABELS[r.movement], r.isNumber, r.bookingRef, r.leadGuest, r.agent,
      r.hotelName, r.city, r.operationCountry, r.checkIn.slice(0, 10), r.checkOut.slice(0, 10),
      r.nights, r.roomCount, r.roomType, r.mealType, r.adults, r.children, r.infants,
      r.reservationStatus ?? (r.confirmed ? 'CONFIRMED' : ''), r.confirmationNumber,
      r.ownArrangement ? 'Yes' : 'No',
    ].map(esc).join(','))

    const blob = new Blob([[header.map(esc).join(','), ...body].join('\n')], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `confirm-booking-hotels-${day ?? 'search'}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }, [visible, day])

  const subtitle = day
    ? fmtDay(`${day}T00:00:00.000Z`)
    : 'Every date matching your search'

  return (
    <div className="space-y-4 p-5">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold text-slate-900">
            <Building2 className="h-5 w-5 text-brand-500" />
            Confirm Booking Hotels
          </h1>
          <p className="mt-0.5 text-xs text-slate-500">
            {subtitle}
            {' · '}
            {loading ? 'Loading…' : `${visible.length} stay${visible.length === 1 ? '' : 's'}`}
            <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">
              read-only
            </span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="secondary" onClick={exportCsv} disabled={visible.length === 0}
            icon={<Download className="h-3.5 w-3.5" />}>
            Export
          </Button>
          <Button size="sm" variant="secondary" onClick={() => void load()}
            icon={<RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />}>
            Refresh
          </Button>
        </div>
      </div>

      {/* ── Filters ────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-md border border-slate-300 bg-white p-0.5">
          {([
            ['today',    'Today'],
            ['tomorrow', 'Tomorrow'],
            ['custom',   'Custom date'],
            ['any',      'Any date'],
          ] as [DateMode, string][]).map(([mode, label]) => (
            <button
              key={mode}
              onClick={() => setDateMode(mode)}
              className={cn(
                'rounded px-2.5 py-1 text-xs font-medium transition-colors',
                dateMode === mode ? 'bg-brand-500 text-white' : 'text-slate-600 hover:bg-slate-100',
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {dateMode === 'custom' && (
          <input
            type="date"
            value={customDate}
            onChange={e => setCustomDate(e.target.value)}
            className={selectCls}
          />
        )}

        <select value={country} onChange={e => setCountry(e.target.value)} className={selectCls}>
          {COUNTRIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>

        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <input
            ref={searchRef}
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="IS number, booking ref, guest or hotel…"
            className="w-72 rounded-md border border-slate-300 py-1.5 pl-8 pr-7 text-xs focus:outline-none focus:ring-2 focus:ring-brand-400"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              aria-label="Clear search"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        <label className="flex cursor-pointer items-center gap-1.5 text-xs text-slate-600">
          <input
            type="checkbox"
            checked={includeOwn}
            onChange={e => setIncludeOwn(e.target.checked)}
            className="h-3.5 w-3.5 rounded border-slate-300 text-brand-500 focus:ring-brand-400"
          />
          Include own arrangement
        </label>
      </div>

      {/* ── Movement tabs ──────────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-2">
        {TABS.map(tab => {
          const Icon = tab.icon
          const active = movement === tab.key
          return (
            <button
              key={tab.key}
              onClick={() => setMovement(tab.key)}
              className={cn(
                'flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold transition-all',
                active
                  ? 'border-brand-400 bg-brand-50 text-brand-700 shadow-sm'
                  : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50',
              )}
            >
              <Icon className={cn('h-3.5 w-3.5', active ? 'text-brand-600' : tab.tone)} />
              {MOVEMENT_LABELS[tab.key]}
              <span className={cn(
                'rounded px-1.5 py-0.5 text-[10px] font-bold',
                active ? 'bg-brand-500 text-white' : 'bg-slate-100 text-slate-600',
              )}>
                {counts[tab.key]}
              </span>
            </button>
          )
        })}
      </div>

      {/* ── Body ───────────────────────────────────────────────────────── */}
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </div>
      )}

      {needsSearch ? (
        <EmptyState
          icon={<Search className="h-6 w-6" />}
          title="Type something to search"
          hint="“Any date” searches across every date, so it needs an IS number, booking reference, guest or hotel name."
        />
      ) : loading ? (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading hotel movements…
        </div>
      ) : visible.length === 0 ? (
        <EmptyState
          icon={<Building2 className="h-6 w-6" />}
          title="Nothing on this day"
          hint="No hotel stay matches these filters. Try another date, another country, or clear the search."
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full min-w-[1100px] text-xs">
            <thead className="sticky top-0 bg-slate-50 text-left text-[10px] uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-3 py-2 font-semibold">Movement</th>
                <th className="px-3 py-2 font-semibold">IS Number</th>
                <th className="px-3 py-2 font-semibold">Guest</th>
                <th className="px-3 py-2 font-semibold">Hotel</th>
                <th className="px-3 py-2 font-semibold">Check-in</th>
                <th className="px-3 py-2 font-semibold">Check-out</th>
                <th className="px-3 py-2 text-center font-semibold">Nts</th>
                <th className="px-3 py-2 font-semibold">Room / Meal</th>
                <th className="px-3 py-2 text-center font-semibold">Pax</th>
                <th className="px-3 py-2 font-semibold">Confirmation</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {visible.map(r => (
                <tr key={`${r.stayKey}-${r.movement}`} className="hover:bg-slate-50/70">
                  <td className="px-3 py-2">
                    <span className={cn(
                      'inline-flex rounded px-1.5 py-0.5 text-[10px] font-semibold ring-1 ring-inset',
                      MOVEMENT_STYLES[r.movement],
                    )}>
                      {MOVEMENT_LABELS[r.movement]}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <a
                      href={`/dashboard/bookings/${encodeURIComponent(r.bookingRef)}`}
                      className="font-semibold text-brand-600 hover:underline"
                    >
                      {r.isNumber || r.bookingRef}
                    </a>
                    <p className="mt-0.5 text-[10px] text-slate-400">{r.bookingRef}</p>
                  </td>
                  <td className="px-3 py-2">
                    <p className="font-medium text-slate-800">{r.leadGuest || '—'}</p>
                    <p className="mt-0.5 text-[10px] text-slate-400">{r.agent || '—'}</p>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1.5">
                      <CountryFlag country={r.operationCountry} className="h-3 w-4 flex-shrink-0" />
                      <span className="font-medium text-slate-800">{r.hotelName}</span>
                      {r.ownArrangement && (
                        <span className="rounded bg-slate-100 px-1 py-0.5 text-[9px] font-semibold text-slate-500">
                          OWN
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-[10px] text-slate-400">{r.city || '—'}</p>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-slate-600">{fmtDay(r.checkIn)}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-slate-600">{fmtDay(r.checkOut)}</td>
                  <td className="px-3 py-2 text-center text-slate-600">{r.nights}</td>
                  <td className="px-3 py-2">
                    <p className="text-slate-700">{r.roomType || '—'}</p>
                    <p className="mt-0.5 text-[10px] text-slate-400">
                      {r.mealType || '—'}{r.roomCount ? ` · ${r.roomCount} room${r.roomCount === 1 ? '' : 's'}` : ''}
                    </p>
                  </td>
                  <td className="px-3 py-2 text-center whitespace-nowrap text-slate-600">
                    {r.adults}A{r.children ? ` ${r.children}C` : ''}{r.infants ? ` ${r.infants}I` : ''}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1.5">
                      {r.confirmed
                        ? <CheckCircle2 className="h-3.5 w-3.5 flex-shrink-0 text-emerald-500" />
                        : <Circle className="h-3.5 w-3.5 flex-shrink-0 text-slate-300" />}
                      <span className={cn('font-medium', r.confirmed ? 'text-emerald-700' : 'text-slate-500')}>
                        {r.reservationStatus ?? (r.confirmed ? 'CONFIRMED' : 'Not confirmed')}
                      </span>
                    </div>
                    {r.confirmationNumber && (
                      <p className="mt-0.5 font-mono text-[10px] text-slate-500">{r.confirmationNumber}</p>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
