'use client'

/**
 * A complete conversation surface — header, stream, composer.
 *
 * One component, two hosts:
 *   <ChatThread compact />   the dock's mini box
 *   <ChatThread />           the full page's right-hand pane
 *
 * `compact` only changes chrome. Every capability — voice notes, record cards,
 * reactions, drag & drop, infinite scroll — is present in both, because a
 * feature written twice immediately becomes two features that differ.
 */

import { AnimatePresence, motion } from 'framer-motion'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AlertTriangle, ArrowLeft, Bell, BellOff, Download, Maximize2, Minus, Pin,
  RefreshCw, UserPlus, WifiOff, X,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { chatApi, useChat } from './chat-store'
import { Aurora, ConversationAvatar, SystemBadge, TypingDots, dayLabel } from './bits'
import { MessageBubble } from './message-bubble'
import { Composer } from './composer'
import { CardViewer, type CardTarget } from './card-viewer'
import type { ChatAttachment, ChatMessage } from './types'

/**
 * Fold incoming rows into the stream.
 *
 * Matched by client_uuid first so the sender's optimistic bubble is replaced
 * rather than duplicated, then by id so a row that arrives twice — from the
 * send response and from a tail read that raced it — is still one bubble.
 * Optimistic rows (id null) sort last, which is where they belong.
 */
function mergeMessages(prev: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  if (!incoming.length) return prev

  const next = [...prev]
  incoming.forEach(m => {
    const at = next.findIndex(x =>
      (m.client_uuid && x.client_uuid === m.client_uuid) || (m.id !== null && x.id === m.id))
    if (at > -1) next[at] = m
    else next.push(m)
  })

  return next.sort((a, b) => (a.id ?? Number.MAX_SAFE_INTEGER) - (b.id ?? Number.MAX_SAFE_INTEGER))
}

