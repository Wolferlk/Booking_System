'use client'

/**
 * The filter bar for Tickets & Vouchers.
 *
 * Every control here maps onto a query parameter the server understands
 * (`src/lib/ticket-filters.ts`), so the list, the tab counts and the report all
 * read the same filter. Nothing is filtered in the browser any more — the table
 * is far too big for that — which is why the state lives in one object that is
 * serialised straight into the request.
 */

import { useMemo, useState } from 'react'
import {
  Search, SlidersHorizontal, X, CalendarRange, RotateCcw, ChevronDown,
} from 'lucide-react'

// ─── state ───────────────────────────────────────────────────────────────────

export type TicketStatusFilter =
  | 'all' | 'pending_activation' | 'active' | 'purchased'
  | 'issued' | 'not_issued' | 'awaiting_approval'

export type TicketSortKey =
  | 'created_desc' | 'created_asc' | 'arrival_asc' | 'arrival_desc'
  | 'booking_created_desc' | 'booking_created_asc' | 'purchased_desc'
  | 'cost_desc' | 'cost_asc' | 'type_asc'

export interface TicketFilterState {
  q: string
  status: TicketStatusFilter
  categories: string[]
  arrivalFrom: string
  arrivalTo: string
  bookingCreatedFrom: string
  bookingCreatedTo: string
  ticketCreatedFrom: string
  ticketCreatedTo: string
  purchasedFrom: string
  purchasedTo: string
  bookingRef: string
  agent: string
  supplier: string
  portal: string
  approval: string
  hasFile: 'any' | 'yes' | 'no'
  currency: string
  sort: TicketSortKey
}

export const EMPTY_FILTERS: TicketFilterState = {
  q: '', status: 'all', categories: [],
  arrivalFrom: '', arrivalTo: '',
  bookingCreatedFrom: '', bookingCreatedTo: '',
  ticketCreatedFrom: '', ticketCreatedTo: '',
  purchasedFrom: '', purchasedTo: '',
  bookingRef: '', agent: '', supplier: '', portal: '',
  approval: '', hasFile: 'any', currency: '', sort: 'created_desc',
}

/** Turn the panel into the query string the API reads. */
export function filtersToParams(f: TicketFilterState, country?: string): URLSearchParams {
  const p = new URLSearchParams()
  if (country && country !== 'ALL') p.set('country', country)
  if (f.q) p.set('q', f.q)
  if (f.status !== 'all') p.set('status', f.status)
  if (f.categories.length) p.set('category', f.categories.join(','))
  const dates: (keyof TicketFilterState)[] = [
    'arrivalFrom', 'arrivalTo', 'bookingCreatedFrom', 'bookingCreatedTo',
    'ticketCreatedFrom', 'ticketCreatedTo', 'purchasedFrom', 'purchasedTo',
    'bookingRef', 'agent', 'supplier', 'portal', 'approval', 'currency',
  ]
  for (const k of dates) {
    const v = f[k]
    if (typeof v === 'string' && v) p.set(k, v)
  }
  if (f.hasFile !== 'any') p.set('hasFile', f.hasFile)
  if (f.sort !== 'created_desc') p.set('sort', f.sort)
  return p
}

/** How many things the user has narrowed by, for the badge on the toggle. */
export function countActiveFilters(f: TicketFilterState): number {
  let n = 0
  if (f.q) n++
  if (f.categories.length) n++
  if (f.arrivalFrom || f.arrivalTo) n++
  if (f.bookingCreatedFrom || f.bookingCreatedTo) n++
  if (f.ticketCreatedFrom || f.ticketCreatedTo) n++
  if (f.purchasedFrom || f.purchasedTo) n++
  if (f.bookingRef) n++
  if (f.agent) n++
  if (f.supplier) n++
  if (f.portal) n++
  if (f.approval) n++
  if (f.hasFile !== 'any') n++
  if (f.currency) n++
  return n
}

// ─── quick ranges ────────────────────────────────────────────────────────────

const iso = (d: Date) => {
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000)
  return local.toISOString().slice(0, 10)
}

function shiftDays(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return iso(d)
}

