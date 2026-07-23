'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import {
  CalendarClock, Loader2, RefreshCw, Lock, AlertTriangle, CheckCircle2,
  Power, ShieldAlert, Mail, PackagePlus, Users, Wrench, Clock, Ban,
} from 'lucide-react'
import Header from '@/components/layout/header'
import { Card } from '@/components/ui/card'
import { readApiResponse } from '@/lib/utils'

type Category = 'Mail' | 'Bookings' | 'Customer' | 'Ops'

interface TogglePayload {
  endpoint: string
  protected: boolean
  payloadOn: Record<string, unknown>
  payloadOff: Record<string, unknown>
}

interface ScheduleJob {
  id: string
  label: string
  description: string
  category: Category
  cadence: string
  timezone?: string
  enabled: boolean
  controllable: boolean
  toggle?: TogglePayload
  lastRunAt: string | null
  lastResult: string | null
  lastError: string | null
  stateBadge?: string
}

interface Summary { total: number; enabled: number; disabled: number; withErrors: number }
interface Payload { jobs: ScheduleJob[]; summary: Summary; autoMailEnabled: boolean; timezone: string }

const CATEGORY_META: Record<Category, { icon: typeof Mail; tint: string }> = {
  Mail:     { icon: Mail,        tint: 'text-sky-500' },
  Bookings: { icon: PackagePlus, tint: 'text-emerald-500' },
  Customer: { icon: Users,       tint: 'text-violet-500' },
  Ops:      { icon: Wrench,      tint: 'text-amber-500' },
}
const CATEGORY_ORDER: Category[] = ['Mail', 'Bookings', 'Customer', 'Ops']

function timeAgo(iso: string | null): string {
  if (!iso) return 'never'
  const t = Date.parse(iso)
  if (isNaN(t)) return 'never'
  const secs = Math.round((Date.now() - t) / 1000)
  if (secs < 60) return 'just now'
  const mins = Math.round(secs / 60)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.round(hrs / 24)
  return `${days}d ago`
}

