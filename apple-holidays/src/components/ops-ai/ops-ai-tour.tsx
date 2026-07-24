'use client'

/**
 * OPS_AI launch tour — the "what's new" guide.
 *
 * Runs as a launch campaign: for LAUNCH_DAYS days from LAUNCH_START it greets
 * every staff member once a day until they finish it. "Skip" snoozes until
 * tomorrow, "Finish" (or "Don't show again") retires it for good. After the
 * window closes it never auto-opens again — but it stays replayable from the
 * OPS_AI panel via `openOpsAiTour()`.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import Image from 'next/image'
import { AnimatePresence, motion } from 'framer-motion'
import { useSession } from 'next-auth/react'
import {
  ArrowLeft, ArrowRight, BedDouble, BellPlus, CalendarPlus, Check, Command,
  Compass, Heart, MessageSquareText, PartyPopper, Search, ShieldCheck,
  Sparkles, WandSparkles, X,
} from 'lucide-react'
import { cn } from '@/lib/utils'

// ── Campaign window ───────────────────────────────────────────────────────
const TOUR_VERSION = 1
const LAUNCH_START = '2026-07-24'   // day the OPS_AI guide goes live
const LAUNCH_DAYS  = 14             // …and keeps greeting people for two weeks

const STORAGE_KEY = `ops_ai_tour_v${TOUR_VERSION}`
const WELCOME_KEY = 'welcome_splash_seen_v1.0.0'  // keep behind the app splash

/** Fires the tour on demand, e.g. from the "How it works" link in the panel. */
export function openOpsAiTour() {
  window.dispatchEvent(new CustomEvent('ops-ai:tour'))
}

const today = () => new Date().toISOString().slice(0, 10)

function withinLaunchWindow(): boolean {
  const start = new Date(`${LAUNCH_START}T00:00:00`)
  const end   = new Date(start)
  end.setDate(end.getDate() + LAUNCH_DAYS)
  const now = new Date()
  return now >= start && now < end
}

function dayOfLaunch(): number {
  const start = new Date(`${LAUNCH_START}T00:00:00`)
  const diff  = Math.floor((Date.now() - start.getTime()) / 86_400_000)
  return Math.min(Math.max(diff + 1, 1), LAUNCH_DAYS)
}

/** 'done' = retired for good; anything else is the last date it was skipped. */
function shouldAutoOpen(): boolean {
  if (!withinLaunchWindow()) return false
  const seen = localStorage.getItem(STORAGE_KEY)
  if (seen === 'done') return false
  return seen !== today()           // already snoozed today → stay quiet
}

// ── Steps ─────────────────────────────────────────────────────────────────
interface Step {
  id:      string
  eyebrow: string
  title:   string
  body:    string
  icon:    typeof Sparkles
  art:     () => JSX.Element
}

const STEPS: Step[] = [
  {
    id: 'meet',
    eyebrow: 'Say hello',
    title: 'Meet OPS_AI',
    body: 'Your operations copilot. Ask it anything about your bookings in plain English — it reads the system, works out what you meant, and hands you the change ready to approve.',
    icon: Sparkles,
    art: MeetArt,
  },
  {
    id: 'open',
    eyebrow: 'Step 1',
    title: 'Open it from anywhere',
    body: 'Tap the glowing badge in the bottom-right corner, or just hit ⌘J (Ctrl+J on Windows). It floats above every screen, so you never lose your place. Esc closes it.',
    icon: Command,
    art: OpenArt,
  },
  {
    id: 'ask',
    eyebrow: 'Step 2',
    title: 'Type like you talk',
    body: 'No commands to memorise. Start typing and it suggests full phrasings — press Tab to accept one. On a booking page it already knows which booking you mean, so "this booking" is enough.',
    icon: MessageSquareText,
    art: AskArt,
  },
  {
    id: 'find',
    eyebrow: 'Step 3',
    title: 'Find & jump instantly',
    body: 'Ask for "bookings arriving on 1 July" or "everything in change-requested" and results appear right in the chat. It can also open the exact page, pre-filtered, in one click.',
    icon: Search,
    art: FindArt,
  },
  {
    id: 'do',
    eyebrow: 'Step 4',
    title: 'It does the typing',
    body: 'Change an agent name, add a day-3 sightseeing tour, fix a hotel, assign a driver, set a reminder, log a call. It drafts the edit — you see exactly what changes, before and after.',
    icon: WandSparkles,
    art: DoArt,
  },
  {
    id: 'approve',
    eyebrow: 'Step 5',
    title: 'Nothing saves without you',
    body: 'Every write shows up as a card marked "needs approval". Nothing touches the database until you press Apply — and your role and country scope are re-checked on the server every time.',
    icon: ShieldCheck,
    art: ApproveArt,
  },
  {
    id: 'safe',
    eyebrow: 'Step 6',
    title: 'Safe by design',
    body: 'Deleting, cancelling, moving a status, confirming payments, managing users — OPS_AI simply has no such power. Not hidden behind a flag: those tools do not exist for it. Every action it runs is signed and audited.',
    icon: Heart,
    art: SafeArt,
  },
  {
    id: 'go',
    eyebrow: 'You are all set',
    title: 'Give it a try',
    body: 'Start with something small and see how it feels. You can reopen this guide any time from the "How it works" link inside the OPS_AI panel.',
    icon: PartyPopper,
    art: GoArt,
  },
]

