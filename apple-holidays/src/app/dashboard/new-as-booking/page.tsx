'use client'

import { Suspense, useCallback, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Search, Loader2, PlusCircle, CheckCircle2, Clock, AlertCircle, Calendar, Users,
  MapPin, Hash, ArrowRight, PackagePlus, ExternalLink, FileSearch, X,
} from 'lucide-react'
import Header from '@/components/layout/header'
import { Card } from '@/components/ui/card'
import { readApiResponse } from '@/lib/utils'

type SearchBy = 'is_number' | 'quotation_no'
type StatusOpt = '2' | 'all'

interface ASResult {
  id: number
  quotation_no: string
  reference_id: string
  reference_id_full?: string[]
  status: string
  status_class: string
  country_name: string | null
  currency: string | null
  created_iso?: string | null
  main?: { arrival_year?: string; arrival_month?: string; arrival_day?: string }
  pax?: { adult?: string; cwb?: string; cnb?: string }
  is_ref: string | null
  imported: boolean
}

interface ImportState { busy?: boolean; ref?: string; error?: string }

const COUNTRY_STYLE: Record<string, string> = {
  Vietnam:    'bg-red-500/10 text-red-600 border-red-500/20',
  'Sri Lanka':'bg-yellow-500/10 text-yellow-600 border-yellow-500/20',
  Singapore:  'bg-blue-500/10 text-blue-600 border-blue-500/20',
  Malaysia:   'bg-emerald-500/10 text-emerald-600 border-emerald-500/20',
}
function countryStyle(name: string | null): string {
  return (name && COUNTRY_STYLE[name]) || 'bg-slate-500/10 text-slate-500 border-slate-500/20'
}
function isConfirmed(b: ASResult) { return b.status === '2' || b.status_class === 'confirm' }
function arrivalDate(b: ASResult): string {
  const m = b.main
  if (!m?.arrival_year || !m?.arrival_month || !m?.arrival_day) return '—'
  const d = new Date(Number(m.arrival_year), Number(m.arrival_month) - 1, Number(m.arrival_day))
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}
function createdDate(b: ASResult): string {
  if (!b.created_iso) return '—'
  const d = new Date(b.created_iso)
  return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}
function paxTotal(b: ASResult): number {
  const p = b.pax
  return p ? Number(p.adult ?? 0) + Number(p.cwb ?? 0) + Number(p.cnb ?? 0) : 0
}
function cntlNumber(b: ASResult): string | null {
  return b.reference_id_full?.find((r) => /CNTL/i.test(r)) ?? null
}

