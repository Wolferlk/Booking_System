'use client'

import { useState, useEffect, useCallback } from 'react'
import { toast } from 'sonner'
import {
  TrendingUp, TrendingDown, Users, Calendar,
  BarChart2, Loader2, ArrowLeft, Minus,
} from 'lucide-react'
import Header from '@/components/layout/header'
import { Card } from '@/components/ui/card'
import Link from 'next/link'

interface Stats {
  total: number
  cancelled: number
  byStatus: Record<string, number>
  totalPax: number
  totalAdults: number
  totalChildren: number
  totalRevenue: number
  topAgents: { agent: string; count: number }[]
}
interface Period { start: string; end: string; stats: Stats }
interface StatusRow { status: string; count: number }

const STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Draft', GT_REVIEW: 'GT Review', BT_CONFIRMED: 'BT Confirmed',
  GT_VERIFIED: 'GT Verified', OPERATIONS_READY: 'Ops Ready',
  CLIENT_LIVE: 'Client Live', IN_PROGRESS: 'In Progress',
  COMPLETED: 'Completed', CANCELLED: 'Cancelled', CHANGE_REQUESTED: 'Change Req',
}

const STATUS_COLOR: Record<string, string> = {
  DRAFT: 'bg-slate-200', GT_REVIEW: 'bg-yellow-200', BT_CONFIRMED: 'bg-blue-200',
  GT_VERIFIED: 'bg-indigo-200', OPERATIONS_READY: 'bg-purple-200',
  CLIENT_LIVE: 'bg-green-200', IN_PROGRESS: 'bg-teal-300',
  COMPLETED: 'bg-emerald-500', CANCELLED: 'bg-red-200', CHANGE_REQUESTED: 'bg-orange-200',
}

function fmt(d: string) {
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}
function fmtMoney(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n)
}
function delta(a: number, b: number) {
  if (b === 0) return null
  return Math.round(((a - b) / b) * 100)
}

