'use client'

/**
 * The approval strip on a ticket card.
 *
 * On Malaysia, Singapore and Vietnam a ticket is no longer bought and explained
 * afterwards. The ground team picks the portal it intends to buy through, sends
 * the ticket to Accounts, and Accounts approves it and pays that portal — only
 * then does the Purchase button come alive. This component is that whole
 * conversation, on the ticket it is about:
 *
 *   choose portal → submit (urgent if it cannot wait) → watch → purchase
 *
 * It renders nothing at all for operations that do not work this way (Sri
 * Lanka, whose driver buys out of his advance) or for categories that are not
 * bought through a portal — an empty box asking for nothing is worse than no
 * box.
 *
 * The state shown is the mirrored copy on the ticket, refreshed by the list
 * endpoint on every load. Actions go to /api/tickets/[id]/approval, which reads
 * and writes the shared table in the Accounts database.
 */
import { useState } from 'react'
import {
  AlertTriangle, Check, Clock, Loader2, Send, Store, Undo2, Wallet, X, Zap,
} from 'lucide-react'
import { toast } from 'sonner'

export type ApprovalStatus = 'pending' | 'approved' | 'paid' | 'rejected' | 'withdrawn' | 'cancelled'

/** The subset of a ticket this strip needs. */
export interface ApprovalTicket {
  id: string
  status: string
  category: string | null
  portalName: string | null
  approvalStatus: string | null
  approvalUrgency: string | null
  approvalReason: string | null
  approvalNeededBy: string | null
  submittedBy: string | null
  submittedAt: string | null
  approvalDecidedBy: string | null
  approvalDecidedAt: string | null
  approvalNote: string | null
  approvalPaidAt: string | null
  approvalPaidRef: string | null
}

interface Props {
  ticket: ApprovalTicket
  /** False for Sri Lanka and anywhere else that does not buy through portals. */
  required: boolean
  /** May this user commit us to a purchase? */
  canSubmit: boolean
  /** Reload the ticket list after anything changes. */
  onChanged: () => void
}

/* ─── How each state reads ─────────────────────────────────────────────────── */

const LOOK: Record<ApprovalStatus, {
  label: string
  hint: string
  chip: string
  icon: typeof Clock
}> = {
  pending: {
    label: 'With Accounts',
    hint: 'Waiting for them to approve and pay the portal.',
    chip: 'bg-amber-50 text-amber-700 border-amber-200',
    icon: Clock,
  },
  approved: {
    label: 'Approved',
    hint: 'Accounts approved it. You can buy once they have paid the portal.',
    chip: 'bg-indigo-50 text-indigo-700 border-indigo-200',
    icon: Check,
  },
  paid: {
    label: 'Paid — buy it',
    hint: 'Accounts has paid the portal. Go ahead and purchase.',
    chip: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    icon: Wallet,
  },
  rejected: {
    label: 'Sent back',
    hint: 'Accounts sent this back. Fix what they asked and submit again.',
    chip: 'bg-red-50 text-red-700 border-red-200',
    icon: X,
  },
  withdrawn: {
    label: 'Withdrawn',
    hint: 'You took this back. Submit it again when it is ready.',
    chip: 'bg-slate-100 text-slate-600 border-slate-200',
    icon: Undo2,
  },
  cancelled: {
    label: 'Cancelled',
    hint: 'This request was cancelled.',
    chip: 'bg-slate-100 text-slate-600 border-slate-200',
    icon: X,
  },
}

function when(value: string | null): string {
  if (!value) return ''
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(undefined, {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  })
}

