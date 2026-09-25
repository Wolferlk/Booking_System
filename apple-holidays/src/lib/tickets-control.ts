/**
 * MC Report "Tickets Control" — a short free-text note per Vietnam movement.
 * See prisma/sql/2026-09-25-agenda-tickets-control.sql.
 *
 * Every function here tolerates the table not existing yet (the SQL has to be
 * run on each database by hand): reads come back empty, the chart-save carry
 * over is skipped, and a write says what to run.
 */
import { prisma } from '@/lib/prisma'

export const TICKETS_CONTROL_MAX = 255

export const TICKETS_CONTROL_NOT_READY =
  'Tickets Control is not set up on this database yet — run prisma/sql/apply-agenda-tickets-control.sh.'

export function isTicketsControlMissing(err: unknown): boolean {
  const e = err as { code?: string; message?: string }
  return e?.code === 'P2021' || /agenda_tickets_control.*(doesn't exist|does not exist)|1146/i.test(e?.message ?? '')
}

/** Notes for many movements at once, keyed by agenda item id. Never throws. */
export async function loadTicketsControl(agendaItemIds: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  if (!agendaItemIds.length) return out
  try {
    const rows = await prisma.agendaTicketsControl.findMany({
      where: { agendaItemId: { in: agendaItemIds } },
      select: { agendaItemId: true, value: true },
    })
    for (const r of rows) out[r.agendaItemId] = r.value
  } catch (err) {
    if (!isTicketsControlMissing(err)) console.error('[tickets-control] load failed (non-fatal):', err)
  }
  return out
}

/** Set (or, with an empty value, clear) one movement's note. Throws when the table is missing. */
export async function setTicketsControl(
  agendaItemId: string,
  bookingRef: string,
  raw: unknown,
  user: { id?: string | null; name?: string | null },
): Promise<string> {
  const value = String(raw ?? '').replace(/\s+/g, ' ').trim().slice(0, TICKETS_CONTROL_MAX)
  if (!value) {
    await prisma.agendaTicketsControl.deleteMany({ where: { agendaItemId } })
    return ''
  }
  const data = { bookingRef, value, updatedById: user.id ?? null, updatedByName: user.name ?? null }
  await prisma.agendaTicketsControl.upsert({
    where: { agendaItemId },
    create: { agendaItemId, ...data },
    update: data,
  })
  return value
}

/**
 * A chart save recreated this booking's movements under new ids: move each note
 * from the old id to the new one. `pairs` is [oldId, newId] per saved movement
 * that had an id before. A note whose movement was removed (or a chart that was
 * regenerated from scratch) is left where it is rather than deleted — it no
 * longer shows anywhere, but nothing typed is ever destroyed. Non-fatal.
 */
export async function carryTicketsControl(bookingRef: string, pairs: [string, string][]): Promise<void> {
  try {
    const existing = await prisma.agendaTicketsControl.findMany({
      where: { bookingRef, agendaItemId: { in: pairs.map(([oldId]) => oldId) } },
      select: { agendaItemId: true },
    })
    if (!existing.length) return
    const newIdFor = new Map(pairs)
    await prisma.$transaction(existing.map(({ agendaItemId }) =>
      prisma.agendaTicketsControl.update({
        where: { agendaItemId },
        data: { agendaItemId: newIdFor.get(agendaItemId)! },
      }),
    ))
  } catch (err) {
    if (!isTicketsControlMissing(err)) console.error('[tickets-control] carry-over failed (non-fatal):', err)
  }
}
