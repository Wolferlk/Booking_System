'use client'

/**
 * AI-call cards for the WhatsApp chat timelines — the booking mini chat and the
 * inbox thread. Each dialled AI call (answered, missed, retrying or ringing)
 * sits in the conversation at the time it happened, so the desk reads the
 * messages and the calls as one story.
 *
 *   answered → summary, mood, verdict, waveform recording player, transcript
 *   missed   → how many tries, last try, why it failed
 *   retrying → next try time
 *   calling  → live "ringing" state
 *
 * Fed by GET /api/bookings/:ref/ai-call-events. Styles carry [html.bk-dark_&]
 * variants so the card follows the booking page's dark theme; it must sit
 * inside a `data-theme-keep` container there (the mini chat list is one).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Bot, User, PhoneIncoming, PhoneMissed, PhoneCall, Play, Pause, Download,
  ChevronDown, Loader2, AlertCircle, Star, CalendarClock, RotateCw, Sparkles,
  ClipboardCheck, Award, Phone, AudioLines, PhoneOff,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { normaliseTranscript, OUTCOME_LABEL, type NormLine } from '@/components/te/transcript-shared'
import { FEEDBACK_CLASS_META, type FeedbackClass } from '@/lib/te/feedback-class'

// ── types + feed ─────────────────────────────────────────────────────────────

export type AiCallKind = 'on_tour' | 'reconfirm' | 'post_tour'
export interface AiCallEvent {
  uid: string
  kind: AiCallKind
  dayNo: number | null
  state: 'answered' | 'missed' | 'retrying' | 'calling' | 'blocked'
  at: string
  attempts: number
  nextAttemptAt: string | null
  error: string | null
  conversationId: string | null
  sentiment: string | null
  outcome: string | null
  rating: number | null
  summary: string | null
  issues: string | null
  verdict: FeedbackClass | null
  verdictReason: string | null
  transcript: Parameters<typeof normaliseTranscript>[0]
  transcriptTurns: number
}
export interface AiCallFeed {
  phone: string | null
  events: AiCallEvent[]
  next: { kind: AiCallKind; dayNo: number | null; at: string } | null
}

const EMPTY: AiCallFeed = { phone: null, events: [], next: null }

/**
 * Polls the booking's AI-call events while `enabled`. Calls change slowly, so
 * once a minute — every 15 s while one is ringing or waiting for a retry.
 * A role without access (403) just gets an empty feed; the chat never breaks.
 */
export function useAiCallFeed(bookingRef: string | null | undefined, enabled: boolean): AiCallFeed {
  const [feed, setFeed] = useState<AiCallFeed>(EMPTY)
  const printRef = useRef('')

  useEffect(() => { setFeed(EMPTY); printRef.current = '' }, [bookingRef])

  useEffect(() => {
    if (!bookingRef || !enabled) return
    let stopped = false
    let timer: ReturnType<typeof setTimeout> | null = null
    let live = false

    const load = async () => {
      if (document.hidden) return
      try {
        const res = await fetch(`/api/bookings/${encodeURIComponent(bookingRef)}/ai-call-events`, { cache: 'no-store' })
        if (!res.ok) return
        const json = await res.json()
        if (!json.success || stopped) return
        const data = json.data as AiCallFeed
        const fp = data.events.map(e => `${e.uid}:${e.state}:${e.attempts}:${e.transcriptTurns}:${e.summary?.length ?? 0}`).join('|') + `|${data.next?.at ?? ''}`
        live = data.events.some(e => e.state === 'calling' || e.state === 'retrying')
        if (fp !== printRef.current) { printRef.current = fp; setFeed(data) }
      } catch { /* offline — keep what we have */ }
    }
    const tick = async () => {
      await load()
      if (!stopped) timer = setTimeout(tick, live ? 15_000 : 60_000)
    }
    tick()
    return () => { stopped = true; if (timer) clearTimeout(timer) }
  }, [bookingRef, enabled])

  return feed
}

