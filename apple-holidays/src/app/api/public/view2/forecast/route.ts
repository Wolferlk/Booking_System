import { NextResponse } from 'next/server'
import { BookingStatus } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import openai, { logAiUsage } from '@/lib/openai'
import { DEFAULT_REPORT_TZ, dateInTz, dayOfWeek, shiftDate, zonedDayStart } from '@/lib/reports/report-window'

export const dynamic = 'force-dynamic'

/**
 * Booking forecast for the Command Center screen (/view2).
 *
 * Eight weeks of daily intake plus the tours already on the books for the next
 * two weeks go to gpt-4o-mini, which returns a 7-day intake forecast with a
 * band and a few plain-English insights. The model is asked to *adjust* a
 * deterministic baseline (same-weekday mean × recent momentum), not to invent
 * numbers from nothing — and if the call fails, the baseline is served as-is,
 * labelled as such. The screen must never go blank because OpenAI is down.
 *
 * Cached for 3 hours in memory and in `system_settings` (Amplify Lambdas are
 * short-lived; a cold start must not trigger a fresh paid call), so a wall of
 * TVs polling this costs roughly eight small calls a day.
 */

const TZ = DEFAULT_REPORT_TZ
const DAY = 86_400_000
const TTL_MS = 3 * 60 * 60 * 1000
const CACHE_KEY = 'view2_forecast_cache'
const MODEL = 'gpt-4o-mini'
const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

interface ForecastDay { date: string; weekday: string; bookings: number; low: number; high: number }
interface ForecastPayload {
  generatedAt: string
  source: 'openai' | 'baseline'
  model: string | null
  headline: string
  insights: string[]
  confidence: 'low' | 'medium' | 'high'
  nextWeekTotal: number
  lastWeekTotal: number
  history: { date: string; received: number; confirmed: number }[]
  forecast: ForecastDay[]
  ahead: { date: string; arrivals: number }[]
}

let memo: ForecastPayload | null = null

const clampInt = (n: unknown, lo = 0, hi = 10_000) => {
  const v = Math.round(Number(n))
  return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : lo
}

export async function GET() {
  const fresh = (p: ForecastPayload | null) => !!p && Date.now() - new Date(p.generatedAt).getTime() < TTL_MS

  if (fresh(memo)) return NextResponse.json({ success: true, data: memo, cached: 'memory' })

  try {
    const row = await prisma.systemSetting.findUnique({ where: { key: CACHE_KEY } })
    if (row) {
      const p = JSON.parse(row.value) as ForecastPayload
      if (fresh(p)) { memo = p; return NextResponse.json({ success: true, data: p, cached: 'db' }) }
    }
  } catch { /* cache miss is fine */ }

  try {
    const payload = await build()
    memo = payload
    try {
      await prisma.systemSetting.upsert({
        where: { key: CACHE_KEY },
        create: { key: CACHE_KEY, value: JSON.stringify(payload) },
        update: { value: JSON.stringify(payload) },
      })
    } catch (err) { console.error('[view2/forecast] cache write failed:', err) }
    return NextResponse.json({ success: true, data: payload })
  } catch (err) {
    console.error('[view2/forecast] failed:', err)
    // Serve a stale forecast over nothing at all.
    if (memo) return NextResponse.json({ success: true, data: memo, cached: 'stale' })
    return NextResponse.json({ success: false, error: 'Forecast unavailable' }, { status: 200 })
  }
}

