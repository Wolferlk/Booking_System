'use client'

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import {
  ArrowLeft, Search, Send, Paperclip, Loader2, MessageCircle,
  ExternalLink, X, RefreshCw, FileText, MessageSquarePlus,
} from 'lucide-react'
import { toast } from 'sonner'
import { STATUS_LABELS, STATUS_COLORS } from '@/lib/state-machine'
import type { BookingStatus, OperationCountry } from '@prisma/client'

// ─── Types ──────────────────────────────────────────────────────────────────

interface ConversationBooking {
  bookingRef: string
  status: BookingStatus
  operationCountry: OperationCountry | null
}

interface Conversation {
  phone: string
  displayName: string | null
  snippet: string
  direction: 'inbound' | 'outbound'
  updatedAt: string
  unreadCount: number
  booking: ConversationBooking | null
}

interface WaMessage {
  id: string
  direction: 'inbound' | 'outbound'
  body: string | null
  senderName: string | null
  status: string
  createdAt: string
  mediaUrl: string | null
  mediaType: string | null
}

interface ThreadBooking extends ConversationBooking {
  leadName: string | null
  arrivalDate: string
  departureDate: string
}

const CONV_POLL_MS = 8000
const THREAD_POLL_MS = 6000
const AVATAR_COLORS = ['#0a7d4d', '#2563eb', '#7c3aed', '#c8102e', '#b45309', '#0891b2', '#be185d', '#4f46e5']

function avatarColor(seed: string) {
  let h = 0
  for (let i = 0; i < seed.length; i += 1) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  return AVATAR_COLORS[h % AVATAR_COLORS.length]
}
function initials(name: string | null, phone: string) {
  const n = (name ?? '').trim()
  if (n) return n.split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase()
  return phone.slice(-2)
}
function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}
function fmtDayKey(iso: string) {
  return new Date(iso).toLocaleDateString('en-CA')
}
function fmtDayLabel(iso: string) {
  const d = new Date(iso)
  const now = new Date()
  if (fmtDayKey(iso) === fmtDayKey(now.toISOString())) return 'Today'
  const y = new Date(now); y.setDate(now.getDate() - 1)
  if (fmtDayKey(iso) === fmtDayKey(y.toISOString())) return 'Yesterday'
  return d.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' })
}
function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

export default function WhatsAppInboxPage() {
  return (
    <Suspense fallback={<div className="flex h-screen items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-emerald-500" /></div>}>
      <WhatsAppInboxInner />
    </Suspense>
  )
}

