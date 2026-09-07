'use client'

/** Small presentational pieces shared by the Query Monitor tabs. */

import { cn } from '@/lib/utils'
import {
  CheckCircle2, Clock, AlertTriangle, CloudUpload, CloudOff, Layers, RefreshCw, XCircle, Sparkles, Hand, Filter,
} from 'lucide-react'

// ── Reading an API answer ────────────────────────────────────────────────────

/**
 * The envelope every /api/query-monitor route replies with.
 *
 * `data` and `error` are deliberately loose. Every tab on this screen reads
 * `d.data.<whatever the route sends>` straight into its own typed state, and the
 * route is the thing that decides that shape — tightening it here would only
 * move forty call sites' worth of casts around without checking anything real.
 */
export interface QmReply {
  success: boolean
  data:    any // eslint-disable-line
  error:   string
  message?: string
  /**
   * The gateway gave up waiting, not the job. Set only for a 504/524, where the
   * work is still going on the server — the caller is expected to say so and
   * start watching, rather than report a failure that did not happen.
   */
  timedOut?: boolean
}

/**
 * Read a response as our JSON envelope, whatever actually came back.
 *
 * `res.json()` on its own is a trap on this deployment. A sweep runs for two
 * minutes and the Amplify gateway hangs up at its own limit long before the
 * function does, answering with an **HTML** error page. Parsing that throws
 * `Unexpected token '<', "<!DOCTYPE"… is not valid JSON`, which is what the
 * screen has been showing instead of anything a person could act on — and worse,
 * it reads as "the sweep failed" when the sweep is running perfectly well and
 * will finish and write its rows a minute later.
 *
 * So the body is taken as text and parsed defensively. A real envelope is
 * returned untouched. Anything else is turned into one, carrying a message that
 * says what actually happened.
 */
export async function readJson(res: Response): Promise<QmReply> {
  const body = await res.text().catch(() => '')

  try {
    const parsed = JSON.parse(body) as QmReply
    // A route that answered properly, success or failure, is authoritative.
    if (parsed && typeof parsed === 'object' && 'success' in parsed) return parsed
  } catch {
    // Not JSON — fall through and describe the response instead.
  }

  return { success: false, data: null, ...describeNonJson(res) }
}

/** What to tell someone looking at a response that is not one of ours. */
function describeNonJson(res: Response): { error: string; timedOut?: boolean } {
  // 504 Gateway Timeout / 524 (Cloudflare). The function is still executing:
  // the runs that produce this appear in the Run Log a minute later, finished
  // and successful. Saying "failed" here would be untrue.
  if (res.status === 504 || res.status === 524) {
    return {
      timedOut: true,
      error:
        'The page stopped waiting after the gateway timed out — the job itself is still '
        + 'running on the server and has not been lost. Give it a minute and check the Run Log.',
    }
  }

  if (res.status === 502 || res.status === 503) {
    return {
      error:
        `The server did not answer (${res.status}). The job may still have started — check the `
        + 'Run Log before pressing this again, so nothing is written twice.',
    }
  }

  if (res.status === 401 || res.status === 403) {
    return { error: 'Your session has expired. Reload the page and sign in again.' }
  }

  if (res.status === 413) return { error: 'That request was too large for the server to accept.' }

  return res.ok
    ? { error: 'The server answered with something that is not JSON. Reload the page and try again.' }
    : { error: `The server answered ${res.status}${res.statusText ? ` ${res.statusText}` : ''}.` }
}

// ── Stat tile ────────────────────────────────────────────────────────────────

export function Stat({
  icon, label, value, tone = 'slate', hint, onClick, active,
}: {
  icon: React.ReactNode
  label: string
  value: React.ReactNode
  tone?: 'slate' | 'emerald' | 'amber' | 'rose' | 'sky' | 'violet'
  hint?: string
  onClick?: () => void
  active?: boolean
}) {
  const tones = {
    slate:   'text-slate-600 bg-slate-50 border-slate-200',
    emerald: 'text-emerald-700 bg-emerald-50 border-emerald-200',
    amber:   'text-amber-700 bg-amber-50 border-amber-200',
    rose:    'text-rose-700 bg-rose-50 border-rose-200',
    sky:     'text-sky-700 bg-sky-50 border-sky-200',
    violet:  'text-violet-700 bg-violet-50 border-violet-200',
  }

  const className = cn(
    'text-left rounded-xl border bg-white p-4 transition-shadow w-full',
    onClick && 'hover:shadow-md cursor-pointer',
    active && 'ring-2 ring-emerald-500 ring-offset-1',
  )

  const inner = (
    <>
      <div className="flex items-center gap-2.5">
        <span className={cn('grid place-items-center w-9 h-9 rounded-lg border', tones[tone])}>{icon}</span>
        <div className="min-w-0">
          <p className="text-[11px] uppercase tracking-wide text-slate-400 font-semibold truncate">{label}</p>
          <p className="text-xl font-bold text-slate-900 leading-tight">{value}</p>
        </div>
      </div>
      {hint && <p className="mt-2 text-[11px] text-slate-400 truncate">{hint}</p>}
    </>
  )

  return onClick
    ? <button type="button" onClick={onClick} className={className}>{inner}</button>
    : <div className={className}>{inner}</div>
}

