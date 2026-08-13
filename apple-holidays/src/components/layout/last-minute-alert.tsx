'use client'

/**
 * The D-4 last-minute booking alarm — the in-app half of `lib/last-minute.ts`.
 *
 * A booking sold four days or fewer before the guest arrives has already burned
 * every lead time the operation runs on, and the one failure that reliably ruins
 * such a file is that nobody noticed it for a morning. A row in a list does not
 * fix that: the list has to be opened. So this component does three things a
 * list cannot.
 *
 *  1. **It sits in the header on every dashboard page.** A red chip next to the
 *     notification bell carries the outstanding count, so the fact travels with
 *     the operator wherever they are in the system.
 *  2. **It interrupts, with sound.** Late files arrive while people are looking
 *     at something else. The tone is graded — a two-tone alarm for a guest
 *     arriving today or tomorrow, a softer chime further out — so the sound
 *     itself carries the severity.
 *  3. **It will not be dismissed, only acknowledged or deferred.** Closing the
 *     dialog snoozes it; the alarm comes back, and keeps coming back, until
 *     somebody accepts the file. The snooze is shorter the nearer the guest is.
 *
 * Acknowledging is a **team-wide** act, matching the AppleSystem import alert:
 * the point is that *somebody* has picked the booking up, not that everyone read
 * the popup. Who and when are recorded server-side.
 *
 * Muting (`lib/last-minute-alert-prefs.ts`) is the opposite — strictly this
 * browser, and it silences the *interruption* only. The header chip and its
 * count are never suppressed, so a muted machine still shows the work; it just
 * stops shouting about it.
 *
 * Everything here fails soft. A polling error, a blocked AudioContext or a
 * private-mode `localStorage` must never be able to break the dashboard chrome —
 * the worst case is a silent alarm, never a broken header.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSession } from 'next-auth/react'
import Link from 'next/link'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import {
  AlertTriangle, ArrowRight, BellOff, BellRing, Check, CheckCheck,
  Clock, Loader2, Users, Volume2, VolumeX, X, Zap,
} from 'lucide-react'
import { readApiResponse } from '@/lib/utils'
import { LAST_MINUTE_TIERS, arrivalSentence, leadLabel, leadSentence } from '@/lib/last-minute-shared'
import {
  MUTE_CHOICES, isMuted, muteAlert, muteLabel, onAlertPrefsChange,
  readAlertPrefs, setAlertSound, unmuteAlert,
  type LastMinuteAlertPrefs,
} from '@/lib/last-minute-alert-prefs'
// Type-only, so the Prisma-backed module is erased from the client bundle.
import type { LastMinuteFeed } from '@/lib/last-minute'

/** How often the feed is refreshed. Matches the notification bell's cadence. */
const POLL_MS = 60_000

/** How often the snooze clock is checked, so a lapsed snooze re-opens promptly. */
const TICK_MS = 15_000

/**
 * How long "remind me later" holds, per severity of the worst open alert.
 *
 * Graded on purpose. A guest landing today cannot be deferred for twenty
 * minutes, and a file four days out does not deserve to be nagged every five —
 * one snooze length for both would be wrong in one direction or the other, and
 * an alarm that is wrong is an alarm people learn to click through.
 */
const SNOOZE_MS: Record<string, number> = {
  CRITICAL: 5 * 60_000,
  URGENT:  10 * 60_000,
  TIGHT:   20 * 60_000,
}

/**
 * The header band, per tier. Richer than the flat `bandClass` the badges use:
 * this is the one surface in the system that is *meant* to be looked at, so it
 * gets a gradient and a glow rather than a block of colour.
 */
