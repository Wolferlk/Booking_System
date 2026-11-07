'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle, Check, CheckCheck, ChevronLeft, ChevronRight, Clock, Copy, ExternalLink, Eye,
  Loader2, Paperclip, Type,
} from 'lucide-react'
import { toast } from 'sonner'
import Modal from '@/components/ui/modal'
import { parseWaText, stripWaFormatting } from '@/lib/wa-text'

// ─── Types ────────────────────────────────────────────────────────────────────

/** One message in the booking's sequence: portal link, trip day, or feedback form. */
export interface ViewerItem {
  id: string
  query: string          // e.g. "message=briefing&date=2026-11-03"
  chip: string           // short label on the strip
  title: string
  copiedLabel: string
  sent: boolean
}

interface SentCopy {
  id: string
  at: string
  status: string
  phone: string
  body: string | null    // null when the log holds a note, not the message itself
}

interface MessageDetail {
  current: string
  attachments: number
  forwardToOps: boolean
  to: string | null
  changedSinceSent: boolean
  sends: SentCopy[]
}

// ─── Data + clipboard ─────────────────────────────────────────────────────────

async function fetchMessage(bookingRef: string, query: string): Promise<MessageDetail> {
  const res = await fetch(`/api/bookings/${bookingRef}/whatsapp-customer?${query}`).then(r => r.json())
  if (!res.success) throw new Error(res.error ?? 'Could not load the message')
  return res.data as MessageDetail
}

function copyViaTextarea(text: string): void {
  const el = document.createElement('textarea')
  el.value = text
  el.style.position = 'fixed'
  el.style.opacity = '0'
  document.body.appendChild(el)
  el.select()
  const ok = document.execCommand('copy')
  el.remove()
  if (!ok) throw new Error('The browser blocked copying')
}

/**
 * Safari drops the click's permission once a fetch has been awaited, so the
 * clipboard write has to start inside the click and be handed the pending text.
 */
async function copyPending(text: Promise<string>): Promise<void> {
  if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
    const blob = text.then(t => new Blob([t], { type: 'text/plain' }))
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'text/plain': blob })])
      return
    } catch {
      await text   // a failed fetch stops here; a refused write falls through
    }
  }
  const value = await text
  try { await navigator.clipboard.writeText(value) } catch { copyViaTextarea(value) }
}

// ─── Row buttons ──────────────────────────────────────────────────────────────

const ROW_BUTTON =
  'flex items-center gap-1 px-2 py-1.5 rounded-lg border border-slate-200 bg-white text-[11px] font-semibold ' +
  'text-slate-600 hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-700 transition-colors ' +
  'flex-shrink-0 disabled:opacity-50'

