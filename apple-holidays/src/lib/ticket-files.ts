/**
 * Several files under one ticket — see prisma/sql/2026-09-25-ticket-files.sql.
 *
 * `Ticket.fileUrl` stays the ticket's one receipt; these sit beside it, e.g.
 * one per guest on a group ticket. Everything here tolerates the table not
 * existing yet (the SQL has to be run on each database by hand): reads come
 * back empty and writes are refused with a message saying what to run.
 */
import { prisma } from '@/lib/prisma'

export interface TicketFileRow {
  id: string
  ticketId: string
  fileUrl: string
  fileName: string | null
  fileType: string | null
  label: string | null
  position: number
  uploadedByName: string | null
  createdAt: Date
}

export const TICKET_FILES_NOT_READY =
  'Multiple ticket files are not set up on this database yet — run prisma/sql/apply-ticket-files.sh.'

export const TICKET_FILE_ROLES = ['GT_USER', 'GT_VN_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN']

/** The table has not been created on this database (Prisma P2021 / MySQL 1146). */
export function isTicketFilesMissing(err: unknown): boolean {
  const e = err as { code?: string; message?: string }
  return e?.code === 'P2021' || /ticket_files.*(doesn't exist|does not exist)|1146/i.test(e?.message ?? '')
}

/** Files for many tickets at once, grouped by ticket id. Never throws. */
export async function loadTicketFiles(ticketIds: string[]): Promise<Record<string, TicketFileRow[]>> {
  const out: Record<string, TicketFileRow[]> = {}
  if (!ticketIds.length) return out
  try {
    const rows = await prisma.ticketFile.findMany({
      where: { ticketId: { in: ticketIds } },
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
    })
    for (const r of rows) (out[r.ticketId] ??= []).push(r)
  } catch (err) {
    if (!isTicketFilesMissing(err)) console.error('[ticket-files] load failed (non-fatal):', err)
  }
  return out
}

/** Remove a deleted ticket's files. Best effort — the ticket is already gone. */
export async function deleteTicketFiles(ticketId: string): Promise<void> {
  try {
    await prisma.ticketFile.deleteMany({ where: { ticketId } })
  } catch (err) {
    if (!isTicketFilesMissing(err)) console.error('[ticket-files] cleanup failed (non-fatal):', err)
  }
}
