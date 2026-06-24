import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { findPnlByIdentifiers, fetchPnlById } from '@/lib/accounts-db'
import type { UserRole } from '@prisma/client'

export const dynamic = 'force-dynamic'
/** POST — iterate all bookings and attempt to auto-link or refresh their
 *  external PNL data.  Only SUPER_ADMIN / ULTRA_SUPER_ADMIN may call this. */
export async function POST(_req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)

  const role = session.user.role as UserRole
  if (!['SUPER_ADMIN', 'ULTRA_SUPER_ADMIN'].includes(role)) {
    return buildApiError('Forbidden — admin only', 403)
  }

  const bookings = await prisma.booking.findMany({
    select: {
      id: true,
      bookingRef: true,
      isNumber: true,
      agentBookingId: true,
      externalPnlLink: { select: { externalPnlId: true } },
    },
  })

  let linked   = 0
  let refreshed = 0
  let skipped  = 0
  let errors   = 0

  for (const b of bookings) {
    try {
      if (b.externalPnlLink) {
        // Already linked — refresh the cache
        const full = await fetchPnlById(b.externalPnlLink.externalPnlId)
        if (full) {
          await prisma.externalPnlLink.update({
            where: { bookingId: b.id },
            data: {
              cachedRecord:  full.record as object,
              cachedItems:   full.items as object[],
              lastFetchedAt: new Date(),
            },
          })
          refreshed++
        } else {
          skipped++
        }
      } else {
        // Attempt auto-link
        const match = await findPnlByIdentifiers({
          isNumber:      b.isNumber,
          tourRef:       b.bookingRef,
          invoiceNumber: b.agentBookingId,
        })
        if (!match) { skipped++; continue }

        const full = await fetchPnlById(match.record.id)
        if (!full) { skipped++; continue }

        await prisma.externalPnlLink.create({
          data: {
            bookingId:     b.id,
            externalPnlId: match.record.id,
            matchedBy:     match.matchedBy,
            matchedValue:  match.matchedValue,
            cachedRecord:  full.record as object,
            cachedItems:   full.items as object[],
            lastFetchedAt: new Date(),
          },
        })
        linked++
      }
    } catch {
      errors++
    }
  }

  return buildApiSuccess({ total: bookings.length, linked, refreshed, skipped, errors })
}
