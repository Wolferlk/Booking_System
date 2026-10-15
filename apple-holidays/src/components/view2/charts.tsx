'use client'

import { useEffect, useState } from 'react'
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, LabelList,
  ComposedChart, Area, Line, ReferenceLine,
} from 'recharts'
import { BarChart3, BrainCircuit, Clock3, MessageSquareHeart, Star, ThumbsUp, CalendarClock, TrendingUp, TrendingDown } from 'lucide-react'
import { Counter, Delta, FeedbackCard, PanelTitle } from './panels'
import type { CompareRow, ForecastData, HourRow, View2Data } from './types'

const AXIS = { fill: '#8d9bbb', fontSize: 11, fontWeight: 700 }
const GRID = 'rgba(140,170,255,.07)'
const TIP = {
  contentStyle: { background: 'rgba(10,15,30,.95)', border: '1px solid rgba(120,160,255,.24)', borderRadius: 10, color: '#f2f6ff', fontSize: 12 },
  cursor: { fill: 'rgba(255,255,255,.04)' },
}
const short = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: 'UTC' })

// ── Yesterday vs today ───────────────────────────────────────────────────────
/**
 * Two charts on two scales: what the team *did* (files received, confirmed,
 * agendas, drivers, feedback) and what the *tours* did (running, landing,
 * leaving). On one axis "86 tours running" flattens every work bar into a stub.
 */
const TOUR_KEYS = ['tours', 'arrivals', 'departures']
function CompareBars({ data, labelSize = 13 }: { data: (CompareRow & { label: string })[]; labelSize?: number }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} barCategoryGap="18%" barGap={3} margin={{ top: 22, right: 6, left: -18, bottom: 0 }}>
        <defs>
          <linearGradient id="ccToday" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#67e8f9" /><stop offset="100%" stopColor="#0aa3be" /></linearGradient>
          <linearGradient id="ccYday" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#8d9bbb" /><stop offset="100%" stopColor="#3a4566" /></linearGradient>
        </defs>
        <CartesianGrid vertical={false} stroke={GRID} />
        <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={false} interval={0} />
        <YAxis tick={AXIS} tickLine={false} axisLine={false} allowDecimals={false} />
        <Tooltip {...TIP} />
        <Bar dataKey="yesterday" name="Yesterday" fill="url(#ccYday)" radius={[5, 5, 0, 0]} animationDuration={1100} />
        <Bar dataKey="yesterdaySoFar" name="Yesterday by now" fill="rgba(160,112,236,.6)" radius={[5, 5, 0, 0]} animationDuration={1300} />
        <Bar dataKey="today" name="Today" fill="url(#ccToday)" radius={[5, 5, 0, 0]} animationDuration={1500}>
          <LabelList dataKey="today" position="top" style={{ fill: '#f2f6ff', fontSize: labelSize, fontWeight: 800 }} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

export function CompareChart({ rows }: { rows: CompareRow[] }) {
  const work = rows.filter(r => !TOUR_KEYS.includes(r.key))
  // Tours are calendar facts, not a running count — "by now" equals the full day.
  const tours = rows.filter(r => TOUR_KEYS.includes(r.key)).map(r => ({ ...r, yesterdaySoFar: 0 }))
  const sumT = work.reduce((n, r) => n + r.today, 0)
  const sumY = work.reduce((n, r) => n + r.yesterdaySoFar, 0)
  return (
    <div className="cc-panel cc-edge h-full p-4 flex flex-col" style={{ ['--edge' as string]: 'var(--cyan)' }}>
      <PanelTitle icon={<BarChart3 className="w-4 h-4" />}
        right={
          <div className="flex items-center gap-3 text-[.7rem] font-bold" style={{ color: 'var(--ink2)' }}>
            <span className="flex items-center gap-1.5"><i className="w-3 h-3 rounded-sm inline-block" style={{ background: '#64708f' }} />Yesterday</span>
            <span className="flex items-center gap-1.5"><i className="w-3 h-3 rounded-sm inline-block" style={{ background: 'rgba(160,112,236,.6)' }} />Yesterday by this time</span>
            <span className="flex items-center gap-1.5"><i className="w-3 h-3 rounded-sm inline-block" style={{ background: 'var(--cyan)' }} />Today</span>
            <Delta now={sumT} then={sumY} suffix="team output vs yday" />
          </div>
        }>
        Yesterday vs Today
      </PanelTitle>
      <div className="flex-1 min-h-0 grid gap-4" style={{ gridTemplateColumns: '2.2fr 1fr' }}>
        <div className="min-h-0 flex flex-col">
          <p className="text-[.6rem] uppercase tracking-[.24em] font-bold" style={{ color: 'var(--ink3)' }}>Team work</p>
          <div className="flex-1 min-h-0"><CompareBars data={work} /></div>
        </div>
        <div className="min-h-0 flex flex-col pl-4 border-l" style={{ borderColor: 'var(--line)' }}>
          <p className="text-[.6rem] uppercase tracking-[.24em] font-bold" style={{ color: 'var(--ink3)' }}>Tours</p>
          <div className="flex-1 min-h-0"><CompareBars data={tours} /></div>
        </div>
      </div>
    </div>
  )
}

