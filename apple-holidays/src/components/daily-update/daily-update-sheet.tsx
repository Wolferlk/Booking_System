'use client'

/**
 * The Daily Update Sheet.
 *
 * A calendar-shaped view of the book: what is arriving in the next ten days,
 * with everything sold today pinned above it. Deliberately a *sheet* rather
 * than a dashboard — the desk reads it top to bottom every morning, fills in
 * whatever IS or CNTL number is still blank, and mails the result out, so the
 * table, the Excel file and the PDF are all the same rows in the same order.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSession } from 'next-auth/react'
import {
  CalendarDays, CalendarRange, Users, AlertTriangle, Search, X, Check,
  FileSpreadsheet, FileText, RefreshCw, Loader2, Sparkles,
  Plane, PlaneLanding, Building2, Phone, Mail, MessageCircle, Pencil,
  ChevronDown, SlidersHorizontal, Globe, Clock, ArrowUpDown, Ban,
} from 'lucide-react'
import { toast } from 'sonner'
import { cn, formatDate, formatDateTime } from '@/lib/utils'
import { Card } from '@/components/ui/card'
import { StatusBadge } from '@/components/ui/badge'
import { CountryFlag } from '@/components/ui/country-flag'
import { useCountryFilter } from '@/hooks/use-country-filter'
import type { BookingStatus } from '@prisma/client'

// ─── Types ────────────────────────────────────────────────────────────────────

type Row = {
  id: string
  bookingRef: string
  isNumber: string | null
  cntlNumber: string | null
  agentBookingId: string | null
  operationCountry: string | null
  status: string
  arrivalDate: string
  departureDate: string
  nights: number
  createdAt: string
  updatedAt: string
  daysToArrival: number
  guestName: string | null
  guestPhone: string | null
  guestEmail: string | null
  guestWhatsapp: string | null
  agent: string | null
  agentPhone: string | null
  agentEmail: string | null
  agentWhatsapp: string | null
  fileHandler: string | null
  paxAdults: number
  paxChildren: number
  paxInfants: number
  totalPax: number
  createdToday: boolean
  amended: boolean
  hotelOnly: boolean
  cancelled: boolean
}

type Stats = {
  total: number
  createdToday: number
  arrivingToday: number
  onGround: number
  missingIds: number
  totalPax: number
}

type DateField = 'arrivalDate' | 'departureDate' | 'createdAt' | 'updatedAt'

type Filters = {
  dateField: DateField
  days: number
  from: string
  to: string
  agent: string
  search: string
  country: string
  includeToday: boolean
  includeCancelled: boolean
  sortBy: DateField
  sortDir: 'asc' | 'desc'
}

const DEFAULT_FILTERS: Filters = {
  dateField: 'arrivalDate',
  days: 10,
  from: '',
  to: '',
  agent: '',
  search: '',
  country: '',
  includeToday: true,
  includeCancelled: false,
  sortBy: 'arrivalDate',
  sortDir: 'asc',
}

const DATE_FIELDS: { value: DateField; label: string; short: string; icon: typeof CalendarDays }[] = [
  { value: 'arrivalDate',   label: 'Arrival date',         short: 'Arrival',   icon: PlaneLanding },
  { value: 'departureDate', label: 'Departure date',       short: 'Departure', icon: Plane },
  { value: 'createdAt',     label: 'Booking created date', short: 'Created',   icon: Sparkles },
  { value: 'updatedAt',     label: 'Last updated date',    short: 'Updated',   icon: Clock },
]

const DAY_PRESETS = [
  { days: 0,  label: 'Today' },
  { days: 3,  label: '3 days' },
  { days: 7,  label: '7 days' },
  { days: 10, label: '10 days' },
  { days: 14, label: '14 days' },
  { days: 30, label: '30 days' },
]

const COUNTRIES = [
  { value: '',                   label: 'All countries' },
  { value: 'VIETNAM',            label: 'Vietnam' },
  { value: 'SRILANKA',           label: 'Sri Lanka' },
  { value: 'SINGAPORE',          label: 'Singapore' },
  { value: 'MALAYSIA',           label: 'Malaysia' },
  { value: 'SINGAPORE_MALAYSIA', label: 'Singapore & Malaysia' },
]

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildQuery(f: Filters): string {
  const p = new URLSearchParams()
  p.set('dateField', f.dateField)
  p.set('days', String(f.days))
  if (f.from) p.set('from', f.from)
  if (f.to) p.set('to', f.to)
  if (f.agent) p.set('agent', f.agent)
  if (f.search) p.set('search', f.search)
  if (f.country) p.set('country', f.country)
  p.set('includeToday', f.includeToday ? '1' : '0')
  p.set('includeCancelled', f.includeCancelled ? '1' : '0')
  p.set('sortBy', f.sortBy)
  p.set('sortDir', f.sortDir)
  return p.toString()
}

/** "TODAY" / "in 3 days" / "landed 2 days ago" — the sheet's urgency column. */
function whenLabel(days: number): string {
  if (days === 0) return 'Today'
  if (days === 1) return 'Tomorrow'
  if (days > 1) return `in ${days} days`
  if (days === -1) return 'landed yesterday'
  return `landed ${Math.abs(days)}d ago`
}

