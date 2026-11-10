'use client'

/**
 * VN Vendor Sync — the movement chart's "Tour vendors from Excel" panel.
 *
 * Shows, per movement, which line of the desk's Excel checklist it matched,
 * the vendor that line names, how sure the match is, and what the sync did
 * about it. Refreshes itself every minute; "Fetch now" re-reads the Excel and
 * applies straight away. Every write can be undone from here.
 *
 * When the sync changes a movement's tour vendor, `onVendorsChanged` hands the
 * new values to the chart so its local state (and the next Save) carry them.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import {
  RefreshCw, Loader2, History, ChevronDown, ChevronUp, Store, Car, Type, PlaneLanding, PlaneTakeoff,
  Hotel, MapPin, Undo2, Check, EyeOff, Play, FileSpreadsheet, Sparkles, AlertTriangle, ArrowRight,
  Database, ExternalLink, Wand2, ShieldCheck, Hand,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  EVENT_ACTION, KIND_LABEL, LINK_STATUS, timeAgo, timeUntil,
  type BookingVendorSyncPayload, type LinkStatus, type VendorSyncLinkInfo, type RunSummary,
} from '@/lib/vn-vendor-sync/shared'

export interface VendorSyncUpdate {
  agendaItemId: string
  tourVendorId: string | null
  tourVendorName: string | null
  tourVendorPhone: string | null
  /** The vendor on the movement is the one the Excel names (applied or already matching). */
  fromSheet: boolean
}

type Filter = 'all' | 'review' | 'applied' | 'manual'

const POLL_MS = 60_000

// ── Pieces ───────────────────────────────────────────────────────────────────

function KindIcon({ kind }: { kind: string | null }) {
  const cls = 'h-3.5 w-3.5'
  if (kind === 'AIRPORT_ARRIVAL') return <PlaneLanding className={cls} />
  if (kind === 'AIRPORT_DEPARTURE') return <PlaneTakeoff className={cls} />
  if (kind === 'HOTEL_MOVE') return <Hotel className={cls} />
  return <MapPin className={cls} />
}

function SourceIcon({ source }: { source: VendorSyncLinkInfo['directorySource'] }) {
  if (source === 'TOUR_VENDOR') return <span title="Linked to the Tour Vendor directory"><Store className="h-3 w-3 text-teal-600" /></span>
  if (source === 'VEHICLE_VENDOR') return <span title="Phone taken from the transport-vendor directory"><Car className="h-3 w-3 text-sky-600" /></span>
  return <span title="Not in the directory — name only"><Type className="h-3 w-3 text-slate-400" /></span>
}

function Confidence({ score, confidence }: { score: number | null; confidence: 'HIGH' | 'MEDIUM' | null }) {
  if (score === null) return null
  const pct = Math.round(score * 100)
  const tone = confidence === 'HIGH' ? 'bg-emerald-500' : 'bg-amber-400'
  return (
    <span className="inline-flex items-center gap-1.5" title={`Match ${pct}% — ${confidence === 'HIGH' ? 'applied automatically' : 'needs a person'}`}>
      <span className="h-1.5 w-12 overflow-hidden rounded-full bg-slate-100">
        <span className={cn('block h-full rounded-full', tone)} style={{ width: `${pct}%`, transition: 'width 600ms ease' }} />
      </span>
      <span className="text-[10px] font-semibold tabular-nums text-slate-500">{pct}%</span>
    </span>
  )
}

