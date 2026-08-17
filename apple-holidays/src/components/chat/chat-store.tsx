'use client'

/**
 * The chat store — shared state and the one poll loop.
 *
 * Mounted once, in the dashboard shell, so every surface (the full page, each
 * mini dock box, the header badge) reads the same conversations and the same
 * unread counts, and ten open surfaces still cost exactly one request per tick.
 *
 * WHY POLLING
 * -----------
 * Neither system has a socket server, and both talk to one shared production
 * database. So the client asks "anything after message id N?" on an interval
 * that follows what the user is doing — fast while a thread is open and focused,
 * slower when idle, much slower when the tab is in the background. The `pulse`
 * request behind it is a single indexed range read, and threads whose id has not
 * moved are never fetched at all.
 *
 * The Accounts app runs the identical protocol from vanilla JS
 * (public/js/chat.js), which is why a message sent there lands here without
 * either system knowing the other exists.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ChatConfig, ChatConversation, ChatPerson, ChatSettings } from './types'

/* ── fetch helper ──────────────────────────────────────────────────────────── */

export async function chatApi<T = Record<string, unknown>>(
  path: string,
  opts: { method?: string; body?: unknown } = {},
): Promise<T> {
  const res = await fetch(`/api/chat${path}`, {
    method: opts.method ?? 'GET',
    headers: opts.body ? { 'Content-Type': 'application/json' } : undefined,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    credentials: 'same-origin',
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((json as { message?: string })?.message || `Request failed (${res.status})`)
  return json as T
}

/* ── context ───────────────────────────────────────────────────────────────── */

interface ChatStore {
  ready: boolean
  me: ChatPerson | null
  config: ChatConfig
  settings: ChatSettings
  conversations: ChatConversation[]
  byId: Map<number, ChatConversation>
  totalUnread: number
  typing: Record<number, string[]>
  /** Bumped whenever a thread gains new messages, so surfaces can tail-read. */
  moved: { ids: number[]; at: number }
  /**
   * The newest state the server reported per thread, refreshed by every pulse.
   *
   * This is the number a thread reconciles itself against, rather than a
   * one-shot "it moved" event: if a tail read fails, or lands while the first
   * page is still in flight, the next pulse still says "the newest id here is
   * 812" and the thread notices it is behind and fetches again. A missed fetch
   * used to mean the message stayed invisible until the thread was reopened.
   */
  live: Record<number, { last_id: number; unread: number; touched_at: string | null }>
  /** False once the poll has failed repeatedly — the UI says so rather than going quiet. */
  connected: boolean
  /** True when messages are arriving over the push channel rather than being polled for. */
  pushLive: boolean
  /** Set when the first load failed outright, so surfaces can offer a retry. */
  error: string | null
  /** Load everything again after a failure. */
  retry: () => void

  refresh: () => Promise<void>
  applyConversations: (list: ChatConversation[]) => void
  /** Declare a conversation "open and being looked at" — drives the fast tier. */
  claimActive: () => () => void
  /** Ridden along on the next pulse; nothing extra is sent. */
  setTyping: (conversationId: number | null) => void

  dock: DockEntry[]
  openInDock: (conversationId: number, minimized?: boolean) => void
  minimizeInDock: (conversationId: number) => void
  expandInDock: (conversationId: number) => void
  closeInDock: (conversationId: number) => void

  toast: (message: string, tone?: 'bad' | 'info', onClick?: () => void) => void
  toasts: Toast[]
  dismissToast: (id: number) => void
}

export interface DockEntry { id: number; minimized: boolean }
export interface Toast { id: number; message: string; tone: 'bad' | 'info'; onClick?: () => void }

const DEFAULT_CONFIG: ChatConfig = {
  poll: { active: 1500, idle: 5000, background: 20000 },
  systems: {
    accounts: { label: 'Accounts', short: 'ACC', accent: '#0d9488' },
    ops: { label: 'Operations', short: 'OPS', accent: '#6366f1' },
  },
  cards: {},
  media_ttl_days: 10,
  max_upload_mb: 25,
  page_size: 40,
}

const Ctx = createContext<ChatStore | null>(null)

export function useChat(): ChatStore {
  const store = useContext(Ctx)
  if (!store) throw new Error('useChat must be used inside <ChatProvider>')
  return store
}

/** Safe variant for components that may render outside the provider. */
export function useChatOptional(): ChatStore | null {
  return useContext(Ctx)
}

/* ── cheap equality, so a 1.5s poll does not re-render the app every tick ─── */

type LiveMap = Record<number, { last_id: number; unread: number; touched_at: string | null }>

function sameLive(a: LiveMap, b: LiveMap): boolean {
  const ka = Object.keys(a), kb = Object.keys(b)
  if (ka.length !== kb.length) return false
  return ka.every(k => {
    const x = a[Number(k)], y = b[Number(k)]
    return y && x.last_id === y.last_id && x.unread === y.unread && x.touched_at === y.touched_at
  })
}

function sameTyping(a: Record<number, string[]>, b: Record<number, string[]>): boolean {
  const ka = Object.keys(a), kb = Object.keys(b)
  if (ka.length !== kb.length) return false
  return ka.every(k => {
    const x = a[Number(k)], y = b[Number(k)]
    return y && x.length === y.length && x.every((n, i) => n === y[i])
  })
}

/* ── the notification chime, synthesised so there is no asset to ship ─────── */

function chime() {
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return
    const ctx = new Ctor()
    ;[[880, 0], [1320, 0.09]].forEach(([freq, delay]) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = freq
      osc.connect(gain); gain.connect(ctx.destination)
      const t = ctx.currentTime + delay
      gain.gain.setValueAtTime(0.0001, t)
      gain.gain.exponentialRampToValueAtTime(0.06, t + 0.015)
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.22)
      osc.start(t); osc.stop(t + 0.24)
    })
    setTimeout(() => { void ctx.close() }, 700)
  } catch { /* audio is a nicety, never an error */ }
}

