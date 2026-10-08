'use client'

import { Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { AnimatePresence, motion } from 'framer-motion'
import {
  AlertCircle, ArrowDown, ArrowLeft, BellRing, Check, CheckCheck, ChevronDown, ChevronUp, Clock,
  Copy, Download, ExternalLink, FileText, Inbox, Keyboard, LayoutTemplate, Loader2, MessageCircle,
  MessageSquarePlus, Paperclip, Pin, PinOff, Plus, RefreshCw, Reply, Search, Send, Smile, Sparkles,
  Trash2, VolumeX, WifiOff, X, Zap,
} from 'lucide-react'
import { toast } from 'sonner'
import { STATUS_LABELS, STATUS_COLORS } from '@/lib/state-machine'
import { countryLabel, countryFlag } from '@/lib/country-detection'
import type { OperationCountry } from '@prisma/client'
import {
  CONV_POLL_MS, DEFAULT_QUICK_REPLIES, DOODLE_BG, EMOJIS, THREAD_POLL_MS, UNASSIGNED, WA_TEXT_LIMIT,
  avatarGradient, conversationsSignature, countryGroupKey, downloadText, fmtAgo, fmtDate, fmtDayLabel,
  fmtDuration, fmtListStamp, fmtTime, initials, messagesSignature, playChime, readLocal, writeLocal,
  type Conversation, type PendingMessage, type QuickReply, type RelatedThread, type ThreadBooking, type WaMessage,
} from '@/components/whatsapp-inbox/shared'
import { TemplatesModal } from '@/components/whatsapp-inbox/templates-modal'

type ListTab = 'all' | 'unread' | 'pinned' | 'country'

const PINS_KEY = 'wa-inbox:pins'
const QR_KEY = 'wa-inbox:quick-replies'
const SOUND_KEY = 'wa-inbox:sound'
const AT_BOTTOM_PX = 96

/**
 * Self-scheduling poll: the next tick is only queued once the previous one has
 * finished (so a slow response can't stack requests), it pauses while the tab
 * is hidden, and it fires immediately when the tab comes back.
 */
function usePolling(fn: () => Promise<unknown>, ms: number, enabled: boolean) {
  const fnRef = useRef(fn)
  useEffect(() => { fnRef.current = fn }, [fn])

  useEffect(() => {
    if (!enabled) return
    let stopped = false
    let running = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const run = async () => {
      if (stopped || running) return
      clearTimeout(timer)
      running = true
      try {
        if (document.visibilityState === 'visible') await fnRef.current()
      } catch { /* the next tick retries */ }
      running = false
      if (!stopped) timer = setTimeout(run, ms)
    }
    timer = setTimeout(run, ms)
    const onVisible = () => { if (document.visibilityState === 'visible') run() }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('online', onVisible)
    return () => {
      stopped = true
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('online', onVisible)
    }
  }, [ms, enabled])
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

  // ── list state ────────────────────────────────────────────────────────────
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [convLoading, setConvLoading] = useState(true)
  const [convRefreshing, setConvRefreshing] = useState(false)
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const [tab, setTab] = useState<ListTab>('all')
  const [countryFilter, setCountryFilter] = useState<string | null>(null)
  const [pins, setPins] = useState<string[]>([])
  const [soundOn, setSoundOn] = useState(false)
  const [online, setOnline] = useState(true)
  const [now, setNow] = useState(() => Date.now())

  // ── thread state ──────────────────────────────────────────────────────────
  const [messages, setMessages] = useState<WaMessage[]>([])
  const [pending, setPending] = useState<PendingMessage[]>([])
  const [threadBooking, setThreadBooking] = useState<ThreadBooking | null>(null)
  const [relatedThreads, setRelatedThreads] = useState<RelatedThread[]>([])
  const [threadLoading, setThreadLoading] = useState(false)
  const [windowOpen, setWindowOpen] = useState<boolean | null>(null)
  const [lastSynced, setLastSynced] = useState<number | null>(null)
  const [unreadMarker, setUnreadMarker] = useState(0)
  const [firstUnreadId, setFirstUnreadId] = useState<string | null>(null)
  const [atBottom, setAtBottom] = useState(true)
  const [newBelow, setNewBelow] = useState(0)

  const [threadSearchOpen, setThreadSearchOpen] = useState(false)
  const [threadQuery, setThreadQuery] = useState('')
  const [matchIdx, setMatchIdx] = useState(0)

  // ── composer state ────────────────────────────────────────────────────────
  const [draft, setDraft] = useState('')
  const [attachment, setAttachment] = useState<File | null>(null)
  const [dragging, setDragging] = useState(false)
  const [emojiOpen, setEmojiOpen] = useState(false)
  const [qrManual, setQrManual] = useState(false)
  const [qrIdx, setQrIdx] = useState(0)
  const [quickReplies, setQuickReplies] = useState<QuickReply[]>(DEFAULT_QUICK_REPLIES)
  const [qrAdding, setQrAdding] = useState(false)
  const [qrNewShortcut, setQrNewShortcut] = useState('')
  const [qrNewText, setQrNewText] = useState('')

  // ── modals ────────────────────────────────────────────────────────────────
  const [newChatOpen, setNewChatOpen] = useState(false)
  const [newChatPhone, setNewChatPhone] = useState('')
  const [templatesOpen, setTemplatesOpen] = useState(false)
  const [lightbox, setLightbox] = useState<string | null>(null)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)

  const boxRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const threadSearchRef = useRef<HTMLInputElement>(null)
  const selectedRef = useRef<string | null>(null)
  const searchRef = useRef('')
  const consumedParam = useRef(false)
  const msgSigRef = useRef('')
  const convSigRef = useRef('')
  const lastStampRef = useRef<number | null>(null)
  const soundRef = useRef(false)
  const atBottomRef = useRef(true)
  const scrollModeRef = useRef<'initial' | 'force' | 'idle'>('idle')
  const prevCountRef = useRef(0)
  const draftsRef = useRef(new Map<string, string>())
  const pendingFilesRef = useRef(new Map<string, File>())
  const dragDepth = useRef(0)
  const unreadAtOpenRef = useRef(0)

  useEffect(() => { selectedRef.current = selected }, [selected])
  useEffect(() => { searchRef.current = search }, [search])
  useEffect(() => { soundRef.current = soundOn }, [soundOn])

  // Per-viewer preferences.
  useEffect(() => {
    setPins(readLocal<string[]>(PINS_KEY, []))
    setQuickReplies(readLocal<QuickReply[]>(QR_KEY, DEFAULT_QUICK_REPLIES))
    setSoundOn(readLocal<boolean>(SOUND_KEY, false))
    setOnline(navigator.onLine)
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    const tick = setInterval(() => setNow(Date.now()), 15000)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
      clearInterval(tick)
    }
  }, [])

  // ── conversation list ────────────────────────────────────────────────────
  const loadConversations = useCallback(async (opts: { manual?: boolean } = {}) => {
    if (opts.manual) setConvRefreshing(true)
    try {
      const q = searchRef.current.trim()
      const qs = q ? `?search=${encodeURIComponent(q)}` : ''
      const res = await fetch(`/api/whatsapp/conversations${qs}`, { cache: 'no-store' }).then(r => r.json())
      if (!res.success) return
      // Results for a search the user has since changed are stale — drop them.
      if (searchRef.current.trim() !== q) return
      const data = res.data as Conversation[]

      // Notify about inbound messages that arrived since the last poll.
      if (!q) {
        const newest = data.reduce((m, c) => Math.max(m, new Date(c.updatedAt).getTime()), 0)
        const prevStamp = lastStampRef.current
        if (prevStamp !== null) {
          const fresh = data.filter(c =>
            c.direction === 'inbound' &&
            new Date(c.updatedAt).getTime() > prevStamp &&
            (c.phone !== selectedRef.current || document.visibilityState !== 'visible'))
          if (fresh.length) {
            if (soundRef.current) playChime()
            const c = fresh[0]
            toast(c.displayName || `+${c.phone}`, {
              description: c.snippet.slice(0, 90) || 'New message',
              icon: <MessageCircle className="h-4 w-4 text-emerald-500" />,
              action: { label: 'Open', onClick: () => openConversationRef.current(c.phone) },
            })
          }
        }
        lastStampRef.current = Math.max(prevStamp ?? 0, newest)
      }

      const sig = conversationsSignature(data)
      if (sig !== convSigRef.current) {
        convSigRef.current = sig
        setConversations(data)
      }
    } catch {
      if (opts.manual) toast.error("Couldn't refresh conversations")
    } finally {
      setConvLoading(false)
      if (opts.manual) setConvRefreshing(false)
    }
  }, [])

  // Initial load + debounced search.
  useEffect(() => {
    const t = setTimeout(() => loadConversations({ manual: search.trim() !== '' }), search ? 250 : 0)
    return () => clearTimeout(t)
  }, [search, loadConversations])

  usePolling(loadConversations, CONV_POLL_MS, true)

  // ── thread ────────────────────────────────────────────────────────────────
  const loadMessages = useCallback(async (phone: string, opts: { initial?: boolean } = {}) => {
    if (opts.initial) setThreadLoading(true)
    try {
      const res = await fetch(`/api/whatsapp/messages?phone=${encodeURIComponent(phone)}`, { cache: 'no-store' }).then(r => r.json())
      if (selectedRef.current !== phone) return
      if (!res.success) {
        if (opts.initial) toast.error(res.error || "Couldn't load this conversation")
        return
      }
      const next = res.data.messages as WaMessage[]
      // Only touch state when something actually changed — re-setting an
      // identical array on every poll is what used to yank the scroll position.
      const sig = messagesSignature(next)
      // Pin the "N unread" divider once, on open — computing it on every poll
      // would slide it down as more messages arrive.
      if (opts.initial && unreadAtOpenRef.current > 0) {
        let left = unreadAtOpenRef.current
        let id: string | null = null
        for (let i = next.length - 1; i >= 0 && left > 0; i -= 1) {
          if (next[i].direction === 'inbound') { left -= 1; if (left === 0) id = next[i].id }
        }
        setFirstUnreadId(id)
      }
      if (sig !== msgSigRef.current) {
        msgSigRef.current = sig
        setMessages(next)
      }
      const booking = res.data.booking as ThreadBooking | null
      setThreadBooking(prev => (JSON.stringify(prev) === JSON.stringify(booking) ? prev : booking))
      const related = (res.data.relatedThreads ?? []) as RelatedThread[]
      setRelatedThreads(prev => (JSON.stringify(prev) === JSON.stringify(related) ? prev : related))
      setWindowOpen(res.data.windowOpen)
      setLastSynced(Date.now())
    } catch {
      if (opts.initial) toast.error("Couldn't load this conversation")
    } finally {
      if (opts.initial && selectedRef.current === phone) setThreadLoading(false)
    }
  }, [])

  const pollThread = useCallback(async () => {
    const phone = selectedRef.current
    if (phone) await loadMessages(phone)
  }, [loadMessages])
  usePolling(pollThread, THREAD_POLL_MS, selected !== null)

  function openConversation(phone: string) {
    if (phone === selectedRef.current) return
    if (selectedRef.current) draftsRef.current.set(selectedRef.current, draft)
    const conv = conversations.find(c => c.phone === phone)
    selectedRef.current = phone
    setSelected(phone)
    msgSigRef.current = ''
    prevCountRef.current = 0
    scrollModeRef.current = 'initial'
    atBottomRef.current = true
    setAtBottom(true)
    setNewBelow(0)
    unreadAtOpenRef.current = conv?.unreadCount ?? 0
    setUnreadMarker(unreadAtOpenRef.current)
    setFirstUnreadId(null)
    setMessages([])
    setThreadBooking(null)
    setRelatedThreads([])
    setWindowOpen(null)
    setLastSynced(null)
    setDraft(draftsRef.current.get(phone) ?? '')
    setAttachment(null)
    setThreadSearchOpen(false)
    setThreadQuery('')
    setEmojiOpen(false)
    setQrManual(false)
    loadMessages(phone, { initial: true })
    setConversations(cs => cs.map(c => (c.phone === phone ? { ...c, unreadCount: 0 } : c)))
  }
  const openConversationRef = useRef(openConversation)
  useEffect(() => { openConversationRef.current = openConversation })

  function closeConversation() {
    if (selectedRef.current) draftsRef.current.set(selectedRef.current, draft)
    selectedRef.current = null
    setSelected(null)
  }

  // Auto-open a conversation passed in via ?phone= (e.g. from a booking's mini-chat)
  useEffect(() => {
    if (consumedParam.current) return
    const phone = searchParams.get('phone')
    if (phone) { consumedParam.current = true; openConversation(phone.replace(/\D/g, '')) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams])

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

  // ── scrolling ─────────────────────────────────────────────────────────────
  const visiblePending = useMemo(() => pending.filter(p => p.phone === selected), [pending, selected])

  function onThreadScroll() {
    const box = boxRef.current
    if (!box) return
    const bottom = box.scrollHeight - box.scrollTop - box.clientHeight < AT_BOTTOM_PX
    atBottomRef.current = bottom
    setAtBottom(prev => (prev === bottom ? prev : bottom))
    if (bottom) setNewBelow(n => (n === 0 ? n : 0))
  }

  function scrollToBottom(smooth = true) {
    const box = boxRef.current
    if (!box) return
    box.scrollTo({ top: box.scrollHeight, behavior: smooth ? 'smooth' : 'auto' })
    setNewBelow(0)
  }

  // Only follow new messages when the reader is already at the bottom. If
  // they've scrolled up into the history, leave them there and count what
  // arrived below instead.
  useLayoutEffect(() => {
    const box = boxRef.current
    if (!box) return
    const total = messages.length + visiblePending.length
    if (scrollModeRef.current === 'initial') {
      if (messages.length === 0) return
      scrollModeRef.current = 'idle'
      prevCountRef.current = total
      const marker = firstUnreadId ? document.getElementById(`wa-msg-${firstUnreadId}`) : null
      if (marker) box.scrollTop = Math.max(0, marker.offsetTop - 120)
      else box.scrollTop = box.scrollHeight
      onThreadScroll()
      return
    }
    const added = total - prevCountRef.current
    prevCountRef.current = total
    if (scrollModeRef.current === 'force') {
      scrollModeRef.current = 'idle'
      box.scrollTo({ top: box.scrollHeight, behavior: 'smooth' })
      return
    }
    if (added <= 0) return
    if (atBottomRef.current) box.scrollTo({ top: box.scrollHeight, behavior: 'smooth' })
    else setNewBelow(n => n + added)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, visiblePending.length])

  function onMediaLoaded() {
    if (atBottomRef.current) boxRef.current?.scrollTo({ top: boxRef.current.scrollHeight })
  }

  // ── send ──────────────────────────────────────────────────────────────────
  async function deliver(item: PendingMessage) {
    const file = pendingFilesRef.current.get(item.tempId)
    try {
      let res: { success: boolean; error?: string; message?: string }
      if (file) {
        const form = new FormData()
        form.append('file', file)
        form.append('phone', item.phone)
        if (item.body) form.append('caption', item.body)
        res = await fetch('/api/whatsapp/send-media', { method: 'POST', body: form }).then(r => r.json())
      } else {
        res = await fetch('/api/whatsapp/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phone: item.phone, message: item.body }),
        }).then(r => r.json())
      }
      if (!res.success) throw new Error(res.error || 'Send failed')
      // Outside the 24h window the API silently redirects this through the
      // approved re-engagement template — flag it so staff know it still went out.
      if (res.message?.includes('re-engagement template')) toast.info('Sent via approved template (outside 24h window)')
      if (selectedRef.current === item.phone) {
        scrollModeRef.current = 'force'
        await loadMessages(item.phone)
      }
      pendingFilesRef.current.delete(item.tempId)
      setPending(p => p.filter(x => x.tempId !== item.tempId))
      loadConversations()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Send failed'
      setPending(p => p.map(x => (x.tempId === item.tempId ? { ...x, state: 'failed', error: msg } : x)))
      toast.error(msg)
    }
  }

  function send() {
    if (!selected) return
    const text = draft.trim()
    if (!text && !attachment) return
    if (text.length > WA_TEXT_LIMIT) { toast.error(`Messages are limited to ${WA_TEXT_LIMIT} characters`); return }
    const item: PendingMessage = {
      tempId: `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      phone: selected,
      body: text,
      fileName: attachment?.name ?? null,
      createdAt: new Date().toISOString(),
      state: 'sending',
    }
    if (attachment) pendingFilesRef.current.set(item.tempId, attachment)
    scrollModeRef.current = 'force'
    setPending(p => [...p, item])
    setDraft('')
    draftsRef.current.delete(selected)
    setAttachment(null)
    if (fileRef.current) fileRef.current.value = ''
    setEmojiOpen(false)
    setQrManual(false)
    deliver(item)
  }

  function retry(item: PendingMessage) {
    const again = { ...item, state: 'sending' as const, error: undefined }
    setPending(p => p.map(x => (x.tempId === item.tempId ? again : x)))
    deliver(again)
  }

  function discard(item: PendingMessage) {
    pendingFilesRef.current.delete(item.tempId)
    setPending(p => p.filter(x => x.tempId !== item.tempId))
  }

  // ── composer helpers ──────────────────────────────────────────────────────
  const slashQuery = draft.startsWith('/') && !/\s/.test(draft) ? draft.slice(1).toLowerCase() : null
  const qrVisible = qrManual || slashQuery !== null
  const qrFiltered = useMemo(() => {
    if (!slashQuery) return quickReplies
    return quickReplies.filter(q => q.shortcut.toLowerCase().includes(slashQuery) || q.text.toLowerCase().includes(slashQuery))
  }, [quickReplies, slashQuery])
  useEffect(() => { setQrIdx(0) }, [slashQuery, qrManual])

  function applyQuickReply(q: QuickReply) {
    setDraft(slashQuery !== null ? q.text : d => (d ? `${d} ${q.text}` : q.text))
    setQrManual(false)
    requestAnimationFrame(() => textareaRef.current?.focus())
  }

  function saveQuickReplies(next: QuickReply[]) {
    setQuickReplies(next)
    writeLocal(QR_KEY, next)
  }

  function addQuickReply() {
    const shortcut = qrNewShortcut.trim().replace(/^\//, '').replace(/\s+/g, '-').toLowerCase()
    const text = qrNewText.trim()
    if (!shortcut || !text) { toast.error('Shortcut and text are both required'); return }
    saveQuickReplies([...quickReplies, { id: `qr-${Date.now()}`, shortcut, text }])
    setQrNewShortcut('')
    setQrNewText('')
    setQrAdding(false)
  }

  function insertAtCursor(text: string) {
    const el = textareaRef.current
    if (!el) { setDraft(d => d + text); return }
    const start = el.selectionStart ?? draft.length
    const end = el.selectionEnd ?? draft.length
    const next = draft.slice(0, start) + text + draft.slice(end)
    setDraft(next)
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(start + text.length, start + text.length)
    })
  }

  function quote(m: WaMessage) {
    const body = (m.body ?? '').trim()
    if (!body) return
    const quoted = body.split('\n').slice(0, 4).map(l => `> ${l}`).join('\n')
    setDraft(d => `${quoted}\n${d}`)
    requestAnimationFrame(() => textareaRef.current?.focus())
  }

  async function copyText(text: string) {
    try {
      await navigator.clipboard.writeText(text)
      toast.success('Copied')
    } catch {
      toast.error("Couldn't copy")
    }
  }

  // Auto-grow the composer.
  useLayoutEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`
  }, [draft, selected])

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (qrVisible && slashQuery !== null && qrFiltered.length) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setQrIdx(i => (i + 1) % qrFiltered.length); return }
      if (e.key === 'ArrowUp') { e.preventDefault(); setQrIdx(i => (i - 1 + qrFiltered.length) % qrFiltered.length); return }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); applyQuickReply(qrFiltered[qrIdx] ?? qrFiltered[0]); return }
    }
    if (e.key === 'Escape' && (qrVisible || emojiOpen)) { e.preventDefault(); setQrManual(false); setEmojiOpen(false); if (slashQuery !== null) setDraft(''); return }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
  }

  function onPaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const file = e.clipboardData.files?.[0]
    if (file) { e.preventDefault(); setAttachment(file) }
  }

  // Drag & drop a file anywhere on the open thread.
  function onDragEnter(e: React.DragEvent) {
    if (!selected || !e.dataTransfer.types.includes('Files')) return
    e.preventDefault()
    dragDepth.current += 1
    setDragging(true)
  }
  function onDragLeave(e: React.DragEvent) {
    if (!dragging) return
    e.preventDefault()
    dragDepth.current = Math.max(0, dragDepth.current - 1)
    if (dragDepth.current === 0) setDragging(false)
  }
  function onDrop(e: React.DragEvent) {
    if (!dragging) return
    e.preventDefault()
    dragDepth.current = 0
    setDragging(false)
    const file = e.dataTransfer.files?.[0]
    if (file) { setAttachment(file); textareaRef.current?.focus() }
  }

  const attachmentPreview = useMemo(
    () => (attachment && attachment.type.startsWith('image/') ? URL.createObjectURL(attachment) : null),
    [attachment],
  )
  useEffect(() => () => { if (attachmentPreview) URL.revokeObjectURL(attachmentPreview) }, [attachmentPreview])

  // ── pins / sound / export ────────────────────────────────────────────────
  function togglePin(phone: string) {
    setPins(prev => {
      const next = prev.includes(phone) ? prev.filter(p => p !== phone) : [phone, ...prev]
      writeLocal(PINS_KEY, next)
      return next
    })
  }

  function toggleSound() {
    setSoundOn(prev => {
      const next = !prev
      writeLocal(SOUND_KEY, next)
      if (next) playChime()
      return next
    })
  }

  const selectedConv = conversations.find(c => c.phone === selected)
  const displayName =
    selectedConv?.displayName ??
    messages.find(m => m.direction === 'inbound' && m.senderName)?.senderName ??
    null

  function exportChat() {
    if (!selected || messages.length === 0) return
    const who = displayName || `+${selected}`
    const lines = messages.map(m => {
      const stamp = new Date(m.createdAt).toLocaleString('en-GB')
      const from = m.direction === 'outbound' ? (m.senderName || 'AppleHolidays') : (m.senderName || who)
      const media = m.mediaUrl ? ` [${m.mediaType ?? 'attachment'}: ${m.mediaUrl}]` : ''
      return `[${stamp}] ${from}: ${m.body ?? ''}${media}`
    })
    downloadText(`whatsapp-${selected}-${new Date().toISOString().slice(0, 10)}.txt`, `Chat with ${who} (+${selected})\n\n${lines.join('\n')}\n`)
  }

  // ── derived lists ────────────────────────────────────────────────────────
  const countryBuckets = useMemo(() => {
    const counts = new Map<string, number>()
    for (const c of conversations) {
      const key = countryGroupKey(c.booking?.operationCountry)
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    return Array.from(counts.entries())
      .map(([key, count]) => ({
        key,
        count,
        label: key === UNASSIGNED ? 'Unassigned' : countryLabel(key as OperationCountry),
        flag: key === UNASSIGNED ? '❔' : countryFlag(key as OperationCountry),
      }))
      .sort((a, b) => b.count - a.count)
  }, [conversations])

  // Default to the busiest country the first time "Country" is opened
  // (or if the previously selected one no longer has any chats).
  useEffect(() => {
    if (tab !== 'country') return
    if (countryFilter && countryBuckets.some(b => b.key === countryFilter)) return
    setCountryFilter(countryBuckets[0]?.key ?? null)
  }, [tab, countryBuckets, countryFilter])

  const unreadTotal = useMemo(
    () => conversations.reduce((n, c) => n + (c.phone === selected ? 0 : c.unreadCount), 0),
    [conversations, selected],
  )
  const unreadChats = conversations.filter(c => c.unreadCount > 0 && c.phone !== selected).length

  const visibleConversations = useMemo(() => {
    let list = conversations
    if (tab === 'unread') list = list.filter(c => c.unreadCount > 0 || c.phone === selected)
    if (tab === 'pinned') list = list.filter(c => pins.includes(c.phone))
    if (tab === 'country' && countryFilter) list = list.filter(c => countryGroupKey(c.booking?.operationCountry) === countryFilter)
    if (!pins.length) return list
    return [...list.filter(c => pins.includes(c.phone)), ...list.filter(c => !pins.includes(c.phone))]
  }, [conversations, tab, countryFilter, pins, selected])

  // Unread count in the browser tab title.
  useEffect(() => {
    const base = 'WhatsApp · AppleHolidays'
    document.title = unreadTotal > 0 ? `(${unreadTotal}) ${base}` : base
  }, [unreadTotal])

  // Thread search.
  const matches = useMemo(() => {
    const q = threadQuery.trim().toLowerCase()
    if (!q) return [] as string[]
    return messages.filter(m => (m.body ?? '').toLowerCase().includes(q)).map(m => m.id)
  }, [messages, threadQuery])
  const activeMatch = matches.length ? matches[Math.min(matchIdx, matches.length - 1)] : null

  useEffect(() => { setMatchIdx(matches.length ? matches.length - 1 : 0) }, [threadQuery]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!activeMatch) return
    document.getElementById(`wa-msg-${activeMatch}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [activeMatch])

  // 24h customer-service window countdown, from the last inbound message.
  const windowClosesAt = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      if (messages[i].direction === 'inbound') return new Date(messages[i].createdAt).getTime() + 24 * 3600_000
    }
    return null
  }, [messages])
  const windowLeft = windowOpen && windowClosesAt ? windowClosesAt - now : null

  // Day groups with "run" info so consecutive bubbles from one side stack tightly.
  const messageGroups = useMemo(() => {
    const groups: { dayLabel: string; items: { m: WaMessage; first: boolean; last: boolean }[] }[] = []
    messages.forEach((m, i) => {
      const prev = messages[i - 1]
      const next = messages[i + 1]
      const label = fmtDayLabel(m.createdAt)
      const sameAsPrev = !!prev && prev.direction === m.direction && fmtDayLabel(prev.createdAt) === label &&
        new Date(m.createdAt).getTime() - new Date(prev.createdAt).getTime() < 5 * 60_000
      const sameAsNext = !!next && next.direction === m.direction && fmtDayLabel(next.createdAt) === label &&
        new Date(next.createdAt).getTime() - new Date(m.createdAt).getTime() < 5 * 60_000
      const entry = { m, first: !sameAsPrev, last: !sameAsNext }
      const lastGroup = groups[groups.length - 1]
      if (lastGroup && lastGroup.dayLabel === label) lastGroup.items.push(entry)
      else groups.push({ dayLabel: label, items: [entry] })
    })
    return groups
  }, [messages])

  // ── global keyboard shortcuts ────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey
      const typing = e.target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)
      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        searchInputRef.current?.focus()
        searchInputRef.current?.select()
        return
      }
      if (mod && e.key.toLowerCase() === 'f' && selectedRef.current) {
        e.preventDefault()
        setThreadSearchOpen(true)
        requestAnimationFrame(() => threadSearchRef.current?.focus())
        return
      }
      if (e.altKey && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
        e.preventDefault()
        const list = visibleConversations
        if (!list.length) return
        const idx = list.findIndex(c => c.phone === selectedRef.current)
        const nextIdx = e.key === 'ArrowDown' ? Math.min(list.length - 1, idx + 1) : Math.max(0, idx - 1)
        openConversationRef.current(list[idx === -1 ? 0 : nextIdx].phone)
        return
      }
      if (e.key === 'Escape') {
        if (lightbox) { setLightbox(null); return }
        if (shortcutsOpen) { setShortcutsOpen(false); return }
        if (newChatOpen || templatesOpen) return
        if (threadSearchOpen) { setThreadSearchOpen(false); setThreadQuery(''); return }
        if (!typing && selectedRef.current) closeConversation()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // ── render ────────────────────────────────────────────────────────────────
  const tabs: { key: ListTab; label: string; count?: number }[] = [
    { key: 'all', label: 'All' },
    { key: 'unread', label: 'Unread', count: unreadChats },
    { key: 'pinned', label: 'Pinned', count: pins.length || undefined },
    { key: 'country', label: 'Country' },
  ]

  return (
    <div className="flex h-screen overflow-hidden bg-gradient-to-br from-slate-50 via-white to-emerald-50/40 text-slate-900">
      {/* ============ Conversation list ============ */}
      <aside className={`flex w-[390px] shrink-0 flex-col border-r border-slate-200/80 bg-white/90 backdrop-blur max-[860px]:w-full ${selected ? 'max-[860px]:hidden' : ''}`}>
        <div className="shrink-0 border-b border-slate-100 px-4 pb-3 pt-4">
          <div className="flex items-center gap-2.5">
            <Link href="/dashboard" title="Back to dashboard" className="grid h-9 w-9 place-items-center rounded-xl border border-slate-200 text-slate-500 transition hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-700">
              <ArrowLeft className="h-4 w-4" />
            </Link>
            <motion.div
              className="relative grid h-10 w-10 place-items-center rounded-2xl bg-gradient-to-br from-emerald-400 via-emerald-500 to-green-700 text-white shadow-lg shadow-emerald-500/30"
              whileHover={{ rotate: -8, scale: 1.05 }}
            >
              <MessageCircle className="h-5 w-5" />
              {unreadTotal > 0 && (
                <motion.span
                  key={unreadTotal}
                  initial={{ scale: 0.4 }} animate={{ scale: 1 }}
                  className="absolute -right-1.5 -top-1.5 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-rose-500 px-1 text-[10px] font-bold ring-2 ring-white"
                >
                  {unreadTotal > 99 ? '99+' : unreadTotal}
                </motion.span>
              )}
            </motion.div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[15px] font-extrabold leading-tight tracking-tight text-slate-900">WhatsApp</p>
              <p className="flex items-center gap-1.5 text-[11px] text-slate-400">
                {online ? (
                  <>
                    <span className="relative flex h-1.5 w-1.5">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                      <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
                    </span>
                    Live · {conversations.length} chats
                  </>
                ) : (
                  <span className="flex items-center gap-1 font-semibold text-rose-500"><WifiOff className="h-3 w-3" /> Offline</span>
                )}
              </p>
            </div>
            <IconBtn title={soundOn ? 'Mute new-message sound' : 'Play a sound on new messages'} onClick={toggleSound} active={soundOn}>
              {soundOn ? <BellRing className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
            </IconBtn>
            <IconBtn title="Message templates" onClick={() => setTemplatesOpen(true)}>
              <LayoutTemplate className="h-4 w-4" />
            </IconBtn>
            <IconBtn title="New chat" onClick={() => setNewChatOpen(true)}>
              <MessageSquarePlus className="h-4 w-4" />
            </IconBtn>
            <IconBtn title="Refresh" onClick={() => loadConversations({ manual: true })}>
              <RefreshCw className={`h-4 w-4 ${convRefreshing ? 'animate-spin' : ''}`} />
            </IconBtn>
          </div>

          <div className="group relative mt-3">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 transition group-focus-within:text-emerald-500" />
            <input
              ref={searchInputRef}
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search name or number…"
              className="h-10 w-full rounded-xl border border-slate-200 bg-slate-50 pl-9 pr-16 text-sm outline-none transition placeholder:text-slate-400 focus:border-emerald-400 focus:bg-white focus:ring-4 focus:ring-emerald-500/10"
            />
            <span className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1">
              {search ? (
                <button onClick={() => setSearch('')} className="grid h-6 w-6 place-items-center rounded-md text-slate-400 hover:bg-slate-200 hover:text-slate-700">
                  {convRefreshing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
                </button>
              ) : (
                <kbd className="rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-semibold text-slate-400">⌘K</kbd>
              )}
            </span>
          </div>

          <div className="mt-3 flex gap-1 rounded-xl bg-slate-100/80 p-1">
            {tabs.map(t => (
              <button key={t.key} onClick={() => setTab(t.key)} className="relative flex-1 rounded-lg py-1.5 text-[12px] font-bold transition">
                {tab === t.key && (
                  <motion.span layoutId="wa-list-tab" className="absolute inset-0 rounded-lg bg-white shadow-sm ring-1 ring-black/5" transition={{ type: 'spring', stiffness: 500, damping: 36 }} />
                )}
                <span className={`relative inline-flex items-center gap-1 ${tab === t.key ? 'text-slate-900' : 'text-slate-500 hover:text-slate-700'}`}>
                  {t.label}
                  {!!t.count && (
                    <span className={`rounded-full px-1.5 text-[10px] ${t.key === 'unread' ? 'bg-emerald-500 text-white' : 'bg-slate-200 text-slate-600'}`}>{t.count}</span>
                  )}
                </span>
              </button>
            ))}
          </div>

          <AnimatePresence initial={false}>
            {tab === 'country' && (
              <motion.div
                initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden"
              >
                <div className="flex flex-wrap gap-1.5 pt-2">
                  {countryBuckets.map(b => (
                    <button
                      key={b.key}
                      onClick={() => setCountryFilter(b.key)}
                      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11.5px] font-bold transition ${
                        countryFilter === b.key ? 'bg-emerald-600 text-white shadow-sm shadow-emerald-600/30' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                      }`}
                    >
                      <span>{b.flag}</span> {b.label} <span className="opacity-70">({b.count})</span>
                    </button>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
          {convLoading && conversations.length === 0 ? (
            <div className="space-y-1.5 px-1">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3 rounded-2xl px-3 py-3" style={{ opacity: 1 - i * 0.1 }}>
                  <div className="h-11 w-11 shrink-0 animate-pulse rounded-full bg-slate-200" />
                  <div className="flex-1 space-y-2">
                    <div className="h-3 w-2/3 animate-pulse rounded bg-slate-200" />
                    <div className="h-2.5 w-full animate-pulse rounded bg-slate-100" />
                  </div>
                </div>
              ))}
            </div>
          ) : visibleConversations.length === 0 ? (
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="mt-6 rounded-2xl border border-dashed border-slate-200 px-5 py-10 text-center">
              {tab === 'pinned' ? <Pin className="mx-auto mb-2 h-8 w-8 text-slate-300" /> : <Inbox className="mx-auto mb-2 h-8 w-8 text-slate-300" />}
              <p className="text-sm font-semibold text-slate-500">
                {search ? 'No matches' : tab === 'unread' ? 'All caught up 🎉' : tab === 'pinned' ? 'No pinned chats' : tab === 'country' ? 'No chats for this country' : 'No conversations yet'}
              </p>
              <p className="mt-1 text-xs text-slate-400">
                {search ? 'Try a different name or number.' : tab === 'pinned' ? 'Hover a chat and press the pin to keep it on top.' : 'Incoming WhatsApp messages will appear here.'}
              </p>
            </motion.div>
          ) : (
            <AnimatePresence initial={false}>
              {visibleConversations.map(c => (
                <ConversationRow
                  key={c.phone}
                  c={c}
                  active={c.phone === selected}
                  pinned={pins.includes(c.phone)}
                  onOpen={() => openConversation(c.phone)}
                  onTogglePin={() => togglePin(c.phone)}
                />
              ))}
            </AnimatePresence>
          )}
        </div>

        <div className="flex shrink-0 items-center justify-between border-t border-slate-100 px-4 py-2 text-[10.5px] text-slate-400">
          <span>{unreadTotal > 0 ? `${unreadTotal} unread in ${unreadChats} chat${unreadChats === 1 ? '' : 's'}` : 'All caught up'}</span>
          <button onClick={() => setShortcutsOpen(true)} className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-semibold transition hover:bg-slate-100 hover:text-slate-600">
            <Keyboard className="h-3 w-3" /> Shortcuts
          </button>
        </div>
      </aside>

      {/* ============ Thread ============ */}
      <section
        className={`relative flex min-w-0 flex-1 flex-col ${selected ? '' : 'max-[860px]:hidden'}`}
        onDragEnter={onDragEnter}
        onDragOver={e => { if (dragging) e.preventDefault() }}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        {!selected ? (
          <EmptyThread onNewChat={() => setNewChatOpen(true)} onTemplates={() => setTemplatesOpen(true)} />
        ) : (
          <>
            {/* header */}
            <div className="z-10 shrink-0 border-b border-slate-200/80 bg-white/85 px-5 py-3 backdrop-blur-md">
              <div className="flex items-center gap-3">
                <button onClick={closeConversation} className="hidden h-9 w-9 place-items-center rounded-xl border border-slate-200 text-slate-500 max-[860px]:grid">
                  <ArrowLeft className="h-4 w-4" />
                </button>
                <Avatar seed={selected} name={displayName} phone={selected} size={42} ring={windowOpen === true} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15px] font-bold leading-tight text-slate-900">{displayName || `+${selected}`}</p>
                  <p className="flex items-center gap-1.5 truncate text-[11.5px] text-slate-400">
                    <button onClick={() => copyText(`+${selected}`)} className="transition hover:text-emerald-600" title="Copy number">+{selected}</button>
                    {lastSynced && <span>· synced {fmtAgo(now - lastSynced)}</span>}
                  </p>
                </div>
                <IconBtn title="Search in chat (⌘F)" active={threadSearchOpen} onClick={() => { setThreadSearchOpen(o => !o); setThreadQuery(''); requestAnimationFrame(() => threadSearchRef.current?.focus()) }}>
                  <Search className="h-4 w-4" />
                </IconBtn>
                <IconBtn title="Send a template" onClick={() => setTemplatesOpen(true)}>
                  <LayoutTemplate className="h-4 w-4" />
                </IconBtn>
                <IconBtn title="Export chat as text" onClick={exportChat} disabled={messages.length === 0}>
                  <Download className="h-4 w-4" />
                </IconBtn>
                <IconBtn title={pins.includes(selected) ? 'Unpin chat' : 'Pin chat'} active={pins.includes(selected)} onClick={() => togglePin(selected)}>
                  {pins.includes(selected) ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}
                </IconBtn>
              </div>

              <AnimatePresence initial={false}>
                {threadSearchOpen && (
                  <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                    <div className="mt-3 flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50/50 px-3 py-1.5">
                      <Search className="h-3.5 w-3.5 text-emerald-600" />
                      <input
                        ref={threadSearchRef}
                        value={threadQuery}
                        onChange={e => setThreadQuery(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter' && matches.length) {
                            e.preventDefault()
                            setMatchIdx(i => (e.shiftKey ? (i + 1) % matches.length : (i - 1 + matches.length) % matches.length))
                          }
                        }}
                        placeholder="Search this conversation…"
                        className="h-7 min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-slate-400"
                      />
                      <span className="shrink-0 text-[11px] font-semibold text-slate-500">
                        {threadQuery ? (matches.length ? `${Math.min(matchIdx, matches.length - 1) + 1}/${matches.length}` : 'No results') : ''}
                      </span>
                      <button disabled={!matches.length} onClick={() => setMatchIdx(i => (i - 1 + matches.length) % matches.length)} className="grid h-6 w-6 place-items-center rounded-md text-slate-500 hover:bg-white disabled:opacity-40"><ChevronUp className="h-3.5 w-3.5" /></button>
                      <button disabled={!matches.length} onClick={() => setMatchIdx(i => (i + 1) % matches.length)} className="grid h-6 w-6 place-items-center rounded-md text-slate-500 hover:bg-white disabled:opacity-40"><ChevronDown className="h-3.5 w-3.5" /></button>
                      <button onClick={() => { setThreadSearchOpen(false); setThreadQuery('') }} className="grid h-6 w-6 place-items-center rounded-md text-slate-500 hover:bg-white"><X className="h-3.5 w-3.5" /></button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              <div className="mt-2.5 flex flex-wrap items-center gap-2">
                {windowOpen === null ? (
                  <span className="h-6 w-56 animate-pulse rounded-full bg-slate-100" />
                ) : windowOpen ? (
                  <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold ${windowLeft !== null && windowLeft < 2 * 3600_000 ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'}`}>
                    <span className="relative flex h-1.5 w-1.5">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-current opacity-50" />
                      <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-current" />
                    </span>
                    24h window open{windowLeft !== null && windowLeft > 0 ? ` · closes in ${fmtDuration(windowLeft)}` : ''}
                  </span>
                ) : (
                  <button onClick={() => setTemplatesOpen(true)} className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-bold text-amber-700 transition hover:bg-amber-100">
                    <Clock className="h-3 w-3" /> Outside 24h window — only an approved template will deliver · <span className="underline">Send template</span>
                  </button>
                )}

                {threadBooking ? (
                  <Link
                    href={`/dashboard/bookings/${threadBooking.bookingRef}`}
                    target="_blank"
                    className="group inline-flex min-w-0 items-center gap-2 rounded-full border border-blue-100 bg-blue-50/70 py-0.5 pl-2.5 pr-1 text-[11px] transition hover:border-blue-300 hover:bg-blue-50"
                    title="Open booking"
                  >
                    <FileText className="h-3 w-3 shrink-0 text-blue-500" />
                    <span className="truncate font-bold text-slate-800">
                      {threadBooking.operationCountry && <span className="mr-1">{countryFlag(threadBooking.operationCountry)}</span>}
                      {threadBooking.bookingRef}{threadBooking.leadName ? ` · ${threadBooking.leadName}` : ''}
                    </span>
                    <span className="hidden text-slate-500 sm:inline">{fmtDate(threadBooking.arrivalDate)} → {fmtDate(threadBooking.departureDate)}</span>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${STATUS_COLORS[threadBooking.status]}`}>{STATUS_LABELS[threadBooking.status]}</span>
                    <ExternalLink className="mr-1 h-3 w-3 shrink-0 text-blue-500 transition group-hover:translate-x-0.5" />
                  </Link>
                ) : windowOpen !== null && (
                  <span className="rounded-full border border-dashed border-slate-200 px-2.5 py-0.5 text-[11px] text-slate-400">No booking linked</span>
                )}
              </div>

              {/* Other numbers on the same booking. Without this the thread looks
                  stale next to the booking page's mini chat, which merges every
                  number filed under the bookingRef into one stream. */}
              {relatedThreads.length > 0 && (
                <div className="mt-2 flex flex-wrap items-center gap-1.5 rounded-xl border border-amber-200 bg-amber-50/70 px-3 py-2" title="Messages sent to these numbers are part of the same booking but live in their own thread — the booking page's chat shows them all together.">
                  <span className="text-[11px] font-bold text-amber-800">
                    {relatedThreads.length === 1 ? 'Another number' : `${relatedThreads.length} other numbers`} on this booking:
                  </span>
                  {relatedThreads.map(rt => (
                    <button
                      key={rt.phone}
                      onClick={() => openConversation(rt.phone)}
                      className="inline-flex items-center gap-1 rounded-lg border border-amber-300 bg-white px-2 py-0.5 text-[11px] font-semibold text-amber-800 transition hover:-translate-y-px hover:bg-amber-100"
                    >
                      <MessageCircle className="h-3 w-3" />
                      {rt.displayName ? `${rt.displayName} · ` : ''}+{rt.phone}
                      <span className="font-normal text-amber-600">({rt.messageCount} · {fmtDate(rt.lastAt)})</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* messages */}
            <div className="relative min-h-0 flex-1">
              <div
                ref={boxRef}
                onScroll={onThreadScroll}
                className="absolute inset-0 overflow-y-auto bg-[#efeae2] px-[clamp(12px,6%,80px)] py-4"
                style={DOODLE_BG}
              >
                {threadLoading && messages.length === 0 ? (
                  <ThreadSkeleton />
                ) : messages.length === 0 && visiblePending.length === 0 ? (
                  <div className="flex h-full flex-col items-center justify-center text-center">
                    <motion.div initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="rounded-2xl bg-white/80 px-6 py-5 shadow-sm backdrop-blur">
                      <Sparkles className="mx-auto mb-2 h-8 w-8 text-emerald-500" />
                      <p className="text-sm font-semibold text-slate-700">Start the conversation</p>
                      <p className="mt-1 max-w-xs text-xs text-slate-500">
                        New numbers usually need an approved template first.{' '}
                        <button onClick={() => setTemplatesOpen(true)} className="font-semibold text-emerald-600 underline">Pick a template</button>
                      </p>
                    </motion.div>
                  </div>
                ) : (
                  <div key={selected}>
                    {messageGroups.map(group => (
                      <div key={group.dayLabel}>
                        <div className="sticky top-1 z-[5] my-3 flex justify-center">
                          <span className="rounded-full bg-white/90 px-3 py-1 text-[11px] font-semibold text-slate-500 shadow-sm ring-1 ring-black/5 backdrop-blur">{group.dayLabel}</span>
                        </div>
                        <AnimatePresence initial={false}>
                          {group.items.map(({ m, first, last }) => (
                            <div key={m.id}>
                              {m.id === firstUnreadId && (
                                <div className="my-3 flex items-center gap-3">
                                  <span className="h-px flex-1 bg-emerald-300/70" />
                                  <span className="rounded-full bg-emerald-500 px-3 py-0.5 text-[10.5px] font-bold text-white shadow-sm">{unreadMarker} unread message{unreadMarker === 1 ? '' : 's'}</span>
                                  <span className="h-px flex-1 bg-emerald-300/70" />
                                </div>
                              )}
                              <MessageBubble
                                m={m}
                                first={first}
                                last={last}
                                query={threadQuery.trim()}
                                isActiveMatch={m.id === activeMatch}
                                onImage={setLightbox}
                                onMediaLoaded={onMediaLoaded}
                                onCopy={() => copyText(m.body ?? '')}
                                onQuote={() => quote(m)}
                              />
                            </div>
                          ))}
                        </AnimatePresence>
                      </div>
                    ))}
                    <AnimatePresence initial={false}>
                      {visiblePending.map(p => (
                        <PendingBubble key={p.tempId} p={p} onRetry={() => retry(p)} onDiscard={() => discard(p)} />
                      ))}
                    </AnimatePresence>
                  </div>
                )}
              </div>

              {/* jump to latest */}
              <AnimatePresence>
                {!atBottom && messages.length > 0 && (
                  <motion.button
                    initial={{ opacity: 0, scale: 0.6, y: 12 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.6, y: 12 }}
                    whileHover={{ scale: 1.08 }} whileTap={{ scale: 0.94 }}
                    onClick={() => scrollToBottom()}
                    className="absolute bottom-4 right-5 z-10 flex items-center gap-1.5 rounded-full bg-white py-2 pl-2.5 pr-3 text-[12px] font-bold text-slate-700 shadow-lg ring-1 ring-black/5"
                    title="Jump to latest"
                  >
                    {newBelow > 0 && (
                      <motion.span key={newBelow} initial={{ scale: 0.5 }} animate={{ scale: 1 }} className="grid h-5 min-w-[20px] place-items-center rounded-full bg-emerald-500 px-1.5 text-[10.5px] text-white">
                        {newBelow}
                      </motion.span>
                    )}
                    {newBelow > 0 ? 'new' : ''}
                    <ArrowDown className="h-4 w-4 text-emerald-600" />
                  </motion.button>
                )}
              </AnimatePresence>

              {/* drop overlay */}
              <AnimatePresence>
                {dragging && (
                  <motion.div
                    initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                    className="pointer-events-none absolute inset-3 z-20 grid place-items-center rounded-3xl border-2 border-dashed border-emerald-400 bg-emerald-50/85 backdrop-blur-sm"
                  >
                    <motion.div initial={{ y: 10 }} animate={{ y: 0 }} className="text-center">
                      <Paperclip className="mx-auto h-10 w-10 text-emerald-500" />
                      <p className="mt-2 text-sm font-bold text-emerald-700">Drop to attach</p>
                    </motion.div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* composer */}
            <div className="relative shrink-0 border-t border-slate-200/80 bg-white/90 backdrop-blur-md">
              {/* quick replies */}
              <AnimatePresence>
                {qrVisible && (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }}
                    className="absolute bottom-full left-4 right-4 mb-2 max-h-72 overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-black/5"
                  >
                    <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
                      <p className="flex items-center gap-1.5 text-[12px] font-bold text-slate-700"><Zap className="h-3.5 w-3.5 text-amber-500" /> Quick replies <span className="font-normal text-slate-400">— type / in the message box</span></p>
                      <div className="flex items-center gap-1">
                        <button onClick={() => setQrAdding(a => !a)} className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11.5px] font-semibold text-emerald-700 hover:bg-emerald-50"><Plus className="h-3 w-3" /> New</button>
                        <button onClick={() => { setQrManual(false); if (slashQuery !== null) setDraft('') }} className="grid h-6 w-6 place-items-center rounded-md text-slate-400 hover:bg-slate-100"><X className="h-3.5 w-3.5" /></button>
                      </div>
                    </div>
                    {qrAdding && (
                      <div className="flex gap-2 border-b border-slate-100 bg-slate-50 p-2">
                        <input value={qrNewShortcut} onChange={e => setQrNewShortcut(e.target.value)} placeholder="shortcut" className="h-8 w-28 rounded-lg border border-slate-200 bg-white px-2 text-[12px] outline-none focus:border-emerald-400" />
                        <input value={qrNewText} onChange={e => setQrNewText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') addQuickReply() }} placeholder="Reply text…" className="h-8 min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-2 text-[12px] outline-none focus:border-emerald-400" />
                        <button onClick={addQuickReply} className="rounded-lg bg-emerald-600 px-3 text-[12px] font-bold text-white hover:bg-emerald-700">Save</button>
                      </div>
                    )}
                    <div className="max-h-52 overflow-y-auto p-1.5">
                      {qrFiltered.length === 0 ? (
                        <p className="px-3 py-4 text-center text-[12px] text-slate-400">No quick reply matches “{slashQuery}”.</p>
                      ) : qrFiltered.map((q, i) => (
                        <div
                          key={q.id}
                          className={`group flex cursor-pointer items-start gap-2 rounded-xl px-2.5 py-2 transition ${i === qrIdx && slashQuery !== null ? 'bg-emerald-50' : 'hover:bg-slate-50'}`}
                          onMouseDown={e => { e.preventDefault(); applyQuickReply(q) }}
                        >
                          <span className="mt-0.5 shrink-0 rounded-md bg-slate-100 px-1.5 py-0.5 font-mono text-[10.5px] font-bold text-slate-600">/{q.shortcut}</span>
                          <span className="min-w-0 flex-1 text-[12.5px] leading-snug text-slate-700">{q.text}</span>
                          <button
                            onMouseDown={e => { e.preventDefault(); e.stopPropagation(); saveQuickReplies(quickReplies.filter(x => x.id !== q.id)) }}
                            className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-slate-300 opacity-0 transition hover:bg-rose-50 hover:text-rose-500 group-hover:opacity-100"
                            title="Delete quick reply"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* emoji */}
              <AnimatePresence>
                {emojiOpen && (
                  <motion.div
                    initial={{ opacity: 0, y: 10, scale: 0.95 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 10, scale: 0.95 }}
                    className="absolute bottom-full left-4 mb-2 grid grid-cols-8 gap-0.5 rounded-2xl bg-white p-2 shadow-2xl ring-1 ring-black/5"
                  >
                    {EMOJIS.map(e => (
                      <motion.button key={e} whileHover={{ scale: 1.3 }} whileTap={{ scale: 0.9 }} onMouseDown={ev => { ev.preventDefault(); insertAtCursor(e) }} className="grid h-8 w-8 place-items-center rounded-lg text-lg hover:bg-slate-100">
                        {e}
                      </motion.button>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>

              <AnimatePresence>
                {attachment && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="mx-4 mt-2.5 flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50/70 px-3 py-2">
                      {attachmentPreview ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={attachmentPreview} alt="" className="h-12 w-12 shrink-0 rounded-lg object-cover ring-1 ring-black/10" />
                      ) : (
                        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-lg bg-white text-emerald-600 ring-1 ring-emerald-200"><FileText className="h-5 w-5" /></span>
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-semibold text-slate-800">{attachment.name}</span>
                        <span className="text-[11px] text-slate-500">{(attachment.size / 1024 / 1024).toFixed(2)} MB · add a caption below</span>
                      </span>
                      <button onClick={() => { setAttachment(null); if (fileRef.current) fileRef.current.value = '' }} className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-slate-400 hover:bg-black/10 hover:text-slate-700">
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              <div className="flex items-end gap-2 px-4 py-3">
                <input ref={fileRef} type="file" className="hidden" onChange={e => setAttachment(e.target.files?.[0] ?? null)} />
                <div className="flex shrink-0 items-center gap-0.5 pb-0.5">
                  <ComposerBtn title="Emoji" active={emojiOpen} onClick={() => { setEmojiOpen(o => !o); setQrManual(false) }}><Smile className="h-[18px] w-[18px]" /></ComposerBtn>
                  <ComposerBtn title="Quick replies (type /)" active={qrManual} onClick={() => { setQrManual(o => !o); setEmojiOpen(false) }}><Zap className="h-[18px] w-[18px]" /></ComposerBtn>
                  <ComposerBtn title="Attach a file or image (or paste / drop)" onClick={() => fileRef.current?.click()}><Paperclip className="h-[18px] w-[18px]" /></ComposerBtn>
                </div>
                <div className="relative min-w-0 flex-1">
                  <textarea
                    ref={textareaRef}
                    rows={1}
                    value={draft}
                    onChange={e => setDraft(e.target.value)}
                    onKeyDown={onKeyDown}
                    onPaste={onPaste}
                    placeholder={
                      attachment
                        ? 'Add a caption (optional) — Enter to send'
                        : windowOpen === false
                          ? 'Outside 24h window — this will send via the approved re-engagement template'
                          : 'Type a message · / for quick replies · Shift+Enter for a new line'
                    }
                    className="block max-h-40 min-h-[44px] w-full resize-none rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm leading-snug outline-none transition placeholder:text-slate-400 focus:border-emerald-400 focus:bg-white focus:ring-4 focus:ring-emerald-500/10"
                  />
                  {draft.length > WA_TEXT_LIMIT * 0.8 && (
                    <span className={`absolute -top-5 right-2 text-[10.5px] font-semibold ${draft.length > WA_TEXT_LIMIT ? 'text-rose-500' : 'text-slate-400'}`}>
                      {draft.length}/{WA_TEXT_LIMIT}
                    </span>
                  )}
                </div>
                <motion.button
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.9 }}
                  onClick={send}
                  disabled={!draft.trim() && !attachment}
                  title="Send (Enter)"
                  className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-gradient-to-br from-emerald-400 to-green-600 text-white shadow-lg shadow-emerald-500/30 transition disabled:from-slate-300 disabled:to-slate-400 disabled:shadow-none"
                >
                  <AnimatePresence mode="wait" initial={false}>
                    <motion.span
                      key={draft.trim() || attachment ? 'ready' : 'idle'}
                      initial={{ rotate: -45, scale: 0.5, opacity: 0 }} animate={{ rotate: 0, scale: 1, opacity: 1 }} exit={{ rotate: 45, scale: 0.5, opacity: 0 }}
                      transition={{ duration: 0.15 }}
                    >
                      <Send className="h-[18px] w-[18px] translate-x-[-1px]" />
                    </motion.span>
                  </AnimatePresence>
                </motion.button>
              </div>
            </div>
          </>
        )}
      </section>

      {/* ============ New chat ============ */}
      <AnimatePresence>
        {newChatOpen && (
          <motion.div
            className="fixed inset-0 z-50 grid place-items-center bg-slate-900/50 px-4 backdrop-blur-sm"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={() => setNewChatOpen(false)}
          >
            <motion.div
              className="w-full max-w-sm rounded-3xl bg-white p-6 shadow-2xl ring-1 ring-black/5"
              initial={{ opacity: 0, y: 24, scale: 0.95 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 16, scale: 0.96 }}
              transition={{ type: 'spring', stiffness: 400, damping: 30 }}
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-emerald-400 to-green-600 text-white shadow-md shadow-emerald-500/30"><MessageSquarePlus className="h-4 w-4" /></span>
                  <p className="text-[15px] font-bold text-slate-900">New chat</p>
                </div>
                <button onClick={() => setNewChatOpen(false)} className="grid h-7 w-7 place-items-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700">
                  <X className="h-4 w-4" />
                </button>
              </div>
              <p className="mt-3 text-[12.5px] text-slate-500">Enter the customer&apos;s WhatsApp number, with country code.</p>
              <div className="relative mt-3">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm font-semibold text-slate-400">+</span>
                <input
                  autoFocus
                  value={newChatPhone}
                  onChange={e => setNewChatPhone(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') startNewChat() }}
                  placeholder="94771234567"
                  inputMode="tel"
                  className="h-12 w-full rounded-xl border border-slate-200 bg-slate-50 pl-7 pr-3 text-[15px] font-semibold tracking-wide outline-none transition placeholder:font-normal placeholder:text-slate-400 focus:border-emerald-400 focus:bg-white focus:ring-4 focus:ring-emerald-500/10"
                />
              </div>
              {(() => {
                const digits = newChatPhone.replace(/\D/g, '')
                const existing = digits.length >= 5 ? conversations.find(c => c.phone.includes(digits)) : null
                return existing ? (
                  <button
                    onClick={() => { setNewChatOpen(false); setNewChatPhone(''); openConversation(existing.phone) }}
                    className="mt-2 flex w-full items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-left text-[12px] text-emerald-800 transition hover:bg-emerald-100"
                  >
                    <MessageCircle className="h-3.5 w-3.5" /> Existing chat: <span className="font-bold">{existing.displayName || `+${existing.phone}`}</span>
                  </button>
                ) : null
              })()}
              <p className="mt-3 text-[11.5px] text-slate-400">
                If this number hasn&apos;t messaged us before, WhatsApp requires an approved template for the first message — a free-form text may be rejected.
              </p>
              <div className="mt-5 flex justify-end gap-2">
                <button onClick={() => setNewChatOpen(false)} className="rounded-xl border border-slate-200 px-4 py-2 text-[13px] font-semibold text-slate-600 transition hover:bg-slate-50">
                  Cancel
                </button>
                <motion.button whileTap={{ scale: 0.96 }} onClick={startNewChat} className="rounded-xl bg-gradient-to-r from-emerald-500 to-green-600 px-4 py-2 text-[13px] font-bold text-white shadow-lg shadow-emerald-500/25 transition hover:brightness-105">
                  Start chat
                </motion.button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ============ Message templates ============ */}
      <AnimatePresence>
        {templatesOpen && (
          <TemplatesModal
            phone={selected}
            recipientLabel={displayName}
            onClose={() => setTemplatesOpen(false)}
            onSent={() => {
              if (selected) { scrollModeRef.current = 'force'; loadMessages(selected) }
              loadConversations()
            }}
          />
        )}
      </AnimatePresence>

      {/* ============ Image lightbox ============ */}
      <AnimatePresence>
        {lightbox && (
          <motion.div
            className="fixed inset-0 z-[60] grid place-items-center bg-slate-950/85 p-6 backdrop-blur"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={() => setLightbox(null)}
          >
            <div className="absolute right-4 top-4 flex gap-2">
              <a href={lightbox} target="_blank" rel="noopener noreferrer" download onClick={e => e.stopPropagation()} className="grid h-10 w-10 place-items-center rounded-full bg-white/10 text-white transition hover:bg-white/20" title="Open original">
                <Download className="h-4 w-4" />
              </a>
              <button onClick={() => setLightbox(null)} className="grid h-10 w-10 place-items-center rounded-full bg-white/10 text-white transition hover:bg-white/20" title="Close (Esc)">
                <X className="h-5 w-5" />
              </button>
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <motion.img
              src={lightbox}
              alt="Attachment"
              initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.92, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 300, damping: 28 }}
              className="max-h-[88vh] max-w-[92vw] rounded-2xl object-contain shadow-2xl"
              onClick={e => e.stopPropagation()}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* ============ Shortcuts ============ */}
      <AnimatePresence>
        {shortcutsOpen && (
          <motion.div
            className="fixed inset-0 z-50 grid place-items-center bg-slate-900/40 px-4 backdrop-blur-sm"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={() => setShortcutsOpen(false)}
          >
            <motion.div
              className="w-full max-w-sm rounded-3xl bg-white p-5 shadow-2xl"
              initial={{ y: 20, scale: 0.95 }} animate={{ y: 0, scale: 1 }} exit={{ y: 12, scale: 0.96 }}
              onClick={e => e.stopPropagation()}
            >
              <p className="flex items-center gap-2 text-[15px] font-bold text-slate-900"><Keyboard className="h-4 w-4 text-emerald-600" /> Keyboard shortcuts</p>
              <div className="mt-4 space-y-2 text-[12.5px]">
                {[
                  ['⌘/Ctrl + K', 'Search chats'],
                  ['⌘/Ctrl + F', 'Search inside the open chat'],
                  ['Alt + ↑ / ↓', 'Previous / next chat'],
                  ['Enter', 'Send message'],
                  ['Shift + Enter', 'New line'],
                  ['/', 'Quick replies'],
                  ['Esc', 'Close search / chat / dialogs'],
                ].map(([k, d]) => (
                  <div key={k} className="flex items-center justify-between gap-3">
                    <span className="text-slate-600">{d}</span>
                    <kbd className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-0.5 font-mono text-[11px] font-semibold text-slate-700">{k}</kbd>
                  </div>
                ))}
              </div>
              <p className="mt-4 text-[11px] text-slate-400">Tip: paste a screenshot or drop a file onto the chat to attach it.</p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ─── Pieces ─────────────────────────────────────────────────────────────────

function IconBtn({ children, title, onClick, active, disabled }: { children: React.ReactNode; title: string; onClick: () => void; active?: boolean; disabled?: boolean }) {
  return (
    <motion.button
      whileTap={{ scale: 0.88 }}
      onClick={onClick}
      title={title}
      disabled={disabled}
      className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg transition disabled:opacity-40 ${
        active ? 'bg-emerald-50 text-emerald-700' : 'text-slate-400 hover:bg-emerald-50 hover:text-emerald-700'
      }`}
    >
      {children}
    </motion.button>
  )
}

function ComposerBtn({ children, title, onClick, active }: { children: React.ReactNode; title: string; onClick: () => void; active?: boolean }) {
  return (
    <motion.button
      whileHover={{ y: -2 }}
      whileTap={{ scale: 0.88 }}
      onClick={onClick}
      title={title}
      className={`grid h-10 w-10 place-items-center rounded-full transition ${active ? 'bg-emerald-100 text-emerald-700' : 'text-slate-500 hover:bg-slate-100 hover:text-emerald-700'}`}
    >
      {children}
    </motion.button>
  )
}

function Avatar({ seed, name, phone, size = 44, ring }: { seed: string; name: string | null; phone: string; size?: number; ring?: boolean }) {
  return (
    <span className="relative shrink-0">
      <span
        className="grid place-items-center rounded-full font-bold text-white shadow-sm"
        style={{ background: avatarGradient(seed), width: size, height: size, fontSize: size * 0.32 }}
      >
        {initials(name, phone)}
      </span>
      {ring && <span className="absolute bottom-0 right-0 h-3 w-3 rounded-full bg-emerald-500 ring-2 ring-white" title="24h window open" />}
    </span>
  )
}

function ConversationRow({ c, active, pinned, onOpen, onTogglePin }: {
  c: Conversation
  active: boolean
  pinned: boolean
  onOpen: () => void
  onTogglePin: () => void
}) {
  const hasUnread = c.unreadCount > 0 && !active
  return (
    <motion.div
      layout="position"
      initial={{ opacity: 0, x: -12 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -12, height: 0 }}
      transition={{ type: 'spring', stiffness: 500, damping: 40 }}
      className="group relative mb-1"
    >
      <button
        onClick={onOpen}
        className={`relative flex w-full items-center gap-3 overflow-hidden rounded-2xl border px-3 py-2.5 text-left transition ${
          active
            ? 'border-emerald-200 bg-gradient-to-r from-emerald-50 to-white shadow-sm'
            : hasUnread
              ? 'border-emerald-100 bg-emerald-50/40 hover:bg-emerald-50'
              : 'border-transparent hover:border-slate-200 hover:bg-slate-50'
        }`}
      >
        {active && <motion.span layoutId="wa-active-bar" className="absolute left-0 top-2 bottom-2 w-1 rounded-r-full bg-emerald-500" />}
        <Avatar seed={c.phone} name={c.displayName} phone={c.phone} />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className={`min-w-0 flex-1 truncate text-[13.5px] ${hasUnread ? 'font-bold text-slate-900' : 'font-semibold text-slate-800'}`}>
              {c.displayName || `+${c.phone}`}
            </span>
            {pinned && <Pin className="h-3 w-3 shrink-0 rotate-45 text-emerald-500" />}
            <span className={`shrink-0 text-[11px] ${hasUnread ? 'font-bold text-emerald-600' : 'text-slate-400'}`}>{fmtListStamp(c.updatedAt)}</span>
          </span>
          <span className="mt-0.5 flex items-center gap-2">
            <span className={`min-w-0 flex-1 truncate text-[12.5px] ${hasUnread ? 'font-medium text-slate-700' : 'text-slate-400'}`}>
              {c.direction === 'outbound' && <CheckCheck className="mr-1 inline h-3.5 w-3.5 -translate-y-px text-slate-400" />}
              {c.snippet || '…'}
            </span>
            <AnimatePresence>
              {hasUnread && (
                <motion.span
                  initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }}
                  className="grid h-[19px] min-w-[19px] shrink-0 place-items-center rounded-full bg-gradient-to-br from-emerald-400 to-green-600 px-1.5 text-[10.5px] font-bold text-white shadow-sm shadow-emerald-500/40"
                >
                  {c.unreadCount > 99 ? '99+' : c.unreadCount}
                </motion.span>
              )}
            </AnimatePresence>
          </span>
          {c.booking && (
            <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-blue-50 px-1.5 py-0.5 text-[10px] font-bold text-blue-600">
              {c.booking.operationCountry && <span>{countryFlag(c.booking.operationCountry)}</span>}
              {c.booking.bookingRef}
              <span className={`ml-0.5 rounded-full px-1 ${STATUS_COLORS[c.booking.status]}`}>{STATUS_LABELS[c.booking.status]}</span>
            </span>
          )}
        </span>
      </button>
      <button
        onClick={e => { e.stopPropagation(); onTogglePin() }}
        title={pinned ? 'Unpin' : 'Pin to top'}
        className="absolute right-2 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-lg bg-white text-slate-400 opacity-0 shadow-sm ring-1 ring-black/5 transition hover:text-emerald-600 group-hover:opacity-100"
      >
        {pinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
      </button>
    </motion.div>
  )
}

function StatusTicks({ status }: { status: string }) {
  if (status === 'failed') return <AlertCircle className="h-3.5 w-3.5 text-rose-500" />
  if (status === 'read') return <CheckCheck className="h-3.5 w-3.5 text-sky-500" />
  if (status === 'delivered') return <CheckCheck className="h-3.5 w-3.5 text-slate-400" />
  if (status === 'sent') return <Check className="h-3.5 w-3.5 text-slate-400" />
  return <Clock className="h-3 w-3 text-slate-400" />
}

function Highlight({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>
  const parts = text.split(new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'))
  return (
    <>
      {parts.map((p, i) =>
        p.toLowerCase() === query.toLowerCase()
          ? <mark key={i} className="rounded bg-amber-200 px-0.5 text-slate-900">{p}</mark>
          : <span key={i}>{p}</span>,
      )}
    </>
  )
}

function MessageBubble({ m, first, last, query, isActiveMatch, onImage, onMediaLoaded, onCopy, onQuote }: {
  m: WaMessage
  first: boolean
  last: boolean
  query: string
  isActiveMatch: boolean
  onImage: (url: string) => void
  onMediaLoaded: () => void
  onCopy: () => void
  onQuote: () => void
}) {
  const isOut = m.direction === 'outbound'
  const tail = first ? (isOut ? 'rounded-tr-md' : 'rounded-tl-md') : ''
  return (
    <motion.div
      id={`wa-msg-${m.id}`}
      initial={{ opacity: 0, y: 12, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: 'spring', stiffness: 420, damping: 30 }}
      className={`group flex items-center gap-1.5 ${isOut ? 'flex-row-reverse' : ''} ${last ? 'mb-2.5' : 'mb-0.5'}`}
    >
      <div
        className={`relative max-w-[72%] rounded-2xl px-3 py-2 shadow-[0_1px_1px_rgba(0,0,0,0.08)] transition ${tail} ${
          isOut ? 'bg-[#d9fdd3]' : 'bg-white'
        } ${m.status === 'failed' ? 'ring-1 ring-rose-300' : ''} ${isActiveMatch ? 'ring-2 ring-amber-400' : ''}`}
      >
        {m.senderName && first && (
          <p className={`mb-0.5 text-[11px] font-bold ${isOut ? 'text-emerald-700' : 'text-blue-600'}`}>{m.senderName}</p>
        )}
        {m.mediaUrl && m.mediaType === 'image' && (
          <button onClick={() => onImage(m.mediaUrl!)} className="mb-1 block overflow-hidden rounded-xl">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={m.mediaUrl} alt="Attachment" onLoad={onMediaLoaded} className="max-h-64 rounded-xl object-cover transition duration-300 hover:scale-[1.03]" />
          </button>
        )}
        {m.mediaUrl && m.mediaType === 'audio' && (
          <audio controls src={m.mediaUrl} className="mb-1 h-10 max-w-[260px]" />
        )}
        {m.mediaUrl && m.mediaType === 'video' && (
          <video controls src={m.mediaUrl} onLoadedData={onMediaLoaded} className="mb-1 max-h-64 rounded-xl" />
        )}
        {m.mediaUrl && !['image', 'audio', 'video'].includes(m.mediaType ?? '') && (
          <a href={m.mediaUrl} target="_blank" rel="noopener noreferrer" className="mb-1 flex items-center gap-2 rounded-xl bg-black/[0.04] px-3 py-2 text-[12.5px] font-semibold text-slate-700 transition hover:bg-black/[0.07]">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-white text-rose-500 shadow-sm"><FileText className="h-4 w-4" /></span>
            {m.mediaType === 'document' ? 'Document' : 'Attachment'}
            <Download className="ml-auto h-3.5 w-3.5 text-slate-400" />
          </a>
        )}
        {m.body && (
          <p className="whitespace-pre-wrap break-words text-[13.5px] leading-relaxed text-slate-800">
            <Highlight text={m.body} query={query} />
          </p>
        )}
        <p className="mt-0.5 flex items-center justify-end gap-1 text-[10px] text-slate-400" title={new Date(m.createdAt).toLocaleString()}>
          {fmtTime(m.createdAt)}
          {isOut && <StatusTicks status={m.status} />}
        </p>
      </div>
      {m.body && (
        <div className="flex shrink-0 gap-0.5 opacity-0 transition group-hover:opacity-100">
          <button onClick={onQuote} title="Quote in reply" className="grid h-7 w-7 place-items-center rounded-full bg-white/80 text-slate-500 shadow-sm hover:text-emerald-600"><Reply className="h-3.5 w-3.5" /></button>
          <button onClick={onCopy} title="Copy text" className="grid h-7 w-7 place-items-center rounded-full bg-white/80 text-slate-500 shadow-sm hover:text-emerald-600"><Copy className="h-3.5 w-3.5" /></button>
        </div>
      )}
    </motion.div>
  )
}

function PendingBubble({ p, onRetry, onDiscard }: { p: PendingMessage; onRetry: () => void; onDiscard: () => void }) {
  const failed = p.state === 'failed'
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 16, scale: 0.9 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ type: 'spring', stiffness: 420, damping: 30 }}
      className="mb-2.5 flex justify-end"
    >
      <div className={`max-w-[72%] rounded-2xl rounded-tr-md px-3 py-2 shadow-[0_1px_1px_rgba(0,0,0,0.08)] ${failed ? 'bg-rose-50 ring-1 ring-rose-300' : 'bg-[#d9fdd3]/80'}`}>
        {p.fileName && (
          <p className="mb-1 flex items-center gap-1.5 text-[12.5px] font-semibold text-slate-700"><Paperclip className="h-3.5 w-3.5" /> {p.fileName}</p>
        )}
        {p.body && <p className="whitespace-pre-wrap break-words text-[13.5px] leading-relaxed text-slate-800">{p.body}</p>}
        <div className="mt-0.5 flex items-center justify-end gap-1.5 text-[10px] text-slate-400">
          {failed ? (
            <>
              <span className="truncate font-semibold text-rose-600" title={p.error}>Not sent</span>
              <button onClick={onRetry} className="rounded-md bg-white px-1.5 py-0.5 font-bold text-emerald-700 shadow-sm hover:bg-emerald-50">Retry</button>
              <button onClick={onDiscard} className="rounded-md bg-white px-1.5 py-0.5 font-bold text-slate-500 shadow-sm hover:bg-slate-50">Discard</button>
            </>
          ) : (
            <>
              {fmtTime(p.createdAt)}
              <motion.span animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1.6, ease: 'linear' }}>
                <Clock className="h-3 w-3" />
              </motion.span>
            </>
          )}
        </div>
      </div>
    </motion.div>
  )
}

