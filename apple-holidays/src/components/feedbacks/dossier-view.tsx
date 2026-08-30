'use client'

/**
 * The feedback dossier, on screen.
 *
 * One component renders a booking's complete feedback picture, and both tabs of
 * the Feedbacks page use it: the explorer shows one expanded, the bulk report
 * shows many collapsed. Keeping it single-source means the two tabs can never
 * show the same booking differently — and it is the same shape the PDF prints.
 */

import { useState } from 'react'
import {
  AlertTriangle, Bot, CalendarDays, CheckCircle2, ChevronDown, ClipboardList,
  Clock, FileText, MailCheck, MessageSquare, MinusCircle, Phone, PhoneCall,
  Plane, Quote, Star, ThumbsUp, User, Users, XCircle,
} from 'lucide-react'
import type {
  CallRecord, ComplaintRecord, FeedbackDossier, HealthBand, Sentiment, TimelineKind,
} from '@/lib/feedbacks/types'

// ─── Shared vocabulary ────────────────────────────────────────────────────────

export const BAND_STYLE: Record<HealthBand, { label: string; text: string; bg: string; ring: string; blurb: string }> = {
  excellent: { label: 'Excellent', text: 'text-emerald-700', bg: 'bg-emerald-50 border-emerald-200', ring: '#059669', blurb: 'Every channel came back strong' },
  good:      { label: 'Good',      text: 'text-sky-700',     bg: 'bg-sky-50 border-sky-200',         ring: '#0284c7', blurb: 'Solid trip, nothing outstanding' },
  watch:     { label: 'Watch',     text: 'text-amber-700',   bg: 'bg-amber-50 border-amber-200',     ring: '#d97706', blurb: 'Mixed signals — worth a read' },
  at_risk:   { label: 'At risk',   text: 'text-red-700',     bg: 'bg-red-50 border-red-200',         ring: '#dc2626', blurb: 'Negative feedback or an open complaint' },
  unknown:   { label: 'No data',   text: 'text-slate-500',   bg: 'bg-slate-50 border-slate-200',     ring: '#cbd5e1', blurb: 'No feedback captured yet' },
}

const SENTIMENT_STYLE: Record<Sentiment, { label: string; cls: string }> = {
  positive: { label: 'Positive', cls: 'bg-emerald-100 text-emerald-700' },
  neutral:  { label: 'Neutral',  cls: 'bg-sky-100 text-sky-700' },
  negative: { label: 'Negative', cls: 'bg-red-100 text-red-700' },
  unknown:  { label: 'Unread',   cls: 'bg-slate-100 text-slate-500' },
}

const KIND_STYLE: Record<CallRecord['kind'], { label: string; bar: string; chip: string; icon: React.ElementType }> = {
  reconfirm: { label: 'Reconfirmation call', bar: 'bg-sky-500',    chip: 'bg-sky-100 text-sky-700',       icon: ClipboardList },
  on_ground: { label: 'On-ground call',      bar: 'bg-violet-500', chip: 'bg-violet-100 text-violet-700', icon: PhoneCall },
  post_tour: { label: 'Post-tour call',      bar: 'bg-orange-500', chip: 'bg-orange-100 text-orange-700', icon: Star },
}

const TIMELINE_STYLE: Record<TimelineKind, { dot: string; icon: React.ElementType }> = {
  call:              { dot: 'bg-violet-500',  icon: PhoneCall },
  form:              { dot: 'bg-emerald-500', icon: FileText },
  desk_note:         { dot: 'bg-sky-500',     icon: MessageSquare },
  complaint:         { dot: 'bg-red-500',     icon: AlertTriangle },
  contact_log:       { dot: 'bg-slate-400',   icon: Phone },
  experience_report: { dot: 'bg-amber-500',   icon: MailCheck },
}

// ─── Formatting ───────────────────────────────────────────────────────────────