/* ── provider ──────────────────────────────────────────────────────────────── */

export function ChatProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false)
  const [me, setMe] = useState<ChatPerson | null>(null)
  const [config, setConfig] = useState<ChatConfig>(DEFAULT_CONFIG)
  const [settings, setSettings] = useState<ChatSettings>({
    sound_enabled: true, desktop_notifications: true, enter_to_send: true, theme: 'aurora', dock_state: [],
  })
  const [conversations, setConversations] = useState<ChatConversation[]>([])
  const [totalUnread, setTotalUnread] = useState(0)
  const [typing, setTyping] = useState<Record<number, string[]>>({})
  const [moved, setMoved] = useState<{ ids: number[]; at: number }>({ ids: [], at: 0 })
  const [live, setLive] = useState<Record<number, { last_id: number; unread: number; touched_at: string | null }>>({})
  const [connected, setConnected] = useState(true)
  /** True while the hub is pushing; false means the poll is carrying the load. */
  const [pushLive, setPushLive] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [bootAttempt, setBootAttempt] = useState(0)
  const [dock, setDock] = useState<DockEntry[]>([])
  const [toasts, setToasts] = useState<Toast[]>([])

  // Refs, not state: these are read inside the poll loop and must never cause it
  // to re-subscribe.
  const activeCount = useRef(0)
  const typingIn = useRef<number | null>(null)
  const lastIds = useRef<Map<number, number>>(new Map())
  const settingsRef = useRef(settings)
  const meRef = useRef<ChatPerson | null>(null)
  const convRef = useRef<ChatConversation[]>([])
  /** Last time a "typing" ping went out, so a fast typist sends one every 3s. */
  const typingSentAt = useRef(0)
  const pushLiveRef = useRef(false)
  const dockRef = useRef<DockEntry[]>([])
  const restored = useRef(false)
  const toastSeq = useRef(0)
  // The poll loop compares against the previous total to decide whether a change
  // is "something new arrived" or just a read marker moving. Kept in a ref so
  // the loop does not re-subscribe every time the badge changes.
  const totalUnreadRef = useRef(0)

  settingsRef.current = settings
  meRef.current = me
  pushLiveRef.current = pushLive
  totalUnreadRef.current = totalUnread
  convRef.current = conversations
  dockRef.current = dock

  const applyConversations = useCallback((list: ChatConversation[]) => {
    setConversations(list)
    setTotalUnread(list.reduce((sum, c) => sum + (c.unread || 0), 0))
  }, [])

  const refresh = useCallback(async () => {
    const d = await chatApi<{ conversations: ChatConversation[] }>('/conversations')
    applyConversations(d.conversations ?? [])
  }, [applyConversations])

  const toast = useCallback((message: string, tone: 'bad' | 'info' = 'info', onClick?: () => void) => {
    const id = ++toastSeq.current
    setToasts(prev => [...prev, { id, message, tone, onClick }])
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), onClick ? 7000 : 4200)
  }, [])

  const dismissToast = useCallback((id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])

  /* ---- the dock ---------------------------------------------------------- */

  const persistDock = useCallback((entries: DockEntry[]) => {
    void chatApi('/dock', {
      method: 'PUT',
      body: { dock: entries.map(e => ({ conversation_id: e.id, minimized: e.minimized })) },
    }).catch(() => { /* the dock is a convenience, never a blocker */ })
  }, [])

  const openInDock = useCallback((conversationId: number, minimized = false) => {
    setDock(prev => {
      if (prev.some(e => e.id === conversationId)) {
        const next = prev.map(e => (e.id === conversationId ? { ...e, minimized: false } : e))
        persistDock(next); return next
      }
      // Three open boxes is already a busy screen — the oldest gives way.
      const open = prev.filter(e => !e.minimized)
      let next = prev
      if (!minimized && open.length >= 3) {
        next = prev.map(e => (e.id === open[0].id ? { ...e, minimized: true } : e))
      }
      next = [...next, { id: conversationId, minimized }]
      persistDock(next)
      return next
    })
  }, [persistDock])

  const minimizeInDock = useCallback((id: number) => {
    setDock(prev => { const next = prev.map(e => (e.id === id ? { ...e, minimized: true } : e)); persistDock(next); return next })
  }, [persistDock])

  const expandInDock = useCallback((id: number) => {
    setDock(prev => {
      const open = prev.filter(e => !e.minimized && e.id !== id)
      let next = prev
      if (open.length >= 3) next = prev.map(e => (e.id === open[0].id ? { ...e, minimized: true } : e))
      next = next.map(e => (e.id === id ? { ...e, minimized: false } : e))
      persistDock(next); return next
    })
  }, [persistDock])

  const closeInDock = useCallback((id: number) => {
    setDock(prev => { const next = prev.filter(e => e.id !== id); persistDock(next); return next })
  }, [persistDock])

  /* ---- active-surface accounting ---------------------------------------- */

  const claimActive = useCallback(() => {
    activeCount.current++
    return () => { activeCount.current = Math.max(0, activeCount.current - 1) }
  }, [])

  /**
   * Say "typing" the cheapest way available.
   *
   * On the push path that is one POST at most every three seconds, and it is
   * never written down. On the poll path it rides along on the next pulse, as
   * before, so behaviour is unchanged where the hub is not running.
   */
  const declareTyping = useCallback((conversationId: number | null) => {
    typingIn.current = conversationId

    if (!pushLiveRef.current || !conversationId) return
    const now = Date.now()
    if (now - typingSentAt.current < 3000) return
    typingSentAt.current = now
    void chatApi('/typing', { method: 'POST', body: { conversation_id: conversationId } }).catch(() => {})
  }, [])

  /* ---- boot -------------------------------------------------------------- */

  const retry = useCallback(() => {
    setError(null)
    setBootAttempt(n => n + 1)
  }, [])

  useEffect(() => {
    let cancelled = false
    let retryTimer: ReturnType<typeof setTimeout> | null = null

    chatApi<{ me: ChatPerson; conversations: ChatConversation[]; settings: ChatSettings; config: ChatConfig }>('/bootstrap')
      .then(d => {
        if (cancelled) return
        setMe(d.me)
        setConfig(d.config ?? DEFAULT_CONFIG)
        setSettings(d.settings)
        applyConversations(d.conversations ?? [])
        setError(null)
        setConnected(true)
        setReady(true)

        // Restore the boxes this person had open. Not on the full chat page — a
        // floating copy of what is already on screen is clutter.
        if (!restored.current && !window.location.pathname.startsWith('/dashboard/chat')) {
          restored.current = true
          const known = new Set((d.conversations ?? []).map(c => c.id))
          const entries = (d.settings?.dock_state ?? [])
            .filter(e => known.has(e.conversation_id))
            .slice(0, 4)
            .map(e => ({ id: e.conversation_id, minimized: e.minimized }))
          if (entries.length) setDock(entries)
        }
      })
      .catch((err: Error) => {
        if (cancelled) return
        // Never fail silently: an empty rail with no explanation is
        // indistinguishable from "you have no conversations", which is what
        // made a failed load look like missing messages. Say so, keep trying,
        // and let the user force a retry.
        setError(err?.message || 'Chat could not be loaded.')
        setConnected(false)
        setReady(true)
        retryTimer = setTimeout(() => { if (!cancelled) setBootAttempt(n => n + 1) }, 8000)
      })

    return () => {
      cancelled = true
      if (retryTimer) clearTimeout(retryTimer)
    }
  }, [applyConversations, bootAttempt])

  /* ---- the live stream (push) -------------------------------------------- */

  /**
   * One SSE connection carries everything the poll used to ask for.
   *
   * The events are deliberately thin — "thread 4's newest id is 812", never the
   * message itself. The client compares that with what it holds and reads the
   * gap over its own authenticated API, which is the same reconciliation the
   * poll drove, so nothing downstream had to change and no message content
   * passes through the hub.
   *
   * If this never connects, `pushLive` stays false and the poll below runs as
   * before. Chat is never worse than it was.
   */
  useEffect(() => {
    if (!ready) return

    let closed = false
    let source: EventSource | null = null
    let renewTimer: ReturnType<typeof setTimeout> | null = null
    let retryTimer: ReturnType<typeof setTimeout> | null = null
    let attempt = 0

    /**
     * Everything below is a hint to re-read; the read itself is what is trusted.
     *
     * `lastId` moves the cursor an open thread chases. `touched` is for changes
     * that create no new id — an edit, a delete, a reaction — and is kept
     * separate so a plain message does not also trigger a whole-page re-read.
     */
    const bump = (conversationId: number, opts: { lastId?: number; touched?: boolean } = {}) => {
      if (!conversationId) return
      setLive(prev => {
        const known = prev[conversationId]
        const lastIdNext = Math.max(opts.lastId ?? 0, known?.last_id ?? 0)
        const touchedNext = opts.touched ? new Date().toISOString() : (known?.touched_at ?? null)
        if (known && known.last_id === lastIdNext && known.touched_at === touchedNext) return prev
        return { ...prev, [conversationId]: { last_id: lastIdNext, unread: known?.unread ?? 0, touched_at: touchedNext } }
      })
    }

    const onMessage = (data: Record<string, unknown>) => {
      const conversationId = Number(data.conversation_id)
      const lastId = Number(data.last_id ?? 0)
      if (!conversationId) return

      bump(conversationId, { lastId })
      lastIds.current.set(conversationId, Math.max(lastId, lastIds.current.get(conversationId) ?? 0))
      setMoved({ ids: [conversationId], at: Date.now() })

      // Previews, ordering and unread counts still come from the API — one read
      // per actual message instead of one every 1.5 seconds.
      void refresh().catch(() => {})

      const mine = meRef.current && data.from === meRef.current.key
      if (mine || String(data.kind) === 'system') return

      if (settingsRef.current.sound_enabled) chime()

      const openIds = new Set(dockRef.current.filter(e => !e.minimized).map(e => e.id))
      if (openIds.has(conversationId)) return
      if (window.location.pathname.startsWith('/dashboard/chat')) return

      const conv = convRef.current.find(c => c.id === conversationId)
      if (conv?.is_muted) return

      toast(
        `${conv?.title ?? String(data.from_name ?? 'New message')}: ${String(data.preview ?? '')}`.trim(),
        'info',
        () => openInDock(conversationId),
      )
    }

    const onTyping = (data: Record<string, unknown>) => {
      const conversationId = Number(data.conversation_id)
      const name = String(data.name ?? '')
      if (!conversationId || !name) return

      setTyping(prev => {
        const others = (prev[conversationId] ?? []).filter(n => n !== name)
        const next = data.stopped ? others : [...others, name]
        return { ...prev, [conversationId]: next }
      })

      // Typing is a lease, not a state: without another event it lapses, so a
      // closed tab cannot leave "…is typing" on screen.
      const lease = Number(data.lease_ms ?? 5000)
      window.setTimeout(() => {
        setTyping(prev => ({ ...prev, [conversationId]: (prev[conversationId] ?? []).filter(n => n !== name) }))
      }, lease)
    }

    const connect = async () => {
      if (closed) return

      let pass: { url: string | null; ticket: string | null; renew_in_seconds: number }
      try {
        pass = await chatApi('/live')
      } catch {
        // The hub may simply not be configured; fall back and stop asking.
        setPushLive(false)
        return
      }
      if (closed || !pass?.url || !pass.ticket) { setPushLive(false); return }

      source = new EventSource(`${pass.url}?ticket=${encodeURIComponent(pass.ticket)}`)

      source.addEventListener('hello', () => {
        attempt = 0
        setPushLive(true)
        setConnected(true)
        // A connection is also a gap: anything that happened while it was down
        // is found by one reconcile, which is why nothing has to be replayed.
        void refresh().catch(() => {})
      })

      source.addEventListener('message', e => { try { onMessage(JSON.parse((e as MessageEvent).data)) } catch { /* ignore */ } })
      source.addEventListener('typing', e => { try { onTyping(JSON.parse((e as MessageEvent).data)) } catch { /* ignore */ } })

      source.addEventListener('touch', e => {
        try {
          const data = JSON.parse((e as MessageEvent).data)
          bump(Number(data.conversation_id), { touched: true })
          void refresh().catch(() => {})
        } catch { /* ignore */ }
      })

      source.addEventListener('read', e => {
        try { bump(Number(JSON.parse((e as MessageEvent).data).conversation_id)) } catch { /* ignore */ }
        void refresh().catch(() => {})
      })

      source.addEventListener('conversation', () => { void refresh().catch(() => {}) })

      source.addEventListener('presence', () => { void 0 /* the dot is refreshed with the next read */ })

      // The hub closes the stream when the ticket lapses; renew a little early.
      if (pass.renew_in_seconds) {
        renewTimer = setTimeout(() => {
          source?.close()
          void connect()
        }, pass.renew_in_seconds * 1000)
      }

      source.onerror = () => {
        // EventSource retries on its own while the connection is merely dropped;
        // a CLOSED state means the ticket was rejected and a new one is needed.
        if (closed || !source || source.readyState !== EventSource.CLOSED) return
        source.close()
        setPushLive(false)
        attempt++
        retryTimer = setTimeout(() => void connect(), Math.min(2000 * attempt, 30_000))
      }
    }

    void connect()

    return () => {
      closed = true
      if (renewTimer) clearTimeout(renewTimer)
      if (retryTimer) clearTimeout(retryTimer)
      source?.close()
      setPushLive(false)
    }
  }, [ready, refresh, toast, openInDock])

  /* ---- presence, and the reconcile that makes push safe ------------------ */

  useEffect(() => {
    if (!ready || !pushLive) return

    // One write every 30 seconds while the tab is visible, instead of one per
    // poll tick. The instant part of presence comes from the hub.
    const beat = () => {
      if (document.hidden) return
      void chatApi('/presence', { method: 'POST', body: {} }).catch(() => {})
    }
    beat()
    const timer = setInterval(beat, 30_000)

    // Coming back to the tab is the one moment worth re-checking unconditionally:
    // a laptop that slept missed its events, and this costs a single request.
    const onFocus = () => { if (!document.hidden) void refresh().catch(() => {}) }
    document.addEventListener('visibilitychange', onFocus)
    window.addEventListener('focus', onFocus)

    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onFocus)
      window.removeEventListener('focus', onFocus)
    }
  }, [ready, pushLive, refresh])

  /* ---- the poll loop: fallback and safety net ---------------------------- */

  useEffect(() => {
    if (!ready) return

    let timer: ReturnType<typeof setTimeout> | null = null
    let stopped = false
    // Consecutive pulse failures. A blip is normal on a shared database; a run
    // of them means the client is not live any more and has to say so.
    let failures = 0

    const interval = () => {
      // While the push channel is up this is only a safety net: one request a
      // minute with a thread open and focused, five minutes otherwise. It exists
      // so that a lost event costs a delay rather than a missing message.
      if (pushLive) {
        return activeCount.current > 0 && document.hasFocus() && !document.hidden ? 60_000 : 300_000
      }

      const base = document.hidden
        ? config.poll.background
        // "Active" means a thread is actually on screen and being used.
        : (activeCount.current > 0 && document.hasFocus() ? config.poll.active : config.poll.idle)
      // Back off while the server is unhappy rather than hammering it at 1.5s.
      return failures ? Math.min(base * Math.min(failures, 6), 30_000) : base
    }

    const tick = async () => {
      const typingParam = typingIn.current
      typingIn.current = null

      const d = await chatApi<{
        total_unread: number
        conversations: Array<{ id: number; last_id: number; unread: number; touched_at: string | null }>
        typing: Record<number, string[]>
      }>(`/pulse${typingParam ? `?typing_in=${typingParam}` : ''}`)

      const movedIds: number[] = []
      const nextLive: Record<number, { last_id: number; unread: number; touched_at: string | null }> = {}
      ;(d.conversations ?? []).forEach(c => {
        const lastId = Number(c.last_id ?? 0)
        nextLive[c.id] = { last_id: lastId, unread: Number(c.unread ?? 0), touched_at: c.touched_at ?? null }

        const known = lastIds.current.get(c.id)
        if (known === undefined) { lastIds.current.set(c.id, lastId); return }
        if (lastId > known) { lastIds.current.set(c.id, lastId); movedIds.push(c.id) }
      })

      // Every open thread reconciles against this, so nothing depends on
      // catching a single event at the right moment. Replaced only when it
      // actually changed — the poll runs every 1.5s and must not re-render the
      // whole app for an unchanged answer.
      setLive(prev => (sameLive(prev, nextLive) ? prev : nextLive))
      setTyping(prev => (sameTyping(prev, d.typing ?? {}) ? prev : (d.typing ?? {})))

      const grew = d.total_unread > 0 && d.total_unread !== totalUnreadRef.current
      totalUnreadRef.current = d.total_unread

      if (movedIds.length) {
        setMoved({ ids: movedIds, at: Date.now() })
        // Previews and ordering are only correct after a refresh, and it is
        // cheap next to what just changed.
        await refresh().catch(() => {})

        if (grew) {
          if (settingsRef.current.sound_enabled) chime()
          const openIds = new Set(dockRef.current.filter(e => !e.minimized).map(e => e.id))
          movedIds.forEach(id => {
            const conv = convRef.current.find(c => c.id === id)
            if (!conv || conv.is_muted || openIds.has(id)) return
            if (window.location.pathname.startsWith('/dashboard/chat')) return
            toast(`${conv.title}: ${conv.last_message.preview ?? 'New message'}`, 'info', () => openInDock(id))
          })
        }
      } else {
        setTotalUnread(d.total_unread)
      }
    }

    const runTick = async () => {
      try {
        await tick()
        failures = 0
        setConnected(prev => (prev ? prev : true))
      } catch {
        failures++
        // One failure is noise; three in a row is a state the user should see,
        // because from the inside it looks exactly like "chat stopped working".
        if (failures >= 3) setConnected(prev => (prev ? false : prev))
      }
    }

    const loop = () => {
      if (stopped) return
      timer = setTimeout(() => { void runTick().finally(loop) }, interval())
    }

    void runTick().finally(loop)

    // Re-arm on focus/visibility so switching to active does not wait out an
    // already-scheduled slow interval.
    const rearm = () => { if (timer) { clearTimeout(timer); timer = null; loop() } }
    document.addEventListener('visibilitychange', rearm)
    window.addEventListener('focus', rearm)

    return () => {
      stopped = true
      if (timer) clearTimeout(timer)
      document.removeEventListener('visibilitychange', rearm)
      window.removeEventListener('focus', rearm)
    }
  }, [ready, pushLive, config.poll, refresh, toast, openInDock])

  const byId = useMemo(() => new Map(conversations.map(c => [c.id, c])), [conversations])

  const value: ChatStore = {
    ready, me, config, settings, conversations, byId, totalUnread, typing, moved,
    live, connected, pushLive, error, retry,
    refresh, applyConversations, claimActive, setTyping: declareTyping,
    dock, openInDock, minimizeInDock, expandInDock, closeInDock,
    toast, toasts, dismissToast,
  }

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
