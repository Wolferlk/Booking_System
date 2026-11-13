'use client'

/**
 * Guest Autopilot — what the system does on its own with the guest's WhatsApp.
 *
 *   ┌ Auto messages ●━━ ┐  ┌ Auto AI calls ●━━ ┐      ← switches (OFF needs an emailed code)
 *   Assigned ─ Allow request ─ Reminder 1 ─ Reminder 2 ─ Allowed   ← the approval journey
 *
 * Server side: /api/bookings/[ref]/guest-automation (lib/guest-automation.ts).
 */
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import {
  Zap, MessageCircle, Bot, Lock, ShieldCheck, Check, Send, Bell, PhoneCall, Hourglass,
  XCircle, RotateCw, Loader2, UserPlus, CheckCheck, AlertTriangle, PhoneIncoming, PhoneMissed, Clock,
  Smile, Meh, Frown, Quote, Sparkles, CalendarDays,
} from 'lucide-react'
import VerificationModal, { type VerificationCredentials } from '@/components/security/verification-modal'
import type { GuestActivity } from '@/lib/guest-autopilot-activity'
import SectionLogsButton from '@/components/logs/section-logs-button'

type Kind = 'messages' | 'calls'

export interface Snapshot {
  switches: { messages: boolean; calls: boolean; changedBy: string | null; changedAt: string | null; reason: string | null }
  journey: {
    phone: string
    startedAt: string
    startedBy: string
    approval: {
      stage: 'allowed' | 'requested' | 'rate-limited' | 'failed'
      requestedAt: string | null
      allowedAt: string | null
      reminders: { at: string; via: 'approval-request' | 'template-text'; ok: boolean; detail?: string }[]
      detail?: string
    }
    registration: { state: 'registered' | 'existing' | 'skipped' | 'failed'; at: string; detail?: string }
    finished?: { outcome: 'allowed' | 'no-response' | 'stopped'; at: string; detail?: string }
  } | null
  maxReminders: number
  allowedCalls: boolean
  aiService: { status: string; callPhone: string | null } | null
  engageOnAssign: boolean
  allowedAt?: string | null
  activity?: GuestActivity | null
}

const DAY = 86_400_000

