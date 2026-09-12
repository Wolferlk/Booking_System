'use client'

/**
 * The count check, opened up.
 *
 * The chip explains in three rows why the daily report says one number and the
 * list says another. The next question is always "which ones?", and until this
 * existed there was no way to answer it: part of the report's cohort sits
 * outside any created-date filter by definition, so the list itself can never
 * be arranged into the answer.
 *
 * So every population gets a tab, every booking gets a row, and every row
 * carries the sentence — with its own dates in it — saying why it counts on one
 * side and not the other. The same file is one click away as a workbook, for
 * the meeting after the screen is closed.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  X, Download, Loader2, AlertTriangle, Search, ArrowRight, Minus, Plus, Equal,
} from 'lucide-react'
import { readApiResponse } from '@/lib/utils'
import type {
  ReconcileBucket, ReconcileBucketMeta, ReconcileDetail, ReconcileRow,
} from '@/lib/reports/created-reconcile-detail'

export interface ReconcileDetailModalProps {
  /** The window the panel was describing — presets resolve server-side. */
  preset: 'today' | 'yesterday' | null
  from: string | null
  to: string | null
  onClose: () => void
}

const BUCKET_TONE: Record<ReconcileBucket, string> = {
  matched: 'text-emerald-700 bg-emerald-50 border-emerald-200',
  earlier: 'text-rose-700 bg-rose-50 border-rose-200',
  later:   'text-sky-700 bg-sky-50 border-sky-200',
  missing: 'text-amber-800 bg-amber-50 border-amber-200',
  b2c:     'text-violet-700 bg-violet-50 border-violet-200',
}

function fmtDate(v: string | null): string {
  if (!v) return '—'
  const d = new Date(v.length <= 10 ? `${v}T00:00:00.000Z` : v)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-GB', { timeZone: 'UTC', day: '2-digit', month: 'short', year: '2-digit' })
}

