import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { buildApiSuccess } from '@/lib/utils'
import { requireMailbox } from '@/lib/mailbox/guard'
import { syncRecentThreads } from '@/lib/mailbox/sync'
import { canSeeAllCountries } from '@/lib/rbac'
import type { OperationCountry, Prisma } from '@prisma/client'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/** The outbox: every mail Mail Box has sent, newest conversation first. */
export async function GET(req: NextRequest) {
  const gate = await requireMailbox('use')
  if ('error' in gate) return gate.error

  const sp   = req.nextUrl.searchParams
  const q    = sp.get('q')?.trim()
  const ref  = sp.get('ref')?.trim()
  const status = sp.get('status')?.trim()
  const take = Math.min(Number(sp.get('limit') ?? 50) || 50, 200)
  const skip = Math.max(Number(sp.get('offset') ?? 0) || 0, 0)

  // Country scoping on the outbox. A thread with no `operationCountry` is one
  // sent without a booking attached, so it stays visible to everyone — hiding
  // it from every scoped desk would make it unreachable rather than protected.
  const country = gate.actor.country
  const scoped = country && country !== 'ALL' && !canSeeAllCountries(gate.actor.role, country as OperationCountry)
  const countryClause: Prisma.MailThreadWhereInput = scoped
    ? { OR: [{ operationCountry: null }, { operationCountry: country as OperationCountry }] }
    : {}

  const where: Prisma.MailThreadWhereInput = {
    ...countryClause,
    ...(ref ? { bookingRef: ref } : {}),
    ...(status && status !== 'ALL'
      ? status === 'UNREAD' ? { unreadReplies: { gt: 0 } } : { status }
      : {}),
    ...(q ? {
      OR: [
        { subject:     { contains: q } },
        { bookingRef:  { contains: q } },
        { toAddresses: { contains: q } },
        { ccAddresses: { contains: q } },
        { sentByName:  { contains: q } },
      ],
    } : {}),
  }

  const [threads, total, unreadTotal] = await Promise.all([
    prisma.mailThread.findMany({
      where,
      orderBy: { lastMessageAt: 'desc' },
      take, skip,
      include: {
        agent:    { select: { id: true, name: true, company: true } },
        template: { select: { id: true, name: true, category: true } },
      },
    }),
    prisma.mailThread.count({ where }),
    prisma.mailThread.count({ where: { unreadReplies: { gt: 0 } } }),
  ])

  return buildApiSuccess({ threads, total, unreadTotal, hasMore: skip + threads.length < total })
}

/** Sync sweep — pulls replies for the most recently active conversations. */
export async function POST() {
  const gate = await requireMailbox('use')
  if ('error' in gate) return gate.error

  try {
    const result = await syncRecentThreads(30)
    return buildApiSuccess(result,
      result.newMessages > 0
        ? `${result.newMessages} new repl${result.newMessages === 1 ? 'y' : 'ies'} across ${result.threads} conversations.`
        : `Checked ${result.threads} conversations — nothing new.`)
  } catch (err) {
    return buildApiSuccess({ threads: 0, newMessages: 0 },
      `Could not reach the mailbox: ${err instanceof Error ? err.message : 'unknown error'}`)
  }
}
