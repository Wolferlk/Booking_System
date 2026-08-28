'use client'

/**
 * Auto Reports — scheduled operations reports by email.
 *
 * One screen for the whole feature:
 *   1. Health strip — is the automation on, how many schedules, anything failing
 *   2. Schedule cards — cadence, recipients, contents, last and next run
 *   3. Preview / test / send-now, without leaving the page
 *   4. Delivery history, so "did the 8am go out?" is answerable at a glance
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import {
  AlertTriangle, Bot, CalendarClock, CheckCircle2, Clock, FileSpreadsheet,
  Globe2, Loader2, Mail, MailCheck, MoreHorizontal, Pause, Play, Plus,
  RefreshCw, Send, ShieldCheck, Trash2, Users, XCircle, Zap,
} from 'lucide-react'
import Header from '@/components/layout/header'
import { cn, readApiResponse } from '@/lib/utils'
import ScheduleEditor from './schedule-editor'
import PreviewDrawer, { previewRequestFor, type PreviewRequest } from './preview-drawer'
import {
  COUNTRY_OPTIONS, REPORT_TYPE_OPTIONS, sectionOptionsFor,
  type AutoReportPayload, type ReportType, type RunLog, type Schedule,
} from './types'

// ─── Formatting helpers ───────────────────────────────────────────────────────

function timeAgo(iso: string | null): string {
  if (!iso) return 'never'
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return 'never'
  const secs = Math.round((Date.now() - t) / 1000)
  if (secs < 60) return 'just now'
  const mins = Math.round(secs / 60)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.round(hrs / 24)}d ago`
}

/**
 * `nextRunAt` is a *local wall-clock* string in the schedule's own timezone, so
 * it is formatted as text rather than parsed as an instant — parsing it would
 * silently re-interpret it in the viewer's zone.
 */
function formatNextRun(local: string | null, timezone: string): string {
  if (!local) return 'not scheduled'
  const [date, time] = local.split('T')
  const label = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC', weekday: 'short', day: '2-digit', month: 'short',
  }).format(new Date(`${date}T00:00:00Z`))
  return `${label}, ${time?.slice(0, 5)} ${timezone.split('/').pop()?.replace(/_/g, ' ')}`
}

const STATUS_META: Record<string, { cls: string; icon: typeof CheckCircle2; label: string }> = {
  ok: { cls: 'text-emerald-600 bg-emerald-50 border-emerald-200', icon: CheckCircle2, label: 'Delivered' },
  error: { cls: 'text-red-600 bg-red-50 border-red-200', icon: XCircle, label: 'Failed' },
  skipped: { cls: 'text-slate-500 bg-slate-50 border-slate-200', icon: Pause, label: 'Skipped' },
}

/** What the shared run-log figures mean, per report type. */
const FIGURE_LABELS: Record<'OPS' | 'RECONCILIATION', { created: string; onGround: string; complaints: string }> = {
  OPS: { created: 'created', onGround: 'on ground', complaints: 'complaints' },
  RECONCILIATION: { created: 'confirmed', onGround: 'B2C orders', complaints: 'findings' },
}

const PERIOD_TINT: Record<string, string> = {
  DAILY: 'bg-teal-50 text-teal-700 border-teal-200',
  WEEKLY: 'bg-blue-50 text-blue-700 border-blue-200',
  MONTHLY: 'bg-violet-50 text-violet-700 border-violet-200',
}

// ─── Small presentational pieces ──────────────────────────────────────────────

function StatTile({
  icon, label, value, sub, tone = 'slate',
}: {
  icon: React.ReactNode
  label: string
  value: string | number
  sub?: string
  tone?: 'slate' | 'teal' | 'red' | 'amber'
}) {
  const tones = {
    slate: 'text-slate-500 bg-slate-100',
    teal: 'text-teal-600 bg-teal-50',
    red: 'text-red-600 bg-red-50',
    amber: 'text-amber-600 bg-amber-50',
  }
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4 flex items-start gap-3">
      <div className={cn('p-2 rounded-lg flex-shrink-0', tones[tone])}>{icon}</div>
      <div className="min-w-0">
        <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">{label}</div>
        <div className="text-2xl font-extrabold text-slate-900 leading-tight mt-0.5">{value}</div>
        {sub && <div className="text-[11px] text-slate-500 truncate">{sub}</div>}
      </div>
    </div>
  )
}

