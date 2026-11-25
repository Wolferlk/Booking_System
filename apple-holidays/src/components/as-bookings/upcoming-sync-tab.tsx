'use client'

/**
 * Upcoming Updates tab — control surface for the daily Upcoming Arrivals update
 * check (`src/lib/as-upcoming-sync.ts`).
 *
 * Two switches: the check itself (ships ON), and whether found updates are
 * applied automatically (ships ON) or only listed for review. Below them, the
 * part ops actually reads every morning — what changed yesterday / today / this
 * week, field by field with the before value, and what is waiting for a person.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import {
  CalendarSearch, Loader2, RefreshCw, AlertTriangle, ShieldCheck, Clock, CalendarDays,
  CheckCircle2, XCircle, Hand, Zap, ArrowRight, Eye, History, ExternalLink,
} from 'lucide-react'
import { toast } from 'sonner'
import { Card } from '@/components/ui/card'
import { readApiResponse } from '@/lib/utils'
import { fmtDateTime } from './shared'

// ── Types (mirror src/lib/as-upcoming-sync.ts / as-update-log.ts) ────────────

interface Settings {
  enabled: boolean
  autoApply: boolean
  hour: number
  minute: number
  horizonDays: number
  maxPerRun: number
}

type DetailStatus = 'updated' | 'available' | 'held' | 'review' | 'not-confirmed' | 'not-found' | 'failed'

interface Detail {
  bookingRef: string
  arrivalDate: string
  status: DetailStatus
  changed?: string[]
  notes?: string[]
  error?: string
}

interface Run {
  at: string
  mode: 'auto' | 'manual'
  window: { from: string; to: string }
  autoApply: boolean
  bookings: number
  upstreamRows: number
  changedUpstream: number
  checked: number
  updated: number
  current: number
  available: number
  held: number
  review: number
  notConfirmed: number
  notFound: number
  failed: number
  baselined: number
  carriedOver: number
  breaker: boolean
  aborted?: string
  durationMs: number
  details: Detail[]
}

interface Status {
  settings: Settings
  timezone: string
  window: { from: string; to: string }
  coveredBookings: number
  tracked: number
  pendingCount: number
  lastRunDate: string | null
  running: boolean
  runs: Run[]
}

interface FieldRec { field: string; from: string | null; to: string | null }

interface UpdateEntry {
  bookingRef: string
  at: string
  by: string
  mode: 'manual' | 'prearrival' | 'upcoming'
  changed: string[]
  fields: FieldRec[]
  before?: { itinerary?: unknown[]; accommodations?: unknown[] }
  count: number
}

interface Pending {
  bookingRef: string
  at: string
  reason: 'auto-apply-off' | 'large-change' | 'breaker'
  notes?: string[]
  changed: string[]
  fields: FieldRec[]
}

type Range = 'yesterday' | 'today' | '7d' | 'review'

const HORIZON_PRESETS = [30, 60, 90, 180, 365] as const
const CAP_PRESETS = [50, 150, 250, 400] as const

const FIELD_LABEL: Record<string, string> = {
  arrivalDate: 'Arrival', departureDate: 'Departure', paxAdults: 'Adults', paxChildren: 'Children',
  quotedTotal: 'Total', currency: 'Currency', agent: 'Agent', agentBookingId: 'Agent ref',
  agentEmail: 'Agent email', fileHandler: 'File handler', isNumber: 'IS number', cntlNumber: 'Control no',
  terms: 'Terms', packageIncludes: 'Includes', packageExcludes: 'Excludes', valueAddedServices: 'Value-added',
  contactEmail: 'Contact email', itinerary: 'Itinerary', accommodations: 'Hotels',
  passengers: 'Guests', emergencyContacts: 'Emergency contacts',
}
const label = (f: string) => FIELD_LABEL[f] ?? f

const MODE_LABEL: Record<UpdateEntry['mode'], string> = {
  upcoming: 'Daily check', prearrival: 'Automatic', manual: 'Manual',
}

const REASON_LABEL: Record<Pending['reason'], string> = {
  'auto-apply-off': 'Auto-apply is off',
  'large-change': 'Large change — check before applying',
  breaker: 'Held by the safety breaker',
}

function pad(n: number): string { return String(n).padStart(2, '0') }

function short(v: string | null): string {
  if (v == null || v === '') return '—'
  return v.length > 60 ? `${v.slice(0, 60)}…` : v
}

// ── Component ────────────────────────────────────────────────────────────────

export default function UpcomingSyncTab() {
  const [status, setStatus] = useState<Status | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [range, setRange] = useState<Range>('yesterday')
  const [updates, setUpdates] = useState<UpdateEntry[] | null>(null)
  const [pending, setPending] = useState<Pending[] | null>(null)
  const [listLoading, setListLoading] = useState(false)
  const wasRunning = useRef(false)

  const load = useCallback(async (quiet = false) => {
    try {
      const res = await fetch('/api/as-bookings-v2/upcoming-sync')
      const json = await readApiResponse<Status>(res)
      if (json.success && json.data) { setStatus(json.data); setError(null) }
      else if (!quiet) setError(json.error ?? 'Could not load status')
    } catch {
      if (!quiet) setError('Network error loading status')
    } finally {
      setLoading(false)
    }
  }, [])

  const loadList = useCallback(async (r: Range) => {
    setListLoading(true)
    try {
      const res = await fetch(`/api/as-bookings-v2/upcoming-sync/updates?range=${r}`)
      const json = await readApiResponse<{ updates?: UpdateEntry[]; pending?: Pending[] }>(res)
      if (json.success && json.data) {
        if (r === 'review') { setPending(json.data.pending ?? []); setUpdates(null) }
        else { setUpdates(json.data.updates ?? []); setPending(null) }
      }
    } catch {
      /* the list is secondary — the status card already reports problems */
    } finally {
      setListLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])
  useEffect(() => { void loadList(range) }, [range, loadList])

  // Poll faster while a run is in progress, slowly otherwise. Refresh the list
  // when a run finishes so the panel shows what it just did.
  const running = !!status?.running
  useEffect(() => {
    const id = setInterval(() => { void load(true) }, running ? 8_000 : 45_000)
    if (wasRunning.current && !running) {
      void loadList(range)
      const last = status?.runs[0]
      if (last) toast.success(`Check finished — ${last.updated} updated, ${last.available + last.held} for review`)
    }
    wasRunning.current = running
    return () => clearInterval(id)
  }, [running, load, loadList, range, status?.runs])

  const save = useCallback(async (patch: Partial<Settings>) => {
    if (!status) return
    const next = { ...status.settings, ...patch }
    setSaving(true)
    setStatus({ ...status, settings: next })
    try {
      const res = await fetch('/api/as-bookings-v2/upcoming-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(next),
      })
      const json = await readApiResponse<{ settings: Settings }>(res)
      if (!json.success) toast.error(json.error ?? 'Could not save')
      else toast.success(json.message ?? 'Saved')
    } catch {
      toast.error('Network error saving settings')
    } finally {
      setSaving(false)
      void load(true)
    }
  }, [status, load])

  const runNow = useCallback(async () => {
    setStarting(true)
    try {
      const res = await fetch('/api/as-bookings-v2/upcoming-sync/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const json = await readApiResponse<{ started: boolean; status: Status }>(res)
      if (!json.success) { toast.error(json.error ?? 'Could not start'); return }
      if (json.data?.status) setStatus(json.data.status)
      toast.info(json.message ?? 'Check started')
    } catch {
      toast.error('Network error starting the check')
    } finally {
      setStarting(false)
    }
  }, [])

  if (loading) {
    return (
      <Card className="flex items-center justify-center h-48">
        <Loader2 className="w-6 h-6 text-brand-500 animate-spin" />
      </Card>
    )
  }

  const s = status?.settings
  const enabled = !!s?.enabled
  const autoApply = !!s?.autoApply
  const last = status?.runs[0]
  const coverage = status && status.coveredBookings > 0
    ? Math.min(100, Math.round((status.tracked / status.coveredBookings) * 100))
    : 0

  return (
    <div className="space-y-5">
      {error && (
        <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <AlertTriangle className="w-4 h-4 shrink-0" /> {error}
        </div>
      )}

      {last?.breaker && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <ShieldCheck className="w-4 h-4 mt-0.5 shrink-0" />
          <span>
            <strong>Safety breaker tripped on the last run.</strong> {last.changedUpstream} bookings changed in
            AppleSystem at once, which looks more like an upstream problem than real amendments. Nothing was
            applied — every one is in <em>Needs review</em>.
          </span>
        </div>
      )}
      {last?.aborted && (
        <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <XCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <span><strong>The last run stopped safely.</strong> {last.aborted}. It will try again on the next run.</span>
        </div>
      )}

      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <Card className="overflow-hidden">
        <div className="relative p-5 sm:p-6">
          {enabled && <div className="pointer-events-none absolute -top-24 -left-24 h-64 w-64 rounded-full bg-brand-400/10 blur-3xl" />}

          <div className="relative flex flex-col lg:flex-row lg:items-start justify-between gap-5">
            <div className="flex items-start gap-4">
              <div className={`w-12 h-12 rounded-2xl flex items-center justify-center transition-colors ${
                enabled ? 'bg-brand-600 text-white shadow-lg shadow-brand-600/25' : 'bg-slate-100 text-slate-400'
              }`}>
                <CalendarSearch className={`w-6 h-6 ${running ? 'animate-pulse' : ''}`} />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="font-semibold text-slate-900">Upcoming arrivals · update check</h3>
                  <StatusPill running={running} enabled={enabled} />
                </div>
                <p className="text-xs text-slate-500 mt-1 max-w-xl leading-relaxed">
                  Every day at <span className="font-medium">{pad(s?.hour ?? 4)}:{pad(s?.minute ?? 30)}</span> ({status?.timezone}),
                  checks <span className="font-medium">every booking arriving in the next {s?.horizonDays} days</span> against
                  AppleSystem. Only bookings that were amended upstream are fetched, and{' '}
                  {autoApply
                    ? <>their changes are <span className="font-medium">applied automatically</span>.</>
                    : <>their changes are <span className="font-medium">listed for review</span>, not applied.</>}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3 shrink-0">
              <button
                onClick={runNow}
                disabled={starting || running}
                className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50 active:scale-[0.98] disabled:opacity-60"
              >
                <RefreshCw className={`w-4 h-4 ${starting || running ? 'animate-spin text-brand-500' : 'text-slate-400'}`} />
                {running ? 'Checking…' : 'Check now'}
              </button>
              <Toggle label="Daily check" on={enabled} disabled={saving} onChange={(v) => save({ enabled: v })} />
              <Toggle label="Auto-apply" on={autoApply} disabled={saving} onChange={(v) => save({ autoApply: v })} tone="brand" />
            </div>
          </div>

          <div className="relative grid grid-cols-2 lg:grid-cols-5 gap-3 mt-5 pt-5 border-t border-slate-100">
            <Metric icon={<CalendarDays className="w-3.5 h-3.5" />} label="Arrival window"
              value={status ? `${status.window.from} → ${status.window.to}` : '—'} hint="Tomorrow onwards — never a tour on the ground" />
            <Metric icon={<CheckCircle2 className="w-3.5 h-3.5" />} label="Bookings covered"
              value={String(status?.coveredBookings ?? 0)} hint="Live B2B bookings in the window" tone="good" />
            <Metric icon={<Eye className="w-3.5 h-3.5" />} label="Being tracked"
              value={`${coverage}%`} hint={coverage < 100 ? `${status?.tracked ?? 0} baselined — the first runs work nearest arrivals first` : 'Every booking has a baseline'} />
            <Metric icon={<Hand className="w-3.5 h-3.5" />} label="Needs review"
              value={String(status?.pendingCount ?? 0)} hint="Found, not applied" tone={(status?.pendingCount ?? 0) > 0 ? 'warn' : 'muted'} />
            <Metric icon={<Clock className="w-3.5 h-3.5" />} label="Last run"
              value={last ? fmtDateTime(last.at) : 'Never'}
              hint={last ? `${last.updated} updated · ${last.current} current${last.carriedOver ? ` · ${last.carriedOver} next run` : ''}` : 'No run yet'} />
          </div>
        </div>
      </Card>

      {/* ── What changed ─────────────────────────────────────────────────── */}
      <Card className="p-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <History className="w-4 h-4 text-slate-400" />
            <h4 className="text-sm font-semibold text-slate-900">Bookings updated from AppleSystem</h4>
          </div>
          <div className="flex items-center gap-2">
            <div className="inline-flex rounded-xl bg-slate-100 p-1">
              {(['yesterday', 'today', '7d', 'review'] as Range[]).map((r) => (
                <button key={r} onClick={() => setRange(r)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                    range === r ? 'bg-white text-brand-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                  }`}>
                  {r === 'yesterday' ? 'Yesterday' : r === 'today' ? 'Today' : r === '7d' ? 'Last 7 days' : `Needs review${status?.pendingCount ? ` (${status.pendingCount})` : ''}`}
                </button>
              ))}
            </div>
            <Link href={`/dashboard/bookings?asUpdated=${range}`}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
              title="Open these bookings in All Bookings">
              All Bookings <ExternalLink className="w-3 h-3" />
            </Link>
          </div>
        </div>
        <p className="text-[11px] text-slate-400 mt-1.5">
          Covers every way a booking is refreshed from the API — this daily check, the pre-arrival sync, the parity check and
          the manual <em>Fetch Data from API</em> button. Each row shows what the booking said before.
        </p>

        <div className="mt-4">
          {listLoading ? (
            <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 text-brand-500 animate-spin" /></div>
          ) : range === 'review' ? (
            <PendingList items={pending ?? []} />
          ) : (
            <UpdateList items={updates ?? []} />
          )}
        </div>
      </Card>

      {/* ── Tuning + safety ──────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="p-5">
          <h4 className="flex items-center gap-2 text-sm font-semibold text-slate-900"><CalendarDays className="w-4 h-4 text-slate-400" /> How far ahead</h4>
          <p className="text-xs text-slate-500 mt-1.5">Arrivals from tomorrow up to this many days out are checked.</p>
          <Presets values={HORIZON_PRESETS} current={s?.horizonDays} disabled={saving} suffix=" days" onPick={(v) => save({ horizonDays: v })} />

          <h4 className="flex items-center gap-2 text-sm font-semibold text-slate-900 mt-5"><Clock className="w-4 h-4 text-slate-400" /> What time</h4>
          <div className="mt-2 flex items-center gap-2">
            <select disabled={saving} value={s?.hour ?? 4} onChange={(e) => save({ hour: Number(e.target.value) })}
              className="rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none disabled:opacity-50">
              {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{pad(h)}</option>)}
            </select>
            <span className="text-slate-400">:</span>
            <select disabled={saving} value={s?.minute ?? 30} onChange={(e) => save({ minute: Number(e.target.value) })}
              className="rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none disabled:opacity-50">
              {[0, 15, 30, 45].map((m) => <option key={m} value={m}>{pad(m)}</option>)}
            </select>
            <span className="text-xs text-slate-400">{status?.timezone}</span>
          </div>
        </Card>

        <Card className="p-5">
          <h4 className="flex items-center gap-2 text-sm font-semibold text-slate-900"><Zap className="w-4 h-4 text-slate-400" /> Fetches per run</h4>
          <p className="text-xs text-slate-500 mt-1.5 leading-relaxed">
            Caps how many bookings are fetched from AppleSystem in one run, so the API is never flooded. Anything over the
            cap is done on the next run, nearest arrival first.
          </p>
          <Presets values={CAP_PRESETS} current={s?.maxPerRun} disabled={saving} onPick={(v) => save({ maxPerRun: v })} />
        </Card>

        <Card className="p-5 border-emerald-200 bg-emerald-50/50">
          <h4 className="flex items-center gap-2 text-sm font-semibold text-emerald-900"><ShieldCheck className="w-4 h-4" /> How live data stays safe</h4>
          <ul className="mt-2 space-y-1.5 text-[11px] leading-relaxed text-emerald-900">
            <li>• Never touches status, tickets, drivers, agenda, P&amp;L, payments or the checklist.</li>
            <li>• Previews each booking first and applies exactly that preview, or nothing.</li>
            <li>• Hand-edited text is never overwritten. You choose Replace or Skip on the booking page.</li>
            <li>• Big changes (arrival moved &gt;3 weeks, new agency, pax or total halved, itinerary or hotels mostly gone) are held for review.</li>
            <li>• If a large share of the book changes at once, a safety breaker stops it applying anything.</li>
            <li>• Never cancels or creates bookings. Skips B2C, cancelled and completed files, and tours already on the ground.</li>
            <li>• Every change is logged with its before value.</li>
          </ul>
        </Card>
      </div>

      {/* ── Run history ──────────────────────────────────────────────────── */}
      <Card className="p-5">
        <h4 className="text-sm font-semibold text-slate-900">Recent runs</h4>
        {!status?.runs.length ? (
          <p className="mt-3 text-sm text-slate-400">No run has happened yet.</p>
        ) : (
          <div className="mt-3 space-y-2">
            {status.runs.map((run) => <RunRow key={run.at} run={run} />)}
          </div>
        )}
      </Card>
    </div>
  )
}

