'use client'

/**
 * Aahaas B2B (Flights) — the confirmed-orders board.
 *
 * Reads `b2b_bookings` and its four component tables straight from the Aahaas
 * B2B schema (read-only; there is no write path anywhere in this feature) and
 * shows only orders whose header status is `confirmed`.
 *
 * The row is deliberately not a table cell grid: a B2B order is a bundle
 * (flight + hotel + insurance + experience), so each row is a boarding-pass-like
 * strip — reference and agent on the left, the route ribbon in the middle,
 * money on the right, component chips underneath.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  AlertTriangle, ArrowRight, BedDouble, CalendarDays, ChevronLeft, ChevronRight,
  Database, Loader2, Plane, RefreshCw, Search, Shield, ShieldCheck, Sparkles,
  Ticket, Users, Wallet,
} from 'lucide-react'
import Header from '@/components/layout/header'

// ─── Types (mirror /api/b2b-flights) ──────────────────────────────────────────

interface Summary {
  id: number
  uuid: string | null
  reference: string
  type: string | null
  orderId: number | null
  amount: number | null
  currency: string | null
  status: string | null
  orderStatus: string | null
  paymentStatus: string | null
  paymentMethod: string | null
  paymentReference: string | null
  createdAt: string | null
  agentName: string | null
  agentEmail: string | null
  leadTraveller: string | null
  components: { flights: number; hotels: number; insurances: number; lifestyles: number }
  routes: string[]
  travelDate: string | null
  pnrs: string[]
  pax: number | null
}

interface ListPayload {
  configured: boolean
  database: string | null
  bookings: Summary[]
  total: number
  stats: {
    confirmed: number
    grossByCurrency: { currency: string; amount: number; count: number }[]
    componentTotals: { flights: number; hotels: number; insurances: number; lifestyles: number }
    last30Days: number
  }
  warnings: string[]
  error: string | null
}

const PAGE_SIZE = 25

const COMPONENT_FILTERS = [
  { value: 'all',        label: 'All components' },
  { value: 'flights',    label: 'Flights' },
  { value: 'hotels',     label: 'Hotels' },
  { value: 'insurances', label: 'Insurance' },
  { value: 'lifestyles', label: 'Experiences' },
] as const

const PAYMENT_FILTERS = [
  { value: 'all',       label: 'Any payment' },
  { value: 'confirmed', label: 'Paid' },
  { value: 'pending',   label: 'Pending' },
  { value: 'failed',    label: 'Failed' },
] as const

function money(v: number | null, currency: string | null): string {
  if (v === null || !Number.isFinite(v)) return '—'
  return `${currency ?? ''} ${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`.trim()
}

function shortDate(v: string | null): string {
  if (!v) return '—'
  const d = new Date(v.length <= 10 ? `${v}T00:00:00Z` : v.replace(' ', 'T') + 'Z')
  if (Number.isNaN(d.getTime())) return v
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' })
}

function paymentTone(status: string | null): string {
  const v = (status ?? '').toLowerCase()
  if (v === 'confirmed' || v === 'paid') return 'bg-emerald-50 text-emerald-700 border-emerald-200'
  if (v === 'pending') return 'bg-amber-50 text-amber-700 border-amber-200'
  if (v === 'failed') return 'bg-rose-50 text-rose-700 border-rose-200'
  return 'bg-slate-50 text-slate-600 border-slate-200'
}

export default function B2bFlightsPage() {
  const router = useRouter()
  const [data, setData] = useState<ListPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState<string | null>(null)

  const [search, setSearch] = useState('')
  const [debounced, setDebounced] = useState('')
  const [component, setComponent] = useState<string>('all')
  const [paymentStatus, setPaymentStatus] = useState<string>('all')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [page, setPage] = useState(0)

  // Debounce the search box so typing a PNR does not fire a query per keystroke.
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => { setDebounced(search); setPage(0) }, 350)
    return () => { if (timer.current) clearTimeout(timer.current) }
  }, [search])

  const load = useCallback(async () => {
    setLoading(true)
    setFetchError(null)
    try {
      const qs = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String(page * PAGE_SIZE),
        component,
        paymentStatus,
      })
      if (debounced.trim()) qs.set('search', debounced.trim())
      if (from) qs.set('from', from)
      if (to) qs.set('to', to)

      const res = await fetch(`/api/b2b-flights?${qs.toString()}`, { cache: 'no-store' })
      const json = await res.json()
      if (!json.success) throw new Error(json.error || 'Request failed')
      setData(json.data as ListPayload)
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : 'Failed to load B2B bookings')
    } finally {
      setLoading(false)
    }
  }, [page, component, paymentStatus, debounced, from, to])

  useEffect(() => { void load() }, [load])

  const totalPages = useMemo(
    () => (data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1),
    [data],
  )

  const stats = data?.stats
  const banner = fetchError ?? data?.error ?? null

  return (
    <div className="min-h-screen bg-slate-50">
      <Header
        title={
          <span className="flex items-center gap-2">
            <Plane className="w-5 h-5 text-sky-600" />
            Aahaas B2B <span className="text-slate-400 font-normal">(Flights)</span>
          </span>
        }
        subtitle={
          <span className="flex items-center gap-2 text-xs">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
            Confirmed agent bookings, read directly from
            <code className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">{data?.database ?? 'the B2B schema'}</code>
            <span className="text-emerald-700 font-medium">· read-only</span>
          </span>
        }
        actions={
          <button
            onClick={() => void load()}
            disabled={loading}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            Refresh
          </button>
        }
      />

      <div className="px-4 sm:px-8 py-6 space-y-6">
        {banner && (
          <div className="flex items-start gap-3 p-4 rounded-xl border border-rose-200 bg-rose-50 text-rose-800">
            <AlertTriangle className="w-5 h-5 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-sm">Could not read the B2B store</p>
              <p className="text-xs mt-0.5 break-words">{banner}</p>
            </div>
          </div>
        )}

        {data && !data.configured && (
          <div className="flex items-start gap-3 p-4 rounded-xl border border-amber-200 bg-amber-50 text-amber-900">
            <Database className="w-5 h-5 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-sm">B2B database is not configured</p>
              <p className="text-xs mt-0.5">Set <code>DB_DATABASE_B2B</code> (it falls back to <code>DB_DATABASE_B2C</code>) alongside the existing host and credentials.</p>
            </div>
          </div>
        )}

        {data?.warnings?.map((w) => (
          <div key={w} className="flex items-start gap-3 p-3 rounded-lg border border-slate-200 bg-white text-slate-600 text-xs">
            <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5 text-amber-500" />
            <span>{w}</span>
          </div>
        ))}

        {/* ── Stat band ───────────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatTile
            icon={<Ticket className="w-4 h-4" />}
            label="Confirmed bookings"
            value={stats ? stats.confirmed.toLocaleString() : '—'}
            hint={stats ? `${stats.last30Days.toLocaleString()} in the last 30 days` : undefined}
            tone="sky"
          />
          <StatTile
            icon={<Wallet className="w-4 h-4" />}
            label="Gross value"
            value={
              stats?.grossByCurrency.length
                ? money(stats.grossByCurrency[0].amount, stats.grossByCurrency[0].currency)
                : '—'
            }
            hint={
              stats && stats.grossByCurrency.length > 1
                ? stats.grossByCurrency.slice(1).map((g) => money(g.amount, g.currency)).join(' · ')
                : undefined
            }
            tone="emerald"
          />
          <StatTile
            icon={<Plane className="w-4 h-4" />}
            label="Flight components"
            value={stats ? stats.componentTotals.flights.toLocaleString() : '—'}
            hint={stats ? `${stats.componentTotals.hotels} hotel · ${stats.componentTotals.insurances} insurance` : undefined}
            tone="indigo"
          />
          <StatTile
            icon={<Sparkles className="w-4 h-4" />}
            label="Experiences"
            value={stats ? stats.componentTotals.lifestyles.toLocaleString() : '—'}
            hint="Lifestyle components across all confirmed orders"
            tone="violet"
          />
        </div>

        {/* ── Filters ─────────────────────────────────────────────────────── */}
        <div className="p-4 rounded-xl border border-slate-200 bg-white flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[260px]">
            <label className="block text-[10px] font-bold uppercase tracking-wide text-slate-400 mb-1">Search</label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="PNR, hotel, policy no., passenger, order id…"
                className="w-full pl-9 pr-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500/30 focus:border-sky-400"
              />
            </div>
          </div>
          <Select label="Component" value={component} onChange={(v) => { setComponent(v); setPage(0) }} options={COMPONENT_FILTERS} />
          <Select label="Payment" value={paymentStatus} onChange={(v) => { setPaymentStatus(v); setPage(0) }} options={PAYMENT_FILTERS} />
          <DateBox label="Booked from" value={from} onChange={(v) => { setFrom(v); setPage(0) }} />
          <DateBox label="Booked to" value={to} onChange={(v) => { setTo(v); setPage(0) }} />
          {(search || component !== 'all' || paymentStatus !== 'all' || from || to) && (
            <button
              onClick={() => { setSearch(''); setComponent('all'); setPaymentStatus('all'); setFrom(''); setTo(''); setPage(0) }}
              className="px-3 py-2 text-sm text-slate-500 hover:text-slate-800"
            >
              Clear
            </button>
          )}
        </div>

        {/* ── Rows ────────────────────────────────────────────────────────── */}
        <div className="space-y-3">
          {loading && !data && (
            <div className="py-20 flex flex-col items-center gap-3 text-slate-400">
              <Loader2 className="w-6 h-6 animate-spin" />
              <p className="text-sm">Reading the B2B store…</p>
            </div>
          )}

          {data && data.bookings.length === 0 && !loading && (
            <div className="py-20 text-center">
              <Plane className="w-10 h-10 mx-auto text-slate-300" />
              <p className="mt-3 text-sm font-medium text-slate-600">No confirmed bookings match these filters</p>
              <p className="text-xs text-slate-400 mt-1">Only orders with <code>status = confirmed</code> are ever listed here.</p>
            </div>
          )}

          {data?.bookings.map((b) => (
            <button
              key={b.id}
              onClick={() => router.push(`/dashboard/b2b-flights/${b.id}`)}
              className="group w-full text-left rounded-xl border border-slate-200 bg-white hover:border-sky-300 hover:shadow-md transition-all overflow-hidden"
            >
              <div className="flex flex-col lg:flex-row">
                {/* Stub — reference + when */}
                <div className="lg:w-64 flex-shrink-0 p-4 bg-gradient-to-br from-slate-50 to-white border-b lg:border-b-0 lg:border-r border-dashed border-slate-200">
                  <p className="font-mono text-sm font-bold text-slate-900">{b.reference}</p>
                  <p className="text-[11px] text-slate-400 mt-0.5">Order #{b.orderId ?? '—'}</p>
                  <div className="mt-2 flex items-center gap-1.5 text-[11px] text-slate-500">
                    <CalendarDays className="w-3.5 h-3.5" />
                    Booked {shortDate(b.createdAt)}
                  </div>
                  {b.travelDate && (
                    <div className="mt-1 flex items-center gap-1.5 text-[11px] font-medium text-sky-700">
                      <Plane className="w-3.5 h-3.5" />
                      Travels {shortDate(b.travelDate)}
                    </div>
                  )}
                </div>

                {/* Body — route + people */}
                <div className="flex-1 p-4 min-w-0">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    {b.routes.length ? b.routes.map((r, i) => (
                      <span key={`${r}-${i}`} className="inline-flex items-center gap-1 text-sm font-semibold text-slate-800">
                        {r.replace('→', '')}
                        {r.includes('→') && <ArrowRight className="w-3.5 h-3.5 text-sky-500" />}
                      </span>
                    )) : <span className="text-sm text-slate-400">No route recorded</span>}
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
                    {b.leadTraveller && (
                      <span className="inline-flex items-center gap-1">
                        <Users className="w-3.5 h-3.5" />
                        {b.leadTraveller}{b.pax ? ` +${Math.max(b.pax - 1, 0)}` : ''}
                      </span>
                    )}
                    {b.agentName && <span className="truncate max-w-[220px]">Agent: {b.agentName}</span>}
                    {b.pnrs.map((p) => (
                      <span key={p} className="font-mono px-1.5 py-0.5 rounded bg-sky-50 text-sky-700 border border-sky-100">PNR {p}</span>
                    ))}
                  </div>
                  <div className="mt-2.5 flex flex-wrap gap-1.5">
                    <Chip show={b.components.flights} icon={<Plane className="w-3 h-3" />} label="flight" tone="sky" />
                    <Chip show={b.components.hotels} icon={<BedDouble className="w-3 h-3" />} label="hotel" tone="indigo" />
                    <Chip show={b.components.insurances} icon={<Shield className="w-3 h-3" />} label="insurance" tone="emerald" />
                    <Chip show={b.components.lifestyles} icon={<Sparkles className="w-3 h-3" />} label="experience" tone="violet" />
                  </div>
                </div>

                {/* Money */}
                <div className="lg:w-56 flex-shrink-0 p-4 border-t lg:border-t-0 lg:border-l border-slate-100 flex lg:flex-col items-center lg:items-end justify-between gap-2">
                  <div className="text-right">
                    <p className="text-base font-bold text-slate-900">{money(b.amount, b.currency)}</p>
                    <p className="text-[11px] text-slate-400">{b.paymentMethod ?? '—'}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`px-2 py-0.5 rounded-full border text-[10px] font-bold uppercase tracking-wide ${paymentTone(b.paymentStatus)}`}>
                      {b.paymentStatus ?? 'unknown'}
                    </span>
                    <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-sky-500 transition-colors" />
                  </div>
                </div>
              </div>
            </button>
          ))}
        </div>

        {/* ── Pagination ──────────────────────────────────────────────────── */}
        {data && data.total > PAGE_SIZE && (
          <div className="flex items-center justify-between pt-2">
            <p className="text-xs text-slate-500">
              Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, data.total)} of {data.total.toLocaleString()}
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0 || loading}
                className="p-2 rounded-lg border border-slate-200 bg-white disabled:opacity-40 hover:bg-slate-50"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="text-xs text-slate-500 tabular-nums">{page + 1} / {totalPages}</span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                disabled={page >= totalPages - 1 || loading}
                className="p-2 rounded-lg border border-slate-200 bg-white disabled:opacity-40 hover:bg-slate-50"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Small pieces ─────────────────────────────────────────────────────────────

