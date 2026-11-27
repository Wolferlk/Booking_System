'use client'

/**
 * "Confirmation Descriptions" — pull every movement's official description from
 * AppleSystem (the booking confirmation) in one go, preview old vs new, and load
 * the ticked ones into the editor draft. Nothing is saved until Save changes.
 */
import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, ArrowRight, CheckCircle2, ChevronDown, ChevronUp, FileCheck2, Loader2, RefreshCw } from 'lucide-react'
import Modal from '@/components/ui/modal'
import { cn } from '@/lib/utils'
import { matchSourceDescriptions, sameDescription, type MatchConfidence, type SourceEntry, type SourceMatchResult } from '@/lib/agenda-source-match'

export interface DescItem { date: string; fromPoint: string; toPoint: string; location: string; details: string; serviceType?: string }
export interface DescChange { idx: number; details: string; expect: { date: string; toPoint: string } }

const CONF: Record<MatchConfidence, { label: string; tone: string }> = {
  exact: { label: 'Exact match', tone: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  good: { label: 'Good match', tone: 'bg-sky-50 text-sky-700 ring-sky-200' },
  check: { label: 'Please check', tone: 'bg-amber-50 text-amber-700 ring-amber-200' },
}
const fmt = (d: string) => (d ? new Date(`${d.slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', timeZone: 'UTC' }) : '—')

export default function ConfirmationDescriptionsModal({ open, onClose, bookingRef, items, arrivalDate, onApply }: {
  open: boolean
  onClose: () => void
  bookingRef: string
  items: DescItem[]
  arrivalDate?: string | null
  onApply: (changes: DescChange[]) => void
}) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sources, setSources] = useState<SourceEntry[] | null>(null)
  const [picked, setPicked] = useState<Set<number>>(new Set())
  const [openRow, setOpenRow] = useState<number | null>(null)
  const [onlyChanges, setOnlyChanges] = useState(true)

  async function fetchSources() {
    setLoading(true); setError(null)
    try {
      const res = await fetch(`/api/bookings/${encodeURIComponent(bookingRef)}/agenda/source-description`, { cache: 'no-store' })
      const json = await res.json()
      if (!res.ok || !json.success) throw new Error(json.error || 'Could not read the confirmation descriptions')
      setSources(Array.isArray(json.data?.items) ? json.data.items : [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read the confirmation')
      setSources(null)
    } finally { setLoading(false) }
  }

  // Fresh read every time the dialog opens.
  useEffect(() => { if (open) { setSources(null); setOpenRow(null); void fetchSources() } }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  const result: SourceMatchResult | null = useMemo(
    () => (sources ? matchSourceDescriptions(items, sources, arrivalDate) : null),
    [sources, items, arrivalDate],
  )
  const rows = useMemo(() => items.map((item, idx) => {
    const m = result?.byItem.get(idx) ?? null
    return { item, idx, m, changed: Boolean(m && !sameDescription(m.description, item.details)) }
  }), [items, result])
  const changed = rows.filter(r => r.changed)
  const same = rows.filter(r => r.m && !r.changed).length
  const none = rows.filter(r => !r.m).length

  // Default ticks: every confident change. "Please check" waits for a person.
  useEffect(() => {
    if (!result) return
    setPicked(new Set(rows.filter(r => r.changed && r.m!.confidence !== 'check').map(r => r.idx)))
  }, [result]) // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (idx: number) => setPicked(cur => { const n = new Set(cur); if (n.has(idx)) n.delete(idx); else n.add(idx); return n })
  const allOn = changed.length > 0 && changed.every(r => picked.has(r.idx))
  const visible = onlyChanges ? rows.filter(r => r.changed || !r.m) : rows

  function apply() {
    onApply(changed.filter(r => picked.has(r.idx)).map(r => ({ idx: r.idx, details: r.m!.description, expect: { date: r.item.date, toPoint: r.item.toPoint } })))
  }

  return (
    <Modal open={open} onClose={onClose} size="4xl" title={`Confirmation Descriptions — ${bookingRef}`}
      footer={
        <div className="flex w-full flex-wrap items-center gap-2">
          <p className="mr-auto text-[11.5px] text-slate-500">Loads into the draft only — press <b>Save changes</b> to keep it.</p>
          <button type="button" onClick={onClose} className="rounded-lg px-3 py-2 text-sm text-slate-600 hover:bg-slate-100">Cancel</button>
          <button type="button" disabled={!picked.size || loading} onClick={apply}
            className="inline-flex items-center gap-1.5 rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-sky-500 disabled:opacity-40">
            <FileCheck2 className="h-4 w-4" /> Replace {picked.size} description{picked.size === 1 ? '' : 's'}
          </button>
        </div>
      }>
      {loading ? (
        <div className="flex flex-col items-center gap-3 py-14 text-sm text-slate-500">
          <Loader2 className="h-6 w-6 animate-spin text-sky-500" />
          Reading the confirmation (AppleSystem, or the Aahaas admin for B2C)…
        </div>
      ) : error ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
          <p className="flex items-center gap-2 font-semibold"><AlertTriangle className="h-4 w-4" />Could not load descriptions</p>
          <p className="mt-1 text-[12.5px]">{error}</p>
          <button type="button" onClick={fetchSources} className="mt-3 inline-flex items-center gap-1 rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-rose-700 ring-1 ring-rose-200 hover:bg-rose-100"><RefreshCw className="h-3.5 w-3.5" />Try again</button>
        </div>
      ) : result && (
        <div className="space-y-3">
          {/* Summary */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              ['Will change', changed.length, 'text-sky-700 bg-sky-50 ring-sky-200'],
              ['Already the same', same, 'text-emerald-700 bg-emerald-50 ring-emerald-200'],
              ['No entry found', none, 'text-slate-600 bg-slate-50 ring-slate-200'],
              ['Entries not placed', result.leftovers.length, result.leftovers.length ? 'text-amber-700 bg-amber-50 ring-amber-200' : 'text-slate-600 bg-slate-50 ring-slate-200'],
            ].map(([label, n, tone]) => (
              <div key={label as string} className={cn('rounded-xl px-3 py-2 ring-1', tone as string)}>
                <p className="text-[10.5px] font-medium uppercase tracking-wide opacity-70">{label}</p>
                <p className="text-xl font-bold tabular-nums">{n}</p>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-3 text-[12px]">
            <label className={cn('inline-flex items-center gap-2 font-medium', changed.length ? 'cursor-pointer text-slate-700' : 'opacity-40')}>
              <input type="checkbox" checked={allOn} disabled={!changed.length} onChange={() => setPicked(allOn ? new Set() : new Set(changed.map(r => r.idx)))}
                className="h-4 w-4 rounded border-slate-300 accent-sky-600" />
              Select all changes ({changed.length})
            </label>
            <label className="ml-auto inline-flex cursor-pointer items-center gap-2 text-slate-500">
              <input type="checkbox" checked={onlyChanges} onChange={e => setOnlyChanges(e.target.checked)} className="h-3.5 w-3.5 rounded border-slate-300" />
              Hide movements that are already the same
            </label>
          </div>

          {changed.length === 0 && none === 0 && (
            <p className="flex items-center gap-2 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700"><CheckCircle2 className="h-4 w-4" />Every description already matches the confirmation.</p>
          )}

          <ul className="space-y-2">
            {visible.map(({ item, idx, m, changed: isChange }) => {
              const on = picked.has(idx)
              const expanded = openRow === idx
              return (
                <li key={idx} className={cn('overflow-hidden rounded-xl border transition',
                  !m ? 'border-dashed border-slate-200 bg-slate-50/60' : on ? 'border-sky-300 bg-sky-50/30 ring-1 ring-sky-200' : 'border-slate-200 bg-white')}>
                  <div className="flex items-start gap-3 px-3 py-2.5">
                    <input type="checkbox" checked={on} disabled={!isChange} onChange={() => toggle(idx)}
                      className="mt-1 h-4 w-4 shrink-0 rounded border-slate-300 accent-sky-600 disabled:opacity-30" />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="rounded bg-slate-900 px-1.5 py-px font-mono text-[10px] font-semibold text-white">#{idx + 1}</span>
                        <span className="text-[11.5px] font-medium text-slate-500">{fmt(item.date)}</span>
                        <span className="min-w-0 truncate text-[12.5px] font-semibold text-slate-800">
                          {item.fromPoint || '—'} <ArrowRight className="mx-0.5 inline h-3 w-3 text-slate-400" /> {item.toPoint || item.location || '—'}
                        </span>
                        {m ? (
                          isChange
                            ? <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1', CONF[m.confidence].tone)}>{CONF[m.confidence].label}</span>
                            : <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 ring-1 ring-emerald-200">Already the same</span>
                        ) : <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500">No confirmation entry for this movement — kept</span>}
                      </div>
                      {m && m.title && <p className="mt-0.5 truncate text-[10.5px] text-slate-400">Confirmation: <span className="text-slate-600">{m.title}</span></p>}

                      {m && isChange && (
                        <div className="mt-2 grid gap-2 md:grid-cols-2">
                          <div className="rounded-lg bg-rose-50/60 p-2 ring-1 ring-rose-100">
                            <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-rose-500">Now</p>
                            <p className={cn('whitespace-pre-line text-[11.5px] text-slate-600', !expanded && 'line-clamp-3', !item.details?.trim() && 'italic text-slate-400')}>{item.details?.trim() || 'empty'}</p>
                          </div>
                          <div className="rounded-lg bg-emerald-50/60 p-2 ring-1 ring-emerald-100">
                            <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-600">From the confirmation</p>
                            <p className={cn('whitespace-pre-line text-[11.5px] text-slate-800', !expanded && 'line-clamp-3')}>{m.description}</p>
                          </div>
                        </div>
                      )}
                    </div>
                    {m && isChange && (
                      <button type="button" onClick={() => setOpenRow(expanded ? null : idx)} className="shrink-0 rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600" title={expanded ? 'Collapse' : 'Read in full'}>
                        {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                      </button>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>

          {result.leftovers.length > 0 && (
            <details className="rounded-xl border border-amber-200 bg-amber-50/60 px-3 py-2 text-[12px] text-amber-800">
              <summary className="cursor-pointer font-semibold">{result.leftovers.length} confirmation entr{result.leftovers.length === 1 ? 'y' : 'ies'} matched no movement</summary>
              <p className="mt-1 text-[11px] text-amber-700">Usually a day with more activities than movements, or a date that differs. Copy the text by hand if it belongs on a movement.</p>
              <ul className="mt-2 space-y-1.5">
                {result.leftovers.map(l => (
                  <li key={l.sourceIdx} className="rounded-lg bg-white/70 p-2">
                    <p className="text-[11px] font-semibold">{l.date ? fmt(l.date) : 'No date'} · {l.title || 'Untitled'}</p>
                    <p className="line-clamp-2 text-[11px] text-slate-600">{l.description}</p>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </Modal>
  )
}
