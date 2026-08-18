'use client'

/**
 * The report drawer: everything about one trip's report, and every action that
 * can be taken on it.
 *
 * Six tabs, in the order someone actually works them: what we're saying, the
 * mail exactly as it was (or will be) sent, the letter the traveller gets, the
 * raw evidence behind it — transcripts included, which is the only place they
 * appear — the escalation when the trip went badly, and the audit trail.
 *
 * A trip nobody called and nobody filled a form in for arrives here as
 * `pending`, with no mail body at all. The write-up box is the whole point of
 * that state: what the Experience team types becomes the evidence the report
 * is then written from.
 */

import { useCallback, useEffect, useState } from 'react'
import {
  AlertTriangle, ArrowUpRight, Ban, CheckCircle2, ClipboardList, Clock,
  Hand, Heart, Loader2, Mail, MapPin, MessageSquareText, PenLine, PhoneCall,
  RefreshCw, Send, Sparkles, Users, X, FileWarning, History, Eye, ShieldAlert,
} from 'lucide-react'
import { toast } from 'sonner'
import type {
  CallEvidence, ExperienceReportRecord, TranscriptLine,
} from '@/lib/te/experience-report/types'
import {
  ChannelChips, Empty, fmtDate, fmtDateShort, fmtDateTime, fmtRelative,
  RISK_META, RiskPill, SectionLabel, StatusPill,
} from './shared'

type Tab = 'report' | 'email' | 'letter' | 'evidence' | 'escalation' | 'activity'

interface Props {
  id: string
  onClose: () => void
  /** Called after any action that changes the row, so the list can refresh. */
  onChanged: () => void
}

// ─── Prompt for the actions that require a written reason ─────────────────────

interface PromptSpec {
  title: string
  intro: string
  label: string
  placeholder: string
  confirmLabel: string
  tone: 'danger' | 'primary'
  /** An empty note is rejected client-side for these. */
  required: boolean
  run: (note: string) => Promise<void>
}

