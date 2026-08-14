'use client'

/**
 * The last-minute board — the permanent header icon beside the notification bell.
 *
 * The D-4 alarm (`last-minute-alert.tsx`) is deliberately self-erasing: the
 * moment somebody clicks "I've got this" the chip and the popup vanish, because
 * an alarm that stays up after it has been answered is an alarm people stop
 * reading. That leaves a real gap, and it is the gap that makes the whole
 * feature look broken from the outside: once the morning's files have been
 * acknowledged there is nowhere in the system to ask *"what came in late this
 * week, and who has it?"* — the work is invisible again.
 *
 * So this icon is always there, whether or not anything is outstanding, and it
 * opens the *board*: every booking sold inside D-4 from a few days back to every
 * late file still ahead of us, acknowledged ones included, with the name of
 * whoever took each one.
 *
 * Division of labour with the alarm:
 *   • the alarm interrupts — sound, modal, snooze, and only unacknowledged files;
 *   • the board is browsed — never interrupts, never makes a sound, shows
 *     everything, and is opened on purpose.
 *
 * Both read the same rule from `lib/last-minute-shared.ts`, so a count here can
 * never disagree with the count there. Acknowledging from either goes through
 * the same POST, so the two stay in step without talking to each other.
 *
 * Fails soft, like everything else in the header: a polling error keeps the last
 * known board rather than breaking the dashboard chrome.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSession } from 'next-auth/react'
import Link from 'next/link'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import {
  ArrowRight, Check, CheckCircle2, Clock, Loader2, PlaneLanding,
  RefreshCw, Sparkles, Users, X, Zap,
} from 'lucide-react'
import { readApiResponse } from '@/lib/utils'
import { LAST_MINUTE_DAYS, LAST_MINUTE_TIERS, arrivalSentence, leadLabel, leadSentence } from '@/lib/last-minute-shared'
// Type-only, so the Prisma-backed module is erased from the client bundle.
import type { LastMinuteBoard, LastMinuteBoardRow } from '@/lib/last-minute'

/** Refresh cadence while the panel is closed — slower than the alarm's, on purpose. */
const POLL_MS = 120_000

/** Which slice of the board is showing. */
type Filter = 'ALL' | 'OUTSTANDING' | 'TAKEN' | 'ARRIVED'

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'ALL',         label: 'All' },
  { key: 'OUTSTANDING', label: 'Outstanding' },
  { key: 'TAKEN',       label: 'Taken' },
  { key: 'ARRIVED',     label: 'Landed' },
]

/** Ring colour per tier — the stroke of the little lead-time meter on each row. */
const RING: Record<string, string> = {
  CRITICAL: 'stroke-rose-500',
  URGENT: 'stroke-orange-500',
  TIGHT: 'stroke-amber-400',
}

const DOT: Record<string, string> = {
  CRITICAL: 'bg-rose-500',
  URGENT: 'bg-orange-500',
  TIGHT: 'bg-amber-400',
}

function fmtDay(iso: string): string {
  const d = new Date(iso)
  return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short' })
}

function fmtWhen(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  const mins = Math.floor((Date.now() - d.getTime()) / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  if (mins < 1440) return `${Math.floor(mins / 60)}h ago`
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
}

/** The day heading a row sits under. */
function groupOf(row: LastMinuteBoardRow): string {
  if (row.daysToArrival < 0) return 'Already landed'
  if (row.daysToArrival === 0) return 'Arriving today'
  if (row.daysToArrival === 1) return 'Arriving tomorrow'
  return `${fmtDay(row.arrivalDate)} — in ${row.daysToArrival} days`
}

/**
 * The lead-time meter: a ring that fills as the sale gets later, so D-0 reads as
 * a full circle without anybody having to parse the number first.
 */
function LeadRing({ leadDays, tier, still }: { leadDays: number; tier: string; still: boolean }) {
  const r = 13
  const circumference = 2 * Math.PI * r
  const filled = (LAST_MINUTE_DAYS - Math.min(Math.max(leadDays, 0), LAST_MINUTE_DAYS)) / LAST_MINUTE_DAYS
  return (
    <div className="relative w-9 h-9 shrink-0">
      <svg viewBox="0 0 32 32" className="w-9 h-9 -rotate-90">
        <circle cx="16" cy="16" r={r} className="stroke-slate-200" strokeWidth="3" fill="none" />
        <motion.circle
          cx="16" cy="16" r={r} strokeWidth="3" fill="none" strokeLinecap="round"
          className={RING[tier] ?? RING.TIGHT}
          strokeDasharray={circumference}
          initial={still ? false : { strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: circumference * (1 - Math.max(filled, 0.08)) }}
          transition={{ duration: 0.7, ease: 'easeOut' }}
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-[10px] font-bold text-slate-700 tabular-nums">
        {leadLabel(leadDays)}
      </span>
    </div>
  )
}

/** A summary tile. The number counts up, which is what makes the row feel live. */
function Tile({ n, label, tone, still }: { n: number; label: string; tone: string; still: boolean }) {
  return (
    <motion.div
      initial={still ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 320, damping: 26 }}
      className="flex-1 min-w-0 rounded-xl bg-white/10 backdrop-blur-sm px-2.5 py-2 border border-white/10"
    >
      <p className={`text-lg font-bold leading-none tabular-nums ${tone}`}>{n}</p>
      <p className="text-[10px] text-white/70 mt-1 truncate">{label}</p>
    </motion.div>
  )
}

