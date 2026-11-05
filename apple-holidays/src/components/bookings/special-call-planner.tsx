'use client'

// On-demand Reconfirmation / Post-tour calls for the AI Voice Calls panel.
//
// The automatic plan places ONE call N days before arrival / after departure.
// That doesn't fit a last-minute booking (arrival tomorrow, trip already under
// way, feedback date already gone), so staff can also:
//   • Call now            — rings straight away
//   • Schedule exact time — pins the call to a date + time
// Each on-demand call is its own schedule row on the TE service (POST
// services/:ref/special-calls), so the agent runs the same playbook and what it
// captures is saved as the booking's real reconfirmation / feedback.

import { useMemo, useState } from 'react'
import {
  PhoneCall, CalendarClock, Loader2, X, AlertCircle, Sparkles, Clock,
  StickyNote, CheckCircle2, PhoneMissed, Zap,
} from 'lucide-react'
import { toast } from 'sonner'

export type SpecialKind = 'reconfirm' | 'post_tour'
export type WhenMode = 'auto' | 'exact' | 'now'
export interface WhenDraft { mode: WhenMode; at: string; note: string }

export interface SpecialScheduleItem {
  id: number
  day_no: number
  call_date: string
  scheduled_at?: string | null
  phase?: string | null
  day_brief?: string | null
  status: string
  attempts: number
  conversation_id?: string | null
  error?: string | null
}

export interface CallWindowConfig {
  call_window?: { start: number; end: number }
  tz_offset_min?: number
  on_demand_special_calls?: boolean
}

type Api = (path: string, method?: string, body?: unknown) => Promise<Record<string, unknown>>

// Reserved schedule day_no slots (mirror of the TE API): the plan's own row, and
// the band each kind's on-demand calls live in.
export const PLAN_SLOT: Record<SpecialKind, number> = { reconfirm: 0, post_tour: 9999 }
const BANDS: Record<SpecialKind, [number, number]> = { reconfirm: [9100, 9499], post_tour: [9500, 9899] }
export function isOnDemand(item: { day_no: number; phase?: string | null }): boolean {
  const k = item.phase === 'reconfirm' || item.phase === 'post_tour' ? item.phase : null
  return !!k && item.day_no >= BANDS[k][0] && item.day_no <= BANDS[k][1]
}

const LABEL: Record<SpecialKind, string> = { reconfirm: 'reconfirmation', post_tour: 'post-tour feedback' }
const THEME: Record<SpecialKind, { btn: string; soft: string; ring: string; text: string }> = {
  reconfirm: { btn: 'bg-sky-600 hover:bg-sky-700', soft: 'bg-sky-50 border-sky-200', ring: 'focus:ring-sky-300', text: 'text-sky-700' },
  post_tour: { btn: 'bg-amber-600 hover:bg-amber-700', soft: 'bg-amber-50 border-amber-200', ring: 'focus:ring-amber-300', text: 'text-amber-700' },
}

// ─── Time helpers ────────────────────────────────────────────────────────────