function NotePrompt({ spec, onDismiss }: { spec: PromptSpec; onDismiss: () => void }) {
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    if (spec.required && !note.trim()) {
      toast.error('Please write a short reason first.')
      return
    }
    setBusy(true)
    try { await spec.run(note.trim()) } finally { setBusy(false) }
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" onClick={busy ? undefined : onDismiss} />
      <div className="relative w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl">
        <h3 className="text-lg font-extrabold text-slate-900">{spec.title}</h3>
        <p className="mt-1.5 text-sm leading-relaxed text-slate-500">{spec.intro}</p>

        <label className="mt-5 block text-[11px] font-extrabold uppercase tracking-wider text-slate-400">
          {spec.label}{spec.required && <span className="ml-1 text-rose-500">*</span>}
        </label>
        <textarea
          autoFocus
          rows={4}
          value={note}
          onChange={e => setNote(e.target.value)}
          placeholder={spec.placeholder}
          className="mt-1.5 w-full resize-none rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm text-slate-700 outline-none transition focus:border-violet-400 focus:ring-4 focus:ring-violet-50"
        />

        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onDismiss}
            disabled={busy}
            className="rounded-xl px-4 py-2.5 text-sm font-bold text-slate-500 transition hover:bg-slate-100 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={busy}
            className={`inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-bold text-white shadow-sm transition disabled:opacity-60 ${
              spec.tone === 'danger' ? 'bg-rose-600 hover:bg-rose-700' : 'bg-violet-600 hover:bg-violet-700'
            }`}
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {spec.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Transcript viewer ────────────────────────────────────────────────────────

function Transcript({ lines }: { lines: TranscriptLine[] }) {
  if (!lines.length) {
    return <p className="px-1 py-2 text-xs italic text-slate-400">No transcript was captured for this call.</p>
  }
  return (
    <div className="space-y-2 rounded-xl bg-slate-50 p-3">
      {lines.map((line, i) => {
        const isAgent = line.speaker === 'agent'
        const isSystem = line.speaker === 'system'
        return (
          <div key={i} className={`flex gap-2 ${isAgent ? '' : 'flex-row-reverse'}`}>
            <span
              className={`mt-0.5 shrink-0 rounded-md px-1.5 py-0.5 text-[9px] font-extrabold tracking-wide text-white ${
                isAgent ? 'bg-violet-600' : isSystem ? 'bg-slate-400' : 'bg-slate-900'
              }`}
            >
              {isAgent ? 'US' : isSystem ? 'SYS' : 'GUEST'}
            </span>
            <p
              className={`max-w-[80%] rounded-xl px-3 py-2 text-[12.5px] leading-relaxed ${
                isAgent ? 'bg-white text-slate-700 ring-1 ring-slate-200'
                : isSystem ? 'bg-slate-100 text-slate-500 italic'
                : 'bg-indigo-600 text-white'
              }`}
            >
              {line.text}
            </p>
          </div>
        )
      })}
    </div>
  )
}

function ratingTone(v: string | null) {
  if (!v) return 'bg-slate-100 text-slate-400'
  const s = v.toLowerCase()
  if (s === 'good' || s === 'excellent') return 'bg-emerald-100 text-emerald-700'
  if (s === 'bad' || s === 'poor') return 'bg-rose-100 text-rose-700'
  if (s === 'average') return 'bg-amber-100 text-amber-700'
  return 'bg-slate-100 text-slate-500'
}

function CallCard({ call }: { call: CallEvidence }) {
  const [open, setOpen] = useState(false)
  const sentiment = call.sentiment?.toLowerCase() ?? ''
  const tone =
    ['positive', 'happy'].includes(sentiment) ? { emoji: '😊', ring: 'ring-emerald-200', bg: 'bg-emerald-50' }
    : ['negative', 'sad', 'angry'].includes(sentiment) ? { emoji: '😞', ring: 'ring-rose-200', bg: 'bg-rose-50' }
    : sentiment === 'neutral' ? { emoji: '😐', ring: 'ring-slate-200', bg: 'bg-slate-50' }
    : { emoji: '📞', ring: 'ring-slate-200', bg: 'bg-slate-50' }

  return (
    <div className={`rounded-2xl ring-1 ${tone.ring} overflow-hidden`}>
      <div className={`flex items-center justify-between gap-3 px-4 py-3 ${tone.bg}`}>
        <div className="flex items-center gap-2.5">
          <span className="rounded-lg bg-slate-900 px-2 py-1 text-[10px] font-extrabold tracking-wide text-white">
            DAY {call.dayNo ?? '?'}
          </span>
          <span className="text-xs font-bold text-slate-600">{fmtDateShort(call.date)}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-base">{tone.emoji}</span>
          <span className="text-[11px] font-bold capitalize text-slate-600">{call.sentiment ?? 'logged'}</span>
        </div>
      </div>

      <div className="space-y-3 bg-white px-4 py-3.5">
        <div className="flex flex-wrap gap-1.5">
          {([['Hotel', call.hotelOk], ['Meals', call.mealsOk], ['Driver', call.driverOk], ['Vehicle', call.vehicleOk]] as const)
            .map(([label, value]) => (
              <span key={label} className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${ratingTone(value)}`}>
                {label} · {value ?? 'not asked'}
              </span>
            ))}
        </div>

        {call.dayBrief && <p className="text-[11px] italic text-slate-400">Planned: {call.dayBrief}</p>}
        {call.summary && <p className="text-[13px] leading-relaxed text-slate-700">{call.summary}</p>}

        {call.highlights && (
          <div className="rounded-r-xl border-l-4 border-violet-300 bg-violet-50 px-3 py-2">
            <p className="text-[9px] font-extrabold uppercase tracking-wider text-violet-600">Highlights</p>
            <p className="mt-0.5 text-[12.5px] leading-relaxed text-violet-900">{call.highlights}</p>
          </div>
        )}

        {call.issues && (
          <div className="rounded-r-xl border-l-4 border-rose-300 bg-rose-50 px-3 py-2">
            <p className="text-[9px] font-extrabold uppercase tracking-wider text-rose-600">Issue raised</p>
            <p className="mt-0.5 text-[12.5px] leading-relaxed text-rose-900">{call.issues}</p>
          </div>
        )}

        {call.transcript.length > 0 && (
          <div>
            <button
              onClick={() => setOpen(o => !o)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-slate-100 px-2.5 py-1.5 text-[11px] font-bold text-slate-600 transition hover:bg-slate-200"
            >
              <MessageSquareText className="h-3 w-3" />
              {open ? 'Hide' : 'Show'} transcript · {call.transcript.length} lines
            </button>
            {open && <div className="mt-2"><Transcript lines={call.transcript} /></div>}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Main drawer ──────────────────────────────────────────────────────────────

export default function ReportDetail({ id, onClose, onChanged }: Props) {
  const [report, setReport] = useState<ExperienceReportRecord | null>(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<Tab>('report')
  const [busy, setBusy] = useState<string | null>(null)
  const [prompt, setPrompt] = useState<PromptSpec | null>(null)
  const [agentEmail, setAgentEmail] = useState('')
  const [writeUp, setWriteUp] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/te/experience-reports/${id}`, { cache: 'no-store' })
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      setReport(json.data)
      setAgentEmail(json.data?.toEmail ?? json.data?.dossier?.facts?.agentEmail ?? '')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not load the report')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !prompt) onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose, prompt])

  const act = useCallback(async (
    action: string,
    payload: Record<string, unknown> = {},
    label = action,
  ) => {
    setBusy(label)
    try {
      const res = await fetch(`/api/te/experience-reports/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...payload }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      setReport(json.data)
      toast.success(json.message ?? 'Done')
      onChanged()
      setPrompt(null)
      if (action === 'writeup') setWriteUp('')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'The action failed')
    } finally {
      setBusy(null)
    }
  }, [id, onChanged])

  const dossier = report?.dossier ?? null
  const facts = dossier?.facts ?? null
  const narrative = report?.narrative ?? null
  const clientMail = narrative?.clientMail ?? null
  const isHeld = report?.status === 'held'
  const isPending = report?.status === 'pending'
  const isSent = report?.status === 'sent'
  const isClosed = isSent || report?.status === 'cancelled'

  const tabs: { key: Tab; label: string; icon: typeof Mail; badge?: number }[] = [
    { key: 'report', label: 'Report', icon: Sparkles },
    { key: 'email', label: 'The mail', icon: Mail },
    ...(clientMail ? [{ key: 'letter' as Tab, label: 'Guest letter', icon: Heart }] : []),
    { key: 'evidence', label: 'Evidence', icon: ClipboardList, badge: dossier?.calls.length },
    ...(report?.riskSignals.length || report?.escalatedAt
      ? [{ key: 'escalation' as Tab, label: 'Concerns', icon: ShieldAlert, badge: report?.riskSignals.length }]
      : []),
    { key: 'activity', label: 'Activity', icon: History, badge: report?.events.length },
  ]

  return (
    <div className="fixed inset-0 z-[60] flex justify-end">
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-[2px]" onClick={onClose} />

      <aside className="relative flex h-full w-full max-w-4xl flex-col bg-slate-50 shadow-2xl">
        {/* Header */}
        <header className="shrink-0 border-b border-slate-200 bg-white px-6 py-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="truncate text-xl font-extrabold tracking-tight text-slate-900">
                  {report?.bookingRef ?? '—'}
                </h2>
                {report && <StatusPill status={report.status} />}
                {report && <RiskPill level={report.riskLevel} score={report.riskScore} />}
              </div>
              <p className="mt-1 truncate text-sm text-slate-500">
                {facts?.clientName ?? report?.clientName ?? 'Guest'}
                <span className="mx-1.5 text-slate-300">·</span>
                {fmtDate(report?.arrivalDate)} → {fmtDate(report?.departureDate)}
                {report?.agentName && (
                  <>
                    <span className="mx-1.5 text-slate-300">·</span>
                    {report.agentName}
                  </>
                )}
              </p>
            </div>
            <button
              onClick={onClose}
              className="shrink-0 rounded-lg p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
              aria-label="Close"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Tabs */}
          <nav className="mt-4 flex gap-1 overflow-x-auto">
            {tabs.map(t => {
              const Icon = t.icon
              const active = tab === t.key
              return (
                <button
                  key={t.key}
                  onClick={() => setTab(t.key)}
                  className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-[12.5px] font-bold transition ${
                    active ? 'bg-violet-600 text-white shadow-sm' : 'text-slate-500 hover:bg-slate-100'
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {t.label}
                  {!!t.badge && (
                    <span className={`rounded-full px-1.5 text-[10px] ${active ? 'bg-white/25' : 'bg-slate-200 text-slate-600'}`}>
                      {t.badge}
                    </span>
                  )}
                </button>
              )
            })}
          </nav>
        </header>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {loading ? (
            <div className="flex h-64 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-violet-500" />
            </div>
          ) : !report ? (
            <Empty icon={FileWarning} title="This report could not be loaded." />
          ) : (
            <>
              {/* The hold banner outranks the tabs — it is the first thing to read. */}
              {isHeld && (
                <div className="mb-5 overflow-hidden rounded-2xl border-2 border-rose-200 bg-rose-50">
                  <div className="flex items-start gap-3 px-5 py-4">
                    <Hand className="mt-0.5 h-5 w-5 shrink-0 text-rose-600" strokeWidth={2.4} />
                    <div className="min-w-0">
                      <p className="text-sm font-extrabold text-rose-900">
                        Held — {report.agentName ?? 'the agent'} has not been told about this trip.
                      </p>
                      {report.holdReason && (
                        <p className="mt-1 text-[13px] leading-relaxed text-rose-700">{report.holdReason}</p>
                      )}
                      <p className="mt-2 text-[12px] text-rose-600">
                        {report.escalatedAt
                          ? `Escalated to ${report.escalationTo} · ${fmtDateTime(report.escalatedAt)}`
                          : `Not yet escalated. Send it to ${report.escalationTo ?? 'the escalation inbox'} so it can be resolved.`}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Awaiting write-up — nothing was sent and nothing can be until
                  somebody writes what the trip was actually like. */}
              {isPending && (
                <div className="mb-5 overflow-hidden rounded-2xl border-2 border-violet-200 bg-violet-50">
                  <div className="flex items-start gap-3 px-5 pt-4">
                    <PenLine className="mt-0.5 h-5 w-5 shrink-0 text-violet-600" strokeWidth={2.4} />
                    <div className="min-w-0">
                      <p className="text-sm font-extrabold text-violet-900">
                        Nothing came back from this trip — no call was answered and no feedback form was filled in.
                      </p>
                      <p className="mt-1 text-[13px] leading-relaxed text-violet-700">
                        So nothing was sent automatically. Write what you know about how the trip went and we will
                        build the agent&apos;s report from it. It is graded for problems exactly like any other report,
                        so if what you write reads badly it will be held rather than sent.
                      </p>
                    </div>
                  </div>

                  <div className="px-5 pb-5 pt-3.5">
                    <textarea
                      rows={5}
                      value={writeUp}
                      onChange={e => setWriteUp(e.target.value)}
                      placeholder="Spoke to the guest on the last morning. They were happy with the Hanoi hotel and loved the Ha Long cruise; the Day 3 driver was late by about 40 minutes but they were relaxed about it…"
                      className="w-full resize-y rounded-xl border border-violet-200 bg-white px-3.5 py-3 text-[13.5px] leading-relaxed text-slate-700 outline-none transition focus:border-violet-400 focus:ring-4 focus:ring-violet-100"
                    />
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <button
                        onClick={() => act('writeup', { text: writeUp.trim() }, 'writeup')}
                        disabled={!!busy || !writeUp.trim()}
                        className="inline-flex items-center gap-2 rounded-xl bg-violet-600 px-5 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-violet-700 disabled:opacity-50"
                      >
                        {busy === 'writeup' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                        Write the report from this
                      </button>
                      <p className="text-[11.5px] text-violet-600">
                        Saved on the report only — the booking record is not changed.
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {isSent && (
                <div className="mb-5 flex items-start gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4">
                  <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" strokeWidth={2.4} />
                  <div className="min-w-0 text-[13px] leading-relaxed text-emerald-800">
                    <p className="font-extrabold">Sent to {report.toEmail}</p>
                    <p className="mt-0.5 text-emerald-700">
                      {fmtDateTime(report.sentAt)}{report.sentBy ? ` · by ${report.sentBy}` : ''}
                      {report.ccEmails.length > 0 && <> · cc {report.ccEmails.join(', ')}</>}
                    </p>
                    {clientMail?.sentAt && (
                      <button
                        onClick={() => setTab('letter')}
                        className="mt-1.5 inline-flex items-center gap-1.5 text-[12px] font-bold text-emerald-700 underline decoration-emerald-300 underline-offset-2"
                      >
                        <Heart className="h-3 w-3" />
                        {clientMail.to} was written to as well — read the letter
                      </button>
                    )}
                  </div>
                </div>
              )}

              {report.lastError && (
                <div className="mb-5 flex items-start gap-3 rounded-2xl border border-orange-200 bg-orange-50 px-5 py-4">
                  <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-orange-600" />
                  <p className="text-[13px] leading-relaxed text-orange-800">{report.lastError}</p>
                </div>
              )}

              {/* ── Report tab ───────────────────────────────────────────── */}
              {tab === 'report' && (
                <div className="space-y-5">
                  {narrative ? (
                    <>
                      <div className="rounded-2xl border border-violet-100 bg-white p-6">
                        {narrative.overallScore && (
                          <span className="mb-3 inline-block rounded-full bg-gradient-to-br from-violet-600 to-indigo-600 px-4 py-1.5 text-[12px] font-extrabold text-white">
                            {narrative.overallScore}
                          </span>
                        )}
                        <h3 className="text-[22px] font-extrabold leading-snug tracking-tight text-slate-900">
                          {narrative.headline}
                        </h3>
                        <p className="mt-3 text-[14px] leading-[1.8] text-slate-600">{narrative.opening}</p>
                      </div>

                      {!!dossier?.places.length && (
                        <div className="rounded-2xl border border-slate-200 bg-white p-5">
                          <SectionLabel>Places visited</SectionLabel>
                          <div className="flex flex-wrap gap-1.5">
                            {dossier.places.map(p => (
                              <span key={p} className="inline-flex items-center gap-1 rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1 text-[12px] font-bold text-indigo-700">
                                <MapPin className="h-3 w-3" />{p}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}

                      {narrative.journeyStory && (
                        <div className="rounded-2xl border border-slate-200 bg-white p-5">
                          <SectionLabel>How the trip unfolded</SectionLabel>
                          <p className="whitespace-pre-line text-[14px] leading-[1.8] text-slate-600">{narrative.journeyStory}</p>
                        </div>
                      )}

                      {narrative.guestVoice && (
                        <div className="rounded-2xl border-l-4 border-emerald-400 bg-emerald-50 p-5">
                          <SectionLabel>In the client&apos;s words</SectionLabel>
                          <p className="whitespace-pre-line text-[14px] leading-[1.8] text-emerald-900">{narrative.guestVoice}</p>
                        </div>
                      )}

                      <div className="rounded-2xl border border-slate-200 bg-white p-5">
                        <SectionLabel>Feedback summary</SectionLabel>
                        <p className="whitespace-pre-line text-[14px] leading-[1.8] text-slate-600">{narrative.feedbackSummary}</p>
                      </div>

                      {Object.values(narrative.serviceNotes).some(Boolean) && (
                        <div className="grid gap-3 sm:grid-cols-2">
                          {([
                            ['🏨', 'Accommodation', narrative.serviceNotes.accommodation],
                            ['🍽️', 'Dining', narrative.serviceNotes.dining],
                            ['🚘', 'Transport', narrative.serviceNotes.transport],
                            ['🧭', 'Guiding', narrative.serviceNotes.guiding],
                          ] as const).filter(([, , v]) => v).map(([icon, label, value]) => (
                            <div key={label} className="rounded-2xl border border-slate-200 bg-white p-4">
                              <p className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">{icon} {label}</p>
                              <p className="mt-1.5 text-[13px] leading-relaxed text-slate-600">{value}</p>
                            </div>
                          ))}
                        </div>
                      )}

                      {narrative.issuesSummary && (
                        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5">
                          <SectionLabel>Points being followed up</SectionLabel>
                          <p className="whitespace-pre-line text-[14px] leading-[1.8] text-amber-900">{narrative.issuesSummary}</p>
                        </div>
                      )}

                      {!!narrative.keyThemes.length && (
                        <div className="rounded-2xl border border-slate-200 bg-white p-5">
                          <SectionLabel>Key observations</SectionLabel>
                          <ul className="space-y-1.5">
                            {narrative.keyThemes.map((t, i) => (
                              <li key={i} className="flex gap-2 text-[13px] leading-relaxed text-slate-600">
                                <span className="text-violet-400">◆</span>{t}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </>
                  ) : (
                    <Empty icon={Sparkles} title="No narrative has been written yet." hint="Use Rewrite to generate one from the evidence." />
                  )}

                  {/* Trip facts */}
                  {facts && (
                    <div className="rounded-2xl border border-slate-200 bg-white p-5">
                      <SectionLabel>Trip details</SectionLabel>
                      <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
                        {([
                          ['Client', facts.clientName],
                          ['Travelling party', facts.passengers.join(', ') || null],
                          ['Party size', `${facts.pax.adults} adult(s)${facts.pax.children ? `, ${facts.pax.children} child(ren)` : ''}${facts.pax.infants ? `, ${facts.pax.infants} infant(s)` : ''}`],
                          ['Travel dates', `${fmtDate(facts.arrivalDate)} → ${fmtDate(facts.departureDate)}`],
                          ['Duration', facts.nights != null ? `${facts.nights} nights` : null],
                          ['Destination', facts.destination],
                          ['Occasion', facts.specialOccasions],
                          ['Agent', facts.agentName],
                          ['Agent email', facts.agentEmail],
                          ['Contact number', facts.callPhone],
                        ] as const).filter(([, v]) => v).map(([label, value]) => (
                          <div key={label}>
                            <dt className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">{label}</dt>
                            <dd className="mt-0.5 text-[13.5px] font-semibold text-slate-700">{value}</dd>
                          </div>
                        ))}
                      </dl>
                    </div>
                  )}

                  {!!dossier?.warnings.length && (
                    <div className="rounded-2xl border border-slate-200 bg-slate-100 p-4">
                      <SectionLabel>Gaps in the evidence</SectionLabel>
                      <ul className="space-y-1">
                        {dossier.warnings.map((w, i) => (
                          <li key={i} className="text-[12px] text-slate-500">• {w}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}

              {/* ── Email tab ────────────────────────────────────────────── */}
              {tab === 'email' && (
                <div className="space-y-4">
                  <div className="rounded-2xl border border-slate-200 bg-white p-5">
                    <SectionLabel>{isSent ? 'As delivered' : 'Ready to send'}</SectionLabel>
                    <dl className="space-y-2 text-[13px]">
                      <div className="flex gap-3">
                        <dt className="w-20 shrink-0 font-bold text-slate-400">To</dt>
                        <dd className="font-semibold text-slate-700">
                          {report.toEmail ?? facts?.agentEmail ?? <span className="text-rose-500">no agent email on file</span>}
                        </dd>
                      </div>
                      {report.ccEmails.length > 0 && (
                        <div className="flex gap-3">
                          <dt className="w-20 shrink-0 font-bold text-slate-400">Cc</dt>
                          <dd className="text-slate-600">{report.ccEmails.join(', ')}</dd>
                        </div>
                      )}
                      <div className="flex gap-3">
                        <dt className="w-20 shrink-0 font-bold text-slate-400">Subject</dt>
                        <dd className="font-semibold text-slate-700">{report.subject ?? '—'}</dd>
                      </div>
                    </dl>
                    <p className="mt-4 flex items-start gap-2 rounded-xl bg-slate-50 px-3 py-2.5 text-[11.5px] leading-relaxed text-slate-500">
                      <Eye className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      Call transcripts are deliberately left out of this mail. They stay internal and are read under
                      <button onClick={() => setTab('evidence')} className="mx-1 font-bold text-violet-600 underline">Evidence</button>.
                    </p>
                  </div>

                  {report.bodyHtml ? (
                    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
                      <iframe
                        title="Report email preview"
                        srcDoc={report.bodyHtml}
                        sandbox=""
                        className="h-[1200px] w-full border-0"
                      />
                    </div>
                  ) : (
                    <Empty icon={Mail} title="No mail body has been prepared." hint="Rewrite the report to build one." />
                  )}
                </div>
              )}

              {/* ── Guest letter tab ─────────────────────────────────────── */}
              {tab === 'letter' && (
                <div className="space-y-4">
                  {clientMail ? (
                    <>
                      <div className="rounded-2xl border border-amber-200 bg-amber-50/60 p-5">
                        <SectionLabel>{clientMail.sentAt ? 'Sent to the traveller' : 'Not sent'}</SectionLabel>
                        <dl className="space-y-2 text-[13px]">
                          <div className="flex gap-3">
                            <dt className="w-20 shrink-0 font-bold text-slate-400">To</dt>
                            <dd className="font-semibold text-slate-700">{clientMail.to ?? '—'}</dd>
                          </div>
                          {clientMail.cc.length > 0 && (
                            <div className="flex gap-3">
                              <dt className="w-20 shrink-0 font-bold text-slate-400">Cc</dt>
                              <dd className="text-slate-600">{clientMail.cc.join(', ')}</dd>
                            </div>
                          )}
                          <div className="flex gap-3">
                            <dt className="w-20 shrink-0 font-bold text-slate-400">Subject</dt>
                            <dd className="font-semibold text-slate-700">{clientMail.subject}</dd>
                          </div>
                          <div className="flex gap-3">
                            <dt className="w-20 shrink-0 font-bold text-slate-400">When</dt>
                            <dd className="text-slate-600">
                              {clientMail.sentAt ? fmtDateTime(clientMail.sentAt) : 'Written but never sent'}
                              {clientMail.testMode && (
                                <span className="ml-2 rounded-md bg-slate-900 px-1.5 py-0.5 text-[10px] font-bold text-white">
                                  test mode — redirected
                                </span>
                              )}
                            </dd>
                          </div>
                        </dl>
                        {clientMail.error && (
                          <p className="mt-3 rounded-xl bg-white px-3 py-2.5 text-[12px] leading-relaxed text-rose-700 ring-1 ring-rose-200">
                            {clientMail.error}
                          </p>
                        )}
                        <p className="mt-4 flex items-start gap-2 rounded-xl bg-white/70 px-3 py-2.5 text-[11.5px] leading-relaxed text-slate-500">
                          <Heart className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                          This is written for the traveller, not the agent — no ratings, no booking reference and
                          nothing about how the trip was graded. A held trip never gets one.
                        </p>
                      </div>

                      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
                        <iframe
                          title="Traveller letter preview"
                          srcDoc={clientMail.bodyHtml}
                          sandbox=""
                          className="h-[900px] w-full border-0"
                        />
                      </div>
                    </>
                  ) : (
                    <Empty
                      icon={Heart}
                      title="No letter has been written yet."
                      hint="One is written and sent to the traveller when the agent's report goes out on a trip that was not held."
                    />
                  )}
                </div>
              )}

              {/* ── Evidence tab ─────────────────────────────────────────── */}
              {tab === 'evidence' && dossier && (
                <div className="space-y-5">
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    {([
                      ['Calls answered', `${dossier.stats.callsAnswered}/${dossier.stats.callsScheduled}`, PhoneCall],
                      ['Positive', String(dossier.stats.positive), CheckCircle2],
                      ['Negative', String(dossier.stats.negative), AlertTriangle],
                      ['Issues logged', String(dossier.stats.issuesLogged), FileWarning],
                    ] as const).map(([label, value, Icon]) => (
                      <div key={label} className="rounded-2xl border border-slate-200 bg-white p-4">
                        <Icon className="h-4 w-4 text-slate-300" />
                        <p className="mt-2 text-xl font-extrabold text-slate-900">{value}</p>
                        <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{label}</p>
                      </div>
                    ))}
                  </div>

                  {dossier.form && (
                    <div className="rounded-2xl border border-slate-200 bg-white p-5">
                      <SectionLabel>Feedback form the guest filled in</SectionLabel>
                      <p className="mb-3 text-[11px] text-slate-400">
                        Submitted {fmtDateTime(dossier.form.submittedAt)}
                        {dossier.form.purpose && ` · ${dossier.form.purpose} travel`}
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {([
                          ['Room', dossier.form.accommodationRoom],
                          ['Hotel food', dossier.form.accommodationFood],
                          ['Restaurant food', dossier.form.restaurantFood],
                          ['Ambience', dossier.form.restaurantAmbience],
                          ['Vehicle', dossier.form.transportVehicle],
                          ['Driver', dossier.form.transportDriver],
                          ['Overall', dossier.form.overallExperience],
                        ] as const).filter(([, v]) => v).map(([label, value]) => (
                          <span key={label} className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${ratingTone(value)}`}>
                            {label} · {value}
                          </span>
                        ))}
                      </div>
                      {dossier.form.remarks && (
                        <p className="mt-3 rounded-xl bg-slate-50 px-3.5 py-2.5 text-[13px] leading-relaxed text-slate-600">
                          “{dossier.form.remarks}”
                        </p>
                      )}
                    </div>
                  )}

                  {!!dossier.deskNotes.length && (
                    <div className="rounded-2xl border border-slate-200 bg-white p-5">
                      <SectionLabel>Recorded by our desk</SectionLabel>
                      {dossier.deskNotes.map((n, i) => (
                        <div key={i} className="text-[13px] leading-relaxed text-slate-600">
                          {n.rating != null && <span className="mr-2 font-extrabold text-slate-900">{n.rating}/5</span>}
                          {n.comment ?? <span className="italic text-slate-400">no comment</span>}
                          <span className="ml-2 text-[11px] text-slate-400">
                            {n.savedBy ? `— ${n.savedBy}, ` : ''}{fmtDate(n.createdAt)}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}

                  <div>
                    <SectionLabel>Follow-up calls · transcripts are internal only</SectionLabel>
                    {dossier.calls.length ? (
                      <div className="space-y-3">
                        {dossier.calls.map((c, i) => <CallCard key={i} call={c} />)}
                      </div>
                    ) : (
                      <Empty icon={PhoneCall} title="No calls were logged for this trip." />
                    )}
                  </div>

                  {!!dossier.itinerary.length && (
                    <div className="rounded-2xl border border-slate-200 bg-white p-5">
                      <SectionLabel>Itinerary as sold</SectionLabel>
                      <ol className="space-y-2">
                        {dossier.itinerary.map(stop => (
                          <li key={stop.dayNo} className="flex gap-3">
                            <span className="mt-0.5 h-fit shrink-0 rounded-md bg-slate-900 px-2 py-0.5 text-[9px] font-extrabold text-white">
                              D{stop.dayNo}
                            </span>
                            <div className="min-w-0">
                              <p className="text-[13px] font-semibold text-slate-700">{stop.title}</p>
                              <p className="text-[11px] text-slate-400">{fmtDateShort(stop.date)}</p>
                            </div>
                          </li>
                        ))}
                      </ol>
                    </div>
                  )}
                </div>
              )}

              {/* ── Concerns tab ─────────────────────────────────────────── */}
              {tab === 'escalation' && (
                <div className="space-y-5">
                  <div className="rounded-2xl border border-slate-200 bg-white p-5">
                    <div className="mb-4 flex items-center justify-between">
                      <SectionLabel>What the grading found</SectionLabel>
                      <RiskPill level={report.riskLevel} score={report.riskScore} />
                    </div>
                    {report.riskSignals.length ? (
                      <div className="space-y-2">
                        {report.riskSignals.map((s, i) => (
                          <div key={i} className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                            <div className="flex items-start justify-between gap-3">
                              <p className="text-[13px] font-extrabold text-slate-800">
                                {s.label}
                                {s.dayNo && <span className="ml-1.5 font-semibold text-slate-400">day {s.dayNo}</span>}
                              </p>
                              <span className="shrink-0 rounded-md bg-white px-1.5 py-0.5 text-[10px] font-bold text-slate-400 ring-1 ring-slate-200">
                                +{s.weight}
                              </span>
                            </div>
                            <p className="mt-1 text-[12.5px] leading-relaxed text-slate-500">{s.detail}</p>
                            <p className="mt-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                              {s.channel === 'ai_call' ? 'Follow-up call' : s.channel === 'guest_form' ? 'Feedback form' : 'Desk note'}
                            </p>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-[13px] text-slate-500">
                        Nothing was flagged. This trip reads as a clean experience.
                      </p>
                    )}
                  </div>

                  {report.resolutionNote && (
                    <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5">
                      <SectionLabel>How it was resolved</SectionLabel>
                      <p className="text-[13.5px] leading-relaxed text-emerald-900">{report.resolutionNote}</p>
                      {report.releasedBy && (
                        <p className="mt-2 text-[11px] text-emerald-600">
                          {report.releasedBy} · {fmtDateTime(report.releasedAt)}
                        </p>
                      )}
                    </div>
                  )}

                  {report.escalationHtml && (
                    <div>
                      <SectionLabel>
                        {report.escalatedAt
                          ? `Escalation sent to ${report.escalationTo}`
                          : `Escalation ready for ${report.escalationTo}`}
                      </SectionLabel>
                      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
                        <iframe
                          title="Escalation email preview"
                          srcDoc={report.escalationHtml}
                          sandbox=""
                          className="h-[900px] w-full border-0"
                        />
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* ── Activity tab ─────────────────────────────────────────── */}
              {tab === 'activity' && (
                <div className="rounded-2xl border border-slate-200 bg-white p-5">
                  <SectionLabel>Everything that happened to this report</SectionLabel>
                  {report.events.length ? (
                    <ol className="relative space-y-4 border-l border-slate-200 pl-5">
                      {[...report.events].reverse().map((e, i) => (
                        <li key={i} className="relative">
                          <span className="absolute -left-[25px] top-1.5 h-2 w-2 rounded-full bg-violet-400 ring-4 ring-white" />
                          <p className="text-[13px] font-extrabold capitalize text-slate-800">
                            {e.action.replace(/_/g, ' ')}
                          </p>
                          {e.detail && <p className="mt-0.5 text-[12.5px] leading-relaxed text-slate-500">{e.detail}</p>}
                          <p className="mt-1 flex items-center gap-1.5 text-[11px] text-slate-400">
                            <Clock className="h-3 w-3" />
                            {fmtDateTime(e.at)}
                            {e.actor && <> · {e.actor}</>}
                          </p>
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <p className="text-[13px] text-slate-400">Nothing recorded yet.</p>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* Action bar */}
        {report && !loading && (
          <footer className="shrink-0 border-t border-slate-200 bg-white px-6 py-4">
            {!isClosed && !isPending && (
              <div className="mb-3 flex items-center gap-2">
                <label className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">Send to</label>
                <input
                  value={agentEmail}
                  onChange={e => setAgentEmail(e.target.value)}
                  placeholder="agent@example.com"
                  className="min-w-0 flex-1 rounded-lg border border-slate-200 px-3 py-1.5 text-[13px] text-slate-700 outline-none transition focus:border-violet-400 focus:ring-4 focus:ring-violet-50"
                />
                <ChannelChips channels={report.sources} />
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2">
              {isPending ? (
                <p className="inline-flex items-center gap-2 rounded-xl bg-violet-50 px-4 py-2.5 text-[12.5px] font-bold text-violet-700">
                  <PenLine className="h-4 w-4" />
                  Write the summary above before this can be sent.
                </p>
              ) : isHeld ? (
                <>
                  <button
                    onClick={() => act('escalate', {}, 'escalate')}
                    disabled={!!busy}
                    className="inline-flex items-center gap-2 rounded-xl bg-rose-600 px-5 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-rose-700 disabled:opacity-60"
                  >
                    {busy === 'escalate' ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUpRight className="h-4 w-4" />}
                    {report.escalatedAt ? 'Escalate again' : `Escalate to ${report.escalationTo ?? 'reviewer'}`}
                  </button>

                  <button
                    onClick={() => setPrompt({
                      title: 'Clear the hold',
                      intro: 'Say how the client’s problem was resolved. The report goes back to the review queue — it is not sent yet.',
                      label: 'How it was resolved',
                      placeholder: 'Spoke to the client, hotel refunded the second night, client is happy…',
                      confirmLabel: 'Clear hold',
                      tone: 'primary',
                      required: true,
                      run: note => act('release', { note }, 'release'),
                    })}
                    disabled={!!busy}
                    className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-bold text-slate-600 ring-1 ring-slate-200 transition hover:bg-slate-50 disabled:opacity-60"
                  >
                    <CheckCircle2 className="h-4 w-4" />
                    Clear hold
                  </button>

                  <button
                    onClick={() => setPrompt({
                      title: 'Send to the agent anyway',
                      intro: 'This trip was flagged as a bad experience. Sending it now means the agent receives the standard report regardless. Your note is kept on the record.',
                      label: 'Why you are overriding the hold',
                      placeholder: 'Client confirmed they are satisfied after our call on 14 Aug…',
                      confirmLabel: 'Override and send',
                      tone: 'danger',
                      required: true,
                      run: note => act('send', {
                        note, overrideHold: true, agentEmailOverride: agentEmail.trim() || null,
                      }, 'send'),
                    })}
                    disabled={!!busy}
                    className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold text-rose-600 transition hover:bg-rose-50 disabled:opacity-60"
                  >
                    <Send className="h-4 w-4" />
                    Send anyway
                  </button>
                </>
              ) : !isClosed ? (
                <>
                  <button
                    onClick={() => act('send', { agentEmailOverride: agentEmail.trim() || null }, 'send')}
                    disabled={!!busy}
                    className="inline-flex items-center gap-2 rounded-xl bg-violet-600 px-5 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-violet-700 disabled:opacity-60"
                  >
                    {busy === 'send' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                    Send to agent
                  </button>

                  <button
                    onClick={() => setPrompt({
                      title: 'Hold this report',
                      intro: 'It will not reach the agent until someone clears the hold.',
                      label: 'Why',
                      placeholder: 'Client called to complain about the Da Nang hotel…',
                      confirmLabel: 'Hold it',
                      tone: 'danger',
                      required: true,
                      run: reason => act('hold', { reason }, 'hold'),
                    })}
                    disabled={!!busy}
                    className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-bold text-slate-600 ring-1 ring-slate-200 transition hover:bg-slate-50 disabled:opacity-60"
                  >
                    <Hand className="h-4 w-4" />
                    Hold
                  </button>

                  <button
                    onClick={() => act('escalate', {}, 'escalate')}
                    disabled={!!busy}
                    className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-bold text-slate-600 ring-1 ring-slate-200 transition hover:bg-slate-50 disabled:opacity-60"
                  >
                    <ArrowUpRight className="h-4 w-4" />
                    Escalate instead
                  </button>
                </>
              ) : null}

              {/* The letter normally rides along with the agent send. This is
                  the retry for when it did not, and the way to send it late. */}
              {isSent && !isHeld && !clientMail?.sentAt && (
                <button
                  onClick={() => act('client_mail', {}, 'client_mail')}
                  disabled={!!busy}
                  className="inline-flex items-center gap-2 rounded-xl bg-amber-500 px-4 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-amber-600 disabled:opacity-60"
                >
                  {busy === 'client_mail' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Heart className="h-4 w-4" />}
                  {clientMail?.error ? 'Retry the guest letter' : 'Send the guest their letter'}
                </button>
              )}

              {!isSent && (
                <button
                  onClick={() => act('regenerate', {}, 'regenerate')}
                  disabled={!!busy}
                  className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold text-slate-500 transition hover:bg-slate-100 disabled:opacity-60"
                >
                  {busy === 'regenerate' ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                  Rewrite
                </button>
              )}

              <button
                onClick={() => setPrompt({
                  title: 'Add a note',
                  intro: 'Kept on the report’s activity trail for whoever picks it up next.',
                  label: 'Note',
                  placeholder: 'Called the client — waiting for the hotel to come back to us.',
                  confirmLabel: 'Add note',
                  tone: 'primary',
                  required: true,
                  run: note => act('note', { note }, 'note'),
                })}
                disabled={!!busy}
                className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold text-slate-500 transition hover:bg-slate-100 disabled:opacity-60"
              >
                <MessageSquareText className="h-4 w-4" />
                Note
              </button>

              {!isClosed && (
                <button
                  onClick={() => setPrompt({
                    title: 'Cancel this report',
                    intro: 'Closes it without sending. The record stays in the history.',
                    label: 'Reason (optional)',
                    placeholder: 'Duplicate — a report already went out for this trip.',
                    confirmLabel: 'Cancel report',
                    tone: 'danger',
                    required: false,
                    run: reason => act('cancel', { reason }, 'cancel'),
                  })}
                  disabled={!!busy}
                  className="ml-auto inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold text-slate-400 transition hover:bg-slate-100 hover:text-rose-600 disabled:opacity-60"
                >
                  <Ban className="h-4 w-4" />
                  Cancel
                </button>
              )}
            </div>

            <p className="mt-2.5 flex items-center gap-1.5 text-[11px] text-slate-400">
              <Users className="h-3 w-3" />
              Built {fmtRelative(report.createdAt)}{report.createdBy ? ` by ${report.createdBy}` : ''}
              {report.triggerSource === 'auto' && ' · automatic post-trip sweep'}
            </p>
          </footer>
        )}
      </aside>

      {prompt && <NotePrompt spec={prompt} onDismiss={() => setPrompt(null)} />}
    </div>
  )
}
