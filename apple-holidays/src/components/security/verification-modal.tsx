'use client'

/**
 * The second step in front of cancelling or deleting a booking.
 *
 * Opening this asks the server for a six-digit code, which is mailed to the
 * address the user signed in with. Nothing is cancelled and nothing is deleted
 * until that code comes back — the destructive route spends it, so a screen left
 * open, a stale tab or a mis-click cannot complete the action on its own.
 *
 * The parent keeps all of its own confirmation (reason, fee lines, typing the
 * reference) and simply hands the final call to `onVerified`, which receives the
 * credentials to include in the request body. `onVerified` must throw on failure
 * so the error is shown here rather than silently swallowed.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { ShieldCheck, MailCheck, AlertTriangle, Loader2, RotateCw } from 'lucide-react'
import Modal from '@/components/ui/modal'
import Button from '@/components/ui/button'

export type VerifyActionName =
  | 'BOOKING_CANCEL'
  | 'BOOKING_FULL_CANCEL'
  | 'BOOKING_DELETE'
  | 'BOOKING_BULK_DELETE'
  | 'BOOKING_FILTERED_DELETE'

export interface VerificationCredentials {
  verificationId: string
  verificationCode: string
}

interface Props {
  open: boolean
  action: VerifyActionName
  /** Single-booking actions. */
  bookingRef?: string
  /** Bulk delete — the exact selection the code will be bound to. */
  bookingRefs?: string[]
  /** Anything else the server needs to derive the target, e.g. the filter a
   *  filtered delete is bound to. Sent with the request for the code. */
  requestPayload?: Record<string, unknown>
  /** One line describing what the code will authorise, shown above the input. */
  summary: React.ReactNode
  confirmLabel: string
  onClose: () => void
  /** Runs the real action. Throw to surface the failure inside this modal. */
  onVerified: (credentials: VerificationCredentials) => Promise<void>
}

const TITLES: Record<VerifyActionName, string> = {
  BOOKING_CANCEL:      'Confirm Cancellation',
  BOOKING_FULL_CANCEL: 'Confirm Full Cancellation',
  BOOKING_DELETE:      'Confirm Deletion',
  BOOKING_BULK_DELETE: 'Confirm Deletion',
  BOOKING_FILTERED_DELETE: 'Confirm Deletion',
}