function pad(n: number) { return String(n).padStart(2, '0') }
/** Browser-local yyyy-mm-ddThh:mm for a <input type="datetime-local">. */
export function toLocalInput(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
function todayYmd(): string { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` }
function ymdDiff(from?: string | null, to?: string | null): number | null {
  const a = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(from ?? '')); const b = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(to ?? ''))
  if (!a || !b) return null
  return Math.round((Date.UTC(+b[1], +b[2] - 1, +b[3]) - Date.UTC(+a[1], +a[2] - 1, +a[3])) / 86_400_000)
}
function atLocal(ymd: string, hh: number, mm = 0): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd)
  return m ? new Date(+m[1], +m[2] - 1, +m[3], hh, mm) : null
}
function fmtWhen(iso?: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const sameDay = d.toDateString() === new Date().toDateString()
  const tomorrow = d.toDateString() === new Date(Date.now() + 86_400_000).toDateString()
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  if (sameDay) return `Today ${time}`
  if (tomorrow) return `Tomorrow ${time}`
  return `${d.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short' })}, ${time}`
}
function relative(iso: string): string {
  const mins = Math.round((new Date(iso).getTime() - Date.now()) / 60_000)
  if (Math.abs(mins) < 1) return 'now'
  const abs = Math.abs(mins)
  const span = abs < 60 ? `${abs} min` : abs < 1440 ? `${Math.round(abs / 60)} h` : `${Math.round(abs / 1440)} d`
  return mins > 0 ? `in ${span}` : `${span} ago`
}

/** Where a call instant falls against the TE call window (evaluated in the TE timezone). */
export function windowCheck(at: Date, cfg?: CallWindowConfig | null): { inWindow: boolean; text?: string } {
  const w = cfg?.call_window
  if (!w) return { inWindow: true }
  const tz = cfg?.tz_offset_min ?? 330
  const h = new Date(at.getTime() + tz * 60_000).getUTCHours()
  if (h >= w.start && h < w.end) return { inWindow: true }
  return { inWindow: false, text: `Outside the call window (${pad(w.start)}:00–${pad(w.end)}:00) — it will ring when the window next opens.` }
}

// ─── Last-minute intelligence ────────────────────────────────────────────────

export interface TimingAdvice { level: 'tight' | 'late' | 'past'; title: string; text: string }

/** Why the automatic slot does / doesn't fit this booking right now. */
export function timingAdvice(kind: SpecialKind, opts: {
  arrival?: string | null; departure?: string | null; daysOffset: number; captured?: boolean
}): TimingAdvice | null {
  const today = todayYmd()
  if (kind === 'reconfirm') {
    const toArrival = ymdDiff(today, opts.arrival)
    if (toArrival == null) return null
    if (toArrival < 0) {
      return { level: 'past', title: 'Trip already under way', text: `Arrived ${-toArrival} day${toArrival === -1 ? '' : 's'} ago — no automatic reconfirmation is placed. Call now only if something still needs reconfirming.` }
    }
    if (toArrival < opts.daysOffset) {
      const when = toArrival === 0 ? 'today' : toArrival === 1 ? 'tomorrow' : `in ${toArrival} days`
      return { level: 'tight', title: 'Last-minute booking', text: `Arrival is ${when}, so the ${opts.daysOffset}-day slot has passed — the automatic call falls on today. Call now or pin an exact time.` }
    }
    return null
  }
  const sinceDeparture = ymdDiff(opts.departure, today)
  if (sinceDeparture == null || opts.captured) return null
  if (sinceDeparture > opts.daysOffset) {
    return { level: 'late', title: 'Feedback date has passed', text: `The trip ended ${sinceDeparture} days ago and the +${opts.daysOffset}-day call date is gone. Call now to collect their feedback.` }
  }
  return null
}

function AdviceBanner({ advice, kind }: { advice: TimingAdvice; kind: SpecialKind }) {
  const tone = advice.level === 'past' ? 'bg-slate-50 border-slate-200 text-slate-600' : 'bg-orange-50 border-orange-200 text-orange-800'
  return (
    <div className={`flex items-start gap-2 rounded-lg border px-2.5 py-2 ${tone}`}>
      <Sparkles className={`w-3.5 h-3.5 flex-shrink-0 mt-0.5 ${advice.level === 'past' ? 'text-slate-400' : THEME[kind].text}`} />
      <p className="text-[10px] leading-relaxed"><span className="font-bold">{advice.title}.</span> {advice.text}</p>
    </div>
  )
}

// ─── Exact-time picker with one-tap presets ──────────────────────────────────

export function WhenPicker({ kind, value, onChange, cfg, arrival, departure }: {
  kind: SpecialKind; value: string; onChange: (v: string) => void
  cfg?: CallWindowConfig | null; arrival?: string | null; departure?: string | null
}) {
  const presets = useMemo(() => {
    const now = new Date()
    const out: { label: string; at: Date }[] = []
    const in15 = new Date(now.getTime() + 15 * 60_000); in15.setMinutes(Math.ceil(in15.getMinutes() / 5) * 5, 0, 0)
    out.push({ label: 'In 15 min', at: in15 })
    const in1h = new Date(now.getTime() + 60 * 60_000); in1h.setSeconds(0, 0)
    out.push({ label: 'In 1 hour', at: in1h })
    const today17 = atLocal(todayYmd(), 17)
    if (today17 && today17.getTime() > now.getTime() + 10 * 60_000) out.push({ label: 'Today 17:00', at: today17 })
    const tmr = new Date(now.getTime() + 86_400_000)
    const tmr10 = atLocal(`${tmr.getFullYear()}-${pad(tmr.getMonth() + 1)}-${pad(tmr.getDate())}`, 10)
    if (tmr10) out.push({ label: 'Tomorrow 10:00', at: tmr10 })
    // Trip-anchored suggestion: the day before arrival / the day after they're home.
    if (kind === 'reconfirm' && arrival) {
      const d = atLocal(String(arrival).slice(0, 10), 10)
      if (d) { d.setDate(d.getDate() - 1); if (d.getTime() > now.getTime()) out.push({ label: 'Day before arrival 10:00', at: d }) }
    }
    if (kind === 'post_tour' && departure) {
      const d = atLocal(String(departure).slice(0, 10), 17)
      if (d) { d.setDate(d.getDate() + 1); if (d.getTime() > now.getTime()) out.push({ label: 'Day after return 17:00', at: d }) }
    }
    return out
  }, [kind, arrival, departure])

  const chosen = value ? new Date(value) : null
  const valid = chosen && !Number.isNaN(chosen.getTime())
  const inPast = valid && chosen!.getTime() < Date.now() - 60_000
  const win = valid ? windowCheck(chosen!, cfg) : { inWindow: true }
  const afterArrival = kind === 'reconfirm' && valid && arrival && ymdDiff(String(arrival).slice(0, 10), toLocalInput(chosen!).slice(0, 10))! > 0

  return (
    <div className="space-y-1.5">
      <input type="datetime-local" className={`form-input h-8 text-xs ${THEME[kind].ring}`} min={toLocalInput(new Date())}
        value={value} onChange={e => onChange(e.target.value)} />
      <div className="flex flex-wrap gap-1">
        {presets.map(p => {
          const active = value === toLocalInput(p.at)
          return (
            <button key={p.label} type="button" onClick={() => onChange(toLocalInput(p.at))}
              className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border transition-colors ${active ? `${THEME[kind].btn} text-white border-transparent` : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'}`}>
              {p.label}
            </button>
          )
        })}
      </div>
      {valid && !inPast && <p className="text-[10px] text-slate-500 flex items-center gap-1"><Clock className="w-3 h-3" /> {fmtWhen(chosen!.toISOString())} · {relative(chosen!.toISOString())}</p>}
      {inPast && <p className="text-[10px] text-red-500 flex items-center gap-1"><AlertCircle className="w-3 h-3" /> That time has passed — pick a later one or call now.</p>}
      {!inPast && !win.inWindow && <p className="text-[10px] text-amber-600 flex items-center gap-1"><AlertCircle className="w-3 h-3" /> {win.text}</p>}
      {afterArrival && <p className="text-[10px] text-amber-600 flex items-center gap-1"><AlertCircle className="w-3 h-3" /> That&apos;s after arrival — a reconfirmation is meant to happen before the trip.</p>}
    </div>
  )
}

// ─── Intake: how should this special call be placed? ─────────────────────────

export function IntakeWhen({ kind, draft, onChange, cfg, arrival, departure, daysOffset }: {
  kind: SpecialKind; draft: WhenDraft; onChange: (d: WhenDraft) => void
  cfg?: CallWindowConfig | null; arrival?: string | null; departure?: string | null; daysOffset: number
}) {
  const advice = timingAdvice(kind, { arrival, departure, daysOffset })
  const opts: { key: WhenMode; label: string; icon: React.ElementType }[] = [
    { key: 'auto',  label: kind === 'reconfirm' ? 'Days before' : 'Days after', icon: CalendarClock },
    { key: 'exact', label: 'Exact time', icon: Clock },
    { key: 'now',   label: 'Right away', icon: Zap },
  ]
  return (
    <div className="space-y-2 mt-2.5">
      {advice && draft.mode === 'auto' && (
        <div className="space-y-1.5">
          <AdviceBanner advice={advice} kind={kind} />
          {advice.level !== 'past' && (
            <div className="flex gap-1.5">
              <button type="button" onClick={() => onChange({ ...draft, mode: 'now' })} className={`text-[10px] font-bold px-2 py-1 rounded-lg text-white ${THEME[kind].btn}`}>Call right after registering</button>
              <button type="button" onClick={() => onChange({ ...draft, mode: 'exact' })} className="text-[10px] font-bold px-2 py-1 rounded-lg bg-white border border-slate-200 text-slate-700 hover:bg-slate-50">Pick a time</button>
            </div>
          )}
        </div>
      )}
      <div className="grid grid-cols-3 gap-1 p-0.5 bg-white/70 border border-slate-200 rounded-lg">
        {opts.map(o => {
          const Icon = o.icon
          const on = draft.mode === o.key
          return (
            <button key={o.key} type="button" onClick={() => onChange({ ...draft, mode: o.key })}
              className={`flex items-center justify-center gap-1 text-[10px] font-semibold py-1 rounded-md transition-colors ${on ? `${THEME[kind].btn} text-white shadow-sm` : 'text-slate-500 hover:bg-slate-50'}`}>
              <Icon className="w-3 h-3" />{o.label}
            </button>
          )
        })}
      </div>
      {draft.mode === 'exact' && <WhenPicker kind={kind} value={draft.at} onChange={at => onChange({ ...draft, at })} cfg={cfg} arrival={arrival} departure={departure} />}
      {draft.mode === 'now' && (
        <p className={`text-[10px] flex items-center gap-1 ${THEME[kind].text}`}><Zap className="w-3 h-3" /> Rings as soon as the booking is registered (once the customer has allowed WhatsApp calls).</p>
      )}
      {draft.mode !== 'auto' && (
        <>
          <input className="form-input h-8 text-xs" maxLength={500} placeholder="Note for the agent (optional) — e.g. flight moved to VN302, confirm 06:10 pickup"
            value={draft.note} onChange={e => onChange({ ...draft, note: e.target.value })} />
          <p className="text-[10px] text-slate-400">Replaces the automatic {kind === 'reconfirm' ? 'days-before' : 'days-after'} call, so the customer is only called once.</p>
        </>
      )}
    </div>
  )
}

// ─── Registered service: Call now / schedule + the on-demand queue ───────────

const ROW_STATUS: Record<string, { label: string; cls: string; icon?: React.ElementType }> = {
  pending:   { label: 'Scheduled', cls: 'bg-blue-50 text-blue-700 border-blue-200', icon: Clock },
  calling:   { label: 'Ringing',   cls: 'bg-violet-50 text-violet-700 border-violet-200', icon: PhoneCall },
  answered:  { label: 'Answered',  cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', icon: CheckCircle2 },
  done:      { label: 'Done',      cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', icon: CheckCircle2 },
  no_answer: { label: 'Retrying',  cls: 'bg-orange-50 text-orange-700 border-orange-200', icon: PhoneMissed },
  missed:    { label: 'Missed',    cls: 'bg-red-50 text-red-600 border-red-200', icon: PhoneMissed },
  failed:    { label: 'Failed',    cls: 'bg-red-50 text-red-600 border-red-200', icon: PhoneMissed },
  skipped:   { label: 'Skipped',   cls: 'bg-slate-50 text-slate-500 border-slate-200' },
}
function RowChip({ status }: { status: string }) {
  const m = ROW_STATUS[status] ?? { label: status, cls: 'bg-slate-50 text-slate-500 border-slate-200' }
  const Icon = m.icon
  return <span className={`inline-flex items-center gap-0.5 text-[9px] font-bold px-1.5 py-0.5 rounded-full border ${m.cls}`}>{Icon && <Icon className="w-2.5 h-2.5" />}{m.label.toUpperCase()}</span>
}
function noteOf(brief?: string | null): string | null {
  const m = /\bNOTE:\s*([\s\S]+)$/.exec(String(brief ?? ''))
  return m ? m[1].trim() : null
}

export function OnDemandStrip({ kind, bookingRef, schedule, cfg, api, planEnabled, daysOffset, arrival, departure, captured, phone, onChanged }: {
  kind: SpecialKind
  bookingRef: string
  schedule: SpecialScheduleItem[]
  cfg?: CallWindowConfig | null
  api: Api
  planEnabled: boolean
  daysOffset: number
  arrival?: string | null
  departure?: string | null
  /** A result for this kind is already captured (silences the "date passed" nudge). */
  captured: boolean
  phone?: string | null
  onChanged: () => void | Promise<void>
}) {
  const [busy, setBusy]       = useState<string | null>(null)
  const [open, setOpen]       = useState(false)
  const [at, setAt]           = useState('')
  const [note, setNote]       = useState('')
  const [replaceAuto, setReplaceAuto] = useState(true)

  const rows = schedule.filter(s => s.phase === kind)
  const plan = rows.find(r => r.day_no === PLAN_SLOT[kind])
  const planUnplaced = !!plan && planEnabled && !plan.conversation_id && (plan.status === 'pending' || plan.status === 'no_answer')
  const onDemand = rows.filter(isOnDemand).sort((a, b) => String(b.scheduled_at ?? '').localeCompare(String(a.scheduled_at ?? '')))
  const advice = timingAdvice(kind, { arrival, departure, daysOffset, captured })

  async function place(body: Record<string, unknown>, key: string) {
    setBusy(key)
    try {
      const res = await api(`services/${bookingRef}/special-calls`, 'POST', { kind, ...body })
      const msg = (res.message as string | undefined) ?? (res.error as string | undefined)
      // A refusal from the TE API arrives as { success: false, error }.
      if (res.success === false) throw new Error(msg ?? 'Request failed')
      if (res.approval_pending) toast.info(msg ?? 'Waiting for the customer to allow WhatsApp calls')
      else if (res.ok === false) toast.info(msg ?? 'The call could not be placed')
      else toast.success(msg ?? 'Done')
      await onChanged()
      return true
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Failed'); return false }
    finally { setBusy(null) }
  }

  async function callNow(withNote = false) {
    const ok = await place({ at: 'now', ...(withNote && note.trim() && { note: note.trim() }) }, 'now')
    if (ok && withNote) { setOpen(false); setNote('') }
  }
  async function scheduleCall() {
    if (!at) { toast.error('Pick a date and time'); return }
    const d = new Date(at)
    if (Number.isNaN(d.getTime()) || d.getTime() < Date.now() - 60_000) { toast.error('Pick a time in the future'); return }
    const ok = await place({ at: d.toISOString(), ...(note.trim() && { note: note.trim() }), ...(planUnplaced && replaceAuto && { replace_auto: true }) }, 'schedule')
    if (ok) { setOpen(false); setAt(''); setNote('') }
  }
  async function ringRow(id: number) {
    setBusy(`ring-${id}`)
    try {
      const res = await api(`schedule/${id}/call`, 'POST', { force: true })
      if (res.approval_pending) toast.info((res.message as string) ?? 'WhatsApp approval pending')
      else if (res.ok === false) toast.info((res.message as string) ?? 'Call could not be placed')
      else toast.success(`Ringing — ${LABEL[kind]} call`)
      await onChanged()
    } catch { toast.error('Call failed') } finally { setBusy(null) }
  }
  async function cancelRow(id: number) {
    if (!confirm(`Cancel this scheduled ${LABEL[kind]} call?`)) return
    setBusy(`cancel-${id}`)
    try { await api(`schedule/${id}`, 'DELETE'); toast.success('Scheduled call cancelled'); await onChanged() }
    catch { toast.error('Failed to cancel') } finally { setBusy(null) }
  }

  const t = THEME[kind]
  return (
    <div className="mt-2.5 pt-2.5 border-t border-slate-200/70 space-y-2">
      {advice && <AdviceBanner advice={advice} kind={kind} />}

      {plan && planEnabled && (
        <p className="text-[10px] text-slate-500 flex items-center gap-1.5 flex-wrap">
          <CalendarClock className="w-3 h-3 text-slate-400" /> Automatic call: <span className="font-semibold text-slate-700">{fmtWhen(plan.scheduled_at ?? `${plan.call_date}T12:00:00`)}</span> <RowChip status={plan.status} />
        </p>
      )}

      <div className="flex flex-wrap items-center gap-1.5">
        <button type="button" disabled={!!busy} onClick={() => callNow(false)} title={phone ? `Ring ${phone} now` : 'Ring now'}
          className={`inline-flex items-center gap-1 text-[10px] font-bold px-2.5 py-1.5 rounded-lg text-white disabled:opacity-60 transition-colors ${t.btn}`}>
          {busy === 'now' ? <Loader2 className="w-3 h-3 animate-spin" /> : <PhoneCall className="w-3 h-3" />} Call now
        </button>
        <button type="button" disabled={!!busy} onClick={() => setOpen(o => !o)}
          className={`inline-flex items-center gap-1 text-[10px] font-bold px-2.5 py-1.5 rounded-lg border bg-white disabled:opacity-60 transition-colors ${open ? `${t.soft} ${t.text}` : 'border-slate-200 text-slate-700 hover:bg-slate-50'}`}>
          <CalendarClock className="w-3 h-3" /> Schedule…
        </button>
        {planUnplaced && <span className="text-[10px] text-slate-400">Call now places the automatic call early — they won&apos;t be rung twice.</span>}
      </div>

      {open && (
        <div className={`rounded-lg border p-2.5 space-y-2 ${t.soft}`}>
          <WhenPicker kind={kind} value={at} onChange={setAt} cfg={cfg} arrival={arrival} departure={departure} />
          <div className="relative">
            <StickyNote className="w-3 h-3 text-slate-400 absolute left-2.5 top-2.5" />
            <input className="form-input h-8 text-xs pl-7" maxLength={500} placeholder="Note for the agent (optional) — it opens the call with this"
              value={note} onChange={e => setNote(e.target.value)} />
          </div>
          {planUnplaced && (
            <label className="flex items-center gap-1.5 text-[10px] text-slate-600 cursor-pointer select-none">
              <input type="checkbox" className="rounded" checked={replaceAuto} onChange={e => setReplaceAuto(e.target.checked)} />
              Replace the automatic call ({fmtWhen(plan!.scheduled_at ?? `${plan!.call_date}T12:00:00`)}) so they&apos;re only called once
            </label>
          )}
          <div className="flex flex-wrap gap-1.5">
            <button type="button" disabled={!!busy || !at} onClick={scheduleCall}
              className={`inline-flex items-center gap-1 text-[11px] font-semibold px-3 py-1 rounded-lg text-white disabled:opacity-50 ${t.btn}`}>
              {busy === 'schedule' ? <Loader2 className="w-3 h-3 animate-spin" /> : <CalendarClock className="w-3 h-3" />} Schedule call
            </button>
            {note.trim() && (
              <button type="button" disabled={!!busy} onClick={() => callNow(true)}
                className="inline-flex items-center gap-1 text-[11px] font-semibold px-3 py-1 rounded-lg bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                <Zap className="w-3 h-3" /> Call now with this note
              </button>
            )}
            <button type="button" onClick={() => setOpen(false)} className="px-3 py-1 rounded-lg bg-white border border-slate-200 text-slate-600 text-[11px] font-semibold hover:bg-slate-50">Close</button>
          </div>
        </div>
      )}

      {onDemand.length > 0 && (
        <div className="space-y-1">
          <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wide">On-demand calls</p>
          {onDemand.slice(0, 6).map(r => {
            const open_ = r.status === 'pending' || r.status === 'no_answer'
            const n = noteOf(r.day_brief)
            return (
              <div key={r.id} className="flex items-center gap-2 bg-white/80 border border-slate-200 rounded-lg px-2 py-1.5">
                <RowChip status={r.status} />
                <span className="text-[11px] font-semibold text-slate-700">{fmtWhen(r.scheduled_at ?? `${r.call_date}T12:00:00`)}</span>
                {r.status === 'pending' && r.scheduled_at && new Date(r.scheduled_at).getTime() > Date.now() && <span className="text-[10px] text-slate-400">{relative(r.scheduled_at)}</span>}
                {r.attempts > 0 && <span className="text-[10px] text-slate-400">{r.attempts}×</span>}
                {n && <span className="text-[10px] text-slate-500 truncate min-w-0 flex-1" title={n}>“{n}”</span>}
                {!n && <span className="flex-1" />}
                {r.error && r.status !== 'answered' && <span className="text-[10px] text-red-400 truncate max-w-[10rem]" title={r.error}>{r.error}</span>}
                {open_ && (
                  <>
                    <button type="button" disabled={!!busy} onClick={() => ringRow(r.id)} title="Ring now" className="p-1 rounded-md text-slate-400 hover:text-green-600 hover:bg-green-50 disabled:opacity-50">
                      {busy === `ring-${r.id}` ? <Loader2 className="w-3 h-3 animate-spin" /> : <PhoneCall className="w-3 h-3" />}
                    </button>
                    {!r.conversation_id && (
                      <button type="button" disabled={!!busy} onClick={() => cancelRow(r.id)} title="Cancel this call" className="p-1 rounded-md text-slate-400 hover:text-red-500 hover:bg-red-50 disabled:opacity-50">
                        {busy === `cancel-${r.id}` ? <Loader2 className="w-3 h-3 animate-spin" /> : <X className="w-3 h-3" />}
                      </button>
                    )}
                  </>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