export default function SchedulesPage() {
  const [data, setData] = useState<Payload | null>(null)
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [criticalPassword, setCriticalPassword] = useState('')

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/schedules')
      const json = await readApiResponse<Payload>(res)
      if (json.success && json.data) setData(json.data)
      else toast.error(json.error ?? 'Could not load schedules')
    } catch {
      toast.error('Network error loading schedules')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
    const t = setInterval(load, 15_000)
    return () => clearInterval(t)
  }, [load])

  const toggle = useCallback(async (job: ScheduleJob) => {
    if (!job.toggle) return
    if (job.toggle.protected && !criticalPassword.trim()) {
      toast.error('Enter the critical services password first')
      return
    }
    setBusyId(job.id)
    try {
      const base = job.enabled ? job.toggle.payloadOff : job.toggle.payloadOn
      const body = job.toggle.protected ? { ...base, password: criticalPassword } : base
      const res = await fetch(job.toggle.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = await readApiResponse(res)
      if (!json.success) { toast.error(json.error ?? 'Could not update'); return }
      toast.success(`${job.label} ${job.enabled ? 'disabled' : 'enabled'}`)
      await load()
    } catch {
      toast.error('Network error updating schedule')
    } finally {
      setBusyId(null)
    }
  }, [criticalPassword, load])

  if (loading) {
    return (
      <div>
        <Header title={<span className="flex items-center gap-2"><CalendarClock className="w-5 h-5 text-brand-500" /> Schedules &amp; Logs</span>} />
        <div className="flex justify-center py-24"><Loader2 className="w-6 h-6 text-brand-500 animate-spin" /></div>
      </div>
    )
  }

  const jobs = data?.jobs ?? []
  const summary = data?.summary
  const autoMailOn = data?.autoMailEnabled ?? false

  return (
    <div>
      <Header
        title={<span className="flex items-center gap-2"><CalendarClock className="w-5 h-5 text-brand-500" /> Schedules &amp; Logs</span>}
        subtitle="Every background automation — status, last run, and on/off control"
      />

      <div className="p-4 sm:p-8 space-y-5">
        {/* ── Summary strip ─────────────────────────────────────────────── */}
        {summary && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <SummaryTile label="Total jobs" value={summary.total} icon={<CalendarClock className="w-4 h-4" />} tint="text-slate-500 bg-slate-50 border-slate-200" />
            <SummaryTile label="Enabled" value={summary.enabled} icon={<Power className="w-4 h-4" />} tint="text-emerald-600 bg-emerald-50 border-emerald-200" />
            <SummaryTile label="Disabled" value={summary.disabled} icon={<Ban className="w-4 h-4" />} tint="text-slate-500 bg-slate-50 border-slate-200" />
            <SummaryTile label="Recent errors" value={summary.withErrors} icon={<AlertTriangle className="w-4 h-4" />} tint="text-rose-600 bg-rose-50 border-rose-200" />
          </div>
        )}

        {/* ── Critical password + refresh row ───────────────────────────── */}
        <Card className="p-4 flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="flex items-center gap-2 flex-1">
            <Lock className="w-4 h-4 text-slate-400 shrink-0" />
            <input
              type="password"
              placeholder="Critical services password (required for protected toggles)"
              value={criticalPassword}
              onChange={(e) => setCriticalPassword(e.target.value)}
              className="form-input flex-1 text-sm"
            />
          </div>
          <button
            onClick={load}
            className="flex items-center justify-center gap-1.5 px-4 py-2 text-sm font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors shrink-0"
          >
            <RefreshCw className="w-4 h-4" /> Refresh
          </button>
        </Card>

        {/* ── Manual-only banner ────────────────────────────────────────── */}
        {!autoMailOn && (
          <div className="flex items-start gap-2.5 p-3.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-800">
            <ShieldAlert className="w-4.5 h-4.5 shrink-0 mt-0.5" />
            <p className="text-sm">
              <span className="font-semibold">Auto Mail Processing is OFF — manual only.</span>{' '}
              Incoming mail is cached but not turned into bookings automatically. Use the{' '}
              <span className="font-medium">Process</span> button in Mail Inbox to create a booking from an email.
            </p>
          </div>
        )}

        {/* ── Grouped jobs ──────────────────────────────────────────────── */}
        {CATEGORY_ORDER.map((cat) => {
          const catJobs = jobs.filter((j) => j.category === cat)
          if (catJobs.length === 0) return null
          const CatIcon = CATEGORY_META[cat].icon
          return (
            <div key={cat}>
              <div className="flex items-center gap-2 mb-3 px-1">
                <CatIcon className={`w-4 h-4 ${CATEGORY_META[cat].tint}`} />
                <h3 className="text-sm font-semibold text-slate-700">{cat}</h3>
                <span className="text-xs text-slate-400">({catJobs.length})</span>
              </div>
              <div className="space-y-2.5">
                {catJobs.map((job) => (
                  <JobRow key={job.id} job={job} busy={busyId === job.id} onToggle={() => toggle(job)} />
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function SummaryTile({ label, value, icon, tint }: { label: string; value: number; icon: React.ReactNode; tint: string }) {
  return (
    <div className={`rounded-xl border px-4 py-3 flex items-center gap-3 ${tint}`}>
      <div className="shrink-0 opacity-80">{icon}</div>
      <div>
        <div className="text-2xl font-bold leading-none tabular-nums">{value}</div>
        <div className="text-[11px] font-medium mt-1 uppercase tracking-wide opacity-80">{label}</div>
      </div>
    </div>
  )
}

function JobRow({ job, busy, onToggle }: { job: ScheduleJob; busy: boolean; onToggle: () => void }) {
  return (
    <div className={`bg-white border rounded-2xl p-4 transition-colors ${job.lastError ? 'border-rose-200' : 'border-slate-200'}`}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-semibold text-slate-800">{job.label}</p>
            {job.stateBadge ? (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-slate-100 text-slate-500 border border-slate-200">
                <Ban className="w-3 h-3" /> {job.stateBadge}
              </span>
            ) : (
              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold border ${
                job.enabled ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-slate-100 text-slate-500 border-slate-200'
              }`}>
                {job.enabled ? <CheckCircle2 className="w-3 h-3" /> : <Ban className="w-3 h-3" />}
                {job.enabled ? 'ON' : 'OFF'}
              </span>
            )}
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-slate-50 text-slate-500 border border-slate-200">
              <Clock className="w-3 h-3" /> {job.cadence}{job.timezone ? ` · ${job.timezone}` : ''}
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1.5">{job.description}</p>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 text-[11px] text-slate-400">
            <span>Last run: <span className="text-slate-600 font-medium">{timeAgo(job.lastRunAt)}</span></span>
            {job.lastResult && <span>Result: <span className="text-slate-600">{job.lastResult}</span></span>}
          </div>

          {job.lastError && (
            <p className="mt-2 flex items-start gap-1.5 text-[11px] text-rose-600">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" /> {job.lastError}
            </p>
          )}
        </div>

        {/* Toggle / status control */}
        <div className="shrink-0">
          {job.controllable && job.toggle ? (
            <button
              role="switch"
              aria-checked={job.enabled}
              disabled={busy}
              onClick={onToggle}
              className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors disabled:opacity-60 ${job.enabled ? 'bg-emerald-500' : 'bg-slate-300'}`}
            >
              {busy && <Loader2 className="absolute inset-0 m-auto w-4 h-4 text-white animate-spin" />}
              <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${job.enabled ? 'translate-x-6' : 'translate-x-1'}`} />
            </button>
          ) : (
            <span className="text-[11px] text-slate-300 font-medium">read-only</span>
          )}
          {job.toggle?.protected && (
            <div className="flex items-center justify-end gap-1 mt-1.5 text-[10px] text-amber-500">
              <Lock className="w-2.5 h-2.5" /> password
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