const TRY_PROMPT = 'Find bookings arriving on 1 July'

// Deterministic confetti/sparkle positions so SSR and CSR markup match.
const SPARKS = [
  { top: '14%', left: '6%',  delay: 0.2, size: 11 },
  { top: '9%',  left: '78%', delay: 0.7, size: 13 },
  { top: '72%', left: '4%',  delay: 1.1, size: 9 },
  { top: '82%', left: '88%', delay: 0.4, size: 12 },
  { top: '38%', left: '95%', delay: 1.4, size: 8 },
  { top: '90%', left: '40%', delay: 0.9, size: 10 },
]

export default function OpsAiTour() {
  const { data: session } = useSession()
  const [open, setOpen]   = useState(false)
  const [step, setStep]   = useState(0)
  const [dir, setDir]     = useState(1)

  // Staff only — clients get the read-only portal, which has no copilot.
  const eligible = Boolean(session?.user) && session?.user?.role !== 'CLIENT'

  // ── Auto-open, once the app welcome splash is out of the way ────────────
  useEffect(() => {
    if (!eligible) return
    if (!shouldAutoOpen()) return

    // The splash owns the first screen; queue behind it if it is showing.
    if (localStorage.getItem(WELCOME_KEY)) {
      const t = setTimeout(() => setOpen(true), 650)
      return () => clearTimeout(t)
    }
    const onSplashDone = () => setTimeout(() => setOpen(true), 450)
    window.addEventListener('welcome-splash:dismissed', onSplashDone)
    return () => window.removeEventListener('welcome-splash:dismissed', onSplashDone)
  }, [eligible])

  // ── Manual replay ───────────────────────────────────────────────────────
  useEffect(() => {
    const replay = () => { setStep(0); setDir(1); setOpen(true) }
    window.addEventListener('ops-ai:tour', replay)
    return () => window.removeEventListener('ops-ai:tour', replay)
  }, [])

  const last  = step === STEPS.length - 1
  const first = step === 0

  const close = useCallback((mode: 'skip' | 'done') => {
    localStorage.setItem(STORAGE_KEY, mode === 'done' ? 'done' : today())
    setOpen(false)
  }, [])

  const go = useCallback((delta: number) => {
    setDir(delta)
    setStep(s => Math.min(Math.max(s + delta, 0), STEPS.length - 1))
  }, [])

  const finish = useCallback((launch: boolean) => {
    close('done')
    if (launch) {
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent('ops-ai:open', { detail: { prefill: TRY_PROMPT } }))
      }, 260)
    }
  }, [close])

  // ── Keyboard: ← → to move, Esc to skip ──────────────────────────────────
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'ArrowRight' && !last) { e.preventDefault(); go(1) }
      if (e.key === 'ArrowLeft'  && !first) { e.preventDefault(); go(-1) }
      if (e.key === 'Escape') { e.preventDefault(); close('skip') }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, last, first, go, close])

  const current = STEPS[step]
  const daysLeft = useMemo(() => LAUNCH_DAYS - dayOfLaunch() + 1, [])

  if (!eligible) return null

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[110] flex items-center justify-center p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <motion.div
            className="absolute inset-0 bg-slate-950/75 backdrop-blur-md"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => close('skip')}
          />

          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="OPS_AI feature guide"
            initial={{ scale: 0.9, y: 30, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            exit={{ scale: 0.94, y: 16, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 250, damping: 24 }}
            className={cn(
              'relative flex w-full max-w-3xl flex-col overflow-hidden rounded-[28px]',
              'border border-white/10 bg-gradient-to-b from-slate-900 to-slate-950',
              'shadow-2xl shadow-brand-500/20',
            )}
          >
            {/* Aurora glow */}
            <motion.div
              aria-hidden
              className="pointer-events-none absolute -top-28 left-1/2 h-64 w-[130%] -translate-x-1/2 rounded-full bg-gradient-to-r from-brand-500/35 via-navy-500/30 to-brand-600/35 blur-3xl"
              animate={{ opacity: [0.45, 0.8, 0.45], scale: [1, 1.07, 1] }}
              transition={{ duration: 6, repeat: Infinity, ease: 'easeInOut' }}
            />

            {/* Sparkles */}
            {SPARKS.map((s, i) => (
              <motion.span
                key={i}
                aria-hidden
                className="pointer-events-none absolute text-brand-300/60"
                style={{ top: s.top, left: s.left }}
                initial={{ opacity: 0, scale: 0 }}
                animate={{ opacity: [0, 1, 0.3, 1], scale: [0.6, 1.1, 0.8, 1], y: [0, -7, 0] }}
                transition={{ duration: 3.4, delay: s.delay, repeat: Infinity, ease: 'easeInOut' }}
              >
                <Sparkles style={{ width: s.size, height: s.size }} />
              </motion.span>
            ))}

            {/* Progress bar */}
            <div className="relative h-1 w-full shrink-0 bg-slate-800">
              <motion.div
                className="h-full rounded-r-full bg-gradient-to-r from-brand-500 to-brand-300"
                animate={{ width: `${((step + 1) / STEPS.length) * 100}%` }}
                transition={{ type: 'spring', stiffness: 180, damping: 26 }}
              />
            </div>

            {/* Top bar */}
            <div className="relative flex shrink-0 items-center gap-2.5 px-5 pt-4 sm:px-7">
              <span className="relative h-8 w-8 shrink-0 overflow-hidden rounded-full ring-1 ring-brand-400/50">
                <Image src="/ops-ai/ops-ai-256.png" alt="" fill sizes="32px" className="scale-110 object-cover" priority />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-bold leading-none tracking-tight text-white">
                  OPS_AI <span className="font-medium text-slate-500">· feature guide</span>
                </p>
                <p className="mt-1 text-[10.5px] leading-none text-slate-500">
                  Step {step + 1} of {STEPS.length} · about a minute
                </p>
              </div>

              <span className="hidden items-center gap-1 rounded-full border border-brand-400/25 bg-brand-500/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-brand-300 sm:inline-flex">
                <Sparkles className="h-3 w-3" />
                New
              </span>

              <button
                onClick={() => close('skip')}
                aria-label="Skip the guide"
                className="rounded-lg p-1.5 text-slate-500 transition-colors hover:bg-slate-800 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Body */}
            <div className="relative min-h-[330px] px-5 pb-2 pt-5 sm:px-7">
              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={current.id}
                  initial={{ opacity: 0, x: dir * 28 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: dir * -28 }}
                  transition={{ duration: 0.28, ease: 'easeOut' }}
                  className="grid gap-6 sm:grid-cols-[1fr_1.05fr] sm:items-center"
                >
                  {/* Copy */}
                  <div>
                    <div className="inline-flex items-center gap-1.5 rounded-full bg-navy-500/15 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-navy-300 ring-1 ring-navy-400/25">
                      <current.icon className="h-3 w-3" />
                      {current.eyebrow}
                    </div>

                    <h2 className="mt-3 bg-gradient-to-r from-white via-brand-100 to-brand-300 bg-clip-text text-2xl font-extrabold leading-tight tracking-tight text-transparent sm:text-[27px]">
                      {current.title}
                    </h2>

                    <p className="mt-2.5 text-[13px] leading-relaxed text-slate-400">
                      {current.body}
                    </p>
                  </div>

                  {/* Art */}
                  <div className="flex min-h-[186px] items-center justify-center">
                    <current.art />
                  </div>
                </motion.div>
              </AnimatePresence>
            </div>

            {/* Footer */}
            <div className="relative flex shrink-0 flex-wrap items-center gap-3 border-t border-white/5 px-5 py-4 sm:px-7">
              {/* Dots */}
              <div className="flex items-center gap-1.5">
                {STEPS.map((s, i) => (
                  <button
                    key={s.id}
                    onClick={() => { setDir(i > step ? 1 : -1); setStep(i) }}
                    aria-label={`Go to step ${i + 1}: ${s.title}`}
                    className="group grid h-5 place-items-center px-0.5"
                  >
                    <motion.span
                      className={cn(
                        'block h-1.5 rounded-full transition-colors',
                        i === step ? 'bg-brand-400' : i < step ? 'bg-brand-400/40' : 'bg-slate-700 group-hover:bg-slate-600',
                      )}
                      animate={{ width: i === step ? 20 : 6 }}
                      transition={{ type: 'spring', stiffness: 320, damping: 26 }}
                    />
                  </button>
                ))}
              </div>

              <button
                onClick={() => close('skip')}
                className="text-[11.5px] font-medium text-slate-500 transition-colors hover:text-slate-300"
              >
                Skip
              </button>

              <div className="ml-auto flex items-center gap-2">
                {!first && (
                  <button
                    onClick={() => go(-1)}
                    className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-[12px] font-semibold text-slate-300 transition-colors hover:bg-slate-800 hover:text-white"
                  >
                    <ArrowLeft className="h-3.5 w-3.5" />
                    Back
                  </button>
                )}

                {last ? (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => finish(false)}
                      className="rounded-xl px-3 py-2 text-[12px] font-semibold text-slate-300 transition-colors hover:bg-slate-800 hover:text-white"
                    >
                      Got it
                    </button>
                    <motion.button
                      whileHover={{ scale: 1.03 }}
                      whileTap={{ scale: 0.97 }}
                      onClick={() => finish(true)}
                      className="group inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-brand-500 to-brand-600 px-5 py-2.5 text-[12.5px] font-bold text-slate-900 shadow-lg shadow-brand-500/30 transition-shadow hover:shadow-brand-500/50"
                    >
                      Try it now
                      <Sparkles className="h-3.5 w-3.5 transition-transform group-hover:rotate-12" />
                    </motion.button>
                  </div>
                ) : (
                  <motion.button
                    whileHover={{ scale: 1.03 }}
                    whileTap={{ scale: 0.97 }}
                    onClick={() => go(1)}
                    className="group inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-brand-500 to-brand-600 px-5 py-2.5 text-[12.5px] font-bold text-slate-900 shadow-lg shadow-brand-500/30 transition-shadow hover:shadow-brand-500/50"
                  >
                    Next
                    <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
                  </motion.button>
                )}
              </div>

              <p className="w-full text-[10px] text-slate-600">
                {withinLaunchWindow()
                  ? `Skipping keeps this handy — we'll say hi again tomorrow (${daysLeft} day${daysLeft === 1 ? '' : 's'} left in the intro). "Got it" retires it for good.`
                  : 'Reopen this any time from the “How it works” link inside OPS_AI.'}
              </p>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

// ── Illustrations ─────────────────────────────────────────────────────────
// Deliberately fake, hand-built mini-UIs: no screenshots to go stale, and they
// animate, which reads far better than a static image at this size.

function Frame({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn(
      'w-full max-w-[300px] rounded-2xl border border-white/10 bg-slate-900/70 p-3.5 shadow-xl shadow-black/40 backdrop-blur',
      className,
    )}>
      {children}
    </div>
  )
}

