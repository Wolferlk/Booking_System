/**
 * Daily mail counts per monitored address.
 *
 * The question this answers is the one the booking team asks about volume
 * rather than about any single query: **how much mail reached each of us today,
 * and how much of it was actually a query?** The query sheet cannot answer it —
 * it deliberately holds one row per *query*, with the mail that was not a query
 * on another tab and the chasers folded away into the row they belong to.
 *
 * So the counting is done from `QueryMonitorMatch`, not from entries. A match is
 * one mail arriving at one address, which is exactly the unit being counted:
 *
 * - a mail to five handlers is **one** entry but **five** mails received, and
 *   each of those five people is entitled to see it in their own count;
 * - a chaser is folded into its query's row and has no row of its own, but it is
 *   still a mail somebody had to read, so it counts here;
 * - `availcheck@` has no mailbox of its own, and its matches are the ones
 *   recognised on the TO/CC line — see `viaAlias`.
 *
 * "Useful" and "other" are the entry's `mailKind`: QUERY is the mail that became
 * a line in the query sheet, EXCLUDED is everything the exclusion patterns
 * diverted — vouchers, on-ground incidents, availability checks, mailer noise.
 * That is the same split the team already reads on the two tabs, counted daily.
 */
import { prisma } from '@/lib/prisma'
import { isoDateInTz, SHEET_TZ, startOfDayInTz } from './dates'
import { listMailboxes } from './config'

/** One address on one day. */
export interface DailyMailboxCount {
  /** `YYYY-MM-DD` in the sheet's timezone. */
  day:          string
  mailboxId:    string
  mailbox:      string
  /** ALIAS rows are counted off the TO/CC line rather than read from a mailbox. */
  isAlias:      boolean
  /** Every mail that reached this address that day. */
  total:        number
  /** …of which became a query on the query sheet. */
  useful:       number
  /** …of which went to the other-mail tab instead. */
  other:        number
  /** Queries among them that have since been answered. */
  replied:      number
  /** Queries among them still waiting for an answer. */
  awaiting:     number
  /** Queries — anybody's — that this person is recorded as having answered. */
  answeredByThem: number
}

/** Every address on one day, plus that day's totals. */
export interface DailyTotals {
  day:      string
  total:    number
  useful:   number
  other:    number
  replied:  number
  awaiting: number
  /** Distinct queries that arrived that day, however many inboxes they hit. */
  queries:  number
}

export interface MailboxSummary {
  mailboxId:      string
  mailbox:        string
  isAlias:        boolean
  isActive:       boolean
  total:          number
  useful:         number
  other:          number
  replied:        number
  awaiting:       number
  answeredByThem: number
}

export interface DailyMailStats {
  generatedAt: string
  timezone:    string
  days:        number
  from:        string
  to:          string
  /** Newest day first — the same order the team reads the sheet in. */
  daily:       DailyTotals[]
  /** Newest day first, and within a day in the mailbox display order. */
  perMailbox:  DailyMailboxCount[]
  summary:     MailboxSummary[]
  totals:      { total: number; useful: number; other: number; replied: number; awaiting: number; queries: number }
}

/** The row shape the counting needs — deliberately narrow, this reads a lot. */
interface CountedMatch {
  mailboxId:   string
  handlerName: string
  receivedAt:  Date
  entry: {
    mailKind:    string
    replyStatus: string
    repliedBy:   string | null
  }
}

const blankCount = (
  day: string, mailbox: { id: string; displayName: string; mailboxKind: string },
): DailyMailboxCount => ({
  day,
  mailboxId: mailbox.id,
  mailbox:   mailbox.displayName,
  isAlias:   mailbox.mailboxKind === 'ALIAS',
  total: 0, useful: 0, other: 0, replied: 0, awaiting: 0, answeredByThem: 0,
})

/**
 * Count the window.
 *
 * Grouped in JavaScript rather than in SQL on purpose: the day a mail belongs to
 * is its day *in the sheet's timezone*, and `CONVERT_TZ` needs the MySQL
 * timezone tables loaded, which is not something this deployment can rely on.
 * The rows are narrow and the window is capped at 180 days, so the read stays
 * small enough to do honestly.
 */
