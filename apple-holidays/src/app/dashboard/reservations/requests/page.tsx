'use client'

/**
 * Request Inbox — hotel stays nobody has started work on.
 *
 * Derived on every read from `accommodations`, exactly the way the D-10
 * pre-checking queue is: no backfill job, no rows created until an operator
 * claims a stay. Switching the module on against a live database creates
 * nothing at all until somebody presses a button here.
 *
 * Two ways to read it, because the queue is used two ways:
 *
 *  - **Table** is the working view for a queue of this size — sortable on every
 *    column, filterable, multi-select, and it fits ~25 stays on a screen
 *    instead of nine.
 *  - **Cards** is the scanning view, for when you want the whole shape of one
 *    stay at a glance rather than a column of dates.
 *
 * Filtering and sorting are done in the browser over the full result set rather
 * than by re-querying: the API already returns the whole horizon in one pass,
 * and a desk of a few hundred rows re-sorts instantly while a round trip would
 * not.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ArrowDown, ArrowUp, ChevronsUpDown, Download, Inbox, LayoutGrid, Loader2,
  RefreshCw, Rows3, Search, SlidersHorizontal, X,
} from 'lucide-react'
import Button from '@/components/ui/button'
import { cn } from '@/lib/utils'
import ReservationDrawer from '@/components/reservations/reservation-drawer'
import { UrgencyChip, EmptyState, fmtDay, relDays } from '@/components/reservations/reservation-ui'
import { URGENCY_RANK, formatMoney, type Urgency } from '@/lib/reservation-shared'
import type { InboxStay } from '@/lib/reservations'

const HORIZONS = [30, 60, 90, 180, 365]

const COUNTRIES = [
  { value: '',                   label: 'All countries' },
  { value: 'VIETNAM',            label: 'Vietnam' },
  { value: 'SRILANKA',           label: 'Sri Lanka' },
  { value: 'SINGAPORE',          label: 'Singapore' },
  { value: 'MALAYSIA',           label: 'Malaysia' },
  { value: 'SINGAPORE_MALAYSIA', label: 'Singapore & Malaysia' },
]

const URGENCIES: { value: Urgency | ''; label: string }[] = [
  { value: '',         label: 'Any urgency' },
  { value: 'overdue',  label: 'Past check-in' },
  { value: 'critical', label: 'Within 14 days' },
  { value: 'soon',     label: 'Within 30 days' },
  { value: 'later',    label: 'Beyond 30 days' },
]

type SortKey =
  | 'urgency' | 'hotelName' | 'bookingRef' | 'city' | 'checkIn'
  | 'nights' | 'pax' | 'agent' | 'budgetAmount'

type ViewMode = 'table' | 'cards'

const VIEW_STORAGE_KEY = 'rs.requests.view'

export default function RequestInboxPage() {
  const [rows, setRows] = useState<InboxStay[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)

  // View
  const [view, setView] = useState<ViewMode>('table')
  const [showFilters, setShowFilters] = useState(false)

  // Filters
  const [horizon, setHorizon] = useState(90)
  const [search, setSearch] = useState('')
  const [country, setCountry] = useState('')
  const [urgency, setUrgency] = useState<Urgency | ''>('')
  const [agent, setAgent] = useState('')
  const [unknownOnly, setUnknownOnly] = useState(false)
  const [noBudgetOnly, setNoBudgetOnly] = useState(false)
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')

  // Sort — nearest check-in first is the only sensible default for a deadline queue.
  const [sortKey, setSortKey] = useState<SortKey>('checkIn')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')

  // Selection
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [claiming, setClaiming] = useState<string | null>(null)
  const [bulkBusy, setBulkBusy] = useState(false)

  // Restore the last view before first paint of the toolbar.
  useEffect(() => {
    const saved = localStorage.getItem(VIEW_STORAGE_KEY)
    if (saved === 'table' || saved === 'cards') setView(saved)
  }, [])

  function changeView(next: ViewMode) {
    setView(next)
    localStorage.setItem(VIEW_STORAGE_KEY, next)
  }

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/reservations/requests?horizon=${horizon}`)
      const json = await res.json()
      if (!json.success) throw new Error(json.error ?? 'Failed to load the inbox')
      setRows(json.data.rows)
      setSelected(new Set())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [horizon])

  useEffect(() => { void load() }, [load])

  /** Agent list for the filter, built from what is actually in the queue. */
  const agents = useMemo(() => {
    const set = new Set<string>()
    for (const r of rows) if (r.agent) set.add(r.agent)
    return Array.from(set).sort((a, b) => a.localeCompare(b))
  }, [rows])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter(r => {
      if (q && !(
        r.hotelName.toLowerCase().includes(q) ||
        r.bookingRef.toLowerCase().includes(q) ||
        (r.agent ?? '').toLowerCase().includes(q) ||
        (r.city ?? '').toLowerCase().includes(q) ||
        (r.roomType ?? '').toLowerCase().includes(q)
      )) return false
      if (country && r.operationCountry !== country) return false
      if (urgency && r.urgency !== urgency) return false
      if (agent && r.agent !== agent) return false
      if (unknownOnly && r.hotelProfileId) return false
      if (noBudgetOnly && r.budgetAmount !== null) return false
      // Date bounds compare on the calendar day, so an inclusive `to` really
      // includes stays checking in that day.
      if (fromDate && r.checkIn.slice(0, 10) < fromDate) return false
      if (toDate && r.checkIn.slice(0, 10) > toDate) return false
      return true
    })
  }, [rows, search, country, urgency, agent, unknownOnly, noBudgetOnly, fromDate, toDate])

  const sorted = useMemo(() => {
    const dir = sortDir === 'asc' ? 1 : -1
    const val = (r: InboxStay): string | number => {
      switch (sortKey) {
        case 'urgency':      return URGENCY_RANK[r.urgency]
        case 'hotelName':    return r.hotelName.toLowerCase()
        case 'bookingRef':   return r.bookingRef.toLowerCase()
        case 'city':         return (r.city ?? '').toLowerCase()
        case 'nights':       return r.nights
        case 'pax':          return r.adults + r.children
        case 'agent':        return (r.agent ?? '').toLowerCase()
        // Unbudgeted stays sort last ascending rather than pretending to be 0.
        case 'budgetAmount': return r.budgetAmount ?? Number.POSITIVE_INFINITY
        case 'checkIn':
        default:             return r.checkIn
      }
    }
    return [...filtered].sort((a, b) => {
      const av = val(a), bv = val(b)
      if (av < bv) return -1 * dir
      if (av > bv) return 1 * dir
      // Stable tiebreak so equal keys never shuffle between renders.
      return a.reservationKey.localeCompare(b.reservationKey)
    })
  }, [filtered, sortKey, sortDir])

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortKey(key); setSortDir(key === 'budgetAmount' ? 'desc' : 'asc') }
  }

  function clearFilters() {
    setSearch(''); setCountry(''); setUrgency(''); setAgent('')
    setUnknownOnly(false); setNoBudgetOnly(false); setFromDate(''); setToDate('')
  }

  const activeFilters =
    [search, country, urgency, agent, fromDate, toDate].filter(Boolean).length +
    (unknownOnly ? 1 : 0) + (noBudgetOnly ? 1 : 0)

  /** Claim one stay: create the reservation row, drop it from the queue, open it. */
  const claim = useCallback(async (stay: InboxStay, openAfter = true) => {
    const res = await fetch('/api/reservations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        bookingRef: stay.bookingRef,
        hotelName: stay.hotelName,
        checkIn: stay.checkIn,
        checkOut: stay.checkOut,
        accommodationId: stay.accommodationId,
        city: stay.city,
        roomType: stay.roomType,
        adults: stay.adults,
        children: stay.children,
      }),
    })
    const json = await res.json()
    if (!json.success) throw new Error(json.error ?? 'Could not claim this stay')
    setRows(prev => prev.filter(r => r.reservationKey !== stay.reservationKey))
    if (openAfter) setOpenId(json.data.id)
    return json.data.id as string
  }, [])

  async function claimOne(stay: InboxStay) {
    setClaiming(stay.reservationKey)
    setError(null)
    try { await claim(stay) }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not claim this stay') }
    finally { setClaiming(null) }
  }

  /**
   * Claim everything selected.
   *
   * Sequential on purpose: claiming is a write per stay and the API is
   * idempotent per reservation key, but firing 200 parallel creates at a live
   * database to save a few seconds is not a trade worth making.
   */
  async function claimSelected() {
    if (selected.size === 0) return
    setBulkBusy(true)
    setError(null)
    const targets = sorted.filter(r => selected.has(r.reservationKey))
    let done = 0
    const failures: string[] = []
    for (const stay of targets) {
      try { await claim(stay, false); done++ }
      catch { failures.push(stay.bookingRef) }
    }
    setSelected(new Set())
    setBulkBusy(false)
    if (failures.length) {
      setError(`Claimed ${done} of ${targets.length}. Failed: ${failures.slice(0, 5).join(', ')}${failures.length > 5 ? '…' : ''}`)
    }
  }

  function exportCsv() {
    const head = ['Booking', 'Hotel', 'City', 'Country', 'Check-in', 'Check-out', 'Nights', 'Adults', 'Children', 'Room', 'Meal', 'Agent', 'Budget USD', 'Hotel matched', 'Days to check-in']
    const esc = (v: unknown) => {
      const s = v === null || v === undefined ? '' : String(v)
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
    }
    const lines = sorted.map(r => [
      r.bookingRef, r.hotelName, r.city, r.operationCountry,
      r.checkIn.slice(0, 10), r.checkOut.slice(0, 10), r.nights,
      r.adults, r.children, r.roomType, r.mealType, r.agent,
      r.budgetAmount ?? '', r.hotelProfileId ? 'yes' : 'no', r.daysToCheckIn,
    ].map(esc).join(','))

    const blob = new Blob([[head.join(','), ...lines].join('\n')], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `reservation-requests-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const allSelected = sorted.length > 0 && selected.size === sorted.length

  return (
    <div className="space-y-4 p-5">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold text-slate-900">
            <Inbox className="h-5 w-5 text-brand-500" />
            Request Inbox
          </h1>
          <p className="mt-0.5 text-xs text-slate-500">
            {loading
              ? 'Loading…'
              : `${sorted.length.toLocaleString()} of ${rows.length.toLocaleString()} stays with no reservation opened yet`}
            {selected.size > 0 && <span className="ml-1 font-medium text-brand-600">· {selected.size} selected</span>}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Hotel, booking, agent, city…"
              className="w-64 rounded-md border border-slate-300 py-1.5 pl-8 pr-7 text-xs focus:outline-none focus:ring-2 focus:ring-brand-400"
            />
            {search && (
              <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          <Button
            size="sm"
            variant={activeFilters > 0 ? 'outline' : 'secondary'}
            onClick={() => setShowFilters(v => !v)}
            icon={<SlidersHorizontal className="h-3.5 w-3.5" />}
          >
            Filters{activeFilters > 0 && ` (${activeFilters})`}
          </Button>

          <div className="flex overflow-hidden rounded-md border border-slate-300">
            <ViewToggle active={view === 'table'} onClick={() => changeView('table')} icon={<Rows3 className="h-3.5 w-3.5" />} label="Table" />
            <ViewToggle active={view === 'cards'} onClick={() => changeView('cards')} icon={<LayoutGrid className="h-3.5 w-3.5" />} label="Cards" />
          </div>

          <Button size="sm" variant="secondary" onClick={exportCsv} disabled={sorted.length === 0} icon={<Download className="h-3.5 w-3.5" />}>
            CSV
          </Button>
          <Button size="sm" variant="secondary" onClick={load} icon={<RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />}>
            Refresh
          </Button>
        </div>
      </div>

      {/* ── Filter panel ───────────────────────────────────────────────── */}
      {showFilters && (
        <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Labelled label="Horizon">
              <select value={horizon} onChange={e => setHorizon(Number(e.target.value))} className={SELECT}>
                {HORIZONS.map(h => <option key={h} value={h}>Next {h} days</option>)}
              </select>
            </Labelled>
            <Labelled label="Country">
              <select value={country} onChange={e => setCountry(e.target.value)} className={SELECT}>
                {COUNTRIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </Labelled>
            <Labelled label="Urgency">
              <select value={urgency} onChange={e => setUrgency(e.target.value as Urgency | '')} className={SELECT}>
                {URGENCIES.map(u => <option key={u.value} value={u.value}>{u.label}</option>)}
              </select>
            </Labelled>
            <Labelled label="Agent">
              <select value={agent} onChange={e => setAgent(e.target.value)} className={SELECT}>
                <option value="">All agents</option>
                {agents.map(a => <option key={a} value={a}>{a}</option>)}
              </select>
            </Labelled>
            <Labelled label="Check-in from">
              <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} className={SELECT} />
            </Labelled>
            <Labelled label="Check-in to">
              <input type="date" value={toDate} onChange={e => setToDate(e.target.value)} className={SELECT} />
            </Labelled>
            <div className="flex items-end gap-4 sm:col-span-2">
              <label className="flex items-center gap-1.5 text-xs text-slate-700">
                <input type="checkbox" checked={unknownOnly} onChange={e => setUnknownOnly(e.target.checked)} />
                Unmatched hotels only
              </label>
              <label className="flex items-center gap-1.5 text-xs text-slate-700">
                <input type="checkbox" checked={noBudgetOnly} onChange={e => setNoBudgetOnly(e.target.checked)} />
                No P&amp;L budget only
              </label>
              {activeFilters > 0 && (
                <button onClick={clearFilters} className="ml-auto text-xs font-medium text-slate-500 underline hover:text-slate-700">
                  Clear all
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Bulk bar ───────────────────────────────────────────────────── */}
      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2">
          <span className="text-xs font-medium text-brand-800">
            {selected.size} stay{selected.size === 1 ? '' : 's'} selected
          </span>
          <Button size="sm" loading={bulkBusy} onClick={claimSelected}>
            Claim all selected
          </Button>
          <button onClick={() => setSelected(new Set())} className="text-xs text-slate-500 underline hover:text-slate-700">
            Clear selection
          </button>
          <span className="text-[11px] text-brand-700">
            Claimed stays are opened as reservations assigned to you; they leave this queue.
          </span>
        </div>
      )}

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
      )}

      {/* ── Body ───────────────────────────────────────────────────────── */}
      {loading && rows.length === 0 ? (
        <div className="flex items-center justify-center py-20 text-slate-400">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : sorted.length === 0 ? (
        <EmptyState
          icon={<Inbox className="h-8 w-8" />}
          title={rows.length === 0 ? 'Inbox clear' : 'No stays match these filters'}
          hint={rows.length === 0
            ? 'Every hotel stay inside this horizon has a reservation opened against it.'
            : 'Widen the horizon or clear a filter.'}
        />
      ) : view === 'table' ? (
        <TableView
          rows={sorted}
          sortKey={sortKey}
          sortDir={sortDir}
          onSort={toggleSort}
          selected={selected}
          onToggleRow={key => setSelected(prev => {
            const next = new Set(prev)
            next.has(key) ? next.delete(key) : next.add(key)
            return next
          })}
          onToggleAll={() => setSelected(allSelected ? new Set() : new Set(sorted.map(r => r.reservationKey)))}
          allSelected={allSelected}
          claiming={claiming}
          onClaim={claimOne}
        />
      ) : (
        <CardView rows={sorted} claiming={claiming} onClaim={claimOne} />
      )}

      <ReservationDrawer reservationId={openId} onClose={() => setOpenId(null)} onChanged={load} />
    </div>
  )
}

const SELECT = 'w-full rounded-md border border-slate-300 px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-brand-400'

function Labelled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</label>
      {children}
    </div>
  )
}

function ViewToggle({
  active, onClick, icon, label,
}: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium transition',
        active ? 'bg-slate-800 text-white' : 'bg-white text-slate-600 hover:bg-slate-50',
      )}
    >
      {icon}{label}
    </button>
  )
}

// ─── Table ───────────────────────────────────────────────────────────────────

interface TableProps {
  rows: InboxStay[]
  sortKey: SortKey
  sortDir: 'asc' | 'desc'
  onSort: (k: SortKey) => void
  selected: Set<string>
  onToggleRow: (key: string) => void
  onToggleAll: () => void
  allSelected: boolean
  claiming: string | null
  onClaim: (s: InboxStay) => void
}

const COLUMNS: { key: SortKey; label: string; align?: 'right' | 'center'; hide?: string }[] = [
  { key: 'urgency',      label: 'Due' },
  { key: 'hotelName',    label: 'Hotel' },
  { key: 'bookingRef',   label: 'Booking' },
  { key: 'city',         label: 'City', hide: 'hidden lg:table-cell' },
  { key: 'checkIn',      label: 'Check-in' },
  { key: 'nights',       label: 'Nights', align: 'right' },
  { key: 'pax',          label: 'Pax', align: 'right' },
  { key: 'agent',        label: 'Agent', hide: 'hidden xl:table-cell' },
  { key: 'budgetAmount', label: 'Budget', align: 'right' },
]

function TableView({
  rows, sortKey, sortDir, onSort, selected, onToggleRow, onToggleAll, allSelected, claiming, onClaim,
}: TableProps) {
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <table className="w-full text-left text-xs">
        <thead className="sticky top-0 z-10 border-b border-slate-200 bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500">
          <tr>
            <th className="w-8 px-3 py-2">
              <input type="checkbox" checked={allSelected} onChange={onToggleAll} title="Select all shown" />
            </th>
            {COLUMNS.map(c => (
              <th
                key={c.key}
                onClick={() => onSort(c.key)}
                className={cn(
                  'cursor-pointer select-none px-3 py-2 font-semibold transition hover:text-slate-800',
                  c.align === 'right' && 'text-right',
                  c.hide,
                )}
              >
                <span className={cn('inline-flex items-center gap-1', c.align === 'right' && 'flex-row-reverse')}>
                  {c.label}
                  <SortIcon active={sortKey === c.key} dir={sortDir} />
                </span>
              </th>
            ))}
            <th className="px-3 py-2" />
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map(r => {
            const isSelected = selected.has(r.reservationKey)
            return (
              <tr
                key={r.reservationKey}
                className={cn(
                  'transition hover:bg-slate-50',
                  isSelected && 'bg-brand-50/50',
                  r.urgency === 'overdue' && 'bg-red-50/40',
                )}
              >
                <td className="px-3 py-1.5">
                  <input type="checkbox" checked={isSelected} onChange={() => onToggleRow(r.reservationKey)} />
                </td>
                <td className="px-3 py-1.5">
                  <UrgencyChip urgency={r.urgency}>{relDays(r.daysToCheckIn)}</UrgencyChip>
                </td>
                <td className="px-3 py-1.5">
                  <div className="flex items-center gap-1.5">
                    <span className="max-w-[15rem] truncate font-medium text-slate-800" title={r.hotelName}>
                      {r.hotelName}
                    </span>
                    {!r.hotelProfileId && (
                      <span
                        className="shrink-0 rounded bg-amber-100 px-1 py-px text-[9px] font-medium text-amber-700"
                        title="No hotel profile matched this name — contacts will need to be found before quoting."
                      >
                        unmatched
                      </span>
                    )}
                  </div>
                  {r.roomType && <div className="truncate text-[10px] text-slate-400">{r.roomType}</div>}
                </td>
                <td className="px-3 py-1.5 font-mono text-[11px] text-slate-600">{r.bookingRef}</td>
                <td className="hidden px-3 py-1.5 text-slate-600 lg:table-cell">{r.city ?? '—'}</td>
                <td className="whitespace-nowrap px-3 py-1.5 text-slate-700">
                  {fmtDay(r.checkIn)}
                  <span className="ml-1 text-[10px] text-slate-400">→ {fmtDay(r.checkOut)}</span>
                </td>
                <td className="px-3 py-1.5 text-right tabular-nums text-slate-600">{r.nights}</td>
                <td className="px-3 py-1.5 text-right tabular-nums text-slate-600">
                  {r.adults}A{r.children > 0 && ` ${r.children}C`}
                </td>
                <td className="hidden max-w-[12rem] truncate px-3 py-1.5 text-slate-600 xl:table-cell" title={r.agent ?? ''}>
                  {r.agent ?? '—'}
                </td>
                <td className="px-3 py-1.5 text-right">
                  {r.budgetAmount === null
                    ? <span className="text-[10px] text-slate-300">no P&amp;L line</span>
                    : <span className="font-mono tabular-nums text-slate-700">{formatMoney(r.budgetAmount, 'USD')}</span>}
                </td>
                <td className="px-3 py-1.5 text-right">
                  <Button
                    size="sm"
                    className="!px-2.5 !py-1 !text-[10px]"
                    loading={claiming === r.reservationKey}
                    onClick={() => onClaim(r)}
                  >
                    Claim
                  </Button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function SortIcon({ active, dir }: { active: boolean; dir: 'asc' | 'desc' }) {
  if (!active) return <ChevronsUpDown className="h-3 w-3 text-slate-300" />
  return dir === 'asc'
    ? <ArrowUp className="h-3 w-3 text-slate-700" />
    : <ArrowDown className="h-3 w-3 text-slate-700" />
}

// ─── Cards ───────────────────────────────────────────────────────────────────

function CardView({
  rows, claiming, onClaim,
}: { rows: InboxStay[]; claiming: string | null; onClaim: (s: InboxStay) => void }) {
  return (
    <div className="grid gap-2.5 md:grid-cols-2 xl:grid-cols-3">
      {rows.map(stay => (
        <div
          key={stay.reservationKey}
          className="flex flex-col rounded-lg border border-slate-200 bg-white p-3 shadow-sm transition hover:border-slate-300"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-slate-900">{stay.hotelName}</div>
              <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-slate-500">
                <span className="font-mono">{stay.bookingRef}</span>
                {stay.city && <>· {stay.city}</>}
              </div>
            </div>
            <UrgencyChip urgency={stay.urgency}>{relDays(stay.daysToCheckIn)}</UrgencyChip>
          </div>

          <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 border-t border-slate-100 pt-2 text-[11px]">
            <Cell label="Check-in">{fmtDay(stay.checkIn)}</Cell>
            <Cell label="Check-out">{fmtDay(stay.checkOut)}</Cell>
            <Cell label="Nights">{stay.nights}</Cell>
            <Cell label="Pax">{stay.adults}A {stay.children > 0 && `${stay.children}C`}</Cell>
            <Cell label="Room">{stay.roomType ?? '—'}</Cell>
            <Cell label="Budget">
              {stay.budgetAmount === null
                ? <span className="text-slate-400">no P&amp;L line</span>
                : formatMoney(stay.budgetAmount, 'USD')}
            </Cell>
          </div>

          {stay.agent && <p className="mt-1.5 truncate text-[10px] text-slate-400">Agent: {stay.agent}</p>}

          <div className="mt-2.5 flex items-center gap-2">
            <Button
              size="sm"
              className="flex-1"
              loading={claiming === stay.reservationKey}
              onClick={() => onClaim(stay)}
            >
              Claim &amp; start
            </Button>
            {!stay.hotelProfileId && (
              <span
                className="rounded bg-amber-50 px-1.5 py-1 text-[10px] font-medium text-amber-700"
                title="No hotel profile matched this name — contacts will need to be found."
              >
                unmatched
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

function Cell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <span className="text-slate-400">{label}: </span>
      <span className="text-slate-700">{children}</span>
    </div>
  )
}
