'use client'

/**
 * Command Center — the second office wall screen (/view2).
 *
 * Everything /view shows, plus where the operation physically is (map), how the
 * floor is moving today (ops flow, pipeline, team processing, hourly activity),
 * yesterday-vs-today, an OpenAI booking forecast and the latest guest feedback.
 *
 * Two views that rotate on their own like a TV board:
 *   01 Live Ops            — KPIs, country spotlight, live map, activity, feedback
 *   02 Insights & Forecast — comparisons, AI forecast, pipeline, team, guest voice
 * `?view=1` or `?view=2` pins one; keys 1 / 2 switch, space pauses.
 *
 * Public and read-only, like /view: no login, the link never expires.
 */

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { useSearchParams } from 'next/navigation'
import {
  Plane, Users, TrendingUp, CalendarClock, Sparkles, Car, Volume2, VolumeX, Maximize, Pause, Play, Globe2, Radar, MapPinned,
} from 'lucide-react'
import { CC_CSS, COUNTRY_ORDER } from '@/components/view2/theme'
import {
  Kpi, Delta, Spotlight, Skyline, ActivityFeed, FeedbackSpotlight, OpsFlow, Pipeline, Leaderboard, Ticker, Counter,
} from '@/components/view2/panels'
import { CompareChart, ForecastPanel, AheadStrip, HourlyFlow, FeedbackWall } from '@/components/view2/charts'
import { TakeoverLayer, chime, siren, type Takeover } from '@/components/view2/takeover'
import type { FHEvent, ForecastData, TEAlert, ViewData, View2Data } from '@/components/view2/types'

const OpsMap = dynamic(() => import('@/components/view2/ops-map'), { ssr: false })

const POLL = { view: 60_000, view2: 60_000, forecast: 30 * 60_000, alerts: 30_000, fh: 20_000 }
const VIEWS = [
  { id: 1, label: 'Live Ops', ms: 75_000 },
  { id: 2, label: 'Insights & Forecast', ms: 55_000 },
] as const
const SPOTLIGHT_MS = 6_000
const TZ = 'Asia/Colombo'

async function getJson<T>(url: string): Promise<T | null> {
  try {
    const r = await fetch(url, { cache: 'no-store' })
    if (!r.ok) return null
    return (await r.json()) as T
  } catch { return null }
}

/** Poll a URL forever; keeps the last good value through network blips. */
function usePoll<T>(url: string, ms: number, pick: (j: any) => T | null | undefined, onData?: (d: T) => void) {
  const [data, setData] = useState<T | null>(null)
  const cb = useRef(onData); cb.current = onData
  const pk = useRef(pick); pk.current = pick
  useEffect(() => {
    let alive = true
    const run = async () => {
      const j = await getJson<any>(url)
      const d = j ? pk.current(j) : null
      if (alive && d) { setData(d); cb.current?.(d) }
    }
    run()
    const id = setInterval(run, ms)
    return () => { alive = false; clearInterval(id) }
  }, [url, ms])
  return data
}

function colomboClock(d: Date) {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).formatToParts(d)
  const g = (t: string) => p.find(x => x.type === t)?.value ?? '00'
  return { hour: Number(g('hour')) % 24, text: `${g('hour')}:${g('minute')}:${g('second')}` }
}

