/**
 * The "All Mails" ledger — every collected message as a sheet row.
 *
 * The rule this module exists to keep is a single sentence: **nothing is left
 * out.** Every other view the Query Monitor produces filters something. The
 * query sheet folds a thread's chasers into one row and holds only new business.
 * The other-mail tab holds only what the exclusion patterns diverted. Neither
 * has ever seen internal or automated mail. Here, one message is one row — the
 * chaser, the voucher, the out-of-office, the colleague's forward — in the order
 * they arrived.
 *
 * A row is a *message* but its columns come from the *query* it belongs to, when
 * it belongs to one. That is the join at the heart of this file:
 *
 *   log row  ──dedupKey──▶  entry  ──mergedIntoId──▶  root entry
 *
 * A mail that opened a query reads its own entry. A chaser reads the root whose
 * sheet row stands for the thread, so its SLA, reply detail and thread summary
 * are the thread's rather than blank. A mail with no entry at all — internal,
 * automated, or arriving before the log was switched on — carries what the
 * envelope itself knows, and says so in the Status column.
 */
import { prisma } from '@/lib/prisma'
import type { QueryMonitorEntry, QueryMonitorMail } from '@prisma/client'
import {
  ALL_MAILS_STATUS, REPLY_STATUS_SHEET_LABEL, USEFUL_MAIL_LABEL, type ReplyStatus,
} from './constants'
import {
  getConfig, listActiveSenderRules, matchSenderRule, startDateBoundary,
} from './config'
import { toExcelDateSerial, toExcelDateTimeSerial } from './dates'
import {
  REPLY_TYPE_SHEET_LABEL, responseHours, slaOutcome, threadMailCount,
} from './row-fields'

/**
 * A row on the all-mail tab, columns A–Z.
 *
 * The query sheet's columns minus the three that only mean anything on a query
 * — Replied time (a raw mail has no clock of its own), Sales Person and
 * Destination — plus Usefull mail, which only this tab has.
 * See `ALL_MAILS_SHEET_COLUMNS`.
 */
export interface AllMailsRowValues {
  date:            number | ''  // A — Excel date serial
  status:          string       // B — where the query stands, or what this mail is
  /**
   * C — Usefull / NotUsefull: does an active sender rule claim this address or
   * its domain? See `USEFUL_MAIL_LABEL`. Never blank — a mail is one or the
   * other, and a blank would read as "not checked".
   */
  usefulMail:      string
  subject:         string       // D — as it was actually sent, prefixes and all
  allocationTime:  number | ''  // E — Excel datetime serial
  fileHandler:     string       // F
  from:            string       // G
  fromEmail:       string       // H
  toList:          string       // I — every monitored mailbox it reached
  agent:           string       // J
  travelDate:      number | ''  // K
  cntl:            string       // L
  amendment:       string       // M
  region:          string       // N
  repliedBy:       string       // O
  responseHours:   number | ''  // P
  sla:             string       // Q
  threadCount:     number | ''  // R
  lastMail:        number | ''  // S
  aiSummary:       string       // T
  repliedByEmail:  string       // U
  repliedTo:       string       // V
  replyType:       string       // W
  forwardChain:    string       // X
  replySummary:    string       // Y
  duplicateReason: string       // Z
}

export function allMailsRowToCells(row: AllMailsRowValues): (string | number)[] {
  return [
    row.date, row.status, row.usefulMail, row.subject, row.allocationTime, row.fileHandler,
    row.from, row.fromEmail, row.toList, row.agent, row.travelDate, row.cntl,
    row.amendment, row.region, row.repliedBy, row.responseHours, row.sla,
    row.threadCount, row.lastMail, row.aiSummary, row.repliedByEmail,
    row.repliedTo, row.replyType, row.forwardChain, row.replySummary,
    row.duplicateReason,
  ]
}

export interface AllMailsReport {
  generatedAt: string
  /** How many days back the window reaches. */
  days:        number
  from:        string
  to:          string
  rows:        AllMailsRowValues[]
  /** Rows dropped by the row ceiling, oldest first — 0 in the normal case. */
  truncated:   number
  totals: {
    /** Mails in the window, before the ceiling. */
    total:     number
    /** …that the query pipeline took on. */
    tracked:   number
    /** …that opened a query on the query sheet. */
    queries:   number
    /** …that chased a thread another row already carries. */
    followUps: number
    /** …that an exclusion pattern diverted to the other-mail tab. */
    other:     number
    /** …from our own tenant, which no other tab has ever shown. */
    internal:  number
    /** …from noreply addresses, mailer daemons and tenant notifications. */
    automated: number
    /** …whose sender an active rule claims — the Usefull mail column, counted. */
    useful:    number
  }
}

/**
 * The most rows this tab will ever carry.
 *
 * A ceiling rather than a truncated window because the two failures are not
 * equally bad: a tab missing its oldest day is a gap the team can widen the
 * window to close, and a Graph write that times out halfway leaves the tab
 * half-rewritten, which is worse than yesterday's copy of it. The newest mail is
 * kept — nobody opens this tab to read three weeks back.
 */
