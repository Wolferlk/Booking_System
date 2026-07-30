'use client'

/**
 * B2C Control Centre — the single screen for the Aahaas storefront integration.
 *
 * Four things, in the order you need them:
 *   1. Connection + schedule health (is the store reachable, when does it run next)
 *   2. Preview — the exact bookings an import would create, with margins, BEFORE
 *      anything is written. This is the safety valve.
 *   3. Import — the one manual write path. Inserts only.
 *   4. Activity log + the B2C bookings already in ops.
 */

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  Activity, AlertTriangle, ArrowRight, CheckCircle2, ChevronDown, Clock,
  Database, DownloadCloud, Eye, Globe2, Loader2, Lock, Plane, RefreshCw,
  ShieldCheck, ShoppingBag, TrendingUp, Users, XCircle,
} from 'lucide-react'
import Header from '@/components/layout/header'
import { CountryFlag } from '@/components/ui/country-flag'

// ─── Types ────────────────────────────────────────────────────────────────────

interface Overview {
  source: {
    configured: boolean
    database: string | null
    readOnly: boolean
    upcomingOrders: number | null
    error: string | null
  }
  ops: {
    importedTotal: number
    importedUpcoming: number
    byCountry: { country: string; count: number }[]
    latestImported: { bookingRef: string; createdAt: string } | null
  }
  schedule: {
    enabled: boolean
    hour: number
    minute: number
    timezone: string
    lastRunDate: string | null
    ranToday: boolean
    today: string
  }
  runs: RunSummary[]
}

interface RunSummary {
  trigger?: string
  triggeredBy?: string | null
  dryRun?: boolean
  mode: string
  candidates: number
  created: string[]
  alreadyImported: string[]
  conflicts: { bookingRef: string; reason: string }[]
  skipped: { orderId: number; reason: string; detail: string }[]
  failed: { orderId: number; error: string }[]
  startedAt: string
  finishedAt: string
}

interface PreviewOrder {
  status: 'new' | 'imported' | 'conflict'
  bookingRef: string
  operationCountry: string | null
  countryVia: string
  arrivalDate: string
  departureDate: string
  paxAdults: number
  paxChildren: number
  paxVia: string
  currency: string
  quotedTotal: number | null
  destination: string | null
  leadPassengerName: string | null
  contactEmail: string | null
  contactPhone: string | null
  productLines: number
  pnlLines: number
  sellTotal: number
  costTotal: number
  margin: number
  paymentStatus: string | null
  flightRoutes: string[]
  items: { dayNo: number; date: string; title: string }[]
  categories: string[]
}

interface Preview {
  upcomingFrom: string
  orders: PreviewOrder[]
  skipped: { orderId: number; reason: string; detail: string }[]
  counts: { candidates: number; new: number; imported: number; conflict: number; skipped: number }
}

// ─── Small presentational helpers ─────────────────────────────────────────────