function MeetArt() {
  return (
    <div className="relative flex h-[180px] w-full items-center justify-center">
      {[0, 1, 2].map(i => (
        <motion.span
          key={i}
          aria-hidden
          className="absolute h-24 w-24 rounded-full ring-1 ring-brand-400/40"
          animate={{ scale: [1, 2.1], opacity: [0.5, 0] }}
          transition={{ duration: 3, repeat: Infinity, delay: i * 1, ease: 'easeOut' }}
        />
      ))}
      <motion.span
        className="relative h-28 w-28 overflow-hidden rounded-full ring-2 ring-brand-400/50 shadow-2xl shadow-brand-500/30"
        animate={{ y: [0, -8, 0] }}
        transition={{ duration: 3.6, repeat: Infinity, ease: 'easeInOut' }}
      >
        <Image src="/ops-ai/ops-ai-256.png" alt="OPS_AI" fill sizes="112px" className="scale-110 object-cover" priority />
      </motion.span>

      <motion.div
        className="absolute -right-1 top-4 rounded-2xl rounded-br-sm bg-brand-400 px-3 py-1.5 text-[11px] font-bold text-slate-900 shadow-lg"
        initial={{ opacity: 0, scale: 0.6 }}
        animate={{ opacity: 1, scale: 1, y: [0, -4, 0] }}
        transition={{ opacity: { delay: 0.4 }, scale: { delay: 0.4, type: 'spring', stiffness: 300 }, y: { duration: 3, repeat: Infinity, delay: 0.6 } }}
      >
        Hi 👋
      </motion.div>
    </div>
  )
}

