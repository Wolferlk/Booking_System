/**
 * Query Monitor — one query's thread ledger.
 *
 * The entry list deliberately does not carry these. A busy thread has a dozen
 * events with a snippet on each, and multiplying that across 100 rows would make
 * the list payload several times the size of everything on screen — while the
 * timeline is only ever read one query at a time, in the detail panel. So it is
 * fetched when that panel opens and not before.
 */
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { requireAdmin } from '@/lib/query-monitor/auth'
import { describeThread, rollUp } from '@/lib/query-monitor/thread-events'

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requireAdmin()
  if (!guard.ok) return buildApiError('Forbidden', 403)

  const entry = await prisma.queryMonitorEntry.findUnique({
    where:  { id: params.id },
    select: { id: true, mergedIntoId: true, replySummary: true, replySummaryAt: true },
  })
  if (!entry) return buildApiError('Entry not found', 404)

  // A follow-up keeps no ledger of its own — its mail is an event on the row it
  // merged into, so that is the thread to read back.
  const rootId = entry.mergedIntoId ?? entry.id

  const events = await prisma.queryMonitorThreadEvent.findMany({
    where:   { entryId: rootId },
    orderBy: { occurredAt: 'asc' },
    take:    200,
  })

  return buildApiSuccess({
    rootId,
    events,
    // Recomputed rather than read off the entry: this panel is where someone
    // goes to check whether the stored columns are telling the truth.
    rollUp:      rollUp(events),
    ledgerSays:  describeThread(events),
    replySummary:   entry.replySummary,
    replySummaryAt: entry.replySummaryAt,
  })
}
