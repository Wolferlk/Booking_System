/**
 * The shared entrance rate card behind the Tour Settlement sheet.
 *
 *   GET   every attraction in the catalogue with the adult / child price the
 *         desk has set against it, plus anything priced that is not shipped.
 *   PUT   save prices. One row per attraction, upserted; a price cleared on
 *         both sides removes the row rather than storing a zero.
 *
 * ---- Who may use it ----
 *
 * Reading runs on `pnl:read`, the same gate as the Drive Log and the settlement
 * documents. Writing needs `assignment:edit` or `pnl:view_profit` — the Sri
 * Lankan ground desk, Accounts and the admins — because a rate typed here is
 * the figure every later booking's sheet starts from.
 *
 * ---- What it writes ----
 *
 * Rows in this system's own `sl_tour_rates`, and nothing else in either
 * database. No booking, agenda, allocation, P&L or saved settlement pack is
 * touched by any path in this file, and a change here never reaches back into a
 * sheet that has already been saved.
 */
import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { hasPermission } from '@/lib/rbac'
import { loadRateCard, parseRates, saveRateCard } from '@/lib/sl-tour-rate-card'
import type { UserRole } from '@prisma/client'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const canWrite = (role: UserRole) =>
  hasPermission(role, 'assignment:edit') || hasPermission(role, 'pnl:view_profit')

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)

  const role = session.user.role as UserRole
  if (!hasPermission(role, 'pnl:read')) return buildApiError('Forbidden', 403)

  try {
    const card = await loadRateCard()
    return buildApiSuccess({ ...card, canWrite: canWrite(role) })
  } catch (err) {
    console.error('[drive-log/documents/rate-card GET]', err)
    return buildApiError('The rate card could not be loaded.', 500)
  }
}

export async function PUT(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)

  const role = session.user.role as UserRole
  if (!canWrite(role)) {
    return buildApiError('Only the operations desk, Accounts and admins may edit the rate card.', 403)
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return buildApiError('The request body was not valid JSON.', 400)
  }

  const rates = parseRates((body as { rates?: unknown })?.rates ?? body)
  if (!rates.length) return buildApiError('No rates were sent.', 400)

  try {
    const card = await saveRateCard(rates, session.user.name ?? session.user.email ?? null)
    return buildApiSuccess({ ...card, canWrite: true })
  } catch (err) {
    // The table is created by a hand-applied migration; until it has been,
    // saying so is far more use than a 500 with no explanation.
    if ((err as { code?: string })?.code === 'P2021') {
      return buildApiError(
        'The rate card table has not been created on this database yet, so shared rates cannot be saved. ' +
        'Rates typed on a sheet still save with that booking.',
        503,
      )
    }
    console.error('[drive-log/documents/rate-card PUT]', err)
    return buildApiError('The rate card could not be saved.', 500)
  }
}
