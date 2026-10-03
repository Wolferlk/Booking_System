'use client'

/**
 * Driver-Auto (Allocating)
 *
 * Trips nobody is driving yet, inside the D-N window (default D-10), offered to
 * registered drivers and vendors through a personal trip-board link that goes
 * out every morning on WhatsApp and email.
 *
 *  • Sri Lanka  — the whole booking is one round trip.
 *  • VN / SG / MY — every movement is its own trip.
 *
 * Per country, the Approval switch decides what a driver's tap does: ON — it
 * lands in "Get Bookings" here for a person to approve; OFF — the first driver
 * gets the trip straight away (clashes and over-full vehicles still blocked).
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import {
  AlertTriangle, ArrowRight, BellRing, CalendarClock, Car, Check, CheckCircle2, ChevronDown,
  Clock, Copy, ExternalLink, Inbox, KeyRound, Link2, Loader2, Mail, MapPin, MessageCircle,
  RefreshCw, Route, Search, Send, Settings2, ShieldCheck, Sparkles, Timer, UserPlus, Users,
  X, Zap,
} from 'lucide-react'
import Button from '@/components/ui/button'
import { CountryFlag } from '@/components/ui/country-flag'
import { cn } from '@/lib/utils'
import {
  CLAIM_STATUS_META, DA_COUNTRY_META, HORIZON_CHOICES, fmtDaysAway, fmtTripDay,
  type ClaimView, type DaCountry, type DaSettings, type OpenTrip, type PartyView,
} from '@/lib/driver-auto/shared'

// ── Types of the API payload ─────────────────────────────────────────────────

interface Overview {
  country: DaCountry
  allowedCountries: DaCountry[]
  horizon: number
  today: string
  settings: DaSettings
  setupRequired: boolean
  setupMessage: string | null
  trips: OpenTrip[]
  claims: ClaimView[]
  parties: PartyView[]
  stats: {
    openTrips: number; urgent: number; withRequests: number; pending: number; pendingStale: number
    wonLast14: number; recipients: number; reachable: number; movements: number
  }
  driversNoCountry: number
  vendorsNoCountry: number
  todaySends: { channel: string; status: string; n: number }[]
  nextSendAt: string
  templateName: string
  preview: string | null
  generatedAt: string
}

const ALL_TABS: DaCountry[] = ['SRILANKA', 'VIETNAM', 'SINGAPORE', 'MALAYSIA']

const TONE: Record<string, string> = {
  amber: 'bg-amber-50 text-amber-700 ring-amber-200',
  emerald: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  rose: 'bg-rose-50 text-rose-700 ring-rose-200',
  slate: 'bg-slate-100 text-slate-600 ring-slate-200',
  sky: 'bg-sky-50 text-sky-700 ring-sky-200',
}

function urgencyTone(daysAway: number) {
  if (daysAway <= 1) return 'rose'
  if (daysAway <= 3) return 'amber'
  return 'sky'
}

function ago(iso: string): string {
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

async function api<T>(url: string, init?: RequestInit): Promise<{ data: T; message?: string }> {
  const res = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) } })
  const json = await res.json().catch(() => ({}))
  if (!res.ok || json.success === false) throw new Error(json.error || `Request failed (${res.status})`)
  return { data: json.data as T, message: json.message }
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function DriverAutoPage() {
  const [tab, setTab] = useState<DaCountry>('SRILANKA')
  const [horizon, setHorizon] = useState<number | null>(null)
  const [cache, setCache] = useState<Partial<Record<DaCountry, Overview>>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [assignFor, setAssignFor] = useState<OpenTrip | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [allowed, setAllowed] = useState<DaCountry[]>(ALL_TABS)

  const data = cache[tab]

  const load = useCallback(async (country: DaCountry, h: number | null) => {
    const qs = new URLSearchParams({ country })
    if (h) qs.set('horizon', String(h))
    const { data } = await api<Overview>(`/api/driver-auto?${qs}`)
    setCache(c => ({ ...c, [country]: data }))
    return data
  }, [])

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      await load(tab, horizon)
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [load, tab, horizon])

  // First load: the active tab, then the others quietly for their badges.
  useEffect(() => {
    let alive = true
    ;(async () => {
      setLoading(true)
      try {
        const first = await load(tab, horizon)
        if (!alive) return
        setAllowed(first.allowedCountries)
        if (!first.allowedCountries.includes(tab)) setTab(first.allowedCountries[0])
        setError(null)
        for (const c of first.allowedCountries) if (c !== tab) void load(c, horizon).catch(() => undefined)
      } catch (e) {
        if (alive) setError((e as Error).message)
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [horizon])

  // Switching to a tab whose background load has not landed yet.
  useEffect(() => {
    if (!cache[tab] && !loading) void refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab])

  // Requests arrive while the page is open — poll the active tab every minute.
  useEffect(() => {
    const id = window.setInterval(() => { void load(tab, horizon).catch(() => undefined) }, 60_000)
    return () => window.clearInterval(id)
  }, [load, tab, horizon])

  const saveSettings = useCallback(async (patch: Partial<DaSettings> | { countries: Partial<Record<DaCountry, Partial<DaSettings['countries'][DaCountry]>>> }) => {
    try {
      const { data: saved, message } = await api<DaSettings>('/api/driver-auto/settings', { method: 'PUT', body: JSON.stringify(patch) })
      setCache(c => {
        const next = { ...c }
        for (const k of Object.keys(next) as DaCountry[]) next[k] = { ...next[k]!, settings: saved }
        return next
      })
      toast.success(message ?? 'Saved')
    } catch (e) {
      toast.error((e as Error).message)
    }
  }, [])

  const meta = DA_COUNTRY_META[tab]
  const cs = data?.settings.countries[tab]

  return (
    <div className="space-y-4 pb-16">
      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-slate-950 via-slate-900 to-emerald-950 p-5 text-white">
        <div className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-emerald-500/15 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-20 left-1/3 h-48 w-48 rounded-full bg-amber-400/10 blur-3xl" />
        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight">
              <span className="grid h-8 w-8 place-items-center rounded-xl bg-emerald-500/20 ring-1 ring-emerald-400/30">
                <Zap className="h-4 w-4 text-emerald-300" />
              </span>
              Driver-Auto
              <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-200">Allocating</span>
            </h1>
            <p className="mt-1.5 max-w-2xl text-xs leading-relaxed text-slate-300">
              Trips with no driver yet, starting within the next {data?.horizon ?? horizon ?? 10} days. Every morning each registered
              driver and vendor gets a personal link and can request a trip — no login needed.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={horizon ?? data?.horizon ?? 10}
              onChange={e => { setCache({}); setHorizon(Number(e.target.value)) }}
              className="rounded-lg border border-white/15 bg-white/10 px-2.5 py-1.5 text-xs font-semibold text-white focus:outline-none focus:ring-2 focus:ring-emerald-400"
            >
              {HORIZON_CHOICES.map(h => <option key={h} value={h} className="text-slate-900">D-{h} window</option>)}
            </select>
            <Button size="sm" variant="secondary" onClick={() => setShowSettings(true)} icon={<Settings2 className="h-3.5 w-3.5" />}>Settings</Button>
            <Button size="sm" variant="secondary" onClick={() => void refresh()}
                    icon={<RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />}>Refresh</Button>
          </div>
        </div>

        {/* Country tabs */}
        <div className="relative mt-4 flex flex-wrap gap-2">
          {ALL_TABS.filter(c => allowed.includes(c)).map(c => {
            const m = DA_COUNTRY_META[c]
            const o = cache[c]
            const active = c === tab
            return (
              <button
                key={c}
                onClick={() => setTab(c)}
                className={cn(
                  'group flex items-center gap-2.5 rounded-xl px-3.5 py-2 text-left transition-all',
                  active ? 'bg-white text-slate-900 shadow-lg shadow-emerald-500/10' : 'bg-white/5 text-slate-200 ring-1 ring-white/10 hover:bg-white/10',
                )}
              >
                <CountryFlag country={c} className="h-4 w-6 rounded-[2px] shadow-sm" />
                <span>
                  <span className="block text-sm font-bold leading-tight">{m.label}</span>
                  <span className={cn('block text-[10px] font-medium', active ? 'text-slate-500' : 'text-slate-400')}>
                    {m.unit === 'BOOKING' ? 'Full booking · round trip' : 'Per movement'}
                  </span>
                </span>
                <span className="ml-1 flex flex-col items-end gap-0.5">
                  <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-bold tabular-nums',
                    active ? 'bg-slate-900 text-white' : 'bg-white/15 text-white')}>
                    {o ? o.stats.openTrips : '·'}
                  </span>
                  {!!o?.stats.pending && (
                    <span className="rounded-full bg-amber-400 px-1.5 text-[9px] font-bold text-amber-950">{o.stats.pending} req</span>
                  )}
                </span>
              </button>
            )
          })}
        </div>

        {/* KPIs */}
        {data && (
          <div className="relative mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            <Kpi icon={Route} label={meta.unit === 'BOOKING' ? 'Open bookings' : 'Open movements'} value={data.stats.openTrips} />
            <Kpi icon={Timer} label="Starting ≤ 48h" value={data.stats.urgent} tone={data.stats.urgent ? 'rose' : undefined} />
            <Kpi icon={Inbox} label="Requests waiting" value={data.stats.pending} tone={data.stats.pending ? 'amber' : undefined} />
            <Kpi icon={CheckCircle2} label="Allocated (14d)" value={data.stats.wonLast14} tone="emerald" />
            <Kpi icon={Users} label="Drivers & vendors" value={data.stats.recipients} sub={`${data.stats.reachable} reachable`} />
            <Kpi icon={MapPin} label="Driven movements" value={data.stats.movements} />
          </div>
        )}
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          <AlertTriangle className="h-4 w-4 shrink-0" /> {error}
        </div>
      )}

      {data?.setupRequired && (
        <div className="flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <div className="font-semibold">Requests and sends are not switched on for this database yet</div>
            <div className="mt-0.5 text-xs">{data.setupMessage} Open trips below are live — only requests, approvals and the morning send need the two new tables.</div>
          </div>
        </div>
      )}

      {!data && loading && (
        <div className="grid place-items-center rounded-2xl border border-slate-200 bg-white py-24 text-slate-400">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      )}

      {data && cs && (
        <>
          {/* ── Approval switch ─────────────────────────────────────────── */}
          <ApprovalSwitch
            country={tab}
            requireApproval={cs.requireApproval}
            onChange={v => void saveSettings({ countries: { [tab]: { requireApproval: v } } })}
          />

          {/* ── Window strip ────────────────────────────────────────────── */}
          <WindowStrip trips={data.trips} today={data.today} horizon={data.horizon} />

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_400px]">
            <OpenTrips data={data} onAssign={setAssignFor} />
            <div className="space-y-4">
              <RequestsInbox data={data} onChanged={() => void refresh()} />
              <MorningPanel data={data} country={tab} onSettings={saveSettings} onSent={() => void refresh()} />
            </div>
          </div>

          <PartiesTable data={data} country={tab} onChanged={() => void refresh()} />
        </>
      )}

      {assignFor && data && (
        <AssignModal
          trip={assignFor}
          parties={data.parties}
          claims={data.claims}
          onClose={() => setAssignFor(null)}
          onDone={() => { setAssignFor(null); void refresh() }}
        />
      )}

      {showSettings && data && (
        <SettingsModal settings={data.settings} onClose={() => setShowSettings(false)}
                       onSave={async s => { await saveSettings(s); setShowSettings(false); void refresh() }} />
      )}
    </div>
  )
}

