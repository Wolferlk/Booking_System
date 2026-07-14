'use client'

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import {
  ArrowLeft, Loader2, AlertCircle, RefreshCw, Cloud, Users, Moon, Sun,
  TrendingUp, TrendingDown, Wallet, Receipt, MapPin, Hash, Building2, Bus, Utensils,
  Ticket, ChevronDown, Code2, Calendar, Plane, CheckCircle2, Clock,
  Percent, Droplet, PlusCircle, Ship, User, PieChart,
} from 'lucide-react'
import Header from '@/components/layout/header'
import { Card } from '@/components/ui/card'
import { CountryFlag } from '@/components/ui/country-flag'

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
  accommodation?: { total?: number; days?: number }
  budget?: Record<string, unknown>
  attraction_breakdown?: Record<string, unknown>
  [k: string]: unknown
}

const COST_CATEGORIES: { key: string; label: string; icon: React.ComponentType<{ className?: string }>; tint: string }[] = [
  { key: 'hotel',           label: 'Hotel',           icon: Building2, tint: 'bg-amber-50 text-amber-600' },
  { key: 'hotel_transport', label: 'Hotel Transport', icon: Bus,       tint: 'bg-orange-50 text-orange-600' },
  { key: 'transport',       label: 'Transport',       icon: Bus,       tint: 'bg-sky-50 text-sky-600' },
  { key: 'attraction',      label: 'Attractions',     icon: Ticket,    tint: 'bg-violet-50 text-violet-600' },
  { key: 'meal',            label: 'Meals',           icon: Utensils,  tint: 'bg-rose-50 text-rose-600' },
  { key: 'cruise',          label: 'Cruise',          icon: Ship,      tint: 'bg-cyan-50 text-cyan-600' },
  { key: 'supplement',      label: 'Supplement',      icon: PlusCircle,tint: 'bg-emerald-50 text-emerald-600' },
  { key: 'water_bottle',    label: 'Water Bottle',    icon: Droplet,   tint: 'bg-blue-50 text-blue-600' },
  { key: 'other',           label: 'Other',           icon: Receipt,   tint: 'bg-slate-100 text-slate-500' },
]

const COUNTRY_CODE: Record<string, string> = {
  Vietnam: 'VIETNAM', 'Sri Lanka': 'SRILANKA', Singapore: 'SINGAPORE', Malaysia: 'MALAYSIA',
}

