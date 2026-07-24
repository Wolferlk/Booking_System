import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { buildApiSuccess } from '@/lib/utils'

export const dynamic = 'force-dynamic'

/**
 * Public feed of recent File Handler actions for the office Live Screen (/view).
 * Same rationale as /api/public/view-dashboard: no login, no token — a TV loads
 * /view and it works forever. Only the non-sensitive action + booking ref is
 * exposed (no passenger detail, no financials). Drives the flight-added and
 * cancel-requested popup animations on the screen.
 */
export async function GET(_req: NextRequest) {
  const events = await prisma.fileHandlerLog.findMany({
    where: { action: { in: ['FLIGHT_ADDED', 'FLIGHT_UPDATED', 'CANCEL_REQUESTED'] } },
    orderBy: { createdAt: 'desc' },
    take: 15,
    select: {
      id: true,
      action: true,
      fileHandlerName: true,
      bookingRef: true,
      isNumber: true,
      operationCountry: true,
      details: true,
      createdAt: true,
    },
  })

  return buildApiSuccess({ generatedAt: new Date().toISOString(), events })
}
