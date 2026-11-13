'use client'

/**
 * Guest care — everything the system does for the guest on its own, shown in
 * the WhatsApp inbox's trip panel so the desk can answer "did they get today's
 * plan? did the bot reach them? did they reconfirm? did feedback come back?"
 * without leaving the chat.
 *
 *   ┌ Hero ───────────────────────────────────────────┐
 *   │ Autopilot switches · care ring · 4-step journey │  Allow → Reconfirm → On tour → Feedback
 *   └─────────────────────────────────────────────────┘
 *   Up next (countdowns) · Call permission · Day-by-day plans + AI calls
 *   Reconfirmation (AI / manual) · Post-tour feedback (call + form) · Last call
 *
 * Read-only. Two GETs: `/guest-automation` (switches, Allow journey, day activity)
 * and `/guest-care` (reconfirm / post-tour calls, feedback form, approval, send time).
 * Switching automation off still happens on the booking page, behind its emailed code.
 */
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { AnimatePresence, motion } from 'framer-motion'
import {
  AlertTriangle, Bell, Bot, CalendarCheck, Check, CheckCheck, ChevronDown, ChevronRight, ClipboardCheck, Clock,
  ExternalLink, HeartHandshake, Hourglass, Lock, MessageCircle, PhoneCall, PhoneIncoming, PhoneMissed, Quote,
  Send, ShieldCheck, Sparkles, Star, UserRound, XCircle, Zap,
} from 'lucide-react'
import type { Snapshot } from '@/components/bookings/guest-autopilot'
import type { GuestActivity } from '@/lib/guest-autopilot-activity'
import type { BookingCalls, CallEntry } from '@/lib/daily-update-calls'
import {
  FEEDBACK_RATING_EMOJI, FEEDBACK_RATING_FIELDS, FEEDBACK_RATING_LABELS, type FeedbackFormCell,
} from '@/lib/daily-update-feedback'
import type { CallApprovalCell } from '@/lib/daily-update-approval'
import type { TripContext } from '@/lib/whatsapp-trip-context'

// ── Data ────────────────────────────────────────────────────────────────────

export interface CareExtras {
  calls: BookingCalls
  feedbackForm: FeedbackFormCell
  approval: CallApprovalCell
  briefing: { time: string | null; custom: boolean; sameDay: boolean; timezone: string; enabled: boolean }
  feedbackAuto: boolean
}

export interface GuestCareData { auto: Snapshot | null; care: CareExtras | null }

export interface GuestCareState {
  ref: string | null
  data: GuestCareData | null
  loading: boolean
  denied: boolean
  error: string | null
}

/** Loads both halves for one booking; `version` bumps re-fetch (the panel's Refresh). */
export function useGuestCare(ref: string | null, version: number): GuestCareState {
  const [state, setState] = useState<GuestCareState>({ ref, data: null, loading: !!ref, denied: false, error: null })

  useEffect(() => {
    if (!ref) return
    const ctrl = new AbortController()
    // Keep the old numbers on a plain refresh, drop them when the booking changes.
    setState(s => ({ ref, data: s.ref === ref ? s.data : null, loading: true, denied: false, error: null }))
    const get = (path: string) =>
      fetch(`/api/bookings/${encodeURIComponent(ref)}/${path}`, { signal: ctrl.signal })
        .then(async r => ({ status: r.status, json: await r.json().catch(() => null) }))

    Promise.all([get('guest-automation'), get('guest-care')])
      .then(([a, c]) => {
        const denied = a.status === 403 && c.status === 403
        const ok = a.json?.success || c.json?.success
        setState({
          ref,
          data: ok ? { auto: a.json?.success ? a.json.data : null, care: c.json?.success ? c.json.data : null } : null,
          loading: false,
          denied,
          error: !ok && !denied ? (a.json?.error ?? c.json?.error ?? 'Could not load guest care') : null,
        })
      })
      .catch(err => {
        if (err?.name === 'AbortError') return
        setState(s => ({ ...s, loading: false, error: 'Could not load guest care' }))
      })
    return () => ctrl.abort()
  }, [ref, version])

  return state
}

// ── Time helpers ────────────────────────────────────────────────────────────

const DAY = 86_400_000
const addDay = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10)
const dayFmt = (d: string, o: Intl.DateTimeFormatOptions) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { timeZone: 'UTC', ...o })
const shortDay = (d: string) => dayFmt(d, { day: 'numeric', month: 'short' })
const weekDay = (d: string) => dayFmt(d, { weekday: 'short', day: 'numeric', month: 'short' })

/** Milliseconds the zone is ahead of UTC at that instant. */
function tzOffsetMs(at: number, tz: string): number {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(at))
  const g = (t: string) => Number(p.find(x => x.type === t)?.value ?? 0)
  return Date.UTC(g('year'), g('month') - 1, g('day'), g('hour') % 24, g('minute'), g('second')) - at
}

/** "2026-11-14" + "18:00" in the trip's zone → epoch ms. */
function zonedInstant(day: string, hhmm: string, tz: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  const guess = Date.parse(`${day}T00:00:00Z`) + (h * 60 + m) * 60_000
  try { return guess - tzOffsetMs(guess, tz) } catch { return guess }
}

function hm12(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number)
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`
}

function clock(iso: string | null | undefined, tz?: string): string {
  if (!iso) return ''
  try { return new Date(iso).toLocaleTimeString('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' }) } catch { return '' }
}

function ago(iso: string | null | undefined): string {
  if (!iso) return ''
  const diff = Date.now() - Date.parse(iso)
  if (diff < 60_000) return 'just now'
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m ago`
  if (diff < DAY) return `${Math.round(diff / 3_600_000)}h ago`
  if (diff < 7 * DAY) return `${Math.round(diff / DAY)}d ago`
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

function countdown(at: number): string {
  const left = at - Date.now()
  if (left <= 60_000) return 'due now'
  const mins = Math.ceil(left / 60_000)
  if (mins < 60) return `in ${mins}m`
  const h = Math.floor(mins / 60)
  if (h < 48) return `in ${h}h ${mins % 60}m`
  return `in ${Math.round(left / DAY)} days`
}

/** Ticks once a minute so countdowns stay honest while the panel is open. */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 60_000); return () => clearInterval(id) }, [])
  return now
}

// ── Mood ────────────────────────────────────────────────────────────────────

type Mood = 'positive' | 'neutral' | 'negative'
function moodOf(s: string | null | undefined): Mood | null {
  const v = (s ?? '').toLowerCase()
  if (!v) return null
  if (/pos|happy|good|great/.test(v)) return 'positive'
  if (/neg|bad|unhappy|angry|poor/.test(v)) return 'negative'
  return 'neutral'
}
const MOOD: Record<Mood, { emoji: string; label: string; chip: string; bar: string }> = {
  positive: { emoji: '😊', label: 'Happy',   chip: 'bg-emerald-50 text-emerald-700 ring-emerald-200', bar: 'from-emerald-400 to-teal-500' },
  neutral:  { emoji: '😐', label: 'Okay',    chip: 'bg-amber-50 text-amber-700 ring-amber-200',       bar: 'from-amber-300 to-amber-500' },
  negative: { emoji: '😟', label: 'Unhappy', chip: 'bg-rose-50 text-rose-700 ring-rose-200',          bar: 'from-rose-400 to-rose-600' },
}

const ratingOf = (e: CallEntry | null | undefined) => {
  const m = /Rated (\d+(?:\.\d+)?)\/10/.exec(e?.summary ?? '')
  return m ? Number(m[1]) : null
}

// ── Journey phases ──────────────────────────────────────────────────────────

type Tone = 'done' | 'active' | 'todo' | 'bad' | 'off'

