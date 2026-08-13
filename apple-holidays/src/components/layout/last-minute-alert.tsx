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
 * Everything here fails soft. A polling error, a blocked AudioContext or a
 * private-mode `localStorage` must never be able to break the dashboard chrome —
 * the worst case is a silent alarm, never a broken header.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSession } from 'next-auth/react'
import Link from 'next/link'
import { AnimatePresence, motion } from 'framer-motion'
import {
  AlertTriangle, ArrowRight, BellOff, BellRing, Check, CheckCheck,
  Clock, Loader2, Users, Volume2, VolumeX, Zap,
} from 'lucide-react'
import { readApiResponse } from '@/lib/utils'
import { LAST_MINUTE_TIERS, arrivalSentence, leadLabel, leadSentence } from '@/lib/last-minute-shared'
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

/** Sound preference. Per browser, not per user — it is about the room, not the account. */
const SOUND_KEY = 'last_minute_alert_sound'

function readSoundPref(): boolean {
  try { return localStorage.getItem(SOUND_KEY) !== 'off' } catch { return true }
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

  const [feed, setFeed] = useState<LastMinuteFeed | null>(null)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)   // bookingRef, or '__all__'
  const [error, setError] = useState<string | null>(null)
  const [soundOn, setSoundOn] = useState(true)
  const [, forceTick] = useState(0)

  const snoozeUntilRef = useRef(0)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const soundOnRef = useRef(true)
  /** Refs already alarmed for, so a poll that returns the same list stays quiet. */
  const announcedRef = useRef<Set<string>>(new Set())

  useEffect(() => { setSoundOn(readSoundPref()) }, [])
  useEffect(() => { soundOnRef.current = soundOn }, [soundOn])

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
    if (!soundOnRef.current) return
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

  // Drive the snooze clock. Without this the dialog would only ever re-open on a
  // poll boundary, which is the wrong granularity for a five-minute snooze.
  useEffect(() => {
    const iv = setInterval(() => forceTick(t => t + 1), TICK_MS)
    return () => clearInterval(iv)
  }, [])

  // Interrupt: open the dialog whenever there is something outstanding and no
  // snooze is running. A booking that has never been alarmed for jumps the
  // snooze — new news always gets through.
  useEffect(() => {
    if (count === 0) { setOpen(false); return }
    if (open) return

    const fresh = alerts.filter(a => !announcedRef.current.has(a.bookingRef))
    const snoozed = Date.now() < snoozeUntilRef.current
    if (snoozed && fresh.length === 0) return

    const loudest = fresh.length > 0
      ? (fresh.some(a => a.tier === 'CRITICAL') ? 'CRITICAL' : fresh.some(a => a.tier === 'URGENT') ? 'URGENT' : 'TIGHT')
      : worst

    alerts.forEach(a => announcedRef.current.add(a.bookingRef))
    setOpen(true)
    play(LAST_MINUTE_TIERS[loudest as keyof typeof LAST_MINUTE_TIERS].alarm)
  }, [alerts, count, open, worst, play])

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
    setOpen(false)
  }, [worst])

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

  const toggleSound = useCallback(() => {
    setSoundOn(on => {
      const next = !on
      try { localStorage.setItem(SOUND_KEY, next ? 'on' : 'off') } catch { /* private mode */ }
      return next
    })
  }, [])

  if (status !== 'authenticated' || role === 'CLIENT') return null

  const critical = alerts.filter(a => a.tier === 'CRITICAL').length
  const band = LAST_MINUTE_TIERS[worst as keyof typeof LAST_MINUTE_TIERS]
  const snoozeMinutes = Math.round((SNOOZE_MS[worst] ?? SNOOZE_MS.TIGHT) / 60_000)

  return (
    <>
      {/* ── Header chip ──────────────────────────────────────────────────────
          Only rendered when something is outstanding. A permanent "0 late
          bookings" control would be chrome nobody reads; its appearing is the
          message. */}
      {count > 0 && (
        <button
          onClick={() => { snoozeUntilRef.current = 0; setOpen(true) }}
          title={`${count} last-minute booking${count === 1 ? '' : 's'} awaiting acknowledgement`}
          className={`relative flex items-center gap-1.5 pl-2 pr-2.5 py-1.5 rounded-lg text-xs font-bold border transition-colors ${
            critical > 0
              ? 'bg-red-600 text-white border-red-700 hover:bg-red-700 animate-pulse'
              : 'bg-amber-100 text-amber-800 border-amber-300 hover:bg-amber-200'
          }`}
        >
          <Zap className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Last minute</span>
          <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-white/25 flex items-center justify-center">
            {count}
          </span>
        </button>
      )}

      {/* ── The dialog ───────────────────────────────────────────────────────── */}
      <AnimatePresence>
        {open && count > 0 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[75] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4"
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 14 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.97, y: 8 }}
              transition={{ type: 'spring', stiffness: 300, damping: 26 }}
              role="alertdialog"
              aria-modal="true"
              aria-labelledby="last-minute-alert-title"
              className="w-full max-w-2xl bg-white rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[88vh]"
            >
              {/* Header — coloured by the worst file in the list */}
              <div className={`px-6 py-5 ${band.bandClass}`}>
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center shrink-0">
                    <Zap className="w-5 h-5 text-white" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] font-bold uppercase tracking-wider text-white/70">
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
                  <button
                    onClick={toggleSound}
                    aria-label={soundOn ? 'Mute the alert sound' : 'Unmute the alert sound'}
                    title={soundOn ? 'Mute the alert sound on this browser' : 'Unmute the alert sound on this browser'}
                    className="p-1.5 rounded-lg text-white/70 hover:text-white hover:bg-white/15 transition-colors shrink-0"
                  >
                    {soundOn ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {/* The list */}
              <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
                {alerts.map(a => {
                  const meta = LAST_MINUTE_TIERS[a.tier]
                  const pax = a.paxAdults + a.paxChildren + a.paxInfants
                  return (
                    <div key={a.bookingRef} className="px-6 py-4 hover:bg-slate-50/70 transition-colors">
                      <div className="flex items-start gap-3">
                        <span className={`mt-0.5 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide border shrink-0 ${meta.badgeClass}`}>
                          <Zap className="w-2.5 h-2.5" /> {leadLabel(a.leadDays)}
                        </span>

                        <div className="min-w-0 flex-1 space-y-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <Link
                              href={`/dashboard/bookings/${a.bookingRef}`}
                              onClick={snooze}
                              className="font-mono font-bold text-sm text-slate-900 hover:text-brand-600"
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
                          <button
                            onClick={() => acknowledge({ bookingRef: a.bookingRef })}
                            disabled={busy !== null}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-bold text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-50 transition-colors"
                          >
                            {busy === a.bookingRef ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                            I&apos;ve got this
                          </button>
                          <Link
                            href={`/dashboard/bookings/${a.bookingRef}`}
                            onClick={snooze}
                            className="inline-flex items-center gap-1 text-[11px] font-semibold text-blue-600 hover:text-blue-800"
                          >
                            Open <ArrowRight className="w-3 h-3" />
                          </Link>
                        </div>
                      </div>
                    </div>
                  )
                })}

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

              {/* Actions */}
              <div className="px-6 py-4 bg-slate-50 border-t border-slate-100 space-y-2">
                {error && (
                  <p className="text-[11px] text-rose-600 flex items-start gap-1.5">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" /> {error}
                  </p>
                )}
                <div className="flex flex-col-reverse sm:flex-row sm:items-center gap-2 sm:justify-between">
                  <button
                    onClick={snooze}
                    className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-700 px-2 py-2"
                  >
                    <BellOff className="w-3.5 h-3.5" />
                    Remind me in {snoozeMinutes} min
                  </button>
                  <button
                    onClick={() => acknowledge({ all: true })}
                    disabled={busy !== null}
                    className="flex items-center justify-center gap-1.5 px-4 py-2 text-sm font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-xl transition-colors disabled:opacity-60"
                  >
                    {busy === '__all__' ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCheck className="w-4 h-4" />}
                    Acknowledge all {count}
                  </button>
                </div>
                <p className="text-[10px] text-slate-400 flex items-center gap-1">
                  <BellRing className="w-3 h-3" />
                  Acknowledging clears this for the whole team, and is recorded against your name.
                  Until then the alarm returns every {snoozeMinutes} minutes.
                </p>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
