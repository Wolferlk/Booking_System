'use client'

import { useState, useRef, useEffect, useCallback, useMemo, useLayoutEffect } from 'react'
import {
  MessageCircle, X, Minus, Send, Phone, Edit2, Check, CheckCheck, Clock,
  Loader2, ChevronDown, RefreshCw, ExternalLink, AlertCircle, ArrowDown,
  Search, Maximize2, Minimize2, Zap, Copy, RotateCcw, Ban, Smile,
} from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

interface WaMessage {
  id: string
  direction: 'outbound' | 'inbound'
  body: string | null
  senderName: string | null
  // sent → delivered → read, or failed. 'pending' is queued until the client
  // replies (see /api/bookings/[ref]/whatsapp-queue); 'sent-queued' is a queued
  // send that has since gone out; 'cancelled' is a queued send someone dropped.
  // 'sending' / 'local-failed' exist only client-side, for optimistic bubbles.
  status: string
  createdAt: string
  // This panel is keyed on bookingRef, so a booking messaged from more than one
  // number (an agent's line, or one typed by hand here) mixes those numbers into
  // one stream. Carrying the phone lets us label who each message went to, and
  // point "open full conversation" at the number that's actually active — the
  // global inbox is keyed on phone, so it only ever shows one of them.
  phone?: string | null
  mediaUrl?: string | null
  mediaType?: string | null
}

interface Props {
  bookingRef: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  booking: any
}

type PanelState = 'closed' | 'open' | 'minimized'

const POLL_INTERVAL_OPEN = 3000  // 3 s when panel is open (real-time feel)
const POLL_INTERVAL_MIN  = 8000  // 8 s when minimized
const AT_BOTTOM_PX       = 80    // within this of the bottom counts as "following" the chat
const WINDOW_MS          = 24 * 60 * 60 * 1000
const QUICK_EMOJI        = ['🙏', '👍', '😊', '✅', '🚗', '✈️', '🏨', '📄']

const digits = (s: string | null | undefined) => (s ?? '').replace(/\D/g, '')

// Cheap fingerprint of a thread. A poll that returns the same rows must not
// touch state at all — a fresh array re-renders every bubble and used to yank
// the list back to the bottom every 3 s while someone was reading up.
const fingerprint = (rows: WaMessage[]) => rows.map(m => `${m.id}:${m.status}`).join('|')

function dayLabel(d: Date): string {
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const that  = new Date(d); that.setHours(0, 0, 0, 0)
  const diff  = Math.round((today.getTime() - that.getTime()) / 86_400_000)
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Yesterday'
  if (diff < 7)   return d.toLocaleDateString([], { weekday: 'long' })
  return d.toLocaleDateString([], { day: 'numeric', month: 'short', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' })
}

function relTime(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 5)    return 'just now'
  if (s < 60)   return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  return `${Math.floor(s / 3600)}h ago`
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || 'WA'
}

function Highlight({ text, q }: { text: string; q: string }) {
  if (!q) return <>{text}</>
  const parts = text.split(new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'ig'))
  return (
    <>
      {parts.map((p, i) =>
        p.toLowerCase() === q.toLowerCase()
          ? <mark key={i} className="bg-yellow-200 rounded px-0.5">{p}</mark>
          : <span key={i}>{p}</span>,
      )}
    </>
  )
}

function StatusTick({ status }: { status: string }) {
  switch (status) {
    case 'sending':      return <Loader2 className="w-3 h-3 animate-spin" />
    case 'pending':      return <Clock className="w-3 h-3 text-amber-500" />
    case 'delivered':    return <CheckCheck className="w-3.5 h-3.5 text-slate-400" />
    case 'read':         return <CheckCheck className="w-3.5 h-3.5 text-sky-500" />
    case 'failed':
    case 'local-failed': return <AlertCircle className="w-3 h-3 text-red-500" />
    case 'cancelled':    return <Ban className="w-3 h-3 text-slate-400" />
    default:             return <Check className="w-3.5 h-3.5 text-slate-400" />
  }
}

