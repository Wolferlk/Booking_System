/** Query Monitor — entry list, filters and headline stats. */
import { NextRequest } from 'next/server'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { requireAdmin } from '@/lib/query-monitor/auth'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const guard = await requireAdmin()
  if (!guard.ok) return buildApiError('Forbidden', 403)

  const p = req.nextUrl.searchParams
  const take   = Math.min(Number(p.get('limit') ?? '100'), 500)
  const skip   = Math.max(Number(p.get('offset') ?? '0'), 0)
  const search = (p.get('search') ?? '').trim()
  const status = p.get('status')       // REPLIED | PENDING | OVERDUE
  const sync   = p.get('sync')         // PENDING | SYNCED | DIRTY | FAILED
  const handler = (p.get('handler') ?? '').trim()
  const days   = Number(p.get('days') ?? '30')
  // QUERY (the default) | EXCLUDED | ALL — which worksheet the mail belongs to.
  const kind   = (p.get('kind') ?? 'QUERY').toUpperCase()

  const and: Prisma.QueryMonitorEntryWhereInput[] = []

  if (Number.isFinite(days) && days > 0) {
    and.push({ receivedAt: { gte: new Date(Date.now() - days * 86_400_000) } })
  }
  if (kind === 'QUERY')         and.push({ mailKind: 'QUERY' })
  else if (kind === 'EXCLUDED') and.push({ mailKind: 'EXCLUDED' })
  if (status) and.push({ replyStatus: status })
  if (sync)   and.push({ syncStatus: sync })
  if (handler) and.push({ handlerNames: { contains: handler } })
  if (search) {
    and.push({
      OR: [
        { subject:     { contains: search } },
        { fromAddress: { contains: search } },
        { fromName:    { contains: search } },
        { agent:       { contains: search } },
        { salesPerson: { contains: search } },
        { destination: { contains: search } },
        { cntl:        { contains: search } },
      ],
    })
  }

  const where: Prisma.QueryMonitorEntryWhereInput = and.length ? { AND: and } : {}

  // The kind tallies ignore the kind filter — they are what the two tabs' badges
  // count, so each must stay visible while looking at the other.
  const kindWhere: Prisma.QueryMonitorEntryWhereInput = and.length
    ? { AND: and.filter(clause => !('mailKind' in clause)) }
    : {}

  const [entries, total, statusCounts, syncCounts, kindCounts, syncCountsAllKinds] = await Promise.all([
    prisma.queryMonitorEntry.findMany({
      where, take, skip,
      orderBy: { receivedAt: 'desc' },
      include: { matches: { select: { handlerName: true, repliedAt: true, mailboxId: true } } },
    }),
    prisma.queryMonitorEntry.count({ where }),
    prisma.queryMonitorEntry.groupBy({ by: ['replyStatus'], where, _count: { _all: true } }),
    prisma.queryMonitorEntry.groupBy({ by: ['syncStatus'],  where, _count: { _all: true } }),
    prisma.queryMonitorEntry.groupBy({ by: ['mailKind'], where: kindWhere, _count: { _all: true } }),
    // Both tabs' backlog — what the header's "Sync to sheet" button counts.
    prisma.queryMonitorEntry.groupBy({ by: ['syncStatus'], where: kindWhere, _count: { _all: true } }),
  ])

  const replyTally = new Map(statusCounts.map(r => [r.replyStatus, r._count._all]))
  const syncTally  = new Map(syncCounts.map(r => [r.syncStatus, r._count._all]))
  const kindTally  = new Map(kindCounts.map(r => [r.mailKind, r._count._all]))
  const allSync    = new Map(syncCountsAllKinds.map(r => [r.syncStatus, r._count._all]))
  const at = (map: Map<string, number>, key: string) => map.get(key) ?? 0

  return buildApiSuccess({
    entries,
    total,
    stats: {
      replied:      at(replyTally, 'REPLIED'),
      pending:      at(replyTally, 'PENDING'),
      overdue:      at(replyTally, 'OVERDUE'),
      synced:       at(syncTally, 'SYNCED'),
      // Counts both tabs: the Sync button writes the whole backlog, not just
      // whichever list is on screen.
      awaitingSync: at(allSync, 'PENDING') + at(allSync, 'DIRTY'),
      failed:       at(syncTally, 'FAILED'),
      queries:      at(kindTally, 'QUERY'),
      excluded:     at(kindTally, 'EXCLUDED'),
    },
  })
}