// ── Pieces ───────────────────────────────────────────────────────────────────

function StatusPill({ running, enabled }: { running: boolean; enabled: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
      running ? 'bg-brand-100 text-brand-700' : enabled ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'
    }`}>
      <span className={`w-1.5 h-1.5 rounded-full ${
        running ? 'bg-brand-500 animate-pulse' : enabled ? 'bg-emerald-500 animate-pulse' : 'bg-slate-400'
      }`} />
      {running ? 'Checking' : enabled ? 'On' : 'Off'}
    </span>
  )
}

function Toggle({ label, on, disabled, onChange, tone = 'emerald' }: {
  label: string; on: boolean; disabled?: boolean; onChange: (v: boolean) => void; tone?: 'emerald' | 'brand'
}) {
  return (
    <label className="inline-flex items-center gap-2 text-xs font-semibold text-slate-600">
      {label}
      <button role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={() => onChange(!on)}
        className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors disabled:opacity-60 ${
          on ? (tone === 'brand' ? 'bg-brand-600' : 'bg-emerald-500') : 'bg-slate-300'
        }`}>
        <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${on ? 'translate-x-6' : 'translate-x-1'}`} />
      </button>
    </label>
  )
}

function Presets({ values, current, disabled, suffix = '', onPick }: {
  values: readonly number[]; current?: number; disabled?: boolean; suffix?: string; onPick: (v: number) => void
}) {
  return (
    <div className="flex flex-wrap gap-2 mt-3">
      {values.map((v) => (
        <button key={v} disabled={disabled} onClick={() => onPick(v)}
          className={`rounded-xl border px-3 py-1.5 text-xs font-semibold transition-all disabled:opacity-50 ${
            current === v ? 'border-brand-400 bg-brand-50 text-brand-700 shadow-sm' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
          }`}>
          {v}{suffix}
        </button>
      ))}
    </div>
  )
}

function Metric({ icon, label, value, hint, tone = 'default' }: {
  icon: React.ReactNode; label: string; value: string; hint?: string; tone?: 'default' | 'good' | 'warn' | 'muted'
}) {
  const valueTone = tone === 'good' ? 'text-emerald-700' : tone === 'warn' ? 'text-amber-700' : tone === 'muted' ? 'text-slate-500' : 'text-slate-900'
  return (
    <div className="rounded-xl border border-slate-100 bg-slate-50/60 px-3 py-2.5 min-w-0">
      <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">{icon} {label}</p>
      <p className={`mt-1 text-sm font-bold truncate ${valueTone}`}>{value}</p>
      {hint && <p className="mt-0.5 text-[11px] text-slate-400 leading-snug">{hint}</p>}
    </div>
  )
}

function FieldDiffs({ fields, changed }: { fields: FieldRec[]; changed: string[] }) {
  const sections = changed.filter((c) => !fields.some((f) => f.field === c))
  return (
    <div className="mt-1.5 flex flex-wrap gap-1.5">
      {fields.map((f) => (
        <span key={f.field} className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-[11px]">
          <span className="font-semibold text-slate-600">{label(f.field)}</span>
          <span className="text-slate-400 line-through">{short(f.from)}</span>
          <ArrowRight className="w-2.5 h-2.5 text-slate-400" />
          <span className="text-slate-800">{short(f.to)}</span>
        </span>
      ))}
      {sections.map((s) => (
        <span key={s} className="inline-flex items-center rounded-md border border-sky-200 bg-sky-50 px-1.5 py-0.5 text-[11px] font-semibold text-sky-700">
          {label(s)} refreshed
        </span>
      ))}
    </div>
  )
}

function UpdateList({ items }: { items: UpdateEntry[] }) {
  if (items.length === 0) return <p className="py-6 text-center text-sm text-slate-400">No booking was updated from AppleSystem in this period.</p>
  return (
    <ul className="divide-y divide-slate-100">
      {items.map((u) => (
        <li key={`${u.bookingRef}-${u.at}`} className="py-2.5">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Link href={`/dashboard/bookings/${u.bookingRef}`} className="font-mono font-semibold text-slate-900 hover:text-brand-600">{u.bookingRef}</Link>
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
              u.mode === 'manual' ? 'bg-slate-100 text-slate-600' : 'bg-sky-100 text-sky-700'
            }`}>{MODE_LABEL[u.mode] ?? u.mode}</span>
            <span className="text-slate-400">{fmtDateTime(u.at)} · {u.by}{u.count > 1 ? ` · ${u.count} updates` : ''}</span>
          </div>
          <FieldDiffs fields={u.fields} changed={u.changed} />
        </li>
      ))}
    </ul>
  )
}

