/**
 * The per-row actions on the Live Watch cancellation panel.
 *
 *   POST   { ref } → send this detected cancellation for accounts approval.
 *   DELETE ?ref=   → drop a decided row from the panel (never touches the booking).
 *
 * POST is the deliberate half of the design: detection always runs, but the
 * status change is gated, so this is how a backlog gets adopted one booking at a
 * time and how an on-ground tour is actioned once a person has actually looked
 * at it. It is guarded to the same roles that may request a cancellation by hand
 * from the booking page — the automation must not become a way around that.
 */
import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { getWatchStatus } from '@/lib/as-watch'
import { requestCancellationByHand, dismissCancelEntry } from '@/lib/as-watch-cancel'
import type { UserRole } from '@prisma/client'

export const dynamic = 'force-dynamic'

/** Kept in step with the cancel route's own list, and with CAN_CANCEL_ROLES. */
const CAN_REQUEST: UserRole[] = ['BT_USER', 'TE_USER', 'GT_VN_USER', 'AC_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN']

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return buildApiError('Unauthorized', 401)
  if (!CAN_REQUEST.includes(session.user.role as UserRole)) {
    return buildApiError('You are not allowed to request a cancellation', 403)
  }

  const body = await req.json().catch(() => ({}))
  const ref = String(body?.ref ?? '').trim()
  if (!ref) return buildApiError('A booking ref is required')

  // Who asked is taken from the session, never from the body — the point of the
  // button is that a *named person* stands behind this one, unlike the sweep.
  const outcome = await requestCancellationByHand(ref, {
    id: session.user.id,
    name: session.user.name ?? session.user.email ?? 'Unknown user',
    email: session.user.email ?? '',
  })
  if (!outcome.ok) return buildApiError(outcome.error ?? 'Could not send for approval')

  return buildApiSuccess(
    { status: await getWatchStatus() },
    `${ref} sent to the accounts team for cancellation approval`,
  )
}

export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return buildApiError('Unauthorized', 401)
  if (!CAN_REQUEST.includes(session.user.role as UserRole)) return buildApiError('Forbidden', 403)

  const ref = req.nextUrl.searchParams.get('ref')?.trim()
  if (!ref) return buildApiError('A booking ref is required')

  const removed = await dismissCancelEntry(ref)
  if (!removed) return buildApiError('That row is no longer in the list')

  return buildApiSuccess({ status: await getWatchStatus() }, `${ref} cleared from the list`)
}