export const MAX_ALL_MAILS_ROWS = 6000

/** The entry columns a row reads. Narrow on purpose: this reads a lot of them. */
type SourceEntry = Pick<QueryMonitorEntry,
  | 'id' | 'dedupKey' | 'mergedIntoId' | 'mailKind' | 'replyStatus' | 'handlerNames'
  | 'agent' | 'travelDate' | 'cntl' | 'amendment' | 'region' | 'receivedAt'
  | 'repliedAt' | 'repliedBy' | 'repliedByEmail' | 'repliedToAddress' | 'replyType'
  | 'forwardChain' | 'aiSummary' | 'replySummary' | 'duplicateReason'
  | 'lastMessageAt' | 'inboundCount' | 'outboundCount' | 'followUpCount'>

const SOURCE_SELECT = {
  id: true, dedupKey: true, mergedIntoId: true, mailKind: true, replyStatus: true,
  handlerNames: true, agent: true, travelDate: true, cntl: true, amendment: true,
  region: true, receivedAt: true, repliedAt: true, repliedBy: true,
  repliedByEmail: true, repliedToAddress: true, replyType: true, forwardChain: true,
  aiSummary: true, replySummary: true, duplicateReason: true, lastMessageAt: true,
  inboundCount: true, outboundCount: true, followUpCount: true,
} as const

/**
 * What column B says about this mail.
 *
 * A query says where it stands. Everything else says what it is instead —
 * because on a ledger of raw mail, "Pending" against an out-of-office notice
 * would be a lie about work nobody owes.
 */
function statusFor(
  mail: QueryMonitorMail, entry: SourceEntry | undefined, root: SourceEntry | undefined,
): string {
  if (!entry) {
    if (mail.skipReason === 'INTERNAL')  return ALL_MAILS_STATUS.INTERNAL
    if (mail.skipReason === 'AUTOMATED') return ALL_MAILS_STATUS.AUTOMATED
    return ALL_MAILS_STATUS.UNTRACKED
  }
  // A chaser has no standing of its own — the thread's row carries the clock.
  if (entry.mergedIntoId) {
    const kind = root?.mailKind ?? entry.mailKind
    return kind === 'EXCLUDED' ? ALL_MAILS_STATUS.EXCLUDED : ALL_MAILS_STATUS.FOLLOW_UP
  }
  if (entry.mailKind === 'EXCLUDED') return ALL_MAILS_STATUS.EXCLUDED
  return REPLY_STATUS_SHEET_LABEL[entry.replyStatus as ReplyStatus] ?? ''
}

/** A sender rule, as the useful-mail test needs it. See `matchSenderRule`. */
export type RuleForMatch = { matchType: string; pattern: string }

/**
 * Usefull / NotUsefull for one sender.
 *
 * Asked of the *mail's own* sender, not of the thread's — on a ledger of raw
 * mail, a colleague's internal forward of an MMT query is not itself mail from
 * MMT, and calling it Usefull would double-count the agency's traffic.
 */
export function usefulMailFor(
  mail: Pick<QueryMonitorMail, 'fromAddress' | 'fromDomain'>, rules: readonly RuleForMatch[],
): string {
  return matchSenderRule(mail.fromAddress, mail.fromDomain, rules)
    ? USEFUL_MAIL_LABEL.USEFUL
    : USEFUL_MAIL_LABEL.NOT_USEFUL
}

/** One log row, with the query it belongs to filled in around it. */
export function buildAllMailsRow(
  mail: QueryMonitorMail, entry: SourceEntry | undefined,
  root: SourceEntry | undefined, slaHours: number,
  rules: readonly RuleForMatch[] = [],
): AllMailsRowValues {
  // The columns that describe the *conversation* come from the row that owns
  // it. For a chaser that is the thread's root; for anything else, itself.
  const source = root ?? entry

  return {
    date:           toExcelDateSerial(mail.receivedAt),
    status:         statusFor(mail, entry, root),
    usefulMail:     usefulMailFor(mail, rules),
    // Left exactly as sent, "Re:" and all — unlike the query sheet, which
    // titles a row with the query rather than with the newest envelope. Here
    // the row *is* the envelope, and hiding that it was a reply would hide the
    // one thing that tells it apart from the mail above it.
    subject:        (mail.subject || '(no subject)').replace(/\s+/g, ' ').trim().slice(0, 500),
    allocationTime: toExcelDateTimeSerial(mail.receivedAt),
    fileHandler:    source?.handlerNames ?? '',
    from:           mail.fromName || mail.fromAddress,
    fromEmail:      mail.fromAddress,
    // The monitored mailboxes this message reached — read off its own envelope,
    // not off the thread's, so a chaser that went to one more person shows it.
    toList:         mail.toNames,
    agent:          source?.agent ?? '',
    travelDate:     toExcelDateSerial(source?.travelDate ?? null),
    cntl:           source?.cntl ?? '',
    amendment:      source?.amendment ?? '',
    region:         source?.region ?? '',
    repliedBy:      source?.repliedBy ?? '',
    responseHours:  source ? responseHours(source.receivedAt, source.repliedAt) : '',
    sla:            source ? slaOutcome(source.receivedAt, source.repliedAt, slaHours) : '',
    threadCount:    source ? threadMailCount(source) : '',
    // The thread's newest mail, not this one's timestamp: read beside column D
    // it says how long ago the conversation this mail belongs to last moved.
    lastMail:       toExcelDateTimeSerial(source?.lastMessageAt ?? mail.receivedAt),
    aiSummary:      source?.aiSummary ?? '',
    repliedByEmail: source?.repliedByEmail ?? '',
    repliedTo:      source?.repliedToAddress ?? '',
    replyType:      REPLY_TYPE_SHEET_LABEL[source?.replyType ?? ''] ?? '',
    forwardChain:   source?.forwardChain ?? '',
    replySummary:   source?.replySummary ?? '',
    duplicateReason: source?.duplicateReason ?? '',
  }
}

