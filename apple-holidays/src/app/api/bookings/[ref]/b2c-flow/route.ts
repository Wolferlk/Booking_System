/**
 * GET → what Aahaas Flow knows about a B2C booking's store order, for the
 * booking page: every product (photos, supplier, status, service date, money),
 * the fulfilment checklist, the order journey, the documents on file and —
 * for roles that see profit — the order's P&L.
 *
 * Each part is read on its own: one Flow source failing leaves the others on
 * the page with that part's own error. Read-only; same auth and country scope
 * as the Aahaas Order card.
 */
import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildApiSuccess } from '@/lib/utils'
import { hasPermission } from '@/lib/rbac'
import { loadB2cBookingForOrder } from '@/lib/b2c-order-access'
import { flowGet, isFlowConfigured } from '@/lib/aahaas-flow-api'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

type Part<T> = { data: T; error: null } | { data: null; error: string }

async function part<T>(work: () => Promise<T>): Promise<Part<T>> {
  try {
    return { data: await work(), error: null }
  } catch (err) {
    return { data: null, error: (err as Error).message }
  }
}

export async function GET(_req: NextRequest, { params }: { params: { ref: string } }) {
  const session = await getServerSession(authOptions)
  const gate = await loadB2cBookingForOrder(params.ref, session)
  if ('error' in gate) return gate.error
  const id = gate.booking.orderId
  const canProfit = hasPermission(session!.user.role, 'pnl:view_profit')

  if (!isFlowConfigured()) {
    return buildApiSuccess({ connected: false, orderId: id, canProfit })
  }

  const actor = session!.user.email ?? session!.user.name ?? null
  const [order, track, documents, pnl] = await Promise.all([
    part(() => flowGet<Record<string, unknown>>(`b2c/orders/${id}`, actor)),
    // Only the journey itself — the tracker's other parts carry supplier costs.
    part(async () => (await flowGet<{ track?: unknown }>(`track/${id}`, actor)).track ?? null),
    part(() => flowGet<Record<string, unknown>>(`documents/${id}`, actor)),
    canProfit ? part(() => flowGet<Record<string, unknown>>(`finance/orders/${id}`, actor)) : Promise.resolve(null),
  ])

  return buildApiSuccess({ connected: true, orderId: id, canProfit, order, track, documents, pnl })
}
