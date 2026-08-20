/**
 * The raw mail log — every message that reached a monitored inbox.
 *
 * `QueryMonitorEntry` is a record of *queries*, and it hides mail on purpose:
 * internal and automated senders never reach it, the exclusion patterns divert
 * the mail that is not a new query to another tab, and a chaser is folded into
 * the row its thread already owns. Every one of those decisions is right for the
 * SLA pivots the team reads, and every one of them means the sheet cannot answer
 * the other question they ask — **what actually landed in these mailboxes?**
 *
 * This module owns the answer. One row per message, written from the same
 * inbox read the sweep was doing anyway, before anything is filtered out. The
 * key is `QueryMonitorEntry`'s own `dedupKey`, so the log and the entries join
 * exactly: a mail that became a query picks up its query's status, SLA and
 * thread columns, and a mail that never became one stands alone with a Status
 * that says why.
 */
import { prisma } from '@/lib/prisma'
import type { Prisma } from '@prisma/client'
import type { MonitoredMessage, SkipReason } from './collect'

/** One message, as the log stores it. Grows a TO list, never a second row. */
export interface LoggedMail {
  dedupKey:    string
  message:     MonitoredMessage
  /** Monitored mailboxes that received it, as the names the sheet prints. */
  handlerNames: string[]
}

/** Comma-joined, de-duplicated, order preserved — the shape a TO cell takes. */
function joinList(values: string[], max: number): string {
  const seen: string[] = []
  for (const value of values) {
    const clean = value.trim()
    if (clean && !seen.includes(clean)) seen.push(clean)
  }
  return seen.join(', ').slice(0, max)
}

/**
 * Write a sweep's whole inbox read to the log.
 *
 * Upserted rather than inserted, because the same mail comes back on every
 * overlapping sweep window and because a mail found in a second inbox has to
 * *grow* its TO list rather than take a second row. Only the TO lists and the
 * skip reason are updated on an existing row: everything else about a message
 * is fixed the moment it arrives.
 *
 * Never allowed to throw. This is a ledger written alongside the sweep's real
 * work, and a mail it fails to record must not cost the query that mail became.
 */
export async function recordMailLog(
  mails: LoggedMail[], runId: string | null,
): Promise<{ written: number; failed: number }> {
  let written = 0
  let failed  = 0

  for (const mail of mails) {
    const { message } = mail
    const toNames     = joinList(mail.handlerNames, 500)
    const toAddresses = joinList(message.recipients, 2000)

    const create: Prisma.QueryMonitorMailCreateInput = {
      dedupKey:          mail.dedupKey,
      internetMessageId: message.internetMessageId?.slice(0, 190) ?? null,
      conversationId:    message.conversationId?.slice(0, 190) ?? null,
      subject:           message.subject.slice(0, 2000),
      fromAddress:       message.fromAddress.slice(0, 320),
      fromName:          message.fromName.slice(0, 190),
      fromDomain:        message.fromDomain.slice(0, 190),
      receivedAt:        message.receivedAt,
      toNames,
      toAddresses,
      hasAttachments:    message.hasAttachments,
      bodySnippet:       (message.bodyPreview || message.bodyText).slice(0, 1200),
      skipReason:        message.skipReason,
      firstRunId:        runId,
    }

    try {
      await prisma.queryMonitorMail.upsert({
        where:  { dedupKey: mail.dedupKey },
        create,
        // A late CC or a mailbox switched on after the first sweep is the only
        // thing about a recorded message that can still change.
        update: { toNames, toAddresses, skipReason: message.skipReason },
      })
      written += 1
    } catch {
      failed += 1
    }
  }

  return { written, failed }
}

/**
 * Seed the log from the entries that existed before it did.
 *
 * Without this the tab would start on the day the log was switched on and show
 * nothing behind it, which on a workbook the team already reads a month of is
 * worse than no tab. Entries carry everything a log row needs except the TO/CC
 * addresses, which were never stored on them — those cells stay blank on the
 * seeded rows and fill in from the next sweep onwards.
 *
 * Idempotent: `skipDuplicates` on the log's unique `dedupKey` means running it
 * twice writes nothing the second time. Internal and automated mail cannot be
 * recovered by it — no entry was ever made for it — so the seeded stretch is
 * everything that reached the sheet, and only the days after the switch carry
 * the full unfiltered picture.
 */
type SeedRow = {
  id: string; dedupKey: string; conversationId: string | null; subject: string
  fromAddress: string; fromName: string; fromDomain: string; receivedAt: Date
  toList: string; bodySnippet: string
}

export async function backfillMailLog(batchSize = 1000): Promise<number> {
  let cursor: string | null = null
  let seeded = 0

  for (;;) {
    const entries: SeedRow[] = await prisma.queryMonitorEntry.findMany({
      take: batchSize,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: 'asc' },
      select: {
        id: true, dedupKey: true, conversationId: true, subject: true,
        fromAddress: true, fromName: true, fromDomain: true, receivedAt: true,
        toList: true, bodySnippet: true,
      },
    })
    if (entries.length === 0) break
    cursor = entries[entries.length - 1].id

    const result = await prisma.queryMonitorMail.createMany({
      data: entries.map(entry => ({
        dedupKey:  entry.dedupKey.slice(0, 190),
        // The entries table keeps no internetMessageId of its own — the dedup
        // key *is* one whenever Graph gave one, which is how it was built.
        internetMessageId: entry.dedupKey.includes('|') ? null : entry.dedupKey.slice(0, 190),
        conversationId: entry.conversationId?.slice(0, 190) ?? null,
        subject:     entry.subject.slice(0, 2000),
        fromAddress: entry.fromAddress.slice(0, 320),
        fromName:    entry.fromName.slice(0, 190),
        fromDomain:  entry.fromDomain.slice(0, 190),
        receivedAt:  entry.receivedAt,
        toNames:     entry.toList.slice(0, 500),
        toAddresses: '',
        bodySnippet: entry.bodySnippet.slice(0, 1200),
        // It became an entry, so by definition the pipeline took it on.
        skipReason:  null,
      })),
      skipDuplicates: true,
    })
    seeded += result.count

    if (entries.length < batchSize) break
  }

  return seeded
}

/** How much the log holds, for the dashboard and the run log. */
export async function mailLogStats(): Promise<{
  total: number
  tracked: number
  byReason: Record<string, number>
  oldest: Date | null
  newest: Date | null
}> {
  const [total, grouped, oldest, newest] = await Promise.all([
    prisma.queryMonitorMail.count(),
    prisma.queryMonitorMail.groupBy({ by: ['skipReason'], _count: { _all: true } }),
    prisma.queryMonitorMail.findFirst({ orderBy: { receivedAt: 'asc' },  select: { receivedAt: true } }),
    prisma.queryMonitorMail.findFirst({ orderBy: { receivedAt: 'desc' }, select: { receivedAt: true } }),
  ])

  const byReason: Record<string, number> = {}
  let tracked = 0
  for (const row of grouped) {
    if (row.skipReason === null) tracked = row._count._all
    else byReason[row.skipReason] = row._count._all
  }

  return {
    total, tracked, byReason,
    oldest: oldest?.receivedAt ?? null,
    newest: newest?.receivedAt ?? null,
  }
}

export type { SkipReason }