function monthStart(offset = 0): string {
  const d = new Date()
  return iso(new Date(d.getFullYear(), d.getMonth() + offset, 1))
}

function monthEnd(offset = 0): string {
  const d = new Date()
  return iso(new Date(d.getFullYear(), d.getMonth() + offset + 1, 0))
}

/**
 * The windows the ground team actually asks for. Each one sets a pair of date
 * boxes, so picking one and then editing a box by hand behaves sensibly.
 */
const QUICK_RANGES: { label: string; from: () => string; to: () => string }[] = [
  { label: 'Today',        from: () => shiftDays(0),  to: () => shiftDays(0) },
  { label: 'Tomorrow',     from: () => shiftDays(1),  to: () => shiftDays(1) },
  { label: 'Next 7 days',  from: () => shiftDays(0),  to: () => shiftDays(7) },
  { label: 'Next 30 days', from: () => shiftDays(0),  to: () => shiftDays(30) },
  { label: 'This month',   from: () => monthStart(),  to: () => monthEnd() },
  { label: 'Next month',   from: () => monthStart(1), to: () => monthEnd(1) },
  { label: 'Last 30 days', from: () => shiftDays(-30), to: () => shiftDays(0) },
  { label: 'Last month',   from: () => monthStart(-1), to: () => monthEnd(-1) },
]

/**
 * One-click answers to the questions this screen exists for. A preset replaces
 * the whole filter rather than adding to it, so what you get is exactly what
 * the label says.
 */
export const PRESETS: { label: string; hint: string; build: () => TicketFilterState }[] = [
  {
    label: 'Arriving next 7 days',
    hint: 'Every ticket for guests landing this week',
    build: () => ({ ...EMPTY_FILTERS, arrivalFrom: shiftDays(0), arrivalTo: shiftDays(7), sort: 'arrival_asc' }),
  },
  {
    label: 'Not issued · arriving soon',
    hint: 'Paid for but no ticket file uploaded yet, arriving within 14 days',
    build: () => ({
      ...EMPTY_FILTERS, status: 'not_issued',
      arrivalFrom: shiftDays(0), arrivalTo: shiftDays(14), sort: 'arrival_asc',
    }),
  },
  {
    label: 'Pending activation',
    hint: 'Waiting for the ground team to activate',
    build: () => ({ ...EMPTY_FILTERS, status: 'pending_activation', sort: 'arrival_asc' }),
  },
  {
    label: 'With Accounts',
    hint: 'Approval requests still unanswered',
    build: () => ({ ...EMPTY_FILTERS, status: 'awaiting_approval', sort: 'arrival_asc' }),
  },
  {
    label: 'Bought this month',
    hint: 'Purchases made in the current month — the spend report',
    build: () => ({
      ...EMPTY_FILTERS, status: 'purchased',
      purchasedFrom: monthStart(), purchasedTo: monthEnd(), sort: 'purchased_desc',
    }),
  },
  {
    label: 'Files opened this month',
    hint: 'Tickets on bookings created this month, whenever they travel',
    build: () => ({
      ...EMPTY_FILTERS,
      bookingCreatedFrom: monthStart(), bookingCreatedTo: monthEnd(),
      sort: 'booking_created_desc',
    }),
  },
]

// ─── options ─────────────────────────────────────────────────────────────────

const CATEGORIES = [
  ['HOTEL', 'Hotel Voucher'], ['TICKETS', 'Entrance Ticket'], ['CRUISE', 'Cruise Ticket'],
  ['WATER', 'Water Activity'], ['GUIDES', 'Guide Voucher'], ['FLIGHT_TICKETS', 'Flight Ticket'],
  ['TRANSPORT', 'Transfer Voucher'], ['MEALS', 'Meal Voucher'], ['TAX_FEES', 'Tax & Fees'],
  ['OTHER', 'Service Voucher'],
]

const SORT_OPTIONS: [TicketSortKey, string][] = [
  ['created_desc', 'Newest ticket first'],
  ['created_asc', 'Oldest ticket first'],
  ['arrival_asc', 'Arrival — soonest first'],
  ['arrival_desc', 'Arrival — latest first'],
  ['booking_created_desc', 'Booking created — newest'],
  ['booking_created_asc', 'Booking created — oldest'],
  ['purchased_desc', 'Recently purchased'],
  ['cost_desc', 'Cost — highest first'],
  ['cost_asc', 'Cost — lowest first'],
  ['type_asc', 'Ticket name A–Z'],
]

