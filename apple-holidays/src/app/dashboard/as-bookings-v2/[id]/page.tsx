'use client'

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import {
  ArrowLeft, Loader2, AlertCircle, RefreshCw, FileCheck2, Users, Wallet, Receipt,
  Hash, User, CheckCircle2, Clock, Calendar, MapPin, Building2, FileText, Route,
  Sparkles, TrendingUp, TrendingDown, Eye, EyeOff, FileDown, ListChecks, XCircle,
  ScrollText, PlusCircle, Bed, Bus, Gauge, Coins, Copy, Download, Code2, ChevronDown,
  ArrowRightLeft, Landmark, Utensils, Droplet, Percent, Ticket, Check, Gift,
  CircleDollarSign, Scissors, Timer,
} from 'lucide-react'
import Header from '@/components/layout/header'
import { Card } from '@/components/ui/card'

// ── Types ────────────────────────────────────────────────────────────────────
interface Activity { type?: string; name?: string; description?: string }
interface ItineraryDay { day: number; date?: string; date_formatted?: string; route?: string; description?: string; activities?: Activity[] }
interface Accommodation { city?: string; check_in?: string; check_out?: string; nights?: number; type?: string }
interface Quote {
  quotation_no: string
  reference_id: number | string
  revision?: number
  reference_numbers?: { quotation_no?: string; formatted?: string; control?: string; temp_po?: string }
  relevant_parties?: { agent?: string; sales_person?: string }
  accommodation?: Accommodation[]
  value_added_services?: unknown[]
  package_includes?: string[]
  package_excludes?: string[]
  terms_and_conditions?: string[]
  itinerary?: ItineraryDay[]
  pnl?: Record<string, unknown>
}

type Tab = 'confirmation' | 'agenda' | 'financials'

// ── Safe accessors ───────────────────────────────────────────────────────────
function get(obj: unknown, ...path: (string | number)[]): unknown {
  let cur: unknown = obj
  for (const k of path) {
    if (cur == null || typeof cur !== 'object') return undefined
    cur = (cur as Record<string | number, unknown>)[k]
  }
  return cur
}

function num(node: unknown): number {
  if (typeof node === 'number') return node
  if (typeof node === 'string') { const n = Number(node); return isNaN(n) ? 0 : n }
  if (node && typeof node === 'object') {
    const o = node as Record<string, unknown>
    if (typeof o.total === 'number') return o.total
    if (typeof o.cost === 'number') return o.cost
  }
  return 0
}

function nestedCost(node: unknown): number {
  if (!node || typeof node !== 'object') return num(node)
  const o = node as Record<string, unknown>
  if (o.cost && typeof o.cost === 'object') return num(o.cost)
  return num(o)
}

function money(amount: number, symbol: string): string {
  return `${symbol}${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
function fmtDate(iso: string | undefined | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return String(iso)
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' })
}

// ── Derived data ─────────────────────────────────────────────────────────────
interface CostSummary {
  symbol: string; currencyCode: string; total: number; net: number; profit: number; margin: number
  lines: { label: string; amount: number }[]; totalPax: number; perPax: number
}

function extractCosts(q: Quote): CostSummary {
  const pnl = (q.pnl ?? {}) as Record<string, unknown>
  const cost = (pnl.cost ?? {}) as Record<string, unknown>
  const info = (pnl.quotation_info ?? {}) as Record<string, unknown>
  const currency = (cost.currency ?? {}) as Record<string, unknown>
  const symbol = String(currency.symbol ?? info.currency ?? '$')
  const currencyCode = String(currency.code ?? info.currency ?? '')
  const total = num(cost.total ?? pnl.cost)
  const net = num((pnl.cost_without_markup as Record<string, unknown>)?.total ?? pnl.cost_without_markup)
  const profit = typeof pnl.profit_loss === 'number' ? (pnl.profit_loss as number) : total - net
  const margin = total > 0 ? (profit / total) * 100 : 0
  const raw = [
    { label: 'Hotel', amount: nestedCost(cost.hotel) },
    { label: 'Hotel Transport', amount: num(cost.hotel_transport) },
    { label: 'Transport', amount: nestedCost(cost.transport) },
    { label: 'Attractions', amount: nestedCost(cost.attraction) },
    { label: 'Meals', amount: nestedCost(cost.meal) },
    { label: 'Cruise', amount: nestedCost(cost.cruise) },
    { label: 'Supplement', amount: num(cost.supplement) },
    { label: 'Water Bottle', amount: nestedCost(cost.water_bottle) },
    { label: 'Other', amount: nestedCost(cost.other) },
  ]
  const lines = raw.filter((l) => l.amount > 0).sort((a, b) => b.amount - a.amount)
  const totalPax = Number(info.total_pax ?? 0)
  const perPax = totalPax > 0 ? total / totalPax : 0
  return { symbol, currencyCode, total, net, profit, margin, lines, totalPax, perPax }
}

/** Consecutive days in the same city collapse into one leg. */
function journeyLegs(pnl: Record<string, unknown>): { name: string; from: number; to: number }[] {
  const dc = pnl.day_city as Record<string, { name?: string }> | undefined
  if (!dc) return []
  const entries = Object.entries(dc)
    .map(([d, v]) => ({ day: Number(d), name: v?.name ?? '' }))
    .filter((e) => e.name)
    .sort((a, b) => a.day - b.day)
  const out: { name: string; from: number; to: number }[] = []
  for (const e of entries) {
    const last = out[out.length - 1]
    if (last && last.name === e.name) last.to = e.day
    else out.push({ name: e.name, from: e.day, to: e.day })
  }
  return out
}

interface ActivityItem {
  id: string; kind: string; name: string; description?: string; duration: number
  adultRate: number; childRate: number; transferRate: number
  adultEntrance: number; childEntrance: number; total: number
}
interface ActivityInfo {
  total: number; totalAttraction: number; totalNone: number; items: ActivityItem[]
  paxAdult: number; paxChild: number
}

function extractActivities(pnl: Record<string, unknown>): ActivityInfo | null {
  const a = get(pnl, 'budget', 'attraction') as Record<string, unknown> | undefined
  if (!a) return null
  const items: ActivityItem[] = []
  for (const kind of ['attraction', 'city_tour', 'excursion'] as const) {
    const objs = get(a, 'items', kind) as Record<string, Record<string, unknown>> | undefined
    if (!objs || Array.isArray(objs)) continue
    for (const [id, o] of Object.entries(objs)) {
      const rate = get(a, 'rates', kind, id) as Record<string, unknown> | undefined
      const bd = get(a, 'rates', `${kind}_breakdown`, id) as Record<string, unknown> | undefined
      items.push({
        id, kind,
        name: String(o.name ?? o.point ?? `#${id}`),
        description: o.description ? String(o.description) : undefined,
        duration: num(o.duration),
        adultRate: num(rate?.adult), childRate: num(rate?.child),
        transferRate: num(bd?.transfer_rate),
        adultEntrance: num(bd?.adult_entrance_rate), childEntrance: num(bd?.child_entrance_rate),
        total: num(get(a, 'attraction_individual', kind, id)),
      })
    }
  }
  return {
    total: num(a.total), totalAttraction: num(a.total_attraction), totalNone: num(a.total_none_attraction),
    items: items.sort((x, y) => y.total - x.total),
    paxAdult: num(get(pnl, 'cost', 'attraction', 'pax_cost', 'adult')),
    paxChild: num(get(pnl, 'cost', 'attraction', 'pax_cost', 'child')),
  }
}

