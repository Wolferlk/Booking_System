'use client'

/**
 * All reservations — the flat worklist.
 *
 * The Deadline Board answers "what is on fire"; this answers "show me every
 * stay matching X". Read-only for most roles; the drawer's action footer is
 * what gates writing, and it is driven by the API's own permission checks
 * rather than by anything decided here.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { BedDouble, Loader2, RefreshCw, Search } from 'lucide-react'
import Button from '@/components/ui/button'
import { cn } from '@/lib/utils'
import ReservationDrawer from '@/components/reservations/reservation-drawer'
import { MoneyVariance, StatusChip, EmptyState, fmtDay } from '@/components/reservations/reservation-ui'
import { STATUS_LABELS, formatMoney, type ReservationStatusValue } from '@/lib/reservation-shared'

const STATUS_GROUPS: { label: string; values: ReservationStatusValue[] }[] = [
  { label: 'Open',      values: ['REQUESTED', 'QUOTING', 'OPTION_HELD', 'PENDING_HOTEL', 'WAITLISTED'] },
  { label: 'Secured',   values: ['CONFIRMED', 'AMENDED'] },
  { label: 'In change', values: ['AMEND_REQUESTED', 'CANCEL_REQUESTED'] },
  { label: 'Closed',    values: ['CANCELLED', 'REJECTED', 'NO_SHOW'] },
]

export default function ReservationListPage() {
  const [rows, setRows] = useState<any[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [group, setGroup] = useState<string>('Open')
  const [search, setSearch] = useState('')
  const [mine, setMine] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      const g = STATUS_GROUPS.find(s => s.label === group)
      if (g) params.set('status', g.values.join(','))
      if (search.trim()) params.set('q', search.trim())
      if (mine) params.set('mine', '1')
      params.set('take', '200')

      const res = await fetch(`/api/reservations?${params}`)
      const json = await res.json()
      if (!json.success) throw new Error(json.error ?? 'Failed to load reservations')
      setRows(json.data.rows)
      setTotal(json.data.total)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [group, search, mine])

  useEffect(() => {
    const t = setTimeout(() => void load(), search ? 300 : 0)
    return () => clearTimeout(t)
  }, [load, search])

  const counts = useMemo(() => {
    const by: Record<string, number> = {}
    for (const r of rows) by[r.status] = (by[r.status] ?? 0) + 1
    return by
  }, [rows])

  return (
    <div className="space-y-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold text-slate-900">
            <BedDouble className="h-5 w-5 text-brand-500" />
            Reservations
          </h1>
          <p className="mt-0.5 text-xs text-slate-500">
            {loading ? 'Loading…' : `${rows.length} shown of ${total}`}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Hotel, booking, confirmation…"
              className="w-60 rounded-md border border-slate-300 py-1.5 pl-8 pr-2 text-xs focus:outline-none focus:ring-2 focus:ring-brand-400"
            />
          </div>
          <label className="flex items-center gap-1.5 text-xs text-slate-600">
            <input type="checkbox" checked={mine} onChange={e => setMine(e.target.checked)} />
            Mine only
          </label>
          <Button size="sm" variant="secondary" onClick={load} icon={<RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />}>
            Refresh
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {STATUS_GROUPS.map(g => (
          <button
            key={g.label}
            onClick={() => setGroup(g.label)}
            className={cn(
              'rounded-md px-3 py-1.5 text-xs font-medium transition',
              group === g.label ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200',
            )}
          >
            {g.label}
          </button>
        ))}
      </div>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
      )}

      {loading && rows.length === 0 ? (
        <div className="flex items-center justify-center py-20 text-slate-400">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<BedDouble className="h-8 w-8" />}
          title={`No ${group.toLowerCase()} reservations`}
          hint="Stays are opened from the Request Inbox."
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-slate-200 bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500">
              <tr>
                <Th>Hotel</Th>
                <Th>Booking</Th>
                <Th>Dates</Th>
                <Th className="text-right">Rooms</Th>
                <Th className="text-right">Total vs budget</Th>
                <Th>Confirmation</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map(r => (
                <tr
                  key={r.id}
                  onClick={() => setOpenId(r.id)}
                  className="cursor-pointer transition hover:bg-slate-50"
                >
                  <td className="px-3 py-2">
                    <div className="font-medium text-slate-800">{r.hotelName}</div>
                    {r.city && <div className="text-[10px] text-slate-400">{r.city}</div>}
                  </td>
                  <td className="px-3 py-2 font-mono text-[11px] text-slate-600">{r.bookingRef}</td>
                  <td className="px-3 py-2 text-slate-600">
                    {fmtDay(r.checkIn)} → {fmtDay(r.checkOut)}
                    <span className="ml-1 text-slate-400">({r.nights}N)</span>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-600">{r.roomCount}</td>
                  <td className="px-3 py-2 text-right">
                    <MoneyVariance amount={r.totalCost} budget={r.budgetAmount} currency={r.currency} />
                  </td>
                  <td className="px-3 py-2 font-mono text-[11px] text-slate-600">
                    {r.confirmationNumber ?? <span className="text-slate-300">—</span>}
                  </td>
                  <td className="px-3 py-2"><StatusChip status={r.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ReservationDrawer reservationId={openId} onClose={() => setOpenId(null)} onChanged={load} />
    </div>
  )
}

function Th({ children, className }: { children: React.ReactNode; className?: string }) {
  return <th className={cn('px-3 py-2 font-semibold', className)}>{children}</th>
}