// ── Pieces ───────────────────────────────────────────────────────────────────

function Kpi({ icon: Icon, label, value, sub, tone }: {
  icon: React.ComponentType<{ className?: string }>; label: string; value: number; sub?: string; tone?: 'rose' | 'amber' | 'emerald'
}) {
  return (
    <div className="rounded-xl bg-white/[0.06] p-3 ring-1 ring-white/10 backdrop-blur">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{label}</span>
        <Icon className={cn('h-3.5 w-3.5',
          tone === 'rose' ? 'text-rose-400' : tone === 'amber' ? 'text-amber-300' : tone === 'emerald' ? 'text-emerald-300' : 'text-slate-500')} />
      </div>
      <div className="mt-1 text-2xl font-bold tabular-nums">{value}</div>
      {sub && <div className="text-[10px] text-slate-400">{sub}</div>}
    </div>
  )
}

function Toggle({ on, onChange, disabled, size = 'md' }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean; size?: 'sm' | 'md' }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={cn(
        'relative inline-flex shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:ring-offset-2 disabled:opacity-50',
        size === 'sm' ? 'h-5 w-9' : 'h-6 w-11',
        on ? 'bg-emerald-500' : 'bg-slate-300',
      )}
    >
      <span className={cn('inline-block transform rounded-full bg-white shadow transition-transform',
        size === 'sm' ? 'h-4 w-4' : 'h-5 w-5',
        on ? (size === 'sm' ? 'translate-x-4' : 'translate-x-5') : 'translate-x-0.5')} />
    </button>
  )
}

