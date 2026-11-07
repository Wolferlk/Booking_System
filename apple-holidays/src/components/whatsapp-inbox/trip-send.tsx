'use client'

/**
 * The two things the trip panel can send: the guest's trip portal link and the
 * movement-chart agenda. Both are real customer messages, so each opens a dialog
 * that names the recipient and shows what goes out before anything is sent.
 *
 * These call the same routes as the booking and agenda pages; nothing about
 * sending lives here.
 */
import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'framer-motion'
import {
  AlertTriangle, CarFront, Check, Copy, ExternalLink, Eye, FileText, FileType2, Globe, Loader2, Mail,
  MessageCircle, Send, X,
} from 'lucide-react'
import { toast } from 'sonner'
import type { TripContext } from '@/lib/whatsapp-trip-context'
import { fmtDate } from '@/components/whatsapp-inbox/shared'

const INACTIVE_STATUSES = ['CANCELLED', 'PENDING_CANCELLATION', 'DRAFT']

/** A 5xx through the proxy can arrive with no JSON body at all. */
async function readJson(res: Response): Promise<{ success?: boolean; error?: string; message?: string; data?: unknown }> {
  try {
    return await res.json()
  } catch {
    return { success: false, error: `The server did not answer (${res.status}). Please try again.` }
  }
}

function Dialog({ title, subtitle, icon, onClose, children }: {
  title: string; subtitle: string; icon: React.ReactNode; onClose: () => void; children: React.ReactNode
}) {
  // Capture phase, so Esc closes this dialog and not the chat underneath it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopImmediatePropagation()
      onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  return createPortal(
    <motion.div
      className="fixed inset-0 z-[70] grid place-items-center bg-slate-950/45 p-4 backdrop-blur-sm"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.div
        role="dialog" aria-modal="true" aria-label={title}
        className="flex max-h-[92vh] w-full max-w-[460px] flex-col overflow-hidden rounded-[28px] bg-white shadow-2xl"
        initial={{ y: 24, scale: 0.96 }} animate={{ y: 0, scale: 1 }} exit={{ y: 12, scale: 0.97 }}
        transition={{ type: 'spring', stiffness: 380, damping: 32 }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-5 pb-3 pt-5">
          {icon}
          <div className="min-w-0 flex-1">
            <p className="truncate text-[15.5px] font-extrabold tracking-tight text-slate-900">{title}</p>
            <p className="truncate text-[11.5px] text-slate-500">{subtitle}</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="grid h-8 w-8 place-items-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-700">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 space-y-3.5 overflow-y-auto px-5 pb-5">{children}</div>
      </motion.div>
    </motion.div>,
    document.body,
  )
}

function Segmented<T extends string>({ value, options, onChange }: {
  value: T
  options: { value: T; label: string; hint?: string; icon?: React.ReactNode }[]
  onChange: (v: T) => void
}) {
  return (
    <div className="flex gap-1 rounded-2xl bg-slate-100 p-1">
      {options.map(o => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`min-w-0 flex-1 rounded-xl px-2 py-1.5 text-center transition ${value === o.value ? 'bg-white text-slate-900 shadow-sm ring-1 ring-black/5' : 'text-slate-500 hover:text-slate-700'}`}
        >
          <span className="inline-flex items-center gap-1.5 text-[12.5px] font-bold">{o.icon}{o.label}</span>
          {o.hint && <span className="block truncate text-[10px] font-medium text-slate-400">{o.hint}</span>}
        </button>
      ))}
    </div>
  )
}

function Warning({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex gap-2 rounded-2xl bg-amber-50 px-3 py-2 text-[11.5px] leading-snug text-amber-800 ring-1 ring-amber-200">
      <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" /> <span>{children}</span>
    </p>
  )
}

function Label({ children }: { children: React.ReactNode }) {
  return <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-400">{children}</p>
}

// ── Client portal ───────────────────────────────────────────────────────────

type Stage = 'welcome' | 'reminder'

