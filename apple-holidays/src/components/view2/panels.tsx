'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  Plane, FileText, CheckCircle2, CalendarRange, Car, MapPinned, MessageSquareHeart, Ban, Sparkles,
  Star, Quote, Crown, Users, Activity, ShieldAlert,
} from 'lucide-react'
import { CountryFlag } from '@/components/ui/country-flag'
import { ago, countryOf, fmtTime } from './theme'
import type { CompareRow, FeedItem, FeedbackItem, LeaderRow, PipelineRow, TEAlert, ViewData, View2Data, LiveBooking } from './types'

// ── Animated number ──────────────────────────────────────────────────────────
export function Counter({ value, dur = 1200, decimals = 0 }: { value: number; dur?: number; decimals?: number }) {
  const [v, setV] = useState(0)
  const from = useRef(0)
  useEffect(() => {
    const start = from.current, t0 = performance.now()
    let raf = 0
    const run = (t: number) => {
      const p = Math.min((t - t0) / dur, 1)
      const e = 1 - Math.pow(1 - p, 3)
      setV(start + (value - start) * e)
      if (p < 1) raf = requestAnimationFrame(run); else from.current = value
    }
    raf = requestAnimationFrame(run)
    return () => cancelAnimationFrame(raf)
  }, [value, dur])
  return <>{decimals ? v.toFixed(decimals) : Math.round(v).toLocaleString()}</>
}

export function Delta({ now, then, suffix = 'vs yday' }: { now: number; then: number; suffix?: string }) {
  const d = now - then
  const tone = d > 0 ? 'var(--good)' : d < 0 ? 'var(--crit)' : 'var(--ink3)'
  const bg = d > 0 ? 'var(--goodS)' : d < 0 ? 'var(--critS)' : 'rgba(255,255,255,.04)'
  return (
    <span className="cc-chip cc-num" style={{ color: tone, background: bg, borderColor: 'transparent' }}>
      {d > 0 ? '▲' : d < 0 ? '▼' : '='} {Math.abs(d)} <span style={{ color: 'var(--ink3)', fontWeight: 600 }}>{suffix}</span>
    </span>
  )
}

export function PanelTitle({ icon, children, right }: { icon: ReactNode; children: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 mb-3 relative">
      <p className="cc-title">{icon}{children}</p>
      {right}
    </div>
  )
}

// ── KPI tile ─────────────────────────────────────────────────────────────────
export function Kpi({ label, value, icon, edge, sub, delay = 0 }: {
  label: string; value: number; icon: ReactNode; edge: string; sub?: ReactNode; delay?: number
}) {
  return (
    <div className="cc-panel cc-edge cc-up px-5 py-4 flex flex-col justify-between" style={{ ['--edge' as string]: edge, animationDelay: `${delay}ms` }}>
      <div className="cc-sweep" style={{ animationDelay: `${delay * 3}ms` }} />
      <div className="flex items-center justify-between">
        <p className="text-[.68rem] font-extrabold uppercase tracking-[.22em]" style={{ color: 'var(--ink2)' }}>{label}</p>
        <span style={{ color: edge }}>{icon}</span>
      </div>
      <p className="cc-num font-extrabold leading-none mt-2" style={{ fontSize: 'clamp(2rem,3.2vw,3.6rem)', color: 'var(--head)', textShadow: `0 0 28px ${edge}55` }}>
        <Counter value={value} />
      </p>
      <div className="mt-2 min-h-[1.5rem] text-[.78rem]" style={{ color: 'var(--ink2)' }}>{sub}</div>
    </div>
  )
}