function ThreadSkeleton() {
  return (
    <div className="space-y-3 py-4">
      {[52, 34, 64, 40, 58, 30].map((w, i) => (
        <div key={i} className={`flex ${i % 2 ? 'justify-end' : 'justify-start'}`}>
          <div className={`h-10 animate-pulse rounded-2xl ${i % 2 ? 'bg-emerald-100/80' : 'bg-white/80'}`} style={{ width: `${w}%` }} />
        </div>
      ))}
    </div>
  )
}

function EmptyThread({ onNewChat, onTemplates }: { onNewChat: () => void; onTemplates: () => void }) {
  return (
    <div className="relative grid flex-1 place-items-center overflow-hidden p-8 text-center">
      <div className="pointer-events-none absolute inset-0" style={DOODLE_BG} />
      <motion.div
        className="pointer-events-none absolute -left-24 top-10 h-72 w-72 rounded-full bg-emerald-300/20 blur-3xl"
        animate={{ x: [0, 40, 0], y: [0, 30, 0] }} transition={{ duration: 14, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.div
        className="pointer-events-none absolute -right-20 bottom-10 h-80 w-80 rounded-full bg-sky-300/20 blur-3xl"
        animate={{ x: [0, -30, 0], y: [0, -40, 0] }} transition={{ duration: 16, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }} className="relative">
        <div className="relative mx-auto h-24 w-24">
          {[0, 1].map(i => (
            <motion.span
              key={i}
              className="absolute inset-0 rounded-[28px] border-2 border-emerald-300"
              animate={{ scale: [1, 1.5], opacity: [0.6, 0] }}
              transition={{ duration: 2.4, repeat: Infinity, delay: i * 1.2, ease: 'easeOut' }}
            />
          ))}
          <motion.div
            className="relative grid h-24 w-24 place-items-center rounded-[28px] bg-gradient-to-br from-emerald-400 to-green-600 text-white shadow-2xl shadow-emerald-500/40"
            animate={{ y: [0, -6, 0] }} transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
          >
            <MessageCircle className="h-11 w-11" />
          </motion.div>
        </div>
        <p className="mt-6 text-xl font-extrabold tracking-tight text-slate-800">Select a conversation</p>
        <p className="mx-auto mt-1.5 max-w-sm text-sm text-slate-500">Pick a chat on the left to read the thread and reply — or start something new.</p>
        <div className="mt-5 flex justify-center gap-2">
          <motion.button whileHover={{ y: -2 }} whileTap={{ scale: 0.96 }} onClick={onNewChat} className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-emerald-500 to-green-600 px-4 py-2.5 text-[13px] font-bold text-white shadow-lg shadow-emerald-500/30">
            <MessageSquarePlus className="h-4 w-4" /> New chat
          </motion.button>
          <motion.button whileHover={{ y: -2 }} whileTap={{ scale: 0.96 }} onClick={onTemplates} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-[13px] font-bold text-slate-700 shadow-sm">
            <LayoutTemplate className="h-4 w-4 text-emerald-600" /> Templates
          </motion.button>
        </div>
        <p className="mt-6 text-[11px] text-slate-400">
          <kbd className="rounded border border-slate-200 bg-white px-1.5 py-0.5 font-mono">⌘K</kbd> search ·{' '}
          <kbd className="rounded border border-slate-200 bg-white px-1.5 py-0.5 font-mono">Alt ↑↓</kbd> switch chats
        </p>
      </motion.div>
    </div>
  )
}
