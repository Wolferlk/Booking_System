'use client'

/**
 * Guest-communication columns on the Operations Board:
 *   Tickets Sent · Driver Details · CS Calls D1·D2·D3
 * plus the strip that runs the daily 14:30 ticket WhatsApp, and the panel in a
 * row's drill-down that previews / sends one booking's tickets.
 *
 * Data comes from the board fetch (`ticketSends`, `driverBrief`, `guestCalls`
 * on each row); only the strip and the send button call their own API.
 */
import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Ticket, Send, Loader2, Truck, Clock, CheckCheck, AlertTriangle, PhoneCall,
  PhoneMissed, PhoneOff, BellOff, Link2, Eye, RefreshCw, Zap, MessageSquare, Smile, Frown, Meh,
} from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import type { OpsDayRow } from '@/lib/reports/ops-day-data'
import type { CallDay } from '@/lib/reports/ops-guest-comms'

// ── Shared ────────────────────────────────────────────────────────────────────

/** Re-renders every 30 s so countdowns move without refetching the board. */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(t)
  }, [intervalMs])
  return now
}

function countdown(ms: number): string {
  const m = Math.max(0, Math.round(ms / 60_000))
  if (m < 1) return 'now'
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  const r = m % 60
  return r ? `${h}h ${r}m` : `${h}h`
}

function clock(iso: string | null, tz?: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: tz ?? undefined })
}

