/**
 * /api/bookings/[ref]/test-booking
 *
 *   GET   → is this booking on the shared Test Bookings register?
 *   POST  { action: 'mark', reason }   → mark it as a test (hidden everywhere)
 *   POST  { action: 'release', note? } → restore it as a real booking
 *
 * The register lives in the accounts database (see src/lib/test-bookings.ts).
 * Marking writes one register row and nothing else — this booking's own row,
 * status and history are never touched, so restoring brings it straight back.
 *
 * Only Ultra Super Admin, Country Admin and the Accounts team may mark or
 * restore, and OPS refuses to hide a booking accounts has taken money for —
 * that is a super admin's call, made on the accounts side.
 */
import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { hasPermission } from '@/lib/rbac'
import {
  TestBookingError,
  canManageTestBookings,
  findTestBooking,
  loadTestBookings,
  markTestBooking,
  releaseTestBooking,
} from '@/lib/test-bookings'
import type { UserRole } from '@prisma/client'

export const dynamic = 'force-dynamic'

async function loadBooking(ref: string) {
  return prisma.booking.findUnique({
    where: { bookingRef: ref },
    select: {
      bookingRef: true, isNumber: true, agentBookingId: true, agent: true, status: true,
      arrivalDate: true, paxAdults: true, paxChildren: true, createdAt: true,
    },
  })
}

export async function GET(_req: NextRequest, { params }: { params: { ref: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  const role = session.user.role as UserRole
  if (role === 'CLIENT' || !hasPermission(role, 'booking:read')) return buildApiError('Forbidden', 403)

  const booking = await loadBooking(params.ref)
  if (!booking) return buildApiError('Booking not found', 404)

  const { checked } = await loadTestBookings()
  const mark = await findTestBooking(booking.bookingRef, booking.isNumber, booking.agentBookingId)

  return buildApiSuccess({ mark, checked, canManage: canManageTestBookings(role) })
}

export async function POST(req: NextRequest, { params }: { params: { ref: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  const role = session.user.role as UserRole
  if (!canManageTestBookings(role)) {
    return buildApiError('Only an Ultra Super Admin, Country Admin or the Accounts team can mark test bookings', 403)
  }

  const booking = await loadBooking(params.ref)
  if (!booking) return buildApiError('Booking not found', 404)

  const body = await req.json().catch(() => ({})) as { action?: string; reason?: string; note?: string }
  const by = String(session.user.email || session.user.name || session.user.id)
  // The booking's own reference unless it carries an IS number, which is the
  // key accounts files invoices and P&Ls under.
  const reference = booking.isNumber || booking.bookingRef

  try {
    if (body.action === 'release') {
      const existing = await findTestBooking(booking.bookingRef, booking.isNumber, booking.agentBookingId)
      const released = await releaseTestBooking({ reference: existing?.ref ?? reference, by, note: body.note ?? null })
      return buildApiSuccess({ released }, `${booking.bookingRef} is a real booking again — back in every list and count.`)
    }

    if (body.action === 'mark') {
      const mark = await markTestBooking({
        reference,
        reason: String(body.reason ?? ''),
        by,
        snapshot: {
          found: true,
          ops: {
            ref: booking.bookingRef,
            status: booking.status,
            agent: booking.agent,
            arrival: booking.arrivalDate.toISOString().slice(0, 10),
            pax: (booking.paxAdults ?? 0) + (booking.paxChildren ?? 0),
            created: booking.createdAt.toISOString().slice(0, 10),
          },
          booked_on: booking.createdAt.toISOString().slice(0, 10),
        },
      })
      return buildApiSuccess({ mark }, `${booking.bookingRef} is now a test booking — hidden from every list, count and daily mail.`)
    }

    return buildApiError('Unknown action', 400)
  } catch (err) {
    if (err instanceof TestBookingError) return buildApiError(err.message, 422)
    console.error('[POST /api/bookings/[ref]/test-booking]', err)
    return buildApiError('Could not reach the Accounts register. Nothing was changed.', 502)
  }
}
