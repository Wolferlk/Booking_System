import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import {
  findPnlByIdentifiers, fetchPnlById, fetchPnlVersionsForBooking,
  type PnlRecord,
} from '@/lib/accounts-db'
import { loadDetailedPnl, isLoaded, syncTicketsFromDetailed } from '@/lib/detailed-pnl'
import type { ExternalPnlLink } from '@prisma/client'
import type { UserRole } from '@prisma/client'

export const dynamic = 'force-dynamic'

/**
 * If a newer amendment exists for the currently-linked record's base, re-point
 * the link to it, refresh the cached snapshot, and re-sync DRAFT tickets from
 * the new line items. Returns the updated link, or null if already latest.
 * Best-effort: throws only on unexpected errors; callers guard the Accounts DB.
 */
async function autoMoveToLatest(
  bookingId: string,
  link: ExternalPnlLink,
): Promise<ExternalPnlLink | null> {
  const linkedRec = link.cachedRecord as unknown as PnlRecord | null
  const res = await fetchPnlVersionsForBooking({
    isNumber:      linkedRec?.is_number ?? null,
    tourRef:       linkedRec?.tour_ref ?? null,
    invoiceNumber: linkedRec?.invoice_number ?? null,
  })
  const latest = res?.versions[0]
  if (!latest || latest.id === link.externalPnlId) return null

  const full = await fetchPnlById(latest.id)
  if (!full) return null

  const updated = await prisma.externalPnlLink.update({
    where: { bookingId },
    data: {
      externalPnlId: full.record.id,
      matchedValue:  full.record.is_number ?? link.matchedValue,
      cachedRecord:  full.record as object,
      cachedItems:   full.items as object[],
      lastFetchedAt: new Date(),
    },
  })
  // Bring DRAFT tickets in line with the new amendment; purchased/paid
  // untouched. Costed off the Detailed P&L, the same source the explicit
  // "create tickets" action uses — an amendment must not re-introduce the flat
  // invoice lines that action no longer produces. A booking whose costing sheet
  // cannot be read keeps its existing tickets rather than losing the re-point.
  try {
    const detailed = await loadDetailedPnl({
      isNumber:      full.record.is_number,
      tourRef:       full.record.tour_ref,
      invoiceNumber: full.record.invoice_number,
    })
    if (isLoaded(detailed)) {
      await syncTicketsFromDetailed(bookingId, detailed.detail, { resync: true })
    }
  } catch (err) {
    console.error('[ext-pnl] ticket resync from the Detailed P&L failed:', err)
  }
  return updated
}

/** GET — return the cached external PNL link for a booking. If already linked,
 *  auto-move to the latest amendment when a newer one exists. If not linked,
 *  attempt auto-linking by matching booking identifiers against the Accounts DB. */
export async function GET(
  _req: NextRequest,
  { params }: { params: { ref: string } },
) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)

  const booking = await prisma.booking.findUnique({
    where: { bookingRef: params.ref },
    select: { id: true, isNumber: true, bookingRef: true, agentBookingId: true, externalPnlLink: true },
  })
  if (!booking) return buildApiError('Booking not found', 404)

  // If already linked, auto-move to the latest amendment when one exists.
  if (booking.externalPnlLink) {
    try {
      const moved = await autoMoveToLatest(booking.id, booking.externalPnlLink)
      return buildApiSuccess(moved ?? booking.externalPnlLink)
    } catch (err) {
      // Accounts DB unreachable — fall back to the cached link.
      console.error('[ext-pnl] auto-move check failed:', err)
      return buildApiSuccess(booking.externalPnlLink)
    }
  }

  // Try to auto-link now
  try {
    const match = await findPnlByIdentifiers({
      isNumber:      booking.isNumber,
      tourRef:       booking.bookingRef,
      invoiceNumber: booking.agentBookingId,
    })

    if (!match) return buildApiSuccess(null)

    const full = await fetchPnlById(match.record.id)
    if (!full) return buildApiSuccess(null)

    const link = await prisma.externalPnlLink.create({
      data: {
        bookingId:     booking.id,
        externalPnlId: match.record.id,
        matchedBy:     match.matchedBy,
        matchedValue:  match.matchedValue,
        cachedRecord:  full.record as object,
        cachedItems:   full.items as object[],
        lastFetchedAt: new Date(),
      },
    })
    return buildApiSuccess(link)
  } catch (err) {
    // External DB may be unreachable — return null without crashing
    console.error('[ext-pnl] auto-link failed:', err)
    return buildApiSuccess(null)
  }
}

/** DELETE — remove the external PNL link from a booking. */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: { ref: string } },
) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)

  const role = session.user.role as UserRole
  if (!['AC_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN'].includes(role)) {
    return buildApiError('Forbidden', 403)
  }

  const booking = await prisma.booking.findUnique({
    where: { bookingRef: params.ref },
    select: { id: true },
  })
  if (!booking) return buildApiError('Booking not found', 404)

  await prisma.externalPnlLink.deleteMany({ where: { bookingId: booking.id } })
  return buildApiSuccess({ unlinked: true })
}