function Chip({ children, tone = 'slate' }: { children: React.ReactNode; tone?: string }) {
  return (
    <span className={cn(
      'inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold border',
      tone === 'slate' ? 'bg-slate-50 text-slate-600 border-slate-200' : tone,
    )}>
      {children}
    </span>
  )
}

// ─── Schedule card ────────────────────────────────────────────────────────────

function ScheduleCard({
  s, busy, onEdit, onPreview, onToggle, onSend, onTest, onDelete,
}: {
  s: Schedule
  busy: string | null
  onEdit: () => void
  onPreview: () => void
  onToggle: () => void
  onSend: () => void
  onTest: () => void
  onDelete: () => void
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const status = s.lastStatus ? STATUS_META[s.lastStatus] : null
  const StatusIcon = status?.icon
  const isBusy = busy === s.id

  const sections = sectionOptionsFor(s.reportType).filter(o => s.sections[o.key])
  const countryLabel = s.countries.length
    ? s.countries.map(c => COUNTRY_OPTIONS.find(o => o.value === c)?.label ?? c).join(', ')
    : 'All countries'

  return (
    <div className={cn(
      'bg-white rounded-xl border transition-all relative',
      s.enabled ? 'border-slate-200 hover:border-slate-300 hover:shadow-md' : 'border-slate-200 bg-slate-50/60',
    )}>
      {/* Top */}
      <div className="p-4 pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className={cn('font-bold truncate', s.enabled ? 'text-slate-900' : 'text-slate-500')}>
                {s.name}
              </h3>
              <span className={cn('px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wide border', PERIOD_TINT[s.period])}>
                {s.period}
              </span>
              {s.reportType === 'RECONCILIATION' && (
                <span className="px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wide border bg-violet-50 text-violet-700 border-violet-200">
                  Reconciliation
                </span>
              )}
              {!s.enabled && <Chip>Paused</Chip>}
            </div>
            <p className="text-xs text-slate-500 mt-1 flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 flex-shrink-0" />
              {s.cadence}
            </p>
          </div>

          <div className="relative flex-shrink-0">
            <button
              onClick={() => setMenuOpen(v => !v)}
              onBlur={() => setTimeout(() => setMenuOpen(false), 150)}
              className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors"
            >
              <MoreHorizontal className="w-4 h-4" />
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-9 z-20 w-48 bg-white rounded-lg border border-slate-200 shadow-lg py-1 animate-fade-in">
                <button onClick={onEdit} className="w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">Edit</button>
                <button onClick={onTest} className="w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">Send test to me</button>
                <button onClick={onSend} className="w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">Send now to everyone</button>
                <button onClick={onToggle} className="w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">
                  {s.enabled ? 'Pause schedule' : 'Resume schedule'}
                </button>
                <div className="h-px bg-slate-100 my-1" />
                <button onClick={onDelete} className="w-full text-left px-3 py-2 text-sm text-red-600 hover:bg-red-50 flex items-center gap-2">
                  <Trash2 className="w-3.5 h-3.5" /> Delete
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Meta grid */}
        <div className="grid grid-cols-2 gap-x-4 gap-y-2 mt-3 pt-3 border-t border-slate-100">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Next send</div>
            <div className="text-xs font-semibold text-slate-700 mt-0.5">
              {s.enabled ? formatNextRun(s.nextRunAt, s.timezone) : '—'}
            </div>
          </div>
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Last send</div>
            <div className="text-xs font-semibold text-slate-700 mt-0.5 flex items-center gap-1.5">
              {StatusIcon && status && <StatusIcon className={cn('w-3.5 h-3.5', status.cls.split(' ')[0])} />}
              {timeAgo(s.lastRunAt)}
              {s.lastRecipients ? <span className="text-slate-400 font-normal">· {s.lastRecipients} sent</span> : null}
            </div>
          </div>
        </div>

        {s.lastStatus === 'error' && s.lastError && (
          <div className="mt-3 px-2.5 py-2 rounded-lg bg-red-50 border border-red-200 text-[11px] text-red-700 flex gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-px" />
            <span className="line-clamp-2">{s.lastError}</span>
          </div>
        )}

        {/* Recipients + contents */}
        <div className="mt-3 flex flex-wrap gap-1.5">
          <Chip><Users className="w-3 h-3" />{s.to.length} to</Chip>
          {s.cc.length > 0 && <Chip>{s.cc.length} cc</Chip>}
          {s.bcc.length > 0 && <Chip>{s.bcc.length} bcc</Chip>}
          {/* Country scope is an operations-report idea; the reconciliation is
              deliberately never scoped by country. */}
          {s.reportType === 'RECONCILIATION'
            ? <Chip><Globe2 className="w-3 h-3" />All channels</Chip>
            : <Chip><Globe2 className="w-3 h-3" />{countryLabel}</Chip>}
          {s.attachCsv && <Chip><FileSpreadsheet className="w-3 h-3" />CSV</Chip>}
          {s.aiSummary && <Chip tone="bg-cyan-50 text-cyan-700 border-cyan-200"><Bot className="w-3 h-3" />AI summary</Chip>}
        </div>

        <div className="mt-2 text-[11px] text-slate-400 truncate" title={[...s.to, ...s.cc].join(', ')}>
          {[...s.to, ...s.cc].slice(0, 3).join(', ')}
          {s.to.length + s.cc.length > 3 && ` +${s.to.length + s.cc.length - 3} more`}
        </div>

        <div className="mt-2 text-[11px] text-slate-500">
          Includes: {sections.map(x => x.label).join(' · ') || 'nothing'}
        </div>
      </div>

      {/* Actions */}
      <div className="px-4 py-2.5 border-t border-slate-100 bg-slate-50/70 rounded-b-xl flex items-center gap-2">
        <button
          onClick={onPreview}
          className="px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-700 border border-slate-200 bg-white hover:bg-slate-50 transition-colors"
        >
          Preview
        </button>
        <button
          onClick={onTest}
          disabled={isBusy}
          className="px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-700 border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-50 transition-colors inline-flex items-center gap-1.5"
        >
          {isBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
          Test
        </button>
        <div className="flex-1" />
        <button
          onClick={onToggle}
          className={cn(
            'px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors inline-flex items-center gap-1.5',
            s.enabled
              ? 'text-slate-600 hover:bg-slate-200/70'
              : 'text-teal-700 bg-teal-50 hover:bg-teal-100',
          )}
        >
          {s.enabled ? <><Pause className="w-3.5 h-3.5" />Pause</> : <><Play className="w-3.5 h-3.5" />Resume</>}
        </button>
      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AutoReportsPage() {
  const [payload, setPayload] = useState<AutoReportPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [editorOpen, setEditorOpen] = useState(false)
  const [editing, setEditing] = useState<Schedule | null>(null)
  const [preview, setPreview] = useState<PreviewRequest | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<Schedule | null>(null)

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true)
    try {
      const res = await fetch('/api/reports/auto')
      const json = await readApiResponse<AutoReportPayload>(res)
      if (!json.success || !json.data) throw new Error(json.error || 'Could not load schedules')
      setPayload(json.data)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not load schedules')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  // Keeps "next send" and "last send" honest while the tab stays open.
  useEffect(() => {
    const t = setInterval(() => { void load(true) }, 60_000)
    return () => clearInterval(t)
  }, [load])

  const post = useCallback(async (body: unknown, successFallback: string) => {
    const res = await fetch('/api/reports/auto', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const json = await readApiResponse(res)
    if (!json.success) throw new Error(json.error || successFallback)
    return json
  }, [])

  const toggleSchedule = useCallback(async (s: Schedule) => {
    try {
      await post({ ...s, enabled: !s.enabled }, 'Could not update the schedule')
      toast.success(s.enabled ? `“${s.name}” paused` : `“${s.name}” resumed`)
      void load(true)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not update the schedule')
    }
  }, [post, load])

  const toggleMaster = useCallback(async () => {
    if (!payload) return
    try {
      const json = await post(
        { action: 'setMasterSwitch', enabled: !payload.masterEnabled },
        'Could not change the master switch',
      )
      toast.success(json.message ?? 'Updated')
      void load(true)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not change the master switch')
    }
  }, [payload, post, load])

  const send = useCallback(async (s: Schedule, mode: 'live' | 'test') => {
    setBusy(s.id)
    try {
      const res = await fetch('/api/reports/auto/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: s.id, mode }),
      })
      const json = await readApiResponse(res)
      if (!json.success) throw new Error(json.error || 'Send failed')
      toast.success(json.message ?? 'Report sent')
      void load(true)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Send failed')
    } finally {
      setBusy(null)
    }
  }, [load])

  const doDelete = useCallback(async (s: Schedule) => {
    try {
      const res = await fetch(`/api/reports/auto?id=${encodeURIComponent(s.id)}`, { method: 'DELETE' })
      const json = await readApiResponse(res)
      if (!json.success) throw new Error(json.error || 'Delete failed')
      toast.success(`“${s.name}” deleted`)
      setConfirmDelete(null)
      setEditorOpen(false)
      void load(true)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Delete failed')
    }
  }, [load])

  const schedules = useMemo(() => payload?.schedules ?? [], [payload])
  const runs = payload?.runs ?? []

  const grouped = useMemo(() => ({
    DAILY: schedules.filter(s => s.period === 'DAILY'),
    WEEKLY: schedules.filter(s => s.period === 'WEEKLY'),
    MONTHLY: schedules.filter(s => s.period === 'MONTHLY'),
  }), [schedules])

  const paused = payload && !payload.masterEnabled

  return (
    <div className="min-h-screen bg-slate-50">
      <Header
        title="Auto Reports"
        subtitle="Scheduled operations reports, delivered by email"
        actions={
          <div className="flex items-center gap-2">
            <button
              onClick={() => void load()}
              className="p-2 rounded-lg text-slate-500 hover:bg-slate-100 transition-colors"
              title="Refresh"
            >
              <RefreshCw className={cn('w-4 h-4', loading && 'animate-spin')} />
            </button>
            <button
              onClick={() => { setEditing(null); setEditorOpen(true) }}
              className="px-4 py-2 rounded-lg bg-teal-600 text-white text-sm font-semibold hover:bg-teal-700 transition-colors inline-flex items-center gap-2"
            >
              <Plus className="w-4 h-4" /> New schedule
            </button>
          </div>
        }
      />

      <div className="px-4 sm:px-8 py-6 space-y-6 max-w-[1400px]">
        {/* Master switch */}
        <div className={cn(
          'rounded-xl border p-4 flex items-center gap-4',
          paused ? 'bg-amber-50 border-amber-200' : 'bg-white border-slate-200',
        )}>
          <div className={cn('p-2.5 rounded-lg flex-shrink-0', paused ? 'bg-amber-100 text-amber-700' : 'bg-teal-50 text-teal-600')}>
            {paused ? <Pause className="w-5 h-5" /> : <ShieldCheck className="w-5 h-5" />}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-bold text-slate-900">
              {paused ? 'Automatic sending is paused' : 'Automatic sending is active'}
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              {paused
                ? 'No schedule will fire until this is switched back on. Manual sends still work.'
                : `Reports are sent from ${payload?.sender ?? '—'}. Schedules are evaluated every minute.`}
            </p>
          </div>
          <button
            onClick={() => void toggleMaster()}
            className={cn(
              'px-4 py-2 rounded-lg text-sm font-semibold transition-colors flex-shrink-0 inline-flex items-center gap-2',
              paused ? 'bg-teal-600 text-white hover:bg-teal-700' : 'border border-slate-200 text-slate-700 hover:bg-slate-50',
            )}
          >
            {paused ? <><Play className="w-4 h-4" />Resume all</> : <><Pause className="w-4 h-4" />Pause all</>}
          </button>
        </div>

        {/* Health */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatTile icon={<CalendarClock className="w-5 h-5" />} label="Schedules" value={payload?.summary.total ?? 0}
            sub={`${payload?.summary.enabled ?? 0} active`} tone="teal" />
          <StatTile icon={<Users className="w-5 h-5" />} label="Recipients" value={payload?.summary.recipients ?? 0}
            sub="unique addresses" />
          <StatTile icon={<MailCheck className="w-5 h-5" />} label="Sends logged" value={runs.filter(r => r.status === 'ok').length}
            sub="last 30 runs" />
          <StatTile icon={<AlertTriangle className="w-5 h-5" />} label="Failing" value={payload?.summary.failing ?? 0}
            sub={payload?.summary.failing ? 'needs attention' : 'all healthy'}
            tone={payload?.summary.failing ? 'red' : 'slate'} />
        </div>

        {/* Schedules */}
        {loading && !payload ? (
          <div className="py-20 flex flex-col items-center gap-3 text-slate-400">
            <Loader2 className="w-7 h-7 animate-spin" />
            <p className="text-sm">Loading schedules…</p>
          </div>
        ) : schedules.length === 0 ? (
          <div className="bg-white rounded-xl border border-dashed border-slate-300 p-12 text-center">
            <div className="w-14 h-14 rounded-2xl bg-teal-50 text-teal-600 flex items-center justify-center mx-auto">
              <Mail className="w-7 h-7" />
            </div>
            <h3 className="text-lg font-bold text-slate-900 mt-4">No report schedules yet</h3>
            <p className="text-sm text-slate-500 mt-1.5 max-w-md mx-auto">
              Create one to email yesterday&apos;s bookings, today&apos;s on-ground tours, complaints and the
              forward book to as many people as you like — every morning, week or month.
            </p>
            <button
              onClick={() => { setEditing(null); setEditorOpen(true) }}
              className="mt-5 px-5 py-2.5 rounded-lg bg-teal-600 text-white text-sm font-semibold hover:bg-teal-700 transition-colors inline-flex items-center gap-2"
            >
              <Plus className="w-4 h-4" /> Create the first schedule
            </button>
          </div>
        ) : (
          (['DAILY', 'WEEKLY', 'MONTHLY'] as const).map(period => {
            const list = grouped[period]
            if (!list.length) return null
            return (
              <div key={period}>
                <div className="flex items-center gap-2 mb-3">
                  <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wide">{period.toLowerCase()}</h2>
                  <span className="text-xs text-slate-400">{list.length}</span>
                </div>
                <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
                  {list.map(s => (
                    <ScheduleCard
                      key={s.id}
                      s={s}
                      busy={busy}
                      onEdit={() => { setEditing(s); setEditorOpen(true) }}
                      onPreview={() => setPreview(previewRequestFor(s))}
                      onToggle={() => void toggleSchedule(s)}
                      onSend={() => void send(s, 'live')}
                      onTest={() => void send(s, 'test')}
                      onDelete={() => setConfirmDelete(s)}
                    />
                  ))}
                </div>
              </div>
            )
          })
        )}

        {/* Quick previews — try a shape before committing to a schedule */}
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="flex items-center gap-2 text-sm font-bold text-slate-900">
            <Zap className="w-4 h-4 text-amber-500" /> Quick preview
          </div>
          <p className="text-xs text-slate-500 mt-1">
            See exactly what each report produces from live data — nothing is sent.
          </p>
          {REPORT_TYPE_OPTIONS.map(t => (
            <div key={t.value} className="mt-3">
              <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">{t.label}</div>
              <div className="flex flex-wrap gap-2 mt-1.5">
                {(['DAILY', 'WEEKLY', 'MONTHLY'] as const).map(p => (
                  <button
                    key={p}
                    onClick={() => setPreview({
                      reportType: t.value as ReportType,
                      period: p,
                      timezone: payload?.defaultTimezone,
                      title: `${t.label} · ${p.toLowerCase()} preview`,
                    })}
                    className="px-3.5 py-2 rounded-lg border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
                  >
                    {p.charAt(0) + p.slice(1).toLowerCase()}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* History */}
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100">
            <h2 className="text-sm font-bold text-slate-900">Delivery history</h2>
            <p className="text-xs text-slate-500 mt-0.5">The last {runs.length} runs, newest first</p>
          </div>

          {runs.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-slate-400">Nothing has been sent yet.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[10px] uppercase tracking-wider text-slate-400 border-b border-slate-100">
                    <th className="text-left font-bold px-4 py-2">When</th>
                    <th className="text-left font-bold px-4 py-2">Schedule</th>
                    <th className="text-left font-bold px-4 py-2">Trigger</th>
                    <th className="text-right font-bold px-4 py-2">Sent to</th>
                    <th className="text-right font-bold px-4 py-2" colSpan={3}>Figures</th>
                    <th className="text-left font-bold px-4 py-2">Result</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((r: RunLog) => {
                    const meta = STATUS_META[r.status] ?? STATUS_META.skipped
                    const Icon = meta.icon
                    // The three numeric columns are shared by both report types
                    // and count different things in each, so each cell says what
                    // it is rather than relying on a header that can only be
                    // right for one of them.
                    const figures = FIGURE_LABELS[r.reportType === 'RECONCILIATION' ? 'RECONCILIATION' : 'OPS']
                    return (
                      <tr key={r.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/60">
                        <td className="px-4 py-2.5 text-slate-500 whitespace-nowrap">{timeAgo(r.finishedAt)}</td>
                        <td className="px-4 py-2.5 font-semibold text-slate-800">
                          {r.scheduleName}
                          {r.reportType === 'RECONCILIATION' && (
                            <span className="ml-1.5 text-[10px] font-bold uppercase tracking-wide text-violet-600">recon</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-slate-500 capitalize">{r.trigger}</td>
                        <td className="px-4 py-2.5 text-right text-slate-700">{r.recipients || '—'}</td>
                        {(['created', 'onGround', 'complaints'] as const).map(key => (
                          <td key={key} className="px-4 py-2.5 text-right text-slate-700 whitespace-nowrap">
                            {r.counts[key]}
                            <span className="ml-1 text-[10px] text-slate-400">{figures[key]}</span>
                          </td>
                        ))}
                        <td className="px-4 py-2.5">
                          <span className={cn('inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-semibold border', meta.cls)}>
                            <Icon className="w-3 h-3" />
                            {meta.label}
                          </span>
                          {r.error && <span className="block text-[11px] text-slate-400 mt-0.5 max-w-xs truncate">{r.error}</span>}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <ScheduleEditor
        open={editorOpen}
        schedule={editing}
        defaultTimezone={payload?.defaultTimezone ?? 'Asia/Colombo'}
        sender={payload?.sender ?? ''}
        onClose={() => setEditorOpen(false)}
        onSaved={() => {
          setEditorOpen(false)
          toast.success(editing ? 'Schedule updated' : 'Schedule created')
          void load(true)
        }}
        onDelete={s => setConfirmDelete(s)}
        onPreview={draft => setPreview(previewRequestFor(draft))}
      />

      <PreviewDrawer request={preview} onClose={() => setPreview(null)} />

      {confirmDelete && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" onClick={() => setConfirmDelete(null)} />
          <div className="relative bg-white rounded-2xl shadow-2xl max-w-sm w-full p-5 animate-slide-up">
            <div className="w-10 h-10 rounded-lg bg-red-50 text-red-600 flex items-center justify-center">
              <Trash2 className="w-5 h-5" />
            </div>
            <h3 className="text-base font-bold text-slate-900 mt-3">Delete “{confirmDelete.name}”?</h3>
            <p className="text-sm text-slate-500 mt-1.5">
              {confirmDelete.recipientCount} recipient{confirmDelete.recipientCount === 1 ? '' : 's'} will stop receiving this
              report. The delivery history is kept.
            </p>
            <div className="flex gap-2 mt-5">
              <button
                onClick={() => setConfirmDelete(null)}
                className="flex-1 px-4 py-2.5 rounded-lg border border-slate-200 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
              >
                Keep it
              </button>
              <button
                onClick={() => void doDelete(confirmDelete)}
                className="flex-1 px-4 py-2.5 rounded-lg bg-red-600 text-white text-sm font-semibold hover:bg-red-700 transition-colors"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
