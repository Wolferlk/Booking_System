'use client'

/**
 * Talking to the driver, from the row he is on.
 *
 * ---- Why here ----
 *
 * The desk sends a driver his paperwork and then needs one sentence back: "are
 * you at the airport", "the flight is two hours late", "did you get the sheets".
 * Until now that sentence was typed on somebody's personal phone, which means
 * the company has no record of it, the next shift cannot see it, and the driver
 * is answering a number that is not the one the documents came from.
 *
 * So the conversation happens on the ops WhatsApp number, in a dock that opens
 * over the Drive Log without losing the row, the filters or the date the desk
 * spent a minute setting up.
 *
 * ---- The 24-hour window ----
 *
 * WhatsApp only allows free-form messages to someone who has messaged us in the
 * last 24 hours. Outside it Meta accepts the send, answers 200, and delivers
 * nothing — the single most expensive failure mode in this whole feature, and
 * invisible unless someone says so. So the window is shown as a standing state
 * at the top of the dock, and the composer says plainly which of the two things
 * is about to happen: a normal message, or a re-engagement template.
 *
 * ---- Ticks ----
 *
 * Every outbound message carries the last status Meta reported for it: one tick
 * sent, two delivered, two blue read, a red mark for failed. They arrive by
 * webhook minutes later, which is why the dock keeps polling after the desk has
 * stopped typing.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  AlertTriangle, Check, CheckCheck, ExternalLink, FileText, Loader2,
  Maximize2, Minus, Paperclip, Phone, RefreshCw, Send, ShieldAlert, X, Zap,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { normaliseSriLankanPhone } from '@/lib/sl-phone'

interface ChatMessage {
  id: string
  direction: 'outbound' | 'inbound'
  body: string | null
  senderName: string | null
  status: string
  createdAt: string
  mediaUrl?: string | null
  mediaType?: string | null
}

export interface DriverChatTarget {
  bookingRef: string
  title: string
  driverName: string | null
  driverPhone: string | null
  vehicle: string | null
}

/** Poll fast enough to feel live, slow enough not to be a load test. */
const POLL_OPEN = 4000
const POLL_MIN  = 12000

/**
 * The three things the desk types most often.
 *
 * Not a template system — a template system is what this becomes in six months
 * if it earns it. These are three sentences that are typed a dozen times a day,
 * and putting them one click away is the difference between the dock being used
 * and the personal phone being used.
 */
const QUICK: { label: string; text: (t: DriverChatTarget) => string }[] = [
  {
    label: 'Got the documents?',
    text: t => `Hi ${t.driverName || ''}`.trim() +
      `, please confirm you have received the tour documents for ${t.title}.`,
  },
  {
    label: 'Pickup confirmed',
    text: t => `Please confirm your pickup time and location for ${t.title}.`,
  },
  {
    label: 'Call the office',
    text: () => 'Please call the operations desk when you are free.',
  },
]

