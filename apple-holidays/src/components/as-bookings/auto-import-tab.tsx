'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Clock, Loader2, PlayCircle, AlertCircle, History, Zap, CheckCircle2 } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { readApiResponse } from '@/lib/utils'
import { JobResultCard, fmtDateTime, type ImportJob } from './shared'

interface Settings { enabled: boolean; hour: number; minute: number }
interface AutoState {
  settings: Settings
  timezone: string
  lastRunDate: string | null
  lastJob: ImportJob | null
}

function hhmm(h: number, m: number): string {
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

export default function AutoImportTab() {
  const [state, setState] = useState<AutoState | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [jobs, setJobs] = useState<ImportJob[]>([])
  const [runningJobId, setRunningJobId] = useState<string | null>(null)
  const [startingRun, setStartingRun] = useState(false)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const loadSettings = useCallback(async () => {
    try {
      const res = await fetch('/api/as-bookings-v2/auto-import')
      const json = await readApiResponse<AutoState>(res)
      if (json.success && json.data) setState(json.data)
      else setError(json.error ?? 'Could not load settings')
    } catch {
      setError('Network error loading settings')
    } finally {
      setLoading(false)
    }
  }, [])

  const loadJobs = useCallback(async () => {
    try {
      const res = await fetch('/api/as-bookings-v2/import-jobs')
      const json = await readApiResponse<{ jobs: ImportJob[] }>(res)
      if (json.success && json.data) {
        setJobs(json.data.jobs)
        const running = json.data.jobs.find((j) => j.status === 'running')
        if (!running && pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; setRunningJobId(null) }
      }
    } catch {
      /* transient */
    }
  }, [])

  useEffect(() => {
    loadSettings(); loadJobs()
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [loadSettings, loadJobs])

  const save = useCallback(async (next: Settings) => {
    setSaving(true); setError(null)
    // optimistic
    setState((s) => (s ? { ...s, settings: next } : s))
    try {
      const res = await fetch('/api/as-bookings-v2/auto-import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(next),
      })
      const json = await readApiResponse<{ settings: Settings }>(res)
      if (!json.success) { setError(json.error ?? 'Could not save'); await loadSettings() }
    } catch {
      setError('Network error saving settings'); await loadSettings()
    } finally {
      setSaving(false)
    }
  }, [loadSettings])

  const runNow = useCallback(async () => {
    setStartingRun(true); setError(null)
    try {
      const res = await fetch('/api/as-bookings-v2/auto-import/run', { method: 'POST' })
      const json = await readApiResponse<{ jobId: string }>(res)
      if (!json.success || !json.data?.jobId) { setError(json.error ?? 'Could not start'); return }
      setRunningJobId(json.data.jobId)
      await loadJobs()
      if (pollRef.current) clearInterval(pollRef.current)
      pollRef.current = setInterval(loadJobs, 2000)
    } catch {
      setError('Network error starting run')
    } finally {
      setStartingRun(false)
    }
  }, [loadJobs])

  if (loading) {
    return (
      <Card className="flex items-center justify-center h-48">
        <Loader2 className="w-6 h-6 text-brand-500 animate-spin" />
      </Card>
    )
  }

  const s = state?.settings
  const enabled = !!s?.enabled

  return (
    <div className="space-y-5">
      {/* ── Control panel ─────────────────────────────────────────────── */}
      <Card className="p-4 sm:p-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${enabled ? 'bg-emerald-100 text-emerald-600' : 'bg-slate-100 text-slate-400'}`}>
              <Zap className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-semibold text-slate-900">Daily auto-import</h3>
              <p className="text-xs text-slate-500 mt-0.5 max-w-md">
                Every morning the server imports <span className="font-medium">yesterday&apos;s</span>{' '}
                confirmed (Status&nbsp;2) quotations automatically. Runs inside the server — no need to keep this page open.
              </p>
            </div>
          </div>

          {/* Toggle */}
          <button
            role="switch"
            aria-checked={enabled}
            disabled={saving}
            onClick={() => s && save({ ...s, enabled: !enabled })}
            className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors disabled:opacity-60 ${enabled ? 'bg-emerald-500' : 'bg-slate-300'}`}
          >
            <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${enabled ? 'translate-x-6' : 'translate-x-1'}`} />
          </button>
        </div>

        {/* Schedule + status row */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-4 pt-4 border-t border-slate-100">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-slate-400" />
            <div>
              <div className="text-xs text-slate-400">Runs daily at</div>
              <label className="flex items-center gap-1.5">
                <input
                  type="time"
                  value={s ? hhmm(s.hour, s.minute) : '06:00'}
                  onChange={(e) => {
                    const [h, m] = e.target.value.split(':').map(Number)
                    if (s && Number.isFinite(h) && Number.isFinite(m)) save({ ...s, hour: h, minute: m })
                  }}
                  className="form-input !py-1 !px-2 !w-28 text-sm font-semibold"
                />
                <span className="text-[11px] text-slate-400">{state?.timezone}</span>
              </label>
            </div>
          </div>

          <div>
            <div className="text-xs text-slate-400">Last auto-run</div>
            <div className="text-sm font-medium text-slate-700 mt-1">
              {state?.lastRunDate ?? 'Not yet run'}
            </div>
          </div>

          <div className="flex sm:justify-end items-center">
            <button
              onClick={runNow}
              disabled={startingRun || !!runningJobId}
              className="flex items-center justify-center gap-1.5 px-4 py-2 text-sm font-semibold text-brand-700 bg-brand-50 border border-brand-100 hover:bg-brand-100 rounded-xl transition-colors disabled:opacity-60"
            >
              {startingRun || runningJobId ? <Loader2 className="w-4 h-4 animate-spin" /> : <PlayCircle className="w-4 h-4" />}
              Run yesterday now
            </button>
          </div>
        </div>

        {saving && (
          <p className="mt-3 text-[11px] text-slate-400 flex items-center gap-1">
            <Loader2 className="w-3 h-3 animate-spin" /> Saving…
          </p>
        )}
        {!saving && !error && (
          <p className="mt-3 text-[11px] text-emerald-600 flex items-center gap-1">
            <CheckCircle2 className="w-3 h-3" /> Settings saved automatically
          </p>
        )}
        {error && (
          <p className="mt-3 flex items-start gap-1.5 text-xs text-rose-600">
            <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-px" /> {error}
          </p>
        )}
      </Card>

      {/* ── Run history / log ─────────────────────────────────────────── */}
      <div>
        <div className="flex items-center gap-2 mb-3 px-1">
          <History className="w-4 h-4 text-slate-400" />
          <h3 className="text-sm font-semibold text-slate-700">Run history</h3>
          <span className="text-xs text-slate-400">({jobs.length})</span>
        </div>

        {jobs.length === 0 ? (
          <Card className="flex flex-col items-center justify-center h-40 text-slate-400 text-center px-6">
            <History className="w-8 h-8 mb-2 opacity-30" />
            <p className="text-sm font-medium">No import runs yet</p>
            <p className="text-xs mt-1">Auto-runs and manual runs will appear here with a country breakdown.</p>
          </Card>
        ) : (
          <div className="space-y-3">
            {jobs.map((job, i) => (
              <JobResultCard key={job.id} job={job} showEvents={i === 0} />
            ))}
          </div>
        )}

        {jobs[0] && (
          <p className="text-[11px] text-slate-400 mt-2 px-1">
            Last updated {fmtDateTime(jobs[0].completedAt ?? jobs[0].startedAt)}
          </p>
        )}
      </div>
    </div>
  )
}