function shortDay(ymd: string | null): string {
  if (!ymd) return ''
  return new Date(`${ymd}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
}

const CHIP = {
  done:    'bg-emerald-50 text-emerald-700 border-emerald-200',
  partial: 'bg-amber-50 text-amber-700 border-amber-200',
  wait:    'bg-sky-50 text-sky-700 border-sky-200',
  live:    'bg-violet-50 text-violet-700 border-violet-200',
  bad:     'bg-rose-50 text-rose-700 border-rose-200',
  muted:   'bg-slate-50 text-slate-400 border-slate-200',
} as const

function Chip({ tone, icon: Icon, children, title, pulse }: {
  tone: keyof typeof CHIP; icon: typeof Ticket; children: React.ReactNode; title?: string; pulse?: boolean
}) {
  return (
    <span title={title} className={cn(
      'relative inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] font-semibold whitespace-nowrap',
      CHIP[tone],
    )}>
      {pulse && (
        <span className="absolute -right-0.5 -top-0.5 flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-violet-400 opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-violet-500" />
        </span>
      )}
      <Icon className="w-3 h-3 flex-shrink-0" strokeWidth={2.5} />
      {children}
    </span>
  )
}

// ── Tickets Sent ──────────────────────────────────────────────────────────────

export function TicketSentCell({ r, nextAt, now }: { r: OpsDayRow; nextAt: string | null; now: number }) {
  const t = r.ticketSends
  if (r.cancelled || (t.issued === 0 && t.notIssued === 0)) {
    return <span className="text-[11px] text-slate-300">—</span>
  }
  const waiting = t.issued - t.sent
  if (t.issued === 0) {
    return (
      <Chip tone="muted" icon={Ticket} title={`${t.notIssued} ticket(s) on the file, none issued yet — nothing to send`}>
        0 issued
      </Chip>
    )
  }
  if (waiting === 0) {
    return (
      <Chip
        tone={t.linksOnly ? 'partial' : 'done'}
        icon={t.linksOnly ? Link2 : CheckCheck}
        title={
          `All ${t.issued} issued ticket(s) sent to the guest${t.lastSentAt ? ` · last ${new Date(t.lastSentAt).toLocaleString('en-GB')}` : ''}` +
          (t.linksOnly ? '\nSent as download links — the guest was outside the 24h WhatsApp window.' : '') +
          (t.notIssued ? `\n${t.notIssued} more not issued yet — they go out once issued.` : '')
        }
      >
        {t.sent}/{t.issued + t.notIssued} sent
      </Chip>
    )
  }
  const eta = nextAt ? Date.parse(nextAt) - now : null
  return (
    <Chip
      tone={t.sent ? 'partial' : 'wait'}
      icon={Clock}
      title={`${waiting} issued ticket(s) waiting · the daily ticket WhatsApp sends them${nextAt ? ` at ${clock(nextAt, 'Asia/Colombo')} Colombo` : ''}. Open the row to send now.`}
    >
      {t.sent}/{t.issued} · {eta != null && eta > 0 ? `in ${countdown(eta)}` : 'due'}
    </Chip>
  )
}

// ── Driver Details (daily plan) ───────────────────────────────────────────────

export function DriverBriefCell({ r, now }: { r: OpsDayRow; now: number }) {
  const b = r.driverBrief
  const cover = b.movements ? ` · driver ${b.withDriver}/${b.movements}` : ''
  const where = b.time && b.tz ? `${b.time} ${b.tz.split('/')[1]?.replace('_', ' ')}` : ''
  const about = b.target ? `Plan for ${shortDay(b.target)}` : ''
  switch (b.state) {
    case 'sent':
      return (
        <Chip tone="done" icon={CheckCheck}
          title={`${about} sent ${new Date(b.at!).toLocaleString('en-GB')}${cover}`}>
          Sent {clock(b.at, b.tz)}
        </Chip>
      )
    case 'scheduled': {
      const ms = Date.parse(b.at!) - now
      const soon = ms <= 60 * 60_000
      return (
        <Chip tone={b.hint ? 'partial' : soon ? 'live' : 'wait'} icon={soon ? Zap : Clock} pulse={soon && !b.hint}
          title={`${about} goes out at ${where}${cover}${b.hint ? `\n⚠ ${b.hint}` : ''}`}>
          {ms > 0 ? `in ${countdown(ms)}` : 'now'}
        </Chip>
      )
    }
    case 'sending':
      return (
        <Chip tone="live" icon={Send} pulse title={`${about} — the 5-minute sweep is sending it now${cover}`}>
          Sending…
        </Chip>
      )
    case 'missed':
      return (
        <Chip tone="bad" icon={AlertTriangle}
          title={`${about} was due ${clock(b.at, b.tz)} (${where}) and has not gone out${b.hint ? `\n${b.hint}` : '\nCheck the Customer WhatsApp panel on the booking.'}`}>
          Not sent
        </Chip>
      )
    case 'off':
      return <Chip tone="muted" icon={BellOff} title={b.hint ?? 'Auto-send off'}>Off</Chip>
    default:
      return <span className="text-[11px] text-slate-300" title={b.hint ?? ''}>—</span>
  }
}

// ── CS Calls D1 · D2 · D3 ─────────────────────────────────────────────────────

const DAY_DOT: Record<CallDay['state'], string> = {
  done:      'bg-emerald-500 text-white border-emerald-500',
  missed:    'bg-rose-500 text-white border-rose-500',
  scheduled: 'bg-sky-100 text-sky-700 border-sky-300',
  upcoming:  'bg-white text-slate-400 border-dashed border-slate-300',
  none:      'bg-amber-50 text-amber-700 border-amber-300',
  na:        'bg-slate-50 text-slate-300 border-slate-200',
}

function dayTitle(d: CallDay): string {
  const what =
    d.state === 'done' ? 'Called — connected'
      : d.state === 'missed' ? 'Called — no answer / failed'
        : d.state === 'scheduled' ? 'AI call scheduled'
          : d.state === 'upcoming' ? 'Not yet — day still ahead'
            : d.state === 'none' ? 'No call made'
              : 'Not a tour day'
  return [
    `Day ${d.day} · ${shortDay(d.date)} — ${what}`,
    d.aiStatus ? `AI call: ${d.aiStatus}${d.attempts ? ` (${d.attempts} attempt${d.attempts === 1 ? '' : 's'})` : ''}` : null,
    d.sentiment ? `Guest mood: ${d.sentiment}` : null,
    d.manual ? `${d.manual} phone call(s) logged by the desk` : null,
  ].filter(Boolean).join('\n')
}

export function CallsCell({ r }: { r: OpsDayRow }) {
  const c = r.guestCalls
  if (r.cancelled || !c.days.length || c.days.every((d) => d.state === 'na')) {
    return <span className="text-[11px] text-slate-300">—</span>
  }
  return (
    <div className="flex items-center gap-1.5" title={c.available ? undefined : 'AI-call data unavailable on this server — showing desk-logged calls only'}>
      {c.days.map((d) => (
        <span key={d.day} title={dayTitle(d)}
          className={cn(
            'relative inline-flex h-6 w-7 items-center justify-center rounded-md border text-[10px] font-bold tabular-nums transition-transform hover:scale-110',
            DAY_DOT[d.state],
          )}>
          D{d.day}
          {d.manual + (d.aiStatus ? 1 : 0) > 1 && (
            <span className="absolute -right-1 -top-1 rounded-full bg-slate-900 px-1 text-[8px] leading-3 text-white">
              {d.manual + (d.aiStatus ? 1 : 0)}
            </span>
          )}
        </span>
      ))}
      {c.due > 0 && (
        <span className={cn('ml-0.5 text-[10px] font-semibold tabular-nums',
          c.done === c.due ? 'text-emerald-600' : 'text-slate-400')}>
          {c.done}/{c.due}
        </span>
      )}
    </div>
  )
}

// ── Daily ticket WhatsApp strip ───────────────────────────────────────────────

interface SendsConfig {
  enabled: boolean; time: string; since: string; lastRunDate: string | null
  tz: string; nextAt: string; canConfigure: boolean
}

export function useTicketSendsConfig(): [SendsConfig | null, (c: SendsConfig) => void] {
  const [cfg, setCfg] = useState<SendsConfig | null>(null)
  useEffect(() => {
    fetch('/api/accounts/report/ticket-sends')
      .then((r) => r.json())
      .then((j) => { if (j?.success) setCfg(j.data) })
      .catch(() => {})
  }, [])
  return [cfg, setCfg]
}

export function GuestCommsStrip({ cfg, onCfg, rows, now }: {
  cfg: SendsConfig | null; onCfg: (c: SendsConfig) => void; rows: OpsDayRow[]; now: number
}) {
  const [busy, setBusy] = useState(false)
  const live = rows.filter((r) => !r.cancelled)
  const ticketsWaiting = live.reduce((s, r) => s + Math.max(0, r.ticketSends.issued - r.ticketSends.sent), 0)
  const ticketsSent = live.reduce((s, r) => s + r.ticketSends.sent, 0)
  const briefs = live.filter((r) => r.driverBrief.state !== 'na' && r.driverBrief.state !== 'off')
  const briefsSent = briefs.filter((r) => r.driverBrief.state === 'sent').length
  const briefsMissed = briefs.filter((r) => r.driverBrief.state === 'missed').length
  const nextBrief = briefs
    .filter((r) => r.driverBrief.state === 'scheduled' && r.driverBrief.at)
    .map((r) => Date.parse(r.driverBrief.at!))
    .sort((a, b) => a - b)[0]
  const callDue = live.reduce((s, r) => s + r.guestCalls.due, 0)
  const callDone = live.reduce((s, r) => s + r.guestCalls.done, 0)

  const save = async (patch: Record<string, unknown>) => {
    setBusy(true)
    try {
      const res = await fetch('/api/accounts/report/ticket-sends', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch),
      })
      const j = await res.json()
      if (!j.success) toast.error(j.error ?? 'Could not save')
      else { onCfg(j.data); toast.success(j.message ?? 'Saved') }
    } catch { toast.error('Network error') } finally { setBusy(false) }
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
      {/* Tickets */}
      <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-gradient-to-br from-white to-emerald-50/60 p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-600 text-white"><Ticket className="h-4 w-4" /></span>
            <div>
              <p className="text-xs font-bold text-slate-900">Tickets → guest WhatsApp</p>
              <p className="text-[11px] text-slate-500">
                {cfg ? <>Daily at <strong>{cfg.time}</strong> Colombo · {cfg.enabled ? `next ${new Date(cfg.nextAt).toLocaleString('en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Colombo' })}` : 'switched off'}</> : 'Loading…'}
              </p>
            </div>
          </div>
          {cfg?.canConfigure && (
            <button role="switch" aria-checked={cfg.enabled} disabled={busy}
              onClick={() => void save({ action: 'toggle', enabled: !cfg.enabled })}
              className={cn('relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50',
                cfg.enabled ? 'bg-emerald-500' : 'bg-slate-300')}>
              <span className={cn('inline-block h-4 w-4 rounded-full bg-white shadow transition-transform',
                cfg.enabled ? 'translate-x-6' : 'translate-x-1')} />
            </button>
          )}
        </div>
        <div className="mt-3 flex items-end gap-4">
          <div><p className="text-2xl font-black tabular-nums text-emerald-700">{ticketsSent}</p><p className="text-[10px] uppercase tracking-wide text-slate-400">sent</p></div>
          <div><p className={cn('text-2xl font-black tabular-nums', ticketsWaiting ? 'text-sky-700' : 'text-slate-300')}>{ticketsWaiting}</p><p className="text-[10px] uppercase tracking-wide text-slate-400">waiting</p></div>
          {cfg?.enabled && ticketsWaiting > 0 && (
            <p className="ml-auto text-[11px] font-semibold text-sky-700">goes out in {countdown(Date.parse(cfg.nextAt) - now)}</p>
          )}
        </div>
        {cfg?.canConfigure && (
          <label className="mt-2 flex items-center gap-1.5 text-[11px] text-slate-500">
            Send time
            <input type="time" defaultValue={cfg.time} disabled={busy}
              onBlur={(e) => e.target.value && e.target.value !== cfg.time && void save({ action: 'time', time: e.target.value })}
              className="rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[11px]" />
            <span className="text-slate-400">· only tickets issued after {new Date(cfg.since).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} go automatically</span>
          </label>
        )}
      </div>

      {/* Driver details */}
      <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-gradient-to-br from-white to-violet-50/60 p-4">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-violet-600 text-white"><Truck className="h-4 w-4" /></span>
          <div>
            <p className="text-xs font-bold text-slate-900">Driver details (daily plan)</p>
            <p className="text-[11px] text-slate-500">
              {nextBrief ? <>Next batch in <strong className="text-violet-700">{countdown(nextBrief - now)}</strong></> : 'No more sends scheduled today'}
            </p>
          </div>
        </div>
        <div className="mt-3 flex items-end gap-4">
          <div><p className="text-2xl font-black tabular-nums text-violet-700">{briefsSent}<span className="text-sm text-slate-300">/{briefs.length}</span></p><p className="text-[10px] uppercase tracking-wide text-slate-400">sent</p></div>
          <div><p className={cn('text-2xl font-black tabular-nums', briefsMissed ? 'text-rose-600' : 'text-slate-300')}>{briefsMissed}</p><p className="text-[10px] uppercase tracking-wide text-slate-400">not sent</p></div>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100">
          <motion.div className="h-full bg-violet-500" initial={{ width: 0 }}
            animate={{ width: `${briefs.length ? (briefsSent / briefs.length) * 100 : 0}%` }} transition={{ duration: 0.6 }} />
        </div>
      </div>

      {/* Calls */}
      <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-gradient-to-br from-white to-sky-50/60 p-4">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-sky-600 text-white"><PhoneCall className="h-4 w-4" /></span>
          <div>
            <p className="text-xs font-bold text-slate-900">Client-service calls D1 · D2 · D3</p>
            <p className="text-[11px] text-slate-500">AI on-tour calls + calls logged by the desk</p>
          </div>
        </div>
        <div className="mt-3 flex items-end gap-4">
          <div><p className="text-2xl font-black tabular-nums text-sky-700">{callDone}<span className="text-sm text-slate-300">/{callDue}</span></p><p className="text-[10px] uppercase tracking-wide text-slate-400">tour days called</p></div>
          <div className="ml-auto flex items-center gap-1 text-[10px] text-slate-500">
            {(['done', 'missed', 'none', 'scheduled'] as const).map((s) => (
              <span key={s} className="inline-flex items-center gap-1">
                <span className={cn('h-2.5 w-2.5 rounded-sm border', DAY_DOT[s])} />
                {s === 'done' ? 'called' : s === 'none' ? 'not called' : s}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Drill-down panel ──────────────────────────────────────────────────────────

export function GuestCommsPanel({ r, onSent }: { r: OpsDayRow; onSent: () => void }) {
  const [preview, setPreview] = useState<{ message: string; sent: number; files: number; mode?: string } | null>(null)
  const [busy, setBusy] = useState<null | 'preview' | 'send' | 'resend'>(null)
  const t = r.ticketSends
  const waiting = t.issued - t.sent

  const call = async (action: 'preview' | 'send', force = false) => {
    setBusy(action === 'send' && force ? 'resend' : action)
    try {
      const res = await fetch('/api/accounts/report/ticket-sends', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, bookingRef: r.bookingRef, force }),
      })
      const j = await res.json()
      if (!j.success) { toast.error(j.error ?? 'Nothing to send'); return }
      if (action === 'preview') setPreview(j.data)
      else { toast.success(j.message ?? 'Sent'); setPreview(null); onSent() }
    } catch { toast.error('Network error') } finally { setBusy(null) }
  }

  const send = (force: boolean) => {
    if (!window.confirm(`Send ${force ? 'ALL issued tickets again' : `${waiting} ticket(s)`} to the guest of ${r.bookingRef} on WhatsApp now?`)) return
    void call('send', force)
  }

  const mood = (s: string | null) => {
    const v = (s ?? '').toLowerCase()
    return v.includes('pos') || v.includes('good') ? Smile : v.includes('neg') || v.includes('bad') ? Frown : Meh
  }

  return (
    <div className="space-y-3">
      <h4 className="text-[10px] font-bold uppercase tracking-wide text-slate-400 flex items-center gap-1.5">
        <MessageSquare className="w-3 h-3" /> Guest comms
      </h4>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3 items-start">
      {/* Tickets */}
      <div className="rounded-xl border border-slate-200 bg-white p-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] font-semibold text-slate-700 flex items-center gap-1.5">
            <Ticket className="w-3.5 h-3.5 text-emerald-600" />
            Tickets sent {t.sent}/{t.issued}
            {t.notIssued > 0 && <span className="font-normal text-slate-400">· {t.notIssued} not issued</span>}
          </p>
          <div className="flex items-center gap-1.5">
            <button type="button" disabled={!!busy || t.issued === 0} onClick={() => void call('preview', waiting === 0)}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-40">
              {busy === 'preview' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Eye className="w-3 h-3" />} Preview
            </button>
            {waiting > 0 ? (
              <button type="button" disabled={!!busy} onClick={() => send(false)}
                className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">
                {busy === 'send' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />} Send now
              </button>
            ) : t.issued > 0 && (
              <button type="button" disabled={!!busy} onClick={() => send(true)}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50">
                {busy === 'resend' ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />} Resend all
              </button>
            )}
          </div>
        </div>
        <AnimatePresence>
          {preview && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden">
              <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap rounded-lg bg-[#e7ffdb] p-2.5 font-sans text-[11px] leading-relaxed text-slate-800">
                {preview.message}
              </pre>
              <p className="mt-1 text-[10px] text-slate-400">
                {preview.sent} ticket(s), {preview.files} file(s) ·{' '}
                {preview.mode === 'links' ? 'guest is outside the 24h window — files go as download links' : 'files follow as photos / PDFs'}
              </p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Driver details */}
      <div className="rounded-xl border border-slate-200 bg-white p-3 text-[11px] text-slate-600">
        <p className="font-semibold text-slate-700 flex items-center gap-1.5">
          <Truck className="w-3.5 h-3.5 text-violet-600" /> Driver details
          <span className="ml-auto"><DriverBriefCell r={r} now={Date.now()} /></span>
        </p>
        {r.driverBrief.target && (
          <p className="mt-1">
            Plan for {shortDay(r.driverBrief.target)} · {r.driverBrief.time} {r.driverBrief.tz}
            {r.driverBrief.movements > 0 && <> · driver on {r.driverBrief.withDriver}/{r.driverBrief.movements} movements</>}
          </p>
        )}
        {r.driverBrief.hint && <p className="mt-1 text-amber-700">⚠ {r.driverBrief.hint}</p>}
      </div>

      {/* Calls */}
      {r.guestCalls.days.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white p-3">
          <p className="text-[11px] font-semibold text-slate-700 flex items-center gap-1.5">
            <PhoneCall className="w-3.5 h-3.5 text-sky-600" /> Client-service calls
          </p>
          <ul className="mt-1.5 space-y-1">
            {r.guestCalls.days.filter((d) => d.state !== 'na').map((d) => {
              const Mood = mood(d.sentiment)
              const Icon = d.state === 'done' ? PhoneCall : d.state === 'missed' ? PhoneMissed : d.state === 'none' ? PhoneOff : Clock
              return (
                <li key={d.day} className="flex items-center gap-2 text-[11px] text-slate-600">
                  <span className={cn('inline-flex h-5 w-7 items-center justify-center rounded border text-[10px] font-bold', DAY_DOT[d.state])}>D{d.day}</span>
                  <Icon className="w-3 h-3 text-slate-400" />
                  <span>{shortDay(d.date)}</span>
                  <span className="text-slate-400">
                    {d.aiStatus ? `AI ${d.aiStatus}${d.attempts > 1 ? ` ×${d.attempts}` : ''}` : 'no AI call'}
                    {d.manual ? ` · ${d.manual} desk call${d.manual === 1 ? '' : 's'}` : ''}
                  </span>
                  {d.sentiment && <Mood className="ml-auto w-3.5 h-3.5 text-slate-500" />}
                </li>
              )
            })}
          </ul>
        </div>
      )}
      </div>
    </div>
  )
}