export default function TicketApprovalPanel({ ticket, required, canSubmit, onChanged }: Props) {
  const [open, setOpen] = useState(false)
  const [urgent, setUrgent] = useState(false)
  const [reason, setReason] = useState('')
  const [neededBy, setNeededBy] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  // Nothing to approve: this operation does not buy through portals, or the
  // ticket has already been bought.
  if (!required || ticket.status !== 'DRAFT') return null

  const status = (ticket.approvalStatus ?? null) as ApprovalStatus | null
  const live = status === 'pending' || status === 'approved' || status === 'paid'
  const isUrgent = status === 'pending' && ticket.approvalUrgency === 'urgent'
  const overdue = isUrgent && ticket.approvalNeededBy
    ? new Date(ticket.approvalNeededBy).getTime() < Date.now()
    : false

  async function call(method: 'POST' | 'DELETE', body?: unknown) {
    setBusy(true)
    try {
      const res = await fetch(`/api/tickets/${ticket.id}/approval`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      })
      const json = await res.json()

      if (!json.success) throw new Error(json.error || 'That did not go through.')

      toast.success(json.message || 'Done')
      setOpen(false)
      setUrgent(false); setReason(''); setNeededBy(''); setNote('')
      onChanged()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'That did not go through.')
    } finally {
      setBusy(false)
    }
  }

  function submit() {
    if (!ticket.portalName) {
      toast.error('Pick the portal you will buy this through and save it first.')
      return
    }
    if (urgent && !reason.trim()) {
      toast.error('Say why it is urgent — Accounts is alerted with this reason.')
      return
    }

    call('POST', {
      urgent,
      urgentReason: reason.trim() || null,
      neededBy: neededBy || null,
      note: note.trim() || null,
    })
  }

  /* ── Never submitted, or sent back / withdrawn: the ask ──────────────── */

  if (!live) {
    const bounced = status === 'rejected' || status === 'withdrawn'

    return (
      <div className="mt-3 pt-3 border-t border-slate-100">
        {bounced && (
          <div className={`flex items-start gap-2 rounded-lg border px-3 py-2 mb-2 text-xs ${LOOK[status!].chip}`}>
            <X className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
            <span>
              <b>{LOOK[status!].label}</b>
              {ticket.approvalDecidedBy ? ` by ${ticket.approvalDecidedBy}` : ''}
              {ticket.approvalNote ? ` — ${ticket.approvalNote}` : ''}
            </span>
          </div>
        )}

        {!ticket.portalName ? (
          <p className="text-xs text-amber-600 font-semibold flex items-center gap-1.5">
            <Store className="w-3.5 h-3.5" />
            Pick the portal you will buy this through before sending it to Accounts.
          </p>
        ) : !open ? (
          <button
            onClick={() => setOpen(true)}
            disabled={!canSubmit}
            title={canSubmit
              ? `Ask Accounts to approve and pay ${ticket.portalName}`
              : 'You do not have permission to submit tickets for approval'}
            className={`btn btn-sm ${canSubmit ? 'btn-primary' : 'btn-secondary opacity-50 cursor-not-allowed'}`}
          >
            <Send className="w-3.5 h-3.5" />
            {bounced ? 'Submit again' : 'Send to Accounts'}
          </button>
        ) : (
          /* The ask itself. Deliberately small: a portal, a flag, a reason. */
          <div className="rounded-xl border border-indigo-200 bg-indigo-50/60 p-3 animate-slide-up">
            <p className="text-xs text-slate-600 mb-2">
              Accounts will be asked to approve paying{' '}
              <b className="text-indigo-700">{ticket.portalName}</b> for this ticket. You can buy it
              once they have paid.
            </p>

            <label className={`flex items-center gap-2 rounded-lg border px-3 py-2 cursor-pointer transition
              ${urgent ? 'border-red-300 bg-red-50' : 'border-slate-200 bg-white hover:border-slate-300'}`}>
              <input
                type="checkbox"
                checked={urgent}
                onChange={e => setUrgent(e.target.checked)}
                className="rounded border-slate-300 text-red-600 focus:ring-red-500"
              />
              <Zap className={`w-3.5 h-3.5 ${urgent ? 'text-red-600' : 'text-slate-400'}`} />
              <span className={`text-xs font-semibold ${urgent ? 'text-red-700' : 'text-slate-600'}`}>
                Urgent — alert Accounts now
              </span>
            </label>

            {urgent && (
              <div className="mt-2 space-y-2 animate-fade-in">
                <input
                  value={reason}
                  onChange={e => setReason(e.target.value)}
                  placeholder="Why it cannot wait — Accounts reads this on the alert"
                  className="w-full text-xs rounded-lg border-slate-300 focus:border-red-400 focus:ring-red-400"
                />
                <label className="block">
                  <span className="text-[10px] uppercase tracking-wide text-slate-400">Money needed out by</span>
                  <input
                    type="datetime-local"
                    value={neededBy}
                    onChange={e => setNeededBy(e.target.value)}
                    className="mt-0.5 w-full text-xs rounded-lg border-slate-300 focus:border-red-400 focus:ring-red-400"
                  />
                </label>
              </div>
            )}

            <input
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder="Anything Accounts should know (optional)"
              className="mt-2 w-full text-xs rounded-lg border-slate-300"
            />

            <div className="flex items-center gap-2 mt-3">
              <button onClick={submit} disabled={busy}
                className={`btn btn-sm text-white ${urgent ? 'bg-red-600 hover:bg-red-700 animate-urgent-glow' : 'btn-primary'}`}>
                {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                {urgent ? 'Send as urgent' : 'Send to Accounts'}
              </button>
              <button onClick={() => setOpen(false)} className="btn btn-secondary btn-sm">Cancel</button>
            </div>
          </div>
        )}
      </div>
    )
  }

  /* ── Submitted: where it has got to ───────────────────────────────────── */

  const look = LOOK[status!]
  const Icon = look.icon

  return (
    <div className="mt-3 pt-3 border-t border-slate-100">
      <div className="flex items-center gap-2 flex-wrap">
        <span
          className={`relative overflow-hidden inline-flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-lg border
            ${isUrgent
              ? 'bg-red-600 text-white border-red-700 animate-urgent-glow'
              : look.chip}`}
          title={look.hint}
        >
          {status === 'pending'
            ? <span className={`w-1.5 h-1.5 rounded-full ${isUrgent ? 'bg-white' : 'bg-amber-500'} animate-breathe`} />
            : <Icon className="w-3 h-3" />}
          {isUrgent ? 'URGENT · ' : ''}{look.label}
          {isUrgent && (
            // The sheen is what makes an urgent request findable in a long
            // list without reading any of it.
            <span className="pointer-events-none absolute inset-0 animate-sheen
                             bg-gradient-to-r from-transparent via-white/40 to-transparent" />
          )}
        </span>

        {ticket.portalName && (
          <span className="inline-flex items-center gap-1 text-xs text-slate-500">
            <Store className="w-3 h-3" /> {ticket.portalName}
          </span>
        )}

        {status === 'pending' && canSubmit && (
          <button
            onClick={() => call('DELETE')}
            disabled={busy}
            title="Take this request back — only possible before Accounts answers it"
            className="btn btn-secondary btn-sm ml-auto"
          >
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Undo2 className="w-3.5 h-3.5" />}
            Withdraw
          </button>
        )}
      </div>

      <p className="text-[11px] text-slate-500 mt-1.5">
        {status === 'pending' && (
          <>
            Sent{ticket.submittedBy ? ` by ${ticket.submittedBy}` : ''}{ticket.submittedAt ? ` · ${when(ticket.submittedAt)}` : ''}.
            {' '}You cannot purchase until Accounts has paid the portal.
          </>
        )}
        {status === 'approved' && (
          <>
            Approved{ticket.approvalDecidedBy ? ` by ${ticket.approvalDecidedBy}` : ''}
            {ticket.approvalDecidedAt ? ` · ${when(ticket.approvalDecidedAt)}` : ''}.
            {' '}Waiting for the payment to the portal.
          </>
        )}
        {status === 'paid' && (
          <>
            Paid{ticket.approvalPaidAt ? ` · ${when(ticket.approvalPaidAt)}` : ''}
            {ticket.approvalPaidRef ? ` · ref ${ticket.approvalPaidRef}` : ''}.
            {' '}Go ahead and buy it.
          </>
        )}
      </p>

      {overdue && (
        <p className="text-[11px] text-red-600 font-semibold mt-1 flex items-center gap-1">
          <AlertTriangle className="w-3 h-3" />
          Past the time you told Accounts the money had to be out — chase them.
        </p>
      )}

      {isUrgent && ticket.approvalReason && (
        <p className="text-[11px] text-red-600 mt-1">Urgent: {ticket.approvalReason}</p>
      )}
    </div>
  )
}