/** A cost sub-node may be `false`, a number, or an object holding `cost`/`total`. */
function extractCost(node: unknown): number {
  if (typeof node === 'number') return node
  if (node && typeof node === 'object') {
    const o = node as Record<string, unknown>
    if (typeof o.total === 'number') return o.total
    if (typeof o.cost === 'number') return o.cost
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

function fmtDay(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' })
}

function ASBookingDetailInner() {
  const router = useRouter()
  const params = useParams<{ id: string }>()
  const searchParams = useSearchParams()

  const referenceId = decodeURIComponent(params.id ?? '')
  const quotationNo = searchParams.get('quotation_no') ?? referenceId
  const currency = searchParams.get('currency') ?? 'USD'

  // ── Rich context passed from the list card ────────────────────────────────
  const ctx = useMemo(() => {
    const arrivalStr = searchParams.get('arrival')
    const adult = Number(searchParams.get('adult') ?? 0)
    const cwb = Number(searchParams.get('cwb') ?? 0)
    const cnb = Number(searchParams.get('cnb') ?? 0)
    return {
      status: searchParams.get('status'),
      countryName: searchParams.get('country_name'),
      map: searchParams.get('map'),
      cntl: searchParams.get('cntl'),
      refs: searchParams.get('refs')?.split(',').filter(Boolean) ?? [],
      arrival: arrivalStr,
      adult, cwb, cnb,
      hasPax: !!(adult || cwb || cnb),
      revR: searchParams.get('revR'),
      revC: searchParams.get('revC'),
    }
  }, [searchParams])

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
  const margin = total > 0 ? (profit / total) * 100 : 0

  const totalPax = info?.total_pax ?? (ctx.hasPax ? ctx.adult + ctx.cwb + ctx.cnb : 0)
  const nights = info?.nights ?? 0
  const days = info?.days ?? 0
  const confirmed = ctx.status === '2'

  // Departure = arrival + nights
  const departure = useMemo(() => {
    if (!ctx.arrival || !nights) return null
    const d = new Date(ctx.arrival)
    if (isNaN(d.getTime())) return null
    d.setDate(d.getDate() + nights)
    return d.toISOString().slice(0, 10)
  }, [ctx.arrival, nights])

  const dayEntries = detail?.day_city
    ? Object.entries(detail.day_city).sort((a, b) => Number(a[0]) - Number(b[0]))
    : []

  // Per-person figures
  const perPaxSell = totalPax > 0 ? total / totalPax : 0
  const perPaxProfit = totalPax > 0 ? profit / totalPax : 0

  // Category rows (non-zero, sorted by amount desc)
  const categoryRows = useMemo(() => {
    if (!detail?.cost) return []
    return COST_CATEGORIES
      .map((c) => ({ ...c, amount: extractCost(detail.cost?.[c.key]) }))
      .filter((c) => c.amount > 0)
      .sort((a, b) => b.amount - a.amount)
  }, [detail])

  // Attraction split (from budget.attraction)
  const attractionSplit = useMemo(() => {
    const a = (detail?.budget as Record<string, unknown> | undefined)?.attraction as
      | { total_attraction?: number; total_none_attraction?: number }
      | undefined
    if (!a) return null
    const attr = a.total_attraction ?? 0
    const none = a.total_none_attraction ?? 0
    if (attr === 0 && none === 0) return null
    return { attr, none }
  }, [detail])

  const countryCode = ctx.countryName ? COUNTRY_CODE[ctx.countryName] : null

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
            {/* ── Hero identity ──────────────────────────────────────── */}
            <Card className="overflow-hidden">
              <div className="flex flex-col lg:flex-row">
                <div className="flex-1 p-6">
                  <div className="flex flex-wrap items-center gap-2.5 mb-4">
                    <span className="font-mono font-bold text-3xl text-slate-900 leading-none">
                      {info?.quotation_no ?? quotationNo}
                    </span>
                    {ctx.status && (
                      <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold border ${
                        confirmed ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-amber-50 text-amber-700 border-amber-200'
                      }`}>
                        {confirmed ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Clock className="w-3.5 h-3.5" />}
                        {confirmed ? 'Confirmed' : 'Unconfirmed'}
                      </span>
                    )}
                    {countryCode && (
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium bg-slate-100 text-slate-700 border border-slate-200">
                        <CountryFlag country={countryCode} className="w-4 h-3" /> {ctx.countryName}
                      </span>
                    )}
                  </div>

                  {/* Reference chips */}
                  <div className="flex flex-wrap items-center gap-1.5 mb-5">
                    <span className="text-xs text-slate-400">ref {info?.reference_id ?? referenceId}</span>
                    {ctx.cntl && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-mono bg-purple-50 text-purple-600 border border-purple-100">
                        <Hash className="w-3 h-3" /> {ctx.cntl}
                      </span>
                    )}
                    {ctx.refs.filter((r) => /PO/i.test(r)).map((r) => (
                      <span key={r} className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-mono bg-indigo-50 text-indigo-600 border border-indigo-100">
                        {r}
                      </span>
                    ))}
                    {info?.is_number && info.is_number !== 'NA' && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-mono bg-blue-50 text-blue-600 border border-blue-100">
                        <Hash className="w-3 h-3" /> IS {info.is_number}
                      </span>
                    )}
                    {info?.agent_name && info.agent_name !== 'NA' && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] bg-slate-100 text-slate-600 border border-slate-200">
                        <User className="w-3 h-3" /> {info.agent_name}
                      </span>
                    )}
                    {info?.is_local != null && (
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] bg-slate-100 text-slate-500 border border-slate-200">
                        {info.is_local ? 'Local' : 'Foreign'}
                      </span>
                    )}
                    {(ctx.revC || ctx.revR) && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] bg-slate-100 text-slate-500 border border-slate-200">
                        <RefreshCw className="w-3 h-3" /> {ctx.revC ?? 0}C · {ctx.revR ?? 0}R revisions
                      </span>
                    )}
                  </div>

                  {/* Trip tiles */}
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    <InfoTile label="Arrival" value={fmtDay(ctx.arrival)} icon={<Plane className="w-4 h-4" />} />
                    <InfoTile label="Departure" value={fmtDay(departure)} icon={<Plane className="w-4 h-4 rotate-90" />} />
                    <InfoTile label="Duration" value={`${nights}N / ${days}D`} icon={<Calendar className="w-4 h-4" />} />
                    <InfoTile
                      label="Total Pax"
                      value={String(totalPax)}
                      sub={ctx.hasPax ? `${ctx.adult} adult${ctx.cwb ? ` · ${ctx.cwb} CWB` : ''}${ctx.cnb ? ` · ${ctx.cnb} CNB` : ''}` : undefined}
                      icon={<Users className="w-4 h-4" />}
                    />
                    <InfoTile label="Nights" value={String(nights)} icon={<Moon className="w-4 h-4" />} />
                    <InfoTile label="Currency" value={info?.currency ?? currency} icon={<Wallet className="w-4 h-4" />} />
                  </div>
                </div>

                {/* Map */}
                {ctx.map && (
                  <div className="lg:w-64 flex-shrink-0 bg-slate-50 border-t lg:border-t-0 lg:border-l border-slate-100 flex items-center justify-center p-4">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={ctx.map.startsWith('//') ? `https:${ctx.map}` : ctx.map}
                      alt="Route map"
                      className="rounded-xl shadow-sm max-h-64 w-auto object-contain"
                    />
                  </div>
                )}
              </div>
            </Card>

            {/* ── Financial headline ─────────────────────────────────── */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <HeadlineCost
                label="Selling Total" value={money(total, symbol)} tone="brand"
                icon={<Receipt className="w-5 h-5" />}
                foot={totalPax > 0 ? `${money(perPaxSell, symbol)} / pax` : undefined}
              />
              <HeadlineCost
                label="Net Cost" value={money(withoutMarkup, symbol)} tone="slate"
                icon={<Wallet className="w-5 h-5" />}
                foot="excludes markup"
              />
              <HeadlineCost
                label={profit >= 0 ? 'Profit / Markup' : 'Loss'} value={money(profit, symbol)}
                tone={profit >= 0 ? 'emerald' : 'red'}
                icon={profit >= 0 ? <TrendingUp className="w-5 h-5" /> : <TrendingDown className="w-5 h-5" />}
                foot={`${margin.toFixed(1)}% margin${totalPax > 0 ? ` · ${money(perPaxProfit, symbol)}/pax` : ''}`}
              />
            </div>

            {/* ── P&L breakdown ──────────────────────────────────────── */}
            <Card className="p-6">
              <div className="flex items-center justify-between mb-5">
                <h2 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                  <PieChart className="w-4 h-4 text-brand-500" /> Cost & P&amp;L Breakdown
                </h2>
                <span className="text-xs text-slate-400">{categoryRows.length} cost line{categoryRows.length !== 1 ? 's' : ''}</span>
              </div>

              {categoryRows.length === 0 ? (
                <p className="text-xs text-slate-400 italic">No itemised cost breakdown available for this booking.</p>
              ) : (
                <div className="space-y-3">
                  {categoryRows.map(({ key, label, icon: Icon, tint, amount }) => {
                    const pct = total > 0 ? (amount / total) * 100 : 0
                    const perPax = totalPax > 0 ? amount / totalPax : 0
                    return (
                      <div key={key} className="flex items-center gap-3">
                        <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${tint}`}>
                          <Icon className="w-4 h-4" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between text-sm mb-1">
                            <span className="text-slate-600 font-medium">{label}</span>
                            <span className="flex items-baseline gap-2">
                              {totalPax > 0 && <span className="text-[11px] text-slate-400 tabular-nums">{money(perPax, symbol)}/pax</span>}
                              <span className="font-semibold text-slate-900 tabular-nums">{money(amount, symbol)}</span>
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                              <div className="h-full bg-brand-400 rounded-full" style={{ width: `${Math.min(100, pct)}%` }} />
                            </div>
                            <span className="text-[10px] text-slate-400 w-9 text-right tabular-nums">{pct.toFixed(0)}%</span>
                          </div>
                        </div>
                      </div>
                    )
                  })}

                  {/* Totals footer */}
                  <div className="flex items-center justify-between pt-3 mt-1 border-t border-slate-100">
                    <span className="text-sm font-semibold text-slate-700">Selling Total</span>
                    <span className="text-base font-bold text-slate-900 tabular-nums">{money(total, symbol)}</span>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-400">Net cost</span>
                    <span className="text-slate-500 tabular-nums">{money(withoutMarkup, symbol)}</span>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className={profit >= 0 ? 'text-emerald-600' : 'text-red-600'}>
                      {profit >= 0 ? 'Markup' : 'Shortfall'} ({margin.toFixed(1)}%)
                    </span>
                    <span className={`font-semibold tabular-nums ${profit >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                      {money(profit, symbol)}
                    </span>
                  </div>
                </div>
              )}

              {/* Attraction split */}
              {attractionSplit && (
                <div className="mt-5 pt-4 border-t border-slate-100">
                  <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-2 flex items-center gap-1.5">
                    <Ticket className="w-3.5 h-3.5" /> Attraction composition
                  </p>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-xl border border-violet-100 bg-violet-50/50 px-3 py-2">
                      <p className="text-sm font-bold text-violet-700 tabular-nums">{money(attractionSplit.attr, symbol)}</p>
                      <p className="text-[10px] text-slate-400 uppercase tracking-wide mt-0.5">Ticketed attractions</p>
                    </div>
                    <div className="rounded-xl border border-slate-100 bg-slate-50/50 px-3 py-2">
                      <p className="text-sm font-bold text-slate-600 tabular-nums">{money(attractionSplit.none, symbol)}</p>
                      <p className="text-[10px] text-slate-400 uppercase tracking-wide mt-0.5">Non-ticketed / transfers</p>
                    </div>
                  </div>
                </div>
              )}
            </Card>

            {/* ── Margin gauge ───────────────────────────────────────── */}
            {total > 0 && (
              <Card className="p-6">
                <h2 className="text-sm font-semibold text-slate-700 mb-4 flex items-center gap-2">
                  <Percent className="w-4 h-4 text-slate-400" /> Profit Analysis
                </h2>
                <div className="flex items-center gap-4">
                  <div className="flex-1">
                    <div className="flex h-6 rounded-lg overflow-hidden border border-slate-100">
                      <div
                        className="bg-slate-300 flex items-center justify-center text-[10px] font-semibold text-slate-700"
                        style={{ width: `${total > 0 ? (withoutMarkup / total) * 100 : 0}%` }}
                        title="Net cost"
                      >
                        {withoutMarkup / total > 0.12 ? 'Cost' : ''}
                      </div>
                      <div
                        className={`${profit >= 0 ? 'bg-emerald-400' : 'bg-red-400'} flex items-center justify-center text-[10px] font-semibold text-white`}
                        style={{ width: `${Math.max(0, Math.min(100, margin))}%` }}
                        title="Markup"
                      >
                        {margin > 10 ? `${margin.toFixed(0)}%` : ''}
                      </div>
                    </div>
                    <div className="flex justify-between mt-2 text-[11px] text-slate-400">
                      <span>Net {money(withoutMarkup, symbol)}</span>
                      <span>Markup {money(profit, symbol)}</span>
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className={`text-2xl font-bold tabular-nums ${profit >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{margin.toFixed(1)}%</p>
                    <p className="text-[10px] text-slate-400 uppercase tracking-wide">Margin</p>
                  </div>
                </div>
              </Card>
            )}

            {/* ── Itinerary timeline ─────────────────────────────────── */}
            {dayEntries.length > 0 && (
              <Card className="p-6">
                <h2 className="text-sm font-semibold text-slate-700 mb-5 flex items-center gap-2">
                  <MapPin className="w-4 h-4 text-slate-400" /> Itinerary — {dayEntries.length} day{dayEntries.length !== 1 ? 's' : ''}
                </h2>
                <div className="relative pl-7">
                  <div className="absolute left-[11px] top-2 bottom-2 w-px bg-gradient-to-b from-brand-300 via-brand-200 to-transparent" />
                  <div className="space-y-4">
                    {dayEntries.map(([day, city], i) => {
                      const dayDate = ctx.arrival ? (() => { const d = new Date(ctx.arrival!); d.setDate(d.getDate() + i); return d } )() : null
                      return (
                        <div key={day} className="relative flex items-start gap-3">
                          <div className="absolute -left-7 w-[22px] h-[22px] rounded-full bg-white border-2 border-brand-400 flex items-center justify-center text-[10px] font-bold text-brand-600">
                            {day}
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-slate-800">{city.name}</p>
                            {dayDate && (
                              <p className="text-[11px] text-slate-400 mt-0.5">
                                {dayDate.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short' })}
                              </p>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              </Card>
            )}

            {/* ── Raw payload ────────────────────────────────────────── */}
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

function InfoTile({ label, value, sub, icon }: { label: string; value: string; sub?: string; icon: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2.5 rounded-xl border border-slate-100 bg-slate-50/60 px-3 py-2.5">
      <div className="text-slate-400 flex-shrink-0">{icon}</div>
      <div className="min-w-0">
        <p className="text-sm font-bold text-slate-900 leading-tight truncate">{value}</p>
        <p className="text-[10px] text-slate-400 mt-0.5 uppercase tracking-wide truncate">{sub ?? label}</p>
      </div>
    </div>
  )
}

function HeadlineCost({ label, value, tone, icon, foot }: { label: string; value: string; tone: 'brand' | 'slate' | 'emerald' | 'red'; icon: React.ReactNode; foot?: string }) {
  const tones: Record<string, string> = {
    brand:   'from-brand-500 to-brand-600',
    slate:   'from-slate-600 to-slate-700',
    emerald: 'from-emerald-500 to-emerald-600',
    red:     'from-red-500 to-red-600',
  }
  return (
    <div className={`rounded-2xl p-5 bg-gradient-to-br ${tones[tone]} text-white shadow-sm`}>
      <div className="flex items-center justify-between mb-3 opacity-90">
        {icon}
        <span className="text-[11px] font-medium uppercase tracking-wide">{label}</span>
      </div>
      <p className="text-2xl font-bold tabular-nums">{value}</p>
      {foot && <p className="text-[11px] opacity-80 mt-1">{foot}</p>}
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