export function fmtDate(v: string | null | undefined): string {
  if (!v) return '—'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? v : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

export function fmtDateTime(v: string | null | undefined): string {
  if (!v) return '—'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? v : d.toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

// ─── Primitives ───────────────────────────────────────────────────────────────

export function Pill({ children, cls }: { children: React.ReactNode; cls: string }) {
  return <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold whitespace-nowrap ${cls}`}>{children}</span>
}

export function SentimentPill({ s }: { s: Sentiment }) {
  return <Pill cls={SENTIMENT_STYLE[s].cls}>{SENTIMENT_STYLE[s].label}</Pill>
}

export function BandPill({ band }: { band: HealthBand }) {
  const b = BAND_STYLE[band]
  return <Pill cls={`${b.text} ${b.bg.split(' ')[0]}`}>{b.label}</Pill>
}

/**
 * The score ring. SVG rather than a conic-gradient so it renders identically in
 * the browser and in the printed PDF, where background graphics may be off.
 */
export function ScoreRing({ value, band, size = 92 }: { value: number | null; band: HealthBand; size?: number }) {
  const b = BAND_STYLE[band]
  const r = (size - 11) / 2
  const circ = 2 * Math.PI * r
  const pct = value == null ? 0 : Math.max(0, Math.min(100, value))

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="block">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#e2e8f0" strokeWidth={8} />
      <circle
        cx={size / 2} cy={size / 2} r={r} fill="none" stroke={b.ring} strokeWidth={8} strokeLinecap="round"
        strokeDasharray={`${(pct / 100) * circ} ${circ}`}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        className="transition-[stroke-dasharray] duration-700"
      />
      <text x="50%" y="50%" textAnchor="middle" dy="0.10em"
        style={{ fontSize: Math.round(size * 0.3), fontWeight: 800, fill: value == null ? '#94a3b8' : '#0f172a' }}>
        {value ?? '—'}
      </text>
      <text x="50%" y="50%" textAnchor="middle" dy="1.6em"
        style={{ fontSize: Math.round(size * 0.1), fontWeight: 700, fill: '#94a3b8', letterSpacing: '0.08em' }}>
        SCORE
      </text>
    </svg>
  )
}

/** A proportion bar. Segments with a zero value are dropped, not rendered flat. */
export function StackBar({ parts, height = 8 }: { parts: { value: number; color: string; label?: string }[]; height?: number }) {
  const total = parts.reduce((n, p) => n + p.value, 0)
  return (
    <div className="w-full rounded-full overflow-hidden bg-slate-100 flex" style={{ height }}>
      {total > 0 && parts.filter(p => p.value > 0).map((p, i) => (
        <div key={i} className={p.color} style={{ width: `${(p.value / total) * 100}%` }} title={p.label} />
      ))}
    </div>
  )
}

export function Card({ title, subtitle, icon: Icon, accent = 'violet', actions, children }: {
  title: string
  subtitle?: string
  icon: React.ElementType
  accent?: 'violet' | 'sky' | 'emerald' | 'amber' | 'red' | 'slate'
  actions?: React.ReactNode
  children: React.ReactNode
}) {
  const tone: Record<string, string> = {
    violet: 'bg-violet-100 text-violet-600',
    sky: 'bg-sky-100 text-sky-600',
    emerald: 'bg-emerald-100 text-emerald-600',
    amber: 'bg-amber-100 text-amber-600',
    red: 'bg-red-100 text-red-600',
    slate: 'bg-slate-100 text-slate-600',
  }
  return (
    <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
      <div className="px-5 py-3.5 border-b border-slate-100 flex items-center gap-3 flex-wrap">
        <div className={`w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 ${tone[accent]}`}>
          <Icon className="w-4 h-4" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-bold text-slate-900">{title}</h3>
          {subtitle && <p className="text-xs text-slate-500">{subtitle}</p>}
        </div>
        {actions}
      </div>
      {children}
    </div>
  )
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="text-xs text-slate-400 bg-slate-50 rounded-xl px-4 py-6 text-center">{children}</div>
}

// ─── Blocks ───────────────────────────────────────────────────────────────────

function CoverageChips({ d }: { d: FeedbackDossier }) {
  const items: [string, boolean][] = [
    ['Reconfirmation call', d.coverage.reconfirmCall],
    ['On-ground call', d.coverage.onGroundCall],
    ['Post-tour call', d.coverage.postTourCall],
    ['Feedback form', d.coverage.guestForm],
    ['Desk note', d.coverage.deskNote],
  ]
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map(([label, on]) => (
        <span key={label}
          className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold ${
            on ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-slate-50 text-slate-400 border border-slate-200'
          }`}>
          {on ? <CheckCircle2 className="w-3 h-3" /> : <MinusCircle className="w-3 h-3" />}
          {label}
        </span>
      ))}
    </div>
  )
}