function CommandCenter() {
  const params = useSearchParams()
  const pinned = Number(params.get('view')) as 1 | 2 | 0
  const [view, setView] = useState<1 | 2>(pinned === 2 ? 2 : 1)
  const [paused, setPaused] = useState(!!pinned)
  const [soundOn, setSoundOn] = useState(true)
  const soundRef = useRef(true); soundRef.current = soundOn
  // null until mounted: a server-rendered clock never matches the browser's.
  const [now, setNow] = useState<Date | null>(null)
  const [spot, setSpot] = useState(0)

  // ── Takeovers ────────────────────────────────────────────────────────────
  const [takeover, setTakeover] = useState<Takeover | null>(null)
  // The queue and "what is showing" live in refs so pump() stays outside a
  // state updater — updaters must be pure (StrictMode calls them twice).
  const queue = useRef<Takeover[]>([])
  const showing = useRef<Takeover | null>(null)
  const pump = useCallback(() => {
    if (showing.current) return
    const next = queue.current.shift()
    if (!next) return
    showing.current = next
    setTakeover(next)
    if (soundRef.current) {
      const loud = next.kind === 'alert' || (next.kind === 'fh' && next.event.action === 'CANCEL_REQUESTED')
      loud ? siren() : chime()
    }
  }, [])
  const enqueue = useCallback((items: Takeover[]) => { if (!items.length) return; queue.current.push(...items); pump() }, [pump])
  const done = useCallback(() => { showing.current = null; setTakeover(null); setTimeout(pump, 500) }, [pump])

  // A freshly opened screen must not replay the backlog: the first load of each
  // feed only seeds the "seen" set.
  const seenB = useRef<Set<string> | null>(null)
  const seenA = useRef<Set<number> | null>(null)
  const seenF = useRef<Set<string> | null>(null)

  const viewData = usePoll<ViewData>('/api/public/view-dashboard', POLL.view, j => j?.data, d => {
    if (!seenB.current) { seenB.current = new Set(d.recentBookings.map(b => b.id)); return }
    const fresh = d.recentBookings.filter(b => !seenB.current!.has(b.id)).reverse()
    fresh.forEach(b => seenB.current!.add(b.id))
    enqueue(fresh.map(booking => ({ kind: 'booking', booking })))
  })
  const v2 = usePoll<View2Data>('/api/public/view2', POLL.view2, j => j?.data)
  const forecast = usePoll<ForecastData>('/api/public/view2/forecast', POLL.forecast, j => (j?.success ? j.data : null))
  const alerts = usePoll<TEAlert[]>('/api/public/te-alerts', POLL.alerts, j => {
    const rows: TEAlert[] = j?.alerts ?? []
    const rank = (a: TEAlert) => (a.severity === 'high' ? 3 : a.severity === 'medium' ? 2 : 1)
    return rows.sort((a, b) => rank(b) - rank(a))
  }, rows => {
    if (!seenA.current) { seenA.current = new Set(rows.map(a => a.id)); return }
    const fresh = rows.filter(a => !seenA.current!.has(a.id))
    fresh.forEach(a => seenA.current!.add(a.id))
    enqueue(fresh.map(alert => ({ kind: 'alert', alert })))
  }) ?? []
  usePoll<FHEvent[]>('/api/public/filehandler-events', POLL.fh, j => j?.data?.events ?? [], rows => {
    if (!seenF.current) { seenF.current = new Set(rows.map(e => e.id)); return }
    const fresh = rows.filter(e => !seenF.current!.has(e.id)).reverse()
    fresh.forEach(e => seenF.current!.add(e.id))
    enqueue(fresh.map(event => ({ kind: 'fh', event })))
  })

  // ── Clocks & rotation ────────────────────────────────────────────────────
  useEffect(() => { setNow(new Date()); const id = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(id) }, [])
  useEffect(() => { const id = setInterval(() => setSpot(s => s + 1), SPOTLIGHT_MS); return () => clearInterval(id) }, [])

  const viewMs = VIEWS[view - 1].ms
  const [cycle, setCycle] = useState(0)
  useEffect(() => {
    if (paused) return
    const id = setTimeout(() => { setView(v => (v === 1 ? 2 : 1)); setCycle(c => c + 1) }, viewMs)
    return () => clearTimeout(id)
  }, [view, paused, viewMs, cycle])

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === '1') { setView(1); setCycle(c => c + 1) }
      if (e.key === '2') { setView(2); setCycle(c => c + 1) }
      if (e.key === ' ') setPaused(p => !p)
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [])

  const countries = useMemo(() => {
    const act = COUNTRY_ORDER.filter(c => (viewData?.byCountry.ongoing[c] ?? 0) + (viewData?.byCountry.upcoming[c] ?? 0) + (viewData?.byCountry.lifetime[c] ?? 0) > 0)
    return act.length ? act : ['VIETNAM']
  }, [viewData])
  const spotCountry = countries[spot % countries.length]

  const clock = now ? colomboClock(now) : { hour: 0, text: '--:--:--' }
  const cmp = useMemo(() => Object.fromEntries((v2?.compare ?? []).map(c => [c.key, c])), [v2])
  const nowMs = now?.getTime() ?? 0

  const fullscreen = () => { document.documentElement.requestFullscreen?.().catch(() => {}) }

  return (
    <div className="cc-root fixed inset-0 overflow-hidden">
      <style dangerouslySetInnerHTML={{ __html: CC_CSS }} />

      {/* ── Backdrop: AI-generated globe, slow drift, and a grid ── */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute inset-0 bg-cover bg-right" style={{ backgroundImage: 'url(/view2/backdrop.jpg)', opacity: .55, animation: 'ccKen 40s ease-in-out infinite alternate' }} />
        <div className="absolute inset-0" style={{ background: 'linear-gradient(90deg,rgba(6,10,22,.92),rgba(6,10,22,.55) 60%,rgba(6,10,22,.75))' }} />
        <div className="absolute inset-0" style={{ backgroundImage: 'linear-gradient(var(--grid) 1px,transparent 1px),linear-gradient(90deg,var(--grid) 1px,transparent 1px)', backgroundSize: '64px 64px', maskImage: 'radial-gradient(ellipse at center,#000 30%,transparent 80%)', WebkitMaskImage: 'radial-gradient(ellipse at center,#000 30%,transparent 80%)' }} />
        <div className="absolute -top-40 left-1/4 w-[50rem] h-[30rem] rounded-full" style={{ background: 'radial-gradient(closest-side,rgba(34,211,238,.10),transparent)', animation: 'ccFloat 14s ease-in-out infinite' }} />
        <div className="absolute -bottom-40 right-0 w-[44rem] h-[30rem] rounded-full" style={{ background: 'radial-gradient(closest-side,rgba(192,132,252,.10),transparent)', animation: 'ccFloat 18s ease-in-out infinite reverse' }} />
      </div>

      {takeover && <TakeoverLayer key={takeover.kind === 'booking' ? takeover.booking.id : takeover.kind === 'alert' ? `a${takeover.alert.id}` : takeover.event.id} item={takeover} onDone={done} />}

      <div className="relative h-full flex flex-col gap-3 p-4">
        {/* ── Header ── */}
        <header className="shrink-0 flex items-center gap-4">
          <div className="relative w-11 h-11 rounded-2xl flex items-center justify-center" style={{ background: 'linear-gradient(135deg,rgba(34,211,238,.25),rgba(192,132,252,.25))', border: '1px solid var(--line2)', animation: 'ccGlow 4s ease-in-out infinite' }}>
            <Radar className="w-6 h-6" style={{ color: 'var(--cyan)' }} />
          </div>
          <div>
            <h1 className="text-xl font-extrabold leading-none tracking-tight" style={{ color: 'var(--head)' }}>
              Aahaas <span style={{ background: 'linear-gradient(90deg,var(--cyan),var(--violet))', WebkitBackgroundClip: 'text', color: 'transparent' }}>Command Center</span>
            </h1>
            <p className="text-[.6rem] uppercase tracking-[.38em] mt-1" style={{ color: 'var(--ink3)' }}>Apple Holidays · Live operations board</p>
          </div>

          {/* view tabs with a rotation progress bar */}
          <nav className="ml-6 flex items-center gap-1 rounded-2xl p-1 border" style={{ borderColor: 'var(--line)', background: 'rgba(10,15,30,.6)' }}>
            {VIEWS.map(v => {
              const on = v.id === view
              return (
                <button key={v.id} onClick={() => { setView(v.id); setCycle(c => c + 1) }}
                  className="relative overflow-hidden rounded-xl px-4 py-2 text-[.78rem] font-extrabold transition-colors"
                  style={{ color: on ? 'var(--head)' : 'var(--ink2)', background: on ? 'linear-gradient(135deg,rgba(34,211,238,.18),rgba(192,132,252,.18))' : 'transparent' }}>
                  <span className="cc-mono mr-2" style={{ color: on ? 'var(--cyan)' : 'var(--ink3)' }}>0{v.id}</span>{v.label}
                  {on && !paused && <span key={`${view}-${cycle}`} className="absolute left-0 bottom-0 h-[2px]" style={{ background: 'linear-gradient(90deg,var(--cyan),var(--violet))', animation: `ccProgress ${v.ms}ms linear forwards` }} />}
                </button>
              )
            })}
          </nav>

          <div className="ml-auto flex items-center gap-2">
            {v2 && (
              <div className="hidden xl:flex items-center gap-2 mr-2">
                <span className="cc-chip cc-num"><Users className="w-3 h-3" style={{ color: 'var(--cyan)' }} />{v2.ops.activeStaffToday} staff working</span>
                <span className="cc-chip cc-num"><Car className="w-3 h-3" style={{ color: 'var(--gold)' }} />{v2.ops.driversOnRoad} drivers on road</span>
              </div>
            )}
            {[
              { on: () => setPaused(p => !p), icon: paused ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />, t: paused ? 'Resume rotation' : 'Pause rotation' },
              { on: () => { setSoundOn(s => !s); chime() }, icon: soundOn ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />, t: 'Sound' },
              { on: fullscreen, icon: <Maximize className="w-4 h-4" />, t: 'Full screen' },
            ].map((b, i) => (
              <button key={i} onClick={b.on} title={b.t} className="w-9 h-9 rounded-xl flex items-center justify-center border" style={{ borderColor: 'var(--line)', background: 'rgba(10,15,30,.6)', color: 'var(--ink)' }}>{b.icon}</button>
            ))}
            <div className="text-right ml-2">
              <p className="cc-mono text-2xl font-bold leading-none" style={{ color: 'var(--head)' }}>{clock.text}</p>
              <p className="text-[.62rem] mt-1" style={{ color: 'var(--ink3)' }}>{now?.toLocaleDateString('en-GB', { weekday: 'long', day: '2-digit', month: 'long', timeZone: TZ })} · Colombo</p>
            </div>
            <span className="cc-chip ml-1" style={{ color: 'var(--good)', borderColor: 'rgba(46,229,157,.4)' }}><span className="cc-dot" style={{ background: 'var(--good)' }} />LIVE</span>
          </div>
        </header>

        {!viewData && !v2 ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center cc-up">
              <Globe2 className="w-14 h-14 mx-auto mb-4" style={{ color: 'var(--cyan)', animation: 'ccSpin 6s linear infinite' }} />
              <p className="text-lg font-bold" style={{ color: 'var(--head)' }}>Connecting to the operations floor…</p>
              <p className="text-sm mt-1" style={{ color: 'var(--ink3)' }}>This screen reconnects on its own.</p>
            </div>
          </div>
        ) : view === 1 ? (
          // ═══════════════════════════ VIEW 1 · LIVE OPS ═══════════════════════════
          <div key="v1" className="cc-view flex-1 min-h-0 grid gap-3" style={{ gridTemplateRows: 'auto minmax(0,1fr) 10.5rem auto' }}>
            {/* KPI strip */}
            <div className="grid grid-cols-6 gap-3">
              <Kpi delay={0} label="On tour today" edge="#22d3ee" icon={<Plane className="w-5 h-5" />} value={viewData?.totals.ongoingToday ?? 0}
                sub={<><Counter value={viewData?.totals.paxOnTour ?? 0} /> pax on the ground</>} />
              <Kpi delay={80} label="Booked today" edge="#c084fc" icon={<Sparkles className="w-5 h-5" />} value={cmp.received?.today ?? viewData?.totals.createdToday ?? 0}
                sub={cmp.received && <Delta now={cmp.received.today} then={cmp.received.yesterdaySoFar} suffix="vs yday same time" />} />
              <Kpi delay={160} label="Confirmed today" edge="#2ee59d" icon={<TrendingUp className="w-5 h-5" />} value={cmp.confirmed?.today ?? 0}
                sub={cmp.confirmed && <Delta now={cmp.confirmed.today} then={cmp.confirmed.yesterdaySoFar} suffix="vs yday same time" />} />
              <Kpi delay={240} label="Upcoming tours" edge="#ff3d8b" icon={<CalendarClock className="w-5 h-5" />} value={viewData?.totals.upcoming ?? 0}
                sub={<>of <b style={{ color: 'var(--head)' }}><Counter value={viewData?.totals.totalBookings ?? 0} /></b> bookings all-time</>} />
              <Kpi delay={320} label="Arrival flights" edge="#ffb547" icon={<Plane className="w-5 h-5 rotate-45" />} value={viewData?.totals.arrivalFlightsToday ?? 0}
                sub={<>{viewData?.totals.flightsToday ?? 0} sectors today · {v2?.map.flights.filter(f => f.phase === 'airborne').length ?? 0} in the air</>} />
              <Kpi delay={400} label="Drives today" edge="#ffc857" icon={<Car className="w-5 h-5" />} value={v2?.ops.movementsNeedingDriver ?? 0}
                sub={v2 && (v2.ops.unassignedMovements
                  ? <span style={{ color: 'var(--warn)' }}>{v2.ops.unassignedMovements} still need a driver</span>
                  : <span style={{ color: 'var(--good)' }}>every drive has a driver ✓</span>)} />
            </div>

            {/* main */}
            <div className="min-h-0 grid grid-cols-12 gap-3">
              <div className="col-span-3 min-h-0 grid gap-3" style={{ gridTemplateRows: 'minmax(0,1.5fr) minmax(0,1fr)' }}>
                {viewData && <Spotlight data={viewData} countries={countries} active={spotCountry} />}
                {v2 && <Skyline hours={v2.hourly.map(h => h.bookings)} total={cmp.received?.today ?? 0} prevSoFar={cmp.received?.yesterdaySoFar ?? 0} nowHour={clock.hour} />}
              </div>

              <div className="col-span-6 cc-panel min-h-0">
                {v2 && <OpsMap cities={v2.map.cities} legs={v2.map.legs} flights={v2.map.flights} />}
                <div className="absolute left-4 top-4 z-[500] pointer-events-none">
                  <p className="cc-title"><MapPinned className="w-4 h-4" />Where we are right now</p>
                </div>
                {v2 && (
                  <div className="absolute right-3 top-3 z-[500] flex flex-col gap-1.5 pointer-events-none">
                    {Object.entries(v2.map.countries).filter(([c]) => c !== 'UNASSIGNED').sort((a, b) => b[1].pax - a[1].pax).map(([c, r], i) => (
                      <div key={c} className="cc-in flex items-center gap-2 rounded-xl px-3 py-1.5 border" style={{ animationDelay: `${i * 80}ms`, borderColor: 'var(--line)', background: 'rgba(6,10,22,.75)', backdropFilter: 'blur(6px)' }}>
                        <span className="w-2 h-2 rounded-full" style={{ background: ({ VIETNAM: '#ff4d6d', SRILANKA: '#ffb547', SINGAPORE: '#ff3d8b', MALAYSIA: '#2ee59d' } as Record<string, string>)[c] ?? '#22d3ee' }} />
                        <span className="text-[.72rem] font-extrabold" style={{ color: 'var(--head)' }}>{c === 'SRILANKA' ? 'Sri Lanka' : c.charAt(0) + c.slice(1).toLowerCase().replace('_', ' & ')}</span>
                        <span className="cc-num text-[.72rem] ml-2" style={{ color: 'var(--ink2)' }}>{r.groups} groups · {r.pax} pax</span>
                      </div>
                    ))}
                  </div>
                )}
                {v2 && (
                  <div className="absolute right-3 bottom-3 z-[500] flex gap-3 rounded-xl px-3 py-2 border text-[.66rem] font-bold pointer-events-none" style={{ borderColor: 'var(--line)', background: 'rgba(6,10,22,.75)', color: 'var(--ink2)' }}>
                    <span className="flex items-center gap-1.5"><i className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: 'var(--cyan)' }} />City · groups</span>
                    <span className="flex items-center gap-1.5"><i className="w-4 h-[2px] inline-block" style={{ background: 'var(--warn)' }} />Today&apos;s drive</span>
                    <span className="flex items-center gap-1.5"><i className="w-4 h-[2px] inline-block" style={{ background: 'var(--violet)' }} />Flight · ✈ airborne</span>
                  </div>
                )}
              </div>

              <div className="col-span-3 min-h-0 grid gap-3" style={{ gridTemplateRows: 'minmax(0,1.45fr) minmax(0,1fr)' }}>
                {v2 && <ActivityFeed items={v2.feed} now={nowMs} />}
                {v2 && <FeedbackSpotlight data={v2.feedback} now={nowMs} />}
              </div>
            </div>

            {v2 ? <OpsFlow compare={v2.compare} ops={v2.ops} /> : <div />}
            <Ticker alerts={alerts} bookings={viewData?.recentBookings ?? []} />
          </div>
        ) : (
          // ═══════════════════════ VIEW 2 · INSIGHTS & FORECAST ═══════════════════════
          <div key="v2" className="cc-view flex-1 min-h-0 grid grid-cols-12 gap-3" style={{ gridTemplateRows: 'repeat(3,minmax(0,1fr))' }}>
            <div className="col-span-7 min-h-0">{v2 && <CompareChart rows={v2.compare} />}</div>
            <div className="col-span-5 row-span-2 min-h-0"><ForecastPanel f={forecast} /></div>
            <div className="col-span-4 min-h-0">{v2 && <Pipeline rows={v2.pipeline} />}</div>
            <div className="col-span-3 min-h-0">{v2 && <Leaderboard rows={v2.leaderboard} />}</div>
            <div className="col-span-3 min-h-0">{v2 && <HourlyFlow hours={v2.hourly} nowHour={clock.hour} />}</div>
            <div className="col-span-2 min-h-0">{v2 && <AheadStrip ahead={v2.ahead} />}</div>
            <div className="col-span-7 min-h-0">{v2 && <FeedbackWall fb={v2.feedback} now={nowMs} />}</div>
          </div>
        )}
      </div>
    </div>
  )
}

export default function Page() {
  return (
    <Suspense fallback={<div className="fixed inset-0" style={{ background: '#060a16' }} />}>
      <CommandCenter />
    </Suspense>
  )
}
