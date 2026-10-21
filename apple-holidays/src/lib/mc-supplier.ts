/**
 * MC Report supplier picks (`agenda_mc_suppliers`) — which Accounts supplier
 * (Suppliers Manage, see accounts-suppliers-db.ts) a movement is paid to. See
 * prisma/sql/2026-10-21-transport-suppliers.sql.
 *
 * Like mc-done.ts, everything here tolerates the table not existing yet (the
 * SQL is run on each database by hand): reads come back empty, the chart-save
 * carry-over is skipped, and a write says what to run.
 */
import { prisma } from '@/lib/prisma'
import { isSupplierSource, partyKey, type SupplierRef, type SupplierSource } from '@/lib/accounts-suppliers-db'

export const MC_SUPPLIER_NOT_READY =
  'Supplier picks are not set up on this database yet — run prisma/sql/apply-transport-suppliers.sh.'

export function isMcSupplierMissing(err: unknown): boolean {
  const e = err as { code?: string; message?: string }
  return e?.code === 'P2021' || /agenda_mc_suppliers.*(doesn't exist|does not exist)|1146/i.test(e?.message ?? '')
}

export type McSupplier = {
  source: SupplierSource
  id: number
  name: string
  country: string | null
  by: string | null
  at: string
}

type Row = {
  agendaItemId: string; supplierSource: string; supplierId: bigint; supplierName: string
  supplierCountry: string | null; setByName: string | null; updatedAt: Date
}

function toPick(r: Row): McSupplier | null {
  if (!isSupplierSource(r.supplierSource)) return null
  return {
    source: r.supplierSource, id: Number(r.supplierId), name: r.supplierName,
    country: r.supplierCountry ?? null, by: r.setByName ?? null, at: r.updatedAt.toISOString(),
  }
}

/** Supplier picks for many movements at once, keyed by agenda item id. Never throws. */
export async function loadMcSuppliers(agendaItemIds: string[]): Promise<Record<string, McSupplier>> {
  const out: Record<string, McSupplier> = {}
  if (!agendaItemIds.length) return out
  try {
    const rows = await prisma.agendaMcSupplier.findMany({ where: { agendaItemId: { in: agendaItemIds } } })
    for (const r of rows) { const p = toPick(r); if (p) out[r.agendaItemId] = p }
  } catch (err) {
    if (!isMcSupplierMissing(err)) console.error('[mc-supplier] load failed (non-fatal):', err)
  }
  return out
}

/**
 * Set (or, with `supplier` null, clear) the supplier on movements. `party` is
 * the movement's driver / vendor as the chart shows it — remembered so the
 * next pick for the same driver can be suggested. Throws the Prisma error when
 * the table is missing.
 */
export async function setMcSupplier(
  items: { agendaItemId: string; bookingRef: string; party: string | null }[],
  supplier: SupplierRef | null,
  user: { id?: string | null; name?: string | null },
): Promise<Record<string, McSupplier | null>> {
  const ids = items.map(i => i.agendaItemId)
  if (!supplier) {
    await prisma.agendaMcSupplier.deleteMany({ where: { agendaItemId: { in: ids } } })
    return Object.fromEntries(ids.map(id => [id, null]))
  }
  const data = {
    supplierSource: supplier.source, supplierId: BigInt(supplier.id), supplierName: supplier.name.slice(0, 191),
    supplierCountry: supplier.country, setById: user.id ?? null, setByName: user.name ?? null,
  }
  await prisma.$transaction(items.map(i => prisma.agendaMcSupplier.upsert({
    where: { agendaItemId: i.agendaItemId },
    create: { agendaItemId: i.agendaItemId, bookingRef: i.bookingRef, partyKey: partyKey(i.party), ...data },
    update: { bookingRef: i.bookingRef, partyKey: partyKey(i.party), ...data },
  })))
  return loadMcSuppliers(ids)
}

/**
 * The supplier each driver / vendor was last paid through, by normalised
 * name — "SURESH" picked as "Suresh Transport" on Monday is suggested on
 * Tuesday. Never throws.
 */
export async function lastSupplierFor(party: string | null | undefined): Promise<McSupplier | null> {
  const key = partyKey(party)
  if (!key) return null
  try {
    const r = await prisma.agendaMcSupplier.findFirst({ where: { partyKey: key }, orderBy: { updatedAt: 'desc' } })
    return r ? toPick(r) : null
  } catch (err) {
    if (!isMcSupplierMissing(err)) console.error('[mc-supplier] last-used lookup failed (non-fatal):', err)
    return null
  }
}

/**
 * A chart save recreated this booking's movements under new ids: move each
 * pick from the old id to the new one. A pick whose movement was removed is
 * left where it is, never deleted. Non-fatal.
 */
export async function carryMcSupplier(bookingRef: string, pairs: [string, string][]): Promise<void> {
  if (!pairs.length) return
  try {
    const existing = await prisma.agendaMcSupplier.findMany({
      where: { bookingRef, agendaItemId: { in: pairs.map(([oldId]) => oldId) } },
      select: { agendaItemId: true },
    })
    if (!existing.length) return
    const newIdFor = new Map(pairs)
    await prisma.$transaction(existing.map(({ agendaItemId }) =>
      prisma.agendaMcSupplier.update({
        where: { agendaItemId },
        data: { agendaItemId: newIdFor.get(agendaItemId)! },
      }),
    ))
  } catch (err) {
    if (!isMcSupplierMissing(err)) console.error('[mc-supplier] carry-over failed (non-fatal):', err)
  }
}
