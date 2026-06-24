import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import type { UserRole } from '@prisma/client'

export const dynamic = 'force-dynamic'
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  const role = session.user.role as UserRole
  if (!['AC_USER', 'SUPER_ADMIN', 'BT_USER'].includes(role)) return buildApiError('Forbidden', 403)

  const agent = await prisma.creditAgent.findUnique({
    where: { id: params.id },
    select: { name: true, aliases: true },
  })
  if (!agent) return buildApiError('Agent not found', 404)

  // Build search terms from name + aliases
  const aliases: string[] = agent.aliases ? JSON.parse(agent.aliases) : []
  const terms = [agent.name, ...aliases]

  // Find bookings where agent field matches any term
  const bookings = await prisma.booking.findMany({
    where: {
      OR: terms.map(term => ({
        agent: { contains: term },
      })),
    },
    orderBy: { arrivalDate: 'desc' },
    include: {
      passengers: { where: { isLead: true }, take: 1 },
      pnl: { select: { id: true } },
      payments: { select: { id: true, amount: true, status: true } },
    },
  })

  const enriched = bookings.map(b => {
    const confirmedPaid = b.payments
      .filter(p => p.status === 'CONFIRMED')
      .reduce((s, p) => s + Number(p.amount), 0)
    return {
      id: b.id,
      bookingRef: b.bookingRef,
      agent: b.agent,
      fileHandler: b.fileHandler,
      status: b.status,
      arrivalDate: b.arrivalDate,
      departureDate: b.departureDate,
      paxAdults: b.paxAdults,
      paxChildren: b.paxChildren,
      quotedTotal: Number(b.quotedTotal),
      currency: b.currency,
      confirmedPaid,
      balance: Number(b.quotedTotal) - confirmedPaid,
      hasPnl: !!b.pnl,
      leadPassenger: b.passengers[0]?.name ?? null,
    }
  })

  return buildApiSuccess(enriched)
}