/** Last 9 digits — enough to match a number across +94 / 0 / spacing variants. */
export const phoneKey = (s: string | null | undefined) => (s ?? '').replace(/\D/g, '').slice(-9)

// ── helpers ──────────────────────────────────────────────────────────────────

// Dark-theme classes are written out literally ([html.bk-dark_&]:…) so the
// Tailwind scanner sees them — never build them from a prefix at runtime.
const VERDICT_DARK: Record<FeedbackClass, string> = {
  good:    '[html.bk-dark_&]:bg-emerald-500/15 [html.bk-dark_&]:text-emerald-300 [html.bk-dark_&]:border-emerald-500/30',
  warning: '[html.bk-dark_&]:bg-amber-500/15 [html.bk-dark_&]:text-amber-300 [html.bk-dark_&]:border-amber-500/30',
  bad:     '[html.bk-dark_&]:bg-red-500/15 [html.bk-dark_&]:text-red-300 [html.bk-dark_&]:border-red-500/30',
  none:    '[html.bk-dark_&]:bg-slate-700/40 [html.bk-dark_&]:text-slate-400 [html.bk-dark_&]:border-slate-600/40',
}

const KIND: Record<AiCallKind, { label: string; icon: typeof Phone }> = {
  on_tour:   { label: 'Daily check-in', icon: Phone },
  reconfirm: { label: 'Reconfirmation', icon: ClipboardCheck },
  post_tour: { label: 'Post-tour feedback', icon: Award },
}

const MOOD: Record<string, { emoji: string; label: string; tone: 'pos' | 'neu' | 'neg' }> = {
  happy: { emoji: '😊', label: 'Happy', tone: 'pos' }, satisfied: { emoji: '😊', label: 'Satisfied', tone: 'pos' },
  positive: { emoji: '😊', label: 'Positive', tone: 'pos' }, neutral: { emoji: '😐', label: 'Neutral', tone: 'neu' },
  mixed: { emoji: '😕', label: 'Mixed', tone: 'neu' }, unhappy: { emoji: '😞', label: 'Unhappy', tone: 'neg' },
  negative: { emoji: '😞', label: 'Negative', tone: 'neg' }, angry: { emoji: '😠', label: 'Upset', tone: 'neg' },
}

