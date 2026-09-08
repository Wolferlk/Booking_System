/**
 * POST /api/srilanka/driver-settlements/bulk — the register, many rows at once.
 *
 * Three actions over a selection:
 *
 *   assign    put the selected tours into a bulk, name what they are being
 *             settled for, set the budget they are measured against, or write a
 *             remark. Bookkeeping only: it touches no figure and no status, so
 *             a tour accounts has already settled can still be filed into a
 *             bulk afterwards.
 *   submit    send each selected booking's saved figures to the accounts team.
 *   withdraw  take those submissions back before they are acted on.
 *
 * ---- What this route cannot do ----
 *
 * Pay anybody, in bulk or otherwise. `submit` writes rows in
 * `sl_transport_settlement_requests` and nothing else; the money is released on
 * Payable 1.0 by an accounts user, one booking at a time, through code that
 * re-derives the obligation and refuses an unapproved P&L. A bulk here is a
 * *batch of paperwork*, never a batch payment — see `sl-transport-actuals.ts`
 * for why that boundary is drawn where it is and how it is enforced.
 *
 * ---- Partial success is the normal outcome ----
 *
 * Twenty bookings submitted together will routinely include one that is already
 * pending and one nobody has costed. Those are reported per booking and the
 * rest still go through: an all-or-nothing bulk would mean the desk hunting for
 * the single row that blocked the other nineteen.
 */
import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { hasPermission } from '@/lib/rbac'
import {
  applySettlementMeta, submitTransportActuals, withdrawTransportActuals,
  toBulkNo, toCostType, type SettlementCostType, type TransportActuals,
} from '@/lib/sl-transport-actuals'
import type { UserRole } from '@prisma/client'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

/** One request may not carry more than a working session's worth of bookings. */
const MAX_BOOKINGS = 200

type Action = 'assign' | 'submit' | 'withdraw'

interface Body {
  action?: Action
  bookingIds?: string[]
  bulkNo?: string | null
  costType?: string | null
  budgetedCost?: number | string | null
  remarks?: string | null
}

interface Outcome {
  bookingId: string
  tour: string
  ok: boolean
  error?: string
  actuals?: TransportActuals
}

/** "" and null both mean "no figure"; anything unparseable is an error, not a zero. */
function figure(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number(String(v).replace(/,/g, ''))
  if (!Number.isFinite(n)) throw new Error('The budgeted cost is not a number.')
  if (n < 0) throw new Error('The budgeted cost cannot be negative.')
  return n
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)

  const role = session.user.role as UserRole
  if (!hasPermission(role, 'pnl:view_profit')) {
    return buildApiError('Only the Accounts team and admins may record driver settlements.', 403)
  }

  let body: Body
  try {
    body = await req.json()
  } catch {
    return buildApiError('Expected a JSON body.', 400)
  }

  const action = body.action ?? 'assign'
  if (!['assign', 'submit', 'withdraw'].includes(action)) {
    return buildApiError('action must be assign, submit or withdraw.', 400)
  }

  const ids = Array.from(new Set((body.bookingIds ?? []).map(String).filter(Boolean)))
  if (ids.length === 0) return buildApiError('Select at least one booking.', 400)
  if (ids.length > MAX_BOOKINGS) {
    return buildApiError(`That is more than ${MAX_BOOKINGS} bookings — narrow the selection first.`, 400)
  }

  // Read the bookings here rather than trusting the browser: the identity
  // stamped onto an accounts row — IS number, control number, arrival — is what
  // the accounts side matches on, and it must come from the database.
  const bookings = await prisma.booking.findMany({
    where: { id: { in: ids }, operationCountry: 'SRILANKA' },
    select: {
      id: true, bookingRef: true, isNumber: true, cntlNumber: true, arrivalDate: true,
      slDriverAllocation: {
        select: { driver: { select: { name: true } }, vendor: { select: { name: true } } },
      },
    },
  })

  const found = new Map(bookings.map(b => [b.id, b]))
  const actor = session.user.name ?? session.user.email ?? 'unknown'

  let budgetedCost: number | null = null
  try {
    budgetedCost = figure(body.budgetedCost)
  } catch (err) {
    return buildApiError(err instanceof Error ? err.message : 'Invalid budgeted cost.', 400)
  }

  const costType: SettlementCostType | null = toCostType(body.costType)
  if (body.costType && body.costType !== '' && !costType) {
    return buildApiError('That is not a cost type this register knows.', 400)
  }

  // Only the fields actually sent are changed. An absent key leaves the column
  // as it stands, so setting a bulk number across twenty rows does not wipe the
  // cost types somebody set on them yesterday.
  const meta: Record<string, unknown> = {}
  if ('bulkNo' in body)       meta.bulkNo = toBulkNo(body.bulkNo)
  if ('costType' in body)     meta.costType = costType
  if ('budgetedCost' in body) meta.budgetedCost = budgetedCost
  if ('remarks' in body)      meta.remarks = body.remarks ?? null

  if (action === 'assign' && Object.keys(meta).length === 0) {
    return buildApiError('Nothing to record — set a bulk number, cost type, budget or remark.', 400)
  }

  const results: Outcome[] = []

  for (const id of ids) {
    const booking = found.get(id)
    const tour = booking?.isNumber || booking?.bookingRef || id

    if (!booking) {
      results.push({ bookingId: id, tour, ok: false, error: 'Not a Sri Lankan booking on this system.' })
      continue
    }

    try {
      if (action === 'submit') {
        results.push({ bookingId: id, tour, ok: true, actuals: await submitTransportActuals(id, actor) })
      } else if (action === 'withdraw') {
        results.push({ bookingId: id, tour, ok: true, actuals: await withdrawTransportActuals(id, actor) })
      } else {
        const actuals = await applySettlementMeta({
          bookingId:  booking.id,
          bookingRef: booking.bookingRef,
          isNumber:   booking.isNumber,
          cntlNumber: booking.cntlNumber,
          travelStartDate: booking.arrivalDate.toISOString().slice(0, 10),
          driverName: booking.slDriverAllocation?.driver?.name
            ?? booking.slDriverAllocation?.vendor?.name ?? null,
          pnlRecordId: null,

          actualPackageCost: null,
          actualBalancePayable: null,
          note: null,
          computedTotalCost: null,
          computedAdvance: null,
          computedBalancePayable: null,
          advancePaid: null,
          rate: null,
          ...meta,
        }, actor)

        results.push({ bookingId: id, tour, ok: true, actuals })
      }
    } catch (err) {
      results.push({
        bookingId: id, tour, ok: false,
        error: err instanceof Error ? err.message : 'That booking could not be updated.',
      })
    }
  }

  const done = results.filter(r => r.ok).length
  const failed = results.length - done

  return buildApiSuccess({
    action,
    results,
    done,
    failed,
    message: failed === 0
      ? `${done} booking${done === 1 ? '' : 's'} updated.`
      : `${done} updated, ${failed} could not be — see the list.`,
  })
}