export function DriverChatDock({
  target, onClose, onOpenDocs,
}: {
  target: DriverChatTarget
  onClose: () => void
  onOpenDocs?: () => void
}) {
  const [minimised, setMinimised] = useState(false)
  const [messages, setMessages]   = useState<ChatMessage[]>([])
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState<string | null>(null)
  const [windowOpen, setWindowOpen] = useState<boolean | null>(null)
  const [draft, setDraft]         = useState('')
  const [sending, setSending]     = useState(false)
  const [attaching, setAttaching] = useState(false)

  const bottomRef = useRef<HTMLDivElement>(null)
  const fileRef   = useRef<HTMLInputElement>(null)
  const seenRef   = useRef(0)

  const reading = useMemo(
    () => normaliseSriLankanPhone(target.driverPhone ?? ''),
    [target.driverPhone],
  )
  const msisdn = reading.ok ? reading.msisdn : ''

  const load = useCallback(async (quiet = false) => {
    if (!msisdn) { setLoading(false); return }
    if (!quiet) setLoading(true)
    try {
      const res  = await fetch(`/api/whatsapp/messages?phone=${encodeURIComponent(msisdn)}`)
      const json = await res.json().catch(() => null)
      if (!res.ok) throw new Error(json?.error ?? 'The conversation could not be read')

      const incoming = (json.data?.messages ?? []) as ChatMessage[]
      setMessages(incoming)
      setWindowOpen(json.data?.windowOpen ?? null)
      setError(null)

      // A reply that lands while the desk is looking elsewhere in the dock is
      // worth a nudge; the first load is not.
      const inbound = incoming.filter(m => m.direction === 'inbound').length
      if (quiet && seenRef.current && inbound > seenRef.current) {
        toast.info(`${target.driverName || 'The driver'} replied`)
      }
      seenRef.current = inbound
    } catch (err) {
      if (!quiet) setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [msisdn, target.driverName])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    if (!msisdn) return
    const id = setInterval(() => void load(true), minimised ? POLL_MIN : POLL_OPEN)
    return () => clearInterval(id)
  }, [load, minimised, msisdn])

  useEffect(() => {
    if (!minimised) bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, minimised])

  const send = async () => {
    const text = draft.trim()
    if (!text || !msisdn || sending) return
    setSending(true)
    try {
      const res = await fetch('/api/whatsapp/send', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ phone: msisdn, message: text }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) throw new Error(json?.error ?? 'The message could not be sent')
      setDraft('')
      await load(true)
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setSending(false)
    }
  }

  const attach = async (file: File) => {
    if (!msisdn) return
    setAttaching(true)
    try {
      const form = new FormData()
      form.append('file', file)
      form.append('phone', msisdn)
      const res  = await fetch('/api/whatsapp/send-media', { method: 'POST', body: form })
      const json = await res.json().catch(() => null)
      if (!res.ok) throw new Error(json?.error ?? 'The attachment could not be sent')
      toast.success(`${file.name} sent`)
      await load(true)
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setAttaching(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  // ── Unusable number: say so, and say what to do about it ──────────────────
  if (!msisdn) {
    return (
      <Shell minimised={false} onClose={onClose} onMinimise={null} target={target} windowOpen={null} onRefresh={null}>
        <div className="px-4 py-6 text-xs text-amber-200 flex items-start gap-2">
          <ShieldAlert className="w-4 h-4 flex-shrink-0 mt-px" />
          <span>
            {target.driverPhone
              ? <>The number on this driver&apos;s record — <span className="font-mono">{target.driverPhone}</span> — cannot be read as a phone number, so no conversation can be opened. {reading.reason}</>
              : <>No driver number is on this file yet. Allocate a driver, or add the number on the driver record, and the conversation opens here.</>}
          </span>
        </div>
      </Shell>
    )
  }

  return (
    <Shell
      minimised={minimised}
      onClose={onClose}
      onMinimise={() => setMinimised(v => !v)}
      onRefresh={() => void load()}
      target={target}
      windowOpen={windowOpen}
      unread={messages.filter(m => m.direction === 'inbound').length}
    >
      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2 min-h-0">
        {loading ? (
          <div className="h-full flex items-center justify-center gap-2 text-slate-500 text-xs">
            <Loader2 className="w-4 h-4 animate-spin" /> Reading the conversation…
          </div>
        ) : error ? (
          <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-[11px] text-rose-200">
            {error}
          </div>
        ) : !messages.length ? (
          <div className="h-full flex flex-col items-center justify-center gap-1.5 text-center px-6">
            <Phone className="w-5 h-5 text-slate-700" />
            <p className="text-xs font-bold text-slate-400">Nothing has been said to this number yet</p>
            <p className="text-[10px] text-slate-600 leading-relaxed">
              The first message opens the thread. Everything sent from here is on the company&apos;s
              WhatsApp number and stays on the file.
            </p>
          </div>
        ) : (
          messages.map(m => <Bubble key={m.id} message={m} />)
        )}
        <div ref={bottomRef} />
      </div>

      {/* Quick replies */}
      <div className="px-3 pb-1.5 flex flex-wrap gap-1">
        {QUICK.map(q => (
          <button
            key={q.label}
            type="button"
            onClick={() => setDraft(q.text(target))}
            className="px-2 py-0.5 rounded-full border border-slate-800 bg-slate-900/60 text-[10px] font-bold text-slate-400 hover:text-slate-100 hover:border-slate-600 transition-colors"
          >
            <Zap className="w-2.5 h-2.5 inline -mt-px mr-0.5" />{q.label}
          </button>
        ))}
        {onOpenDocs ? (
          <button
            type="button"
            onClick={onOpenDocs}
            className="px-2 py-0.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 text-[10px] font-bold text-emerald-300 hover:bg-emerald-500/20 transition-colors"
          >
            <FileText className="w-2.5 h-2.5 inline -mt-px mr-0.5" />Send documents
          </button>
        ) : null}
      </div>

      {/* Composer */}
      <div className="border-t border-slate-800 px-3 py-2.5 space-y-1.5">
        <div className="flex items-end gap-2">
          <input
            ref={fileRef}
            type="file"
            className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) void attach(f) }}
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={attaching}
            title="Send a photo or a document"
            className="p-2 rounded-lg text-slate-500 hover:text-slate-200 hover:bg-slate-800 transition-colors disabled:opacity-40"
          >
            {attaching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Paperclip className="w-4 h-4" />}
          </button>
          <textarea
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send() }
            }}
            rows={1}
            placeholder={`Message ${target.driverName || 'the driver'}…`}
            className="flex-1 resize-none max-h-24 px-3 py-2 rounded-lg bg-slate-950/70 border border-slate-800 text-xs text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-slate-600"
          />
          <button
            type="button"
            onClick={() => void send()}
            disabled={!draft.trim() || sending}
            className="p-2 rounded-lg bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/25 transition-colors disabled:opacity-40"
          >
            {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          </button>
        </div>
        <p className="text-[9.5px] text-slate-600 leading-snug">
          {windowOpen === false
            ? 'Outside the 24-hour window — this goes as the approved re-engagement template, not as plain text.'
            : windowOpen
              ? 'The driver messaged us recently, so this goes as a normal message.'
              : 'Enter sends · Shift+Enter for a new line.'}
        </p>
      </div>
    </Shell>
  )
}

