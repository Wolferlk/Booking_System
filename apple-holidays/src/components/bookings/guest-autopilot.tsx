'use client'

/**
 * Guest Autopilot — what the system does on its own with the guest's WhatsApp.
 *
 *   ┌ Auto messages ●━━ ┐  ┌ Auto AI calls ●━━ ┐      ← switches (OFF needs an emailed code)
 *   Assigned ─ Allow request ─ Reminder 1 ─ Reminder 2 ─ Allowed   ← the approval journey
 *
 * Server side: /api/bookings/[ref]/guest-automation (lib/guest-automation.ts).
 */
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import {
  Zap, MessageCircle, Bot, Lock, ShieldCheck, Check, Send, Bell, PhoneCall, Hourglass,
  XCircle, RotateCw, Loader2, UserPlus,
} from 'lucide-react'
import VerificationModal, { type VerificationCredentials } from '@/components/security/verification-modal'

type Kind = 'messages' | 'calls'

interface Snapshot {
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
