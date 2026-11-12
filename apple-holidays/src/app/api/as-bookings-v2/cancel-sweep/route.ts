/**
 * AppleSystem cancellation check — the page's side.
 *
 *   GET                                  → daily settings, due/last-run, recent runs
 *   PUT  { enabled?, hour?, lookbackDays?, autoRequest? }  → save daily settings
 *   POST { from, to, dateField: 'create'|'arrival', mode: 'detect'|'request' }
 *                                        → run a range check now, return the report
 *
 * `mode: 'detect'` is a preview: it lists, changes nothing on any booking.
 * `mode: 'request'` moves eligible bookings to "requested to cancel" — the same
 * guarded transition the Live Watch uses, attributed to the person who ran it.
 * Nothing here ever cancels a booking; accounts decide.
 */
import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import type { UserRole } from '@prisma/client'
import { authOptions } from '@/lib/auth'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import {
  getDailyStatus,
  listSweepRuns,
  runCancelSweep,
  saveDailyConfig,
  validateRange,
  MAX_RANGE_DAYS,
  type SweepDateField,
  type SweepMode,
} from '@/lib/as-cancel-sweep'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

/** Same roles that may request a cancellation from the booking page / Live Watch. */
const CAN_RUN: UserRole[] = ['BT_USER', 'TE_USER', 'GT_VN_USER', 'AC_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN']
/** Changing what the automation does every morning is an admin decision. */
const CAN_CONFIGURE: UserRole[] = ['SUPER_ADMIN', 'ULTRA_SUPER_ADMIN']

async function snapshot(role: UserRole) {
  const [daily, runs] = await Promise.all([getDailyStatus(), listSweepRuns(12)])
  return { daily, runs, maxRangeDays: MAX_RANGE_DAYS, canConfigure: CAN_CONFIGURE.includes(role) }
}

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user) return buildApiError('Unauthorized', 401)
  const role = session.user.role as UserRole
  if (!CAN_RUN.includes(role)) return buildApiError('Forbidden', 403)
  return buildApiSuccess(await snapshot(role))
}

export async function PUT(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return buildApiError('Unauthorized', 401)
  const role = session.user.role as UserRole
  if (!CAN_CONFIGURE.includes(role)) return buildApiError('Only an admin can change the daily check', 403)

  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  const patch: Record<string, unknown> = {}
  if (typeof body.enabled === 'boolean') patch.enabled = body.enabled
  if (typeof body.autoRequest === 'boolean') patch.autoRequest = body.autoRequest
  if (body.hour != null) patch.hour = Number(body.hour)
  if (body.lookbackDays != null) patch.lookbackDays = Number(body.lookbackDays)

  await saveDailyConfig(patch)
  return buildApiSuccess(await snapshot(role), 'Daily cancellation check saved')
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return buildApiError('Unauthorized', 401)
  const role = session.user.role as UserRole
  if (!CAN_RUN.includes(role)) return buildApiError('You are not allowed to run a cancellation check', 403)

  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  const from = String(body.from ?? '').trim()
  const to = String(body.to ?? '').trim()
  const dateField: SweepDateField = body.dateField === 'arrival' ? 'arrival' : 'create'
  const mode: SweepMode = body.mode === 'request' ? 'request' : 'detect'

  const bad = validateRange(from, to)
  if (bad) return buildApiError(bad, 400)

  const outcome = await runCancelSweep({
    trigger: 'manual',
    mode,
    dateField,
    from,
    to,
    actorId: session.user.id,
    actorName: session.user.name ?? session.user.email ?? 'Unknown user',
  })
  if (!outcome.ran) return buildApiError(outcome.message, outcome.reason === 'already-running' ? 409 : 400)
  if (outcome.run.error) {
    return buildApiError(`AppleSystem could not be read: ${outcome.run.error}`, 502)
  }

  const s = outcome.run.summary
  const message = mode === 'detect'
    ? `${s.upstream} cancelled in AppleSystem · ${s.matched} in our system · nothing changed (preview)`
    : `${s.requested} booking${s.requested === 1 ? '' : 's'} requested to cancel · ${s.matched} matched of ${s.upstream} cancelled upstream`

  return buildApiSuccess({ run: outcome.run, details: outcome.details, ...(await snapshot(role)) }, message)
}
