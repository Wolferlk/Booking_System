/**
 * Why a booking's guest reconfirmation missed its D-10 deadline.
 *
 * `GET` returns where the booking stands against the deadline together with the
 * recorded explanation, so the panel renders from one round trip and never has
 * to decide for itself what "not reconfirmed" means.
 *
 * `PUT` records or replaces the explanation; `DELETE` withdraws it — used when
 * the reason turns out to be wrong, not when the booking is finally reconfirmed
 * (a reconfirmed booking simply stops being asked, and its last explanation is
 * left in place as the record of what held it up).
 *
 * Two guards beyond the usual auth and country scoping:
 *
 *   • **Only a breached booking may carry a reason.** Accepting one before D-10
 *     would let the desk pre-excuse work it has not missed yet, and the board
 *     would fill with explanations for deadlines that were met.
 *   • **`OTHER` must be written out.** A bare "Other" tells the morning report
 *     nothing, which is the one outcome this whole feature exists to prevent.
 *
 * Every write appends a `StatusEvent`, so the file's own trail says who
 * explained the delay and how — the lifecycle status is never touched, because
 * an explanation changes what ops *knows*, not where the booking *is*.
 */
import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { canSeeAllCountries } from '@/lib/rbac'
import { isInCountryScope } from '@/lib/country-detection'
import {
  RECONFIRM_DUE_DAYS, REASON_META, clearReconfirmDelay, isReconfirmReason,
  loadBookingReconfirm, saveReconfirmDelay,
} from '@/lib/reconfirm-delay'
import type { UserRole } from '@prisma/client'

export const dynamic = 'force-dynamic'

/**
 * Who may explain a delay. The three desks that actually chase a guest —
 * booking, ground and travel experience — plus admins. Accounts is absent for
 * the same reason it cannot set Hotel Only: this is an operational note, not a
 * financial one, even when the reason it records is an unpaid balance.
 */
const CAN_WRITE: UserRole[] = [
  'BT_USER', 'GT_USER', 'GT_TE_USER', 'TE_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN',
]

type Guard =
  | { ok: false; error: ReturnType<typeof buildApiError> }
  | {
      ok: true
      bookingId: string
      status: string
      actorId: string
      actor: string
    }

/** Auth + country scope, shared by all three verbs. */
async function guard(ref: string, opts: { write: boolean }): Promise<Guard> {
  const session = await getServerSession(authOptions)
  if (!session) return { ok: false, error: buildApiError('Unauthorized', 401) }

  const role = session.user.role as UserRole
  if (opts.write && !CAN_WRITE.includes(role)) {
    return { ok: false, error: buildApiError('Forbidden — your role cannot record a reconfirmation reason', 403) }
  }

  const booking = await prisma.booking.findUnique({
    where: { bookingRef: ref },
    select: { id: true, status: true, operationCountry: true },
  })
  if (!booking) return { ok: false, error: buildApiError('Booking not found', 404) }

  const userCountry = session.user.country as string | undefined
  if (!canSeeAllCountries(role, userCountry as never) && userCountry && userCountry !== 'ALL') {
    if (!isInCountryScope(booking.operationCountry, userCountry)) {
      return { ok: false, error: buildApiError('Forbidden', 403) }
    }
  }

  return {
    ok: true,
    bookingId: booking.id,
    status: booking.status,
    actorId: session.user.id as string,
    actor: session.user.name || session.user.email || 'Unknown',
  }
}

/** Append the decision to the file's trail. Never fails the write. */
async function audit(bookingId: string, status: string, actorId: string, note: string) {
  await prisma.statusEvent.create({
    data: { bookingId, fromState: status, toState: status, actorId, note },
  }).catch(() => { /* the reason is the record that matters; not its trail */ })
}

export async function GET(_req: NextRequest, { params }: { params: { ref: string } }) {
  const g = await guard(params.ref, { write: false })
  if (!g.ok) return g.error

  const view = await loadBookingReconfirm(params.ref)
  if (!view) return buildApiError('Booking not found', 404)
  return buildApiSuccess(view)
}

export async function PUT(req: NextRequest, { params }: { params: { ref: string } }) {
  const g = await guard(params.ref, { write: true })
  if (!g.ok) return g.error

  const body = await req.json().catch(() => ({})) as { reason?: unknown; note?: unknown }
  if (!isReconfirmReason(body.reason)) {
    return buildApiError('`reason` must be one of the reconfirmation delay reasons')
  }
  const note = typeof body.note === 'string' ? body.note.trim() : ''
  if (REASON_META[body.reason].requiresNote && !note) {
    return buildApiError(`“${REASON_META[body.reason].label}” needs a written explanation`)
  }

  const view = await loadBookingReconfirm(params.ref)
  if (!view) return buildApiError('Booking not found', 404)

  // Refuse to record a reason for a deadline that was not missed. The message
  // says which of the three ways it was not missed, so an operator who expected
  // the field to be there learns why it is not rather than retrying.
  if (!view.standing.needsReason) {
    const why =
      view.standing.state === 'NA'   ? 'this is a Hotel Only booking — there is no tour to reconfirm with the guest'
      : view.standing.state === 'DONE' ? 'this booking is already reconfirmed'
      : view.standing.state === 'PAST' ? 'the guest has already travelled — the deadline is closed'
      : `D-${RECONFIRM_DUE_DAYS} has not passed yet — it falls on ${view.standing.dueAt}`
    return buildApiError(`No reason is needed: ${why}`, 409)
  }

  const delay = await saveReconfirmDelay({
    bookingRef: params.ref,
    reason: body.reason,
    note,
    dueAt: new Date(`${view.standing.dueAt}T00:00:00.000Z`),
    actor: g.actor,
  })

  await audit(
    g.bookingId, g.status, g.actorId,
    `Reconfirmation delay reason: ${delay.reasonLabel}`
      + ` (${Math.abs(view.standing.daysToDue)} day(s) past D-${RECONFIRM_DUE_DAYS})`
      + (note ? ` — ${note}` : ''),
  )

  return buildApiSuccess(
    { ...view, delay },
    `Reason recorded — it will show on the ops board and the daily report`,
  )
}

export async function DELETE(_req: NextRequest, { params }: { params: { ref: string } }) {
  const g = await guard(params.ref, { write: true })
  if (!g.ok) return g.error

  const removed = await clearReconfirmDelay(params.ref)
  if (removed) {
    await audit(g.bookingId, g.status, g.actorId, 'Reconfirmation delay reason withdrawn')
  }

  const view = await loadBookingReconfirm(params.ref)
  return buildApiSuccess(view, removed ? 'Reason removed' : 'There was no reason recorded')
}