/**
 * Every mail in the window, oldest first, as rows.
 *
 * Three reads, not one per row: the log for the window, the entries those rows
 * name, and the roots the merged ones point at. A join in SQL would be tidier
 * and would also mean the tab could not be built at all on a database where the
 * two tables have drifted apart — they are deliberately not related by a foreign
 * key, because the log has to be able to hold mail no entry will ever exist for.
 */
export async function getAllMailsReport(days?: number): Promise<AllMailsReport> {
  const cfg    = await getConfig()
  const window = Math.min(90, Math.max(1, days ?? cfg.allMailsDays))

  const since  = new Date(Date.now() - window * 86_400_000)
  // Never reach behind the day the workbook starts on: mail older than that is
  // deliberately absent from every other tab, and a ledger that contradicts them
  // reads as a bug rather than as more information.
  const cutoff = startDateBoundary(cfg.startDate)
  const from   = cutoff && cutoff > since ? cutoff : since
  const to     = new Date()

  const total = await prisma.queryMonitorMail.count({ where: { receivedAt: { gte: from } } })

  // The same active rules, in the same priority order, that fill the Agent
  // column on the query sheet — so Usefull mail can never disagree with it.
  const rules = await listActiveSenderRules()

  // Newest-first in SQL so the row ceiling drops the *oldest* mail when the
  // window holds more than the tab can carry, then reversed below: the tab
  // reads oldest at the top, newest at the bottom, like a ledger.
  const mails = (await prisma.queryMonitorMail.findMany({
    where:   { receivedAt: { gte: from } },
    orderBy: { receivedAt: 'desc' },
    take:    MAX_ALL_MAILS_ROWS,
  })).reverse()

  const entries = await prisma.queryMonitorEntry.findMany({
    where:  { dedupKey: { in: mails.map(m => m.dedupKey) } },
    select: SOURCE_SELECT,
  })
  const byDedupKey = new Map(entries.map(e => [e.dedupKey, e as SourceEntry]))

  // The threads the chasers belong to. Usually already in `entries` — the root
  // is normally in the same window — but not when the window's oldest day cuts
  // a conversation in half, which is exactly when a blank SLA would be noticed.
  const rootIds = Array.from(new Set(
    entries.map(e => e.mergedIntoId).filter((id): id is string => !!id),
  ))
  const roots = rootIds.length > 0
    ? await prisma.queryMonitorEntry.findMany({
        where:  { id: { in: rootIds } },
        select: SOURCE_SELECT,
      })
    : []
  const byId = new Map<string, SourceEntry>([
    ...entries.map(e => [e.id, e as SourceEntry] as const),
    ...roots.map(e => [e.id, e as SourceEntry] as const),
  ])

  const totals = {
    total, tracked: 0, queries: 0, followUps: 0, other: 0, internal: 0,
    automated: 0, useful: 0,
  }

  const rows = mails.map(mail => {
    const entry = byDedupKey.get(mail.dedupKey)
    const root  = entry?.mergedIntoId ? byId.get(entry.mergedIntoId) : undefined

    if (!entry) {
      if (mail.skipReason === 'INTERNAL')       totals.internal  += 1
      else if (mail.skipReason === 'AUTOMATED') totals.automated += 1
    } else {
      totals.tracked += 1
      if (entry.mergedIntoId) totals.followUps += 1
      else if (entry.mailKind === 'EXCLUDED') totals.other += 1
      else totals.queries += 1
    }

    const row = buildAllMailsRow(mail, entry, root, cfg.slaHours, rules)
    if (row.usefulMail === USEFUL_MAIL_LABEL.USEFUL) totals.useful += 1
    return row
  })

  return {
    generatedAt: to.toISOString(),
    days:        window,
    from:        from.toISOString(),
    to:          to.toISOString(),
    rows,
    truncated:   Math.max(0, total - rows.length),
    totals,
  }
}