const APPROVALS: [string, string][] = [
  ['', 'Any approval state'],
  ['none', 'Never submitted'],
  ['pending', 'Waiting with Accounts'],
  ['approved', 'Approved — awaiting payment'],
  ['paid', 'Paid — ready to buy'],
  ['rejected', 'Sent back'],
]

// ─── pieces ──────────────────────────────────────────────────────────────────

function DateRange({
  icon, label, hint, from, to, onChange,
}: {
  icon: React.ReactNode
  label: string
  hint: string
  from: string
  to: string
  onChange: (from: string, to: string) => void
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5">
        <span className="text-slate-400">{icon}</span>
        <span className="text-xs font-semibold text-slate-700">{label}</span>
        {(from || to) && (
          <button
            onClick={() => onChange('', '')}
            className="text-[10px] text-slate-400 hover:text-red-600"
          >
            clear
          </button>
        )}
      </div>
      <div className="flex items-center gap-1.5">
        <input
          type="date" value={from} max={to || undefined}
          onChange={e => onChange(e.target.value, to)}
          className="form-input text-xs py-1.5 flex-1 min-w-0"
        />
        <span className="text-slate-300 text-xs">→</span>
        <input
          type="date" value={to} min={from || undefined}
          onChange={e => onChange(from, e.target.value)}
          className="form-input text-xs py-1.5 flex-1 min-w-0"
        />
      </div>
      <div className="flex flex-wrap gap-1">
        {QUICK_RANGES.map(r => (
          <button
            key={r.label}
            onClick={() => onChange(r.from(), r.to())}
            className="text-[10px] px-1.5 py-0.5 rounded border border-slate-200 text-slate-500 hover:bg-brand-50 hover:text-brand-700 hover:border-brand-200"
          >
            {r.label}
          </button>
        ))}
      </div>
      <p className="text-[10px] text-slate-400 leading-tight">{hint}</p>
    </div>
  )
}

function TextFilter({
  label, value, placeholder, onChange,
}: { label: string; value: string; placeholder: string; onChange: (v: string) => void }) {
  return (
    <div className="space-y-1">
      <label className="text-xs font-semibold text-slate-700">{label}</label>
      <input
        value={value}
        placeholder={placeholder}
        onChange={e => onChange(e.target.value)}
        className="form-input text-xs py-1.5"
      />
    </div>
  )
}

// ─── main ────────────────────────────────────────────────────────────────────

export interface TicketTab {
  value: TicketStatusFilter
  label: string
  count: number | undefined
  tone?: 'warn' | 'good' | 'alert'
}