const TONES: Record<string, string> = {
  sky: 'bg-sky-50 text-sky-700 border-sky-200',
  indigo: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  emerald: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  violet: 'bg-violet-50 text-violet-700 border-violet-200',
}

function Chip({ show, icon, label, tone }: { show: number; icon: React.ReactNode; label: string; tone: string }) {
  if (!show) return null
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[10px] font-semibold ${TONES[tone]}`}>
      {icon}{show} {label}{show > 1 ? 's' : ''}
    </span>
  )
}

function StatTile({ icon, label, value, hint, tone }: {
  icon: React.ReactNode; label: string; value: string; hint?: string; tone: string
}) {
  return (
    <div className="p-4 rounded-xl border border-slate-200 bg-white">
      <div className="flex items-center gap-2">
        <span className={`p-1.5 rounded-lg border ${TONES[tone]}`}>{icon}</span>
        <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{label}</span>
      </div>
      <p className="mt-2 text-xl font-bold text-slate-900 tabular-nums">{value}</p>
      {hint && <p className="text-[11px] text-slate-400 mt-0.5 truncate">{hint}</p>}
    </div>
  )
}

function Select({ label, value, onChange, options }: {
  label: string; value: string; onChange: (v: string) => void
  options: readonly { value: string; label: string }[]
}) {
  return (
    <div>
      <label className="block text-[10px] font-bold uppercase tracking-wide text-slate-400 mb-1">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="px-3 py-2 rounded-lg border border-slate-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-sky-500/30"
      >
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  )
}

function DateBox({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="block text-[10px] font-bold uppercase tracking-wide text-slate-400 mb-1">{label}</label>
      <input
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="px-3 py-2 rounded-lg border border-slate-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-sky-500/30"
      />
    </div>
  )
}
