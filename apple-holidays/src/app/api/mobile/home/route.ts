/**
 * GET /api/mobile/home  — the driver's "Today" screen in one call:
 * the trip to drive today (running or ready), today's plan, the next trip,
 * this month's km, and anything that needs the driver (vehicle photos due,
 * unread notifications, requests waiting).
 */
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { buildApiSuccess } from '@/lib/utils'
import { requireDriver } from '@/lib/mobile/auth'
import { mobileRoute } from '@/lib/mobile/http'
import { addDaysYmd, loadDriverTrips, localTodayFor } from '@/lib/mobile/trips'
import { feedbackSubmitted, guestLinks, tripProgress } from '@/lib/mobile/sessions'
import { vehicleCheckState } from '@/lib/mobile/profile'

export const dynamic = 'force-dynamic'

export const GET = mobileRoute('home', async (req: NextRequest) => {
  const actor = await requireDriver(req)
  const today = localTodayFor(actor.country)
  const trips = await loadDriverTrips(actor.driverId, addDaysYmd(today, -45), addDaysYmd(today, 45))

  const sessions = await prisma.mobileTripSession.findMany({
    where: { driverId: actor.driverId, bookingId: { in: trips.map(t => t.bookingId) } },
    select: { bookingId: true, status: true },
  })
  const status = new Map(sessions.map(s => [s.bookingId, s.status]))

  // Today's trip: a running one first (even if its dates moved), else one whose dates cover today.
  const running = trips.find(t => status.get(t.bookingId) === 'ACTIVE')
  const ready = trips.find(t => !status.has(t.bookingId) && t.startDate <= today && t.endDate >= today)
  const current = running ?? ready ?? null
  const next = trips.find(t => t.startDate > today && t !== current && !status.has(t.bookingId)) ?? null
  // Other trips on today's date (a driver can have a transfer next to a tour).
  const alsoToday = trips
    .filter(t => t !== current && t.startDate <= today && t.endDate >= today && status.get(t.bookingId) !== 'COMPLETED' && status.get(t.bookingId) !== 'HANDED_OVER')
    .map(t => {
      const day = t.days.find(d => d.date === today)
      const first = day?.movements.find(m => m.mine && !m.noDriverNeeded) ?? null
      return {
        bookingRef: t.bookingRef, fileNo: t.fileNo, leadGuest: t.leadGuest, pax: t.pax, mode: t.mode,
        dayNo: day?.dayNo ?? null, dayCount: t.days.length, legs: day?.movements.filter(m => m.mine).length ?? 0,
        started: status.get(t.bookingId) === 'ACTIVE', firstMovement: first,
      }
    })

  const monthStart = `${today.slice(0, 7)}-01`
  const [monthDays, unread, pendingRequests, vehicleCheck] = await Promise.all([
    prisma.mobileTripDay.findMany({
      where: { driverId: actor.driverId, dayDate: { gte: monthStart } },
      select: { distanceKm: true, sessionId: true, dayDate: true },
    }),
    prisma.mobileNotification.count({ where: { actorType: 'DRIVER', actorId: actor.driverId, readAt: null } }),
    prisma.mobileDriverRequest.count({ where: { driverId: actor.driverId, status: 'PENDING', kind: { not: 'SIGNUP' } } }),
    vehicleCheckState(actor.driverId),
  ])

  let currentBlock = null
  if (current) {
    const [progress, feedback] = await Promise.all([tripProgress(actor.driverId, current), feedbackSubmitted(current.bookingId)])
    const todayPlan = current.days.find(d => d.date === today) ?? null
    currentBlock = {
      trip: { ...current, days: undefined },
      todayPlan,
      dayIndex: todayPlan ? todayPlan.dayNo : null,
      dayCount: current.days.length,
      isLastDay: current.endDate <= today,
      progress,
      feedback,
      links: guestLinks(current.bookingRef),
    }
  }

  return buildApiSuccess({
    today,
    name: actor.name,
    current: currentBlock,
    alsoToday,
    next: next && {
      bookingRef: next.bookingRef, fileNo: next.fileNo, leadGuest: next.leadGuest, pax: next.pax,
      startDate: next.startDate, endDate: next.endDate, dayCount: next.days.length,
      firstMovement: next.days[0]?.movements[0] ?? null,
    },
    upcomingCount: trips.filter(t => t.startDate > today).length,
    month: {
      km: Math.round(monthDays.reduce((s, d) => s + Number(d.distanceKm), 0)),
      daysDriven: new Set(monthDays.map(d => d.dayDate)).size,
      trips: new Set(monthDays.map(d => d.sessionId)).size,
    },
    alerts: { vehicleCheck, unread, pendingRequests },
  })
})