// ── Badges ───────────────────────────────────────────────────────────────────

export function ReplyStatusBadge({ status }: { status: string }) {
  const meta: Record<string, { label: string; cls: string; icon: React.ReactNode }> = {
    REPLIED: { label: 'Replied', cls: 'bg-emerald-100 text-emerald-700', icon: <CheckCircle2 className="w-3 h-3" /> },
    PENDING: { label: 'Pending', cls: 'bg-amber-100 text-amber-700',     icon: <Clock className="w-3 h-3" /> },
    OVERDUE: { label: 'Overdue', cls: 'bg-rose-100 text-rose-700',       icon: <AlertTriangle className="w-3 h-3" /> },
  }
  const m = meta[status] ?? { label: status, cls: 'bg-slate-100 text-slate-600', icon: null }
  return (
    <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold', m.cls)}>
      {m.icon}{m.label}
    </span>
  )
}

export function SyncStatusBadge({ status, sheetRow }: { status: string; sheetRow?: number | null }) {
  const meta: Record<string, { label: string; cls: string; icon: React.ReactNode }> = {
    SYNCED:  { label: sheetRow ? `Row ${sheetRow}` : 'In sheet', cls: 'bg-sky-100 text-sky-700',      icon: <CloudUpload className="w-3 h-3" /> },
    PENDING: { label: 'Awaiting write',  cls: 'bg-slate-100 text-slate-600', icon: <CloudOff className="w-3 h-3" /> },
    DIRTY:   { label: 'Needs rewrite',   cls: 'bg-violet-100 text-violet-700', icon: <RefreshCw className="w-3 h-3" /> },
    FAILED:  { label: 'Write failed',    cls: 'bg-rose-100 text-rose-700',   icon: <XCircle className="w-3 h-3" /> },
    SKIPPED: { label: 'Skipped',         cls: 'bg-slate-100 text-slate-500', icon: null },
    // A follow-up sharing the query's row — it is never written on its own.
    MERGED:  { label: 'Same query',      cls: 'bg-slate-100 text-slate-500', icon: <Layers className="w-3 h-3" /> },
  }
  const m = meta[status] ?? { label: status, cls: 'bg-slate-100 text-slate-600', icon: null }
  return (
    <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold', m.cls)}>
      {m.icon}{m.label}
    </span>
  )
}

export function SourceBadge({ source, confidence }: { source: string; confidence?: number | null }) {
  if (source === 'MANUAL') {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-indigo-50 text-indigo-600" title="Hand-corrected — sweeps will not overwrite these fields">
        <Hand className="w-3 h-3" /> Edited
      </span>
    )
  }
  if (source === 'AI') {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-violet-50 text-violet-600"
            title={confidence != null ? `AI confidence ${(confidence * 100).toFixed(0)}%` : 'Extracted by GPT'}>
        <Sparkles className="w-3 h-3" /> AI{confidence != null ? ` ${(confidence * 100).toFixed(0)}%` : ''}
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-slate-100 text-slate-500" title="Read straight out of the subject/body by the parser">
      <Filter className="w-3 h-3" /> Rules
    </span>
  )
}

// ── Toggle ───────────────────────────────────────────────────────────────────

export function Toggle({
  checked, onChange, label, description, disabled, tone = 'emerald',
}: {
  checked: boolean
  onChange: (next: boolean) => void
  label: string
  description?: string
  disabled?: boolean
  tone?: 'emerald' | 'amber'
}) {
  const onCls = tone === 'amber' ? 'bg-amber-500' : 'bg-emerald-600'
  return (
    <label className={cn('flex items-start gap-3 cursor-pointer', disabled && 'opacity-50 cursor-not-allowed')}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => !disabled && onChange(!checked)}
        className={cn(
          'mt-0.5 relative w-10 h-6 rounded-full transition-colors flex-shrink-0',
          checked ? onCls : 'bg-slate-300',
        )}
      >
        <span className={cn(
          'absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform',
          checked ? 'translate-x-[1.125rem]' : 'translate-x-0.5',
        )} />
      </button>
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-slate-800">{label}</span>
        {description && <span className="block text-xs text-slate-500 mt-0.5">{description}</span>}
      </span>
    </label>
  )
}

// ── Field ────────────────────────────────────────────────────────────────────

export function Field({
  label, hint, children,
}: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-semibold text-slate-600 mb-1">{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-slate-400 mt-1">{hint}</span>}
    </label>
  )
}

export const inputCls =
  'w-full px-3 py-2 rounded-lg border border-slate-200 text-sm text-slate-800 '
  + 'focus:outline-none focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-400'

export function EmptyState({ icon, title, hint }: { icon: React.ReactNode; title: string; hint?: string }) {
  return (
    <div className="py-16 text-center">
      <div className="mx-auto w-12 h-12 grid place-items-center rounded-xl bg-slate-100 text-slate-400">{icon}</div>
      <p className="mt-3 text-sm font-semibold text-slate-600">{title}</p>
      {hint && <p className="mt-1 text-xs text-slate-400 max-w-md mx-auto">{hint}</p>}
    </div>
  )
}