export default function VerificationModal({
  open, action, bookingRef, bookingRefs, requestPayload, summary, confirmLabel, onClose, onVerified,
}: Props) {
  const [status, setStatus]   = useState<'sending' | 'sent' | 'failed'>('sending')
  const [maskedEmail, setMask] = useState('')
  const [verificationId, setId] = useState('')
  const [code, setCode]       = useState('')
  const [error, setError]     = useState<string | null>(null)
  const [busy, setBusy]       = useState(false)
  const [cooldown, setCooldown] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  // Guards React 18 double-invoked effects in dev from asking for two codes,
  // which would leave the user holding the one that has just been superseded.
  const requestedFor = useRef<string | null>(null)

  const refsKey = (bookingRefs ?? []).join(',')
  const payloadKey = requestPayload ? JSON.stringify(requestPayload) : ''

  const sendCode = useCallback(async () => {
    setStatus('sending'); setError(null); setCode(''); setId('')
    try {
      const res = await fetch('/api/verification/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          ...(bookingRef ? { bookingRef } : {}),
          ...(bookingRefs?.length ? { bookingRefs } : {}),
          ...(requestPayload ?? {}),
        }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error ?? 'Could not send the confirmation code')
      setId(json.data.verificationId)
      setMask(json.data.maskedEmail)
      setStatus('sent')
      setCooldown(45)
      setTimeout(() => inputRef.current?.focus(), 50)
    } catch (err) {
      setStatus('failed')
      setError(err instanceof Error ? err.message : 'Could not send the confirmation code')
    }
  }, [action, bookingRef, bookingRefs, requestPayload])

  // One code per opening, and a fresh one if the target changes underneath.
  useEffect(() => {
    if (!open) { requestedFor.current = null; return }
    const key = `${action}:${bookingRef ?? ''}:${refsKey}:${payloadKey}`
    if (requestedFor.current === key) return
    requestedFor.current = key
    void sendCode()
    // sendCode is intentionally omitted: it changes identity with the array prop
    // on every render, which would re-request the code in a loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, action, bookingRef, refsKey, payloadKey])

  useEffect(() => {
    if (cooldown <= 0) return
    const t = setTimeout(() => setCooldown(c => c - 1), 1000)
    return () => clearTimeout(t)
  }, [cooldown])

  async function confirm() {
    if (code.length !== 6 || !verificationId) return
    setBusy(true); setError(null)
    try {
      await onVerified({ verificationId, verificationCode: code })
    } catch (err) {
      // The code is spent whether or not the action that followed succeeded, so
      // the only honest offer after a failure is a fresh one.
      setError(err instanceof Error ? err.message : 'The action could not be completed')
      setCode('')
    } finally {
      setBusy(false)
    }
  }

  const ready = status === 'sent' && code.length === 6 && !busy

  return (
    <Modal
      open={open}
      onClose={busy ? () => {} : onClose}
      title={TITLES[action]}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="danger" loading={busy} disabled={!ready} onClick={() => void confirm()}>
            <ShieldCheck className="mr-1 h-4 w-4" /> {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="rounded-lg border border-red-200 bg-red-50 p-3">
          <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-red-700">
            <AlertTriangle className="h-3.5 w-3.5" /> Two-step confirmation required
          </p>
          <div className="mt-1.5 text-xs leading-relaxed text-red-800">{summary}</div>
        </div>

        {status === 'sending' && (
          <p className="flex items-center gap-2 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" /> Emailing your confirmation code…
          </p>
        )}

        {status === 'failed' && (
          <div className="space-y-3">
            <p className="text-sm leading-relaxed text-red-600">{error}</p>
            <p className="text-xs text-slate-500">
              Nothing has been changed. This booking is exactly as it was.
            </p>
            <Button size="sm" variant="secondary" onClick={() => void sendCode()}>
              <RotateCw className="mr-1 h-3.5 w-3.5" /> Try again
            </Button>
          </div>
        )}

        {status === 'sent' && (
          <>
            <p className="flex items-start gap-2 text-sm leading-relaxed text-slate-600">
              <MailCheck className="mt-0.5 h-4 w-4 flex-shrink-0 text-emerald-500" />
              <span>
                A 6-digit code has been emailed to <strong className="text-slate-800">{maskedEmail}</strong>.
                Enter it below to confirm. It is valid for 10 minutes and can be used once.
              </span>
            </p>

            <div>
              <label className="form-label">Confirmation code *</label>
              <input
                ref={inputRef}
                className="form-input text-center font-mono text-2xl tracking-[0.5em]"
                value={code}
                onChange={e => { setCode(e.target.value.replace(/\D/g, '').slice(0, 6)); setError(null) }}
                onKeyDown={e => { if (e.key === 'Enter' && ready) void confirm() }}
                placeholder="000000"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
              />
              {error && <p className="mt-1.5 text-xs font-medium text-red-600">{error}</p>}
              <div className="mt-2 flex items-center justify-between">
                <p className="text-[11px] text-slate-400">
                  Didn&apos;t arrive? Check your junk folder.
                </p>
                <button
                  type="button"
                  disabled={cooldown > 0 || busy}
                  onClick={() => void sendCode()}
                  className="text-[11px] font-medium text-brand-600 hover:underline disabled:cursor-not-allowed disabled:text-slate-300 disabled:no-underline"
                >
                  {cooldown > 0 ? `Send a new code (${cooldown}s)` : 'Send a new code'}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </Modal>
  )
}