async function build(): Promise<ForecastPayload> {
  const now = new Date()
  const today = dateInTz(now, TZ)
  const start = zonedDayStart(shiftDate(today, -56), TZ)
  const calToday = new Date(`${today}T00:00:00Z`)

  const [created, confirmed, upcoming] = await Promise.all([
    prisma.booking.findMany({
      where: { status: { not: BookingStatus.CANCELLED }, createdAt: { gte: start } },
      select: { createdAt: true },
    }),
    prisma.statusEvent.findMany({
      where: { toState: BookingStatus.BT_CONFIRMED, createdAt: { gte: start } },
      select: { createdAt: true },
    }),
    prisma.booking.findMany({
      where: { status: { not: BookingStatus.CANCELLED }, arrivalDate: { gte: calToday, lt: new Date(calToday.getTime() + 14 * DAY) } },
      select: { arrivalDate: true },
    }),
  ])

  // 56 complete days, ending yesterday — today is still running and would drag
  // every weekday mean down.
  const days = Array.from({ length: 56 }, (_, i) => shiftDate(today, i - 56))
  const idx = new Map(days.map((d, i) => [d, i]))
  const history = days.map(d => ({ date: d, received: 0, confirmed: 0 }))
  for (const b of created) { const i = idx.get(dateInTz(b.createdAt, TZ)); if (i != null) history[i].received++ }
  for (const e of confirmed) { const i = idx.get(dateInTz(e.createdAt, TZ)); if (i != null) history[i].confirmed++ }

  const ahead = Array.from({ length: 14 }, (_, i) => ({ date: shiftDate(today, i), arrivals: 0 }))
  for (const b of upcoming) {
    const i = Math.floor((b.arrivalDate.getTime() - calToday.getTime()) / DAY)
    if (i >= 0 && i < 14) ahead[i].arrivals++
  }

  // ── Baseline: last-4-weeks same-weekday mean × momentum ────────────────────
  const last28 = history.slice(-28)
  const sum = (a: number[]) => a.reduce((x, y) => x + y, 0)
  const recent14 = sum(history.slice(-14).map(h => h.received))
  const prior14 = sum(history.slice(-28, -14).map(h => h.received))
  const momentum = prior14 > 0 ? Math.min(1.3, Math.max(0.7, recent14 / prior14)) : 1
  const byWeekday = Array.from({ length: 7 }, (_, wd) => last28.filter(h => dayOfWeek(h.date) === wd).map(h => h.received))
  const baseline: ForecastDay[] = Array.from({ length: 7 }, (_, i) => {
    const date = shiftDate(today, i + 1)
    const wd = dayOfWeek(date)
    const vals = byWeekday[wd]
    const mean = vals.length ? sum(vals) / vals.length : 0
    const sd = vals.length > 1 ? Math.sqrt(sum(vals.map(v => (v - mean) ** 2)) / (vals.length - 1)) : mean * 0.3
    const point = mean * momentum
    return { date, weekday: WEEKDAY[wd], bookings: Math.round(point), low: Math.max(0, Math.round(point - sd)), high: Math.round(point + sd) }
  })

  const lastWeekTotal = sum(history.slice(-7).map(h => h.received))
  const base: ForecastPayload = {
    generatedAt: now.toISOString(),
    source: 'baseline',
    model: null,
    headline: `About ${sum(baseline.map(b => b.bookings))} new bookings expected over the next 7 days`,
    insights: [
      `Momentum ${momentum >= 1 ? 'up' : 'down'} ${Math.abs(Math.round((momentum - 1) * 100))}% on the previous fortnight`,
      `${sum(ahead.slice(0, 7).map(a => a.arrivals))} tours already booked to arrive this week`,
    ],
    confidence: 'medium',
    nextWeekTotal: sum(baseline.map(b => b.bookings)),
    lastWeekTotal,
    history: history.slice(-28),
    forecast: baseline,
    ahead,
  }

  if (!process.env.OPENAI_API_KEY) return base

  try {
    const prompt = {
      today,
      timezone: TZ,
      business: 'Inbound tour operator (Vietnam, Sri Lanka, Singapore, Malaysia). "received" = new tour bookings filed that day; "confirmed" = bookings confirmed by the booking team that day.',
      dailyHistory: history.map(h => ({ ...h, weekday: WEEKDAY[dayOfWeek(h.date)] })),
      toursAlreadyArrivingNext14Days: ahead,
      statisticalBaseline: baseline,
    }
    const res = await openai.chat.completions.create({
      model: MODEL,
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content:
          'You are a demand forecaster for a travel operations team. Forecast new bookings ("received") for each of the next 7 dates. ' +
          'Start from statisticalBaseline and adjust only when the history clearly supports it (weekday pattern, trend, recent spikes). ' +
          'Integers only. Return JSON: {"forecast":[{"date":"YYYY-MM-DD","bookings":int,"low":int,"high":int}],' +
          '"headline":"one short sentence for a wall screen, max 90 chars",' +
          '"insights":["3 short, specific observations, each max 80 chars, plain English, no jargon"],' +
          '"confidence":"low|medium|high"}' },
        { role: 'user', content: JSON.stringify(prompt) },
      ],
    })
    await logAiUsage({ callType: 'view2_forecast', model: MODEL, usage: res.usage, source: 'view2' })

    const j = JSON.parse(res.choices[0]?.message?.content ?? '{}')
    const byDate = new Map<string, { bookings: unknown; low: unknown; high: unknown }>(
      Array.isArray(j.forecast) ? j.forecast.map((f: { date: string }) => [f.date, f]) : [],
    )
    // Keep the baseline's dates; take the model's numbers where it gave them.
    const forecast = baseline.map(b => {
      const f = byDate.get(b.date)
      if (!f) return b
      const point = clampInt(f.bookings)
      const low = Math.min(point, clampInt(f.low))
      const high = Math.max(point, clampInt(f.high))
      return { ...b, bookings: point, low, high }
    })
    const insights = Array.isArray(j.insights)
      ? j.insights.filter((s: unknown) => typeof s === 'string' && s.trim()).slice(0, 4).map((s: string) => s.slice(0, 120))
      : []

    return {
      ...base,
      source: 'openai',
      model: MODEL,
      headline: typeof j.headline === 'string' && j.headline.trim() ? j.headline.slice(0, 140) : base.headline,
      insights: insights.length ? insights : base.insights,
      confidence: ['low', 'medium', 'high'].includes(j.confidence) ? j.confidence : 'medium',
      forecast,
      nextWeekTotal: sum(forecast.map(f => f.bookings)),
    }
  } catch (err) {
    console.error('[view2/forecast] OpenAI call failed, serving baseline:', err instanceof Error ? err.message : err)
    return base
  }
}