/** The inbox is keyed on the number as WhatsApp holds it, not as it was typed. */
function msisdnOf(raw: string | null): string {
  const read = normaliseSriLankanPhone(raw ?? '')
  return read.ok ? read.msisdn : (raw ?? '')
}

/** The dock itself — header, chrome, and the minimised state. */
function Shell({
  target, windowOpen, minimised, unread, onClose, onMinimise, onRefresh, children,
}: {
  target: DriverChatTarget
  windowOpen: boolean | null
  minimised: boolean
  unread?: number
  onClose: () => void
  onMinimise: (() => void) | null
  onRefresh: (() => void) | null
  children: React.ReactNode
}) {
  return (
    <div
      className={cn(
        'fixed z-[70] right-4 bottom-4 w-[min(94vw,400px)] rounded-2xl bg-[#0c1225] border border-slate-800',
        'shadow-2xl shadow-black/70 overflow-hidden flex flex-col',
        minimised ? 'h-auto' : 'h-[min(78vh,620px)]',
      )}
    >
      <div className="flex items-center gap-2.5 px-3.5 py-2.5 border-b border-slate-800 bg-slate-950/60 flex-shrink-0">
        <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/25 flex items-center justify-center flex-shrink-0">
          <span className="text-[11px] font-black text-emerald-300">
            {(target.driverName ?? '?').trim().charAt(0).toUpperCase() || '?'}
          </span>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-black text-white truncate">
            {target.driverName || 'Driver'}
            {unread ? <span className="ml-1.5 text-[9px] font-bold text-slate-500">{unread} received</span> : null}
          </p>
          <p className="text-[10px] text-slate-500 truncate font-mono">
            {target.driverPhone || 'no number'}
            {target.vehicle ? <span className="font-sans"> · {target.vehicle}</span> : null}
          </p>
        </div>

        {windowOpen !== null ? (
          <span
            title={windowOpen
              ? 'The driver has messaged us in the last 24 hours — free-form messages reach him.'
              : 'The driver has not messaged us in 24 hours. Plain text is accepted by Meta and delivered to nobody, so messages go as an approved template instead.'}
            className={cn(
              'px-1.5 py-0.5 rounded border text-[8.5px] font-black uppercase tracking-wide flex-shrink-0',
              windowOpen
                ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                : 'border-amber-500/30 bg-amber-500/10 text-amber-300',
            )}
          >
            {windowOpen ? 'open' : 'template'}
          </span>
        ) : null}

        {onRefresh ? (
          <button onClick={onRefresh} title="Refresh" className="p-1 text-slate-500 hover:text-slate-200 rounded transition-colors">
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        ) : null}
        <a
          href={`/dashboard/whatsapp?phone=${encodeURIComponent(msisdnOf(target.driverPhone))}`}
          target="_blank"
          rel="noopener noreferrer"
          title="Open the full conversation in the inbox"
          className="p-1 text-slate-500 hover:text-slate-200 rounded transition-colors"
        >
          <ExternalLink className="w-3.5 h-3.5" />
        </a>
        {onMinimise ? (
          <button onClick={onMinimise} title={minimised ? 'Expand' : 'Minimise'} className="p-1 text-slate-500 hover:text-slate-200 rounded transition-colors">
            {minimised ? <Maximize2 className="w-3.5 h-3.5" /> : <Minus className="w-3.5 h-3.5" />}
          </button>
        ) : null}
        <button onClick={onClose} title="Close" className="p-1 text-slate-500 hover:text-white rounded transition-colors">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {minimised ? null : children}
    </div>
  )
}

