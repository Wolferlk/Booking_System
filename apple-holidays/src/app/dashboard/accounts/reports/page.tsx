'use client'

import { useEffect, useState } from 'react'
import { Loader2, Download, FileText, Filter } from 'lucide-react'
import { useCountryFilter } from '@/hooks/use-country-filter'
import Header from '@/components/layout/header'
import { Card, CardHeader, CardBody } from '@/components/ui/card'
import { StatusBadge } from '@/components/ui/badge'
import { formatDate, formatCurrency } from '@/lib/utils'
import { toast } from 'sonner'

type ReportRow = {
  bookingRef: string
  agent: string
  fileHandler: string
  status: string
  arrivalDate: string
  departureDate: string
  paxAdults: number
  paxChildren: number
  quotedTotal: number
  currency: string
  totalRevenue: number
  totalCost: number
  profit: number
  marginPct: number
  totalPaid: number
  balanceDue: number
  leadPassenger: string
  createdAt: string
}

const STATUSES = [
  { value: '', label: 'All Statuses' },
  { value: 'DRAFT', label: 'Draft' },
  { value: 'BT_CONFIRMED', label: 'BT Confirmed' },
  { value: 'GT_REVIEW', label: 'GT Review' },
  { value: 'GT_VERIFIED', label: 'GT Verified' },
  { value: 'OPERATIONS_READY', label: 'Operations Ready' },
  { value: 'COMPLETED', label: 'Completed' },
  { value: 'CANCELLED', label: 'Cancelled' },
]

