'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Loader2, XCircle, CheckCircle2, AlertTriangle, ExternalLink } from 'lucide-react'
import { toast } from 'sonner'
import Header from '@/components/layout/header'
import { Card } from '@/components/ui/card'
import Button from '@/components/ui/button'
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
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string | null>(null)

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

  async function decide(row: Row, decision: 'APPROVE' | 'REJECT') {
    const note = (notes[row.id] ?? '').trim()
    if (decision === 'REJECT' && !note) {
      toast.error('Add a note explaining why the cancellation is rejected')
      return
    }
    setBusy(`${row.id}-${decision}`)
    try {
      const res = await fetch(`/api/bookings/${row.bookingRef}/cancel/decision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision, note }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      toast.success(json.message ?? 'Decision saved')
      setNotes(n => ({ ...n, [row.id]: '' }))
      await load(view)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save the decision')
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
      <Header
        title="Cancellation Approvals"
        subtitle="Bookings held at Pending Approval — Accounts Team until you approve or reject"
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

                      {!isPending && (
                        <p className="mt-2 text-xs text-slate-500">
                          Approved by <strong>{row.cancelDecidedByName ?? '—'}</strong>
                          {row.cancelDecidedAt ? ` on ${formatDateTime(row.cancelDecidedAt)}` : ''}
                          {row.cancelDecisionNote ? ` · ${row.cancelDecisionNote}` : ''}
                        </p>
                      )}
                    </div>

                    {isPending && (
                      <div className="w-full shrink-0 lg:w-80">
                        <textarea
                          className="form-input w-full text-sm"
                          rows={3}
                          placeholder="Note (optional to approve, required to reject)"
                          value={notes[row.id] ?? ''}
                          onChange={e => setNotes(n => ({ ...n, [row.id]: e.target.value }))}
                        />
                        <div className="mt-2 flex gap-2">
                          <Button
                            variant="danger" size="sm" className="flex-1"
                            loading={busy === `${row.id}-APPROVE`}
                            onClick={() => decide(row, 'APPROVE')}
                          >
                            <XCircle className="mr-1 h-4 w-4" /> Approve Cancellation
                          </Button>
                          <Button
                            variant="secondary" size="sm" className="flex-1"
                            loading={busy === `${row.id}-REJECT`}
                            onClick={() => decide(row, 'REJECT')}
                          >
                            Reject
                          </Button>
                        </div>
                        <p className="mt-2 text-[11px] text-slate-500">
                          Approving marks the booking Confirmed Cancellation and emails the cancellation
                          notice automatically.
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