function OpenArt() {
  return (
    <Frame className="relative h-[180px] overflow-hidden">
      <div className="space-y-2 opacity-40">
        {[70, 55, 82, 46].map((w, i) => (
          <div key={i} className="h-2.5 rounded-full bg-slate-700" style={{ width: `${w}%` }} />
        ))}
      </div>

      {/* Floating launcher */}
      <motion.div
        className="absolute bottom-3.5 right-3.5 grid h-12 w-12 place-items-center rounded-full bg-gradient-to-br from-slate-800 to-slate-950 ring-1 ring-white/15 shadow-[0_8px_24px_-6px_rgba(234,179,8,0.6)]"
        animate={{ scale: [1, 1.08, 1] }}
        transition={{ duration: 2.2, repeat: Infinity, ease: 'easeInOut' }}
      >
        {[0, 1].map(i => (
          <motion.span
            key={i}
            className="absolute inset-0 rounded-full ring-1 ring-brand-400/50"
            animate={{ scale: [1, 1.5], opacity: [0.6, 0] }}
            transition={{ duration: 2.2, repeat: Infinity, delay: i * 1.1, ease: 'easeOut' }}
          />
        ))}
        <span className="relative h-9 w-9 overflow-hidden rounded-full">
          <Image src="/ops-ai/ops-ai-256.png" alt="" fill sizes="36px" className="scale-110 object-cover" />
        </span>
      </motion.div>

      {/* Shortcut */}
      <motion.div
        className="absolute bottom-6 left-3.5 flex items-center gap-1.5"
        animate={{ opacity: [0.55, 1, 0.55] }}
        transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
      >
        <kbd className="rounded-md bg-slate-800 px-2 py-1 text-[11px] font-bold text-slate-200 ring-1 ring-white/10">⌘</kbd>
        <span className="text-[11px] text-slate-600">+</span>
        <kbd className="rounded-md bg-slate-800 px-2 py-1 text-[11px] font-bold text-slate-200 ring-1 ring-white/10">J</kbd>
      </motion.div>
    </Frame>
  )
}