const STATUS_STYLE: Record<PreviewOrder['status'], { label: string; cls: string }> = {
  new:      { label: 'Will import', cls: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/25' },
  imported: { label: 'Already in ops', cls: 'bg-slate-500/10 text-slate-500 border-slate-500/25' },
  conflict: { label: 'Ref conflict', cls: 'bg-red-500/10 text-red-600 border-red-500/25' },
}

const VIA_LABEL: Record<string, string> = {
  'product-country': 'product',
  'flight-airport': 'flight route',
  text: 'name match',
  'unsupported-destination': 'outside ops',
  none: 'unknown',
}

function StatTile({
  icon, label, value, sub, tone = 'slate',
}: {
  icon: React.ReactNode
  label: string
  value: string | number
  sub?: string
  tone?: 'slate' | 'emerald' | 'amber' | 'violet' | 'red'
}) {
  const tones: Record<string, string> = {
    slate: 'from-slate-500/10 text-slate-600',
    emerald: 'from-emerald-500/15 text-emerald-600',
    amber: 'from-amber-500/15 text-amber-600',
    violet: 'from-violet-500/15 text-violet-600',
    red: 'from-red-500/15 text-red-600',
  }
  return (
    <div className="relative overflow-hidden rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className={`absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r ${tones[tone].split(' ')[0]} to-transparent`} />
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">{label}</p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-slate-900">{value}</p>
          {sub && <p className="mt-0.5 truncate text-xs text-slate-500">{sub}</p>}
        </div>
        <span className={`shrink-0 rounded-lg bg-slate-50 p-2 ${tones[tone].split(' ')[1]}`}>{icon}</span>
      </div>
    </div>
  )
}

function money(v: number | null, cur: string) {
  if (v === null) return '—'
  return `${cur} ${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function timeAgo(iso: string) {
  const secs = Math.round((Date.now() - new Date(iso).getTime()) / 1000)
  if (!Number.isFinite(secs)) return iso
  if (secs < 60) return `${secs}s ago`
  if (secs < 3600) return `${Math.round(secs / 60)}m ago`
  if (secs < 86400) return `${Math.round(secs / 3600)}h ago`
  return `${Math.round(secs / 86400)}d ago`
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function B2cControlCentre() {
  const [overview, setOverview] = useState<Overview | null>(null)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [loadingOverview, setLoadingOverview] = useState(true)
  const [loadingPreview, setLoadingPreview] = useState(false)
  const [importing, setImporting] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [lastResult, setLastResult] = useState<RunSummary | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [tab, setTab] = useState<'preview' | 'activity'>('preview')

  const loadOverview = useCallback(async () => {
    setLoadingOverview(true)
    try {
      const res = await fetch('/api/b2c/overview')
      const json = await res.json()
      if (json.success) setOverview(json.data)
      else setError(json.error ?? 'Failed to load overview')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load overview')
    } finally {
      setLoadingOverview(false)
    }
  }, [])

  const loadPreview = useCallback(async () => {
    setLoadingPreview(true)
    setError(null)
    try {
      const res = await fetch('/api/b2c/preview')
      const json = await res.json()
      if (json.success) setPreview(json.data)
      else setError(json.error ?? 'Preview failed')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Preview failed')
    } finally {
      setLoadingPreview(false)
    }
  }, [])

  useEffect(() => { void loadOverview(); void loadPreview() }, [loadOverview, loadPreview])

  async function runImport() {
    setConfirmOpen(false)
    setImporting(true)
    setError(null)
    try {
      const res = await fetch('/api/b2c/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'backfill' }),
      })
      const json = await res.json()
      if (json.success) {
        setLastResult(json.data)
        await Promise.all([loadOverview(), loadPreview()])
      } else {
        setError(json.error ?? 'Import failed')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed')
    } finally {
      setImporting(false)
    }
  }

  const willImport = preview?.counts.new ?? 0
  const totals = useMemo(() => {
    const rows = preview?.orders.filter((o) => o.status === 'new') ?? []
    return {
      sell: rows.reduce((s, o) => s + o.sellTotal, 0),
      cost: rows.reduce((s, o) => s + o.costTotal, 0),
      pax: rows.reduce((s, o) => s + o.paxAdults + o.paxChildren, 0),
    }
  }, [preview])

  const nextRun = overview
    ? `${String(overview.schedule.hour).padStart(2, '0')}:${String(overview.schedule.minute).padStart(2, '0')} ${overview.schedule.timezone}`
    : '—'

  return (
    <>
      <Header title="B2C — Aahaas" subtitle="Storefront orders flowing into operations" />

      <div className="space-y-5 p-4 sm:p-6">
        {/* ── Hero: connection + schedule ───────────────────────────────── */}
        <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-gradient-to-br from-fuchsia-50 via-white to-violet-50 p-5 shadow-sm">
          <div className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-fuchsia-400/10 blur-3xl" />
          <div className="relative flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-fuchsia-500/25 bg-fuchsia-500/10 px-2.5 py-1 text-xs font-semibold text-fuchsia-700">
                  <ShoppingBag className="h-3.5 w-3.5" /> Aahaas B2C
                </span>
                {overview?.source.configured ? (
                  overview.source.error ? (
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-red-500/25 bg-red-500/10 px-2.5 py-1 text-xs font-semibold text-red-700">
                      <XCircle className="h-3.5 w-3.5" /> Store unreachable
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2.5 py-1 text-xs font-semibold text-emerald-700">
                      <span className="relative flex h-2 w-2">
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                        <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
                      </span>
                      Store connected
                    </span>
                  )
                ) : (
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/25 bg-amber-500/10 px-2.5 py-1 text-xs font-semibold text-amber-700">
                    <AlertTriangle className="h-3.5 w-3.5" /> Not configured
                  </span>
                )}
                <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-600">
                  <Lock className="h-3.5 w-3.5" /> Read-only source
                </span>
              </div>

              <h2 className="mt-3 text-lg font-bold text-slate-900">
                {overview?.source.database ?? 'production_live1'}
                <ArrowRight className="mx-2 inline h-4 w-4 text-slate-400" />
                <span className="text-slate-600">ops bookings</span>
              </h2>
              <p className="mt-1 max-w-2xl text-sm text-slate-600">
                Upcoming travel orders are copied into operations as ordinary bookings, so agenda,
                driver allocation, ticketing, P&amp;L and WhatsApp all work on them. The Aahaas
                database is never written to.
              </p>
            </div>

            <div className="flex shrink-0 flex-col gap-2 sm:flex-row lg:flex-col">
              <button
                onClick={() => void loadPreview()}
                disabled={loadingPreview}
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:opacity-60"
              >
                {loadingPreview ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />}
                Refresh preview
              </button>
              <button
                onClick={() => setConfirmOpen(true)}
                disabled={importing || willImport === 0}
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-fuchsia-600 to-violet-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:from-fuchsia-500 hover:to-violet-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : <DownloadCloud className="h-4 w-4" />}
                {willImport > 0 ? `Import ${willImport} booking${willImport === 1 ? '' : 's'}` : 'Nothing to import'}
              </button>
            </div>
          </div>

          <div className="relative mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-slate-200/70 pt-3 text-xs text-slate-500">
            <span className="inline-flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5" /> Auto-import daily at <b className="text-slate-700">{nextRun}</b>
            </span>
            <span className="inline-flex items-center gap-1.5">
              {overview?.schedule.enabled
                ? <><CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" /> Schedule enabled</>
                : <><XCircle className="h-3.5 w-3.5 text-slate-400" /> Schedule disabled</>}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Activity className="h-3.5 w-3.5" /> Last run:{' '}
              <b className="text-slate-700">{overview?.schedule.lastRunDate ?? 'never'}</b>
              {overview?.schedule.ranToday && <span className="text-slate-400">(already ran today)</span>}
            </span>
          </div>
        </div>

        {error && (
          <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span className="min-w-0 break-words">{error}</span>
          </div>
        )}

        {overview?.source.error && (
          <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            <Database className="mt-0.5 h-4 w-4 shrink-0" />
            <span className="min-w-0 break-words">
              Could not read the Aahaas store: {overview.source.error}
            </span>
          </div>
        )}

        {/* ── Stat tiles ────────────────────────────────────────────────── */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatTile
            icon={<ShoppingBag className="h-4 w-4" />}
            label="Upcoming in store"
            value={loadingOverview ? '…' : overview?.source.upcomingOrders ?? '—'}
            sub="travel orders with a future service date"
            tone="violet"
          />
          <StatTile
            icon={<DownloadCloud className="h-4 w-4" />}
            label="Ready to import"
            value={loadingPreview ? '…' : willImport}
            sub={`${totals.pax} pax · ${money(totals.sell, 'USD')} sell`}
            tone="emerald"
          />
          <StatTile
            icon={<CheckCircle2 className="h-4 w-4" />}
            label="Already in ops"
            value={loadingOverview ? '…' : overview?.ops.importedTotal ?? 0}
            sub={
              overview?.ops.latestImported
                ? `latest ${overview.ops.latestImported.bookingRef} · ${timeAgo(overview.ops.latestImported.createdAt)}`
                : 'none imported yet'
            }
            tone="slate"
          />
          <StatTile
            icon={<TrendingUp className="h-4 w-4" />}
            label="Preview margin"
            value={loadingPreview ? '…' : money(Math.round((totals.sell - totals.cost) * 100) / 100, 'USD')}
            sub={`cost ${money(totals.cost, 'USD')}`}
            tone={totals.sell - totals.cost >= 0 ? 'emerald' : 'red'}
          />
        </div>

        {/* ── Country spread of what's already imported ──────────────────── */}
        {(overview?.ops.byCountry.length ?? 0) > 0 && (
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-slate-900">
              <Globe2 className="h-4 w-4 text-slate-400" /> Imported by country
            </h3>
            <div className="flex flex-wrap gap-2">
              {overview!.ops.byCountry.map((c) => (
                <span
                  key={c.country}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-medium text-slate-700"
                >
                  {c.country === 'UNSCOPED'
                    ? <Globe2 className="h-3.5 w-3.5 text-slate-400" />
                    : <CountryFlag country={c.country} className="h-3 w-4" />}
                  {c.country === 'UNSCOPED' ? 'Outside ops countries' : c.country}
                  <b className="tabular-nums">{c.count}</b>
                </span>
              ))}
            </div>
          </div>
        )}

        {/* ── Result banner from a manual run ───────────────────────────── */}
        {lastResult && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
              <div className="min-w-0 text-sm">
                <p className="font-semibold text-emerald-900">
                  Import finished — {lastResult.created.length} created,{' '}
                  {lastResult.alreadyImported.length} already present,{' '}
                  {lastResult.skipped.length} skipped, {lastResult.conflicts.length} conflicts,{' '}
                  {lastResult.failed.length} failed
                </p>
                {lastResult.created.length > 0 && (
                  <p className="mt-1 break-words text-emerald-800">
                    Created:{' '}
                    {lastResult.created.map((ref, i) => (
                      <span key={ref}>
                        {i > 0 && ', '}
                        <Link href={`/dashboard/bookings/${ref}`} className="font-mono font-semibold underline">
                          {ref}
                        </Link>
                      </span>
                    ))}
                  </p>
                )}
                {lastResult.failed.length > 0 && (
                  <ul className="mt-1 list-inside list-disc text-red-700">
                    {lastResult.failed.map((f) => (
                      <li key={f.orderId}>order {f.orderId}: {f.error}</li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── Tabs: preview / activity ──────────────────────────────────── */}
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center gap-1 border-b border-slate-200 px-3 pt-3">
            {([
              ['preview', 'Upcoming orders', preview?.orders.length ?? 0],
              ['activity', 'Activity log', overview?.runs.length ?? 0],
            ] as const).map(([key, label, count]) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={`relative -mb-px rounded-t-lg px-4 py-2.5 text-sm font-semibold transition ${
                  tab === key
                    ? 'border-x border-t border-slate-200 bg-white text-slate-900'
                    : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                {label}
                <span className="ml-2 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] tabular-nums text-slate-500">
                  {count}
                </span>
              </button>
            ))}
            <div className="ml-auto pb-2 pr-1">
              <button
                onClick={() => { void loadOverview(); void loadPreview() }}
                className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-50 hover:text-slate-700"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${loadingPreview || loadingOverview ? 'animate-spin' : ''}`} />
                Refresh
              </button>
            </div>
          </div>

          {tab === 'preview' ? (
            <PreviewTable
              preview={preview}
              loading={loadingPreview}
              expanded={expanded}
              setExpanded={setExpanded}
            />
          ) : (
            <ActivityLog runs={overview?.runs ?? []} />
          )}
        </div>
      </div>

      {/* ── Confirm dialog ─────────────────────────────────────────────── */}
      {confirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl">
            <div className="flex items-start gap-3">
              <span className="rounded-lg bg-fuchsia-100 p-2 text-fuchsia-700">
                <DownloadCloud className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <h3 className="text-lg font-bold text-slate-900">
                  Import {willImport} booking{willImport === 1 ? '' : 's'} into operations?
                </h3>
                <p className="mt-1 text-sm text-slate-600">
                  This creates {willImport} new booking{willImport === 1 ? '' : 's'} with itinerary and
                  P&amp;L. It only inserts — no existing booking is modified or deleted, and nothing is
                  written to the Aahaas store.
                </p>
                <ul className="mt-3 space-y-1 text-sm text-slate-600">
                  <li className="flex items-center gap-2">
                    <ShieldCheck className="h-4 w-4 text-emerald-500" />
                    Refs already in ops are skipped, not overwritten
                  </li>
                  <li className="flex items-center gap-2">
                    <Users className="h-4 w-4 text-slate-400" />
                    {totals.pax} passengers · {money(totals.sell, 'USD')} sell value
                  </li>
                </ul>
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => setConfirmOpen(false)}
                className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                onClick={() => void runImport()}
                className="rounded-lg bg-gradient-to-r from-fuchsia-600 to-violet-600 px-4 py-2 text-sm font-semibold text-white hover:from-fuchsia-500 hover:to-violet-500"
              >
                Yes, import
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

