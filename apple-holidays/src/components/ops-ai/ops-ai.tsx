'use client'

import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import Image from 'next/image'
import { usePathname, useRouter } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { AnimatePresence, motion, useMotionValue } from 'framer-motion'
import {
  X, CornerDownLeft, Loader2, Sparkles, ShieldCheck, Trash2,
  ChevronUp, ChevronDown, FileText, Command,
  Mic, Square, AudioLines, PhoneOff, MicOff,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import ActionCard from './action-card'
import LookupResult from './lookup-result'
import { openOpsAiTour } from './ops-ai-tour'
import { useDictation } from './use-dictation'
import { useRealtimeVoice } from './use-realtime-voice'
import type { OpsAction, OpsMessage } from './types'

const REF_IN_PATH = /\/(?:bookings|driver-log|portal|trip)\/([A-Z]{2}[A-Z0-9-]{2,})/i
const SUGGEST_DEBOUNCE_MS = 380

// Both preferences are per-browser, not per-user: they describe where this
// person likes the chrome to sit, not anything worth a round trip.
const SUGGEST_COLLAPSED_KEY = 'ops-ai:suggest-collapsed'
const LAUNCHER_POS_KEY      = 'ops-ai:launcher-offset'

let seq = 0
const nextId = () => `m${Date.now()}-${seq++}`

/**
 * OPS_AI — the operations copilot.
 *
 * Mounted once in the dashboard shell. Everything it can do is defined server
 * side in `src/lib/ops-ai/registry.ts`; this component only renders proposals
 * and relays the user's approval, so a UI bug can never widen its reach.
 */
export default function OpsAI() {
  const { data: session } = useSession()
  const pathname = usePathname()
  const router   = useRouter()

  const [open, setOpen]           = useState(false)
  const [input, setInput]         = useState('')
  const [messages, setMessages]   = useState<OpsMessage[]>([])
  const [thinking, setThinking]   = useState(false)
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [suggestLoading, setSuggestLoading] = useState(false)
  const [highlighted, setHighlighted] = useState(-1)
  const [suggestCollapsed, setSuggestCollapsed] = useState(false)

  const threadRef  = useRef<HTMLDivElement>(null)
  const inputRef   = useRef<HTMLTextAreaElement>(null)
  const suggestSeq = useRef(0)

  const bookingRef = useMemo(() => {
    const m = pathname?.match(REF_IN_PATH)
    return m ? m[1].toUpperCase() : null
  }, [pathname])

  // The copilot is staff-only; clients get the read-only portal instead.
  const enabled = Boolean(session?.user) && session?.user?.role !== 'CLIENT'

  // ── Global hotkey ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!enabled) return
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'j') {
        e.preventDefault()
        setOpen(o => !o)
      }
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [enabled])

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 120)
  }, [open])

  // Restore the collapsed/expanded choice for the quick-actions list.
  useEffect(() => {
    try {
      setSuggestCollapsed(localStorage.getItem(SUGGEST_COLLAPSED_KEY) === '1')
    } catch { /* private mode — fall back to expanded */ }
  }, [])

  const toggleSuggestCollapsed = useCallback(() => {
    setSuggestCollapsed(prev => {
      const next = !prev
      if (next) setHighlighted(-1)
      try { localStorage.setItem(SUGGEST_COLLAPSED_KEY, next ? '1' : '0') } catch { /* ignore */ }
      return next
    })
  }, [])

  // ── Programmatic open ───────────────────────────────────────────────────
  // The launch tour ends by opening the panel with a starter prompt already
  // typed, so the first thing a new user sees is a command they can just send.
  useEffect(() => {
    if (!enabled) return
    function onOpen(e: Event) {
      const prefill = (e as CustomEvent<{ prefill?: string }>).detail?.prefill
      if (prefill) setInput(prefill)
      setOpen(true)
    }
    window.addEventListener('ops-ai:open', onOpen)
    return () => window.removeEventListener('ops-ai:open', onOpen)
  }, [enabled])

  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, thinking])

  // ── Type-ahead ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!open) return
    const ticket = ++suggestSeq.current
    const partial = input.trim()
    setHighlighted(-1)

    const timer = setTimeout(async () => {
      if (partial.length >= 2) setSuggestLoading(true)
      try {
        const res = await fetch('/api/ops-ai/suggest', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ partial, pathname }),
        })
        const json = await res.json()
        // Drop responses from a keystroke the user has already typed past.
        if (ticket !== suggestSeq.current) return
        setSuggestions(json?.success ? (json.data.suggestions ?? []) : [])
      } catch {
        if (ticket === suggestSeq.current) setSuggestions([])
      } finally {
        if (ticket === suggestSeq.current) setSuggestLoading(false)
      }
    }, partial.length < 2 ? 0 : SUGGEST_DEBOUNCE_MS)

    return () => clearTimeout(timer)
  }, [input, open, pathname])

  // ── Turn ────────────────────────────────────────────────────────────────
  const send = useCallback(async (raw: string) => {
    const text = raw.trim()
    if (!text || thinking) return

    const history = messages
      .filter(m => !m.error)
      .slice(-8)
      .map(m => ({ role: m.role, content: m.content }))

    setMessages(prev => [...prev, { id: nextId(), role: 'user', content: text }])
    setInput('')
    setSuggestions([])
    setThinking(true)

    try {
      const res = await fetch('/api/ops-ai/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, pathname, bookingRef, history }),
      })
      const json = await res.json()

      if (!json?.success) {
        setMessages(prev => [...prev, {
          id: nextId(), role: 'assistant', error: true,
          content: json?.error ?? 'OPS_AI could not reach the model.',
        }])
        return
      }

      const { reply, actions, lookups } = json.data as {
        reply: string; actions: OpsAction[]; lookups: OpsMessage['lookups']
      }

      setMessages(prev => [...prev, {
        id: nextId(),
        role: 'assistant',
        content: reply || (actions?.length ? 'Ready when you are:' : 'Nothing to do for that one.'),
        actions,
        lookups,
      }])
    } catch (err) {
      setMessages(prev => [...prev, {
        id: nextId(), role: 'assistant', error: true,
        content: err instanceof Error ? err.message : 'Something went wrong.',
      }])
    } finally {
      setThinking(false)
    }
  }, [thinking, messages, pathname, bookingRef])

  // ── Running one approved action ─────────────────────────────────────────
  const runAction = useCallback(async (action: OpsAction) => {
    try {
      const res = await fetch('/api/ops-ai/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ envelope: action.envelope }),
      })
      const json = await res.json()
      if (!json?.success) return { ok: false, message: json?.error ?? 'That action was refused.' }

      const effect = json.data?.effect as { type: string; href?: string } | undefined
      if (effect?.type === 'navigate' && effect.href) {
        router.push(effect.href)
        setTimeout(() => setOpen(false), 350)
      } else if (effect?.type === 'refresh') {
        // Server components come back via refresh(); client-side pages that hold
        // their own fetched state listen for this event and re-pull.
        router.refresh()
        window.dispatchEvent(new CustomEvent('ops-ai:mutated'))
      }
      return { ok: true, message: json.data?.message ?? 'Done.' }
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : 'Request failed.' }
    }
  }, [router])

  // ── Voice-to-voice ────────────────────────────────────────────────────────
  // Spoken turns and anything the voice agent looks up or proposes are dropped
  // into the same thread as typed turns. Crucially, a proposed write arrives here
  // as a signed action card (via onAction) — never as an executed change — so the
  // "every change needs your approval" guarantee holds for voice too.
  const pushAssistant = useCallback((patch: Partial<OpsMessage>) => {
    setMessages(prev => [...prev, { id: nextId(), role: 'assistant', content: '', ...patch }])
  }, [])

  const voice = useRealtimeVoice(
    () => ({ pathname: pathname ?? undefined, bookingRef }),
    {
      onUserSpeech:      text => setMessages(prev => [...prev, { id: nextId(), role: 'user', content: text }]),
      onAssistantSpeech: text => pushAssistant({ content: text }),
      onLookup:          lookup => pushAssistant({ lookups: [lookup] }),
      onAction:          action => pushAssistant({ actions: [action] }),
    },
  )

  function onComposerKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // A collapsed list is out of sight, so it must also be out of the way of
    // the arrow keys — those belong to the textarea again.
    if (suggestions.length && !suggestCollapsed) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setHighlighted(h => (h + 1) % suggestions.length)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setHighlighted(h => (h <= 0 ? suggestions.length - 1 : h - 1))
        return
      }
      if (e.key === 'Tab' && highlighted >= 0) {
        e.preventDefault()
        setInput(suggestions[highlighted])
        return
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      const picked = !suggestCollapsed && highlighted >= 0 ? suggestions[highlighted] : null
      send(picked ?? input)
    }
  }

  if (!enabled) return null

  return (
    <>
      <Launcher open={open} onToggle={() => setOpen(o => !o)} />

      <AnimatePresence>
        {open && (
          <>
            <motion.div
              key="scrim"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setOpen(false)}
              className="fixed inset-0 z-[70] bg-slate-950/40 backdrop-blur-[2px] lg:hidden"
            />

            <motion.aside
              key="panel"
              initial={{ x: '100%', opacity: 0.6 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: '100%', opacity: 0.4 }}
              transition={{ type: 'spring', stiffness: 300, damping: 34 }}
              className={cn(
                'fixed right-0 top-0 z-[80] flex h-screen w-full flex-col sm:w-[440px]',
                'border-l border-slate-700/60 bg-slate-950/95 backdrop-blur-xl',
                'shadow-[-20px_0_60px_-15px_rgba(0,0,0,0.7)]',
              )}
            >
              {/* Aurora wash — keeps the panel from reading as a flat black box. */}
              <div className="pointer-events-none absolute inset-0 overflow-hidden">
                <div className="absolute -left-24 -top-24 h-64 w-64 rounded-full bg-brand-500/10 blur-3xl" />
                <div className="absolute -right-16 top-1/3 h-56 w-56 rounded-full bg-navy-500/10 blur-3xl" />
              </div>

              <Header
                bookingRef={bookingRef}
                onClear={() => setMessages([])}
                onClose={() => setOpen(false)}
                hasThread={messages.length > 0}
              />

              <div ref={threadRef} className="relative flex-1 space-y-4 overflow-y-auto px-4 py-4">
                {messages.length === 0 && <EmptyState bookingRef={bookingRef} />}

                {messages.map(msg => (
                  <div key={msg.id} className={cn('flex flex-col gap-2', msg.role === 'user' && 'items-end')}>
                    {msg.role === 'user' ? (
                      <div className="max-w-[85%] rounded-2xl rounded-br-md bg-brand-400/90 px-3.5 py-2 text-[13px] font-medium leading-snug text-slate-900">
                        {msg.content}
                      </div>
                    ) : (
                      <>
                        {msg.content && (
                          <div className="flex gap-2.5">
                            <Avatar />
                            <div
                              className={cn(
                                'max-w-[88%] whitespace-pre-wrap rounded-2xl rounded-tl-md px-3.5 py-2 text-[13px] leading-relaxed',
                                msg.error
                                  ? 'bg-red-950/50 text-red-200 ring-1 ring-red-500/30'
                                  : 'bg-slate-800/70 text-slate-200',
                              )}
                            >
                              {msg.content}
                            </div>
                          </div>
                        )}

                        {msg.lookups?.length ? (
                          <div className="ml-9 space-y-2">
                            {msg.lookups.map((lookup, i) => (
                              <LookupResult key={i} lookup={lookup} onNavigate={() => setOpen(false)} />
                            ))}
                          </div>
                        ) : null}

                        {msg.actions?.length ? (
                          <div className="ml-9 space-y-2">
                            {msg.actions.map(action => (
                              <ActionCard key={action.id} action={action} onRun={runAction} />
                            ))}
                          </div>
                        ) : null}
                      </>
                    )}
                  </div>
                ))}

                {thinking && (
                  <div className="flex gap-2.5">
                    <Avatar pulsing />
                    <div className="flex items-center gap-2 rounded-2xl rounded-tl-md bg-slate-800/70 px-3.5 py-2.5">
                      {[0, 1, 2].map(i => (
                        <motion.span
                          key={i}
                          className="h-1.5 w-1.5 rounded-full bg-brand-300"
                          animate={{ opacity: [0.25, 1, 0.25], y: [0, -3, 0] }}
                          transition={{ duration: 1.1, repeat: Infinity, delay: i * 0.15 }}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <Composer
                input={input}
                setInput={setInput}
                onKeyDown={onComposerKey}
                onSend={() => send(input)}
                onPick={s => { setInput(s); send(s) }}
                suggestions={suggestions}
                suggestLoading={suggestLoading}
                collapsed={suggestCollapsed}
                onToggleCollapsed={toggleSuggestCollapsed}
                highlighted={highlighted}
                setHighlighted={setHighlighted}
                thinking={thinking}
                inputRef={inputRef}
                voiceStatus={voice.status}
                voiceError={voice.error}
                agentSpeaking={voice.agentSpeaking}
                muted={voice.muted}
                onToggleVoice={voice.toggle}
                onToggleMute={voice.toggleMute}
              />
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </>
  )
}

// ── Launcher ──────────────────────────────────────────────────────────────

const FAB_SIZE   = 56  // h-14 / w-14
const FAB_INSET  = 24  // bottom-6 / right-6

/** Keep the launcher fully on screen whatever the viewport does. */
function clampOffset(x: number, y: number) {
  if (typeof window === 'undefined') return { x, y }
  const minX = Math.min(0, -(window.innerWidth  - FAB_SIZE - FAB_INSET * 2))
  const minY = Math.min(0, -(window.innerHeight - FAB_SIZE - FAB_INSET * 2))
  return {
    x: Math.min(0, Math.max(minX, x)),
    y: Math.min(0, Math.max(minY, y)),
  }
}

function Launcher({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  // Offsets from the resting bottom-right corner, so a fresh browser still
  // gets the familiar position and only a deliberate drag moves it.
  const x = useMotionValue(0)
  const y = useMotionValue(0)
  const draggedRef = useRef(false)

  useEffect(() => {
    let saved: { x?: number; y?: number } | null = null
    try {
      const raw = localStorage.getItem(LAUNCHER_POS_KEY)
      saved = raw ? JSON.parse(raw) : null
    } catch { /* ignore unreadable/parked value */ }
    if (!saved) return
    const next = clampOffset(Number(saved.x) || 0, Number(saved.y) || 0)
    x.set(next.x)
    y.set(next.y)
  }, [x, y])

  useEffect(() => {
    function onResize() {
      const next = clampOffset(x.get(), y.get())
      x.set(next.x)
      y.set(next.y)
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [x, y])

  return (
    <motion.button
      onClick={() => {
        // A drag ends with a click event on the same element; ignore that one.
        if (draggedRef.current) return
        onToggle()
      }}
      aria-label="Open OPS_AI"
      drag
      dragMomentum={false}
      dragElastic={0.03}
      onDragStart={() => { draggedRef.current = true }}
      onDragEnd={() => {
        const next = clampOffset(x.get(), y.get())
        x.set(next.x)
        y.set(next.y)
        try { localStorage.setItem(LAUNCHER_POS_KEY, JSON.stringify(next)) } catch { /* ignore */ }
        setTimeout(() => { draggedRef.current = false }, 150)
      }}
      style={{ x, y }}
      initial={{ scale: 0, rotate: -90 }}
      animate={{ scale: 1, rotate: 0 }}
      transition={{ type: 'spring', stiffness: 260, damping: 18, delay: 0.4 }}
      whileHover={{ scale: 1.06 }}
      whileTap={{ scale: 0.94 }}
      whileDrag={{ scale: 1.08, cursor: 'grabbing' }}
      className={cn(
        'group fixed bottom-6 right-6 z-[75] flex h-14 w-14 cursor-grab items-center justify-center rounded-full',
        'bg-gradient-to-br from-slate-800 to-slate-950 ring-1 ring-white/15 touch-none select-none',
        'shadow-[0_8px_30px_-6px_rgba(234,179,8,0.45)] transition-shadow hover:shadow-[0_10px_40px_-6px_rgba(234,179,8,0.7)]',
        open && 'opacity-0 pointer-events-none',
      )}
    >
      {/* Two offset halo rings give it a live, "listening" feel at rest. */}
      {[0, 1].map(i => (
        <motion.span
          key={i}
          className="absolute inset-0 rounded-full ring-1 ring-brand-400/50"
          animate={{ scale: [1, 1.45], opacity: [0.55, 0] }}
          transition={{ duration: 2.4, repeat: Infinity, delay: i * 1.2, ease: 'easeOut' }}
        />
      ))}

      <span className="relative h-11 w-11 overflow-hidden rounded-full">
        <Image src="/ops-ai/ops-ai-256.png" alt="" fill sizes="44px" className="scale-110 object-cover" priority />
      </span>

      <span
        className={cn(
          'pointer-events-none absolute right-full mr-3 whitespace-nowrap rounded-lg bg-slate-900 px-2.5 py-1.5',
          'text-[11px] font-medium text-slate-200 opacity-0 shadow-lg ring-1 ring-white/10 transition-opacity',
          'group-hover:opacity-100',
        )}
      >
        Ask OPS_AI
        <kbd className="ml-1.5 rounded bg-slate-800 px-1 py-px text-[9px] text-slate-400">⌘J</kbd>
        <span className="ml-1.5 text-[9px] text-slate-500">drag to move</span>
      </span>
    </motion.button>
  )
}

// ── Chrome ────────────────────────────────────────────────────────────────

function Avatar({ pulsing }: { pulsing?: boolean }) {
  return (
    <span
      className={cn(
        'relative mt-0.5 h-7 w-7 shrink-0 overflow-hidden rounded-full ring-1 ring-brand-400/40',
        pulsing && 'animate-pulse-slow',
      )}
    >
      <Image src="/ops-ai/ops-ai-256.png" alt="" fill sizes="28px" className="scale-110 object-cover" />
    </span>
  )
}

function Header({
  bookingRef, onClear, onClose, hasThread,
}: { bookingRef: string | null; onClear: () => void; onClose: () => void; hasThread: boolean }) {
  return (
    <header className="relative shrink-0 border-b border-slate-700/60 px-4 py-3">
      <div className="flex items-center gap-3">
        <span className="relative h-9 w-9 shrink-0 overflow-hidden rounded-full ring-1 ring-brand-400/50">
          <Image src="/ops-ai/ops-ai-256.png" alt="" fill sizes="36px" className="scale-110 object-cover" />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <h2 className="text-[14px] font-bold tracking-tight text-white">OPS_AI</h2>
            <Sparkles className="h-3 w-3 text-brand-300" />
          </div>
          <p className="flex items-center gap-1 text-[10.5px] text-slate-500">
            <ShieldCheck className="h-3 w-3 text-emerald-400/70" />
            Every change needs your approval
          </p>
        </div>

        {hasThread && (
          <button
            onClick={onClear}
            title="Clear conversation"
            className="rounded-lg p-1.5 text-slate-500 transition-colors hover:bg-slate-800 hover:text-slate-300"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
        <button
          onClick={onClose}
          className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-800 hover:text-white"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {bookingRef && (
        <div className="mt-2.5 flex items-center gap-1.5 rounded-lg bg-brand-400/10 px-2.5 py-1.5 ring-1 ring-brand-400/25">
          <FileText className="h-3 w-3 shrink-0 text-brand-300" />
          <span className="text-[11px] text-slate-400">
            Working on <span className="font-semibold text-brand-200">{bookingRef}</span> — say “this booking”
          </span>
        </div>
      )}
    </header>
  )
}

function EmptyState({ bookingRef }: { bookingRef: string | null }) {
  const examples = bookingRef
    ? [
        `Change the agent name on this booking to 30 Sundays`,
        `Add a Sigiriya full-day sightseeing tour to day 3`,
        `Set the meeting time on day 1 to 08:30`,
      ]
    : [
        'Find bookings arriving on 1 July',
        'Open booking IS23492',
        'Show everything in change-requested status',
      ]

  return (
    <div className="flex flex-col items-center px-4 pb-2 pt-8 text-center">
      <motion.span
        className="relative h-20 w-20 overflow-hidden rounded-full ring-2 ring-brand-400/30"
        animate={{ y: [0, -6, 0] }}
        transition={{ duration: 3.6, repeat: Infinity, ease: 'easeInOut' }}
      >
        <Image src="/ops-ai/ops-ai-256.png" alt="OPS_AI" fill sizes="80px" className="scale-110 object-cover" priority />
      </motion.span>

      <h3 className="mt-4 text-[15px] font-bold text-white">Tell me what to do</h3>
      <p className="mt-1 max-w-[280px] text-[12px] leading-relaxed text-slate-400">
        I read the system, propose the exact change, and wait for your approval before anything is saved.
      </p>

      <div className="mt-5 w-full space-y-1.5 text-left">
        <p className="px-1 text-[10px] font-semibold uppercase tracking-wider text-slate-600">Try</p>
        {examples.map(ex => (
          <div
            key={ex}
            className="rounded-lg border border-slate-800 bg-slate-900/50 px-3 py-2 text-[11.5px] text-slate-400"
          >
            “{ex}”
          </div>
        ))}
      </div>

      <button
        onClick={openOpsAiTour}
        className="mt-4 inline-flex items-center gap-1.5 text-[11px] font-medium text-slate-500 transition-colors hover:text-brand-300"
      >
        <Sparkles className="h-3 w-3" />
        How it works — 1-minute guide
      </button>
    </div>
  )
}

// ── Composer ──────────────────────────────────────────────────────────────

interface ComposerProps {
  input: string
  setInput: (v: string) => void
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void
  onSend: () => void
  onPick: (s: string) => void
  suggestions: string[]
  suggestLoading: boolean
  collapsed: boolean
  onToggleCollapsed: () => void
  highlighted: number
  setHighlighted: (n: number) => void
  thinking: boolean
  inputRef: React.RefObject<HTMLTextAreaElement>
  voiceStatus: 'idle' | 'connecting' | 'live' | 'error'
  voiceError: string | null
  agentSpeaking: boolean
  muted: boolean
  onToggleVoice: () => void
  onToggleMute: () => void
}

function Composer({
  input, setInput, onKeyDown, onSend, onPick,
  suggestions, suggestLoading, collapsed, onToggleCollapsed,
  highlighted, setHighlighted, thinking, inputRef,
  voiceStatus, voiceError, agentSpeaking, muted, onToggleVoice, onToggleMute,
}: ComposerProps) {
  const title = input.trim().length < 2 ? 'Quick actions' : 'Did you mean'

  // Dictation appends its transcript to whatever is already typed. Kept in a ref
  // so the append reads the freshest value even though the callback is memoised.
  const inputValRef = useRef(input)
  inputValRef.current = input
  const dictation = useDictation(useCallback((text: string) => {
    const cur = inputValRef.current.trim()
    setInput(cur ? `${cur} ${text}` : text)
    requestAnimationFrame(() => inputRef.current?.focus())
  }, [setInput, inputRef]))

  const voiceLive = voiceStatus === 'live' || voiceStatus === 'connecting'

  return (
    <div className="relative shrink-0 border-t border-slate-700/60 p-3">
      <AnimatePresence>
        {suggestions.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6 }}
            className="absolute bottom-full left-3 right-3 mb-2 overflow-hidden rounded-xl border border-slate-700 bg-slate-900/95 shadow-2xl backdrop-blur-xl"
          >
            {/* The list can eat most of the panel, so the header doubles as a
                minimise handle — collapsed it keeps a one-line reminder that
                suggestions are waiting. */}
            <button
              type="button"
              onClick={onToggleCollapsed}
              title={collapsed ? 'Show suggestions' : 'Minimise suggestions'}
              className={cn(
                'flex w-full items-center gap-1.5 px-3 py-1.5 text-left text-[9.5px] font-semibold',
                'uppercase tracking-wider text-slate-500 transition-colors hover:bg-slate-800/60 hover:text-slate-300',
                !collapsed && 'border-b border-slate-800',
              )}
            >
              {collapsed ? <ChevronDown className="h-3 w-3" /> : <ChevronUp className="h-3 w-3" />}
              {title}
              {collapsed && (
                <span className="rounded bg-slate-800 px-1 py-px text-[9px] tabular-nums text-slate-400">
                  {suggestions.length}
                </span>
              )}
              {suggestLoading && <Loader2 className="ml-auto h-3 w-3 animate-spin text-brand-400" />}
            </button>

            <AnimatePresence initial={false}>
              {!collapsed && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.16, ease: 'easeOut' }}
                  className="overflow-hidden"
                >
                  <div className="max-h-[40vh] overflow-y-auto">
                    {suggestions.map((s, i) => (
                      <button
                        key={s}
                        onMouseEnter={() => setHighlighted(i)}
                        onClick={() => onPick(s)}
                        className={cn(
                          'flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] transition-colors',
                          i === highlighted ? 'bg-brand-400/15 text-brand-100' : 'text-slate-300 hover:bg-slate-800/70',
                        )}
                      >
                        <Command className="h-3 w-3 shrink-0 text-slate-600" />
                        <span className="min-w-0 flex-1 truncate">{s}</span>
                        {i === highlighted && <CornerDownLeft className="h-3 w-3 shrink-0 text-brand-400" />}
                      </button>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>

      <VoiceBar
        status={voiceStatus}
        error={voiceError}
        agentSpeaking={agentSpeaking}
        muted={muted}
        onToggleMute={onToggleMute}
        onEnd={onToggleVoice}
      />

      <div className="flex items-end gap-2 rounded-xl border border-slate-700 bg-slate-900/80 p-2 transition-colors focus-within:border-brand-400/60">
        <textarea
          ref={inputRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          rows={1}
          placeholder={dictation.status === 'recording' ? 'Listening — speak now…' : 'Change the agent name, add a day-3 tour, find July arrivals…'}
          className={cn(
            'max-h-32 min-h-[36px] flex-1 resize-none border-0 bg-transparent p-1.5 text-[13px] leading-snug',
            'text-slate-100 placeholder:text-slate-600 focus:outline-none focus:ring-0',
          )}
          onInput={e => {
            const el = e.currentTarget
            el.style.height = 'auto'
            el.style.height = `${Math.min(el.scrollHeight, 128)}px`
          }}
        />

        {/* Dictation — fills the composer, then follows the normal approve flow. */}
        <button
          type="button"
          onClick={dictation.toggle}
          disabled={thinking || dictation.status === 'transcribing' || voiceLive}
          title={
            dictation.status === 'recording'   ? 'Stop dictation'
            : dictation.status === 'transcribing' ? 'Transcribing…'
            : dictation.error ?? 'Dictate (voice to text)'
          }
          className={cn(
            'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-all',
            dictation.status === 'recording'
              ? 'bg-red-500/90 text-white animate-pulse'
              : 'bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-brand-200',
            'disabled:cursor-not-allowed disabled:opacity-50',
          )}
        >
          {dictation.status === 'transcribing'
            ? <Loader2 className="h-4 w-4 animate-spin" />
            : dictation.status === 'recording'
              ? <Square className="h-3.5 w-3.5" />
              : <Mic className="h-4 w-4" />}
        </button>

        {/* Voice-to-voice — a spoken conversation; writes still surface as cards. */}
        <button
          type="button"
          onClick={onToggleVoice}
          disabled={dictation.status === 'recording'}
          title={voiceLive ? 'End voice conversation' : 'Talk to OPS_AI'}
          className={cn(
            'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-all',
            voiceLive
              ? 'bg-emerald-500/90 text-white'
              : 'bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-emerald-200',
            'disabled:cursor-not-allowed disabled:opacity-50',
          )}
        >
          {voiceStatus === 'connecting'
            ? <Loader2 className="h-4 w-4 animate-spin" />
            : <AudioLines className={cn('h-4 w-4', voiceStatus === 'live' && 'animate-pulse')} />}
        </button>

        <button
          onClick={onSend}
          disabled={!input.trim() || thinking}
          className={cn(
            'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-all',
            'bg-brand-400 text-slate-900 hover:bg-brand-300 hover:shadow-glow',
            'disabled:cursor-not-allowed disabled:bg-slate-800 disabled:text-slate-600 disabled:shadow-none',
          )}
        >
          {thinking ? <Loader2 className="h-4 w-4 animate-spin" /> : <CornerDownLeft className="h-4 w-4" />}
        </button>
      </div>

      <p className="mt-1.5 px-1 text-[10px] text-slate-600">
        OPS_AI cannot delete, cancel, or change booking status.
      </p>
    </div>
  )
}

// ── Voice status bar ────────────────────────────────────────────────────────

function VoiceBar({
  status, error, agentSpeaking, muted, onToggleMute, onEnd,
}: {
  status: 'idle' | 'connecting' | 'live' | 'error'
  error: string | null
  agentSpeaking: boolean
  muted: boolean
  onToggleMute: () => void
  onEnd: () => void
}) {
  if (status === 'idle') return null

  if (status === 'error') {
    return (
      <div className="mb-2 flex items-center gap-2 rounded-lg bg-red-950/50 px-3 py-2 text-[11px] text-red-200 ring-1 ring-red-500/30">
        <PhoneOff className="h-3.5 w-3.5 shrink-0" />
        <span className="min-w-0 flex-1 truncate">{error ?? 'Voice mode failed.'}</span>
      </div>
    )
  }

  const label =
    status === 'connecting' ? 'Connecting…'
    : agentSpeaking         ? 'OPS_AI speaking…'
    : muted                 ? 'Muted'
    : 'Listening…'

  return (
    <div className="mb-2 flex items-center gap-2.5 rounded-lg bg-emerald-500/10 px-3 py-2 ring-1 ring-emerald-400/30">
      <span className="relative flex h-2 w-2 shrink-0">
        <span className={cn(
          'absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75',
          status === 'live' && !muted && 'animate-ping',
        )} />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
      </span>

      <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-emerald-100">{label}</span>

      {status === 'live' && (
        <button
          type="button"
          onClick={onToggleMute}
          title={muted ? 'Unmute microphone' : 'Mute microphone'}
          className={cn(
            'flex h-6 w-6 shrink-0 items-center justify-center rounded-md transition-colors',
            muted ? 'bg-slate-700 text-slate-300' : 'text-emerald-200 hover:bg-emerald-500/20',
          )}
        >
          {muted ? <MicOff className="h-3.5 w-3.5" /> : <Mic className="h-3.5 w-3.5" />}
        </button>
      )}

      <button
        type="button"
        onClick={onEnd}
        title="End voice conversation"
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-red-300 transition-colors hover:bg-red-500/20"
      >
        <PhoneOff className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}
