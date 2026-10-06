'use client'

/**
 * Test booking banner — the booking page's view of the shared Test Bookings
 * register (src/lib/test-bookings.ts).
 *
 * Marked: a purple banner saying the booking is hidden from every list, count
 * and daily mail, with who marked it and why, and a Restore button.
 * Not marked: a small "Mark as test booking" control, only for the roles that
 * may use it. Marking changes nothing on the booking itself.
 */
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { FlaskConical, RotateCcw, Loader2, EyeOff } from 'lucide-react'
import { formatDateTime, readApiResponse } from '@/lib/utils'
import type { TestBookingMark } from '@/lib/test-bookings'

interface State {
  mark: TestBookingMark | null
  checked: boolean
  canManage: boolean
  problem?: 'missing' | 'unreachable' | 'error' | null
  problemMessage?: string | null
}

export default function TestBookingBanner({ bookingRef }: { bookingRef: string }) {
  const [state, setState] = useState<State | null>(null)
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')

  const url = `/api/bookings/${encodeURIComponent(bookingRef)}/test-booking`

  const load = useCallback(async () => {
    try {
      const res = await fetch(url, { cache: 'no-store' })
      const body = await readApiResponse<State>(res)
      setState(body.success && body.data ? body.data : null)
    } catch {
      setState(null)
    }
  }, [url])

  useEffect(() => { load() }, [load])

  const post = async (body: Record<string, unknown>) => {
    setBusy(true)
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || json.success === false) throw new Error(json.error || json.message || `Request failed (${res.status})`)
      toast.success(json.message || 'Done')
      setOpen(false)
      setReason('')
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  if (!state) return null

  if (state.mark) {
    const m = state.mark
    return (
      <div className="relative overflow-hidden rounded-xl border-2 border-violet-300 bg-gradient-to-r from-violet-50 via-purple-50 to-violet-50 p-5 shadow-sm">
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.06]"
          style={{ backgroundImage: 'repeating-linear-gradient(45deg,#7c3aed 0 12px,transparent 12px 24px)' }}
        />
        <div className="relative flex flex-col sm:flex-row sm:items-center gap-4">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-violet-600 text-white shadow">
            <FlaskConical className="h-6 w-6" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-base font-extrabold uppercase tracking-[0.18em] text-violet-700">Test booking</p>
            <p className="mt-1 text-sm text-violet-900/90">
              Hidden from every booking list, count and daily mail — here and in Accounts (invoices, P&amp;Ls, payables).
              Nothing on this booking was changed.
            </p>
            <p className="mt-1.5 text-xs text-violet-700/80">
              {m.reason ? <>“{m.reason}” · </> : null}
              Marked by <strong>{m.markedBy ?? 'unknown'}</strong>
              {m.markedFrom === 'ops' ? ' in OPS' : ' in Accounts'}
              {m.markedAt ? ` on ${formatDateTime(m.markedAt)}` : ''}
            </p>
          </div>
          {state.canManage && (
            <button
              disabled={busy}
              onClick={() => {
                const note = window.prompt(`Restore ${bookingRef} as a real booking?\nIt comes back in every list, count and daily mail.\n\nOptional note:`, '')
                if (note !== null) post({ action: 'release', note })
              }}
              className="inline-flex items-center gap-2 rounded-lg bg-white px-3.5 py-2 text-sm font-semibold text-violet-700 shadow-sm ring-1 ring-violet-200 hover:bg-violet-50 disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />} Restore
            </button>
          )}
        </div>
      </div>
    )
  }

  if (!state.canManage) return null

  // The register is not set up on the accounts side yet: say so plainly
  // instead of offering a button that can only fail.
  if (state.problem === 'missing') {
    return (
      <div className="flex justify-end">
        <span className="inline-flex items-center gap-1.5 rounded-lg bg-amber-50 px-2.5 py-1.5 text-[11px] font-medium text-amber-800 ring-1 ring-amber-200">
          <FlaskConical className="h-3.5 w-3.5" />
          Test Bookings not available yet — the Accounts register has not been set up (migration pending).
        </span>
      </div>
    )
  }

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {!open ? (
        <button
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-violet-700 ring-1 ring-violet-200 hover:bg-violet-50"
          title="Hide this booking from every list, count and daily mail (here and in Accounts). Reversible."
        >
          <FlaskConical className="h-3.5 w-3.5" /> Mark as test booking
        </button>
      ) : (
        <div className="flex w-full flex-col gap-2 rounded-xl border border-violet-200 bg-violet-50/60 p-3 sm:flex-row sm:items-center">
          <input
            autoFocus
            value={reason}
            onChange={e => setReason(e.target.value)}
            placeholder="Why is this a test? (kept with the mark)"
            className="flex-1 rounded-lg border border-violet-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300"
          />
          <button
            disabled={busy || reason.trim().length < 3}
            onClick={() => post({ action: 'mark', reason })}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-violet-600 px-3.5 py-2 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <EyeOff className="h-4 w-4" />} Hide as test
          </button>
          <button onClick={() => setOpen(false)} className="rounded-lg px-3 py-2 text-sm text-slate-600 hover:bg-white">Cancel</button>
        </div>
      )}
      {!state.checked && (
        <span className="text-[11px] text-amber-600">
          {state.problemMessage ?? 'Test register unreachable — showing last known state.'}
        </span>
      )}
    </div>
  )
}