// ── AI forecast ──────────────────────────────────────────────────────────────
/** Types the insight out a character at a time — the "AI is speaking" cue. */
function Typed({ text }: { text: string }) {
  const [n, setN] = useState(0)
  useEffect(() => {
    setN(0)
    const id = setInterval(() => setN(x => (x >= text.length ? x : x + 1)), 22)
    return () => clearInterval(id)
  }, [text])
  return <>{text.slice(0, n)}<span style={{ opacity: n < text.length ? 1 : 0, color: 'var(--cyan)' }}>▍</span></>
}

export function ForecastPanel({ f }: { f: ForecastData | null }) {
  const [insight, setInsight] = useState(0)
  useEffect(() => {
    if (!f?.insights.length) return
    const id = setInterval(() => setInsight(i => (i + 1) % f.insights.length), 9000)
    return () => clearInterval(id)
  }, [f?.insights.length])

  if (!f) {
    return (
      <div className="cc-panel h-full p-4 flex items-center justify-center">
        <div className="text-center">
          <div className="w-20 h-20 mx-auto rounded-full bg-cover bg-center" style={{ backgroundImage: 'url(/view2/ai-orb.jpg)', animation: 'ccOrb 3s ease-in-out infinite' }} />
          <p className="mt-3 text-sm font-bold" style={{ color: 'var(--ink2)' }}>AI is reading eight weeks of bookings…</p>
        </div>
      </div>
    )
  }

  const hist = f.history.slice(-14).map(h => ({ date: h.date, label: short(h.date), actual: h.received }))
  const last = hist[hist.length - 1]
  const fc = f.forecast.map(d => ({ date: d.date, label: `${d.weekday} ${short(d.date).split(' ')[0]}`, forecast: d.bookings, band: [d.low, d.high] as [number, number] }))
  // The forecast line starts on the last actual so the two read as one curve.
  const series = [
    ...hist.map(h => ({ ...h, forecast: h === last ? h.actual : undefined })),
    ...fc,
  ]
  const change = f.lastWeekTotal ? Math.round(((f.nextWeekTotal - f.lastWeekTotal) / f.lastWeekTotal) * 100) : 0
  const up = change >= 0

  return (
    <div className="cc-panel h-full p-4 flex flex-col" style={{ borderColor: 'rgba(192,132,252,.35)' }}>
      <div className="absolute -right-16 -top-16 w-64 h-64 rounded-full bg-cover bg-center opacity-50 pointer-events-none"
        style={{ backgroundImage: 'url(/view2/ai-orb.jpg)', animation: 'ccOrb 6s ease-in-out infinite', maskImage: 'radial-gradient(circle,#000 45%,transparent 70%)', WebkitMaskImage: 'radial-gradient(circle,#000 45%,transparent 70%)' }} />
      <PanelTitle icon={<BrainCircuit className="w-4 h-4" style={{ color: 'var(--violet)' }} />}
        right={<span className="cc-chip" style={{ color: 'var(--violet)' }}>{f.source === 'openai' ? `OpenAI · ${f.model}` : 'Statistical baseline'} · {f.confidence} confidence</span>}>
        Booking Forecast · next 7 days
      </PanelTitle>

      <div className="relative flex items-end gap-6">
        <div>
          <p className="text-[.62rem] uppercase tracking-[.24em]" style={{ color: 'var(--ink3)' }}>Expected new bookings</p>
          <p className="cc-num font-extrabold leading-none" style={{ fontSize: 'clamp(2.6rem,4vw,4.2rem)', color: 'var(--head)', textShadow: '0 0 30px var(--violetG)' }}>
            <Counter value={f.nextWeekTotal} />
          </p>
        </div>
        <div className="pb-1">
          <span className="cc-chip cc-num" style={{ color: up ? 'var(--good)' : 'var(--crit)', background: up ? 'var(--goodS)' : 'var(--critS)', borderColor: 'transparent' }}>
            {up ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}{up ? '+' : ''}{change}% vs last 7 days ({f.lastWeekTotal})
          </span>
          <p className="text-[.85rem] font-bold mt-1.5 max-w-[30rem]" style={{ color: 'var(--ink)' }}>{f.headline}</p>
        </div>
      </div>

      <div className="flex-1 min-h-0 mt-2">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={series} margin={{ top: 10, right: 8, left: -20, bottom: 0 }}>
            <defs>
              <linearGradient id="ccAct" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#22d3ee" stopOpacity=".9" /><stop offset="100%" stopColor="#0aa3be" stopOpacity=".25" /></linearGradient>
              <linearGradient id="ccBand" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#c084fc" stopOpacity=".35" /><stop offset="100%" stopColor="#c084fc" stopOpacity=".05" /></linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke={GRID} />
            <XAxis dataKey="label" tick={{ ...AXIS, fontSize: 10 }} tickLine={false} axisLine={false} interval={1} />
            <YAxis tick={AXIS} tickLine={false} axisLine={false} allowDecimals={false} />
            <Tooltip {...TIP} />
            <Area type="monotone" dataKey="band" name="Likely range" stroke="none" fill="url(#ccBand)" animationDuration={1600} />
            <Bar dataKey="actual" name="Actual" fill="url(#ccAct)" radius={[4, 4, 0, 0]} barSize={14} animationDuration={1200} />
            <Line type="monotone" dataKey="forecast" name="Forecast" stroke="#c084fc" strokeWidth={3} strokeDasharray="7 5" dot={{ r: 3.5, fill: '#c084fc', strokeWidth: 0 }} animationDuration={2000} connectNulls />
            {last && <ReferenceLine x={last.label} stroke="rgba(255,255,255,.25)" strokeDasharray="3 4" label={{ value: 'today', fill: '#8d9bbb', fontSize: 10, position: 'top' }} />}
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div className="relative mt-2 rounded-xl px-3 py-2.5 border flex items-start gap-2.5 min-h-[3.2rem]" style={{ borderColor: 'rgba(192,132,252,.3)', background: 'rgba(192,132,252,.07)' }}>
        <BrainCircuit className="w-4 h-4 shrink-0 mt-0.5" style={{ color: 'var(--violet)' }} />
        <p className="text-[.85rem] font-semibold" style={{ color: 'var(--head)' }}>
          {f.insights.length ? <Typed key={insight} text={f.insights[insight % f.insights.length]} /> : '—'}
        </p>
      </div>
    </div>
  )
}