export function ChatThread({
  conversationId, compact, onBack, onMinimize, onClose, onManageMembers, onPopOut,
}: {
  conversationId: number | null
  compact?: boolean
  onBack?: () => void
  onMinimize?: () => void
  onClose?: () => void
  onManageMembers?: () => void
  onPopOut?: () => void
}) {
  const { me, byId, config, typing, live, connected, refresh, applyConversations, claimActive, toast } = useChat()
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [loading, setLoading] = useState(false)
  const [exhausted, setExhausted] = useState(false)
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null)
  const [card, setCard] = useState<CardTarget | null>(null)
  const [lightbox, setLightbox] = useState<ChatAttachment | null>(null)
  /** Set when the first page could not be read — never show an empty stream instead. */
  const [loadError, setLoadError] = useState<string | null>(null)
  /** Bumped to force the first page to be read again. */
  const [reloadKey, setReloadKey] = useState(0)
  /** True once the first page has landed; the tail read waits for it. */
  const [booted, setBooted] = useState(false)
  /** Bumped after every successful tail read, so a page-sized backlog drains. */
  const [tailNudge, setTailNudge] = useState(0)

  const streamRef = useRef<HTMLDivElement | null>(null)
  const lastIdRef = useRef(0)
  const oldestIdRef = useRef<number | null>(null)
  const readSentRef = useRef(0)
  const tailBusyRef = useRef(false)
  const lastIdConversationRef = useRef<number | null>(null)

  const conversation = conversationId ? byId.get(conversationId) ?? null : null

  const ids = messages.map(m => m.id).filter(Boolean) as number[]
  lastIdRef.current = ids.length ? Math.max(...ids) : 0
  oldestIdRef.current = ids.length ? Math.min(...ids) : null
  // Which conversation the two ids above belong to. Without this the cursors
  // outlive the thread they were measured in — see markRead().
  lastIdConversationRef.current = ids.length ? conversationId : null

  /* ---- the fast poll tier is claimed only while a thread is actually open -- */
  useEffect(() => {
    if (!conversationId) return
    return claimActive()
  }, [conversationId, claimActive])

  const nearBottom = () => {
    const el = streamRef.current
    return !el || el.scrollHeight - el.scrollTop - el.clientHeight < 130
  }

  const scrollToBottom = useCallback((instant = false) => {
    const el = streamRef.current
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: instant ? 'auto' : 'smooth' })
  }, [])

  /**
   * Move this conversation's read marker to the newest message ON SCREEN.
   *
   * The id has to be checked against the conversation it belongs to. This
   * component is reused when the page switches threads and by every dock box, so
   * `lastIdRef` could still hold the previous conversation's newest id — and ids
   * are global across conversations, so posting one meant "read up to a message
   * this thread has never seen". Production had exactly that: a thread whose
   * newest message was id 3 carried a read marker of 6, which silently swallows
   * the unread badge for anything in between.
   */
  const markRead = useCallback(() => {
    if (!conversationId || !lastIdRef.current) return
    if (lastIdConversationRef.current !== conversationId) return
    if (readSentRef.current >= lastIdRef.current) return

    readSentRef.current = lastIdRef.current
    void chatApi(`/conversations/${conversationId}/read`, { method: 'POST', body: { up_to: lastIdRef.current } })
      .then(() => refresh())
      .catch(() => { readSentRef.current = 0 })
  }, [conversationId, refresh])

  /* ---- open -------------------------------------------------------------- */

  useEffect(() => {
    if (!conversationId) { setMessages([]); setBooted(false); setLoadError(null); return }

    let cancelled = false
    setMessages([]); setExhausted(false); setReplyTo(null); setLoadError(null); setBooted(false)
    readSentRef.current = 0
    setLoading(true)

    chatApi<{ messages: ChatMessage[] }>(`/conversations/${conversationId}/messages`)
      .then(d => {
        if (cancelled) return
        setMessages(d.messages ?? [])
        if ((d.messages ?? []).length < config.page_size) setExhausted(true)
        setBooted(true)
        requestAnimationFrame(() => scrollToBottom(true))
      })
      .catch(err => {
        if (cancelled) return
        // An empty stream saying "No messages yet — say hello" is a lie when the
        // read failed, and it is precisely what made a broken read look like
        // missing messages. Keep the failure on screen with a way out.
        setLoadError(err?.message || 'These messages could not be loaded.')
      })
      .finally(() => { if (!cancelled) setLoading(false) })

    return () => { cancelled = true }
  }, [conversationId, config.page_size, scrollToBottom, reloadKey])

  // Mark read once the first page has landed.
  useEffect(() => { if (messages.length) markRead() }, [messages.length, markRead])

  /* ---- the tail read ----------------------------------------------------- */

  /**
   * Reconcile against the id the last pulse reported, rather than reacting to a
   * single "it moved" event.
   *
   * The event form dropped messages for good: if the fetch failed, or fired
   * while the first page was still in flight (whose result then replaced the
   * appended rows), nothing ever asked again — the message stayed invisible
   * until the conversation was reopened. Comparing the server's newest id with
   * the newest id on screen makes every following pulse a fresh chance to catch
   * up, so a failure costs a second and a half, not the message.
   */
  const serverLastId = conversationId ? (live[conversationId]?.last_id ?? 0) : 0

  useEffect(() => {
    if (!conversationId || !booted) return
    if (!serverLastId || serverLastId <= lastIdRef.current) return
    if (tailBusyRef.current) return

    tailBusyRef.current = true
    const wasAtBottom = nearBottom()
    const from = lastIdRef.current

    chatApi<{ messages: ChatMessage[] }>(`/conversations/${conversationId}/messages?after=${from}`)
      .then(d => {
        const fresh = d.messages ?? []
        if (!fresh.length) return
        setMessages(prev => mergeMessages(prev, fresh))
        // More may be waiting than one page holds — ask again now that the
        // cursor has moved.
        setTailNudge(n => n + 1)
        if (wasAtBottom) requestAnimationFrame(() => { scrollToBottom(); markRead() })
      })
      // Deliberately quiet: the next pulse sees the same gap and retries.
      .catch(() => {})
      .finally(() => { tailBusyRef.current = false })
  }, [serverLastId, tailNudge, booted, conversationId, scrollToBottom, markRead])

  /**
   * An edit, a delete or a reaction changes a message without creating a new id,
   * so the cursor above cannot see it. `touched_at` moves instead, and the page
   * on screen is re-read and merged — the merge is by id, so bubbles are updated
   * in place rather than duplicated.
   */
  const touchedAt = conversationId ? (live[conversationId]?.touched_at ?? null) : null

  useEffect(() => {
    if (!conversationId || !booted || !touchedAt || !messages.length) return

    const limit = Math.min(Math.max(messages.length, 20), 60)
    chatApi<{ messages: ChatMessage[] }>(`/conversations/${conversationId}/messages?limit=${limit}`)
      .then(d => { if (d.messages?.length) setMessages(prev => mergeMessages(prev, d.messages)) })
      .catch(() => {})
    // messages.length is read, not depended on: re-reading whenever the stream
    // grows would undo the point of the cursor above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [touchedAt, conversationId, booted])

  /* ---- infinite scroll upwards ------------------------------------------- */

  const onScroll = () => {
    const el = streamRef.current
    if (!el || loading || exhausted || !oldestIdRef.current || el.scrollTop > 90) {
      if (nearBottom()) markRead()
      return
    }

    setLoading(true)
    const keepHeight = el.scrollHeight

    chatApi<{ messages: ChatMessage[] }>(`/conversations/${conversationId}/messages?before=${oldestIdRef.current}`)
      .then(d => {
        const older = d.messages ?? []
        if (!older.length) { setExhausted(true); return }
        setMessages(prev => [...older, ...prev])
        // Hold the reading position: the user was looking at a message, not at a
        // scroll offset.
        requestAnimationFrame(() => { el.scrollTop = el.scrollHeight - keepHeight })
      })
      .finally(() => setLoading(false))
  }

  /* ---- actions ----------------------------------------------------------- */

  const send = (payload: Parameters<React.ComponentProps<typeof Composer>['onSend']>[0]) => {
    if (!conversationId || !me) return

    // Optimistic bubble — the reply appears before the round trip and is replaced
    // by the server's copy (matched on client_uuid) when it lands.
    const optimistic: ChatMessage = {
      id: null,
      conversation_id: conversationId,
      kind: payload.kind === 'card' ? 'text' : (payload.kind as ChatMessage['kind']),
      body: payload.body ?? (payload.card_ref ? `Sharing ${payload.card_ref}…` : ''),
      sender: me,
      client_uuid: payload.client_uuid,
      created_at: new Date().toISOString(),
      edited_at: null,
      deleted: false,
      card: null,
      reply_to: replyTo ? { id: replyTo.id!, sender: replyTo.sender.name, preview: (replyTo.body ?? '').slice(0, 100) } : null,
      attachments: [],
      reactions: [],
    }
    setMessages(prev => [...prev, optimistic])
    requestAnimationFrame(() => scrollToBottom())

    chatApi<{ message: ChatMessage; conversations: never[] }>(`/conversations/${conversationId}/messages`, {
      method: 'POST', body: payload,
    })
      .then(d => {
        // The same merge the tail read uses: the server copy replaces the
        // optimistic bubble whether it is matched by uuid or by id, and a tail
        // read that raced this response cannot leave a duplicate behind.
        setMessages(prev => mergeMessages(prev, [d.message]))
        applyConversations(d.conversations ?? [])
        requestAnimationFrame(() => scrollToBottom())
      })
      .catch(err => {
        // Take the optimistic bubble back rather than leaving a message on screen
        // that does not exist anywhere.
        setMessages(prev => prev.filter(m => m.client_uuid !== payload.client_uuid))
        toast(err.message, 'bad')
      })
  }

  const react = (messageId: number, emoji: string) => {
    chatApi<{ message: ChatMessage }>(`/messages/${messageId}/react`, { method: 'POST', body: { emoji } })
      .then(d => setMessages(prev => prev.map(m => (m.id === messageId ? d.message : m))))
      .catch(err => toast(err.message, 'bad'))
  }

  const edit = (message: ChatMessage) => {
    const next = window.prompt('Edit message', message.body ?? '')
    if (next === null || !next.trim() || next === message.body) return
    chatApi<{ message: ChatMessage }>(`/messages/${message.id}`, { method: 'PATCH', body: { body: next } })
      .then(d => setMessages(prev => prev.map(m => (m.id === message.id ? d.message : m))))
      .catch(err => toast(err.message, 'bad'))
  }

  const remove = (messageId: number) => {
    if (!window.confirm('Delete this message for everyone?')) return
    chatApi<{ message: ChatMessage }>(`/messages/${messageId}`, { method: 'DELETE' })
      .then(d => { setMessages(prev => prev.map(m => (m.id === messageId ? d.message : m))); void refresh() })
      .catch(err => toast(err.message, 'bad'))
  }

  const toggleFlag = (kind: 'pin' | 'mute') => {
    if (!conversation) return
    const body = kind === 'pin'
      ? { pinned: !conversation.is_pinned }
      : { hours: conversation.is_muted ? null : 8 }
    void chatApi(`/conversations/${conversation.id}/${kind}`, { method: 'POST', body }).then(() => refresh())
  }

  /* ---- empty ------------------------------------------------------------- */

  if (!conversationId || !conversation) {
    return (
      <div className={cn('flex min-w-0 flex-col overflow-hidden bg-white', !compact && 'rounded-3xl border border-slate-200 shadow-sm')}>
        <div className="grid flex-1 place-items-center p-10 text-center text-slate-400">
          <div>
            <motion.div animate={{ y: [0, -8, 0] }} transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }} className="mb-3 text-4xl">💬</motion.div>
            <p className="text-sm">Pick a conversation, or start a new one.</p>
          </div>
        </div>
      </div>
    )
  }

  const typingNames = typing[conversation.id] ?? []
  let lastDay = ''
  let lastSender = ''

  return (
    <div className={cn('flex min-w-0 flex-1 flex-col overflow-hidden bg-white', !compact && 'rounded-3xl border border-slate-200 shadow-sm')}>
      {/* ---- header ---- */}
      <header
        className={cn(
          'relative flex flex-shrink-0 items-center gap-3 overflow-hidden text-white',
          compact ? 'cursor-pointer px-3 py-2.5' : 'px-5 py-3',
        )}
        style={{
          background: conversation.peer?.system === 'ops' || conversation.type === 'group'
            ? 'linear-gradient(120deg,#1e1b4b 0%,#312e81 70%,#6366f1 150%)'
            : 'linear-gradient(120deg,#0f172a 0%,#134e4a 68%,#0d9488 140%)',
        }}
        onClick={compact ? onMinimize : undefined}
      >
        {!compact && <Aurora />}

        {onBack && (
          <button onClick={e => { e.stopPropagation(); onBack() }} className="relative z-[2] rounded-xl p-2 hover:bg-white/15 lg:hidden">
            <ArrowLeft className="h-4 w-4" />
          </button>
        )}

        <div className="relative z-[2]"><ConversationAvatar conversation={conversation} size={compact ? 34 : 40} /></div>

        <div className="relative z-[2] min-w-0 flex-1">
          <div className="flex items-center gap-2 truncate text-[1rem] font-extrabold tracking-tight">
            <span className="truncate">{conversation.type === 'group' ? `${conversation.emoji ?? '💬'} ${conversation.title}` : conversation.title}</span>
            {conversation.peer && <SystemBadge system={conversation.peer.system} />}
            {conversation.type === 'group' && conversation.cross_system && <SystemBadge system="ops" label="CROSS" />}
          </div>
          <div className="truncate text-[.68rem] font-semibold text-teal-200">
            {conversation.type === 'group'
              ? `${conversation.member_count} members${conversation.cross_system ? ' · Accounts + Operations' : ''}`
              : (conversation.peer?.is_online ? 'Online now' : conversation.peer?.role_label ?? '')}
          </div>
        </div>

        <div className="relative z-[2] ml-auto flex items-center gap-0.5" onClick={e => e.stopPropagation()}>
          {compact ? (
            <>
              <HeaderButton title="Open in full page" onClick={onPopOut}><Maximize2 className="h-3.5 w-3.5" /></HeaderButton>
              <HeaderButton title="Minimise" onClick={onMinimize}><Minus className="h-3.5 w-3.5" /></HeaderButton>
              <HeaderButton title="Close" onClick={onClose}><X className="h-3.5 w-3.5" /></HeaderButton>
            </>
          ) : (
            <>
              <HeaderButton title={conversation.is_pinned ? 'Unpin' : 'Pin to top'} active={conversation.is_pinned} onClick={() => toggleFlag('pin')}>
                <Pin className="h-4 w-4" />
              </HeaderButton>
              <HeaderButton title={conversation.is_muted ? 'Unmute' : 'Mute for 8 hours'} active={conversation.is_muted} onClick={() => toggleFlag('mute')}>
                {conversation.is_muted ? <BellOff className="h-4 w-4" /> : <Bell className="h-4 w-4" />}
              </HeaderButton>
              {conversation.type === 'group' && onManageMembers && (
                <HeaderButton title="Members" onClick={onManageMembers}><UserPlus className="h-4 w-4" /></HeaderButton>
              )}
            </>
          )}
        </div>
      </header>

      {/* ---- stream ---- */}
      <div
        ref={streamRef}
        onScroll={onScroll}
        className={cn('min-h-0 flex-1 overflow-y-auto', compact ? 'px-3.5 pb-1 pt-3.5' : 'px-6 pb-2 pt-5')}
        style={{
          background:
            'radial-gradient(900px 420px at 88% -8%, rgba(99,102,241,.07), transparent 62%),'
            + 'radial-gradient(760px 380px at 4% 104%, rgba(13,148,136,.08), transparent 60%), #f6f8fb',
        }}
      >
        {/* Live or not live is never left to be guessed from an absence of messages. */}
        {!connected && (
          <div className="sticky top-0 z-10 mb-2 flex items-center justify-center gap-2 rounded-xl border border-amber-300 bg-amber-50/95 px-3 py-1.5 text-[.7rem] font-bold text-amber-800">
            <WifiOff className="h-3.5 w-3.5" /> Reconnecting — new messages may be delayed
          </div>
        )}

        {loading && !messages.length && (
          <div className="space-y-3">
            {[72, 96, 60, 110].map((h, i) => (
              <div key={i} className={cn('animate-pulse rounded-2xl bg-slate-200/70', i % 2 && 'ml-auto')} style={{ height: h, width: `${48 + i * 7}%` }} />
            ))}
          </div>
        )}

        {/* A failed read is never dressed up as an empty conversation. */}
        {!loading && loadError && (
          <div className="grid place-items-center py-14 text-center">
            <div className="max-w-sm rounded-2xl border border-rose-200 bg-rose-50/80 px-5 py-4">
              <AlertTriangle className="mx-auto mb-2 h-6 w-6 text-rose-600" />
              <p className="text-[.82rem] font-bold text-rose-800">This conversation could not be loaded</p>
              <p className="mt-1 text-[.72rem] text-rose-700/80">{loadError}</p>
              <button
                onClick={() => { setLoadError(null); setReloadKey(k => k + 1) }}
                className="mt-3 inline-flex items-center gap-2 rounded-xl bg-rose-700 px-3.5 py-2 text-[.75rem] font-bold text-white transition hover:bg-rose-800 active:scale-95"
              >
                <RefreshCw className="h-3.5 w-3.5" /> Try again
              </button>
            </div>
          </div>
        )}

        {!loading && !loadError && !messages.length && (
          <div className="grid place-items-center py-16 text-center text-slate-400">
            <div>
              <div className="mb-2 text-3xl">✍️</div>
              <p className="text-sm">No messages yet — say hello.</p>
            </div>
          </div>
        )}

        {messages.map(m => {
          const day = m.created_at ? new Date(m.created_at).toDateString() : ''
          const showDay = Boolean(day) && day !== lastDay
          if (showDay) { lastDay = day; lastSender = '' }

          const senderKey = m.kind === 'system' ? '' : m.sender.key
          const isFirst = senderKey !== lastSender || m.kind === 'system'
          lastSender = m.kind === 'system' ? '' : senderKey

          return (
            <div key={m.id ?? m.client_uuid ?? Math.random()}>
              {showDay && (
                <div className="my-4 flex items-center gap-3">
                  <span className="h-px flex-1 bg-gradient-to-r from-transparent via-slate-200 to-transparent" />
                  <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-[.62rem] font-extrabold uppercase tracking-[.1em] text-slate-400">
                    {dayLabel(m.created_at!)}
                  </span>
                  <span className="h-px flex-1 bg-gradient-to-r from-transparent via-slate-200 to-transparent" />
                </div>
              )}
              <MessageBubble
                message={m}
                mine={Boolean(me && m.sender.key === me.key)}
                isFirst={isFirst}
                myKey={me?.key ?? null}
                ttlDays={config.media_ttl_days}
                onReact={react}
                onReply={setReplyTo}
                onEdit={edit}
                onDelete={remove}
                onOpenCard={(type, ref) => setCard({ type, ref, conversationId: conversation.id })}
                onLightbox={setLightbox}
              />
            </div>
          )
        })}
      </div>

      {/* ---- typing ---- */}
      <div className={cn('flex min-h-[26px] items-center gap-2 text-[.72rem] font-semibold text-slate-500', compact ? 'px-3.5 pb-1.5' : 'px-6 pb-2.5')}>
        {!!typingNames.length && (
          <>
            <TypingDots />
            <span>{typingNames.length === 1 ? `${typingNames[0]} is typing…` : `${typingNames.join(', ')} are typing…`}</span>
          </>
        )}
      </div>

      <Composer
        conversationId={conversation.id}
        compact={compact}
        replyTo={replyTo}
        onClearReply={() => setReplyTo(null)}
        onSend={send}
        onError={m => toast(m, 'bad')}
      />

      <CardViewer target={card} onClose={() => setCard(null)} />

      {/* ---- image lightbox ---- */}
      <AnimatePresence>
        {lightbox?.url && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={() => setLightbox(null)}
            className="fixed inset-0 z-[130] flex cursor-zoom-out items-center justify-center bg-slate-950/95"
          >
            <div className="absolute inset-x-0 top-0 flex items-center gap-3 bg-gradient-to-b from-slate-950/80 to-transparent px-6 py-4 text-white">
              <b className="text-[.85rem] font-bold">{lightbox.name}</b>
              <a
                href={`${lightbox.url}${lightbox.url.includes('?') ? '&' : '?'}download=1`}
                onClick={e => e.stopPropagation()}
                className="ml-auto flex items-center gap-2 rounded-xl border border-white/25 bg-white/10 px-3.5 py-2 text-[.78rem] font-bold hover:bg-white/20"
              >
                <Download className="h-3.5 w-3.5" /> Download
              </a>
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <motion.img
              initial={{ scale: 0.94, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
              src={lightbox.url} alt={lightbox.name}
              onClick={e => e.stopPropagation()}
              className="max-h-[88vh] max-w-[94vw] rounded-2xl shadow-2xl"
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function HeaderButton({ children, title, onClick, active }: { children: React.ReactNode; title: string; onClick?: () => void; active?: boolean }) {
  return (
    <button
      title={title}
      onClick={onClick}
      className={cn(
        'grid h-8 w-8 place-items-center rounded-xl transition active:scale-90',
        active ? 'bg-white text-slate-900' : 'text-slate-200 hover:bg-white/15 hover:text-white',
      )}
    >
      {children}
    </button>
  )
}
