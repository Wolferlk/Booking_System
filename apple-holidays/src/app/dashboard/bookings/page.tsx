'use client'

import { Suspense, useEffect, useState, useCallback, useRef } from 'react'
import Link from 'next/link'
import { useSearchParams, useRouter } from 'next/navigation'
import {
  Plus, Search, FileText, Loader2, ArrowRight, Users, Calendar,
  ArrowUp, ArrowDown, ArrowUpDown, Clock, MapPin,
  Hash, Trash2, AlertTriangle, ChevronLeft, ChevronRight, X,
  Download, ChevronDown, Table2,
  Cloud, FolderOpen, CheckCircle2, AlertCircle, Sparkles, RefreshCw,
} from 'lucide-react'
import Header from '@/components/layout/header'
import { Card } from '@/components/ui/card'
import { StatusBadge } from '@/components/ui/badge'
import Button from '@/components/ui/button'
import { formatDate, formatDateTime, formatCurrency } from '@/lib/utils'
import { CountryFlag } from '@/components/ui/country-flag'
import Modal from '@/components/ui/modal'
import { STATUS_LABELS } from '@/lib/state-machine'
import { useSession } from 'next-auth/react'
import { useCountryFilter } from '@/hooks/use-country-filter'
import type { BookingStatus } from '@prisma/client'

const STATUSES = Object.keys(STATUS_LABELS) as BookingStatus[]

type SortField = 'arrivalDate' | 'departureDate' | 'createdAt' | 'updatedAt'
type SortDir   = 'asc' | 'desc'
type DateFilter = '' | 'today' | 'this_week' | 'this_month'
type ScanState  = 'idle' | 'scanning' | 'not_found' | 'done' | 'error'

const SCAN_STEPS = [
  { label: 'Searching OneDrive',        desc: 'Looking for booking folder across all configured drives' },
  { label: 'Found booking folder',       desc: 'Located folder — reading TC and PNL documents' },
  { label: 'Extracting booking data',    desc: 'AI is reading documents and building the booking record' },
  { label: 'Building travel agenda',     desc: 'Generating itinerary and agenda from booking details' },
  { label: 'Complete',                   desc: 'Booking successfully imported from OneDrive' },
]

const BOOKING_REF_RE = /^(VN|IS|SG|MY|AH)\d{4,}$/i

const DATE_FILTER_OPTIONS: { value: DateFilter; label: string }[] = [
  { value: '',           label: 'All' },
  { value: 'today',      label: 'Today' },
  { value: 'this_week',  label: 'This Week' },
  { value: 'this_month', label: 'This Month' },
]

const SORT_FIELD_OPTIONS: { value: SortField; label: string }[] = [
  { value: 'arrivalDate',   label: 'Arrival Date' },
  { value: 'departureDate', label: 'Departure Date' },
  { value: 'createdAt',     label: 'Created' },
  { value: 'updatedAt',     label: 'Last Updated' },
]

interface Booking {
  id: string
  bookingRef: string
  agent: string | null
  agentBookingId: string | null
  fileHandler: string | null
  status: BookingStatus
  arrivalDate: string
  departureDate: string
  paxAdults: number
  paxChildren: number
  quotedTotal: string
  currency: string
  createdAt: string
  isNumber: string | null
  passengers: { name: string; isLead: boolean }[]
  createdBy: { name: string; role: string }
  _count: { changeRequests: number }
  pnl: { id: string } | null
  tourAgenda: {
    id: string
    items?: { location: string; fromPoint: string | null; toPoint: string | null; details: string | null }[]
  } | null
  operationCountry: string | null
  // Deep-search context fields (only present when contentSearch is active)
  flights?: { flightNo: string; airline: string | null; fromApt: string; toApt: string }[]
  accommodations?: { hotel: string; city: string }[]
  itineraryItems?: { title: string; description: string | null }[]
}

interface MatchSnippet {
  type: 'passenger' | 'flight' | 'hotel' | 'itinerary' | 'agenda'
  label: string
  text: string
}

function getMatchSnippets(b: Booking, query: string): MatchSnippet[] {
  if (!query) return []
  const q = query.toLowerCase()
  const snippets: MatchSnippet[] = []

  b.passengers?.forEach(p => {
    if (p.name.toLowerCase().includes(q))
      snippets.push({ type: 'passenger', label: 'Passenger', text: p.name })
  })

  b.flights?.forEach(f => {
    const raw = [f.flightNo, f.airline, f.fromApt, f.toApt].filter(Boolean).join(' ')
    if (raw.toLowerCase().includes(q))
      snippets.push({ type: 'flight', label: 'Flight', text: `${f.flightNo} · ${f.fromApt} → ${f.toApt}${f.airline ? ` (${f.airline})` : ''}` })
  })

  b.accommodations?.forEach(a => {
    if ((a.hotel + ' ' + a.city).toLowerCase().includes(q))
      snippets.push({ type: 'hotel', label: 'Hotel', text: `${a.hotel}, ${a.city}` })
  })

  b.itineraryItems?.forEach(it => {
    const haystack = (it.title + ' ' + (it.description ?? '')).toLowerCase()
    if (haystack.includes(q)) {
      const src = it.title.toLowerCase().includes(q) ? it.title : (it.description ?? '')
      snippets.push({ type: 'itinerary', label: 'Itinerary', text: snippet(src, q) })
    }
  })

  b.tourAgenda?.items?.forEach(item => {
    const parts = [item.location, item.fromPoint, item.toPoint].filter(Boolean) as string[]
    const base = parts.join(' → ')
    const haystack = (base + ' ' + (item.details ?? '')).toLowerCase()
    if (haystack.includes(q)) {
      const src = base.toLowerCase().includes(q) ? base : (item.details ?? '')
      snippets.push({ type: 'agenda', label: 'Agenda', text: snippet(src, q) })
    }
  })

  return snippets.slice(0, 6)
}

function snippet(text: string, query: string, pad = 28): string {
  const idx = text.toLowerCase().indexOf(query.toLowerCase())
  if (idx === -1) return text.slice(0, 80)
  const start = Math.max(0, idx - pad)
  const end   = Math.min(text.length, idx + query.length + pad)
  return (start > 0 ? '…' : '') + text.slice(start, end) + (end < text.length ? '…' : '')
}

