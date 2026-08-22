'use client'

/**
 * Proforma invoice pipeline.
 *
 * Columns are the stages an invoice actually passes through, and an invoice
 * only advances when a human moves it. The three-way match (invoice ↔ the rate
 * we agreed ↔ the P&L hotel budget) runs on arrival and decides whether a row
 * lands in Under review or Discrepancy — but it never files itself as Verified,
 * because "the numbers agree" and "I checked" are different claims.
 *
 * Forwarding hands the invoice to Accounts. Marking it paid is theirs alone.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Loader2, ReceiptText, RefreshCw } from 'lucide-react'
import Button from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { EmptyState, fmtDay } from '@/components/reservations/reservation-ui'
import { formatMoney } from '@/lib/reservation-shared'

const STAGES: { status: string; label: string; tone: string; next?: { to: string; label: string } }[] = [
  { status: 'RECEIVED',     label: 'Received',    tone: 'border-slate-200 bg-slate-50',     next: { to: 'UNDER_REVIEW', label: 'Start review' } },
  { status: 'UNDER_REVIEW', label: 'Under review',tone: 'border-sky-200 bg-sky-50/60',      next: { to: 'VERIFIED', label: 'Verify' } },
  { status: 'DISCREPANCY',  label: 'Discrepancy', tone: 'border-red-200 bg-red-50/60',      next: { to: 'VERIFIED', label: 'Resolved — verify' } },
  { status: 'VERIFIED',     label: 'Verified',    tone: 'border-emerald-200 bg-emerald-50/60', next: { to: 'FORWARDED', label: 'Forward to Accounts' } },
  { status: 'FORWARDED',    label: 'With Accounts', tone: 'border-violet-200 bg-violet-50/60' },
  { status: 'PAID',         label: 'Paid',        tone: 'border-teal-200 bg-teal-50/60' },
]

export default function InvoicePipelinePage() {
  const [rows, setRows] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/reservations/invoices?take=400')
      const json = await res.json()
      if (!json.success) throw new Error(json.error ?? 'Failed to load invoices')
      setRows(json.data.rows)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const byStage = useMemo(() => {
    const map: Record<string, any[]> = {}
    for (const s of STAGES) map[s.status] = []
    for (const r of rows) (map[r.status] ??= []).push(r)
    return map
  }, [rows])

  async function advance(id: string, to: string) {
    setBusy(id)
    setError(null)
    try {
      const res = await fetch(`/api/reservations/invoices/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: to }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error ?? 'Could not update the invoice')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Update failed')
    } finally {
      setBusy(null)
    }
  }

  const openValue = rows
    .filter(r => ['RECEIVED', 'UNDER_REVIEW', 'DISCREPANCY', 'VERIFIED', 'FORWARDED'].includes(r.status))
    .reduce((s, r) => s + (Number(r.totalAmount) || 0), 0)

  return (
    <div className="space-y-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold text-slate-900">
            <ReceiptText className="h-5 w-5 text-brand-500" />
            Proforma Invoices
          </h1>
          <p className="mt-0.5 text-xs text-slate-500">
            {loading ? 'Loading…' : `${rows.length} invoice${rows.length === 1 ? '' : 's'} · ${formatMoney(openValue, 'USD')} awaiting payment`}
          </p>
        </div>
        <Button size="sm" variant="secondary" onClick={load} icon={<RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />}>
          Refresh
        </Button>
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
          icon={<ReceiptText className="h-8 w-8" />}
          title="No proforma invoices yet"
          hint="Invoices are attached to a reservation from its Money tab, then work their way along this pipeline."
        />
      ) : (
        <div className="grid gap-3 lg:grid-cols-3 xl:grid-cols-6">
          {STAGES.map(stage => (
            <div key={stage.status} className={cn('rounded-lg border p-2.5', stage.tone)}>
              <div className="mb-2 flex items-center justify-between">
                <h2 className="text-xs font-semibold text-slate-700">{stage.label}</h2>
                <span className="rounded-full bg-white px-1.5 text-[10px] font-semibold text-slate-600 shadow-sm">
                  {byStage[stage.status]?.length ?? 0}
                </span>
              </div>

              <div className="space-y-1.5">
                {(byStage[stage.status] ?? []).length === 0 ? (
                  <p className="py-3 text-center text-[10px] text-slate-400">empty</p>
                ) : (
                  byStage[stage.status].map(inv => (
                    <div key={inv.id} className="rounded border border-slate-200 bg-white p-2">
                      <div className="truncate text-[11px] font-medium text-slate-800">
                        {inv.hotelName ?? inv.reservation?.hotelName ?? 'Unknown hotel'}
                      </div>
                      <div className="mt-0.5 flex items-center justify-between text-[10px] text-slate-500">
                        <span className="font-mono">{inv.invoiceNumber ?? 'no ref'}</span>
                        <span className="font-mono">{formatMoney(inv.totalAmount, inv.currency)}</span>
                      </div>
                      {inv.bookingRef && (
                        <div className="mt-0.5 font-mono text-[10px] text-slate-400">{inv.bookingRef}</div>
                      )}
                      {inv.dueDate && (
                        <div className="mt-0.5 text-[10px] text-slate-400">due {fmtDay(inv.dueDate)}</div>
                      )}

                      {inv.status === 'DISCREPANCY' && inv.variance != null && (
                        <div className="mt-1.5 flex items-start gap-1 rounded bg-red-50 px-1.5 py-1 text-[10px] text-red-700">
                          <AlertTriangle className="mt-px h-3 w-3 shrink-0" />
                          <span>
                            Off by {Number(inv.variance).toFixed(2)}
                            {inv.variancePct != null && ` (${Number(inv.variancePct).toFixed(1)}%)`}
                          </span>
                        </div>
                      )}

                      {stage.next && (
                        <Button
                          size="sm"
                          variant="secondary"
                          className="mt-1.5 w-full !px-2 !py-1 !text-[10px]"
                          loading={busy === inv.id}
                          onClick={() => advance(inv.id, stage.next!.to)}
                        >
                          {stage.next.label}
                        </Button>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