const BAND: Record<string, { gradient: string; glow: string; ring: string }> = {
  CRITICAL: {
    gradient: 'bg-gradient-to-br from-rose-500 via-red-600 to-red-700',
    glow: 'shadow-[0_0_60px_-12px_rgba(225,29,72,0.85)]',
    ring: 'ring-red-500/30',
  },
  URGENT: {
    gradient: 'bg-gradient-to-br from-amber-500 via-orange-500 to-orange-600',
    glow: 'shadow-[0_0_60px_-12px_rgba(249,115,22,0.8)]',
    ring: 'ring-orange-500/30',
  },
  TIGHT: {
    gradient: 'bg-gradient-to-br from-amber-400 via-amber-500 to-yellow-600',
    glow: 'shadow-[0_0_60px_-12px_rgba(245,158,11,0.7)]',
    ring: 'ring-amber-500/30',
  },
}

/** The coloured rail down the left of each row, so severity reads at a glance. */
const RAIL: Record<string, string> = {
  CRITICAL: 'bg-gradient-to-b from-rose-500 to-red-600',
  URGENT: 'bg-gradient-to-b from-amber-500 to-orange-600',
  TIGHT: 'bg-gradient-to-b from-amber-300 to-amber-500',
}

function fmtDate(iso: string): string {
  const d = new Date(iso)
  return isNaN(d.getTime())
    ? '—'
    : d.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short' })
}