function Highlight({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>
  const idx = text.toLowerCase().indexOf(query.toLowerCase())
  if (idx === -1) return <>{text}</>
  return (
    <>
      {text.slice(0, idx)}
      <mark className="bg-yellow-200 text-yellow-900 font-semibold rounded-sm px-0.5 not-italic">
        {text.slice(idx, idx + query.length)}
      </mark>
      {text.slice(idx + query.length)}
    </>
  )
}

const SNIPPET_STYLE: Record<MatchSnippet['type'], string> = {
  passenger: 'bg-violet-50 text-violet-700 border-violet-200',
  flight:    'bg-sky-50    text-sky-700    border-sky-200',
  hotel:     'bg-amber-50  text-amber-700  border-amber-200',
  itinerary: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  agenda:    'bg-blue-50   text-blue-700   border-blue-200',
}

const SNIPPET_ICON: Record<MatchSnippet['type'], string> = {
  passenger: '👤',
  flight:    '✈️',
  hotel:     '🏨',
  itinerary: '📋',
  agenda:    '📍',
}

const COUNTRY_BADGE: Record<string, { label: string; color: string }> = {
  VIETNAM:            { label: 'Vietnam',   color: 'bg-red-500/10 text-red-400 border-red-500/20' },
  SRILANKA:           { label: 'Sri Lanka', color: 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20' },
  SINGAPORE:          { label: 'Singapore', color: 'bg-blue-500/10 text-blue-400 border-blue-500/20' },
  MALAYSIA:           { label: 'Malaysia',  color: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' },
  SINGAPORE_MALAYSIA: { label: 'SG & MY',   color: 'bg-blue-500/10 text-blue-400 border-blue-500/20' },
  ALL:                { label: 'All',       color: 'bg-slate-500/10 text-slate-400 border-slate-500/20' },
}

function SortIcon({ field, sortBy, sortDir }: { field: SortField; sortBy: SortField; sortDir: SortDir }) {
  if (sortBy !== field) return <ArrowUpDown className="w-3 h-3 ml-1 opacity-25 inline" />
  return sortDir === 'asc'
    ? <ArrowUp   className="w-3 h-3 ml-1 text-brand-600 inline" />
    : <ArrowDown className="w-3 h-3 ml-1 text-brand-600 inline" />
}

function BookingsPageInner() {
  const { data: session } = useSession()
  const router = useRouter()
  const searchParams = useSearchParams()
  const { countryFilter } = useCountryFilter()

  const [bookings, setBookings]         = useState<Booking[]>([])
  const [total, setTotal]               = useState(0)
  const [loading, setLoading]           = useState(true)
  // Unified search input — routes to either 'search' or 'refSearch' based on input type
  const [displaySearch, setDisplaySearch] = useState(searchParams.get('search') ?? '')
  const [search, setSearch]             = useState(searchParams.get('search') ?? '')
  const [refSearch, setRefSearch]       = useState('')
  const [contentSearch, setContentSearch] = useState('')
  const [showDownloadMenu, setShowDownloadMenu] = useState(false)
  const [downloadingExcel, setDownloadingExcel] = useState(false)
  const downloadMenuRef = useRef<HTMLDivElement>(null)
  const [status, setStatus]             = useState(searchParams.get('status') ?? '')
  const [dateFilter, setDateFilter]   = useState<DateFilter>((searchParams.get('dateFilter') ?? '') as DateFilter)
  const [dateBasis, setDateBasis]     = useState<'arrivalDate' | 'createdAt'>('arrivalDate')
  const [dateFrom, setDateFrom]       = useState('')
  const [dateTo, setDateTo]           = useState('')
  const [sortBy, setSortBy]           = useState<SortField>((searchParams.get('sortBy') ?? 'createdAt') as SortField)
  const [sortDir, setSortDir]         = useState<SortDir>((searchParams.get('sortDir') ?? 'desc') as SortDir)
  const [page, setPage]               = useState(1)
  const [limit, setLimit]             = useState(50)

  // ── Multi-select state ────────────────────────────────────────────────────
  const [selected, setSelected]       = useState<Set<string>>(new Set())
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [deleting, setDeleting]       = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  // ── OneDrive auto-scan state ──────────────────────────────────────────────
  const [scanState, setScanState]           = useState<ScanState>('idle')
  const [scanStep, setScanStep]             = useState(0)
  const [scanError, setScanError]           = useState<string | null>(null)
  const [scanBookingRef, setScanBookingRef] = useState<string | null>(null)
  const scanSearchRef  = useRef<string>('')
  const autoScanTimer  = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Auto-booking-create today banner ────────────────────────────────────
  interface AutoJobSummary { id: string; targetDate: string; totalCreated: number; totalUpdated: number; totalErrors: number; completedAt: string }
  const [todayJob, setTodayJob]           = useState<AutoJobSummary | null>(null)
  const [bannerDismissed, setBannerDismissed] = useState(false)
  useEffect(() => {
    fetch('/api/admin/onedrive-booking-auto/today')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.job) setTodayJob(d.job) })
      .catch(() => {})
  }, [])

  const normalizedSearch   = displaySearch.trim()
  const isBookingRefSearch = BOOKING_REF_RE.test(normalizedSearch)

  const fetchBookings = useCallback(async () => {
    setLoading(true)
    setSelected(new Set())   // clear selection on every fetch
    const params = new URLSearchParams()
    if (search)                                         params.set('search',        search)
    if (refSearch)                                      params.set('refSearch',     refSearch)
    if (contentSearch)                                  params.set('contentSearch', contentSearch)
    if (status)                                         params.set('status',        status)
    if (dateFilter)                                     params.set('dateFilter',    dateFilter)
    if (dateFilter)                                     params.set('dateField',     dateBasis)
    if (dateFrom)                                       params.set('dateFrom',      dateFrom)
    if (dateTo)                                         params.set('dateTo',        dateTo)
    if (countryFilter && countryFilter !== 'ALL')       params.set('country',       countryFilter)
    params.set('sortBy',  sortBy)
    params.set('sortDir', sortDir)
    params.set('page',    String(page))
    params.set('limit',   String(limit))
    try {
      const res  = await fetch(`/api/bookings?${params}`)
      const json = await res.json()
      if (json.success) {
        setBookings(json.data.bookings)
        setTotal(json.data.total)
      }
    } finally {
      setLoading(false)
    }
  }, [search, refSearch, contentSearch, status, dateFilter, dateBasis, dateFrom, dateTo, sortBy, sortDir, countryFilter, page, limit])

  // Close download menu on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (downloadMenuRef.current && !downloadMenuRef.current.contains(e.target as Node)) {
        setShowDownloadMenu(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  useEffect(() => { fetchBookings() }, [fetchBookings])

  // Reset scan when the unified search input changes
  useEffect(() => {
    setScanState('idle')
    setScanStep(0)
    setScanError(null)
    setScanBookingRef(null)
  }, [displaySearch])

  // Auto-trigger OneDrive scan (debounced 1.2 s) when no results + ref-like query
  useEffect(() => {
    if (autoScanTimer.current) clearTimeout(autoScanTimer.current)

    if (!loading && bookings.length === 0 && isBookingRefSearch && scanState === 'idle') {
      autoScanTimer.current = setTimeout(() => {
        const ref = normalizedSearch.replace(/\s+/g, '').toUpperCase()
        scanSearchRef.current = ref
        void runOneDriveScan(ref)
      }, 1200)
    }

    return () => { if (autoScanTimer.current) clearTimeout(autoScanTimer.current) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, bookings.length, isBookingRefSearch, scanState, normalizedSearch])

  async function runOneDriveScan(bookingRef: string) {
    setScanState('scanning')
    setScanStep(0)
    setScanError(null)
    setScanBookingRef(bookingRef)

    // Fake step progression while the API call runs
    const t1 = setTimeout(() => setScanStep(s => Math.max(s, 1)),  3500)
    const t2 = setTimeout(() => setScanStep(s => Math.max(s, 2)),  9000)
    const t3 = setTimeout(() => setScanStep(s => Math.max(s, 3)), 15000)

    try {
      const res  = await fetch('/api/onedrive/sync', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ bookingRef }),
      })
      const json = await res.json()
      clearTimeout(t1); clearTimeout(t2); clearTimeout(t3)

      // Ignore result if user has already changed the search
      if (scanSearchRef.current !== bookingRef) return

      if (!json.success) {
        setScanState('error')
        setScanError(json.error ?? 'Scan failed — please try again')
        return
      }

      const tot = (json.data?.total ?? {}) as Record<string, number>
      const scanCreated = (tot.bookingsCreated ?? 0) > 0 || (tot.bookingsUpdated ?? 0) > 0

      // Also check if the booking exists in DB regardless of scan result
      // (background cron may have created it, or it already existed)
      let existsInDb = false
      try {
        const chk  = await fetch(`/api/bookings?refSearch=${encodeURIComponent(bookingRef)}&limit=1`)
        const chkJ = await chk.json()
        existsInDb = chkJ.success && (chkJ.data?.total ?? 0) > 0
      } catch { /* ignore check failure */ }

      if (scanCreated || existsInDb) {
        setScanStep(4)
        setScanState('done')
        setTimeout(() => fetchBookings(), 900)
      } else {
        setScanStep(s => Math.max(s, 1))
        setScanState('not_found')
      }
    } catch {
      clearTimeout(t1); clearTimeout(t2); clearTimeout(t3)
      if (scanSearchRef.current === bookingRef) {
        setScanState('error')
        setScanError('Network error — please try again')
      }
    }
  }

  // Unified search handler — routes ref-like input to refSearch, text to search
  function handleUnifiedSearch(value: string) {
    setDisplaySearch(value)
    setPage(1)
    const trimmed = value.trim()
    // Ref-like: VN12345, IS48231, SG001, 4-digit IS number etc.
    if (BOOKING_REF_RE.test(trimmed) || /^[A-Za-z]{1,3}\d{3,}$/.test(trimmed) || /^\d{4,}$/.test(trimmed)) {
      setRefSearch(trimmed.toUpperCase())
      setSearch('')
    } else {
      setSearch(value)
      setRefSearch('')
    }
  }

  function toggleSort(field: SortField) {
    setPage(1)
    if (sortBy === field) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortBy(field)
      setSortDir('desc')
    }
  }

  function clearDateRange() {
    setDateFrom('')
    setDateTo('')
    setPage(1)
  }

  const totalPages = Math.max(1, Math.ceil(total / limit))
  const pageFrom   = total === 0 ? 0 : (page - 1) * limit + 1
  const pageTo     = Math.min(page * limit, total)

  // ── Selection helpers ─────────────────────────────────────────────────────
  const allRefs      = bookings.map(b => b.bookingRef)
  const allSelected  = allRefs.length > 0 && allRefs.every(r => selected.has(r))
  const someSelected = allRefs.some(r => selected.has(r))

  function toggleAll() {
    if (allSelected) {
      setSelected(new Set())
    } else {
      setSelected(new Set(allRefs))
    }
  }

  function toggleOne(ref: string) {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(ref) ? next.delete(ref) : next.add(ref)
      return next
    })
  }

  async function handleBulkDelete() {
    setDeleting(true)
    setDeleteError(null)
    try {
      const res  = await fetch('/api/bookings/bulk-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingRefs: Array.from(selected) }),
      })
      const json = await res.json()
      if (!json.success) {
        setDeleteError(json.error ?? 'Delete failed')
        return
      }
      setConfirmOpen(false)
      setSelected(new Set())
      await fetchBookings()
    } catch {
      setDeleteError('Network error — please try again')
    } finally {
      setDeleting(false)
    }
  }

  const role      = session?.user?.role
  const canCreate = !!role && role !== 'CLIENT'
  const canDelete = role === 'SUPER_ADMIN' || role === 'ULTRA_SUPER_ADMIN'

  function buildPrintUrl(mode: 'full' | 'numbers') {
    const params = new URLSearchParams()
    params.set('mode', mode)
    if (search)                                   params.set('search',        search)
    if (refSearch)                                params.set('refSearch',     refSearch)
    if (contentSearch)                            params.set('contentSearch', contentSearch)
    if (status)                                   params.set('status',        status)
    if (dateFilter)                               params.set('dateFilter',    dateFilter)
    if (dateFilter)                               params.set('dateField',     dateBasis)
    if (dateFrom)                                 params.set('dateFrom',      dateFrom)
    if (dateTo)                                   params.set('dateTo',        dateTo)
    if (countryFilter && countryFilter !== 'ALL') params.set('country',       countryFilter)
    params.set('sortBy',  sortBy)
    params.set('sortDir', sortDir)
    return `/print/bookings-list?${params}`
  }

  async function downloadExcel() {
    setDownloadingExcel(true)
    setShowDownloadMenu(false)
    try {
      const params = new URLSearchParams()
      if (search)                                   params.set('search',        search)
      if (refSearch)                                params.set('refSearch',     refSearch)
      if (contentSearch)                            params.set('contentSearch', contentSearch)
      if (status)                                   params.set('status',        status)
      if (dateFilter)                               params.set('dateFilter',    dateFilter)
      if (dateFilter)                               params.set('dateField',     dateBasis)
      if (dateFrom)                                 params.set('dateFrom',      dateFrom)
      if (dateTo)                                   params.set('dateTo',        dateTo)
      if (countryFilter && countryFilter !== 'ALL') params.set('country',       countryFilter)
      params.set('sortBy',  sortBy)
      params.set('sortDir', sortDir)

      const res = await fetch(`/api/bookings/export?${params}`)
      if (!res.ok) throw new Error('Export failed')
      const blob = await res.blob()
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement('a')
      a.href     = url
      const cd   = res.headers.get('Content-Disposition') ?? ''
      const match = cd.match(/filename="([^"]+)"/)
      a.download = match ? match[1] : 'bookings-export.xlsx'
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      // silently ignore — user will see nothing downloaded
    } finally {
      setDownloadingExcel(false)
    }
  }

  const selectedCount = selected.size
  const selectedBookings = bookings.filter(b => selected.has(b.bookingRef))

  return (
    <div>
      <Header
        title="All Bookings"
        subtitle={`${total} total booking${total !== 1 ? 's' : ''}`}
        actions={
          <div className="flex items-center gap-2">
            {/* Download PDF */}
            <div className="relative" ref={downloadMenuRef}>
              <button
                onClick={() => setShowDownloadMenu(v => !v)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-slate-700 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors"
              >
                <Download className="w-4 h-4" />
                Download PDF
                <ChevronDown className="w-3 h-3" />
              </button>
              {showDownloadMenu && (
                <div className="absolute right-0 top-10 z-30 w-64 bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden">
                  <p className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider px-4 pt-3 pb-1">
                    {total} booking{total !== 1 ? 's' : ''} · current filters
                  </p>
                  <div className="border-t border-slate-100">
                    <button
                      onClick={() => { setShowDownloadMenu(false); window.open(buildPrintUrl('full'), '_blank') }}
                      className="w-full flex items-center gap-2.5 px-4 py-3 hover:bg-slate-50 text-sm text-slate-700 transition-colors text-left"
                    >
                      <FileText className="w-4 h-4 text-slate-400" />
                      <div>
                        <p className="font-semibold">Full Details</p>
                        <p className="text-xs text-slate-400">Names, dates, amounts, status</p>
                      </div>
                    </button>
                    <button
                      onClick={() => { setShowDownloadMenu(false); window.open(buildPrintUrl('numbers'), '_blank') }}
                      className="w-full flex items-center gap-2.5 px-4 py-3 hover:bg-slate-50 text-sm text-slate-700 transition-colors text-left border-t border-slate-100"
                    >
                      <Hash className="w-4 h-4 text-slate-400" />
                      <div>
                        <p className="font-semibold">Numbers Only</p>
                        <p className="text-xs text-slate-400">Booking refs, IS/VN/CNTL numbers</p>
                      </div>
                    </button>
                  </div>
                  <div className="border-t border-slate-200 bg-emerald-50/60">
                    <button
                      onClick={downloadExcel}
                      disabled={downloadingExcel}
                      className="w-full flex items-center gap-2.5 px-4 py-3 hover:bg-emerald-50 text-sm text-emerald-800 transition-colors text-left disabled:opacity-60"
                    >
                      {downloadingExcel
                        ? <Loader2 className="w-4 h-4 text-emerald-600 animate-spin" />
                        : <Table2 className="w-4 h-4 text-emerald-600" />
                      }
                      <div>
                        <p className="font-semibold">{downloadingExcel ? 'Generating…' : 'Excel (.xlsx)'}</p>
                        <p className="text-xs text-emerald-600">4 sheets: summary, flights, hotels, passengers</p>
                      </div>
                    </button>
                  </div>
                </div>
              )}
            </div>

            {canCreate && (
              <Button onClick={() => router.push('/dashboard/bookings/new')} icon={<Plus className="w-4 h-4" />}>
                New Booking
              </Button>
            )}
          </div>
        }
      />

      {/* ── Auto-booking-create daily summary banner ─────────────────── */}
      {todayJob && !bannerDismissed && (
        <div className="mx-8 mt-4 flex items-center gap-3 bg-green-50 border border-green-200 rounded-xl px-4 py-3">
          <CheckCircle2 className="w-5 h-5 text-green-600 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-green-800">
              Today&apos;s auto-import complete —{' '}
              <span className="text-green-700">
                {todayJob.totalCreated} booking{todayJob.totalCreated !== 1 ? 's' : ''} created
              </span>
              {todayJob.totalUpdated > 0 && `, ${todayJob.totalUpdated} updated`}
              {todayJob.totalErrors > 0 && (
                <span className="text-amber-700">, {todayJob.totalErrors} errors</span>
              )}
            </p>
            <p className="text-xs text-green-600 mt-0.5">
              Target date: {new Date(todayJob.targetDate).toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' })}
              {' · '}<Link href="/dashboard/admin/onedrive/bookings" className="underline underline-offset-2">View details</Link>
            </p>
          </div>
          <button onClick={() => setBannerDismissed(true)} className="text-green-500 hover:text-green-700 transition-colors shrink-0">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      <div className="p-8 space-y-5">
        {/* ── Filters ──────────────────────────────────────────────────── */}
        <Card className="p-4 space-y-3">

          {/* Row 1 — Unified search + Status */}
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="text"
                placeholder="Search by ref, VN/IS/SG/MY number, Tour ref, agent, passenger name…"
                value={displaySearch}
                onChange={e => handleUnifiedSearch(e.target.value)}
                className="form-input pl-9 pr-9"
              />
              {displaySearch && (
                <button
                  type="button"
                  onClick={() => { setDisplaySearch(''); setSearch(''); setRefSearch(''); setPage(1) }}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded text-slate-400 hover:text-slate-600"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            <select
              value={status}
              onChange={e => { setStatus(e.target.value); setPage(1) }}
              className="form-select w-full sm:w-52"
            >
              <option value="">All statuses</option>
              {STATUSES.map(s => (
                <option key={s} value={s}>{STATUS_LABELS[s]}</option>
              ))}
            </select>
          </div>

          {/* Row 3 — Content / deep search (hotels, flights, agenda, itinerary) + Created date range */}
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <FileText className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-violet-400" />
              <input
                type="text"
                placeholder="Deep search — hotels, flights, agenda items, itinerary text…"
                value={contentSearch}
                onChange={e => { setContentSearch(e.target.value); setPage(1) }}
                className="form-input pl-9 pr-9 border-violet-200 focus:border-violet-400 focus:ring-violet-200 placeholder:text-violet-300"
              />
              {contentSearch && (
                <button
                  type="button"
                  onClick={() => { setContentSearch(''); setPage(1) }}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded text-slate-400 hover:text-slate-600"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Created date range */}
            <div className="flex items-center gap-2 flex-shrink-0">
              <span className="text-xs text-slate-400 whitespace-nowrap">Created</span>
              <input
                type="date"
                value={dateFrom}
                onChange={e => { setDateFrom(e.target.value); setDateFilter(''); setPage(1) }}
                className="form-input text-sm py-1.5 w-36"
              />
              <span className="text-xs text-slate-400">→</span>
              <input
                type="date"
                value={dateTo}
                onChange={e => { setDateTo(e.target.value); setDateFilter(''); setPage(1) }}
                className="form-input text-sm py-1.5 w-36"
              />
              {(dateFrom || dateTo) && (
                <button
                  onClick={clearDateRange}
                  className="text-xs text-slate-400 hover:text-slate-600 px-1.5"
                >
                  ✕
                </button>
              )}
            </div>
          </div>

          {/* Row 4 — Date period pills + Sort controls */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
            <div className="flex items-center gap-1.5 flex-wrap">
              <Calendar className="w-3.5 h-3.5 text-slate-400 shrink-0 mr-0.5" />
              {DATE_FILTER_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  onClick={() => { setDateFilter(opt.value); setPage(1); if (opt.value) clearDateRange() }}
                  className={`px-3 py-1 rounded-full text-xs font-medium transition-colors border ${
                    dateFilter === opt.value && !dateFrom && !dateTo
                      ? 'bg-brand-600 text-white border-brand-600'
                      : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  {opt.label}
                </button>
              ))}

              {/* Which date the period pills apply to */}
              <span className="text-xs text-slate-400 ml-1.5 whitespace-nowrap">by</span>
              <select
                value={dateBasis}
                onChange={e => { setDateBasis(e.target.value as 'arrivalDate' | 'createdAt'); setPage(1) }}
                className="form-select text-xs py-1 pr-7"
                title="Choose whether the period filter applies to the trip arrival date or the date the booking was added"
              >
                <option value="arrivalDate">Arrival date</option>
                <option value="createdAt">Created date</option>
              </select>
            </div>

            <div className="sm:ml-auto flex items-center gap-2 flex-wrap">
              {/* Per-page selector */}
              <span className="text-xs text-slate-400 whitespace-nowrap">Show</span>
              <select
                value={limit}
                onChange={e => { setLimit(Number(e.target.value)); setPage(1) }}
                className="form-select text-sm py-1.5 pr-8 w-20"
              >
                <option value={20}>20</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
                <option value={200}>200</option>
              </select>

              <span className="text-xs text-slate-300 mx-1">|</span>

              <span className="text-xs text-slate-400 whitespace-nowrap">Sort by</span>
              <select
                value={sortBy}
                onChange={e => { setSortBy(e.target.value as SortField); setSortDir('desc'); setPage(1) }}
                className="form-select text-sm py-1.5 pr-8"
              >
                {SORT_FIELD_OPTIONS.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
              <button
                onClick={() => setSortDir(d => d === 'asc' ? 'desc' : 'asc')}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 text-xs font-medium transition-colors"
              >
                {sortDir === 'asc'
                  ? <><ArrowUp   className="w-3.5 h-3.5" /> Asc</>
                  : <><ArrowDown className="w-3.5 h-3.5" /> Desc</>
                }
              </button>
            </div>
          </div>
        </Card>

        {/* ── Table ──────────────────────────────────────────────────── */}
        <Card>
          {loading ? (
            <div className="flex items-center justify-center h-48">
              <Loader2 className="w-6 h-6 text-brand-500 animate-spin" />
            </div>
          ) : bookings.length === 0 ? (
            isBookingRefSearch || scanState !== 'idle' ? (
              /* ── OneDrive auto-scan progress panel ─────────────────────── */
              <div className="py-10 px-8">
                <div className="max-w-lg mx-auto">

                  {/* Header */}
                  <div className="flex items-start gap-4 mb-8">
                    <div className={`w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0 border transition-all duration-500 ${
                      scanState === 'done'      ? 'bg-emerald-50 border-emerald-200' :
                      scanState === 'error'     ? 'bg-red-50 border-red-200' :
                      scanState === 'not_found' ? 'bg-amber-50 border-amber-200' :
                                                  'bg-brand-50 border-brand-100'
                    }`}>
                      {scanState === 'done'      ? <CheckCircle2 className="w-6 h-6 text-emerald-500" /> :
                       scanState === 'error'     ? <AlertCircle  className="w-6 h-6 text-red-500" /> :
                       scanState === 'not_found' ? <FolderOpen   className="w-6 h-6 text-amber-500" /> :
                       scanState === 'scanning'  ? <Cloud        className="w-6 h-6 text-brand-500 animate-pulse" /> :
                                                   <Cloud        className="w-6 h-6 text-brand-400" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-base font-semibold text-slate-800">
                        {scanState === 'done'      ? 'Booking imported successfully!' :
                         scanState === 'not_found' ? 'Booking not found in OneDrive' :
                         scanState === 'error'     ? 'Scan encountered an error' :
                         scanState === 'scanning'  ? `Scanning OneDrive for ${scanBookingRef ?? normalizedSearch.toUpperCase()}…` :
                                                     `Preparing to scan for ${normalizedSearch.toUpperCase()}`}
                      </p>
                      <p className="text-sm text-slate-400 mt-0.5">
                        {scanState === 'done'      ? `${scanBookingRef} was found and created in the system` :
                         scanState === 'not_found' ? `No folder matching ${scanBookingRef} was found across all drives` :
                         scanState === 'error'     ? (scanError ?? 'Something went wrong during the scan') :
                         scanState === 'scanning'  ? 'This usually takes 10–30 seconds depending on file sizes' :
                                                     'Auto-scan will begin shortly…'}
                      </p>
                    </div>
                  </div>

                  {/* Step list */}
                  <div className="space-y-3 mb-8">
                    {SCAN_STEPS.map((step, i) => {
                      const isCompleted = scanState === 'done' || i < scanStep
                      const isActive    = i === scanStep && (scanState === 'scanning')
                      const isError     = i === scanStep && scanState === 'error'
                      const isPending   = !isCompleted && !isActive && !isError
                      return (
                        <div
                          key={i}
                          className={`flex items-start gap-3 transition-all duration-300 ${
                            isPending && scanState === 'scanning' ? 'opacity-40' : 'opacity-100'
                          }`}
                        >
                          <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 border transition-all duration-300 ${
                            isCompleted ? 'bg-emerald-50 border-emerald-200' :
                            isActive    ? 'bg-brand-50 border-brand-200' :
                            isError     ? 'bg-red-50 border-red-200' :
                                          'bg-slate-50 border-slate-200'
                          }`}>
                            {isCompleted ? (
                              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                            ) : isActive ? (
                              <Loader2 className="w-3.5 h-3.5 text-brand-500 animate-spin" />
                            ) : isError ? (
                              <AlertCircle className="w-3.5 h-3.5 text-red-500" />
                            ) : (
                              <div className="w-2 h-2 rounded-full bg-slate-300" />
                            )}
                          </div>

                          <div className="flex-1 pt-0.5 min-w-0">
                            <p className={`text-sm font-medium transition-colors ${
                              isCompleted ? 'text-emerald-700' :
                              isActive    ? 'text-brand-700' :
                              isError     ? 'text-red-600' :
                                            'text-slate-400'
                            }`}>{step.label}</p>
                            {(isActive || isCompleted) && (
                              <p className="text-xs text-slate-400 mt-0.5 leading-relaxed">{step.desc}</p>
                            )}
                          </div>

                          {isActive && (
                            <div className="flex-shrink-0 pt-1">
                              {i === 0 && <Cloud        className="w-4 h-4 text-brand-300" />}
                              {i === 1 && <FolderOpen   className="w-4 h-4 text-brand-300" />}
                              {i === 2 && <Sparkles     className="w-4 h-4 text-brand-300" />}
                              {i === 3 && <MapPin       className="w-4 h-4 text-brand-300" />}
                              {i === 4 && <CheckCircle2 className="w-4 h-4 text-emerald-300" />}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>

                  {/* Done action bar */}
                  {scanState === 'done' && (
                    <div className="flex items-center gap-3 p-4 bg-emerald-50 border border-emerald-100 rounded-2xl">
                      <CheckCircle2 className="w-5 h-5 text-emerald-500 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-emerald-800">Booking ready</p>
                        <p className="text-xs text-emerald-600 mt-0.5">Loading booking list…</p>
                      </div>
                      <Link
                        href={`/dashboard/bookings/${scanBookingRef}`}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold rounded-xl transition-colors whitespace-nowrap"
                      >
                        View Booking <ArrowRight className="w-3.5 h-3.5" />
                      </Link>
                    </div>
                  )}

                  {/* Not found action bar */}
                  {scanState === 'not_found' && (
                    <div className="space-y-3">
                      <div className="p-4 bg-amber-50 border border-amber-100 rounded-2xl">
                        <p className="text-sm font-semibold text-amber-800 mb-1">Not found in OneDrive</p>
                        <p className="text-xs text-amber-700 leading-relaxed">
                          No folder for <span className="font-mono font-semibold">{scanBookingRef}</span> was found across any configured drive.
                          Make sure the folder is named correctly (e.g.{' '}
                          <span className="font-mono">{scanBookingRef} - Client Name</span>).
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setScanState('idle')}
                          className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-600 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors"
                        >
                          <RefreshCw className="w-3.5 h-3.5" /> Retry Scan
                        </button>
                        {canCreate && (
                          <button
                            onClick={() => router.push('/dashboard/bookings/new')}
                            className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-white bg-brand-600 hover:bg-brand-500 rounded-xl transition-colors"
                          >
                            <Plus className="w-3.5 h-3.5" /> Create Manually
                          </button>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Error action bar */}
                  {scanState === 'error' && (
                    <div className="space-y-3">
                      <div className="p-4 bg-red-50 border border-red-100 rounded-2xl">
                        <p className="text-sm font-semibold text-red-800 mb-1">Scan failed</p>
                        <p className="text-xs text-red-700">{scanError ?? 'An unexpected error occurred.'}</p>
                      </div>
                      <button
                        onClick={() => setScanState('idle')}
                        className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-600 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors"
                      >
                        <RefreshCw className="w-3.5 h-3.5" /> Try Again
                      </button>
                    </div>
                  )}

                </div>
              </div>
            ) : (
              /* ── Regular empty state ───────────────────────────────────── */
              <div className="flex flex-col items-center justify-center h-48 text-slate-400">
                <FileText className="w-10 h-10 mb-3 opacity-30" />
                <p className="text-sm font-medium">No bookings found</p>
                {canCreate && (
                  <Link href="/dashboard/bookings/new" className="mt-3 text-sm text-brand-600 hover:underline">
                    Create your first booking
                  </Link>
                )}
              </div>
            )
          ) : (
            <>
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    {/* Select-all checkbox — only visible to admins */}
                    {canDelete && (
                      <th className="w-10">
                        <input
                          type="checkbox"
                          checked={allSelected}
                          ref={el => { if (el) el.indeterminate = someSelected && !allSelected }}
                          onChange={toggleAll}
                          className="w-4 h-4 rounded border-slate-300 text-brand-600 cursor-pointer"
                          title="Select all on this page"
                        />
                      </th>
                    )}
                    <th>Booking / Numbers</th>
                    <th>Country</th>
                    <th>Lead Passenger</th>
                    <th>Agent</th>
                    <th>
                      <button className="flex items-center whitespace-nowrap hover:text-brand-700 transition-colors" onClick={() => toggleSort('arrivalDate')}>
                        Arrival <SortIcon field="arrivalDate" sortBy={sortBy} sortDir={sortDir} />
                      </button>
                    </th>
                    <th>
                      <button className="flex items-center whitespace-nowrap hover:text-brand-700 transition-colors" onClick={() => toggleSort('departureDate')}>
                        Departure <SortIcon field="departureDate" sortBy={sortBy} sortDir={sortDir} />
                      </button>
                    </th>
                    <th>Pax</th>
                    {!contentSearch && <th>Status</th>}
                    <th>
                      <button className="flex items-center whitespace-nowrap hover:text-brand-700 transition-colors" onClick={() => toggleSort('createdAt')}>
                        Created <SortIcon field="createdAt" sortBy={sortBy} sortDir={sortDir} />
                      </button>
                    </th>
                    {!contentSearch && <th>Agenda</th>}
                    {contentSearch && <th className="text-violet-600">Matched in</th>}
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {bookings.map(b => {
                    const lead       = b.passengers.find(p => p.isLead) ?? b.passengers[0]
                    const isSelected = selected.has(b.bookingRef)
                    const snippets   = getMatchSnippets(b, contentSearch)
                    return (
                      <tr
                        key={b.id}
                        className={`cursor-pointer hover:bg-slate-50 transition-colors ${isSelected ? 'bg-red-50/60' : ''}`}
                        onClick={() => router.push(`/dashboard/bookings/${b.bookingRef}`)}
                      >
                        {/* Per-row checkbox */}
                        {canDelete && (
                          <td onClick={e => e.stopPropagation()}>
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => toggleOne(b.bookingRef)}
                              className="w-4 h-4 rounded border-slate-300 text-brand-600 cursor-pointer"
                            />
                          </td>
                        )}

                        {/* Booking ref + all numbers */}
                        <td onClick={e => e.stopPropagation()}>
                          <Link href={`/dashboard/bookings/${b.bookingRef}`} className="font-semibold text-slate-900 font-mono hover:text-brand-600">
                            {b.bookingRef}
                          </Link>
                          <div className="flex flex-wrap gap-1 mt-1">
                            {b.isNumber && (
                              <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-mono bg-blue-50 text-blue-600 border border-blue-100">
                                IS: {b.isNumber}
                              </span>
                            )}
                            {b.agentBookingId && (
                              <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-mono bg-purple-50 text-purple-600 border border-purple-100">
                                ID: {b.agentBookingId}
                              </span>
                            )}
                            {b._count.changeRequests > 0 && (
                              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-orange-100 text-orange-700">
                                {b._count.changeRequests} change{b._count.changeRequests > 1 ? 's' : ''}
                              </span>
                            )}
                          </div>
                        </td>

                        {/* Country */}
                        <td>
                          {b.operationCountry && COUNTRY_BADGE[b.operationCountry] ? (
                            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-none text-[11px] font-medium border ${COUNTRY_BADGE[b.operationCountry].color}`}>
                              <CountryFlag country={b.operationCountry} className="w-4 h-3" /> {COUNTRY_BADGE[b.operationCountry].label}
                            </span>
                          ) : (
                            <span className="text-xs text-slate-300">—</span>
                          )}
                        </td>

                        {/* Lead passenger */}
                        <td>{lead?.name ?? '—'}</td>

                        {/* Agent */}
                        <td className="text-slate-500 text-xs">{b.agent ?? '—'}</td>

                        {/* Arrival */}
                        <td>
                          <div className="flex items-center gap-1 text-xs text-slate-600">
                            <Calendar className="w-3 h-3 flex-shrink-0" />
                            {formatDate(b.arrivalDate)}
                          </div>
                        </td>

                        {/* Departure */}
                        <td>
                          <div className="flex items-center gap-1 text-xs text-slate-600">
                            <Calendar className="w-3 h-3 flex-shrink-0" />
                            {formatDate(b.departureDate)}
                          </div>
                        </td>

                        {/* Pax */}
                        <td>
                          <div className="flex items-center gap-1 text-xs text-slate-600">
                            <Users className="w-3 h-3" />
                            {b.paxAdults + b.paxChildren}
                          </div>
                        </td>

                        {/* Status — hidden during deep search */}
                        {!contentSearch && (
                          <td><StatusBadge className="rounded-none" status={b.status} /></td>
                        )}

                        {/* Created */}
                        <td>
                          <div className="flex items-center gap-1 text-xs text-slate-500 whitespace-nowrap">
                            <Clock className="w-3 h-3 flex-shrink-0" />
                            {formatDateTime(b.createdAt)}
                          </div>
                        </td>

                        {/* Agenda — hidden during deep search */}
                        {!contentSearch && (
                          <td onClick={e => e.stopPropagation()}>
                            {b.tourAgenda ? (
                              <Link
                                href={`/dashboard/bookings/${b.bookingRef}/agenda`}
                                className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 bg-blue-50 px-2 py-0.5 rounded-full border border-blue-200 hover:bg-blue-100 transition-colors"
                              >
                                <MapPin className="w-3 h-3" /> Agenda
                              </Link>
                            ) : (
                              <Link
                                href={`/dashboard/bookings/${b.bookingRef}/agenda`}
                                className="inline-flex items-center gap-1 text-xs font-medium text-slate-400 bg-slate-50 px-2 py-0.5 rounded-full border border-slate-200 hover:bg-slate-100 transition-colors"
                              >
                                <MapPin className="w-3 h-3" /> View
                              </Link>
                            )}
                          </td>
                        )}

                        {/* Matched in — shown only during deep search */}
                        {contentSearch && (
                          <td onClick={e => e.stopPropagation()} className="max-w-[280px]">
                            {snippets.length === 0 ? (
                              <span className="text-xs text-slate-300 italic">—</span>
                            ) : (
                              <div className="flex flex-col gap-1">
                                {snippets.map((s, si) => (
                                  <span
                                    key={si}
                                    className={`inline-flex items-start gap-1 px-2 py-1 rounded border text-[11px] leading-snug ${SNIPPET_STYLE[s.type]}`}
                                  >
                                    <span className="flex-shrink-0 text-[10px] mt-0.5">{SNIPPET_ICON[s.type]}</span>
                                    <span className="font-semibold flex-shrink-0">{s.label}:</span>
                                    <span className="break-words min-w-0">
                                      <Highlight text={s.text} query={contentSearch} />
                                    </span>
                                  </span>
                                ))}
                              </div>
                            )}
                          </td>
                        )}

                        <td>
                          <ArrowRight className="w-4 h-4 text-slate-300" />
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {/* ── Pagination bar ─────────────────────────────────────────── */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between px-5 py-3 border-t border-slate-100 bg-slate-50/60">
                <p className="text-xs text-slate-500">
                  Showing <span className="font-medium text-slate-700">{pageFrom}–{pageTo}</span> of <span className="font-medium text-slate-700">{total}</span> bookings
                </p>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setPage(1)}
                    disabled={page === 1}
                    className="px-2 py-1 text-xs rounded border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    «
                  </button>
                  <button
                    onClick={() => setPage(p => Math.max(1, p - 1))}
                    disabled={page === 1}
                    className="flex items-center gap-0.5 px-2 py-1 text-xs rounded border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    <ChevronLeft className="w-3.5 h-3.5" /> Prev
                  </button>

                  {/* Page number pills */}
                  {Array.from({ length: totalPages }, (_, i) => i + 1)
                    .filter(p => p === 1 || p === totalPages || Math.abs(p - page) <= 2)
                    .reduce<(number | '…')[]>((acc, p, i, arr) => {
                      if (i > 0 && p - (arr[i - 1] as number) > 1) acc.push('…')
                      acc.push(p)
                      return acc
                    }, [])
                    .map((p, i) =>
                      p === '…' ? (
                        <span key={`ellipsis-${i}`} className="px-2 text-xs text-slate-400">…</span>
                      ) : (
                        <button
                          key={p}
                          onClick={() => setPage(p as number)}
                          className={`w-8 h-7 text-xs rounded border transition-colors ${
                            page === p
                              ? 'bg-brand-600 text-white border-brand-600 font-semibold'
                              : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                          }`}
                        >
                          {p}
                        </button>
                      )
                    )
                  }

                  <button
                    onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                    disabled={page === totalPages}
                    className="flex items-center gap-0.5 px-2 py-1 text-xs rounded border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    Next <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => setPage(totalPages)}
                    disabled={page === totalPages}
                    className="px-2 py-1 text-xs rounded border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    »
                  </button>
                </div>
              </div>
            )}

            {/* Always-visible page count when only 1 page */}
            {totalPages === 1 && total > 0 && (
              <div className="px-5 py-2.5 border-t border-slate-100 bg-slate-50/60">
                <p className="text-xs text-slate-400">
                  Showing all <span className="font-medium text-slate-600">{total}</span> booking{total !== 1 ? 's' : ''}
                </p>
              </div>
            )}
            </>
          )}
        </Card>
      </div>

      {/* ── Floating selection action bar ───────────────────────────────────── */}
      {canDelete && selectedCount > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 flex items-center gap-4 px-5 py-3 bg-slate-900 text-white rounded-2xl shadow-2xl border border-slate-700 animate-slide-up">
          <span className="text-sm font-medium">
            {selectedCount} booking{selectedCount !== 1 ? 's' : ''} selected
          </span>
          <button
            onClick={() => setSelected(new Set())}
            className="text-xs text-slate-400 hover:text-white transition-colors"
          >
            Clear
          </button>
          <button
            onClick={() => { setDeleteError(null); setConfirmOpen(true) }}
            className="flex items-center gap-2 px-4 py-1.5 bg-red-600 hover:bg-red-500 text-white text-sm font-medium rounded-xl transition-colors"
          >
            <Trash2 className="w-4 h-4" />
            Delete {selectedCount}
          </button>
        </div>
      )}

      {/* ── Confirm delete modal ─────────────────────────────────────────────── */}
      <Modal
        open={confirmOpen}
        onClose={() => !deleting && setConfirmOpen(false)}
        title="Delete Bookings"
        size="sm"
        footer={
          <>
            <button
              onClick={() => setConfirmOpen(false)}
              disabled={deleting}
              className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 disabled:opacity-50 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleBulkDelete}
              disabled={deleting}
              className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-500 text-white text-sm font-medium rounded-xl disabled:opacity-60 transition-colors"
            >
              {deleting
                ? <><Loader2 className="w-4 h-4 animate-spin" /> Deleting…</>
                : <><Trash2 className="w-4 h-4" /> Delete {selectedCount}</>
              }
            </button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="flex items-start gap-3 p-3 bg-red-50 rounded-xl border border-red-100">
            <AlertTriangle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-red-700">
              This will <strong>permanently delete</strong> {selectedCount} booking{selectedCount !== 1 ? 's' : ''} and all associated data (passengers, flights, hotels, agenda, PNL). This cannot be undone.
            </p>
          </div>

          {deleteError && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {deleteError}
            </p>
          )}

          <div className="max-h-52 overflow-y-auto space-y-1">
            {selectedBookings.map(b => {
              const lead = b.passengers.find(p => p.isLead) ?? b.passengers[0]
              return (
                <div key={b.bookingRef} className="flex items-center justify-between px-3 py-2 rounded-lg bg-slate-50 border border-slate-100 text-sm">
                  <span className="font-mono font-semibold text-slate-800">{b.bookingRef}</span>
                  <span className="text-slate-500 text-xs truncate max-w-[140px]">{lead?.name ?? b.agent ?? '—'}</span>
                </div>
              )
            })}
          </div>
        </div>
      </Modal>
    </div>
  )
}

export default function BookingsPage() {
  return (
    <Suspense fallback={<div className="flex justify-center h-64"><div className="w-6 h-6 border-2 border-brand-500 border-t-transparent rounded-full animate-spin mt-20" /></div>}>
      <BookingsPageInner />
    </Suspense>
  )
}
