'use client'

/**
 * Driver App — the operations side of the Aahaas Driver App (iOS / Android).
 *
 *  • Live         drivers on the road now (map, km today, last GPS ping),
 *                 drivers with a movement today who have not swiped "Start day",
 *                 and days already finished
 *  • Requests     driver change (hand-over), help calls, profile / bank
 *                 changes, feedback waivers — approve or decline
 *  • Vehicle photos  the 2-monthly renewal with the AI first look; approving
 *                 copies the front / inside photos onto the vehicle record
 *  • App drivers  who has activated the app and when they were last seen
 *
 * Reads/writes go through /api/driver-app/* (lib/mobile/ops.ts).
 */

import dynamic from 'next/dynamic'
import { useSession } from 'next-auth/react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import {
  AlertTriangle, Camera, Check, Clock, Gauge, Inbox, Loader2, MapPin, Phone, RefreshCw, Smartphone,
  Sparkles, Users, X,
} from 'lucide-react'
import Button from '@/components/ui/button'
import { cn } from '@/lib/utils'

const DriversMap = dynamic(() => import('@/components/driver-app/drivers-map'), { ssr: false })

type Tab = 'live' | 'requests' | 'vehicle' | 'accounts'

interface LiveRow {
  dayId: string; driverId: string; driverName: string; driverPhone: string | null; vehicle: string | null
  bookingRef: string; dayDate: string; status: string; startedAt: string; endedAt: string | null
  km: number; tripKm: number; lastLat: number | null; lastLng: number | null; lastSpeedKmh: number | null
  lastPingAt: string | null; silent: boolean; stale: boolean
}
interface Live {
  today: string
  driving: LiveRow[]
  finishedToday: LiveRow[]
  notStarted: { driverId: string; driverName: string; driverPhone: string | null; bookingRef: string; firstTime: string | null; usesApp: boolean }[]
  totals: { driving: number; kmToday: number; pendingRequests: number; pendingChecks: number; appDrivers: number }
}
interface RequestRow {
  id: string; kind: string; driverName: string | null; driverPhone: string | null; bookingRef: string | null
  reason: string | null; status: string; createdAt: string; payload: Record<string, unknown> | null
  decidedByName: string | null; decisionNote: string | null
  current: Record<string, string | null> | null
}
interface CheckRow {
  id: string; driverName: string; status: string; createdAt: string; odometer: number | null
  photos: Record<string, string>; vehicle: { plateNo: string; type: string } | null
  aiReview: { verdict: string; summary: string; issues: string[]; plateSeen: string | null; plateMatches: boolean | null; cleanliness: string | null } | null
  reviewNote: string | null; reviewedByName: string | null
}
interface AccountRow {
  driverId: string; name: string; phone: string | null; country: string | null; activated: boolean
  language: string; platform: string | null; appVersion: string | null; lastLoginAt: string | null; lastSeenAt: string | null
}

const KIND_LABEL: Record<string, { label: string; tone: string }> = {
  HELP: { label: 'Help call', tone: 'bg-red-100 text-red-700' },
  HANDOVER: { label: 'Driver change', tone: 'bg-amber-100 text-amber-800' },
  PROFILE_CHANGE: { label: 'Profile change', tone: 'bg-sky-100 text-sky-700' },
  FEEDBACK_WAIVER: { label: 'Feedback waiver', tone: 'bg-violet-100 text-violet-700' },
}

function ago(iso: string | null): string {
  if (!iso) return '—'
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60_000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  return h < 48 ? `${h} h ago` : `${Math.round(h / 24)} d ago`
}

function hm(iso: string | null) {
  return iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) } })
  const j = await res.json().catch(() => null)
  if (!res.ok || !j?.success) throw new Error(j?.error || `Request failed (${res.status})`)
  return j.data as T
}