function DeltaBadge({ a, b }: { a: number; b: number }) {
  const d = delta(a, b)
  if (d === null) return <span className="text-slate-400 text-xs">—</span>
  const up = d > 0
  const Icon = d === 0 ? Minus : up ? TrendingUp : TrendingDown
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs font-semibold px-1.5 py-0.5 rounded-full ${
      d === 0 ? 'bg-slate-100 text-slate-500' :
      up ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'
    }`}>
      <Icon className="w-3 h-3" />
      {d === 0 ? '0%' : `${Math.abs(d)}%`}
    </span>
  )
}

function defaultDates() {
  const now = new Date()
  const thisStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10)
  const thisEnd   = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10)
  const lastStart = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString().slice(0, 10)
  const lastEnd   = new Date(now.getFullYear(), now.getMonth(), 0).toISOString().slice(0, 10)
  return { thisStart, thisEnd, lastStart, lastEnd }
}

export default function TEAnalyticsPage() {
  const def = defaultDates()
  const [fromA, setFromA] = useState(def.thisStart)
  const [toA,   setToA]   = useState(def.thisEnd)
  const [fromB, setFromB] = useState(def.lastStart)
  const [toB,   setToB]   = useState(def.lastEnd)
  const [data,  setData]  = useState<{ periodA: Period; periodB: Period; statusDistribution: StatusRow[] } | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const url = `/api/te/analytics?fromA=${fromA}&toA=${toA}&fromB=${fromB}&toB=${toB}`
      const res  = await fetch(url)
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      setData(json.data)
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to load analytics')
    } finally {
      setLoading(false)
    }
  }, [fromA, toA, fromB, toB])

  useEffect(() => { load() }, [load])

  const A = data?.periodA.stats
  const B = data?.periodB.stats
  const dist = data?.statusDistribution ?? []
  const maxDist = Math.max(...dist.map(s => s.count), 1)

  return (
    <div>
      <Header
        title="Analytics & Compare"
        subtitle="Compare booking periods and analyse performance"
        actions={
          <Link href="/dashboard/te/live" className="btn btn-sm btn-secondary">
            <ArrowLeft className="w-4 h-4" /> Live Overview
          </Link>
        }
      />

      <div className="p-6 max-w-7xl space-y-5">

        {/* Period pickers */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Period A */}
          <Card className="p-4 border-brand-200 bg-brand-50/30">
            <p className="text-xs font-semibold text-brand-700 uppercase tracking-wide mb-3">Period A (Current)</p>
            <div className="flex gap-3 flex-wrap items-end">
              <div>
                <label className="form-label text-xs">From</label>
                <input type="date" className="form-input text-sm" value={fromA} onChange={e => setFromA(e.target.value)} />
              </div>
              <div>
                <label className="form-label text-xs">To</label>
                <input type="date" className="form-input text-sm" value={toA} onChange={e => setToA(e.target.value)} />
              </div>
            </div>
          </Card>
          {/* Period B */}
          <Card className="p-4 border-slate-200">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Period B (Compare)</p>
            <div className="flex gap-3 flex-wrap items-end">
              <div>
                <label className="form-label text-xs">From</label>
                <input type="date" className="form-input text-sm" value={fromB} onChange={e => setFromB(e.target.value)} />
              </div>
              <div>
                <label className="form-label text-xs">To</label>
                <input type="date" className="form-input text-sm" value={toB} onChange={e => setToB(e.target.value)} />
              </div>
            </div>
          </Card>
        </div>

        {loading && (
          <div className="flex items-center justify-center py-20 gap-3">
            <Loader2 className="w-6 h-6 text-brand-500 animate-spin" />
            <span className="text-slate-500">Loading analytics…</span>
          </div>
        )}

        {!loading && A && B && (
          <>
            {/* KPI comparison table */}
            <Card className="overflow-hidden">
              <div className="grid grid-cols-4 text-xs font-semibold text-slate-400 uppercase tracking-wide px-5 py-3 border-b bg-slate-50">
                <span>Metric</span>
                <span className="text-brand-700">Period A · {fmt(fromA)} – {fmt(toA)}</span>
                <span className="text-slate-500">Period B · {fmt(fromB)} – {fmt(toB)}</span>
                <span>Change</span>
              </div>
              {[
                { label: 'Total Bookings', a: A.total,         b: B.total,         fmt: (n: number) => String(n),   icon: <Calendar className="w-4 h-4" /> },
                { label: 'Total Pax',      a: A.totalPax,      b: B.totalPax,      fmt: (n: number) => String(n),   icon: <Users className="w-4 h-4" /> },
                { label: 'Adults',         a: A.totalAdults,   b: B.totalAdults,   fmt: (n: number) => String(n),   icon: null },
                { label: 'Children',       a: A.totalChildren, b: B.totalChildren, fmt: (n: number) => String(n),   icon: null },
                { label: 'Revenue (USD)',  a: A.totalRevenue,  b: B.totalRevenue,  fmt: fmtMoney,                   icon: <TrendingUp className="w-4 h-4" /> },
                { label: 'Cancelled',      a: A.cancelled,     b: B.cancelled,     fmt: (n: number) => String(n),   icon: null },
              ].map(row => (
                <div key={row.label} className="grid grid-cols-4 items-center px-5 py-3 border-b last:border-0 hover:bg-slate-50 transition-colors">
                  <div className="flex items-center gap-2 text-sm font-medium text-slate-700">
                    {row.icon && <span className="text-slate-400">{row.icon}</span>}
                    {row.label}
                  </div>
                  <span className="text-base font-bold text-brand-700">{row.fmt(row.a)}</span>
                  <span className="text-base font-semibold text-slate-500">{row.fmt(row.b)}</span>
                  <DeltaBadge a={row.a} b={row.b} />
                </div>
              ))}
            </Card>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Status distribution */}
              <Card className="p-5">
                <div className="flex items-center gap-2 mb-4">
                  <BarChart2 className="w-4 h-4 text-brand-500" />
                  <p className="font-semibold text-slate-800 text-sm">Status Distribution (Period A)</p>
                </div>
                <div className="space-y-2">
                  {dist.sort((a, b) => b.count - a.count).map(row => (
                    <div key={row.status}>
                      <div className="flex justify-between text-xs mb-0.5">
                        <span className="text-slate-600">{STATUS_LABELS[row.status] ?? row.status}</span>
                        <span className="font-semibold text-slate-700">{row.count}</span>
                      </div>
                      <div className="h-4 bg-slate-100 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${STATUS_COLOR[row.status] ?? 'bg-slate-300'}`}
                          style={{ width: `${(row.count / maxDist) * 100}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </Card>

              {/* Top agents comparison */}
              <Card className="p-5">
                <div className="flex items-center gap-2 mb-4">
                  <Users className="w-4 h-4 text-brand-500" />
                  <p className="font-semibold text-slate-800 text-sm">Top Agents</p>
                </div>
                <div className="space-y-3">
                  {/* Merge agents from both periods */}
                  {Array.from(new Set([
                    ...A.topAgents.map(a => a.agent),
                    ...B.topAgents.map(a => a.agent),
                  ])).slice(0, 6).map(agent => {
                    const aCount = A.topAgents.find(x => x.agent === agent)?.count ?? 0
                    const bCount = B.topAgents.find(x => x.agent === agent)?.count ?? 0
                    const maxVal = Math.max(aCount, bCount, 1)
                    return (
                      <div key={agent}>
                        <div className="flex justify-between items-center text-xs mb-1">
                          <span className="font-medium text-slate-700 truncate max-w-[160px]">{agent}</span>
                          <div className="flex gap-2 items-center flex-shrink-0">
                            <span className="text-brand-700 font-bold">{aCount}</span>
                            <span className="text-slate-400">vs</span>
                            <span className="text-slate-500">{bCount}</span>
                            <DeltaBadge a={aCount} b={bCount} />
                          </div>
                        </div>
                        <div className="flex gap-1 h-2">
                          <div className="bg-brand-400 rounded-full" style={{ width: `${(aCount / maxVal) * 50}%` }} />
                          <div className="bg-slate-300 rounded-full" style={{ width: `${(bCount / maxVal) * 50}%` }} />
                        </div>
                      </div>
                    )
                  })}
                </div>
                <div className="flex gap-4 mt-4 pt-3 border-t border-slate-100">
                  <span className="flex items-center gap-1.5 text-xs text-slate-500">
                    <span className="w-3 h-2 bg-brand-400 rounded-full inline-block" /> Period A
                  </span>
                  <span className="flex items-center gap-1.5 text-xs text-slate-500">
                    <span className="w-3 h-2 bg-slate-300 rounded-full inline-block" /> Period B
                  </span>
                </div>
              </Card>
            </div>

            {/* Revenue per pax */}
            {A.totalPax > 0 && (
              <Card className="p-5">
                <p className="font-semibold text-slate-800 text-sm mb-4">Revenue per Pax</p>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {[
                    { label: 'Rev/Pax (A)',       value: fmtMoney(A.totalPax > 0 ? A.totalRevenue / A.totalPax : 0) },
                    { label: 'Rev/Pax (B)',        value: fmtMoney(B.totalPax > 0 ? B.totalRevenue / B.totalPax : 0) },
                    { label: 'Rev/Booking (A)',    value: fmtMoney(A.total > 0 ? A.totalRevenue / A.total : 0) },
                    { label: 'Rev/Booking (B)',    value: fmtMoney(B.total > 0 ? B.totalRevenue / B.total : 0) },
                  ].map(m => (
                    <div key={m.label} className="bg-slate-50 rounded-xl p-3 text-center">
                      <p className="text-xs text-slate-500 mb-1">{m.label}</p>
                      <p className="text-lg font-bold text-slate-800">{m.value}</p>
                    </div>
                  ))}
                </div>
              </Card>
            )}
          </>
        )}
      </div>
    </div>
  )
}
