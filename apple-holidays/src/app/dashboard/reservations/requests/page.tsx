'use client'

/**
 * Request Inbox — hotel stays nobody has started work on.
 *
 * Derived on every read from `accommodations`, exactly the way the D-10
 * pre-checking queue is: no backfill job, no rows created until an operator
 * claims a stay. Switching the module on against a live database creates
 * nothing at all until somebody presses a button here.
 *
 * Own-arrangement stays never appear — we hold no commitment with those
 * properties, so there is nothing for this desk to negotiate.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Inbox, Loader2, RefreshCw, Search } from 'lucide-react'
import Button from '@/components/ui/button'
import { cn } from '@/lib/utils'
import ReservationDrawer from '@/components/reservations/reservation-drawer'
import { UrgencyChip, EmptyState, fmtDay, relDays } from '@/components/reservations/reservation-ui'
import { URGENCY_RANK, formatMoney } from '@/lib/reservation-shared'
import type { InboxStay } from '@/lib/reservations'

const HORIZONS = [30, 60, 90, 180, 365]

export default function RequestInboxPage() {
  const [rows, setRows] = useState<InboxStay[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [horizon, setHorizon] = useState(90)
  const [search, setSearch] = useState('')
  const [claiming, setClaiming] = useState<string | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/reservations/requests?horizon=${horizon}`)
      const json = await res.json()
      if (!json.success) throw new Error(json.error ?? 'Failed to load the inbox')
      setRows(json.data.rows)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [horizon])

  useEffect(() => { void load() }, [load])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const list = q
      ? rows.filter(r =>
          r.hotelName.toLowerCase().includes(q) ||
          r.bookingRef.toLowerCase().includes(q) ||
          (r.agent ?? '').toLowerCase().includes(q) ||
          (r.city ?? '').toLowerCase().includes(q))
      : rows
    return [...list].sort((a, b) =>
      URGENCY_RANK[a.urgency] - URGENCY_RANK[b.urgency] || a.daysToCheckIn - b.daysToCheckIn)
  }, [rows, search])

  /** Claim a stay: create the reservation row and open it. */
  async function claim(stay: InboxStay) {
    setClaiming(stay.reservationKey)
    try {
      const res = await fetch('/api/reservations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bookingRef: stay.bookingRef,
          hotelName: stay.hotelName,
          checkIn: stay.checkIn,
          checkOut: stay.checkOut,
          accommodationId: stay.accommodationId,
          city: stay.city,
          roomType: stay.roomType,
          adults: stay.adults,
          children: stay.children,
        }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error ?? 'Could not claim this stay')
      setOpenId(json.data.id)
      setRows(prev => prev.filter(r => r.reservationKey !== stay.reservationKey))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not claim this stay')
    } finally {
      setClaiming(null)
    }
  }

  return (
    <div className="space-y-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold text-slate-900">
            <Inbox className="h-5 w-5 text-brand-500" />
            Request Inbox
          </h1>
          <p className="mt-0.5 text-xs text-slate-500">
            {loading ? 'Loading…' : `${filtered.length} stay${filtered.length === 1 ? '' : 's'} with no reservation opened yet`}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Hotel, booking, agent…"
              className="w-56 rounded-md border border-slate-300 py-1.5 pl-8 pr-2 text-xs focus:outline-none focus:ring-2 focus:ring-brand-400"
            />
          </div>
          <select
            value={horizon}
            onChange={e => setHorizon(Number(e.target.value))}
            className="rounded-md border border-slate-300 px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-brand-400"
          >
            {HORIZONS.map(h => <option key={h} value={h}>Next {h} days</option>)}
          </select>
          <Button size="sm" variant="secondary" onClick={load} icon={<RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />}>
            Refresh
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
      )}

      {loading && rows.length === 0 ? (
        <div className="flex items-center justify-center py-20 text-slate-400">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<Inbox className="h-8 w-8" />}
          title="Inbox clear"
          hint="Every hotel stay inside this horizon has a reservation opened against it."
        />
      ) : (
        <div className="grid gap-2.5 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map(stay => (
            <div
              key={stay.reservationKey}
              className="flex flex-col rounded-lg border border-slate-200 bg-white p-3 shadow-sm transition hover:border-slate-300"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-slate-900">{stay.hotelName}</div>
                  <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-slate-500">
                    <span className="font-mono">{stay.bookingRef}</span>
                    {stay.city && <>· {stay.city}</>}
                  </div>
                </div>
                <UrgencyChip urgency={stay.urgency}>{relDays(stay.daysToCheckIn)}</UrgencyChip>
              </div>

              <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 border-t border-slate-100 pt-2 text-[11px]">
                <Cell label="Check-in">{fmtDay(stay.checkIn)}</Cell>
                <Cell label="Check-out">{fmtDay(stay.checkOut)}</Cell>
                <Cell label="Nights">{stay.nights}</Cell>
                <Cell label="Pax">{stay.adults}A {stay.children > 0 && `${stay.children}C`}</Cell>
                <Cell label="Room">{stay.roomType ?? '—'}</Cell>
                <Cell label="Budget">
                  {stay.budgetAmount === null
                    ? <span className="text-slate-400">no P&amp;L line</span>
                    : formatMoney(stay.budgetAmount, 'USD')}
                </Cell>
              </div>

              {stay.agent && (
                <p className="mt-1.5 truncate text-[10px] text-slate-400">Agent: {stay.agent}</p>
              )}

              <div className="mt-2.5 flex items-center gap-2">
                <Button
                  size="sm"
                  className="flex-1"
                  loading={claiming === stay.reservationKey}
                  onClick={() => claim(stay)}
                >
                  Claim &amp; start
                </Button>
                {!stay.hotelProfileId && (
                  <span
                    className="rounded bg-amber-50 px-1.5 py-1 text-[10px] font-medium text-amber-700"
                    title="No hotel profile matched this name — contacts will need to be found."
                  >
                    unknown hotel
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <ReservationDrawer reservationId={openId} onClose={() => setOpenId(null)} onChanged={load} />
    </div>
  )
}

function Cell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <span className="text-slate-400">{label}: </span>
      <span className="text-slate-700">{children}</span>
    </div>
  )
}
