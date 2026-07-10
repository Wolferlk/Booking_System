'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import {
  Truck, Loader2, Search, X, CheckCircle2, Send, ChevronRight, Ticket, Fuel,
} from 'lucide-react'
import Header from '@/components/layout/header'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { formatCurrency, formatDate } from '@/lib/utils'

interface DriverLogListRow {
  bookingRef: string
  leadPassenger: string | null
  arrivalDate: string | null
  departureDate: string | null
  driverName: string | null
  driverPhone: string | null
  isSaved: boolean
  pnlLinked: boolean
  autoSend: boolean
  waSentAt: string | null
  currency: string
  tourAdvance: number
  fuelAdvance: number
  grandAdvance: number
}

export default function DriverLogListPage() {
  const [rows, setRows]       = useState<DriverLogListRow[]>([])
  const [loading, setLoading] = useState(true)
  const [q, setQ]             = useState('')
  const [onlySaved, setOnlySaved] = useState(false)

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const res = await fetch('/api/driver-log')
        const json = await res.json()
        if (!res.ok || !json.success) throw new Error(json.error || 'Failed to load')
        if (alive) setRows(json.data as DriverLogListRow[])
      } catch (e) {
        if (alive) toast.error(e instanceof Error ? e.message : 'Failed to load driver logs')
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => { alive = false }
  }, [])

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase()
    return rows.filter(r => {
      if (onlySaved && !r.isSaved) return false
      if (!term) return true
      return (
        r.bookingRef.toLowerCase().includes(term)
        || (r.leadPassenger ?? '').toLowerCase().includes(term)
        || (r.driverName ?? '').toLowerCase().includes(term)
      )
    })
  }, [rows, q, onlySaved])

  const savedCount = rows.filter(r => r.isSaved).length

  return (
    <div className="min-h-screen bg-slate-50">
      <Header
        title="Driver Logs"
        subtitle="Sri Lanka driver advance sheets — tour & fuel advances from the Accounts PNL"
      />

      <div className="p-4 sm:p-8 max-w-6xl mx-auto space-y-4">
        {/* Controls */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              value={q}
              onChange={e => setQ(e.target.value)}
              placeholder="Search booking, passenger or driver…"
              className="w-full pl-9 pr-9 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-300"
            />
            {q && (
              <button onClick={() => setQ('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
          <button
            onClick={() => setOnlySaved(s => !s)}
            className={`inline-flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg border transition-colors ${
              onlySaved ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
            }`}
          >
            <CheckCircle2 className="w-4 h-4" /> Saved only
          </button>
          <div className="text-xs text-slate-500">
            {savedCount} saved · {rows.length} total
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20 text-slate-400">
            <Loader2 className="w-6 h-6 animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <Card className="p-10 text-center text-slate-500">
            <Truck className="w-8 h-8 mx-auto mb-3 text-slate-300" />
            <p className="text-sm">No driver logs found.</p>
            <p className="text-xs mt-1 text-slate-400">
              Sri Lanka bookings with a linked Accounts PNL appear here.
            </p>
          </Card>
        ) : (
          <Card className="overflow-hidden p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-slate-500 border-b border-slate-100">
                    <th className="px-4 py-3 font-medium">Booking</th>
                    <th className="px-4 py-3 font-medium">Passenger</th>
                    <th className="px-4 py-3 font-medium">Dates</th>
                    <th className="px-4 py-3 font-medium">Driver</th>
                    <th className="px-4 py-3 font-medium text-right">Tour</th>
                    <th className="px-4 py-3 font-medium text-right">Fuel</th>
                    <th className="px-4 py-3 font-medium text-right">Advance</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filtered.map(r => (
                    <tr key={r.bookingRef} className="hover:bg-slate-50">
                      <td className="px-4 py-3">
                        <Link href={`/dashboard/driver-log/${r.bookingRef}`} className="font-medium text-slate-900 hover:underline">
                          {r.bookingRef}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-slate-600">{r.leadPassenger ?? '—'}</td>
                      <td className="px-4 py-3 text-slate-600 whitespace-nowrap">
                        {r.arrivalDate ? formatDate(r.arrivalDate) : '—'}
                        {r.departureDate ? ` → ${formatDate(r.departureDate)}` : ''}
                      </td>
                      <td className="px-4 py-3 text-slate-600">{r.driverName ?? <span className="text-slate-400">Unassigned</span>}</td>
                      <td className="px-4 py-3 text-right text-slate-700 whitespace-nowrap">
                        <span className="inline-flex items-center gap-1 justify-end"><Ticket className="w-3 h-3 text-slate-400" />{formatCurrency(r.tourAdvance, r.currency)}</span>
                      </td>
                      <td className="px-4 py-3 text-right text-slate-700 whitespace-nowrap">
                        <span className="inline-flex items-center gap-1 justify-end"><Fuel className="w-3 h-3 text-slate-400" />{formatCurrency(r.fuelAdvance, r.currency)}</span>
                      </td>
                      <td className="px-4 py-3 text-right font-semibold text-slate-900 whitespace-nowrap">
                        {formatCurrency(r.grandAdvance, r.currency)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap items-center gap-1.5">
                          {r.isSaved
                            ? <Badge color="green">Saved</Badge>
                            : <Badge color="gray">Draft</Badge>}
                          {r.autoSend && <Badge color="blue">Auto-send</Badge>}
                          {r.waSentAt && (
                            <span className="inline-flex items-center gap-1 text-xs text-emerald-600">
                              <Send className="w-3 h-3" /> Sent
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Link href={`/dashboard/driver-log/${r.bookingRef}`} className="text-slate-400 hover:text-slate-700">
                          <ChevronRight className="w-4 h-4" />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </div>
    </div>
  )
}