interface Phase { key: string; label: string; icon: typeof Bot; tone: Tone; value: string; hint: string }

const TONE: Record<Tone, { dot: string; text: string; ring: string }> = {
  done:   { dot: 'bg-gradient-to-br from-emerald-400 to-teal-500 text-white shadow-lg shadow-emerald-500/30', text: 'text-emerald-300', ring: 'ring-emerald-300/40' },
  active: { dot: 'bg-gradient-to-br from-amber-300 to-orange-400 text-amber-950 shadow-lg shadow-amber-500/30', text: 'text-amber-300', ring: 'ring-amber-300/50' },
  todo:   { dot: 'bg-white/10 text-white/60 ring-1 ring-white/15', text: 'text-white/55', ring: 'ring-white/10' },
  bad:    { dot: 'bg-gradient-to-br from-rose-400 to-rose-600 text-white shadow-lg shadow-rose-500/30', text: 'text-rose-300', ring: 'ring-rose-300/40' },
  off:    { dot: 'bg-white/5 text-white/30 ring-1 ring-white/15', text: 'text-white/35', ring: 'ring-white/5' },
}

function phasesOf(d: GuestCareData, t: TripContext): Phase[] {
  const s = d.auto
  const c = d.care
  const a = s?.activity ?? null
  const callsOn = s?.switches.calls !== false

  // 1 — WhatsApp call permission (the bot cannot dial until the guest taps Allow)
  const allowed = !!s?.allowedCalls || c?.approval.state === 'approved'
  const j = s?.journey ?? null
  const reqAt = j?.approval.requestedAt ?? c?.approval.requestedAt ?? null
  let perm: Phase = { key: 'allow', label: 'Permission', icon: ShieldCheck, tone: 'todo', value: 'Not asked', hint: 'Allow request not sent' }
  if (allowed) perm = { ...perm, tone: 'done', value: 'Allowed', hint: `Tapped Allow ${ago(s?.allowedAt ?? c?.approval.approvedAt) || ''}`.trim() }
  else if (j?.finished?.outcome === 'no-response') perm = { ...perm, tone: 'bad', value: 'No reply', hint: 'Reminders ran out' }
  else if (j || c?.approval.state === 'sent') perm = { ...perm, tone: 'active', value: 'Waiting', hint: `Asked ${ago(reqAt)}` }
  if (!callsOn && !allowed) perm = { ...perm, tone: 'off', value: 'Calls off' }

  // 2 — Pre-trip reconfirmation (AI call or a manual log)
  const pre = c?.calls.PRE.latest ?? null
  const preX = a?.extras.find(x => x.phase === 'Reconfirm')
  let rec: Phase = { key: 'reconfirm', label: 'Reconfirm', icon: CalendarCheck, tone: 'todo', value: 'Pending', hint: 'Before arrival' }
  if (pre) rec = { ...rec, tone: 'done', value: pre.source === 'AI' ? 'AI call' : 'Manual', hint: ago(pre.at) }
  else if (preX?.state === 'answered') rec = { ...rec, tone: 'done', value: 'AI call', hint: shortDay(preX.date) }
  else if (preX?.state === 'scheduled' || preX?.state === 'calling') rec = { ...rec, tone: 'active', value: preX.state === 'calling' ? 'Calling' : 'Booked', hint: shortDay(preX.date) }
  else if (preX?.state === 'missed') rec = { ...rec, tone: 'bad', value: 'Missed', hint: `${shortDay(preX.date)} · call manually` }
  else if (t.phase !== 'upcoming') rec = { ...rec, tone: 'bad', value: 'Not logged', hint: 'No reconfirmation on file' }

  // 3 — On tour: daily plans + check-in calls
  let tour: Phase = { key: 'tour', label: 'On tour', icon: MessageCircle, tone: 'todo', value: t.daysToGo ? `${t.daysToGo}d to go` : 'Soon', hint: `${t.tripDays} days planned` }
  if (t.phase === 'on-tour') {
    const failed = (a?.stats.plansFailed ?? 0) > 0
    tour = { ...tour, tone: failed ? 'bad' : 'active', value: `Day ${t.tripDay}/${t.tripDays}`, hint: `${a?.stats.plansSent ?? 0} plans · ${a?.stats.callsAnswered ?? 0} calls` }
  } else if (t.phase === 'ended') {
    tour = { ...tour, tone: 'done', value: 'Done', hint: `${a?.stats.plansSent ?? 0} plans · ${a?.stats.callsAnswered ?? 0} calls` }
  }

  // 4 — Post-tour feedback (the call + the digital form)
  const post = c?.calls.POST.latest ?? null
  const form = c?.feedbackForm
  const postX = a?.extras.find(x => x.phase === 'After tour')
  const rating = ratingOf(post)
  let fb: Phase = { key: 'feedback', label: 'Feedback', icon: HeartHandshake, tone: 'todo', value: 'After trip', hint: `From ${shortDay(t.departureDate)}` }
  if (form?.form) fb = { ...fb, tone: 'done', value: form.form.overall ? `${FEEDBACK_RATING_EMOJI[form.form.overall] ?? ''} ${FEEDBACK_RATING_LABELS[form.form.overall] ?? ''}`.trim() : 'Received', hint: 'Form submitted' }
  else if (post) fb = { ...fb, tone: 'done', value: rating != null ? `${rating}/10` : post.source === 'AI' ? 'AI call' : 'Manual', hint: ago(post.at) }
  else if (postX?.state === 'answered') fb = { ...fb, tone: 'done', value: 'AI call', hint: shortDay(postX.date) }
  else if (form?.sentAt) fb = { ...fb, tone: 'active', value: 'Form sent', hint: ago(form.sentAt) }
  else if (postX?.state === 'scheduled') fb = { ...fb, tone: 'active', value: 'Call booked', hint: shortDay(postX.date) }
  else if (t.phase === 'ended') fb = { ...fb, tone: 'bad', value: 'Pending', hint: 'Nothing back yet' }

  return [perm, rec, tour, fb]
}

/** Touchpoints that should have happened by now, and how many did. */
function careScore(d: GuestCareData, t: TripContext, phases: Phase[]) {
  const a = d.auto?.activity
  const plansDue = a ? a.days.filter(x => x.date < a.today || x.plan.state === 'read' || x.plan.state === 'delivered' || x.plan.state === 'sent').length : 0
  let due = plansDue + (a?.stats.callsDue ?? 0)
  let done = (a?.stats.plansSent ?? 0) + (a?.stats.callsAnswered ?? 0)
  for (const p of phases) {
    if (p.key === 'tour') continue
    if (p.tone === 'done') { due++; done++ } else if (p.tone === 'bad') due++
  }
  if (t.phase === 'upcoming' && phases[0].tone !== 'done') due++
  return { due, done: Math.min(done, due) }
}

/** The next things the system will do on its own, soonest first. */
interface NextEvent { at: number; icon: typeof Bot; tone: 'sky' | 'violet' | 'amber' | 'rose'; title: string; sub: string }

