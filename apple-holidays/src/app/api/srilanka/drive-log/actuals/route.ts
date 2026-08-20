/**
 * POST /api/srilanka/drive-log/actuals — the desk's own transport figures.
 *
 * Three actions on one booking's row:
 *
 *   save      write the actual package cost and actual balance payable, and
 *             leave them here. Nobody else sees them.
 *   submit    send the saved figures to the accounts team, who settle from
 *             them on Payable 1.0.
 *   withdraw  take a submission back before it has been acted on.
 *
 * ---- What this route cannot do ----
 *
 * Pay anything. `submit` writes one row in `sl_transport_settlement_requests`
 * and nothing else; the money is released by an accounts user pressing Record
 * settlement, through code that re-derives the booking's real obligation,
 * refuses an unapproved P&L, splits the amount across the supplier lines and
 * files the bank slip. See `src/lib/sl-transport-actuals.ts` for why the
 * boundary is drawn there and how it is enforced.
 *
 * ---- Who may use it ----
 *
 * `pnl:view_profit` rather than the `pnl:read` the rest of the Drive Log runs
 * on. Reading what a booking costs is one thing; asserting that the accounts
 * system's figure is wrong, and asking for money to be released against your
 * assertion, is another — so it is the Accounts and admin roles only.
 */
import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { hasPermission } from '@/lib/rbac'
import {
  saveTransportActuals, submitTransportActuals, withdrawTransportActuals,
} from '@/lib/sl-transport-actuals'
import type { UserRole } from '@prisma/client'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type Action = 'save' | 'submit' | 'withdraw'

interface Body {
  action?: Action
  bookingId?: string
  actualPackageCost?: number | string | null
  actualBalancePayable?: number | string | null
  note?: string | null
  /** The derived figures the browser was showing — see below. */
  computed?: {
    totalCost?: number | null
    advance?: number | null
    balancePayable?: number | null
    advancePaid?: number | null
    rate?: number | null
  }
}

/** "" and null both mean "no figure"; anything unparseable is an error, not a zero. */
function figure(v: number | string | null | undefined, label: string): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number(String(v).replace(/,/g, ''))
  if (!Number.isFinite(n)) throw new Error(`${label} is not a number.`)
  if (n < 0) throw new Error(`${label} cannot be negative.`)
  return n
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)

  const role = session.user.role as UserRole
  if (!hasPermission(role, 'pnl:view_profit')) {
    return buildApiError('Only the Accounts team and admins may record actual transport figures.', 403)
  }

  let body: Body
  try {
    body = await req.json()
  } catch {
    return buildApiError('Expected a JSON body.', 400)
  }

  const action = body.action ?? 'save'
  const bookingId = String(body.bookingId ?? '').trim()
  if (!bookingId) return buildApiError('bookingId is required.', 400)
  if (!['save', 'submit', 'withdraw'].includes(action)) {
    return buildApiError('action must be save, submit or withdraw.', 400)
  }

  // The booking is re-read here rather than trusted from the browser: the
  // identity stamped onto the accounts row — IS number, control number, arrival
  // — is what the accounts side matches on, and it must come from the database,
  // not from a payload anyone could edit.
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: {
      id: true, bookingRef: true, isNumber: true, cntlNumber: true,
      arrivalDate: true, operationCountry: true,
      slDriverAllocation: {
        select: { driver: { select: { name: true } }, vendor: { select: { name: true } } },
      },
    },
  })

  if (!booking) return buildApiError('Booking not found.', 404)
  if (booking.operationCountry !== 'SRILANKA') {
    return buildApiError('The Drive Log covers Sri Lankan bookings only.', 400)
  }

  const actor = session.user.name ?? session.user.email ?? 'unknown'

  try {
    if (action === 'submit') {
      return buildApiSuccess({
        actuals: await submitTransportActuals(bookingId, actor),
        message: 'Sent to the accounts team. They will settle from this figure on Payable 1.0.',
      })
    }

    if (action === 'withdraw') {
      return buildApiSuccess({
        actuals: await withdrawTransportActuals(bookingId, actor),
        message: 'Withdrawn. The accounts team will no longer see this figure.',
      })
    }

    const actuals = await saveTransportActuals({
      bookingId: booking.id,
      bookingRef: booking.bookingRef,
      isNumber: booking.isNumber,
      cntlNumber: booking.cntlNumber,
      travelStartDate: booking.arrivalDate.toISOString().slice(0, 10),
      driverName: booking.slDriverAllocation?.driver?.name
        ?? booking.slDriverAllocation?.vendor?.name
        ?? null,
      // Not resolved here on purpose: the accounts side matches on the IS and
      // control keys, which are stamped from the booking above, and looking the
      // P&L id up would mean a second round trip for a column that is only ever
      // a shortcut.
      pnlRecordId: null,

      actualPackageCost:    figure(body.actualPackageCost, 'Actual transport package cost'),
      actualBalancePayable: figure(body.actualBalancePayable, 'Actual balance payable'),
      note: body.note ?? null,

      // What the screen was comparing against, frozen onto the row. Taken from
      // the browser because it is a *record of what the person saw*, not a
      // figure anything is computed from — the accounts side re-derives its own
      // obligation regardless, and this only ever appears as context beside it.
      computedTotalCost:      figure(body.computed?.totalCost, 'Total cost'),
      computedAdvance:        figure(body.computed?.advance, 'Advance'),
      computedBalancePayable: figure(body.computed?.balancePayable, 'Balance payable'),
      advancePaid:            figure(body.computed?.advancePaid, 'Advance paid'),
      rate:                   figure(body.computed?.rate, 'Rate'),
    }, actor)

    return buildApiSuccess({ actuals, message: 'Saved.' })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'That change could not be saved.'
    console.error('[drive-log/actuals]', err)
    // These are all "you cannot do that from here" answers rather than faults:
    // already submitted, already settled, nothing to withdraw, a figure that is
    // not a figure. The window shows the sentence, so 422 is the honest status.
    return buildApiError(message, 422)
  }
}
