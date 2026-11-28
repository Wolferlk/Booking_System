/**
 * Agenda page ↔ late-flight meeting-time fill (lib/agenda-flight-time-sync.ts).
 *
 * GET  — dry run: which EMPTY airport meeting times the booking's flights can
 *        time now, which are still waiting and why, and the last automatic
 *        fill (for the page's "filled from flight details" note). Writes nothing.
 * POST — "Fill now": applies the same plan straight away, even when the
 *        automatic switch is off. Only empty times (and, if switched on, times
 *        the auto-fill wrote itself) — never one someone typed.
 */
import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { hasPermission } from '@/lib/rbac'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import type { UserRole } from '@prisma/client'
import {
  readFlightTimeLedger, syncAgendaFlightTimes, waitingText, type FlightTimeSyncResult,
} from '@/lib/agenda-flight-time-sync'
import { fillReason } from '@/lib/agenda-flight-time-plan'

export const dynamic = 'force-dynamic'

function shape(r: FlightTimeSyncResult) {
  return {
    reason: r.reason ?? null,
    autoFillEnabled: r.autoFillEnabled,
    retimeEnabled: r.retimeEnabled,
    fills: r.fills.map(f => ({
      itemId: f.itemId, date: f.date, fromPoint: f.fromPoint, toPoint: f.toPoint,
      kind: f.kind, before: f.before, after: f.after, role: f.role,
      flightNo: f.flightNo, flightTime: f.flightTime, bufferLabel: f.bufferLabel,
      driverName: f.driverName, why: fillReason(f),
    })),
    skipped: r.skipped.length,
    waiting: r.waiting.map(w => ({ ...w, text: waitingText(w) })),
  }
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { ref: string } },
) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  if (!hasPermission(session.user.role as UserRole, 'agenda:read')) return buildApiError('Forbidden', 403)

  const [plan, ledger] = await Promise.all([
    syncAgendaFlightTimes({ ref: params.ref }, { trigger: 'manual', dryRun: true }),
    readFlightTimeLedger(params.ref),
  ])
  if (plan.reason === 'no-booking') return buildApiError('Booking not found', 404)

  return buildApiSuccess({ ...shape(plan), recent: ledger.recent ?? null, autoRows: ledger.fills })
}

export async function POST(
  _req: NextRequest,
  { params }: { params: { ref: string } },
) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  if (!hasPermission(session.user.role as UserRole, 'agenda:edit')) return buildApiError('Forbidden', 403)

  const r = await syncAgendaFlightTimes({ ref: params.ref }, {
    trigger: 'manual',
    actor: { id: session.user.id, name: session.user.name || session.user.email || null },
  })
  if (r.reason === 'no-booking') return buildApiError('Booking not found', 404)
  const ledger = await readFlightTimeLedger(params.ref)
  return buildApiSuccess(
    { ...shape(r), recent: ledger.recent ?? null, autoRows: ledger.fills },
    r.fills.length ? `${r.fills.length} meeting time${r.fills.length === 1 ? '' : 's'} filled from flight details` : 'Nothing to fill',
  )
}