function whenTone(days: number): string {
  if (days < 0) return 'bg-cyan-50 text-cyan-700 ring-cyan-200'
  if (days === 0) return 'bg-red-50 text-red-700 ring-red-200'
  if (days <= 2) return 'bg-orange-50 text-orange-700 ring-orange-200'
  if (days <= 5) return 'bg-amber-50 text-amber-700 ring-amber-200'
  return 'bg-slate-50 text-slate-600 ring-slate-200'
}

function accentTone(r: Row): string {
  if (r.cancelled) return 'bg-red-400'
  if (r.daysToArrival < 0) return 'bg-cyan-400'
  if (r.daysToArrival === 0) return 'bg-red-500'
  if (r.daysToArrival <= 2) return 'bg-orange-400'
  if (r.daysToArrival <= 5) return 'bg-amber-400'
  return 'bg-slate-200'
}

// ─── Stat tile ────────────────────────────────────────────────────────────────

function Tile({
  label, value, icon: Icon, gradient, active, onClick, hint,
}: {
  label: string
  value: number
  icon: typeof Users
  gradient: string
  active?: boolean
  onClick?: () => void
  hint?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      title={hint}
      className={cn(
        'group relative overflow-hidden rounded-2xl p-4 text-left transition-all',
        'ring-1 ring-slate-200 bg-white',
        onClick && 'hover:-translate-y-0.5 hover:shadow-lg hover:ring-slate-300 cursor-pointer',
        active && 'ring-2 ring-slate-900 shadow-lg',
      )}
    >
      <div className={cn('absolute inset-x-0 top-0 h-1', gradient)} />
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-2xl font-bold text-slate-900 tabular-nums leading-none">{value}</p>
          <p className="mt-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500 truncate">{label}</p>
        </div>
        <span className={cn('flex-shrink-0 rounded-xl p-2 text-white', gradient)}>
          <Icon className="w-4 h-4" />
        </span>
      </div>
    </button>
  )
}

// ─── Inline IS / CNTL editor ──────────────────────────────────────────────────

/**
 * The one write this screen makes.
 *
 * IS and CNTL numbers arrive late — the file is created from a TC before the
 * numbers are issued — so the sheet is where the gap is spotted, and making
 * somebody open the booking page to fill in six characters is why the gaps
 * survive. Saves go through the booking PUT route, which re-checks role and
 * country server-side; this component only decides whether to show the pencil.
 */
