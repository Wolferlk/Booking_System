import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { parseCancellationPolicy, roleInAudience } from '@/lib/cancellation-policy'
import {
  VERIFY_ACTION, isVerifyAction, issueVerification, bookingTarget, bookingSetTarget,
  bookingFilterTarget,
  VerificationUnavailableError, type VerifyAction,
} from '@/lib/action-verification'
import type { UserRole } from '@prisma/client'

export const dynamic = 'force-dynamic'

/**
 * Step one of cancelling or deleting a booking: mail the signed-in user a code.
 *
 * The target is derived here from the booking references in the body — never
 * accepted from the client — so a code can only ever be issued for the booking
 * the caller named, and the same derivation on the destructive route is what
 * binds the two calls together.
 *
 * The permission for the action itself is re-checked before a code goes out.
 * That is not for security (the destructive route checks again, and that is the
 * check that counts) but so nobody is walked through a confirmation for
 * something they were never going to be allowed to do.
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)

  const body = await req.json().catch(() => ({}))
  const action = body?.action
  if (!isVerifyAction(action)) return buildApiError('Unknown action')

  const role = session.user.role as UserRole
  const resolved = await resolveTarget(action, body, role)
  if ('error' in resolved) return buildApiError(resolved.error, resolved.status)

  try {
    const challenge = await issueVerification({
      userId:   session.user.id,
      email:    session.user.email ?? '',
      userName: session.user.name ?? null,
      action,
      target:   resolved.target,
      label:    resolved.label,
      ipAddress: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
    })

    return buildApiSuccess(
      {
        verificationId: challenge.id,
        maskedEmail:    challenge.maskedEmail,
        expiresAt:      challenge.expiresAt.toISOString(),
        label:          resolved.label,
      },
      `Confirmation code sent to ${challenge.maskedEmail}`,
    )
  } catch (err) {
    if (err instanceof VerificationUnavailableError) return buildApiError(err.message, 503)
    return buildApiError(err instanceof Error ? err.message : 'Could not send the confirmation code', 400)
  }
}

type Resolved = { target: string; label: string } | { error: string; status: number }

const DELETE_ROLES = ['SUPER_ADMIN', 'ULTRA_SUPER_ADMIN']
// Kept in step with the role list in /api/bookings/[ref]/cancel.
const CANCEL_ROLES = ['BT_USER', 'TE_USER', 'GT_VN_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN']

async function resolveTarget(action: VerifyAction, body: Record<string, unknown>, role: UserRole): Promise<Resolved> {
  if (action === VERIFY_ACTION.BOOKING_BULK_DELETE) {
    if (!DELETE_ROLES.includes(role)) return { error: 'Only Super Admin can delete bookings', status: 403 }

    const refs = Array.isArray(body.bookingRefs)
      ? body.bookingRefs.map(r => String(r).trim()).filter(Boolean)
      : []
    if (refs.length === 0) return { error: 'No bookings selected', status: 400 }
    if (refs.length > 100) return { error: 'Cannot delete more than 100 bookings at once', status: 400 }

    const found = await prisma.booking.count({ where: { bookingRef: { in: refs } } })
    if (found === 0) return { error: 'No matching bookings found', status: 404 }

    const unique = Array.from(new Set(refs.map(r => r.toUpperCase())))
    return {
      target: bookingSetTarget(refs),
      label:  unique.length === 1 ? unique[0] : `${unique.length} bookings`,
    }
  }

  if (action === VERIFY_ACTION.BOOKING_FILTERED_DELETE) {
    if (!DELETE_ROLES.includes(role)) return { error: 'Only Super Admin can delete bookings', status: 403 }

    const filters = body.filters
    if (!filters || typeof filters !== 'object') {
      return { error: 'At least one filter is required', status: 400 }
    }
    // Only how many match is quoted back — the set is re-evaluated when the
    // delete actually runs, and the code is bound to the filter, not the count.
    const count = typeof body.matchCount === 'number' ? body.matchCount : null
    return {
      target: bookingFilterTarget(filters),
      label:  count === null ? 'a filtered set of bookings' : `${count} booking${count === 1 ? '' : 's'} matching your filter`,
    }
  }

  const ref = String(body.bookingRef ?? '').trim()
  if (!ref) return { error: 'Booking reference is required', status: 400 }

  const booking = await prisma.booking.findUnique({
    where: { bookingRef: ref },
    select: { bookingRef: true, status: true },
  })
  if (!booking) return { error: 'Booking not found', status: 404 }

  if (action === VERIFY_ACTION.BOOKING_DELETE && !DELETE_ROLES.includes(role)) {
    return { error: 'Only Super Admin can delete bookings', status: 403 }
  }
  if (action === VERIFY_ACTION.BOOKING_CANCEL && !CANCEL_ROLES.includes(role)) {
    return { error: 'Your role is not allowed to cancel a booking', status: 403 }
  }
  if (action === VERIFY_ACTION.BOOKING_FULL_CANCEL) {
    const rows = await prisma.systemSetting.findMany({
      where: { key: { startsWith: 'cancel_' } },
      select: { key: true, value: true },
    })
    const raw: Record<string, string> = {}
    for (const r of rows) raw[r.key] = r.value
    const policy = parseCancellationPolicy(raw)
    if (!policy.fullEnabled) return { error: 'Full cancel is switched off in Settings', status: 403 }
    if (!roleInAudience(role, policy.fullAudience)) {
      return { error: 'Your role is not allowed to fully cancel a booking', status: 403 }
    }
  }

  return { target: bookingTarget(booking.bookingRef), label: booking.bookingRef }
}
