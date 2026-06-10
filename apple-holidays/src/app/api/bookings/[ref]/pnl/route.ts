import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess, computePNLTotals, isClientPortalUnlocked, isCreditAgent } from '@/lib/utils'
import { hasPermission } from '@/lib/rbac'
import type { UserRole, PNLCategory } from '@prisma/client'

export async function GET(
  req: NextRequest,
  { params }: { params: { ref: string } },
) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)

  const role = session.user.role as UserRole
  if (!hasPermission(role, 'pnl:read')) {
    return buildApiError('Forbidden', 403)
  }

  const booking = await prisma.booking.findUnique({ where: { bookingRef: params.ref } })
  if (!booking) return buildApiError('Booking not found', 404)

  // Ground Team can only see P&L from T-5
  if (role === 'GT_USER' && !isClientPortalUnlocked(booking.arrivalDate)) {
    return buildApiError('P&L not available until T−5', 403)
  }

  const pnl = await prisma.pNL.findUnique({
    where: { bookingId: booking.id },
    include: { lineItems: { orderBy: { sortOrder: 'asc' } } },
  })

  if (!pnl) return buildApiSuccess(null)

  return buildApiSuccess({ ...computePNLTotals(pnl), bookingAgent: booking.agent })
}

export async function POST(
  req: NextRequest,
  { params }: { params: { ref: string } },
) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)

  const role = session.user.role as UserRole
  if (!hasPermission(role, 'pnl:create')) {
    return buildApiError('Forbidden', 403)
  }

  const booking = await prisma.booking.findUnique({ where: { bookingRef: params.ref } })
  if (!booking) return buildApiError('Booking not found', 404)

  const { paxAdults, paxChildren, lineItems = [] } = await req.json()

  // Upsert PNL
  const existingPnl = await prisma.pNL.findUnique({ where: { bookingId: booking.id } })

  let pnl
  if (existingPnl) {
    await prisma.pNLLineItem.deleteMany({ where: { pnlId: existingPnl.id } })
    pnl = await prisma.pNL.update({
      where: { id: existingPnl.id },
      data: {
        paxAdults: Number(paxAdults ?? booking.paxAdults),
        paxChildren: Number(paxChildren ?? booking.paxChildren),
      },
    })
  } else {
    pnl = await prisma.pNL.create({
      data: {
        bookingId: booking.id,
        paxAdults: Number(paxAdults ?? booking.paxAdults),
        paxChildren: Number(paxChildren ?? booking.paxChildren),
      },
    })

    // Credit agents skip payment approval — go straight to OPERATIONS_READY
    if (booking.status === 'GT_VERIFIED') {
      const creditAgent = isCreditAgent(booking.agent)
      const nextStatus = creditAgent ? 'OPERATIONS_READY' : 'AWAITING_PAYMENT_CONFIRM'
      await Promise.all([
        prisma.booking.update({
          where: { id: booking.id },
          data: { status: nextStatus },
        }),
        prisma.statusEvent.create({
          data: {
            bookingId: booking.id,
            fromState: 'GT_VERIFIED',
            toState: nextStatus,
            actorId: session.user.id,
            note: creditAgent
              ? 'P&L uploaded — credit agent, no payment approval required'
              : 'P&L uploaded by Accounts Team',
          },
        }),
      ])
    }
  }

  const createdLines = await Promise.all(
    lineItems.map((line: Record<string, unknown>, index: number) =>
      prisma.pNLLineItem.create({
        data: {
          pnlId: pnl.id,
          activity: line.activity as string,
          category: (line.category as PNLCategory) || 'OTHER',
          mmtRate: Number(line.mmtRate ?? 0),
          sicRate: Number(line.sicRate ?? 0),
          pvtRatePP: Number(line.pvtRatePP ?? 0),
          adEntrance: Number(line.adEntrance ?? 0),
          chEntrance: Number(line.chEntrance ?? 0),
          otherRate: Number(line.otherRate ?? 0),
          notes: line.notes as string | undefined,
          sortOrder: index,
        },
      }),
    ),
  )

  const fullPnl = await prisma.pNL.findUnique({
    where: { id: pnl.id },
    include: { lineItems: { orderBy: { sortOrder: 'asc' } } },
  })

  return buildApiSuccess(computePNLTotals(fullPnl!), 'P&L saved')
}