export default function LastMinutePanel() {
  const { data: session, status } = useSession()
  const role = (session?.user as { role?: string } | undefined)?.role
  const reduceMotion = useReducedMotion()
  const still = Boolean(reduceMotion)

  const [board, setBoard] = useState<LastMinuteBoard | null>(null)
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [filter, setFilter] = useState<Filter>('ALL')
  const [busy, setBusy] = useState<string | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)

  const load = useCallback(async (spin = false) => {
    if (spin) setLoading(true)
    try {
      const res = await fetch('/api/bookings/last-minute/board')
      const json = await readApiResponse<LastMinuteBoard>(res)
      if (json.success && json.data) setBoard(json.data)
    } catch { /* keep the last known board — the header must never break */ }
    finally { if (spin) setLoading(false) }
  }, [])

  useEffect(() => {
    if (status !== 'authenticated' || role === 'CLIENT') return
    load()
    const iv = setInterval(() => load(), POLL_MS)
    return () => clearInterval(iv)
  }, [status, role, load])

  // Opening is a deliberate act, so it always gets fresh numbers.
  useEffect(() => { if (open) load(true) }, [open, load])

  // Close on outside click / Escape, the same way the notification bell does.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open])

  const rows = useMemo(() => board?.rows ?? [], [board])
  const summary = board?.summary
  const outstanding = summary?.outstanding ?? 0
  const total = summary?.total ?? 0

  const shown = useMemo(() => rows.filter(r => {
    if (filter === 'OUTSTANDING') return !r.acknowledged && !r.arrived
    if (filter === 'TAKEN') return r.acknowledged
    if (filter === 'ARRIVED') return r.arrived
    return true
  }), [rows, filter])

  /** Rows grouped under their arrival-day heading, in board order. */
  const groups = useMemo(() => {
    const out: { heading: string; rows: LastMinuteBoardRow[] }[] = []
    for (const row of shown) {
      const heading = groupOf(row)
      const last = out[out.length - 1]
      if (last && last.heading === heading) last.rows.push(row)
      else out.push({ heading, rows: [row] })
    }
    return out
  }, [shown])

  /** Acknowledge one file straight from the board — same endpoint as the alarm. */
  const acknowledge = useCallback(async (bookingRef: string) => {
    setBusy(bookingRef)
    try {
      const res = await fetch('/api/bookings/last-minute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingRef }),
      })
      const json = await readApiResponse<{ acknowledged: string[] }>(res)
      if (json.success) await load()
    } catch { /* the row simply stays outstanding */ }
    finally { setBusy(null) }
  }, [load])

  if (status !== 'authenticated' || role === 'CLIENT') return null

  return (
    <div className="relative" ref={wrapRef}>
      {/* ── The header icon ────────────────────────────────────────────────────
          Permanent, unlike the alarm's chip. Quiet when there is nothing
          outstanding — it still opens the week's board — and lit when there is. */}
      <motion.button
        whileHover={still ? undefined : { scale: 1.06 }}
        whileTap={still ? undefined : { scale: 0.94 }}
        onClick={() => setOpen(v => !v)}
        aria-label="Last-minute bookings"
        aria-expanded={open}
        title={
          outstanding > 0
            ? `${outstanding} last-minute booking${outstanding === 1 ? '' : 's'} nobody has taken yet`
            : total > 0
              ? `${total} last-minute booking${total === 1 ? '' : 's'} this week — all taken`
              : 'Last-minute bookings (inside D-4)'
        }
        className={`relative p-2 rounded-xl transition-colors ${
          outstanding > 0
            ? 'text-white bg-gradient-to-br from-rose-500 to-red-600 shadow-lg shadow-rose-500/30'
            : open
              ? 'text-amber-600 bg-amber-50'
              : 'text-slate-500 hover:text-amber-600 hover:bg-amber-50'
        }`}
      >
        {/* A halo that breathes only while something is unowned. */}
        {!still && outstanding > 0 && (
          <motion.span
            aria-hidden
            className="absolute inset-0 rounded-xl bg-rose-500/40"
            animate={{ scale: [1, 1.35], opacity: [0.55, 0] }}
            transition={{ duration: 1.8, repeat: Infinity, ease: 'easeOut' }}
          />
        )}
        <motion.span
          className="relative block"
          animate={still || outstanding === 0 ? undefined : { rotate: [0, -10, 10, -6, 0] }}
          transition={{ duration: 0.8, repeat: Infinity, repeatDelay: 2.6 }}
        >
          <Zap className="w-5 h-5" />
        </motion.span>

        {/* Count badge: red while unowned, quiet slate once the week is all taken. */}
        <AnimatePresence>
          {total > 0 && (
            <motion.span
              key={outstanding > 0 ? 'live' : 'calm'}
              initial={still ? false : { scale: 0.4, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.4, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 520, damping: 22 }}
              className={`absolute -top-0.5 -right-0.5 min-w-[17px] h-[17px] px-1 rounded-full text-[10px] font-bold flex items-center justify-center ring-2 ring-white ${
                outstanding > 0 ? 'bg-slate-900 text-white' : 'bg-slate-200 text-slate-600'
              }`}
            >
              {outstanding > 0 ? outstanding : total}
            </motion.span>
          )}
        </AnimatePresence>
      </motion.button>

      {/* ── The board ──────────────────────────────────────────────────────── */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={still ? { opacity: 0 } : { opacity: 0, y: -10, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={still ? { opacity: 0 } : { opacity: 0, y: -8, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 380, damping: 30 }}
            role="dialog"
            aria-label="Last-minute bookings"
            className="fixed left-2 right-2 top-16 sm:absolute sm:left-auto sm:right-0 sm:top-full sm:mt-2 sm:w-[34rem] z-50 rounded-2xl bg-white shadow-2xl ring-1 ring-slate-900/10 overflow-hidden flex flex-col max-h-[80vh]"
          >
            {/* ── Header ── */}
            <div className="relative px-4 py-3.5 bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 overflow-hidden">
              {/* Aurora: two slow drifting pools of tier colour. Atmosphere only —
                  it is what makes the board feel live rather than printed. */}
              {!still && (
                <>
                  <motion.span
                    aria-hidden
                    className="pointer-events-none absolute -top-16 -left-10 w-56 h-56 rounded-full bg-rose-500/25 blur-3xl"
                    animate={{ x: [0, 40, 0], y: [0, 18, 0], opacity: [0.5, 0.85, 0.5] }}
                    transition={{ duration: 9, repeat: Infinity, ease: 'easeInOut' }}
                  />
                  <motion.span
                    aria-hidden
                    className="pointer-events-none absolute -bottom-20 right-0 w-56 h-56 rounded-full bg-amber-400/20 blur-3xl"
                    animate={{ x: [0, -30, 0], y: [0, -14, 0], opacity: [0.4, 0.75, 0.4] }}
                    transition={{ duration: 11, repeat: Infinity, ease: 'easeInOut' }}
                  />
                </>
              )}

              <div className="relative flex items-start gap-2.5">
                <div className="relative w-9 h-9 shrink-0 rounded-xl bg-white/10 backdrop-blur-sm flex items-center justify-center">
                  <motion.span
                    animate={still ? undefined : { scale: [1, 1.15, 1] }}
                    transition={{ duration: 2.2, repeat: Infinity, ease: 'easeInOut' }}
                  >
                    <Zap className="w-4 h-4 text-amber-300" />
                  </motion.span>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-white/50">
                    Sold inside D-{LAST_MINUTE_DAYS}
                  </p>
                  <h3 className="text-white font-bold text-sm leading-tight mt-0.5">Last-minute bookings</h3>
                </div>
                <button
                  onClick={() => load(true)}
                  aria-label="Refresh"
                  className="p-1.5 rounded-lg text-white/60 hover:text-white hover:bg-white/10 transition-colors"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
                </button>
                <button
                  onClick={() => setOpen(false)}
                  aria-label="Close"
                  className="p-1.5 rounded-lg text-white/60 hover:text-white hover:bg-white/10 transition-colors"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* ── Summary tiles ── */}
              <div className="relative mt-3 flex items-stretch gap-1.5">
                <Tile n={outstanding} label="Nobody has it" tone={outstanding > 0 ? 'text-rose-300' : 'text-white'} still={still} />
                <Tile n={summary?.arrivingToday ?? 0} label="Arriving today" tone="text-amber-300" still={still} />
                <Tile n={summary?.critical ?? 0} label="Critical" tone="text-orange-300" still={still} />
                <Tile n={total} label="In the window" tone="text-white" still={still} />
              </div>
            </div>

            {/* ── Filters ── */}
            <div className="flex items-center gap-1 px-3 py-2 border-b border-slate-100 bg-slate-50/70">
              {FILTERS.map(f => {
                const active = filter === f.key
                return (
                  <button
                    key={f.key}
                    onClick={() => setFilter(f.key)}
                    className={`relative px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-colors ${
                      active ? 'text-white' : 'text-slate-500 hover:text-slate-800'
                    }`}
                  >
                    {active && (
                      <motion.span
                        layoutId={still ? undefined : 'lm-filter-pill'}
                        className="absolute inset-0 rounded-lg bg-slate-900"
                        transition={{ type: 'spring', stiffness: 420, damping: 32 }}
                      />
                    )}
                    <span className="relative">{f.label}</span>
                  </button>
                )
              })}
              <span className="ml-auto text-[10px] text-slate-400 tabular-nums">
                {shown.length} of {total}
              </span>
            </div>

            {/* ── The list ── */}
            <div className="flex-1 overflow-y-auto">
              {shown.length === 0 ? (
                <motion.div
                  initial={still ? false : { opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="px-6 py-10 text-center"
                >
                  <motion.div
                    className="w-12 h-12 mx-auto rounded-2xl bg-emerald-50 flex items-center justify-center"
                    animate={still ? undefined : { scale: [1, 1.06, 1] }}
                    transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
                  >
                    <CheckCircle2 className="w-6 h-6 text-emerald-500" />
                  </motion.div>
                  <p className="mt-3 text-sm font-semibold text-slate-700">
                    {total === 0 ? 'Nothing was sold late' : 'Nothing in this view'}
                  </p>
                  <p className="mt-1 text-[11px] text-slate-500 max-w-xs mx-auto leading-snug">
                    {total === 0
                      ? `No booking in the last few days or the weeks ahead was created within ${LAST_MINUTE_DAYS} days of the guest arriving.`
                      : 'Every last-minute file in the window sits under one of the other tabs.'}
                  </p>
                </motion.div>
              ) : (
                groups.map(group => (
                  <div key={group.heading}>
                    {/* Sticky day heading, so the arrival you are reading is always named. */}
                    <div className="sticky top-0 z-10 px-4 py-1.5 bg-white/90 backdrop-blur border-b border-slate-100 flex items-center gap-1.5">
                      <Clock className="w-3 h-3 text-slate-400" />
                      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                        {group.heading}
                      </span>
                      <span className="text-[10px] text-slate-300">·</span>
                      <span className="text-[10px] text-slate-400 tabular-nums">{group.rows.length}</span>
                    </div>

                    {group.rows.map((row, i) => {
                      const meta = LAST_MINUTE_TIERS[row.tier]
                      const pax = row.paxAdults + row.paxChildren + row.paxInfants
                      const working = busy === row.bookingRef
                      return (
                        <motion.div
                          key={row.bookingRef}
                          initial={still ? false : { opacity: 0, x: -12 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: still ? 0 : Math.min(i * 0.035, 0.3), type: 'spring', stiffness: 380, damping: 30 }}
                          className="group relative px-4 py-3 border-b border-slate-50 hover:bg-slate-50/80 transition-colors"
                        >
                          {/* Severity rail, drawn on hover. */}
                          <span
                            aria-hidden
                            className={`absolute left-0 top-0 bottom-0 w-0.5 origin-center scale-y-0 group-hover:scale-y-100 transition-transform duration-200 ${DOT[row.tier] ?? DOT.TIGHT}`}
                          />

                          <div className="flex items-start gap-3">
                            <LeadRing leadDays={row.leadDays} tier={row.tier} still={still} />

                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                <Link
                                  href={`/dashboard/bookings/${row.bookingRef}`}
                                  onClick={() => setOpen(false)}
                                  className="font-mono font-bold text-[13px] text-slate-900 hover:text-brand-600 transition-colors"
                                >
                                  {row.bookingRef}
                                </Link>
                                <span
                                  title={meta.hint}
                                  className={`px-1.5 py-px rounded text-[9px] font-bold uppercase tracking-wide border ${meta.badgeClass}`}
                                >
                                  {row.tier}
                                </span>
                                {row.leadName && (
                                  <span className="text-[11px] text-slate-600 truncate">{row.leadName}</span>
                                )}
                              </div>

                              <p className="mt-1 text-[11px] text-slate-500 flex items-center gap-2.5 flex-wrap">
                                <span className="inline-flex items-center gap-1 font-semibold text-slate-600">
                                  <PlaneLanding className="w-3 h-3" />
                                  {fmtDay(row.arrivalDate)} · {arrivalSentence(row.daysToArrival)}
                                </span>
                                <span className="inline-flex items-center gap-1">
                                  <Users className="w-3 h-3" /> {pax}
                                </span>
                                {row.operationCountry && (
                                  <span className="text-slate-400">{row.operationCountry}</span>
                                )}
                              </p>

                              <p className="mt-0.5 text-[10px] text-slate-400">
                                {leadSentence(row.leadDays)}
                                {row.agent ? ` · ${row.agent}` : ''}
                              </p>

                              {/* Who has it — the answer the board exists to give. */}
                              <div className="mt-1.5">
                                {row.acknowledged ? (
                                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-emerald-50 border border-emerald-200 text-[10px] font-semibold text-emerald-700">
                                    <Check className="w-2.5 h-2.5" />
                                    {row.acknowledgedBy ?? 'Taken'}
                                    <span className="font-normal text-emerald-600/80">
                                      {fmtWhen(row.acknowledgedAt)}
                                    </span>
                                  </span>
                                ) : row.arrived ? (
                                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-slate-100 border border-slate-200 text-[10px] font-semibold text-slate-500">
                                    Landed, never acknowledged
                                  </span>
                                ) : (
                                  <motion.span
                                    animate={still ? undefined : { opacity: [1, 0.55, 1] }}
                                    transition={{ duration: 2.2, repeat: Infinity, ease: 'easeInOut' }}
                                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-rose-50 border border-rose-200 text-[10px] font-bold text-rose-600"
                                  >
                                    <Sparkles className="w-2.5 h-2.5" /> Nobody has this yet
                                  </motion.span>
                                )}
                              </div>
                            </div>

                            <div className="flex flex-col items-end gap-1.5 shrink-0">
                              {!row.acknowledged && !row.arrived && (
                                <motion.button
                                  whileTap={still ? undefined : { scale: 0.94 }}
                                  onClick={() => acknowledge(row.bookingRef)}
                                  disabled={busy !== null}
                                  className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-50 transition-colors"
                                >
                                  {working ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : <Check className="w-2.5 h-2.5" />}
                                  I&apos;ve got this
                                </motion.button>
                              )}
                              <Link
                                href={`/dashboard/bookings/${row.bookingRef}`}
                                onClick={() => setOpen(false)}
                                className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-blue-600 hover:text-blue-800 group/open"
                              >
                                Open
                                <ArrowRight className="w-2.5 h-2.5 transition-transform group-hover/open:translate-x-0.5" />
                              </Link>
                            </div>
                          </div>
                        </motion.div>
                      )
                    })}
                  </div>
                ))
              )}
            </div>

            {/* ── Footer ── */}
            <div className="px-4 py-2.5 border-t border-slate-100 bg-slate-50/80 flex items-center justify-between gap-2">
              <p className="text-[10px] text-slate-400 leading-snug">
                Booked within {LAST_MINUTE_DAYS} days of arrival
                {board ? ` · ${board.window.from} → ${board.window.to}` : ''}
              </p>
              <Link
                href="/dashboard/bookings"
                onClick={() => setOpen(false)}
                className="text-[11px] font-semibold text-blue-600 hover:text-blue-800 whitespace-nowrap"
              >
                All bookings →
              </Link>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