function WhatsAppInboxInner() {
  const searchParams = useSearchParams()

  const [conversations, setConversations] = useState<Conversation[]>([])
  const [convLoading, setConvLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<string | null>(null)

  const [messages, setMessages] = useState<WaMessage[]>([])
  const [threadBooking, setThreadBooking] = useState<ThreadBooking | null>(null)
  const [threadLoading, setThreadLoading] = useState(false)

  const [draft, setDraft] = useState('')
  const [attachment, setAttachment] = useState<File | null>(null)
  const [sending, setSending] = useState(false)

  const [newChatOpen, setNewChatOpen] = useState(false)
  const [newChatPhone, setNewChatPhone] = useState('')

  const boxRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const selectedRef = useRef<string | null>(null)
  const consumedParam = useRef(false)

  useEffect(() => { selectedRef.current = selected }, [selected])

  // ── conversation list ────────────────────────────────────────────────────
  const loadConversations = useCallback(async (opts: { showLoader?: boolean } = {}) => {
    if (opts.showLoader) setConvLoading(true)
    try {
      const qs = search.trim() ? `?search=${encodeURIComponent(search.trim())}` : ''
      const res = await fetch(`/api/whatsapp/conversations${qs}`).then(r => r.json())
      if (res.success) setConversations(res.data)
    } catch { /* keep last known list on transient failure */ } finally {
      if (opts.showLoader) setConvLoading(false)
    }
  }, [search])

  useEffect(() => {
    const t = setTimeout(() => loadConversations({ showLoader: true }), 200)
    return () => clearTimeout(t)
  }, [loadConversations])

  useEffect(() => {
    const id = setInterval(() => loadConversations(), CONV_POLL_MS)
    return () => clearInterval(id)
  }, [loadConversations])

  // ── thread ────────────────────────────────────────────────────────────────
  const loadMessages = useCallback(async (phone: string, opts: { showLoader?: boolean } = {}) => {
    if (opts.showLoader) setThreadLoading(true)
    try {
      const res = await fetch(`/api/whatsapp/messages?phone=${encodeURIComponent(phone)}`).then(r => r.json())
      if (res.success && selectedRef.current === phone) {
        setMessages(res.data.messages)
        setThreadBooking(res.data.booking)
      }
    } catch {
      if (opts.showLoader) toast.error("Couldn't load this conversation")
    } finally {
      if (opts.showLoader) setThreadLoading(false)
    }
  }, [])

  function openConversation(phone: string) {
    setSelected(phone)
    setMessages([])
    setThreadBooking(null)
    setDraft('')
    setAttachment(null)
    loadMessages(phone, { showLoader: true })
    setConversations(cs => cs.map(c => (c.phone === phone ? { ...c, unreadCount: 0 } : c)))
  }

  // New contact: no message row exists for this phone yet, so it won't be in
  // `conversations` (that list is just a group-by over existing messages) —
  // opening it is enough; it appears in the list once the first message sends.
  function startNewChat() {
    const phone = newChatPhone.replace(/\D/g, '')
    if (phone.length < 7) { toast.error('Enter a valid WhatsApp number with country code'); return }
    setNewChatOpen(false)
    setNewChatPhone('')
    openConversation(phone)
  }

  // Auto-open a conversation passed in via ?phone= (e.g. from a booking's mini-chat)
  useEffect(() => {
    if (consumedParam.current) return
    const phone = searchParams.get('phone')
    if (phone) { consumedParam.current = true; openConversation(phone.replace(/\D/g, '')) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams])

  useEffect(() => {
    if (!selected) return
    const id = setInterval(() => loadMessages(selected), THREAD_POLL_MS)
    return () => clearInterval(id)
  }, [selected, loadMessages])

  useEffect(() => {
    boxRef.current?.scrollTo({ top: boxRef.current.scrollHeight })
  }, [messages, selected])

  // ── send ──────────────────────────────────────────────────────────────────
  async function send() {
    if (!selected || sending) return
    if (attachment) { await sendFile(); return }
    const text = draft.trim()
    if (!text) return
    setSending(true)
    try {
      const res = await fetch('/api/whatsapp/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: selected, message: text }),
      }).then(r => r.json())
      if (!res.success) throw new Error(res.error)
      setDraft('')
      await loadMessages(selected)
      loadConversations()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Send failed')
    } finally {
      setSending(false)
    }
  }

  async function sendFile() {
    if (!selected || !attachment) return
    setSending(true)
    try {
      const form = new FormData()
      form.append('file', attachment)
      form.append('phone', selected)
      if (draft.trim()) form.append('caption', draft.trim())
      const res = await fetch('/api/whatsapp/send-media', { method: 'POST', body: form }).then(r => r.json())
      if (!res.success) throw new Error(res.error)
      setDraft('')
      setAttachment(null)
      if (fileRef.current) fileRef.current.value = ''
      await loadMessages(selected)
      loadConversations()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't send the file")
    } finally {
      setSending(false)
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
  }

  const selectedConv = conversations.find(c => c.phone === selected)

  // Insert "Today / Yesterday / date" separators between message groups.
  const messageGroups = useMemo(() => {
    const groups: { dayLabel: string; items: WaMessage[] }[] = []
    for (const m of messages) {
      const label = fmtDayLabel(m.createdAt)
      const last = groups[groups.length - 1]
      if (last && last.dayLabel === label) last.items.push(m)
      else groups.push({ dayLabel: label, items: [m] })
    }
    return groups
  }, [messages])

  return (
    <div className="flex h-screen overflow-hidden bg-slate-50 text-slate-900">
      {/* ============ Conversation list ============ */}
      <aside className={`flex w-[380px] shrink-0 flex-col border-r border-slate-200 bg-white max-[860px]:w-full ${selected ? 'max-[860px]:hidden' : ''}`}>
        <div className="shrink-0 border-b border-slate-200 px-4 py-4">
          <div className="flex items-center gap-2.5">
            <Link href="/dashboard" title="Back to dashboard" className="grid h-9 w-9 place-items-center rounded-lg border border-slate-200 text-slate-500 transition hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-700">
              <ArrowLeft className="h-4 w-4" />
            </Link>
            <div className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-emerald-500 to-green-600 text-white shadow-sm">
              <MessageCircle className="h-4.5 w-4.5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-bold leading-tight text-slate-900">WhatsApp</p>
              <p className="text-[11px] text-slate-400">AppleHolidays</p>
            </div>
            <button onClick={() => setNewChatOpen(true)} title="New chat" className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 transition hover:bg-emerald-50 hover:text-emerald-700">
              <MessageSquarePlus className="h-4 w-4" />
            </button>
            <button onClick={() => loadConversations({ showLoader: true })} title="Refresh" className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-700">
              <RefreshCw className={`h-4 w-4 ${convLoading ? 'animate-spin' : ''}`} />
            </button>
          </div>

          <div className="relative mt-3">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search name or number…"
              className="h-10 w-full rounded-lg border border-slate-200 bg-slate-50 pl-9 pr-3 text-sm outline-none transition placeholder:text-slate-400 focus:border-emerald-400 focus:bg-white focus:ring-2 focus:ring-emerald-500/15"
            />
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
          {convLoading && conversations.length === 0 ? (
            <div className="flex items-center justify-center py-14"><Loader2 className="h-5 w-5 animate-spin text-emerald-500" /></div>
          ) : conversations.length === 0 ? (
            <div className="mt-6 rounded-xl border border-dashed border-slate-200 px-5 py-10 text-center">
              <MessageCircle className="mx-auto mb-2 h-8 w-8 text-slate-300" />
              <p className="text-sm font-semibold text-slate-500">{search ? 'No matches' : 'No conversations yet'}</p>
              <p className="mt-1 text-xs text-slate-400">{search ? 'Try a different name or number.' : 'Incoming WhatsApp messages will appear here.'}</p>
            </div>
          ) : (
            conversations.map(c => {
              const active = c.phone === selected
              const hasUnread = c.unreadCount > 0 && !active
              return (
                <button
                  key={c.phone}
                  onClick={() => openConversation(c.phone)}
                  className={`mb-1 flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition ${
                    active
                      ? 'border-emerald-200 bg-emerald-50/70 shadow-sm'
                      : hasUnread
                        ? 'border-emerald-100 bg-emerald-50/40 hover:bg-emerald-50'
                        : 'border-transparent hover:border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  <span
                    className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-[13px] font-bold text-white"
                    style={{ background: avatarColor(c.phone) }}
                  >
                    {initials(c.displayName, c.phone)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className={`min-w-0 flex-1 truncate text-[13.5px] ${hasUnread ? 'font-bold text-slate-900' : 'font-semibold text-slate-800'}`}>
                        {c.displayName || `+${c.phone}`}
                      </span>
                      <span className={`shrink-0 text-[11px] ${hasUnread ? 'font-bold text-emerald-600' : 'text-slate-400'}`}>{fmtTime(c.updatedAt)}</span>
                    </span>
                    <span className="mt-0.5 flex items-center gap-2">
                      <span className={`min-w-0 flex-1 truncate text-[12.5px] ${hasUnread ? 'font-medium text-slate-700' : 'text-slate-400'}`}>
                        {c.direction === 'outbound' ? 'You: ' : ''}{c.snippet || '…'}
                      </span>
                      {c.unreadCount > 0 && (
                        <span className="grid h-[18px] min-w-[18px] shrink-0 place-items-center rounded-full bg-emerald-500 px-1.5 text-[10.5px] font-bold text-white">
                          {c.unreadCount > 99 ? '99+' : c.unreadCount}
                        </span>
                      )}
                    </span>
                    {c.booking && (
                      <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-blue-50 px-1.5 py-0.5 text-[10px] font-bold text-blue-600">
                        Linked · {c.booking.bookingRef}
                      </span>
                    )}
                  </span>
                </button>
              )
            })
          )}
        </div>
      </aside>

      {/* ============ Thread ============ */}
      <section className={`relative flex min-w-0 flex-1 flex-col ${selected ? '' : 'max-[860px]:hidden'}`}>
        {!selected ? (
          <div className="grid flex-1 place-items-center p-8 text-center">
            <div>
              <div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-emerald-50 text-emerald-500">
                <MessageCircle className="h-8 w-8" />
              </div>
              <p className="mt-4 text-lg font-bold text-slate-800">Select a conversation</p>
              <p className="mt-1 text-sm text-slate-400">Pick a chat on the left to read the thread and reply.</p>
            </div>
          </div>
        ) : (
          <>
            {/* header */}
            <div className="shrink-0 border-b border-slate-200 bg-white px-5 py-3">
              <div className="flex items-center gap-3">
                <button onClick={() => setSelected(null)} className="hidden h-9 w-9 place-items-center rounded-lg border border-slate-200 text-slate-500 max-[860px]:grid">
                  <ArrowLeft className="h-4 w-4" />
                </button>
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-[13px] font-bold text-white" style={{ background: avatarColor(selected) }}>
                  {initials(selectedConv?.displayName ?? null, selected)}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15px] font-bold leading-tight text-slate-900">{selectedConv?.displayName || `+${selected}`}</p>
                  <p className="text-xs text-slate-400">+{selected}</p>
                </div>
              </div>

              {threadBooking ? (
                <div className="mt-3 flex flex-wrap items-center gap-2.5 rounded-xl border border-blue-100 bg-blue-50/60 px-3.5 py-2.5">
                  <FileText className="h-4 w-4 shrink-0 text-blue-500" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12.5px] font-bold text-slate-800">
                      {threadBooking.bookingRef}{threadBooking.leadName ? ` · ${threadBooking.leadName}` : ''}
                    </p>
                    <p className="text-[11px] text-slate-500">{fmtDate(threadBooking.arrivalDate)} → {fmtDate(threadBooking.departureDate)}</p>
                  </div>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-bold ${STATUS_COLORS[threadBooking.status]}`}>
                    {STATUS_LABELS[threadBooking.status]}
                  </span>
                  <Link
                    href={`/dashboard/bookings/${threadBooking.bookingRef}`}
                    target="_blank"
                    className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-blue-600 px-2.5 py-1.5 text-[11.5px] font-semibold text-white transition hover:bg-blue-700"
                  >
                    View booking <ExternalLink className="h-3 w-3" />
                  </Link>
                </div>
              ) : (
                <div className="mt-3 rounded-xl border border-dashed border-slate-200 px-3.5 py-2 text-[12px] text-slate-400">
                  No booking linked to this number yet.
                </div>
              )}
            </div>

            {/* messages */}
            <div ref={boxRef} className="min-h-0 flex-1 overflow-y-auto bg-[#ece5dd] px-[clamp(12px,6%,80px)] py-5">
              {threadLoading && messages.length === 0 ? (
                <div className="flex items-center justify-center py-14"><Loader2 className="h-5 w-5 animate-spin text-emerald-500" /></div>
              ) : messages.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center text-center text-slate-400">
                  <MessageCircle className="mb-2 h-10 w-10 opacity-30" />
                  <p className="text-sm">No messages yet.</p>
                </div>
              ) : (
                messageGroups.map(group => (
                  <div key={group.dayLabel}>
                    <div className="my-3 flex justify-center">
                      <span className="rounded-full bg-white/70 px-3 py-1 text-[11px] font-semibold text-slate-500 shadow-sm">{group.dayLabel}</span>
                    </div>
                    {group.items.map(m => {
                      const isOut = m.direction === 'outbound'
                      return (
                        <div key={m.id} className={`mb-1.5 flex ${isOut ? 'justify-end' : 'justify-start'}`}>
                          <div className={`max-w-[70%] rounded-2xl px-3 py-2 shadow-sm ${isOut ? 'rounded-br-sm bg-[#dcf8c6]' : 'rounded-bl-sm bg-white'}`}>
                            {m.senderName && (
                              <p className={`mb-0.5 text-[10.5px] font-semibold ${isOut ? 'text-emerald-700' : 'text-blue-600'}`}>{m.senderName}</p>
                            )}
                            {m.mediaUrl && m.mediaType === 'image' && (
                              <a href={m.mediaUrl} target="_blank" rel="noopener noreferrer">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img src={m.mediaUrl} alt="Attachment" className="mb-1 max-h-60 rounded-lg object-cover" />
                              </a>
                            )}
                            {m.mediaUrl && m.mediaType !== 'image' && (
                              <a href={m.mediaUrl} target="_blank" rel="noopener noreferrer" className="mb-1 flex items-center gap-1.5 text-[13px] font-semibold text-blue-600 underline">
                                <FileText className="h-3.5 w-3.5" /> {m.mediaType === 'audio' ? 'Voice message' : 'View attachment'}
                              </a>
                            )}
                            {m.body && <p className="whitespace-pre-wrap break-words text-[13.5px] leading-relaxed text-slate-800">{m.body}</p>}
                            <p className={`mt-1 text-right text-[10px] ${isOut ? 'text-emerald-700/70' : 'text-slate-400'}`}>
                              {fmtTime(m.createdAt)}{isOut && <span className="ml-1">{m.status === 'sent' ? '✓' : m.status === 'failed' ? '✗' : '✓✓'}</span>}
                            </p>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                ))
              )}
            </div>

            {/* composer */}
            <div className="shrink-0 border-t border-slate-200 bg-white">
              {attachment && (
                <div className="mx-4 mt-2.5 flex items-center gap-3 rounded-lg border border-slate-200 bg-emerald-50 px-3 py-2">
                  <Paperclip className="h-4 w-4 shrink-0 text-emerald-600" />
                  <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-slate-800">{attachment.name}</span>
                  <button onClick={() => { setAttachment(null); if (fileRef.current) fileRef.current.value = '' }} className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-slate-400 hover:bg-black/10 hover:text-slate-700">
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
              <div className="flex items-end gap-2 px-4 py-3">
                <input ref={fileRef} type="file" className="hidden" onChange={e => setAttachment(e.target.files?.[0] ?? null)} />
                <button onClick={() => fileRef.current?.click()} disabled={sending} title="Attach a file or image" className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-slate-200 text-slate-500 transition hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-700 disabled:opacity-50">
                  <Paperclip className="h-4 w-4" />
                </button>
                <textarea
                  rows={1}
                  value={draft}
                  onChange={e => setDraft(e.target.value)}
                  onKeyDown={onKeyDown}
                  placeholder={attachment ? 'Add a caption (optional) — Enter to send' : 'Type a message — Enter to send, Shift+Enter for a new line'}
                  className="max-h-[120px] min-h-[42px] flex-1 resize-none rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm outline-none transition placeholder:text-slate-400 focus:border-emerald-400 focus:bg-white focus:ring-2 focus:ring-emerald-500/15"
                />
                <button
                  onClick={send}
                  disabled={sending || (!draft.trim() && !attachment)}
                  className="inline-flex h-10 items-center gap-2 rounded-lg bg-gradient-to-b from-emerald-500 to-green-600 px-4 text-sm font-semibold text-white shadow-sm transition hover:brightness-105 disabled:opacity-50"
                >
                  {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  {sending ? 'Sending…' : 'Send'}
                </button>
              </div>
            </div>
          </>
        )}
      </section>

      {/* ============ New chat ============ */}
      {newChatOpen && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 px-4" onClick={() => setNewChatOpen(false)}>
          <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <p className="text-[15px] font-bold text-slate-900">New chat</p>
              <button onClick={() => setNewChatOpen(false)} className="grid h-7 w-7 place-items-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700">
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="mt-1 text-[12.5px] text-slate-500">Enter the customer&apos;s WhatsApp number, with country code.</p>
            <input
              autoFocus
              value={newChatPhone}
              onChange={e => setNewChatPhone(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') startNewChat() }}
              placeholder="e.g. 94771234567"
              inputMode="tel"
              className="mt-3 h-11 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm outline-none transition placeholder:text-slate-400 focus:border-emerald-400 focus:bg-white focus:ring-2 focus:ring-emerald-500/15"
            />
            <p className="mt-2 text-[11.5px] text-slate-400">
              If this number hasn&apos;t messaged us before, WhatsApp requires an approved template for the first message — a free-form text may be rejected.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setNewChatOpen(false)} className="rounded-lg border border-slate-200 px-3.5 py-2 text-[13px] font-semibold text-slate-600 transition hover:bg-slate-50">
                Cancel
              </button>
              <button onClick={startNewChat} className="rounded-lg bg-gradient-to-b from-emerald-500 to-green-600 px-3.5 py-2 text-[13px] font-semibold text-white shadow-sm transition hover:brightness-105">
                Start chat
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