export default function ReportsPage() {
  const { countryFilter } = useCountryFilter()
  const [rows, setRows] = useState<ReportRow[]>([])
  const [loading, setLoading] = useState(false)
  const [filterStatus, setFilterStatus] = useState('')
  const [filterFrom, setFilterFrom] = useState('')
  const [filterTo, setFilterTo] = useState('')
  const [filterAgent, setFilterAgent] = useState('')

  async function load() {
    setLoading(true)
    try {
      const params = new URLSearchParams({ limit: '500' })
      if (filterStatus) params.set('status', filterStatus)
      if (filterAgent) params.set('search', filterAgent)
      if (countryFilter && countryFilter !== 'ALL') params.set('country', countryFilter)

      const res = await fetch(`/api/accounts/report?${params}`)
      const json = await res.json()
      if (json.success) {
        let data: ReportRow[] = json.data
        // client-side date filter
        if (filterFrom) data = data.filter(r => r.arrivalDate >= filterFrom)
        if (filterTo) data = data.filter(r => r.arrivalDate <= filterTo)
        setRows(data)
      } else {
        toast.error(json.error ?? 'Failed to load report')
      }
    } catch {
      toast.error('Failed to load report')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [countryFilter]) // eslint-disable-line react-hooks/exhaustive-deps

  function downloadCSV() {
    if (rows.length === 0) { toast.error('No data to export'); return }

    const headers = [
      'Booking Ref', 'Agent', 'File Handler', 'Status',
      'Arrival', 'Departure', 'Adults', 'Children',
      'Quoted Total', 'Currency', 'Revenue', 'Cost', 'Profit', 'Margin %',
      'Total Paid', 'Balance Due', 'Lead Passenger', 'Created',
    ]

    const csvRows = rows.map(r => [
      r.bookingRef, r.agent, r.fileHandler, r.status,
      r.arrivalDate ? formatDate(r.arrivalDate) : '',
      r.departureDate ? formatDate(r.departureDate) : '',
      r.paxAdults, r.paxChildren,
      r.quotedTotal, r.currency,
      r.totalRevenue.toFixed(2), r.totalCost.toFixed(2),
      r.profit.toFixed(2), r.marginPct.toFixed(1) + '%',
      r.totalPaid.toFixed(2), r.balanceDue.toFixed(2),
      r.leadPassenger, r.createdAt ? formatDate(r.createdAt) : '',
    ].map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','))

    const csv = [headers.join(','), ...csvRows].join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `bookings-report-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
    toast.success(`Exported ${rows.length} rows`)
  }

  // Totals
  const totalRevenue = rows.reduce((s, r) => s + (r.totalRevenue || 0), 0)
  const totalCost = rows.reduce((s, r) => s + (r.totalCost || 0), 0)
  const totalProfit = rows.reduce((s, r) => s + (r.profit || 0), 0)
  const totalPaid = rows.reduce((s, r) => s + (r.totalPaid || 0), 0)
  const totalBalance = rows.reduce((s, r) => s + (r.balanceDue || 0), 0)
  const avgMargin = totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0

  return (
    <div>
      <Header
        title="Reports"
        subtitle="Export booking data and financial summaries"
        actions={
          <button onClick={downloadCSV} className="btn btn-primary btn-sm">
            <Download className="w-4 h-4" /> Export CSV
          </button>
        }
      />

      <div className="p-8 space-y-6">

        {/* Filters */}
        <Card>
          <CardHeader>
            <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
              <Filter className="w-4 h-4 text-slate-400" /> Filters
            </h3>
          </CardHeader>
          <CardBody>
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
              <div>
                <label className="form-label">Status</label>
                <select
                  className="form-input"
                  value={filterStatus}
                  onChange={e => setFilterStatus(e.target.value)}
                >
                  {STATUSES.map(s => (
                    <option key={s.value} value={s.value}>{s.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="form-label">Arrival From</label>
                <input
                  type="date"
                  className="form-input"
                  value={filterFrom}
                  onChange={e => setFilterFrom(e.target.value)}
                />
              </div>
              <div>
                <label className="form-label">Arrival To</label>
                <input
                  type="date"
                  className="form-input"
                  value={filterTo}
                  onChange={e => setFilterTo(e.target.value)}
                />
              </div>
              <div>
                <label className="form-label">Agent / Search</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="Agent name, booking ref…"
                  value={filterAgent}
                  onChange={e => setFilterAgent(e.target.value)}
                />
              </div>
            </div>
            <div className="mt-4 flex gap-2">
              <button onClick={load} className="btn btn-primary btn-sm" disabled={loading}>
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Filter className="w-4 h-4" />}
                Apply Filters
              </button>
              <button onClick={() => {
                setFilterStatus(''); setFilterFrom(''); setFilterTo(''); setFilterAgent('')
              }} className="btn btn-secondary btn-sm">
                Clear
              </button>
            </div>
          </CardBody>
        </Card>

        {/* Summary KPIs */}
        {rows.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-6 gap-3">
            {[
              { label: 'Bookings', value: String(rows.length), color: 'text-slate-900' },
              { label: 'Revenue', value: formatCurrency(totalRevenue), color: 'text-blue-600' },
              { label: 'Cost', value: formatCurrency(totalCost), color: 'text-orange-600' },
              { label: 'Profit', value: formatCurrency(totalProfit), color: totalProfit >= 0 ? 'text-green-600' : 'text-red-600' },
              { label: 'Margin', value: `${avgMargin.toFixed(1)}%`, color: avgMargin >= 0 ? 'text-green-600' : 'text-red-600' },
              { label: 'Outstanding', value: formatCurrency(totalBalance), color: totalBalance > 0 ? 'text-red-600' : 'text-green-600' },
            ].map(k => (
              <div key={k.label} className="bg-white border border-slate-200 rounded-xl p-4 text-center shadow-sm">
                <div className="text-xs text-slate-400 mb-1">{k.label}</div>
                <div className={`text-base font-bold ${k.color}`}>{k.value}</div>
              </div>
            ))}
          </div>
        )}

        {/* Table */}
        <Card>
          <CardHeader
            action={
              <div className="flex items-center gap-2 text-xs text-slate-400">
                <FileText className="w-3.5 h-3.5" />
                {loading ? 'Loading…' : `${rows.length} bookings`}
              </div>
            }
          >
            <h3 className="text-sm font-semibold text-slate-900">Booking Report</h3>
          </CardHeader>
          <CardBody className="p-0">
            {loading ? (
              <div className="flex justify-center py-12">
                <Loader2 className="w-6 h-6 text-brand-500 animate-spin" />
              </div>
            ) : rows.length === 0 ? (
              <div className="text-center py-12 text-slate-400 text-sm">No bookings match the selected filters</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200">
                      {['Booking Ref', 'Agent', 'File Handler', 'Lead Pax', 'Status', 'Arrival', 'Pax', 'Revenue', 'Cost', 'Profit', 'Margin', 'Paid', 'Balance'].map(h => (
                        <th key={h} className="text-left px-3 py-2.5 font-semibold text-slate-500 uppercase tracking-wide text-[10px] whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {rows.map(r => (
                      <tr key={r.bookingRef} className="hover:bg-slate-50 transition-colors">
                        <td className="px-3 py-2 font-mono font-semibold text-brand-700">
                          <a href={`/dashboard/bookings/${r.bookingRef}`} target="_blank" rel="noreferrer" className="hover:underline">
                            {r.bookingRef}
                          </a>
                        </td>
                        <td className="px-3 py-2 text-slate-700 whitespace-nowrap">{r.agent || '—'}</td>
                        <td className="px-3 py-2 text-slate-500">{r.fileHandler || '—'}</td>
                        <td className="px-3 py-2 text-slate-700">{r.leadPassenger || '—'}</td>
                        <td className="px-3 py-2">
                          <StatusBadge status={r.status as never} />
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap text-slate-500">{r.arrivalDate ? formatDate(r.arrivalDate) : '—'}</td>
                        <td className="px-3 py-2 text-center">{(r.paxAdults || 0) + (r.paxChildren || 0)}</td>
                        <td className="px-3 py-2 text-blue-600 whitespace-nowrap">{formatCurrency(r.totalRevenue)}</td>
                        <td className="px-3 py-2 text-orange-600 whitespace-nowrap">{formatCurrency(r.totalCost)}</td>
                        <td className={`px-3 py-2 font-semibold whitespace-nowrap ${r.profit >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                          {formatCurrency(r.profit)}
                        </td>
                        <td className={`px-3 py-2 ${r.marginPct >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                          {r.marginPct.toFixed(1)}%
                        </td>
                        <td className="px-3 py-2 text-green-600 whitespace-nowrap">{formatCurrency(r.totalPaid)}</td>
                        <td className={`px-3 py-2 font-medium whitespace-nowrap ${r.balanceDue > 0 ? 'text-red-600' : 'text-slate-400'}`}>
                          {r.balanceDue > 0 ? formatCurrency(r.balanceDue) : '✓'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  )
}
