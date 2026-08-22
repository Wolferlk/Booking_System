'use client'

/**
 * The Hotels panel on the booking detail page.
 *
 * Answers one question for everybody outside the Reservation Team: is this
 * booking's accommodation actually secured with the properties, or is it still
 * a list of names on a document? The Booking Team needs that before promising a
 * hotel to a client, and until now the honest answer lived in a spreadsheet.
 *
 * Read-only here by design — writing happens in the reservation drawer, behind
 * the accuracy gate.
 */

import { useCallback, useEffect, useState } from 'react'
import { BedDouble, ExternalLink, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { StatusChip, fmtDay } from '@/components/reservations/reservation-ui'
import { formatMoney } from '@/lib/reservation-shared'
import type { BookingHotelRollup } from '@/lib/reservations'

export default function BookingHotelsPanel({ bookingRef }: { bookingRef: string }) {
  const [data, setData] = useState<BookingHotelRollup | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/reservations?bookingRef=${encodeURIComponent(bookingRef)}&take=50`)
      const json = await res.json()
      if (!json.success) return
      const rows = json.data.rows ?? []
      const live = rows.filter((r: any) => !['CANCELLED', 'REJECTED', 'NO_SHOW'].includes(r.status))
      setData({
        total: live.length,
        secured: live.filter((r: any) => ['CONFIRMED', 'AMENDED'].includes(r.status)).length,
        rows,
      })
    } finally {
      setLoading(false)
    }
  }, [bookingRef])

  useEffect(() => { void load() }, [load])

  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white p-4 text-xs text-slate-400">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading hotel reservations…
      </div>
    )
  }

  // Nothing to say when this booking has never been through the desk.
  if (!data || data.rows.length === 0) return null

  const allSecured = data.total > 0 && data.secured === data.total

  return (
    <div className="rounded-lg border border-slate-200 bg-white">
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-800">
          <BedDouble className="h-4 w-4 text-slate-400" />
          Hotels
        </h3>
        <div className="flex items-center gap-2">
          <span className={cn(
            'rounded-full px-2 py-0.5 text-[11px] font-semibold',
            allSecured ? 'bg-emerald-100 text-emerald-700'
              : data.secured === 0 ? 'bg-red-100 text-red-700'
              : 'bg-amber-100 text-amber-800',
          )}>
            {data.secured} of {data.total} secured
          </span>
          <a
            href="/dashboard/reservations/list"
            className="text-slate-400 transition hover:text-slate-600"
            title="Open the reservation desk"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </div>
      </div>

      <div className="divide-y divide-slate-100">
        {data.rows.map(r => (
          <div key={r.id} className="flex items-center gap-3 px-4 py-2 text-xs">
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium text-slate-800">{r.hotelName}</div>
              <div className="text-[10px] text-slate-400">
                {fmtDay(r.checkIn)} → {fmtDay(r.checkOut)}
              </div>
            </div>
            {r.confirmationNumber && (
              <span className="hidden font-mono text-[10px] text-slate-500 sm:inline">
                {r.confirmationNumber}
              </span>
            )}
            <span className="hidden font-mono text-[11px] tabular-nums text-slate-600 sm:inline">
              {formatMoney(r.totalCost, r.currency)}
            </span>
            <StatusChip status={r.status} />
          </div>
        ))}
      </div>
    </div>
  )
}
