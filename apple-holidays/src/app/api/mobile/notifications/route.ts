/**
 * GET  /api/mobile/notifications           — latest 50 for the signed-in user,
 *                                            plus (drivers) `pinned`: what is
 *                                            happening today, built live
 *                                            from the trips and the running day
 * POST /api/mobile/notifications { ids? }  — mark read (all when ids omitted)
 */
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { buildApiSuccess } from '@/lib/utils'
import { actorIdOf, requireActor } from '@/lib/mobile/auth'
import { mobileRoute, readJson } from '@/lib/mobile/http'
import { loadDriverTrips, localTodayFor } from '@/lib/mobile/trips'

export const dynamic = 'force-dynamic'

function who(actor: Awaited<ReturnType<typeof requireActor>>) {
  return { actorType: actor.kind, actorId: actorIdOf(actor) }
}

interface Pinned {
  key: string
  kind: 'DAY_RUNNING' | 'DAY_DONE' | 'TODAY_PLAN'
  title: string
  body: string
  bookingRef: string
  live: boolean
  km: number | null
  startedAt: string | null
}

/** Today's trips for this driver, as cards: running day, day done, or today's plan. */
async function pinnedFor(driverId: string, country: string | null): Promise<Pinned[]> {
  const today = localTodayFor(country)
  const trips = await loadDriverTrips(driverId, today, today)
  const [sessions, days] = await Promise.all([
    prisma.mobileTripSession.findMany({ where: { driverId, bookingId: { in: trips.map(t => t.bookingId) } }, select: { bookingId: true, status: true } }),
    prisma.mobileTripDay.findMany({ where: { driverId, OR: [{ status: 'STARTED' }, { dayDate: today }] }, orderBy: { startedAt: 'desc' } }),
  ])
  const out: Pinned[] = []
  for (const t of trips) {
    const session = sessions.find(s => s.bookingId === t.bookingId)
    if (session && session.status !== 'ACTIVE') continue
    const plan = t.days.find(d => d.date === today)
    const day = days.find(d => d.bookingRef === t.bookingRef && (d.status === 'STARTED' || d.dayDate === today))
    const dayLabel = plan ? `Day ${plan.dayNo}` : 'Today'
    if (day?.status === 'STARTED') {
      const km = Math.round(Number(day.distanceKm) * 10) / 10
      out.push({ key: `run:${day.id}`, kind: 'DAY_RUNNING', title: `${dayLabel} running · ${t.fileNo}`, body: `${km.toFixed(1)} km so far. Swipe "End day" when you finish.`, bookingRef: t.bookingRef, live: true, km, startedAt: day.startedAt.toISOString() })
      continue
    }
    if (day?.status === 'ENDED') {
      const km = Math.round(Number(day.distanceKm) * 10) / 10
      out.push({ key: `done:${day.id}`, kind: 'DAY_DONE', title: `${dayLabel} done · ${km.toFixed(1)} km`, body: t.endDate <= today ? 'Last day — show the feedback QR to finish the trip.' : 'Rest well! See you tomorrow.', bookingRef: t.bookingRef, live: false, km, startedAt: day.startedAt.toISOString() })
      continue
    }
    if (!plan) continue
    const m = plan.movements.find(x => x.mine && !x.noDriverNeeded)
    const what = m ? `${m.time ? `${m.time} · ` : ''}${m.from ?? m.location}${m.to ? ` → ${m.to}` : ''}` : 'No movement on the chart yet.'
    out.push({
      key: `plan:${t.bookingRef}:${today}`, kind: 'TODAY_PLAN', title: `Today · ${dayLabel} · ${t.fileNo}`,
      body: `${what} ${session ? 'Swipe "Start day" when you leave.' : 'Start the trip when you meet the guest.'}`,
      bookingRef: t.bookingRef, live: false, km: null, startedAt: null,
    })
  }
  return out.sort((a, b) => Number(b.live) - Number(a.live))
}

export const GET = mobileRoute('notifications', async (req: NextRequest) => {
  const actor = await requireActor(req)
  const [rows, pinned] = await Promise.all([
    prisma.mobileNotification.findMany({
      where: who(actor), orderBy: { createdAt: 'desc' }, take: 50,
      select: { id: true, kind: true, title: true, body: true, data: true, readAt: true, createdAt: true },
    }),
    actor.kind === 'DRIVER' ? pinnedFor(actor.driverId, actor.country).catch(() => [] as Pinned[]) : Promise.resolve([] as Pinned[]),
  ])
  return buildApiSuccess({ items: rows, unread: rows.filter(r => !r.readAt).length, pinned })
})

export const POST = mobileRoute('notifications-read', async (req: NextRequest) => {
  const actor = await requireActor(req)
  const body = await readJson<{ ids?: string[] }>(req).catch(() => ({} as { ids?: string[] }))
  await prisma.mobileNotification.updateMany({
    where: { ...who(actor), readAt: null, ...(Array.isArray(body.ids) && body.ids.length ? { id: { in: body.ids.slice(0, 100) } } : {}) },
    data: { readAt: new Date() },
  })
  return buildApiSuccess({ ok: true })
})