function when(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  const diff = Date.now() - d.getTime()
  if (diff < 60_000) return 'just now'
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m ago`
  if (diff < DAY) return `${Math.round(diff / 3_600_000)}h ago`
  return d.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

function inFuture(ms: number): string {
  const left = ms - Date.now()
  if (left <= 0) return 'due now'
  // Work in whole minutes first so 23h 59.6m reads "24h 0m", never "23h 60m".
  const total = Math.ceil(left / 60_000)
  const h = Math.floor(total / 60), m = total % 60
  return h > 0 ? `in ${h}h ${m}m` : `in ${m}m`
}

export default function GuestAutopilot({ bookingRef, hasWhatsapp, canEdit, reloadKey }: {
  bookingRef: string
  /** A valid guest WhatsApp is on file — the journey can run. */
  hasWhatsapp: boolean
  canEdit: boolean
  reloadKey?: number
}) {
  const [snap, setSnap] = useState<Snapshot | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [offKind, setOffKind] = useState<Kind | null>(null)
  const [reason, setReason] = useState('')
  const [verifyOpen, setVerifyOpen] = useState(false)

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/bookings/${encodeURIComponent(bookingRef)}/guest-automation`)
      const j = await r.json()
      if (j?.success) setSnap(j.data as Snapshot)
    } catch { /* panel is optional */ }
  }, [bookingRef])

  useEffect(() => { void load() }, [load, reloadKey])

  async function post(body: Record<string, unknown>) {
    const r = await fetch(`/api/bookings/${encodeURIComponent(bookingRef)}/guest-automation`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })
    const j = await r.json()
    if (!j.success) throw new Error(j.error ?? 'Failed')
    setSnap(j.data as Snapshot)
    return j.data as Snapshot & { notes?: string[]; result?: { approval?: string; registration?: string } }
  }

  async function turnOn(kind: Kind) {
    setBusy(kind)
    try {
      const d = await post({ action: 'set', kinds: [kind], on: true })
      toast.success(`Auto ${kind === 'calls' ? 'AI calls' : 'messages'} back ON`, { description: d.notes?.join(' · ') || undefined })
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Failed') } finally { setBusy(null) }
  }

  async function start() {
    setBusy('start')
    try {
      const d = await post({ action: 'start' })
      const a = d.result?.approval
      toast.success(a === 'allowed' ? 'Guest already allows calls ✓' : 'Allow request sent to the guest',
        { description: d.result?.registration === 'registered' ? 'AI calls registered.' : undefined })
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Failed') } finally { setBusy(null) }
  }

  if (!snap) return null
  const { switches, journey } = snap

  return (
    <div className="h-full rounded-2xl border border-slate-200 bg-gradient-to-br from-white to-slate-50/60 px-4 py-3 shadow-sm">
      {/* Header + switches */}
      <div className="flex flex-wrap items-center gap-2">
        <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">
          <Zap className="w-3.5 h-3.5 text-amber-500" /> Guest Autopilot
        </p>
        <SectionLogsButton bookingRef={bookingRef} section="messages" label="Daily messages & AI calls" />
        <div className="ml-auto flex items-center gap-2">
          <Switch label="Auto messages" icon={MessageCircle} on={switches.messages} busy={busy === 'messages'} disabled={!canEdit}
            onToggle={() => (switches.messages ? setOffKind('messages') : turnOn('messages'))} />
          <Switch label="Auto AI calls" icon={Bot} on={switches.calls} busy={busy === 'calls'} disabled={!canEdit}
            onToggle={() => (switches.calls ? setOffKind('calls') : turnOn('calls'))} />
        </div>
      </div>

      {(!switches.messages || !switches.calls) && switches.changedBy && (
        <p className="mt-1.5 text-[11px] text-red-600/90 flex items-center gap-1">
          <ShieldCheck className="w-3 h-3" />
          Turned off by {switches.changedBy} · {when(switches.changedAt)}{switches.reason ? ` · “${switches.reason}”` : ''}
        </p>
      )}

      {/* Journey */}
      {switches.calls && <Journey snap={snap} hasWhatsapp={hasWhatsapp} canEdit={canEdit} busy={busy === 'start'} onStart={start} />}

      {/* What actually went out: daily plans + AI calls, day by day */}
      {snap.activity && snap.activity.days.length > 0 && (
        <ActivityPanel a={snap.activity} messagesOn={switches.messages} callsOn={switches.calls} />
      )}

      {/* Turn-off confirm: reason, then the emailed code */}
      {offKind && !verifyOpen && (
        <div className="mt-3 rounded-xl border border-red-200 bg-red-50/70 p-3">
          <p className="text-xs font-semibold text-red-800 flex items-center gap-1.5">
            <Lock className="w-3.5 h-3.5" /> Turn off auto {offKind === 'calls' ? 'AI calls' : 'messages'} for {bookingRef}?
          </p>
          <p className="mt-0.5 text-[11px] text-red-700/80">
            {offKind === 'calls'
              ? 'The AI-call service is paused and no more Allow reminders go out.'
              : 'No daily trip plan, feedback request, portal or ticket messages go out automatically. Manual sends still work.'}
            {' '}A code will be emailed to you to confirm.
          </p>
          <input className="form-input mt-2 text-sm" placeholder="Reason (e.g. guest asked us to stop)" value={reason}
            onChange={e => setReason(e.target.value)} maxLength={300} />
          <div className="mt-2 flex justify-end gap-2">
            <button type="button" onClick={() => { setOffKind(null); setReason('') }} className="text-xs text-slate-500 hover:text-slate-700 px-2">Keep ON</button>
            <button type="button" onClick={() => setVerifyOpen(true)}
              className="inline-flex items-center gap-1 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700">
              <ShieldCheck className="w-3.5 h-3.5" /> Email me the code
            </button>
          </div>
        </div>
      )}

      {offKind && (
        <VerificationModal
          open={verifyOpen}
          action="GUEST_AUTOMATION_OFF"
          bookingRef={bookingRef}
          requestPayload={{ kinds: [offKind] }}
          summary={<>Turning off <strong>automatic {offKind === 'calls' ? 'AI calls' : 'WhatsApp messages'}</strong> for <strong>{bookingRef}</strong>. You can turn it back on any time.</>}
          confirmLabel="Turn off"
          onClose={() => setVerifyOpen(false)}
          onVerified={async (cred: VerificationCredentials) => {
            const d = await post({ action: 'set', kinds: [offKind], on: false, reason, ...cred })
            toast.success(`Auto ${offKind === 'calls' ? 'AI calls' : 'messages'} turned OFF`, { description: d.notes?.join(' · ') || undefined })
            setVerifyOpen(false); setOffKind(null); setReason('')
          }}
        />
      )}
    </div>
  )
}

function Switch({ label, icon: Icon, on, busy, disabled, onToggle }: {
  label: string; icon: typeof Bot; on: boolean; busy: boolean; disabled: boolean; onToggle: () => void
}) {
  return (
    <button type="button" role="switch" aria-checked={on} disabled={disabled || busy} onClick={onToggle}
      title={on ? `${label} ON — turning off needs an emailed code` : `${label} OFF — click to turn back on`}
      className={`group inline-flex items-center gap-2 rounded-full border pl-2 pr-1 py-1 text-[11px] font-semibold transition disabled:opacity-60 ${
        on ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-red-200 bg-red-50 text-red-700'}`}>
      <Icon className="w-3.5 h-3.5" />
      {label}
      <span className={`relative inline-flex h-4 w-7 items-center rounded-full transition ${on ? 'bg-emerald-500' : 'bg-red-300'}`}>
        <span className={`absolute flex h-3 w-3 items-center justify-center rounded-full bg-white shadow transition-all ${on ? 'left-3.5' : 'left-0.5'}`}>
          {busy ? <Loader2 className="w-2 h-2 animate-spin text-slate-400" /> : on ? null : <Lock className="w-2 h-2 text-red-400" />}
        </span>
      </span>
    </button>
  )
}

type StepState = 'done' | 'active' | 'todo' | 'bad'

function Journey({ snap, hasWhatsapp, canEdit, busy, onStart }: {
  snap: Snapshot; hasWhatsapp: boolean; canEdit: boolean; busy: boolean; onStart: () => void
}) {
  const j = snap.journey
  const allowed = snap.allowedCalls || j?.approval.stage === 'allowed'

  // Once the guest has tapped Allow, the journey collapses into one celebratory line.
  if (allowed) return <AllowedBanner snap={snap} />

  if (!j) {
    return (
      <div className="mt-2.5 flex items-center gap-2 rounded-xl bg-slate-50 px-3 py-2">
        <Hourglass className="w-3.5 h-3.5 text-slate-400" />
        <p className="flex-1 text-[11px] text-slate-500">
          {allowed ? 'Guest already allows WhatsApp calls ✓'
            : hasWhatsapp ? 'Allow request not sent yet for this number.'
            : 'Assign the guest WhatsApp and the Allow request + AI-call registration go out automatically.'}
        </p>
        {hasWhatsapp && canEdit && !allowed && (
          <StartBtn busy={busy} onClick={onStart} label="Send Allow request" />
        )}
      </div>
    )
  }

  const reqAt = j.approval.requestedAt ?? j.startedAt
  const rem = j.approval.reminders
  const lastSendMs = Date.parse(rem[rem.length - 1]?.at ?? reqAt)
  const open = !j.finished && !allowed

  const steps: { icon: typeof Bot; label: string; sub: string; state: StepState }[] = [
    { icon: UserPlus, label: 'Assigned', sub: `+${j.phone}`, state: 'done' },
    {
      icon: Send, label: 'Allow request',
      sub: j.approval.stage === 'failed' && !j.approval.requestedAt ? 'failed' : when(reqAt),
      state: j.approval.stage === 'failed' && !j.approval.requestedAt ? 'bad' : 'done',
    },
    ...Array.from({ length: snap.maxReminders }, (_, i) => {
      const r = rem[i]
      const isNext = open && i === rem.length
      return {
        icon: Bell, label: `Reminder ${i + 1}`,
        sub: r ? `${when(r.at)}${r.via === 'template-text' ? ' · text' : ''}` : allowed ? 'not needed' : isNext ? inFuture(lastSendMs + DAY) : j.finished ? '—' : 'after 24h',
        state: (r ? (r.ok ? 'done' : 'bad') : isNext ? 'active' : 'todo') as StepState,
      }
    }),
    {
      icon: allowed ? Check : j.finished?.outcome === 'no-response' ? XCircle : PhoneCall,
      label: allowed ? 'Allowed' : j.finished?.outcome === 'no-response' ? 'No response' : j.finished?.outcome === 'stopped' ? 'Stopped' : 'Waiting',
      sub: allowed ? when(j.approval.allowedAt) || 'calls on' : j.finished ? (j.finished.detail ?? when(j.finished.at)) : 'for Allow tap',
      state: allowed ? 'done' : j.finished ? 'bad' : rem.length === 0 ? 'active' : 'todo',
    },
  ]

  // The live service row wins over the journey's note: if TE already has an
  // active/paused service, the booking IS registered whatever the intake said.
  const svcLive = !!snap.aiService && ['active', 'paused'].includes(snap.aiService.status.toLowerCase())
  const reg = svcLive && (j.registration.state === 'failed' || j.registration.state === 'skipped')
    ? { ...j.registration, state: 'existing' as const }
    : j.registration
  return (
    <div className="mt-2.5">
      <ol className="flex items-start">
        {steps.map((s, i) => {
          const Icon = s.icon
          const dot =
            s.state === 'done' ? 'bg-emerald-500 text-white' :
            s.state === 'active' ? 'bg-amber-400 text-white ring-4 ring-amber-100 animate-pulse' :
            s.state === 'bad' ? 'bg-red-500 text-white' : 'bg-slate-100 text-slate-400'
          return (
            <li key={s.label} className="relative flex-1 min-w-0 flex flex-col items-center text-center">
              {i > 0 && (
                <span aria-hidden className={`absolute right-1/2 top-3 h-0.5 w-full -z-0 ${
                  steps[i - 1].state === 'done' && s.state !== 'todo' ? 'bg-emerald-300' : 'bg-slate-200'}`} />
              )}
              <span className={`relative z-10 flex h-6 w-6 items-center justify-center rounded-full ${dot}`}>
                <Icon className="h-3 w-3" />
              </span>
              <span className="mt-1 text-[10px] font-semibold text-slate-700 leading-tight">{s.label}</span>
              <span className="text-[9.5px] text-slate-400 leading-tight truncate max-w-full px-0.5" title={s.sub}>{s.sub}</span>
            </li>
          )
        })}
      </ol>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium border ${
          reg.state === 'registered' || reg.state === 'existing' ? 'bg-violet-50 text-violet-700 border-violet-200'
          : reg.state === 'failed' ? 'bg-red-50 text-red-700 border-red-200' : 'bg-slate-50 text-slate-500 border-slate-200'}`}
          title={reg.detail}>
          <Bot className="w-3 h-3" />
          {reg.state === 'registered' ? 'AI calls registered' : reg.state === 'existing' ? 'AI calls already set up'
            : reg.state === 'failed' ? 'AI-call registration failed' : 'AI calls not registered'}
          {snap.aiService && <span className="opacity-70">· {snap.aiService.status}</span>}
        </span>
        {open && <span className="text-[10px] text-slate-400">Auto-reminders via WhatsApp every 24 h until the guest taps Allow (max {snap.maxReminders}).</span>}
        {!open && !allowed && canEdit && hasWhatsapp && (
          <span className="ml-auto"><StartBtn busy={busy} onClick={onStart} label="Restart" icon={RotateCw} /></span>
        )}
      </div>
    </div>
  )
}

function StartBtn({ busy, onClick, label, icon: Icon = Send }: { busy: boolean; onClick: () => void; label: string; icon?: typeof Send }) {
  return (
    <button type="button" disabled={busy} onClick={onClick}
      className="inline-flex items-center gap-1 rounded-full bg-[#25D366] px-2.5 py-1 text-[11px] font-semibold text-white shadow-sm hover:bg-[#1ebe5a] disabled:opacity-60">
      {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Icon className="w-3 h-3" />} {label}
    </button>
  )
}

// ── Allowed banner ───────────────────────────────────────────────────────────

function registrationOf(snap: Snapshot) {
  const svcLive = !!snap.aiService && ['active', 'paused'].includes(snap.aiService.status.toLowerCase())
  const st = snap.journey?.registration.state
  if (svcLive) return { ok: true, label: snap.aiService!.status.toLowerCase() === 'paused' ? 'AI calls paused' : 'AI calls live' }
  if (st === 'registered' || st === 'existing') return { ok: true, label: 'AI calls registered' }
  if (st === 'failed') return { ok: false, label: 'AI-call registration failed' }
  return { ok: false, label: 'AI calls not registered' }
}

function AllowedBanner({ snap }: { snap: Snapshot }) {
  const at = snap.allowedAt ?? snap.journey?.approval.allowedAt ?? null
  const reminders = snap.journey?.approval.reminders.filter(r => r.ok).length ?? 0
  const reg = registrationOf(snap)
  return (
    <div className="relative mt-2.5 overflow-hidden rounded-xl border border-emerald-200/80 bg-gradient-to-r from-emerald-50 via-teal-50/70 to-white px-3 py-2.5">
      <Sparkles aria-hidden className="pointer-events-none absolute -right-1 -top-1 h-14 w-14 text-emerald-200/50" />
      <div className="relative flex items-center gap-3">
        <span className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-emerald-400 to-teal-500 text-white shadow-md shadow-emerald-500/25">
          <PhoneCall className="h-4 w-4" />
          <span className="absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-white ring-2 ring-emerald-50">
            <Check className="h-2.5 w-2.5 text-emerald-600" strokeWidth={3} />
          </span>
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold text-emerald-900">Guest allowed WhatsApp calls</p>
          <p className="text-[11px] text-emerald-700/80">
            {at ? `Tapped Allow ${when(at)}` : 'Allowed on this number'}
            {reminders > 0 ? ` · after ${reminders} reminder${reminders === 1 ? '' : 's'}` : snap.journey ? ' · on the first request' : ''}
          </p>
        </div>
        <span className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
          reg.ok ? 'border-violet-200 bg-white/80 text-violet-700' : 'border-amber-200 bg-amber-50 text-amber-700'}`}
          title={snap.journey?.registration.detail}>
          {reg.ok && (
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-violet-400 opacity-60" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-violet-500" />
            </span>
          )}
          <Bot className="h-3 w-3" /> {reg.label}
        </span>
      </div>
    </div>
  )
}

