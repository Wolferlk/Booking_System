import { NextRequest } from 'next/server'
import { BookingStatus, type OperationCountry } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { buildApiSuccess } from '@/lib/utils'
import { STATUS_LABELS } from '@/lib/state-machine'
import { DEFAULT_REPORT_TZ, clockInTz, dateInTz, shiftDate, zonedDayStart } from '@/lib/reports/report-window'
import { airport, place, vehicleKind, type OpCountry } from '@/lib/ops-geo'
import { resolveIsLeisure } from '@/lib/leisure-day'
import { resolveIsHotelOnly } from '@/lib/driver-requirement'

export const dynamic = 'force-dynamic'

/**
 * Public feed for the office "Command Center" screen (/view2).
 *
 * Same bargain as /api/public/view-dashboard: no login, no token, a TV loads
 * /view2 and it works forever — so everything here is aggregate or minimal.
 * No passenger names beyond a first name on feedback, no financials, no phone
 * numbers. Staff and driver first names only. Keep the link internal.
 *
 * Day boundaries follow the rest of the system (see booking-date-window.ts):
 * instants (`createdAt`, `assignedAt`, status events) are bucketed on Colombo
 * business days; `arrivalDate` / `departureDate` are calendar dates stored as
 * midnight UTC and keep UTC boundaries.
 *
 * Every section is read independently through `safe()` — live has schema drift,
 * and one missing table must blank one panel, never the whole screen.
 */

const TZ = DEFAULT_REPORT_TZ
const DAY = 86_400_000
const MAX_ON_GROUND = 150
const MAX_FLIGHTS = 60

async function safe<T>(label: string, fn: () => Promise<T>, fallback: T): Promise<T> {
  try { return await fn() } catch (err) {
    console.error(`[view2] ${label} failed:`, err instanceof Error ? err.message : err)
    return fallback
  }
}

const firstName = (s: string | null | undefined) => (s ?? '').trim().split(/\s+/)[0] || null

function opCountry(c: string | null | undefined): OpCountry | null {
  if (c === 'VIETNAM' || c === 'SRILANKA' || c === 'SINGAPORE' || c === 'MALAYSIA') return c
  return null
}

/** Guest-form grades onto a 5-star scale so all three feedback sources compare. */
const GRADE: Record<string, number> = { EXCELLENT: 5, GOOD: 4, AVERAGE: 3, POOR: 2 }

/** Post-tour call ratings arrive as 1–5 or 1–10 depending on the script. */
const toFive = (r: number | null | undefined) =>
  r == null ? null : r > 5 ? Math.round((r / 2) * 10) / 10 : r

const SENTIMENT_STARS: Record<string, number> = { positive: 5, neutral: 3, negative: 2, mixed: 3 }

/** Stages of the pipeline, in the order a file moves through them. */
const PIPELINE: BookingStatus[] = [
  'DRAFT', 'BT_CONFIRMED', 'GT_REVIEW', 'CHANGE_REQUESTED', 'GT_VERIFIED',
  'AWAITING_PAYMENT_CONFIRM', 'OPERATIONS_READY', 'CLIENT_LIVE', 'DRIVER_ALLOCATED',
  'QC1_PASS', 'TICKETS_ISSUED', 'QC2_PASS', 'MSG_SENT_CUSTOMER', 'IN_PROGRESS',
  'TE_REVIEWED', 'FEEDBACK_DONE',
]

