'use client'

import { CheckCircle2, MinusCircle, AlertTriangle, MapPin, Clock, Loader2, PackageCheck } from 'lucide-react'

// ── Shared types (mirror src/lib/as-import.ts) ─────────────────────────────────
export type ImportResultKind = 'created' | 'skipped' | 'error'

export interface ImportEvent {
  ref: string | null
  quotationNo: string
  country: string | null
  result: ImportResultKind
  message?: string
}

export interface CountryTally { created: number; skipped: number; errors: number }

export interface ImportJob {
  id: string
  mode: 'auto' | 'manual'
  dateFrom: string
  dateTo: string
  status: 'running' | 'done' | 'error'
  startedAt: string
  completedAt: string | null
  durationMs: number | null
  totalFound: number
  totalCreated: number
  totalSkipped: number
  totalErrors: number
  countryCounts: Record<string, CountryTally>
  events: ImportEvent[]
  errorMessage?: string
}

// ── Country presentation ───────────────────────────────────────────────────────
export const COUNTRY_LABEL: Record<string, string> = {
  VIETNAM: 'Vietnam',
  SRILANKA: 'Sri Lanka',
  SINGAPORE: 'Singapore',
  MALAYSIA: 'Malaysia',
  SINGAPORE_MALAYSIA: 'Singapore / Malaysia',
  UNKNOWN: 'Unknown',
}

export const COUNTRY_STYLE: Record<string, string> = {
  VIETNAM: 'bg-red-500/10 text-red-600 border-red-500/20',
  SRILANKA: 'bg-yellow-500/10 text-yellow-700 border-yellow-500/20',
  SINGAPORE: 'bg-blue-500/10 text-blue-600 border-blue-500/20',
  MALAYSIA: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20',
  SINGAPORE_MALAYSIA: 'bg-indigo-500/10 text-indigo-600 border-indigo-500/20',
  UNKNOWN: 'bg-slate-500/10 text-slate-500 border-slate-500/20',
}

export function countryLabel(key: string): string {
  return COUNTRY_LABEL[key] ?? key
}
export function countryStyle(key: string): string {
  return COUNTRY_STYLE[key] ?? COUNTRY_STYLE.UNKNOWN
}

export function fmtDateTime(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return isNaN(d.getTime()) ? '—' : d.toLocaleString('en-GB', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  })
}

export function fmtRange(from: string, to: string): string {
  return from === to ? from : `${from} → ${to}`
}

// ── Stat tile ──────────────────────────────────────────────────────────────────
export function StatTile({
  label, value, tone,
}: { label: string; value: number; tone: 'created' | 'skipped' | 'errors' | 'found' }) {
  const styles = {
    created: 'bg-emerald-50 border-emerald-100 text-emerald-700',
    skipped: 'bg-slate-50 border-slate-200 text-slate-600',
    errors: 'bg-rose-50 border-rose-100 text-rose-700',
    found: 'bg-brand-50 border-brand-100 text-brand-700',
  }[tone]
  return (
    <div className={`rounded-xl border px-3 py-2.5 text-center ${styles}`}>
      <div className="text-2xl font-bold leading-none tabular-nums">{value}</div>
      <div className="text-[11px] font-medium mt-1 uppercase tracking-wide opacity-80">{label}</div>
    </div>
  )
}

function StatusPill({ status }: { status: ImportJob['status'] }) {
  if (status === 'running') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-amber-50 text-amber-700 border border-amber-200">
        <Loader2 className="w-3 h-3 animate-spin" /> Running
      </span>
    )
  }
  if (status === 'error') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-rose-50 text-rose-700 border border-rose-200">
        <AlertTriangle className="w-3 h-3" /> Error
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
      <PackageCheck className="w-3 h-3" /> Done
    </span>
  )
}

function ResultIcon({ result }: { result: ImportResultKind }) {
  if (result === 'created') return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
  if (result === 'skipped') return <MinusCircle className="w-3.5 h-3.5 text-slate-400 shrink-0" />
  return <AlertTriangle className="w-3.5 h-3.5 text-rose-500 shrink-0" />
}

/**
 * Full result card for one import run — stat tiles, per-country breakdown, and
 * (optionally) the per-booking event list. Reused by the Range and Auto tabs.
 */
export function JobResultCard({ job, showEvents = true }: { job: ImportJob; showEvents?: boolean }) {
  const countries = Object.entries(job.countryCounts)
    .sort((a, b) => (b[1].created + b[1].skipped) - (a[1].created + a[1].skipped))

  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-slate-800">
            {job.mode === 'auto' ? 'Daily import' : 'Range import'}
          </span>
          <span className="text-xs text-slate-400 font-mono">{fmtRange(job.dateFrom, job.dateTo)}</span>
        </div>
        <div className="flex items-center gap-2">
          <StatusPill status={job.status} />
          <span className="text-[11px] text-slate-400 flex items-center gap-1">
            <Clock className="w-3 h-3" /> {fmtDateTime(job.completedAt ?? job.startedAt)}
          </span>
        </div>
      </div>

      {/* Stat tiles */}
      <div className="grid grid-cols-4 gap-2">
        <StatTile label="Found" value={job.totalFound} tone="found" />
        <StatTile label="Created" value={job.totalCreated} tone="created" />
        <StatTile label="Skipped" value={job.totalSkipped} tone="skipped" />
        <StatTile label="Errors" value={job.totalErrors} tone="errors" />
      </div>

      {job.errorMessage && (
        <p className="flex items-start gap-1.5 text-xs text-rose-600">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" /> {job.errorMessage}
        </p>
      )}

      {/* Per-country breakdown */}
      {countries.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {countries.map(([key, t]) => (
            <span
              key={key}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium border ${countryStyle(key)}`}
            >
              <MapPin className="w-3 h-3" /> {countryLabel(key)}
              <span className="font-bold">+{t.created}</span>
              {t.skipped > 0 && <span className="opacity-60">· {t.skipped} skip</span>}
              {t.errors > 0 && <span className="text-rose-600">· {t.errors} err</span>}
            </span>
          ))}
        </div>
      )}

      {/* Event list */}
      {showEvents && job.events.length > 0 && (
        <div className="border-t border-slate-100 pt-3">
          <div className="max-h-64 overflow-y-auto space-y-1 pr-1">
            {job.events.map((ev, i) => (
              <div key={i} className="flex items-center gap-2 text-xs py-1">
                <ResultIcon result={ev.result} />
                <span className="font-mono font-semibold text-slate-700 w-24 shrink-0">
                  {ev.ref ?? '—'}
                </span>
                <span className="text-slate-400 w-20 shrink-0">q{ev.quotationNo}</span>
                {ev.country && (
                  <span className={`px-1.5 py-0.5 rounded text-[10px] border ${countryStyle(ev.country)}`}>
                    {countryLabel(ev.country)}
                  </span>
                )}
                {ev.message && <span className="text-rose-500 truncate">{ev.message}</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