function IdCell({
  value, field, bookingRef, canEdit, onSaved,
}: {
  value: string | null
  field: 'isNumber' | 'cntlNumber'
  bookingRef: string
  canEdit: boolean
  onSaved: (next: string | null) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value ?? '')
  const [saving, setSaving] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { setDraft(value ?? '') }, [value])
  useEffect(() => { if (editing) inputRef.current?.focus() }, [editing])

  const save = useCallback(async () => {
    const next = draft.trim()
    if (next === (value ?? '')) { setEditing(false); return }
    setSaving(true)
    try {
      const res = await fetch(`/api/bookings/${encodeURIComponent(bookingRef)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [field]: next === '' ? null : next }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || json?.success === false) {
        throw new Error(json?.error ?? 'Could not save')
      }
      onSaved(next === '' ? null : next)
      toast.success(`${field === 'isNumber' ? 'IS' : 'CNTL'} number saved for ${bookingRef}`)
      setEditing(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save')
      setDraft(value ?? '')
    } finally {
      setSaving(false)
    }
  }, [draft, value, bookingRef, field, onSaved])

  if (editing) {
    return (
      <div className="flex items-center gap-1">
        <input
          ref={inputRef}
          value={draft}
          disabled={saving}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') { e.preventDefault(); void save() }
            if (e.key === 'Escape') { setDraft(value ?? ''); setEditing(false) }
          }}
          onBlur={() => void save()}
          placeholder={field === 'isNumber' ? 'IS number' : 'CNTL number'}
          className="w-28 rounded-lg border border-slate-900 px-2 py-1 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-slate-900/20"
        />
        {saving
          ? <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-400" />
          : <Check className="w-3.5 h-3.5 text-emerald-500" />}
      </div>
    )
  }

  if (!value) {
    return (
      <button
        type="button"
        disabled={!canEdit}
        onClick={() => setEditing(true)}
        className={cn(
          'inline-flex items-center gap-1 rounded-lg border border-dashed px-2 py-1 text-[11px] font-medium',
          canEdit
            ? 'border-amber-400 bg-amber-50 text-amber-700 hover:bg-amber-100'
            : 'border-slate-300 bg-slate-50 text-slate-400 cursor-default',
        )}
      >
        <AlertTriangle className="w-3 h-3" />
        {canEdit ? 'Add' : 'Missing'}
      </button>
    )
  }

  return (
    <button
      type="button"
      disabled={!canEdit}
      onClick={() => setEditing(true)}
      className={cn(
        'group/id inline-flex items-center gap-1.5 rounded-lg px-1.5 py-1 font-mono text-xs font-semibold text-slate-800',
        canEdit && 'hover:bg-slate-100',
      )}
    >
      {value}
      {canEdit && <Pencil className="w-3 h-3 text-slate-300 opacity-0 group-hover/id:opacity-100 transition-opacity" />}
    </button>
  )
}

// ─── Contact block ────────────────────────────────────────────────────────────

function Contact({ phone, whatsapp, email }: { phone: string | null; whatsapp: string | null; email: string | null }) {
  if (!phone && !whatsapp && !email) {
    return <span className="text-xs text-slate-300">—</span>
  }
  return (
    <div className="space-y-0.5">
      {phone && (
        <a href={`tel:${phone}`} className="flex items-center gap-1.5 text-xs text-slate-700 hover:text-slate-900">
          <Phone className="w-3 h-3 flex-shrink-0 text-slate-400" />
          <span className="truncate">{phone}</span>
        </a>
      )}
      {whatsapp && whatsapp !== phone && (
        <a
          href={`https://wa.me/${whatsapp.replace(/[^\d]/g, '')}`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 text-xs text-emerald-600 hover:text-emerald-700"
        >
          <MessageCircle className="w-3 h-3 flex-shrink-0" />
          <span className="truncate">{whatsapp}</span>
        </a>
      )}
      {email && (
        <a href={`mailto:${email}`} className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-800">
          <Mail className="w-3 h-3 flex-shrink-0 text-slate-400" />
          <span className="truncate max-w-[160px]">{email}</span>
        </a>
      )}
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function DailyUpdateSheet() {
  const { data: session } = useSession()
  const { canFilter } = useCountryFilter()

  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS)
  const [searchDraft, setSearchDraft] = useState('')
  const [rows, setRows] = useState<Row[]>([])
  const [agents, setAgents] = useState<{ name: string; count: number }[]>([])
  const [stats, setStats] = useState<Stats | null>(null)
  const [range, setRange] = useState<{ start: string; end: string } | null>(null)
  const [canEdit, setCanEdit] = useState(false)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [onlyMissing, setOnlyMissing] = useState(false)
  const [downloading, setDownloading] = useState<'xlsx' | 'pdf' | null>(null)

  const patch = useCallback((next: Partial<Filters>) => {
    setFilters(f => ({ ...f, ...next }))
  }, [])

  // Debounce the search box so typing a booking ref does not fire a query per key.
  useEffect(() => {
    const t = setTimeout(() => patch({ search: searchDraft.trim() }), 350)
    return () => clearTimeout(t)
  }, [searchDraft, patch])

  const query = useMemo(() => buildQuery(filters), [filters])

  const load = useCallback(async (silent = false) => {
    if (silent) setRefreshing(true); else setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/daily-update?${query}`, { cache: 'no-store' })
      const json = await res.json()
      if (!res.ok || !json.success) throw new Error(json.error ?? 'Failed to load the sheet')
      setRows(json.data.rows)
      setAgents(json.data.agents)
      setStats(json.data.stats)
      setRange(json.data.range)
      setCanEdit(Boolean(json.data.canEdit))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load the sheet')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [query])

  useEffect(() => { void load() }, [load])

  /**
   * Downloads go through fetch rather than a plain link so a 403 or a render
   * failure surfaces as a toast instead of a browser tab full of JSON.
   */
  const download = useCallback(async (kind: 'xlsx' | 'pdf') => {
    setDownloading(kind)
    try {
      const url = kind === 'xlsx'
        ? `/api/daily-update/export?${query}`
        : `/api/daily-update/export-pdf?${query}`
      const res = await fetch(url, { cache: 'no-store' })
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        throw new Error(json?.error ?? `Export failed (${res.status})`)
      }
      const blob = await res.blob()
      const href = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = href
      a.download = `daily-update-${new Date().toISOString().slice(0, 10)}.${kind}`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(href)
      toast.success(kind === 'xlsx' ? 'Excel sheet downloaded' : 'PDF sheet downloaded')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Export failed')
    } finally {
      setDownloading(null)
    }
  }, [query])

  const applyEdit = useCallback((id: string, field: 'isNumber' | 'cntlNumber', next: string | null) => {
    setRows(rs => rs.map(r => (r.id === id ? { ...r, [field]: next } : r)))
    setStats(s => (s ? { ...s, missingIds: Math.max(0, s.missingIds - 1) } : s))
  }, [])

  const visible = useMemo(
    () => (onlyMissing ? rows.filter(r => !r.isNumber || !r.cntlNumber) : rows),
    [rows, onlyMissing],
  )

  // Today's intake sits in its own band above the travel window — that split is
  // the whole shape of a morning update, so it is rendered, not just sorted.
  const todaysRows  = useMemo(() => visible.filter(r => r.createdToday), [visible])
  const windowRows  = useMemo(() => visible.filter(r => !r.createdToday), [visible])
  // Mirrors `pinsToday` on the server: an explicit from/to range asks for that
  // span and nothing else, so today's intake is not carried on top of it.
  const splitToday  = filters.includeToday && !filters.from && !filters.to && todaysRows.length > 0

  const activeField = DATE_FIELDS.find(f => f.value === filters.dateField) ?? DATE_FIELDS[0]
  const usingCustomRange = Boolean(filters.from || filters.to)
  const isDefaultView =
    JSON.stringify({ ...filters, search: '' }) === JSON.stringify({ ...DEFAULT_FILTERS, search: '' }) && !onlyMissing

  return (
    <div className="space-y-5">
      {/* ── Summary tiles ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <Tile
          label="On the sheet" value={stats?.total ?? 0} icon={CalendarRange}
          gradient="bg-gradient-to-br from-slate-700 to-slate-900"
          hint="Bookings matching the current window and filters"
        />
        <Tile
          label="Booked today" value={stats?.createdToday ?? 0} icon={Sparkles}
          gradient="bg-gradient-to-br from-emerald-500 to-green-600"
          hint="Created today — pinned to the top of the sheet"
        />
        <Tile
          label="Arriving today" value={stats?.arrivingToday ?? 0} icon={PlaneLanding}
          gradient="bg-gradient-to-br from-rose-500 to-red-600"
          hint="Guests landing today"
        />
        <Tile
          label="On the ground" value={stats?.onGround ?? 0} icon={Building2}
          gradient="bg-gradient-to-br from-cyan-500 to-sky-600"
          hint="Already arrived and not yet departed"
        />
        <Tile
          label="Total pax" value={stats?.totalPax ?? 0} icon={Users}
          gradient="bg-gradient-to-br from-violet-500 to-purple-600"
        />
        <Tile
          label="Missing IS / CNTL" value={stats?.missingIds ?? 0} icon={AlertTriangle}
          gradient="bg-gradient-to-br from-amber-400 to-orange-500"
          active={onlyMissing}
          onClick={() => setOnlyMissing(v => !v)}
          hint="Click to show only files with a blank IS or CNTL number"
        />
      </div>

      {/* ── Filter bar ────────────────────────────────────────────────────── */}
      <Card className="overflow-hidden">
        <div className="border-b border-slate-100 bg-gradient-to-r from-slate-50 to-white px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            {/* Which date the window is measured against */}
            <div className="inline-flex rounded-xl bg-slate-100 p-0.5">
              {DATE_FIELDS.map(f => {
                const Icon = f.icon
                return (
                  <button
                    key={f.value}
                    type="button"
                    onClick={() => patch({ dateField: f.value, sortBy: f.value })}
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-all',
                      filters.dateField === f.value
                        ? 'bg-white text-slate-900 shadow-sm'
                        : 'text-slate-500 hover:text-slate-700',
                    )}
                    title={`Filter by ${f.label.toLowerCase()}`}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">{f.short}</span>
                  </button>
                )
              })}
            </div>

            {/* Day window */}
            <div className="inline-flex rounded-xl bg-slate-100 p-0.5">
              {DAY_PRESETS.map(p => (
                <button
                  key={p.days}
                  type="button"
                  onClick={() => patch({ days: p.days, from: '', to: '' })}
                  className={cn(
                    'rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-all',
                    !usingCustomRange && filters.days === p.days
                      ? 'bg-slate-900 text-white shadow-sm'
                      : 'text-slate-500 hover:text-slate-700',
                  )}
                >
                  {p.label}
                </button>
              ))}
            </div>

            {/* Search */}
            <div className="relative min-w-[200px] flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 w-4 h-4 -translate-y-1/2 text-slate-400" />
              <input
                value={searchDraft}
                onChange={e => setSearchDraft(e.target.value)}
                placeholder="Ref, IS, CNTL, guest, agent, phone…"
                className="w-full rounded-xl border border-slate-200 bg-white py-2 pl-9 pr-8 text-sm placeholder:text-slate-400 focus:border-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900/10"
              />
              {searchDraft && (
                <button
                  type="button"
                  onClick={() => setSearchDraft('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:bg-slate-100"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            <button
              type="button"
              onClick={() => setShowAdvanced(v => !v)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-semibold transition-colors',
                showAdvanced || filters.agent || filters.country || usingCustomRange
                  ? 'border-slate-900 bg-slate-900 text-white'
                  : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50',
              )}
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
              Filters
              <ChevronDown className={cn('w-3.5 h-3.5 transition-transform', showAdvanced && 'rotate-180')} />
            </button>

            <button
              type="button"
              onClick={() => void load(true)}
              disabled={refreshing}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
            >
              <RefreshCw className={cn('w-3.5 h-3.5', refreshing && 'animate-spin')} />
              <span className="hidden sm:inline">Refresh</span>
            </button>

            <div className="inline-flex overflow-hidden rounded-xl shadow-sm">
              <button
                type="button"
                onClick={() => void download('xlsx')}
                disabled={downloading !== null}
                className="inline-flex items-center gap-1.5 bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
              >
                {downloading === 'xlsx'
                  ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  : <FileSpreadsheet className="w-3.5 h-3.5" />}
                Excel
              </button>
              <button
                type="button"
                onClick={() => void download('pdf')}
                disabled={downloading !== null}
                className="inline-flex items-center gap-1.5 bg-rose-600 px-3 py-2 text-xs font-semibold text-white hover:bg-rose-700 disabled:opacity-60"
              >
                {downloading === 'pdf'
                  ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  : <FileText className="w-3.5 h-3.5" />}
                PDF
              </button>
            </div>
          </div>

          {showAdvanced && (
            <div className="mt-3 grid gap-3 border-t border-slate-100 pt-3 sm:grid-cols-2 xl:grid-cols-4">
              {/* Agent */}
              <label className="block">
                <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Agent</span>
                <select
                  value={filters.agent}
                  onChange={e => patch({ agent: e.target.value })}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus:border-slate-900 focus:outline-none"
                >
                  <option value="">All agents</option>
                  {agents.map(a => (
                    <option key={a.name} value={a.name}>{a.name} ({a.count})</option>
                  ))}
                </select>
              </label>

              {/* Country — only the two admin roles may cross countries; everyone
                  else is already scoped server-side, so the control is hidden. */}
              {canFilter && (
                <label className="block">
                  <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Country</span>
                  <select
                    value={filters.country}
                    onChange={e => patch({ country: e.target.value })}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus:border-slate-900 focus:outline-none"
                  >
                    {COUNTRIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                  </select>
                </label>
              )}

              {/* Explicit range */}
              <label className="block">
                <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  {activeField.short} from
                </span>
                <input
                  type="date"
                  value={filters.from}
                  onChange={e => patch({ from: e.target.value })}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus:border-slate-900 focus:outline-none"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  {activeField.short} to
                </span>
                <input
                  type="date"
                  value={filters.to}
                  onChange={e => patch({ to: e.target.value })}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus:border-slate-900 focus:outline-none"
                />
              </label>

              <div className="flex flex-wrap items-center gap-4 sm:col-span-2 xl:col-span-4">
                <label className="inline-flex cursor-pointer items-center gap-2 text-xs font-medium text-slate-600">
                  <input
                    type="checkbox"
                    checked={filters.includeToday}
                    onChange={e => patch({ includeToday: e.target.checked })}
                    className="rounded border-slate-300 text-slate-900 focus:ring-slate-900"
                  />
                  Pin bookings created today to the top
                </label>
                <label className="inline-flex cursor-pointer items-center gap-2 text-xs font-medium text-slate-600">
                  <input
                    type="checkbox"
                    checked={filters.includeCancelled}
                    onChange={e => patch({ includeCancelled: e.target.checked })}
                    className="rounded border-slate-300 text-slate-900 focus:ring-slate-900"
                  />
                  Include cancelled bookings
                </label>
                <button
                  type="button"
                  onClick={() => { setFilters(DEFAULT_FILTERS); setSearchDraft(''); setOnlyMissing(false) }}
                  disabled={isDefaultView}
                  className="ml-auto inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-semibold text-slate-500 hover:bg-slate-100 disabled:opacity-40"
                >
                  <X className="w-3.5 h-3.5" /> Reset to default view
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Context line — what this sheet currently covers */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 bg-white px-4 py-2 text-[11px] text-slate-500">
          <span className="inline-flex items-center gap-1.5 font-semibold text-slate-700">
            <CalendarDays className="w-3.5 h-3.5" />
            {activeField.label}
          </span>
          {range && (
            <span>{formatDate(range.start)} → {formatDate(range.end)}</span>
          )}
          {filters.agent && (
            <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 font-medium text-slate-700">
              {filters.agent}
              <button type="button" onClick={() => patch({ agent: '' })}><X className="w-3 h-3" /></button>
            </span>
          )}
          {filters.country && (
            <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 font-medium text-slate-700">
              <Globe className="w-3 h-3" /> {filters.country.replace('_', ' & ')}
              <button type="button" onClick={() => patch({ country: '' })}><X className="w-3 h-3" /></button>
            </span>
          )}
          {onlyMissing && (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 font-medium text-amber-700">
              Missing IS / CNTL only
              <button type="button" onClick={() => setOnlyMissing(false)}><X className="w-3 h-3" /></button>
            </span>
          )}
          <span className="ml-auto">{visible.length} row{visible.length === 1 ? '' : 's'}</span>
        </div>
      </Card>

      {/* ── The sheet ─────────────────────────────────────────────────────── */}
      <Card className="overflow-hidden">
        {loading ? (
          <div className="flex flex-col items-center justify-center gap-3 py-20 text-slate-400">
            <Loader2 className="w-6 h-6 animate-spin" />
            <p className="text-sm">Building today&apos;s sheet…</p>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center gap-3 py-20">
            <AlertTriangle className="w-8 h-8 text-amber-500" />
            <p className="text-sm text-slate-600">{error}</p>
            <button
              type="button"
              onClick={() => void load()}
              className="rounded-xl bg-slate-900 px-4 py-2 text-xs font-semibold text-white"
            >
              Try again
            </button>
          </div>
        ) : visible.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-20 text-center">
            <CalendarRange className="w-10 h-10 text-slate-200" />
            <p className="text-sm font-semibold text-slate-600">Nothing on the sheet</p>
            <p className="max-w-sm text-xs text-slate-400">
              No bookings fall inside this window. Widen the day range, switch the date the window is measured
              against, or clear the filters.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1180px] border-collapse text-sm">
              <thead className="sticky top-0 z-10">
                <tr className="bg-slate-900 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-300">
                  <th className="px-3 py-2.5 w-10">#</th>
                  <th className="px-3 py-2.5">Booking</th>
                  <th className="px-3 py-2.5">IS number</th>
                  <th className="px-3 py-2.5">CNTL number</th>
                  <th className="px-3 py-2.5">
                    <button
                      type="button"
                      onClick={() => patch({ sortDir: filters.sortDir === 'asc' ? 'desc' : 'asc' })}
                      className="inline-flex items-center gap-1 hover:text-white"
                    >
                      Travel dates <ArrowUpDown className="w-3 h-3" />
                    </button>
                  </th>
                  <th className="px-3 py-2.5">Guest</th>
                  <th className="px-3 py-2.5">Guest contact</th>
                  <th className="px-3 py-2.5">Agent</th>
                  <th className="px-3 py-2.5">Agent contact</th>
                  <th className="px-3 py-2.5">Created / Updated</th>
                </tr>
              </thead>

              {splitToday && (
                <SheetSection
                  title={`Booked today — ${todaysRows.length} new file${todaysRows.length === 1 ? '' : 's'}`}
                  tone="emerald"
                  rows={todaysRows}
                  offset={0}
                  canEdit={canEdit}
                  onEdit={applyEdit}
                />
              )}
              {windowRows.length > 0 && (
                <SheetSection
                  title={splitToday
                    ? `${activeField.label} — ${range ? `${formatDate(range.start)} to ${formatDate(range.end)}` : 'window'}`
                    : null}
                  tone="slate"
                  rows={windowRows}
                  offset={splitToday ? todaysRows.length : 0}
                  canEdit={canEdit}
                  onEdit={applyEdit}
                />
              )}
            </table>
          </div>
        )}
      </Card>

      <p className="px-1 text-[11px] text-slate-400">
        Contains guest and agent contact details — internal use only. Downloads carry exactly the rows and order
        shown above.
        {session?.user?.name ? ` Viewed by ${session.user.name}.` : ''}
      </p>
    </div>
  )
}

// ─── One banded group of rows ─────────────────────────────────────────────────

function SheetSection({
  title, tone, rows, offset, canEdit, onEdit,
}: {
  title: string | null
  tone: 'emerald' | 'slate'
  rows: Row[]
  offset: number
  canEdit: boolean
  onEdit: (id: string, field: 'isNumber' | 'cntlNumber', next: string | null) => void
}) {
  return (
    <tbody className="divide-y divide-slate-100">
      {title && (
        <tr>
          <td colSpan={10} className="p-0">
            <div
              className={cn(
                'flex items-center gap-2 px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-white',
                tone === 'emerald'
                  ? 'bg-gradient-to-r from-emerald-600 to-green-500'
                  : 'bg-gradient-to-r from-slate-700 to-slate-500',
              )}
            >
              {tone === 'emerald' ? <Sparkles className="w-3 h-3" /> : <CalendarRange className="w-3 h-3" />}
              {title}
            </div>
          </td>
        </tr>
      )}
      {rows.map((r, i) => (
        <tr
          key={r.id}
          className={cn(
            'group transition-colors hover:bg-slate-50',
            r.cancelled && 'bg-red-50/40',
            r.createdToday && !r.cancelled && 'bg-emerald-50/30',
          )}
        >
          <td className="relative px-3 py-2.5 align-top text-xs text-slate-400 tabular-nums">
            <span className={cn('absolute inset-y-0 left-0 w-1', accentTone(r))} />
            {offset + i + 1}
          </td>

          {/* Booking */}
          <td className="px-3 py-2.5 align-top">
            <a
              href={`/dashboard/bookings/${encodeURIComponent(r.bookingRef)}`}
              className={cn(
                'font-mono text-xs font-bold hover:underline',
                r.cancelled ? 'text-red-700 line-through' : 'text-slate-900',
              )}
            >
              {r.bookingRef}
            </a>
            <div className="mt-1 flex flex-wrap items-center gap-1">
              {r.operationCountry && (
                <span className="inline-flex items-center" title={r.operationCountry}>
                  <CountryFlag country={r.operationCountry} className="w-4 h-3 rounded-[1px]" />
                </span>
              )}
              <StatusBadge status={r.status as BookingStatus} className="scale-90 origin-left" />
            </div>
            <div className="mt-1 flex flex-wrap gap-1">
              {r.createdToday && !r.cancelled && (
                <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[9px] font-bold uppercase text-emerald-700">New today</span>
              )}
              {r.amended && !r.createdToday && (
                <span className="rounded bg-violet-100 px-1.5 py-0.5 text-[9px] font-bold uppercase text-violet-700">Amended</span>
              )}
              {r.hotelOnly && (
                <span className="rounded bg-sky-100 px-1.5 py-0.5 text-[9px] font-bold uppercase text-sky-700">Hotel only</span>
              )}
              {r.cancelled && (
                <span className="inline-flex items-center gap-0.5 rounded bg-red-100 px-1.5 py-0.5 text-[9px] font-bold uppercase text-red-700">
                  <Ban className="w-2.5 h-2.5" /> Cancelled
                </span>
              )}
            </div>
          </td>

          {/* IS + CNTL — editable in place when they are blank */}
          <td className="px-3 py-2.5 align-top">
            <IdCell
              value={r.isNumber} field="isNumber" bookingRef={r.bookingRef} canEdit={canEdit}
              onSaved={next => onEdit(r.id, 'isNumber', next)}
            />
          </td>
          <td className="px-3 py-2.5 align-top">
            <IdCell
              value={r.cntlNumber} field="cntlNumber" bookingRef={r.bookingRef} canEdit={canEdit}
              onSaved={next => onEdit(r.id, 'cntlNumber', next)}
            />
            {r.agentBookingId && (
              <div className="mt-0.5 text-[10px] text-slate-400">Agent ID {r.agentBookingId}</div>
            )}
          </td>

          {/* Travel window */}
          <td className="px-3 py-2.5 align-top">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-900">
              <PlaneLanding className="w-3 h-3 text-slate-400" />
              {formatDate(r.arrivalDate)}
            </div>
            <div className="mt-0.5 flex items-center gap-1.5 text-xs text-slate-500">
              <Plane className="w-3 h-3 text-slate-300" />
              {formatDate(r.departureDate)}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-1">
              <span className={cn('rounded-full px-1.5 py-0.5 text-[10px] font-bold ring-1', whenTone(r.daysToArrival))}>
                {whenLabel(r.daysToArrival)}
              </span>
              <span className="text-[10px] text-slate-400">
                {r.nights}N · {r.totalPax} pax
              </span>
            </div>
          </td>

          {/* Guest */}
          <td className="px-3 py-2.5 align-top">
            <p className="text-xs font-semibold text-slate-900">{r.guestName ?? '—'}</p>
            <p className="mt-0.5 text-[10px] text-slate-400">
              {r.paxAdults}A · {r.paxChildren}C · {r.paxInfants}I
            </p>
            {r.fileHandler && (
              <p className="mt-0.5 text-[10px] text-slate-400">Handler: {r.fileHandler}</p>
            )}
          </td>
          <td className="px-3 py-2.5 align-top">
            <Contact phone={r.guestPhone} whatsapp={r.guestWhatsapp} email={r.guestEmail} />
          </td>

          {/* Agent */}
          <td className="px-3 py-2.5 align-top">
            <p className="text-xs font-semibold text-slate-900">{r.agent ?? '—'}</p>
          </td>
          <td className="px-3 py-2.5 align-top">
            <Contact phone={r.agentPhone} whatsapp={r.agentWhatsapp} email={r.agentEmail} />
          </td>

          {/* Audit dates */}
          <td className="px-3 py-2.5 align-top">
            <p className="text-[10px] text-slate-500">Created {formatDateTime(r.createdAt)}</p>
            <p className="mt-0.5 text-[10px] text-slate-400">Updated {formatDateTime(r.updatedAt)}</p>
          </td>
        </tr>
      ))}
    </tbody>
  )
}