export default function DriverAppPage() {
  const { data: session } = useSession()
  const isAdmin = ['SUPER_ADMIN', 'ULTRA_SUPER_ADMIN'].includes(session?.user?.role ?? '')
  const [tab, setTab] = useState<Tab>('live')
  const [live, setLive] = useState<Live | null>(null)
  const [requests, setRequests] = useState<RequestRow[]>([])
  const [checks, setChecks] = useState<CheckRow[]>([])
  const [accounts, setAccounts] = useState<AccountRow[]>([])
  const [showAll, setShowAll] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [track, setTrack] = useState<{ lat: number; lng: number }[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      const [l, r, a] = await Promise.all([
        api<Live>('/api/driver-app/live'),
        api<{ requests: RequestRow[]; vehicleChecks: CheckRow[] }>(`/api/driver-app/requests?status=${showAll ? 'ALL' : 'PENDING'}`),
        api<{ accounts: AccountRow[] }>('/api/driver-app/accounts'),
      ])
      setLive(l); setRequests(r.requests); setChecks(r.vehicleChecks); setAccounts(a.accounts)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [showAll])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === 'visible') load() }, 30_000)
    return () => clearInterval(t)
  }, [load])

  useEffect(() => {
    if (!selected) { setTrack(null); return }
    api<{ points: { lat: number; lng: number }[] }>(`/api/driver-app/track/${selected}`)
      .then(r => setTrack(r.points)).catch(() => setTrack(null))
  }, [selected])

  const mapDrivers = useMemo(() => (live?.driving ?? [])
    .filter(d => d.lastLat != null && d.lastLng != null)
    .map(d => ({
      dayId: d.dayId, name: d.driverName, lat: d.lastLat!, lng: d.lastLng!, silent: d.silent,
      label: `${d.driverName} · ${d.bookingRef} · ${d.km} km today · ${ago(d.lastPingAt)}`,
    })), [live])

  async function decide(kind: 'requests' | 'vehicle-checks', id: string, decision: 'APPROVED' | 'REJECTED') {
    let note: string | null = null
    if (decision === 'REJECTED' || kind === 'requests') {
      note = window.prompt(decision === 'REJECTED' ? 'Reason (sent to the driver):' : 'Note to the driver (optional):') ?? null
      if (decision === 'REJECTED' && !note?.trim()) return
    }
    setBusy(id)
    try {
      await api(`/api/driver-app/${kind}/${id}`, { method: 'PATCH', body: JSON.stringify({ decision, note }) })
      toast.success(decision === 'APPROVED' ? 'Approved — the driver has been notified' : 'Declined — the driver has been notified')
      load()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  const tabs: { id: Tab; label: string; icon: React.ReactNode; count?: number }[] = [
    { id: 'live', label: 'Live', icon: <MapPin className="h-4 w-4" />, count: live?.totals.driving },
    { id: 'requests', label: 'Requests', icon: <Inbox className="h-4 w-4" />, count: live?.totals.pendingRequests },
    { id: 'vehicle', label: 'Vehicle photos', icon: <Camera className="h-4 w-4" />, count: live?.totals.pendingChecks },
    { id: 'accounts', label: 'App drivers', icon: <Users className="h-4 w-4" />, count: live?.totals.appDrivers },
  ]

  return (
    <div className="p-6 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900 flex items-center gap-2"><Smartphone className="h-5 w-5 text-brand-500" /> Driver App</h1>
          <p className="text-sm text-slate-500">Drivers on the road, their km, help calls and requests from the Aahaas Driver App.</p>
        </div>
        <div className="flex gap-2">
          {isAdmin && (
            <Button variant="secondary" size="sm" icon={<Sparkles className="h-4 w-4" />} onClick={async () => {
              if (!window.confirm('Submit the WhatsApp sign-in code template (aahaas_driver_app_code) to Meta for approval?')) return
              try {
                const r = await api<{ status: string }>('/api/driver-app/templates', { method: 'POST' })
                toast.success(`Template submitted — status ${r.status}`)
              } catch (e) { toast.error((e as Error).message) }
            }}>WhatsApp code template</Button>
          )}
          <Button variant="secondary" size="sm" onClick={load} icon={<RefreshCw className="h-4 w-4" />}>Refresh</Button>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 flex gap-2">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" /> {error}
        </div>
      )}

      {live && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <Stat label="Driving now" value={live.totals.driving} icon={<MapPin className="h-4 w-4" />} />
          <Stat label="Km today" value={live.totals.kmToday} icon={<Gauge className="h-4 w-4" />} />
          <Stat label="Not started yet" value={live.notStarted.length} icon={<Clock className="h-4 w-4" />} warn={live.notStarted.length > 0} />
          <Stat label="Requests waiting" value={live.totals.pendingRequests} icon={<Inbox className="h-4 w-4" />} warn={live.totals.pendingRequests > 0} />
          <Stat label="Drivers on the app" value={live.totals.appDrivers} icon={<Smartphone className="h-4 w-4" />} />
        </div>
      )}

      <div className="flex gap-1 border-b border-slate-200">
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={cn('flex items-center gap-2 px-4 py-2 text-sm border-b-2 -mb-px',
              tab === t.id ? 'border-brand-500 text-brand-600 font-medium' : 'border-transparent text-slate-500 hover:text-slate-700')}>
            {t.icon}{t.label}
            {!!t.count && <span className="rounded-full bg-slate-100 px-2 text-xs text-slate-600">{t.count}</span>}
          </button>
        ))}
        {(tab === 'requests' || tab === 'vehicle') && (
          <label className="ml-auto flex items-center gap-2 text-xs text-slate-500 pr-2">
            <input type="checkbox" checked={showAll} onChange={e => setShowAll(e.target.checked)} /> Show answered
          </label>
        )}
      </div>

      {loading && <div className="flex items-center gap-2 text-slate-500 text-sm"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>}

      {!loading && tab === 'live' && live && (
        <div className="grid lg:grid-cols-5 gap-5">
          <div className="lg:col-span-3 space-y-3">
            <DriversMap drivers={mapDrivers} track={track} selected={selected} onSelect={setSelected} />
            <p className="text-xs text-slate-400">Green = GPS live · Amber = no GPS for 20+ min. Click a driver to draw today&apos;s route.</p>
          </div>
          <div className="lg:col-span-2 space-y-4">
            <Section title={`On the road (${live.driving.length})`}>
              {live.driving.length === 0 && <Empty text="Nobody is driving right now." />}
              {live.driving.map(d => (
                <button key={d.dayId} onClick={() => setSelected(d.dayId === selected ? null : d.dayId)}
                  className={cn('w-full text-left rounded-lg border p-3 hover:bg-slate-50', d.dayId === selected ? 'border-brand-400 bg-brand-50/40' : 'border-slate-200')}>
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-slate-800">{d.driverName}</span>
                    <span className={cn('text-xs rounded-full px-2 py-0.5', d.silent ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-700')}>
                      {d.silent ? `No GPS · ${ago(d.lastPingAt)}` : d.lastSpeedKmh != null ? `${d.lastSpeedKmh} km/h` : 'Live'}
                    </span>
                  </div>
                  <div className="text-xs text-slate-500 mt-1">{d.bookingRef} · {d.vehicle ?? '—'} · started {hm(d.startedAt)}</div>
                  <div className="text-xs text-slate-700 mt-1"><b>{d.km}</b> km today · <b>{d.tripKm}</b> km this trip{d.stale && <span className="text-red-600"> · day left open since {d.dayDate}</span>}</div>
                  {d.driverPhone && <a href={`tel:${d.driverPhone}`} onClick={e => e.stopPropagation()} className="text-xs text-brand-600 inline-flex items-center gap-1 mt-1"><Phone className="h-3 w-3" />{d.driverPhone}</a>}
                </button>
              ))}
            </Section>
            <Section title={`Not started today (${live.notStarted.length})`}>
              {live.notStarted.length === 0 && <Empty text="Every driver with a movement today has started." />}
              {live.notStarted.map(n => (
                <div key={n.driverId} className="rounded-lg border border-slate-200 p-3 text-sm flex items-center justify-between">
                  <div>
                    <div className="font-medium text-slate-800">{n.driverName}</div>
                    <div className="text-xs text-slate-500">{n.bookingRef} · first pickup {n.firstTime ?? '—'} · {n.usesApp ? 'has the app' : <span className="text-amber-700">not on the app</span>}</div>
                  </div>
                  {n.driverPhone && <a href={`tel:${n.driverPhone}`} className="text-brand-600"><Phone className="h-4 w-4" /></a>}
                </div>
              ))}
            </Section>
            <Section title={`Finished today (${live.finishedToday.length})`}>
              {live.finishedToday.length === 0 && <Empty text="No finished days yet." />}
              {live.finishedToday.map(d => (
                <button key={d.dayId} onClick={() => setSelected(d.dayId)} className="w-full text-left rounded-lg border border-slate-200 p-3 text-sm hover:bg-slate-50">
                  <span className="font-medium">{d.driverName}</span> · {d.bookingRef} · <b>{d.km}</b> km · {hm(d.startedAt)}–{hm(d.endedAt)}
                </button>
              ))}
            </Section>
          </div>
        </div>
      )}

      {!loading && tab === 'requests' && (
        <div className="space-y-3">
          {requests.length === 0 && <Empty text="No requests waiting." />}
          {requests.map(r => {
            const meta = KIND_LABEL[r.kind] ?? { label: r.kind, tone: 'bg-slate-100 text-slate-700' }
            const payload = (r.payload ?? {}) as Record<string, unknown>
            return (
              <div key={r.id} className={cn('rounded-xl border p-4 bg-white', r.kind === 'HELP' && r.status === 'PENDING' ? 'border-red-300' : 'border-slate-200')}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className={cn('text-xs rounded-full px-2 py-0.5 font-medium', meta.tone)}>{meta.label}</span>
                  <span className="font-medium text-slate-800">{r.driverName}</span>
                  {r.bookingRef && <span className="text-xs text-slate-500">· {r.bookingRef}</span>}
                  <span className="text-xs text-slate-400 ml-auto">{ago(r.createdAt)}</span>
                </div>
                {r.reason && <p className="text-sm text-slate-700 mt-2">“{r.reason}”</p>}
                {r.kind === 'HELP' && (
                  <div className="text-xs text-slate-600 mt-2 flex gap-3">
                    {typeof payload.topic === 'string' && <span>Topic: <b>{payload.topic.toLowerCase()}</b></span>}
                    {typeof payload.map === 'string' && <a className="text-brand-600 inline-flex items-center gap-1" href={payload.map} target="_blank" rel="noreferrer"><MapPin className="h-3 w-3" />Open location</a>}
                    {r.driverPhone && <a className="text-brand-600 inline-flex items-center gap-1" href={`tel:${r.driverPhone}`}><Phone className="h-3 w-3" />{r.driverPhone}</a>}
                  </div>
                )}
                {r.kind === 'PROFILE_CHANGE' && (
                  <table className="text-xs mt-2">
                    <tbody>
                      {Object.entries(payload).map(([k, v]) => (
                        <tr key={k}>
                          <td className="pr-4 text-slate-500">{k}</td>
                          <td className="pr-4 text-slate-400 line-through">{r.current?.[k] ?? '—'}</td>
                          <td className="font-medium text-slate-800">{k === 'photoUrl' ? <a className="text-brand-600" href={String(v)} target="_blank" rel="noreferrer">new photo</a> : String(v)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                {r.kind === 'HANDOVER' && r.status === 'PENDING' && (
                  <p className="text-xs text-amber-700 mt-2">Pick the new driver in SL Driver Allocation / the movement chart as usual, then approve here to close this driver&apos;s trip in the app.</p>
                )}
                {r.status === 'PENDING' ? (
                  <div className="flex gap-2 mt-3">
                    <Button size="sm" loading={busy === r.id} onClick={() => decide('requests', r.id, 'APPROVED')} icon={<Check className="h-4 w-4" />}>
                      {r.kind === 'HELP' ? 'Handled' : 'Approve'}
                    </Button>
                    {r.kind !== 'HELP' && <Button size="sm" variant="secondary" disabled={busy === r.id} onClick={() => decide('requests', r.id, 'REJECTED')} icon={<X className="h-4 w-4" />}>Decline</Button>}
                  </div>
                ) : (
                  <p className="text-xs text-slate-500 mt-2">{r.status.toLowerCase()} by {r.decidedByName}{r.decisionNote ? ` — ${r.decisionNote}` : ''}</p>
                )}
              </div>
            )
          })}
        </div>
      )}

      {!loading && tab === 'vehicle' && (
        <div className="space-y-3">
          {checks.length === 0 && <Empty text="No vehicle photos waiting for review." />}
          {checks.map(c => (
            <div key={c.id} className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-slate-800">{c.driverName}</span>
                <span className="text-xs text-slate-500">{c.vehicle ? `${c.vehicle.type} · ${c.vehicle.plateNo}` : 'no vehicle linked'}{c.odometer ? ` · odometer ${c.odometer.toLocaleString()} km` : ''}</span>
                <span className="text-xs text-slate-400 ml-auto">{ago(c.createdAt)}</span>
              </div>
              <div className="flex gap-2 mt-3 overflow-x-auto">
                {Object.entries(c.photos).map(([slot, url]) => (
                  <a key={slot} href={url} target="_blank" rel="noreferrer" className="shrink-0 text-center">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={url} alt={slot} className="h-24 w-32 object-cover rounded-lg border border-slate-200" />
                    <span className="text-[10px] uppercase tracking-wide text-slate-400">{slot}</span>
                  </a>
                ))}
              </div>
              {c.aiReview && (
                <div className={cn('mt-3 rounded-lg p-3 text-xs',
                  c.aiReview.verdict === 'LOOKS_GOOD' ? 'bg-emerald-50 text-emerald-800' : c.aiReview.verdict === 'RETAKE' ? 'bg-red-50 text-red-800' : 'bg-amber-50 text-amber-800')}>
                  <div className="font-medium flex items-center gap-1"><Sparkles className="h-3 w-3" /> AI first look: {c.aiReview.verdict.replace('_', ' ').toLowerCase()}</div>
                  <div className="mt-1">{c.aiReview.summary}</div>
                  {c.aiReview.issues.length > 0 && <ul className="list-disc ml-4 mt-1">{c.aiReview.issues.map((i, n) => <li key={n}>{i}</li>)}</ul>}
                  {c.aiReview.plateSeen && <div className="mt-1">Plate seen: {c.aiReview.plateSeen} {c.aiReview.plateMatches === false && <b>— does not match the record</b>}</div>}
                </div>
              )}
              {c.status === 'SUBMITTED' ? (
                <div className="flex gap-2 mt-3">
                  <Button size="sm" loading={busy === c.id} onClick={() => decide('vehicle-checks', c.id, 'APPROVED')} icon={<Check className="h-4 w-4" />}>Approve</Button>
                  <Button size="sm" variant="secondary" disabled={busy === c.id} onClick={() => decide('vehicle-checks', c.id, 'REJECTED')} icon={<X className="h-4 w-4" />}>Ask to retake</Button>
                </div>
              ) : (
                <p className="text-xs text-slate-500 mt-2">{c.status.toLowerCase()} by {c.reviewedByName}{c.reviewNote ? ` — ${c.reviewNote}` : ''}</p>
              )}
            </div>
          ))}
        </div>
      )}

      {!loading && tab === 'accounts' && (
        <div className="rounded-xl border border-slate-200 bg-white overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500">
              <tr><th className="text-left p-3">Driver</th><th className="text-left p-3">Phone</th><th className="text-left p-3">Status</th><th className="text-left p-3">Language</th><th className="text-left p-3">Device</th><th className="text-left p-3">Last seen</th></tr>
            </thead>
            <tbody>
              {accounts.length === 0 && <tr><td colSpan={6}><Empty text="No driver has opened the app yet." /></td></tr>}
              {accounts.map(a => (
                <tr key={a.driverId} className="border-t border-slate-100">
                  <td className="p-3 font-medium text-slate-800">{a.name}</td>
                  <td className="p-3 text-slate-600">{a.phone ?? '—'}</td>
                  <td className="p-3">{a.activated ? <span className="text-emerald-700">Active</span> : <span className="text-amber-700">Verified, no password</span>}</td>
                  <td className="p-3 uppercase text-slate-500">{a.language}</td>
                  <td className="p-3 text-slate-500">{[a.platform, a.appVersion].filter(Boolean).join(' · ') || '—'}</td>
                  <td className="p-3 text-slate-500">{ago(a.lastSeenAt ?? a.lastLoginAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function Stat({ label, value, icon, warn }: { label: string; value: number; icon: React.ReactNode; warn?: boolean }) {
  return (
    <div className={cn('rounded-xl border p-4 bg-white', warn ? 'border-amber-300' : 'border-slate-200')}>
      <div className="flex items-center gap-2 text-xs text-slate-500">{icon}{label}</div>
      <div className={cn('text-2xl font-semibold mt-1', warn ? 'text-amber-700' : 'text-slate-900')}>{value.toLocaleString()}</div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</h3>
      {children}
    </div>
  )
}

function Empty({ text }: { text: string }) {
  return <p className="text-sm text-slate-400 p-3">{text}</p>
}