// ── Activity: daily plans + AI calls ─────────────────────────────────────────

type ActDay = GuestActivity['days'][number]
type Mood = 'positive' | 'neutral' | 'negative'

const fmtDay = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })

function moodKind(s: string | null | undefined): Mood | null {
  const v = (s ?? '').toLowerCase()
  if (!v) return null
  if (/pos|happy|good|great/.test(v)) return 'positive'
  if (/neg|bad|unhappy|angry|poor/.test(v)) return 'negative'
  return 'neutral'
}

const MOOD: Record<Mood, { icon: typeof Smile; label: string; cls: string; bar: string }> = {
  positive: { icon: Smile, label: 'Happy', cls: 'text-emerald-600 bg-emerald-50 border-emerald-200', bar: 'from-emerald-400 to-emerald-500' },
  neutral: { icon: Meh, label: 'Okay', cls: 'text-amber-600 bg-amber-50 border-amber-200', bar: 'from-amber-300 to-amber-400' },
  negative: { icon: Frown, label: 'Unhappy', cls: 'text-rose-600 bg-rose-50 border-rose-200', bar: 'from-rose-400 to-rose-500' },
}

function Ring({ value, max, color }: { value: number; max: number; color: string }) {
  const r = 13
  const c = 2 * Math.PI * r
  const pct = max > 0 ? Math.min(1, value / max) : 0
  return (
    <svg viewBox="0 0 32 32" className="h-8 w-8 shrink-0 -rotate-90">
      <circle cx="16" cy="16" r={r} fill="none" strokeWidth="3.5" className="stroke-slate-100" />
      <circle cx="16" cy="16" r={r} fill="none" strokeWidth="3.5" strokeLinecap="round"
        className={`${color} transition-all duration-700`} strokeDasharray={c} strokeDashoffset={c * (1 - pct)} />
    </svg>
  )
}

