'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Loader2, CheckCircle2, AlertTriangle, ExternalLink } from 'lucide-react'
import { toast } from 'sonner'
import Header from '@/components/layout/header'
import { Card } from '@/components/ui/card'
import { formatDate, formatDateTime, formatCurrency, cn } from '@/lib/utils'
import { STATUS_LABELS } from '@/lib/state-machine'
import type { BookingStatus } from '@prisma/client'

type Row = {
  id: string
  bookingRef: string
  isNumber: string | null
  agent: string | null
  fileHandler: string | null
  arrivalDate: string
  departureDate: string
  paxAdults: number
  paxChildren: number
  paxInfants: number
  quotedTotal: string | null
  currency: string | null
  operationCountry: string | null
  status: BookingStatus
  cancelPrevStatus: BookingStatus | null
  cancelRequestedAt: string | null
  cancelledByName: string | null
  cancelledByEmail: string | null
  cancellationReason: string | null
  cancellationFees: { note: string; amount: number }[] | null
  cancellationFeeTotal: string | null
  cancelDecidedAt: string | null
  cancelDecidedByName: string | null
  cancelDecisionNote: string | null
  leadPassenger: string | null
}

/** Days between now and arrival — drives the penalty-window warning. */
function daysToArrival(arrival: string): number {
  return Math.ceil((new Date(arrival).getTime() - Date.now()) / 86400000)
}

export default function AccountsCancellationsPage() {
  const [view, setView] = useState<'pending' | 'decided'>('pending')
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async (v: 'pending' | 'decided') => {
    setLoading(true)
    try {
      const res = await fetch(`/api/accounts/cancellations?view=${v}`)
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      setRows(json.data ?? [])
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not load cancellations')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load(view) }, [view, load])

  return (
    <>
      <Header
        title="Cancellation Approvals"
        subtitle="View-only — cancellation requests are approved or rejected in the Apple Accounts system"
      />

      <div className="p-8 space-y-6">
        <div className="flex items-center gap-2">
          {(['pending', 'decided'] as const).map(v => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={cn(
                'rounded-lg px-4 py-2 text-sm font-semibold transition-colors',
                view === v
                  ? 'bg-brand-500 text-white shadow-sm'
                  : 'bg-white text-slate-600 border border-slate-300 hover:bg-slate-50',
              )}
            >
              {v === 'pending' ? 'Awaiting Approval' : 'Recently Decided'}
              {view === v && rows.length > 0 && ` (${rows.length})`}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-24">
            <Loader2 className="h-8 w-8 animate-spin text-brand-500" />
          </div>
        ) : rows.length === 0 ? (
          <Card className="p-12 text-center">
            <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-500" />
            <p className="mt-3 text-sm font-medium text-slate-600">
              {view === 'pending'
                ? 'No cancellations are waiting for approval.'
                : 'No cancellation decisions recorded yet.'}
            </p>
          </Card>
        ) : (
          <div className="space-y-4">
            {rows.map(row => {
              const days = daysToArrival(row.arrivalDate)
              const inPenalty = days <= 21 && days > 0
              const isPending = row.status === 'PENDING_CANCELLATION'

              return (
                <Card key={row.id} className={cn('p-5', isPending && 'border-l-4 border-l-orange-400')}>
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-3">
                        <Link
                          href={`/dashboard/bookings/${row.bookingRef}`}
                          className="font-mono text-lg font-bold text-slate-900 hover:text-brand-600"
                        >
                          {row.bookingRef}
                        </Link>
                        <ExternalLink className="h-3.5 w-3.5 text-slate-400" />
                        {row.isNumber && (
                          <span className="text-xs font-medium text-slate-500">{row.isNumber}</span>
                        )}
                        <span className={cn(
                          'rounded-full px-2.5 py-0.5 text-[11px] font-semibold',
                          isPending ? 'bg-orange-100 text-orange-700' : 'bg-red-100 text-red-700',
                        )}>
                          {STATUS_LABELS[row.status]}
                        </span>
                        {inPenalty && isPending && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-0.5 text-[11px] font-semibold text-amber-800">
                            <AlertTriangle className="h-3 w-3" />
                            Arrives in {days} day{days === 1 ? '' : 's'} — penalty window
                          </span>
                        )}
                      </div>

                      <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1.5 text-xs text-slate-600 sm:grid-cols-3">
                        <div><span className="text-slate-400">Lead pax:</span> {row.leadPassenger ?? '—'}</div>
                        <div><span className="text-slate-400">Agent:</span> {row.agent ?? '—'}</div>
                        <div><span className="text-slate-400">Handler:</span> {row.fileHandler ?? '—'}</div>
                        <div><span className="text-slate-400">Travel:</span> {formatDate(row.arrivalDate)} → {formatDate(row.departureDate)}</div>
                        <div><span className="text-slate-400">Pax:</span> {row.paxAdults}A {row.paxChildren}C {row.paxInfants}I</div>
                        <div><span className="text-slate-400">Value:</span> {formatCurrency(row.quotedTotal, row.currency ?? 'USD')}</div>
                        <div><span className="text-slate-400">Held at:</span> {row.cancelPrevStatus ? STATUS_LABELS[row.cancelPrevStatus] : '—'}</div>
                        <div><span className="text-slate-400">Requested by:</span> {row.cancelledByName ?? '—'}</div>
                        <div><span className="text-slate-400">Requested on:</span> {row.cancelRequestedAt ? formatDateTime(row.cancelRequestedAt) : '—'}</div>
                      </div>

                      <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Reason</p>
                        <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">
                          {row.cancellationReason || 'No reason recorded.'}
                        </p>
                      </div>

                      {Array.isArray(row.cancellationFees) && row.cancellationFees.length > 0 && (
                        <div className="mt-3 rounded-lg border border-slate-200 bg-white p-3">
                          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Cancellation Fees</p>
                          <ul className="mt-1.5 space-y-1">
                            {row.cancellationFees.map((fee, i) => (
                              <li key={i} className="flex items-center justify-between gap-3 text-sm text-slate-700">
                                <span className="min-w-0 truncate">{fee.note || '—'}</span>
                                <span className="shrink-0 font-medium">{formatCurrency(fee.amount, row.currency ?? 'USD')}</span>
                              </li>
                            ))}
                          </ul>
                          <div className="mt-2 flex items-center justify-between border-t border-slate-200 pt-1.5 text-sm font-bold text-slate-900">
                            <span>Total Cancellation Fee</span>
                            <span>{formatCurrency(row.cancellationFeeTotal, row.currency ?? 'USD')}</span>
                          </div>
                        </div>
                      )}

                      {!isPending && (
                        <p className="mt-2 text-xs text-slate-500">
                          Approved by <strong>{row.cancelDecidedByName ?? '—'}</strong>
                          {row.cancelDecidedAt ? ` on ${formatDateTime(row.cancelDecidedAt)}` : ''}
                          {row.cancelDecisionNote ? ` · ${row.cancelDecisionNote}` : ''}
                        </p>
                      )}
                    </div>

                    {isPending && (
                      <div className="w-full shrink-0 rounded-lg border border-orange-200 bg-orange-50 p-3 lg:w-72">
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-orange-700">
                          Awaiting accounts decision
                        </p>
                        <p className="mt-1 text-[11px] leading-relaxed text-orange-800/80">
                          Approve or reject this request in the Apple Accounts system under
                          Cancellation Management. This list is view-only.
                        </p>
                      </div>
                    )}
                  </div>
                </Card>
              )
            })}
          </div>
        )}
      </div>
    </>
  )
}
