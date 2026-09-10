'use client'

/**
 * Activity Check.
 *
 * Every other search in this system starts from a booking. This one starts from
 * the activity: type "Ba Na Hills", pick a date window, and get back every file
 * touching it — from the movement chart where the agenda exists, and from the
 * sold itinerary where it does not.
 *
 * Four views over one result set, because the same search answers four
 * different questions: a day-by-day roster, a flat sheet, one card per file,
 * and the numbers underneath. Whatever is on screen is what the Excel and PDF
 * downloads contain — they re-run this exact query server-side.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import {
  Search, X, Loader2, RefreshCw, Sparkles, Compass, SlidersHorizontal,
  CalendarDays, CalendarRange, Users, MapPin, FileSpreadsheet, FileText, Printer,
  Columns3, ChevronDown, ChevronRight, ExternalLink, Car, UserCheck, Store,
  AlertTriangle, Clock, Ban, Layers, Table2, LayoutList, BarChart3, Building2,
  Plane, CheckCircle2, CircleSlash, Wand2, Phone, Mail, ArrowUpDown, Info,
} from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { Card } from '@/components/ui/card'
import { useCountryFilter } from '@/hooks/use-country-filter'
import { SERVICE_TYPE_VALUES, SERVICE_TYPE_LABELS } from '@/lib/service-types'
import {
  ACTIVITY_FIELDS, ACTIVITY_FIELD_LABELS, RANGE_PRESET_LABELS,
  type ActivityField, type RangePreset,
} from '@/lib/activity-check'
import {
  DEFAULT_COLUMNS, COLUMNS, type ColumnKey,
} from '@/lib/activity-check-columns'
import ColumnPicker from '@/components/activity-check/column-picker'
import ActivityExplorer from '@/components/activity-check/activity-explorer'

// ─── Types (mirrors of the server payload) ────────────────────────────────────

type Counterpart = { source: 'AGENDA' | 'ITINERARY'; activity: string; details: string | null; dayNo: number | null }

type Row = {
  id: string
  source: 'AGENDA' | 'ITINERARY'
  bookingId: string
  bookingRef: string
  isNumber: string | null
  cntlNumber: string | null
  agentBookingId: string | null
  agent: string | null
  fileHandler: string | null
  operationCountry: string | null
  status: string
  cancelled: boolean
  hotelOnly: boolean
  arrivalDate: string
  departureDate: string
  date: string
  dayNo: number | null
  weekday: string
  daysAway: number
  activity: string
  location: string | null
  fromPoint: string | null
  toPoint: string | null
  details: string | null
  serviceType: string | null
  serviceTypeLabel: string | null
  meetingTime: string | null
  timeFrom: string | null
  timeTo: string | null
  mealPlan: string | null
  isLeisure: boolean | null
  isHotelOnly: boolean | null
  driverName: string | null
  driverPhone: string | null
  vehicleType: string | null
  vehiclePlate: string | null
  vendorName: string | null
  guideName: string | null
  guidePhone: string | null
  tourVendorName: string | null
  tourVendorPhone: string | null
  assigned: boolean
  guestName: string | null
  guestPhone: string | null
  guestEmail: string | null
  guestWhatsapp: string | null
  paxAdults: number
  paxChildren: number
  paxInfants: number
  totalPax: number
  matchedTerms: string[]
  matchedFields: ActivityField[]
  snippet: string
  score: number
  counterpart: Counterpart | null
}

type Bucket = { key: string; label: string; count: number; bookings: number; pax: number }
type DayBucket = Bucket & { date: string; weekday: string }
type TermBucket = Bucket & { firstDate: string | null; lastDate: string | null; variants: number }

type Stats = {
  activities: number; bookings: number; pax: number
  fromAgenda: number; fromItinerary: number
  unassigned: number; cancelled: number
  past: number; today: number; upcoming: number
  distinctAgents: number
  byTerm: TermBucket[]; byDay: DayBucket[]
  byLocation: Bucket[]; byServiceType: Bucket[]; byAgent: Bucket[]; byVendor: Bucket[]; byActivity: Bucket[]
}

type Payload = {
  rows: Row[]
  agents: { name: string; count: number }[]
  stats: Stats
  range: { start: string; end: string }
  truncated: boolean
  scanned: number
  generatedAt: string
}

type ViewMode = 'timeline' | 'table' | 'bookings' | 'insights'

// ─── Filters ──────────────────────────────────────────────────────────────────

type Filters = {
  terms: string[]
  matchMode: 'any' | 'all'
  fuzzy: boolean
  fields: ActivityField[]
  preset: RangePreset
  from: string
  to: string
  source: 'BOTH' | 'AGENDA' | 'ITINERARY'
  serviceTypes: string[]
  agent: string
  booking: string
  includeCancelled: boolean
  unassignedOnly: boolean
  sortBy: 'date' | 'booking' | 'activity' | 'location' | 'relevance'
  sortDir: 'asc' | 'desc'
}

const DEFAULT_FILTERS: Filters = {
  terms: [],
  matchMode: 'any',
  fuzzy: true,
  fields: [...ACTIVITY_FIELDS],
  // The desk's most common question is about the week ahead, and it is the
  // cheapest window to open the page on.
  preset: 'next7',
  from: '',
  to: '',
  source: 'BOTH',
  serviceTypes: [],
  agent: '',
  booking: '',
  includeCancelled: false,
  unassignedOnly: false,
  sortBy: 'date',
  sortDir: 'asc',
}

const PRESET_ORDER: RangePreset[] = [
  'today', 'tomorrow', 'thisWeek', 'lastWeek', 'nextWeek',
  'next7', 'next14', 'next30', 'last30', 'thisMonth', 'lastMonth', 'nextMonth', 'custom',
]

const COLUMNS_STORAGE_KEY = 'ah_activity_check_columns'

const fmtDate = (iso: string | null, opts?: Intl.DateTimeFormatOptions) =>
  iso ? new Date(iso).toLocaleDateString('en-GB', opts ?? { day: '2-digit', month: 'short', year: 'numeric' }) : '—'

function whenLabel(days: number): string {
  if (days === 0) return 'Today'
  if (days === 1) return 'Tomorrow'
  if (days === -1) return 'Yesterday'
  return days > 0 ? `in ${days}d` : `${Math.abs(days)}d ago`
}

function whenTone(days: number): string {
  if (days < 0) return 'bg-slate-100 text-slate-500'
  if (days === 0) return 'bg-red-100 text-red-700'
  if (days <= 2) return 'bg-orange-100 text-orange-700'
  if (days <= 7) return 'bg-brand-100 text-brand-700'
  return 'bg-slate-100 text-slate-600'
}

/**
 * Marks the searched words inside a piece of text.
 *
 * The server matches on a diacritic-folded, punctuation-stripped string that
 * has no index correspondence to what is displayed, so the highlight is done
 * here on the raw text, word by word. Accents are the known gap — "Đà Nẵng"
 * matches but highlights only where it was typed with them.
 */
