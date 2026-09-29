/**
 * MC Report "done" marks (`agenda_mc_done`) — the Sri Lanka desk ticks off a
 * movement once it has run and the report paints the row green. See
 * prisma/sql/2026-09-29-agenda-mc-done.sql.
 *
 * Like mc-details.ts, everything here tolerates the table not existing yet (the
 * SQL is run on each database by hand): reads come back empty, the chart-save
 * carry-over is skipped, and a write says what to run.
 */
import { prisma } from '@/lib/prisma'

export const MC_DONE_NOT_READY =
  'MC Report "done" marks are not set up on this database yet — run prisma/sql/apply-agenda-mc-done.sh.'

export function isMcDoneMissing(err: unknown): boolean {
  const e = err as { code?: string; message?: string }
  return e?.code === 'P2021' || /agenda_mc_done.*(doesn't exist|does not exist)|1146/i.test(e?.message ?? '')
}

export type McDone = { at: string; by: string | null }

/** Done marks for many movements at once, keyed by agenda item id. Never throws. */
export async function loadMcDone(agendaItemIds: string[]): Promise<Record<string, McDone>> {
  const out: Record<string, McDone> = {}
  if (!agendaItemIds.length) return out
  try {
    const rows = await prisma.agendaMcDone.findMany({ where: { agendaItemId: { in: agendaItemIds } } })
    for (const r of rows) out[r.agendaItemId] = { at: r.doneAt.toISOString(), by: r.doneByName ?? null }
  } catch (err) {
    if (!isMcDoneMissing(err)) console.error('[mc-done] load failed (non-fatal):', err)
  }
  return out
}

/**
 * Mark (or un-mark) movements done. Marking one already done keeps its original
 * time and name. Throws the Prisma error when the table is missing.
 */
export async function setMcDone(
  items: { agendaItemId: string; bookingRef: string }[],
  done: boolean,
  user: { id?: string | null; name?: string | null },
): Promise<Record<string, McDone | null>> {
  const ids = items.map(i => i.agendaItemId)
  if (!done) {
    await prisma.agendaMcDone.deleteMany({ where: { agendaItemId: { in: ids } } })
    return Object.fromEntries(ids.map(id => [id, null]))
  }
  await prisma.agendaMcDone.createMany({
    data: items.map(i => ({
      agendaItemId: i.agendaItemId, bookingRef: i.bookingRef,
      doneById: user.id ?? null, doneByName: user.name ?? null,
    })),
    skipDuplicates: true,
  })
  return loadMcDone(ids)
}

/**
 * A chart save recreated this booking's movements under new ids: move each mark
 * from the old id to the new one. A mark whose movement was removed is left
 * where it is, never deleted. Non-fatal.
 */
export async function carryMcDone(bookingRef: string, pairs: [string, string][]): Promise<void> {
  if (!pairs.length) return
  try {
    const existing = await prisma.agendaMcDone.findMany({
      where: { bookingRef, agendaItemId: { in: pairs.map(([oldId]) => oldId) } },
      select: { agendaItemId: true },
    })
    if (!existing.length) return
    const newIdFor = new Map(pairs)
    await prisma.$transaction(existing.map(({ agendaItemId }) =>
      prisma.agendaMcDone.update({
        where: { agendaItemId },
        data: { agendaItemId: newIdFor.get(agendaItemId)! },
      }),
    ))
  } catch (err) {
    if (!isMcDoneMissing(err)) console.error('[mc-done] carry-over failed (non-fatal):', err)
  }
}
