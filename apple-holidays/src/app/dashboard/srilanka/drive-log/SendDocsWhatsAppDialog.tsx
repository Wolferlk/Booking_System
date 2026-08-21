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
 * All four sheets by default, as one PDF. Opened from the editor it sends the
 * pack *on screen*, unsaved corrections included; opened from a Drive Log row it
 * sends the saved pack, or the derived draft when nothing has been saved.
 */

import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import {
  AlertTriangle, ArrowRight, Check, Loader2, MessageCircle, Phone, Send, X,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { normaliseSriLankanPhone } from '@/lib/sl-phone'
import { DOC_KINDS, DOC_LABEL, type SettlementDocKind, type SettlementDocPack } from '@/lib/sl-settlement-docs'

interface Contact {
  driverName: string | null
  vehicle: string | null
  storedPhone: string | null
  phone: { ok: boolean; msisdn: string; pretty: string; shape: string; reason: string | null }
  canSend: boolean
}

interface SendOutcome {
  phone: string
  channel: 'template' | 'freeform'
  filename: string
  preview: string
}

export function SendDocsWhatsAppDialog({
  bookingRef, title, pack, onClose,
}: {
  bookingRef: string
  title: string
  /** The pack on screen. Omitted from the Drive Log row, where the saved pack is sent. */
  pack?: SettlementDocPack | null
  onClose: () => void
}) {
  const [contact, setContact] = useState<Contact | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)
  const [phone, setPhone]     = useState('')
  const [kinds, setKinds]     = useState<SettlementDocKind[]>([...DOC_KINDS])
  const [sending, setSending] = useState(false)
  const [sent, setSent]       = useState<SendOutcome | null>(null)

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

  const send = async () => {
    if (!reading.ok || !kinds.length) return
    setSending(true)
    try {
      const res = await fetch(`/api/srilanka/drive-log/documents/whatsapp?ref=${encodeURIComponent(bookingRef)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pack: pack ?? undefined, docs: kinds.join(','), phone }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) throw new Error(json?.error ?? 'The documents could not be sent')
      setSent(json.data as SendOutcome)
      toast.success(`Documents sent to +${(json.data as SendOutcome).phone}`)
    } catch (err) {
      toast.error((err as Error).message)
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

  return (
    <>
      <div className="fixed inset-0 bg-black/75 backdrop-blur-sm z-[60]" onClick={onClose} />
      <div className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-[61] w-[min(94vw,520px)] rounded-2xl bg-[#0c1225] border border-slate-800 shadow-2xl shadow-black/60 overflow-hidden">

        <div className="flex items-center gap-3 px-5 py-4 border-b border-slate-800">
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
        ) : sent ? (
          <div className="px-5 py-6 space-y-4">
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-xs text-emerald-200">
              <p className="font-bold flex items-center gap-1.5"><Check className="w-3.5 h-3.5" /> Sent to +{sent.phone}</p>
              <p className="mt-1 text-emerald-300/80">
                {sent.channel === 'template'
                  ? 'Delivered as the approved template — the driver had not messaged us in the last 24 hours.'
                  : 'Delivered as a normal message — the driver’s 24-hour window was open.'}
              </p>
              <p className="mt-1 text-emerald-300/60 font-mono text-[10px]">{sent.filename}</p>
            </div>
            <pre className="rounded-xl border border-slate-800 bg-slate-950/60 p-3 text-[11px] text-slate-300 whitespace-pre-wrap font-sans leading-relaxed max-h-52 overflow-y-auto">
              {sent.preview}
            </pre>
            <button
              onClick={onClose}
              className="w-full py-2 rounded-xl bg-slate-900/60 border border-slate-800 text-xs font-bold text-slate-300 hover:text-white hover:border-slate-700 transition-colors"
            >
              Done
            </button>
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
              {sending ? 'Sending…' : `Send ${kinds.length} document${kinds.length === 1 ? '' : 's'}`}
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
