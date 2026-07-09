import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { hasPermission } from '@/lib/rbac'
import { prisma } from '@/lib/prisma'
import { syncTicketsFromPnl, type PnlItemLike } from '@/lib/ext-pnl-tickets'
import type { UserRole } from '@prisma/client'

export const dynamic = 'force-dynamic'

/**
 * POST /api/bookings/[ref]/ext-pnl/create-tickets
 *
 * ?resync=true  — update existing DRAFT tickets from PNL + create any new ones.
 *                 Never deletes or modifies PURCHASED/PAID tickets.
 * (default)     — create tickets only for PNL items that have no ticket yet.
 *
 * Returns { created, updated, skipped }
 */
export async function POST(req: NextRequest, { params }: { params: { ref: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)

  const role = session.user.role as UserRole
  if (!hasPermission(role, 'ticket:create')) return buildApiError('Forbidden', 403)

  const resync = req.nextUrl.searchParams.get('resync') === 'true'

  const booking = await prisma.booking.findUnique({
    where: { bookingRef: params.ref },
    select: { id: true },
  })
  if (!booking) return buildApiError('Booking not found', 404)

  const pnlLink = await prisma.externalPnlLink.findUnique({
    where: { bookingId: booking.id },
  })
  if (!pnlLink) return buildApiError('No Accounts PNL linked to this booking', 404)

  const items = pnlLink.cachedItems as PnlItemLike[]
  if (!items || items.length === 0) {
    return buildApiSuccess({ created: 0, updated: 0, skipped: 0 }, 'No PNL items found')
  }

  const { created, updated, skipped } = await syncTicketsFromPnl(booking.id, items, { resync })

  const msg = resync
    ? `Re-synced: ${created} created, ${updated} updated, ${skipped} skipped`
    : `${created} ticket${created !== 1 ? 's' : ''} created, ${skipped} already existed`

  return buildApiSuccess({ created, updated, skipped }, msg)
}