function StatTile({ ring, title, value, sub, dim }: { ring: ReactNode; title: string; value: string; sub: string; dim?: boolean }) {
  return (
    <div className={`flex min-w-0 items-center gap-2 rounded-xl border border-slate-100 bg-white px-2.5 py-1.5 shadow-[0_1px_2px_rgba(15,23,42,0.04)] ${dim ? 'opacity-50' : ''}`}>
      {ring}
      <div className="min-w-0">
        <p className="text-[9.5px] font-semibold uppercase tracking-wider text-slate-400">{title}</p>
        <p className="truncate text-[13px] font-bold leading-tight text-slate-800">{value}</p>
        <p className="truncate text-[10px] leading-tight text-slate-500">{sub}</p>
      </div>
    </div>
  )
}

const PLAN_LOOK: Record<ActDay['plan']['state'], { cls: string; Icon: typeof Check; tip: string }> = {
  read: { cls: 'bg-sky-500 text-white shadow-sm shadow-sky-500/30', Icon: CheckCheck, tip: 'Read by the guest' },
  delivered: { cls: 'bg-slate-600 text-white', Icon: CheckCheck, tip: 'Delivered' },
  sent: { cls: 'bg-slate-300 text-white', Icon: Check, tip: 'Sent' },
  failed: { cls: 'bg-rose-500 text-white', Icon: AlertTriangle, tip: 'Failed to deliver' },
  missed: { cls: 'border border-dashed border-rose-200 bg-rose-50 text-rose-300', Icon: XCircle, tip: 'No plan went out for this day' },
  today: { cls: 'bg-amber-400 text-white ring-4 ring-amber-100 animate-pulse', Icon: Clock, tip: 'Due today' },
  upcoming: { cls: 'border border-dashed border-slate-200 text-slate-300', Icon: MessageCircle, tip: 'Upcoming' },
}

