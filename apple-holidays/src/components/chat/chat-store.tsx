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
  const [dock, setDock] = useState<DockEntry[]>([])
  const [toasts, setToasts] = useState<Toast[]>([])

  // Refs, not state: these are read inside the poll loop and must never cause it
  // to re-subscribe.
  const activeCount = useRef(0)
  const typingIn = useRef<number | null>(null)
  const lastIds = useRef<Map<number, number>>(new Map())
  const settingsRef = useRef(settings)
  const convRef = useRef<ChatConversation[]>([])
  const dockRef = useRef<DockEntry[]>([])
  const restored = useRef(false)
  const toastSeq = useRef(0)
  // The poll loop compares against the previous total to decide whether a change
  // is "something new arrived" or just a read marker moving. Kept in a ref so
  // the loop does not re-subscribe every time the badge changes.
  const totalUnreadRef = useRef(0)

  settingsRef.current = settings
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

  const declareTyping = useCallback((conversationId: number | null) => {
    typingIn.current = conversationId
  }, [])

  /* ---- boot -------------------------------------------------------------- */

  useEffect(() => {
    let cancelled = false
    chatApi<{ me: ChatPerson; conversations: ChatConversation[]; settings: ChatSettings; config: ChatConfig }>('/bootstrap')
      .then(d => {
        if (cancelled) return
        setMe(d.me)
        setConfig(d.config ?? DEFAULT_CONFIG)
        setSettings(d.settings)
        applyConversations(d.conversations ?? [])
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
      .catch(() => { if (!cancelled) setReady(true) })

    return () => { cancelled = true }
  }, [applyConversations])

  /* ---- the poll loop ----------------------------------------------------- */

  useEffect(() => {
    if (!ready) return

    let timer: ReturnType<typeof setTimeout> | null = null
    let stopped = false

    const interval = () => {
      if (document.hidden) return config.poll.background
      // "Active" means a thread is actually on screen and being used.
      return activeCount.current > 0 && document.hasFocus() ? config.poll.active : config.poll.idle
    }

    const tick = async () => {
      const typingParam = typingIn.current
      typingIn.current = null

      const d = await chatApi<{
        total_unread: number
        conversations: Array<{ id: number; last_id: number; unread: number }>
        typing: Record<number, string[]>
      }>(`/pulse${typingParam ? `?typing_in=${typingParam}` : ''}`)

      const movedIds: number[] = []
      ;(d.conversations ?? []).forEach(c => {
        const known = lastIds.current.get(c.id)
        if (known === undefined) { lastIds.current.set(c.id, c.last_id); return }
        if (c.last_id > known) { lastIds.current.set(c.id, c.last_id); movedIds.push(c.id) }
      })

      setTyping(d.typing ?? {})

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

    const loop = () => {
      if (stopped) return
      timer = setTimeout(() => { void tick().catch(() => {}).finally(loop) }, interval())
    }

    void tick().catch(() => {}).finally(loop)

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
  }, [ready, config.poll, refresh, toast, openInDock])

  const byId = useMemo(() => new Map(conversations.map(c => [c.id, c])), [conversations])

  const value: ChatStore = {
    ready, me, config, settings, conversations, byId, totalUnread, typing, moved,
    refresh, applyConversations, claimActive, setTyping: declareTyping,
    dock, openInDock, minimizeInDock, expandInDock, closeInDock,
    toast, toasts, dismissToast,
  }

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