/** One message, and what WhatsApp last said about it. */
function Bubble({ message }: { message: ChatMessage }) {
  const out = message.direction === 'outbound'
  const time = new Date(message.createdAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })

  // A document sent by the settlement pack carries the tag, and reads far
  // better as "Documents sent" than as the whole template body again.
  const tagged = out && (message.senderName ?? '').startsWith('[DRIVER-DOCS]')

  return (
    <div className={cn('flex', out ? 'justify-end' : 'justify-start')}>
      <div className={cn(
        'max-w-[85%] rounded-2xl px-3 py-2 text-[11px] leading-relaxed',
        out ? 'bg-emerald-500/12 border border-emerald-500/25 text-emerald-50 rounded-br-sm'
            : 'bg-slate-800/70 border border-slate-700/60 text-slate-100 rounded-bl-sm',
      )}>
        {tagged ? (
          <p className="text-[9px] font-black uppercase tracking-wide text-emerald-400/80 mb-1 flex items-center gap-1">
            <FileText className="w-2.5 h-2.5" /> Documents
          </p>
        ) : null}

        {message.mediaUrl ? (
          message.mediaType === 'image' ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={message.mediaUrl} alt="" className="rounded-lg mb-1 max-h-48 object-cover" />
          ) : (
            <a
              href={message.mediaUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 mb-1 underline underline-offset-2 opacity-90 hover:opacity-100"
            >
              <FileText className="w-3 h-3" /> Attachment
            </a>
          )
        ) : null}

        {message.body ? <p className="whitespace-pre-wrap break-words">{message.body}</p> : null}

        <p className={cn('mt-1 flex items-center gap-1 text-[9px]', out ? 'justify-end text-emerald-300/60' : 'text-slate-500')}>
          {time}
          {out ? <Ticks status={message.status} /> : null}
        </p>
      </div>
    </div>
  )
}

/** One tick sent, two delivered, two blue read, a warning for failed. */
function Ticks({ status }: { status: string }) {
  if (status === 'failed')    return <AlertTriangle className="w-2.5 h-2.5 text-rose-400" />
  if (status === 'read')      return <CheckCheck className="w-3 h-3 text-sky-400" />
  if (status === 'delivered') return <CheckCheck className="w-3 h-3" />
  return <Check className="w-3 h-3" />
}