/** Day-indexed activity plan from budget.attraction.ob_items. */
function extractDayPlan(pnl: Record<string, unknown>): { day: number; date: string | null; entries: { kind: string; name: string }[] }[] {
  const ob = get(pnl, 'budget', 'attraction', 'ob_items') as Record<string, Record<string, unknown>> | undefined
  if (!ob || Array.isArray(ob)) return []
  return Object.entries(ob).map(([day, v]) => {
    const dt = v.date as { year?: number; month?: number; day?: number } | undefined
    const date = dt?.year ? `${dt.year}-${String(dt.month).padStart(2, '0')}-${String(dt.day).padStart(2, '0')}` : null
    const entries: { kind: string; name: string }[] = []
    for (const kind of ['attraction', 'city_tour', 'excursion'] as const) {
      const arr = v[kind]
      if (Array.isArray(arr)) {
        for (const it of arr) {
          const o = it as Record<string, unknown>
          entries.push({ kind, name: String(o.name ?? o.point ?? '') })
        }
      }
    }
    return { day: Number(day), date, entries }
  }).sort((a, b) => a.day - b.day)
}

interface TransportInfo {
  vehicleType: string | null; vehicleRate: number; bata: number; paging: number
  highway: number; driverAcc: number; rateArray: number[]
  total: number; perPerson: number; distanceKm: number; additionalKm: number
  waterBottle: number; mealTransferCost: number; mealTransferPp: number
}

function extractTransport(pnl: Record<string, unknown>): TransportInfo | null {
  const t = get(pnl, 'budget', 'transport') as Record<string, unknown> | undefined
  const c = get(pnl, 'cost', 'transport', 'cost') as Record<string, unknown> | undefined
  if (!t && !c) return null
  const v = get(t, 'vehicle') as Record<string, unknown> | undefined
  const r = get(t, 'rates') as Record<string, unknown> | undefined
  const m = get(t, 'mileage') as Record<string, unknown> | undefined
  const rateArray = Array.isArray(r?.rate_array) ? (r!.rate_array as unknown[]).map(num) : []
  return {
    vehicleType: v?.vehicle_type ? String(v.vehicle_type) : null,
    vehicleRate: num(v?.rate), bata: num(v?.bata), paging: num(v?.paging),
    highway: num(v?.highway_charges), driverAcc: num(v?.driver_accommodation),
    rateArray,
    total: num(r?.total ?? c?.total), perPerson: num(r?.pp ?? c?.per_person),
    distanceKm: num(m?.actual_distance), additionalKm: num(m?.additional_distance),
    waterBottle: num(t?.per_water_bottle),
    mealTransferCost: num(get(t, 'meal_transfer', 'cost')), mealTransferPp: num(get(t, 'meal_transfer', 'pp')),
  }
}

// ── JSON syntax highlighting (escaped first, so safe to inject) ──────────────
function highlightJson(json: string): string {
  const escaped = json.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return escaped.replace(
    /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+-]?\d+)?)/g,
    (m) => {
      let cls = 'text-emerald-600'
      if (/^"/.test(m)) cls = /:$/.test(m) ? 'text-sky-700 font-semibold' : 'text-amber-700'
      else if (/true|false/.test(m)) cls = 'text-purple-600'
      else if (/null/.test(m)) cls = 'text-slate-400'
      return `<span class="${cls}">${m}</span>`
    },
  )
}