function fmtStamp(v: string | null): string {
  if (!v) return '—'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

export default function ReconcileDetailModal({ preset, from, to, onClose }: ReconcileDetailModalProps) {
  const [data, setData]       = useState<ReconcileDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed]   = useState<string | null>(null)
  const [tab, setTab]         = useState<ReconcileBucket>('matched')
  const [term, setTerm]       = useState('')

  const query = useMemo(() => {
    const p = new URLSearchParams()
    if (preset) p.set('preset', preset)
    else if (from && to) { p.set('from', from); p.set('to', to) }
    return p.toString()
  }, [preset, from, to])

  const load = useCallback(async () => {
    setLoading(true)
    setFailed(null)
    try {
      const res  = await fetch(`/api/bookings/report-count/detail?${query}`)
      const json = await readApiResponse<ReconcileDetail>(res)
      if (!json.success || !json.data) { setFailed(json.error ?? 'The reconciliation could not be built'); return }
      setData(json.data)
      // Open on the bucket somebody has to act on, when there is one.
      if (json.data.missing > 0) setTab('missing')
    } catch {
      setFailed('Could not reach the reconciliation')
    } finally {
      setLoading(false)
    }
  }, [query])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const bucket: ReconcileBucketMeta | undefined = data?.buckets.find(b => b.key === tab)

  const rows: ReconcileRow[] = useMemo(() => {
    if (!data) return []
    const t = term.trim().toLowerCase()
    return data.rows
      .filter(r => r.bucket === tab)
      .filter(r => !t || [r.bookingRef, r.isNumber, r.leadPassenger, r.agent, r.country]
        .some(v => (v ?? '').toLowerCase().includes(t)))
  }, [data, tab, term])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onMouseDown={onClose}>
      <div
        className="w-full max-w-[92rem] max-h-[92vh] bg-white rounded-2xl shadow-2xl flex flex-col overflow-hidden"
        onMouseDown={e => e.stopPropagation()}
      >
        {/* ── Header ───────────────────────────────────────────────────────── */}
        <div className="flex items-start justify-between gap-4 px-5 py-4 border-b border-slate-200">
          <div>
            <h2 className="text-base font-bold text-slate-900">
              Count check — why the report and this list differ
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              {data
                ? `${fmtDate(data.from)}${data.to === data.from ? '' : ` → ${fmtDate(data.to)}`} · business days in ${data.timezone}`
                : 'Loading the window…'}
              {data?.sweptAt && ` · ledger last swept ${fmtStamp(data.sweptAt)}`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <a
              href={`/api/bookings/report-count/workbook?${query}`}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold bg-brand-600 text-white hover:bg-brand-700 transition-colors"
              title="Every tab below, plus two tabs explaining the arithmetic, as an Excel file"
            >
              <Download className="w-3.5 h-3.5" /> Download Excel
            </a>
            <button onClick={onClose} className="p-2 rounded-lg text-slate-400 hover:bg-slate-100" title="Close">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {loading && (
          <div className="flex-1 flex items-center justify-center py-20 text-sm text-slate-400 gap-2">
            <Loader2 className="w-4 h-4 animate-spin" /> Building the reconciliation…
          </div>
        )}

        {!loading && failed && (
          <div className="flex-1 flex items-center justify-center py-20 text-sm text-rose-600 gap-2">
            <AlertTriangle className="w-4 h-4" /> {failed}
          </div>
        )}

        {!loading && data && (
          <>
            {/* ── The identity, across the top ───────────────────────────── */}
            <div className="px-5 py-3 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center gap-2 text-xs">
              <Figure label="Filed here (B2B)" value={data.opsIntakeB2B} />
              <Minus className="w-3 h-3 text-slate-400" />
              <Figure label="Earlier confirmation" value={data.earlierConfirmations} tone="rose" onClick={() => setTab('earlier')} />
              <Plus className="w-3 h-3 text-slate-400" />
              <Figure label="Filed here later" value={data.enteredLater} tone="sky" onClick={() => setTab('later')} />
              <Equal className="w-3 h-3 text-slate-400" />
              <Figure label="Daily report" value={data.reportTotal} tone="brand" />
              <span className="mx-1 h-5 w-px bg-slate-200" />
              <Figure label="Confirmed upstream" value={data.upstream} />
              <Figure label="Missing here" value={data.missing} tone={data.missing ? 'amber' : undefined} onClick={() => setTab('missing')} />
            </div>

            {!data.available && (
              <p className="px-5 py-2 text-xs text-amber-800 bg-amber-50 border-b border-amber-200">
                The accounts ledger could not be read for this window, so nothing below is matched against a
                confirmation — these are plain intake rows. {data.error}
              </p>
            )}

            {/* ── Tabs ──────────────────────────────────────────────────── */}
            <div className="px-5 pt-3 flex flex-wrap gap-2 border-b border-slate-200">
              {data.buckets.map(b => (
                <button
                  key={b.key}
                  onClick={() => setTab(b.key)}
                  className={`px-3 py-1.5 rounded-t-lg text-xs font-semibold border-b-2 transition-colors ${
                    tab === b.key
                      ? 'border-brand-600 text-slate-900'
                      : 'border-transparent text-slate-500 hover:text-slate-800'
                  }`}
                >
                  {b.label}
                  <span className={`ml-1.5 px-1.5 py-px rounded-full border text-[10px] tabular-nums ${BUCKET_TONE[b.key]}`}>
                    {b.count}
                  </span>
                </button>
              ))}
            </div>

            {/* ── What this tab is ──────────────────────────────────────── */}
            {bucket && (
              <div className="px-5 py-3 flex items-start justify-between gap-4 border-b border-slate-100">
                <p className="text-xs text-slate-600 leading-relaxed max-w-5xl">
                  <span className="inline-flex items-center gap-1 font-semibold text-slate-800">
                    {bucket.effect} <ArrowRight className="w-3 h-3 text-slate-400" />
                  </span>{' '}
                  {bucket.explain}
                </p>
                <div className="relative shrink-0">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
                  <input
                    value={term}
                    onChange={e => setTerm(e.target.value)}
                    placeholder="Filter this tab…"
                    className="pl-8 pr-3 py-1.5 w-56 rounded-lg border border-slate-200 text-xs focus:outline-none focus:ring-2 focus:ring-brand-100"
                  />
                </div>
              </div>
            )}

            {/* ── Rows ──────────────────────────────────────────────────── */}
            <div className="flex-1 overflow-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-white shadow-[0_1px_0_0_rgb(226,232,240)]">
                  <tr className="text-left text-slate-500">
                    <Th>Booking</Th>
                    <Th>Lead passenger</Th>
                    <Th>Agent</Th>
                    <Th>Country</Th>
                    <Th className="text-right">Pax</Th>
                    <Th>Arrival</Th>
                    <Th>Filed here</Th>
                    <Th className="text-right">Quoted</Th>
                    <Th>Why it sits here</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.map(r => (
                    <tr key={`${r.bucket}-${r.bookingRef}`} className="hover:bg-slate-50 align-top">
                      <td className="px-3 py-2 font-semibold text-slate-900 whitespace-nowrap">{r.bookingRef}</td>
                      <td className="px-3 py-2 text-slate-700">{r.leadPassenger ?? '—'}</td>
                      <td className="px-3 py-2 text-slate-600">{r.agent ?? '—'}</td>
                      <td className="px-3 py-2 text-slate-600 whitespace-nowrap">{r.country ?? '—'}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-700">{r.pax ?? '—'}</td>
                      <td className="px-3 py-2 text-slate-600 whitespace-nowrap">{fmtDate(r.arrivalDate)}</td>
                      <td className="px-3 py-2 text-slate-600 whitespace-nowrap">{fmtStamp(r.filedHere)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-700 whitespace-nowrap">
                        {r.quotedTotal === null ? '—' : `${r.currency ?? ''} ${r.quotedTotal.toLocaleString()}`}
                      </td>
                      <td className="px-3 py-2 text-slate-500 leading-relaxed min-w-[26rem]">{r.reason}</td>
                    </tr>
                  ))}
                  {!rows.length && (
                    <tr>
                      <td colSpan={9} className="px-3 py-10 text-center text-slate-400">
                        {term
                          ? 'Nothing on this tab matches that.'
                          : tab === 'missing'
                            ? 'Nothing — every confirmation raised in this window has a booking here.'
                            : 'Nothing in this window.'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <p className="px-5 py-2.5 border-t border-slate-200 text-[11px] text-slate-400 leading-relaxed">
              The report counts the confirmations Apple System raised in this window, whenever they were filed
              here; this list counts what was filed here inside it. Only <strong>Missing here</strong> is a
              fault — the rest is timing and channel. The ledger holds no country, so this is a whole-window,
              all-countries answer regardless of the filters on the list behind.
            </p>
          </>
        )}
      </div>
    </div>
  )
}

function Th({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <th className={`px-3 py-2 font-semibold whitespace-nowrap ${className}`}>{children}</th>
}

function Figure({
  label, value, tone, onClick,
}: { label: string; value: number; tone?: 'rose' | 'sky' | 'amber' | 'brand'; onClick?: () => void }) {
  const colour =
    tone === 'rose'  ? 'text-rose-700 border-rose-200 bg-rose-50'
    : tone === 'sky'   ? 'text-sky-700 border-sky-200 bg-sky-50'
    : tone === 'amber' ? 'text-amber-800 border-amber-200 bg-amber-50'
    : tone === 'brand' ? 'text-white border-brand-600 bg-brand-600'
    : 'text-slate-700 border-slate-200 bg-white'

  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag
      onClick={onClick}
      className={`px-2.5 py-1.5 rounded-lg border ${colour} ${onClick ? 'hover:brightness-95 transition-[filter]' : ''}`}
    >
      <span className="block text-[10px] uppercase tracking-wide opacity-70 leading-none">{label}</span>
      <span className="block font-bold tabular-nums leading-tight mt-0.5">{value.toLocaleString()}</span>
    </Tag>
  )
}
