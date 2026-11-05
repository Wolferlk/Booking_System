'use client'

/**
 * "UPDATED BOOKING — attention please".
 *
 * The Aahaas store amended this booking (a new store order replacing an earlier
 * version, see b2c-order-chain) and ops applied it — usually by itself, the
 * moment the watch saw it. For a booking first sold on an earlier day that is
 * unplanned work: the dates, pax or services the team planned around may have
 * moved. So the booking says so, loudly, at the top of the page — what changed,
 * what was left for a person, a duplicate to cancel — until somebody
 * acknowledges it. A same-day correction is applied quietly and never shows here.
 */
import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, BellRing, CheckCircle2, GitBranch, Loader2 } from 'lucide-react'
import { readApiResponse } from '@/lib/utils'

interface Notice {
  orderId: number
  previousOrderId: number | null
  sameOrder?: boolean
  reason?: string | null
  version: number
  amendedAt: string | null
  originAt: string | null
  isOld: boolean
  duplicateRef: string | null
  appliedAt?: string | null
  appliedVersion?: number | null
  autoApplied?: boolean
  appliedChanges?: string[]
  leftForReview?: string[]
  lastError?: string | null
  acknowledgedAt?: string | null
}

export default function B2cAmendmentAttention({ bookingRef, onChange }: { bookingRef: string; onChange?: () => void }) {
  const [notices, setNotices] = useState<Notice[]>([])
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/bookings/${encodeURIComponent(bookingRef)}/b2c-sync`)
      const json = await readApiResponse<{ amendments?: Notice[] }>(res)
      if (json.success) setNotices((json.data?.amendments ?? []).filter((n) => n.appliedAt && n.isOld && !n.acknowledgedAt))
    } catch {
      /* informational */
    }
  }, [bookingRef])

  useEffect(() => { load() }, [load])

  async function acknowledge() {
    setBusy(true)
    try {
      for (const n of notices) {
        await fetch('/api/b2c/amendments', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ orderId: n.orderId, ...(n.sameOrder && { sameOrderVersion: n.version }) }),
        })
      }
      await load()
      onChange?.()
    } finally {
      setBusy(false)
    }
  }

  if (notices.length === 0) return null
  const n = notices[0]

  return (
    <div className="relative overflow-hidden rounded-xl border-2 border-amber-400 bg-gradient-to-r from-amber-50 via-orange-50 to-amber-50 p-4 shadow-sm">
      <span className="pointer-events-none absolute inset-y-0 left-0 w-1.5 animate-pulse bg-amber-500" />
      <div className="flex flex-col gap-3 pl-2 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500 px-2.5 py-0.5 text-xs font-bold uppercase tracking-wide text-white">
              <BellRing className="h-3.5 w-3.5 animate-bounce" /> Updated booking — attention please
            </span>
            <span className="inline-flex items-center gap-1 rounded-full bg-violet-100 px-2 py-0.5 text-[11px] font-semibold text-violet-700">
              <GitBranch className="h-3 w-3" /> Store version {n.version}
            </span>
          </div>
          <p className="text-sm text-amber-950">
            The customer&apos;s booking was <b>amended in the Aahaas store</b>:{' '}
            {n.sameOrder
              ? <>order <b>{n.orderId}</b> is now <b>version {n.version}</b>, same order number</>
              : <>order <b>{n.orderId}</b> replaces order <b>{n.previousOrderId ?? '—'}</b></>}
            {n.amendedAt ? <> on <b>{n.amendedAt.slice(0, 16)}</b></> : null}
            {n.reason ? <> ({n.reason})</> : null}
            {n.originAt ? <> (first booked {n.originAt.slice(0, 10)})</> : null}.{' '}
            {n.autoApplied ? 'It was applied here automatically' : 'It was applied here'}
            {n.appliedVersion ? <> as <b>V{n.appliedVersion}</b></> : null}. Check drivers, tickets, hotels and suppliers against the new version.
          </p>
          {(n.appliedChanges?.length ?? 0) > 0 && (
            <ul className="ml-4 list-disc text-xs text-amber-900">
              {n.appliedChanges!.slice(0, 8).map((c) => <li key={c}>{c}</li>)}
            </ul>
          )}
          {(n.appliedChanges?.length ?? 0) === 0 && (
            <p className="text-xs text-amber-900">Nothing on this booking needed to change — the store figures already matched.</p>
          )}
          {(n.leftForReview?.length ?? 0) > 0 && (
            <p className="flex items-start gap-1 text-xs text-rose-700">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              Left for you (edited here, so not overwritten): {n.leftForReview!.join(', ')} — open Update Booking to decide.
            </p>
          )}
          {n.duplicateRef && (
            <p className="flex items-start gap-1 text-xs font-semibold text-rose-700">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              Order {n.orderId} has its own booking {n.duplicateRef} — that is the active version; this one is shown as replaced.
            </p>
          )}
          {notices.length > 1 && <p className="text-xs text-amber-800">+{notices.length - 1} earlier amendment(s) of this booking also unacknowledged.</p>}
        </div>
        <button
          type="button"
          onClick={acknowledge}
          disabled={busy}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white shadow hover:bg-emerald-700 disabled:opacity-60"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} I&apos;ve checked it
        </button>
      </div>
    </div>
  )
}