// ─── Preview table ────────────────────────────────────────────────────────────

function PreviewTable({
  preview, loading, expanded, setExpanded,
}: {
  preview: Preview | null
  loading: boolean
  expanded: string | null
  setExpanded: (v: string | null) => void
}) {
  if (loading && !preview) {
    return (
      <div className="flex items-center justify-center gap-2 p-12 text-sm text-slate-500">
        <Loader2 className="h-4 w-4 animate-spin" /> Reading the Aahaas store…
      </div>
    )
  }
  if (!preview || preview.orders.length === 0) {
    return (
      <div className="p-12 text-center">
        <ShoppingBag className="mx-auto h-10 w-10 text-slate-300" />
        <p className="mt-3 text-sm font-medium text-slate-600">No upcoming travel orders</p>
        <p className="mt-1 text-xs text-slate-400">
          Only orders with a future service date in a travel category are considered.
        </p>
      </div>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[1000px] text-sm">
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50/70 text-left text-[11px] uppercase tracking-wider text-slate-500">
            <th className="px-4 py-2.5 font-semibold">Order</th>
            <th className="px-4 py-2.5 font-semibold">Status</th>
            <th className="px-4 py-2.5 font-semibold">Country</th>
            <th className="px-4 py-2.5 font-semibold">Travel</th>
            <th className="px-4 py-2.5 font-semibold">Pax</th>
            <th className="px-4 py-2.5 font-semibold">Customer</th>
            <th className="px-4 py-2.5 text-right font-semibold">Sell</th>
            <th className="px-4 py-2.5 text-right font-semibold">Cost</th>
            <th className="px-4 py-2.5 text-right font-semibold">Margin</th>
            <th className="px-4 py-2.5 font-semibold">Lines</th>
            <th className="w-8" />
          </tr>
        </thead>
        <tbody>
          {preview.orders.map((o) => {
            const open = expanded === o.bookingRef
            return (
              <Fragment key={o.bookingRef}>
                <tr
                  onClick={() => setExpanded(open ? null : o.bookingRef)}
                  className="cursor-pointer border-b border-slate-100 transition hover:bg-slate-50/70"
                >
                  <td className="px-4 py-2.5">
                    <span className="font-mono font-semibold text-slate-900">{o.bookingRef}</span>
                    {o.flightRoutes.length > 0 && (
                      <span className="mt-0.5 flex items-center gap-1 text-[11px] text-slate-500">
                        <Plane className="h-3 w-3" /> {o.flightRoutes[0]}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    <span className={`inline-flex rounded-md border px-2 py-0.5 text-[11px] font-semibold ${STATUS_STYLE[o.status].cls}`}>
                      {STATUS_STYLE[o.status].label}
                    </span>
                  </td>
                  <td className="px-4 py-2.5">
                    {o.operationCountry ? (
                      <span className="inline-flex items-center gap-1.5 text-slate-700">
                        <CountryFlag country={o.operationCountry} className="h-3 w-4" />
                        {o.operationCountry}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 text-amber-600" title="No ops team operates this destination — imported unscoped">
                        <Globe2 className="h-3.5 w-3.5" /> Outside ops
                      </span>
                    )}
                    <span className="block text-[10px] text-slate-400">
                      via {VIA_LABEL[o.countryVia] ?? o.countryVia}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 whitespace-nowrap text-slate-700">
                    {o.arrivalDate}
                    {o.departureDate !== o.arrivalDate && (
                      <span className="text-slate-400"> → {o.departureDate}</span>
                    )}
                    {o.destination && (
                      <span className="block max-w-[160px] truncate text-[11px] text-slate-400">{o.destination}</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 tabular-nums text-slate-700">
                    {o.paxAdults}A{o.paxChildren > 0 ? ` ${o.paxChildren}C` : ''}
                    <span className="block text-[10px] text-slate-400">{o.paxVia}</span>
                  </td>
                  <td className="px-4 py-2.5">
                    <span className="block max-w-[150px] truncate text-slate-700">{o.leadPassengerName ?? '—'}</span>
                    <span className="block max-w-[150px] truncate text-[11px] text-slate-400">{o.contactEmail ?? ''}</span>
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-slate-700">{money(o.sellTotal, o.currency)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-slate-500">{money(o.costTotal, o.currency)}</td>
                  <td className={`px-4 py-2.5 text-right font-semibold tabular-nums ${o.margin >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                    {money(o.margin, o.currency)}
                  </td>
                  <td className="px-4 py-2.5">
                    <span className="inline-flex items-center gap-1 rounded bg-slate-100 px-1.5 py-0.5 text-[11px] tabular-nums text-slate-600">
                      {o.productLines} items · {o.pnlLines} P&amp;L
                    </span>
                  </td>
                  <td className="px-2">
                    <ChevronDown className={`h-4 w-4 text-slate-400 transition ${open ? 'rotate-180' : ''}`} />
                  </td>
                </tr>
                {open && (
                  <tr className="border-b border-slate-100 bg-slate-50/50">
                    <td colSpan={11} className="px-4 py-3">
                      <div className="grid gap-4 md:grid-cols-2">
                        <div>
                          <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-400">
                            Itinerary ({o.items.length})
                          </p>
                          <ul className="space-y-1">
                            {o.items.map((it, i) => (
                              <li key={i} className="flex gap-2 text-xs text-slate-600">
                                <span className="shrink-0 rounded bg-white px-1.5 py-0.5 font-mono text-[10px] text-slate-500 ring-1 ring-slate-200">
                                  D{it.dayNo}
                                </span>
                                <span className="shrink-0 tabular-nums text-slate-400">{it.date}</span>
                                <span className="min-w-0 break-words">{it.title}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                        <div className="text-xs text-slate-600">
                          <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-400">
                            P&amp;L categories
                          </p>
                          <div className="flex flex-wrap gap-1.5">
                            {o.categories.map((c) => (
                              <span key={c} className="rounded bg-white px-2 py-0.5 ring-1 ring-slate-200">{c}</span>
                            ))}
                          </div>
                          <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1">
                            <dt className="text-slate-400">Payment</dt>
                            <dd className="font-medium">{o.paymentStatus ?? '—'}</dd>
                            <dt className="text-slate-400">Order total (store)</dt>
                            <dd className="tabular-nums">{money(o.quotedTotal, o.currency)}</dd>
                            <dt className="text-slate-400">Phone</dt>
                            <dd>{o.contactPhone ?? '—'}</dd>
                          </dl>
                          {o.status === 'imported' && (
                            <Link
                              href={`/dashboard/bookings/${o.bookingRef}`}
                              className="mt-3 inline-flex items-center gap-1 font-semibold text-fuchsia-700 underline"
                            >
                              Open booking <ArrowRight className="h-3 w-3" />
                            </Link>
                          )}
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            )
          })}
        </tbody>
      </table>

      {preview.skipped.length > 0 && (
        <div className="border-t border-slate-200 bg-amber-50/60 p-4">
          <p className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-amber-700">
            <AlertTriangle className="h-3.5 w-3.5" /> Skipped ({preview.skipped.length})
          </p>
          <ul className="space-y-1 text-xs text-amber-800">
            {preview.skipped.map((s) => (
              <li key={s.orderId}>
                <span className="font-mono font-semibold">{s.orderId}</span> — {s.reason}: {s.detail}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

// ─── Activity log ─────────────────────────────────────────────────────────────

function ActivityLog({ runs }: { runs: RunSummary[] }) {
  if (runs.length === 0) {
    return (
      <div className="p-12 text-center">
        <Activity className="mx-auto h-10 w-10 text-slate-300" />
        <p className="mt-3 text-sm font-medium text-slate-600">No import runs recorded yet</p>
        <p className="mt-1 text-xs text-slate-400">
          The nightly job and any manual import will appear here.
        </p>
      </div>
    )
  }

  return (
    <ol className="divide-y divide-slate-100">
      {runs.map((r, i) => {
        const ok = r.failed.length === 0
        return (
          <li key={`${r.startedAt}-${i}`} className="flex gap-3 p-4">
            <span className={`mt-0.5 shrink-0 rounded-lg p-1.5 ${ok ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-600'}`}>
              {ok ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-semibold text-slate-900">
                  {r.created.length} created
                </span>
                <span className="text-slate-400">·</span>
                <span className="text-slate-600">{r.alreadyImported.length} already present</span>
                {r.skipped.length > 0 && (
                  <>
                    <span className="text-slate-400">·</span>
                    <span className="text-amber-600">{r.skipped.length} skipped</span>
                  </>
                )}
                {r.conflicts.length > 0 && (
                  <>
                    <span className="text-slate-400">·</span>
                    <span className="text-red-600">{r.conflicts.length} conflicts</span>
                  </>
                )}
                {r.failed.length > 0 && (
                  <>
                    <span className="text-slate-400">·</span>
                    <span className="text-red-600">{r.failed.length} failed</span>
                  </>
                )}
              </div>
              <p className="mt-0.5 text-xs text-slate-400">
                {r.mode} · {r.trigger ?? 'manual'}
                {r.triggeredBy ? ` by ${r.triggeredBy}` : ''} · {timeAgo(r.startedAt)}
                <span className="ml-1 text-slate-300">({new Date(r.startedAt).toLocaleString()})</span>
              </p>
              {r.created.length > 0 && (
                <p className="mt-1 break-words font-mono text-[11px] text-slate-500">
                  {r.created.join(', ')}
                </p>
              )}
              {r.failed.slice(0, 3).map((f) => (
                <p key={f.orderId} className="mt-1 break-words text-[11px] text-red-600">
                  order {f.orderId}: {f.error}
                </p>
              ))}
            </div>
          </li>
        )
      })}
    </ol>
  )
}
