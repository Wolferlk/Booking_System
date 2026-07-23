'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { CalendarRange, Loader2, PackagePlus, AlertCircle, Info } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { readApiResponse } from '@/lib/utils'
import { JobResultCard, type ImportJob } from './shared'

function isoDaysAgo(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString().slice(0, 10)
}

export default function RangeImportTab() {
  const [from, setFrom] = useState(isoDaysAgo(1))
  const [to, setTo] = useState(isoDaysAgo(1))
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [job, setJob] = useState<ImportJob | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const stopPolling = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
  }, [])

  useEffect(() => stopPolling, [stopPolling])

  const poll = useCallback(async (jobId: string) => {
    try {
      const res = await fetch(`/api/as-bookings-v2/import-jobs/${jobId}`)
      const json = await readApiResponse<{ job: ImportJob }>(res)
      if (json.success && json.data?.job) {
        setJob(json.data.job)
        if (json.data.job.status !== 'running') stopPolling()
      }
    } catch {
      /* transient — keep polling */
    }
  }, [stopPolling])

  const start = useCallback(async () => {
    setStarting(true); setError(null); setJob(null); stopPolling()
    try {
      const res = await fetch('/api/as-bookings-v2/bulk-import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to }),
      })
      const json = await readApiResponse<{ jobId: string }>(res)
      if (!json.success || !json.data?.jobId) {
        setError(json.error ?? 'Could not start the import')
        return
      }
      const jobId = json.data.jobId
      await poll(jobId)
      pollRef.current = setInterval(() => poll(jobId), 2000)
    } catch {
      setError('Network error — could not start the import')
    } finally {
      setStarting(false)
    }
  }, [from, to, poll, stopPolling])

  const running = job?.status === 'running'

  return (
    <div className="space-y-5">
      <Card className="p-4 sm:p-5 space-y-4">
        <div className="flex items-start gap-2 text-sm text-slate-600">
          <CalendarRange className="w-4.5 h-4.5 text-brand-500 mt-0.5 shrink-0" />
          <p>
            Import every <span className="font-semibold text-emerald-700">confirmed (Status&nbsp;2)</span>{' '}
            quotation whose <span className="font-semibold">create date</span> falls in this range.
            Already-imported bookings are safely skipped.
          </p>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-end gap-3">
          <label className="flex-1">
            <span className="block text-xs font-medium text-slate-500 mb-1">From (create date)</span>
            <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className="form-input" />
          </label>
          <label className="flex-1">
            <span className="block text-xs font-medium text-slate-500 mb-1">To (create date)</span>
            <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} className="form-input" />
          </label>
          <button
            onClick={start}
            disabled={starting || running || !from || !to}
            className="flex items-center justify-center gap-1.5 px-5 py-2 text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-500 rounded-xl transition-colors disabled:opacity-60"
          >
            {starting || running ? <Loader2 className="w-4 h-4 animate-spin" /> : <PackagePlus className="w-4 h-4" />}
            {running ? 'Importing…' : 'Import confirmations'}
          </button>
        </div>

        <div className="flex flex-wrap gap-2">
          {([['Yesterday', 1, 1], ['Last 7 days', 7, 1], ['Last 30 days', 30, 1]] as const).map(([label, start_, end]) => (
            <button
              key={label}
              onClick={() => { setFrom(isoDaysAgo(start_)); setTo(isoDaysAgo(end)) }}
              className="px-2.5 py-1 rounded-lg text-xs font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 transition-colors"
            >
              {label}
            </button>
          ))}
        </div>

        {error && (
          <p className="flex items-start gap-1.5 text-xs text-rose-600">
            <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-px" /> {error}
          </p>
        )}
      </Card>

      {job ? (
        <JobResultCard job={job} />
      ) : (
        <Card className="flex flex-col items-center justify-center h-48 text-slate-400 text-center px-6">
          <Info className="w-9 h-9 mb-3 opacity-30" />
          <p className="text-sm font-medium">Pick a create-date range and start importing</p>
          <p className="text-xs mt-1">Progress and a per-country breakdown appear here.</p>
        </Card>
      )}
    </div>
  )
}