function ApprovalSwitch({ country, requireApproval, onChange }: { country: DaCountry; requireApproval: boolean; onChange: (v: boolean) => void }) {
  const unit = DA_COUNTRY_META[country].unit === 'BOOKING' ? 'booking' : 'movement'
  return (
    <div className={cn('flex flex-wrap items-center justify-between gap-4 rounded-2xl border p-4 transition-colors',
      requireApproval ? 'border-emerald-200 bg-gradient-to-r from-emerald-50 to-white' : 'border-amber-300 bg-gradient-to-r from-amber-50 to-white')}>
      <div className="flex items-start gap-3">
        <span className={cn('grid h-10 w-10 shrink-0 place-items-center rounded-xl',
          requireApproval ? 'bg-emerald-500 text-white' : 'bg-amber-500 text-white')}>
          {requireApproval ? <ShieldCheck className="h-5 w-5" /> : <Zap className="h-5 w-5" />}
        </span>
        <div>
          <div className="text-sm font-bold text-slate-900">
            {requireApproval ? 'Approval needed' : 'Direct assign — first come, first served'}
            <span className="ml-2 text-xs font-medium text-slate-500">{DA_COUNTRY_META[country].label}</span>
          </div>
          <p className="mt-0.5 max-w-3xl text-xs text-slate-600">
            {requireApproval
              ? `A driver's request lands in Get Bookings below. Nothing is assigned until someone here approves it.`
              : `The first driver to tap "Take" gets the ${unit} immediately and is sent the assignment on WhatsApp. Date clashes and vehicles with too few seats are still refused.`}
          </p>
        </div>
      </div>
      <label className="flex items-center gap-3 text-xs font-semibold text-slate-700">
        Approve before assigning
        <Toggle on={requireApproval} onChange={v => {
          if (!v && !window.confirm(`Turn approval OFF for ${DA_COUNTRY_META[country].label}? Drivers will be assigned the moment they tap "Take".`)) return
          onChange(v)
        }} />
      </label>
    </div>
  )
}