function upcomingOf(d: GuestCareData, t: TripContext): NextEvent[] {
  const out: NextEvent[] = []
  const s = d.auto
  const c = d.care
  const a = s?.activity
  const tz = c?.briefing.timezone ?? 'UTC'
  const msgsOn = s?.switches.messages !== false
  const callsOn = s?.switches.calls !== false

  if (a && c?.briefing.time && c.briefing.enabled && msgsOn) {
    const time = c.briefing.time
    for (const day of a.days) {
      if (day.plan.state !== 'today' && day.plan.state !== 'upcoming') continue
      const sendDay = c.briefing.sameDay ? day.date : addDay(day.date, -1)
      const at = zonedInstant(sendDay, time, tz)
      if (at < Date.now() - 30 * 60_000) continue
      out.push({ at, icon: MessageCircle, tone: 'sky', title: `Day ${day.dayNo} trip plan`, sub: `WhatsApp · ${weekDay(sendDay)} · ${hm12(time)}` })
      break
    }
  }
  if (a && callsOn) {
    const next = a.days.find(x => x.call.state === 'scheduled' || x.call.state === 'calling')
    if (next) {
      const at = next.call.at ? Date.parse(next.call.at) : zonedInstant(next.date, '12:00', tz)
      out.push({ at, icon: Bot, tone: 'violet', title: `Day ${next.dayNo} AI check-in call`, sub: next.call.state === 'calling' ? 'Calling now' : `${weekDay(next.date)}${next.call.at ? ` · ${clock(next.call.at)}` : ''}` })
    }
    for (const x of a.extras) {
      if (x.state !== 'scheduled' && x.state !== 'calling') continue
      out.push({
        at: x.at ? Date.parse(x.at) : zonedInstant(x.date, '12:00', tz),
        icon: x.phase === 'Reconfirm' ? CalendarCheck : HeartHandshake, tone: 'amber',
        title: x.phase === 'Reconfirm' ? 'AI reconfirmation call' : 'AI post-tour feedback call',
        sub: weekDay(x.date),
      })
    }
  }
  if (c && c.feedbackAuto && msgsOn && !c.feedbackForm.sentAt && !c.feedbackForm.form && t.phase !== 'ended') {
    out.push({ at: zonedInstant(t.departureDate, '12:00', tz), icon: ClipboardCheck, tone: 'rose', title: 'Feedback form', sub: `WhatsApp · departure day · ${weekDay(t.departureDate)}` })
  }
  return out.sort((x, y) => x.at - y.at).slice(0, 3)
}

// ── Small pieces ────────────────────────────────────────────────────────────

function Ring({ value, max, size = 64, stroke = 6, children }: { value: number; max: number; size?: number; stroke?: number; children?: React.ReactNode }) {
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const pct = max > 0 ? Math.min(1, value / max) : 0
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} className="h-full w-full -rotate-90">
        <defs>
          <linearGradient id="care-ring" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#fbbf24" /><stop offset="100%" stopColor="#34d399" />
          </linearGradient>
        </defs>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} stroke="rgba(255,255,255,0.12)" />
        <motion.circle
          cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} strokeLinecap="round" stroke="url(#care-ring)"
          strokeDasharray={c} initial={{ strokeDashoffset: c }} animate={{ strokeDashoffset: c * (1 - pct) }}
          transition={{ duration: 0.9, ease: 'easeOut' }}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center">{children}</div>
    </div>
  )
}

function SwitchPill({ on, label, icon: Icon }: { on: boolean; label: string; icon: typeof Bot }) {
  return (
    <span
      title={on ? `${label} is ON` : `${label} is OFF — turn it back on from the booking page`}
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ring-1 ${on ? 'bg-emerald-400/15 text-emerald-200 ring-emerald-300/30' : 'bg-rose-400/15 text-rose-200 ring-rose-300/30'}`}
    >
      <Icon className="h-3 w-3" />
      {label}
      {on ? (
        <span className="relative ml-0.5 flex h-1.5 w-1.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-300 opacity-70" />
          <span className="relative h-1.5 w-1.5 rounded-full bg-emerald-300" />
        </span>
      ) : <Lock className="h-2.5 w-2.5" />}
    </span>
  )
}

function CardShell({ icon: Icon, tint, title, aside, children }: { icon: typeof Bot; tint: string; title: string; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl bg-white p-3 shadow-[0_1px_2px_rgba(15,23,42,0.05)] ring-1 ring-slate-200/70">
      <header className="mb-2 flex items-center gap-2">
        <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-xl ${tint}`}><Icon className="h-3.5 w-3.5" /></span>
        <h4 className="min-w-0 flex-1 truncate text-[12.5px] font-extrabold tracking-tight text-slate-900">{title}</h4>
        {aside}
      </header>
      {children}
    </section>
  )
}

function Pill({ tone, children, title }: { tone: 'emerald' | 'sky' | 'slate' | 'rose' | 'amber' | 'violet' | 'ghost'; children: React.ReactNode; title?: string }) {
  const tones = {
    emerald: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
    sky: 'bg-sky-50 text-sky-700 ring-sky-200',
    slate: 'bg-slate-100 text-slate-600 ring-slate-200',
    rose: 'bg-rose-50 text-rose-700 ring-rose-200',
    amber: 'bg-amber-50 text-amber-700 ring-amber-200',
    violet: 'bg-violet-50 text-violet-700 ring-violet-200',
    ghost: 'bg-white text-slate-400 ring-slate-200',
  }
  return (
    <span title={title} className={`inline-flex min-w-0 max-w-full items-center gap-1 truncate rounded-full px-1.5 py-0.5 text-[10px] font-bold ring-1 ${tones[tone]}`}>
      {children}
    </span>
  )
}

function SourceBadge({ e }: { e: CallEntry }) {
  return e.source === 'AI'
    ? <Pill tone="violet"><Bot className="h-2.5 w-2.5" />AI call</Pill>
    : <Pill tone="sky"><UserRound className="h-2.5 w-2.5" />Manual{e.by ? ` · ${e.by}` : ''}</Pill>
}

// ── Overview teaser ─────────────────────────────────────────────────────────

/** Compact strip on the Trip tab; tapping it opens the full Care section. */
export function GuestCarePulse({ state, trip, onOpen }: { state: GuestCareState; trip: TripContext; onOpen: () => void }) {
  const now = useNow()
  const d = state.ref === trip.bookingRef ? state.data : null
  const phases = useMemo(() => (d ? phasesOf(d, trip) : []), [d, trip])
  const next = useMemo(() => (d ? upcomingOf(d, trip)[0] : undefined), [d, trip, now]) // eslint-disable-line react-hooks/exhaustive-deps

  if (state.denied) return null
  if (!d) {
    return state.loading ? <div className="h-[104px] animate-pulse rounded-2xl bg-gradient-to-r from-violet-100/70 to-slate-100" /> : null
  }

  const s = d.auto?.switches
  return (
    <button onClick={onOpen} className="group block w-full overflow-hidden rounded-2xl bg-white text-left ring-1 ring-violet-200/70 transition hover:-translate-y-0.5 hover:shadow-lg hover:shadow-violet-500/10">
      <div className="flex items-center gap-2 bg-gradient-to-r from-[#1e1645] via-[#2a1d5c] to-[#3b1f5e] px-3 py-2">
        <Zap className="h-3.5 w-3.5 text-amber-300" />
        <p className="flex-1 text-[11px] font-extrabold uppercase tracking-[0.14em] text-white/90">Guest care</p>
        {s && (
          <span className="flex items-center gap-1">
            <span title={`Auto messages ${s.messages ? 'ON' : 'OFF'}`} className={`grid h-5 w-5 place-items-center rounded-full ${s.messages ? 'bg-emerald-400/20 text-emerald-200' : 'bg-rose-400/20 text-rose-200'}`}><MessageCircle className="h-3 w-3" /></span>
            <span title={`Auto AI calls ${s.calls ? 'ON' : 'OFF'}`} className={`grid h-5 w-5 place-items-center rounded-full ${s.calls ? 'bg-emerald-400/20 text-emerald-200' : 'bg-rose-400/20 text-rose-200'}`}><Bot className="h-3 w-3" /></span>
          </span>
        )}
        <ChevronRight className="h-3.5 w-3.5 text-white/50 transition group-hover:translate-x-0.5" />
      </div>
      <div className="grid grid-cols-4 gap-1 px-2 pb-1.5 pt-2">
        {phases.map(p => {
          const Icon = p.icon
          const tone = p.tone === 'done' ? 'bg-emerald-500 text-white' : p.tone === 'active' ? 'bg-amber-400 text-amber-950' : p.tone === 'bad' ? 'bg-rose-500 text-white' : 'bg-slate-100 text-slate-400'
          return (
            <div key={p.key} className="min-w-0 text-center" title={`${p.label}: ${p.value} — ${p.hint}`}>
              <span className={`mx-auto grid h-7 w-7 place-items-center rounded-full ${tone} ${p.tone === 'active' ? 'ring-4 ring-amber-100' : ''}`}><Icon className="h-3.5 w-3.5" /></span>
              <p className="mt-0.5 truncate text-[9.5px] font-bold text-slate-400">{p.label}</p>
              <p className={`truncate text-[11px] font-extrabold ${p.tone === 'bad' ? 'text-rose-600' : 'text-slate-800'}`}>{p.value}</p>
            </div>
          )
        })}
      </div>
      {next && (
        <div className="flex items-center gap-1.5 border-t border-slate-100 px-3 py-1.5 text-[11px]">
          <Clock className="h-3 w-3 shrink-0 text-violet-500" />
          <span className="truncate font-semibold text-slate-600">Next: {next.title}</span>
          <span className="ml-auto shrink-0 font-bold text-violet-600">{countdown(next.at)}</span>
        </div>
      )}
    </button>
  )
}