export default function TicketFilterBar({
  filters, onChange, tabs, resultCount, children,
}: {
  filters: TicketFilterState
  onChange: (next: TicketFilterState) => void
  tabs: TicketTab[]
  resultCount: number | null
  /** Actions that sit beside the search box — export, report, refresh. */
  children?: React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  const activeCount = useMemo(() => countActiveFilters(filters), [filters])

  const set = <K extends keyof TicketFilterState>(key: K, value: TicketFilterState[K]) =>
    onChange({ ...filters, [key]: value })

  const toggleCategory = (cat: string) =>
    set('categories', filters.categories.includes(cat)
      ? filters.categories.filter(c => c !== cat)
      : [...filters.categories, cat])

  // The "you are currently looking at" line. Clearing one chip has to leave the
  // rest of the filter alone, so each carries its own reset.
  const chips: { label: string; clear: () => void }[] = []
  if (filters.q) chips.push({ label: `Search: ${filters.q}`, clear: () => set('q', '') })
  if (filters.categories.length) {
    chips.push({
      label: `${filters.categories.length} categor${filters.categories.length === 1 ? 'y' : 'ies'}`,
      clear: () => set('categories', []),
    })
  }
  const rangeChip = (label: string, a: keyof TicketFilterState, b: keyof TicketFilterState) => {
    const from = filters[a] as string
    const to = filters[b] as string
    if (!from && !to) return
    chips.push({
      label: `${label}: ${from || '…'} → ${to || '…'}`,
      clear: () => onChange({ ...filters, [a]: '', [b]: '' }),
    })
  }
  rangeChip('Arrival', 'arrivalFrom', 'arrivalTo')
  rangeChip('Booking created', 'bookingCreatedFrom', 'bookingCreatedTo')
  rangeChip('Ticket added', 'ticketCreatedFrom', 'ticketCreatedTo')
  rangeChip('Purchased', 'purchasedFrom', 'purchasedTo')
  if (filters.bookingRef) chips.push({ label: `Booking ${filters.bookingRef}`, clear: () => set('bookingRef', '') })
  if (filters.agent) chips.push({ label: `Agent ${filters.agent}`, clear: () => set('agent', '') })
  if (filters.supplier) chips.push({ label: `Supplier ${filters.supplier}`, clear: () => set('supplier', '') })
  if (filters.portal) chips.push({ label: `Portal ${filters.portal}`, clear: () => set('portal', '') })
  if (filters.approval) {
    chips.push({
      label: APPROVALS.find(a => a[0] === filters.approval)?.[1] ?? filters.approval,
      clear: () => set('approval', ''),
    })
  }
  if (filters.hasFile !== 'any') {
    chips.push({
      label: filters.hasFile === 'yes' ? 'Ticket file uploaded' : 'No ticket file',
      clear: () => set('hasFile', 'any'),
    })
  }
  if (filters.currency) chips.push({ label: filters.currency, clear: () => set('currency', '') })

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-card p-4 space-y-3">

      {/* Search + actions */}
      <div className="flex flex-col lg:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            placeholder="Search ticket, supplier, booking ref, agent, portal, confirmation no…"
            value={filters.q}
            onChange={e => set('q', e.target.value)}
            className="form-input pl-9 pr-9"
          />
          {filters.q && (
            <button
              onClick={() => set('q', '')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setOpen(o => !o)}
            className={`btn btn-sm whitespace-nowrap ${activeCount ? 'btn-primary' : 'btn-secondary'}`}
          >
            <SlidersHorizontal className="w-4 h-4" />
            Filters
            {activeCount > 0 && (
              <span className="ml-1 px-1.5 py-0.5 rounded-full bg-white/25 text-[10px] font-bold">
                {activeCount}
              </span>
            )}
            <ChevronDown className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
          </button>

          <select
            value={filters.sort}
            onChange={e => set('sort', e.target.value as TicketSortKey)}
            className="form-select text-xs py-2 w-44"
            title="Sort order"
          >
            {SORT_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>

          {children}
        </div>
      </div>

      {/* Presets */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 mr-1">
          Quick views
        </span>
        {PRESETS.map(p => (
          <button
            key={p.label}
            title={p.hint}
            onClick={() => onChange(p.build())}
            className="text-[11px] px-2 py-1 rounded-lg border border-slate-200 text-slate-600 hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700 transition-colors"
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Advanced panel */}
      {open && (
        <div className="border-t border-slate-100 pt-4 space-y-4">

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
            <DateRange
              icon={<CalendarRange className="w-3.5 h-3.5" />}
              label="Arrival date"
              hint="Tickets for guests arriving in this window."
              from={filters.arrivalFrom} to={filters.arrivalTo}
              onChange={(from, to) => onChange({ ...filters, arrivalFrom: from, arrivalTo: to })}
            />
            <DateRange
              icon={<CalendarRange className="w-3.5 h-3.5" />}
              label="Booking created"
              hint="Tickets on files opened in this window, whenever they travel."
              from={filters.bookingCreatedFrom} to={filters.bookingCreatedTo}
              onChange={(from, to) => onChange({ ...filters, bookingCreatedFrom: from, bookingCreatedTo: to })}
            />
            <DateRange
              icon={<CalendarRange className="w-3.5 h-3.5" />}
              label="Ticket added"
              hint="When the ticket line itself was created on the system."
              from={filters.ticketCreatedFrom} to={filters.ticketCreatedTo}
              onChange={(from, to) => onChange({ ...filters, ticketCreatedFrom: from, ticketCreatedTo: to })}
            />
            <DateRange
              icon={<CalendarRange className="w-3.5 h-3.5" />}
              label="Purchased"
              hint="When the ticket was actually bought — the spend window."
              from={filters.purchasedFrom} to={filters.purchasedTo}
              onChange={(from, to) => onChange({ ...filters, purchasedFrom: from, purchasedTo: to })}
            />
          </div>

          {/* Categories */}
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-slate-700">Categories</span>
              {filters.categories.length > 0 && (
                <button onClick={() => set('categories', [])} className="text-[10px] text-slate-400 hover:text-red-600">
                  clear
                </button>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {CATEGORIES.map(([value, label]) => {
                const on = filters.categories.includes(value)
                return (
                  <button
                    key={value}
                    onClick={() => toggleCategory(value)}
                    className={`text-[11px] px-2 py-1 rounded-lg border transition-colors ${
                      on
                        ? 'bg-brand-600 text-white border-brand-600'
                        : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    {label}
                  </button>
                )
              })}
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
            <TextFilter label="Booking ref" value={filters.bookingRef} placeholder="IS49029"
              onChange={v => set('bookingRef', v)} />
            <TextFilter label="Agent" value={filters.agent} placeholder="Agent name"
              onChange={v => set('agent', v)} />
            <TextFilter label="Supplier" value={filters.supplier} placeholder="Supplier"
              onChange={v => set('supplier', v)} />
            <TextFilter label="Portal" value={filters.portal} placeholder="Global Tix…"
              onChange={v => set('portal', v)} />

            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-700">Approval</label>
              <select
                value={filters.approval}
                onChange={e => set('approval', e.target.value)}
                className="form-select text-xs py-1.5"
              >
                {APPROVALS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-700">Ticket file</label>
              <select
                value={filters.hasFile}
                onChange={e => set('hasFile', e.target.value as 'any' | 'yes' | 'no')}
                className="form-select text-xs py-1.5"
              >
                <option value="any">Any</option>
                <option value="yes">Uploaded — issued</option>
                <option value="no">Missing — not issued</option>
              </select>
            </div>
          </div>

          <div className="flex items-center justify-between pt-1">
            <p className="text-[11px] text-slate-400">
              Filters run on the server, so counts and reports cover every matching ticket — not just this page.
            </p>
            <button
              onClick={() => onChange({ ...EMPTY_FILTERS, sort: filters.sort })}
              className="btn btn-secondary btn-sm text-xs"
            >
              <RotateCcw className="w-3.5 h-3.5" /> Reset all
            </button>
          </div>
        </div>
      )}

      {/* Status tabs */}
      <div className="flex items-center gap-1 flex-wrap border-t border-slate-100 pt-3">
        {tabs.map(t => (
          <button
            key={t.value}
            onClick={() => set('status', t.value)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors border ${
              filters.status === t.value
                ? 'bg-brand-600 text-white border-brand-600'
                : t.tone === 'alert'
                  ? 'bg-white text-red-600 border-red-200 hover:bg-red-50'
                  : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
            }`}
          >
            {t.label}
            <span className={`ml-1.5 px-1.5 py-0.5 rounded-full text-[10px] font-bold ${
              filters.status === t.value ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-500'
            }`}>
              {t.count === undefined ? '…' : t.count.toLocaleString()}
            </span>
          </button>
        ))}
      </div>

      {/* Active filter chips */}
      {chips.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 border-t border-slate-100 pt-3">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
            Showing
          </span>
          {chips.map(c => (
            <span
              key={c.label}
              className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-brand-50 text-brand-700 border border-brand-200"
            >
              {c.label}
              <button onClick={c.clear} className="hover:text-red-600">
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
          {resultCount !== null && (
            <span className="text-[11px] text-slate-500 ml-1">
              {resultCount.toLocaleString()} match{resultCount === 1 ? '' : 'es'}
            </span>
          )}
          <button
            onClick={() => onChange({ ...EMPTY_FILTERS, sort: filters.sort })}
            className="text-[11px] text-slate-400 hover:text-red-600 underline ml-1"
          >
            clear all
          </button>
        </div>
      )}
    </div>
  )
}