// ── Already on the books: arrivals over the next 14 days ─────────────────────
export function AheadStrip({ ahead }: { ahead: View2Data['ahead'] }) {
  const max = Math.max(1, ...ahead.map(a => a.arrivals))
  const total = ahead.reduce((n, a) => n + a.arrivals, 0)
  const pax = ahead.reduce((n, a) => n + a.pax, 0)
  return (
    <div className="cc-panel cc-edge h-full p-4 flex flex-col" style={{ ['--edge' as string]: 'var(--pink)' }}>
      <PanelTitle icon={<CalendarClock className="w-4 h-4" />} right={<span className="cc-chip cc-num">{total} · {pax} pax</span>}>Arriving 14d</PanelTitle>
      <div className="flex-1 min-h-0 flex items-end gap-1">
        {ahead.map((a, i) => {
          const d = new Date(`${a.date}T00:00:00Z`)
          const wknd = [0, 6].includes(d.getUTCDay())
          return (
            <div key={a.date} className="flex-1 min-w-0 h-full flex flex-col items-center justify-end gap-1">
              <span className="cc-num text-[.72rem] font-extrabold" style={{ color: a.arrivals ? 'var(--head)' : 'var(--ink3)' }}>{a.arrivals || ''}</span>
              <div className="w-full rounded-t-md" style={{
                height: `${Math.max(4, (a.arrivals / max) * 100)}%`, transformOrigin: 'bottom', animation: `ccBar .8s cubic-bezier(.34,1.56,.64,1) ${i * 45}ms both`,
                background: i === 0 ? 'linear-gradient(180deg,#ff8fb8,#ff3d8b)' : 'linear-gradient(180deg,rgba(255,61,139,.85),rgba(255,61,139,.2))',
                boxShadow: i === 0 ? '0 0 14px rgba(255,61,139,.6)' : undefined,
              }} />
              <span className="text-[.58rem] font-bold cc-mono leading-none" style={{ color: i === 0 ? 'var(--head)' : wknd ? 'var(--pink)' : 'var(--ink3)' }}>
                {d.getUTCDate()}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Hourly ops activity (stacked) ────────────────────────────────────────────
const SERIES = [
  { key: 'bookings', label: 'TC received', color: '#22d3ee' },
  { key: 'actions', label: 'Workflow moves', color: '#2ee59d' },
  { key: 'agendas', label: 'Agendas built', color: '#c084fc' },
  { key: 'drivers', label: 'Drivers assigned', color: '#ffc857' },
] as const
export function HourlyFlow({ hours, nowHour }: { hours: HourRow[]; nowHour: number }) {
  const data = hours.map(h => ({ ...h, label: String(h.hour).padStart(2, '0') }))
  const busiest = hours.reduce((b, h) => {
    const t = h.bookings + h.actions + h.agendas + h.drivers
    return t > b.t ? { h: h.hour, t } : b
  }, { h: -1, t: 0 })
  return (
    <div className="cc-panel cc-edge h-full p-4 flex flex-col" style={{ ['--edge' as string]: 'var(--good)' }}>
      <PanelTitle icon={<Clock3 className="w-4 h-4" />}
        right={busiest.h >= 0 && <span className="cc-chip cc-num">peak {String(busiest.h).padStart(2, '0')}:00 · {busiest.t} actions</span>}>
        Floor Activity · by hour
      </PanelTitle>
      <div className="flex flex-wrap gap-x-3 gap-y-1 mb-1">
        {SERIES.map(s => (
          <span key={s.key} className="flex items-center gap-1.5 text-[.66rem] font-bold" style={{ color: 'var(--ink2)' }}>
            <i className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: s.color }} />{s.label}
          </span>
        ))}
      </div>
      <div className="flex-1 min-h-0">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 6, right: 4, left: -24, bottom: 0 }} barCategoryGap="14%">
            <CartesianGrid vertical={false} stroke={GRID} />
            <XAxis dataKey="label" tick={{ ...AXIS, fontSize: 9 }} tickLine={false} axisLine={false} interval={2} />
            <YAxis tick={AXIS} tickLine={false} axisLine={false} allowDecimals={false} />
            <Tooltip {...TIP} />
            <ReferenceLine x={String(nowHour).padStart(2, '0')} stroke="rgba(255,255,255,.35)" strokeDasharray="3 3" />
            {SERIES.map((s, i) => (
              <Bar key={s.key} dataKey={s.key} name={s.label} stackId="a" fill={s.color}
                radius={i === SERIES.length - 1 ? [3, 3, 0, 0] : undefined} animationDuration={900 + i * 250} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

// ── Feedback wall + satisfaction gauge ───────────────────────────────────────
export function FeedbackWall({ fb, now }: { fb: View2Data['feedback']; now: number }) {
  const [page, setPage] = useState(0)
  const per = 3
  const pages = Math.max(1, Math.ceil(fb.items.length / per))
  useEffect(() => {
    if (pages < 2) return
    const id = setInterval(() => setPage(p => (p + 1) % pages), 10_000)
    return () => clearInterval(id)
  }, [pages])
  const shown = fb.items.slice(page * per, page * per + per)

  const s = fb.stats
  const pct = s.avgStars != null ? s.avgStars / 5 : 0
  const R = 46, C = 2 * Math.PI * R
  const sent = s.sentiment
  const sentTotal = Object.values(sent).reduce((a, b) => a + b, 0)

  return (
    <div className="cc-panel cc-edge h-full p-4 flex flex-col" style={{ ['--edge' as string]: 'var(--gold)' }}>
      <PanelTitle icon={<MessageSquareHeart className="w-4 h-4" />} right={<span className="cc-chip cc-num">{s.count30} pieces of feedback · 30 days</span>}>
        Guest Voice
      </PanelTitle>
      <div className="flex-1 min-h-0 grid gap-3" style={{ gridTemplateColumns: '13rem 1fr' }}>
        <div className="flex flex-col items-center justify-center rounded-2xl border p-3" style={{ borderColor: 'var(--line)', background: 'rgba(255,200,87,.04)' }}>
          <div className="relative w-32 h-32">
            <svg viewBox="0 0 120 120" className="w-full h-full -rotate-90">
              <defs><linearGradient id="ccGold"><stop offset="0%" stopColor="#ffb547" /><stop offset="100%" stopColor="#ffe08a" /></linearGradient></defs>
              <circle cx="60" cy="60" r={R} stroke="rgba(255,255,255,.08)" strokeWidth="10" fill="none" />
              <circle cx="60" cy="60" r={R} stroke="url(#ccGold)" strokeWidth="10" fill="none" strokeLinecap="round"
                strokeDasharray={C} strokeDashoffset={C * (1 - pct)} style={{ transition: 'stroke-dashoffset 1.6s cubic-bezier(.2,.8,.2,1)', filter: 'drop-shadow(0 0 6px rgba(255,200,87,.6))' }} />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <p className="cc-num text-3xl font-extrabold leading-none" style={{ color: 'var(--head)' }}>{s.avgStars != null ? <Counter value={s.avgStars} decimals={1} /> : '—'}</p>
              <p className="text-[.58rem] uppercase tracking-[.2em] flex items-center gap-1 mt-1" style={{ color: 'var(--ink3)' }}><Star className="w-3 h-3" style={{ color: 'var(--gold)', fill: 'var(--gold)' }} />avg / 5</p>
            </div>
          </div>
          {s.recommendPct != null && (
            <p className="text-[.75rem] font-bold flex items-center gap-1.5" style={{ color: 'var(--good)' }}><ThumbsUp className="w-3.5 h-3.5" />{s.recommendPct}% would recommend</p>
          )}
          {sentTotal > 0 && (
            <div className="w-full mt-2">
              <div className="flex h-2 rounded-full overflow-hidden">
                {(['positive', 'neutral', 'mixed', 'negative'] as const).filter(k => sent[k]).map(k => (
                  <span key={k} style={{ width: `${(sent[k] / sentTotal) * 100}%`, background: k === 'positive' ? 'var(--good)' : k === 'negative' ? 'var(--crit)' : 'var(--warn)' }} />
                ))}
              </div>
              <p className="text-[.58rem] mt-1 text-center" style={{ color: 'var(--ink3)' }}>on-tour call mood · {sentTotal} calls</p>
            </div>
          )}
        </div>
        <div key={page} className="grid grid-cols-3 gap-3 min-h-0">
          {shown.map(f => <FeedbackCard key={f.id} f={f} now={now} big />)}
          {shown.length === 0 && <p className="text-sm col-span-3" style={{ color: 'var(--ink3)' }}>No feedback captured yet.</p>}
        </div>
      </div>
    </div>
  )
}
