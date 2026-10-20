/**
 * GET /api/mobile/staff/home — the company app's home: today's arrivals and
 * departures, trips running, and what is waiting (WhatsApp unread, driver
 * requests). Read-only, country-scoped like the web.
 */
import { NextRequest } from 'next/server'
import type { OperationCountry } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { buildApiSuccess } from '@/lib/utils'
import { MOBILE_STAFF_ROLES, requireStaff } from '@/lib/mobile/auth'
import { mobileRoute } from '@/lib/mobile/http'
import { localTodayFor } from '@/lib/mobile/trips'
import { viewerCountry } from '@/lib/mobile/ops'
import { SANDBOX_REF_PREFIX } from '@/lib/mobile/sandbox'

export const dynamic = 'force-dynamic'

const LIVE: string[] = ['OPERATIONS_READY', 'CLIENT_LIVE', 'IN_PROGRESS', 'TE_REVIEWED', 'DRIVER_ALLOCATED', 'TICKETS_ISSUED', 'MSG_SENT_CUSTOMER', 'QC1_PASS', 'QC2_PASS']

export const GET = mobileRoute('staff-home', async (req: NextRequest) => {
  const s = await requireStaff(req)
  const country = viewerCountry(s.role, s.country)
  const today = localTodayFor(country ?? 'SRILANKA')
  const start = new Date(`${today}T00:00:00.000Z`)
  const end = new Date(`${today}T23:59:59.999Z`)
  const scope = country ? { operationCountry: country as OperationCountry } : {}
  const notCancelled = { status: { notIn: ['CANCELLED', 'DRAFT'] as never[] } }
  const card = {
    bookingRef: true, isNumber: true, status: true, operationCountry: true, arrivalDate: true, departureDate: true,
    paxAdults: true, paxChildren: true, agent: true,
    passengers: { where: { isLead: true }, take: 1, select: { name: true } },
  } as const

  const [arrivals, departures, onTour, waUnread, driverRequests, driving] = await Promise.all([
    prisma.booking.findMany({ where: { ...scope, ...notCancelled, arrivalDate: { gte: start, lte: end } }, select: card, take: 50, orderBy: { arrivalDate: 'asc' } }),
    prisma.booking.findMany({ where: { ...scope, ...notCancelled, departureDate: { gte: start, lte: end } }, select: card, take: 50, orderBy: { departureDate: 'asc' } }),
    prisma.booking.count({ where: { ...scope, status: { in: LIVE as never[] }, arrivalDate: { lte: end }, departureDate: { gte: start } } }),
    prisma.whatsAppMessage.count({ where: { direction: 'inbound', read: false, createdAt: { gte: new Date(Date.now() - 7 * 86_400_000) } } }),
    MOBILE_STAFF_ROLES.includes(s.role) ? prisma.mobileDriverRequest.count({ where: { status: 'PENDING' } }).catch(() => 0) : Promise.resolve(0),
    MOBILE_STAFF_ROLES.includes(s.role) ? prisma.mobileTripDay.count({ where: { status: 'STARTED', NOT: { bookingRef: { startsWith: SANDBOX_REF_PREFIX } } } }).catch(() => 0) : Promise.resolve(0),
  ])
  const shape = (b: (typeof arrivals)[number]) => ({
    bookingRef: b.bookingRef, fileNo: b.isNumber || b.bookingRef, status: b.status, country: b.operationCountry,
    leadGuest: b.passengers[0]?.name ?? null, pax: b.paxAdults + b.paxChildren, agent: b.agent,
    arrivalDate: b.arrivalDate, departureDate: b.departureDate,
  })
  return buildApiSuccess({
    today, name: s.name, role: s.role, country: s.country,
    driverOps: MOBILE_STAFF_ROLES.includes(s.role),
    arrivals: arrivals.map(shape), departures: departures.map(shape),
    counts: { onTour, waUnread, driverRequests, driving },
  })
})
