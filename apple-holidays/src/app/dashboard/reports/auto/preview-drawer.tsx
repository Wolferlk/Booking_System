'use client'

/**
 * Full-screen preview of a report.
 *
 * The email body is rendered in a sandboxed iframe from the same endpoint the
 * mailer uses, so what is on screen is literally the message that will be sent —
 * no second renderer to drift out of sync.
 */

import { useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle, Download, Loader2, Mail, Monitor, Smartphone, X,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Schedule } from './types'

export interface PreviewRequest {
  scheduleId?: string
  period?: string
  timezone?: string
  countries?: string[]
  aiSummary?: boolean
  maxRows?: number
  title?: string
}

/** Build the query the preview endpoint expects from either a saved id or a draft. */
export function previewQuery(req: PreviewRequest): string {
  const p = new URLSearchParams()
  if (req.scheduleId) p.set('scheduleId', req.scheduleId)
  else {
    p.set('period', req.period ?? 'DAILY')
    if (req.timezone) p.set('timezone', req.timezone)
    if (req.countries?.length) p.set('countries', req.countries.join(','))
    if (req.aiSummary) p.set('aiSummary', 'true')
    if (req.maxRows) p.set('maxRows', String(req.maxRows))
  }
  return p.toString()
}

export function previewRequestFor(draft: Partial<Schedule>): PreviewRequest {
  return {
    // A saved schedule previews by id so the exact stored config is used;
    // an unsaved draft previews its in-flight values instead.
    scheduleId: draft.id,
    period: draft.period,
    timezone: draft.timezone,
    countries: draft.countries,
    aiSummary: draft.aiSummary,
    maxRows: draft.maxRows,
    title: draft.name || 'Preview',
  }
}

interface Summary {
  subject: string
  data: {
    window: { label: string; fromDate: string; toDate: string; timezone: string }
    created: { total: number; channel: { b2b: number; b2c: number }; pax: number }
    onGround: { total: number; pax: number }
    readiness: { total: number; notReady: number; tomorrow: number }
    complaints: { total: number; open: number; available: boolean }
    upcoming: { total: number; next7: number }
  }
}

export default function PreviewDrawer({
  request, onClose,
}: {
  request: PreviewRequest | null
  onClose: () => void
}) {
  const [summary, setSummary] = useState<Summary | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop')

  const query = useMemo(() => (request ? previewQuery(request) : ''), [request])

  useEffect(() => {
    if (!request) { setSummary(null); setError(null); return }
    let cancelled = false
    setLoading(true)
    setError(null)
    fetch(`/api/reports/auto/preview?${query}`)
      .then(async res => {
        const json = await res.json()
        if (!res.ok || !json.success) throw new Error(json.error || 'Preview failed')
        if (!cancelled) setSummary(json.data as Summary)
      })
      .catch(err => { if (!cancelled) setError(err instanceof Error ? err.message : 'Preview failed') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [request, query])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    if (request) {
      document.addEventListener('keydown', onKey)
      document.body.style.overflow = 'hidden'
    }
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [request, onClose])

  if (!request) return null

  const d = summary?.data
  const stats = d ? [
    { label: 'Created', value: d.created.total, sub: `${d.created.channel.b2b} B2B · ${d.created.channel.b2c} B2C` },
    { label: 'On ground', value: d.onGround.total, sub: `${d.onGround.pax} guests` },
    { label: 'Next 3 days', value: d.readiness.total, sub: `${d.readiness.notReady} not ready` },
    { label: 'Complaints', value: d.complaints.total, sub: d.complaints.available ? `${d.complaints.open} open` : 'unavailable' },
    { label: 'Upcoming', value: d.upcoming.total, sub: `${d.upcoming.next7} in 7 days` },
  ] : []

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-slate-900/60 backdrop-blur-sm animate-fade-in">
      <div className="flex-1 flex flex-col m-0 sm:m-4 bg-slate-100 sm:rounded-2xl overflow-hidden shadow-2xl">
        {/* Head */}
        <div className="px-5 py-3.5 bg-white border-b border-slate-200 flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-sm font-bold text-slate-900">
              <Mail className="w-4 h-4 text-teal-600 flex-shrink-0" />
              <span className="truncate">{summary?.subject ?? request.title ?? 'Report preview'}</span>
            </div>
            <p className="text-xs text-slate-500 mt-0.5 truncate">
              {d ? `${d.window.label} · times in ${d.window.timezone}` : 'Building the report…'}
            </p>
          </div>

          <div className="hidden sm:flex items-center gap-1 p-1 rounded-lg bg-slate-100">
            {([['desktop', Monitor], ['mobile', Smartphone]] as const).map(([mode, Icon]) => (
              <button
                key={mode}
                onClick={() => setDevice(mode)}
                className={cn(
                  'p-1.5 rounded-md transition-colors',
                  device === mode ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-400 hover:text-slate-600',
                )}
                title={`${mode} width`}
              >
                <Icon className="w-4 h-4" />
              </button>
            ))}
          </div>

          <a
            href={`/api/reports/auto/preview?${query}&format=csv`}
            className="hidden sm:inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
          >
            <Download className="w-3.5 h-3.5" /> CSV
          </a>

          <button onClick={onClose} className="p-2 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Stat strip */}
        {stats.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-px bg-slate-200 border-b border-slate-200">
            {stats.map(s => (
              <div key={s.label} className="bg-white px-4 py-2.5">
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{s.label}</div>
                <div className="text-xl font-extrabold text-slate-900 leading-tight">{s.value.toLocaleString()}</div>
                <div className="text-[11px] text-slate-500">{s.sub}</div>
              </div>
            ))}
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-auto bg-slate-200/60 p-3 sm:p-6">
          {error ? (
            <div className="max-w-lg mx-auto mt-10 p-5 rounded-xl bg-white border border-red-200">
              <div className="flex items-center gap-2 text-red-600 font-semibold text-sm">
                <AlertTriangle className="w-4 h-4" /> Preview failed
              </div>
              <p className="text-sm text-slate-600 mt-2">{error}</p>
            </div>
          ) : loading && !summary ? (
            <div className="h-full flex flex-col items-center justify-center text-slate-400 gap-3">
              <Loader2 className="w-7 h-7 animate-spin" />
              <p className="text-sm">Collecting bookings, tours and complaints…</p>
            </div>
          ) : (
            <iframe
              key={query}
              title="Report preview"
              src={`/api/reports/auto/preview?${query}&format=html`}
              sandbox=""
              className={cn(
                'bg-white mx-auto block border border-slate-300 rounded-lg shadow-sm transition-all',
                device === 'mobile' ? 'w-[400px] max-w-full' : 'w-full max-w-[760px]',
              )}
              style={{ height: 'calc(100vh - 260px)', minHeight: 420 }}
            />
          )}
        </div>
      </div>
    </div>
  )
}