export async function getDailyMailStats(days = 30): Promise<DailyMailStats> {
  const window = Math.min(180, Math.max(1, Math.floor(days)))
  const today  = isoDateInTz(new Date())

  // Anchored to the start of a day in the sheet's timezone, so the oldest day in
  // the report is a whole day rather than a fragment of one.
  const from = startOfDayInTz(
    isoDateInTz(new Date(Date.now() - (window - 1) * 86_400_000)),
  ) ?? new Date(Date.now() - window * 86_400_000)

  const mailboxes = await listMailboxes()
  const byId = new Map(mailboxes.map(m => [m.id, m]))

  const matches = await prisma.queryMonitorMatch.findMany({
    where:  { receivedAt: { gte: from } },
    select: {
      mailboxId: true, handlerName: true, receivedAt: true,
      entry: { select: { mailKind: true, replyStatus: true, repliedBy: true } },
    },
  }) as CountedMatch[]

  // Distinct queries per day, counted once however many inboxes they reached —
  // the number the team compares against the rows on the query sheet.
  const entries = await prisma.queryMonitorEntry.findMany({
    where:  { receivedAt: { gte: from }, mergedIntoId: null },
    select: { receivedAt: true, mailKind: true },
  })

  const cells = new Map<string, DailyMailboxCount>()
  const dayKeys = new Set<string>()

  for (const match of matches) {
    const mailbox = byId.get(match.mailboxId)
    if (!mailbox) continue // a handler removed from the team; their history stays on the entries
    const day = isoDateInTz(match.receivedAt)
    dayKeys.add(day)

    const key = `${day}|${match.mailboxId}`
    const cell = cells.get(key) ?? blankCount(day, mailbox)

    cell.total += 1
    if (match.entry.mailKind === 'EXCLUDED') {
      cell.other += 1
    } else {
      cell.useful += 1
      if (match.entry.replyStatus === 'REPLIED') cell.replied += 1
      else cell.awaiting += 1
    }
    // Credit for answering follows the name in the sheet's "Replied By" column,
    // which is the person the reply was actually sent from — not the owner of
    // the query, and not everyone it was addressed to.
    if (match.entry.repliedBy && match.entry.repliedBy === match.handlerName) {
      cell.answeredByThem += 1
    }

    cells.set(key, cell)
  }

  const queriesPerDay = new Map<string, number>()
  for (const entry of entries) {
    if (entry.mailKind !== 'QUERY') continue
    const day = isoDateInTz(entry.receivedAt)
    dayKeys.add(day)
    queriesPerDay.set(day, (queriesPerDay.get(day) ?? 0) + 1)
  }

  const days_ = Array.from(dayKeys).sort().reverse()
  const order = new Map(mailboxes.map((m, i) => [m.id, i]))

  const perMailbox = Array.from(cells.values()).sort((a, b) =>
    a.day === b.day
      ? (order.get(a.mailboxId) ?? 0) - (order.get(b.mailboxId) ?? 0)
      : (a.day < b.day ? 1 : -1),
  )

  const daily: DailyTotals[] = days_.map(day => {
    const rows = perMailbox.filter(c => c.day === day)
    return {
      day,
      total:    rows.reduce((n, c) => n + c.total, 0),
      useful:   rows.reduce((n, c) => n + c.useful, 0),
      other:    rows.reduce((n, c) => n + c.other, 0),
      replied:  rows.reduce((n, c) => n + c.replied, 0),
      awaiting: rows.reduce((n, c) => n + c.awaiting, 0),
      queries:  queriesPerDay.get(day) ?? 0,
    }
  })

  const summary: MailboxSummary[] = mailboxes.map(m => {
    const rows = perMailbox.filter(c => c.mailboxId === m.id)
    return {
      mailboxId: m.id,
      mailbox:   m.displayName,
      isAlias:   m.mailboxKind === 'ALIAS',
      isActive:  m.isActive,
      total:          rows.reduce((n, c) => n + c.total, 0),
      useful:         rows.reduce((n, c) => n + c.useful, 0),
      other:          rows.reduce((n, c) => n + c.other, 0),
      replied:        rows.reduce((n, c) => n + c.replied, 0),
      awaiting:       rows.reduce((n, c) => n + c.awaiting, 0),
      answeredByThem: rows.reduce((n, c) => n + c.answeredByThem, 0),
    }
  })

  return {
    generatedAt: new Date().toISOString(),
    timezone:    SHEET_TZ,
    days:        window,
    from:        isoDateInTz(from),
    to:          today,
    daily,
    perMailbox,
    summary,
    totals: {
      total:    daily.reduce((n, d) => n + d.total, 0),
      useful:   daily.reduce((n, d) => n + d.useful, 0),
      other:    daily.reduce((n, d) => n + d.other, 0),
      replied:  daily.reduce((n, d) => n + d.replied, 0),
      awaiting: daily.reduce((n, d) => n + d.awaiting, 0),
      queries:  daily.reduce((n, d) => n + d.queries, 0),
    },
  }
}