function AskArt() {
  const typed = 'change the agent name'
  return (
    <Frame className="h-[180px]">
      <div className="flex items-center gap-2 rounded-xl bg-slate-800/80 px-3 py-2 ring-1 ring-brand-400/25">
        <MessageSquareText className="h-3.5 w-3.5 shrink-0 text-brand-300" />
        <motion.span
          className="overflow-hidden whitespace-nowrap text-[11.5px] text-slate-200"
          initial={{ width: 0 }}
          animate={{ width: 'auto' }}
          transition={{ duration: 1.6, ease: 'easeInOut' }}
        >
          {typed}
        </motion.span>
        <motion.span
          className="h-3.5 w-px bg-brand-300"
          animate={{ opacity: [1, 0, 1] }}
          transition={{ duration: 1, repeat: Infinity }}
        />
      </div>

      <p className="mt-3 px-1 text-[9.5px] font-bold uppercase tracking-wider text-slate-600">Suggestions</p>
      <div className="mt-1.5 space-y-1.5">
        {[
          'Change the agent name on this booking to 30 Sundays',
          'Change the agent email on this booking',
        ].map((s, i) => (
          <motion.div
            key={s}
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 1.5 + i * 0.18 }}
            className={cn(
              'flex items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-[11px]',
              i === 0 ? 'bg-brand-400/15 text-brand-100 ring-1 ring-brand-400/30' : 'bg-slate-800/60 text-slate-400',
            )}
          >
            <span className="truncate">{s}</span>
            {i === 0 && (
              <kbd className="shrink-0 rounded bg-slate-900/70 px-1.5 py-px text-[9px] font-bold text-brand-200">Tab</kbd>
            )}
          </motion.div>
        ))}
      </div>
    </Frame>
  )
}