/** How many phases need a human — for the rail badge. */
export function careAlerts(state: GuestCareState, trip: TripContext | null): number {
  if (!trip || state.ref !== trip.bookingRef || !state.data) return 0
  return phasesOf(state.data, trip).filter(p => p.tone === 'bad').length
}

// ── Full section ────────────────────────────────────────────────────────────

export function GuestCare({ state, trip: t, onRetry }: { state: GuestCareState; trip: TripContext; onRetry: () => void }) {
  const now = useNow()
  const d = state.ref === t.bookingRef ? state.data : null
  const phases = useMemo(() => (d ? phasesOf(d, t) : []), [d, t])
  const next = useMemo(() => (d ? upcomingOf(d, t) : []), [d, t, now]) // eslint-disable-line react-hooks/exhaustive-deps

  if (state.denied) {
    return <Empty icon={Lock} title="Not available on your login" text="Guest autopilot is open to the booking, ground and travel-experience teams." />
  }
  if (!d) {
    if (state.error) return <Empty icon={AlertTriangle} title="Could not load guest care" text={state.error} action={{ label: 'Try again', onClick: onRetry }} />
    return (
      <div className="space-y-2.5">
        <div className="h-52 animate-pulse rounded-3xl bg-gradient-to-br from-violet-200/60 to-slate-200/60" />
        <div className="h-24 animate-pulse rounded-2xl bg-slate-200/60" />
        <div className="h-40 animate-pulse rounded-2xl bg-slate-200/40" />
      </div>
    )
  }

  const a = d.auto?.activity ?? null
  const score = careScore(d, t, phases)

  return (
    <div className="space-y-2.5">
      <Hero d={d} t={t} phases={phases} score={score} />
      {next.length > 0 && <UpNext events={next} />}
      <Permission d={d} />
      {a && a.days.length > 0 && <Days a={a} d={d} t={t} />}
      <Reconfirmation d={d} t={t} />
      <PostTour d={d} t={t} />
      {a?.lastCall && <LastCall a={a} />}
      <Link
        href={`/dashboard/bookings/${t.bookingRef}`} target="_blank"
        className="flex items-center justify-center gap-1.5 rounded-2xl border border-dashed border-slate-300 py-2 text-[11.5px] font-bold text-slate-500 transition hover:border-violet-300 hover:bg-violet-50/60 hover:text-violet-700"
      >
        Manage autopilot on the booking <ExternalLink className="h-3 w-3" />
      </Link>
    </div>
  )
}

function Empty({ icon: Icon, title, text, action }: { icon: typeof Bot; title: string; text: string; action?: { label: string; onClick: () => void } }) {
  return (
    <div className="rounded-3xl border border-dashed border-slate-300/80 px-5 py-9 text-center">
      <Icon className="mx-auto mb-2.5 h-7 w-7 text-slate-300" />
      <p className="text-[13px] font-bold text-slate-600">{title}</p>
      <p className="mx-auto mt-1 max-w-[260px] text-[11.5px] leading-relaxed text-slate-400">{text}</p>
      {action && <button onClick={action.onClick} className="mt-3 rounded-xl bg-slate-900 px-3 py-1.5 text-[11.5px] font-bold text-white">{action.label}</button>}
    </div>
  )
}

// ── Hero ────────────────────────────────────────────────────────────────────

function Hero({ d, t, phases, score }: { d: GuestCareData; t: TripContext; phases: Phase[]; score: { due: number; done: number } }) {
  const s = d.auto?.switches
  const a = d.auto?.activity
  const mood = a?.stats.mood ?? null
  const pct = score.due ? Math.round((score.done / score.due) * 100) : 100
  const activeIdx = phases.findIndex(p => p.tone === 'active' || p.tone === 'bad' || p.tone === 'todo')

  return (
    <div className="relative overflow-hidden rounded-3xl bg-[#1a1240] text-white shadow-xl shadow-violet-950/25">
      <div className="pointer-events-none absolute -right-14 -top-16 h-48 w-48 rounded-full bg-fuchsia-500/25 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-20 -left-12 h-48 w-48 rounded-full bg-amber-400/20 blur-3xl" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_1px_1px,rgba(255,255,255,0.07)_1px,transparent_0)] [background-size:14px_14px]" />

      <div className="relative px-4 pb-3 pt-3.5">
        <div className="flex items-center gap-1.5">
          <Zap className="h-3.5 w-3.5 text-amber-300" />
          <p className="text-[10.5px] font-extrabold uppercase tracking-[0.16em] text-violet-200/90">Guest autopilot</p>
        </div>

        <div className="mt-2.5 flex items-center gap-3">
          <Ring value={score.done} max={score.due || 1}>
            <div className="text-center leading-none">
              <p className="text-[17px] font-extrabold">{pct}<span className="text-[10px] text-white/60">%</span></p>
              <p className="mt-0.5 text-[8px] font-bold uppercase tracking-wider text-white/50">care</p>
            </div>
          </Ring>
          <div className="min-w-0 flex-1">
            <p className="text-[15px] font-extrabold leading-tight tracking-tight">
              {score.due ? `${score.done} of ${score.due} touchpoints done` : 'Nothing due yet'}
            </p>
            <p className="mt-0.5 text-[11px] font-semibold text-violet-200/80">
              {t.phase === 'upcoming' ? (t.daysToGo === 1 ? 'Arrives tomorrow' : `Arrives in ${t.daysToGo} days`)
                : t.phase === 'ended' ? 'Trip completed' : `On tour · Day ${t.tripDay} of ${t.tripDays}`}
              {mood && <> · {MOOD[mood].emoji} {MOOD[mood].label}</>}
            </p>
            {s && (
              <div className="mt-1.5 flex flex-wrap gap-1">
                <SwitchPill on={s.messages} label="Messages" icon={MessageCircle} />
                <SwitchPill on={s.calls} label="AI calls" icon={Bot} />
              </div>
            )}
          </div>
        </div>
        {s && (!s.messages || !s.calls) && s.changedBy && (
          <p className="mt-2 flex items-center gap-1 text-[10.5px] text-rose-200/90">
            <ShieldCheck className="h-3 w-3 shrink-0" />
            <span className="truncate">Turned off by {s.changedBy} · {ago(s.changedAt)}{s.reason ? ` · “${s.reason}”` : ''}</span>
          </p>
        )}
      </div>

      {/* journey rail */}
      <div className="relative border-t border-white/10 bg-white/[0.03] px-2 pb-3 pt-3">
        <ol className="relative flex">
          {phases.map((p, i) => {
            const Icon = p.icon
            const look = TONE[p.tone]
            const lit = i < phases.length - 1 && p.tone === 'done'
            return (
              <li key={p.key} className="relative flex min-w-0 flex-1 flex-col items-center text-center" title={p.hint}>
                {i < phases.length - 1 && (
                  <span aria-hidden className="absolute left-1/2 top-[15px] h-[2px] w-full overflow-hidden rounded-full bg-white/10">
                    {lit && <motion.span className="block h-full bg-gradient-to-r from-emerald-300 to-amber-300" initial={{ width: 0 }} animate={{ width: '100%' }} transition={{ duration: 0.6, delay: 0.15 * i }} />}
                  </span>
                )}
                <motion.span
                  initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ delay: 0.08 * i, type: 'spring', stiffness: 400, damping: 22 }}
                  className={`relative z-10 grid h-[30px] w-[30px] place-items-center rounded-full ${look.dot} ${i === activeIdx && p.tone === 'active' ? `ring-4 ${look.ring}` : ''}`}
                >
                  {p.tone === 'done' ? <Check className="h-4 w-4" strokeWidth={3} /> : p.tone === 'bad' ? <AlertTriangle className="h-3.5 w-3.5" /> : <Icon className="h-3.5 w-3.5" />}
                  {p.tone === 'active' && <span className="absolute inset-0 animate-ping rounded-full bg-amber-300/30" />}
                </motion.span>
                <p className="mt-1.5 text-[9.5px] font-bold uppercase tracking-wider text-white/45">{p.label}</p>
                <p className={`max-w-full truncate px-0.5 text-[11.5px] font-extrabold ${look.text}`}>{p.value}</p>
                <p className="max-w-full truncate px-0.5 text-[9.5px] text-white/40">{p.hint}</p>
              </li>
            )
          })}
        </ol>
      </div>
    </div>
  )
}