// ── Country spotlight ────────────────────────────────────────────────────────
export function Spotlight({ data, countries, active }: { data: ViewData; countries: string[]; active: string }) {
  const m = countryOf(active)
  const images = Array.from(new Set(countries.map(c => countryOf(c).image)))
  return (
    <div className="cc-panel h-full" style={{ borderColor: `${m.hex}66`, boxShadow: `0 0 40px -12px ${m.hex}` }}>
      {images.map(src => (
        <div key={src} className="absolute inset-0 bg-cover bg-center transition-opacity duration-[1400ms]"
          style={{ backgroundImage: `url(${src})`, opacity: src === m.image ? 1 : 0, animation: src === m.image ? 'ccKen 14s ease-out both' : undefined }} />
      ))}
      <div className="absolute inset-0" style={{ background: 'linear-gradient(180deg,rgba(6,10,22,.25),rgba(6,10,22,.6) 45%,rgba(6,10,22,.96))' }} />
      <div className="absolute inset-0" style={{ background: `linear-gradient(135deg,${m.hex}2a,transparent 60%)` }} />
      <div key={active} className="relative h-full flex flex-col p-5 cc-in">
        <div className="flex items-center gap-3">
          <span className="rounded-lg overflow-hidden border border-white/30 shadow-lg"><CountryFlag country={active} className="w-12 h-8" /></span>
          <div>
            <p className="text-[.62rem] uppercase tracking-[.32em] text-white/70 flex items-center gap-1.5">
              <span className="cc-dot" style={{ background: m.hex }} /> Spotlight
            </p>
            <h3 className="text-3xl font-extrabold text-white drop-shadow">{m.label}</h3>
          </div>
        </div>
        <div className="mt-auto">
          <p className="text-[.66rem] uppercase tracking-[.28em] text-white/70">On tour today</p>
          <p className="cc-num font-extrabold text-white leading-none" style={{ fontSize: 'clamp(3.5rem,6vw,6.5rem)', textShadow: `0 0 40px ${m.hex}` }}>
            <Counter value={data.byCountry.ongoing[active] ?? 0} />
          </p>
          <div className="grid grid-cols-3 gap-2 mt-3">
            {[
              ['Upcoming', data.byCountry.upcoming[active] ?? 0],
              ['Booked today', data.byCountry.createdToday?.[active] ?? 0],
              ['All-time', data.byCountry.lifetime[active] ?? 0],
            ].map(([l, v]) => (
              <div key={l as string} className="rounded-xl px-3 py-2 border border-white/15" style={{ background: 'rgba(0,0,0,.35)', backdropFilter: 'blur(6px)' }}>
                <p className="text-[.58rem] uppercase tracking-[.18em] text-white/60">{l}</p>
                <p className="cc-num text-xl font-extrabold text-white"><Counter value={v as number} /></p>
              </div>
            ))}
          </div>
        </div>
        {/* country index dots */}
        <div className="flex gap-1.5 mt-3">
          {countries.map(c => (
            <span key={c} className="h-1 rounded-full transition-all duration-500" style={{ flex: c === active ? 3 : 1, background: c === active ? countryOf(c).hex : 'rgba(255,255,255,.2)' }} />
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Booked-today skyline ─────────────────────────────────────────────────────
/** Hours are Colombo hours (from /api/public/view2), so `nowHour` must be too. */
export function Skyline({ hours, total, prevSoFar, nowHour }: { hours: number[]; total: number; prevSoFar: number; nowHour: number }) {
  const peak = Math.max(1, ...hours)
  const best = hours.indexOf(Math.max(...hours))
  const prev = useRef(total)
  const [burst, setBurst] = useState(0)
  useEffect(() => { if (total > prev.current) setBurst(b => b + 1); prev.current = total }, [total])
  return (
    <div className="cc-panel cc-edge h-full p-4 flex flex-col" style={{ ['--edge' as string]: 'var(--violet)' }}>
      <PanelTitle icon={<Sparkles className="w-4 h-4" />} right={<Delta now={total} then={prevSoFar} suffix="vs yday same time" />}>Booked Today</PanelTitle>
      <div className="flex items-end gap-3">
        <div className="relative">
          {burst > 0 && <span key={burst} className="absolute inset-0 -m-2 rounded-full border-2" style={{ borderColor: 'var(--violet)', animation: 'ccPing 1.2s ease-out forwards' }} />}
          <p className="cc-num text-5xl font-extrabold" style={{ color: 'var(--head)', textShadow: '0 0 30px var(--violetG)' }}><Counter value={total} /></p>
        </div>
        <p className="pb-1 text-[.75rem] font-bold" style={{ color: 'var(--ink2)' }}>
          {total ? `busiest at ${String(best).padStart(2, '0')}:00` : 'nothing filed yet today'}
        </p>
      </div>
      <div className="flex-1 min-h-[40px] flex items-end gap-[3px] mt-3">
        {hours.map((n, h) => {
          const future = h > nowHour, live = h === nowHour
          return (
            <div key={h} className="flex-1 h-full flex flex-col justify-end">
              <div style={{
                height: `${Math.max(n ? 12 : 6, (n / peak) * 100)}%`, borderRadius: 3, transformOrigin: 'bottom',
                animation: future ? undefined : `ccBar .7s cubic-bezier(.34,1.56,.64,1) ${h * 25}ms both${live ? ', ccPulse 1.6s ease-in-out infinite' : ''}`,
                background: future ? 'rgba(255,255,255,.06)' : live ? 'linear-gradient(180deg,#f0abfc,#a855f7)' : n ? 'linear-gradient(180deg,#c084fc,rgba(160,112,236,.35))' : 'rgba(255,255,255,.1)',
                boxShadow: live && n ? '0 0 14px rgba(232,121,249,.7)' : undefined,
              }} />
            </div>
          )
        })}
      </div>
      <div className="flex justify-between mt-1.5 text-[.6rem] cc-mono" style={{ color: 'var(--ink3)' }}><span>00</span><span>06</span><span>12</span><span>18</span><span>23</span></div>
    </div>
  )
}

// ── Live activity stream ─────────────────────────────────────────────────────
const FEED_STYLE: Record<string, { icon: ReactNode; color: string }> = {
  booking: { icon: <FileText className="w-4 h-4" />, color: 'var(--cyan)' },
  status: { icon: <CheckCircle2 className="w-4 h-4" />, color: 'var(--good)' },
  agenda: { icon: <CalendarRange className="w-4 h-4" />, color: 'var(--violet)' },
  driver: { icon: <Car className="w-4 h-4" />, color: 'var(--gold)' },
  cancel: { icon: <Ban className="w-4 h-4" />, color: 'var(--crit)' },
}
export function ActivityFeed({ items, now }: { items: FeedItem[]; now: number }) {
  const seen = useRef<Set<string> | null>(null)
  const fresh = new Set<string>()
  if (seen.current) items.forEach(i => { if (!seen.current!.has(i.id)) fresh.add(i.id) })
  useEffect(() => { seen.current = new Set(items.map(i => i.id)) }, [items])

  return (
    <div className="cc-panel cc-edge h-full p-4 flex flex-col" style={{ ['--edge' as string]: 'var(--good)' }}>
      <PanelTitle icon={<Activity className="w-4 h-4" />} right={<span className="cc-chip"><span className="cc-dot" style={{ background: 'var(--good)' }} />live</span>}>Live Activity</PanelTitle>
      <div className="relative flex-1 min-h-0 overflow-hidden">
        <div className="space-y-1.5">
          {items.slice(0, 14).map((it, i) => {
            const s = FEED_STYLE[it.kind] ?? FEED_STYLE.status
            const isNew = fresh.has(it.id)
            return (
              <div key={it.id} className="flex items-center gap-3 rounded-xl px-3 py-2 border cc-in"
                style={{ animationDelay: `${i * 40}ms`, borderColor: isNew ? s.color : 'var(--line)', background: isNew ? 'rgba(46,229,157,.08)' : 'rgba(255,255,255,.025)' }}>
                <span className="w-8 h-8 shrink-0 rounded-lg flex items-center justify-center" style={{ color: s.color, background: 'rgba(255,255,255,.05)', boxShadow: `inset 0 0 0 1px ${s.color}44` }}>{s.icon}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-[.82rem] font-bold truncate" style={{ color: 'var(--head)' }}>{it.title}</p>
                  <p className="text-[.7rem] truncate" style={{ color: 'var(--ink2)' }}>{it.sub}</p>
                </div>
                <div className="text-right shrink-0">
                  {it.country && <CountryFlag country={it.country} className="w-5 h-3.5 rounded-[2px] ml-auto" />}
                  <p className="text-[.62rem] cc-mono mt-0.5" style={{ color: 'var(--ink3)' }}>{ago(it.at, now)}</p>
                </div>
              </div>
            )
          })}
        </div>
        <div className="absolute inset-x-0 bottom-0 h-16 pointer-events-none" style={{ background: 'linear-gradient(transparent,rgba(14,22,46,.95))' }} />
      </div>
    </div>
  )
}

// ── Feedback ─────────────────────────────────────────────────────────────────
const SOURCE_LABEL: Record<FeedbackItem['source'], string> = {
  guest_form: 'Guest form', post_tour: 'Post-tour call', on_tour_call: 'On-tour AI call',
}
export function Stars({ value, size = 14 }: { value: number | null; size?: number }) {
  if (value == null) return null
  return (
    <span className="inline-flex gap-0.5">
      {[1, 2, 3, 4, 5].map(i => (
        <Star key={i} style={{ width: size, height: size, color: 'var(--gold)', fill: i <= Math.round(value) ? 'var(--gold)' : 'transparent', opacity: i <= Math.round(value) ? 1 : .35 }} />
      ))}
    </span>
  )
}
const sentimentTone = (s: string | null) => {
  const k = (s ?? '').toLowerCase()
  return k === 'negative' ? 'var(--crit)' : k === 'positive' ? 'var(--good)' : 'var(--warn)'
}
export function FeedbackCard({ f, now, big }: { f: FeedbackItem; now: number; big?: boolean }) {
  const tone = sentimentTone(f.sentiment)
  return (
    <div className="relative h-full rounded-2xl border p-4 flex flex-col cc-in overflow-hidden" style={{ borderColor: `${tone}55`, background: 'rgba(255,255,255,.03)' }}>
      <Quote className="absolute -right-2 -top-2 w-20 h-20 opacity-[.06]" />
      <div className="flex items-center gap-2">
        <Stars value={f.stars} size={big ? 18 : 14} />
        <span className="ml-auto text-[.6rem] uppercase tracking-[.2em] font-bold" style={{ color: tone }}>{SOURCE_LABEL[f.source]}</span>
      </div>
      <p className={`mt-2 font-semibold leading-snug ${big ? 'text-[1.05rem] line-clamp-5' : 'text-[.85rem] line-clamp-4'}`} style={{ color: 'var(--head)' }}>
        &ldquo;{f.text}&rdquo;
      </p>
      <div className="mt-auto pt-3 flex items-center gap-2 text-[.72rem]" style={{ color: 'var(--ink2)' }}>
        {f.country && <CountryFlag country={f.country} className="w-5 h-3.5 rounded-[2px]" />}
        <span className="font-bold cc-mono" style={{ color: 'var(--ink)' }}>{f.bookingRef ?? '—'}</span>
        {f.who && <span>· {f.who}</span>}
        <span className="ml-auto cc-mono" style={{ color: 'var(--ink3)' }}>{ago(f.at, now)}</span>
      </div>
    </div>
  )
}

/** One feedback at a time, cross-fading — for the busy Live Ops view. */
export function FeedbackSpotlight({ data, now }: { data: View2Data['feedback']; now: number }) {
  const [i, setI] = useState(0)
  const items = data.items
  useEffect(() => {
    if (items.length < 2) return
    const id = setInterval(() => setI(x => (x + 1) % items.length), 8000)
    return () => clearInterval(id)
  }, [items.length])
  const f = items[i % Math.max(1, items.length)]
  return (
    <div className="cc-panel cc-edge h-full p-4 flex flex-col" style={{ ['--edge' as string]: 'var(--gold)' }}>
      <PanelTitle icon={<MessageSquareHeart className="w-4 h-4" />}
        right={data.stats.avgStars != null && <span className="cc-chip cc-num"><Star className="w-3 h-3" style={{ color: 'var(--gold)', fill: 'var(--gold)' }} />{data.stats.avgStars} · 30d</span>}>
        Latest Feedback
      </PanelTitle>
      <div className="flex-1 min-h-0">
        {f ? <FeedbackCard key={f.id} f={f} now={now} /> : <p className="text-sm" style={{ color: 'var(--ink3)' }}>No feedback captured yet.</p>}
      </div>
      {items.length > 1 && (
        <div className="flex gap-1 mt-2">{items.map((x, k) => <span key={x.id} className="h-1 flex-1 rounded-full" style={{ background: k === i ? 'var(--gold)' : 'rgba(255,255,255,.12)' }} />)}</div>
      )}
    </div>
  )
}

// ── Ops flow: how a file moves through the floor today ───────────────────────
/**
 * A horizontal chain of the stages the team actually works — TC in, confirmed,
 * client confirmed, agenda built, driver assigned, on tour, feedback — each a
 * glowing node with today's count, and particles streaming along the wire at a
 * speed proportional to how busy the next stage is. Reads as "the floor is
 * moving" from across a room.
 */
export function OpsFlow({ compare, ops }: { compare: CompareRow[]; ops: View2Data['ops'] }) {
  const by = Object.fromEntries(compare.map(c => [c.key, c]))
  const nodes = [
    { key: 'received', label: 'TC Received', icon: <FileText className="w-5 h-5" />, color: '#22d3ee' },
    { key: 'confirmed', label: 'Confirmed', icon: <CheckCircle2 className="w-5 h-5" />, color: '#2ee59d' },
    { key: 'clientConfirmed', label: 'Client Confirmed', icon: <Users className="w-5 h-5" />, color: '#5eead4' },
    { key: 'agendas', label: 'Agenda Built', icon: <CalendarRange className="w-5 h-5" />, color: '#c084fc' },
    { key: 'drivers', label: 'Driver Assigned', icon: <Car className="w-5 h-5" />, color: '#ffc857' },
    { key: 'tours', label: 'On Tour', icon: <MapPinned className="w-5 h-5" />, color: '#ff3d8b' },
    { key: 'feedback', label: 'Feedback', icon: <MessageSquareHeart className="w-5 h-5" />, color: '#ffb547' },
  ]
  const n = nodes.length
  const centre = (i: number) => ((i + 0.5) / n) * 100
  return (
    <div className="cc-panel h-full px-5 py-3 flex flex-col">
      <PanelTitle icon={<Activity className="w-4 h-4" />}
        right={
          <div className="flex items-center gap-2">
            <span className="cc-chip cc-num"><Users className="w-3 h-3" />{ops.activeStaffToday} staff active</span>
            <span className="cc-chip cc-num">{ops.actionsToday} workflow moves</span>
            <span className="cc-chip cc-num" style={{ color: ops.unassignedMovements ? 'var(--warn)' : 'var(--good)' }}>
              <Car className="w-3 h-3" />{ops.movementsNeedingDriver - ops.unassignedMovements}/{ops.movementsNeedingDriver} drives covered today
            </span>
          </div>
        }>
        Today&apos;s Ops Flow
      </PanelTitle>
      <div className="relative flex-1 min-h-0">
        {/* the wire, node centre to node centre, at the icons' mid-height (1.5rem) */}
        <div className="absolute h-[2px] rounded-full" style={{ top: '1.5rem', left: `${centre(0)}%`, right: `${100 - centre(n - 1)}%`,
          background: `linear-gradient(90deg,${nodes.map(x => `${x.color}88`).join(',')})` }} />
        {/* particles stream along each segment; busier next stage, more and faster */}
        {nodes.slice(0, -1).map((_, i) => {
          const next = by[nodes[i + 1].key]?.today ?? 0
          const count = Math.min(4, 1 + Math.floor(next / 3))
          const dur = Math.max(1.4, 4 - Math.min(2.6, next / 6))
          const c = nodes[i + 1].color
          return (
            <div key={i} className="absolute h-0" style={{ top: '1.5rem', left: `calc(${centre(i)}% + 1.75rem)`, width: `calc(${100 / n}% - 3.5rem)` }}>
              {Array.from({ length: count }, (_, k) => (
                <span key={k} className="absolute w-2 h-2 -mt-1 rounded-full"
                  style={{ background: c, boxShadow: `0 0 8px ${c}`, animation: `ccRun ${dur}s linear ${(k * dur) / count}s infinite` }} />
              ))}
            </div>
          )
        })}
        <div className="absolute inset-0 grid" style={{ gridTemplateColumns: `repeat(${nodes.length},1fr)` }}>
          {nodes.map((n, i) => {
            const r = by[n.key]
            return (
              <div key={n.key} className="flex flex-col items-center cc-up" style={{ animationDelay: `${i * 90}ms` }}>
                <div className="relative w-12 h-12 rounded-2xl flex items-center justify-center"
                  style={{ background: `radial-gradient(circle at 30% 30%,${n.color}55,rgba(10,15,30,.95))`, border: `1px solid ${n.color}`, boxShadow: `0 0 22px -2px ${n.color}`, color: '#fff' }}>
                  {n.icon}
                  {(r?.today ?? 0) > 0 && <span className="absolute inset-0 rounded-2xl" style={{ border: `1px solid ${n.color}`, animation: 'ccPing 2.4s ease-out infinite', animationDelay: `${i * .3}s` }} />}
                </div>
                <p className="cc-num text-3xl font-extrabold mt-1 leading-none" style={{ color: 'var(--head)' }}><Counter value={r?.today ?? 0} /></p>
                <p className="text-[.62rem] uppercase tracking-[.16em] font-bold mt-1 text-center" style={{ color: n.color }}>{n.label}</p>
                <p className="text-[.62rem] cc-num" style={{ color: 'var(--ink3)' }}>yday {r?.yesterday ?? 0}</p>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ── Pipeline (work in progress by stage) ─────────────────────────────────────
export function Pipeline({ rows }: { rows: PipelineRow[] }) {
  const max = Math.max(1, ...rows.map(r => r.wip))
  const totalWip = rows.reduce((n, r) => n + r.wip, 0)
  const moved = rows.reduce((n, r) => n + r.movedToday, 0)
  return (
    <div className="cc-panel cc-edge h-full p-4 flex flex-col" style={{ ['--edge' as string]: 'var(--cyan)' }}>
      <PanelTitle icon={<FileText className="w-4 h-4" />} right={<span className="cc-chip cc-num">{totalWip} in pipeline · {moved} moved today</span>}>Booking Pipeline</PanelTitle>
      <div className="flex-1 min-h-0 flex flex-col justify-between gap-1">
        {rows.slice(0, 11).map((r, i) => (
          <div key={r.status} className="grid items-center gap-2" style={{ gridTemplateColumns: '9.5rem 1fr 3.4rem' }}>
            <p className="text-[.72rem] font-bold truncate" style={{ color: 'var(--ink)' }}>{r.label}</p>
            <div className="relative h-4 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,.05)' }}>
              <div className="absolute inset-y-0 left-0 rounded-full" style={{
                width: `${Math.max(2, (r.wip / max) * 100)}%`, transformOrigin: 'left',
                animation: `ccBarX .9s cubic-bezier(.2,.8,.2,1) ${i * 60}ms both`,
                background: 'linear-gradient(90deg,rgba(10,163,190,.5),var(--cyan))', boxShadow: '0 0 12px var(--cyanG)',
              }} />
              <span className="absolute right-2 inset-y-0 flex items-center text-[.66rem] font-extrabold cc-num" style={{ color: 'var(--head)' }}>{r.wip}</span>
            </div>
            <span className="text-[.68rem] font-extrabold cc-num text-right" style={{ color: r.movedToday ? 'var(--good)' : 'var(--ink3)' }}>
              {r.movedToday ? `+${r.movedToday}` : '·'}
            </span>
          </div>
        ))}
        {rows.length === 0 && <p className="text-sm" style={{ color: 'var(--ink3)' }}>Pipeline is empty.</p>}
      </div>
    </div>
  )
}

// ── Team leaderboard ─────────────────────────────────────────────────────────
const MEDAL = ['#ffc857', '#c9d4ea', '#d27a26']
export function Leaderboard({ rows }: { rows: LeaderRow[] }) {
  const max = Math.max(1, ...rows.map(r => r.total))
  return (
    <div className="cc-panel cc-edge h-full p-4 flex flex-col" style={{ ['--edge' as string]: 'var(--gold)' }}>
      <PanelTitle icon={<Crown className="w-4 h-4" />} right={<span className="cc-chip">today</span>}>Team Processing</PanelTitle>
      <div className="flex-1 min-h-0 flex flex-col gap-1.5">
        {rows.slice(0, 4).map((r, i) => (
          <div key={r.name + i} className="flex items-center gap-3 cc-in" style={{ animationDelay: `${i * 70}ms` }}>
            <span className="w-8 h-8 shrink-0 rounded-full flex items-center justify-center text-[.8rem] font-extrabold"
              style={{ background: i < 3 ? `${MEDAL[i]}22` : 'rgba(255,255,255,.05)', color: i < 3 ? MEDAL[i] : 'var(--ink2)', border: `1px solid ${i < 3 ? MEDAL[i] : 'var(--line)'}` }}>
              {i === 0 ? <Crown className="w-4 h-4" /> : i + 1}
            </span>
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline justify-between gap-2">
                <p className="text-[.85rem] font-extrabold truncate" style={{ color: 'var(--head)' }}>{r.name}</p>
                <p className="cc-num text-lg font-extrabold" style={{ color: i < 3 ? MEDAL[i] : 'var(--ink)' }}>{r.total}</p>
              </div>
              <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,.05)' }}>
                <div className="h-full rounded-full" style={{ width: `${(r.total / max) * 100}%`, transformOrigin: 'left', animation: `ccBarX .9s ease-out ${i * 70}ms both`, background: i < 3 ? MEDAL[i] : 'var(--s2)' }} />
              </div>
              <p className="text-[.62rem] truncate mt-0.5" style={{ color: 'var(--ink3)' }}>
                {r.actions} moves{r.created ? ` · ${r.created} new files` : ''}{r.topStage ? ` · mostly ${r.topStage}` : ''}
              </p>
            </div>
          </div>
        ))}
        {rows.length === 0 && <p className="text-sm" style={{ color: 'var(--ink3)' }}>No processing recorded yet today.</p>}
      </div>
    </div>
  )
}

// ── Bottom ticker: traveller alerts + newest bookings ────────────────────────
export function Ticker({ alerts, bookings }: { alerts: TEAlert[]; bookings: LiveBooking[] }) {
  const high = alerts.filter(a => a.severity === 'high').length
  const items: ReactNode[] = [
    ...alerts.map(a => (
      <span key={`a${a.id}`} className="inline-flex items-center gap-2">
        <ShieldAlert className="w-4 h-4" style={{ color: a.severity === 'high' ? 'var(--crit)' : 'var(--warn)' }} />
        {a.booking_ref && <b className="cc-mono" style={{ color: 'var(--head)' }}>{a.booking_ref}</b>}
        <span>{a.title ?? a.details ?? 'Issue reported on tour'}</span>
      </span>
    )),
    ...bookings.slice(0, 8).map(b => (
      <span key={`b${b.id}`} className="inline-flex items-center gap-2">
        <Plane className="w-4 h-4" style={{ color: 'var(--cyan)' }} />
        <CountryFlag country={b.operationCountry} className="w-5 h-3.5 rounded-[2px]" />
        <b className="cc-mono" style={{ color: 'var(--head)' }}>{b.bookingRef}</b>
        <span>{b.paxAdults + b.paxChildren} pax · {b.agent || 'Direct'} · filed {fmtTime(b.createdAt)}</span>
      </span>
    )),
  ]
  return (
    <div className="cc-panel flex items-stretch" style={{ borderColor: high ? 'rgba(255,77,109,.5)' : 'var(--line)' }}>
      <div className="shrink-0 flex items-center gap-2 px-4 border-r" style={{ borderColor: 'var(--line)', background: high ? 'var(--critS)' : 'rgba(34,211,238,.07)' }}>
        <ShieldAlert className="w-4 h-4" style={{ color: high ? 'var(--crit)' : alerts.length ? 'var(--warn)' : 'var(--good)', animation: high ? 'ccPulse 1s infinite' : undefined }} />
        <div className="leading-tight">
          <p className="text-[.55rem] uppercase tracking-[.28em]" style={{ color: 'var(--ink3)' }}>Traveller alerts</p>
          <p className="cc-num text-sm font-extrabold" style={{ color: high ? 'var(--crit)' : alerts.length ? 'var(--warn)' : 'var(--good)' }}>
            {alerts.length ? `${alerts.length} open${high ? ` · ${high} high` : ''}` : 'All quiet'}
          </p>
        </div>
      </div>
      <div className="relative flex-1 overflow-hidden flex items-center py-2.5">
        <div className="flex items-center gap-10 whitespace-nowrap pl-6 text-[.85rem]" style={{ color: 'var(--ink)', animation: `ccMarquee ${Math.max(30, items.length * 7)}s linear infinite` }}>
          {[0, 1].map(k => <span key={k} className="inline-flex items-center gap-10">{items}</span>)}
        </div>
      </div>
    </div>
  )
}
