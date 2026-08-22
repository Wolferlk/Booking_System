'use client'

/**
 * The Deadline Board — the Reservation Team's home page.
 *
 * Everything this team owns has a clock on it, so the landing screen is the
 * clocks rather than a generic dashboard. Five lanes, worked left to right:
 * an option about to lapse costs a room, a silent hotel costs a day, an unpaid
 * invoice costs a relationship, and a credit note nobody chases is simply money
 * given away.
 *
 * Lanes are ordered by what it costs to ignore them, not by volume.
 */

import { useCallback, useEffect, useState } from 'react'
import {
  BedDouble, Clock, FileMinus2, Gauge, Loader2, MessageSquareWarning,
  RefreshCw, ReceiptText, Wallet,
} from 'lucide-react'
import Button from '@/components/ui/button'
import { cn } from '@/lib/utils'
import ReservationDrawer from '@/components/reservations/reservation-drawer'
import { StatusChip, UrgencyChip, EmptyState, fmtDay } from '@/components/reservations/reservation-ui'
import { URGENCY_RANK, formatMoney } from '@/lib/reservation-shared'
import type { BoardData, BoardRow } from '@/lib/reservations'

const LANES: {
  key: keyof Omit<BoardData, 'summary'>
  title: string
  blurb: string
  icon: React.ReactNode
  tone: string
}[] = [
  {
    key: 'optionReleasing',
    title: 'Options releasing',
    blurb: 'The property is holding rooms on a deadline. Let it lapse and the room is gone.',
    icon: <Clock className="h-4 w-4" />,
    tone: 'border-red-200 bg-red-50/50',
  },
  {
    key: 'awaitingHotel',
    title: 'Awaiting hotel',
    blurb: 'Sent and unanswered for more than a day. Chase on a second channel.',
    icon: <MessageSquareWarning className="h-4 w-4" />,
    tone: 'border-amber-200 bg-amber-50/50',
  },
  {
    key: 'paymentDue',
    title: 'Payment due',
    blurb: 'Due within the week and not yet settled.',
    icon: <Wallet className="h-4 w-4" />,
    tone: 'border-orange-200 bg-orange-50/50',
  },
  {
    key: 'proformaMissing',
    title: 'Proforma missing',
    blurb: 'Confirmed stays with no invoice from the property yet.',
    icon: <ReceiptText className="h-4 w-4" />,
    tone: 'border-violet-200 bg-violet-50/50',
  },
  {
    key: 'creditNotesAgeing',
    title: 'Credit notes ageing',
    blurb: 'Money a property owes back, past the date it was promised.',
    icon: <FileMinus2 className="h-4 w-4" />,
    tone: 'border-slate-200 bg-slate-50',
  },
]

export default function DeadlineBoardPage() {
  const [board, setBoard] = useState<BoardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/reservations/board')
      const json = await res.json()
      if (!json.success) throw new Error(json.error ?? 'Failed to load the board')
      setBoard(json.data)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const total = board
    ? LANES.reduce((n, l) => n + (board[l.key]?.length ?? 0), 0)
    : 0

  return (
    <div className="space-y-5 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold text-slate-900">
            <Gauge className="h-5 w-5 text-brand-500" />
            Deadline Board
          </h1>
          <p className="mt-0.5 text-xs text-slate-500">
            {loading ? 'Loading…' : `${total} item${total === 1 ? '' : 's'} need attention today`}
          </p>
        </div>
        <Button size="sm" variant="secondary" onClick={load} icon={<RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />}>
          Refresh
        </Button>
      </div>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
      )}

      {board && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Today's check-ins" value={board.summary.todayCheckIns} icon={<BedDouble className="h-4 w-4" />} />
          <Stat label="Unassigned" value={board.summary.unassignedRequests} icon={<Clock className="h-4 w-4" />} />
          <Stat label="Still open" value={board.summary.openReservations} icon={<MessageSquareWarning className="h-4 w-4" />} />
          <Stat
            label="Secured"
            value={board.summary.securedPct === null ? '—' : `${board.summary.securedPct}%`}
            icon={<ReceiptText className="h-4 w-4" />}
            tone={board.summary.securedPct !== null && board.summary.securedPct >= 80 ? 'emerald' : 'amber'}
          />
        </div>
      )}

      {loading && !board ? (
        <div className="flex items-center justify-center py-20 text-slate-400">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {LANES.map(lane => {
            const rows = [...(board?.[lane.key] ?? [])].sort(
              (a, b) => URGENCY_RANK[a.urgency] - URGENCY_RANK[b.urgency],
            )
            return (
              <div key={lane.key} className={cn('rounded-lg border p-3', lane.tone)}>
                <div className="mb-1 flex items-center justify-between">
                  <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                    {lane.icon}{lane.title}
                  </h2>
                  <span className="rounded-full bg-white px-2 py-0.5 text-xs font-semibold text-slate-700 shadow-sm">
                    {rows.length}
                  </span>
                </div>
                <p className="mb-2.5 text-[11px] leading-relaxed text-slate-500">{lane.blurb}</p>

                {rows.length === 0 ? (
                  <p className="rounded border border-dashed border-slate-200 bg-white/60 px-3 py-4 text-center text-[11px] text-slate-400">
                    Nothing here — this lane is clear.
                  </p>
                ) : (
                  <div className="space-y-1.5">
                    {rows.map(row => (
                      <LaneRow
                        key={`${lane.key}-${row.id}`}
                        row={row}
                        onOpen={lane.key === 'creditNotesAgeing' ? undefined : () => setOpenId(row.id)}
                      />
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      <ReservationDrawer reservationId={openId} onClose={() => setOpenId(null)} onChanged={load} />
    </div>
  )
}

function LaneRow({ row, onOpen }: { row: BoardRow; onOpen?: () => void }) {
  return (
    <button
      onClick={onOpen}
      disabled={!onOpen}
      className={cn(
        'flex w-full items-center gap-2 rounded-md border border-slate-200 bg-white px-2.5 py-2 text-left transition',
        onOpen ? 'hover:border-slate-300 hover:shadow-sm' : 'cursor-default',
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-xs font-medium text-slate-800">{row.hotelName}</span>
          <span className="font-mono text-[10px] text-slate-400">{row.bookingRef}</span>
        </div>
        <div className="mt-0.5 flex items-center gap-2 text-[10px] text-slate-500">
          <span>{fmtDay(row.checkIn)}</span>
          {row.amount !== null && <span className="font-mono">{formatMoney(row.amount, row.currency)}</span>}
        </div>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <UrgencyChip urgency={row.urgency}>{row.reason}</UrgencyChip>
        <StatusChip status={row.status} />
      </div>
    </button>
  )
}

function Stat({
  label, value, icon, tone = 'slate',
}: { label: string; value: React.ReactNode; icon: React.ReactNode; tone?: string }) {
  const tones: Record<string, string> = {
    slate: 'text-slate-700',
    emerald: 'text-emerald-600',
    amber: 'text-amber-600',
  }
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
        {icon}{label}
      </div>
      <div className={cn('mt-1 text-2xl font-semibold tabular-nums', tones[tone])}>{value}</div>
    </div>
  )
}