// ── Up next ─────────────────────────────────────────────────────────────────

const EVENT_TONE = {
  sky: 'from-sky-400 to-blue-500 shadow-sky-500/25',
  violet: 'from-violet-400 to-fuchsia-500 shadow-violet-500/25',
  amber: 'from-amber-300 to-orange-500 shadow-amber-500/25',
  rose: 'from-rose-400 to-pink-500 shadow-rose-500/25',
}

function UpNext({ events }: { events: NextEvent[] }) {
  return (
    <CardShell icon={Hourglass} tint="bg-violet-50 text-violet-600" title="Up next — automatic">
      <ol className="space-y-1.5">
        {events.map((e, i) => {
          const Icon = e.icon
          return (
            <motion.li key={`${e.title}${e.at}`} initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.05 * i }}
              className={`flex items-center gap-2.5 rounded-xl px-2 py-1.5 ${i === 0 ? 'bg-gradient-to-r from-violet-50 to-transparent' : ''}`}>
              <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-gradient-to-br text-white shadow-md ${EVENT_TONE[e.tone]}`}><Icon className="h-4 w-4" /></span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[12px] font-bold text-slate-800">{e.title}</p>
                <p className="truncate text-[10.5px] text-slate-400">{e.sub}</p>
              </div>
              <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-extrabold tabular-nums ${i === 0 ? 'bg-violet-600 text-white' : 'bg-slate-100 text-slate-600'}`}>{countdown(e.at)}</span>
            </motion.li>
          )
        })}
      </ol>
    </CardShell>
  )
}

// ── Call permission ─────────────────────────────────────────────────────────