// ── Page ─────────────────────────────────────────────────────────────────────
function ASBookingV2DetailInner() {
  const router = useRouter()
  const params = useParams<{ id: string }>()
  const searchParams = useSearchParams()

  const referenceId = decodeURIComponent(params.id ?? '')
  const quotationNo = searchParams.get('quotation_no') ?? ''
  const ctxStatus = searchParams.get('status')
  const ctxCountry = searchParams.get('country_name')

  const [quote, setQuote] = useState<Quote | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('confirmation')
  const [showAmounts, setShowAmounts] = useState(true)
  const [pdfBusy, setPdfBusy] = useState<null | 'with' | 'without'>(null)

  const fetchQuote = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const q = new URLSearchParams({ quotation_no: quotationNo, reference_id: referenceId })
      const res = await fetch(`/api/as-bookings-v2/quote?${q.toString()}`)
      const json = await res.json()
      if (!json.success) { setError(json.error ?? 'Failed to load confirmation'); return }
      setQuote(json.data.quote)
    } catch {
      setError('Network error — could not reach AppleSystem')
    } finally {
      setLoading(false)
    }
  }, [quotationNo, referenceId])

  useEffect(() => { fetchQuote() }, [fetchQuote])

  async function downloadPdf(withCosts: boolean) {
    setPdfBusy(withCosts ? 'with' : 'without')
    try {
      const q = new URLSearchParams({ quotation_no: quotationNo, reference_id: referenceId, costs: withCosts ? '1' : '0' })
      const res = await fetch(`/api/as-bookings-v2/pdf?${q.toString()}`)
      if (!res.ok) {
        let msg = 'PDF generation failed'
        try { const j = await res.json(); msg = j.error ?? msg } catch {}
        alert(msg)
        return
      }
      const blob = await res.blob()
      const href = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = href
      a.download = `AS-${quotationNo}-confirmation-${withCosts ? 'with-costs' : 'no-costs'}.pdf`
      document.body.appendChild(a); a.click(); a.remove()
      URL.revokeObjectURL(href)
    } catch {
      alert('Network error while generating PDF')
    } finally {
      setPdfBusy(null)
    }
  }

  const pnl = (quote?.pnl ?? {}) as Record<string, unknown>
  const info = (pnl.quotation_info ?? {}) as Record<string, unknown>
  const ref = quote?.reference_numbers ?? {}
  const parties = quote?.relevant_parties ?? {}
  const costs = quote ? extractCosts(quote) : null
  const isNumber = String(info.is_number ?? '').trim()
  const nights = Number(info.nights ?? 0)
  const days = Number(info.days ?? 0)
  const pax = (info.pax ?? {}) as Record<string, unknown>
  const adult = Number(pax.adult ?? 0), cwb = Number(pax.cwb ?? 0), cnb = Number(pax.cnb ?? 0)
  const totalPax = Number(info.total_pax ?? adult + cwb + cnb)
  const confirmed = ctxStatus === '2'
  const itin = quote?.itinerary ?? []
  const legs = useMemo(() => journeyLegs(pnl), [pnl])

  return (
    <div>
      <Header
        title={
          <span className="flex items-center gap-2">
            <FileCheck2 className="w-5 h-5 text-brand-500" />
            {isNumber && isNumber !== 'NA' ? `IS ${isNumber}` : (ref.formatted ?? quotationNo)}
          </span>
        }
        subtitle="AppleSystem booking confirmation"
        actions={
          <div className="flex items-center gap-2">
            <button
              onClick={() => downloadPdf(true)}
              disabled={loading || !!pdfBusy}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-brand-600 hover:bg-brand-500 rounded-xl transition-colors disabled:opacity-60"
            >
              {pdfBusy === 'with' ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileDown className="w-4 h-4" />}
              PDF · with costs
            </button>
            <button
              onClick={() => downloadPdf(false)}
              disabled={loading || !!pdfBusy}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-slate-700 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors disabled:opacity-60"
            >
              {pdfBusy === 'without' ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileDown className="w-4 h-4" />}
              PDF · no costs
            </button>
            <button
              onClick={() => router.push('/dashboard/as-bookings-v2')}
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
              <p className="text-sm">Loading confirmation…</p>
            </div>
          </Card>
        ) : error ? (
          <Card className="flex flex-col items-center justify-center h-56 text-center px-6">
            <AlertCircle className="w-10 h-10 text-red-400 mb-3" />
            <p className="text-sm font-semibold text-slate-700">Couldn&apos;t load confirmation</p>
            <p className="text-xs text-slate-400 mt-1 max-w-sm">{error}</p>
            <button
              onClick={fetchQuote}
              className="mt-4 flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-white bg-brand-600 hover:bg-brand-500 rounded-xl transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" /> Try again
            </button>
          </Card>
        ) : !quote ? null : (
          <>
            {/* ── Hero ────────────────────────────────────────────────── */}
            <Card className="p-6">
              <div className="flex flex-wrap items-center gap-2.5 mb-4">
                <span className="font-mono font-bold text-3xl text-slate-900 leading-none">{ref.formatted ?? quotationNo}</span>
                {isNumber && isNumber !== 'NA' && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-blue-50 text-blue-700 border border-blue-200">
                    <Hash className="w-3.5 h-3.5" /> IS {isNumber}
                  </span>
                )}
                {ctxStatus && (
                  <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold border ${
                    confirmed ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-amber-50 text-amber-700 border-amber-200'
                  }`}>
                    {confirmed ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Clock className="w-3.5 h-3.5" />}
                    {confirmed ? 'Confirmed' : 'Unconfirmed'}
                  </span>
                )}
                {ctxCountry && (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium bg-slate-100 text-slate-700 border border-slate-200">
                    <MapPin className="w-3.5 h-3.5" /> {ctxCountry}
                  </span>
                )}
                {info.is_local != null && (
                  <span className="inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-medium bg-slate-100 text-slate-500 border border-slate-200">
                    {info.is_local ? 'Local' : 'Foreign'}
                  </span>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-1.5 mb-5">
                {ref.control && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-mono bg-purple-50 text-purple-600 border border-purple-100">
                    <Hash className="w-3 h-3" /> {ref.control}
                  </span>
                )}
                {ref.temp_po && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-mono bg-indigo-50 text-indigo-600 border border-indigo-100">{ref.temp_po}</span>
                )}
                {parties.agent && parties.agent !== 'NA' && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] bg-slate-100 text-slate-600 border border-slate-200">
                    <User className="w-3 h-3" /> {parties.agent}
                  </span>
                )}
                {parties.sales_person && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] bg-slate-100 text-slate-500 border border-slate-200">Sales · {parties.sales_person}</span>
                )}
                {quote.revision != null && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] bg-slate-100 text-slate-500 border border-slate-200">
                    <RefreshCw className="w-3 h-3" /> Rev {quote.revision}
                  </span>
                )}
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
                <InfoTile label="Duration" value={`${nights}N / ${days}D`} icon={<Calendar className="w-4 h-4" />} />
                <InfoTile label="Total Pax" value={String(totalPax)} sub={`${adult} adult${cwb ? ` · ${cwb} CWB` : ''}${cnb ? ` · ${cnb} CNB` : ''}`} icon={<Users className="w-4 h-4" />} />
                <InfoTile label={`Currency · rate ${info.exchange_rate ?? '—'}`} value={String(info.currency ?? costs?.currencyCode ?? '—')} icon={<Wallet className="w-4 h-4" />} />
                <InfoTile label="Itinerary" value={`${itin.length} day${itin.length !== 1 ? 's' : ''}`} icon={<Route className="w-4 h-4" />} />
              </div>

              {/* Journey route strip */}
              {legs.length > 0 && (
                <div className="border-t border-slate-100 pt-4">
                  <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-2.5 flex items-center gap-1.5">
                    <Route className="w-3.5 h-3.5" /> Journey
                  </p>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {legs.map((l, i) => (
                      <span key={`${l.name}-${i}`} className="flex items-center gap-1.5">
                        {i > 0 && <span className="text-slate-300 text-xs">→</span>}
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium bg-gradient-to-br from-brand-50 to-amber-50 text-brand-700 border border-brand-100">
                          <MapPin className="w-3 h-3" />
                          {l.name}
                          <span className="text-[10px] text-brand-400 font-normal">
                            {l.from === l.to ? `D${l.from}` : `D${l.from}–${l.to}`}
                          </span>
                        </span>
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </Card>

            {/* ── Money strip ─────────────────────────────────────────── */}
            {costs && (costs.total > 0 || costs.lines.length > 0) && (
              <div>
                <div className="flex items-center justify-end mb-2">
                  <button
                    onClick={() => setShowAmounts(!showAmounts)}
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium text-slate-600 bg-white border border-slate-200 hover:bg-slate-50 transition-colors"
                  >
                    {showAmounts ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    {showAmounts ? 'Hide amounts' : 'Show amounts'}
                  </button>
                </div>
                {showAmounts ? (
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <HeadlineCost label="Selling Total" value={money(costs.total, costs.symbol)} tone="brand" icon={<Receipt className="w-5 h-5" />} foot={costs.totalPax > 0 ? `${money(costs.perPax, costs.symbol)} / pax` : undefined} />
                    <HeadlineCost label="Net Cost" value={money(costs.net, costs.symbol)} tone="slate" icon={<Wallet className="w-5 h-5" />} foot="excludes markup" />
                    <HeadlineCost label={costs.profit >= 0 ? 'Markup / Profit' : 'Loss'} value={money(costs.profit, costs.symbol)} tone={costs.profit >= 0 ? 'emerald' : 'red'} icon={costs.profit >= 0 ? <TrendingUp className="w-5 h-5" /> : <TrendingDown className="w-5 h-5" />} foot={`${costs.margin.toFixed(1)}% margin`} />
                  </div>
                ) : (
                  <Card className="p-4">
                    <p className="text-xs text-slate-400 italic flex items-center gap-2">
                      <EyeOff className="w-4 h-4" /> Amounts hidden. Use “PDF · no costs” to export a customer-facing copy.
                    </p>
                  </Card>
                )}
              </div>
            )}

            {/* ── Tabs ────────────────────────────────────────────────── */}
            <div className="inline-flex rounded-xl bg-slate-100 p-1">
              {([['confirmation', 'Confirmation', FileText], ['agenda', 'Agenda', Route], ['financials', 'Financials', CircleDollarSign]] as const).map(([val, label, Icon]) => {
                const active = tab === val
                return (
                  <button
                    key={val}
                    onClick={() => setTab(val)}
                    className={`flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${active ? 'bg-white text-brand-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                  >
                    <Icon className="w-3.5 h-3.5" /> {label}
                  </button>
                )
              })}
            </div>

            {tab === 'confirmation' && <ConfirmationTab quote={quote} pnl={pnl} />}
            {tab === 'agenda' && <AgendaTab itin={itin} dayPlan={extractDayPlan(pnl)} />}
            {tab === 'financials' && (
              <FinancialsTab quote={quote} pnl={pnl} costs={costs} showAmounts={showAmounts} totalPax={totalPax} />
            )}

            {/* ── Raw API response (bottom) ───────────────────────────── */}
            <RawApiCard quote={quote} quotationNo={quotationNo} referenceId={referenceId} />
          </>
        )}
      </div>
    </div>
  )
}