function FindArt() {
  const rows = [
    { ref: 'IS23492', name: 'Weber · 4 pax', when: '1 Jul' },
    { ref: 'IS23511', name: 'Okafor · 2 pax', when: '1 Jul' },
    { ref: 'VN40123', name: 'Tanaka · 6 pax', when: '1 Jul' },
  ]
  return (
    <Frame className="h-[180px]">
      <div className="flex items-center gap-2 text-[11px] text-slate-400">
        <Search className="h-3.5 w-3.5 text-brand-300" />
        <span className="truncate">Arrivals · 1 Jul 2026</span>
        <span className="ml-auto shrink-0 rounded-full bg-slate-800 px-2 py-px text-[9.5px] font-bold text-slate-400">3</span>
      </div>

      <div className="mt-2.5 space-y-1.5">
        {rows.map((r, i) => (
          <motion.div
            key={r.ref}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 + i * 0.14, type: 'spring', stiffness: 220, damping: 20 }}
            className="flex items-center gap-2 rounded-lg bg-slate-800/60 px-2.5 py-2"
          >
            <span className="rounded bg-navy-500/25 px-1.5 py-px text-[9.5px] font-bold text-navy-200">{r.ref}</span>
            <span className="truncate text-[11px] text-slate-300">{r.name}</span>
            <span className="ml-auto shrink-0 text-[10px] text-slate-500">{r.when}</span>
          </motion.div>
        ))}
      </div>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.7 }}
        className="mt-2.5 flex items-center justify-center gap-1.5 rounded-lg bg-navy-500/70 py-1.5 text-[10.5px] font-semibold text-white"
      >
        <Compass className="h-3 w-3" />
        Open the filtered list
      </motion.div>
    </Frame>
  )
}

function DoArt() {
  const chips = [
    { icon: CalendarPlus, label: 'Add day-3 tour' },
    { icon: BedDouble,    label: 'Fix the hotel' },
    { icon: BellPlus,     label: 'Set a reminder' },
  ]
  return (
    <Frame className="h-[180px]">
      <div className="flex items-start gap-2">
        <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-brand-400/15 text-brand-300">
          <WandSparkles className="h-3.5 w-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[11.5px] font-bold text-white">Update booking</p>
          <p className="truncate text-[10.5px] text-slate-500">IS23492 · Agent name</p>
        </div>
      </div>

      <div className="mt-2.5 flex items-center gap-1.5 rounded-lg bg-slate-800/60 px-2.5 py-2 text-[11px]">
        <span className="truncate text-slate-500 line-through decoration-slate-600">Blue Lanka Tours</span>
        <ArrowRight className="h-3 w-3 shrink-0 text-slate-600" />
        <span className="truncate font-semibold text-slate-100">30 Sundays</span>
      </div>

      <div className="mt-2.5 flex flex-wrap gap-1.5">
        {chips.map((c, i) => (
          <motion.span
            key={c.label}
            initial={{ opacity: 0, scale: 0.85 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.25 + i * 0.12, type: 'spring', stiffness: 260, damping: 18 }}
            className="inline-flex items-center gap-1.5 rounded-full bg-slate-800/80 px-2.5 py-1 text-[10px] text-slate-300 ring-1 ring-white/5"
          >
            <c.icon className="h-3 w-3 text-brand-300" />
            {c.label}
          </motion.span>
        ))}
      </div>
    </Frame>
  )
}