function Permission({ d }: { d: GuestCareData }) {
  const s = d.auto
  const c = d.care
  const j = s?.journey ?? null
  const allowed = !!s?.allowedCalls || c?.approval.state === 'approved'
  const allowedAt = s?.allowedAt ?? j?.approval.allowedAt ?? c?.approval.approvedAt ?? null
  const reqAt = j?.approval.requestedAt ?? j?.startedAt ?? c?.approval.requestedAt ?? null
  const reminders = j?.approval.reminders ?? []
  const max = s?.maxReminders ?? 2

  const svc = s?.aiService
  const svcLive = !!svc && ['active', 'paused'].includes(svc.status.toLowerCase())
  const reg = j?.registration.state
  const regLabel = svcLive ? (svc!.status.toLowerCase() === 'paused' ? 'AI calls paused' : 'AI calls live')
    : reg === 'registered' || reg === 'existing' ? 'AI calls registered'
    : reg === 'failed' ? 'Registration failed' : 'Not registered'
  const regOk = svcLive || reg === 'registered' || reg === 'existing'

  type Step = { label: string; sub: string; state: 'done' | 'active' | 'todo' | 'bad'; icon: typeof Bot }
  const steps: Step[] = [
    { label: 'Request', icon: Send, sub: reqAt ? ago(reqAt) : 'not sent', state: reqAt || allowed ? 'done' : j?.approval.stage === 'failed' ? 'bad' : 'todo' },
    ...Array.from({ length: max }, (_, i): Step => {
      const r = reminders[i]
      const isNext = !allowed && !j?.finished && !!reqAt && i === reminders.length
      return {
        label: `Reminder ${i + 1}`, icon: Bell,
        sub: r ? ago(r.at) : allowed ? 'not needed' : isNext ? 'next in 24h' : '—',
        state: r ? (r.ok ? 'done' : 'bad') : isNext ? 'active' : 'todo',
      }
    }),
    {
      label: allowed ? 'Allowed' : j?.finished?.outcome === 'no-response' ? 'No reply' : 'Allow tap', icon: allowed ? Check : PhoneCall,
      sub: allowed ? ago(allowedAt) || 'calls on' : j?.finished ? 'stopped' : 'waiting',
      state: allowed ? 'done' : j?.finished ? 'bad' : reqAt && reminders.length === 0 ? 'active' : 'todo',
    },
  ]

  return (
    <CardShell
      icon={ShieldCheck}
      tint={allowed ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'}
      title="WhatsApp call permission"
      aside={<Pill tone={regOk ? 'violet' : reg === 'failed' ? 'rose' : 'slate'} title={j?.registration.detail}><Bot className="h-2.5 w-2.5" />{regLabel}</Pill>}
    >
      {allowed ? (
        <div className="relative overflow-hidden rounded-xl bg-gradient-to-r from-emerald-50 via-teal-50/70 to-white px-3 py-2 ring-1 ring-emerald-100">
          <Sparkles aria-hidden className="absolute -right-1 -top-1 h-12 w-12 text-emerald-200/60" />
          <p className="relative flex items-center gap-1.5 text-[12px] font-bold text-emerald-800"><CheckCheck className="h-4 w-4" /> Guest tapped Allow</p>
          <p className="relative text-[10.5px] text-emerald-700/80">
            {allowedAt ? ago(allowedAt) : 'Allowed on this number'}
            {reminders.filter(r => r.ok).length > 0 ? ` · after ${reminders.filter(r => r.ok).length} reminder(s)` : j ? ' · on the first request' : ''}
            {c?.approval.phone ? ` · +${c.approval.phone}` : ''}
          </p>
        </div>
      ) : (
        <ol className="flex items-start">
          {steps.map((st, i) => {
            const Icon = st.icon
            const dot = st.state === 'done' ? 'bg-emerald-500 text-white' : st.state === 'active' ? 'bg-amber-400 text-white ring-4 ring-amber-100' : st.state === 'bad' ? 'bg-rose-500 text-white' : 'bg-slate-100 text-slate-400'
            return (
              <li key={st.label} className="relative flex min-w-0 flex-1 flex-col items-center text-center">
                {i > 0 && <span aria-hidden className={`absolute right-1/2 top-3 h-0.5 w-full ${steps[i - 1].state === 'done' && st.state !== 'todo' ? 'bg-emerald-300' : 'bg-slate-200'}`} />}
                <span className={`relative z-10 grid h-6 w-6 place-items-center rounded-full ${dot}`}><Icon className="h-3 w-3" /></span>
                <span className="mt-1 max-w-full truncate text-[9.5px] font-bold text-slate-700">{st.label}</span>
                <span className="max-w-full truncate text-[9px] text-slate-400">{st.sub}</span>
              </li>
            )
          })}
        </ol>
      )}
      {!allowed && !j && !c?.approval.requestedAt && (
        <p className="mt-2 rounded-lg bg-amber-50 px-2 py-1 text-[10.5px] text-amber-700">
          No Allow request on this number yet — the AI bot can’t call the guest until they tap Allow.
        </p>
      )}
    </CardShell>
  )
}

// ── Day by day ──────────────────────────────────────────────────────────────

type ActDay = GuestActivity['days'][number]

function planPill(day: ActDay, d: GuestCareData): { tone: Parameters<typeof Pill>[0]['tone']; icon: typeof Bot; text: string; tip: string } {
  const c = d.care
  const tz = c?.briefing.timezone
  const at = day.plan.at
  const msgsOn = d.auto?.switches.messages !== false
  switch (day.plan.state) {
    case 'read':      return { tone: 'sky', icon: CheckCheck, text: `Read${at ? ` · ${clock(at, tz)}` : ''}`, tip: `Read by the guest · sent ${ago(at)}` }
    case 'delivered': return { tone: 'slate', icon: CheckCheck, text: 'Delivered', tip: `Delivered · sent ${ago(at)}` }
    case 'sent':      return { tone: 'slate', icon: Check, text: 'Sent', tip: `Sent ${ago(at)}` }
    case 'failed':    return { tone: 'rose', icon: AlertTriangle, text: 'Failed', tip: 'WhatsApp could not deliver this plan — resend it from the chat' }
    case 'missed':    return { tone: 'rose', icon: XCircle, text: 'Not sent', tip: 'No plan went out for this day' }
  }
  if (!msgsOn || !c?.briefing.time || !c.briefing.enabled) return { tone: 'ghost', icon: Lock, text: 'Auto off', tip: 'Automatic daily plans are off for this booking' }
  const sendDay = c.briefing.sameDay ? day.date : addDay(day.date, -1)
  const when = zonedInstant(sendDay, c.briefing.time, c.briefing.timezone)
  const text = when <= Date.now() ? 'Sending…' : `${sendDay === d.auto?.activity?.today ? 'Today' : shortDay(sendDay)} ${hm12(c.briefing.time)}`
  return { tone: day.plan.state === 'today' ? 'amber' : 'ghost', icon: Clock, text, tip: `Goes out automatically ${countdown(when)}` }
}

function callPill(day: ActDay): { tone: Parameters<typeof Pill>[0]['tone']; icon: typeof Bot; text: string } | null {
  const c = day.call
  const mood = moodOf(c.sentiment)
  switch (c.state) {
    case 'answered':  return { tone: mood === 'negative' ? 'rose' : mood === 'neutral' ? 'amber' : 'violet', icon: PhoneIncoming, text: mood ? `${MOOD[mood].emoji} ${MOOD[mood].label}` : 'Answered' }
    case 'missed':    return { tone: 'rose', icon: PhoneMissed, text: c.attempts > 1 ? `No answer ×${c.attempts}` : 'No answer' }
    case 'calling':   return { tone: 'violet', icon: PhoneCall, text: 'Calling…' }
    case 'scheduled': return { tone: 'ghost', icon: Clock, text: c.at ? clock(c.at) || 'Scheduled' : 'Scheduled' }
    case 'none':      return null
    default:          return { tone: 'ghost', icon: Bot, text: '—' }
  }
}

function Days({ a, d, t }: { a: GuestActivity; d: GuestCareData; t: TripContext }) {
  const todayIdx = a.days.findIndex(x => x.date === a.today)
  const hideable = todayIdx > 2 ? todayIdx - 1 : 0
  const [showAll, setShowAll] = useState(false)
  const [open, setOpen] = useState<string | null>(null)
  const days = showAll ? a.days : a.days.slice(hideable)
  const s = a.stats
  const plansDue = Math.max(a.days.filter(x => x.date <= a.today).length, s.plansSent)

  return (
    <CardShell
      icon={MessageCircle} tint="bg-sky-50 text-sky-600" title="Daily plans & AI calls"
      aside={<span className="shrink-0 text-[10.5px] font-bold text-slate-400">{t.tripDays} days</span>}
    >
      {/* stat strip */}
      <div className="mb-2 grid grid-cols-3 gap-1.5">
        <Stat label="Plans sent" value={`${s.plansSent}/${plansDue}`} sub={s.plansFailed ? `${s.plansFailed} failed` : `${s.plansRead} read`} tone={s.plansFailed ? 'rose' : 'sky'} pct={plansDue ? s.plansSent / plansDue : 0} />
        <Stat label="AI calls" value={a.callsAvailable ? `${s.callsAnswered}/${s.callsDue}` : '—'} sub={a.callsAvailable ? (s.callsDue ? `${s.callsDue - s.callsAnswered} not reached` : 'none due') : 'unavailable'} tone="violet" pct={s.callsDue ? s.callsAnswered / s.callsDue : 0} />
        <Stat label="Mood" value={s.mood ? MOOD[s.mood].emoji : '—'} sub={s.mood ? MOOD[s.mood].label : 'no call yet'} tone={s.mood === 'negative' ? 'rose' : s.mood === 'neutral' ? 'amber' : 'emerald'} pct={s.mood ? 1 : 0} />
      </div>

      {/* heat strip — every day at a glance */}
      <div className="mb-2 flex gap-[3px]" aria-hidden>
        {a.days.map(x => {
          const c = x.plan.state === 'read' ? 'bg-sky-500' : x.plan.state === 'delivered' || x.plan.state === 'sent' ? 'bg-sky-300'
            : x.plan.state === 'failed' || x.plan.state === 'missed' ? 'bg-rose-400' : x.plan.state === 'today' ? 'bg-amber-400' : 'bg-slate-200'
          return <span key={x.date} title={`D${x.dayNo}`} className={`h-1.5 flex-1 rounded-full ${c} ${x.date === a.today ? 'ring-2 ring-amber-200' : ''}`} />
        })}
      </div>

      {hideable > 0 && (
        <button onClick={() => setShowAll(v => !v)} className="mb-1 flex w-full items-center justify-center gap-1 rounded-lg py-1 text-[10.5px] font-bold text-slate-400 hover:bg-slate-50 hover:text-slate-600">
          <ChevronDown className={`h-3 w-3 transition ${showAll ? 'rotate-180' : ''}`} />
          {showAll ? 'Hide earlier days' : `Show ${hideable} earlier day${hideable === 1 ? '' : 's'}`}
        </button>
      )}

      <ol className="relative space-y-1 before:absolute before:bottom-3 before:left-[17px] before:top-3 before:w-px before:bg-slate-200">
        {days.map(day => {
          const isToday = day.date === a.today
          const past = day.date < a.today
          const plan = planPill(day, d)
          const call = a.callsAvailable ? callPill(day) : null
          const detail = day.call.summary || day.call.issues
          const isOpen = open === day.date
          return (
            <li key={day.date} className="relative">
              <button
                onClick={() => detail && setOpen(isOpen ? null : day.date)}
                className={`flex w-full items-center gap-2 rounded-xl py-1 pl-0 pr-1.5 text-left transition ${isToday ? 'bg-amber-50 ring-1 ring-amber-200' : detail ? 'hover:bg-slate-50' : 'cursor-default'}`}
              >
                <span className={`relative z-10 grid h-[34px] w-[34px] shrink-0 place-items-center rounded-full text-center leading-none ring-4 ring-white ${
                  isToday ? 'bg-amber-400 text-amber-950' : past ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-500'}`}>
                  <span><span className="block text-[11px] font-extrabold">D{day.dayNo}</span></span>
                </span>
                <span className="w-[54px] shrink-0 leading-tight">
                  <span className={`block text-[11px] font-bold ${isToday ? 'text-amber-700' : 'text-slate-700'}`}>{isToday ? 'Today' : dayFmt(day.date, { weekday: 'short' })}</span>
                  <span className="block text-[10px] text-slate-400">{shortDay(day.date)}</span>
                </span>
                <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
                  <Pill tone={plan.tone} title={plan.tip}><MessageCircle className="h-2.5 w-2.5 shrink-0" /><plan.icon className="h-2.5 w-2.5 shrink-0" />{plan.text}</Pill>
                  {call && <Pill tone={call.tone}><call.icon className="h-2.5 w-2.5 shrink-0" />{call.text}</Pill>}
                </span>
                {detail && <ChevronDown className={`h-3 w-3 shrink-0 text-slate-400 transition ${isOpen ? 'rotate-180' : ''}`} />}
              </button>
              <AnimatePresence initial={false}>
                {isOpen && detail && (
                  <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                    <div className="ml-[42px] mt-1 rounded-xl bg-violet-50/70 px-2.5 py-1.5 text-[11px] leading-snug text-slate-700 ring-1 ring-violet-100">
                      {day.call.summary && <p>{day.call.summary}</p>}
                      {day.call.issues && <p className="mt-1 flex items-start gap-1 text-rose-600"><AlertTriangle className="mt-px h-3 w-3 shrink-0" />{day.call.issues}</p>}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </li>
          )
        })}
      </ol>
      {d.care?.briefing.time && (
        <p className="mt-2 flex items-center gap-1 text-[10px] text-slate-400">
          <Clock className="h-3 w-3" />
          Plans go out {d.care.briefing.sameDay ? 'the same morning' : 'the evening before'} at {hm12(d.care.briefing.time)} trip time{d.care.briefing.custom ? ' (custom for this booking)' : ''}.
        </p>
      )}
    </CardShell>
  )
}

function Stat({ label, value, sub, tone, pct }: { label: string; value: string; sub: string; tone: 'sky' | 'violet' | 'rose' | 'amber' | 'emerald'; pct: number }) {
  const bar = { sky: 'bg-sky-500', violet: 'bg-violet-500', rose: 'bg-rose-500', amber: 'bg-amber-400', emerald: 'bg-emerald-500' }[tone]
  return (
    <div className="min-w-0 rounded-xl bg-slate-50 px-2 py-1.5 ring-1 ring-slate-100">
      <p className="truncate text-[9px] font-bold uppercase tracking-wider text-slate-400">{label}</p>
      <p className="text-[14px] font-extrabold leading-tight text-slate-900">{value}</p>
      <div className="mt-1 h-1 overflow-hidden rounded-full bg-slate-200">
        <motion.div className={`h-full rounded-full ${bar}`} initial={{ width: 0 }} animate={{ width: `${Math.round(Math.min(1, pct) * 100)}%` }} transition={{ duration: 0.7 }} />
      </div>
      <p className="mt-0.5 truncate text-[9.5px] text-slate-500">{sub}</p>
    </div>
  )
}

// ── Reconfirmation ──────────────────────────────────────────────────────────

function EntryBody({ e, tz }: { e: CallEntry; tz?: string }) {
  const mood = moodOf(e.sentiment)
  return (
    <div className="rounded-xl bg-slate-50 px-2.5 py-2 ring-1 ring-slate-100">
      <div className="flex flex-wrap items-center gap-1">
        <SourceBadge e={e} />
        {mood && <Pill tone={mood === 'negative' ? 'rose' : mood === 'neutral' ? 'amber' : 'emerald'}>{MOOD[mood].emoji} {MOOD[mood].label}</Pill>}
        {e.outcome && <Pill tone="slate">{e.outcome.replace(/_/g, ' ')}</Pill>}
        <span className="ml-auto text-[10px] text-slate-400" title={new Date(e.at).toLocaleString('en-GB', { timeZone: tz })}>{ago(e.at)}</span>
      </div>
      <p className="mt-1.5 line-clamp-3 text-[11.5px] leading-snug text-slate-700" title={e.summary}>{e.summary}</p>
      {e.notes && e.notes !== e.summary && <p className="mt-1 line-clamp-2 text-[10.5px] leading-snug text-slate-500">{e.notes}</p>}
    </div>
  )
}

function Reconfirmation({ d, t }: { d: GuestCareData; t: TripContext }) {
  const cell = d.care?.calls.PRE
  const latest = cell?.latest ?? null
  const x = d.auto?.activity?.extras.find(e => e.phase === 'Reconfirm')
  const ai = cell?.entries.filter(e => e.source === 'AI').length ?? 0
  const manual = (cell?.count ?? 0) - ai

  return (
    <CardShell
      icon={CalendarCheck}
      tint={latest || x?.state === 'answered' ? 'bg-emerald-50 text-emerald-600' : x?.state === 'missed' || t.phase !== 'upcoming' ? 'bg-rose-50 text-rose-600' : 'bg-amber-50 text-amber-600'}
      title="Pre-trip reconfirmation"
      aside={cell && cell.count > 0 ? (
        <span className="flex shrink-0 gap-1">
          {ai > 0 && <Pill tone="violet"><Bot className="h-2.5 w-2.5" />{ai}</Pill>}
          {manual > 0 && <Pill tone="sky"><UserRound className="h-2.5 w-2.5" />{manual}</Pill>}
        </span>
      ) : undefined}
    >
      {latest ? <EntryBody e={latest} tz={d.care?.briefing.timezone} />
        : x ? (
          <StatusLine
            tone={x.state === 'answered' ? 'emerald' : x.state === 'missed' ? 'rose' : 'violet'}
            icon={x.state === 'answered' ? PhoneIncoming : x.state === 'missed' ? PhoneMissed : Clock}
            title={x.state === 'answered' ? 'AI reconfirmation call answered' : x.state === 'missed' ? 'AI reconfirmation call not answered' : x.state === 'calling' ? 'AI is calling the guest now' : 'AI reconfirmation call scheduled'}
            sub={`${weekDay(x.date)}${x.at ? ` · ${clock(x.at)}` : ''}${x.state === 'missed' ? ' — reconfirm manually and log it' : ''}`}
          />
        ) : (
          <StatusLine
            tone={t.phase === 'upcoming' ? 'slate' : 'rose'} icon={Hourglass}
            title={t.phase === 'upcoming' ? 'Not reconfirmed yet' : 'No reconfirmation on file'}
            sub={t.phase === 'upcoming' ? `Guest arrives ${weekDay(t.arrivalDate)} — AI call or manual log` : 'Neither an AI call nor a manual log was recorded'}
          />
        )}
    </CardShell>
  )
}

function StatusLine({ tone, icon: Icon, title, sub }: { tone: 'emerald' | 'rose' | 'violet' | 'slate' | 'amber' | 'sky'; icon: typeof Bot; title: string; sub: string }) {
  const tones = {
    emerald: 'bg-emerald-50 ring-emerald-100 text-emerald-700', rose: 'bg-rose-50 ring-rose-100 text-rose-700',
    violet: 'bg-violet-50 ring-violet-100 text-violet-700', slate: 'bg-slate-50 ring-slate-100 text-slate-600',
    amber: 'bg-amber-50 ring-amber-100 text-amber-700', sky: 'bg-sky-50 ring-sky-100 text-sky-700',
  }
  return (
    <div className={`flex items-center gap-2 rounded-xl px-2.5 py-2 ring-1 ${tones[tone]}`}>
      <Icon className="h-4 w-4 shrink-0" />
      <div className="min-w-0">
        <p className="truncate text-[11.5px] font-bold">{title}</p>
        <p className="truncate text-[10.5px] opacity-80">{sub}</p>
      </div>
    </div>
  )
}

// ── Post-tour feedback ──────────────────────────────────────────────────────

const SHORT_RATING: Record<string, string> = {
  accommodationRoom: 'Hotel room', accommodationFood: 'Hotel food',
  restaurantFood: 'Restaurant', restaurantAmbience: 'Ambience',
  transportVehicle: 'Vehicle', transportDriver: 'Driver',
}

function PostTour({ d, t }: { d: GuestCareData; t: TripContext }) {
  const cell = d.care?.calls.POST
  const latest = cell?.latest ?? null
  const x = d.auto?.activity?.extras.find(e => e.phase === 'After tour')
  const ff = d.care?.feedbackForm
  const form = ff?.form ?? null
  const rating = ratingOf(latest)
  const got = !!form || !!latest || x?.state === 'answered'

  return (
    <CardShell
      icon={HeartHandshake}
      tint={got ? 'bg-pink-50 text-pink-600' : t.phase === 'ended' ? 'bg-rose-50 text-rose-600' : 'bg-slate-100 text-slate-500'}
      title="Post-tour feedback"
      aside={rating != null ? (
        <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-extrabold text-amber-600 ring-1 ring-amber-200">
          <Star className="h-3 w-3 fill-amber-400 text-amber-400" />{rating}/10
        </span>
      ) : undefined}
    >
      <div className="space-y-2">
        {/* the call */}
        <div>
          <p className="mb-1 flex items-center gap-1 text-[9.5px] font-bold uppercase tracking-wider text-slate-400"><PhoneCall className="h-3 w-3" />Feedback call</p>
          {latest ? <EntryBody e={latest} tz={d.care?.briefing.timezone} />
            : x ? (
              <StatusLine
                tone={x.state === 'answered' ? 'emerald' : x.state === 'missed' ? 'rose' : 'violet'}
                icon={x.state === 'missed' ? PhoneMissed : x.state === 'answered' ? PhoneIncoming : Clock}
                title={x.state === 'answered' ? 'AI feedback call answered' : x.state === 'missed' ? 'AI feedback call not answered' : 'AI feedback call scheduled'}
                sub={`${weekDay(x.date)}${x.summary ? ` · ${x.summary}` : ''}`}
              />
            ) : (
              <StatusLine tone={t.phase === 'ended' ? 'rose' : 'slate'} icon={Hourglass}
                title={t.phase === 'ended' ? 'No feedback call yet' : 'After the trip'}
                sub={t.phase === 'ended' ? 'Call the guest or log a manual call' : `Guest departs ${weekDay(t.departureDate)}`} />
            )}
        </div>

        {/* the form */}
        <div>
          <p className="mb-1 flex items-center gap-1 text-[9.5px] font-bold uppercase tracking-wider text-slate-400"><ClipboardCheck className="h-3 w-3" />Feedback form</p>
          {form ? (
            <div className="rounded-xl bg-gradient-to-br from-pink-50 via-white to-amber-50/60 p-2.5 ring-1 ring-pink-100">
              <div className="flex items-center gap-2">
                <span className="text-[26px] leading-none">{form.overall ? FEEDBACK_RATING_EMOJI[form.overall] ?? '📝' : '📝'}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-[12.5px] font-extrabold text-slate-800">{form.overall ? `${FEEDBACK_RATING_LABELS[form.overall] ?? form.overall} overall` : 'Form submitted'}</p>
                  <p className="truncate text-[10.5px] text-slate-500">Submitted {ago(form.submittedAt)}{form.clientName ? ` by ${form.clientName}` : ''}</p>
                </div>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-1">
                {FEEDBACK_RATING_FIELDS.map(f => {
                  const v = form.ratings[f.key]
                  return (
                    <div key={f.key} className={`flex items-center gap-1.5 rounded-lg px-1.5 py-1 ${v === 'POOR' ? 'bg-rose-50 ring-1 ring-rose-200' : v === 'AVERAGE' ? 'bg-amber-50' : 'bg-white/70'}`}>
                      <span className="text-[13px] leading-none">{v ? FEEDBACK_RATING_EMOJI[v] : '·'}</span>
                      <span className="min-w-0 truncate text-[10px] font-semibold text-slate-600" title={`${f.label}: ${v ? FEEDBACK_RATING_LABELS[v] : '—'}`}>{SHORT_RATING[f.key] ?? f.label}</span>
                    </div>
                  )
                })}
              </div>
              {form.remarks && (
                <p className="mt-2 flex gap-1 rounded-lg bg-white/80 px-2 py-1.5 text-[11px] italic leading-snug text-slate-600">
                  <Quote className="mt-px h-3 w-3 shrink-0 text-pink-400" /><span className="line-clamp-3">{form.remarks}</span>
                </p>
              )}
            </div>
          ) : ff?.sentAt ? (
            <StatusLine tone="amber" icon={Send} title="Sent — waiting for the guest" sub={`Form sent on WhatsApp ${ago(ff.sentAt)}`} />
          ) : (
            <StatusLine
              tone="slate" icon={d.care?.feedbackAuto ? Clock : Lock}
              title={d.care?.feedbackAuto ? 'Goes out automatically' : 'Auto-send is off'}
              sub={d.care?.feedbackAuto ? `On departure day · ${weekDay(t.departureDate)}` : 'Send it from the chat when the trip ends'}
            />
          )}
        </div>
      </div>
    </CardShell>
  )
}

// ── Last AI call ────────────────────────────────────────────────────────────

function LastCall({ a }: { a: GuestActivity }) {
  const lc = a.lastCall!
  const mood = moodOf(lc.sentiment)
  return (
    <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-violet-50 via-white to-white p-3 pl-4 ring-1 ring-violet-100">
      <span aria-hidden className={`absolute inset-y-0 left-0 w-1 bg-gradient-to-b ${mood ? MOOD[mood].bar : 'from-violet-400 to-violet-500'}`} />
      <Quote aria-hidden className="absolute -right-1 -top-1 h-14 w-14 text-violet-100" />
      <div className="relative flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-violet-600">
        <Bot className="h-3 w-3" /> What the guest said{lc.dayNo ? ` · Day ${lc.dayNo}` : ''}
        {mood && <span className={`ml-auto rounded-full px-1.5 py-px text-[10px] normal-case tracking-normal ring-1 ${MOOD[mood].chip}`}>{MOOD[mood].emoji} {MOOD[mood].label}</span>}
      </div>
      <p className="relative mt-1.5 line-clamp-4 text-[12px] leading-snug text-slate-700" title={lc.summary}>{lc.summary}</p>
      {lc.issues && (
        <p className="relative mt-1.5 flex items-start gap-1 rounded-lg bg-rose-50 px-2 py-1 text-[11px] text-rose-700">
          <AlertTriangle className="mt-px h-3 w-3 shrink-0" /><span className="line-clamp-2">{lc.issues}</span>
        </p>
      )}
    </div>
  )
}
