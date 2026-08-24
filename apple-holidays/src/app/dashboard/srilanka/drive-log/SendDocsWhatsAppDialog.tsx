'use client'

/**
 * Sending the settlement paperwork to a driver on WhatsApp.
 *
 * ---- The number is the whole problem ----
 *
 * A driver's number reaches the file written every way there is: `+94775622923`,
 * `0775622923`, `94775622923.`, with spaces, with dashes. WhatsApp accepts one
 * form and one only. It does not reject the others — it delivers them to nobody,
 * so a send that "worked" can quietly reach no one at all.
 *
 * So the number is shown twice: as it is stored on the driver record, and as
 * WhatsApp will actually receive it, updating as the desk types. Nothing is sent
 * until that second line reads like a real phone number, and the box is editable
 * for the times the number on file is simply wrong. An edit here changes this
 * send only; the driver record is edited on the driver screen.
 *
 * ---- What goes ----
 *
 * Every sheet by default, as one PDF. Opened from the editor it sends the pack
 * *on screen*, unsaved corrections included; opened from a Drive Log row it
 * sends the saved pack, or the derived draft when nothing has been saved.
 *
 * The booking sheet can go with them — guests, flights, hotels, the agenda and
 * the vouchers — as a second message, because WhatsApp carries one document per
 * message. It is the PDF the operations email already sends, and it prints no
 * rate, no cost and no payment, which is what makes it fit for a driver.
 *
 * ---- And then: did it arrive? ----
 *
 * The dialog does not close on a green tick. Pressing send is the beginning of
 * the question, not the end of it — Meta answers 200 in a second and reports
 * the actual delivery minutes later. So the dialog stays open on a live
 * receipt board that walks each document from sent to delivered to read, or to
 * failed with the reason. A desk that watches it for ten seconds knows
 * something a desk that watched the old success toast never did.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  AlertTriangle, ArrowRight, Check, CheckCheck, Copy, Loader2, MessageCircle,
  Phone, Send, Settings2, ShieldCheck, X,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { normaliseSriLankanPhone } from '@/lib/sl-phone'
import { DOC_KINDS, DOC_LABEL, type SettlementDocKind, type SettlementDocPack } from '@/lib/sl-settlement-docs'

interface CopyContact {
  enabled: boolean
  active: boolean
  label: string
  pretty: string
  msisdn: string
  reason: string | null
  canEdit?: boolean
  phone?: string
}

interface Contact {
  driverName: string | null
  vehicle: string | null
  storedPhone: string | null
  phone: { ok: boolean; msisdn: string; pretty: string; shape: string; reason: string | null }
  canSend: boolean
  copyContact: CopyContact
}

/** One row of the receipt board — a document, a recipient, a delivery state. */
interface Delivery {
  id: string
  kind: string
  audience: string
  phone: string
  channel: string | null
  docs: string[]
  filename: string | null
  status: string
  failureReason: string | null
  copyLabel: string | null
  createdAt: string
}

interface SendOutcome {
  phone: string
  channel: 'template' | 'freeform'
  filename: string
  preview: string
  sendId?: string | null
  bookingSheet?: { ok: boolean; filename?: string; reason?: string }
  copyContact?: CopyContact
}

/** How long the board keeps asking. Meta is usually done inside ten seconds. */
const RECEIPT_POLL_MS  = 3500
const RECEIPT_STOP_MS  = 3 * 60 * 1000

