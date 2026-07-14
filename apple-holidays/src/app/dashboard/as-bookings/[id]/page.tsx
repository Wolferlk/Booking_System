'use client'

import { Suspense, useCallback, useEffect, useState } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import {
  ArrowLeft, Loader2, AlertCircle, RefreshCw, Cloud, Users, Moon, Sun,
  TrendingUp, Wallet, Receipt, MapPin, Hash, Building2, Bus, Utensils,
  Ticket, ChevronDown, Code2,
} from 'lucide-react'
import Header from '@/components/layout/header'
import { Card } from '@/components/ui/card'

interface QuotationInfo {
  quotation_no?: string
  reference_id?: number | string
  is_number?: string
  agent_name?: string
  total_pax?: number
  nights?: number
  days?: number
  currency?: string
  exchange_rate?: string
  is_local?: boolean
}

interface Detail {
  quotation_info?: QuotationInfo
  cost?: Record<string, unknown>
  cost_without_markup?: Record<string, unknown>
  profit_loss?: number
  day_city?: Record<string, { city: string; name: string }>
  [k: string]: unknown
}

const COST_CATEGORIES: { key: string; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { key: 'hotel',           label: 'Hotel',           icon: Building2 },
  { key: 'transport',       label: 'Transport',       icon: Bus },
  { key: 'hotel_transport', label: 'Hotel Transport', icon: Bus },
  { key: 'attraction',      label: 'Attractions',     icon: Ticket },
  { key: 'meal',            label: 'Meals',           icon: Utensils },
  { key: 'cruise',          label: 'Cruise',          icon: Cloud },
  { key: 'supplement',      label: 'Supplement',      icon: Receipt },
  { key: 'water_bottle',    label: 'Water Bottle',    icon: Receipt },
  { key: 'other',           label: 'Other',           icon: Receipt },
]

/** A cost sub-node may be `false`, a number, or an object holding `cost`/`total`. */
function extractCost(node: unknown): number {
  if (typeof node === 'number') return node
  if (node && typeof node === 'object') {
    const o = node as Record<string, unknown>
    if (typeof o.cost === 'number') return o.cost
    if (typeof o.total === 'number') return o.total
  }
  return 0
}

function currencySymbol(detail: Detail): string {
  const cur = detail.cost?.currency as { symbol?: string } | undefined
  return cur?.symbol ?? detail.quotation_info?.currency ?? '$'
}

