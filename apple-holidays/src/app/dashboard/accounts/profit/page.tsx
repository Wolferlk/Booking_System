'use client'

import { useEffect, useState } from 'react'
import { Loader2, TrendingUp, TrendingDown } from 'lucide-react'
import Header from '@/components/layout/header'
import { Card, CardHeader, CardBody } from '@/components/ui/card'
import { formatCurrency } from '@/lib/utils'
import { useCountryFilter } from '@/hooks/use-country-filter'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from 'recharts'

const COLORS = ['#eab308', '#22c55e', '#3b82f6', '#a855f7', '#f97316', '#ef4444']

export default function ProfitDashboardPage() {
  const { countryFilter } = useCountryFilter()
  const [stats, setStats] = useState<Record<string, unknown> | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const params = new URLSearchParams()
    if (countryFilter && countryFilter !== 'ALL') params.set('country', countryFilter)
    fetch(`/api/dashboard/stats?${params}`)
      .then(r => r.json())
      .then(j => { if (j.success) setStats(j.data) })
      .finally(() => setLoading(false))
  }, [countryFilter])

  if (loading) return <div className="flex justify-center h-48"><Loader2 className="w-6 h-6 text-brand-500 animate-spin mt-12" /></div>

  const revenue = Number(stats?.totalRevenue ?? 0)
  const cost = Number(stats?.totalCost ?? 0)
  const profit = Number(stats?.totalProfit ?? 0)
  const margin = revenue > 0 ? (profit / revenue) * 100 : 0

  const chartData = [
    { name: 'Revenue', value: revenue },
    { name: 'Cost', value: cost },
    { name: 'Profit', value: profit },
  ]

  const statusData = stats?.byStatus
    ? Object.entries(stats.byStatus as Record<string, number>).map(([name, value]) => ({ name, value }))
    : []

  return (
    <div>
      <Header title="Profit Dashboard" subtitle="Financial overview across all bookings" />
      <div className="p-8 space-y-6">

        {/* KPIs */}
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
          {[
            { label: 'Total Revenue', value: formatCurrency(revenue), color: 'text-slate-900', bg: 'bg-blue-50' },
            { label: 'Total Cost', value: formatCurrency(cost), color: 'text-slate-900', bg: 'bg-orange-50' },
            { label: 'Total Profit', value: formatCurrency(profit), color: profit >= 0 ? 'text-green-600' : 'text-red-600', bg: profit >= 0 ? 'bg-green-50' : 'bg-red-50' },
            { label: 'Margin', value: `${margin.toFixed(1)}%`, color: margin >= 15 ? 'text-green-600' : 'text-orange-600', bg: 'bg-purple-50' },
          ].map(k => (
            <Card key={k.label} className={`p-5 ${k.bg}`}>
              <p className="text-xs text-slate-500">{k.label}</p>
              <p className={`text-2xl font-bold mt-1 ${k.color}`}>{k.value}</p>
            </Card>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Revenue vs Cost vs Profit bar */}
          <Card>
            <CardHeader><h3 className="text-sm font-semibold">Revenue / Cost / Profit</h3></CardHeader>
            <CardBody>
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} tickFormatter={v => `$${v}`} />
                  <Tooltip formatter={(v: number) => formatCurrency(v)} />
                  <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                    {chartData.map((_, i) => (
                      <Cell key={i} fill={['#3b82f6', '#f97316', '#22c55e'][i]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </CardBody>
          </Card>

          {/* Bookings by status pie */}
          <Card>
            <CardHeader><h3 className="text-sm font-semibold">Bookings by Status</h3></CardHeader>
            <CardBody>
              {statusData.length > 0 ? (
                <ResponsiveContainer width="100%" height={250}>
                  <PieChart>
                    <Pie data={statusData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label>
                      {statusData.map((_, i) => (
                        <Cell key={i} fill={COLORS[i % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <p className="text-center text-slate-400 text-sm py-8">No data</p>
              )}
            </CardBody>
          </Card>
        </div>

        {/* Summary table */}
        <Card>
          <CardHeader><h3 className="text-sm font-semibold">Summary</h3></CardHeader>
          <CardBody>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-3">
                {[
                  { label: 'Total Bookings', value: String(stats?.totalBookings ?? 0) },
                  { label: 'Active Bookings', value: String(stats?.activeBookings ?? 0) },
                  { label: 'Upcoming (30d)', value: String(stats?.upcomingTrips ?? 0) },
                  { label: 'Pending Review', value: String(stats?.pendingReview ?? 0) },
                ].map(r => (
                  <div key={r.label} className="flex justify-between py-2 border-b border-slate-100">
                    <span className="text-sm text-slate-500">{r.label}</span>
                    <span className="text-sm font-semibold">{r.value}</span>
                  </div>
                ))}
              </div>
              <div className="space-y-3">
                {[
                  { label: 'Revenue per Booking', value: formatCurrency(stats?.totalBookings ? revenue / (stats.totalBookings as number) : 0) },
                  { label: 'Profit per Booking', value: formatCurrency(stats?.totalBookings ? profit / (stats.totalBookings as number) : 0) },
                  { label: 'Cost Ratio', value: revenue > 0 ? `${((cost / revenue) * 100).toFixed(1)}%` : '—' },
                  { label: 'Profit Margin', value: `${margin.toFixed(1)}%` },
                ].map(r => (
                  <div key={r.label} className="flex justify-between py-2 border-b border-slate-100">
                    <span className="text-sm text-slate-500">{r.label}</span>
                    <span className="text-sm font-semibold">{r.value}</span>
                  </div>
                ))}
              </div>
            </div>
          </CardBody>
        </Card>
      </div>
    </div>
  )
}