function PlanCell({ d }: { d: ActDay }) {
  const look = PLAN_LOOK[d.plan.state]
  const at = d.plan.at ? ` · ${when(d.plan.at)}` : ''
  return (
    <span title={`Day ${d.dayNo} plan — ${look.tip}${at}`}
      className={`flex h-6 w-6 items-center justify-center rounded-full transition hover:scale-110 ${look.cls}`}>
      <look.Icon className="h-3 w-3" />
    </span>
  )
}

function CallCell({ d }: { d: ActDay }) {
  const c = d.call
  const mood = moodKind(c.sentiment)
  const at = c.at ? ` · ${when(c.at)}` : ''
  let cls = ''
  let Icon: typeof Check = Bot
  let tip = ''
  switch (c.state) {
    case 'answered':
      cls = `bg-gradient-to-br ${mood ? MOOD[mood].bar : 'from-violet-400 to-violet-500'} text-white shadow-sm`
      Icon = PhoneIncoming
      tip = `Answered${mood ? ` · ${MOOD[mood].label}` : ''}${at}${c.summary ? `\n${c.summary.slice(0, 200)}` : ''}`
      break
    case 'missed':
      cls = 'bg-rose-500 text-white'; Icon = PhoneMissed
      tip = `Not answered${c.attempts > 1 ? ` · ${c.attempts} tries` : ''}${at}`
      break
    case 'calling':
      cls = 'bg-violet-500 text-white ring-4 ring-violet-100 animate-pulse'; Icon = PhoneCall; tip = 'Calling now'
      break
    case 'scheduled':
      cls = 'border border-violet-200 bg-violet-50 text-violet-500'; Icon = Clock; tip = `Scheduled${at}`
      break
    case 'none':
      cls = 'bg-slate-50 text-slate-300'; Icon = XCircle; tip = 'No call this day'
      break
    default:
      cls = 'border border-dashed border-slate-200 text-slate-300'; Icon = Bot; tip = 'Upcoming'
  }
  return (
    <span title={`Day ${d.dayNo} AI call — ${tip}`}
      className={`flex h-6 w-6 items-center justify-center rounded-full transition hover:scale-110 ${cls}`}>
      <Icon className={c.state === 'none' ? 'h-2.5 w-2.5' : 'h-3 w-3'} />
    </span>
  )
}

