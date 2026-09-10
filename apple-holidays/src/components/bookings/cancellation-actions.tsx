'use client'

/**
 * The two things that can still happen to a cancellation, on the booking page.
 *
 *   Recover  — pull a cancelled booking back to the exact status it held
 *              before the cancellation was requested.
 *   Seal     — close a cancellation for good, so no role and no future setting
 *              can bring the booking back.
 *
 * Whether either is offered is decided by the server, not here: the panel asks
 * `GET /api/bookings/[ref]/cancel/recover` and renders its verdict. The same
 * call enforces the answer on POST, so the button and the route can never
 * disagree about who may do what, or for how long.
 */

import { useCallback, useEffect, useState } from 'react'
import { RotateCcw, ShieldX, Lock, Clock, Loader2, AlertTriangle } from 'lucide-react'
import { toast } from 'sonner'
import Modal from '@/components/ui/modal'
import Button from '@/components/ui/button'
import {
  roleInAudience, type CancellationPolicy, type RecoveryBlock,
} from '@/lib/cancellation-policy'
import type { BookingStatus } from '@prisma/client'

interface Verdict {
  policy: CancellationPolicy
  allowed: boolean
  block: RecoveryBlock | null
  blockMessage: string | null
  restoreTo: BookingStatus
  expiresAt: string | null
  sealed: boolean
}

/** One fetch of the server's verdict, shared by both entry points. */
function useCancellationVerdict(bookingRef: string) {
  const [verdict, setVerdict] = useState<Verdict | null>(null)

  const reload = useCallback(async () => {
    try {
      const res = await fetch(`/api/bookings/${bookingRef}/cancel/recover`)
      const json = await res.json()
      setVerdict(json.success ? json.data : null)
    } catch {
      setVerdict(null)
    }
  }, [bookingRef])

  useEffect(() => { void reload() }, [reload])
  return { verdict, reload }
}

function daysLeft(expiresAt: string | null): number | null {
  if (!expiresAt) return null
  return Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 86_400_000)
}

/* ── Recover / seal, shown inside the "Booking Cancelled" banner ─────────── */