export default function WhatsAppMiniChat({ bookingRef, booking }: Props) {
  const [panel, setPanel]               = useState<PanelState>('closed')
  const [expanded, setExpanded]         = useState(false)
  const [phone, setPhone]               = useState('')
  const [editingPhone, setEditingPhone] = useState(false)
  const [phoneInput, setPhoneInput]     = useState('')
  const [message, setMessage]           = useState('')
  const [sending, setSending]           = useState(false)
  const [messages, setMessages]         = useState<WaMessage[]>([])
  const [optimistic, setOptimistic]     = useState<WaMessage[]>([])
  const [loaded, setLoaded]             = useState(false)
  const [refreshing, setRefreshing]     = useState(false)
  const [unread, setUnread]             = useState(0)
  const [newBelow, setNewBelow]         = useState(0)
  const [atBottom, setAtBottom]         = useState(true)
  const [lastSync, setLastSync]         = useState<number | null>(null)
  const [syncError, setSyncError]       = useState(false)
  const [now, setNow]                   = useState(() => Date.now())
  const [searchOpen, setSearchOpen]     = useState(false)
  const [query, setQuery]               = useState('')
  const [onlyActive, setOnlyActive]     = useState(false)
  const [tray, setTray]                 = useState<'none' | 'quick' | 'emoji'>('none')

  const listRef       = useRef<HTMLDivElement>(null)
  const inputRef      = useRef<HTMLTextAreaElement>(null)
  const panelRef      = useRef<PanelState>('closed')
  const printRef      = useRef('')
  const inboundRef    = useRef<number | null>(null)
  const atBottomRef   = useRef(true)
  const prevLenRef    = useRef(0)
  const forceScrollRef = useRef(false)
  const inFlightRef   = useRef(false)

  panelRef.current = panel

  const guestName: string = (booking?.passengers ?? [])[0]?.name ?? ''
  const draftKey = `wa-mini-draft:${bookingRef}`

  const resolvedPhone =
    booking?.contactWhatsapp ||
    booking?.contactPhone    ||
    booking?.agentWhatsapp   ||
    booking?.agentPhone      ||
    ''

  // ── derived thread data ────────────────────────────────────────────────
  // Distinct numbers this booking's thread spans, and the one carrying the most
  // recent message (messages arrive oldest-first).
  const threadPhones = useMemo(
    () => Array.from(new Set(messages.map(m => digits(m.phone)).filter(Boolean))),
    [messages],
  )
  const latestPhone = useMemo(
    () => digits([...messages].reverse().find(m => m.phone)?.phone),
    [messages],
  )
  const activeDigits = digits(phone)

  // WhatsApp only delivers free-form text inside 24h of the client's last
  // message. The server makes the real call (it can see replies logged against
  // other bookings too); this is the desk's heads-up before they hit send.
  const lastInboundAt = useMemo(() => {
    const hit = [...messages].reverse().find(m =>
      m.direction === 'inbound' && (!activeDigits || digits(m.phone) === activeDigits),
    )
    return hit ? new Date(hit.createdAt).getTime() : null
  }, [messages, activeDigits])
  const windowLeftMs = lastInboundAt ? lastInboundAt + WINDOW_MS - now : -1
  const windowOpen   = windowLeftMs > 0

  const contactChips = useMemo(() => {
    const chips: { label: string; val: string }[] = []
    const seen = new Set<string>()
    const add = (label: string, val: string | null | undefined) => {
      const d = digits(val)
      if (!d || seen.has(d)) return
      seen.add(d); chips.push({ label, val: val as string })
    }
    add('Client WA', booking?.contactWhatsapp)
    add('Client Ph', booking?.contactPhone)
    add('Agent WA',  booking?.agentWhatsapp)
    add('Agent Ph',  booking?.agentPhone)
    threadPhones.forEach(p => add('In thread', p))
    return chips
  }, [booking, threadPhones])

  const shown = useMemo(() => {
    let rows = [...messages, ...optimistic]
    if (onlyActive && activeDigits) rows = rows.filter(m => !m.phone || digits(m.phone) === activeDigits)
    const q = query.trim().toLowerCase()
    if (q) rows = rows.filter(m => (m.body ?? '').toLowerCase().includes(q) || (m.senderName ?? '').toLowerCase().includes(q))
    return rows
  }, [messages, optimistic, onlyActive, activeDigits, query])

  // ── fetch history ──────────────────────────────────────────────────────
  const fetchMessages = useCallback(async (mode: 'initial' | 'poll' | 'manual' = 'poll') => {
    if (inFlightRef.current && mode === 'poll') return
    inFlightRef.current = true
    if (mode === 'manual') setRefreshing(true)
    try {
      const res  = await fetch(`/api/bookings/${bookingRef}/whatsapp/messages`, { cache: 'no-store' })
      const json = await res.json()
      if (!json.success) throw new Error(json.error ?? 'Failed to load')
      const incoming: WaMessage[] = json.data
      setLastSync(Date.now())
      setSyncError(false)

      const inboundCount = incoming.filter(m => m.direction === 'inbound').length
      if (inboundRef.current !== null && mode === 'poll') {
        const diff = inboundCount - inboundRef.current
        if (diff > 0 && panelRef.current === 'minimized') setUnread(u => u + diff)
      }
      inboundRef.current = inboundCount

      const fp = fingerprint(incoming)
      if (fp !== printRef.current) {
        printRef.current = fp
        setMessages(incoming)
      }
    } catch {
      setSyncError(true)
      if (mode === 'manual') toast.error('Could not refresh WhatsApp messages')
    } finally {
      inFlightRef.current = false
      setLoaded(true)
      if (mode === 'manual') setRefreshing(false)
    }
  }, [bookingRef])

  // ── polling: paused while the tab is hidden, caught up on return ──────
  useEffect(() => {
    if (panel === 'closed') return
    let timer: ReturnType<typeof setTimeout> | null = null
    let stopped = false
    const interval = panel === 'open' ? POLL_INTERVAL_OPEN : POLL_INTERVAL_MIN

    const tick = async () => {
      if (stopped) return
      if (!document.hidden) await fetchMessages('poll')
      if (!stopped) timer = setTimeout(tick, interval)
    }
    const onVisible = () => { if (!document.hidden) fetchMessages('poll') }

    if (inboundRef.current === null) fetchMessages('initial')
    timer = setTimeout(tick, interval)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      stopped = true
      if (timer) clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [panel, fetchMessages])

  // A clock for "synced 4s ago" and the 24h countdown — cheap, and only while visible.
  useEffect(() => {
    if (panel !== 'open') return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [panel])

  // ── drafts survive a reload or a closed panel ─────────────────────────
  useEffect(() => {
    try { setMessage(localStorage.getItem(draftKey) ?? '') } catch { /* storage blocked */ }
  }, [draftKey])
  useEffect(() => {
    try {
      if (message) localStorage.setItem(draftKey, message)
      else localStorage.removeItem(draftKey)
    } catch { /* storage blocked */ }
  }, [draftKey, message])

  // ── auto-grow composer ────────────────────────────────────────────────
  useLayoutEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`
  }, [message, panel])

  // ── scrolling ─────────────────────────────────────────────────────────
  // Only follow the conversation when the reader is already at the bottom (or
  // just sent something). Anyone scrolled up keeps their place and gets a
  // "new messages" pill instead of being dragged down.
  const scrollToBottom = useCallback((smooth: boolean) => {
    const el = listRef.current
    if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' })
    setNewBelow(0)
  }, [])

  function onListScroll() {
    const el = listRef.current
    if (!el) return
    const bottom = el.scrollHeight - el.scrollTop - el.clientHeight < AT_BOTTOM_PX
    atBottomRef.current = bottom
    setAtBottom(bottom)
    if (bottom) setNewBelow(0)
  }

  // A search or number filter changes the list length without anything being
  // new — land at the bottom of the filtered view instead of counting "new".
  useLayoutEffect(() => { forceScrollRef.current = true }, [query, onlyActive])

  useLayoutEffect(() => {
    if (panel !== 'open') return
    const len  = shown.length
    const prev = prevLenRef.current
    prevLenRef.current = len
    if (forceScrollRef.current) {
      forceScrollRef.current = false
      scrollToBottom(false)
    } else if (len > prev) {
      if (atBottomRef.current) scrollToBottom(prev > 0)
      else setNewBelow(n => n + (len - prev))
    }
  }, [shown.length, panel, scrollToBottom])

  // Opening (or expanding) the panel lands at the latest message, instantly.
  useLayoutEffect(() => {
    if (panel === 'open') {
      atBottomRef.current = true
      setAtBottom(true)
      scrollToBottom(false)
    }
  }, [panel, expanded, loaded, scrollToBottom])

  // ── open panel ────────────────────────────────────────────────────────
  function open() {
    setPanel('open')
    setUnread(0)
    if (!phone) {
      setPhone(resolvedPhone)
      if (!resolvedPhone) { setPhoneInput(''); setEditingPhone(true) }
    }
  }

  // ── send ──────────────────────────────────────────────────────────────
  async function send(textOverride?: string, retryId?: string) {
    const target = phone.trim()
    const text   = (textOverride ?? message).trim()
    if (!target) { toast.error('Enter a phone number'); setEditingPhone(true); return }
    if (!text)   { toast.error('Enter a message'); return }
    if (digits(target).length < 8) { toast.error('That phone number looks too short'); return }

    const tempId = retryId ?? `tmp-${Date.now()}`
    const bubble: WaMessage = {
      id: tempId, direction: 'outbound', body: text, senderName: 'You',
      status: 'sending', createdAt: new Date().toISOString(), phone: digits(target),
    }
    setOptimistic(o => [...o.filter(m => m.id !== tempId), bubble])
    forceScrollRef.current = true
    if (!textOverride) setMessage('')
    setTray('none')
    setSending(true)

    try {
      const res  = await fetch(`/api/bookings/${bookingRef}/whatsapp`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to:        digits(target),
          name:      guestName || 'Guest',
          message:   text,
          attachPdf: false,
        }),
      })
      const json = await res.json().catch(() => ({ success: false, error: `Send failed (HTTP ${res.status})` }))
      if (!json.success) throw new Error(json.error)
      if (json.data?.queued) toast.info(json.message ?? 'Queued until the client replies', { duration: 8000 })
      else toast.success('Sent')
      setOptimistic(o => o.filter(m => m.id !== tempId))
      forceScrollRef.current = true
      await fetchMessages('manual')
    } catch (err) {
      setOptimistic(o => o.map(m => m.id === tempId ? { ...m, status: 'local-failed' } : m))
      toast.error(err instanceof Error ? err.message : 'Send failed')
    } finally {
      setSending(false)
      inputRef.current?.focus()
    }
  }

  async function cancelQueued(id: string) {
    try {
      const res  = await fetch(`/api/bookings/${bookingRef}/whatsapp-queue?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      toast.success('Queued message cancelled')
      await fetchMessages('manual')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not cancel')
    }
  }

  function copy(text: string) {
    navigator.clipboard?.writeText(text).then(
      () => toast.success('Copied'),
      () => toast.error('Copy failed'),
    )
  }

  function confirmPhone() {
    const v = phoneInput.trim()
    if (v && digits(v).length < 8) { toast.error('That phone number looks too short'); return }
    if (v) setPhone(v)
    setEditingPhone(false)
  }

  function insertAtCursor(text: string) {
    const el = inputRef.current
    if (!el) { setMessage(m => m + text); return }
    const start = el.selectionStart ?? message.length
    const end   = el.selectionEnd ?? message.length
    const next  = message.slice(0, start) + text + message.slice(end)
    setMessage(next)
    requestAnimationFrame(() => {
      el.focus()
      el.selectionStart = el.selectionEnd = start + text.length
    })
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      if (!sending) send()
    }
  }

  function handlePanelKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key !== 'Escape') return
    if (tray !== 'none')   { setTray('none'); return }
    if (searchOpen)        { setSearchOpen(false); setQuery(''); return }
    setPanel('minimized')
  }

  // ── quick replies, filled from the booking ────────────────────────────
  const quickReplies = useMemo(() => {
    const first   = guestName.split(/\s+/)[0] || 'there'
    const arrival = booking?.arrivalDate
      ? new Date(booking.arrivalDate).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' })
      : null
    return [
      { label: 'Greeting',       text: `Hi ${first}, this is the operations team regarding your booking ${bookingRef}. ` },
      { label: 'Acknowledge',    text: 'Thank you for your message. We have noted this and will get back to you shortly.' },
      { label: 'Flight details', text: 'Could you please share your flight number and arrival time so we can arrange your airport pickup?' },
      { label: 'Pickup time',    text: 'Could you please confirm your preferred pickup time from the hotel?' },
      ...(arrival ? [{ label: 'Driver details', text: `Your driver's details will be shared with you before your arrival on ${arrival}.` }] : []),
      { label: 'Passport copy',  text: 'Could you please send us a clear copy of the passport(s) for all travellers?' },
      { label: 'All set',        text: `Everything is confirmed for booking ${bookingRef}. Have a wonderful trip! 🙏` },
    ]
  }, [guestName, booking?.arrivalDate, bookingRef])

  // ── FAB ───────────────────────────────────────────────────────────────
  const fab = (
    <button
      onClick={() => {
        if (panel === 'closed')         open()
        else if (panel === 'minimized') { setUnread(0); setPanel('open') }
        else setPanel('minimized')
      }}
      className="group w-14 h-14 rounded-full bg-gradient-to-br from-emerald-400 to-green-600 hover:from-emerald-500 hover:to-green-700 shadow-xl shadow-green-600/30 flex items-center justify-center transition-all active:scale-95 relative"
      title="WhatsApp chat"
    >
      {panel === 'open'
        ? <ChevronDown className="w-7 h-7 text-white" />
        : <MessageCircle className="w-7 h-7 text-white transition-transform group-hover:scale-110" />}
      {panel !== 'open' && unread > 0 && (
        <>
          <span className="absolute inset-0 rounded-full bg-green-400 animate-ping opacity-40" />
          <span className="absolute -top-1 -right-1 min-w-[20px] h-[20px] bg-red-500 ring-2 ring-white rounded-full text-[10px] text-white flex items-center justify-center font-bold px-1">
            {unread}
          </span>
        </>
      )}
    </button>
  )

  const syncLabel = syncError
    ? 'Offline — retrying'
    : lastSync ? `Synced ${relTime(now - lastSync)}` : 'Connecting…'

  // Slot 2 of the shared bottom-right launcher lane (see ops-ai.tsx): same
  // right edge as the chat dock and OPS_AI, stacked above both. The panel
  // opens upwards from the button, so it is capped to the space left above it.
  return (
    <div className="fixed bottom-[156px] right-5 z-[102] flex flex-col items-end gap-3">

      {/* ── Full chat panel ─────────────────────────────────────────── */}
      {panel === 'open' && (
        <div
          onKeyDown={handlePanelKeyDown}
          className={cn(
            'bg-white rounded-2xl shadow-2xl ring-1 ring-black/5 flex flex-col overflow-hidden transition-[width,height] duration-200',
            expanded ? 'w-[min(480px,calc(100vw-40px))]' : 'w-[min(360px,calc(100vw-40px))]',
          )}
          style={{ height: expanded ? 'min(720px, calc(100vh - 200px))' : 'min(540px, calc(100vh - 240px))' }}
        >

          {/* Header */}
          <div className="flex items-center gap-2.5 px-3 py-2.5 bg-gradient-to-r from-green-700 via-green-600 to-emerald-500 text-white flex-shrink-0">
            <div className="relative w-9 h-9 rounded-full bg-white/20 ring-2 ring-white/30 flex items-center justify-center flex-shrink-0 text-xs font-bold">
              {guestName ? initials(guestName) : <MessageCircle className="w-4 h-4" />}
              <span className={cn(
                'absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full ring-2 ring-green-600',
                syncError ? 'bg-red-400' : 'bg-lime-300',
              )} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold leading-tight truncate">{guestName || 'WhatsApp'}</p>
              <p className="text-[10.5px] text-green-100 truncate">
                <span className="font-mono">{bookingRef}</span>
                <span className="mx-1 opacity-60">·</span>
                <span className={cn(syncError && 'text-red-100')}>{syncLabel}</span>
              </p>
            </div>
            <div className="flex items-center gap-0.5">
              <button
                onClick={() => { setSearchOpen(s => !s); if (searchOpen) setQuery('') }}
                className={cn('p-1.5 rounded-lg transition-colors', searchOpen ? 'bg-white/25' : 'hover:bg-white/20')}
                title="Search messages"
              >
                <Search className="w-3.5 h-3.5" />
              </button>
              {(latestPhone || activeDigits) && (
                <a
                  // Open the thread that's actually active, not necessarily the
                  // booking's stored contact — otherwise this lands on an empty
                  // thread whenever the conversation ran on a second number.
                  href={`/dashboard/whatsapp?phone=${encodeURIComponent(latestPhone || activeDigits)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-1.5 hover:bg-white/20 rounded-lg transition-colors"
                  title="Open full conversation"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              )}
              <button
                onClick={() => fetchMessages('manual')}
                className="p-1.5 hover:bg-white/20 rounded-lg transition-colors"
                title="Refresh"
              >
                <RefreshCw className={cn('w-3.5 h-3.5', refreshing && 'animate-spin')} />
              </button>
              <button
                onClick={() => setExpanded(x => !x)}
                className="p-1.5 hover:bg-white/20 rounded-lg transition-colors"
                title={expanded ? 'Compact' : 'Expand'}
              >
                {expanded ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
              </button>
              <button onClick={() => setPanel('minimized')} className="p-1.5 hover:bg-white/20 rounded-lg" title="Minimize (Esc)">
                <Minus className="w-4 h-4" />
              </button>
              <button onClick={() => setPanel('closed')} className="p-1.5 hover:bg-white/20 rounded-lg" title="Close">
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Search */}
          {searchOpen && (
            <div className="px-3 py-1.5 bg-white border-b border-slate-100 flex items-center gap-2 flex-shrink-0">
              <Search className="w-3.5 h-3.5 text-slate-400" />
              <input
                autoFocus
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Search this conversation…"
                className="flex-1 text-xs py-1 focus:outline-none"
              />
              {query && (
                <span className="text-[10px] text-slate-400">{shown.filter(m => !m.id.startsWith('tmp-')).length} found</span>
              )}
            </div>
          )}

          {/* Recipient */}
          <div className="px-3 py-2 bg-slate-50 border-b border-slate-100 flex-shrink-0 space-y-1.5">
            {editingPhone ? (
              <div className="flex items-center gap-2">
                <Phone className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                <input
                  autoFocus
                  type="tel"
                  className="flex-1 text-xs border border-slate-300 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-green-400/60 font-mono"
                  placeholder="Country code + number, e.g. 94771234567"
                  value={phoneInput}
                  onChange={e => setPhoneInput(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') confirmPhone()
                    if (e.key === 'Escape' && phone) { e.stopPropagation(); setEditingPhone(false) }
                  }}
                />
                <button onClick={confirmPhone} className="p-1 rounded-md text-green-600 hover:bg-green-100 flex-shrink-0" title="Use this number">
                  <Check className="w-4 h-4" />
                </button>
                {phone && (
                  <button onClick={() => setEditingPhone(false)} className="p-1 rounded-md text-slate-400 hover:bg-slate-200 flex-shrink-0" title="Cancel">
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <Phone className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                <span className="flex-1 text-xs text-slate-700 font-mono truncate">
                  {phone ? `+${activeDigits}` : <span className="text-slate-400 font-sans">No number — click edit</span>}
                </span>
                {phone && (
                  <span
                    className={cn(
                      'text-[10px] px-1.5 py-0.5 rounded-full font-medium whitespace-nowrap',
                      windowOpen ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700',
                    )}
                    title={windowOpen
                      ? 'The client messaged within the last 24 hours, so free-form text should deliver straight away.'
                      : 'No client reply in the last 24 hours on this thread. Sending will deliver the approved reply-request template and queue your text until they answer.'}
                  >
                    {windowOpen ? `24h window · ${Math.max(1, Math.ceil(windowLeftMs / 3_600_000))}h left` : 'Window closed'}
                  </span>
                )}
                <button
                  onClick={() => { setPhoneInput(phone); setEditingPhone(true) }}
                  className="p-1 rounded-md text-slate-400 hover:text-green-600 hover:bg-green-50 flex-shrink-0"
                  title="Change number"
                >
                  <Edit2 className="w-3 h-3" />
                </button>
              </div>
            )}

            {/* Quick-pick chips */}
            {!editingPhone && contactChips.length > 0 && (
              <div className="flex flex-wrap items-center gap-1">
                {contactChips.map(x => (
                  <button
                    key={x.label + x.val}
                    onClick={() => setPhone(x.val)}
                    className={cn(
                      'text-[10px] px-1.5 py-0.5 rounded-full border transition-colors',
                      digits(phone) === digits(x.val)
                        ? 'bg-green-100 border-green-400 text-green-700 font-semibold'
                        : 'bg-white border-slate-200 text-slate-500 hover:border-green-300 hover:text-green-700',
                    )}
                    title={`+${digits(x.val)}`}
                  >
                    {x.label} ···{digits(x.val).slice(-4)}
                  </button>
                ))}
                {threadPhones.length > 1 && activeDigits && (
                  <button
                    onClick={() => setOnlyActive(v => !v)}
                    className={cn(
                      'ml-auto text-[10px] px-1.5 py-0.5 rounded-full border transition-colors',
                      onlyActive ? 'bg-slate-700 border-slate-700 text-white' : 'bg-white border-slate-200 text-slate-500 hover:border-slate-400',
                    )}
                    title="Show only messages with the selected number"
                  >
                    {onlyActive ? 'This number' : 'All numbers'}
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Message list */}
          <div className="relative flex-1 min-h-0">
            <div
              ref={listRef}
              onScroll={onListScroll}
              className="h-full overflow-y-auto overscroll-contain px-3 py-3 bg-[#efeae2]"
              style={{
                backgroundImage: 'radial-gradient(rgba(0,0,0,0.035) 1px, transparent 1px)',
                backgroundSize: '14px 14px',
              }}
            >
              {!loaded && (
                <div className="space-y-2 animate-pulse">
                  {[60, 45, 70, 40].map((w, i) => (
                    <div key={i} className={cn('flex', i % 2 ? 'justify-end' : 'justify-start')}>
                      <div className="h-9 rounded-2xl bg-white/70" style={{ width: `${w}%` }} />
                    </div>
                  ))}
                </div>
              )}

              {loaded && shown.length === 0 && (
                <div className="flex flex-col items-center justify-center h-full text-center text-slate-500 py-8">
                  <div className="w-14 h-14 rounded-full bg-white/80 flex items-center justify-center mb-3 shadow-sm">
                    {query ? <Search className="w-6 h-6 text-slate-400" /> : <MessageCircle className="w-7 h-7 text-green-500" />}
                  </div>
                  <p className="text-xs font-medium">{query ? 'No messages match your search.' : 'No messages yet.'}</p>
                  {!query && (
                    <p className="text-[11px] mt-0.5 text-slate-400">
                      Pick a quick reply <Zap className="inline w-3 h-3 -mt-0.5" /> or type below to start.
                    </p>
                  )}
                </div>
              )}

              {shown.map((msg, i) => {
                const prev    = shown[i - 1]
                const at      = new Date(msg.createdAt)
                const newDay  = !prev || new Date(prev.createdAt).toDateString() !== at.toDateString()
                const grouped = !newDay && prev && prev.direction === msg.direction && prev.senderName === msg.senderName
                  && at.getTime() - new Date(prev.createdAt).getTime() < 5 * 60_000
                const isOut   = msg.direction === 'outbound'
                const time    = at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                const failed  = msg.status === 'failed' || msg.status === 'local-failed'
                const muted   = msg.status === 'cancelled'

                return (
                  <div key={msg.id}>
                    {newDay && (
                      <div className="flex justify-center my-2 sticky top-0 z-10">
                        <span className="text-[10px] font-medium text-slate-600 bg-white/90 backdrop-blur px-2.5 py-0.5 rounded-full shadow-sm">
                          {dayLabel(at)}
                        </span>
                      </div>
                    )}
                    <div className={cn('group flex items-end gap-1', isOut ? 'justify-end' : 'justify-start', grouped ? 'mt-0.5' : 'mt-2')}>
                      {isOut && msg.body && !msg.id.startsWith('tmp-') && (
                        <button
                          onClick={() => copy(msg.body!)}
                          className="opacity-0 group-hover:opacity-100 p-1 rounded-full text-slate-400 hover:text-slate-600 hover:bg-white/70 transition-opacity"
                          title="Copy"
                        >
                          <Copy className="w-3 h-3" />
                        </button>
                      )}
                      <div
                        className={cn(
                          'max-w-[80%] rounded-2xl px-3 py-1.5 shadow-sm',
                          isOut ? 'bg-[#d9fdd3]' : 'bg-white',
                          !grouped && (isOut ? 'rounded-tr-sm' : 'rounded-tl-sm'),
                          failed && 'ring-1 ring-red-300 bg-red-50',
                          muted && 'opacity-60',
                          msg.status === 'sending' && 'opacity-75',
                        )}
                      >
                        {msg.senderName && !grouped && (
                          <p className={cn('text-[10px] font-semibold mb-0.5', isOut ? 'text-green-700' : 'text-sky-700')}>
                            {msg.senderName}
                          </p>
                        )}
                        {msg.mediaUrl && msg.mediaType === 'image' && (
                          <a href={msg.mediaUrl} target="_blank" rel="noopener noreferrer">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={msg.mediaUrl} alt="Attachment" loading="lazy" className="mb-1 max-h-48 rounded-lg object-cover" />
                          </a>
                        )}
                        {msg.mediaUrl && msg.mediaType !== 'image' && (
                          <a href={msg.mediaUrl} target="_blank" rel="noopener noreferrer"
                             className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-sky-700 bg-black/5 rounded-lg px-2 py-1.5 hover:bg-black/10">
                            📎 View attachment
                          </a>
                        )}
                        {msg.body && (
                          <p className={cn('text-xs text-slate-800 whitespace-pre-wrap break-words leading-relaxed', muted && 'line-through')}>
                            <Highlight text={msg.body} q={query.trim()} />
                          </p>
                        )}
                        <div className="flex items-center justify-end gap-1 mt-0.5 text-[10px] text-slate-500">
                          {threadPhones.length > 1 && msg.phone && (
                            <span className="font-mono opacity-70">+{digits(msg.phone)}</span>
                          )}
                          <span>{time}</span>
                          {isOut && <StatusTick status={msg.status} />}
                        </div>

                        {msg.status === 'pending' && (
                          <div className="mt-1 pt-1 border-t border-amber-200/70 flex items-center gap-2 text-[10px] text-amber-700">
                            <span className="flex-1">Queued · goes out when the client replies</span>
                            <button onClick={() => cancelQueued(msg.id)} className="font-semibold hover:underline">Cancel</button>
                          </div>
                        )}
                        {failed && msg.body && (
                          <div className="mt-1 pt-1 border-t border-red-200 flex items-center gap-2 text-[10px] text-red-600">
                            <span className="flex-1">Not delivered</span>
                            <button
                              onClick={() => send(msg.body!, msg.id.startsWith('tmp-') ? msg.id : undefined)}
                              disabled={sending}
                              className="flex items-center gap-0.5 font-semibold hover:underline disabled:opacity-50"
                            >
                              <RotateCcw className="w-3 h-3" /> Retry
                            </button>
                            {msg.id.startsWith('tmp-') && (
                              <button
                                onClick={() => setOptimistic(o => o.filter(m => m.id !== msg.id))}
                                className="hover:underline"
                              >
                                Dismiss
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                      {!isOut && msg.body && (
                        <button
                          onClick={() => copy(msg.body!)}
                          className="opacity-0 group-hover:opacity-100 p-1 rounded-full text-slate-400 hover:text-slate-600 hover:bg-white/70 transition-opacity"
                          title="Copy"
                        >
                          <Copy className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Jump-to-latest — shown when the reader has scrolled up */}
            {!atBottom && (
              <button
                onClick={() => scrollToBottom(true)}
                className="absolute bottom-3 right-3 flex items-center gap-1 h-8 pl-2 pr-2.5 rounded-full bg-white text-slate-600 shadow-lg ring-1 ring-black/5 hover:bg-slate-50 text-[11px] font-medium"
                title="Jump to latest"
              >
                <ArrowDown className="w-3.5 h-3.5" />
                {newBelow > 0 && (
                  <span className="bg-green-500 text-white rounded-full px-1.5 leading-4">{newBelow} new</span>
                )}
              </button>
            )}
          </div>

          {/* Trays */}
          {tray === 'quick' && (
            <div className="flex-shrink-0 max-h-40 overflow-y-auto bg-white border-t border-slate-100 p-2 grid grid-cols-1 gap-1">
              {quickReplies.map(q => (
                <button
                  key={q.label}
                  onClick={() => { setMessage(m => (m ? m.trimEnd() + ' ' : '') + q.text); setTray('none'); inputRef.current?.focus() }}
                  className="text-left px-2 py-1.5 rounded-lg hover:bg-green-50 group"
                >
                  <span className="block text-[10.5px] font-semibold text-green-700">{q.label}</span>
                  <span className="block text-[11px] text-slate-500 truncate group-hover:text-slate-700">{q.text}</span>
                </button>
              ))}
            </div>
          )}
          {tray === 'emoji' && (
            <div className="flex-shrink-0 bg-white border-t border-slate-100 px-2 py-1.5 flex flex-wrap gap-1">
              {QUICK_EMOJI.map(em => (
                <button key={em} onClick={() => insertAtCursor(em)} className="w-8 h-8 rounded-lg hover:bg-slate-100 text-lg leading-none">
                  {em}
                </button>
              ))}
            </div>
          )}

          {/* Composer */}
          <div className="flex-shrink-0 bg-white border-t border-slate-100 px-2.5 pt-2 pb-1.5">
            <div className="flex items-end gap-1.5">
              <div className="flex-1 flex items-end bg-slate-50 rounded-2xl border border-slate-200 focus-within:ring-2 focus-within:ring-green-400/50 focus-within:border-green-300 transition-shadow">
                <button
                  onClick={() => setTray(t => t === 'emoji' ? 'none' : 'emoji')}
                  className={cn('p-2 rounded-full transition-colors', tray === 'emoji' ? 'text-green-600' : 'text-slate-400 hover:text-slate-600')}
                  title="Emoji"
                >
                  <Smile className="w-4 h-4" />
                </button>
                <textarea
                  ref={inputRef}
                  className="flex-1 resize-none text-xs text-slate-800 bg-transparent py-2 focus:outline-none placeholder-slate-400 leading-relaxed"
                  rows={1}
                  placeholder={phone ? 'Type a message…' : 'Set a number above first'}
                  value={message}
                  onChange={e => setMessage(e.target.value)}
                  onKeyDown={handleKeyDown}
                />
                <button
                  onClick={() => setTray(t => t === 'quick' ? 'none' : 'quick')}
                  className={cn('p-2 rounded-full transition-colors', tray === 'quick' ? 'text-green-600' : 'text-slate-400 hover:text-slate-600')}
                  title="Quick replies"
                >
                  <Zap className="w-4 h-4" />
                </button>
              </div>
              <button
                onClick={() => send()}
                disabled={sending || !phone.trim() || !message.trim()}
                className="w-10 h-10 rounded-full bg-gradient-to-br from-emerald-400 to-green-600 hover:from-emerald-500 hover:to-green-700 disabled:from-slate-300 disabled:to-slate-300 disabled:cursor-not-allowed flex items-center justify-center flex-shrink-0 transition-all active:scale-95 shadow-md shadow-green-600/20"
                title="Send (Ctrl/⌘ + Enter)"
              >
                {sending
                  ? <Loader2 className="w-4 h-4 text-white animate-spin" />
                  : <Send className="w-4 h-4 text-white -ml-0.5" />}
              </button>
            </div>
            <div className="flex items-center justify-between mt-1 px-1 text-[10px] text-slate-400">
              <span>
                <kbd className="font-sans px-1 rounded bg-slate-100 border border-slate-200">Ctrl/⌘</kbd>+<kbd className="font-sans px-1 rounded bg-slate-100 border border-slate-200">Enter</kbd> to send
                <span className="mx-1">·</span>PDFs: use the <strong>WhatsApp</strong> button above
              </span>
              {message.length > 0 && (
                <span className={cn(message.length > 4096 && 'text-red-500 font-semibold')}>{message.length}</span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Minimized bar ───────────────────────────────────────────── */}
      {panel === 'minimized' && (
        <div
          onClick={() => { setUnread(0); setPanel('open') }}
          className="flex items-center gap-2 pl-2 pr-3 py-2 bg-gradient-to-r from-green-700 to-emerald-500 text-white rounded-full shadow-lg cursor-pointer hover:brightness-110 transition select-none"
        >
          <span className="w-7 h-7 rounded-full bg-white/20 flex items-center justify-center text-[10px] font-bold">
            {guestName ? initials(guestName) : <MessageCircle className="w-3.5 h-3.5" />}
          </span>
          <span className="text-sm font-medium max-w-[180px] truncate">{guestName || 'WhatsApp'} · {bookingRef}</span>
          {unread > 0 && (
            <span className="bg-red-500 text-white text-[10px] font-bold rounded-full px-1.5 py-0.5 leading-none">
              {unread} new
            </span>
          )}
          <button
            onClick={e => { e.stopPropagation(); setPanel('closed') }}
            className="p-0.5 rounded-full hover:bg-white/20"
            title="Close"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {fab}
    </div>
  )
}