const time = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''
function whenLabel(iso: string) {
  const d = new Date(iso)
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const that = new Date(d); that.setHours(0, 0, 0, 0)
  const diff = Math.round((that.getTime() - today.getTime()) / 86_400_000)
  const day = diff === 0 ? 'Today' : diff === 1 ? 'Tomorrow' : d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
  return `${day} · ${time(iso)}`
}
function ordinal(n: number) {
  const v = n % 100
  if (v >= 11 && v <= 13) return `${n}th`
  return `${n}${({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th'}`
}
const mmss = (s: number) => (Number.isFinite(s) && s > 0 ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}` : '0:00')

function title(ev: AiCallEvent) {
  const k = KIND[ev.kind].label
  return ev.kind === 'on_tour' && ev.dayNo ? `Day ${ev.dayNo} ${k.toLowerCase()}` : k
}

// ── card ─────────────────────────────────────────────────────────────────────

export function AiCallCard({ ev, className }: { ev: AiCallEvent; className?: string }) {
  const [openTranscript, setOpenTranscript] = useState(false)
  const [moreSummary, setMoreSummary] = useState(false)
  const mood = ev.sentiment ? MOOD[ev.sentiment.toLowerCase()] : undefined
  const KindIcon = KIND[ev.kind].icon

  // Never dialled — a quiet one-liner, not a "missed call" card.
  if (ev.state === 'blocked') {
    const noPhone = /no phone/i.test(ev.error ?? '')
    return (
      <div className={cn('my-2 flex justify-center', className)}>
        <span
          title={ev.error ?? undefined}
          className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-slate-200 bg-white/85 px-2.5 py-1 text-[10.5px] text-slate-500 shadow-sm backdrop-blur [html.bk-dark_&]:border-white/10 [html.bk-dark_&]:bg-[#182229]/90 [html.bk-dark_&]:text-slate-400"
        >
          <PhoneOff className="h-3 w-3 shrink-0 text-slate-400" />
          <span className="truncate">
            <b className="font-semibold text-slate-600 [html.bk-dark_&]:text-slate-300">{title(ev)}</b> not placed ·{' '}
            {noPhone ? 'no phone number on file' : 'guest hasn’t allowed WhatsApp calls yet'}
          </span>
          <span className="shrink-0 text-slate-400">{time(ev.at)}</span>
        </span>
      </div>
    )
  }

  const head = {
    answered: {
      band: 'from-violet-600 via-indigo-600 to-sky-600', icon: PhoneIncoming,
      label: 'AI call answered',
      sub: ev.attempts > 1 ? `Picked up on the ${ordinal(ev.attempts)} try` : 'Picked up first time',
    },
    missed: {
      band: 'from-rose-500 via-rose-600 to-pink-600', icon: PhoneMissed,
      label: 'Missed AI call',
      sub: `No answer${ev.attempts > 1 ? ` after ${ev.attempts} tries` : ''}`,
    },
    retrying: {
      band: 'from-amber-500 via-orange-500 to-rose-500', icon: RotateCw,
      label: 'Not answered yet',
      sub: `${ev.attempts} ${ev.attempts === 1 ? 'try' : 'tries'} so far${ev.nextAttemptAt ? ` · next ${time(ev.nextAttemptAt)}` : ''}`,
    },
    calling: {
      band: 'from-violet-500 via-fuchsia-500 to-violet-600 bg-[length:200%_100%] animate-[aiCallShimmer_2.4s_linear_infinite]', icon: PhoneCall,
      label: 'Calling the guest…',
      sub: 'The AI agent is on the line',
    },
  }[ev.state]

  return (
    <div className={cn('my-3 flex justify-center', className)}>
      <style>{`@keyframes aiCallShimmer{0%{background-position:0% 50%}100%{background-position:200% 50%}}`}</style>
      <div className={cn(
        'w-full max-w-[420px] overflow-hidden rounded-2xl bg-white shadow-[0_6px_24px_-8px_rgba(76,29,149,0.35)] ring-1 ring-black/5',
        `[html.bk-dark_&]:bg-[#111b21] [html.bk-dark_&]:ring-white/10 [html.bk-dark_&]:shadow-[0_6px_24px_-8px_rgba(0,0,0,0.6)]`,
      )}>
        {/* Header band */}
        <div className={cn('relative flex items-center gap-2.5 bg-gradient-to-r px-3 py-2.5 text-white', head.band)}>
          <div className="pointer-events-none absolute inset-0 opacity-30 [background:radial-gradient(120px_60px_at_90%_0%,rgba(255,255,255,0.6),transparent)]" />
          <div className="relative grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white/20 ring-1 ring-white/30 backdrop-blur">
            {ev.state === 'calling' && <span className="absolute inset-0 animate-ping rounded-full bg-white/30" />}
            <head.icon className="relative h-4 w-4" />
          </div>
          <div className="relative min-w-0 flex-1">
            <p className="flex items-center gap-1.5 text-[12.5px] font-bold leading-tight">
              {head.label}
              {ev.state === 'calling' && <LiveBars />}
            </p>
            <p className="truncate text-[10.5px] text-white/80">
              <KindIcon className="-mt-0.5 mr-1 inline h-3 w-3" />{title(ev)} · {head.sub}
            </p>
          </div>
          <div className="relative flex shrink-0 flex-col items-end gap-0.5">
            {mood && (
              <span title={mood.label} className="grid h-7 w-7 place-items-center rounded-full bg-white/90 text-base leading-none shadow-sm">{mood.emoji}</span>
            )}
            <span className="text-[10px] font-medium text-white/80">{time(ev.at)}</span>
          </div>
        </div>

        {/* Body */}
        {ev.state === 'answered' ? (
          <div className="space-y-2.5 px-3 pb-3 pt-2.5">
            <div className="flex flex-wrap items-center gap-1">
              <span className={cn('inline-flex items-center gap-1 rounded-full bg-violet-50 px-2 py-0.5 text-[10px] font-bold text-violet-700', `[html.bk-dark_&]:bg-violet-500/15 [html.bk-dark_&]:text-violet-300`)}>
                <Bot className="h-3 w-3" /> AI agent
              </span>
              {mood && (
                <span className={cn(
                  'rounded-full px-2 py-0.5 text-[10px] font-bold',
                  mood.tone === 'pos' ? `bg-emerald-50 text-emerald-700 [html.bk-dark_&]:bg-emerald-500/15 [html.bk-dark_&]:text-emerald-300`
                    : mood.tone === 'neg' ? `bg-rose-50 text-rose-600 [html.bk-dark_&]:bg-rose-500/15 [html.bk-dark_&]:text-rose-300`
                      : `bg-slate-100 text-slate-600 [html.bk-dark_&]:bg-white/10 [html.bk-dark_&]:text-slate-300`,
                )}>{mood.emoji} {mood.label}</span>
              )}
              {ev.verdict && ev.verdict !== 'none' && (
                <span title={ev.verdictReason ?? undefined} className={cn('rounded-full border px-2 py-0.5 text-[10px] font-bold', FEEDBACK_CLASS_META[ev.verdict].chip, VERDICT_DARK[ev.verdict])}>
                  {FEEDBACK_CLASS_META[ev.verdict].emoji} {FEEDBACK_CLASS_META[ev.verdict].label}
                </span>
              )}
              {ev.outcome && (
                <span className={cn('rounded-full bg-sky-50 px-2 py-0.5 text-[10px] font-bold text-sky-700', `[html.bk-dark_&]:bg-sky-500/15 [html.bk-dark_&]:text-sky-300`)}>
                  {OUTCOME_LABEL[ev.outcome] ?? ev.outcome.replace(/_/g, ' ')}
                </span>
              )}
              {ev.rating != null && <Stars rating10={ev.rating} />}
            </div>

            {ev.summary ? (
              <div className={cn('relative rounded-xl bg-gradient-to-br from-violet-50/80 to-sky-50/60 px-2.5 py-2', `[html.bk-dark_&]:from-violet-500/10 [html.bk-dark_&]:to-sky-500/5`)}>
                <p className={cn('mb-0.5 flex items-center gap-1 text-[9.5px] font-bold uppercase tracking-wider text-violet-500', `[html.bk-dark_&]:text-violet-300`)}>
                  <Sparkles className="h-3 w-3" /> Call summary
                </p>
                <p className={cn('text-[11.5px] leading-relaxed text-slate-700', `[html.bk-dark_&]:text-slate-200`, !moreSummary && 'line-clamp-3')}>{ev.summary}</p>
                {ev.summary.length > 160 && (
                  <button onClick={() => setMoreSummary(v => !v)} className={cn('mt-0.5 text-[10.5px] font-semibold text-violet-600 hover:underline', `[html.bk-dark_&]:text-violet-300`)}>
                    {moreSummary ? 'Show less' : 'Read more'}
                  </button>
                )}
              </div>
            ) : (
              <p className={cn('flex items-center gap-1.5 text-[11px] italic text-slate-400', `[html.bk-dark_&]:text-slate-500`)}>
                <Loader2 className="h-3 w-3 animate-spin" /> Summary is being written up…
              </p>
            )}

            {ev.issues && (
              <div className={cn('flex gap-1.5 rounded-xl border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-800', `[html.bk-dark_&]:border-amber-400/30 [html.bk-dark_&]:bg-amber-500/10 [html.bk-dark_&]:text-amber-200`)}>
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span className="leading-relaxed">{ev.issues}</span>
              </div>
            )}

            {ev.conversationId && <RecordingPlayer conversationId={ev.conversationId} />}

            {(ev.transcriptTurns > 0 || ev.conversationId) && (
              <div>
                <button
                  onClick={() => setOpenTranscript(v => !v)}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-left text-[11px] font-semibold text-slate-600 transition hover:border-violet-300 hover:bg-violet-50/60',
                    `[html.bk-dark_&]:border-white/10 [html.bk-dark_&]:bg-white/5 [html.bk-dark_&]:text-slate-300 [html.bk-dark_&]:hover:border-violet-400/40 [html.bk-dark_&]:hover:bg-violet-500/10`,
                  )}
                >
                  <AudioLines className={cn('h-3.5 w-3.5 text-violet-500', `[html.bk-dark_&]:text-violet-300`)} />
                  <span className="flex-1">{openTranscript ? 'Hide transcript' : 'View transcript'}</span>
                  {ev.transcriptTurns > 0 && (
                    <span className={cn('rounded-full bg-white px-1.5 text-[10px] text-slate-500 ring-1 ring-slate-200', `[html.bk-dark_&]:bg-white/10 [html.bk-dark_&]:text-slate-400 [html.bk-dark_&]:ring-white/10`)}>{ev.transcriptTurns} turns</span>
                  )}
                  <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', openTranscript && 'rotate-180')} />
                </button>
                {openTranscript && <Transcript raw={ev.transcript} conversationId={ev.conversationId} />}
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-2 px-3 pb-3 pt-2.5">
            {ev.state === 'calling' ? (
              <p className={cn('text-[11.5px] text-slate-600', `[html.bk-dark_&]:text-slate-300`)}>
                Ringing now. The summary, transcript and recording show up here once the call ends.
              </p>
            ) : (
              <>
                <AttemptDots count={Math.max(ev.attempts, 1)} retrying={ev.state === 'retrying'} />
                <p className={cn('text-[11.5px] text-slate-600', `[html.bk-dark_&]:text-slate-300`)}>
                  {ev.state === 'retrying'
                    ? <>The guest hasn’t picked up yet. The AI agent will try again{ev.nextAttemptAt ? <> at <b>{whenLabel(ev.nextAttemptAt)}</b></> : ' shortly'}.</>
                    : <>The guest didn’t pick up{ev.attempts > 1 ? <> on any of the <b>{ev.attempts}</b> tries</> : ''}. A WhatsApp follow-up may help.</>}
                </p>
                {ev.error && (
                  <p className={cn('truncate rounded-lg bg-slate-50 px-2 py-1 font-mono text-[10px] text-slate-500', `[html.bk-dark_&]:bg-white/5 [html.bk-dark_&]:text-slate-400`)} title={ev.error}>
                    {ev.error}
                  </p>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

/** Small "next AI call" pill shown at the end of the chat. */
export function NextAiCallChip({ next }: { next: AiCallFeed['next'] }) {
  if (!next) return null
  const label = next.kind === 'on_tour' && next.dayNo ? `Day ${next.dayNo} check-in` : KIND[next.kind].label
  return (
    <div className="my-3 flex justify-center">
      <span className={cn(
        'inline-flex items-center gap-1.5 rounded-full border border-dashed border-violet-300 bg-white/85 px-3 py-1 text-[10.5px] font-semibold text-violet-700 shadow-sm backdrop-blur',
        `[html.bk-dark_&]:border-violet-400/40 [html.bk-dark_&]:bg-[#182229]/90 [html.bk-dark_&]:text-violet-300`,
      )}>
        <CalendarClock className="h-3 w-3" /> Next AI call · {label} · {whenLabel(next.at)}
      </span>
    </div>
  )
}

// ── pieces ───────────────────────────────────────────────────────────────────

function LiveBars() {
  return (
    <span className="inline-flex h-3 items-end gap-[2px]">
      {[0, 150, 300, 450].map(d => (
        <span key={d} className="w-[2px] animate-bounce rounded-full bg-white" style={{ height: `${6 + (d % 300) / 50}px`, animationDelay: `${d}ms` }} />
      ))}
    </span>
  )
}

function Stars({ rating10 }: { rating10: number }) {
  const five = Math.round(Math.max(0, Math.min(10, rating10)) / 2)
  return (
    <span className="inline-flex items-center gap-px" title={`${rating10}/10`}>
      {[1, 2, 3, 4, 5].map(i => (
        <Star key={i} className={cn('h-3 w-3', i <= five ? 'fill-amber-400 text-amber-400' : `text-slate-300 [html.bk-dark_&]:text-slate-600`)} />
      ))}
    </span>
  )
}

function AttemptDots({ count, retrying }: { count: number; retrying: boolean }) {
  const shown = Math.min(count, 8)
  return (
    <div className="flex items-center gap-1.5">
      {Array.from({ length: shown }).map((_, i) => (
        <span key={i} className={cn('grid h-5 w-5 place-items-center rounded-full bg-rose-100 text-rose-500', `[html.bk-dark_&]:bg-rose-500/15 [html.bk-dark_&]:text-rose-300`)}>
          <PhoneMissed className="h-2.5 w-2.5" />
        </span>
      ))}
      {count > shown && <span className="text-[10px] font-bold text-rose-500">+{count - shown}</span>}
      {retrying && (
        <span className={cn('grid h-5 w-5 place-items-center rounded-full border border-dashed border-amber-400 text-amber-500', `[html.bk-dark_&]:text-amber-300`)}>
          <RotateCw className="h-2.5 w-2.5" />
        </span>
      )}
    </div>
  )
}

// Only one recording plays at a time across every card on the page.
const PLAY_EVENT = 'ai-call-recording-play'

function seeded(id: string, n: number): number[] {
  let h = 2166136261
  for (let i = 0; i < id.length; i += 1) h = Math.imul(h ^ id.charCodeAt(i), 16777619)
  const out: number[] = []
  for (let i = 0; i < n; i += 1) {
    h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0
    const r = (h % 1000) / 1000
    const envelope = 0.55 + 0.45 * Math.sin((i / n) * Math.PI) // louder mid-call
    out.push(0.18 + 0.82 * r * envelope)
  }
  return out
}

/**
 * Waveform-style recording player. Nothing downloads until play is pressed;
 * the bars are a stable visual signature per call (not the real waveform),
 * and fill as it plays. Click the bars to seek.
 */
function RecordingPlayer({ conversationId }: { conversationId: string }) {
  const src = `/api/te/recordings/${encodeURIComponent(conversationId)}/audio`
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const pendingSeek = useRef<number | null>(null)
  const [armed, setArmed] = useState(false)
  const [state, setState] = useState<'idle' | 'loading' | 'playing' | 'paused' | 'error'>('idle')
  const [cur, setCur] = useState(0)
  const [dur, setDur] = useState(0)
  const [rate, setRate] = useState(1)
  const bars = useMemo(() => seeded(conversationId, 46), [conversationId])
  const progress = dur > 0 ? cur / dur : 0

  useEffect(() => {
    const onOther = (e: Event) => {
      if ((e as CustomEvent<string>).detail !== conversationId) audioRef.current?.pause()
    }
    window.addEventListener(PLAY_EVENT, onOther)
    return () => window.removeEventListener(PLAY_EVENT, onOther)
  }, [conversationId])

  const play = useCallback(() => {
    if (!armed) { setArmed(true); setState('loading'); return } // effect below starts it once mounted
    const a = audioRef.current
    if (!a) return
    window.dispatchEvent(new CustomEvent(PLAY_EVENT, { detail: conversationId }))
    a.play().catch(() => setState('error'))
  }, [armed, conversationId])

  useEffect(() => {
    if (!armed) return
    const a = audioRef.current
    if (!a) return
    a.playbackRate = rate
    window.dispatchEvent(new CustomEvent(PLAY_EVENT, { detail: conversationId }))
    a.play().catch(() => { /* onError handles a missing file */ })
  }, [armed]) // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = () => {
    const a = audioRef.current
    if (state === 'playing' && a) a.pause()
    else if (state === 'error') { setArmed(false); setState('idle'); setTimeout(() => { setArmed(true); setState('loading') }, 0) }
    else play()
  }

  const seek = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    const a = audioRef.current
    if (a && dur > 0) { a.currentTime = frac * dur; setCur(a.currentTime); if (state !== 'playing') play() }
    else { pendingSeek.current = frac; play() }
  }

  const cycleRate = () => {
    const next = rate === 1 ? 1.5 : rate === 1.5 ? 2 : 1
    setRate(next)
    if (audioRef.current) audioRef.current.playbackRate = next
  }

  const playing = state === 'playing'

  return (
    <div className={cn(
      'rounded-xl border border-violet-100 bg-gradient-to-r from-violet-50 to-indigo-50/50 p-2',
      `[html.bk-dark_&]:border-violet-400/20 [html.bk-dark_&]:from-violet-500/10 [html.bk-dark_&]:to-indigo-500/5`,
    )}>
      <div className="flex items-center gap-2">
        <button
          onClick={toggle}
          className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-gradient-to-br from-violet-500 to-indigo-600 text-white shadow-md shadow-violet-600/30 transition hover:scale-105 active:scale-95"
          title={playing ? 'Pause' : state === 'error' ? 'Try again' : 'Play call recording'}
        >
          {state === 'loading' ? <Loader2 className="h-4 w-4 animate-spin" />
            : playing ? <Pause className="h-4 w-4" />
              : state === 'error' ? <RotateCw className="h-4 w-4" />
                : <Play className="ml-0.5 h-4 w-4" />}
        </button>

        <div className="min-w-0 flex-1">
          <div onClick={seek} className="flex h-7 cursor-pointer items-center gap-[2px]" title="Seek">
            {bars.map((h, i) => {
              const filled = (i + 0.5) / bars.length <= progress
              return (
                <span
                  key={i}
                  className={cn(
                    'flex-1 rounded-full transition-colors duration-150',
                    filled ? 'bg-violet-600' : `bg-violet-300/60 [html.bk-dark_&]:bg-violet-300/25`,
                    filled && `[html.bk-dark_&]:bg-violet-300`,
                    playing && filled && i === Math.floor(progress * bars.length) - 1 && 'animate-pulse',
                  )}
                  style={{ height: `${Math.round(h * 100)}%` }}
                />
              )
            })}
          </div>
          <div className={cn('mt-0.5 flex items-center justify-between text-[10px] font-medium text-violet-700/80', `[html.bk-dark_&]:text-violet-200/80`)}>
            <span className="tabular-nums">{state === 'error' ? '' : `${mmss(cur)}${dur ? ` / ${mmss(dur)}` : ''}`}</span>
            {state === 'error'
              ? <span className={cn('flex items-center gap-1 text-amber-600', `[html.bk-dark_&]:text-amber-300`)}><AlertCircle className="h-3 w-3" /> Recording not ready yet — try again in a few minutes</span>
              : state === 'idle' ? <span>Call recording</span> : null}
          </div>
        </div>

        <button
          onClick={cycleRate}
          className={cn('h-6 shrink-0 rounded-md bg-white px-1.5 text-[10px] font-bold text-violet-700 ring-1 ring-violet-200 hover:bg-violet-100', `[html.bk-dark_&]:bg-white/10 [html.bk-dark_&]:text-violet-200 [html.bk-dark_&]:ring-white/10 [html.bk-dark_&]:hover:bg-white/15`)}
          title="Playback speed"
        >
          {rate}×
        </button>
        <a
          href={src}
          download={`${conversationId}.mp3`}
          className={cn('grid h-6 w-6 shrink-0 place-items-center rounded-md text-violet-500 hover:bg-white hover:text-violet-700', `[html.bk-dark_&]:text-violet-300 [html.bk-dark_&]:hover:bg-white/10`)}
          title="Download recording"
        >
          <Download className="h-3.5 w-3.5" />
        </a>
      </div>

      {armed && (
        <audio
          ref={audioRef}
          src={src}
          preload="auto"
          className="hidden"
          onLoadedMetadata={e => {
            const a = e.currentTarget
            setDur(a.duration)
            if (pendingSeek.current != null && Number.isFinite(a.duration)) {
              a.currentTime = pendingSeek.current * a.duration
              pendingSeek.current = null
            }
          }}
          onTimeUpdate={e => setCur(e.currentTarget.currentTime)}
          onPlaying={() => setState('playing')}
          onPause={() => setState(s => (s === 'error' ? s : 'paused'))}
          onWaiting={() => setState('loading')}
          onEnded={() => { setState('paused'); setCur(0) }}
          onError={() => setState('error')}
        />
      )}
    </div>
  )
}

/**
 * Chat-style transcript. Falls back to fetching the conversation from the voice
 * service when the stored transcript is empty (same as the AI Call Bot).
 */
function Transcript({ raw, conversationId }: { raw: AiCallEvent['transcript']; conversationId: string | null }) {
  const stored = useMemo(() => normaliseTranscript(raw), [raw])
  const [fetched, setFetched] = useState<NormLine[] | null>(null)
  const [st, setSt] = useState<'idle' | 'loading' | 'error'>('idle')

  useEffect(() => {
    if (stored.length || !conversationId) return
    let cancelled = false
    setSt('loading')
    fetch(`/api/te/proxy?path=${encodeURIComponent(`conversations/${conversationId}/transcript`)}`)
      .then(r => r.json())
      .then(j => {
        if (cancelled) return
        const l = normaliseTranscript(j?.transcript)
        setFetched(l)
        setSt(l.length ? 'idle' : 'error')
      })
      .catch(() => { if (!cancelled) setSt('error') })
    return () => { cancelled = true }
  }, [conversationId, stored.length])

  const lines = stored.length ? stored : (fetched ?? [])

  if (!lines.length) {
    return (
      <div className={cn('mt-2 flex items-center justify-center gap-2 rounded-xl bg-slate-50 py-4 text-[11px] italic text-slate-400', `[html.bk-dark_&]:bg-white/5 [html.bk-dark_&]:text-slate-500`)}>
        {st === 'loading' ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading the conversation…</> : <>No transcript stored for this call yet.</>}
      </div>
    )
  }

  return (
    <div className={cn('mt-2 max-h-72 space-y-2 overflow-y-auto overscroll-contain rounded-xl bg-slate-50/80 p-2', `[html.bk-dark_&]:bg-black/20`)}>
      {lines.map((l, i) => {
        if (l.speaker === 'system') {
          return <p key={i} className={cn('text-center text-[10px] italic text-slate-400', `[html.bk-dark_&]:text-slate-500`)}>{l.text}</p>
        }
        const agent = l.speaker === 'agent'
        return (
          <div key={i} className={cn('flex items-end gap-1.5', !agent && 'flex-row-reverse')}>
            <span className={cn('grid h-5 w-5 shrink-0 place-items-center rounded-full text-white', agent ? 'bg-gradient-to-br from-violet-500 to-indigo-600' : 'bg-gradient-to-br from-emerald-400 to-teal-600')}>
              {agent ? <Bot className="h-3 w-3" /> : <User className="h-3 w-3" />}
            </span>
            <div className={cn(
              'max-w-[80%] rounded-2xl px-2.5 py-1.5 text-[11.5px] leading-relaxed',
              agent
                ? `rounded-bl-sm bg-white text-slate-700 ring-1 ring-violet-100 [html.bk-dark_&]:bg-violet-500/15 [html.bk-dark_&]:text-violet-50 [html.bk-dark_&]:ring-violet-400/20`
                : `rounded-br-sm bg-emerald-50 text-slate-800 ring-1 ring-emerald-100 [html.bk-dark_&]:bg-emerald-500/15 [html.bk-dark_&]:text-emerald-50 [html.bk-dark_&]:ring-emerald-400/20`,
            )}>
              <p className={cn('mb-0.5 text-[9px] font-bold uppercase tracking-wide', agent ? `text-violet-500 [html.bk-dark_&]:text-violet-300` : `text-emerald-600 [html.bk-dark_&]:text-emerald-300`)}>
                {agent ? 'AI agent' : 'Guest'}
              </p>
              {l.text}
            </div>
          </div>
        )
      })}
    </div>
  )
}