function NewASBookingInner() {
  const router = useRouter()
  const [searchBy, setSearchBy] = useState<SearchBy>('is_number')
  const [status, setStatus] = useState<StatusOpt>('2')
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<ASResult[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [imports, setImports] = useState<Record<number, ImportState>>({})

  const runSearch = useCallback(async () => {
    const q = query.trim()
    if (!q) return
    setLoading(true); setError(null); setResults(null); setImports({})
    try {
      const params = new URLSearchParams({ status })
      params.set(searchBy, q)
      const res = await fetch(`/api/as-bookings-v2/search?${params.toString()}`)
      const json = await readApiResponse<{ bookings: ASResult[] }>(res)
      if (!json.success || !json.data) { setError(json.error ?? 'Search failed'); return }
      setResults(json.data.bookings)
    } catch {
      setError('Network error — could not reach AppleSystem')
    } finally {
      setLoading(false)
    }
  }, [query, searchBy, status])

  const importOne = useCallback(async (b: ASResult) => {
    setImports((s) => ({ ...s, [b.id]: { busy: true } }))
    try {
      const res = await fetch('/api/as-bookings-v2/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quotation_no: b.quotation_no, reference_id: String(b.reference_id ?? b.id) }),
      })
      const json = await readApiResponse<{ bookingRef: string; alreadyExists: boolean }>(res)
      if (!json.success || !json.data) {
        setImports((s) => ({ ...s, [b.id]: { error: json.error ?? 'Import failed' } }))
        return
      }
      setImports((s) => ({ ...s, [b.id]: { ref: json.data!.bookingRef } }))
    } catch {
      setImports((s) => ({ ...s, [b.id]: { error: 'Network error while importing' } }))
    }
  }, [])

  const placeholder = searchBy === 'is_number'
    ? 'e.g. VN 40659  or  IS 12345'
    : 'e.g. 477171'

  return (
    <div>
      <Header
        title={
          <span className="flex items-center gap-2">
            <PlusCircle className="w-5 h-5 text-brand-500" />
            New Booking · AppleSystem
          </span>
        }
        subtitle="Find a confirmed AppleSystem quotation by IS number and import it into the system"
      />

      <div className="p-4 sm:p-8 space-y-5">
        {/* ── Search panel ─────────────────────────────────────────────── */}
        <Card className="p-4 sm:p-5 space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="inline-flex rounded-xl bg-slate-100 p-1">
              {([['is_number', 'IS Number'], ['quotation_no', 'Quotation No']] as const).map(([val, label]) => (
                <button
                  key={val}
                  onClick={() => setSearchBy(val)}
                  className={`px-3.5 py-1.5 rounded-lg text-sm font-medium transition-all ${
                    searchBy === val ? 'bg-white text-brand-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="inline-flex rounded-xl bg-slate-100 p-1">
              {([['2', 'Confirmed only'], ['all', 'Any status']] as const).map(([val, label]) => (
                <button
                  key={val}
                  onClick={() => setStatus(val)}
                  className={`px-3.5 py-1.5 rounded-lg text-sm font-medium transition-all ${
                    status === val ? 'bg-white text-brand-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="text"
                autoFocus
                placeholder={placeholder}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') runSearch() }}
                className="form-input pl-9 pr-9"
              />
              {query && (
                <button
                  onClick={() => setQuery('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded text-slate-400 hover:text-slate-600"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            <button
              onClick={runSearch}
              disabled={loading || !query.trim()}
              className="flex items-center justify-center gap-1.5 px-5 py-2 text-sm font-semibold text-white bg-brand-600 hover:bg-brand-500 rounded-xl transition-colors disabled:opacity-60"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
              Search
            </button>
          </div>
        </Card>

        {/* ── Results ──────────────────────────────────────────────────── */}
        {loading ? (
          <Card className="flex items-center justify-center h-56">
            <div className="flex flex-col items-center gap-3 text-slate-400">
              <Loader2 className="w-7 h-7 text-brand-500 animate-spin" />
              <p className="text-sm">Searching AppleSystem…</p>
            </div>
          </Card>
        ) : error ? (
          <Card className="flex flex-col items-center justify-center h-56 text-center px-6">
            <AlertCircle className="w-10 h-10 text-red-400 mb-3" />
            <p className="text-sm font-semibold text-slate-700">Search failed</p>
            <p className="text-xs text-slate-400 mt-1 max-w-sm">{error}</p>
            <button
              onClick={runSearch}
              className="mt-4 flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-white bg-brand-600 hover:bg-brand-500 rounded-xl transition-colors"
            >
              <Search className="w-3.5 h-3.5" /> Try again
            </button>
          </Card>
        ) : results === null ? (
          <Card className="flex flex-col items-center justify-center h-56 text-slate-400 text-center px-6">
            <FileSearch className="w-10 h-10 mb-3 opacity-30" />
            <p className="text-sm font-medium">Search for a booking to begin</p>
            <p className="text-xs mt-1">Enter an IS number (or quotation number) above, then press Search.</p>
          </Card>
        ) : results.length === 0 ? (
          <Card className="flex flex-col items-center justify-center h-56 text-slate-400 text-center px-6">
            <FileSearch className="w-10 h-10 mb-3 opacity-30" />
            <p className="text-sm font-medium">No matching bookings</p>
            <p className="text-xs mt-1">
              Nothing found for <span className="font-mono text-slate-500">{query.trim()}</span>
              {status === '2' ? ' among confirmed bookings.' : '.'}
            </p>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {results.map((b) => (
              <ResultCard
                key={b.id}
                booking={b}
                state={imports[b.id]}
                onImport={() => importOne(b)}
                onView={() => router.push(
                  `/dashboard/as-bookings-v2/${encodeURIComponent(String(b.id))}?` +
                  new URLSearchParams({ quotation_no: b.quotation_no, status: b.status, ...(b.country_name ? { country_name: b.country_name } : {}) }).toString(),
                )}
                onOpenBooking={(ref) => router.push(`/dashboard/bookings/${encodeURIComponent(ref)}`)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function StatusChip({ booking }: { booking: ASResult }) {
  const confirmed = isConfirmed(booking)
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold border ${
      confirmed ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-amber-50 text-amber-700 border-amber-200'
    }`}>
      {confirmed ? <CheckCircle2 className="w-3 h-3" /> : <Clock className="w-3 h-3" />}
      {confirmed ? 'Confirmed' : 'Unconfirmed'}
    </span>
  )
}

function ResultCard({ booking, state, onImport, onView, onOpenBooking }: {
  booking: ASResult
  state?: ImportState
  onImport: () => void
  onView: () => void
  onOpenBooking: (ref: string) => void
}) {
  const cntl = cntlNumber(booking)
  const importedRef = state?.ref ?? (booking.imported ? booking.is_ref ?? undefined : undefined)

  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-4 hover:shadow-md transition-all flex flex-col">
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="min-w-0">
          <p className="font-mono font-bold text-slate-900 text-lg leading-none">{booking.is_ref ?? booking.quotation_no}</p>
          <p className="text-[11px] text-slate-400 mt-1">quotation {booking.quotation_no}</p>
        </div>
        <StatusChip booking={booking} />
      </div>

      <div className="flex flex-wrap gap-1.5 mb-3">
        {booking.country_name && (
          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium border ${countryStyle(booking.country_name)}`}>
            <MapPin className="w-3 h-3" /> {booking.country_name}
          </span>
        )}
        {cntl && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-mono bg-purple-50 text-purple-600 border border-purple-100">
            <Hash className="w-3 h-3" /> {cntl}
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-y-2 gap-x-3 text-xs text-slate-600 border-t border-slate-100 pt-3">
        <span className="flex items-center gap-1.5"><Calendar className="w-3.5 h-3.5 text-slate-400" /> {arrivalDate(booking)}</span>
        <span className="flex items-center gap-1.5"><Users className="w-3.5 h-3.5 text-slate-400" /> {paxTotal(booking)} pax</span>
        <span className="col-span-2 flex items-center gap-1.5 text-[11px] text-slate-400"><Clock className="w-3 h-3" /> Created {createdDate(booking)}</span>
      </div>

      {state?.error && (
        <p className="mt-3 flex items-start gap-1.5 text-[11px] text-rose-600">
          <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-px" /> {state.error}
        </p>
      )}

      <div className="mt-4 flex items-center gap-2">
        <button
          onClick={onView}
          className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold text-brand-700 bg-brand-50 border border-brand-100 hover:bg-brand-100 transition-colors"
        >
          View <ArrowRight className="w-3.5 h-3.5" />
        </button>
        {importedRef ? (
          <button
            onClick={() => onOpenBooking(importedRef)}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 transition-colors"
          >
            <ExternalLink className="w-3.5 h-3.5" /> Open {importedRef}
          </button>
        ) : (
          <button
            onClick={onImport}
            disabled={state?.busy}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-500 transition-colors disabled:opacity-60"
          >
            {state?.busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <PackagePlus className="w-3.5 h-3.5" />}
            Import
          </button>
        )}
      </div>
    </div>
  )
}

export default function NewASBookingPage() {
  return (
    <Suspense fallback={<div className="flex justify-center h-64"><div className="w-6 h-6 border-2 border-brand-500 border-t-transparent rounded-full animate-spin mt-20" /></div>}>
      <NewASBookingInner />
    </Suspense>
  )
}
