/**
 * GET /api/mobile/performance — the driver's own scorecard.
 *
 * The score, grade, ratings and guest comments are the same numbers ops sees
 * on Drivers & Vehicles → Performance (lib/partner-analytics.ts). Money (trip
 * value) and agent names are left out. App-measured km / days are added, plus
 * a few badges to give the numbers a reason to look at them.
 */
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { buildApiSuccess } from '@/lib/utils'
import { requireDriver } from '@/lib/mobile/auth'
import { mobileRoute } from '@/lib/mobile/http'
import { getPartnerAnalytics } from '@/lib/partner-analytics'
import { vehicleCheckState } from '@/lib/mobile/profile'

export const dynamic = 'force-dynamic'

export const GET = mobileRoute('performance', async (req: NextRequest) => {
  const actor = await requireDriver(req)
  const [a, days, sessions, vehicleCheck] = await Promise.all([
    getPartnerAnalytics('driver', actor.driverId),
    prisma.mobileTripDay.findMany({ where: { driverId: actor.driverId }, select: { dayDate: true, distanceKm: true } }),
    prisma.mobileTripSession.findMany({ where: { driverId: actor.driverId }, select: { status: true, feedbackStatus: true } }),
    vehicleCheckState(actor.driverId),
  ])

  const totalKm = Math.round(days.reduce((s, d) => s + Number(d.distanceKm), 0))
  const byMonth = new Map<string, number>()
  for (const d of days) byMonth.set(d.dayDate.slice(0, 7), (byMonth.get(d.dayDate.slice(0, 7)) ?? 0) + Number(d.distanceKm))
  const completed = sessions.filter(s => s.status === 'COMPLETED')
  const withFeedback = completed.filter(s => s.feedbackStatus === 'SUBMITTED').length

  const badges = [
    { id: 'km1000', label: '1,000 km club', icon: 'road', earned: totalKm >= 1000 },
    { id: 'km10000', label: '10,000 km legend', icon: 'trophy', earned: totalKm >= 10000 },
    { id: 'star', label: 'Guest favourite', icon: 'star', earned: (a.rating ?? 0) >= 4.5 && a.ratedBookings >= 3 },
    { id: 'feedback', label: 'Feedback champion', icon: 'chat', earned: completed.length >= 3 && withFeedback / completed.length >= 0.8 },
    { id: 'tours25', label: '25 tours', icon: 'flag', earned: a.toursDone >= 25 },
    { id: 'clean', label: 'No complaints', icon: 'shield', earned: a.toursDone >= 5 && a.complaintCount === 0 },
    { id: 'vehicle', label: 'Vehicle ready', icon: 'car', earned: !vehicleCheck.due },
  ]

  return buildApiSuccess({
    score: a.score, grade: a.grade,
    rating: a.rating, vehicleRating: a.vehicleRating, overallRating: a.overallRating,
    ratingBreakdown: a.ratingBreakdown, ratedBookings: a.ratedBookings, responseRate: a.responseRate,
    praiseCount: a.praiseCount, complaintCount: a.complaintCount,
    trips: a.trips, toursDone: a.toursDone, daysOnRoad: a.daysOnRoad, pax: a.pax,
    upcomingTrips: a.upcomingTrips, lastTrip: a.lastTrip, nextTrip: a.nextTrip,
    monthly: a.monthly, topRoutes: a.topRoutes.slice(0, 5),
    comments: a.comments
      .filter(c => c.mentionsDriver || c.driverRating)
      .slice(0, 15)
      .map(c => ({ tone: c.tone, text: c.text, date: c.date, bookingRef: c.bookingRef, driverRating: c.driverRating })),
    app: {
      totalKm,
      daysDriven: new Set(days.map(d => d.dayDate)).size,
      tripsCompleted: completed.length,
      feedbackRate: completed.length ? Math.round((withFeedback / completed.length) * 100) : null,
      kmByMonth: Array.from(byMonth.entries()).sort().slice(-6).map(([month, km]) => ({ month, km: Math.round(km) })),
    },
    badges,
  })
})