export function CancellationRecoveryPanel({
  bookingRef, role, onDone,
}: {
  bookingRef: string
  role: string
  onDone: () => void | Promise<void>
}) {
  const { verdict, reload } = useCancellationVerdict(bookingRef)
  const [recoverOpen, setRecoverOpen] = useState(false)
  const [sealOpen, setSealOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [confirmRef, setConfirmRef] = useState('')
  const [busy, setBusy] = useState<'recover' | 'seal' | null>(null)

  if (!verdict) return null

  const { policy } = verdict
  const canSeal = policy.fullEnabled && !verdict.sealed && roleInAudience(role, policy.fullAudience)
  // A booking nobody can act on gets no panel at all rather than a row of
  // greyed-out buttons explaining what is not on offer.
  const worthShowing = verdict.allowed || verdict.sealed || canSeal
    || (verdict.block === 'window-expired' && policy.recoveryEnabled)
  if (!worthShowing) return null

  const left = daysLeft(verdict.expiresAt)

  async function post(path: string, body: Record<string, unknown>, kind: 'recover' | 'seal') {
    setBusy(kind)
    try {
      const res = await fetch(`/api/bookings/${bookingRef}/cancel/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      toast.success(json.message ?? 'Done')
      setRecoverOpen(false); setSealOpen(false)
      setReason(''); setConfirmRef('')
      await reload()
      await onDone()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Action failed')
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
      <div className="mt-4 rounded-lg border border-red-200 bg-white/80 px-4 py-3">
        {verdict.sealed ? (
          <p className="flex items-start gap-2 text-xs leading-relaxed text-slate-600">
            <Lock className="mt-px h-3.5 w-3.5 flex-shrink-0 text-slate-500" />
            <span>
              <strong>Sealed cancellation.</strong> This booking was fully cancelled — it cannot be
              recovered by anyone, and no change to the cancellation settings will reopen it. The
              file itself stays complete and readable.
            </span>
          </p>
        ) : verdict.allowed ? (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs leading-relaxed text-slate-600">
              <strong className="text-slate-800">This cancellation can still be reversed.</strong>{' '}
              Recovering puts the booking back at{' '}
              <strong>{verdict.restoreTo.replace(/_/g, ' ')}</strong> with its itinerary, passengers
              and reference untouched.
              {left !== null && (
                <> The window closes in <strong>{left} day{left === 1 ? '' : 's'}</strong>.</>
              )}
            </p>
            <div className="flex flex-shrink-0 gap-2">
              <Button size="sm" variant="secondary"
                className="!border-emerald-300 !bg-emerald-50 !text-emerald-800 hover:!bg-emerald-100"
                onClick={() => setRecoverOpen(true)}>
                <RotateCcw className="mr-1 h-4 w-4" /> Recover Booking
              </Button>
              {canSeal && (
                <Button size="sm" variant="danger" onClick={() => setSealOpen(true)}>
                  <ShieldX className="mr-1 h-4 w-4" /> Seal
                </Button>
              )}
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="flex items-start gap-2 text-xs leading-relaxed text-slate-600">
              <Clock className="mt-px h-3.5 w-3.5 flex-shrink-0 text-slate-400" />
              <span>{verdict.blockMessage}</span>
            </p>
            {canSeal && (
              <Button size="sm" variant="danger" className="flex-shrink-0" onClick={() => setSealOpen(true)}>
                <ShieldX className="mr-1 h-4 w-4" /> Seal
              </Button>
            )}
          </div>
        )}
      </div>

      {/* ── Recover ───────────────────────────────────────────────────── */}
      <Modal
        open={recoverOpen}
        onClose={() => setRecoverOpen(false)}
        title="Recover Cancelled Booking"
        footer={
          <>
            <Button variant="secondary" onClick={() => setRecoverOpen(false)}>Leave Cancelled</Button>
            <Button
              variant="primary"
              loading={busy === 'recover'}
              onClick={() => {
                if (policy.recoveryRequireReason && !reason.trim()) {
                  toast.error('Please say why this booking is coming back'); return
                }
                void post('recover', { reason: reason.trim() }, 'recover')
              }}
            >
              <RotateCcw className="mr-1 h-4 w-4" /> Recover to {verdict.restoreTo.replace(/_/g, ' ')}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
              {bookingRef} returns to {verdict.restoreTo.replace(/_/g, ' ')}
            </p>
            <p className="mt-1 text-xs leading-relaxed text-emerald-800">
              It becomes a live booking again and reappears on every active list. Nothing is
              recreated — the itinerary, passengers, accommodations and reference are the originals.
              The cancellation record is filed into the status trail rather than deleted, so the
              booking keeps its own history.
            </p>
          </div>

          <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-500" />
            <p className="text-xs leading-relaxed text-amber-800">
              Everyone downstream was told this trip was off. Check the tickets, driver and hotel
              bookings that were released when it was cancelled before treating the file as live.
            </p>
          </div>

          <div>
            <label className="form-label">
              Why is it coming back{policy.recoveryRequireReason ? ' *' : ''}
            </label>
            <textarea
              className="form-textarea" rows={3}
              value={reason}
              onChange={e => setReason(e.target.value)}
              placeholder="e.g. Agent confirmed the guest is travelling after all — cancelled in error"
            />
            <p className="mt-1.5 text-[11px] text-slate-400">
              Written into the status trail next to the cancellation it reverses.
              {policy.recoveryNotify && ' Accounts and whoever requested the cancellation are emailed.'}
            </p>
          </div>
        </div>
      </Modal>

      {/* ── Seal an existing cancellation ─────────────────────────────── */}
      <SealModal
        open={sealOpen}
        onClose={() => setSealOpen(false)}
        bookingRef={bookingRef}
        policy={policy}
        reason={reason}
        setReason={setReason}
        confirmRef={confirmRef}
        setConfirmRef={setConfirmRef}
        busy={busy === 'seal'}
        alreadyCancelled
        onConfirm={() => void post('full', { reason: reason.trim(), confirmRef: confirmRef.trim() }, 'seal')}
      />
    </>
  )
}

/* ── Full cancel, offered on a live booking ─────────────────────────────── */

export function FullCancelButton({
  bookingRef, role, onDone,
}: {
  bookingRef: string
  role: string
  onDone: () => void | Promise<void>
}) {
  const { verdict } = useCancellationVerdict(bookingRef)
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [confirmRef, setConfirmRef] = useState('')
  const [busy, setBusy] = useState(false)

  if (!verdict) return null
  const { policy } = verdict
  if (!policy.fullEnabled || !roleInAudience(role, policy.fullAudience)) return null

  async function confirm() {
    setBusy(true)
    try {
      const res = await fetch(`/api/bookings/${bookingRef}/cancel/full`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: reason.trim(), confirmRef: confirmRef.trim() }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      toast.success(json.message ?? 'Booking fully cancelled')
      setOpen(false); setReason(''); setConfirmRef('')
      await onDone()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Action failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Button
        size="sm" variant="secondary"
        className="!border-red-400 !bg-red-600 !text-white hover:!bg-red-700"
        onClick={() => setOpen(true)}
      >
        <ShieldX className="mr-1 h-4 w-4" /> Full Cancel
      </Button>

      <SealModal
        open={open}
        onClose={() => setOpen(false)}
        bookingRef={bookingRef}
        policy={policy}
        reason={reason}
        setReason={setReason}
        confirmRef={confirmRef}
        setConfirmRef={setConfirmRef}
        busy={busy}
        alreadyCancelled={false}
        onConfirm={() => void confirm()}
      />
    </>
  )
}

/* ── Shared confirmation for both ways of sealing ───────────────────────── */

function SealModal({
  open, onClose, bookingRef, policy, reason, setReason, confirmRef, setConfirmRef,
  busy, alreadyCancelled, onConfirm,
}: {
  open: boolean
  onClose: () => void
  bookingRef: string
  policy: CancellationPolicy
  reason: string
  setReason: (v: string) => void
  confirmRef: string
  setConfirmRef: (v: string) => void
  busy: boolean
  alreadyCancelled: boolean
  onConfirm: () => void
}) {
  const refOk = !policy.fullConfirmRef || confirmRef.trim().toUpperCase() === bookingRef.toUpperCase()

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={alreadyCancelled ? 'Seal This Cancellation' : 'Full Cancel — Permanent'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Go Back</Button>
          <Button
            variant="danger"
            loading={busy}
            disabled={!refOk || !reason.trim()}
            onClick={onConfirm}
          >
            <ShieldX className="mr-1 h-4 w-4" />
            {alreadyCancelled ? 'Seal Permanently' : 'Cancel Permanently'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="rounded-lg border-2 border-red-300 bg-red-50 p-3">
          <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-red-700">
            <Lock className="h-3.5 w-3.5" /> This cannot be undone
          </p>
          <p className="mt-1.5 text-xs leading-relaxed text-red-800">
            {alreadyCancelled ? (
              <>
                Sealing closes the recovery window on {bookingRef} immediately and for good. No
                role — including an admin — will be able to bring this booking back, and turning
                recovery back on in Settings will not reopen it.
              </>
            ) : (
              <>
                {bookingRef} is cancelled <strong>right now</strong>, not sent to the accounts queue,
                and sealed against recovery in the same step. The cancellation notice is emailed
                automatically. No role will ever be able to reinstate it.
              </>
            )}
          </p>
          <p className="mt-2 text-[11px] leading-relaxed text-red-700/80">
            Nothing is deleted. The booking, its itinerary and its full history stay on screen and
            in every report — only the way back is removed. If there is any chance this booking
            returns, use the ordinary cancellation instead.
          </p>
        </div>

        <div>
          <label className="form-label">Reason *</label>
          <textarea
            className="form-textarea" rows={3}
            value={reason}
            onChange={e => setReason(e.target.value)}
            placeholder="e.g. Duplicate file — the live booking is BK-2026-0412"
          />
        </div>

        {policy.fullConfirmRef && (
          <div>
            <label className="form-label">
              Type <span className="font-mono font-bold text-red-700">{bookingRef}</span> to confirm *
            </label>
            <input
              className={`form-input font-mono ${
                confirmRef && !refOk ? '!border-red-400 !bg-red-50' : ''
              }`}
              value={confirmRef}
              onChange={e => setConfirmRef(e.target.value)}
              placeholder={bookingRef}
              autoComplete="off"
            />
            {confirmRef && !refOk && (
              <p className="mt-1 text-[11px] font-medium text-red-600">
                That is not this booking&apos;s reference.
              </p>
            )}
          </div>
        )}

        {busy && (
          <p className="flex items-center gap-2 text-xs text-slate-500">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Sealing…
          </p>
        )}
      </div>
    </Modal>
  )
}