function StatTiles({ d }: { d: FeedbackDossier }) {
  const s = d.stats
  const tiles = [
    { label: 'Calls logged', value: s.callsLogged, note: `${s.callsCompleted}/${s.callsScheduled} scheduled done`, cls: 'text-violet-600' },
    { label: 'Positive', value: s.sentiment.positive, note: `${s.sentiment.negative} negative`, cls: s.sentiment.negative ? 'text-amber-600' : 'text-emerald-600' },
    { label: 'Service checks', value: `${s.goodChecks}/${s.goodChecks + s.badChecks}`, note: `${s.badChecks} flagged`, cls: s.badChecks ? 'text-amber-600' : 'text-emerald-600' },
    { label: 'Complaints', value: s.complaintsTotal, note: `${s.complaintsOpen} still open`, cls: s.complaintsOpen ? 'text-red-600' : 'text-slate-400' },
    { label: 'Post-tour', value: s.npsRating == null ? '—' : `${s.npsRating}/10`, note: s.wouldRecommend == null ? 'no recommendation' : s.wouldRecommend ? 'would recommend' : 'would not recommend', cls: s.npsRating == null ? 'text-slate-400' : s.npsRating >= 8 ? 'text-emerald-600' : 'text-amber-600' },
    { label: 'Channels', value: `${d.coverage.count}/5`, note: 'produced feedback', cls: d.coverage.count >= 3 ? 'text-emerald-600' : d.coverage.count ? 'text-amber-600' : 'text-slate-400' },
  ]
  return (
    <div className="grid gap-2.5 grid-cols-2 sm:grid-cols-3 lg:grid-cols-6">
      {tiles.map(t => (
        <div key={t.label} className="rounded-xl border border-slate-200 bg-slate-50/60 px-3 py-2.5">
          <p className="text-[9px] font-bold text-slate-500 uppercase tracking-wide">{t.label}</p>
          <p className={`text-xl font-black leading-tight mt-0.5 ${t.cls}`}>{t.value}</p>
          <p className="text-[10px] text-slate-400 leading-tight">{t.note}</p>
        </div>
      ))}
    </div>
  )
}

function ScoreBreakdown({ d }: { d: FeedbackDossier }) {
  if (!d.score.components.length) return <Empty>No channel produced a score for this booking.</Empty>
  return (
    <div className="space-y-2.5">
      {d.score.components.map(c => (
        <div key={c.key} className="flex items-center gap-3">
          <span className="text-xs font-semibold text-slate-700 w-32 flex-shrink-0">{c.label}</span>
          <div className="flex-1 min-w-0">
            <StackBar parts={[
              { value: c.value, color: c.value >= 70 ? 'bg-emerald-500' : c.value >= 50 ? 'bg-amber-500' : 'bg-red-500' },
              { value: 100 - c.value, color: 'bg-slate-100' },
            ]} />
            <p className="text-[10px] text-slate-400 mt-1">{c.detail} · weight ×{c.weight}</p>
          </div>
          <span className="text-sm font-black text-slate-900 w-9 text-right">{Math.round(c.value)}</span>
        </div>
      ))}
      {d.score.complaintPenalty > 0 && (
        <div className="flex items-center gap-2 text-xs font-semibold text-red-600 pt-1 border-t border-slate-100">
          <AlertTriangle className="w-3.5 h-3.5" />
          −{d.score.complaintPenalty} points for complaints still open
        </div>
      )}
      <ul className="pt-1 space-y-0.5">
        {d.score.reasons.map((r, i) => (
          <li key={i} className="text-xs text-slate-600">• {r}</li>
        ))}
      </ul>
    </div>
  )
}

