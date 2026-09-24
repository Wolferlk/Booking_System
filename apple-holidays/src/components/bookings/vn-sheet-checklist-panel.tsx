'use client'

/**
 * Checklist VN 2.1v — this booking's block from the VN desk's live Excel
 * checklist, shown at the foot of the booking page.
 *
 * Read-only: what the sheet says as of the last sync (every 2 hours). The
 * header chip shows how fresh it is; opening a stale one starts a sync in the
 * background and the panel re-polls until it lands.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import {
  FileSpreadsheet, RefreshCw, Download, ExternalLink, Loader2, Search, Users, CalendarRange,
  ArrowRight, TrendingUp, TrendingDown, Wallet, Receipt, History, AlertTriangle, CheckCircle2,
  CircleDashed, Sparkles, LayoutGrid, Database,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  PAID_BUCKETS, PAID_BUCKET_ORDER, codeStyle, fmtPct, fmtUsd, fmtVnd, isPaidBucket, timeAgo,
  type BookingSheetPayload, type PaidBucket, type SheetLine,
} from '@/lib/vn-checklist-sheet/shared'

type Tour = BookingSheetPayload['tours'][number]
type Filter = 'all' | 'open' | 'check' | 'paid'

// ── Small pieces ─────────────────────────────────────────────────────────────

function MarginRing({ value }: { value: number | null }) {
  const pct = value === null ? 0 : Math.max(-1, Math.min(1, value))
  const r = 30
  const c = 2 * Math.PI * r
  const tone = value === null ? '#cbd5e1' : value < 0 ? '#ef4444' : value < 0.1 ? '#f59e0b' : '#10b981'
  return (
    <div className="relative h-[76px] w-[76px] shrink-0">
      <svg viewBox="0 0 76 76" className="h-full w-full -rotate-90">
        <circle cx="38" cy="38" r={r} fill="none" stroke="#f1f5f9" strokeWidth="8" />
        <circle
          cx="38" cy="38" r={r} fill="none" stroke={tone} strokeWidth="8" strokeLinecap="round"
          strokeDasharray={`${Math.abs(pct) * c} ${c}`}
          style={{ transition: 'stroke-dasharray 900ms cubic-bezier(.2,.8,.2,1)' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-[15px] font-bold tabular-nums" style={{ color: tone }}>{fmtPct(value)}</span>
        <span className="text-[9px] font-medium uppercase tracking-wider text-slate-400">margin</span>
      </div>
    </div>
  )
}

function Kpi({ icon: Icon, label, value, sub, tone = 'slate' }: {
  icon: typeof Wallet; label: string; value: string; sub?: string; tone?: 'slate' | 'emerald' | 'rose' | 'indigo' | 'amber'
}) {
  const tones = {
    slate: 'bg-slate-100 text-slate-600', emerald: 'bg-emerald-100 text-emerald-700',
    rose: 'bg-rose-100 text-rose-700', indigo: 'bg-indigo-100 text-indigo-700', amber: 'bg-amber-100 text-amber-700',
  }
  return (
    <div className="group rounded-xl border border-slate-200/80 bg-white p-3.5 transition hover:-translate-y-0.5 hover:shadow-md">
      <div className="flex items-center gap-2">
        <span className={cn('flex h-7 w-7 items-center justify-center rounded-lg', tones[tone])}><Icon className="h-3.5 w-3.5" /></span>
        <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</span>
      </div>
      <p className="mt-2 text-lg font-bold tabular-nums text-slate-900">{value}</p>
      {sub && <p className="mt-0.5 text-[11px] text-slate-400 tabular-nums">{sub}</p>}
    </div>
  )
}

function FreshnessChip({ data, syncing }: { data: BookingSheetPayload; syncing: boolean }) {
  const at = data.lastSuccessAt
  const ageH = at ? (Date.now() - new Date(at).getTime()) / 3_600_000 : Infinity
  const failed = data.lastSync?.status === 'FAILED'
  const busy = syncing || data.refreshing
  const state = busy ? 'busy' : failed ? 'failed' : ageH <= data.intervalHours + 0.25 ? 'fresh' : 'stale'
  const styles = {
    busy:   { dot: 'bg-sky-400',     ring: 'bg-sky-400',     text: 'Syncing with Excel…' },
    fresh:  { dot: 'bg-emerald-400', ring: 'bg-emerald-400', text: `Synced ${timeAgo(at)}` },
    stale:  { dot: 'bg-amber-400',   ring: 'bg-amber-400',   text: `Synced ${timeAgo(at)}` },
    failed: { dot: 'bg-rose-400',    ring: 'bg-rose-400',    text: `Last sync failed · data from ${timeAgo(at)}` },
  }[state]
  return (
    <span
      className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-[11px] font-medium text-white/90 ring-1 ring-white/15 backdrop-blur"
      title={failed ? data.lastSync?.error ?? '' : `Refreshes every ${data.intervalHours} h`}
    >
      <span className="relative flex h-2 w-2">
        <span className={cn('absolute inline-flex h-full w-full rounded-full opacity-70', styles.ring, (state === 'busy' || state === 'fresh') && 'animate-ping')} />
        <span className={cn('relative inline-flex h-2 w-2 rounded-full', styles.dot)} />
      </span>
      {styles.text}
    </span>
  )
}

// ── Panel ────────────────────────────────────────────────────────────────────

export default function VnSheetChecklistPanel({ bookingRef }: { bookingRef: string }) {
  const [data, setData] = useState<BookingSheetPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [active, setActive] = useState(0)
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const [showAllEvents, setShowAllEvents] = useState(false)
  const pollRef = useRef<NodeJS.Timeout | null>(null)

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true)
    try {
      const res = await fetch(`/api/vn-checklist-sheet/booking/${encodeURIComponent(bookingRef)}`, { cache: 'no-store' })
      const json = await res.json()
      if (json.success) setData(json.data)
    } catch { /* keep what we have */ } finally {
      if (!quiet) setLoading(false)
    }
  }, [bookingRef])

  useEffect(() => { void load() }, [load])

  // A background refresh was started by this read — look again until it lands.
  useEffect(() => {
    if (pollRef.current) clearTimeout(pollRef.current)
    if (data?.refreshing) pollRef.current = setTimeout(() => { void load(true) }, 20_000)
    return () => { if (pollRef.current) clearTimeout(pollRef.current) }
  }, [data, load])

  async function syncNow() {
    setSyncing(true)
    const t = toast.loading('Reading the Excel checklist…')
    try {
      const res = await fetch('/api/vn-checklist-sheet/settings', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'sync' }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      toast.success(json.message, { id: t })
      await load(true)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Sync failed', { id: t })
    } finally { setSyncing(false) }
  }

  const tour: Tour | undefined = data?.tours[Math.min(active, (data?.tours.length ?? 1) - 1)]

  const lines = useMemo(() => {
    if (!tour) return []
    const q = query.trim().toLowerCase()
    return tour.lines.filter(l => {
      if (filter === 'open' && l.paidBucket !== 'OPEN') return false
      if (filter === 'check' && l.paidBucket !== 'CHECK') return false
      if (filter === 'paid' && !isPaidBucket(l.paidBucket)) return false
      if (q && !`${l.details} ${l.vendor ?? ''} ${l.code ?? ''} ${l.paidRaw ?? ''}`.toLowerCase().includes(q)) return false
      return true
    })
  }, [tour, filter, query])

  const payMix = useMemo(() => {
    if (!tour) return []
    const total = tour.lines.reduce((s, l) => s + Math.max(l.totalEstimateVnd ?? 0, 0), 0) || 1
    return PAID_BUCKET_ORDER.map(b => {
      const ls = tour.lines.filter(l => l.paidBucket === b)
      const vnd = ls.reduce((s, l) => s + Math.max(l.totalEstimateVnd ?? 0, 0), 0)
      return { bucket: b, count: ls.length, vnd, share: vnd / total }
    }).filter(x => x.count)
  }, [tour])

  const codeMix = useMemo(() => {
    if (!tour) return []
    const map = new Map<string, { vnd: number; count: number }>()
    for (const l of tour.lines) {
      const k = l.code || 'Other'
      const cur = map.get(k) ?? { vnd: 0, count: 0 }
      cur.vnd += l.totalEstimateVnd ?? 0
      cur.count++
      map.set(k, cur)
    }
    const max = Math.max(...Array.from(map.values()).map(v => v.vnd), 1)
    return Array.from(map.entries()).map(([code, v]) => ({ code, ...v, share: v.vnd / max })).sort((a, b) => b.vnd - a.vnd)
  }, [tour])

  // ── States ─────────────────────────────────────────────────────────────────

  const shell = (children: React.ReactNode) => (
    <section data-nav="Checklist VN 2.1" data-nav-icon="checklist"
      className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-card">
      {children}
    </section>
  )

  const header = (
    <div className="relative overflow-hidden bg-gradient-to-br from-slate-900 via-indigo-950 to-emerald-900 px-6 py-5 text-white">
      <div className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-emerald-400/20 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-24 left-1/3 h-56 w-56 rounded-full bg-indigo-400/20 blur-3xl" />
      <div className="relative flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/10 ring-1 ring-white/20">
            <FileSpreadsheet className="h-5 w-5 text-emerald-300" />
          </span>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-base font-semibold tracking-tight">Checklist VN</h3>
              <span className="rounded-md bg-emerald-400/20 px-1.5 py-0.5 text-[10px] font-bold text-emerald-200 ring-1 ring-emerald-300/30">2.1v</span>
            </div>
            <p className="mt-0.5 text-xs text-white/60">
              Live from the desk&apos;s Excel checklist
              {tour?.sheetTab && <> · {tour.sheetTab}{tour.sheetRow ? `, row ${tour.sheetRow}` : ''}</>}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {data?.installed && <FreshnessChip data={data} syncing={syncing} />}
          {data?.installed && (
            <button onClick={syncNow} disabled={syncing}
              className="inline-flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-1.5 text-xs font-medium ring-1 ring-white/15 transition hover:bg-white/20 disabled:opacity-60">
              <RefreshCw className={cn('h-3.5 w-3.5', syncing && 'animate-spin')} /> Sync now
            </button>
          )}
          {tour && (
            <a href={`/api/vn-checklist-sheet/download?kind=mirror&tour=${encodeURIComponent(tour.tourCode)}`}
              className="inline-flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-1.5 text-xs font-medium ring-1 ring-white/15 transition hover:bg-white/20">
              <Download className="h-3.5 w-3.5" /> This tour (.xlsx)
            </a>
          )}
          {data?.sheetWebUrl && (
            <a href={data.sheetWebUrl} target="_blank" rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-400 px-3 py-1.5 text-xs font-semibold text-emerald-950 transition hover:bg-emerald-300">
              <ExternalLink className="h-3.5 w-3.5" /> Open in Excel
            </a>
          )}
        </div>
      </div>
    </div>
  )

  if (loading && !data) {
    return shell(<>{header}<div className="flex items-center justify-center gap-2 py-14 text-sm text-slate-400"><Loader2 className="h-4 w-4 animate-spin" /> Loading the checklist…</div></>)
  }

  if (data && !data.installed) {
    return shell(<>{header}
      <div className="flex items-start gap-3 px-6 py-6 text-sm text-amber-800">
        <Database className="mt-0.5 h-4 w-4 shrink-0" />
        <p>Checklist VN 2.1 is not set up on this database yet. An admin needs to run <code className="rounded bg-amber-50 px-1">prisma/sql/apply-vn-checklist-sheet.sh</code> once.</p>
      </div>
    </>)
  }

  if (!tour) {
    return shell(<>{header}
      <div className="flex flex-col items-center px-6 py-12 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-50 ring-1 ring-slate-200">
          <CircleDashed className="h-6 w-6 text-slate-300" />
        </div>
        <p className="mt-3 text-sm font-medium text-slate-700">{bookingRef} is not on the checklist yet</p>
        <p className="mt-1 max-w-md text-xs text-slate-400">
          {data?.lastSuccessAt
            ? `The sheet was last read ${timeAgo(data.lastSuccessAt)}. Once the desk adds this tour it will appear here on the next sync.`
            : 'The Excel checklist has not been synced yet — press Sync now.'}
        </p>
        <Link href="/dashboard/checklist-vn/sheet" className="mt-4 inline-flex items-center gap-1 text-xs font-medium text-indigo-600 hover:underline">
          <LayoutGrid className="h-3.5 w-3.5" /> Open the checklist board
        </Link>
      </div>
    </>)
  }

  // ── Main ───────────────────────────────────────────────────────────────────

  const profit = tour.pnlIncurredVnd
  const mismatch = tour.totalEstimateVnd !== null && Math.abs(tour.linesTotalVnd - tour.totalEstimateVnd) > 1000
  const route = (tour.itinerary ?? '').split(/\s*[-–>]+\s*/).filter(Boolean)
  const paidPct = tour.lineCount ? tour.paidLineCount / tour.lineCount : 0
  const events = showAllEvents ? tour.events : tour.events.slice(0, 4)

  return shell(<>
    {header}

    {data!.tours.length > 1 && (
      <div className="flex gap-1 border-b border-slate-100 bg-slate-50/60 px-6 pt-3">
        {data!.tours.map((t, i) => (
          <button key={t.tourCode} onClick={() => setActive(i)}
            className={cn('rounded-t-lg px-3 py-1.5 text-xs font-semibold transition',
              i === active ? 'bg-white text-slate-900 ring-1 ring-slate-200' : 'text-slate-500 hover:text-slate-700')}>
            {t.tourCode}{!t.isActive && ' · removed'}
          </button>
        ))}
      </div>
    )}

    <div className="space-y-5 p-6">
      {!tour.isActive && (
        <div className="flex items-center gap-2 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700 ring-1 ring-rose-200">
          <AlertTriangle className="h-3.5 w-3.5" /> This tour is no longer on the sheet — showing its last known state.
        </div>
      )}

      {/* Identity strip */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="rounded-lg bg-slate-900 px-2.5 py-1 font-mono font-semibold text-white">{tour.tourCode}</span>
        {tour.agent && <span className="rounded-lg bg-indigo-50 px-2.5 py-1 font-medium text-indigo-700 ring-1 ring-indigo-100">{tour.agent}</span>}
        {tour.agentRef && <span className="rounded-lg bg-slate-50 px-2.5 py-1 font-mono text-slate-600 ring-1 ring-slate-200" title="Agent reference">{tour.agentRef}</span>}
        {tour.pax !== null && <span className="inline-flex items-center gap-1 rounded-lg bg-slate-50 px-2.5 py-1 text-slate-600 ring-1 ring-slate-200"><Users className="h-3 w-3" />{tour.pax} pax</span>}
        {(tour.arrivalDate || tour.departureDate) && (
          <span className="inline-flex items-center gap-1 rounded-lg bg-slate-50 px-2.5 py-1 text-slate-600 ring-1 ring-slate-200">
            <CalendarRange className="h-3 w-3" />
            {fmtDay(tour.arrivalDate)} → {fmtDay(tour.departureDate)}{tour.days ? ` · ${tour.days} days` : ''}
          </span>
        )}
        {route.length > 0 && (
          <span className="inline-flex items-center gap-1 rounded-lg bg-emerald-50 px-2.5 py-1 font-medium text-emerald-700 ring-1 ring-emerald-100">
            {route.map((c, i) => (
              <span key={i} className="inline-flex items-center gap-1">{i > 0 && <ArrowRight className="h-3 w-3 opacity-50" />}{c}</span>
            ))}
          </span>
        )}
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-[repeat(4,minmax(0,1fr))_auto]">
        <Kpi icon={Wallet} label="Revenue" tone="indigo" value={fmtUsd(tour.revenueUsd)}
          sub={tour.quotedUsd !== null && tour.quotedUsd !== tour.revenueUsd ? `Quoted ${fmtUsd(tour.quotedUsd)}` : tour.exchangeRate ? `@ ${tour.exchangeRate.toLocaleString()} ₫` : undefined} />
        <Kpi icon={Sparkles} label="Total VND" tone="slate" value={fmtVnd(tour.totalVnd, { compact: true })} sub={fmtVnd(tour.totalVnd)} />
        <Kpi icon={Receipt} label="Total estimate" tone="amber" value={fmtVnd(tour.totalEstimateVnd, { compact: true })}
          sub={`${tour.lineCount} payment line${tour.lineCount === 1 ? '' : 's'}`} />
        <Kpi icon={profit !== null && profit < 0 ? TrendingDown : TrendingUp} label="PNL incurred"
          tone={profit === null ? 'slate' : profit < 0 ? 'rose' : 'emerald'}
          value={fmtVnd(profit, { compact: true })} sub={fmtVnd(profit)} />
        <div className="col-span-2 flex items-center justify-center rounded-xl border border-slate-200/80 bg-gradient-to-br from-white to-slate-50 px-4 py-2 lg:col-span-1">
          <MarginRing value={tour.profitMargin} />
        </div>
      </div>

      {/* Payment progress + cost mix */}
      <div className="grid gap-4 lg:grid-cols-5">
        <div className="rounded-xl border border-slate-200/80 p-4 lg:col-span-3">
          <div className="flex items-baseline justify-between">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Payment progress</p>
            <p className="text-xs text-slate-500"><span className="text-base font-bold text-slate-900 tabular-nums">{Math.round(paidPct * 100)}%</span> of lines paid</p>
          </div>
          <div className="mt-3 flex h-3 w-full overflow-hidden rounded-full bg-slate-100">
            {payMix.map(p => (
              <div key={p.bucket} className={cn('h-full transition-all duration-700', PAID_BUCKETS[p.bucket].bar)}
                style={{ width: `${Math.max(p.share * 100, p.count ? 2 : 0)}%` }}
                title={`${PAID_BUCKETS[p.bucket].label}: ${p.count} line(s), ${fmtVnd(p.vnd)}`} />
            ))}
          </div>
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
            {payMix.map(p => (
              <span key={p.bucket} className="inline-flex items-center gap-1.5 text-[11px] text-slate-600">
                <span className={cn('h-2 w-2 rounded-full', PAID_BUCKETS[p.bucket].dot)} />
                {PAID_BUCKETS[p.bucket].label}
                <span className="font-semibold text-slate-800 tabular-nums">{p.count}</span>
                <span className="text-slate-400 tabular-nums">· {fmtVnd(p.vnd, { compact: true })}</span>
              </span>
            ))}
          </div>
        </div>
        <div className="rounded-xl border border-slate-200/80 p-4 lg:col-span-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Where the money goes</p>
          <div className="mt-3 space-y-2">
            {codeMix.slice(0, 6).map(c => (
              <div key={c.code} className="flex items-center gap-2 text-[11px]">
                <span className="w-20 shrink-0 truncate font-medium text-slate-600">{c.code}</span>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
                  <div className="h-full rounded-full transition-all duration-700" style={{ width: `${c.share * 100}%`, background: codeStyle(c.code).hex }} />
                </div>
                <span className="w-16 shrink-0 text-right tabular-nums text-slate-700">{fmtVnd(c.vnd, { compact: true })}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Lines */}
      <div className="overflow-hidden rounded-xl border border-slate-200/80">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 bg-slate-50/70 px-4 py-2.5">
          <div className="flex gap-1">
            {([
              ['all', 'All', tour.lineCount],
              ['open', 'Not marked', tour.openLineCount],
              ['check', 'Check', tour.checkLineCount],
              ['paid', 'Paid', tour.paidLineCount],
            ] as [Filter, string, number][]).map(([k, label, count]) => (
              <button key={k} onClick={() => setFilter(k)}
                className={cn('rounded-lg px-2.5 py-1 text-[11px] font-semibold transition',
                  filter === k ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-500 hover:bg-white hover:text-slate-800')}>
                {label} <span className="opacity-60">{count}</span>
              </button>
            ))}
          </div>
          <label className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Find a line, vendor…"
              className="w-48 rounded-lg border border-slate-200 bg-white py-1 pl-7 pr-2 text-xs outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100" />
          </label>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-xs">
            <thead>
              <tr className="text-left text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                <th className="px-4 py-2">Details for payment</th>
                <th className="px-2 py-2">Vendor</th>
                <th className="px-2 py-2 text-right">Unit price</th>
                <th className="px-2 py-2 text-center">Qty</th>
                <th className="px-2 py-2 text-right">Total estimate</th>
                <th className="px-4 py-2 text-right">Paid</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {lines.map(l => <LineRow key={l.id} line={l} />)}
              {!lines.length && (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-400">No lines match.</td></tr>
              )}
            </tbody>
            <tfoot>
              <tr className="border-t border-slate-200 bg-slate-50/70 font-semibold text-slate-800">
                <td className="px-4 py-2.5" colSpan={4}>
                  Total of lines
                  {mismatch && (
                    <span className="ml-2 inline-flex items-center gap-1 rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 ring-1 ring-amber-200"
                      title="The sum of the lines differs from the tour's Total estimate cell">
                      <AlertTriangle className="h-3 w-3" /> sheet says {fmtVnd(tour.totalEstimateVnd)}
                    </span>
                  )}
                </td>
                <td className="px-2 py-2.5 text-right tabular-nums">{fmtVnd(tour.linesTotalVnd)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* Timeline */}
      <div className="rounded-xl border border-slate-200/80 p-4">
        <div className="flex items-center justify-between">
          <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500"><History className="h-3.5 w-3.5" /> Changes seen on the sheet</p>
          <span className="text-[11px] text-slate-400">First seen {timeAgo(tour.firstSeenAt)}</span>
        </div>
        {tour.events.length === 0 ? (
          <p className="mt-3 flex items-center gap-1.5 text-xs text-slate-400"><CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" /> No changes since this tour was first synced.</p>
        ) : (
          <ol className="relative mt-3 space-y-3 border-l border-slate-200 pl-4">
            {events.map(e => (
              <li key={e.id} className="relative">
                <span className={cn('absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full ring-4 ring-white',
                  e.kind === 'REMOVED' ? 'bg-rose-400' : e.kind === 'ADDED' || e.kind === 'RESTORED' ? 'bg-emerald-400' : 'bg-indigo-400')} />
                <p className="text-xs font-medium text-slate-800">{e.summary}</p>
                <p className="text-[10px] text-slate-400">{new Date(e.createdAt).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</p>
                {e.changes.length > 0 && (
                  <ul className="mt-1 space-y-0.5">
                    {e.changes.slice(0, 5).map((c, i) => (
                      <li key={i} className="text-[11px] text-slate-500">
                        <span className="font-medium text-slate-600">{c.field}</span>
                        {c.line && <span className="text-slate-400"> · {c.line}</span>}
                        {(c.from || c.to) && <>: <span className="line-through decoration-slate-300">{c.from ?? '—'}</span> → <span className="text-slate-700">{c.to ?? '—'}</span></>}
                      </li>
                    ))}
                    {e.changes.length > 5 && <li className="text-[11px] text-slate-400">+{e.changes.length - 5} more</li>}
                  </ul>
                )}
              </li>
            ))}
          </ol>
        )}
        {tour.events.length > 4 && (
          <button onClick={() => setShowAllEvents(v => !v)} className="mt-2 text-[11px] font-medium text-indigo-600 hover:underline">
            {showAllEvents ? 'Show fewer' : `Show all ${tour.events.length}`}
          </button>
        )}
      </div>
    </div>
  </>)
}

function LineRow({ line: l }: { line: SheetLine }) {
  const b = PAID_BUCKETS[l.paidBucket as PaidBucket] ?? PAID_BUCKETS.OPEN
  const qty = [l.quan1, l.quan2].filter(v => v !== null)
  return (
    <tr className="group transition hover:bg-indigo-50/30">
      <td className="px-4 py-2.5">
        <div className="flex items-start gap-2">
          {l.code && <span className={cn('mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ring-1', codeStyle(l.code).tone)}>{l.code}</span>}
          <div className="min-w-0">
            <p className="text-slate-800">{l.details}</p>
            {(l.dates || l.note || l.qcStatus || l.incurred) && (
              <p className="mt-0.5 text-[10px] text-slate-400">
                {[l.dates && `Dates ${l.dates}`, l.qcStatus && `QC ${l.qcStatus}`, l.incurred && `Incurred ${l.incurred}`, l.note].filter(Boolean).join(' · ')}
              </p>
            )}
          </div>
        </div>
      </td>
      <td className="px-2 py-2.5 text-slate-600">{l.vendor || <span className="text-slate-300">—</span>}</td>
      <td className="px-2 py-2.5 text-right tabular-nums text-slate-600">{l.unitPrice !== null ? l.unitPrice.toLocaleString('en-US') : '—'}</td>
      <td className="px-2 py-2.5 text-center tabular-nums text-slate-500">{qty.length ? qty.join(' × ') : '—'}</td>
      <td className="px-2 py-2.5 text-right font-semibold tabular-nums text-slate-900">{fmtVnd(l.totalEstimateVnd)}</td>
      <td className="px-4 py-2.5 text-right">
        <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1', b.pill)} title={l.paidRaw ?? 'Nothing typed in Paid'}>
          {l.paidRaw || b.label}
        </span>
      </td>
    </tr>
  )
}

function fmtDay(iso: string | null) {
  if (!iso) return '—'
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: 'UTC' })
}