function WindowStrip({ trips, today, horizon }: { trips: OpenTrip[]; today: string; horizon: number }) {
  const days = useMemo(() => {
    const out: { ymd: string; n: number; req: number }[] = []
    const base = Date.parse(`${today}T00:00:00Z`)
    for (let i = 0; i <= horizon; i++) {
      const ymd = new Date(base + i * 86_400_000).toISOString().slice(0, 10)
      const list = trips.filter(t => t.startDate === ymd)
      out.push({ ymd, n: list.length, req: list.filter(t => (t.requestCount ?? 0) > 0).length })
    }
    return out
  }, [trips, today, horizon])
  const max = Math.max(1, ...days.map(d => d.n))

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-bold text-slate-900">
          <CalendarClock className="h-4 w-4 text-emerald-600" /> D-{horizon} window
        </h2>
        <div className="flex items-center gap-3 text-[10px] font-semibold text-slate-500">
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-slate-300" /> No driver</span>
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-amber-400" /> Has requests</span>
        </div>
      </div>
      <div className="flex h-24 items-end gap-1.5">
        {days.map((d, i) => (
          <div key={d.ymd} className="group flex flex-1 flex-col items-center gap-1" title={`${fmtTripDay(d.ymd)} — ${d.n} open`}>
            <span className={cn('text-[10px] font-bold tabular-nums', d.n ? 'text-slate-700' : 'text-slate-300')}>{d.n || ''}</span>
            <div className="relative w-full overflow-hidden rounded-md bg-slate-100" style={{ height: `${Math.max(6, (d.n / max) * 64)}px` }}>
              <div className={cn('absolute inset-x-0 bottom-0', i <= 1 ? 'bg-rose-300' : 'bg-slate-300')} style={{ height: d.n ? '100%' : 0 }} />
              {d.req > 0 && <div className="absolute inset-x-0 bottom-0 bg-amber-400" style={{ height: `${(d.req / Math.max(1, d.n)) * 100}%` }} />}
            </div>
            <span className={cn('text-[9px] font-semibold', i === 0 ? 'text-emerald-700' : 'text-slate-400')}>
              {i === 0 ? 'Today' : fmtTripDay(d.ymd).split(' ').slice(1).join(' ')}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

function OpenTrips({ data, onAssign }: { data: Overview; onAssign: (t: OpenTrip) => void }) {
  const [q, setQ] = useState('')
  const [onlyRequested, setOnlyRequested] = useState(false)
  const [open, setOpen] = useState<string | null>(null)

  const visible = useMemo(() => {
    const s = q.trim().toLowerCase()
    return data.trips.filter(t => {
      if (onlyRequested && !(t.requestCount ?? 0)) return false
      if (!s) return true
      return [t.bookingRef, t.title, t.route, t.agent, t.leadGuest, ...t.cities].filter(Boolean).join(' ').toLowerCase().includes(s)
    })
  }, [data.trips, q, onlyRequested])

  const groups = useMemo(() => {
    const m = new Map<string, OpenTrip[]>()
    for (const t of visible) m.set(t.startDate, [...(m.get(t.startDate) ?? []), t])
    return Array.from(m.entries())
  }, [visible])

  const unitWord = DA_COUNTRY_META[data.country].unit === 'BOOKING' ? 'bookings' : 'movements'

  return (
    <section className="rounded-2xl border border-slate-200 bg-white">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 p-4">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-bold text-slate-900">
            <Car className="h-4 w-4 text-emerald-600" /> Still not allocated
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-600">{visible.length}</span>
          </h2>
          <p className="text-[11px] text-slate-500">Open {unitWord} from today to D-{data.horizon}. Leisure and hotel-only days are left out.</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Ref, city, agent, guest…"
                   className="w-52 rounded-lg border border-slate-300 py-1.5 pl-8 pr-2 text-xs focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500" />
          </div>
          <button onClick={() => setOnlyRequested(v => !v)}
                  className={cn('rounded-lg border px-2.5 py-1.5 text-xs font-semibold',
                    onlyRequested ? 'border-amber-300 bg-amber-50 text-amber-700' : 'border-slate-300 text-slate-500 hover:bg-slate-50')}>
            With requests
          </button>
        </div>
      </header>

      {groups.length === 0 ? (
        <div className="grid place-items-center gap-2 py-16 text-center">
          <span className="grid h-12 w-12 place-items-center rounded-2xl bg-emerald-50"><Sparkles className="h-6 w-6 text-emerald-500" /></span>
          <div className="text-sm font-semibold text-slate-700">Everything in the window has a driver</div>
          <div className="text-xs text-slate-400">Nothing to offer in {DA_COUNTRY_META[data.country].label} for the next {data.horizon} days.</div>
        </div>
      ) : (
        <div className="divide-y divide-slate-100">
          {groups.map(([day, list]) => (
            <div key={day} className="p-4">
              <div className="mb-2 flex items-center gap-2">
                <span className={cn('rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ring-1', TONE[urgencyTone(list[0].daysAway)])}>
                  {fmtDaysAway(list[0].daysAway)}
                </span>
                <span className="text-xs font-bold text-slate-700">{fmtTripDay(day, { year: true })}</span>
                <span className="text-[11px] text-slate-400">· {list.length} open</span>
              </div>
              <div className="grid gap-2 lg:grid-cols-2">
                {list.map(t => (
                  <TripCard key={t.key} trip={t} expanded={open === t.key} onToggle={() => setOpen(o => (o === t.key ? null : t.key))} onAssign={() => onAssign(t)} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

function TripCard({ trip: t, expanded, onToggle, onAssign }: { trip: OpenTrip; expanded: boolean; onToggle: () => void; onAssign: () => void }) {
  return (
    <div className={cn('group rounded-xl border bg-white p-3 transition-all hover:shadow-md',
      (t.requestCount ?? 0) > 0 ? 'border-amber-300 ring-1 ring-amber-100' : 'border-slate-200')}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <a href={`/dashboard/bookings/${encodeURIComponent(t.bookingRef)}`} target="_blank" rel="noreferrer"
               className="text-xs font-bold text-slate-900 hover:text-emerald-700 hover:underline">{t.bookingRef}</a>
            {t.kind === 'BOOKING' && <span className="rounded bg-slate-900 px-1.5 py-px text-[9px] font-bold text-white">{t.days}D ROUND TRIP</span>}
            {t.startTime && <span className="flex items-center gap-0.5 text-[10px] font-semibold text-slate-500"><Clock className="h-3 w-3" />{t.startTime}</span>}
          </div>
          <div className="mt-0.5 truncate text-sm font-semibold text-slate-800" title={t.title}>{t.title}</div>
          <div className="mt-0.5 flex items-center gap-1 truncate text-[11px] text-slate-500" title={t.route}>
            <Route className="h-3 w-3 shrink-0" /> {t.route}
          </div>
        </div>
        {(t.requestCount ?? 0) > 0 && (
          <span className="flex shrink-0 items-center gap-1 rounded-full bg-amber-400 px-2 py-0.5 text-[10px] font-bold text-amber-950">
            <BellRing className="h-3 w-3" /> {t.requestCount}
          </span>
        )}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[10px]">
        <Chip icon={Users}>{t.paxAdults}A{t.paxChildren ? ` · ${t.paxChildren}C` : ''}</Chip>
        {t.kind === 'BOOKING' && <Chip icon={MapPin}>{t.drivenLegs} driven day(s)</Chip>}
        {t.vehicleType && <Chip icon={Car}>{t.vehicleType}</Chip>}
        {t.agent && <Chip>{t.agent}</Chip>}
        {t.noAgenda && <span className="rounded-md bg-rose-50 px-1.5 py-0.5 font-semibold text-rose-600 ring-1 ring-rose-200">No movement chart yet</span>}
      </div>

      <div className="mt-2.5 flex items-center justify-between">
        {t.legs.length > 1 ? (
          <button onClick={onToggle} className="flex items-center gap-1 text-[11px] font-semibold text-slate-500 hover:text-slate-800">
            <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', expanded && 'rotate-180')} /> {t.legs.length} movements
          </button>
        ) : <span />}
        <button onClick={onAssign}
                className="flex items-center gap-1 rounded-lg bg-slate-900 px-2.5 py-1 text-[11px] font-semibold text-white opacity-90 transition hover:bg-emerald-600 hover:opacity-100">
          <UserPlus className="h-3 w-3" /> Assign
        </button>
      </div>

      {expanded && (
        <ol className="mt-2 space-y-1 border-t border-slate-100 pt-2">
          {t.legs.map(l => (
            <li key={l.agendaItemId} className={cn('flex gap-2 text-[11px]', !l.driven && 'text-slate-400 line-through decoration-slate-300')}>
              <span className="w-16 shrink-0 font-semibold text-slate-600">{fmtTripDay(l.date).replace(/^\w+ /, '')}</span>
              <span className="w-10 shrink-0 tabular-nums text-slate-400">{l.time ?? ''}</span>
              <span className="min-w-0 truncate">{l.from || l.location}{l.to ? ` → ${l.to}` : ''}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

function Chip({ icon: Icon, children }: { icon?: React.ComponentType<{ className?: string }>; children: React.ReactNode }) {
  return (
    <span className="flex items-center gap-1 rounded-md bg-slate-50 px-1.5 py-0.5 font-semibold text-slate-600 ring-1 ring-slate-200">
      {Icon && <Icon className="h-3 w-3" />}{children}
    </span>
  )
}

// ── Get Bookings (requests) ──────────────────────────────────────────────────

function RequestsInbox({ data, onChanged }: { data: Overview; onChanged: () => void }) {
  const [busy, setBusy] = useState<string | null>(null)
  const [showHistory, setShowHistory] = useState(false)
  const pending = data.claims.filter(c => c.status === 'PENDING')
  const history = data.claims.filter(c => c.status !== 'PENDING').slice(0, 30)

  // Group requests by trip so competing drivers sit side by side.
  const byTrip = useMemo(() => {
    const m = new Map<string, ClaimView[]>()
    for (const c of pending) m.set(c.tripKey, [...(m.get(c.tripKey) ?? []), c])
    return Array.from(m.values()).sort((a, b) => a[0].tripDate.localeCompare(b[0].tripDate))
  }, [pending])

  const act = async (c: ClaimView, action: 'approve' | 'reject') => {
    let note: string | null = null
    if (action === 'reject') {
      note = window.prompt(`Decline ${c.partyName}'s request for ${c.bookingRef}? Optional note:`, '')
      if (note === null) return
    }
    setBusy(c.id)
    try {
      const { message } = await api<ClaimView>(`/api/driver-auto/claims/${c.id}`, { method: 'POST', body: JSON.stringify({ action, note }) })
      toast.success(message ?? 'Done')
      onChanged()
    } catch (e) {
      toast.error((e as Error).message)
      onChanged()
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white">
      <header className="flex items-center justify-between border-b border-slate-100 p-4">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-bold text-slate-900">
            <Inbox className="h-4 w-4 text-amber-500" /> Get Bookings
            <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-bold', pending.length ? 'bg-amber-400 text-amber-950' : 'bg-slate-100 text-slate-500')}>{pending.length}</span>
          </h2>
          <p className="text-[11px] text-slate-500">Driver requests waiting for approval</p>
        </div>
      </header>

      <div className="max-h-[560px] space-y-3 overflow-y-auto p-3">
        {byTrip.length === 0 && (
          <div className="py-8 text-center text-xs text-slate-400">
            {data.settings.countries[data.country].requireApproval
              ? 'No requests waiting. They appear here as drivers tap "Request".'
              : 'Approval is off — drivers are assigned directly. Their picks show in the history below.'}
          </div>
        )}
        {byTrip.map(group => {
          const head = group[0]
          const snap = head.snapshot
          return (
            <div key={head.tripKey} className={cn('rounded-xl border p-3', head.stillOpen === false ? 'border-slate-200 bg-slate-50' : 'border-amber-200 bg-amber-50/40')}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-xs font-bold text-slate-900">{head.bookingRef}
                    <span className="ml-1.5 font-semibold text-slate-500">{fmtTripDay(head.tripDate)}{head.tripEndDate && head.tripEndDate !== head.tripDate ? ` – ${fmtTripDay(head.tripEndDate)}` : ''}</span>
                  </div>
                  <div className="truncate text-[11px] text-slate-600">{snap?.kind === 'BOOKING' ? snap?.title : snap?.route}</div>
                </div>
                {group.length > 1 && <span className="shrink-0 rounded-full bg-slate-900 px-2 py-0.5 text-[9px] font-bold text-white">{group.length} competing</span>}
              </div>
              {head.stillOpen === false && (
                <div className="mt-2 rounded-md bg-slate-200/70 px-2 py-1 text-[10px] font-semibold text-slate-600">
                  No longer open — allocated elsewhere or the chart changed. Approving will close it out.
                </div>
              )}
              <div className="mt-2 space-y-2">
                {group.map(c => (
                  <div key={c.id} className="rounded-lg bg-white p-2.5 ring-1 ring-slate-200">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 text-xs font-bold text-slate-800">
                          <span className={cn('rounded px-1 py-px text-[9px] font-bold', c.partyType === 'DRIVER' ? 'bg-emerald-100 text-emerald-700' : 'bg-sky-100 text-sky-700')}>
                            {c.partyType === 'DRIVER' ? 'DRIVER' : 'VENDOR'}
                          </span>
                          <span className="truncate">{c.partyName}</span>
                        </div>
                        <div className="text-[10px] text-slate-400">requested {ago(c.createdAt)}{c.partyPhone ? ` · ${c.partyPhone}` : ''}</div>
                      </div>
                      <div className="flex shrink-0 gap-1">
                        <button disabled={busy === c.id} onClick={() => void act(c, 'reject')} title="Decline"
                                className="grid h-7 w-7 place-items-center rounded-lg border border-slate-200 text-slate-500 hover:border-rose-300 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50">
                          <X className="h-3.5 w-3.5" />
                        </button>
                        <button disabled={busy === c.id} onClick={() => void act(c, 'approve')}
                                className="flex h-7 items-center gap-1 rounded-lg bg-emerald-600 px-2.5 text-[11px] font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">
                          {busy === c.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Approve
                        </button>
                      </div>
                    </div>
                    <div className="mt-1.5 flex flex-wrap gap-1 text-[10px]">
                      {c.clashes && c.clashes.length > 0
                        ? <span className="rounded-md bg-rose-50 px-1.5 py-0.5 font-semibold text-rose-700 ring-1 ring-rose-200" title={c.clashes.join(', ')}>Busy: {c.clashes.slice(0, 2).join(', ')}{c.clashes.length > 2 ? '…' : ''}</span>
                        : <span className="rounded-md bg-emerald-50 px-1.5 py-0.5 font-semibold text-emerald-700 ring-1 ring-emerald-200">Free on these dates</span>}
                      {c.fits === false && <span className="rounded-md bg-rose-50 px-1.5 py-0.5 font-semibold text-rose-700 ring-1 ring-rose-200">Too few seats</span>}
                      {c.fits === true && <span className="rounded-md bg-emerald-50 px-1.5 py-0.5 font-semibold text-emerald-700 ring-1 ring-emerald-200">Seats OK</span>}
                      {typeof c.load === 'number' && <span className="rounded-md bg-slate-50 px-1.5 py-0.5 font-semibold text-slate-600 ring-1 ring-slate-200">{c.load} trip(s) in 30d</span>}
                    </div>
                    {c.driverNote && <div className="mt-1.5 rounded-md bg-slate-50 px-2 py-1 text-[11px] italic text-slate-600">“{c.driverNote}”</div>}
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>

      <div className="border-t border-slate-100">
        <button onClick={() => setShowHistory(v => !v)} className="flex w-full items-center justify-between px-4 py-2.5 text-[11px] font-semibold text-slate-500 hover:bg-slate-50">
          Recent decisions ({history.length})
          <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', showHistory && 'rotate-180')} />
        </button>
        {showHistory && (
          <ul className="max-h-72 divide-y divide-slate-100 overflow-y-auto">
            {history.map(c => {
              const m = CLAIM_STATUS_META[c.status]
              return (
                <li key={c.id} className="flex items-center justify-between gap-2 px-4 py-2 text-[11px]">
                  <div className="min-w-0">
                    <div className="truncate font-semibold text-slate-700">{c.bookingRef} · {c.partyName}</div>
                    <div className="truncate text-[10px] text-slate-400">
                      {fmtTripDay(c.tripDate)} · {c.decidedByName ?? '—'} · {ago(c.decidedAt ?? c.createdAt)}
                      {c.notifyResult ? ` · ${c.notifyResult}` : ''}
                    </div>
                  </div>
                  <span className={cn('shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-bold ring-1', TONE[m.tone])}>{m.label}</span>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </section>
  )
}

// ── Morning message ──────────────────────────────────────────────────────────

function MorningPanel({ data, country, onSettings, onSent }: {
  data: Overview; country: DaCountry
  onSettings: (patch: { countries: Partial<Record<DaCountry, Partial<DaSettings['countries'][DaCountry]>>> }) => Promise<void>
  onSent: () => void
}) {
  const cs = data.settings.countries[country]
  const [sending, setSending] = useState<'dry' | 'send' | null>(null)
  const [tpl, setTpl] = useState<{ approved: boolean | null; error?: string } | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    let alive = true
    api<{ approved: boolean | null; error?: string }>('/api/driver-auto/template')
      .then(r => { if (alive) setTpl(r.data) })
      .catch(() => { if (alive) setTpl({ approved: null }) })
    return () => { alive = false }
  }, [])

  const next = new Date(data.nextSendAt)
  const nextLocal = next.toLocaleString('en-GB', {
    timeZone: DA_COUNTRY_META[country].tz, weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  })
  const sentToday = data.todaySends.filter(s => s.status === 'sent').reduce((n, s) => n + s.n, 0)
  const failedToday = data.todaySends.filter(s => s.status === 'failed').reduce((n, s) => n + s.n, 0)

  const send = async (dryRun: boolean) => {
    if (!dryRun && !window.confirm(`Send the open-trips link now to ${data.stats.recipients} driver(s)/vendor(s) in ${DA_COUNTRY_META[country].label}? Anyone already messaged today is skipped.`)) return
    setSending(dryRun ? 'dry' : 'send')
    try {
      const { message } = await api('/api/driver-auto/send', { method: 'POST', body: JSON.stringify({ country, dryRun }) })
      toast.success(message ?? 'Done')
      if (!dryRun) onSent()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setSending(null)
    }
  }

  const submitTemplate = async () => {
    setSubmitting(true)
    try {
      const { message } = await api('/api/driver-auto/template', { method: 'POST' })
      toast.success(message ?? 'Submitted')
      setTpl({ approved: false })
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
      <header className="flex items-center justify-between border-b border-slate-100 p-4">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-bold text-slate-900"><BellRing className="h-4 w-4 text-emerald-600" /> Morning message</h2>
          <p className="text-[11px] text-slate-500">
            {cs.autoSend ? <>Next send <b className="text-slate-700">{nextLocal}</b> ({DA_COUNTRY_META[country].label} time)</> : 'Automatic send is off — use Send now, or switch it on.'}
          </p>
        </div>
        <Toggle on={cs.autoSend} onChange={v => void onSettings({ countries: { [country]: { autoSend: v } } })} />
      </header>

      <div className="space-y-3 p-4">
        {/* Phone mock */}
        <div className="rounded-2xl bg-[#e5ddd5] p-3">
          <div className="ml-auto max-w-[92%] rounded-xl rounded-tr-sm bg-white p-3 text-[12px] leading-relaxed text-slate-800 shadow-sm">
            {data.preview ? data.preview.split('\n').map((line, i) => (
              <p key={i} className={cn(line.startsWith('http') && 'break-all text-sky-600 underline', !line && 'h-2')}>{line}</p>
            )) : <span className="text-slate-400">No recipients registered for this country.</span>}
            <div className="mt-1.5 text-[10px] text-slate-400">AppleHolidays Operations</div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
          <span className={cn('flex items-center gap-1 rounded-md px-1.5 py-0.5 font-semibold ring-1',
            tpl?.approved ? TONE.emerald : tpl?.approved === false ? TONE.amber : TONE.slate)}>
            <MessageCircle className="h-3 w-3" /> {data.templateName}: {tpl == null ? 'checking…' : tpl.approved ? 'approved' : tpl.approved === false ? 'not approved yet' : 'unknown'}
          </span>
          {tpl?.approved === false && (
            <button onClick={() => void submitTemplate()} disabled={submitting} className="rounded-md bg-slate-900 px-1.5 py-0.5 font-semibold text-white hover:bg-emerald-600 disabled:opacity-50">
              {submitting ? 'Submitting…' : 'Submit to Meta'}
            </button>
          )}
          <span className="rounded-md bg-slate-50 px-1.5 py-0.5 font-semibold text-slate-600 ring-1 ring-slate-200">Today: {sentToday} sent{failedToday ? ` · ${failedToday} failed` : ''}</span>
        </div>

        <div className="grid grid-cols-2 gap-2 text-[11px]">
          <label className="flex items-center justify-between rounded-lg border border-slate-200 px-2.5 py-2 font-semibold text-slate-600">
            <span className="flex items-center gap-1.5"><Mail className="h-3.5 w-3.5" /> Also email</span>
            <Toggle size="sm" on={cs.emailEnabled} onChange={v => void onSettings({ countries: { [country]: { emailEnabled: v } } })} />
          </label>
          <label className="flex items-center justify-between rounded-lg border border-slate-200 px-2.5 py-2 font-semibold text-slate-600">
            <span className="flex items-center gap-1.5"><Users className="h-3.5 w-3.5" /> Vendors too</span>
            <Toggle size="sm" on={cs.includeVendors} onChange={v => void onSettings({ countries: { [country]: { includeVendors: v } } })} />
          </label>
        </div>

        <div className="flex gap-2">
          <Button size="sm" variant="secondary" className="flex-1" loading={sending === 'dry'} onClick={() => void send(true)}>Dry run</Button>
          <Button size="sm" className="flex-1 !bg-emerald-600 hover:!bg-emerald-700" loading={sending === 'send'} disabled={data.setupRequired}
                  onClick={() => void send(false)} icon={<Send className="h-3.5 w-3.5" />}>Send now</Button>
        </div>
        {(data.driversNoCountry > 0 || data.vendorsNoCountry > 0) && (
          <p className="rounded-lg bg-amber-50 px-2.5 py-2 text-[10px] text-amber-800">
            {data.driversNoCountry} driver(s) and {data.vendorsNoCountry} vendor(s) have no country set, so they get no link in any tab. Set their country on the Drivers / Vendors page.
          </p>
        )}
      </div>
    </section>
  )
}

// ── Drivers & links ──────────────────────────────────────────────────────────

function PartiesTable({ data, country, onChanged }: { data: Overview; country: DaCountry; onChanged: () => void }) {
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const list = useMemo(() => {
    const s = q.trim().toLowerCase()
    return data.parties.filter(p => !s || [p.name, p.phone, p.email, p.vehicle].filter(Boolean).join(' ').toLowerCase().includes(s))
  }, [data.parties, q])

  const linkAction = async (p: PartyView, action: 'rotate' | 'exclude' | 'include') => {
    if (action === 'rotate' && !window.confirm(`Issue a new link for ${p.name}? The link they have now stops working.`)) return
    setBusy(p.key)
    try {
      const { data: r, message } = await api<{ link: string }>('/api/driver-auto/links', { method: 'POST', body: JSON.stringify({ partyKey: p.key, action }) })
      if (action === 'rotate') { await navigator.clipboard?.writeText(r.link).catch(() => undefined); toast.success(`${message} — copied`) }
      else toast.success(message ?? 'Saved')
      onChanged()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  const sendOne = async (p: PartyView) => {
    setBusy(p.key)
    try {
      const { message } = await api('/api/driver-auto/send', { method: 'POST', body: JSON.stringify({ country, only: [p.key] }) })
      toast.success(message ?? 'Sent')
      onChanged()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 p-4">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-bold text-slate-900"><KeyRound className="h-4 w-4 text-emerald-600" /> Drivers &amp; personal links</h2>
          <p className="text-[11px] text-slate-500">Each link is signed for one driver/vendor. Reset it if a link is shared — the old one stops working at once.</p>
        </div>
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search driver / vendor…"
                 className="w-56 rounded-lg border border-slate-300 py-1.5 pl-8 pr-2 text-xs focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500" />
        </div>
      </header>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-500">
            <tr>
              <th className="px-4 py-2 font-semibold">Name</th>
              <th className="px-3 py-2 font-semibold">Vehicle</th>
              <th className="px-3 py-2 font-semibold">Reach</th>
              <th className="px-3 py-2 font-semibold">Last morning message</th>
              <th className="px-3 py-2 font-semibold">Gets message</th>
              <th className="px-4 py-2 text-right font-semibold">Link</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {list.map(p => (
              <tr key={p.key} className={cn('hover:bg-slate-50/60', p.excluded && 'opacity-60')}>
                <td className="px-4 py-2">
                  <div className="flex items-center gap-1.5 font-semibold text-slate-800">
                    <span className={cn('rounded px-1 py-px text-[9px] font-bold', p.type === 'DRIVER' ? 'bg-emerald-100 text-emerald-700' : 'bg-sky-100 text-sky-700')}>{p.type === 'DRIVER' ? 'D' : 'V'}</span>
                    {p.name}
                  </div>
                </td>
                <td className="px-3 py-2 text-slate-500">{p.vehicle ?? '—'}{p.capacity ? <span className="ml-1 text-slate-400">({p.capacity} seats)</span> : null}</td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-1.5">
                    <MessageCircle className={cn('h-3.5 w-3.5', p.phone ? 'text-emerald-600' : 'text-slate-300')} />
                    <Mail className={cn('h-3.5 w-3.5', p.email ? 'text-sky-600' : 'text-slate-300')} />
                  </div>
                </td>
                <td className="px-3 py-2 text-slate-500">
                  {p.lastSentAt ? <>{ago(p.lastSentAt)} <span className={cn('ml-1 rounded px-1 text-[9px] font-bold', p.lastSendStatus === 'sent' ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700')}>{p.lastSendStatus}</span></> : '—'}
                </td>
                <td className="px-3 py-2">
                  <Toggle size="sm" on={!p.excluded} disabled={busy === p.key} onChange={v => void linkAction(p, v ? 'include' : 'exclude')} />
                </td>
                <td className="px-4 py-2">
                  <div className="flex items-center justify-end gap-1">
                    <IconBtn title="Copy link" onClick={() => { void navigator.clipboard?.writeText(p.link ?? ''); toast.success('Link copied') }}><Copy className="h-3.5 w-3.5" /></IconBtn>
                    <IconBtn title="Open board as this driver" onClick={() => window.open(p.link, '_blank', 'noopener')}><ExternalLink className="h-3.5 w-3.5" /></IconBtn>
                    <IconBtn title="Send this driver today's link now" disabled={busy === p.key || data.setupRequired} onClick={() => void sendOne(p)}><Send className="h-3.5 w-3.5" /></IconBtn>
                    <IconBtn title="Reset link (old link stops working)" disabled={busy === p.key} onClick={() => void linkAction(p, 'rotate')}><Link2 className="h-3.5 w-3.5" /></IconBtn>
                  </div>
                </td>
              </tr>
            ))}
            {list.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-10 text-center text-slate-400">No active drivers or vendors registered for {DA_COUNTRY_META[country].label}.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function IconBtn({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button {...props} className="grid h-7 w-7 place-items-center rounded-lg border border-slate-200 text-slate-500 transition hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-700 disabled:opacity-40">
      {children}
    </button>
  )
}

// ── Modals ───────────────────────────────────────────────────────────────────

function Shell({ title, onClose, children, wide }: { title: React.ReactNode; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/50 p-0 backdrop-blur-sm sm:items-center sm:p-4" onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className={cn('max-h-[90vh] w-full overflow-hidden rounded-t-2xl bg-white shadow-2xl sm:rounded-2xl', wide ? 'max-w-2xl' : 'max-w-lg')}>
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3.5">
          <div className="text-sm font-bold text-slate-900">{title}</div>
          <button onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><X className="h-4 w-4" /></button>
        </div>
        <div className="max-h-[calc(90vh-56px)] overflow-y-auto">{children}</div>
      </div>
    </div>
  )
}

function AssignModal({ trip, parties, claims, onClose, onDone }: {
  trip: OpenTrip; parties: PartyView[]; claims: ClaimView[]; onClose: () => void; onDone: () => void
}) {
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const requested = new Set(claims.filter(c => c.status === 'PENDING' && c.tripKey === trip.key).map(c => c.partyKey))

  const ranked = useMemo(() => {
    const s = q.trim().toLowerCase()
    return parties
      .filter(p => !s || [p.name, p.vehicle, p.phone].filter(Boolean).join(' ').toLowerCase().includes(s))
      .map(p => ({ p, fits: p.capacity ? trip.pax <= p.capacity : null, asked: requested.has(p.key) }))
      // Asked first, then those whose vehicle fits, then drivers before vendors.
      .sort((a, b) => Number(b.asked) - Number(a.asked) || Number(b.fits === true) - Number(a.fits === true)
        || Number(a.p.type === 'VENDOR') - Number(b.p.type === 'VENDOR') || a.p.name.localeCompare(b.p.name))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parties, q, trip.pax])

  const assign = async (p: PartyView) => {
    if (!window.confirm(`Assign ${p.name} to ${trip.bookingRef} (${fmtTripDay(trip.startDate)})? They will be messaged on WhatsApp.`)) return
    setBusy(p.key)
    try {
      const { message } = await api('/api/driver-auto/assign', { method: 'POST', body: JSON.stringify({ tripKey: trip.key, partyKey: p.key }) })
      toast.success(message ?? 'Assigned')
      onDone()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  return (
    <Shell onClose={onClose} title={<span className="flex items-center gap-2"><UserPlus className="h-4 w-4 text-emerald-600" /> Assign {trip.bookingRef} <ArrowRight className="h-3.5 w-3.5 text-slate-400" /> <span className="font-semibold text-slate-500">{fmtTripDay(trip.startDate)}{trip.days > 1 ? ` · ${trip.days} days` : ''}</span></span>}>
      <div className="space-y-3 p-5">
        <div className="rounded-xl bg-slate-50 p-3 text-xs text-slate-600">
          <div className="font-semibold text-slate-800">{trip.title}</div>
          <div>{trip.route} · {trip.pax} guest(s)</div>
        </div>
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Find a driver or vendor…"
                 className="w-full rounded-lg border border-slate-300 py-2 pl-8 pr-2 text-sm focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500" />
        </div>
        <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
          {ranked.map(({ p, fits, asked }) => (
            <li key={p.key} className="flex items-center justify-between gap-2 px-3 py-2">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 text-sm font-semibold text-slate-800">
                  <span className={cn('rounded px-1 py-px text-[9px] font-bold', p.type === 'DRIVER' ? 'bg-emerald-100 text-emerald-700' : 'bg-sky-100 text-sky-700')}>{p.type === 'DRIVER' ? 'D' : 'V'}</span>
                  <span className="truncate">{p.name}</span>
                  {asked && <span className="rounded bg-amber-400 px-1 text-[9px] font-bold text-amber-950">REQUESTED</span>}
                </div>
                <div className="flex items-center gap-2 text-[11px] text-slate-500">
                  {p.vehicle ?? 'No vehicle on file'}
                  {fits === false && <span className="font-semibold text-rose-600">· too few seats</span>}
                  {fits === true && <span className="font-semibold text-emerald-600">· seats OK</span>}
                  {!p.phone && <span className="font-semibold text-amber-600">· no WhatsApp</span>}
                </div>
              </div>
              <Button size="sm" loading={busy === p.key} disabled={!!busy} onClick={() => void assign(p)} className="!bg-slate-900 hover:!bg-emerald-600">Assign</Button>
            </li>
          ))}
          {ranked.length === 0 && <li className="px-3 py-8 text-center text-xs text-slate-400">No match.</li>}
        </ul>
        <p className="text-[10px] text-slate-400">The trip is re-checked before saving — if someone filled it in the meantime, nothing is overwritten.</p>
      </div>
    </Shell>
  )
}

function SettingsModal({ settings, onClose, onSave }: { settings: DaSettings; onClose: () => void; onSave: (s: Partial<DaSettings>) => Promise<void> }) {
  const [horizonDays, setHorizonDays] = useState(settings.horizonDays)
  const [sendHour, setSendHour] = useState(settings.sendHour)
  const [maxPending, setMaxPending] = useState(settings.maxPendingPerParty)
  const [saving, setSaving] = useState(false)

  return (
    <Shell onClose={onClose} title={<span className="flex items-center gap-2"><Settings2 className="h-4 w-4 text-emerald-600" /> Driver-Auto settings</span>}>
      <div className="space-y-4 p-5 text-sm">
        <Field label="Window (days ahead)" hint="Trips starting from today up to this many days ahead are offered. D-10 is the standard.">
          <select value={horizonDays} onChange={e => setHorizonDays(Number(e.target.value))} className="w-full rounded-lg border border-slate-300 px-3 py-2">
            {HORIZON_CHOICES.map(h => <option key={h} value={h}>D-{h}</option>)}
          </select>
        </Field>
        <Field label="Morning send time" hint="Local time in each country — Colombo, Hanoi, Singapore, Kuala Lumpur.">
          <select value={sendHour} onChange={e => setSendHour(Number(e.target.value))} className="w-full rounded-lg border border-slate-300 px-3 py-2">
            {Array.from({ length: 12 }, (_, i) => i + 5).map(h => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}
          </select>
        </Field>
        <Field label="Max open requests per driver" hint="Stops one driver holding every trip on the board.">
          <input type="number" min={1} max={100} value={maxPending} onChange={e => setMaxPending(Number(e.target.value))} className="w-full rounded-lg border border-slate-300 px-3 py-2" />
        </Field>
        <div className="rounded-xl bg-slate-50 p-3 text-[11px] text-slate-500">
          Approval, auto-send, email and vendor switches are per country, on each tab. Defaults are the safe ones: approval on, auto-send off.
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" loading={saving} className="!bg-emerald-600 hover:!bg-emerald-700"
                  onClick={async () => { setSaving(true); await onSave({ horizonDays, sendHour, maxPendingPerParty: maxPending }); setSaving(false) }}>Save</Button>
        </div>
      </div>
    </Shell>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold text-slate-700">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-slate-400">{hint}</span>}
    </label>
  )
}