export default function LastMinuteAlert() {
  const { data: session, status } = useSession()
  const role = (session?.user as { role?: string } | undefined)?.role
  const reduceMotion = useReducedMotion()

  const [feed, setFeed] = useState<LastMinuteFeed | null>(null)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)   // bookingRef, or '__all__'
  const [error, setError] = useState<string | null>(null)
  const [prefs, setPrefs] = useState<LastMinuteAlertPrefs>({ soundOn: true, muteUntil: 0 })
  const [muteMenu, setMuteMenu] = useState(false)
  const [tick, setTick] = useState(0)

  const snoozeUntilRef = useRef(0)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const soundOnRef = useRef(true)
  const mutedRef = useRef(false)
  /** Refs already alarmed for, so a poll that returns the same list stays quiet. */
  const announcedRef = useRef<Set<string>>(new Set())

  // ─── Preferences ────────────────────────────────────────────────────────────
  // Read on mount (never during render — the server has no localStorage) and
  // re-read on every change, including ones made in the Settings page in another
  // tab. The refs mirror the state so the audio path can stay outside React.

  useEffect(() => {
    const sync = () => setPrefs(readAlertPrefs())
    sync()
    return onAlertPrefsChange(sync)
  }, [])

  // Re-evaluated on every tick as well as on every preference change, so a
  // timed mute lapses on its own without waiting for a poll.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const muted = useMemo(() => isMuted(prefs), [prefs, tick])
  useEffect(() => { soundOnRef.current = prefs.soundOn }, [prefs.soundOn])
  useEffect(() => { mutedRef.current = muted }, [muted])

  const alerts = useMemo(() => feed?.alerts ?? [], [feed])
  const count = alerts.length
  const worst = useMemo(() => {
    if (alerts.some(a => a.tier === 'CRITICAL')) return 'CRITICAL'
    if (alerts.some(a => a.tier === 'URGENT'))   return 'URGENT'
    return 'TIGHT'
  }, [alerts])

  // ─── Sound ──────────────────────────────────────────────────────────────────
  // Generated with the Web Audio API rather than shipped as a file: no asset to
  // 404, no CDN, and the two tones stay distinguishable at any volume. The same
  // pair of voices the live operations board already uses, so the sounds mean
  // the same thing in both places.

  const play = useCallback((harsh: boolean) => {
    if (!soundOnRef.current || mutedRef.current) return
    try {
      const AC = window.AudioContext
        || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      const ctx = audioCtxRef.current ?? (audioCtxRef.current = new AC())
      if (ctx.state === 'suspended') void ctx.resume()
      const t0 = ctx.currentTime

      if (harsh) {
        // Three sweeps of a high→low two-tone wail — unmistakably an alarm.
        for (let i = 0; i < 3; i++) {
          const base = t0 + i * 0.5
          ;([[880, base], [660, base + 0.25]] as [number, number][]).forEach(([f, t]) => {
            const osc = ctx.createOscillator(), gain = ctx.createGain()
            osc.type = 'sawtooth'; osc.frequency.value = f
            gain.gain.setValueAtTime(0, t)
            gain.gain.linearRampToValueAtTime(0.3, t + 0.03)
            gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.24)
            osc.connect(gain); gain.connect(ctx.destination)
            osc.start(t); osc.stop(t + 0.26)
          })
        }
      } else {
        // A rising minor third — attention-getting without being an emergency.
        ;[659.25, 830.61].forEach((f, i) => {
          const osc = ctx.createOscillator(), gain = ctx.createGain()
          osc.type = 'triangle'; osc.frequency.value = f
          const t = t0 + i * 0.16
          gain.gain.setValueAtTime(0, t)
          gain.gain.linearRampToValueAtTime(0.26, t + 0.03)
          gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.5)
          osc.connect(gain); gain.connect(ctx.destination)
          osc.start(t); osc.stop(t + 0.55)
        })
      }
    } catch { /* audio unavailable or blocked — the popup still shows */ }
  }, [])

  // Browsers refuse to start audio before the user has interacted with the page.
  // Unlock the context on the first click anywhere, so the *second* alarm of a
  // session is always audible even if the first one was swallowed.
  useEffect(() => {
    const unlock = () => {
      try {
        const AC = window.AudioContext
          || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
        const ctx = audioCtxRef.current ?? (audioCtxRef.current = new AC())
        if (ctx.state === 'suspended') void ctx.resume()
      } catch { /* nothing to unlock */ }
    }
    window.addEventListener('pointerdown', unlock, { once: true })
    return () => window.removeEventListener('pointerdown', unlock)
  }, [])

  // ─── Feed ───────────────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/bookings/last-minute')
      const json = await readApiResponse<LastMinuteFeed>(res)
      if (json.success && json.data) setFeed(json.data)
    } catch { /* keep the last known state — the header must never break */ }
  }, [])

  useEffect(() => {
    if (status !== 'authenticated' || role === 'CLIENT') return
    load()
    const iv = setInterval(load, POLL_MS)
    return () => clearInterval(iv)
  }, [status, role, load])

  // Drive the snooze and mute clocks. Without this the dialog would only ever
  // re-open on a poll boundary, which is the wrong granularity for a
  // five-minute snooze — and a lapsed mute would stay silent for a minute more.
  useEffect(() => {
    const iv = setInterval(() => setTick(t => t + 1), TICK_MS)
    return () => clearInterval(iv)
  }, [])

  // Interrupt: open the dialog whenever there is something outstanding and no
  // snooze is running. A booking that has never been alarmed for jumps the
  // snooze — new news always gets through. A *mute* is stronger than that: it
  // suppresses the popup entirely, on purpose, which is why the header chip
  // below is never hidden.
  useEffect(() => {
    if (count === 0) { setOpen(false); return }
    if (open) return

    if (muted) {
      // Still mark them seen, so un-muting does not replay an old backlog as
      // though it had just landed.
      alerts.forEach(a => announcedRef.current.add(a.bookingRef))
      return
    }

    const fresh = alerts.filter(a => !announcedRef.current.has(a.bookingRef))
    const snoozed = Date.now() < snoozeUntilRef.current
    if (snoozed && fresh.length === 0) return

    const loudest = fresh.length > 0
      ? (fresh.some(a => a.tier === 'CRITICAL') ? 'CRITICAL' : fresh.some(a => a.tier === 'URGENT') ? 'URGENT' : 'TIGHT')
      : worst

    alerts.forEach(a => announcedRef.current.add(a.bookingRef))
    setOpen(true)
    play(LAST_MINUTE_TIERS[loudest as keyof typeof LAST_MINUTE_TIERS].alarm)
  }, [alerts, count, open, worst, play, muted, tick])

  // Say it in the tab title too, so an operator working in another tab still
  // sees it. Restored on unmount and as soon as the last file is acknowledged.
  useEffect(() => {
    if (count === 0) return
    const original = document.title
    document.title = `(${count}) ⚡ Last minute — ${original.replace(/^\(\d+\) ⚡ Last minute — /, '')}`
    return () => { document.title = original }
  }, [count])

  // ─── Actions ────────────────────────────────────────────────────────────────

  const snooze = useCallback(() => {
    snoozeUntilRef.current = Date.now() + (SNOOZE_MS[worst] ?? SNOOZE_MS.TIGHT)
    setMuteMenu(false)
    setOpen(false)
  }, [worst])

  // Escape closes the way the X does — deferred, never dismissed.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (muteMenu) { setMuteMenu(false); return }
      snooze()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, muteMenu, snooze])

  const acknowledge = useCallback(async (payload: { bookingRef?: string; all?: boolean }) => {
    setBusy(payload.all ? '__all__' : payload.bookingRef ?? null)
    setError(null)
    try {
      const res = await fetch('/api/bookings/last-minute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const json = await readApiResponse<{ acknowledged: string[] }>(res)
      if (!json.success) {
        // Never close on a failed save: the alarm stopping is the only evidence
        // anyone owns the file, so a write that did not land must stay visible.
        setError(json.error ?? 'Could not save the acknowledgement. Please try again.')
        return
      }
      const done = new Set(json.data?.acknowledged ?? [])
      setFeed(prev => prev ? { ...prev, alerts: prev.alerts.filter(a => !done.has(a.bookingRef)) } : prev)
      void load()
    } catch {
      setError('Could not reach the server. The booking is still unacknowledged.')
    } finally {
      setBusy(null)
    }
  }, [load])

  const toggleSound = useCallback(() => setAlertSound(!prefs.soundOn), [prefs.soundOn])

  /** Mute for `hours`, or — with no argument — until it is switched back on. */
  const applyMute = useCallback((hours?: number) => {
    muteAlert(hours)
    setMuteMenu(false)
    setOpen(false)
  }, [])

  if (status !== 'authenticated' || role === 'CLIENT') return null

  const critical = alerts.filter(a => a.tier === 'CRITICAL').length
  const urgent = alerts.filter(a => a.tier === 'URGENT').length
  const band = BAND[worst] ?? BAND.TIGHT
  const snoozeMinutes = Math.round((SNOOZE_MS[worst] ?? SNOOZE_MS.TIGHT) / 60_000)
  const mutedFor = muteLabel(prefs)

  /** Framer variants, collapsed to nothing when the OS asks for less motion. */
  const listItem = reduceMotion
    ? { hidden: { opacity: 1 }, show: { opacity: 1 } }
    : { hidden: { opacity: 0, x: -14 }, show: { opacity: 1, x: 0 } }

  return (
    <>
      {/* ── Header chip ──────────────────────────────────────────────────────
          Only rendered when something is outstanding. A permanent "0 late
          bookings" control would be chrome nobody reads; its appearing is the
          message. Muting never hides it — it only stops the popup. */}
      {count > 0 && (
        <motion.button
          layout
          initial={reduceMotion ? false : { opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          whileHover={reduceMotion ? undefined : { scale: 1.04 }}
          whileTap={reduceMotion ? undefined : { scale: 0.96 }}
          transition={{ type: 'spring', stiffness: 420, damping: 24 }}
          onClick={() => { snoozeUntilRef.current = 0; setOpen(true) }}
          title={
            muted
              ? `${count} last-minute booking${count === 1 ? '' : 's'} awaiting acknowledgement — alerts are muted on this browser`
              : `${count} last-minute booking${count === 1 ? '' : 's'} awaiting acknowledgement`
          }
          className={`group relative flex items-center gap-1.5 pl-2 pr-2.5 py-1.5 rounded-lg text-xs font-bold border overflow-hidden transition-colors ${
            muted
              ? 'bg-slate-100 text-slate-500 border-slate-300 hover:bg-slate-200'
              : critical > 0
                ? 'bg-red-600 text-white border-red-700 hover:bg-red-700'
                : 'bg-amber-100 text-amber-800 border-amber-300 hover:bg-amber-200'
          }`}
        >
          {/* A slow sheen instead of `animate-pulse`: it reads as "live" without
              the whole chip fading out, which made the count hard to read. */}
          {!reduceMotion && !muted && critical > 0 && (
            <motion.span
              aria-hidden
              className="absolute inset-0 bg-gradient-to-r from-transparent via-white/40 to-transparent"
              initial={{ x: '-120%' }}
              animate={{ x: '120%' }}
              transition={{ duration: 1.8, repeat: Infinity, repeatDelay: 1.6, ease: 'easeInOut' }}
            />
          )}
          {muted
            ? <BellOff className="w-3.5 h-3.5 relative" />
            : (
              <motion.span
                className="relative"
                animate={reduceMotion || critical === 0 ? undefined : { rotate: [0, -12, 12, -8, 0] }}
                transition={{ duration: 0.7, repeat: Infinity, repeatDelay: 2.4 }}
              >
                <Zap className="w-3.5 h-3.5" />
              </motion.span>
            )}
          <span className="hidden sm:inline relative">Last minute</span>
          <span className={`relative min-w-[18px] h-[18px] px-1 rounded-full flex items-center justify-center ${
            muted ? 'bg-slate-300/70 text-slate-700' : 'bg-white/25'
          }`}>
            {count}
          </span>
        </motion.button>
      )}

      {/* ── The dialog ───────────────────────────────────────────────────────── */}
      <AnimatePresence>
        {open && count > 0 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[75] flex items-center justify-center bg-slate-950/70 backdrop-blur-md p-4"
          >
            {/* A soft pool of the tier colour behind the card. Purely atmosphere,
                but it is what makes the popup read as an alarm rather than a form. */}
            {!reduceMotion && (
              <motion.div
                aria-hidden
                className={`pointer-events-none absolute w-[38rem] h-[38rem] rounded-full blur-3xl ${
                  worst === 'CRITICAL' ? 'bg-red-600/25' : worst === 'URGENT' ? 'bg-orange-500/20' : 'bg-amber-400/20'
                }`}
                initial={{ opacity: 0, scale: 0.7 }}
                animate={{ opacity: [0.5, 0.9, 0.5], scale: 1 }}
                transition={{ opacity: { duration: 4, repeat: Infinity, ease: 'easeInOut' }, scale: { duration: 0.6 } }}
              />
            )}

            <motion.div
              initial={{ opacity: 0, scale: 0.94, y: 18 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.97, y: 10 }}
              transition={{ type: 'spring', stiffness: 320, damping: 27 }}
              role="alertdialog"
              aria-modal="true"
              aria-labelledby="last-minute-alert-title"
              className={`relative w-full max-w-2xl bg-white rounded-3xl overflow-hidden flex flex-col max-h-[88vh] ring-1 ${band.ring} ${band.glow}`}
            >
              {/* ── Header — coloured by the worst file in the list ── */}
              <div className={`relative px-6 py-5 overflow-hidden ${band.gradient}`}>
                {/* Diagonal sheen sweeping across the band. */}
                {!reduceMotion && (
                  <motion.div
                    aria-hidden
                    className="absolute inset-0 bg-gradient-to-r from-transparent via-white/25 to-transparent skew-x-12"
                    initial={{ x: '-150%' }}
                    animate={{ x: '150%' }}
                    transition={{ duration: 2.6, repeat: Infinity, repeatDelay: 2.4, ease: 'easeInOut' }}
                  />
                )}

                <div className="relative flex items-start gap-3">
                  {/* The icon, with radar rings when a guest is arriving today. */}
                  <div className="relative w-11 h-11 shrink-0">
                    {!reduceMotion && critical > 0 && [0, 0.8].map(delay => (
                      <motion.span
                        key={delay}
                        aria-hidden
                        className="absolute inset-0 rounded-2xl border-2 border-white/50"
                        initial={{ scale: 1, opacity: 0.6 }}
                        animate={{ scale: 1.7, opacity: 0 }}
                        transition={{ duration: 1.8, repeat: Infinity, delay, ease: 'easeOut' }}
                      />
                    ))}
                    <div className="absolute inset-0 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center">
                      <motion.span
                        animate={reduceMotion ? undefined : { scale: [1, 1.18, 1] }}
                        transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
                      >
                        <Zap className="w-5 h-5 text-white" />
                      </motion.span>
                    </div>
                  </div>

                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-white/70">
                      Last-minute booking · inside D-4
                    </p>
                    <h2 id="last-minute-alert-title" className="text-white font-bold text-lg leading-tight mt-0.5">
                      {count === 1
                        ? '1 booking was sold with almost no lead time'
                        : `${count} bookings were sold with almost no lead time`}
                    </h2>
                    <p className="text-white/80 text-xs mt-1">
                      {critical > 0
                        ? `${critical} of them ${critical === 1 ? 'arrives' : 'arrive'} today or tomorrow. Confirm the hotel, transport and airport meeting now.`
                        : 'Every supplier is on short notice and the D-10 guest reconfirmation window is already gone.'}
                    </p>
                  </div>

                  {/* ── Header controls: sound, mute, close ── */}
                  <div className="flex items-center gap-0.5 shrink-0">
                    <motion.button
                      whileTap={reduceMotion ? undefined : { scale: 0.88 }}
                      onClick={toggleSound}
                      aria-label={prefs.soundOn ? 'Mute the alert sound' : 'Unmute the alert sound'}
                      title={prefs.soundOn ? 'Mute the alert sound on this browser' : 'Unmute the alert sound on this browser'}
                      className="p-1.5 rounded-lg text-white/70 hover:text-white hover:bg-white/15 transition-colors"
                    >
                      {prefs.soundOn ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
                    </motion.button>

                    {/* Mute menu — the popup-level twin of the Settings card. */}
                    <div className="relative">
                      <motion.button
                        whileTap={reduceMotion ? undefined : { scale: 0.88 }}
                        onClick={() => setMuteMenu(v => !v)}
                        aria-label="Mute these alerts for a while"
                        aria-expanded={muteMenu}
                        title="Stop these pop-ups for a while on this browser"
                        className={`p-1.5 rounded-lg transition-colors ${
                          muteMenu ? 'bg-white/25 text-white' : 'text-white/70 hover:text-white hover:bg-white/15'
                        }`}
                      >
                        <BellOff className="w-4 h-4" />
                      </motion.button>

                      <AnimatePresence>
                        {muteMenu && (
                          <motion.div
                            initial={{ opacity: 0, y: -6, scale: 0.96 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: -6, scale: 0.96 }}
                            transition={{ duration: 0.15 }}
                            className="absolute right-0 top-full mt-2 w-60 rounded-2xl bg-white shadow-2xl ring-1 ring-slate-900/10 p-2 z-10"
                          >
                            <p className="px-2 pt-1 pb-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                              Mute pop-ups on this browser
                            </p>
                            {MUTE_CHOICES.map(h => (
                              <button
                                key={h}
                                onClick={() => applyMute(h)}
                                className="w-full text-left px-2 py-1.5 rounded-lg text-xs font-semibold text-slate-700 hover:bg-slate-100 transition-colors"
                              >
                                For {h} hour{h === 1 ? '' : 's'}
                              </button>
                            ))}
                            <button
                              onClick={() => applyMute()}
                              className="w-full text-left px-2 py-1.5 rounded-lg text-xs font-semibold text-rose-600 hover:bg-rose-50 transition-colors"
                            >
                              Turn off until I switch it back on
                            </button>
                            <p className="px-2 pt-2 text-[10px] text-slate-400 leading-snug border-t border-slate-100 mt-1">
                              Only this browser, and only the pop-up. The header count stays,
                              and nobody else is affected.
                            </p>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>

                    <motion.button
                      whileTap={reduceMotion ? undefined : { scale: 0.88 }}
                      onClick={snooze}
                      aria-label={`Close — reminds you again in ${snoozeMinutes} minutes`}
                      title={`Close. The alarm returns in ${snoozeMinutes} min until somebody acknowledges these.`}
                      className="p-1.5 rounded-lg text-white/70 hover:text-white hover:bg-white/15 transition-colors"
                    >
                      <X className="w-4 h-4" />
                    </motion.button>
                  </div>
                </div>

                {/* Severity strip — the shape of the backlog in one line. */}
                <div className="relative mt-3 flex items-center gap-1.5 flex-wrap">
                  {([
                    ['Arriving today / tomorrow', critical],
                    ['Two days out', urgent],
                    ['Three to four days out', count - critical - urgent],
                  ] as [string, number][])
                    .filter(([, n]) => n > 0)
                    .map(([label, n], i) => (
                      <motion.span
                        key={label}
                        initial={reduceMotion ? false : { opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.1 + i * 0.06 }}
                        className="inline-flex items-center gap-1.5 rounded-full bg-white/15 backdrop-blur-sm px-2.5 py-1 text-[10px] font-semibold text-white"
                      >
                        <span className="font-bold tabular-nums">{n}</span> {label}
                      </motion.span>
                    ))}
                </div>
              </div>

              {/* ── The list ── */}
              <div className="flex-1 overflow-y-auto divide-y divide-slate-100 bg-gradient-to-b from-white to-slate-50/60">
                <AnimatePresence initial={false} mode="popLayout">
                  {alerts.map((a, i) => {
                    const meta = LAST_MINUTE_TIERS[a.tier]
                    const pax = a.paxAdults + a.paxChildren + a.paxInfants
                    const working = busy === a.bookingRef
                    return (
                      <motion.div
                        key={a.bookingRef}
                        layout={!reduceMotion}
                        variants={listItem}
                        initial="hidden"
                        animate="show"
                        exit={reduceMotion ? { opacity: 0 } : { opacity: 0, x: 60, height: 0, marginTop: 0, paddingTop: 0, paddingBottom: 0 }}
                        transition={{ delay: reduceMotion ? 0 : Math.min(i * 0.045, 0.35), type: 'spring', stiffness: 380, damping: 30 }}
                        className="group relative px-6 py-4 hover:bg-white transition-colors"
                      >
                        {/* Severity rail, grown on hover so the row feels alive. */}
                        <span
                          aria-hidden
                          className={`absolute left-0 top-0 bottom-0 w-1 origin-center transition-transform duration-200 scale-y-0 group-hover:scale-y-100 ${RAIL[a.tier] ?? RAIL.TIGHT}`}
                        />

                        <div className="flex items-start gap-3">
                          <span className={`mt-0.5 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide border shrink-0 ${meta.badgeClass}`}>
                            <Zap className="w-2.5 h-2.5" /> {leadLabel(a.leadDays)}
                          </span>

                          <div className="min-w-0 flex-1 space-y-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <Link
                                href={`/dashboard/bookings/${a.bookingRef}`}
                                onClick={snooze}
                                className="font-mono font-bold text-sm text-slate-900 hover:text-brand-600 transition-colors"
                              >
                                {a.bookingRef}
                              </Link>
                              {a.leadName && <span className="text-xs text-slate-600 truncate">{a.leadName}</span>}
                              {a.agent && <span className="text-[11px] text-slate-400 truncate">· {a.agent}</span>}
                            </div>

                            <p className="text-[11px] text-slate-600 flex items-center gap-3 flex-wrap">
                              <span className="inline-flex items-center gap-1 font-semibold text-slate-700">
                                <Clock className="w-3 h-3" />
                                {fmtDate(a.arrivalDate)} — {arrivalSentence(a.daysToArrival)}
                              </span>
                              <span className="inline-flex items-center gap-1">
                                <Users className="w-3 h-3" /> {pax} pax
                              </span>
                              <span className="text-slate-400">{leadSentence(a.leadDays)}</span>
                            </p>

                            <p className="text-[11px] text-slate-500 leading-snug">{meta.hint}</p>
                          </div>

                          <div className="flex flex-col items-end gap-1.5 shrink-0">
                            <motion.button
                              whileHover={reduceMotion || busy !== null ? undefined : { scale: 1.04 }}
                              whileTap={reduceMotion || busy !== null ? undefined : { scale: 0.95 }}
                              onClick={() => acknowledge({ bookingRef: a.bookingRef })}
                              disabled={busy !== null}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-bold text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-50 shadow-sm transition-colors"
                            >
                              {working ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                              I&apos;ve got this
                            </motion.button>
                            <Link
                              href={`/dashboard/bookings/${a.bookingRef}`}
                              onClick={snooze}
                              className="inline-flex items-center gap-1 text-[11px] font-semibold text-blue-600 hover:text-blue-800 group/open"
                            >
                              Open
                              <ArrowRight className="w-3 h-3 transition-transform group-hover/open:translate-x-0.5" />
                            </Link>
                          </div>
                        </div>
                      </motion.div>
                    )
                  })}
                </AnimatePresence>

                {feed?.truncated && (
                  <p className="px-6 py-3 text-[11px] text-slate-500">
                    Only the nearest {alerts.length} are shown. Acknowledge these to see the rest.
                  </p>
                )}
                {feed && !feed.acksReadable && (
                  <p className="px-6 py-3 text-[11px] text-amber-600 flex items-start gap-1.5">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
                    Acknowledgements cannot be read right now, so this list may include files
                    somebody has already taken. Tell the IT team.
                  </p>
                )}
              </div>

              {/* ── Actions ── */}
              <div className="px-6 py-4 bg-white border-t border-slate-100 space-y-2">
                <AnimatePresence>
                  {error && (
                    <motion.p
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      className="text-[11px] text-rose-600 flex items-start gap-1.5 overflow-hidden"
                    >
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" /> {error}
                    </motion.p>
                  )}
                </AnimatePresence>

                <div className="flex flex-col-reverse sm:flex-row sm:items-center gap-2 sm:justify-between">
                  <button
                    onClick={snooze}
                    className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-700 px-2 py-2 transition-colors"
                  >
                    <BellOff className="w-3.5 h-3.5" />
                    Remind me in {snoozeMinutes} min
                  </button>
                  <motion.button
                    whileHover={reduceMotion || busy !== null ? undefined : { scale: 1.02 }}
                    whileTap={reduceMotion || busy !== null ? undefined : { scale: 0.97 }}
                    onClick={() => acknowledge({ all: true })}
                    disabled={busy !== null}
                    className="relative flex items-center justify-center gap-1.5 px-5 py-2.5 text-sm font-semibold text-white bg-gradient-to-br from-slate-800 to-slate-900 hover:from-slate-700 hover:to-slate-800 rounded-xl shadow-lg shadow-slate-900/20 transition-colors disabled:opacity-60 overflow-hidden"
                  >
                    {busy === '__all__' ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCheck className="w-4 h-4" />}
                    Acknowledge all {count}
                  </motion.button>
                </div>

                <p className="text-[10px] text-slate-400 flex items-center gap-1">
                  <BellRing className="w-3 h-3" />
                  Acknowledging clears this for the whole team, and is recorded against your name.
                  Until then the alarm returns every {snoozeMinutes} minutes.
                </p>

                {mutedFor && (
                  <p className="text-[10px] text-slate-500 flex items-center gap-1.5">
                    <BellOff className="w-3 h-3" />
                    {mutedFor} on this browser.
                    <button
                      onClick={() => unmuteAlert()}
                      className="font-semibold text-blue-600 hover:text-blue-800 underline underline-offset-2"
                    >
                      Turn alerts back on
                    </button>
                  </p>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