function ActivityPanel({ a, messagesOn, callsOn }: { a: GuestActivity; messagesOn: boolean; callsOn: boolean }) {
  const plansDue = Math.max(a.days.filter(d => d.date <= a.today).length, a.stats.plansSent)
  const mood = a.stats.mood
  const MoodIcon = mood ? MOOD[mood].icon : Meh
  const showCalls = a.callsAvailable
  const lastMood = moodKind(a.lastCall?.sentiment)
  const LastMoodIcon = lastMood ? MOOD[lastMood].icon : null

  return (
    <div className="mt-3 space-y-2.5">
      {/* Stat tiles */}
      <div className={`grid gap-2 ${showCalls ? 'grid-cols-1 sm:grid-cols-3' : 'grid-cols-1 sm:grid-cols-2'}`}>
        <StatTile dim={!messagesOn}
          ring={<Ring value={a.stats.plansSent} max={Math.max(plansDue, 1)} color="stroke-sky-500" />}
          title="Daily plans" value={`${a.stats.plansSent}/${plansDue} sent`}
          sub={a.stats.plansFailed ? `${a.stats.plansFailed} failed · ${a.stats.plansRead} read` : `${a.stats.plansRead} read by guest`} />
        {showCalls && (
          <StatTile dim={!callsOn}
            ring={<Ring value={a.stats.callsAnswered} max={Math.max(a.stats.callsDue, 1)} color="stroke-violet-500" />}
            title="AI calls" value={`${a.stats.callsAnswered}/${a.stats.callsDue} answered`}
            sub={a.stats.callsDue ? `${a.stats.callsDue - a.stats.callsAnswered} not reached` : 'none due yet'} />
        )}
        {showCalls && (
          <div className={`flex min-w-0 items-center gap-2 rounded-xl border px-2.5 py-1.5 ${mood ? MOOD[mood].cls : 'border-slate-100 bg-white text-slate-300'}`}>
            <MoodIcon className="h-7 w-7 shrink-0" />
            <div className="min-w-0">
              <p className="text-[9.5px] font-semibold uppercase tracking-wider opacity-70">Guest mood</p>
              <p className="truncate text-[13px] font-bold leading-tight">{mood ? MOOD[mood].label : '—'}</p>
              <p className="truncate text-[10px] leading-tight opacity-70">{mood ? 'from the last call' : 'no call yet'}</p>
            </div>
          </div>
        )}
      </div>

      {/* Day-by-day timeline */}
      <div className="rounded-xl border border-slate-100 bg-white/80 p-2">
        <div className="flex items-stretch gap-1 overflow-x-auto pb-0.5">
          <div className="sticky left-0 z-10 flex shrink-0 flex-col justify-end gap-1.5 bg-white/95 pb-1 pr-1.5 text-[9.5px] font-semibold text-slate-400">
            <span className="flex h-6 items-center gap-1"><MessageCircle className="h-3 w-3 text-sky-500" />Plan</span>
            {showCalls && <span className="flex h-6 items-center gap-1"><Bot className="h-3 w-3 text-violet-500" />Call</span>}
          </div>
          {a.days.map(d => {
            const isToday = d.date === a.today
            return (
              <div key={d.date}
                className={`flex min-w-[38px] flex-1 flex-col items-center gap-1.5 rounded-lg px-0.5 pb-1 pt-0.5 ${isToday ? 'bg-amber-50 ring-1 ring-amber-200' : ''}`}>
                <div className="text-center leading-none">
                  <p className={`text-[9.5px] font-bold ${isToday ? 'text-amber-700' : 'text-slate-600'}`}>D{d.dayNo}</p>
                  <p className="text-[8.5px] text-slate-400">{isToday ? 'Today' : fmtDay(d.date)}</p>
                </div>
                <PlanCell d={d} />
                {showCalls && <CallCell d={d} />}
              </div>
            )
          })}
        </div>
        {a.extras.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1 border-t border-slate-100 pt-1.5">
            {a.extras.map((x, i) => (
              <span key={i} title={x.summary ?? undefined}
                className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium ${
                  x.state === 'answered' ? 'border-violet-200 bg-violet-50 text-violet-700'
                  : x.state === 'missed' ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-slate-200 bg-slate-50 text-slate-500'}`}>
                <CalendarDays className="h-3 w-3" /> {x.phase} · {fmtDay(x.date)} · {x.state === 'answered' ? 'answered' : x.state === 'missed' ? 'missed' : x.state === 'calling' ? 'calling' : 'scheduled'}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Latest call — what the guest said */}
      {a.lastCall && (
        <div className="relative overflow-hidden rounded-xl border border-violet-100 bg-gradient-to-br from-violet-50/80 via-white to-white p-2.5 pl-3.5">
          <span aria-hidden className={`absolute inset-y-0 left-0 w-1 bg-gradient-to-b ${lastMood ? MOOD[lastMood].bar : 'from-violet-400 to-violet-500'}`} />
          <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-violet-600">
            <Quote className="h-3 w-3" /> Last AI call{a.lastCall.dayNo ? ` · Day ${a.lastCall.dayNo}` : ''} · {fmtDay(a.lastCall.date)}
            {lastMood && LastMoodIcon && (
              <span className={`ml-auto inline-flex items-center gap-1 rounded-full border px-1.5 py-px normal-case tracking-normal ${MOOD[lastMood].cls}`}>
                <LastMoodIcon className="h-3 w-3" />{MOOD[lastMood].label}
              </span>
            )}
          </div>
          <p className="mt-1 line-clamp-3 text-[12px] leading-snug text-slate-700" title={a.lastCall.summary}>{a.lastCall.summary}</p>
          {a.lastCall.issues && (
            <p className="mt-1 flex items-start gap-1 text-[11px] text-rose-600">
              <AlertTriangle className="mt-px h-3 w-3 shrink-0" /><span className="line-clamp-2">{a.lastCall.issues}</span>
            </p>
          )}
        </div>
      )}
    </div>
  )
}
