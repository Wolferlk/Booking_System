import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { canSeeAllCountries } from '@/lib/rbac'
import { countryScope } from '@/lib/country-detection'
import type { UserRole } from '@prisma/client'
import type { OperationCountry } from '@prisma/client'

export const dynamic = 'force-dynamic'
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)

  const role = session.user.role as UserRole
  if (!['AC_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN'].includes(role)) {
    return buildApiError('Forbidden', 403)
  }

  const userCountry = session.user.country as OperationCountry | undefined
  const countryOverride = req.nextUrl.searchParams.get('country') as OperationCountry | null

  const { searchParams } = req.nextUrl
  const status = searchParams.get('status')
  const search = searchParams.get('search')
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '500'), 1000)

  const andClauses: Record<string, unknown>[] = []

  // Country scoping
  if (!canSeeAllCountries(role, userCountry ?? 'ALL')) {
    const scope = countryScope(userCountry)
    if (scope) andClauses.push({ operationCountry: { in: scope } })
  } else if (countryOverride && countryOverride !== 'ALL') {
    if (countryOverride === 'SINGAPORE_MALAYSIA') {
      andClauses.push({ operationCountry: { in: countryScope(countryOverride)! } })
    } else {
      andClauses.push({ operationCountry: countryOverride })
    }
  }

  if (status) andClauses.push({ status })
  if (search) {
    andClauses.push({
      OR: [
        { bookingRef: { contains: search } },
        { agent: { contains: search } },
        { fileHandler: { contains: search } },
        { passengers: { some: { name: { contains: search } } } },
      ],
    })
  }

  const where: Record<string, unknown> = andClauses.length ? { AND: andClauses } : {}

  const bookings = await prisma.booking.findMany({
    where,
    orderBy: { arrivalDate: 'desc' },
    take: limit,
    include: {
      passengers: { where: { isLead: true }, take: 1 },
      pnl: { include: { lineItems: true } },
      payments: true,
    },
  })

  const data = bookings.map(b => {
    // Revenue = quoted total (or pnl.totalRevenue if available)
    const totalRevenue = b.pnl
      ? b.pnl.lineItems.reduce((s, li) => {
          const ppAdult = Number(li.pvtRatePP ?? li.sicRate ?? 0)
          const ppChild = Number(li.pvtRatePP ?? li.sicRate ?? 0) * 0.7
          return s + ppAdult * (b.paxAdults ?? 0) + ppChild * (b.paxChildren ?? 0)
            + Number(li.adEntrance ?? 0) * (b.paxAdults ?? 0)
            + Number(li.chEntrance ?? 0) * (b.paxChildren ?? 0)
            + Number(li.otherRate ?? 0)
        }, 0)
      : Number(b.quotedTotal ?? 0)

    const totalCost = b.pnl
      ? b.pnl.lineItems.reduce((s, li) => {
          const costPP = Number(li.mmtRate ?? 0)
          return s + costPP * ((b.paxAdults ?? 0) + (b.paxChildren ?? 0))
            + Number(li.adEntrance ?? 0) * (b.paxAdults ?? 0)
            + Number(li.chEntrance ?? 0) * (b.paxChildren ?? 0)
            + Number(li.otherRate ?? 0)
        }, 0)
      : 0

    const profit = totalRevenue - totalCost
    const marginPct = totalRevenue > 0 ? (profit / totalRevenue) * 100 : 0

    const confirmedPayments = b.payments.filter(p => p.status === 'CONFIRMED')
    const totalPaid = confirmedPayments.reduce((s, p) => s + Number(p.amount ?? 0), 0)
    const balanceDue = Number(b.quotedTotal ?? 0) - totalPaid

    const leadPax = b.passengers[0]

    return {
      bookingRef: b.bookingRef,
      agent: b.agent ?? '',
      fileHandler: b.fileHandler ?? '',
      status: b.status,
      arrivalDate: b.arrivalDate ? b.arrivalDate.toISOString().slice(0, 10) : '',
      departureDate: b.departureDate ? b.departureDate.toISOString().slice(0, 10) : '',
      paxAdults: b.paxAdults ?? 0,
      paxChildren: b.paxChildren ?? 0,
      quotedTotal: Number(b.quotedTotal ?? 0),
      currency: b.currency ?? 'USD',
      totalRevenue,
      totalCost,
      profit,
      marginPct,
      totalPaid,
      balanceDue,
      leadPassenger: leadPax?.name ?? '',
      createdAt: b.createdAt ? b.createdAt.toISOString().slice(0, 10) : '',
    }
  })

  return buildApiSuccess(data)
}