export function SendDocsWhatsAppDialog({
  bookingRef, title, pack, driverId, onClose, onOpenChat,
}: {
  bookingRef: string
  title: string
  /** The pack on screen. Omitted from the Drive Log row, where the saved pack is sent. */
  pack?: SettlementDocPack | null
  /** The allocated driver, when the row knows it — filed on the delivery receipt. */
  driverId?: string | null
  onClose: () => void
  /** Opens the chat dock on this driver, so a silent delivery can be chased at once. */
  onOpenChat?: () => void
}) {
  const [contact, setContact] = useState<Contact | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)
  const [phone, setPhone]     = useState('')
  const [kinds, setKinds]     = useState<SettlementDocKind[]>([...DOC_KINDS])
  const [withBooking, setWithBooking] = useState(false)
  const [sending, setSending] = useState(false)
  const [sent, setSent]       = useState<SendOutcome | null>(null)
  const [sentAt, setSentAt]   = useState<number | null>(null)
  const [deliveries, setDeliveries] = useState<Delivery[]>([])
  const [editingCopy, setEditingCopy] = useState(false)

  useEffect(() => {
    let alive = true
    setLoading(true)
    fetch(`/api/srilanka/drive-log/documents/whatsapp?ref=${encodeURIComponent(bookingRef)}`)
      .then(async res => {
        const json = await res.json().catch(() => null)
        if (!res.ok) throw new Error(json?.error ?? 'The driver contact could not be read')
        return json.data as Contact
      })
      .then(data => {
        if (!alive) return
        setContact(data)
        // Prefilled with what is on file, not with the cleaned version: the desk
        // should see the number as it was actually recorded.
        setPhone(data.storedPhone ?? '')
      })
      .catch(err => { if (alive) setError((err as Error).message) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [bookingRef])

  /** The same normalisation the server will apply, run as the desk types. */
  const reading = useMemo(() => normaliseSriLankanPhone(phone), [phone])

  // ── The receipt board ──────────────────────────────────────────────────────
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const readReceipts = useCallback(async () => {
    try {
      const res  = await fetch(`/api/srilanka/drive-log/documents/deliveries?ref=${encodeURIComponent(bookingRef)}`)
      const json = await res.json().catch(() => null)
      if (!res.ok) return
      setDeliveries((json.data?.sends ?? []) as Delivery[])
    } catch {
      /* A receipt that cannot be read is not a send that failed. */
    }
  }, [bookingRef])

  useEffect(() => {
    if (!sentAt) return
    void readReceipts()
    pollRef.current = setInterval(() => {
      if (Date.now() - sentAt > RECEIPT_STOP_MS) {
        if (pollRef.current) clearInterval(pollRef.current)
        return
      }
      void readReceipts()
    }, RECEIPT_POLL_MS)
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [sentAt, readReceipts])

  const send = async () => {
    if (!reading.ok || !kinds.length) return
    setSending(true)
    try {
      const res = await fetch(`/api/srilanka/drive-log/documents/whatsapp?ref=${encodeURIComponent(bookingRef)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pack: pack ?? undefined,
          docs: kinds.join(','),
          phone,
          includeBooking: withBooking,
          driverId: driverId ?? undefined,
        }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) throw new Error(json?.error ?? 'The documents could not be sent')
      setSent(json.data as SendOutcome)
      setSentAt(Date.now())
      toast.success(`Documents sent to +${(json.data as SendOutcome).phone}`)
    } catch (err) {
      toast.error((err as Error).message)
      // A refusal is still worth a look at the board: the failed attempt is
      // recorded there with Meta's reason on it.
      setSentAt(Date.now())
    } finally {
      setSending(false)
    }
  }

  /** Kept in printing order however they are ticked — board first, forms behind. */
  const toggle = (k: SettlementDocKind) =>
    setKinds(prev => {
      const next = prev.includes(k) ? prev.filter(x => x !== k) : [...prev, k]
      return DOC_KINDS.filter(x => next.includes(x))
    })

  const shapeNote: Record<string, string> = {
    international: 'already had the country code',
    local: 'local number — the leading 0 is replaced by 94',
    bare: 'no prefix — 94 added',
    foreign: 'not a Sri Lankan number; sent as written',
  }

  const copy = contact?.copyContact

  return (
    <>
      <div className="fixed inset-0 bg-black/75 backdrop-blur-sm z-[60]" onClick={onClose} />
      <div className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-[61] w-[min(94vw,560px)] max-h-[92vh] overflow-y-auto rounded-2xl bg-[#0c1225] border border-slate-800 shadow-2xl shadow-black/60">

        <div className="flex items-center gap-3 px-5 py-4 border-b border-slate-800 sticky top-0 bg-[#0c1225] z-10">
          <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/25 flex items-center justify-center">
            <MessageCircle className="w-5 h-5 text-emerald-400" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-white font-black text-sm truncate">Send documents to the driver · {title}</p>
            <p className="text-slate-400 text-[11px] mt-0.5">
              One PDF over WhatsApp — the sheets exactly as they print.
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {loading ? (
          <div className="px-5 py-10 flex items-center justify-center gap-2 text-slate-500 text-sm">
            <Loader2 className="w-4 h-4 animate-spin" /> Reading the driver&apos;s details…
          </div>
        ) : error ? (
          <div className="px-5 py-6">
            <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-xs text-rose-200 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 flex-shrink-0" /> {error}
            </div>
          </div>
        ) : sentAt ? (
          <div className="px-5 py-5 space-y-4">
            {sent ? (
              <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-xs text-emerald-200">
                <p className="font-bold flex items-center gap-1.5"><Check className="w-3.5 h-3.5" /> Handed to WhatsApp for +{sent.phone}</p>
                <p className="mt-1 text-emerald-300/80">
                  {sent.channel === 'template'
                    ? 'Sent as the approved template — the driver had not messaged us in the last 24 hours.'
                    : 'Sent as a normal message — the driver’s 24-hour window was open.'}
                </p>
              </div>
            ) : (
              <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-xs text-rose-200">
                <p className="font-bold flex items-center gap-1.5"><AlertTriangle className="w-3.5 h-3.5" /> The send was refused</p>
                <p className="mt-1 text-rose-300/80">The attempt is recorded below with the reason.</p>
              </div>
            )}

            <ReceiptBoard deliveries={deliveries} onRefresh={() => void readReceipts()} />

            {sent?.bookingSheet && !sent.bookingSheet.ok ? (
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-[11px] text-amber-200">
                <p className="font-bold flex items-center gap-1.5"><AlertTriangle className="w-3.5 h-3.5" /> The booking details did not go</p>
                <p className="mt-1 opacity-80">{sent.bookingSheet.reason}</p>
              </div>
            ) : null}

            {sent?.preview ? (
              <details className="rounded-xl border border-slate-800 bg-slate-950/60 overflow-hidden">
                <summary className="px-3 py-2 text-[11px] font-bold text-slate-400 cursor-pointer hover:text-slate-200">
                  What the driver reads
                </summary>
                <pre className="px-3 pb-3 text-[11px] text-slate-300 whitespace-pre-wrap font-sans leading-relaxed">
                  {sent.preview}
                </pre>
              </details>
            ) : null}

            <div className="flex gap-2">
              {onOpenChat ? (
                <button
                  onClick={() => { onOpenChat(); onClose() }}
                  className="flex-1 py-2 rounded-xl bg-emerald-500/12 border border-emerald-500/35 text-xs font-bold text-emerald-200 hover:bg-emerald-500/20 transition-colors flex items-center justify-center gap-1.5"
                >
                  <MessageCircle className="w-3.5 h-3.5" /> Chat with the driver
                </button>
              ) : null}
              <button
                onClick={onClose}
                className="flex-1 py-2 rounded-xl bg-slate-900/60 border border-slate-800 text-xs font-bold text-slate-300 hover:text-white hover:border-slate-700 transition-colors"
              >
                Done
              </button>
            </div>
          </div>
        ) : (
          <div className="px-5 py-4 space-y-4">
            {/* Who */}
            <div className="rounded-xl border border-slate-800 bg-slate-950/40 px-3 py-2.5">
              <p className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">Driver</p>
              <p className="text-sm font-bold text-slate-100 mt-0.5">{contact?.driverName ?? 'No driver on this file'}</p>
              {contact?.vehicle ? <p className="text-[11px] text-slate-500">{contact.vehicle}</p> : null}
            </div>

            {/* The number */}
            <div>
              <label className="block">
                <span className="block text-[10px] uppercase tracking-wider text-slate-500 font-bold mb-1">
                  WhatsApp number
                </span>
                <div className="relative">
                  <Phone className="w-3.5 h-3.5 text-slate-600 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="tel"
                    value={phone}
                    onChange={e => setPhone(e.target.value)}
                    placeholder="0775622923"
                    className="w-full pl-9 pr-3 py-2 rounded-lg bg-slate-950/70 border border-slate-800 text-sm text-slate-100 font-mono placeholder:text-slate-600 focus:outline-none focus:border-slate-600"
                  />
                </div>
              </label>

              {/* What WhatsApp will actually receive. */}
              <div className={cn(
                'mt-2 rounded-lg border px-3 py-2 text-[11px] flex items-start gap-2',
                reading.ok ? 'border-emerald-500/25 bg-emerald-500/5 text-emerald-200'
                           : 'border-amber-500/30 bg-amber-500/10 text-amber-200',
              )}>
                {reading.ok ? (
                  <>
                    <ArrowRight className="w-3.5 h-3.5 flex-shrink-0 mt-px" />
                    <span>
                      Sends to <span className="font-mono font-bold">{reading.msisdn}</span>
                      <span className="text-emerald-300/70"> · {reading.pretty}</span>
                      <span className="block text-emerald-300/60">{shapeNote[reading.shape] ?? ''}</span>
                    </span>
                  </>
                ) : (
                  <>
                    <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-px" />
                    <span>{reading.reason}</span>
                  </>
                )}
              </div>

              {contact?.storedPhone && contact.storedPhone.replace(/\D/g, '') !== phone.replace(/\D/g, '') ? (
                <button
                  type="button"
                  onClick={() => setPhone(contact.storedPhone ?? '')}
                  className="mt-1.5 text-[10px] font-bold text-slate-500 hover:text-slate-300 underline underline-offset-2"
                >
                  Back to the number on the driver record ({contact.storedPhone})
                </button>
              ) : null}
            </div>

            {/* The standing copy — stated before the send, never after. */}
            <CopyContactCard
              contact={copy}
              editing={editingCopy}
              onEdit={() => setEditingCopy(true)}
              onDone={next => {
                setEditingCopy(false)
                if (next && contact) setContact({ ...contact, copyContact: next })
              }}
            />

            {/* What goes */}
            <div>
              <span className="block text-[10px] uppercase tracking-wider text-slate-500 font-bold mb-1.5">
                Documents · one PDF
              </span>
              <div className="grid grid-cols-2 gap-1.5">
                {DOC_KINDS.map(k => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => toggle(k)}
                    className={cn(
                      'flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-[11px] font-bold transition-colors text-left',
                      kinds.includes(k)
                        ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-200'
                        : 'bg-slate-900/50 border-slate-800 text-slate-500 hover:border-slate-700',
                    )}
                  >
                    <span className={cn(
                      'w-3.5 h-3.5 rounded border flex items-center justify-center flex-shrink-0',
                      kinds.includes(k) ? 'bg-emerald-500 border-emerald-500' : 'border-slate-600',
                    )}>
                      {kinds.includes(k) ? <Check className="w-2.5 h-2.5 text-slate-950" /> : null}
                    </span>
                    {DOC_LABEL[k]}
                  </button>
                ))}
              </div>
            </div>

            {/* The booking sheet — a second message, and a different document. */}
            <button
              type="button"
              onClick={() => setWithBooking(v => !v)}
              className={cn(
                'w-full flex items-start gap-2.5 px-3 py-2.5 rounded-xl border text-left transition-colors',
                withBooking
                  ? 'bg-sky-500/10 border-sky-500/30'
                  : 'bg-slate-900/50 border-slate-800 hover:border-slate-700',
              )}
            >
              <span className={cn(
                'w-3.5 h-3.5 rounded border flex items-center justify-center flex-shrink-0 mt-0.5',
                withBooking ? 'bg-sky-400 border-sky-400' : 'border-slate-600',
              )}>
                {withBooking ? <Check className="w-2.5 h-2.5 text-slate-950" /> : null}
              </span>
              <span className="min-w-0">
                <span className={cn('block text-[11px] font-bold', withBooking ? 'text-sky-200' : 'text-slate-300')}>
                  Also send the booking details PDF
                </span>
                <span className="block text-[10px] text-slate-500 leading-snug">
                  Guests, flights, hotels, the day-by-day agenda and the vouchers — as a second message.
                  It carries no rates or costs.
                </span>
              </span>
            </button>

            {!contact?.canSend ? (
              <div className="rounded-xl border border-slate-700 bg-slate-900/60 px-3 py-2 text-[11px] text-slate-300">
                Sending documents to a driver is for the operations desk, Accounts and admins.
              </div>
            ) : null}

            <button
              onClick={send}
              disabled={!reading.ok || !kinds.length || sending || !contact?.canSend}
              className="w-full py-2.5 rounded-xl bg-emerald-500/15 border border-emerald-500/40 text-xs font-black text-emerald-200 hover:bg-emerald-500/25 transition-colors disabled:opacity-40 disabled:hover:bg-emerald-500/15 flex items-center justify-center gap-2"
            >
              {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
              {sending
                ? 'Sending…'
                : `Send ${kinds.length} document${kinds.length === 1 ? '' : 's'}${withBooking ? ' + booking sheet' : ''}`}
            </button>
            <p className="text-[10px] text-slate-600 text-center -mt-1">
              {pack ? 'Sends the version on screen, including unsaved edits.' : 'Sends the saved documents for this booking.'}
            </p>
          </div>
        )}
      </div>
    </>
  )
}

// ── The receipt board ────────────────────────────────────────────────────────

const STATUS_TONE: Record<string, string> = {
  pending:   'border-slate-700 bg-slate-800/60 text-slate-300',
  sent:      'border-slate-600 bg-slate-800/60 text-slate-200',
  delivered: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200',
  read:      'border-sky-500/30 bg-sky-500/10 text-sky-200',
  failed:    'border-rose-500/40 bg-rose-500/10 text-rose-200',
}

const STATUS_WORD: Record<string, string> = {
  pending:   'waiting',
  sent:      'sent — not yet on the phone',
  delivered: 'on the driver’s phone',
  read:      'opened',
  failed:    'never arrived',
}

const KIND_WORD: Record<string, string> = {
  settlement: 'Settlement pack',
  booking:    'Booking details',
}

/**
 * What actually happened, per message.
 *
 * The board's job is to make the gap between "we sent it" and "he has it"
 * visible for the ten seconds it usually lasts, and impossible to miss on the
 * days it lasts forever.
 */
function ReceiptBoard({ deliveries, onRefresh }: { deliveries: Delivery[]; onRefresh: () => void }) {
  if (!deliveries.length) {
    return (
      <div className="rounded-xl border border-slate-800 bg-slate-950/40 px-4 py-5 text-center text-[11px] text-slate-500 flex items-center justify-center gap-2">
        <Loader2 className="w-3.5 h-3.5 animate-spin" /> Waiting for WhatsApp to report back…
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/40 overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-800">
        <ShieldCheck className="w-3.5 h-3.5 text-slate-500" />
        <p className="text-[10px] uppercase tracking-wider text-slate-500 font-bold flex-1">Delivery</p>
        <button onClick={onRefresh} className="text-[10px] font-bold text-slate-500 hover:text-slate-200">
          Refresh
        </button>
      </div>
      <div className="divide-y divide-slate-800/70">
        {deliveries.map(d => (
          <div key={d.id} className="px-3 py-2.5">
            <div className="flex items-center gap-2">
              {d.audience === 'copy'
                ? <Copy className="w-3 h-3 text-slate-500 flex-shrink-0" />
                : <Send className="w-3 h-3 text-slate-500 flex-shrink-0" />}
              <p className="text-[11px] font-bold text-slate-200 flex-1 min-w-0 truncate">
                {KIND_WORD[d.kind] ?? d.kind}
                {d.audience === 'copy'
                  ? <span className="text-slate-500 font-normal"> · copy to {d.copyLabel || `+${d.phone}`}</span>
                  : <span className="text-slate-500 font-normal"> · +{d.phone}</span>}
              </p>
              <span className={cn('px-1.5 py-0.5 rounded border text-[9px] font-black uppercase tracking-wide flex items-center gap-1', STATUS_TONE[d.status] ?? STATUS_TONE.pending)}>
                <StatusIcon status={d.status} />
                {d.status}
              </span>
            </div>
            <p className="text-[10px] text-slate-500 mt-0.5 ml-5">
              {STATUS_WORD[d.status] ?? d.status}
              {d.channel ? ` · ${d.channel === 'template' ? 'approved template' : 'free-form'}` : ''}
              {d.docs.length ? ` · ${d.docs.length} sheet${d.docs.length === 1 ? '' : 's'}` : ''}
            </p>
            {d.failureReason ? (
              <p className="text-[10px] text-rose-300/90 mt-1 ml-5 leading-snug">{d.failureReason}</p>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  )
}

function StatusIcon({ status }: { status: string }) {
  if (status === 'failed')    return <AlertTriangle className="w-2.5 h-2.5" />
  if (status === 'read')      return <CheckCheck className="w-2.5 h-2.5" />
  if (status === 'delivered') return <CheckCheck className="w-2.5 h-2.5" />
  if (status === 'sent')      return <Check className="w-2.5 h-2.5" />
  return <Loader2 className="w-2.5 h-2.5 animate-spin" />
}

// ── The standing copy ────────────────────────────────────────────────────────

/**
 * Where the second copy goes — and, for an admin, where it should go.
 *
 * Shown on the compose step rather than the result step on purpose. A copy the
 * sender learns about afterwards is a surprise; a copy stated before the send
 * is a policy.
 */
function CopyContactCard({
  contact, editing, onEdit, onDone,
}: {
  contact: CopyContact | undefined
  editing: boolean
  onEdit: () => void
  onDone: (next: CopyContact | null) => void
}) {
  const [phone, setPhone]     = useState(contact?.phone ?? contact?.pretty ?? '')
  const [label, setLabel]     = useState(contact?.label ?? '')
  const [enabled, setEnabled] = useState(contact?.enabled ?? false)
  const [saving, setSaving]   = useState(false)

  const reading = useMemo(() => normaliseSriLankanPhone(phone), [phone])

  const save = async () => {
    setSaving(true)
    try {
      const res = await fetch('/api/srilanka/drive-log/documents/copy-contact', {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ enabled, phone, label }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) throw new Error(json?.error ?? 'The copy number could not be saved')
      toast.success(enabled ? 'Documents will be copied to this number' : 'Copying turned off')
      onDone(json.data as CopyContact)
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  if (editing) {
    return (
      <div className="rounded-xl border border-slate-700 bg-slate-950/60 px-3 py-3 space-y-2.5">
        <p className="text-[10px] uppercase tracking-wider text-slate-400 font-bold">Copy every driver document to</p>
        <input
          value={label}
          onChange={e => setLabel(e.target.value)}
          placeholder="Whose number is this? e.g. Ground manager"
          className="w-full px-3 py-2 rounded-lg bg-slate-950/70 border border-slate-800 text-xs text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-slate-600"
        />
        <input
          value={phone}
          onChange={e => setPhone(e.target.value)}
          placeholder="0771234567"
          className="w-full px-3 py-2 rounded-lg bg-slate-950/70 border border-slate-800 text-xs text-slate-100 font-mono placeholder:text-slate-600 focus:outline-none focus:border-slate-600"
        />
        {phone.trim() ? (
          <p className={cn('text-[10px]', reading.ok ? 'text-emerald-300/80' : 'text-amber-300')}>
            {reading.ok ? `Copies go to ${reading.pretty}` : reading.reason}
          </p>
        ) : null}
        <label className="flex items-center gap-2 text-[11px] text-slate-300 font-bold cursor-pointer">
          <input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} className="accent-emerald-500" />
          Copy every document sent to a driver
        </label>
        <div className="flex gap-2 pt-0.5">
          <button
            onClick={() => void save()}
            disabled={saving || (enabled && !reading.ok)}
            className="flex-1 py-1.5 rounded-lg bg-emerald-500/15 border border-emerald-500/40 text-[11px] font-bold text-emerald-200 hover:bg-emerald-500/25 transition-colors disabled:opacity-40"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button
            onClick={() => onDone(null)}
            className="px-3 py-1.5 rounded-lg bg-slate-900/60 border border-slate-800 text-[11px] font-bold text-slate-400 hover:text-slate-200"
          >
            Cancel
          </button>
        </div>
      </div>
    )
  }

  const tone = contact?.active
    ? 'border-indigo-500/30 bg-indigo-500/10'
    : contact?.enabled
      ? 'border-amber-500/30 bg-amber-500/10'
      : 'border-slate-800 bg-slate-950/40'

  return (
    <div className={cn('rounded-xl border px-3 py-2.5 flex items-start gap-2.5', tone)}>
      <Copy className={cn('w-3.5 h-3.5 flex-shrink-0 mt-0.5', contact?.active ? 'text-indigo-300' : 'text-slate-500')} />
      <div className="min-w-0 flex-1">
        {contact?.active ? (
          <>
            <p className="text-[11px] font-bold text-indigo-200">
              A copy also goes to {contact.label || 'the standing copy number'}
            </p>
            <p className="text-[10px] text-indigo-300/70 font-mono">{contact.pretty}</p>
            <p className="text-[10px] text-slate-500 leading-snug mt-0.5">
              The copy opens by naming the driver and the number the original went to, so it never
              reads as a document addressed to its reader.
            </p>
          </>
        ) : contact?.enabled ? (
          <>
            <p className="text-[11px] font-bold text-amber-200">Copying is on, but the number cannot be used</p>
            <p className="text-[10px] text-amber-300/80 leading-snug">{contact.reason ?? 'No usable number is configured.'}</p>
          </>
        ) : (
          <>
            <p className="text-[11px] font-bold text-slate-300">No copy is kept of driver documents</p>
            <p className="text-[10px] text-slate-500 leading-snug">
              Set a standing number and every document sent to a driver is shadowed to it automatically.
            </p>
          </>
        )}
      </div>
      {contact?.canEdit !== false ? (
        <button
          onClick={onEdit}
          title="Change the copy number"
          className="p-1 rounded-md text-slate-500 hover:text-slate-200 hover:bg-slate-800/70 transition-colors flex-shrink-0"
        >
          <Settings2 className="w-3.5 h-3.5" />
        </button>
      ) : null}
    </div>
  )
}