// ── Confirmation tab ─────────────────────────────────────────────────────────
function ConfirmationTab({ quote, pnl }: { quote: Quote; pnl: Record<string, unknown> }) {
  const acc = quote.accommodation ?? []
  const includes = quote.package_includes ?? []
  const excludes = quote.package_excludes ?? []
  const terms = quote.terms_and_conditions ?? []
  const vas = quote.value_added_services ?? []
  const accTotal = num(get(pnl, 'accommodation', 'total'))
  const accDays = num(get(pnl, 'accommodation', 'days'))
  const totalNights = acc.reduce((s, a) => s + Number(a.nights ?? 0), 0)

  return (
    <div className="space-y-5">
      {/* Accommodation */}
      <Card className="p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
            <Bed className="w-4 h-4 text-amber-500" /> Accommodation — {acc.length} stay{acc.length !== 1 ? 's' : ''}
          </h2>
          <span className="text-xs text-slate-400">
            {totalNights} night{totalNights !== 1 ? 's' : ''}
            {accDays > 0 ? ` · ${accDays} chargeable day${accDays !== 1 ? 's' : ''}` : ''}
            {accTotal > 0 ? ` · ${accTotal} units` : ''}
          </span>
        </div>
        {acc.length === 0 ? (
          <p className="text-xs text-slate-400 italic">No accommodation listed.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {acc.map((a, i) => (
              <div key={i} className="rounded-xl border border-slate-100 bg-white p-4">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="w-8 h-8 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center flex-shrink-0"><Building2 className="w-4 h-4" /></div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-800 truncate">{a.city ?? 'Stay'}</p>
                      <p className="text-[11px] text-slate-400 capitalize">{(a.type ?? '').replace(/_/g, ' ')}</p>
                    </div>
                  </div>
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-slate-100 text-slate-600 flex-shrink-0">{a.nights ?? 0}N</span>
                </div>
                <div className="flex items-center gap-1.5 text-xs text-slate-500">
                  <Calendar className="w-3.5 h-3.5 text-slate-400" />
                  {fmtDate(a.check_in)} → {fmtDate(a.check_out)}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Value added services */}
      {vas.length > 0 && (
        <Card className="p-6">
          <h2 className="text-sm font-semibold text-slate-700 mb-4 flex items-center gap-2">
            <Gift className="w-4 h-4 text-pink-500" /> Value Added Services
          </h2>
          <div className="flex flex-wrap gap-2">
            {vas.map((v, i) => (
              <span key={i} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-pink-50 text-pink-700 border border-pink-100">
                <Sparkles className="w-3 h-3" />
                {typeof v === 'string' ? v : String((v as Record<string, unknown>)?.name ?? JSON.stringify(v))}
              </span>
            ))}
          </div>
        </Card>
      )}

      {/* Includes / Excludes */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <ListCard title="Package Includes" items={includes} icon={<ListChecks className="w-4 h-4 text-emerald-500" />} tone="emerald" />
        <ListCard title="Package Excludes" items={excludes} icon={<XCircle className="w-4 h-4 text-red-500" />} tone="red" />
      </div>

      {/* Terms */}
      <Card className="p-6">
        <h2 className="text-sm font-semibold text-slate-700 mb-4 flex items-center gap-2">
          <ScrollText className="w-4 h-4 text-slate-400" /> Terms &amp; Conditions
        </h2>
        {terms.length === 0 ? (
          <p className="text-xs text-slate-400 italic">None listed.</p>
        ) : (
          <ol className="list-decimal pl-5 space-y-1.5 text-xs text-slate-600">
            {terms.map((t, i) => <li key={i}>{t}</li>)}
          </ol>
        )}
      </Card>
    </div>
  )
}

// ── Agenda tab ───────────────────────────────────────────────────────────────
function AgendaTab({ itin, dayPlan }: {
  itin: ItineraryDay[]
  dayPlan: { day: number; date: string | null; entries: { kind: string; name: string }[] }[]
}) {
  const planByDay = new Map(dayPlan.map((d) => [d.day, d]))

  if (itin.length === 0) {
    return (
      <Card className="flex flex-col items-center justify-center h-40 text-slate-400">
        <Route className="w-9 h-9 mb-2 opacity-30" />
        <p className="text-sm">No itinerary available for this booking.</p>
      </Card>
    )
  }
  return (
    <Card className="p-6">
      <h2 className="text-sm font-semibold text-slate-700 mb-5 flex items-center gap-2">
        <Route className="w-4 h-4 text-brand-500" /> Tour Agenda — {itin.length} day{itin.length !== 1 ? 's' : ''}
      </h2>
      <div className="relative pl-8">
        <div className="absolute left-[13px] top-2 bottom-2 w-px bg-gradient-to-b from-brand-300 via-brand-200 to-transparent" />
        <div className="space-y-5">
          {itin.map((d) => {
            const plan = planByDay.get(d.day)
            return (
              <div key={d.day} className="relative">
                <div className="absolute -left-8 w-[26px] h-[26px] rounded-full bg-white border-2 border-brand-400 flex items-center justify-center text-[10px] font-bold text-brand-600">
                  {d.day}
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-baseline gap-2 mb-1">
                    <p className="text-sm font-semibold text-slate-800">Day {d.day}</p>
                    <span className="text-[11px] text-slate-400">{d.date_formatted ?? fmtDate(d.date)}</span>
                  </div>
                  {d.route && <p className="text-sm font-medium text-slate-700 mb-1">{d.route}</p>}
                  {d.description && <p className="text-xs text-slate-500 leading-relaxed mb-2">{d.description}</p>}

                  {(d.activities ?? []).length > 0 && (
                    <div className="space-y-2 mt-2">
                      {d.activities!.map((ac, i) => (
                        <div key={i} className="flex items-start gap-2.5 rounded-xl border border-slate-100 bg-slate-50/60 p-3">
                          <div className="w-7 h-7 rounded-lg bg-violet-50 text-violet-600 flex items-center justify-center flex-shrink-0">
                            {ac.type === 'attraction' ? <Sparkles className="w-3.5 h-3.5" /> : <Ticket className="w-3.5 h-3.5" />}
                          </div>
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-[9px] uppercase tracking-wide font-bold text-violet-600 bg-violet-100 rounded px-1.5 py-0.5">{(ac.type ?? 'activity').replace(/_/g, ' ')}</span>
                              <p className="text-sm font-semibold text-slate-800">{ac.name}</p>
                            </div>
                            {ac.description && <p className="text-xs text-slate-500 mt-1 leading-relaxed">{ac.description}</p>}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Booked (OB) items scheduled for this day */}
                  {plan && plan.entries.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {plan.entries.map((e, i) => (
                        <span key={i} className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium bg-sky-50 text-sky-700 border border-sky-100">
                          <Check className="w-3 h-3" /> {e.name}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </Card>
  )
}

// ── Financials tab ───────────────────────────────────────────────────────────
function FinancialsTab({ quote, pnl, costs, showAmounts, totalPax }: {
  quote: Quote; pnl: Record<string, unknown>; costs: CostSummary | null; showAmounts: boolean; totalPax: number
}) {
  const transport = useMemo(() => extractTransport(pnl), [pnl])
  const acts = useMemo(() => extractActivities(pnl), [pnl])

  if (!costs) return null
  if (!showAmounts) {
    return (
      <Card className="flex flex-col items-center justify-center h-40 text-slate-400">
        <EyeOff className="w-9 h-9 mb-2 opacity-30" />
        <p className="text-sm">Amounts are hidden — toggle “Show amounts” above.</p>
      </Card>
    )
  }

  const sym = costs.symbol
  const sellPP = get(pnl, 'cost', 'pp') as Record<string, unknown> | undefined
  const netPP = get(pnl, 'cost_without_markup', 'pp') as Record<string, unknown> | undefined
  const sellAdult = (sellPP?.adult ?? {}) as Record<string, unknown>
  const netAdult = (netPP?.adult ?? {}) as Record<string, unknown>
  const adultKeys = Object.keys(sellAdult)

  // Per-person component costs
  const ppRows = [
    { label: 'Hotel', icon: <Building2 className="w-3.5 h-3.5" />, v: num(get(pnl, 'cost', 'hotel', 'cost_pp')) },
    { label: 'Transport', icon: <Bus className="w-3.5 h-3.5" />, v: num(get(pnl, 'cost', 'transport', 'cost', 'per_person')) },
    { label: 'Attractions', icon: <Ticket className="w-3.5 h-3.5" />, v: num(get(pnl, 'cost', 'attraction', 'pax_cost', 'adult')) },
    { label: 'Meals', icon: <Utensils className="w-3.5 h-3.5" />, v: num(get(pnl, 'cost', 'meal', 'pax_cost', 'adult')) },
    { label: 'Hotel Transport', icon: <Bus className="w-3.5 h-3.5" />, v: num(get(pnl, 'cost', 'hotel_transport', 'pp_adult')) },
  ].filter((r) => r.v > 0)

  const supplementTotal = num(get(pnl, 'cost', 'supplement', 'total'))
  const costCut = num(get(pnl, 'cost', 'cost_cut', 'total'))
  const guide = num(get(pnl, 'guide_data', 'total'))
  const roomsValue = num(pnl.total_rooms_value)
  const roomPP = num(pnl.per_person_room_cost)
  const curFrom = get(pnl, 'budget', 'transport', 'currency', 'from') as Record<string, unknown> | undefined
  const curTo = get(pnl, 'budget', 'transport', 'currency', 'to') as Record<string, unknown> | undefined

  return (
    <div className="space-y-5">
      {/* Cost breakdown */}
      <Card className="p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
            <Receipt className="w-4 h-4 text-brand-500" /> Cost Breakdown
          </h2>
          <span className="text-xs text-slate-400">{costs.lines.length} cost line{costs.lines.length !== 1 ? 's' : ''}</span>
        </div>
        {costs.lines.length === 0 ? (
          <p className="text-xs text-slate-400 italic">No itemised cost breakdown available.</p>
        ) : (
          <div className="space-y-3">
            {costs.lines.map((l) => {
              const pct = costs.total > 0 ? (l.amount / costs.total) * 100 : 0
              const perPax = totalPax > 0 ? l.amount / totalPax : 0
              return (
                <div key={l.label} className="flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between text-sm mb-1">
                      <span className="text-slate-600 font-medium">{l.label}</span>
                      <span className="flex items-baseline gap-2">
                        {totalPax > 0 && <span className="text-[11px] text-slate-400 tabular-nums">{money(perPax, sym)}/pax</span>}
                        <span className="font-semibold text-slate-900 tabular-nums">{money(l.amount, sym)}</span>
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
            <div className="flex items-center justify-between pt-3 mt-1 border-t border-slate-100">
              <span className="text-sm font-semibold text-slate-700">Selling Total</span>
              <span className="text-base font-bold text-slate-900 tabular-nums">{money(costs.total, sym)}</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-400">Net cost</span>
              <span className="text-slate-500 tabular-nums">{money(costs.net, sym)}</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className={costs.profit >= 0 ? 'text-emerald-600' : 'text-red-600'}>
                {costs.profit >= 0 ? 'Markup' : 'Shortfall'} ({costs.margin.toFixed(1)}%)
              </span>
              <span className={`font-semibold tabular-nums ${costs.profit >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{money(costs.profit, sym)}</span>
            </div>
          </div>
        )}

        {/* Margin gauge */}
        {costs.total > 0 && (
          <div className="mt-5 pt-4 border-t border-slate-100">
            <div className="flex items-center gap-4">
              <div className="flex-1">
                <div className="flex h-6 rounded-lg overflow-hidden border border-slate-100">
                  <div className="bg-slate-300 flex items-center justify-center text-[10px] font-semibold text-slate-700" style={{ width: `${(costs.net / costs.total) * 100}%` }}>
                    {costs.net / costs.total > 0.12 ? 'Cost' : ''}
                  </div>
                  <div className={`${costs.profit >= 0 ? 'bg-emerald-400' : 'bg-red-400'} flex items-center justify-center text-[10px] font-semibold text-white`} style={{ width: `${Math.max(0, Math.min(100, costs.margin))}%` }}>
                    {costs.margin > 10 ? `${costs.margin.toFixed(0)}%` : ''}
                  </div>
                </div>
              </div>
              <div className="text-right flex-shrink-0">
                <p className={`text-2xl font-bold tabular-nums ${costs.profit >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{costs.margin.toFixed(1)}%</p>
                <p className="text-[10px] text-slate-400 uppercase tracking-wide">Margin</p>
              </div>
            </div>
          </div>
        )}
      </Card>

      {/* Per-person pricing */}
      {(adultKeys.length > 0 || ppRows.length > 0) && (
        <Card className="p-6">
          <h2 className="text-sm font-semibold text-slate-700 mb-4 flex items-center gap-2">
            <Users className="w-4 h-4 text-sky-500" /> Per-Person Pricing
          </h2>

          {adultKeys.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-5">
              {adultKeys.map((k) => {
                const sell = num(sellAdult[k]); const net = num(netAdult[k])
                const mk = sell - net
                return (
                  <div key={k} className="rounded-xl border border-sky-100 bg-sky-50/40 p-4">
                    <p className="text-[10px] uppercase tracking-wide text-slate-400 mb-1">
                      Adult{adultKeys.length > 1 ? ` · option ${k}` : ''}
                    </p>
                    <p className="text-xl font-bold text-slate-900 tabular-nums">{money(sell, sym)}</p>
                    <p className="text-[11px] text-slate-500 mt-1">
                      net {money(net, sym)} · <span className="text-emerald-600 font-semibold">+{money(mk, sym)}</span>
                    </p>
                  </div>
                )
              })}
              {num(sellPP?.cwb) > 0 && (
                <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-4">
                  <p className="text-[10px] uppercase tracking-wide text-slate-400 mb-1">Child with bed</p>
                  <p className="text-xl font-bold text-slate-900 tabular-nums">{money(num(sellPP?.cwb), sym)}</p>
                  <p className="text-[11px] text-slate-500 mt-1">net {money(num(netPP?.cwb), sym)}</p>
                </div>
              )}
              {num(sellPP?.cnb) > 0 && (
                <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-4">
                  <p className="text-[10px] uppercase tracking-wide text-slate-400 mb-1">Child no bed</p>
                  <p className="text-xl font-bold text-slate-900 tabular-nums">{money(num(sellPP?.cnb), sym)}</p>
                  <p className="text-[11px] text-slate-500 mt-1">net {money(num(netPP?.cnb), sym)}</p>
                </div>
              )}
            </div>
          )}

          {ppRows.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-2">Per-adult component costs</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
                {ppRows.map((r) => (
                  <div key={r.label} className="rounded-lg border border-slate-100 bg-white px-3 py-2">
                    <div className="flex items-center gap-1.5 text-slate-400 mb-1">{r.icon}<span className="text-[10px] uppercase tracking-wide truncate">{r.label}</span></div>
                    <p className="text-sm font-bold text-slate-900 tabular-nums">{money(r.v, sym)}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>
      )}

      {/* Transport economics */}
      {transport && (transport.total > 0 || transport.distanceKm > 0) && (
        <Card className="p-6">
          <h2 className="text-sm font-semibold text-slate-700 mb-4 flex items-center gap-2">
            <Bus className="w-4 h-4 text-sky-500" /> Transport Economics
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
            <MiniStat label="Vehicle" value={transport.vehicleType ? `#${transport.vehicleType}` : '—'} icon={<Bus className="w-4 h-4" />} />
            <MiniStat label="Distance" value={`${transport.distanceKm.toLocaleString()} km`} sub={transport.additionalKm > 0 ? `+${transport.additionalKm} additional` : undefined} icon={<Gauge className="w-4 h-4" />} />
            <MiniStat label="Total" value={money(transport.total, sym)} icon={<Coins className="w-4 h-4" />} />
            <MiniStat label="Per person" value={money(transport.perPerson, sym)} icon={<Users className="w-4 h-4" />} />
          </div>

          {transport.rateArray.length > 0 && (
            <div className="mb-4">
              <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-2">Rate segments</p>
              <div className="flex flex-wrap gap-1.5">
                {transport.rateArray.map((r, i) => (
                  <span key={i} className="inline-flex items-center px-2 py-1 rounded-lg text-xs font-mono bg-sky-50 text-sky-700 border border-sky-100 tabular-nums">
                    {money(r, sym)}
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
            {[
              { l: 'Vehicle rate', v: transport.vehicleRate },
              { l: 'Bata', v: transport.bata },
              { l: 'Paging', v: transport.paging },
              { l: 'Highway', v: transport.highway },
              { l: 'Driver acc.', v: transport.driverAcc },
              { l: 'Water bottle', v: transport.waterBottle },
            ].map((x) => (
              <div key={x.l} className="rounded-lg border border-slate-100 bg-slate-50/60 px-3 py-2">
                <p className="text-[10px] uppercase tracking-wide text-slate-400 truncate">{x.l}</p>
                <p className="text-sm font-semibold text-slate-700 tabular-nums">{money(x.v, sym)}</p>
              </div>
            ))}
          </div>

          {(transport.mealTransferCost > 0 || transport.mealTransferPp > 0) && (
            <div className="mt-3 flex items-center gap-2 text-xs text-slate-500">
              <Utensils className="w-3.5 h-3.5 text-slate-400" />
              Meal transfer: {money(transport.mealTransferCost, sym)} total · {money(transport.mealTransferPp, sym)} pp
            </div>
          )}
        </Card>
      )}

      {/* Activity economics */}
      {acts && acts.items.length > 0 && (
        <Card className="p-6">
          <h2 className="text-sm font-semibold text-slate-700 mb-4 flex items-center gap-2">
            <Ticket className="w-4 h-4 text-violet-500" /> Activity &amp; Attraction Economics
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-5">
            <div className="rounded-xl border border-violet-100 bg-violet-50/50 px-4 py-3">
              <p className="text-lg font-bold text-violet-700 tabular-nums">{money(acts.totalAttraction, sym)}</p>
              <p className="text-[10px] text-slate-400 uppercase tracking-wide mt-0.5">Ticketed attractions</p>
            </div>
            <div className="rounded-xl border border-slate-100 bg-slate-50/60 px-4 py-3">
              <p className="text-lg font-bold text-slate-600 tabular-nums">{money(acts.totalNone, sym)}</p>
              <p className="text-[10px] text-slate-400 uppercase tracking-wide mt-0.5">Transfers / non-ticketed</p>
            </div>
            <div className="rounded-xl border border-brand-100 bg-brand-50/50 px-4 py-3">
              <p className="text-lg font-bold text-brand-700 tabular-nums">{money(acts.total, sym)}</p>
              <p className="text-[10px] text-slate-400 uppercase tracking-wide mt-0.5">
                Activities total{acts.paxAdult > 0 ? ` · ${money(acts.paxAdult, sym)}/adult` : ''}
              </p>
            </div>
          </div>

          <div className="space-y-2">
            {acts.items.map((it) => (
              <div key={`${it.kind}-${it.id}`} className="rounded-xl border border-slate-100 bg-white p-4">
                <div className="flex items-start justify-between gap-3 mb-2">
                  <div className="flex items-start gap-2.5 min-w-0">
                    <div className="w-8 h-8 rounded-lg bg-violet-50 text-violet-600 flex items-center justify-center flex-shrink-0">
                      {it.kind === 'attraction' ? <Sparkles className="w-4 h-4" /> : <Landmark className="w-4 h-4" />}
                    </div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[9px] uppercase tracking-wide font-bold text-violet-600 bg-violet-100 rounded px-1.5 py-0.5">{it.kind.replace(/_/g, ' ')}</span>
                        <p className="text-sm font-semibold text-slate-800">{it.name}</p>
                      </div>
                      {it.duration > 0 && (
                        <p className="text-[11px] text-slate-400 mt-1 flex items-center gap-1"><Timer className="w-3 h-3" /> {it.duration} min</p>
                      )}
                    </div>
                  </div>
                  <p className="text-sm font-bold text-slate-900 tabular-nums flex-shrink-0">{money(it.total, sym)}</p>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <RateChip label="Adult" value={money(it.adultRate, sym)} />
                  <RateChip label="Child" value={money(it.childRate, sym)} />
                  {it.transferRate > 0 && <RateChip label="Transfer" value={money(it.transferRate, sym)} tone="sky" />}
                  {it.adultEntrance > 0 && <RateChip label="Adult entry" value={money(it.adultEntrance, sym)} tone="emerald" />}
                  {it.childEntrance > 0 && <RateChip label="Child entry" value={money(it.childEntrance, sym)} tone="emerald" />}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Other financials */}
      <Card className="p-6">
        <h2 className="text-sm font-semibold text-slate-700 mb-4 flex items-center gap-2">
          <Percent className="w-4 h-4 text-slate-400" /> Other Financials
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          <MiniStat label="Supplement" value={money(supplementTotal, sym)} icon={<PlusCircle className="w-4 h-4" />} />
          <MiniStat label="Cost cut" value={money(costCut, sym)} icon={<Scissors className="w-4 h-4" />} />
          <MiniStat label="Guide" value={money(guide, sym)} icon={<User className="w-4 h-4" />} />
          <MiniStat label="Rooms value" value={money(roomsValue, sym)} sub={roomPP > 0 ? `${money(roomPP, sym)} pp` : undefined} icon={<Bed className="w-4 h-4" />} />
        </div>

        {(curFrom || curTo) && (
          <div className="mt-4 pt-4 border-t border-slate-100">
            <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-2 flex items-center gap-1.5">
              <ArrowRightLeft className="w-3.5 h-3.5" /> Currency conversion
            </p>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-50 border border-slate-200 font-medium text-slate-700">
                {String(curFrom?.code ?? '—')} <span className="text-[11px] text-slate-400">@ {String(curFrom?.exchange_rate ?? '—')}</span>
              </span>
              <ArrowRightLeft className="w-4 h-4 text-slate-300" />
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-50 border border-slate-200 font-medium text-slate-700">
                {String(curTo?.code ?? '—')} <span className="text-[11px] text-slate-400">@ {String(curTo?.exchange_rate ?? '—')}</span>
              </span>
            </div>
          </div>
        )}
      </Card>
    </div>
  )
}

// ── Raw API response ─────────────────────────────────────────────────────────
function RawApiCard({ quote, quotationNo, referenceId }: { quote: Quote; quotationNo: string; referenceId: string }) {
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)

  const json = useMemo(() => JSON.stringify(quote, null, 2), [quote])
  // Highlighting a very large payload is expensive — fall back to plain text.
  const html = useMemo(() => (json.length <= 200_000 ? highlightJson(json) : null), [json])
  const sizeKb = (new TextEncoder().encode(json).length / 1024).toFixed(1)
  const requestBody = JSON.stringify({ quotation_no: quotationNo, reference_id: referenceId }, null, 2)

  async function copyJson() {
    try {
      await navigator.clipboard.writeText(json)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch { /* clipboard unavailable */ }
  }

  function downloadJson() {
    const blob = new Blob([json], { type: 'application/json' })
    const href = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = href
    a.download = `AS-${quotationNo}-raw.json`
    document.body.appendChild(a); a.click(); a.remove()
    URL.revokeObjectURL(href)
  }

  return (
    <Card className="overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-5 py-3.5 text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors"
      >
        <span className="flex items-center gap-2">
          <Code2 className="w-4 h-4 text-slate-400" />
          Raw API response
          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 border border-slate-200">{sizeKb} KB</span>
          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-600 border border-emerald-100">200 OK</span>
        </span>
        <ChevronDown className={`w-4 h-4 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="border-t border-slate-100">
          {/* Endpoint + request */}
          <div className="px-5 py-4 bg-slate-50/60 border-b border-slate-100 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">POST</span>
              <code className="text-xs font-mono text-slate-700">/api/quotation/template/quote</code>
              <span className="text-[10px] text-slate-400">upstream · AppleSystem</span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-sky-100 text-sky-700">GET</span>
              <code className="text-xs font-mono text-slate-500">/api/as-bookings-v2/quote?quotation_no={quotationNo}&amp;reference_id={referenceId}</code>
              <span className="text-[10px] text-slate-400">this app · proxy</span>
            </div>
            <div>
              <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-1.5">Request body</p>
              <pre className="text-[11px] font-mono bg-white border border-slate-200 rounded-lg p-3 text-slate-600 overflow-x-auto">{requestBody}</pre>
            </div>
          </div>

          {/* Actions */}
          <div className="px-5 py-2.5 flex items-center justify-between border-b border-slate-100">
            <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Response body</p>
            <div className="flex items-center gap-1.5">
              <button
                onClick={copyJson}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium text-slate-600 border border-slate-200 hover:bg-slate-50 transition-colors"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                {copied ? 'Copied' : 'Copy'}
              </button>
              <button
                onClick={downloadJson}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium text-slate-600 border border-slate-200 hover:bg-slate-50 transition-colors"
              >
                <Download className="w-3.5 h-3.5" /> JSON
              </button>
            </div>
          </div>

          <div className="max-h-[520px] overflow-auto bg-slate-50/40">
            {html ? (
              <pre
                className="text-[11px] leading-relaxed font-mono p-4 whitespace-pre-wrap break-words"
                dangerouslySetInnerHTML={{ __html: html }}
              />
            ) : (
              <pre className="text-[11px] leading-relaxed font-mono p-4 whitespace-pre-wrap break-words text-slate-600">{json}</pre>
            )}
          </div>
        </div>
      )}
    </Card>
  )
}

// ── Small components ─────────────────────────────────────────────────────────
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

function MiniStat({ label, value, sub, icon }: { label: string; value: string; sub?: string; icon: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-100 bg-slate-50/60 px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-slate-400 mb-1">
        {icon}<span className="text-[10px] uppercase tracking-wide truncate">{label}</span>
      </div>
      <p className="text-sm font-bold text-slate-900 tabular-nums truncate">{value}</p>
      {sub && <p className="text-[10px] text-slate-400 mt-0.5 truncate">{sub}</p>}
    </div>
  )
}

function RateChip({ label, value, tone = 'slate' }: { label: string; value: string; tone?: 'slate' | 'sky' | 'emerald' }) {
  const tones: Record<string, string> = {
    slate: 'bg-slate-50 text-slate-600 border-slate-200',
    sky: 'bg-sky-50 text-sky-700 border-sky-100',
    emerald: 'bg-emerald-50 text-emerald-700 border-emerald-100',
  }
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium border ${tones[tone]}`}>
      <span className="opacity-60">{label}</span>
      <span className="font-mono font-semibold tabular-nums">{value}</span>
    </span>
  )
}

function HeadlineCost({ label, value, tone, icon, foot }: { label: string; value: string; tone: 'brand' | 'slate' | 'emerald' | 'red'; icon: React.ReactNode; foot?: string }) {
  const tones: Record<string, string> = {
    brand: 'from-brand-500 to-brand-600', slate: 'from-slate-600 to-slate-700',
    emerald: 'from-emerald-500 to-emerald-600', red: 'from-red-500 to-red-600',
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

function ListCard({ title, items, icon, tone }: { title: string; items: string[]; icon: React.ReactNode; tone: 'emerald' | 'red' }) {
  const dot = tone === 'emerald' ? 'text-emerald-500' : 'text-red-400'
  return (
    <Card className="p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-slate-700 flex items-center gap-2">{icon} {title}</h2>
        <span className="text-xs text-slate-400">{items.length}</span>
      </div>
      {items.length === 0 ? (
        <p className="text-xs text-slate-400 italic">None listed.</p>
      ) : (
        <ul className="space-y-1.5">
          {items.map((it, i) => (
            <li key={i} className="flex items-start gap-2 text-xs text-slate-600">
              <span className={`mt-1.5 w-1 h-1 rounded-full bg-current flex-shrink-0 ${dot}`} />
              {it}
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

export default function ASBookingV2DetailPage() {
  return (
    <Suspense fallback={<div className="flex justify-center h-64"><div className="w-6 h-6 border-2 border-brand-500 border-t-transparent rounded-full animate-spin mt-20" /></div>}>
      <ASBookingV2DetailInner />
    </Suspense>
  )
}
