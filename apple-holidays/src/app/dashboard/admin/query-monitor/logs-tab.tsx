'use client'

/**
 * Run log — one line per sweep, expandable into the full trace of what the
 * backend did: which mailbox returned what, which queries were deduplicated,
 * which fields came from AI, and exactly which sheet rows were written.
 */
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import {
  AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, CircleDot, Clock,
  Info, Loader2, ScrollText, Sparkles, XCircle,
} from 'lucide-react'
import { cn, formatDateTime } from '@/lib/utils'
import { EmptyState, Stat } from './ui'
import type { QmRun, QmRunStep } from './types'

interface WeekTotals {
  runs: number; entriesCreated: number; rowsAppended: number; aiCalls: number; errors: number
}

const STATUS_META: Record<string, { cls: string; icon: React.ReactNode }> = {
  SUCCESS: { cls: 'bg-emerald-100 text-emerald-700', icon: <CheckCircle2 className="w-3 h-3" /> },
  PARTIAL: { cls: 'bg-amber-100 text-amber-700',     icon: <AlertTriangle className="w-3 h-3" /> },
  FAILED:  { cls: 'bg-rose-100 text-rose-700',       icon: <XCircle className="w-3 h-3" /> },
  RUNNING: { cls: 'bg-sky-100 text-sky-700',         icon: <Loader2 className="w-3 h-3 animate-spin" /> },
  SKIPPED: { cls: 'bg-slate-100 text-slate-500',     icon: <CircleDot className="w-3 h-3" /> },
}

