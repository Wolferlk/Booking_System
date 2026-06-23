import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { fetchPnlById } from '@/lib/accounts-db'
import type { UserRole } from '@prisma/client'

/**
 * POST /api/accounts/pnl-link
 * Body: { externalPnlId: number, bookingRef: string }
 *
 * Links an external PNL record to a booking from the PNL-side view.
 * Replaces any existing link on that booking.
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)

  const role = session.user.role as UserRole
  if (!['AC_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN'].includes(role)) {
    return buildApiError('Forbidden', 403)
  }

  const body = await req.json().catch(() => null)
  const externalPnlId = Number(body?.externalPnlId)
  const bookingRef    = String(body?.bookingRef ?? '').trim()

  if (!externalPnlId || isNaN(externalPnlId)) return buildApiError('externalPnlId is required', 400)
  if (!bookingRef)                              return buildApiError('bookingRef is required', 400)

  const booking = await prisma.booking.findUnique({
    where: { bookingRef },
    select: { id: true },
  })
  if (!booking) return buildApiError(`Booking ${bookingRef} not found`, 404)

  try {
    const full = await fetchPnlById(externalPnlId)
    if (!full) return buildApiError('External PNL record not found in Accounts DB', 404)

    const link = await prisma.externalPnlLink.upsert({
      where:  { bookingId: booking.id },
      create: {
        bookingId:     booking.id,
        externalPnlId: full.record.id,
        matchedBy:     'manual',
        matchedValue:  String(full.record.id),
        cachedRecord:  full.record as object,
        cachedItems:   full.items as object[],
        lastFetchedAt: new Date(),
      },
      update: {
        externalPnlId: full.record.id,
        matchedBy:     'manual',
        matchedValue:  String(full.record.id),
        cachedRecord:  full.record as object,
        cachedItems:   full.items as object[],
        lastFetchedAt: new Date(),
      },
      include: {
        booking: {
          select: {
            bookingRef: true, isNumber: true, status: true, agent: true,
            arrivalDate: true, paxAdults: true, paxChildren: true,
            passengers: { where: { isLead: true }, select: { name: true }, take: 1 },
          },
        },
      },
    })
    return buildApiSuccess(link)
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'External DB unreachable'
    return buildApiError(msg, 502)
  }
}

/**
 * DELETE /api/accounts/pnl-link
 * Body: { bookingRef: string }
 *
 * Removes the external PNL link from a booking.
 */
export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)

  const role = session.user.role as UserRole
  if (!['AC_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN'].includes(role)) {
    return buildApiError('Forbidden', 403)
  }

  const body = await req.json().catch(() => null)
  const bookingRef = String(body?.bookingRef ?? '').trim()
  if (!bookingRef) return buildApiError('bookingRef is required', 400)

  const booking = await prisma.booking.findUnique({
    where: { bookingRef },
    select: { id: true },
  })
  if (!booking) return buildApiError(`Booking ${bookingRef} not found`, 404)

  await prisma.externalPnlLink.deleteMany({ where: { bookingId: booking.id } })
  return buildApiSuccess({ unlinked: true, bookingRef })
}
