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
 * A reason may be recorded on **any** booking, at any point in its life — before
 * D-10, after it, on a reconfirmed file and on a Hotel Only one. What the board
 * and the morning mail print is still decided by `delaySummary`, which speaks
 * only for a breach, so an explanation written early stays a note on the file
 * until the deadline it is about actually passes.
 *
 * One guard beyond the usual auth and country scoping:
 *
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
import type { BookingStatus, UserRole } from '@prisma/client'

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
      status: BookingStatus
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
async function audit(bookingId: string, status: BookingStatus, actorId: string, note: string) {
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

  const delay = await saveReconfirmDelay({
    bookingRef: params.ref,
    reason: body.reason,
    note,
    dueAt: new Date(`${view.standing.dueAt}T00:00:00.000Z`),
    actor: g.actor,
  })

  // The trail says where the file stood when the reason was written, because
  // "agent not responding, three days before the deadline" and the same words
  // three days after it are different claims about the same booking.
  const days = view.standing.daysToDue
  const standingNote =
    days < 0 ? `${Math.abs(days)} day(s) past D-${RECONFIRM_DUE_DAYS}`
    : days === 0 ? `D-${RECONFIRM_DUE_DAYS} is today`
    : `${days} day(s) before D-${RECONFIRM_DUE_DAYS}`

  await audit(
    g.bookingId, g.status, g.actorId,
    `Reconfirmation delay reason: ${delay.reasonLabel} (${standingNote})`
      + (note ? ` — ${note}` : ''),
  )

  return buildApiSuccess(
    { ...view, delay },
    view.standing.breached
      ? 'Reason recorded — it will show on the ops board and the daily report'
      : `Reason recorded — it will show on the ops board and the daily report if D-${RECONFIRM_DUE_DAYS} passes unreconfirmed`,
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