function Highlight({ text, terms }: { text: string; terms: string[] }) {
  const words = useMemo(() => Array.from(new Set(
    terms.flatMap(t => t.split(/\s+/))
      .map(w => w.replace(/[^0-9A-Za-zÀ-ɏḀ-ỿ]/g, ''))
      .filter(w => w.length >= 3),
  )).sort((a, b) => b.length - a.length), [terms])

  if (!words.length || !text) return <>{text}</>

  const re = new RegExp(`(${words.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi')
  return (
    <>
      {text.split(re).map((part, i) =>
        re.test(part) && words.some(w => w.toLowerCase() === part.toLowerCase())
          ? <mark key={i} className="bg-brand-200/70 text-brand-900 rounded px-0.5">{part}</mark>
          : <span key={i}>{part}</span>,
      )}
    </>
  )
}

// ─── The board ────────────────────────────────────────────────────────────────

export default function ActivityCheckBoard() {
  const { countryParam } = useCountryFilter()

  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS)
  const [draft, setDraft] = useState('')
  const [data, setData] = useState<Payload | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [view, setView] = useState<ViewMode>('timeline')
  const [showFilters, setShowFilters] = useState(false)
  const [showColumns, setShowColumns] = useState(false)
  const [showExplorer, setShowExplorer] = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [exporting, setExporting] = useState<string | null>(null)
  const [columns, setColumns] = useState<ColumnKey[]>(DEFAULT_COLUMNS)

  const inputRef = useRef<HTMLInputElement>(null)

  // The column choice is a per-user working preference, not shared state, so it
  // lives in the browser rather than on the server.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(COLUMNS_STORAGE_KEY)
      if (!raw) return
      const parsed = JSON.parse(raw) as ColumnKey[]
      const valid = parsed.filter(k => COLUMNS.some(c => c.key === k))
      if (valid.length) setColumns(valid)
    } catch { /* a corrupt preference is not worth a broken page */ }
  }, [])

  useEffect(() => {
    try { localStorage.setItem(COLUMNS_STORAGE_KEY, JSON.stringify(columns)) } catch { /* private mode */ }
  }, [columns])

  const update = useCallback(<K extends keyof Filters>(key: K, value: Filters[K]) => {
    setFilters(f => ({ ...f, [key]: value }))
  }, [])

  /** The query string the screen and every download share. */
  const queryString = useMemo(() => {
    const sp = new URLSearchParams()
    if (filters.terms.length) sp.set('terms', filters.terms.map(t => (t.includes(',') ? `"${t}"` : t)).join(','))
    sp.set('matchMode', filters.matchMode)
    if (!filters.fuzzy) sp.set('fuzzy', '0')
    if (filters.fields.length !== ACTIVITY_FIELDS.length) sp.set('fields', filters.fields.join(','))
    if (filters.preset === 'custom') {
      if (filters.from) sp.set('from', filters.from)
      if (filters.to) sp.set('to', filters.to)
    } else {
      sp.set('preset', filters.preset)
    }
    if (filters.source !== 'BOTH') sp.set('source', filters.source)
    if (filters.serviceTypes.length) sp.set('serviceTypes', filters.serviceTypes.join(','))
    if (filters.agent) sp.set('agent', filters.agent)
    if (filters.booking) sp.set('booking', filters.booking)
    if (filters.includeCancelled) sp.set('includeCancelled', '1')
    if (filters.unassignedOnly) sp.set('unassignedOnly', '1')
    sp.set('sortBy', filters.sortBy)
    sp.set('sortDir', filters.sortDir)
    if (countryParam) sp.set('country', countryParam)
    return sp.toString()
  }, [filters, countryParam])

  const exportQuery = useMemo(
    () => `${queryString}&cols=${columns.join(',')}`,
    [queryString, columns],
  )

  const load = useCallback(async (qs: string) => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/activity-check?${qs}`)
      const json = await res.json()
      if (!json.success) throw new Error(json.error ?? 'Search failed')
      setData(json.data as Payload)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Search failed')
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [])

  // Debounced so typing a booking filter does not fire a query per keystroke.
  useEffect(() => {
    const t = setTimeout(() => void load(queryString), 250)
    return () => clearTimeout(t)
  }, [queryString, load])

  // ── Keyword chips ──────────────────────────────────────────────────────────

  const addTerm = useCallback((raw: string) => {
    const value = raw.trim().replace(/,$/, '')
    if (!value) return
    setFilters(f => (
      f.terms.some(t => t.toLowerCase() === value.toLowerCase())
        ? f
        : { ...f, terms: [...f.terms, value] }
    ))
    setDraft('')
  }, [])

  const removeTerm = useCallback((term: string) => {
    setFilters(f => ({ ...f, terms: f.terms.filter(t => t !== term) }))
  }, [])

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',' || e.key === 'Tab') {
      if (draft.trim()) {
        e.preventDefault()
        addTerm(draft)
      }
    } else if (e.key === 'Backspace' && !draft && filters.terms.length) {
      // Backspace on an empty box removes the last chip — the behaviour every
      // other tag input has, and the one hands reach for.
      removeTerm(filters.terms[filters.terms.length - 1])
    }
  }

  // ── Exports ────────────────────────────────────────────────────────────────

  const download = useCallback(async (kind: 'xlsx' | 'pdf' | 'html') => {
    setExporting(kind)
    const path = kind === 'xlsx' ? 'export' : kind === 'pdf' ? 'export-pdf' : 'export-html'
    try {
      if (kind === 'html') {
        // The HTML report is meant to be *read* and printed, so it opens in a
        // tab rather than landing in the downloads folder.
        window.open(`/api/activity-check/${path}?${exportQuery}`, '_blank', 'noopener')
        return
      }
      const res = await fetch(`/api/activity-check/${path}?${exportQuery}`)
      if (!res.ok) {
        const json = await res.json().catch(() => null)
        throw new Error(json?.error ?? `Export failed (${res.status})`)
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `activity-check-${new Date().toISOString().slice(0, 10)}.${kind}`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      toast.success(kind === 'xlsx' ? 'Excel file downloaded' : 'PDF downloaded')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Export failed')
    } finally {
      setExporting(null)
    }
  }, [exportQuery])

  // ── Derived groupings ──────────────────────────────────────────────────────

  const rows = data?.rows ?? []
  const stats = data?.stats

  const byDay = useMemo(() => {
    const map = new Map<string, Row[]>()
    for (const r of rows) {
      const key = r.date.slice(0, 10)
      const list = map.get(key)
      if (list) list.push(r)
      else map.set(key, [r])
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]))
  }, [rows])

  const byBooking = useMemo(() => {
    const map = new Map<string, Row[]>()
    for (const r of rows) {
      const list = map.get(r.bookingRef)
      if (list) list.push(r)
      else map.set(r.bookingRef, [r])
    }
    return Array.from(map.entries()).sort((a, b) => a[1][0].date.localeCompare(b[1][0].date))
  }, [rows])

  const toggleExpand = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const activeFilterCount = [
    filters.source !== 'BOTH',
    filters.serviceTypes.length > 0,
    Boolean(filters.agent),
    Boolean(filters.booking),
    filters.includeCancelled,
    filters.unassignedOnly,
    filters.fields.length !== ACTIVITY_FIELDS.length,
    !filters.fuzzy,
  ].filter(Boolean).length

  return (
    <div className="space-y-4">
      {/* ── Search ─────────────────────────────────────────────────────────── */}
      <Card className="p-4 sm:p-5">
        <div className="flex flex-col lg:flex-row gap-3">
          <div className="flex-1 min-w-0">
            <label className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1.5 block">
              Activities &amp; keywords
            </label>
            <div
              onClick={() => inputRef.current?.focus()}
              className="min-h-[46px] flex flex-wrap items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 bg-white focus-within:border-brand-400 focus-within:ring-2 focus-within:ring-brand-100 cursor-text transition-colors"
            >
              <Search className="w-4 h-4 text-slate-400 flex-shrink-0" />
              {filters.terms.map(term => {
                const hits = stats?.byTerm.find(b => b.key === term)
                return (
                  <span
                    key={term}
                    className={cn(
                      'inline-flex items-center gap-1.5 pl-2.5 pr-1 py-1 rounded-full text-xs font-semibold border',
                      hits && hits.count === 0
                        ? 'bg-slate-50 border-slate-200 text-slate-400'
                        : 'bg-brand-50 border-brand-200 text-brand-800',
                    )}
                  >
                    {term}
                    {hits && (
                      <span className={cn(
                        'px-1.5 rounded-full text-[10px] font-bold',
                        hits.count === 0 ? 'bg-slate-200 text-slate-500' : 'bg-brand-500 text-white',
                      )}>
                        {hits.count}
                      </span>
                    )}
                    <button
                      onClick={e => { e.stopPropagation(); removeTerm(term) }}
                      className="p-0.5 rounded-full hover:bg-brand-200/60"
                      aria-label={`Remove ${term}`}
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                )
              })}
              <input
                ref={inputRef}
                value={draft}
                onChange={e => setDraft(e.target.value)}
                onKeyDown={onKeyDown}
                onBlur={() => draft.trim() && addTerm(draft)}
                placeholder={filters.terms.length ? 'Add another…' : 'Ba Na Hills, Ha Long cruise, Ninh Binh…'}
                className="flex-1 min-w-[180px] text-sm bg-transparent outline-none placeholder:text-slate-400 py-1"
              />
              {loading && <Loader2 className="w-4 h-4 text-brand-500 animate-spin flex-shrink-0" />}
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-3 text-[11px] text-slate-400">
              <span>Press Enter or comma to add. Quote a phrase with commas in it.</span>
              {filters.terms.length > 1 && (
                <div className="inline-flex items-center gap-1 bg-slate-100 rounded-lg p-0.5">
                  {(['any', 'all'] as const).map(m => (
                    <button
                      key={m}
                      onClick={() => update('matchMode', m)}
                      className={cn(
                        'px-2 py-0.5 rounded-md font-semibold transition-colors',
                        filters.matchMode === m ? 'bg-white text-brand-700 shadow-sm' : 'text-slate-500',
                      )}
                    >
                      {m === 'any' ? 'Match ANY' : 'Match ALL'}
                    </button>
                  ))}
                </div>
              )}
              <button
                onClick={() => update('fuzzy', !filters.fuzzy)}
                className={cn(
                  'inline-flex items-center gap-1 px-2 py-0.5 rounded-lg font-semibold transition-colors',
                  filters.fuzzy ? 'bg-violet-50 text-violet-700' : 'bg-slate-100 text-slate-500',
                )}
                title="Tolerates typos and missing spaces — “Bana hils” still finds “Ba Na Hills”"
              >
                <Wand2 className="w-3 h-3" /> {filters.fuzzy ? 'Typo-tolerant' : 'Exact only'}
              </button>
            </div>
          </div>

          <div className="flex flex-col gap-2 lg:w-auto lg:pt-6">
            <div className="flex gap-2">
              <button
                onClick={() => setShowExplorer(true)}
                className="flex-1 lg:flex-none inline-flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl border border-slate-200 text-sm font-semibold text-slate-600 hover:border-brand-300 hover:text-brand-700 transition-colors"
              >
                <Compass className="w-4 h-4" /> Explore
              </button>
              <button
                onClick={() => setShowFilters(s => !s)}
                className={cn(
                  'flex-1 lg:flex-none inline-flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl border text-sm font-semibold transition-colors',
                  showFilters || activeFilterCount
                    ? 'border-brand-300 bg-brand-50 text-brand-700'
                    : 'border-slate-200 text-slate-600 hover:border-brand-300',
                )}
              >
                <SlidersHorizontal className="w-4 h-4" /> Filters
                {activeFilterCount > 0 && (
                  <span className="px-1.5 rounded-full bg-brand-500 text-white text-[10px] font-bold">
                    {activeFilterCount}
                  </span>
                )}
              </button>
              <button
                onClick={() => void load(queryString)}
                className="px-3 py-2.5 rounded-xl border border-slate-200 text-slate-500 hover:text-brand-600 hover:border-brand-300 transition-colors"
                aria-label="Refresh"
              >
                <RefreshCw className={cn('w-4 h-4', loading && 'animate-spin')} />
              </button>
            </div>
          </div>
        </div>

        {/* ── Date window ──────────────────────────────────────────────────── */}
        <div className="mt-4 pt-4 border-t border-slate-100">
          <div className="flex flex-wrap items-center gap-1.5">
            <CalendarRange className="w-4 h-4 text-slate-400 mr-1" />
            {PRESET_ORDER.map(p => (
              <button
                key={p}
                onClick={() => update('preset', p)}
                className={cn(
                  'px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors',
                  filters.preset === p
                    ? 'bg-slate-900 text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200',
                )}
              >
                {RANGE_PRESET_LABELS[p]}
              </button>
            ))}
            {filters.preset === 'custom' && (
              <div className="flex items-center gap-2 ml-1">
                <input
                  type="date"
                  value={filters.from}
                  onChange={e => update('from', e.target.value)}
                  className="px-2 py-1 rounded-lg border border-slate-200 text-xs outline-none focus:border-brand-400"
                />
                <span className="text-slate-400 text-xs">→</span>
                <input
                  type="date"
                  value={filters.to}
                  onChange={e => update('to', e.target.value)}
                  className="px-2 py-1 rounded-lg border border-slate-200 text-xs outline-none focus:border-brand-400"
                />
              </div>
            )}
            {data && (
              <span className="ml-auto text-xs text-slate-400 whitespace-nowrap">
                {fmtDate(data.range.start)} → {fmtDate(data.range.end)}
              </span>
            )}
          </div>
        </div>

        {/* ── Advanced filters ─────────────────────────────────────────────── */}
        {showFilters && (
          <div className="mt-4 pt-4 border-t border-slate-100 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-2">Read from</p>
              <div className="space-y-1">
                {([
                  { v: 'BOTH' as const, label: 'Agenda + Itinerary', hint: 'Everything, paired up' },
                  { v: 'AGENDA' as const, label: 'Movement chart only', hint: 'Operational truth' },
                  { v: 'ITINERARY' as const, label: 'Itinerary only', hint: 'What was sold' },
                ]).map(o => (
                  <button
                    key={o.v}
                    onClick={() => update('source', o.v)}
                    className={cn(
                      'w-full text-left px-2.5 py-1.5 rounded-lg text-xs transition-colors',
                      filters.source === o.v ? 'bg-brand-50 text-brand-800 font-semibold' : 'text-slate-600 hover:bg-slate-50',
                    )}
                  >
                    {o.label}
                    <span className="block text-[10px] text-slate-400 font-normal">{o.hint}</span>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-2">Search inside</p>
              <div className="space-y-1">
                {ACTIVITY_FIELDS.map(f => {
                  const on = filters.fields.includes(f)
                  return (
                    <button
                      key={f}
                      onClick={() => update(
                        'fields',
                        // Never let the last field be switched off — a search
                        // with nothing to search in matches nothing, silently.
                        on
                          ? (filters.fields.length > 1 ? filters.fields.filter(x => x !== f) : filters.fields)
                          : [...filters.fields, f],
                      )}
                      className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs text-slate-600 hover:bg-slate-50"
                    >
                      <span className={cn(
                        'w-4 h-4 rounded border flex items-center justify-center flex-shrink-0',
                        on ? 'bg-brand-500 border-brand-500' : 'border-slate-300',
                      )}>
                        {on && <CheckCircle2 className="w-3 h-3 text-white" />}
                      </span>
                      {ACTIVITY_FIELD_LABELS[f]}
                    </button>
                  )
                })}
              </div>
            </div>

            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-2">Narrow to</p>
              <div className="space-y-2">
                <select
                  value={filters.agent}
                  onChange={e => update('agent', e.target.value)}
                  className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs outline-none focus:border-brand-400"
                >
                  <option value="">All agents</option>
                  {(data?.agents ?? []).map(a => (
                    <option key={a.name} value={a.name}>{a.name} ({a.count})</option>
                  ))}
                </select>
                <input
                  value={filters.booking}
                  onChange={e => update('booking', e.target.value)}
                  placeholder="Booking ref, IS no., guest…"
                  className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs outline-none focus:border-brand-400"
                />
                <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={filters.unassignedOnly}
                    onChange={e => update('unassignedOnly', e.target.checked)}
                    className="rounded border-slate-300 text-brand-500 focus:ring-brand-400"
                  />
                  Only movements with no driver
                </label>
                <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={filters.includeCancelled}
                    onChange={e => update('includeCancelled', e.target.checked)}
                    className="rounded border-slate-300 text-brand-500 focus:ring-brand-400"
                  />
                  Include cancelled files
                </label>
              </div>
            </div>

            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-2">
                Service type
                {filters.serviceTypes.length > 0 && (
                  <button
                    onClick={() => update('serviceTypes', [])}
                    className="ml-2 font-semibold text-brand-600 normal-case tracking-normal"
                  >
                    clear
                  </button>
                )}
              </p>
              <div className="max-h-40 overflow-y-auto space-y-0.5 pr-1">
                {SERVICE_TYPE_VALUES.map(st => {
                  const on = filters.serviceTypes.includes(st)
                  return (
                    <button
                      key={st}
                      onClick={() => update(
                        'serviceTypes',
                        on ? filters.serviceTypes.filter(x => x !== st) : [...filters.serviceTypes, st],
                      )}
                      className={cn(
                        'w-full text-left px-2 py-1 rounded-md text-[11px] transition-colors truncate',
                        on ? 'bg-brand-50 text-brand-800 font-semibold' : 'text-slate-600 hover:bg-slate-50',
                      )}
                    >
                      {SERVICE_TYPE_LABELS[st]}
                    </button>
                  )
                })}
              </div>
              <p className="mt-1 text-[10px] text-slate-400">Applies to agenda rows only.</p>
            </div>
          </div>
        )}
      </Card>

      {/* ── Stats ──────────────────────────────────────────────────────────── */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <StatTile icon={Sparkles} label="Activities" value={stats.activities} tone="brand" />
          <StatTile icon={FileText} label="Bookings" value={stats.bookings} tone="blue" />
          <StatTile icon={Users} label="Total pax" value={stats.pax} tone="violet" />
          <StatTile icon={CalendarDays} label="Days covered" value={stats.byDay.length} tone="slate" />
          <StatTile
            icon={Car}
            label="No driver yet"
            value={stats.unassigned}
            tone={stats.unassigned ? 'red' : 'green'}
          />
          <StatTile icon={Building2} label="Agents" value={stats.distinctAgents} tone="slate" />
        </div>
      )}

      {/* ── Toolbar ────────────────────────────────────────────────────────── */}
      <Card className="px-3 py-2.5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="inline-flex items-center gap-1 bg-slate-100 rounded-xl p-1">
            {([
              { id: 'timeline' as const, label: 'Timeline', icon: LayoutList },
              { id: 'table' as const, label: 'Table', icon: Table2 },
              { id: 'bookings' as const, label: 'By file', icon: Layers },
              { id: 'insights' as const, label: 'Insights', icon: BarChart3 },
            ]).map(v => (
              <button
                key={v.id}
                onClick={() => setView(v.id)}
                className={cn(
                  'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors',
                  view === v.id ? 'bg-white text-brand-700 shadow-sm' : 'text-slate-500 hover:text-slate-700',
                )}
              >
                <v.icon className="w-3.5 h-3.5" /> {v.label}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex items-center gap-1 text-xs text-slate-500">
              <ArrowUpDown className="w-3.5 h-3.5 text-slate-400" />
              <select
                value={filters.sortBy}
                onChange={e => update('sortBy', e.target.value as Filters['sortBy'])}
                className="bg-transparent outline-none font-semibold text-slate-600 cursor-pointer"
              >
                <option value="date">Date</option>
                <option value="relevance">Best match</option>
                <option value="booking">Booking ref</option>
                <option value="activity">Activity name</option>
                <option value="location">Location</option>
              </select>
              <button
                onClick={() => update('sortDir', filters.sortDir === 'asc' ? 'desc' : 'asc')}
                className="px-1.5 py-0.5 rounded border border-slate-200 text-[10px] font-bold text-slate-500 hover:border-brand-300"
              >
                {filters.sortDir === 'asc' ? 'ASC' : 'DESC'}
              </button>
            </div>

            <div className="h-5 w-px bg-slate-200" />

            <button
              onClick={() => setShowColumns(true)}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs font-semibold text-slate-600 hover:border-brand-300 hover:text-brand-700"
            >
              <Columns3 className="w-3.5 h-3.5" /> Columns
              <span className="px-1.5 rounded-full bg-slate-100 text-[10px]">{columns.length}</span>
            </button>
            <button
              onClick={() => void download('xlsx')}
              disabled={!rows.length || exporting !== null}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 disabled:opacity-40"
            >
              {exporting === 'xlsx' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileSpreadsheet className="w-3.5 h-3.5" />}
              Excel
            </button>
            <button
              onClick={() => void download('pdf')}
              disabled={!rows.length || exporting !== null}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-red-600 text-white text-xs font-semibold hover:bg-red-700 disabled:opacity-40"
            >
              {exporting === 'pdf' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileText className="w-3.5 h-3.5" />}
              PDF
            </button>
            <button
              onClick={() => void download('html')}
              disabled={!rows.length || exporting !== null}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs font-semibold text-slate-600 hover:border-brand-300 disabled:opacity-40"
              title="Opens the printable report in a new tab"
            >
              <Printer className="w-3.5 h-3.5" /> Print view
            </button>
          </div>
        </div>
      </Card>

      {/* ── Notices ────────────────────────────────────────────────────────── */}
      {error && (
        <div className="flex items-start gap-2 p-3 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700">
          <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <div><b>Search failed.</b> {error}</div>
        </div>
      )}
      {data?.truncated && (
        <div className="flex items-start gap-2 p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-800">
          <Info className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <div>
            This window holds more activities than one search reads. The results below are the first
            {' '}{data.scanned.toLocaleString()} scanned — narrow the dates or add a keyword to be sure you are seeing everything.
          </div>
        </div>
      )}

      {/* ── Results ────────────────────────────────────────────────────────── */}
      {!loading && data && rows.length === 0 && (
        <Card className="p-12 text-center">
          <CircleSlash className="w-8 h-8 text-slate-300 mx-auto mb-3" />
          <p className="text-sm font-semibold text-slate-600">Nothing matched this search.</p>
          <p className="text-xs text-slate-400 mt-1 max-w-md mx-auto">
            {filters.terms.length
              ? 'Try a shorter keyword, widen the date range, or switch the source to “Agenda + Itinerary”.'
              : 'There is no activity recorded in this window for the files you can see.'}
          </p>
          {filters.terms.length > 0 && !filters.fuzzy && (
            <button
              onClick={() => update('fuzzy', true)}
              className="mt-4 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-50 text-violet-700 text-xs font-semibold"
            >
              <Wand2 className="w-3.5 h-3.5" /> Try typo-tolerant matching
            </button>
          )}
        </Card>
      )}

      {view === 'timeline' && rows.length > 0 && (
        <div className="space-y-3">
          {byDay.map(([day, list]) => (
            <Card key={day} className="overflow-hidden">
              <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-100 flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold text-slate-800">
                    {fmtDate(`${day}T00:00:00`, { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' })}
                  </span>
                  <span className={cn('px-2 py-0.5 rounded-full text-[10px] font-bold', whenTone(list[0].daysAway))}>
                    {whenLabel(list[0].daysAway)}
                  </span>
                </div>
                <span className="text-xs text-slate-500">
                  {list.length} activit{list.length === 1 ? 'y' : 'ies'} ·{' '}
                  {new Set(list.map(r => r.bookingRef)).size} file(s) ·{' '}
                  {Array.from(new Map(list.map(r => [r.bookingId, r.totalPax])).values()).reduce((s, n) => s + n, 0)} pax
                </span>
              </div>
              <div className="divide-y divide-slate-100">
                {list.map(row => (
                  <ActivityRowCard
                    key={row.id}
                    row={row}
                    terms={filters.terms}
                    expanded={expanded.has(row.id)}
                    onToggle={() => toggleExpand(row.id)}
                  />
                ))}
              </div>
            </Card>
          ))}
        </div>
      )}

      {view === 'table' && rows.length > 0 && (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-slate-800 text-white sticky top-0">
                <tr>
                  {columns.map(key => {
                    const def = COLUMNS.find(c => c.key === key)
                    if (!def) return null
                    return (
                      <th key={key} className="px-3 py-2 text-left font-bold uppercase tracking-wide text-[10px] whitespace-nowrap">
                        {def.label}
                      </th>
                    )
                  })}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map(row => (
                  <tr key={row.id} className={cn('hover:bg-brand-50/40', row.cancelled && 'bg-red-50/50 text-red-700')}>
                    {columns.map(key => {
                      const def = COLUMNS.find(c => c.key === key)
                      if (!def) return null
                      const value = String(def.value(row) ?? '')
                      return (
                        <td
                          key={key}
                          className={cn(
                            'px-3 py-2 align-top',
                            def.wide ? 'max-w-md text-slate-600' : 'whitespace-nowrap',
                            key === 'bookingRef' && 'font-mono font-bold text-brand-700',
                          )}
                        >
                          {key === 'bookingRef' ? (
                            <Link href={`/dashboard/bookings/${row.bookingRef}`} className="hover:underline">
                              {value}
                            </Link>
                          ) : value ? (
                            <span className={def.wide ? 'line-clamp-3' : undefined}>
                              <Highlight text={value} terms={filters.terms} />
                            </span>
                          ) : (
                            <span className="text-slate-300">—</span>
                          )}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-4 py-2 bg-slate-50 border-t border-slate-100 text-[11px] text-slate-500">
            Showing {rows.length} rows in {columns.length} columns — the Excel download uses this exact column set.
          </div>
        </Card>
      )}

      {view === 'bookings' && rows.length > 0 && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
          {byBooking.map(([ref, list]) => {
            const first = list[0]
            return (
              <Card key={ref} className="overflow-hidden">
                <div className="px-4 py-3 border-b border-slate-100 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Link
                      href={`/dashboard/bookings/${ref}`}
                      className="font-mono font-bold text-brand-700 hover:underline inline-flex items-center gap-1"
                    >
                      {ref} <ExternalLink className="w-3 h-3" />
                    </Link>
                    <p className="text-xs text-slate-600 mt-0.5 truncate">
                      {first.guestName ?? 'Guest not named'} · {first.totalPax} pax
                      {first.agent ? ` · ${first.agent}` : ''}
                    </p>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      {fmtDate(first.arrivalDate)} → {fmtDate(first.departureDate)}
                      {first.isNumber ? ` · IS ${first.isNumber}` : ''}
                    </p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <span className="px-2 py-0.5 rounded-full bg-brand-50 text-brand-700 text-[10px] font-bold">
                      {list.length} match{list.length === 1 ? '' : 'es'}
                    </span>
                    {first.cancelled && (
                      <span className="block mt-1 px-2 py-0.5 rounded-full bg-red-100 text-red-700 text-[10px] font-bold">
                        CANCELLED
                      </span>
                    )}
                  </div>
                </div>
                <div className="divide-y divide-slate-50">
                  {list.map(r => (
                    <div key={r.id} className="px-4 py-2 flex items-start gap-3">
                      <div className="flex-shrink-0 text-center w-14">
                        <div className="text-[10px] font-bold text-slate-700">
                          {fmtDate(r.date, { day: '2-digit', month: 'short' })}
                        </div>
                        <div className="text-[9px] text-slate-400">{r.dayNo ? `Day ${r.dayNo}` : r.weekday.slice(0, 3)}</div>
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-semibold text-slate-800 leading-snug">
                          <Highlight text={r.activity} terms={filters.terms} />
                        </p>
                        <div className="flex flex-wrap items-center gap-2 mt-0.5 text-[10px] text-slate-500">
                          <SourceChip source={r.source} />
                          {r.location && <span className="inline-flex items-center gap-0.5"><MapPin className="w-2.5 h-2.5" />{r.location}</span>}
                          {r.serviceTypeLabel && <span>{r.serviceTypeLabel}</span>}
                          {r.meetingTime && <span className="inline-flex items-center gap-0.5"><Clock className="w-2.5 h-2.5" />{r.meetingTime}</span>}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            )
          })}
        </div>
      )}

      {view === 'insights' && stats && rows.length > 0 && (
        <Insights stats={stats} />
      )}

      {loading && !data && (
        <Card className="p-16 text-center">
          <Loader2 className="w-6 h-6 text-brand-500 animate-spin mx-auto" />
          <p className="text-sm text-slate-400 mt-3">Searching every agenda and itinerary in the window…</p>
        </Card>
      )}

      <ColumnPicker
        open={showColumns}
        onClose={() => setShowColumns(false)}
        selected={columns}
        onChange={setColumns}
      />
      <ActivityExplorer
        open={showExplorer}
        onClose={() => setShowExplorer(false)}
        country={countryParam}
        activeTerms={filters.terms}
        onPick={term => addTerm(term)}
      />
    </div>
  )
}

// ─── Pieces ───────────────────────────────────────────────────────────────────

const TONES: Record<string, string> = {
  brand: 'bg-brand-50 text-brand-600',
  blue: 'bg-blue-50 text-blue-600',
  violet: 'bg-violet-50 text-violet-600',
  green: 'bg-emerald-50 text-emerald-600',
  red: 'bg-red-50 text-red-600',
  slate: 'bg-slate-100 text-slate-500',
}

function StatTile({
  icon: Icon, label, value, tone,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: number
  tone: keyof typeof TONES
}) {
  return (
    <Card className="p-3 flex items-center gap-3">
      <span className={cn('p-2 rounded-lg flex-shrink-0', TONES[tone])}>
        <Icon className="w-4 h-4" />
      </span>
      <div className="min-w-0">
        <p className="text-xl font-bold text-slate-900 leading-none tabular-nums">{value.toLocaleString()}</p>
        <p className="text-[10px] uppercase tracking-wider text-slate-400 mt-1 truncate">{label}</p>
      </div>
    </Card>
  )
}

function SourceChip({ source }: { source: 'AGENDA' | 'ITINERARY' }) {
  return (
    <span className={cn(
      'px-1.5 py-0.5 rounded font-bold text-[9px] uppercase tracking-wide',
      source === 'AGENDA' ? 'bg-emerald-50 text-emerald-700' : 'bg-violet-50 text-violet-700',
    )}>
      {source === 'AGENDA' ? 'Agenda' : 'Itinerary'}
    </span>
  )
}

/**
 * One matched activity.
 *
 * Collapsed it shows what a desk scans for — the file, the tour, the time, who
 * is driving. Expanded it shows the full text plus the *other* record for the
 * same day, which is the answer to "the agenda says nothing, what did we sell?"
 */
function ActivityRowCard({
  row, terms, expanded, onToggle,
}: {
  row: Row
  terms: string[]
  expanded: boolean
  onToggle: () => void
}) {
  const needsDriver = row.source === 'AGENDA' && !row.assigned && !row.isLeisure && !row.isHotelOnly

  return (
    <div className={cn('px-4 py-3 transition-colors', row.cancelled ? 'bg-red-50/40' : 'hover:bg-brand-50/30')}>
      <div className="flex items-start gap-3">
        <button
          onClick={onToggle}
          className="mt-0.5 p-0.5 rounded text-slate-300 hover:text-slate-600 flex-shrink-0"
          aria-label={expanded ? 'Collapse' : 'Expand'}
        >
          {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </button>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={`/dashboard/bookings/${row.bookingRef}`}
              className="font-mono text-xs font-bold text-brand-700 hover:underline"
            >
              {row.bookingRef}
            </Link>
            <SourceChip source={row.source} />
            {row.dayNo && (
              <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 text-[9px] font-bold">
                DAY {row.dayNo}
              </span>
            )}
            {row.cancelled && (
              <span className="px-1.5 py-0.5 rounded bg-red-100 text-red-700 text-[9px] font-bold">CANCELLED</span>
            )}
            {row.isLeisure && (
              <span className="px-1.5 py-0.5 rounded bg-sky-50 text-sky-700 text-[9px] font-bold">LEISURE</span>
            )}
            {needsDriver && (
              <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 text-[9px] font-bold inline-flex items-center gap-1">
                <AlertTriangle className="w-2.5 h-2.5" /> NO DRIVER
              </span>
            )}
          </div>

          <p className="mt-1 text-sm font-semibold text-slate-800 leading-snug">
            <Highlight text={row.activity} terms={terms} />
          </p>

          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500">
            {row.location && (
              <span className="inline-flex items-center gap-1"><MapPin className="w-3 h-3 text-slate-400" />
                <Highlight text={row.location} terms={terms} />
              </span>
            )}
            {row.serviceTypeLabel && (
              <span className="inline-flex items-center gap-1"><Plane className="w-3 h-3 text-slate-400" />{row.serviceTypeLabel}</span>
            )}
            {(row.meetingTime || row.timeFrom) && (
              <span className="inline-flex items-center gap-1"><Clock className="w-3 h-3 text-slate-400" />
                {row.meetingTime || `${row.timeFrom ?? ''}${row.timeTo ? `–${row.timeTo}` : ''}`}
              </span>
            )}
            <span className="inline-flex items-center gap-1"><Users className="w-3 h-3 text-slate-400" />{row.totalPax} pax</span>
            {row.guestName && <span className="truncate max-w-[180px]">{row.guestName}</span>}
            {row.agent && <span className="text-slate-400">· {row.agent}</span>}
          </div>

          {row.snippet && !expanded && (
            <p className="mt-1.5 text-[11px] text-slate-500 line-clamp-2 italic">
              <Highlight text={row.snippet} terms={terms} />
            </p>
          )}

          {expanded && (
            <div className="mt-3 space-y-3">
              {row.details && (
                <div className="p-3 rounded-lg bg-slate-50 border border-slate-100">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                    {row.source === 'AGENDA' ? 'Movement details' : 'Itinerary description'}
                  </p>
                  <p className="text-[11px] text-slate-600 whitespace-pre-wrap leading-relaxed">
                    <Highlight text={row.details} terms={terms} />
                  </p>
                </div>
              )}

              {/* The other side's record for the same day — the fallback the
                  desk otherwise has to open the booking to find. */}
              {row.counterpart && (
                <div className={cn(
                  'p-3 rounded-lg border',
                  row.counterpart.source === 'ITINERARY'
                    ? 'bg-violet-50/60 border-violet-100'
                    : 'bg-emerald-50/60 border-emerald-100',
                )}>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1 flex items-center gap-1.5">
                    <SourceChip source={row.counterpart.source} />
                    same day on this file
                    {row.counterpart.dayNo ? ` · Day ${row.counterpart.dayNo}` : ''}
                  </p>
                  <p className="text-[11px] font-semibold text-slate-700">
                    <Highlight text={row.counterpart.activity} terms={terms} />
                  </p>
                  {row.counterpart.details && (
                    <p className="text-[11px] text-slate-600 whitespace-pre-wrap leading-relaxed mt-1">
                      <Highlight text={row.counterpart.details} terms={terms} />
                    </p>
                  )}
                </div>
              )}

              {(row.fromPoint || row.toPoint) && (
                <p className="text-[11px] text-slate-500">
                  <b className="text-slate-400">Route:</b> {row.fromPoint ?? '—'} → {row.toPoint ?? '—'}
                </p>
              )}

              {(row.driverName || row.vendorName || row.guideName || row.tourVendorName) && (
                <div className="flex flex-wrap gap-2">
                  {row.driverName && <GroundChip icon={Car} label="Driver" value={row.driverName} phone={row.driverPhone} />}
                  {row.vehicleType && <GroundChip icon={Car} label="Vehicle" value={[row.vehicleType, row.vehiclePlate].filter(Boolean).join(' · ')} />}
                  {row.vendorName && <GroundChip icon={Store} label="Transport vendor" value={row.vendorName} />}
                  {row.guideName && <GroundChip icon={UserCheck} label="Guide" value={row.guideName} phone={row.guidePhone} />}
                  {row.tourVendorName && <GroundChip icon={Store} label="Tour vendor" value={row.tourVendorName} phone={row.tourVendorPhone} />}
                </div>
              )}

              <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-500 pt-1 border-t border-slate-100">
                {row.guestPhone && (
                  <span className="inline-flex items-center gap-1"><Phone className="w-3 h-3 text-slate-400" />{row.guestPhone}</span>
                )}
                {row.guestEmail && (
                  <span className="inline-flex items-center gap-1"><Mail className="w-3 h-3 text-slate-400" />{row.guestEmail}</span>
                )}
                {row.fileHandler && <span>Handler: {row.fileHandler}</span>}
                {row.matchedFields.length > 0 && (
                  <span className="text-slate-400">
                    matched in {row.matchedFields.map(f => ACTIVITY_FIELD_LABELS[f].toLowerCase()).join(', ')}
                  </span>
                )}
                <Link
                  href={`/dashboard/bookings/${row.bookingRef}/agenda`}
                  className="ml-auto inline-flex items-center gap-1 text-brand-600 font-semibold hover:underline"
                >
                  Open movement chart <ExternalLink className="w-3 h-3" />
                </Link>
              </div>
            </div>
          )}
        </div>

        <div className="flex-shrink-0 text-right">
          <span className={cn('px-2 py-0.5 rounded-full text-[10px] font-bold', whenTone(row.daysAway))}>
            {whenLabel(row.daysAway)}
          </span>
          {row.matchedTerms.length > 0 && (
            <div className="mt-1 flex flex-wrap justify-end gap-1 max-w-[160px]">
              {row.matchedTerms.map(t => (
                <span key={t} className="px-1.5 py-0.5 rounded bg-brand-100 text-brand-700 text-[9px] font-semibold">
                  {t}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function GroundChip({
  icon: Icon, label, value, phone,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: string
  phone?: string | null
}) {
  return (
    <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg bg-white border border-slate-200 text-[11px]">
      <Icon className="w-3 h-3 text-slate-400" />
      <span className="text-slate-400">{label}:</span>
      <b className="text-slate-700">{value}</b>
      {phone && <span className="text-slate-400">· {phone}</span>}
    </span>
  )
}

/** The numbers underneath the list — where the volume actually sits. */
function Insights({ stats }: { stats: Stats }) {
  const maxDay = Math.max(...stats.byDay.map(d => d.count), 1)

  return (
    <div className="space-y-3">
      <Card className="p-4">
        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3">Activities per day</h3>
        <div className="flex items-end gap-1 h-32 overflow-x-auto pb-1">
          {stats.byDay.map(d => (
            <div key={d.date} className="flex-1 min-w-[26px] flex flex-col items-center h-full group">
              <span className="text-[10px] font-bold text-slate-500 tabular-nums">{d.count}</span>
              <div className="flex-1 w-full flex items-end">
                <div
                  className="w-full rounded-t bg-gradient-to-b from-brand-400 to-brand-600 group-hover:from-brand-500 group-hover:to-brand-700 transition-colors"
                  style={{ height: `${Math.max((d.count / maxDay) * 100, 3)}%` }}
                  title={`${d.label} — ${d.count} activities, ${d.bookings} files, ${d.pax} pax`}
                />
              </div>
              <span className="text-[9px] text-slate-400 mt-1 whitespace-nowrap">{d.label}</span>
              <span className="text-[8px] text-slate-300">{d.weekday}</span>
            </div>
          ))}
        </div>
      </Card>

      {stats.byTerm.length > 0 && (
        <Card className="overflow-hidden">
          <div className="px-4 py-2.5 border-b border-slate-100">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">By keyword</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 text-slate-500">
                <tr>
                  <th className="px-4 py-2 text-left font-semibold">Keyword</th>
                  <th className="px-3 py-2 text-right font-semibold">Activities</th>
                  <th className="px-3 py-2 text-right font-semibold">Files</th>
                  <th className="px-3 py-2 text-right font-semibold">Pax</th>
                  <th className="px-3 py-2 text-left font-semibold">First</th>
                  <th className="px-3 py-2 text-left font-semibold">Last</th>
                  <th className="px-3 py-2 text-right font-semibold" title="How many different ways this activity is written">
                    Variants
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {stats.byTerm.map(t => (
                  <tr key={t.key} className={cn(t.count === 0 && 'text-slate-400')}>
                    <td className="px-4 py-2 font-semibold text-slate-700">{t.label}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{t.count}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{t.bookings}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{t.pax}</td>
                    <td className="px-3 py-2">{fmtDate(t.firstDate)}</td>
                    <td className="px-3 py-2">{fmtDate(t.lastDate)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{t.variants}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        <BucketCard title="Top activities" buckets={stats.byActivity} icon={Sparkles} />
        <BucketCard title="By location" buckets={stats.byLocation} icon={MapPin} />
        <BucketCard title="By service type" buckets={stats.byServiceType} icon={Plane} />
        <BucketCard title="By agent" buckets={stats.byAgent} icon={Building2} />
        <BucketCard title="By vendor" buckets={stats.byVendor} icon={Store} />
        <Card className="p-4">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3">Where the rows came from</h3>
          <div className="space-y-2 text-xs">
            <SplitBar label="Movement chart" value={stats.fromAgenda} total={stats.activities} tone="bg-emerald-500" />
            <SplitBar label="Itinerary" value={stats.fromItinerary} total={stats.activities} tone="bg-violet-500" />
            <div className="pt-2 mt-2 border-t border-slate-100 space-y-1.5 text-slate-500">
              <div className="flex justify-between"><span>Already happened</span><b>{stats.past}</b></div>
              <div className="flex justify-between"><span>Today</span><b>{stats.today}</b></div>
              <div className="flex justify-between"><span>Still upcoming</span><b>{stats.upcoming}</b></div>
              {stats.cancelled > 0 && (
                <div className="flex justify-between text-red-600"><span>On cancelled files</span><b>{stats.cancelled}</b></div>
              )}
            </div>
          </div>
        </Card>
      </div>
    </div>
  )
}

function SplitBar({ label, value, total, tone }: { label: string; value: number; total: number; tone: string }) {
  const pct = total ? Math.round((value / total) * 100) : 0
  return (
    <div>
      <div className="flex justify-between text-slate-600 mb-1">
        <span>{label}</span>
        <b className="tabular-nums">{value} <span className="text-slate-400 font-normal">({pct}%)</span></b>
      </div>
      <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
        <div className={cn('h-full rounded-full', tone)} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

function BucketCard({
  title, buckets, icon: Icon,
}: {
  title: string
  buckets: Bucket[]
  icon: React.ComponentType<{ className?: string }>
}) {
  if (!buckets.length) return null
  const max = Math.max(...buckets.map(b => b.count), 1)
  return (
    <Card className="p-4">
      <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3 flex items-center gap-1.5">
        <Icon className="w-3.5 h-3.5" /> {title}
      </h3>
      <div className="space-y-2">
        {buckets.slice(0, 10).map(b => (
          <div key={b.key}>
            <div className="flex justify-between items-baseline gap-2 text-[11px]">
              <span className="text-slate-600 truncate" title={b.label}>{b.label}</span>
              <span className="text-slate-400 tabular-nums flex-shrink-0">
                {b.count} · {b.pax}p
              </span>
            </div>
            <div className="h-1 rounded-full bg-slate-100 overflow-hidden mt-0.5">
              <div className="h-full rounded-full bg-brand-400" style={{ width: `${(b.count / max) * 100}%` }} />
            </div>
          </div>
        ))}
      </div>
    </Card>
  )
}
