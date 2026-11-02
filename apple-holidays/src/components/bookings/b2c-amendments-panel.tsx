'use client'

/**
 * "Booking updates" — Aahaas B2C bookings the store amended (a new store order
 * replacing an earlier version). Old bookings re-opened are listed until
 * someone acknowledges them; Update Booking on the booking applies the change.
 * Same-day corrections are filed silently and shown only under "Show all".
 */
import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, CheckCircle2, GitBranch, Loader2 } from 'lucide-react'
import { readApiResponse } from '@/lib/utils'

interface Notice {
  bookingRef: string
  orderId: number
  previousOrderId: number | null
  version: number
  amendedAt: string | null
  originAt: string | null
  isOld: boolean
  duplicateRef: string | null
  appliedAt?: string | null
  appliedVersion?: number | null
  acknowledgedBy?: string | null
  acknowledgedAt?: string | null
}

export default function B2cAmendmentsPanel() {
  const [notices, setNotices] = useState<Notice[]>([])
  const [all, setAll] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<number | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/b2c/amendments${all ? '?all=1' : ''}`)
      const json = await readApiResponse<{ notices: Notice[] }>(res)
      if (json.success) setNotices(json.data?.notices ?? [])
    } finally {
      setLoading(false)
    }
  }, [all])

  useEffect(() => { load() }, [load])

  async function ack(orderId: number) {
    setBusy(orderId)
    try {
      const res = await fetch('/api/b2c/amendments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId }),
      })
      const json = await readApiResponse<{ notice: Notice }>(res)
      if (json.success) await load()
    } finally {
      setBusy(null)
    }
  }

  if (!loading && notices.length === 0 && !all) return null

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-4">
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-2 text-sm font-semibold text-amber-900">
          <GitBranch className="w-4 h-4" /> Booking updates from the store
          {!all && notices.length > 0 && <span className="text-xs font-normal">— {notices.length} old booking{notices.length === 1 ? '' : 's'} amended, waiting for acknowledgement</span>}
        </div>
        <button type="button" className="text-xs text-amber-800 underline" onClick={() => setAll((v) => !v)}>
          {all ? 'Old & open only' : 'Show all'}
        </button>
      </div>
      {loading ? (
        <div className="flex items-center gap-2 text-xs text-slate-500"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading…</div>
      ) : notices.length === 0 ? (
        <div className="text-xs text-slate-500">No store amendments on file.</div>
      ) : (
        <table className="w-full text-xs">
          <thead className="text-left text-slate-500">
            <tr><th className="py-1">Booking</th><th>New order</th><th>Replaces</th><th>First sold</th><th>Amended</th><th>State</th><th /></tr>
          </thead>
          <tbody>
            {notices.map((n) => (
              <tr key={n.orderId} className="border-t border-amber-100">
                <td className="py-1.5 font-mono">
                  <Link href={`/dashboard/bookings/${encodeURIComponent(n.bookingRef)}`} className="text-blue-700 hover:underline">{n.bookingRef}</Link>
                  <span className="ml-1 rounded bg-violet-100 px-1.5 text-[10px] font-semibold text-violet-700">v{n.version}</span>
                </td>
                <td className="font-mono">{n.orderId}</td>
                <td className="font-mono">{n.previousOrderId ?? '—'}</td>
                <td>{n.originAt?.slice(0, 10) ?? '—'}</td>
                <td>
                  {n.amendedAt?.slice(0, 16) ?? '—'}{' '}
                  {n.isOld
                    ? <span className="rounded bg-amber-200 px-1.5 text-[10px] font-semibold text-amber-900">old booking</span>
                    : <span className="rounded bg-slate-100 px-1.5 text-[10px] text-slate-600">same day</span>}
                </td>
                <td>
                  {n.appliedAt
                    ? <span className="text-emerald-700">applied → V{n.appliedVersion ?? '?'}</span>
                    : <span className="text-amber-800">not applied — open the booking → Update Booking</span>}
                  {n.duplicateRef && (
                    <div className="flex items-center gap-1 text-rose-700"><AlertTriangle className="w-3 h-3" /> also imported as {n.duplicateRef} — cancel the duplicate</div>
                  )}
                </td>
                <td className="text-right">
                  {n.acknowledgedAt ? (
                    <span className="inline-flex items-center gap-1 text-slate-500" title={n.acknowledgedAt}><CheckCircle2 className="w-3 h-3 text-emerald-600" /> {n.acknowledgedBy}</span>
                  ) : n.isOld ? (
                    <button type="button" disabled={busy === n.orderId} onClick={() => ack(n.orderId)}
                      className="rounded border border-emerald-300 bg-white px-2 py-0.5 text-emerald-800 hover:bg-emerald-50 disabled:opacity-50">
                      {busy === n.orderId ? '…' : 'Acknowledge'}
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
