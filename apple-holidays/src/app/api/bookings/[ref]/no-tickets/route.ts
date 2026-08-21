/**
 * Mark a booking as "No Tickets" — or take the mark off again.
 *
 * A booking with nothing to buy used to read as *N/A* on QC, which is
 * indistinguishable from unstarted. The mark records that the emptiness is a
 * decision, so Ticket Activation can report as done (see `no-tickets.ts`).
 *
 * Treated as a decision rather than a preference: only the desks that buy
 * tickets may set it, the actor and the moment are stamped on the booking, and
 * a `StatusEvent` is appended so the trail says who decided and why. The
 * booking's lifecycle status is never touched.
 */
import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { canSeeAllCountries } from '@/lib/rbac'
import { isInCountryScope } from '@/lib/country-detection'
import { noTicketsAuditNote } from '@/lib/no-tickets'
import type { UserRole } from '@prisma/client'

export const dynamic = 'force-dynamic'

/** The desks that buy tickets — the same ones that may add one. */
const CAN_SET: UserRole[] = [
  'GT_USER', 'GT_VN_USER', 'GT_TE_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN',
]

/** A cancelled file is not worth re-scoping, and the mark would only confuse the trail. */
const FROZEN_STATUSES = new Set<string>(['CANCELLED'])

const STATE_SELECT = {
  bookingRef: true, noTickets: true, noTicketsAt: true,
  noTicketsBy: true, noTicketsNote: true,
} as const

/** In scope for this user's country? Admins and ALL-country users always are. */
function outOfScope(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  session: any,
  operationCountry: string | null,
): boolean {
  const role = session.user.role as UserRole
  const userCountry = session.user.country as string | undefined
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (canSeeAllCountries(role, userCountry as any)) return false
  if (!userCountry || userCountry === 'ALL') return false
  return !isInCountryScope(operationCountry, userCountry)
}

/**
 * Current state, plus whether the page may offer the mark at all. The tickets
 * page reads this on load; it is deliberately cheap enough to sit alongside the
 * ticket list without a second full booking fetch.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: { ref: string } },
) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)

  const booking = await prisma.booking.findUnique({
    where: { bookingRef: params.ref },
    select: { ...STATE_SELECT, status: true, operationCountry: true },
  })
  if (!booking) return buildApiError('Booking not found', 404)
  if (outOfScope(session, booking.operationCountry)) return buildApiError('Forbidden', 403)

  const { status, operationCountry, ...state } = booking
  return buildApiSuccess({
    ...state,
    canSet: CAN_SET.includes(session.user.role as UserRole) && !FROZEN_STATUSES.has(status),
  })
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { ref: string } },
) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)

  const role = session.user.role as UserRole
  if (!CAN_SET.includes(role)) {
    return buildApiError('Forbidden — your role cannot change the No Tickets mark', 403)
  }

  const body = await req.json().catch(() => ({})) as { noTickets?: unknown; note?: unknown }
  if (typeof body.noTickets !== 'boolean') {
    return buildApiError('`noTickets` must be true or false')
  }
  const on   = body.noTickets
  const note = typeof body.note === 'string' ? body.note.trim().slice(0, 2000) : ''

  const booking = await prisma.booking.findUnique({
    where: { bookingRef: params.ref },
    select: {
      id: true, status: true, operationCountry: true, noTickets: true,
      _count: { select: { tickets: true } },
    },
  })
  if (!booking) return buildApiError('Booking not found', 404)
  if (outOfScope(session, booking.operationCountry)) return buildApiError('Forbidden', 403)

  if (FROZEN_STATUSES.has(booking.status)) {
    return buildApiError('This booking is cancelled — the No Tickets mark cannot be changed', 409)
  }

  // The mark says "there are none". A file that already has tickets on it would
  // then be telling two stories at once, and QC would report done over unbought
  // tickets — so the tickets have to go first.
  if (on && booking._count.tickets > 0) {
    return buildApiError(
      `This booking has ${booking._count.tickets} ticket(s) on it — delete them before marking it as No Tickets`,
      409,
    )
  }

  // Idempotent: setting what is already set is a no-op rather than a second
  // audit line, so a double-click does not litter the trail.
  if (booking.noTickets === on) {
    return buildApiSuccess(
      { bookingRef: params.ref, noTickets: on },
      on ? 'Already marked as No Tickets' : 'Not marked as No Tickets',
    )
  }

  const actor = session.user.name || session.user.email || 'Unknown'
  const now   = new Date()

  const updated = await prisma.booking.update({
    where: { bookingRef: params.ref },
    data: on
      ? { noTickets: true, noTicketsAt: now, noTicketsBy: actor, noTicketsNote: note || null }
      // Clearing keeps nothing behind: a stale "marked by" on an unmarked
      // booking reads as if the decision were still standing.
      : { noTickets: false, noTicketsAt: null, noTicketsBy: null, noTicketsNote: null },
    select: STATE_SELECT,
  })

  // Audit. `toState` is the unchanged current status — the event records a
  // decision about the file, not a move along the lifecycle.
  await prisma.statusEvent.create({
    data: {
      bookingId: booking.id,
      fromState: booking.status,
      toState:   booking.status,
      actorId:   session.user.id as string,
      note:      noTicketsAuditNote(on, note),
    },
  }).catch(() => { /* the flag is the record that matters; never fail the write on its trail */ })

  return buildApiSuccess(
    updated,
    on
      ? `${params.ref} is marked as having no tickets`
      : `No Tickets removed from ${params.ref}`,
  )
}