function ApproveArt() {
  return (
    <Frame className="h-[180px]">
      <div className="flex items-center gap-2">
        <span className="rounded bg-brand-400/15 px-1.5 py-px text-[9px] font-bold uppercase tracking-wider text-brand-300">
          needs approval
        </span>
        <ShieldCheck className="ml-auto h-3.5 w-3.5 text-emerald-400/80" />
      </div>

      <p className="mt-2 text-[11.5px] font-bold text-white">Add agenda item · Day 3</p>
      <p className="mt-0.5 text-[10.5px] leading-snug text-slate-500">
        Sigiriya — full-day sightseeing, pickup 08:30
      </p>

      <motion.button
        className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg bg-brand-400 py-2 text-[11.5px] font-bold text-slate-900"
        animate={{ scale: [1, 1.035, 1], boxShadow: ['0 0 0 0 rgba(250,204,21,0)', '0 0 22px 2px rgba(250,204,21,0.45)', '0 0 0 0 rgba(250,204,21,0)'] }}
        transition={{ duration: 2.2, repeat: Infinity, ease: 'easeInOut' }}
      >
        <Check className="h-3.5 w-3.5" />
        Apply
      </motion.button>

      {/* Cute cursor tapping the button */}
      <motion.span
        aria-hidden
        className="pointer-events-none absolute ml-[52%] mt-[-6px] text-lg"
        animate={{ y: [6, 0, 6], opacity: [0.6, 1, 0.6] }}
        transition={{ duration: 2.2, repeat: Infinity, ease: 'easeInOut' }}
      >
        👆
      </motion.span>

      <p className="mt-2.5 text-center text-[10px] text-slate-600">
        Your role &amp; country are re-checked server-side
      </p>
    </Frame>
  )
}

function SafeArt() {
  const cant = ['Delete', 'Cancel', 'Change status', 'Confirm payment', 'Manage users', 'Run SQL']
  return (
    <Frame className="h-[180px]">
      <div className="flex items-center gap-2">
        <ShieldCheck className="h-4 w-4 text-emerald-400" />
        <p className="text-[11.5px] font-bold text-white">Things OPS_AI cannot do</p>
      </div>

      <div className="mt-2.5 flex flex-wrap gap-1.5">
        {cant.map((c, i) => (
          <motion.span
            key={c}
            initial={{ opacity: 0, scale: 0.85 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.1 + i * 0.09, type: 'spring', stiffness: 280, damping: 18 }}
            className="inline-flex items-center gap-1 rounded-full bg-slate-800/70 px-2.5 py-1 text-[10px] text-slate-400 ring-1 ring-white/5"
          >
            <X className="h-2.5 w-2.5 text-red-400/80" />
            {c}
          </motion.span>
        ))}
      </div>

      <div className="mt-3 space-y-1.5">
        {['Every action signed and time-limited', 'Every run written to the audit log'].map((t, i) => (
          <motion.p
            key={t}
            initial={{ opacity: 0, x: -6 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.7 + i * 0.14 }}
            className="flex items-center gap-1.5 text-[10.5px] text-slate-400"
          >
            <Check className="h-3 w-3 shrink-0 text-emerald-400" />
            {t}
          </motion.p>
        ))}
      </div>
    </Frame>
  )
}

function GoArt() {
  return (
    <div className="relative flex h-[180px] w-full items-center justify-center">
      {['🎉', '✨', '🎊', '⭐'].map((e, i) => (
        <motion.span
          key={e}
          aria-hidden
          className="absolute text-xl"
          style={{ left: `${14 + i * 24}%`, top: '12%' }}
          animate={{ y: [0, 118], opacity: [0, 1, 0], rotate: [0, i % 2 ? 160 : -160] }}
          transition={{ duration: 3, repeat: Infinity, delay: i * 0.55, ease: 'easeIn' }}
        >
          {e}
        </motion.span>
      ))}

      <Frame className="max-w-[260px]">
        <p className="text-[9.5px] font-bold uppercase tracking-wider text-slate-600">Try saying</p>
        <div className="mt-2 flex items-center gap-2 rounded-xl bg-slate-800/80 px-3 py-2.5 ring-1 ring-brand-400/25">
          <Sparkles className="h-3.5 w-3.5 shrink-0 text-brand-300" />
          <span className="truncate text-[11.5px] text-slate-100">{TRY_PROMPT}</span>
        </div>
        <div className="mt-2 flex items-center justify-center gap-1.5 text-[10px] text-slate-500">
          <kbd className="rounded bg-slate-800 px-1.5 py-px text-[9.5px] font-bold text-slate-300 ring-1 ring-white/10">⌘J</kbd>
          opens OPS_AI from anywhere
        </div>
      </Frame>
    </div>
  )
}
