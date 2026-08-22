'use client'

/**
 * Credit note register.
 *
 * Money a property owes back after a cancellation, an amendment or an
 * overcharge. Sorted by age, because a credit note nobody chases quietly
 * becomes a discount we gave the hotel.
 *
 * The ageing buckets lead the page: "which partner owes us most, longest" is
 * the question this screen exists to answer in one glance.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { FileMinus2, Loader2, RefreshCw, Send } from 'lucide-react'
import Button from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { EmptyState, fmtDay } from '@/components/reservations/reservation-ui'
import { formatMoney } from '@/lib/reservation-shared'

const BUCKETS = ['0-30', '31-60', '61-90', '90+'] as const

const BUCKET_TONE: Record<string, string> = {
  '0-30':  'border-slate-200 bg-slate-50 text-slate-700',
  '31-60': 'border-amber-200 bg-amber-50 text-amber-800',
  '61-90': 'border-orange-200 bg-orange-50 text-orange-800',
  '90+':   'border-red-200 bg-red-50 text-red-800',
}

const STATUS_TONE: Record<string, string> = {
  PENDING:     'bg-slate-100 text-slate-600',
  REQUESTED:   'bg-sky-100 text-sky-700',
  PROMISED:    'bg-amber-100 text-amber-800',
  RECEIVED:    'bg-emerald-100 text-emerald-700',
  APPLIED:     'bg-teal-100 text-teal-700',
  WRITTEN_OFF: 'bg-slate-200 text-slate-500',
  DISPUTED:    'bg-red-100 text-red-700',
}

export default function CreditNotesPage() {
  const [rows, setRows] = useState<any[]>([])
  const [buckets, setBuckets] = useState<Record<string, { count: number; value: number }>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [openOnly, setOpenOnly] = useState(true)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/reservations/credit-notes?${openOnly ? 'open=1' : ''}`)
      const json = await res.json()
      if (!json.success) throw new Error(json.error ?? 'Failed to load credit notes')
      setRows(json.data.rows)
      setBuckets(json.data.buckets ?? {})
      setSelected(new Set())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [openOnly])

  useEffect(() => { void load() }, [load])

  /** Chase every selected note, then reload once rather than per row. */
  async function chaseSelected() {
    if (selected.size === 0) return
    setBusy(true)
    setError(null)
    try {
      const results = await Promise.allSettled(
        Array.from(selected).map(id =>
          fetch(`/api/reservations/credit-notes/${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'chase' }),
          }),
        ),
      )
      const failed = results.filter(r => r.status === 'rejected').length
      if (failed) setError(`${failed} of ${selected.size} chases failed`)
      await load()
    } finally {
      setBusy(false)
    }
  }

  async function setStatus(id: string, status: string) {
    setBusy(true)
    try {
      const res = await fetch(`/api/reservations/credit-notes/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      const json = await res.json()
      if (!json.success) setError(json.error ?? 'Update failed')
      else await load()
    } finally {
      setBusy(false)
    }
  }

  const totalOutstanding = useMemo(
    () => rows.reduce((s, r) => s + (Number(r.expectedAmount) || 0), 0),
    [rows],
  )

  function toggle(id: string) {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  return (
    <div className="space-y-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold text-slate-900">
            <FileMinus2 className="h-5 w-5 text-brand-500" />
            Credit Notes
          </h1>
          <p className="mt-0.5 text-xs text-slate-500">
            {loading ? 'Loading…' : `${rows.length} note${rows.length === 1 ? '' : 's'} · ${formatMoney(totalOutstanding, 'USD')} outstanding`}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs text-slate-600">
            <input type="checkbox" checked={openOnly} onChange={e => setOpenOnly(e.target.checked)} />
            Open only
          </label>
          <Button
            size="sm"
            disabled={selected.size === 0}
            loading={busy}
            onClick={chaseSelected}
            icon={<Send className="h-3.5 w-3.5" />}
          >
            Chase {selected.size > 0 && `(${selected.size})`}
          </Button>
          <Button size="sm" variant="secondary" onClick={load} icon={<RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />}>
            Refresh
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {BUCKETS.map(b => (
          <div key={b} className={cn('rounded-lg border p-3', BUCKET_TONE[b])}>
            <div className="text-[10px] font-semibold uppercase tracking-wide opacity-70">{b} days</div>
            <div className="mt-1 text-xl font-semibold tabular-nums">
              {formatMoney(buckets[b]?.value ?? 0, 'USD')}
            </div>
            <div className="text-[10px] opacity-70">{buckets[b]?.count ?? 0} note(s)</div>
          </div>
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
          icon={<FileMinus2 className="h-8 w-8" />}
          title="Nothing outstanding"
          hint="Credit notes are raised automatically when a paid stay is cancelled, or by hand from a reservation."
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-slate-200 bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2">
                  <input
                    type="checkbox"
                    checked={selected.size > 0 && selected.size === rows.length}
                    onChange={e => setSelected(e.target.checked ? new Set(rows.map(r => r.id)) : new Set())}
                  />
                </th>
                <th className="px-3 py-2 font-semibold">Hotel</th>
                <th className="px-3 py-2 font-semibold">Booking</th>
                <th className="px-3 py-2 font-semibold">Reason</th>
                <th className="px-3 py-2 text-right font-semibold">Expected</th>
                <th className="px-3 py-2 text-right font-semibold">Age</th>
                <th className="px-3 py-2 font-semibold">Chased</th>
                <th className="px-3 py-2 font-semibold">Status</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map(c => (
                <tr key={c.id} className={cn('transition hover:bg-slate-50', c.overdue && 'bg-red-50/30')}>
                  <td className="px-3 py-2">
                    <input type="checkbox" checked={selected.has(c.id)} onChange={() => toggle(c.id)} />
                  </td>
                  <td className="px-3 py-2 font-medium text-slate-800">{c.hotelName}</td>
                  <td className="px-3 py-2 font-mono text-[11px] text-slate-600">{c.bookingRef ?? '—'}</td>
                  <td className="px-3 py-2 text-slate-600">{c.reason.replace(/_/g, ' ').toLowerCase()}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-800">
                    {formatMoney(c.expectedAmount, c.currency)}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <span className={cn(
                      'rounded px-1.5 py-0.5 text-[10px] font-medium',
                      BUCKET_TONE[c.bucket],
                    )}>
                      {c.outstandingDays}d
                    </span>
                  </td>
                  <td className="px-3 py-2 text-slate-600">
                    {c.chaseCount}×
                    {c.lastChasedAt && <span className="ml-1 text-[10px] text-slate-400">{fmtDay(c.lastChasedAt)}</span>}
                  </td>
                  <td className="px-3 py-2">
                    <span className={cn('rounded px-1.5 py-0.5 text-[10px] font-medium', STATUS_TONE[c.status])}>
                      {c.status.replace(/_/g, ' ').toLowerCase()}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right">
                    {!['RECEIVED', 'APPLIED', 'WRITTEN_OFF'].includes(c.status) && (
                      <button
                        onClick={() => setStatus(c.id, 'RECEIVED')}
                        disabled={busy}
                        className="rounded px-2 py-1 text-[10px] font-medium text-emerald-700 transition hover:bg-emerald-50"
                      >
                        Mark received
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