function CountdownRing({ nextRunAt, intervalMin, busy }: { nextRunAt: string | null; intervalMin: number; busy: boolean }) {
  const [, force] = useState(0)
  useEffect(() => { const t = setInterval(() => force(x => x + 1), 15_000); return () => clearInterval(t) }, [])
  const left = nextRunAt ? Math.max(0, new Date(nextRunAt).getTime() - Date.now()) : 0
  const frac = nextRunAt ? 1 - Math.min(1, left / (intervalMin * 60_000)) : 0
  const r = 9, c = 2 * Math.PI * r
  return (
    <span className="relative inline-flex h-6 w-6 items-center justify-center" title={nextRunAt ? `Next sync ${timeUntil(nextRunAt)}` : 'Sync is off'}>
      <svg viewBox="0 0 24 24" className="absolute inset-0 -rotate-90">
        <circle cx="12" cy="12" r={r} fill="none" stroke="rgba(255,255,255,.15)" strokeWidth="2.5" />
        <circle cx="12" cy="12" r={r} fill="none" stroke="#5eead4" strokeWidth="2.5" strokeLinecap="round"
          strokeDasharray={`${frac * c} ${c}`} style={{ transition: 'stroke-dasharray 800ms ease' }} />
      </svg>
      {busy ? <Loader2 className="h-3 w-3 animate-spin text-teal-200" /> : <span className="h-1.5 w-1.5 rounded-full bg-teal-300" />}
    </span>
  )
}

// ── Panel ────────────────────────────────────────────────────────────────────

