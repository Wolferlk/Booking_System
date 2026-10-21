import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { hasPermission } from '@/lib/rbac'
import { getAccountsSupplier, isSupplierSource } from '@/lib/accounts-suppliers-db'
import { MC_SUPPLIER_NOT_READY, isMcSupplierMissing, setMcSupplier } from '@/lib/mc-supplier'
import { applyMcSupplierToLines } from '@/lib/trans-recon/server'
import type { UserRole } from '@prisma/client'

export const dynamic = 'force-dynamic'

const MAX_ITEMS = 200

/**
 * Set the Accounts supplier on one or more movements.
 * Body `{ agendaItemIds, supplier: { source, id } | null }` — null takes it off.
 * The supplier is re-read from the Accounts registry, never taken from the
 * browser, and any Trans-Reconsultation line already made from these
 * movements follows (unless its supplier was set on the sheet).
 */
export async function PUT(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  if (!hasPermission(session.user.role as UserRole, 'agenda:edit')) return buildApiError('Forbidden', 403)

  const body = await req.json().catch(() => null) as { agendaItemIds?: unknown; supplier?: { source?: unknown; id?: unknown } | null } | null
  const ids = Array.isArray(body?.agendaItemIds)
    ? Array.from(new Set(body!.agendaItemIds.filter((v): v is string => typeof v === 'string' && v.length > 0)))
    : []
  if (!ids.length) return buildApiError('agendaItemIds is required')
  if (ids.length > MAX_ITEMS) return buildApiError(`At most ${MAX_ITEMS} movements at a time`)

  let supplier = null
  if (body?.supplier) {
    const { source, id } = body.supplier
    if (!isSupplierSource(source) || !Number.isFinite(Number(id))) return buildApiError('Pick a supplier from the list')
    let found
    try { found = await getAccountsSupplier(source, Number(id)) }
    catch (err) {
      console.error('[mc-report/supplier] Accounts lookup failed:', err)
      return buildApiError('Could not reach the Accounts supplier list — try again.', 502)
    }
    if (!found) return buildApiError('That supplier is no longer in Suppliers Manage — search again.', 404)
    if (!found.active) return buildApiError(`"${found.name}" is switched off in Suppliers Manage — pick another or ask Accounts.`, 400)
    supplier = { source: found.source, id: found.id, name: found.name, country: found.country }
  }

  const items = await prisma.agendaItem.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      agenda: { select: { booking: { select: { bookingRef: true } } } },
      assignment: {
        select: {
          vendorName: true, driverName: true,
          vendor: { select: { name: true } },
          driver: { select: { name: true, vehicle: { select: { vendor: { select: { name: true } } } } } },
        },
      },
    },
  })
  if (items.length !== ids.length) return buildApiError('Some movements are gone — reload the report', 404)

  const actor = { id: session.user.id, name: session.user.name ?? session.user.email ?? null }
  try {
    const saved = await setMcSupplier(items.map(i => ({
      agendaItemId: i.id,
      bookingRef: i.agenda.booking.bookingRef,
      // The name the desk sees in Driver / Vendor — what "used last time" is remembered by.
      // Same fallback order as the chart's `vendor` field (api/mc-report/route.ts).
      party: i.assignment?.vendor?.name ?? i.assignment?.vendorName ?? i.assignment?.driver?.vehicle?.vendor?.name
        ?? i.assignment?.driverName ?? i.assignment?.driver?.name ?? null,
    })), supplier, actor)
    const sheetLines = await applyMcSupplierToLines(ids, supplier, actor)
    return buildApiSuccess({ suppliers: saved, sheetLines }, supplier ? `Supplier set on ${ids.length} movement${ids.length === 1 ? '' : 's'}` : 'Supplier removed')
  } catch (err) {
    if (isMcSupplierMissing(err)) return buildApiError(MC_SUPPLIER_NOT_READY, 503)
    throw err
  }
}
