/**
 * GET /api/mobile/trips  — the driver's trips: running, upcoming (60 days) and
 * recent (30 days), each with the app's own progress (started / km / done).
 */
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { buildApiSuccess } from '@/lib/utils'
import { requireDriver } from '@/lib/mobile/auth'
import { mobileRoute } from '@/lib/mobile/http'
import { addDaysYmd, loadDriverTrips, localTodayFor } from '@/lib/mobile/trips'

export const dynamic = 'force-dynamic'

export const GET = mobileRoute('trips', async (req: NextRequest) => {
  const actor = await requireDriver(req)
  const today = localTodayFor(actor.country)
  const trips = await loadDriverTrips(actor.driverId, addDaysYmd(today, -30), addDaysYmd(today, 60))
  const sessions = await prisma.mobileTripSession.findMany({
    where: { driverId: actor.driverId, bookingId: { in: trips.map(t => t.bookingId) } },
    select: { bookingId: true, status: true, totalKm: true, completedAt: true },
  })
  const byBooking = new Map(sessions.map(s => [s.bookingId, s]))
  const rows = trips.map(t => {
    const s = byBooking.get(t.bookingId)
    const phase = s?.status === 'COMPLETED' ? 'DONE'
      : s?.status === 'ACTIVE' ? 'RUNNING'
      : t.endDate < today ? 'MISSED'
      : t.startDate <= today ? 'READY' : 'UPCOMING'
    return {
      bookingRef: t.bookingRef, fileNo: t.fileNo, country: t.country, leadGuest: t.leadGuest, pax: t.pax,
      startDate: t.startDate, endDate: t.endDate, mode: t.mode, dayCount: t.days.length,
      firstStop: t.days[0]?.movements[0]?.from ?? t.days[0]?.movements[0]?.location ?? null,
      phase, km: s ? Number(s.totalKm) : 0,
    }
  })
  return buildApiSuccess({ today, trips: rows })
})