export default function VnVendorSyncPanel({ bookingRef, onVendorsChanged }: {
  bookingRef: string
  onVendorsChanged?: (updates: VendorSyncUpdate[]) => void
}) {
  const [data, setData] = useState<BookingVendorSyncPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [fetching, setFetching] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [open, setOpen] = useState(true)
  const [showLog, setShowLog] = useState(false)
  const [filter, setFilter] = useState<Filter>('all')
  const lastSig = useRef<string>('')
  const onChangedRef = useRef(onVendorsChanged)
  onChangedRef.current = onVendorsChanged

  // Push what the movements hold now into the chart, whenever it changed.
  const emit = useCallback((d: BookingVendorSyncPayload) => {
    const updates: VendorSyncUpdate[] = d.links
      .filter(l => l.agendaItemId && l.current)
      .map(l => ({
        agendaItemId: l.agendaItemId as string,
        tourVendorId: l.current?.tourVendorId ?? null,
        tourVendorName: l.current?.tourVendorName ?? null,
        tourVendorPhone: l.current?.tourVendorPhone ?? null,
        fromSheet: l.status === 'APPLIED' || l.status === 'IN_SYNC',
      }))
    const sig = JSON.stringify(updates)
    if (sig !== lastSig.current) {
      lastSig.current = sig
      if (updates.length) onChangedRef.current?.(updates)
    }
  }, [])

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true)
    try {
      const res = await fetch(`/api/vn-vendor-sync/booking/${encodeURIComponent(bookingRef)}`, { cache: 'no-store' })
      const json = await res.json()
      if (json.success) { setData(json.data); emit(json.data) }
    } catch { /* keep what we have */ } finally {
      if (!quiet) setLoading(false)
    }
  }, [bookingRef, emit])

  useEffect(() => { void load() }, [load])
  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === 'visible') void load(true) }, POLL_MS)
    return () => clearInterval(t)
  }, [load])

  async function fetchNow() {
    setFetching(true)
    const t = toast.loading('Reading the Excel checklist and matching vendors…')
    try {
      const res = await fetch(`/api/vn-vendor-sync/booking/${encodeURIComponent(bookingRef)}`, { method: 'POST' })
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      const run = json.data.run as RunSummary | null
      const { run: _r, ...payload } = json.data
      setData(payload)
      emit(payload)
      if (!run) toast.success('Up to date', { id: t })
      else if (run.status === 'FAILED') toast.error(run.error ?? 'Sync failed', { id: t })
      else {
        const parts = [
          run.applied && `${run.applied} applied`, run.updated && `${run.updated} updated`,
          run.suggested && `${run.suggested} to review`, run.keptManual && `${run.keptManual} kept as set by hand`,
        ].filter(Boolean)
        toast.success(parts.length ? parts.join(' · ') : 'Everything already matches the Excel', { id: t, description: run.sheetNote ?? undefined })
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Fetch failed', { id: t })
    } finally {
      setFetching(false)
    }
  }

  async function act(link: VendorSyncLinkInfo, action: 'apply' | 'undo' | 'ignore' | 'resume') {
    setBusyId(link.id)
    try {
      const res = await fetch('/api/vn-vendor-sync/action', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, linkId: link.id }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      toast.success(json.data.message)
      await load(true)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed')
    } finally {
      setBusyId(null)
    }
  }

  const counts = useMemo(() => {
    const c: Record<LinkStatus, number> = { APPLIED: 0, IN_SYNC: 0, SUGGESTED: 0, KEPT_MANUAL: 0, STALE: 0, IGNORED: 0 }
    for (const l of data?.links ?? []) c[l.status]++
    return c
  }, [data])

  const shown = useMemo(() => (data?.links ?? []).filter(l =>
    filter === 'all' ? true
      : filter === 'review' ? l.status === 'SUGGESTED'
        : filter === 'applied' ? l.status === 'APPLIED' || l.status === 'IN_SYNC'
          : l.status === 'KEPT_MANUAL'), [data, filter])

  if (loading && !data) {
    return (
      <div className="mb-4 flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-xs text-slate-400">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading tour vendors from Excel…
      </div>
    )
  }
  if (!data) return null

  const total = data.links.length
  const mode = data.config.mode
  const busy = fetching || data.lastRun?.status === 'RUNNING'

  return (
    <section className="mb-5 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      {/* Header */}
      <div className="relative overflow-hidden bg-gradient-to-r from-slate-900 via-slate-900 to-teal-900 px-4 py-3 text-white">
        <div className="pointer-events-none absolute -right-10 -top-16 h-40 w-40 rounded-full bg-teal-500/20 blur-2xl" />
        <div className="relative flex flex-wrap items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/10 ring-1 ring-white/15">
            <Store className="h-4 w-4 text-teal-200" />
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold">Tour vendors from Excel</h3>
              <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ring-1',
                mode === 'AUTO' ? 'bg-emerald-400/15 text-emerald-200 ring-emerald-300/30'
                  : mode === 'SUGGEST' ? 'bg-amber-400/15 text-amber-200 ring-amber-300/30' : 'bg-white/10 text-white/60 ring-white/20')}>
                {mode === 'AUTO' ? `Auto · every ${data.config.intervalMin} min` : mode === 'SUGGEST' ? 'Suggest only' : 'Off'}
              </span>
            </div>
            <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-white/60">
              <FileSpreadsheet className="h-3 w-3" />
              {data.tourCodes.length ? `Checklist ${data.tourCodes.join(', ')}` : 'No block for this booking in the Excel yet'}
              <span className="text-white/30">·</span>
              Excel read {timeAgo(data.sheetSyncedAt)}
            </p>
          </div>

          <div className="ml-auto flex items-center gap-2">
            {mode !== 'OFF' && (
              <span className="hidden items-center gap-2 rounded-full bg-white/10 px-2.5 py-1 text-[11px] text-white/80 ring-1 ring-white/15 sm:inline-flex">
                <CountdownRing nextRunAt={data.nextRunAt} intervalMin={data.config.intervalMin} busy={busy} />
                {busy ? 'Syncing…' : `Next ${timeUntil(data.nextRunAt)}`}
              </span>
            )}
            {data.installed && data.canEdit && (
              <button type="button" onClick={fetchNow} disabled={fetching}
                className="inline-flex items-center gap-1.5 rounded-lg bg-teal-400 px-3 py-1.5 text-xs font-semibold text-slate-900 shadow-sm transition hover:bg-teal-300 disabled:opacity-60">
                {fetching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                Fetch now
              </button>
            )}
            <button type="button" onClick={() => { setShowLog(v => !v); setOpen(true) }}
              className={cn('inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium ring-1 transition',
                showLog ? 'bg-white text-slate-900 ring-white' : 'bg-white/10 text-white ring-white/20 hover:bg-white/20')}>
              <History className="h-3.5 w-3.5" /> Logs
              {data.events.length > 0 && <span className="rounded-full bg-teal-400/80 px-1.5 text-[10px] font-bold text-slate-900">{data.events.length}</span>}
            </button>
            <button type="button" onClick={() => setOpen(v => !v)} className="rounded-lg p-1.5 text-white/70 hover:bg-white/10" aria-label={open ? 'Collapse' : 'Expand'}>
              {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>
          </div>
        </div>

        {/* Distribution bar */}
        {total > 0 && (
          <div className="relative mt-3">
            <div className="flex h-1.5 overflow-hidden rounded-full bg-white/10">
              {(['APPLIED', 'IN_SYNC', 'SUGGESTED', 'KEPT_MANUAL', 'STALE', 'IGNORED'] as LinkStatus[]).map(s => counts[s] > 0 && (
                <span key={s} className={cn('h-full', LINK_STATUS[s].dot)} style={{ width: `${(counts[s] / total) * 100}%` }} title={`${LINK_STATUS[s].label}: ${counts[s]}`} />
              ))}
            </div>
            <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[10.5px] text-white/70">
              {(['APPLIED', 'IN_SYNC', 'SUGGESTED', 'KEPT_MANUAL', 'STALE', 'IGNORED'] as LinkStatus[]).map(s => counts[s] > 0 && (
                <span key={s} className="inline-flex items-center gap-1"><span className={cn('h-1.5 w-1.5 rounded-full', LINK_STATUS[s].dot)} />{LINK_STATUS[s].label} {counts[s]}</span>
              ))}
            </div>
          </div>
        )}
      </div>

      {open && (
        <div className="divide-y divide-slate-100">
          {!data.installed && (
            <div className="flex items-start gap-2 bg-amber-50 px-4 py-3 text-xs text-amber-800">
              <Database className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>Not set up on this database yet. Run <code className="rounded bg-amber-100 px-1">bash prisma/sql/apply-vn-vendor-sync.sh</code> (three new tables, nothing else changes).</span>
            </div>
          )}

          {/* Log */}
          {showLog && (
            <div className="bg-slate-50/70 px-4 py-3">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">What the sync did on {bookingRef}</p>
                <Link href="/dashboard/checklist-vn/vendor-sync" className="inline-flex items-center gap-1 text-[11px] font-medium text-teal-700 hover:underline">
                  Full log <ExternalLink className="h-3 w-3" />
                </Link>
              </div>
              {data.events.length === 0 ? (
                <p className="py-2 text-xs text-slate-400">Nothing yet — the sync has not changed or suggested anything here.</p>
              ) : (
                <ol className="relative max-h-72 space-y-2 overflow-y-auto border-l border-slate-200 pl-4">
                  {data.events.map(e => (
                    <li key={e.id} className="relative">
                      <span className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full bg-white ring-2 ring-teal-400" />
                      <div className="flex flex-wrap items-center gap-1.5 text-[11.5px]">
                        <span className={cn('rounded px-1.5 py-0.5 text-[10px] font-semibold ring-1', EVENT_ACTION[e.action]?.tone)}>{EVENT_ACTION[e.action]?.label ?? e.action}</span>
                        <span className="font-medium text-slate-700">{e.movementLabel}</span>
                        {(e.fromValue || e.toValue) && (
                          <span className="inline-flex items-center gap-1 text-slate-500">
                            <span className={cn(!e.fromValue && 'italic text-slate-400')}>{e.fromValue ?? 'empty'}</span>
                            <ArrowRight className="h-3 w-3" />
                            <span className={cn('font-semibold text-slate-800', !e.toValue && 'italic font-normal text-slate-400')}>{e.toValue ?? 'empty'}</span>
                          </span>
                        )}
                      </div>
                      {e.detail && <p className="mt-0.5 text-[11px] text-slate-500">{e.detail}</p>}
                      <p className="mt-0.5 text-[10px] text-slate-400">{timeAgo(e.createdAt)} · {e.actor ?? 'Auto sync'}</p>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          )}

          {data.installed && total === 0 && (
            <div className="flex items-center gap-3 px-4 py-5 text-xs text-slate-500">
              <Sparkles className="h-4 w-4 text-slate-300" />
              {data.onSheet
                ? 'No upcoming movement matched a vendor line in the Excel yet. Fetch now after the desk fills the VENDORS column.'
                : 'This booking has no block in the Excel checklist yet, so there is nothing to apply.'}
            </div>
          )}

          {total > 0 && (
            <>
              <div className="flex flex-wrap items-center gap-1 px-4 py-2">
                {([
                  ['all', 'All', total], ['review', 'To review', counts.SUGGESTED],
                  ['applied', 'Applied', counts.APPLIED + counts.IN_SYNC], ['manual', 'Kept yours', counts.KEPT_MANUAL],
                ] as [Filter, string, number][]).map(([k, label, n]) => (
                  <button key={k} type="button" onClick={() => setFilter(k)}
                    className={cn('rounded-full px-2.5 py-1 text-[11px] font-medium transition',
                      filter === k ? 'bg-slate-900 text-white' : 'text-slate-500 hover:bg-slate-100')}>
                    {label} <span className={cn('ml-0.5 tabular-nums', filter === k ? 'text-white/60' : 'text-slate-400')}>{n}</span>
                  </button>
                ))}
                <span className="ml-auto hidden items-center gap-1 text-[10.5px] text-slate-400 md:inline-flex">
                  <ShieldCheck className="h-3 w-3" /> Only the tour vendor is written. Drivers, rates and anything set by hand stay as they are.
                </span>
              </div>

              <ul className="divide-y divide-slate-100">
                {shown.map(l => {
                  const st = LINK_STATUS[l.status]
                  const working = busyId === l.id
                  return (
                    <li key={l.id} className={cn('group px-4 py-3 transition hover:bg-slate-50/70', l.status === 'IGNORED' && 'opacity-60')}>
                      <div className="flex flex-wrap items-start gap-3">
                        <div className="flex w-[86px] shrink-0 flex-col items-start gap-1">
                          <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-slate-700">
                            {l.movementDate ? new Date(`${l.movementDate}T00:00:00Z`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: 'UTC' }) : '—'}
                          </span>
                          <span className="inline-flex items-center gap-1 text-[10px] text-slate-400"><KindIcon kind={l.movementKind} />{KIND_LABEL[l.movementKind ?? ''] ?? 'Movement'}</span>
                        </div>

                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[12.5px] font-medium text-slate-800" title={l.movementLabel ?? ''}>
                            {(l.movementLabel ?? '').replace(/^\d{4}-\d{2}-\d{2} · /, '')}
                          </p>
                          {l.lineDetails && (
                            <p className="mt-0.5 flex items-center gap-1.5 truncate text-[11px] text-slate-500" title={`${l.reason ?? ''}`}>
                              <FileSpreadsheet className="h-3 w-3 shrink-0 text-emerald-600" />
                              {l.sheetRow && <span className="font-mono text-[10px] text-slate-400">row {l.sheetRow}</span>}
                              {l.lineCode && <span className="rounded bg-slate-100 px-1 text-[10px] font-semibold text-slate-600">{l.lineCode}</span>}
                              <span className="truncate italic">“{l.lineDetails}”</span>
                            </p>
                          )}
                          {l.also.length > 0 && (
                            <p className="mt-1 flex flex-wrap items-center gap-1 text-[10.5px] text-slate-400">
                              Also on this movement:
                              {l.also.map(a => (
                                <span key={a.vendor} className="rounded-full bg-slate-50 px-1.5 py-0.5 text-slate-600 ring-1 ring-slate-200" title={a.details}>
                                  {a.vendor}{a.code ? ` · ${a.code}` : ''}
                                </span>
                              ))}
                            </p>
                          )}
                          {l.note && <p className="mt-1 text-[10.5px] text-slate-400">{l.note}</p>}
                        </div>

                        <div className="flex min-w-[200px] flex-col items-end gap-1.5">
                          <div className="flex items-center gap-2">
                            {l.status === 'KEPT_MANUAL' && l.current?.tourVendorName && (
                              <span className="inline-flex items-center gap-1 rounded-lg bg-violet-50 px-2 py-1 text-[11.5px] font-semibold text-violet-700 ring-1 ring-violet-100" title="Set by hand on the movement">
                                <Hand className="h-3 w-3" />{l.current.tourVendorName}
                              </span>
                            )}
                            <span className={cn('inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[12px] font-semibold ring-1',
                              l.status === 'APPLIED' || l.status === 'IN_SYNC' ? 'bg-teal-50 text-teal-800 ring-teal-100'
                                : l.status === 'KEPT_MANUAL' ? 'bg-white text-slate-500 ring-slate-200 line-through decoration-slate-300'
                                  : 'bg-white text-slate-800 ring-slate-200')}
                              title={l.vendorPhone ? `${l.vendorName} · ${l.vendorPhone}` : l.vendorName ?? ''}>
                              <SourceIcon source={l.directorySource} />
                              {l.vendorName ?? l.sheetVendor ?? '—'}
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            <Confidence score={l.score} confidence={l.confidence} />
                            <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1', st.pill)} title={st.hint}>{st.label}</span>
                          </div>
                          {data.canEdit && (
                            <div className="flex items-center gap-1">
                              {working && <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-400" />}
                              {!working && l.status === 'SUGGESTED' && (
                                <>
                                  <button type="button" onClick={() => act(l, 'apply')} className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-2 py-1 text-[11px] font-semibold text-white hover:bg-emerald-700">
                                    <Check className="h-3 w-3" /> Apply
                                  </button>
                                  <button type="button" onClick={() => act(l, 'ignore')} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-slate-500 hover:bg-slate-100">
                                    <EyeOff className="h-3 w-3" /> Ignore
                                  </button>
                                </>
                              )}
                              {!working && l.status === 'KEPT_MANUAL' && (
                                <>
                                  <button type="button" onClick={() => {
                                    if (window.confirm(`Replace "${l.current?.tourVendorName}" with "${l.vendorName}" from the Excel?`)) void act(l, 'apply')
                                  }} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-teal-700 hover:bg-teal-50">
                                    <Wand2 className="h-3 w-3" /> Use Excel
                                  </button>
                                  <button type="button" onClick={() => act(l, 'ignore')} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-slate-500 hover:bg-slate-100">
                                    <EyeOff className="h-3 w-3" /> Ignore
                                  </button>
                                </>
                              )}
                              {!working && (l.status === 'APPLIED' || (l.status === 'STALE' && l.appliedName)) && l.appliedName && (
                                <button type="button" onClick={() => act(l, 'undo')} title={`Put back ${l.prevName ? `"${l.prevName}"` : 'an empty tour vendor'}`}
                                  className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-rose-600 opacity-70 hover:bg-rose-50 group-hover:opacity-100">
                                  <Undo2 className="h-3 w-3" /> Undo
                                </button>
                              )}
                              {!working && l.status === 'IGNORED' && (
                                <button type="button" onClick={() => act(l, 'resume')} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-indigo-600 hover:bg-indigo-50">
                                  <Play className="h-3 w-3" /> Resume
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    </li>
                  )
                })}
                {shown.length === 0 && <li className="px-4 py-4 text-center text-xs text-slate-400">Nothing in this view.</li>}
              </ul>
            </>
          )}

          {data.lastRun?.status === 'FAILED' && (
            <div className="flex items-start gap-2 bg-rose-50 px-4 py-2.5 text-[11px] text-rose-700">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              Last sweep failed {timeAgo(data.lastRun.startedAt)}: {data.lastRun.error}
            </div>
          )}
        </div>
      )}
    </section>
  )
}