export function PortalSendDialog({ trip, phone, contactName, onClose, onSent }: {
  trip: TripContext; phone: string; contactName: string; onClose: () => void; onSent: () => void
}) {
  const [stage, setStage] = useState<Stage>(trip.portal.welcomeSentAt ? 'reminder' : 'welcome')
  const [preview, setPreview] = useState<string | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const inactive = INACTIVE_STATUSES.includes(trip.status)

  useEffect(() => {
    const ctrl = new AbortController()
    setPreview(null)
    setPreviewError(null)
    const q = new URLSearchParams({ message: 'portal', stage, to: phone })
    fetch(`/api/bookings/${encodeURIComponent(trip.bookingRef)}/whatsapp-customer?${q}`, { signal: ctrl.signal })
      .then(readJson)
      .then(json => {
        if (json.success) setPreview((json.data as { current: string }).current)
        else setPreviewError(json.error ?? 'Could not load the message')
      })
      .catch(err => { if (err?.name !== 'AbortError') setPreviewError('Could not load the message') })
    return () => ctrl.abort()
  }, [stage, phone, trip.bookingRef])

  async function send() {
    setSending(true)
    try {
      const res = await fetch(`/api/bookings/${encodeURIComponent(trip.bookingRef)}/whatsapp-customer`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ action: 'portal', stage, to: phone }),
      })
      const json = await readJson(res)
      if (!json.success) { toast.error(json.error ?? 'Send failed'); return }
      toast.success('Portal link handed to WhatsApp — watch the ticks in the chat')
      onSent()
      onClose()
    } catch {
      toast.error('Network problem — the link was not sent')
    } finally {
      setSending(false)
    }
  }

  return (
    <Dialog
      title="Send client portal"
      subtitle={`${trip.isNumber ?? trip.bookingRef} · to ${contactName}`}
      onClose={onClose}
      icon={<span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-emerald-400 to-teal-700 text-white shadow-lg shadow-emerald-600/25"><Globe className="h-5 w-5" /></span>}
    >
      <Segmented<Stage>
        value={stage}
        onChange={setStage}
        options={[
          { value: 'welcome',  label: 'Welcome',         hint: trip.portal.welcomeSentAt ? `Sent ${fmtDate(trip.portal.welcomeSentAt)}` : 'Not sent yet' },
          { value: 'reminder', label: 'Ready to travel', hint: trip.portal.reminderSentAt ? `Sent ${fmtDate(trip.portal.reminderSentAt)}` : 'Not sent yet' },
        ]}
      />

      <div>
        <Label>What they will receive</Label>
        <div className="rounded-3xl bg-[#efeae2] p-3">
          <div className="ml-auto max-w-[92%] rounded-2xl rounded-tr-md bg-[#d9fdd3] px-3 py-2 text-[12.5px] leading-relaxed text-slate-800 shadow-sm">
            {preview !== null ? (
              <p className="whitespace-pre-wrap break-words">{preview}</p>
            ) : previewError ? (
              <p className="text-rose-600">{previewError}</p>
            ) : (
              <div className="space-y-1.5 py-1">
                <div className="h-2.5 w-11/12 animate-pulse rounded bg-emerald-200/70" />
                <div className="h-2.5 w-3/4 animate-pulse rounded bg-emerald-200/70" />
                <div className="h-2.5 w-5/6 animate-pulse rounded bg-emerald-200/70" />
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 rounded-2xl bg-slate-50 px-3 py-2 ring-1 ring-slate-100">
        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-slate-500">{trip.portal.url}</span>
        <button
          onClick={() => { navigator.clipboard?.writeText(trip.portal.url); toast.success('Link copied') }}
          className="inline-flex items-center gap-1 rounded-lg px-1.5 py-1 text-[11px] font-bold text-slate-600 transition hover:bg-white"
        >
          <Copy className="h-3 w-3" /> Copy
        </button>
        <a href={trip.portal.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 rounded-lg px-1.5 py-1 text-[11px] font-bold text-slate-600 transition hover:bg-white">
          <ExternalLink className="h-3 w-3" /> Open
        </a>
      </div>

      {inactive && <Warning>This booking is {trip.status.toLowerCase().replace(/_/g, ' ')}, so the portal link can&apos;t be sent.</Warning>}

      <motion.button
        whileTap={{ scale: 0.98 }}
        disabled={sending || inactive || preview === null}
        onClick={send}
        className="flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-emerald-500 to-teal-600 py-3 text-[13.5px] font-bold text-white shadow-lg shadow-emerald-600/25 transition hover:brightness-105 disabled:opacity-50 disabled:shadow-none"
      >
        {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        {sending ? 'Sending…' : `Send to +${phone}`}
      </motion.button>
    </Dialog>
  )
}

// ── Agenda document ─────────────────────────────────────────────────────────

type Channel = 'whatsapp' | 'email'
type Format = 'pdf' | 'word'

const digits = (raw: string | null | undefined) => (raw ?? '').replace(/\D/g, '')

export function AgendaSendDialog({ trip, phone, contactName, windowOpen, onClose, onSent }: {
  trip: TripContext; phone: string; contactName: string; windowOpen: boolean | null
  onClose: () => void; onSent: () => void
}) {
  const fileLabel = trip.isNumber ?? trip.bookingRef
  const [channel, setChannel] = useState<Channel>('whatsapp')
  const [format, setFormat] = useState<Format>('pdf')
  const [showDrivers, setShowDrivers] = useState(true)
  const [number, setNumber] = useState(phone)
  const [email, setEmail] = useState(trip.guestContact.email ?? '')
  const [note, setNote] = useState(`Movement Chart for your booking ${fileLabel}. Please find the agenda attached.`)
  const [subject, setSubject] = useState(`Tour Confirmation — ${fileLabel}`)
  const [sending, setSending] = useState(false)
  const [previewing, setPreviewing] = useState(false)

  const numbers = useMemo(() => {
    const seen = new Set<string>()
    return [
      { label: 'This chat', value: phone },
      { label: 'Guest',     value: digits(trip.guestContact.whatsapp) },
      { label: 'Guest',     value: digits(trip.guestContact.phone) },
      { label: 'Agent',     value: digits(trip.agentContact.whatsapp) },
      { label: 'Agent',     value: digits(trip.agentContact.phone) },
    ].filter(n => n.value && !seen.has(n.value) && seen.add(n.value))
  }, [phone, trip])

  const emails = useMemo(() => {
    const list = [
      { label: 'Guest', value: trip.guestContact.email },
      { label: 'Agent', value: trip.agentContact.email },
    ]
    return list.filter((e): e is { label: string; value: string } => !!e.value)
  }, [trip])

  const recipient = channel === 'whatsapp' ? digits(number) : email.trim()
  // A template can only carry a PDF, so Word needs an open 24h window.
  const wordBlocked = channel === 'whatsapp' && format === 'word' && recipient === phone && windowOpen === false
  const inactive = INACTIVE_STATUSES.includes(trip.status)

  async function preview() {
    setPreviewing(true)
    // Opened before the wait, or the browser treats it as an unasked-for popup.
    const tab = format === 'pdf' ? window.open('', '_blank') : null
    try {
      const res = await fetch(`/api/bookings/${encodeURIComponent(trip.bookingRef)}/agenda/send`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ mode: 'download', format, showDrivers }),
      })
      if (!res.ok) {
        tab?.close()
        toast.error((await readJson(res)).error ?? 'Could not build the document')
        return
      }
      const url = URL.createObjectURL(await res.blob())
      if (tab) {
        tab.location.href = url
      } else {
        const a = document.createElement('a')
        a.href = url
        a.download = `${trip.bookingRef}-agenda.docx`
        a.click()
      }
      setTimeout(() => URL.revokeObjectURL(url), 120_000)
    } catch {
      tab?.close()
      toast.error('Network problem — could not build the document')
    } finally {
      setPreviewing(false)
    }
  }

  async function send() {
    setSending(true)
    try {
      const res = await fetch(`/api/bookings/${encodeURIComponent(trip.bookingRef)}/agenda/send`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          mode: channel, format, showDrivers, to: recipient, message: note.trim() || undefined,
          ...(channel === 'email' ? { subject: subject.trim() || undefined } : {}),
        }),
      })
      const json = await readJson(res)
      if (!json.success) { toast.error(json.error ?? 'Send failed'); return }
      toast.success(channel === 'whatsapp'
        ? 'Agenda handed to WhatsApp — watch the ticks in the chat'
        : `Agenda emailed to ${recipient}`)
      onSent()
      onClose()
    } catch {
      toast.error('Network problem — the agenda was not sent')
    } finally {
      setSending(false)
    }
  }

  const inputCls = 'w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-[13px] text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-amber-400 focus:ring-4 focus:ring-amber-100'

  return (
    <Dialog
      title="Send agenda"
      subtitle={`${fileLabel} · movement chart`}
      onClose={onClose}
      icon={<span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-amber-400 to-orange-600 text-white shadow-lg shadow-amber-600/25"><FileText className="h-5 w-5" /></span>}
    >
      <Segmented<Channel>
        value={channel}
        onChange={setChannel}
        options={[
          { value: 'whatsapp', label: 'WhatsApp', icon: <MessageCircle className="h-3.5 w-3.5" /> },
          { value: 'email',    label: 'Email',    icon: <Mail className="h-3.5 w-3.5" /> },
        ]}
      />

      <div className="grid grid-cols-2 gap-2.5">
        <div>
          <Label>Format</Label>
          <Segmented<Format>
            value={format}
            onChange={setFormat}
            options={[
              { value: 'pdf',  label: 'PDF',  icon: <FileText className="h-3.5 w-3.5" /> },
              { value: 'word', label: 'Word', icon: <FileType2 className="h-3.5 w-3.5" /> },
            ]}
          />
        </div>
        <div>
          <Label>Drivers</Label>
          <Segmented<'with' | 'without'>
            value={showDrivers ? 'with' : 'without'}
            onChange={v => setShowDrivers(v === 'with')}
            options={[
              { value: 'with',    label: 'With', icon: <CarFront className="h-3.5 w-3.5" /> },
              { value: 'without', label: 'Without' },
            ]}
          />
        </div>
      </div>

      {channel === 'whatsapp' ? (
        <div>
          <Label>Send to</Label>
          <div className="mb-2 flex flex-wrap gap-1.5">
            {numbers.map(n => (
              <button
                key={n.value}
                type="button"
                onClick={() => setNumber(n.value)}
                className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold transition ${digits(number) === n.value ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
              >
                {digits(number) === n.value && <Check className="h-3 w-3" />}
                {n.label} · +{n.value}
              </button>
            ))}
          </div>
          <input value={number} onChange={e => setNumber(e.target.value)} inputMode="tel" placeholder="94771234567" aria-label="WhatsApp number" className={inputCls} />
        </div>
      ) : (
        <div className="space-y-2.5">
          <div>
            <Label>Send to</Label>
            {emails.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-1.5">
                {emails.map(e => (
                  <button
                    key={e.value}
                    type="button"
                    onClick={() => setEmail(e.value)}
                    className={`inline-flex max-w-full items-center gap-1 truncate rounded-full px-2.5 py-1 text-[11px] font-bold transition ${email === e.value ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                  >
                    {e.label} · {e.value}
                  </button>
                ))}
              </div>
            )}
            <input value={email} onChange={e => setEmail(e.target.value)} type="email" placeholder="guest@example.com" aria-label="Email address" className={inputCls} />
          </div>
          <div>
            <Label>Subject</Label>
            <input value={subject} onChange={e => setSubject(e.target.value)} aria-label="Subject" className={inputCls} />
          </div>
        </div>
      )}

      <div>
        <Label>{channel === 'whatsapp' ? 'Your note (optional)' : 'Note added to the email (optional)'}</Label>
        <textarea value={note} onChange={e => setNote(e.target.value)} rows={2} aria-label="Note" className={`${inputCls} resize-none`} />
      </div>

      {channel === 'whatsapp' && format === 'pdf' && (
        <p className="text-[11px] leading-snug text-slate-500">
          Goes out on the approved template <span className="font-mono">aahaas_booking_details</span>, so it doesn&apos;t need the 24-hour window.
        </p>
      )}
      {channel === 'whatsapp' && format === 'word' && (
        <Warning>
          WhatsApp only accepts a Word file inside the 24-hour window.
          {wordBlocked ? ' This chat is outside it, so switch to PDF.' : ' If this number is outside it, the send will be refused.'}
        </Warning>
      )}
      {inactive && <Warning>This booking is {trip.status.toLowerCase().replace(/_/g, ' ')}. Check before sending {contactName} this agenda.</Warning>}

      <div className="flex gap-2">
        <button
          type="button"
          disabled={previewing}
          onClick={preview}
          className="inline-flex items-center gap-1.5 rounded-2xl border border-slate-200 px-3.5 text-[12.5px] font-bold text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"
        >
          {previewing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />}
          {format === 'pdf' ? 'Preview' : 'Download'}
        </button>
        <motion.button
          whileTap={{ scale: 0.98 }}
          disabled={sending || !recipient || wordBlocked}
          onClick={send}
          className="flex min-w-0 flex-1 items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-amber-400 to-orange-500 py-3 text-[13.5px] font-bold text-white shadow-lg shadow-amber-500/30 transition hover:brightness-105 disabled:opacity-50 disabled:shadow-none"
        >
          {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          <span className="truncate">{sending ? 'Building & sending…' : `Send ${format === 'pdf' ? 'PDF' : 'Word'} via ${channel === 'whatsapp' ? 'WhatsApp' : 'email'}`}</span>
        </motion.button>
      </div>
    </Dialog>
  )
}