function money(amount: number, symbol: string): string {
  return `${symbol}${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function ASBookingDetailInner() {
  const router = useRouter()
  const params = useParams<{ id: string }>()
  const searchParams = useSearchParams()

  const referenceId = decodeURIComponent(params.id ?? '')
  const quotationNo = searchParams.get('quotation_no') ?? referenceId
  const currency = searchParams.get('currency') ?? 'USD'

  const [detail, setDetail] = useState<Detail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showRaw, setShowRaw] = useState(false)

  const fetchDetail = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const q = new URLSearchParams({ reference_id: referenceId, quotation_no: quotationNo })
      if (currency) q.set('currency', currency)
      const res = await fetch(`/api/as-bookings/detail?${q.toString()}`)
      const json = await res.json()
      if (!json.success) {
        setError(json.error ?? 'Failed to load booking detail')
        return
      }
      setDetail(json.data.detail)
    } catch {
      setError('Network error — could not reach AppleSystem')
    } finally {
      setLoading(false)
    }
  }, [referenceId, quotationNo, currency])

  useEffect(() => { fetchDetail() }, [fetchDetail])

  const info = detail?.quotation_info
  const symbol = detail ? currencySymbol(detail) : '$'
  const total = extractCost(detail?.cost)
  const withoutMarkup = extractCost(detail?.cost_without_markup)
  const profit = typeof detail?.profit_loss === 'number' ? detail.profit_loss : total - withoutMarkup

  const dayEntries = detail?.day_city
    ? Object.entries(detail.day_city).sort((a, b) => Number(a[0]) - Number(b[0]))
    : []

  return (
    <div>
      <Header
        title={
          <span className="flex items-center gap-2">
            <Cloud className="w-5 h-5 text-brand-500" />
            {quotationNo}
          </span>
        }
        subtitle="AppleSystem booking breakdown"
        actions={
          <div className="flex items-center gap-2">
            <button
              onClick={fetchDetail}
              disabled={loading}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-slate-700 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors disabled:opacity-60"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
            <button
              onClick={() => router.push('/dashboard/as-bookings')}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-slate-700 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors"
            >
              <ArrowLeft className="w-4 h-4" /> Back
            </button>
          </div>
        }
      />

      <div className="p-4 sm:p-8 space-y-5">
        {loading ? (
          <Card className="flex items-center justify-center h-56">
            <div className="flex flex-col items-center gap-3 text-slate-400">
              <Loader2 className="w-7 h-7 text-brand-500 animate-spin" />
              <p className="text-sm">Loading breakdown…</p>
            </div>
          </Card>
        ) : error ? (
          <Card className="flex flex-col items-center justify-center h-56 text-center px-6">
            <AlertCircle className="w-10 h-10 text-red-400 mb-3" />
            <p className="text-sm font-semibold text-slate-700">Couldn&apos;t load booking</p>
            <p className="text-xs text-slate-400 mt-1 max-w-sm">{error}</p>
            <button
              onClick={fetchDetail}
              className="mt-4 flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-white bg-brand-600 hover:bg-brand-500 rounded-xl transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" /> Try again
            </button>
          </Card>
        ) : !detail ? null : (
          <>
            {/* ── Identity strip ─────────────────────────────────────── */}
            <Card className="p-5">
              <div className="flex flex-wrap items-center gap-2 mb-4">
                <span className="font-mono font-bold text-2xl text-slate-900">{info?.quotation_no ?? quotationNo}</span>
                <span className="text-sm text-slate-400">ref {info?.reference_id ?? referenceId}</span>
                {info?.is_number && info.is_number !== 'NA' && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-mono bg-blue-50 text-blue-600 border border-blue-100">
                    <Hash className="w-3 h-3" /> IS {info.is_number}
                  </span>
                )}
                {info?.agent_name && info.agent_name !== 'NA' && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] bg-slate-100 text-slate-600 border border-slate-200">
                    {info.agent_name}
                  </span>
                )}
                {info?.is_local != null && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] bg-slate-100 text-slate-500 border border-slate-200">
                    {info.is_local ? 'Local' : 'Foreign'}
                  </span>
                )}
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <InfoTile label="Total Pax" value={String(info?.total_pax ?? '—')} icon={<Users className="w-4 h-4" />} />
                <InfoTile label="Nights" value={String(info?.nights ?? '—')} icon={<Moon className="w-4 h-4" />} />
                <InfoTile label="Days" value={String(info?.days ?? '—')} icon={<Sun className="w-4 h-4" />} />
                <InfoTile label="Currency" value={info?.currency ?? currency} icon={<Wallet className="w-4 h-4" />} />
              </div>
            </Card>

            {/* ── Cost headline ──────────────────────────────────────── */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <HeadlineCost label="Selling Total" value={money(total, symbol)} tone="brand" icon={<Receipt className="w-5 h-5" />} />
              <HeadlineCost label="Cost (no markup)" value={money(withoutMarkup, symbol)} tone="slate" icon={<Wallet className="w-5 h-5" />} />
              <HeadlineCost label="Markup / Profit" value={money(profit, symbol)} tone="emerald" icon={<TrendingUp className="w-5 h-5" />} />
            </div>

            {/* ── Cost breakdown by category ─────────────────────────── */}
            <Card className="p-5">
              <h2 className="text-sm font-semibold text-slate-700 mb-4 flex items-center gap-2">
                <Receipt className="w-4 h-4 text-slate-400" /> Cost Breakdown
              </h2>
              <div className="space-y-2">
                {COST_CATEGORIES.map(({ key, label, icon: Icon }) => {
                  const amount = extractCost(detail.cost?.[key])
                  if (amount === 0) return null
                  const pct = total > 0 ? (amount / total) * 100 : 0
                  return (
                    <div key={key} className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center flex-shrink-0">
                        <Icon className="w-4 h-4 text-slate-500" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-slate-600">{label}</span>
                          <span className="font-medium text-slate-900 tabular-nums">{money(amount, symbol)}</span>
                        </div>
                        <div className="h-1.5 bg-slate-100 rounded-full mt-1 overflow-hidden">
                          <div className="h-full bg-brand-400 rounded-full" style={{ width: `${Math.min(100, pct)}%` }} />
                        </div>
                      </div>
                    </div>
                  )
                })}
                {COST_CATEGORIES.every(({ key }) => extractCost(detail.cost?.[key]) === 0) && (
                  <p className="text-xs text-slate-400 italic">No itemised cost breakdown available for this booking.</p>
                )}
              </div>
            </Card>

            {/* ── Day-by-day cities ──────────────────────────────────── */}
            {dayEntries.length > 0 && (
              <Card className="p-5">
                <h2 className="text-sm font-semibold text-slate-700 mb-4 flex items-center gap-2">
                  <MapPin className="w-4 h-4 text-slate-400" /> Itinerary — {dayEntries.length} day{dayEntries.length !== 1 ? 's' : ''}
                </h2>
                <div className="relative pl-6">
                  <div className="absolute left-[9px] top-1 bottom-1 w-px bg-slate-200" />
                  <div className="space-y-3">
                    {dayEntries.map(([day, city]) => (
                      <div key={day} className="relative flex items-center gap-3">
                        <div className="absolute -left-6 w-[18px] h-[18px] rounded-full bg-white border-2 border-brand-400 flex items-center justify-center">
                          <div className="w-1.5 h-1.5 rounded-full bg-brand-400" />
                        </div>
                        <span className="text-[11px] font-semibold text-slate-400 w-12 flex-shrink-0">Day {day}</span>
                        <span className="text-sm text-slate-700">{city.name}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </Card>
            )}

            {/* ── Raw payload (developer view) ───────────────────────── */}
            <Card>
              <button
                onClick={() => setShowRaw((v) => !v)}
                className="w-full flex items-center justify-between px-5 py-3 text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors"
              >
                <span className="flex items-center gap-2"><Code2 className="w-4 h-4 text-slate-400" /> Raw AppleSystem payload</span>
                <ChevronDown className={`w-4 h-4 transition-transform ${showRaw ? 'rotate-180' : ''}`} />
              </button>
              {showRaw && (
                <div className="border-t border-slate-100 max-h-[480px] overflow-auto">
                  <pre className="text-[11px] leading-relaxed text-slate-600 p-4 whitespace-pre-wrap break-all">
                    {JSON.stringify(detail, null, 2)}
                  </pre>
                </div>
              )}
            </Card>
          </>
        )}
      </div>
    </div>
  )
}

function InfoTile({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2.5 rounded-xl border border-slate-100 bg-slate-50/60 px-3 py-2.5">
      <div className="text-slate-400">{icon}</div>
      <div className="min-w-0">
        <p className="text-base font-bold text-slate-900 leading-none">{value}</p>
        <p className="text-[10px] text-slate-400 mt-1 uppercase tracking-wide">{label}</p>
      </div>
    </div>
  )
}

function HeadlineCost({ label, value, tone, icon }: { label: string; value: string; tone: 'brand' | 'slate' | 'emerald'; icon: React.ReactNode }) {
  const tones: Record<string, string> = {
    brand:   'from-brand-500 to-brand-600 text-white',
    slate:   'from-slate-600 to-slate-700 text-white',
    emerald: 'from-emerald-500 to-emerald-600 text-white',
  }
  return (
    <div className={`rounded-2xl p-5 bg-gradient-to-br ${tones[tone]} shadow-sm`}>
      <div className="flex items-center justify-between mb-3 opacity-90">
        {icon}
        <span className="text-[11px] font-medium uppercase tracking-wide">{label}</span>
      </div>
      <p className="text-2xl font-bold tabular-nums">{value}</p>
    </div>
  )
}

export default function ASBookingDetailPage() {
  return (
    <Suspense fallback={<div className="flex justify-center h-64"><div className="w-6 h-6 border-2 border-brand-500 border-t-transparent rounded-full animate-spin mt-20" /></div>}>
      <ASBookingDetailInner />
    </Suspense>
  )
}