/** View + Copy for one message row. Copy always takes the latest version. */
export function MessageRowActions({ bookingRef, item, onView }: {
  bookingRef: string
  item: ViewerItem
  onView: (id: string) => void
}) {
  const [state, setState] = useState<'idle' | 'copying' | 'copied'>('idle')
  const timer = useRef<ReturnType<typeof setTimeout>>()
  useEffect(() => () => clearTimeout(timer.current), [])

  async function copy() {
    setState('copying')
    try {
      await copyPending(fetchMessage(bookingRef, item.query).then(d => d.current))
      toast.success(`${item.copiedLabel} copied`)
      setState('copied')
      timer.current = setTimeout(() => setState('idle'), 1800)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Copy failed')
      setState('idle')
    }
  }

  return (
    <>
      <button type="button" onClick={() => onView(item.id)} className={ROW_BUTTON} title={`View: ${item.title}`}>
        <Eye className="w-3 h-3" /> <span className="hidden sm:inline">View</span>
      </button>
      <button type="button" onClick={copy} disabled={state === 'copying'} className={ROW_BUTTON} title={`Copy: ${item.title}`}>
        {state === 'copying' ? <Loader2 className="w-3 h-3 animate-spin" />
          : state === 'copied' ? <Check className="w-3 h-3 text-emerald-600" />
          : <Copy className="w-3 h-3" />}
        <span className="hidden sm:inline">{state === 'copied' ? 'Copied' : 'Copy'}</span>
      </button>
    </>
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtSent(iso: string) {
  return new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}
function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
}

const STATUS_LABEL: Record<string, string> = {
  sent: 'Sent', delivered: 'Delivered', read: 'Read', failed: 'Failed', retried: 'Failed, retried',
}

function isFailed(status: string) {
  return status === 'failed' || status === 'retried'
}

function StatusTick({ status }: { status: string }) {
  if (isFailed(status)) return <AlertTriangle className="w-3 h-3 text-rose-500" />
  if (status === 'read') return <CheckCheck className="w-3.5 h-3.5 text-sky-500" />
  if (status === 'delivered') return <CheckCheck className="w-3.5 h-3.5 text-slate-400" />
  return <Check className="w-3.5 h-3.5 text-slate-400" />
}

// ─── Bubble ───────────────────────────────────────────────────────────────────

function BubbleLine({ line }: { line: string }) {
  return (
    <>
      {parseWaText(line).map((s, i) => {
        if (s.kind === 'bold') return <strong key={i} className="font-semibold">{s.text}</strong>
        if (s.kind === 'italic') return <em key={i}>{s.text}</em>
        if (s.kind === 'strike') return <s key={i}>{s.text}</s>
        if (s.kind === 'link') {
          return <a key={i} href={s.text} target="_blank" rel="noopener noreferrer" className="text-sky-700 underline break-all">{s.text}</a>
        }
        return <span key={i}>{s.text}</span>
      })}
    </>
  )
}

/** The message as the guest sees it. Lines missing from `compareTo` are tinted. */
function Bubble({ text, compareTo, tint, footer }: {
  text: string
  compareTo: string | null
  tint: string
  footer: React.ReactNode
}) {
  const other = useMemo(() => (compareTo === null ? null : new Set(compareTo.split('\n'))), [compareTo])
  return (
    <div className="relative max-w-[92%] rounded-xl rounded-tr-none bg-[#d9fdd3] px-3 pt-2 pb-1.5 text-[13px] leading-[1.45] text-slate-800 shadow-sm">
      <span aria-hidden className="absolute -right-2 top-0 border-t-[10px] border-l-[10px] border-t-[#d9fdd3] border-l-transparent" />
      {text.split('\n').map((line, i) => (
        <div
          key={i}
          className={`min-h-[1.45em] whitespace-pre-wrap break-words rounded-sm ${
            other && line.trim() && !other.has(line) ? `${tint} -mx-1 px-1` : ''
          }`}
        >
          <BubbleLine line={line} />
        </div>
      ))}
      <div className="mt-0.5 flex items-center justify-end gap-1 text-[10px] text-slate-500">{footer}</div>
    </div>
  )
}

// ─── Viewer ───────────────────────────────────────────────────────────────────

const LATEST = 'latest'

export default function WhatsappMessageViewer({ bookingRef, items, activeId, recipient, onSelect, onClose }: {
  bookingRef: string
  items: ViewerItem[]
  activeId: string
  recipient: string
  onSelect: (id: string) => void
  onClose: () => void
}) {
  const index = Math.max(0, items.findIndex(i => i.id === activeId))
  const item = items[index]
  const prev = items[index - 1]
  const next = items[index + 1]

  const [detail, setDetail] = useState<MessageDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [version, setVersion] = useState(LATEST)
  const [copied, setCopied] = useState<'wa' | 'plain' | null>(null)
  const activeChip = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    let stale = false
    setDetail(null)
    setError(null)
    setVersion(LATEST)
    setCopied(null)
    fetchMessage(bookingRef, item.query)
      .then(d => { if (!stale) setDetail(d) })
      .catch(err => { if (!stale) setError(err instanceof Error ? err.message : 'Could not load the message') })
    return () => { stale = true }
  }, [bookingRef, item.query])

  useEffect(() => { setCopied(null) }, [version])

  useEffect(() => {
    activeChip.current?.scrollIntoView({ block: 'nearest', inline: 'center' })
  }, [activeId])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft' && prev) onSelect(prev.id)
      if (e.key === 'ArrowRight' && next) onSelect(next.id)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [prev, next, onSelect])

  const sentCopy = detail?.sends.find(s => s.id === version) ?? null
  const shownText = sentCopy?.body ?? detail?.current ?? ''
  const lastGood = detail?.sends.find(s => s.body && !isFailed(s.status)) ?? null
  // Compare the two versions only where the plan really moved on.
  const compareTo = !detail?.changedSinceSent ? null
    : sentCopy ? detail.current
    : lastGood?.body ?? null
  const latestFailed = detail?.sends[0] && isFailed(detail.sends[0].status)
  const matchesLastSend = Boolean(detail?.sends.some(s => !isFailed(s.status))) && !detail?.changedSinceSent

  async function copy(mode: 'wa' | 'plain') {
    try {
      await copyPending(Promise.resolve(mode === 'wa' ? shownText : stripWaFormatting(shownText)))
      setCopied(mode)
      toast.success(`${item.copiedLabel} copied${mode === 'plain' ? ' as plain text' : ''}`)
    } catch {
      toast.error('Copy failed')
    }
  }

  const waLink = detail?.to ? `https://wa.me/${detail.to.replace(/\D/g, '')}?text=${encodeURIComponent(shownText)}` : null

  return (
    <Modal
      open
      onClose={onClose}
      size="2xl"
      title={item.title}
      footer={
        <div className="flex w-full flex-wrap items-center gap-2">
          {waLink && (
            <a
              href={waLink}
              target="_blank"
              rel="noopener noreferrer"
              className="mr-auto inline-flex items-center gap-1.5 rounded-lg px-2 py-2 text-xs font-semibold text-emerald-700 hover:bg-emerald-50"
              title="Opens WhatsApp with this text ready. Nothing sends until you press send there."
            >
              <ExternalLink className="w-3.5 h-3.5" /> Open in my WhatsApp
            </a>
          )}
          <button
            type="button"
            onClick={() => copy('plain')}
            disabled={!detail}
            className={`inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 disabled:opacity-40 ${waLink ? '' : 'ml-auto'}`}
            title="Without the * and _ marks, for email or a note"
          >
            {copied === 'plain' ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Type className="w-3.5 h-3.5" />}
            {copied === 'plain' ? 'Copied' : 'Copy plain text'}
          </button>
          <button
            type="button"
            onClick={() => copy('wa')}
            disabled={!detail}
            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-40"
            title="Keeps the bold and italics when pasted into WhatsApp"
          >
            {copied === 'wa' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
            {copied === 'wa' ? 'Copied' : 'Copy for WhatsApp'}
          </button>
        </div>
      }
    >
      {/* Every message on this booking, in the order the guest meets them */}
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => prev && onSelect(prev.id)}
          disabled={!prev}
          aria-label="Previous message"
          className="flex-shrink-0 rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 disabled:opacity-30"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <div className="flex flex-1 gap-1 overflow-x-auto py-0.5 [scrollbar-width:none]">
          {items.map(i => (
            <button
              key={i.id}
              ref={i.id === activeId ? activeChip : undefined}
              type="button"
              onClick={() => onSelect(i.id)}
              title={i.title}
              className={`flex flex-shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                i.id === activeId ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {i.sent && <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />}
              {i.chip}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => next && onSelect(next.id)}
          disabled={!next}
          aria-label="Next message"
          className="flex-shrink-0 rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 disabled:opacity-30"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      {/* Which version is on show */}
      {detail && detail.sends.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <VersionPill active={version === LATEST} onClick={() => setVersion(LATEST)}>Latest version</VersionPill>
          {detail.sends.map(s => (
            <VersionPill
              key={s.id}
              active={version === s.id}
              disabled={s.body === null}
              onClick={() => setVersion(s.id)}
              title={`${STATUS_LABEL[s.status] ?? s.status} · ${s.phone}${s.body === null ? ' · sent as an approved template, shown under Latest version' : ''}`}
            >
              <StatusTick status={s.status} /> {fmtSent(s.at)}
            </VersionPill>
          ))}
        </div>
      )}

      {detail && latestFailed && (
        <Notice tone="rose">
          WhatsApp reports the last send failed, so the guest may not have this message.
        </Notice>
      )}
      {detail?.changedSinceSent && (
        <Notice tone="amber">
          {sentCopy
            ? 'This is the older text. Tinted lines have changed since.'
            : 'The plan changed after the last send. Tinted lines are new, so the guest has not seen them.'}
        </Notice>
      )}
      {detail?.forwardToOps && (
        <Notice tone="amber">
          No guest number on this booking, so this goes to the ops numbers to pass on.
        </Notice>
      )}

      {/* The chat */}
      <div className="mt-3 overflow-hidden rounded-xl border border-slate-200">
        <div className="flex items-center gap-2.5 bg-[#075e54] px-3 py-2 text-white">
          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-white/20 text-[11px] font-bold">
            {recipient.replace(/^(mr|mrs|ms|dr)\.?\s+/i, '').charAt(0).toUpperCase() || 'G'}
          </div>
          <div className="min-w-0">
            <p className="truncate text-xs font-semibold">{recipient}</p>
            <p className="truncate text-[10px] text-white/70">{detail?.to ? `+${detail.to}` : 'No number on this booking'}</p>
          </div>
        </div>
        <div className="flex min-h-[220px] flex-col items-end bg-[#efeae2] px-4 py-3 pr-5">
          {error ? (
            <p className="w-full py-10 text-center text-xs text-rose-600">{error}</p>
          ) : !detail ? (
            <div className="flex w-full justify-center py-16"><Loader2 className="w-5 h-5 animate-spin text-emerald-600" /></div>
          ) : (
            <Bubble
              text={shownText}
              compareTo={compareTo}
              tint={sentCopy ? 'bg-amber-200/70' : 'bg-emerald-300/50'}
              footer={sentCopy ? (
                <><span>{fmtTime(sentCopy.at)}</span><StatusTick status={sentCopy.status} /></>
              ) : (
                <><Clock className="w-3 h-3" /><span>{matchesLastSend ? 'Same as last send' : 'Not sent yet'}</span></>
              )}
            />
          )}
        </div>
      </div>

      {detail && detail.attachments > 0 && (
        <p className="mt-2 flex items-center gap-1.5 text-[11px] text-slate-500">
          <Paperclip className="w-3 h-3" />
          {detail.attachments} ticket file{detail.attachments > 1 ? 's go' : ' goes'} with this message on a normal send. Copy takes the text only.
        </p>
      )}
    </Modal>
  )
}

function VersionPill({ active, disabled, title, onClick, children }: {
  active: boolean
  disabled?: boolean
  title?: string
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-medium transition-colors disabled:cursor-default ${
        active
          ? 'border-emerald-500 bg-emerald-50 text-emerald-800'
          : 'border-slate-200 bg-white text-slate-600 enabled:hover:bg-slate-50'
      }`}
    >
      {children}
    </button>
  )
}

function Notice({ tone, children }: { tone: 'amber' | 'rose'; children: React.ReactNode }) {
  const cls = tone === 'rose' ? 'bg-rose-50 border-rose-200 text-rose-800' : 'bg-amber-50 border-amber-200 text-amber-800'
  return (
    <p className={`mt-2 flex items-start gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] ${cls}`}>
      <AlertTriangle className="mt-px w-3 h-3 flex-shrink-0" /> {children}
    </p>
  )
}