const LEVEL_META: Record<string, { cls: string; icon: React.ReactNode }> = {
  info:    { cls: 'text-slate-600',   icon: <Info className="w-3.5 h-3.5 text-slate-400" /> },
  success: { cls: 'text-emerald-700', icon: <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" /> },
  warn:    { cls: 'text-amber-700',   icon: <AlertTriangle className="w-3.5 h-3.5 text-amber-500" /> },
  error:   { cls: 'text-rose-700',    icon: <XCircle className="w-3.5 h-3.5 text-rose-500" /> },
}

export default function LogsTab({ refreshKey }: { refreshKey: number }) {
  const [runs, setRuns] = useState<QmRun[]>([])
  const [week, setWeek] = useState<WeekTotals | null>(null)
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/query-monitor/runs?limit=60')
      const d = await res.json()
      if (!d.success) { toast.error(d.error); return }
      setRuns(d.data.runs)
      setWeek(d.data.week)
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { void load() }, [load, refreshKey])

  return (
    <div className="space-y-4">
      {week && (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
          <Stat icon={<ScrollText className="w-5 h-5" />} label="Sweeps (7d)" value={week.runs} />
          <Stat icon={<CheckCircle2 className="w-5 h-5" />} tone="emerald" label="Queries captured" value={week.entriesCreated} />
          <Stat icon={<CircleDot className="w-5 h-5" />} tone="sky" label="Rows written" value={week.rowsAppended} />
          <Stat icon={<Sparkles className="w-5 h-5" />} tone="violet" label="AI calls" value={week.aiCalls} hint="gpt-4o-mini, only for unreadable mails" />
          <Stat icon={<AlertTriangle className="w-5 h-5" />} tone={week.errors > 0 ? 'rose' : 'slate'} label="Errors" value={week.errors} />
        </div>
      )}

      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
        {loading ? (
          <div className="py-16 grid place-items-center text-slate-400"><Loader2 className="w-6 h-6 animate-spin" /></div>
        ) : runs.length === 0 ? (
          <EmptyState
            icon={<ScrollText className="w-6 h-6" />}
            title="No sweeps yet"
            hint="Press “Run now” — the full trace of that run will appear here."
          />
        ) : (
          <div className="divide-y divide-slate-100">
            {runs.map(run => (
              <RunRow
                key={run.id}
                run={run}
                open={expanded === run.id}
                onToggle={() => setExpanded(expanded === run.id ? null : run.id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function RunRow({ run, open, onToggle }: { run: QmRun; open: boolean; onToggle: () => void }) {
  const [steps, setSteps] = useState<QmRunStep[] | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!open || steps) return
    setLoading(true)
    fetch(`/api/query-monitor/runs/${run.id}`)
      .then(r => r.json())
      .then(d => { if (d.success) setSteps(d.data.steps) })
      .finally(() => setLoading(false))
  }, [open, steps, run.id])

  const meta = STATUS_META[run.status] ?? STATUS_META.SKIPPED

  return (
    <div>
      <button onClick={onToggle} className="w-full px-4 py-3 flex flex-wrap items-center gap-3 hover:bg-slate-50 text-left">
        {open ? <ChevronDown className="w-4 h-4 text-slate-400" /> : <ChevronRight className="w-4 h-4 text-slate-400" />}

        <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold', meta.cls)}>
          {meta.icon}{run.status}
        </span>

        <span className="text-sm font-medium text-slate-700 whitespace-nowrap">{formatDateTime(run.startedAt)}</span>

        <span className="text-[11px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 font-semibold">{run.trigger}</span>
        {run.triggeredBy && <span className="text-[11px] text-slate-400">by {run.triggeredBy}</span>}

        <span className="text-xs text-slate-500 flex flex-wrap items-center gap-x-3 gap-y-1 ml-auto">
          <span>{run.mailboxesScanned} mailbox{run.mailboxesScanned === 1 ? '' : 'es'}</span>
          <span>{run.messagesSeen} mails</span>
          <span className="font-semibold text-emerald-700">{run.entriesCreated} new</span>
          {run.repliesDetected > 0 && <span className="text-sky-700">{run.repliesDetected} replies</span>}
          {run.rowsAppended > 0 && <span className="text-sky-700">{run.rowsAppended} appended</span>}
          {run.rowsUpdated > 0 && <span className="text-violet-700">{run.rowsUpdated} rewritten</span>}
          {run.aiCalls > 0 && <span className="text-violet-600">{run.aiCalls} AI</span>}
          {run.errors > 0 && <span className="text-rose-600 font-semibold">{run.errors} error{run.errors === 1 ? '' : 's'}</span>}
          {run.durationMs != null && (
            <span className="inline-flex items-center gap-1 text-slate-400">
              <Clock className="w-3 h-3" />{(run.durationMs / 1000).toFixed(1)}s
            </span>
          )}
        </span>
      </button>

      {open && (
        <div className="px-4 pb-4">
          {run.errorMessage && (
            <p className="mb-3 text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg p-2.5">
              {run.errorMessage}
            </p>
          )}

          <div className="rounded-lg border border-slate-200 bg-slate-50 max-h-96 overflow-y-auto">
            {loading ? (
              <div className="py-8 grid place-items-center text-slate-400"><Loader2 className="w-5 h-5 animate-spin" /></div>
            ) : !steps || steps.length === 0 ? (
              <p className="p-4 text-xs text-slate-400">No step detail recorded for this run.</p>
            ) : (
              <ol className="divide-y divide-slate-200/70">
                {steps.map((step, i) => {
                  const level = LEVEL_META[step.level] ?? LEVEL_META.info
                  return (
                    <li key={i} className="px-3 py-2 flex items-start gap-2.5">
                      <span className="mt-0.5 flex-shrink-0">{level.icon}</span>
                      <span className="text-[11px] text-slate-400 font-mono whitespace-nowrap mt-0.5">
                        {new Date(step.t).toLocaleTimeString()}
                      </span>
                      <span className="min-w-0">
                        <span className={cn('block text-xs', level.cls)}>{step.msg}</span>
                        {step.meta && (
                          <span className="block text-[10px] text-slate-400 font-mono break-all">
                            {Object.entries(step.meta).map(([k, v]) => `${k}=${String(v)}`).join('  ')}
                          </span>
                        )}
                      </span>
                    </li>
                  )
                })}
              </ol>
            )}
          </div>

          {run.windowFrom && run.windowTo && (
            <p className="mt-2 text-[11px] text-slate-400">
              Mail window {formatDateTime(run.windowFrom)} → {formatDateTime(run.windowTo)}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
