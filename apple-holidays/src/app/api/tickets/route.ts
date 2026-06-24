import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { hasPermission, canSeeAllCountries } from '@/lib/rbac'
import { countryScope } from '@/lib/country-detection'
import type { UserRole, OperationCountry } from '@prisma/client'

export const dynamic = 'force-dynamic'
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)

  const role = session.user.role as UserRole
  const userCountry = session.user.country as OperationCountry | undefined
  const { searchParams } = req.nextUrl
  const bookingRef = searchParams.get('bookingRef')
  const countryOverride = searchParams.get('country') as OperationCountry | null

  const effectiveCountry = canSeeAllCountries(role, userCountry ?? 'ALL')
    ? (countryOverride || null)
    : (userCountry || null)

  const where: Record<string, unknown> = {}
  if (bookingRef) {
    const booking = await prisma.booking.findUnique({ where: { bookingRef } })
    if (booking) where.bookingId = booking.id
  } else if (effectiveCountry) {
    where.booking = { operationCountry: { in: countryScope(effectiveCountry)! } }
  }

  const tickets = await prisma.ticket.findMany({
    where,
    include: {
      booking: { select: { bookingRef: true, arrivalDate: true } },
      agendaItem: { select: { date: true, location: true, toPoint: true } },
      pnlLine: {
        select: {
          activity: true, paymentStatus: true, paymentRefNumber: true, category: true,
          mmtRate: true, sicRate: true, pvtRatePP: true,
          adEntrance: true, chEntrance: true, otherRate: true,
          pnl: { select: { paxAdults: true, paxChildren: true } },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  })

  return buildApiSuccess(tickets)
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)

  const role = session.user.role as UserRole
  if (!hasPermission(role, 'ticket:create')) {
    return buildApiError('Forbidden', 403)
  }

  const body = await req.json()
  const { bookingRef, agendaItemId, pnlLineId, type, qty, supplier, costPerUnit, currency, notes } = body

  if (!bookingRef || !type) return buildApiError('bookingRef and type are required')

  const booking = await prisma.booking.findUnique({ where: { bookingRef } })
  if (!booking) return buildApiError('Booking not found', 404)

  const totalCost = costPerUnit ? Number(costPerUnit) * Number(qty ?? 1) : null

  const ticket = await prisma.ticket.create({
    data: {
      bookingId: booking.id,
      agendaItemId: agendaItemId || null,
      pnlLineId: pnlLineId || null,
      type,
      qty: Number(qty ?? 1),
      supplier,
      costPerUnit: costPerUnit ? Number(costPerUnit) : null,
      totalCost,
      currency: currency ?? 'USD',
      notes,
      status: 'DRAFT',
    },
  })

  return buildApiSuccess(ticket, 'Ticket created')
}