export async function GET(_req: NextRequest) {
  const now = new Date()

  // ── Windows ────────────────────────────────────────────────────────────────
  const todayStr = dateInTz(now, TZ)
  const yStr = shiftDate(todayStr, -1)
  const tStart = zonedDayStart(todayStr, TZ)
  const yStart = zonedDayStart(yStr, TZ)
  const yNow = new Date(now.getTime() - DAY)
  const trendStart = zonedDayStart(shiftDate(todayStr, -27), TZ)

  // Calendar (UTC midnight) boundaries for arrival/departure columns.
  const calToday = new Date(`${todayStr}T00:00:00Z`)
  const calTomorrow = new Date(calToday.getTime() + DAY)
  const calYesterday = new Date(calToday.getTime() - DAY)
  const calPlus14 = new Date(calToday.getTime() + 14 * DAY)

  const notCancelled = { status: { not: BookingStatus.CANCELLED } }
  const onTourOn = (start: Date, end: Date) => ({
    ...notCancelled, arrivalDate: { lt: end }, departureDate: { gte: start },
  })

  const [
    created2d, events2d, agendas2d, assigns2d, guest2d, post2d, call2d,
    toursYesterday, toursToday, arrYesterday, arrToday, depYesterday, depToday,
    wipByStatus, trendCreated, trendConfirmed, upcomingArrivals,
    latestEvents, latestBookings, latestAgendas, latestAssigns,
    latestGuest, latestPost, latestCalls, feedback30,
    onGroundRows, agendaToday, flightRows,
  ] = await Promise.all([
    safe('created2d', () => prisma.booking.findMany({
      where: { createdAt: { gte: yStart } },
      select: { createdAt: true, status: true, operationCountry: true, createdById: true,
        createdBy: { select: { name: true } } },
    }), []),
    safe('events2d', () => prisma.statusEvent.findMany({
      where: { createdAt: { gte: yStart } },
      select: { createdAt: true, toState: true, actorId: true, actor: { select: { name: true, role: true } } },
    }), []),
    safe('agendas2d', () => prisma.tourAgenda.findMany({
      where: { createdAt: { gte: yStart } }, select: { createdAt: true },
    }), []),
    safe('assigns2d', () => prisma.assignment.findMany({
      where: { assignedAt: { gte: yStart }, driverName: { not: null } }, select: { assignedAt: true },
    }), []),
    safe('guest2d', () => prisma.guestFeedbackForm.findMany({
      where: { submittedAt: { gte: yStart } }, select: { submittedAt: true },
    }), []),
    safe('post2d', () => prisma.tbl_te_post_tour.findMany({
      where: { created_at: { gte: yStart } }, select: { created_at: true },
    }), []),
    safe('call2d', () => prisma.tbl_te_feedback.findMany({
      where: { created_at: { gte: yStart } }, select: { created_at: true },
    }), []),

    safe('toursY', () => prisma.booking.count({ where: onTourOn(calYesterday, calToday) }), 0),
    safe('toursT', () => prisma.booking.count({ where: onTourOn(calToday, calTomorrow) }), 0),
    safe('arrY', () => prisma.booking.count({ where: { ...notCancelled, arrivalDate: { gte: calYesterday, lt: calToday } } }), 0),
    safe('arrT', () => prisma.booking.count({ where: { ...notCancelled, arrivalDate: { gte: calToday, lt: calTomorrow } } }), 0),
    safe('depY', () => prisma.booking.count({ where: { ...notCancelled, departureDate: { gte: calYesterday, lt: calToday } } }), 0),
    safe('depT', () => prisma.booking.count({ where: { ...notCancelled, departureDate: { gte: calToday, lt: calTomorrow } } }), 0),

    // Live work-in-progress: every file still ahead of us (not finished, not
    // cancelled, not already flown home), by the stage it sits in.
    safe('wip', () => prisma.booking.groupBy({
      by: ['status'],
      where: { status: { in: PIPELINE }, departureDate: { gte: calToday } },
      _count: { id: true },
    }), []),

    safe('trendCreated', () => prisma.booking.findMany({
      where: { ...notCancelled, createdAt: { gte: trendStart } }, select: { createdAt: true },
    }), []),
    safe('trendConfirmed', () => prisma.statusEvent.findMany({
      where: { toState: BookingStatus.BT_CONFIRMED, createdAt: { gte: trendStart } }, select: { createdAt: true },
    }), []),
    safe('upcomingArrivals', () => prisma.booking.findMany({
      where: { ...notCancelled, arrivalDate: { gte: calToday, lt: calPlus14 } },
      select: { arrivalDate: true, paxAdults: true, paxChildren: true, operationCountry: true },
    }), []),

    // ── Live activity stream ──
    safe('latestEvents', () => prisma.statusEvent.findMany({
      orderBy: { createdAt: 'desc' }, take: 18,
      select: { id: true, createdAt: true, fromState: true, toState: true,
        actor: { select: { name: true } },
        booking: { select: { bookingRef: true, operationCountry: true } } },
    }), []),
    safe('latestBookings', () => prisma.booking.findMany({
      where: notCancelled, orderBy: { createdAt: 'desc' }, take: 10,
      select: { id: true, bookingRef: true, agent: true, operationCountry: true,
        paxAdults: true, paxChildren: true, arrivalDate: true, createdAt: true },
    }), []),
    safe('latestAgendas', () => prisma.tourAgenda.findMany({
      orderBy: { createdAt: 'desc' }, take: 8,
      select: { id: true, createdAt: true, _count: { select: { items: true } },
        booking: { select: { bookingRef: true, operationCountry: true } } },
    }), []),
    safe('latestAssigns', () => prisma.assignment.findMany({
      where: { driverName: { not: null } }, orderBy: { assignedAt: 'desc' }, take: 10,
      select: { id: true, assignedAt: true, driverName: true, vehicleType: true,
        agendaItem: { select: { location: true, toPoint: true, date: true,
          agenda: { select: { booking: { select: { bookingRef: true, operationCountry: true } } } } } } },
    }), []),

    // ── Feedback ──
    safe('latestGuest', () => prisma.guestFeedbackForm.findMany({
      orderBy: { submittedAt: 'desc' }, take: 8,
      select: { id: true, submittedAt: true, overallExperience: true, transportDriver: true,
        accommodationRoom: true, remarks: true, clientName: true,
        booking: { select: { bookingRef: true, operationCountry: true } } },
    }), []),
    safe('latestPost', () => prisma.tbl_te_post_tour.findMany({
      orderBy: { created_at: 'desc' }, take: 8,
      select: { id: true, created_at: true, booking_ref: true, rating: true, comment: true,
        best_moment: true, summary: true, sentiment: true, would_recommend: true },
    }), []),
    safe('latestCalls', () => prisma.tbl_te_feedback.findMany({
      where: { OR: [{ highlights: { not: null } }, { summary: { not: null } }] },
      orderBy: { created_at: 'desc' }, take: 8,
      select: { id: true, created_at: true, booking_ref: true, sentiment: true,
        highlights: true, summary: true, day_no: true },
    }), []),
    safe('feedback30', () => Promise.all([
      prisma.guestFeedbackForm.findMany({
        where: { submittedAt: { gte: new Date(now.getTime() - 30 * DAY) } },
        select: { overallExperience: true },
      }),
      prisma.tbl_te_post_tour.findMany({
        where: { created_at: { gte: new Date(now.getTime() - 30 * DAY) }, rating: { not: null } },
        select: { rating: true, would_recommend: true },
      }),
      prisma.tbl_te_feedback.groupBy({
        by: ['sentiment'],
        where: { created_at: { gte: new Date(now.getTime() - 30 * DAY) } },
        _count: { _all: true },
      }),
    ]), [[], [], []] as const),

    // ── Map: who is on the ground right now and where ──
    safe('onGround', () => prisma.booking.findMany({
      where: onTourOn(calToday, calTomorrow),
      select: { id: true, operationCountry: true, tourDestination: true,
        paxAdults: true, paxChildren: true, arrivalDate: true, departureDate: true },
      orderBy: { arrivalDate: 'asc' }, take: MAX_ON_GROUND,
    }), []),
    safe('agendaToday', () => prisma.agendaItem.findMany({
      where: { date: { gte: calToday, lt: calTomorrow }, agenda: { booking: onTourOn(calToday, calTomorrow) } },
      select: { id: true, location: true, fromPoint: true, toPoint: true, details: true, serviceType: true,
        isLeisure: true, isHotelOnly: true, sortOrder: true,
        agenda: { select: { bookingId: true } },
        assignment: { select: { driverName: true, vehicleType: true, vehiclePlate: true } } },
      orderBy: [{ date: 'asc' }, { sortOrder: 'asc' }],
    }), []),
    safe('flights', () => prisma.flight.findMany({
      where: { date: { gte: calToday, lt: calTomorrow }, booking: notCancelled },
      select: { id: true, flightNo: true, airline: true, depTime: true, arrTime: true, fromApt: true, toApt: true,
        booking: { select: { operationCountry: true, paxAdults: true, paxChildren: true } } },
      take: MAX_FLIGHTS,
    }), []),
  ])

  // ── Yesterday vs today ─────────────────────────────────────────────────────
  // Three columns for every instant metric: yesterday's full day, yesterday up
  // to this same minute (the honest comparison for a day still running), today.
  const tri = (ts: Date[]) => {
    let y = 0, ySoFar = 0, t = 0
    for (const d of ts) {
      if (d >= tStart) t++
      else if (d >= yStart) { y++; if (d < yNow) ySoFar++ }
    }
    return { yesterday: y, yesterdaySoFar: ySoFar, today: t }
  }
  const createdLive = created2d.filter(b => b.status !== 'CANCELLED')
  const compare = [
    { key: 'received', label: 'TC Received', ...tri(createdLive.map(b => b.createdAt)) },
    { key: 'confirmed', label: 'Confirmed', ...tri(events2d.filter(e => e.toState === 'BT_CONFIRMED').map(e => e.createdAt)) },
    { key: 'clientConfirmed', label: 'Client Confirmed', ...tri(events2d.filter(e => e.toState === 'GT_VERIFIED').map(e => e.createdAt)) },
    { key: 'agendas', label: 'Agendas', ...tri(agendas2d.map(a => a.createdAt)) },
    { key: 'drivers', label: 'Drivers Assigned', ...tri(assigns2d.map(a => a.assignedAt)) },
    { key: 'feedback', label: 'Feedback', ...tri([...guest2d.map(g => g.submittedAt), ...post2d.map(p => p.created_at), ...call2d.map(c => c.created_at)]) },
    { key: 'tours', label: 'Tours Running', yesterday: toursYesterday, yesterdaySoFar: toursYesterday, today: toursToday },
    { key: 'arrivals', label: 'Arrivals', yesterday: arrYesterday, yesterdaySoFar: arrYesterday, today: arrToday },
    { key: 'departures', label: 'Departures', yesterday: depYesterday, yesterdaySoFar: depYesterday, today: depToday },
  ]

  // ── Today, hour by hour (Colombo clock) ────────────────────────────────────
  const hourly = Array.from({ length: 24 }, (_, h) => ({ hour: h, bookings: 0, actions: 0, agendas: 0, drivers: 0 }))
  const hourOf = (d: Date) => clockInTz(d, TZ).hour
  for (const b of createdLive) if (b.createdAt >= tStart) hourly[hourOf(b.createdAt)].bookings++
  for (const e of events2d) if (e.createdAt >= tStart) hourly[hourOf(e.createdAt)].actions++
  for (const a of agendas2d) if (a.createdAt >= tStart) hourly[hourOf(a.createdAt)].agendas++
  for (const a of assigns2d) if (a.assignedAt >= tStart) hourly[hourOf(a.assignedAt)].drivers++

  // ── Processed today, by stage reached ──────────────────────────────────────
  const movedToday: Record<string, number> = {}
  for (const e of events2d) if (e.createdAt >= tStart) movedToday[e.toState] = (movedToday[e.toState] ?? 0) + 1
  const wipMap: Record<string, number> = {}
  for (const r of wipByStatus) wipMap[r.status] = r._count.id
  const pipeline = PIPELINE
    .map(s => ({ status: s, label: STATUS_LABELS[s] ?? s, wip: wipMap[s] ?? 0, movedToday: movedToday[s] ?? 0 }))
    .filter(p => p.wip > 0 || p.movedToday > 0)

  // ── Team: who processed what today ─────────────────────────────────────────
  const team = new Map<string, { name: string; role: string | null; actions: number; created: number; stages: Record<string, number> }>()
  const member = (id: string, name: string | null | undefined, role: string | null) => {
    let m = team.get(id)
    if (!m) { m = { name: firstName(name) ?? 'Team', role, actions: 0, created: 0, stages: {} }; team.set(id, m) }
    return m
  }
  for (const e of events2d) {
    if (e.createdAt < tStart) continue
    const m = member(e.actorId, e.actor?.name, e.actor?.role ?? null)
    m.actions++
    m.stages[e.toState] = (m.stages[e.toState] ?? 0) + 1
  }
  for (const b of createdLive) {
    if (b.createdAt < tStart) continue
    member(b.createdById, b.createdBy?.name, null).created++
  }
  const leaderboard = Array.from(team.values())
    .map(m => {
      const top = Object.entries(m.stages).sort((a, b) => b[1] - a[1])[0]
      return { name: m.name, role: m.role, actions: m.actions, created: m.created,
        total: m.actions + m.created, topStage: top ? STATUS_LABELS[top[0] as BookingStatus] ?? top[0] : null }
    })
    .sort((a, b) => b.total - a.total)
    .slice(0, 8)

  // ── 4-week trend (Colombo days) ────────────────────────────────────────────
  const days = Array.from({ length: 28 }, (_, i) => shiftDate(todayStr, i - 27))
  const dayIdx = new Map(days.map((d, i) => [d, i]))
  const trend = days.map(d => ({ date: d, received: 0, confirmed: 0 }))
  for (const b of trendCreated) { const i = dayIdx.get(dateInTz(b.createdAt, TZ)); if (i != null) trend[i].received++ }
  for (const e of trendConfirmed) { const i = dayIdx.get(dateInTz(e.createdAt, TZ)); if (i != null) trend[i].confirmed++ }

  // Known future: tours already booked to land over the next 14 days.
  const ahead = Array.from({ length: 14 }, (_, i) => ({
    date: shiftDate(todayStr, i), arrivals: 0, pax: 0, byCountry: {} as Record<string, number>,
  }))
  for (const b of upcomingArrivals) {
    const i = Math.floor((b.arrivalDate.getTime() - calToday.getTime()) / DAY)
    if (i < 0 || i >= 14) continue
    ahead[i].arrivals++
    ahead[i].pax += b.paxAdults + b.paxChildren
    if (b.operationCountry) ahead[i].byCountry[b.operationCountry] = (ahead[i].byCountry[b.operationCountry] ?? 0) + 1
  }

  // ── Activity stream ────────────────────────────────────────────────────────
  type FeedItem = { id: string; kind: string; at: string; title: string; sub: string; country: OperationCountry | null }
  const feed: FeedItem[] = []
  for (const e of latestEvents) feed.push({
    id: `ev-${e.id}`, kind: e.toState === 'CANCELLED' || e.toState === 'PENDING_CANCELLATION' ? 'cancel' : 'status',
    at: e.createdAt.toISOString(),
    title: `${e.booking?.bookingRef ?? '—'} → ${STATUS_LABELS[e.toState] ?? e.toState}`,
    sub: `by ${firstName(e.actor?.name) ?? 'system'}`,
    country: e.booking?.operationCountry ?? null,
  })
  for (const b of latestBookings) feed.push({
    id: `bk-${b.id}`, kind: 'booking', at: b.createdAt.toISOString(),
    title: `New booking ${b.bookingRef}`,
    sub: `${b.paxAdults + b.paxChildren} pax · ${b.agent || 'Direct'}`,
    country: b.operationCountry,
  })
  for (const a of latestAgendas) feed.push({
    id: `ag-${a.id}`, kind: 'agenda', at: a.createdAt.toISOString(),
    title: `Agenda built · ${a.booking?.bookingRef ?? '—'}`,
    sub: `${a._count.items} movements planned`,
    country: a.booking?.operationCountry ?? null,
  })
  for (const a of latestAssigns) feed.push({
    id: `as-${a.id}`, kind: 'driver', at: a.assignedAt.toISOString(),
    title: `${firstName(a.driverName)} assigned · ${a.agendaItem?.agenda?.booking?.bookingRef ?? '—'}`,
    sub: [a.agendaItem?.toPoint || a.agendaItem?.location, a.vehicleType].filter(Boolean).join(' · ').slice(0, 80),
    country: a.agendaItem?.agenda?.booking?.operationCountry ?? null,
  })
  feed.sort((a, b) => b.at.localeCompare(a.at))

  // ── Feedback wall ──────────────────────────────────────────────────────────
  const refs = Array.from(new Set([...latestPost.map(p => p.booking_ref), ...latestCalls.map(c => c.booking_ref)]))
  const refCountry = new Map<string, OperationCountry | null>()
  if (refs.length) {
    const rows = await safe('refCountry', () => prisma.booking.findMany({
      where: { bookingRef: { in: refs } }, select: { bookingRef: true, operationCountry: true },
    }), [])
    for (const r of rows) refCountry.set(r.bookingRef, r.operationCountry)
  }
  type FeedbackItem = { id: string; source: 'guest_form' | 'post_tour' | 'on_tour_call'; at: string; bookingRef: string | null
    country: OperationCountry | null; stars: number | null; sentiment: string | null; text: string; who: string | null }
  const feedbackItems: FeedbackItem[] = []
  for (const g of latestGuest) {
    const text = (g.remarks ?? '').trim()
    feedbackItems.push({
      id: `gf-${g.id}`, source: 'guest_form', at: g.submittedAt.toISOString(),
      bookingRef: g.booking?.bookingRef ?? null, country: g.booking?.operationCountry ?? null,
      stars: g.overallExperience ? GRADE[g.overallExperience] ?? null : null,
      sentiment: g.overallExperience === 'POOR' ? 'negative' : g.overallExperience ? 'positive' : null,
      text: text || `Overall experience: ${(g.overallExperience ?? '—').toLowerCase()}`,
      who: firstName(g.clientName),
    })
  }
  for (const p of latestPost) {
    const text = (p.comment || p.best_moment || p.summary || '').trim()
    if (!text && p.rating == null) continue
    feedbackItems.push({
      id: `pt-${p.id}`, source: 'post_tour', at: p.created_at.toISOString(),
      bookingRef: p.booking_ref, country: refCountry.get(p.booking_ref) ?? null,
      stars: toFive(p.rating), sentiment: p.sentiment, text: text || 'Rated the trip on the post-tour call', who: null,
    })
  }
  for (const c of latestCalls) {
    const text = (c.highlights || c.summary || '').trim()
    if (!text) continue
    feedbackItems.push({
      id: `tc-${c.id}`, source: 'on_tour_call', at: c.created_at.toISOString(),
      bookingRef: c.booking_ref, country: refCountry.get(c.booking_ref) ?? null,
      stars: c.sentiment ? SENTIMENT_STARS[c.sentiment.toLowerCase()] ?? null : null,
      sentiment: c.sentiment, text: c.day_no ? `Day ${c.day_no}: ${text}` : text, who: null,
    })
  }
  feedbackItems.sort((a, b) => b.at.localeCompare(a.at))

  const [guest30, post30, calls30] = feedback30
  const ratings = [
    ...guest30.map(g => (g.overallExperience ? GRADE[g.overallExperience] : null)),
    ...post30.map(p => toFive(p.rating)),
  ].filter((n): n is number => n != null)
  const sentimentCounts: Record<string, number> = {}
  for (const r of calls30) if (r.sentiment) sentimentCounts[r.sentiment.toLowerCase()] = r._count._all
  const recommend = post30.filter(p => p.would_recommend != null)
  const feedbackStats = {
    count30: guest30.length + post30.length + calls30.reduce((n, r) => n + r._count._all, 0),
    avgStars: ratings.length ? Math.round((ratings.reduce((a, b) => a + b, 0) / ratings.length) * 10) / 10 : null,
    ratedCount: ratings.length,
    recommendPct: recommend.length ? Math.round((recommend.filter(p => p.would_recommend).length / recommend.length) * 100) : null,
    sentiment: sentimentCounts,
  }

  // ── Map ────────────────────────────────────────────────────────────────────
  // Pins are cities, not files: "6 groups · 18 pax in Kandy" reads across a room
  // and names nobody. Pin choice mirrors /api/dashboard/live-ops.
  const movesByBooking = new Map<string, typeof agendaToday>()
  for (const it of agendaToday) {
    const list = movesByBooking.get(it.agenda.bookingId)
    if (list) list.push(it); else movesByBooking.set(it.agenda.bookingId, [it])
  }
  const cities = new Map<string, { name: string; lat: number; lng: number; country: string | null; groups: number; pax: number; arriving: number }>()
  const legs = new Map<string, { from: { name: string; lat: number; lng: number }; to: { name: string; lat: number; lng: number }; groups: number; country: string | null }>()
  const countryRoll = new Map<string, { groups: number; pax: number; pinned: number }>()
  for (const b of onGroundRows) {
    const oc = opCountry(b.operationCountry)
    const first = movesByBooking.get(b.id)?.[0] ?? null
    const legFrom = place(first?.fromPoint, oc)
    const legTo = place(first?.toPoint, oc) ?? place(first?.location, oc)
    const pin = legTo ?? legFrom ?? place(b.tourDestination, oc)
    const pax = b.paxAdults + b.paxChildren
    const cKey = b.operationCountry ?? 'UNASSIGNED'
    const roll = countryRoll.get(cKey) ?? { groups: 0, pax: 0, pinned: 0 }
    roll.groups++; roll.pax += pax
    countryRoll.set(cKey, roll)
    if (pin) {
      roll.pinned++
      const c = cities.get(pin.name) ?? { name: pin.name, lat: pin.lat, lng: pin.lng, country: b.operationCountry, groups: 0, pax: 0, arriving: 0 }
      c.groups++; c.pax += pax
      if (b.arrivalDate >= calToday) c.arriving++
      cities.set(pin.name, c)
    }
    if (legFrom && legTo && legFrom.name !== legTo.name) {
      const k = `${legFrom.name}>${legTo.name}`
      const l = legs.get(k) ?? { from: legFrom, to: legTo, groups: 0, country: b.operationCountry }
      l.groups++
      legs.set(k, l)
    }
  }

  // Fleet on the road — distinct vehicles, same rule as live-ops.
  const seenVehicle = new Set<string>(), seenDriver = new Set<string>()
  let unassigned = 0, needDriver = 0
  for (const it of agendaToday) {
    const a = it.assignment
    const needs = !resolveIsHotelOnly(it) && !resolveIsLeisure(it)
    if (needs) { needDriver++; if (!a?.driverName && !a?.vehiclePlate) unassigned++ }
    if (!a) continue
    if (a.driverName?.trim()) seenDriver.add(a.driverName.trim().toLowerCase())
    if (vehicleKind(a.vehicleType) === 'none') continue
    const k = (a.vehiclePlate?.trim() || a.driverName?.trim() || '').toLowerCase()
    if (k) seenVehicle.add(k)
  }

  const clock = clockInTz(now, TZ)
  const nowMin = clock.hour * 60 + clock.minute
  const minutesOf = (t: string | null) => {
    const m = String(t ?? '').trim().match(/^(\d{1,2})[:.\s]?(\d{2})/)
    if (!m) return null
    const h = Number(m[1]), mm = Number(m[2])
    return h > 23 || mm > 59 ? null : h * 60 + mm
  }
  const flights = flightRows.flatMap(f => {
    const from = airport(f.fromApt), to = airport(f.toApt)
    if (!from || !to) return []
    const dep = minutesOf(f.depTime), arr = minutesOf(f.arrTime)
    const sameDay = dep != null && arr != null && arr > dep
    const phase = dep == null ? 'unknown' : nowMin < dep ? 'scheduled' : sameDay && nowMin >= arr! ? 'landed' : sameDay ? 'airborne' : 'landed'
    const progress = sameDay && phase === 'airborne' ? (nowMin - dep!) / (arr! - dep!) : phase === 'landed' ? 1 : 0
    return [{
      id: f.id, flightNo: f.flightNo, airline: f.airline, depTime: f.depTime, arrTime: f.arrTime,
      from: { iata: from.iata, city: from.city, lat: from.lat, lng: from.lng },
      to: { iata: to.iata, city: to.city, lat: to.lat, lng: to.lng },
      pax: (f.booking?.paxAdults ?? 0) + (f.booking?.paxChildren ?? 0),
      country: f.booking?.operationCountry ?? null, phase, progress,
    }]
  })

  return buildApiSuccess({
    generatedAt: now.toISOString(),
    tz: TZ,
    today: todayStr,
    compare,
    hourly,
    pipeline,
    leaderboard,
    trend,
    ahead,
    feed: feed.slice(0, 30),
    feedback: { items: feedbackItems.slice(0, 12), stats: feedbackStats },
    ops: {
      movementsToday: agendaToday.length,
      movementsNeedingDriver: needDriver,
      unassignedMovements: unassigned,
      driversOnRoad: seenDriver.size,
      vehiclesOnRoad: seenVehicle.size,
      actionsToday: events2d.filter(e => e.createdAt >= tStart).length,
      activeStaffToday: team.size,
    },
    map: {
      cities: Array.from(cities.values()).sort((a, b) => b.pax - a.pax),
      legs: Array.from(legs.values()),
      flights,
      countries: Object.fromEntries(countryRoll),
    },
  })
}