function CallCard({ c }: { c: CallRecord }) {
  const [open, setOpen] = useState(false)
  const k = KIND_STYLE[c.kind]
  const Icon = k.icon

  return (
    <div className="rounded-xl border border-slate-200 overflow-hidden bg-white">
      <div className={`flex items-center gap-2 px-3.5 py-2.5 bg-slate-50/70 border-b border-slate-100 flex-wrap`}>
        <div className={`w-1 self-stretch rounded-full ${k.bar} -my-2.5`} />
        <Icon className="w-3.5 h-3.5 text-slate-500" />
        <span className="text-xs font-bold text-slate-900">
          {k.label}{c.dayNo != null && <span className="text-slate-400 font-semibold"> · Day {c.dayNo}</span>}
        </span>
        <SentimentPill s={c.sentiment} />
        {c.rating != null && <Pill cls="bg-violet-100 text-violet-700">{c.rating}/10</Pill>}
        {c.outcome && <Pill cls="bg-slate-100 text-slate-600">{c.outcome}</Pill>}
        <span className="text-[10px] text-slate-400 ml-auto">{fmtDateTime(c.at)}</span>
      </div>

      <div className="px-3.5 py-3 space-y-2.5">
        {c.summary && (
          <p className="text-xs text-purple-900 bg-violet-50 border-l-2 border-violet-500 rounded-r-lg px-3 py-2 whitespace-pre-line">
            {c.summary}
          </p>
        )}

        {c.checks.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {c.checks.map((ch, i) => (
              <Pill key={i} cls={
                ch.answer === 'good' ? 'bg-emerald-100 text-emerald-700'
                  : ch.answer === 'bad' ? 'bg-red-100 text-red-700'
                  : 'bg-slate-100 text-slate-500'
              }>
                {ch.answer === 'good' ? <CheckCircle2 className="w-3 h-3" /> : ch.answer === 'bad' ? <XCircle className="w-3 h-3" /> : null}
                {ch.label}: {ch.raw}
              </Pill>
            ))}
          </div>
        )}

        {c.notes.map((n, i) => (
          <div key={i} className="border-t border-dashed border-slate-100 pt-2 first:border-t-0 first:pt-0">
            <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wide">{n.label}</p>
            <p className="text-xs text-slate-700 whitespace-pre-line">{n.text}</p>
          </div>
        ))}

        {!c.summary && !c.checks.length && !c.notes.length && (
          <p className="text-xs text-slate-400">The call was logged but recorded no answers — nothing was captured.</p>
        )}

        {c.transcript.length > 0 && (
          <div className="border-t border-slate-100 pt-2">
            <button onClick={() => setOpen(v => !v)}
              className="flex items-center gap-1.5 text-[10px] font-bold text-slate-500 uppercase tracking-wide hover:text-violet-600 transition-colors">
              <ChevronDown className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
              Transcript — {c.transcript.length} turns
            </button>
            {open && (
              <div className="mt-2 space-y-1 max-h-96 overflow-y-auto pr-1">
                {c.transcript.map((t, i) => (
                  <div key={i} className="flex gap-2 text-xs">
                    <span className={`flex-shrink-0 w-14 text-[9px] font-bold uppercase tracking-wide pt-0.5 ${
                      t.speaker === 'agent' ? 'text-violet-600' : t.speaker === 'customer' ? 'text-emerald-600' : 'text-slate-400'
                    }`}>
                      {t.speaker === 'agent' ? 'AI' : t.speaker === 'customer' ? 'Guest' : 'System'}
                    </span>
                    <span className="text-slate-700 flex-1 whitespace-pre-line">{t.text}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function ComplaintCard({ c }: { c: ComplaintRecord }) {
  const tone = c.severity === 'high'
    ? { border: 'border-l-red-500', pill: 'bg-red-100 text-red-700' }
    : c.severity === 'medium'
      ? { border: 'border-l-amber-500', pill: 'bg-amber-100 text-amber-700' }
      : { border: 'border-l-slate-400', pill: 'bg-slate-100 text-slate-600' }

  return (
    <div className={`rounded-xl border border-slate-200 border-l-4 ${tone.border} px-3.5 py-3 bg-white`}>
      <div className="flex items-center gap-1.5 flex-wrap">
        <Pill cls={tone.pill}>{c.severity.toUpperCase()}</Pill>
        <Pill cls={c.isOpen ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'}>
          {c.isOpen ? 'OPEN' : c.status.toUpperCase()}
        </Pill>
        {c.category && <Pill cls="bg-slate-100 text-slate-600">{c.category}</Pill>}
        {c.callKind && <Pill cls="bg-sky-100 text-sky-700">{c.callKind}</Pill>}
        <span className="text-[10px] text-slate-400 ml-auto">{fmtDateTime(c.createdAt)}</span>
      </div>
      <p className="text-sm font-bold text-slate-900 mt-1.5">{c.title ?? 'Complaint raised on a call'}</p>
      {c.details && <p className="text-xs text-slate-600 mt-1 whitespace-pre-line">{c.details}</p>}
      {c.customerQuote && (
        <p className="text-xs italic text-slate-600 border-l-2 border-slate-200 pl-2.5 mt-2 flex gap-1.5">
          <Quote className="w-3 h-3 flex-shrink-0 mt-0.5 text-slate-300" />
          {c.customerQuote}
        </p>
      )}
      {c.resolutionNote && (
        <p className="text-xs text-emerald-700 mt-2">
          <strong>Resolution:</strong> {c.resolutionNote}
          {c.resolvedAt && <span className="text-slate-400"> ({fmtDateTime(c.resolvedAt)})</span>}
        </p>
      )}
    </div>
  )
}

function FormBlock({ d }: { d: FeedbackDossier }) {
  if (!d.form) return <Empty>The guest did not submit a feedback form.</Empty>

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        {d.form.scorePct != null && <Pill cls="bg-violet-100 text-violet-700">{d.form.scorePct}% overall</Pill>}
        {d.form.purpose && <Pill cls="bg-sky-100 text-sky-700">Purpose: {d.form.purpose}</Pill>}
        {d.form.clientName && <span className="text-xs text-slate-400">Submitted by {d.form.clientName}</span>}
        <span className="text-[10px] text-slate-400 ml-auto">{fmtDateTime(d.form.submittedAt)}</span>
      </div>

      <div className="space-y-2">
        {d.form.answers.map(a => (
          <div key={a.label} className="flex items-center gap-3">
            <span className="text-xs font-semibold text-slate-700 w-44 flex-shrink-0">{a.label}</span>
            <div className="flex-1 min-w-0">
              {a.score == null
                ? <div className="h-2 rounded-full bg-slate-100" />
                : <StackBar parts={[
                    { value: a.score, color: a.score >= 4 ? 'bg-emerald-500' : a.score === 3 ? 'bg-sky-500' : a.score === 2 ? 'bg-amber-500' : 'bg-red-500' },
                    { value: 4 - a.score, color: 'bg-slate-100' },
                  ]} />}
            </div>
            <span className="w-20 text-right">
              {a.value
                ? <Pill cls={
                    (a.score ?? 0) >= 3 ? 'bg-emerald-100 text-emerald-700'
                      : a.score === 2 ? 'bg-amber-100 text-amber-700'
                      : 'bg-red-100 text-red-700'
                  }>{a.value}</Pill>
                : <span className="text-[10px] text-slate-300">not answered</span>}
            </span>
          </div>
        ))}
      </div>

      {d.form.remarks && (
        <p className="text-xs text-purple-900 bg-violet-50 border-l-2 border-violet-500 rounded-r-lg px-3 py-2">
          <strong>Guest remarks:</strong> {d.form.remarks}
        </p>
      )}
    </div>
  )
}

function Timeline({ d }: { d: FeedbackDossier }) {
  if (!d.timeline.length) return <Empty>Nothing has been recorded against this booking yet.</Empty>

  return (
    <div className="relative pl-5">
      <div className="absolute left-1.5 top-1.5 bottom-1.5 w-px bg-slate-200" />
      <div className="space-y-3.5">
        {d.timeline.map((e, i) => {
          const style = TIMELINE_STYLE[e.kind]
          const Icon = style.icon
          return (
            <div key={`${e.ref}-${i}`} className="relative">
              <span className={`absolute -left-[18px] top-1 w-3 h-3 rounded-full ring-2 ring-white ${style.dot}`} />
              <div className="flex items-baseline gap-2 flex-wrap">
                <Icon className="w-3.5 h-3.5 text-slate-400 self-center" />
                <span className="text-xs font-bold text-slate-900">{e.title}</span>
                {e.sentiment !== 'unknown' && <SentimentPill s={e.sentiment} />}
                {e.severity && (
                  <Pill cls={e.severity === 'high' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}>
                    {e.severity.toUpperCase()}
                  </Pill>
                )}
                <span className="text-[10px] text-slate-400 ml-auto">{fmtDateTime(e.at)}</span>
              </div>
              {e.detail && <p className="text-xs text-slate-600 mt-0.5 line-clamp-3">{e.detail}</p>}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function Facts({ d }: { d: FeedbackDossier }) {
  const f = d.facts
  const rows: [React.ElementType, string, React.ReactNode][] = [
    [User, 'Guest', <>{f.clientName ?? '—'}{f.leadPassenger && f.leadPassenger !== f.clientName && <span className="text-slate-400"> (lead: {f.leadPassenger})</span>}</>],
    [Users, 'Party', `${f.pax.total} pax — ${f.pax.adults} adults, ${f.pax.children} children, ${f.pax.infants} infants`],
    [CalendarDays, 'Travel dates', <>{fmtDate(f.arrivalDate)} → {fmtDate(f.departureDate)}{f.nights != null && <span className="text-slate-400"> ({f.nights} nights)</span>}</>],
    [Plane, 'Destination', f.tourDestination ?? f.operationCountry ?? '—'],
    [MailCheck, 'Agent', <>{f.agent ?? '—'}{f.agentEmail && <span className="text-slate-400"> · {f.agentEmail}</span>}</>],
    [Bot, 'AI calls', f.callService
      ? <>Registered <span className="text-slate-400">· {f.callService.status}{f.callService.callPhone ? ` · ${f.callService.callPhone}` : ''}{f.callService.callTime ? ` · daily ${f.callService.callTime}` : ''}</span></>
      : <span className="text-slate-400">Not registered for AI voice calls</span>],
  ]
  if (f.specialOccasions) rows.push([Star, 'Occasions', f.specialOccasions])

  return (
    <div className="space-y-1.5">
      {rows.map(([Icon, label, value], i) => (
        <div key={i} className="flex gap-3 items-start text-xs py-1 border-b border-slate-50 last:border-0">
          <Icon className="w-3.5 h-3.5 text-slate-300 flex-shrink-0 mt-0.5" />
          <span className="font-bold text-slate-400 uppercase tracking-wide text-[10px] w-28 flex-shrink-0 mt-0.5">{label}</span>
          <span className="text-slate-800 min-w-0">{value}</span>
        </div>
      ))}
    </div>
  )
}

// ─── The dossier ──────────────────────────────────────────────────────────────

export function DossierHeader({ d, actions }: { d: FeedbackDossier; actions?: React.ReactNode }) {
  const b = BAND_STYLE[d.score.band]
  const f = d.facts

  return (
    <div className="rounded-2xl overflow-hidden bg-gradient-to-br from-violet-900 via-violet-700 to-fuchsia-600 text-white">
      <div className="px-5 py-5 flex items-center gap-5 flex-wrap">
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-white/70">Feedback dossier</p>
          <h2 className="text-2xl font-black tracking-tight mt-0.5 truncate">
            {f.bookingRef}{f.clientName && <span className="font-bold text-white/90"> — {f.clientName}</span>}
          </h2>
          <p className="text-xs text-white/80 mt-1">
            {f.tourDestination ?? f.operationCountry ?? 'Tour'} · {fmtDate(f.arrivalDate)} → {fmtDate(f.departureDate)} · {f.pax.total} pax
            {f.agent && ` · ${f.agent}`}
          </p>
          <div className="flex flex-wrap gap-1.5 mt-3">
            {[
              `${d.stats.callsLogged} calls`,
              d.coverage.guestForm ? 'Form submitted' : 'No form',
              `${d.stats.complaintsOpen} open complaints`,
              `${d.coverage.count}/5 channels`,
            ].map(chip => (
              <span key={chip} className="px-2.5 py-1 rounded-full bg-white/15 border border-white/25 text-[10px] font-bold">
                {chip}
              </span>
            ))}
          </div>
        </div>

        <div className="bg-white/95 rounded-2xl px-5 py-3 text-center flex-shrink-0">
          <ScoreRing value={d.score.value} band={d.score.band} size={96} />
          <p className={`text-[10px] font-black uppercase tracking-[0.1em] mt-1.5 ${b.text}`}>{b.label}</p>
          <p className="text-[10px] text-slate-500 max-w-[150px] leading-tight">{b.blurb}</p>
        </div>
      </div>
      {actions && <div className="px-5 py-3 bg-black/15 flex items-center gap-2 flex-wrap">{actions}</div>}
    </div>
  )
}

export default function DossierView({ d, compact = false }: { d: FeedbackDossier; compact?: boolean }) {
  const callsByKind = (['reconfirm', 'on_ground', 'post_tour'] as CallRecord['kind'][])
    .map(kind => ({ kind, list: d.calls.filter(c => c.kind === kind) }))
    .filter(g => g.list.length > 0)

  return (
    <div className="space-y-4">
      {d.warnings.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 space-y-1">
          {d.warnings.map((w, i) => (
            <p key={i} className="text-xs text-amber-800 flex items-start gap-2">
              <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />{w}
            </p>
          ))}
        </div>
      )}

      <StatTiles d={d} />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card icon={ThumbsUp} accent="violet" title="Experience score"
          subtitle={`${d.score.value ?? '—'}/100 — weighted across the channels that spoke`}>
          <div className="p-5"><ScoreBreakdown d={d} /></div>
        </Card>

        <Card icon={FileText} accent="sky" title="Booking" subtitle="Trip facts as they stand today">
          <div className="p-5 space-y-3">
            <Facts d={d} />
            <CoverageChips d={d} />
          </div>
        </Card>
      </div>

      <Card icon={Bot} accent="violet" title="AI call responses"
        subtitle={`${d.stats.callsLogged} logged — reconfirmation, on-ground and post-tour, with transcripts`}>
        <div className="p-5 space-y-4">
          {callsByKind.length === 0 && <Empty>No AI voice call has been logged for this booking.</Empty>}
          {callsByKind.map(g => (
            <div key={g.kind} className="space-y-2.5">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">
                {KIND_STYLE[g.kind].label} — {g.list.length}
              </p>
              {g.list.map(c => <CallCard key={c.uid} c={c} />)}
            </div>
          ))}
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card icon={FileText} accent="emerald" title="Guest feedback form"
          subtitle={d.form ? `Submitted ${fmtDateTime(d.form.submittedAt)}` : 'Not submitted'}>
          <div className="p-5"><FormBlock d={d} /></div>
        </Card>

        <Card icon={AlertTriangle} accent="red" title="Complaints & urgent asks"
          subtitle={`${d.stats.complaintsTotal} raised · ${d.stats.complaintsOpen} still open`}>
          <div className="p-5 space-y-2.5">
            {d.complaints.length
              ? d.complaints.map(c => <ComplaintCard key={c.id} c={c} />)
              : <Empty>No complaint was raised on any call.</Empty>}
          </div>
        </Card>
      </div>

      {!compact && (
        <>
          <Card icon={Clock} accent="slate" title="Timeline"
            subtitle={`${d.timeline.length} events, newest first`}>
            <div className="p-5"><Timeline d={d} /></div>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card icon={MessageSquare} accent="sky" title="Desk-saved feedback" subtitle="What the team recorded by hand">
              <div className="p-5 space-y-2.5">
                {d.deskNotes.length ? d.deskNotes.map(n => (
                  <div key={n.id} className="rounded-xl border border-slate-200 border-l-4 border-l-sky-500 px-3.5 py-3">
                    <div className="flex items-center gap-2 flex-wrap">
                      {n.rating != null
                        ? <Pill cls={n.rating >= 4 ? 'bg-emerald-100 text-emerald-700' : n.rating >= 3 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'}>{n.rating}/5</Pill>
                        : <Pill cls="bg-slate-100 text-slate-500">No rating</Pill>}
                      {n.savedBy && <span className="text-[10px] text-slate-400">saved by {n.savedBy}</span>}
                      <span className="text-[10px] text-slate-400 ml-auto">{fmtDateTime(n.createdAt)}</span>
                    </div>
                    {n.comment && <p className="text-xs text-slate-700 mt-1.5 whitespace-pre-line">{n.comment}</p>}
                  </div>
                )) : <Empty>The desk has not saved a rating for this booking.</Empty>}
              </div>
            </Card>

            <Card icon={Phone} accent="slate" title="Contact log"
              subtitle={`${d.contactLogs.length} interactions recorded by the team`}>
              <div className="p-5">
                {d.contactLogs.length ? (
                  <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
                    {d.contactLogs.map(l => (
                      <div key={l.id} className="text-xs border-b border-slate-50 pb-2 last:border-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Pill cls="bg-sky-100 text-sky-700">{l.type}</Pill>
                          <span className="font-bold text-slate-800">{l.subject}</span>
                          <span className="text-[10px] text-slate-400 ml-auto">{fmtDateTime(l.contactedAt)}</span>
                        </div>
                        {l.notes && <p className="text-slate-600 mt-0.5">{l.notes}</p>}
                        {l.by && <p className="text-[10px] text-slate-400 mt-0.5">— {l.by}</p>}
                      </div>
                    ))}
                  </div>
                ) : <Empty>No contact has been logged against this booking.</Empty>}
              </div>
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card icon={CalendarDays} accent="amber" title="Call schedule"
              subtitle={`${d.stats.callsScheduled} scheduled · ${d.stats.callsCompleted} done · ${d.stats.callsMissed} missed · ${d.stats.callsPending} pending`}>
              <div className="p-5">
                {d.schedule.length ? (
                  <div className="overflow-x-auto max-h-80">
                    <table className="w-full text-xs">
                      <thead className="sticky top-0 bg-white">
                        <tr className="text-[9px] font-bold text-slate-400 uppercase tracking-wide border-b border-slate-200">
                          <th className="text-left pb-2 pr-3">Day</th>
                          <th className="text-left pb-2 pr-3">Date</th>
                          <th className="text-left pb-2 pr-3">Phase</th>
                          <th className="text-left pb-2 pr-3">Status</th>
                          <th className="text-left pb-2">Brief</th>
                        </tr>
                      </thead>
                      <tbody>
                        {d.schedule.map(s => (
                          <tr key={s.id} className="border-b border-slate-50">
                            <td className="py-1.5 pr-3 font-bold text-slate-800">{s.dayNo ?? '—'}</td>
                            <td className="py-1.5 pr-3 whitespace-nowrap">{fmtDate(s.callDate)}</td>
                            <td className="py-1.5 pr-3 text-slate-500">{s.phase ?? '—'}</td>
                            <td className="py-1.5 pr-3">
                              <Pill cls={
                                ['done', 'answered', 'completed'].includes(s.status) ? 'bg-emerald-100 text-emerald-700'
                                  : ['missed', 'failed', 'error'].includes(s.status) ? 'bg-red-100 text-red-700'
                                  : 'bg-amber-100 text-amber-700'
                              }>{s.status}</Pill>
                            </td>
                            <td className="py-1.5 text-slate-500 truncate max-w-[220px]">{s.dayBrief ?? s.error ?? '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : <Empty>No call schedule exists for this booking.</Empty>}
              </div>
            </Card>

            <Card icon={MailCheck} accent="amber" title="Experience reports" subtitle="What went out to the agent afterwards">
              <div className="p-5 space-y-2">
                {d.experienceReports.length ? d.experienceReports.map(r => (
                  <div key={r.id} className="text-xs border-b border-slate-50 pb-2 last:border-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Pill cls={r.status === 'sent' ? 'bg-emerald-100 text-emerald-700' : r.status === 'held' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}>
                        {r.status}
                      </Pill>
                      {r.riskLevel !== 'none' && <Pill cls="bg-red-100 text-red-700">{r.riskLevel} risk ({r.riskScore})</Pill>}
                      <span className="text-[10px] text-slate-400 ml-auto">{fmtDateTime(r.sentAt ?? r.createdAt)}</span>
                    </div>
                    <p className="text-slate-700 mt-1">{r.subject ?? r.holdReason ?? '—'}</p>
                    {r.toEmail && <p className="text-[10px] text-slate-400">to {r.toEmail}</p>}
                  </div>
                )) : <Empty>No experience report has been built for this booking.</Empty>}
              </div>
            </Card>
          </div>
        </>
      )}
    </div>
  )
}