function PendingList({ items }: { items: Pending[] }) {
  if (items.length === 0) return <p className="py-6 text-center text-sm text-slate-400">Nothing is waiting for review.</p>
  return (
    <ul className="divide-y divide-slate-100">
      {items.map((p) => (
        <li key={p.bookingRef} className="py-2.5">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Link href={`/dashboard/bookings/${p.bookingRef}`} className="font-mono font-semibold text-slate-900 hover:text-brand-600">{p.bookingRef}</Link>
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
              p.reason === 'auto-apply-off' ? 'bg-slate-100 text-slate-600' : 'bg-amber-100 text-amber-800'
            }`}>{REASON_LABEL[p.reason]}</span>
            <span className="text-slate-400">found {fmtDateTime(p.at)}</span>
            <Link href={`/dashboard/bookings/${p.bookingRef}`} className="ml-auto inline-flex items-center gap-1 text-[11px] font-semibold text-brand-600 hover:underline">
              Review with Fetch Data from API <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
          {p.notes && p.notes.length > 0 && (
            <ul className="mt-1 space-y-0.5">
              {p.notes.map((n) => <li key={n} className="flex items-center gap-1 text-[11px] text-amber-800"><AlertTriangle className="w-3 h-3" /> {n}</li>)}
            </ul>
          )}
          <FieldDiffs fields={p.fields} changed={p.changed} />
        </li>
      ))}
    </ul>
  )
}

const DETAIL_TEXT: Record<DetailStatus, { text: string; cls: string }> = {
  updated:         { text: 'updated', cls: 'text-emerald-700' },
  available:       { text: 'waiting for review', cls: 'text-slate-600' },
  held:            { text: 'held for review', cls: 'text-amber-700' },
  review:          { text: 'updated · hand edit to decide', cls: 'text-amber-700' },
  'not-confirmed': { text: 'no longer confirmed in AppleSystem', cls: 'text-rose-700' },
  'not-found':     { text: 'not checked', cls: 'text-slate-500' },
  failed:          { text: 'failed', cls: 'text-red-600' },
}

function RunRow({ run }: { run: Run }) {
  const [open, setOpen] = useState(false)
  const bad = run.failed > 0 || run.breaker || !!run.aborted
  return (
    <div className={`rounded-xl border ${bad ? 'border-amber-200 bg-amber-50' : 'border-slate-200 bg-white'}`}>
      <button onClick={() => setOpen((v) => !v)} className="flex w-full flex-wrap items-center justify-between gap-3 px-3.5 py-2.5 text-left">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-slate-800">
            {fmtDateTime(run.at)}{' '}
            <span className="font-normal text-slate-500">
              · {run.mode === 'auto' ? 'scheduled' : 'manual'} · {run.bookings} bookings · {run.changedUpstream} amended upstream
              {!run.autoApply && ' · review only'}
            </span>
          </p>
          <p className="text-[11px] text-slate-500">
            {Math.max(1, Math.round(run.durationMs / 1000))}s · {run.checked} fetched
            {run.baselined > 0 && ` · ${run.baselined} baselined`}
            {run.carriedOver > 0 && <span className="text-amber-700"> · {run.carriedOver} carried over</span>}
            {run.breaker && <span className="text-amber-700"> · breaker</span>}
            {run.aborted && <span className="text-red-600"> · stopped: {run.aborted}</span>}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-3 text-[11px] font-semibold">
          <span className="text-emerald-700">{run.updated} updated</span>
          <span className="text-amber-700">{run.available + run.held} review</span>
          <span className="text-slate-500">{run.current} current</span>
          <span className={run.failed > 0 ? 'text-red-600' : 'text-slate-400'}>{run.failed} failed</span>
        </div>
      </button>
      {open && (
        <div className="border-t border-slate-100 px-3.5 py-2.5">
          {run.details.length === 0 ? (
            <p className="text-[11px] text-slate-400">Nothing needed doing — every checked booking already matched AppleSystem.</p>
          ) : (
            <ul className="space-y-1">
              {run.details.map((d) => (
                <li key={`${d.bookingRef}-${d.status}`} className="flex flex-wrap items-start gap-2 text-[11px]">
                  {d.status === 'failed' ? <XCircle className="mt-0.5 w-3 h-3 shrink-0 text-red-500" /> : <CheckCircle2 className="mt-0.5 w-3 h-3 shrink-0 text-slate-300" />}
                  <Link href={`/dashboard/bookings/${d.bookingRef}`} className="font-mono font-semibold text-slate-700 hover:text-brand-600">{d.bookingRef}</Link>
                  <span className="text-slate-400">arr {d.arrivalDate}</span>
                  <span className={DETAIL_TEXT[d.status].cls}>{DETAIL_TEXT[d.status].text}</span>
                  {d.changed?.length ? <span className="text-slate-500">— {d.changed.map(label).join(', ')}</span> : null}
                  {d.notes?.map((n) => <span key={n} className="w-full pl-5 text-amber-800">{n}</span>)}
                  {d.error && <span className="w-full pl-5 text-slate-500">{d.error}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
