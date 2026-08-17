/**
 * Query Monitor sweep — the job that runs every hour.
 *
 * One pass does four things, in order:
 *   1. reads each active file-handler inbox since the lookback window,
 *   2. collapses a mail that reached several handlers into ONE entry whose
 *      "File Handler" cell lists every recipient (the whole point of the
 *      dedup — the sheet must never carry the same query twice),
 *   3. enriches it (sender rule → sales person / agent, regex → destination /
 *      travel date / CNTL, GPT only for what is still missing),
 *   4. appends new rows to the master workbook and rewrites rows whose reply
 *      landed after they were first written.
 *
 * Every step is recorded on the QueryMonitorRun row, which is what the "View
 * log" screen reads. A sweep never throws: a broken mailbox or a locked
 * workbook downgrades the run to PARTIAL and the next hour tries again.
 */
import { prisma } from '@/lib/prisma'
import type { Prisma, QueryMonitorEntry } from '@prisma/client'
import {
  REPLIED_ROW_FILL, REPLY_STATUS_SHEET_LABEL, SETTINGS, UNMATCHED_SALES_PERSON,
  type ReplyStatus, type RunStatus, type RunTrigger,
} from './constants'
import {
  getConfig, listActiveMailboxes, mailboxAddresses, setSetting, startDateBoundary,
} from './config'
import { classifySubject, parseExcludePatterns } from './classify'
import {
  fetchInboxSince, fetchSentIndex, findSentInConversation,
  type MonitoredMessage, type SentIndex, type SentMessage,
} from './collect'
import { extractByRules, extractWithAi } from './extract'
import {
  isoDateInTz, startOfDayInTz, toExcelDateSerial, toExcelDateTimeSerial,
} from './dates'
import {
  displaySubject, hasReference, normalizeSubject, subjectKeyFor, threadKeyFor,
} from './thread'
import { summarizeMail, summarizeThread } from './summarize'
import {
  buildDirectory, classifyOutbound, describeThread, needsThreadSummary,
  reassignThreadEvents, recordThreadEvent, rollUpEntry, timelineLines,
  type Directory, type EventKind, type ThreadRollUp,
} from './thread-events'
import { exportDailyStatsToSheet } from './daily-stats-sheet'
import {
  EXCLUDED_LAYOUT, QUERY_LAYOUT, appendExcludedRows, appendRows, closeSession,
  deleteRowsAt, ensureWorksheet, findLastDataRow, layoutFor, openSession, readValuesRange,
  remapRowNumber, resolveSheetRef, setRowFill, updateExcludedRow, updateRow,
  type ExcludedRowValues, type SheetLayout, type SheetRef, type SheetRowValues,
  type WorkbookTarget,
} from './sheet'

// ── Run log ──────────────────────────────────────────────────────────────────

export type StepLevel = 'info' | 'success' | 'warn' | 'error'

export interface RunStep {
  t:     string
  level: StepLevel
  msg:   string
  meta?: Record<string, unknown>
}

export interface RunSummary {
  runId:            string | null
  status:           RunStatus
  skipped?:         string
  mailboxesScanned: number
  messagesSeen:     number
  entriesCreated:   number
  entriesUpdated:   number
  repliesDetected:  number
  rowsAppended:     number
  rowsUpdated:      number
  aiCalls:          number
  errors:           number
  durationMs:       number
  steps:            RunStep[]
}

export class RunLog {
  readonly steps: RunStep[] = []
  errors = 0

  add(level: StepLevel, msg: string, meta?: Record<string, unknown>) {
    this.steps.push({ t: new Date().toISOString(), level, msg, ...(meta ? { meta } : {}) })
    if (level === 'error') this.errors += 1
    const tag = level === 'error' ? '✕' : level === 'warn' ? '!' : level === 'success' ? '✓' : '·'
    console.log(`[QueryMonitor] ${tag} ${msg}`)
  }
}

// ── Sender rules ─────────────────────────────────────────────────────────────

interface SenderResolution {
  salesPerson: string
  agent:       string
  region:      string | null
  destination: string | null
  ruleId:      string | null
}

type SenderRule = Awaited<ReturnType<typeof loadSenderRules>>[number]

async function loadSenderRules() {
  return prisma.queryMonitorSenderRule.findMany({
    where:   { isActive: true },
    orderBy: [{ priority: 'desc' }, { pattern: 'asc' }],
  })
}

/**
 * Exact address beats domain, and higher priority beats lower — so a single
 * salesperson at a big agency can be split out without touching the domain rule.
 */
export function resolveSender(
  address: string, domain: string, fromName: string, rules: SenderRule[],
): SenderResolution {
  const lowerAddress = address.toLowerCase()
  const lowerDomain  = domain.toLowerCase()

  const byEmail = rules.find(r => r.matchType === 'EMAIL' && r.pattern.toLowerCase() === lowerAddress)
  const byDomain = rules.find(r =>
    r.matchType === 'DOMAIN' &&
    (lowerDomain === r.pattern.toLowerCase() || lowerDomain.endsWith(`.${r.pattern.toLowerCase()}`)))

  const rule = byEmail ?? byDomain
  if (rule) {
    return {
      salesPerson: rule.salesPerson,
      agent:       rule.agent,
      region:      rule.region ?? null,
      destination: rule.destination ?? null,
      ruleId:      rule.id,
    }
  }

  // No rule: keep the row, but label it the way the team already labels unknown
  // agents in the sheet, and put the sender's own name in the Agent column so
  // the row is still actionable.
  return {
    salesPerson: UNMATCHED_SALES_PERSON,
    agent:       fromName || domain || address,
    region:      null,
    destination: null,
    ruleId:      null,
  }
}

// ── Grouping ─────────────────────────────────────────────────────────────────

interface GroupHandler {
  mailboxId:   string
  handlerName: string
  graphId:     string
  receivedAt:  Date
  /**
   * True for a distribution group recognised on the mail's TO/CC line rather
   * than read out of its own inbox. Such a recipient belongs in the TO list —
   * the team wants to see that a query also went to availcheck — but never in
   * the running for File Handler: a group cannot own a query or answer one.
   */
  viaAlias?:   boolean
}

interface MessageGroup {
  dedupKey: string
  message:  MonitoredMessage
  handlers: GroupHandler[]
}

/**
 * A monitored address with no mailbox behind it: `availcheck@aahaas.com` is a
 * distribution group, so Graph answers ErrorInvalidUser for it and, without
 * Group.Read.All, will not even say what it is.
 *
 * It is still one of the addresses the booking team works out of, so its traffic
 * is recognised the only way it can be without a new tenant permission: on the
 * TO/CC line of the mail its members receive. That costs no extra Graph call —
 * the recipients come back with the message that is being read anyway.
 *
 * The blind spot is worth stating plainly: a mail sent *only* to the group, with
 * nobody monitored on it, reaches no inbox this system reads and is therefore
 * invisible. Licencing the group as a shared mailbox, or granting Group.Read.All,
 * is what would close that gap.
 */
interface AliasMailbox {
  id:          string
  displayName: string
  addresses:   string[]
}

/** Every alias recipient of this mail, as handlers to fold into the group. */
function aliasHandlersFor(message: MonitoredMessage, aliases: AliasMailbox[]): GroupHandler[] {
  if (aliases.length === 0 || message.recipients.length === 0) return []
  const on = new Set(message.recipients)
  return aliases
    .filter(alias => alias.addresses.some(address => on.has(address)))
    .map(alias => ({
      mailboxId:   alias.id,
      handlerName: alias.displayName,
      // The message identity we have is the copy read out of a member's inbox;
      // the group has no mailbox of its own to hold a different one.
      graphId:     message.graphId,
      receivedAt:  message.receivedAt,
      viaAlias:    true,
    }))
}

/** Stable key for "the same mail", whichever inbox it was seen in. */
export function dedupKeyFor(message: MonitoredMessage): string {
  if (message.internetMessageId) return message.internetMessageId.slice(0, 190)
  const subject = message.subject.toLowerCase().replace(/^(re|fw|fwd)\s*:\s*/gi, '').trim()
  return `${message.conversationId ?? 'no-conv'}|${subject}`.slice(0, 190)
}

// ── Threads ──────────────────────────────────────────────────────────────────

type EntryWithMatches = Prisma.QueryMonitorEntryGetPayload<{ include: { matches: true } }>

/**
 * Has this round been closed off by an answer the new mail is a response to?
 *
 * A thread is not one query for ever. While a query is still open, a second mail
 * from the agent is a chaser — the same unanswered question, and folding it into
 * the row keeps the SLA measured from when it was first asked. Once we have
 * actually replied, though, the round is over: the next mail is the agent coming
 * back with something new, and it deserves a line and an SLA clock of its own.
 *
 * `repliedAt` is the right signal because it is only ever set by a *direct*
 * reply addressed back to the asker — a forward to a colleague leaves it null,
 * so passing a query on can never split the thread.
 */
function roundIsClosed(root: { repliedAt: Date | null }, message: MonitoredMessage): boolean {
  return root.repliedAt !== null && root.repliedAt <= message.receivedAt
}

/**
 * The row that already stands for this mail's thread, if there is one.
 *
 * `dedupKeyFor` recognises one mail seen in several inboxes; this recognises the
 * *next* mail of a conversation the sheet already carries — the chaser, the
 * "any update?", the agent replying into their own thread. Without it each of
 * those takes a row of its own and the sheet shows the same subject three times.
 *
 * The *latest* unmerged match wins, not the earliest. A thread can now hold more
 * than one round (see `roundIsClosed`), and the round still open is the last one
 * to have been started. Within a round this changes nothing: the chasers are all
 * MERGED, so the only unmerged entry that round has is the mail that opened it —
 * which is exactly the one whose Allocation time the SLA is measured from.
 *
 * A null `root` sends the mail down the new-entry path, where it takes a row.
 * `newRound` distinguishes the two ways that happens: a thread nobody has seen
 * before, or one whose last round we already answered. Only the second needs the
 * append guard relaxed, so the caller records it on the entry.
 */
interface ThreadLookup {
  root:     EntryWithMatches | null
  newRound: boolean
}

async function findThreadRoot(
  message: MonitoredMessage, subjectKey: string | null, since: Date,
): Promise<ThreadLookup> {
  const identities: Prisma.QueryMonitorEntryWhereInput[] = []
  if (message.conversationId) identities.push({ conversationId: message.conversationId })
  if (subjectKey)             identities.push({ subjectKey })

  if (identities.length > 0) {
    const root = await prisma.queryMonitorEntry.findFirst({
      // A follow-up folds into the round's own root, never into another
      // follow-up — merged entries own no row to rewrite.
      where:   { mergedIntoId: null, receivedAt: { gte: since }, OR: identities },
      orderBy: { receivedAt: 'desc' },
      include: { matches: true },
    })
    if (root) {
      return roundIsClosed(root, message)
        ? { root: null, newRound: true }
        : { root, newRound: false }
    }
  }

  return findSameDayResend(message)
}

/**
 * The same mail again, from the same person, on the same day.
 *
 * Neither key above sees this one. `conversationId` differs because it is a new
 * send rather than a reply, and `subjectKey` is null whenever the subject names
 * no reference — "Srilanka Quote : DEC 2027 : URGENT : MANU X 4" has nothing in
 * it that identifies one query, so it is not safe to thread *across senders* on.
 *
 * From the *same address* on the *same day* it is safe, and it is the case the
 * team keeps seeing: two identical lines, one under the other. Two agents at one
 * agency sending the same generic subject still keep a row each — that is the
 * distinction the sender address draws and the domain would not.
 */
async function findSameDayResend(message: MonitoredMessage): Promise<ThreadLookup> {
  const day = startOfDayInTz(isoDateInTz(message.receivedAt))
  if (!day || !message.fromAddress) return { root: null, newRound: false }

  const nextDay = new Date(day.getTime() + 24 * 3_600_000)
  const sameDay = await prisma.queryMonitorEntry.findMany({
    where: {
      mergedIntoId: null,
      fromAddress:  message.fromAddress,
      receivedAt:   { gte: day, lt: nextDay },
    },
    // Newest first, for the same reason as `findThreadRoot`: the round still
    // open is the last one started.
    orderBy: { receivedAt: 'desc' },
    include: { matches: true },
    take:    50,
  })

  const subject = normalizeSubject(message.subject)
  const root = sameDay.find(entry => normalizeSubject(entry.subject) === subject)
  if (!root) return { root: null, newRound: false }
  return roundIsClosed(root, message)
    ? { root: null, newRound: true }
    : { root, newRound: false }
}

/**
 * Fold a follow-up into the row its thread already owns.
 *
 * The follow-up is still recorded — its `dedupKey` is what stops the next sweep
 * treating the same mail as new — but it is born MERGED and is never written to
 * a workbook. What reaches the sheet is a *rewrite* of the existing row, and
 * only when something the sheet shows has actually changed: a rewrite that
 * changes no cell is a Graph call for nothing.
 *
 * Reply state is deliberately left alone. "Replied time" records when the team
 * answered the query, and an agent writing again does not un-answer it.
 */
async function mergeFollowUp(
  root: EntryWithMatches, group: MessageGroup, runId: string,
  directory: Directory, aliasNames?: ReadonlySet<string>,
): Promise<{ toList: string; rewrite: boolean }> {
  const { message } = group

  await prisma.queryMonitorEntry.create({
    data: {
      dedupKey:       group.dedupKey,
      conversationId: message.conversationId,
      threadKey:      root.threadKey ?? threadKeyFor(message),
      subjectKey:     subjectKeyFor(message),
      mergedIntoId:   root.id,
      mailKind:       root.mailKind,
      subject:        message.subject.slice(0, 2000),
      fromAddress:    message.fromAddress,
      fromName:       message.fromName.slice(0, 180),
      fromDomain:     message.fromDomain,
      receivedAt:     message.receivedAt,
      lastMessageAt:  message.receivedAt,
      replyStatus:    root.replyStatus,
      toList:         joinHandlers(group.handlers.map(h => h.handlerName)),
      // The owner lives on the root — this entry is not a query of its own.
      handlerNames:   '',
      salesPerson:    root.salesPerson,
      agent:          root.agent,
      destination:    root.destination,
      travelDate:     root.travelDate,
      cntl:           root.cntl,
      region:         root.region,
      bodySnippet:    (message.bodyPreview || message.bodyText).slice(0, 1200),
      // Nothing was extracted for it: every field above is the root's.
      extractionSource: 'RULE',
      syncStatus:       'MERGED',
      backupSyncStatus: 'MERGED',
      firstRunId:       runId,
      matches: {
        create: group.handlers.map(h => ({
          mailboxId:   h.mailboxId,
          graphId:     h.graphId,
          handlerName: h.handlerName,
          receivedAt:  h.receivedAt,
          viaAlias:    h.viaAlias ?? false,
        })),
      },
    },
  })

  // A chaser often reaches one more handler than the original did.
  const newHandlers = group.handlers.filter(
    h => !root.matches.some(m => m.mailboxId === h.mailboxId),
  )
  if (newHandlers.length > 0) {
    await prisma.queryMonitorMatch.createMany({
      data: newHandlers.map(h => ({
        entryId:     root.id,
        mailboxId:   h.mailboxId,
        graphId:     h.graphId,
        handlerName: h.handlerName,
        receivedAt:  h.receivedAt,
        viaAlias:    h.viaAlias ?? false,
      })),
      skipDuplicates: true,
    })
  }

  const toList = joinHandlers([
    ...splitHandlers(root.toList),
    ...newHandlers.map(h => h.handlerName),
  ])
  const owner = root.handlerNames.trim() || autoFileHandler(splitHandlers(toList), aliasNames)

  // The chaser goes into the root's ledger, not the follow-up's: the ledger
  // belongs to the row, and the row is the root's.
  await recordThreadEvent(root.id, {
    direction:    'IN',
    kind:         'FOLLOW_UP',
    actorName:    message.fromName || message.fromAddress,
    actorAddress: message.fromAddress,
    toAddresses:  message.recipients,
    occurredAt:   message.receivedAt,
    subject:      message.subject,
    snippet:      message.bodyPreview || message.bodyText,
    messageId:    message.internetMessageId,
    graphId:      message.graphId,
  }, directory)

  // The row always changes now: "Mails in Thread" goes up by one and "Last Mail"
  // moves to this mail's timestamp. That is the whole trade for not giving the
  // chaser a line of its own — the row has to say that the chaser happened.
  const ledger = await rollUpEntry(root.id)

  await prisma.queryMonitorEntry.update({
    where: { id: root.id },
    data: {
      toList,
      handlerNames:  owner,
      followUpCount: { increment: 1 },
      lastMessageAt: message.receivedAt,
      duplicateReason: appendDuplicateReason(
        root.duplicateReason,
        duplicateReasonFor(
          { conversationId: message.conversationId, subjectKey: subjectKeyFor(message), fromAddress: message.fromAddress },
          root,
        ),
      ),
      ...ledgerPatch(ledger),
      ...dirtyPatch(root),
    },
  })

  return { toList, rewrite: true }
}

/**
 * The ledger roll-up as columns on the entry.
 *
 * `lastMessageAt` is left out on purpose: the caller owns it. On a merge it is
 * the chaser's timestamp and is already being written; on a reply it must *not*
 * move, because "Last Mail" answering itself would make every answered thread
 * look like it had just been touched by the agent.
 */
function ledgerPatch(ledger: ThreadRollUp) {
  return {
    inboundCount:  ledger.inboundCount,
    outboundCount: ledger.outboundCount,
    replyType:     ledger.replyType,
    forwardChain:  ledger.forwardChain,
    lastActor:     ledger.lastActor,
    lastDirection: ledger.lastDirection,
  }
}

// ── Sheet row assembly ───────────────────────────────────────────────────────

/**
 * How long the team took to answer, in hours to two decimals.
 *
 * A number, not "2h 15m": the column exists so the team can average it and sort
 * on it, which text cannot do. Blank while the query is still open — a zero
 * there would drag every average down and read as "answered instantly".
 */
export function responseHours(receivedAt: Date, repliedAt: Date | null): number | '' {
  if (!repliedAt) return ''
  const hours = (repliedAt.getTime() - receivedAt.getTime()) / 3_600_000
  // Clock skew between Graph's received and sent stamps can put a fast reply a
  // hair before the mail it answers; floor at zero rather than show a negative.
  return Number(Math.max(0, hours).toFixed(2))
}

/**
 * Met / Missed, which the Status column cannot say.
 *
 * Status is where the query stands *now* — Replied, Pending, Overdue. This is
 * whether the SLA was honoured, and the two come apart on exactly the row that
 * matters: a query answered six hours late reads "Replied" forever, and only
 * this column remembers that it was late.
 */
export function slaOutcome(
  receivedAt: Date, repliedAt: Date | null, slaHours: number,
): string {
  if (!repliedAt) return ''
  return repliedAt.getTime() - receivedAt.getTime() <= slaHours * 3_600_000 ? 'Met' : 'Missed'
}

export function buildSheetRow(
  entry: QueryMonitorEntry, writeStatus: boolean, slaHours = 2,
): SheetRowValues {
  const status = writeStatus
    ? (REPLY_STATUS_SHEET_LABEL[entry.replyStatus as ReplyStatus] ?? '')
    : ''

  return {
    date:           toExcelDateSerial(entry.receivedAt),
    status,
    // The thread's title, not the newest envelope: "Re: Re: Fw:" in front of a
    // subject is how the same query ends up looking like three.
    subject:        displaySubject(entry.subject).slice(0, 500),
    allocationTime: toExcelDateTimeSerial(entry.receivedAt),
    repliedTime:    toExcelDateTimeSerial(entry.repliedAt),
    // One owner in F, everyone who received it in I. Blank F is deliberate: it
    // is the team's cue that nobody has picked the query up yet.
    fileHandler:    entry.handlerNames,
    // Who it came from, read straight after who owns it. The query sheet has
    // carried the sender's *domain* rules since day one (Sales Person, Agent)
    // and never the person — so "who at MMT actually sent this" was a column the
    // team did not have, and it belongs next to F rather than off the far right.
    from:           entry.fromName || entry.fromAddress,
    fromEmail:      entry.fromAddress,
    toList:         entry.toList,
    salesPerson:    entry.salesPerson ?? '',
    destination:    entry.destination ?? '',
    agent:          entry.agent ?? '',
    travelDate:     toExcelDateSerial(entry.travelDate),
    cntl:           entry.cntl ?? '',
    amendment:      entry.amendment ?? '',
    region:         entry.region ?? '',
    repliedBy:      entry.repliedBy ?? '',
    responseHours:  responseHours(entry.receivedAt, entry.repliedAt),
    sla:            slaOutcome(entry.receivedAt, entry.repliedAt, slaHours),
    // Everything that passed on this thread, ours included — see `threadMailCount`.
    threadCount:    threadMailCount(entry),
    lastMail:       toExcelDateTimeSerial(entry.lastMessageAt ?? entry.receivedAt),
    aiSummary:      entry.aiSummary ?? '',
    repliedByEmail: entry.repliedByEmail ?? '',
    repliedTo:      entry.repliedToAddress ?? '',
    replyType:      REPLY_TYPE_SHEET_LABEL[entry.replyType ?? ''] ?? '',
    forwardChain:   entry.forwardChain ?? '',
    // The thread in prose. Falls back to the ledger's own description when the
    // AI switch is off, so this column is never blank on a thread that moved.
    replySummary:   entry.replySummary ?? '',
    // Why this row is the one that survived, when others folded into it.
    duplicateReason: entry.duplicateReason ?? '',
  }
}

/**
 * How many mails this row stands for — theirs and ours.
 *
 * Rows written before the ledger existed have an empty one, and `inboundCount`
 * defaults to 1 on every one of them. So the old counter is kept as a floor: a
 * row that folded in four chasers last week still says five, not one, and starts
 * counting our side of the conversation from the next mail that lands.
 */
export function threadMailCount(entry: {
  inboundCount: number; outboundCount: number; followUpCount: number
}): number {
  return Math.max(entry.inboundCount + entry.outboundCount, entry.followUpCount + 1)
}

/** Column Y, in the team's words rather than the database's. */
const REPLY_TYPE_SHEET_LABEL: Record<string, string> = {
  DIRECT:   'Direct reply',
  FORWARD:  'Forwarded on',
  INTERNAL: 'Internal only',
}

/** The same entry as a row on the second tab. */
export function buildExcludedRow(entry: QueryMonitorEntry): ExcludedRowValues {
  return {
    date:         toExcelDateSerial(entry.receivedAt),
    receivedTime: toExcelDateTimeSerial(entry.receivedAt),
    subject:      displaySubject(entry.subject).slice(0, 500),
    sender:       entry.fromName || entry.fromDomain,
    senderEmail:  entry.fromAddress,
    fileHandler:  entry.handlerNames,
    toList:       entry.toList,
    reason:       entry.excludeReason ?? 'Not a query',
    destination:  entry.destination ?? '',
    cntl:         entry.cntl ?? '',
    aiSummary:    entry.aiSummary ?? '',
    threadCount:  threadMailCount(entry),
    lastMail:     toExcelDateTimeSerial(entry.lastMessageAt ?? entry.receivedAt),
    replySummary: entry.replySummary ?? '',
    duplicateReason: entry.duplicateReason ?? '',
  }
}

// ── File handler ─────────────────────────────────────────────────────────────

/** The TO list as a clean, de-duplicated, comma-joined cell. */
export function joinHandlers(names: string[]): string {
  return names
    .map(n => n.trim())
    .filter(Boolean)
    .filter((name, i, all) => all.indexOf(name) === i)
    .join(', ')
}

export function splitHandlers(list: string): string[] {
  return list.split(',').map(s => s.trim()).filter(Boolean)
}

/**
 * Who owns a query, given everyone it was sent to.
 *
 * A mail that reached exactly one mailbox has an obvious owner and is assigned
 * straight away. A mail that reached several has none yet — the cell stays blank
 * until the first reply names one (see `detectReplies`) or an admin picks from
 * the TO-list dropdown. Guessing here is worse than leaving it empty: a wrong
 * name in the File Handler column is invisible, an empty one is a to-do.
 *
 * Distribution groups are struck out of the candidates first. A mail to one
 * handler and to availcheck reached one *person*, and that person owns it —
 * counting the group as a second recipient would blank the owner on most of the
 * team's mail, which is the opposite of what the column is for.
 */
export function autoFileHandler(toList: string[], aliasNames?: ReadonlySet<string>): string {
  const people = aliasNames && aliasNames.size > 0
    ? toList.filter(name => !aliasNames.has(name))
    : toList
  return people.length === 1 ? people[0] : ''
}

function computeReplyStatus(receivedAt: Date, repliedAt: Date | null, slaHours: number): ReplyStatus {
  if (repliedAt) return 'REPLIED'
  const ageHours = (Date.now() - receivedAt.getTime()) / 3_600_000
  return ageHours > slaHours ? 'OVERDUE' : 'PENDING'
}

/**
 * Queue a changed entry for both workbooks.
 *
 * A row already written must be *rewritten* in place; one not yet written just
 * stays pending and carries the change out with its first append. The two
 * workbooks are tracked separately because they number their rows independently
 * and either can fail on its own.
 */
export function dirtyPatch(entry: {
  sheetRow: number | null; syncStatus: string
  backupSheetRow: number | null; backupSyncStatus: string
}): { syncStatus: string; backupSyncStatus: string } {
  return {
    syncStatus:       entry.sheetRow       ? 'DIRTY' : entry.syncStatus,
    backupSyncStatus: entry.backupSheetRow ? 'DIRTY' : entry.backupSyncStatus,
  }
}

function overrideSet(entry: { manualOverrides: Prisma.JsonValue | null }): Set<string> {
  const raw = entry.manualOverrides
  if (!Array.isArray(raw)) return new Set()
  return new Set(raw.filter((v): v is string => typeof v === 'string'))
}

// ── Locking ──────────────────────────────────────────────────────────────────

const LOCK_TTL_MS = 15 * 60 * 1000

async function acquireLock(key: string = SETTINGS.runLock, ttlMs = LOCK_TTL_MS): Promise<boolean> {
  const existing = await prisma.systemSetting.findUnique({ where: { key } })
  if (existing) {
    const heldSince = new Date(existing.value).getTime()
    if (Number.isFinite(heldSince) && Date.now() - heldSince < ttlMs) return false
  }
  await setSetting(key, new Date().toISOString())
  return true
}

async function releaseLock(key: string = SETTINGS.runLock): Promise<void> {
  await prisma.systemSetting.deleteMany({ where: { key } })
}

// ── The sweep ────────────────────────────────────────────────────────────────

export interface RunOptions {
  trigger?:     RunTrigger
  triggeredBy?: string
  /** Run even when the master switch is off (the UI's "Run now" button). */
  force?:       boolean
  /** Override the lookback window for a catch-up run. */
  lookbackHours?: number
}

export async function runQueryMonitorSweep(options: RunOptions = {}): Promise<RunSummary> {
  const trigger = options.trigger ?? 'CRON'
  const startedAt = Date.now()
  const log = new RunLog()

  const empty = (status: RunStatus, skipped?: string): RunSummary => ({
    runId: null, status, skipped,
    mailboxesScanned: 0, messagesSeen: 0, entriesCreated: 0, entriesUpdated: 0,
    repliesDetected: 0, rowsAppended: 0, rowsUpdated: 0, aiCalls: 0, errors: 0,
    durationMs: Date.now() - startedAt, steps: log.steps,
  })

  const config = await getConfig()
  if (!config.enabled && !options.force) {
    return empty('SKIPPED', 'Query Monitor is switched off')
  }

  if (!await acquireLock()) {
    return empty('SKIPPED', 'Another sweep is already running')
  }

  const lookbackHours = options.lookbackHours ?? config.lookbackHours
  // The workbook starts on a given day, so there is no point reading mail from
  // before it — a wide catch-up lookback is clamped rather than refused.
  const cutoff     = startDateBoundary(config.startDate)
  const lookedBack = new Date(Date.now() - lookbackHours * 3_600_000)
  const windowFrom = cutoff && cutoff > lookedBack ? cutoff : lookedBack
  const windowTo   = new Date()

  const run = await prisma.queryMonitorRun.create({
    data: {
      trigger, status: 'RUNNING', windowFrom, windowTo,
      triggeredBy: options.triggeredBy ?? null,
    },
  })

  const counters = {
    mailboxesScanned: 0, messagesSeen: 0, entriesCreated: 0, entriesUpdated: 0,
    repliesDetected: 0, rowsAppended: 0, rowsUpdated: 0, aiCalls: 0,
  }

  try {
    log.add('info', `Sweep started — window ${windowFrom.toISOString()} → ${windowTo.toISOString()}`, {
      trigger, lookbackHours, autoWrite: config.autoWrite,
      startDate: config.startDate || null, backup: config.backupEnabled,
    })

    // ── 1. Read the mailboxes ───────────────────────────────────────────────
    const allMailboxes = await listActiveMailboxes()
    const mailboxes = allMailboxes.filter(m => m.mailboxKind !== 'ALIAS')
    const aliases: AliasMailbox[] = allMailboxes
      .filter(m => m.mailboxKind === 'ALIAS')
      .map(m => ({ id: m.id, displayName: m.displayName, addresses: mailboxAddresses(m) }))
    /** Names that must never be picked as the File Handler. */
    const aliasNames = new Set(aliases.map(a => a.displayName))
    /** Address → the name the sheet prints for it, so a ledger cell reads in names. */
    const directory = buildDirectory(allMailboxes)

    if (mailboxes.length === 0) log.add('warn', 'No active mailboxes configured')
    if (aliases.length > 0) {
      log.add('info',
        `${aliases.length} distribution group(s) counted from the TO/CC line: `
        + aliases.map(a => `${a.displayName} (${a.addresses.join(', ')})`).join(' · '))
    }

    const groups = new Map<string, MessageGroup>()
    /** mailboxId → that handler's Sent Items over the chase window. */
    const sentIndexes = new Map<string, SentIndex>()

    for (const mailbox of mailboxes) {
      try {
        const messages = await fetchInboxSince(mailbox.email, windowFrom)
        counters.mailboxesScanned += 1
        counters.messagesSeen += messages.length

        // Sent Items across the chase window, so replies to older still-open
        // queries are picked up in the same pass without extra calls.
        const sentSince = new Date(Date.now() - config.replyChaseDays * 86_400_000)
        const sent = await fetchSentIndex(mailbox, sentSince, normalizeSubject)
        sentIndexes.set(mailbox.id, sent)
        if (sent.error) {
          log.add('warn', `${mailbox.email} — Sent Items unreadable, replies from it cannot be seen: ${sent.error}`)
        }

        for (const message of messages) {
          const key = dedupKeyFor(message)
          const existing = groups.get(key)
          if (existing) {
            // Same mail, another handler — record the recipient, don't clone the row.
            if (!existing.handlers.some(h => h.mailboxId === mailbox.id)) {
              existing.handlers.push({
                mailboxId: mailbox.id, handlerName: mailbox.displayName,
                graphId: message.graphId, receivedAt: message.receivedAt,
              })
            }
            if (message.receivedAt < existing.message.receivedAt) existing.message = message
          } else {
            groups.set(key, {
              dedupKey: key,
              message,
              handlers: [{
                mailboxId: mailbox.id, handlerName: mailbox.displayName,
                graphId: message.graphId, receivedAt: message.receivedAt,
              }],
            })
          }

          // The groups on the same mail. Attributed per message rather than per
          // group so it does not matter which member's copy was read first.
          const group = groups.get(key)!
          for (const handler of aliasHandlersFor(message, aliases)) {
            if (!group.handlers.some(h => h.mailboxId === handler.mailboxId)) {
              group.handlers.push(handler)
            }
          }
        }

        const latest = messages[0]?.receivedAt ?? null
        await prisma.queryMonitorMailbox.update({
          where: { id: mailbox.id },
          data: {
            lastCheckedAt: new Date(),
            lastError:     null,
            totalSeen:     { increment: messages.length },
            ...(latest ? { lastMessageAt: latest } : {}),
          },
        })

        log.add('info', `${mailbox.email} — ${messages.length} external message(s)`, {
          mailbox: mailbox.email, count: messages.length,
        })
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        log.add('error', `${mailbox.email} — mailbox read failed: ${msg}`, { mailbox: mailbox.email })
        await prisma.queryMonitorMailbox.update({
          where: { id: mailbox.id },
          data:  { lastCheckedAt: new Date(), lastError: msg.slice(0, 500) },
        }).catch(() => {})
      }
    }

    // The groups never report themselves — their counters come from the mail
    // that named them, so the UI can still show when one was last written to.
    for (const alias of aliases) {
      const seen = Array.from(groups.values()).filter(g =>
        g.handlers.some(h => h.mailboxId === alias.id))
      const latest = seen
        .map(g => g.message.receivedAt)
        .sort((a, b) => b.getTime() - a.getTime())[0] ?? null

      await prisma.queryMonitorMailbox.update({
        where: { id: alias.id },
        data: {
          lastCheckedAt: new Date(),
          lastError:     null,
          totalSeen:     { increment: seen.length },
          ...(latest ? { lastMessageAt: latest } : {}),
        },
      }).catch(() => {})

      log.add('info', `${alias.displayName} (group) — on ${seen.length} of this window's mail(s)`)
    }

    log.add('info', `${groups.size} unique quer${groups.size === 1 ? 'y' : 'ies'} after dedup across handlers`)

    // ── 2. Upsert entries ───────────────────────────────────────────────────
    const rules = await loadSenderRules()
    const excludePatterns = config.excludeEnabled
      ? parseExcludePatterns(config.excludePatterns)
      : []
    let excludedThisRun = 0

    // How far back a follow-up may reach for the row it belongs to. Never past
    // the workbook's start date: a row in the *previous* file cannot be
    // rewritten, so mail whose thread began there has to start a fresh row here.
    const windowStart = new Date(Date.now() - config.threadWindowDays * 86_400_000)
    const threadWindowFrom = cutoff && cutoff > windowStart ? cutoff : windowStart

    const ordered = Array.from(groups.values()).sort(
      (a, b) => a.message.receivedAt.getTime() - b.message.receivedAt.getTime(),
    )

    /**
     * Summaries are the one AI call that fires on *every* new mail, so the sweep
     * carries a ceiling for them. A catch-up run over a long lookback, or a
     * mailbox that has just been switched on and returns a week of mail, would
     * otherwise make hundreds of calls in one pass and time the function out
     * long before it reached the workbook. What is left over stays unsummarised
     * — a blank cell, on a row that is otherwise complete.
     */
    let summaryBudget = config.aiSummaryEnabled ? 60 : 0
    let summarised = 0

    for (const group of ordered) {
      try {
        const { message } = group
        const toList = joinHandlers(group.handlers.map(h => h.handlerName))

        const existing = await prisma.queryMonitorEntry.findUnique({
          where:   { dedupKey: group.dedupKey },
          include: { matches: true },
        })

        if (existing) {
          // Already known — only the TO list can grow (a colleague was CC'd
          // late, or their mailbox was activated after the first sweep).
          const newHandlers = group.handlers.filter(
            h => !existing.matches.some(m => m.mailboxId === h.mailboxId),
          )
          if (newHandlers.length === 0) continue

          await prisma.queryMonitorMatch.createMany({
            data: newHandlers.map(h => ({
              entryId:     existing.id,
              mailboxId:   h.mailboxId,
              graphId:     h.graphId,
              handlerName: h.handlerName,
              receivedAt:  h.receivedAt,
              viaAlias:    h.viaAlias ?? false,
            })),
            skipDuplicates: true,
          })

          const merged = joinHandlers([
            ...splitHandlers(existing.toList),
            ...newHandlers.map(h => h.handlerName),
          ])

          // A second recipient means the owner is no longer obvious, but an owner
          // already chosen — by a reply or by hand — is never taken back.
          const owner = existing.handlerNames.trim() || autoFileHandler(splitHandlers(merged), aliasNames)

          await prisma.queryMonitorEntry.update({
            where: { id: existing.id },
            data: {
              toList:       merged,
              handlerNames: owner,
              // Already in a sheet? Mark it for a rewrite rather than a new row.
              ...dirtyPatch(existing),
            },
          })
          counters.entriesUpdated += 1
          log.add('info', `TO list grew on "${message.subject.slice(0, 60)}" → ${merged}`)
          continue
        }

        // ── A later mail of a thread the sheet already carries ────────────
        // One query, one row — while the query is open. A chaser rewrites that
        // row instead of adding a second line with the same subject under it;
        // a mail arriving after we replied opens a new round and takes a line.
        const subjectKey = subjectKeyFor(message)
        const { root, newRound } = config.threadMergeEnabled
          ? await findThreadRoot(message, subjectKey, threadWindowFrom)
          : { root: null, newRound: false }

        if (root) {
          const { toList: mergedList } = await mergeFollowUp(root, group, run.id, directory, aliasNames)
          counters.entriesUpdated += 1
          log.add('info',
            `Follow-up on "${displaySubject(message.subject).slice(0, 60)}" — folded into `
            + (root.sheetRow ? `row ${root.sheetRow}` : 'the query it belongs to')
            + `, now ${root.followUpCount + 2} mail(s) on one row (TO list ${mergedList})`,
            { entryId: root.id, followUps: root.followUpCount + 1 })
          continue
        }

        if (newRound) {
          log.add('info',
            `"${displaySubject(message.subject).slice(0, 60)}" came back after we replied — `
            + 'new round, so it takes a row of its own rather than folding into the answered one',
            { subject: message.subject.slice(0, 120), from: message.fromAddress })
        }

        // ── New entry ─────────────────────────────────────────────────────
        // Vouchers, on-ground incidents and avail checks are recorded like
        // anything else but routed to the second tab, so the query sheet stays
        // a measure of new business only.
        const { kind, reason } = classifySubject(message.subject, excludePatterns)

        const sender = resolveSender(message.fromAddress, message.fromDomain, message.fromName, rules)
        const fields = extractByRules(message.subject, message.bodyText, message.receivedAt)

        let destination    = fields.destination ?? sender.destination
        let travelDate     = fields.travelDate
        let travelDateText = fields.travelDateText
        let region         = fields.region ?? sender.region
        let isUrgent       = fields.isUrgent
        let source: 'RULE' | 'AI' = 'RULE'
        let confidence: number | null = null

        const missing: ('destination' | 'travelDate')[] = []
        if (!destination) missing.push('destination')
        if (!travelDate)  missing.push('travelDate')

        // No AI spend on mail that is not going into the query sheet.
        if (config.aiEnabled && missing.length > 0 && kind === 'QUERY') {
          const ai = await extractWithAi(message.subject, message.bodyText, message.receivedAt, missing)
          if (ai.ok) {
            counters.aiCalls += 1
            source = 'AI'
            confidence     = ai.fields.confidence ?? null
            destination    = destination    ?? ai.fields.destination    ?? null
            travelDate     = travelDate     ?? ai.fields.travelDate     ?? null
            travelDateText = travelDateText ?? ai.fields.travelDateText ?? null
            region         = region         ?? ai.fields.region         ?? null
            isUrgent       = isUrgent       || (ai.fields.isUrgent ?? false)
          }
        }

        // One sentence saying what the mail actually wants — written for both
        // tabs, because "what is this on-ground incident about" is exactly the
        // question the other-mail tab is opened to answer.
        let aiSummary: string | null = null
        if (summaryBudget > 0) {
          summaryBudget -= 1
          aiSummary = await summarizeMail(
            message.subject, message.bodyText || message.bodyPreview, kind,
          )
          if (aiSummary) {
            summarised += 1
            counters.aiCalls += 1
          }
        }

        const created = await prisma.queryMonitorEntry.create({
          data: {
            dedupKey:       group.dedupKey,
            conversationId: message.conversationId,
            // What every later mail of this thread will find it by.
            threadKey:      threadKeyFor(message),
            subjectKey,
            // Re-opened an answered thread, so the append guard must match it on
            // the exact row identity only — see the `newRound` note on the model.
            newRound,
            lastMessageAt:  message.receivedAt,
            mailKind:       kind,
            excludeReason:  reason?.slice(0, 180) ?? null,
            subject:        message.subject.slice(0, 2000),
            fromAddress:    message.fromAddress,
            fromName:       message.fromName.slice(0, 180),
            fromDomain:     message.fromDomain,
            receivedAt:     message.receivedAt,
            replyStatus:    computeReplyStatus(message.receivedAt, null, config.slaHours),
            toList,
            handlerNames:   autoFileHandler(splitHandlers(toList), aliasNames),
            salesPerson:    sender.salesPerson,
            agent:          sender.agent?.slice(0, 180) ?? null,
            destination,
            travelDate,
            travelDateText: travelDateText?.slice(0, 180) ?? null,
            cntl:           fields.cntl,
            region:         region?.slice(0, 180) ?? null,
            isUrgent,
            bodySnippet:    (message.bodyPreview || message.bodyText).slice(0, 1200),
            extractionSource: source,
            aiConfidence:   confidence,
            aiSummary,
            aiSummaryAt:    aiSummary ? new Date() : null,
            syncStatus:     'PENDING',
            firstRunId:     run.id,
            matches: {
              create: group.handlers.map(h => ({
                mailboxId:   h.mailboxId,
                graphId:     h.graphId,
                handlerName: h.handlerName,
                receivedAt:  h.receivedAt,
                viaAlias:    h.viaAlias ?? false,
              })),
            },
          },
        })

        // The mail that opened the thread is its first ledger event. Everything
        // the row later says about the conversation is counted from here.
        await recordThreadEvent(created.id, {
          direction:    'IN',
          kind:         'QUERY',
          actorName:    message.fromName || message.fromAddress,
          actorAddress: message.fromAddress,
          toAddresses:  message.recipients,
          occurredAt:   message.receivedAt,
          subject:      message.subject,
          snippet:      message.bodyPreview || message.bodyText,
          messageId:    message.internetMessageId,
          graphId:      message.graphId,
        }, directory)

        if (sender.ruleId) {
          await prisma.queryMonitorSenderRule.update({
            where: { id: sender.ruleId },
            data:  { matchCount: { increment: 1 }, lastMatchedAt: new Date() },
          }).catch(() => {})
        }

        counters.entriesCreated += 1

        if (kind === 'EXCLUDED') {
          excludedThisRun += 1
          log.add('info', `Not a query — "${created.subject.slice(0, 60)}" → "${config.excludedSheetName}" (matched ${reason})`, {
            entryId: created.id, reason,
          })
        } else {
          log.add('success', `New query "${created.subject.slice(0, 60)}" — to ${toList} · ${sender.salesPerson}`, {
            entryId: created.id, fileHandler: created.handlerNames || '(unassigned)',
            destination, travelDate: travelDate?.toISOString() ?? null, source,
          })
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        log.add('error', `Failed to record "${group.message.subject.slice(0, 60)}": ${msg}`)
      }
    }

    if (config.aiSummaryEnabled) {
      log.add(summaryBudget > 0 ? 'info' : 'warn',
        `AI read ${summarised} new mail(s) and wrote a one-line summary`
        + (summaryBudget > 0
          ? ''
          : ' — the per-sweep ceiling of 60 was reached, the rest were left blank'))
    }

    // ── 3. Reply detection ──────────────────────────────────────────────────
    counters.repliesDetected = await detectReplies(
      sentIndexes, config.replyChaseDays, config.slaHours, directory, log,
    )

    // ── 3b. Re-read the threads that moved ──────────────────────────────────
    // After the ledger has both sides of every conversation, and before the
    // workbook is written, so a row goes out with its summary already on it
    // rather than blank until the next sweep rewrites it.
    counters.aiCalls += await refreshThreadSummaries(config.aiSummaryEnabled, log)

    // ── 4. Push to the workbook ─────────────────────────────────────────────
    if (config.autoWrite) {
      const sync = await syncEntriesToSheet(log)
      counters.rowsAppended = sync.appended
      counters.rowsUpdated  = sync.updated
    } else {
      const pending = await prisma.queryMonitorEntry.count({ where: { syncStatus: { in: ['PENDING', 'DIRTY'] } } })
      log.add('warn', `Auto-write is OFF — ${pending} row(s) held in review. Turn it on (or press "Sync to sheet") to write them.`)
    }

    // ── 5. Rewrite the daily counts ─────────────────────────────────────────
    // Last, and never able to fail the sweep: it is a report *about* the work
    // this run just did, so a workbook that refuses it must not cost the rows.
    if (config.dailyStatsAutoWrite) {
      try {
        const stats = await exportDailyStatsToSheet()
        const primary = stats.workbooks.find(w => w.target === 'primary')
        log.add('info',
          `"${stats.sheetName}" rewritten — ${primary?.rows ?? 0} row(s) over ${stats.days} days `
          + `(${stats.stats.totals.total} mails, ${stats.stats.totals.useful} useful, ${stats.stats.totals.other} other)`)
      } catch (err) {
        log.add('warn', `Daily counts not updated: ${err instanceof Error ? err.message : String(err)}`)
      }
    }

    const status: RunStatus = log.errors === 0 ? 'SUCCESS' : 'PARTIAL'
    const durationMs = Date.now() - startedAt

    log.add(status === 'SUCCESS' ? 'success' : 'warn',
      `Sweep finished in ${(durationMs / 1000).toFixed(1)}s — `
      + `${counters.entriesCreated} new (${excludedThisRun} not a query), `
      + `${counters.entriesUpdated} updated, `
      + `${counters.repliesDetected} replies, ${counters.rowsAppended} row(s) appended`)

    await prisma.queryMonitorRun.update({
      where: { id: run.id },
      data: {
        status, finishedAt: new Date(), durationMs,
        ...counters, errors: log.errors,
        steps: JSON.stringify(log.steps),
      },
    })
    await setSetting(SETTINGS.lastRunAt, new Date().toISOString())

    return { runId: run.id, status, ...counters, errors: log.errors, durationMs, steps: log.steps }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    log.add('error', `Sweep aborted: ${msg}`)
    await prisma.queryMonitorRun.update({
      where: { id: run.id },
      data: {
        status: 'FAILED', finishedAt: new Date(), durationMs: Date.now() - startedAt,
        ...counters, errors: log.errors, errorMessage: msg.slice(0, 1000),
        steps: JSON.stringify(log.steps),
      },
    }).catch(() => {})
    await setSetting(SETTINGS.lastRunAt, new Date().toISOString()).catch(() => {})

    return {
      runId: run.id, status: 'FAILED', ...counters,
      errors: log.errors, durationMs: Date.now() - startedAt, steps: log.steps,
    }
  } finally {
    await releaseLock().catch(() => {})
  }
}

// ── Reply detection ──────────────────────────────────────────────────────────

/** How a sent mail was tied to a query. Listed strongest first. */
type ReplyMatchKind = 'RECIPIENT' | 'CONVERSATION' | 'SUBJECT'

const MATCH_RANK: Record<ReplyMatchKind, number> = {
  RECIPIENT: 0, CONVERSATION: 1, SUBJECT: 2,
}

interface ReplyCandidate {
  sentAt:       Date
  handlerName:  string
  mailboxEmail: string
  messageId:    string | null
  match:        ReplyMatchKind
  /** Everyone the reply went to — column X, so a forward cannot pose as a reply. */
  recipients:   string[]
}

/**
 * Clock skew between Graph's `receivedDateTime` and a `sentDateTime` on another
 * server can put a genuine reply a few seconds before the mail it answers.
 */
const REPLY_SKEW_MS = 120_000

/**
 * Is this sent mail a reply *to the person who asked*, rather than a note about
 * their query to somebody else?
 *
 * The distinction is the whole accuracy problem. A handler who forwards the
 * thread to a colleague, or answers a colleague's question on it, produces a
 * sent mail with the query's conversation id and nothing else to tell it apart —
 * and counting that as the reply both stops the SLA clock early and credits the
 * wrong person. Checking the agent's address against TO and CC is what separates
 * the two, and it is why the recipients are collected at all.
 */
function addressedToAsker(sent: SentMessage, askerAddress: string): boolean {
  return sent.recipients.includes(askerAddress.toLowerCase())
}

/** The better of two candidates: strongest match first, then earliest. */
function betterReply(a: ReplyCandidate | null, b: ReplyCandidate): ReplyCandidate {
  if (!a) return b
  if (MATCH_RANK[b.match] !== MATCH_RANK[a.match]) {
    return MATCH_RANK[b.match] < MATCH_RANK[a.match] ? b : a
  }
  return b.sentAt < a.sentAt ? b : a
}

/**
 * Fills in "Replied time" and "Replied By" for open queries. Bulk-matches
 * against the Sent Items indexes first (free — they were read during collection),
 * then falls back to a per-thread lookup for the handful of older threads that
 * fell outside them. Anything past the SLA with no reply is flipped to OVERDUE so
 * the sheet shows it in red.
 *
 * This is what keeps yesterday's rows honest. A query raised at 16:00 and
 * answered at 09:00 the next morning is out of every lookback window by the time
 * the reply lands, so replies are chased for `chaseDays` regardless of when the
 * mail arrived: the reply time, the status **and** the file handler are all
 * written back into rows that were appended days ago.
 *
 * Three things it now does that the conversation-id-only version could not:
 *
 * - **Every mailbox is searched, not only the ones on the query's TO list.** A
 *   colleague who was never addressed but picked the query up still answered it,
 *   and the sheet should say so.
 * - **A reply addressed back to the agent outranks one that is not.** See
 *   `addressedToAsker` — this is what stops an internal forward being recorded as
 *   the answer, and it is the difference between "we replied at 09:12" and "we
 *   talked about it at 09:12 and replied at 14:40".
 * - **Mail with no conversation id can still be answered.** It is matched on the
 *   normalised subject, but only together with the agent's address, which is what
 *   makes a subject as generic as "Urgent quote required" safe to match on.
 *
 * Since the thread ledger (15 Aug 2026) it also does the other half of the job.
 * Every mail of ours on the query's conversation is now written down — the
 * forwards and the internal notes as well as the replies — so the row can say
 * who passed the thread to whom. **Only a mail that actually reached the person
 * who asked stops the SLA clock.** That is a deliberate tightening: a forward
 * used to be accepted as the reply when nothing better could be found, which
 * both stopped the clock early and credited the wrong person. Such a thread now
 * stays open and reads "Forwarded on" in column Y, which is the truth about it.
 */
async function detectReplies(
  sentIndexes: Map<string, SentIndex>,
  chaseDays: number,
  slaHours: number,
  directory: Directory,
  log: RunLog,
): Promise<number> {
  const since = new Date(Date.now() - chaseDays * 86_400_000)
  const indexes = Array.from(sentIndexes.values())

  // Excluded mail is not measured against the SLA, so it never costs a lookup —
  // nor do follow-ups, whose reply state is the root row's to carry.
  //
  // Queries already marked REPLIED are included when nobody is recorded against
  // them: those are rows from before this attribution existed, and column O is
  // blank on every one of them until something fills it in.
  const open = await prisma.queryMonitorEntry.findMany({
    where: {
      mailKind: 'QUERY', mergedIntoId: null, receivedAt: { gte: since },
      OR: [{ replyStatus: { not: 'REPLIED' } }, { repliedBy: null }],
    },
    include: { matches: { include: { mailbox: true } } },
    orderBy: { receivedAt: 'asc' },
    take:    500,
  })

  let detected = 0
  let attributed = 0
  let targetedLookups = 0
  const TARGETED_LOOKUP_BUDGET = 40

  for (const entry of open) {
    const notBefore = new Date(entry.receivedAt.getTime() - REPLY_SKEW_MS)
    const subjectKey = normalizeSubject(entry.subject)
    const candidates: ReplyCandidate[] = []
    const bestSoFar = () => candidates.reduce<ReplyCandidate | null>(betterReply, null)

    /**
     * Everything of ours seen on this thread, whatever it turned out to be.
     * Keyed by Graph id because the same sent mail can be reached twice — once
     * through the conversation index and once through the subject one.
     */
    const outbound = new Map<string, { sent: SentMessage; index: SentIndex; kind: EventKind }>()

    /**
     * Look at one sent mail: write it into the ledger whatever it is, and offer
     * it as the reply only if it actually reached the person who asked.
     *
     * `evidence` is how the mail was tied to this query, which is a separate
     * question from what the mail was — a mail can be firmly on the thread and
     * still be a forward.
     */
    const consider = (sent: SentMessage, index: SentIndex, evidence: ReplyMatchKind) => {
      if (sent.sentAt < notBefore) return

      const kind = classifyOutbound(sent, entry.fromAddress)
      outbound.set(sent.graphId, { sent, index, kind })
      if (kind !== 'REPLY') return

      candidates.push({
        sentAt:       sent.sentAt,
        handlerName:  index.handlerName,
        mailboxEmail: index.mailboxEmail,
        messageId:    sent.internetMessageId,
        match:        evidence === 'CONVERSATION' ? 'RECIPIENT' : evidence,
        recipients:   sent.recipients,
      })
    }

    for (const index of indexes) {
      if (entry.conversationId) {
        for (const sent of index.byConversation.get(entry.conversationId) ?? []) {
          consider(sent, index, 'CONVERSATION')
        }
      }
      // Subject matching alone would collapse unrelated queries, so it is only
      // ever accepted together with the asker's own address.
      if (subjectKey) {
        for (const sent of index.bySubject.get(subjectKey) ?? []) {
          if (sent.conversationId && sent.conversationId === entry.conversationId) continue
          if (addressedToAsker(sent, entry.fromAddress)) consider(sent, index, 'SUBJECT')
        }
      }
    }

    // Older thread, nothing in the bulk window — ask Graph about this one
    // conversation, in the mailboxes that actually received it.
    if (outbound.size === 0 && entry.conversationId && targetedLookups < TARGETED_LOOKUP_BUDGET) {
      for (const match of entry.matches) {
        // A distribution group has no Sent Items to look in.
        if (match.viaAlias || match.mailbox.mailboxKind === 'ALIAS') continue
        if (targetedLookups >= TARGETED_LOOKUP_BUDGET) break
        targetedLookups += 1

        const index: SentIndex = sentIndexes.get(match.mailboxId) ?? {
          mailboxId: match.mailboxId, mailboxEmail: match.mailbox.email,
          handlerName: match.handlerName, byConversation: new Map(), bySubject: new Map(),
        }
        const sentMails = await findSentInConversation(
          match.mailbox.email, entry.conversationId, notBefore,
        )
        for (const sent of sentMails) consider(sent, index, 'CONVERSATION')
        // Keep going even after a hit unless the agent has demonstrably been
        // answered: another handler may have replied before this one forwarded it.
        if (bestSoFar()) break
      }
    }

    // Write down our side of the conversation — forwards and internal notes
    // included. This is what column Z is built from, and it is the only record
    // anywhere of a thread that was passed on but never answered.
    let ledgerGrew = false
    for (const { sent, index, kind } of Array.from(outbound.values())) {
      const added = await recordThreadEvent(entry.id, {
        direction:    'OUT',
        kind,
        actorName:    index.handlerName,
        actorAddress: index.mailboxEmail,
        toAddresses:  sent.recipients,
        occurredAt:   sent.sentAt,
        subject:      sent.subject,
        snippet:      sent.bodyPreview,
        messageId:    sent.internetMessageId,
        graphId:      sent.graphId,
      }, directory)
      ledgerGrew = ledgerGrew || added
    }

    const ledger = ledgerGrew ? await rollUpEntry(entry.id) : null

    const reply = bestSoFar()
    const repliedAt = reply?.sentAt ?? entry.repliedAt
    const nextStatus = computeReplyStatus(entry.receivedAt, repliedAt, slaHours)

    // Whoever answered owns the query. This is how a mail sent to six handlers
    // gets a File Handler without anyone touching the dashboard — but a name
    // already chosen by hand is left alone.
    const overrides = overrideSet(entry)
    const newOwner = reply && !entry.handlerNames.trim() && !overrides.has('handlerNames')
      ? reply.handlerName
      : null

    // Nothing found and nothing changed — the common case, and it must not cost
    // a write.
    const isNewAttribution = !!reply && (
      entry.repliedBy !== reply.handlerName
      || entry.repliedAt?.getTime() !== reply.sentAt.getTime()
      || entry.replyMatch !== reply.match
    )
    if (!isNewAttribution && !newOwner && !ledger && nextStatus === entry.replyStatus) continue

    await prisma.queryMonitorEntry.update({
      where: { id: entry.id },
      data: {
        repliedAt,
        replyStatus: nextStatus,
        // Who actually answered, kept whether or not they became the owner —
        // on a mail sent to six handlers this is the only record of it.
        ...(reply ? {
          repliedBy:        reply.handlerName,
          repliedByEmail:   reply.mailboxEmail,
          replyMessageId:   reply.messageId?.slice(0, 255) ?? null,
          replyMatch:       reply.match,
          repliedToAddress: reply.recipients.join(', ').slice(0, 500),
        } : {}),
        ...(newOwner ? { handlerNames: newOwner } : {}),
        // Counts, forward chain and reply type, recomputed from the ledger this
        // pass just added to. `lastMessageAt` is left alone: it is when the
        // *agent* last wrote, and our own answer must not move it.
        ...(ledger ? ledgerPatch(ledger) : {}),
        // A row already in a sheet needs its Status / Replied time rewritten.
        ...dirtyPatch(entry),
      },
    })

    // A thread that was passed on but never answered is the case this feature
    // exists to make visible — it used to look identical to an unread mail.
    if (!reply && ledger?.forwardChain) {
      log.add('warn',
        `"${entry.subject.slice(0, 50)}" forwarded but not yet answered — ${ledger.forwardChain}`,
        { entryId: entry.id, forwardChain: ledger.forwardChain })
    }

    if (reply) {
      attributed += 1
      if (entry.replyStatus !== 'REPLIED') detected += 1
      await prisma.queryMonitorMatch.updateMany({
        where: { entryId: entry.id, handlerName: reply.handlerName },
        data:  { repliedAt: reply.sentAt },
      }).catch(() => {})
      log.add('info',
        `Reply found for "${entry.subject.slice(0, 50)}" by ${reply.handlerName}`
        + (reply.match === 'RECIPIENT' ? '' : ` (matched on ${reply.match.toLowerCase()} only)`), {
          entryId: entry.id, repliedAt: reply.sentAt.toISOString(),
          repliedByEmail: reply.mailboxEmail, match: reply.match,
          ...(newOwner ? { fileHandlerAssigned: newOwner } : {}),
        })
    }
  }

  if (attributed > 0) {
    log.add('success',
      `${detected} repl${detected === 1 ? 'y' : 'ies'} detected`
      + (attributed > detected ? `, ${attributed - detected} already-answered row(s) credited to whoever replied` : ''))
  }
  return detected
}

// ── Thread summaries ─────────────────────────────────────────────────────────

/**
 * Rewrite column AA for every thread that has grown since it was last read.
 *
 * The AI Summary in column T is written once, from the mail that opened the
 * thread, and is never touched again — which is correct for "what was asked" and
 * silent about everything that happened afterwards. This column is the opposite:
 * it is regenerated from the ledger whenever the ledger grows, so a row standing
 * for eleven mails says what became of them.
 *
 * Two things keep it cheap. The regeneration test is `replySummaryEvents <
 * inbound + outbound`, so a conversation nobody has touched costs nothing; and a
 * one-mail thread is skipped outright, because there the AI Summary already says
 * everything a thread summary could.
 *
 * With the AI switch off it still runs — writing `describeThread`, which is
 * assembled from the ledger and costs nothing. The cell is worth having either
 * way, and this is the one place where a fact is better than a sentence.
 */
async function refreshThreadSummaries(aiEnabled: boolean, log: RunLog): Promise<number> {
  /** As with the per-mail summaries, a catch-up run must not make hundreds of calls. */
  const AI_BUDGET = 30
  let aiCalls = 0
  let written = 0

  const moved = await prisma.queryMonitorEntry.findMany({
    where: {
      mergedIntoId: null,
      // A thread of one has nothing to summarise beyond column T.
      OR: [{ outboundCount: { gt: 0 } }, { inboundCount: { gt: 1 } }],
    },
    orderBy: { lastMessageAt: 'desc' },
    take:    200,
  })

  for (const entry of moved) {
    if (!needsThreadSummary(entry)) continue

    const events = await prisma.queryMonitorThreadEvent.findMany({
      where:   { entryId: entry.id },
      orderBy: { occurredAt: 'asc' },
      take:    200,
    })
    if (events.length === 0) continue

    /**
     * The watermark is the same number `needsThreadSummary` tests against, not
     * `events.length`. They can differ — `inboundCount` floors at 1 for a row
     * whose ledger only ever caught our side of the conversation — and storing
     * the smaller of the two would leave the entry permanently behind its own
     * threshold, re-summarised on every sweep for ever.
     */
    const watermark = entry.inboundCount + entry.outboundCount

    // The ledger's own reading is computed first and kept as the floor: if the
    // model is off, over budget or unreachable, the cell still says something
    // true rather than falling back to blank.
    const factual = describeThread(events)
    let summary = factual

    /**
     * A thread the budget could not reach still gets the factual sentence — but
     * the watermark is *not* advanced for it, so the next sweep offers it to the
     * model again. Advancing it would mean a busy hour permanently downgraded
     * every thread it happened to push past the ceiling.
     */
    const overBudget = aiEnabled && aiCalls >= AI_BUDGET
    if (aiEnabled && !overBudget) {
      aiCalls += 1
      summary = await summarizeThread(entry.subject, timelineLines(events)) ?? factual
    }
    const readThisFar = overBudget ? entry.replySummaryEvents : watermark

    if (!summary || summary === entry.replySummary) {
      // Nothing new to say, but record that the thread has been read this far.
      await prisma.queryMonitorEntry.update({
        where: { id: entry.id },
        data:  { replySummaryEvents: readThisFar },
      })
      continue
    }

    await prisma.queryMonitorEntry.update({
      where: { id: entry.id },
      data: {
        replySummary:       summary,
        replySummaryAt:     new Date(),
        replySummaryEvents: readThisFar,
        ...dirtyPatch(entry),
      },
    })
    written += 1
  }

  if (written > 0) {
    log.add('info',
      `${written} thread summar${written === 1 ? 'y' : 'ies'} rewritten`
      + (aiEnabled
        ? ` (${aiCalls} read by AI${aiCalls >= AI_BUDGET ? ' — per-sweep ceiling reached, the rest describe the ledger' : ''})`
        : ' from the ledger — turn the AI switch on for a written reading of each thread'))
  }
  return aiCalls
}

// ── Sheet sync ───────────────────────────────────────────────────────────────

export interface WorkbookSyncResult {
  target:   WorkbookTarget
  appended: number
  updated:  number
  failed:   number
  /** Set when the workbook could not be reached at all. */
  error?:   string
}

export interface SyncResult {
  /** The live workbook's numbers — what the run log and the UI report. */
  appended:  number
  updated:   number
  failed:    number
  /** Per-workbook detail, live first, standby second when it is switched on. */
  workbooks: WorkbookSyncResult[]
  /** Nothing was attempted: another write held the lock. Not a failure. */
  skipped?:  boolean
}

/**
 * Where one workbook's row pointers and sync state live on the entry. The two
 * workbooks number their rows independently — the backup can be appended to
 * while the live file is locked, and vice versa — so neither may read the
 * other's columns.
 */
interface WorkbookPlan {
  target:      WorkbookTarget
  label:       string
  rowField:    'sheetRow' | 'backupSheetRow'
  statusField: 'syncStatus' | 'backupSyncStatus'
  errorField:  'syncError' | 'backupSyncError'
  /** Which workbook's remembered row colour this plan writes. */
  fillField:   'sheetHighlight' | 'backupHighlight'
}

const PRIMARY_PLAN: WorkbookPlan = {
  target: 'primary', label: 'workbook',
  rowField: 'sheetRow', statusField: 'syncStatus', errorField: 'syncError',
  fillField: 'sheetHighlight',
}

const BACKUP_PLAN: WorkbookPlan = {
  target: 'backup', label: 'backup workbook',
  rowField: 'backupSheetRow', statusField: 'backupSyncStatus', errorField: 'backupSyncError',
  fillField: 'backupHighlight',
}

/**
 * The fill a query's row should be carrying: green once it has been answered,
 * nothing while it is still open.
 *
 * Only the query tab is coloured. The other-mail tab is not measured against the
 * SLA and is never chased for a reply, so there is no state on it for a colour
 * to mean anything about.
 */
export function rowFillFor(
  entry: { mailKind: string; replyStatus: string }, enabled: boolean,
): string | null {
  if (!enabled || entry.mailKind === 'EXCLUDED') return null
  return entry.replyStatus === 'REPLIED' ? REPLIED_ROW_FILL : null
}

/**
 * Write everything outstanding to both workbooks: PENDING entries are appended
 * in one contiguous block per tab (cheap — a single range PATCH each), DIRTY
 * entries are rewritten in place at the row they already own.
 *
 * Two tabs, two files, one pass. Entries classified QUERY go to the query sheet;
 * everything the exclusion patterns caught goes to the "other mail" tab. Both
 * tabs are created with their header on first use.
 *
 * The backup is a full mirror, written in the same sweep, so it is never more
 * than one sweep behind the live file. It is deliberately a separate pass with
 * its own row numbers and its own failure state: a locked backup must never stop
 * the team's live sheet being updated, and a retry must not double-append.
 *
 * Safe to call by hand from the UI, which is how a review-first team gets rows
 * into the sheet while auto-write is still off.
 */
export async function syncEntriesToSheet(log?: RunLog, limit = 200): Promise<SyncResult> {
  const config = await getConfig()

  /**
   * One writer at a time.
   *
   * Both callers write the same PENDING block: the sweep when auto-write is on,
   * and the "Sync to sheet" button. Pressed while a sweep is writing, both read
   * the same set of pending entries and both append it — the append guard reads
   * the tail *before* the other writer's rows land, so it cannot see them. That
   * is how the sheet ended up with the same query on two rows in a row.
   *
   * The second caller is turned away rather than queued: its rows are still
   * PENDING, and whichever write is in flight is already putting them down.
   */
  if (!await acquireLock(SETTINGS.syncLock, SYNC_LOCK_TTL_MS)) {
    log?.add('warn', 'Another write to the workbook is already running — this one was skipped so the rows are not appended twice')
    return { appended: 0, updated: 0, failed: 0, skipped: true, workbooks: [] }
  }

  try {
    await skipEntriesBeforeStartDate(config.startDate, log)

    const workbooks: WorkbookSyncResult[] = [await syncOneWorkbook(PRIMARY_PLAN, log, limit)]

    if (config.backupEnabled && await backupIsADistinctFile(log)) {
      workbooks.push(await syncOneWorkbook(BACKUP_PLAN, log, limit))
    }

    const primary = workbooks[0]
    return {
      appended: primary.appended, updated: primary.updated, failed: primary.failed,
      workbooks,
    }
  } finally {
    await releaseLock(SETTINGS.syncLock).catch(() => {})
  }
}

/** A write runs to at most 300 s (`maxDuration`); past that the lock is stale. */
const SYNC_LOCK_TTL_MS = 6 * 60 * 1000

/**
 * Refuse to mirror a workbook into itself.
 *
 * Two share links can resolve to the same file — a copied link, a re-shared one,
 * the same URL pasted into both boxes. Mirroring then means appending every row
 * twice to one workbook and, worse, the "backup" row numbers would collide with
 * the primary's, so later rewrites would land on the wrong rows. The drive item
 * is the identity that matters, not the URL text.
 */
async function backupIsADistinctFile(log?: RunLog): Promise<boolean> {
  try {
    const [primary, backup] = await Promise.all([
      resolveSheetRef(false, 'primary'),
      resolveSheetRef(false, 'backup'),
    ])
    if (primary.driveId === backup.driveId && primary.itemId === backup.itemId) {
      log?.add('warn',
        `Backup skipped — the backup link points at the same file as the live workbook ("${primary.fileName}"). `
        + 'Set a different file, or turn mirroring off.')
      return false
    }
    return true
  } catch (err) {
    // Unreachable is the backup pass's own problem to report, not a reason to
    // decide the files are the same.
    log?.add('warn', `Could not compare the two workbooks: ${err instanceof Error ? err.message : String(err)}`)
    return true
  }
}

export interface RetryFailedResult {
  /** Never written to that workbook — queued to be appended. */
  queued:   number
  /** Already own a row there — queued to be rewritten in place, not appended. */
  rewrites: number
  /** Still FAILED: they predate the workbook's start date and never write. */
  stale:    number
}

/**
 * Put the failed writes back in the queue.
 *
 * A write that fails — a mismatched header, a locked file, Graph refusing —
 * leaves the entry FAILED with the reason on it. Nothing picks those up again:
 * the sync only looks for PENDING and DIRTY, so once the cause is fixed the rows
 * would sit there forever. This is the "try again" for the whole backlog.
 *
 * Which state an entry goes back to matters more than it looks:
 *
 *   • no row number in that workbook → PENDING, so it is appended;
 *   • a row number already → DIRTY, so that row is *rewritten in place*.
 *
 * Sending the second kind back as PENDING is how a retry turns into a duplicate
 * line: the row is already on the sheet, and appending would put a second one
 * under it. The two workbooks are decided separately — the live file can be
 * written and the backup behind, or the other way round.
 *
 * Entries from before the workbook's start date are left alone: the next write
 * would only close them off as SKIPPED again, and saying so is more use than
 * moving them through a state that changes nothing.
 */
export async function retryFailedWrites(): Promise<RetryFailedResult> {
  const config = await getConfig()
  const cutoff = startDateBoundary(config.startDate)
  const inRange = cutoff ? { receivedAt: { gte: cutoff } } : {}

  let queued   = 0
  let rewrites = 0

  for (const plan of [PRIMARY_PLAN, BACKUP_PLAN]) {
    // A row it already owns is rewritten, never appended a second time.
    const rewrite = await prisma.queryMonitorEntry.updateMany({
      where: { ...inRange, [plan.statusField]: 'FAILED', [plan.rowField]: { not: null } },
      data:  { [plan.statusField]: 'DIRTY', [plan.errorField]: null },
    })
    const append = await prisma.queryMonitorEntry.updateMany({
      where: { ...inRange, [plan.statusField]: 'FAILED', [plan.rowField]: null },
      data:  { [plan.statusField]: 'PENDING', [plan.errorField]: null },
    })

    // The live workbook's numbers are the ones worth reporting; the backup is
    // requeued in the same pass and rides along with the next write.
    if (plan.target === 'primary') {
      rewrites = rewrite.count
      queued   = append.count
    }
  }

  const stale = cutoff
    ? await prisma.queryMonitorEntry.count({
        where: { receivedAt: { lt: cutoff }, syncStatus: 'FAILED' },
      })
    : 0

  return { queued, rewrites, stale }
}

/**
 * Retire the backlog that predates the workbook.
 *
 * The team moved to a new file on a given day; everything collected before it
 * belongs to the old sheet and is already there. Left PENDING it would be
 * appended to the new file on the next sync and would sit in the "awaiting
 * write" count forever, so it is closed off as SKIPPED instead.
 */
async function skipEntriesBeforeStartDate(startDate: string, log?: RunLog): Promise<void> {
  const cutoff = startDateBoundary(startDate)
  if (!cutoff) return

  const stale = await prisma.queryMonitorEntry.updateMany({
    where: {
      receivedAt: { lt: cutoff },
      OR: [
        { syncStatus:       { in: ['PENDING', 'DIRTY', 'FAILED'] } },
        { backupSyncStatus: { in: ['PENDING', 'DIRTY', 'FAILED'] } },
      ],
    },
    data: {
      syncStatus:       'SKIPPED',
      backupSyncStatus: 'SKIPPED',
      syncError:        `Received before the workbook's start date (${startDate})`,
    },
  })

  if (stale.count > 0) {
    log?.add('info', `${stale.count} entr${stale.count === 1 ? 'y' : 'ies'} predate ${startDate} — left out of the new workbook`)
  }
}

/**
 * Identity of a row for the append guard: the day, the timestamp and the
 * subject — the three cells nothing else on the sheet edits.
 *
 * Serials are rounded to five decimals (under a second) because a double that
 * has been through Excel and back is equal to the one we sent only to within
 * the precision Graph reports it at.
 */
function writtenRowKey(
  date: number | '', time: number | '', subject: string,
): string {
  const serial = (v: number | '') => (v === '' ? '' : v.toFixed(5))
  return `${serial(date)}|${serial(time)}|${subject.trim().toLowerCase()}`
}

/**
 * The looser identity: *one query*, however many mails carried it.
 *
 * The exact key above is about one write landing twice. This one is about the
 * thing the team actually sees — two lines with the same date and the same
 * subject, one under the other. Two mails are the same query when they arrived
 * on the same day with the same subject and either
 *
 *   • the subject names a reference ("… ORN014IRMLT - #1209104"), which is one
 *     specific query whoever sent it, or
 *   • they came from the same address — the agent who sent the same thing twice.
 *
 * A generic subject from *different* senders is deliberately not folded: two
 * agents at one agency both send "Urgent quote required" about two different
 * groups, and hiding one of those is worse than a repeated line. That is the
 * same rule the sheet-level duplicate sweep applies, kept in step on purpose.
 */
function sameQueryKeys(
  date: number | '', subject: string, fromAddress: string | null,
): string[] {
  const day     = date === '' ? '' : String(Math.floor(date))
  const cleaned = normalizeSubject(subject)
  if (!day || !cleaned) return []

  const keys: string[] = []
  if (hasReference(cleaned)) keys.push(`ref|${day}|${cleaned}`)
  if (fromAddress) keys.push(`from|${day}|${cleaned}|${fromAddress.trim().toLowerCase()}`)
  return keys
}

/** Keep the audit trail short, stable, and readable in the workbook cell. */
function appendDuplicateReason(existing: string | null | undefined, reason: string): string {
  const parts = (existing ?? '').split('; ').map(s => s.trim()).filter(Boolean)
  if (!parts.includes(reason)) parts.push(reason)
  return parts.join('; ').slice(0, 1000)
}

function duplicateReasonFor(
  duplicate: Pick<QueryMonitorEntry, 'conversationId' | 'subjectKey' | 'fromAddress'>,
  winner: Pick<QueryMonitorEntry, 'conversationId' | 'subjectKey' | 'fromAddress'>,
): string {
  if (duplicate.conversationId && duplicate.conversationId === winner.conversationId) return 'Same conversation'
  if (duplicate.subjectKey && duplicate.subjectKey === winner.subjectKey) return 'Same reference/subject'
  if (duplicate.fromAddress && duplicate.fromAddress.toLowerCase() === (winner.fromAddress ?? '').toLowerCase()) {
    return 'Same-day same sender'
  }
  return 'Same query identity'
}

/**
 * Every identity a row already on the sheet answers to.
 *
 * The exact one, plus the reference-subject one — a line whose subject names a
 * query is that query, and a second line for it is the duplicate the team is
 * looking at. The sender is not on the query tab, so the same-sender key cannot
 * be read back off a row; it is applied inside the block instead, where the
 * entries are still to hand.
 */
function sheetRowKeys(
  cells: (string | number | boolean | null)[], layout: SheetLayout,
): string[] {
  // Query tab: A date, D allocation time, C subject.
  // Other-mail tab: A date, B received time, C subject.
  // Cells arrive in layout order whatever columns they were read from, so a
  // hand-edited header does not change these indexes — see projectRows.
  const timeIndex = layout.kind === 'excluded' ? 1 : 3
  const num = (v: unknown) => (typeof v === 'number' ? v : '')
  const subject = String(cells[2] ?? '')

  return [
    writtenRowKey(num(cells[0]), num(cells[timeIndex]), subject),
    ...sameQueryKeys(num(cells[0]), subject, null),
  ]
}

/**
 * Two pending entries that are the same query — before either becomes a row.
 *
 * Thread merging catches this when the mails are recognisably one thread: same
 * conversation, or same subject carrying a reference. What it cannot catch is a
 * pair it has no key for — the agent who re-sent the same generic subject an
 * hour later from the same address, a mail that reached us twice through two
 * routes with two message ids. Both entries are then legitimately PENDING, both
 * go in the same block, and the sheet gets two identical lines next to each
 * other. This is the last gate before the append.
 *
 * The later one is folded into the earlier: `mergedIntoId` points at it, its
 * sync state becomes MERGED, and the row it would have taken is never written.
 * Nothing is deleted — the mail is still there, still readable in the dashboard,
 * and it counts towards the surviving row's "Mails in Thread".
 */
async function foldDuplicatesInBlock(
  entries: QueryMonitorEntry[],
  keysOf: (entry: QueryMonitorEntry) => string[],
  note: (level: StepLevel, msg: string, meta?: Record<string, unknown>) => void,
): Promise<QueryMonitorEntry[]> {
  if (entries.length < 2) return entries

  const winnerByKey = new Map<string, QueryMonitorEntry>()
  const kept: QueryMonitorEntry[] = []

  for (const entry of entries) {
    const keys   = keysOf(entry)
    const matchedKey = keys.find(k => winnerByKey.has(k))
    const winner = matchedKey ? winnerByKey.get(matchedKey) : undefined

    if (!winner) {
      for (const key of keys) if (!winnerByKey.has(key)) winnerByKey.set(key, entry)
      kept.push(entry)
      continue
    }

    // The winner answers to this one's keys too, so a third copy folds as well.
    for (const key of keys) if (!winnerByKey.has(key)) winnerByKey.set(key, winner)

    await prisma.queryMonitorEntry.update({
      where: { id: entry.id },
      data: {
        // Already merged into something else? Leave that pointer alone.
        ...(entry.mergedIntoId ? {} : { mergedIntoId: winner.id }),
        syncStatus:       'MERGED',
        backupSyncStatus: 'MERGED',
        syncError:        null,
        backupSyncError:  null,
      },
    })

    // The folded mail is part of the thread the winner now stands for, so its
    // ledger goes with it — otherwise the surviving row under-counts itself by
    // exactly the mail this fold just kept off the sheet.
    await reassignThreadEvents(entry.id, winner.id)

    // The surviving row has to say the second mail happened — that is the whole
    // trade for not giving it a line of its own.
    winner.followUpCount += 1
    const last = winner.lastMessageAt ?? winner.receivedAt
    if (entry.receivedAt > last) winner.lastMessageAt = entry.receivedAt

    const ledger = await rollUpEntry(winner.id)
    Object.assign(winner, ledgerPatch(ledger))

    await prisma.queryMonitorEntry.update({
      where: { id: winner.id },
      data: {
        followUpCount: winner.followUpCount,
        lastMessageAt: winner.lastMessageAt,
        ...ledgerPatch(ledger),
        // The thread just got longer than its summary was written from.
        replySummaryEvents: 0,
        duplicateReason: appendDuplicateReason(
          winner.duplicateReason,
          matchedKey?.startsWith('ref|') ? 'Same reference/subject'
            : matchedKey?.startsWith('from|') ? 'Same-day same sender'
            : 'Same query identity',
        ),
      },
    })

    winner.duplicateReason = appendDuplicateReason(
      winner.duplicateReason,
      matchedKey?.startsWith('ref|') ? 'Same reference/subject'
        : matchedKey?.startsWith('from|') ? 'Same-day same sender'
        : 'Same query identity',
    )

    note('warn',
      `Same query twice — "${displaySubject(entry.subject).slice(0, 60)}" folded into the row `
      + 'the earlier mail gets, instead of a second line under it',
      { entryId: entry.id, mergedInto: winner.id })
  }

  return kept
}

/**
 * Rows already on the tab that the pending block is about to write again.
 *
 * The hole this closes: `appendRows` puts the block in the workbook and the
 * database write that records the row numbers is a separate call. If the
 * process dies between the two — a Lambda timing out mid-sync — the rows are on
 * the sheet and the entries are still PENDING, so the next sync appends them a
 * second time. Nothing downstream can tell those two lines apart afterwards.
 *
 * So before appending, the tail of the tab is read and any pending row already
 * standing there is claimed rather than written again: the entry is pointed at
 * the row it turns out to own, and drops out of the append.
 *
 * Only the tail is read. A row this sync is about to append can only have been
 * written by a sync that got as far as the workbook, which puts it at the
 * bottom — scanning the whole sheet every time would cost far more than it
 * could ever find.
 */
async function claimAlreadyWrittenRows(
  entries: QueryMonitorEntry[],
  keysOf: (entry: QueryMonitorEntry) => string[],
  ref: SheetRef, tab: string, layout: SheetLayout, sessionId: string | null,
  plan: WorkbookPlan,
  tailRows = 200,
): Promise<{ toAppend: QueryMonitorEntry[]; claimed: number }> {
  if (entries.length === 0) return { toAppend: entries, claimed: 0 }

  let rows: (string | number | boolean | null)[][]
  let firstRow: number
  try {
    const lastDataRow = await findLastDataRow(ref, tab, sessionId, layout)
    if (lastDataRow < 2) return { toAppend: entries, claimed: 0 }
    firstRow = Math.max(2, lastDataRow - tailRows + 1)
    rows = await readValuesRange(ref, tab, firstRow, lastDataRow, layout, sessionId)
  } catch {
    // The guard is an optimisation over correctness of the append itself. If the
    // tail cannot be read, write the block — a duplicate row is recoverable,
    // a query missing from the sheet is what the team actually notices.
    return { toAppend: entries, claimed: 0 }
  }

  // A row answers to more than one key: the exact one (this write landing
  // twice) and the "same query" ones (the team seeing the same line twice).
  const rowByKey = new Map<string, number>()
  rows.forEach((cells, i) => {
    for (const key of sheetRowKeys(cells, layout)) {
      if (!rowByKey.has(key)) rowByKey.set(key, firstRow + i)
    }
  })

  const toAppend: QueryMonitorEntry[] = []
  let claimed = 0

  for (const entry of entries) {
    const row = keysOf(entry).map(k => rowByKey.get(k)).find(r => r !== undefined)
    if (row === undefined) { toAppend.push(entry); continue }

    await prisma.queryMonitorEntry.update({
      where: { id: entry.id },
      data: {
        [plan.rowField]:    row,
        [plan.statusField]: 'SYNCED',
        [plan.errorField]:  null,
        ...(plan.target === 'primary' ? { sheetTab: tab, syncedAt: new Date() } : {}),
      },
    })
    claimed += 1
  }

  return { toAppend, claimed }
}

/**
 * Where each dirty entry's row has actually got to.
 *
 * A stored `sheetRow` is a row *number*, and a row number only means what it
 * meant when it was recorded for as long as nobody inserts or deletes rows above
 * it in Excel. The team does insert rows — that is what a shared workbook is for
 * — and on 17 Aug two hand-typed lines pushed every row below them down by two
 * while the database went on pointing at the old numbers. Nothing complained:
 * `updateRow` writes to the number it is given, so the next reply on that thread
 * would have overwritten one of the lines the team had just typed in.
 *
 * So before rewriting anything in place, the span holding the dirty rows is read
 * once and each entry is matched to the row that actually carries it, by the
 * exact identity the append guard already uses — date serial, allocation-time
 * serial and subject, the three cells nothing else edits. Three outcomes:
 *
 *   • **the stored row still matches** — the ordinary case, nothing to do;
 *   • **it moved** — the pointer is corrected to where the row now is, in the
 *     database as well as for this write, so the drift is repaired permanently;
 *   • **it is nowhere in the span** — the write is *skipped*. A row we cannot
 *     find is a row we must not guess at: writing blind is precisely how a
 *     hand-typed line gets destroyed. The entry is reported and left for the
 *     team to look at.
 *
 * One read per tab, not per row. If it fails, every entry is returned unverified
 * and the old behaviour stands — a sweep must not stop because a range read did.
 */
async function locateDirtyRows(
  entries: QueryMonitorEntry[],
  keysOf: (entry: QueryMonitorEntry) => string[],
  ref: SheetRef, tab: string, layout: SheetLayout, sessionId: string | null,
  plan: WorkbookPlan,
  margin = 250,
  maxSpan = 3000,
): Promise<Map<string, number | null>> {
  const located = new Map<string, number | null>()
  const rowsHeld = entries
    .map(e => e[plan.rowField])
    .filter((r): r is number => typeof r === 'number' && r > 1)
  if (rowsHeld.length === 0) return located

  // Padded on both sides, because the span the rows occupy is not where they may
  // have gone. A single dirty row would otherwise be looked for in a range of
  // exactly one row — itself — and any row that had moved would be reported lost
  // rather than found a few lines further down. The margin is what a hand edit
  // realistically shifts a row by; a bigger displacement is reported, not guessed.
  const first = Math.max(2, Math.min(...rowsHeld) - margin)
  const last  = Math.max(...rowsHeld) + margin
  // A span this wide means something is badly out of step; reading it would cost
  // more than the guard is worth. Leave every entry unverified.
  if (last - first + 1 > maxSpan) return located

  let rows: (string | number | boolean | null)[][]
  try {
    rows = await readValuesRange(ref, tab, first, last, layout, sessionId)
  } catch {
    return located
  }

  // Only the exact key is used here. The loose "same query" keys deliberately
  // match more than one row — two rounds of a thread, a genuine repeat — and
  // repointing an entry at one of those would move the write onto a row that
  // belongs to a different mail.
  const rowByExactKey = new Map<string, number>()
  rows.forEach((cells, i) => {
    // The padding runs past the last row in use, and a run of blank rows would
    // otherwise all key alike. No entry can key that way — every one has a
    // subject — but an empty row is not a candidate for anything.
    if (String(cells[2] ?? '').trim() === '') return
    const [exact] = sheetRowKeys(cells, layout)
    if (exact && !rowByExactKey.has(exact)) rowByExactKey.set(exact, first + i)
  })

  for (const entry of entries) {
    const stored = entry[plan.rowField]
    if (typeof stored !== 'number' || stored <= 1) continue
    const [exact] = keysOf(entry)
    located.set(entry.id, exact ? rowByExactKey.get(exact) ?? null : null)
  }
  return located
}

/** One workbook's share of the work. See `syncEntriesToSheet`. */
async function syncOneWorkbook(
  plan: WorkbookPlan, log?: RunLog, limit = 200,
): Promise<WorkbookSyncResult> {
  const note = (level: StepLevel, msg: string, meta?: Record<string, unknown>) =>
    log?.add(level, plan.target === 'backup' ? `Backup — ${msg}` : msg, meta)

  const config = await getConfig()

  /**
   * The cut-off is enforced on the *write*, not just when entries are collected.
   * An entry from before it may still carry a row number belonging to the
   * previous workbook; rewriting "its" row here would land on an unrelated row of
   * the current file. Filtering by date makes that impossible whatever state the
   * entry is in.
   */
  const cutoff = startDateBoundary(config.startDate)
  const inRange = cutoff ? { receivedAt: { gte: cutoff } } : {}

  const pending = await prisma.queryMonitorEntry.findMany({
    where:   { ...inRange, [plan.statusField]: 'PENDING' },
    orderBy: { receivedAt: 'asc' },
    take:    limit,
  })
  const dirty = await prisma.queryMonitorEntry.findMany({
    where:   { ...inRange, [plan.statusField]: 'DIRTY', [plan.rowField]: { not: null } },
    orderBy: { receivedAt: 'asc' },
    take:    limit,
  })

  const blank: WorkbookSyncResult = { target: plan.target, appended: 0, updated: 0, failed: 0 }

  if (pending.length === 0 && dirty.length === 0) {
    note('info', 'Already up to date — nothing to write')
    return blank
  }
  let ref: SheetRef
  try {
    ref = await resolveSheetRef(false, plan.target)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    note('error', `Cannot reach the ${plan.label}: ${msg}`)
    return { ...blank, failed: pending.length + dirty.length, error: msg }
  }

  const isExcluded = (e: QueryMonitorEntry) => e.mailKind === 'EXCLUDED'
  const pendingQueries  = pending.filter(e => !isExcluded(e))
  const pendingExcluded = pending.filter(isExcluded)

  /**
   * Which tab a row lives on. The primary remembers it per entry (rows written
   * before the two-tab split have none, and can only be on the query sheet); the
   * backup mirrors the primary's tab names, and an entry's kind cannot change
   * once it is written, so its kind is enough.
   */
  const tabFor = (entry: QueryMonitorEntry) => {
    const byKind = isExcluded(entry) ? config.excludedSheetName : config.sheetName
    return plan.target === 'primary' ? (entry.sheetTab ?? byKind) : byKind
  }

  const sessionId = await openSession(ref)
  let appended = 0
  let updated  = 0
  let failed   = 0
  let painted  = 0

  /** Mark a whole failed block, so the next sync retries it rather than losing it. */
  const failBlock = async (entries: QueryMonitorEntry[], msg: string, what: string) => {
    failed += entries.length
    await prisma.queryMonitorEntry.updateMany({
      where: { id: { in: entries.map(e => e.id) } },
      data:  { [plan.statusField]: 'FAILED', [plan.errorField]: msg.slice(0, 500) },
    })
    note('error', `Append failed for ${entries.length} ${what} row(s): ${msg}`)
  }

  const recordRows = async (entries: QueryMonitorEntry[], firstRow: number, tab: string) =>
    Promise.all(entries.map((entry, i) =>
      prisma.queryMonitorEntry.update({
        where: { id: entry.id },
        data: {
          [plan.rowField]:    firstRow + i,
          [plan.statusField]: 'SYNCED',
          [plan.errorField]:  null,
          // The tab and the "when" belong to the live file; the backup follows it.
          ...(plan.target === 'primary' ? { sheetTab: tab, syncedAt: new Date() } : {}),
        },
      }),
    ))

  /**
   * Every identity this entry's row answers to — the exact one (date serial,
   * allocation-time serial, subject) first, then the looser "same query" ones.
   *
   * Used by all three guards, so they cannot drift apart: the in-block fold, the
   * append claim, and `locateDirtyRows` — which takes the exact key alone,
   * because the loose keys match more than one row by design.
   *
   * An entry that re-opened an answered thread gets the exact key only. The
   * loose keys are same-day-and-subject, which is exactly what two rounds of one
   * thread look like — keeping them would claim the new round onto the old
   * round's row and undo the split that put it there. The exact key carries the
   * allocation time, which two rounds never share, so a write landing twice is
   * still caught.
   */
  const queryKeysFor = (e: QueryMonitorEntry) => {
    const row = buildSheetRow(e, config.writeStatusColumn, config.slaHours)
    const exact = writtenRowKey(row.date, row.allocationTime, row.subject)
    return e.newRound
      ? [exact]
      : [exact, ...sameQueryKeys(row.date, row.subject, e.fromAddress)]
  }

  /**
   * The same, for the other-mail tab. Non-query mail is never chased for a
   * reply, so it has no `repliedAt` and in practice never opens a round — the
   * branch is here so the two builders cannot drift apart if it ever does.
   */
  const excludedKeysFor = (e: QueryMonitorEntry) => {
    const row = buildExcludedRow(e)
    const exact = writtenRowKey(row.date, row.receivedTime, row.subject)
    return e.newRound
      ? [exact]
      : [exact, ...sameQueryKeys(row.date, row.subject, e.fromAddress)]
  }

  /**
   * Bring one row's colour up to date — green once the query has been answered.
   *
   * Skipped when the row already carries the colour it should: the remembered
   * fill is what stops every sweep re-painting hundreds of rows that have not
   * changed. Failures are swallowed on purpose; the values are the deliverable
   * and the colour is a reading aid, so a workbook that refuses the format call
   * must not turn a written row into a failed one.
   */
  const paintRow = async (
    entry: QueryMonitorEntry, rowNumber: number, tab: string, layout: SheetLayout,
  ) => {
    const wanted = rowFillFor(entry, config.highlightReplied)
    if (entry.mailKind === 'EXCLUDED') return
    if ((entry[plan.fillField] ?? null) === wanted) return

    try {
      await setRowFill(ref, tab, rowNumber, layout, wanted, sessionId)
      await prisma.queryMonitorEntry.update({
        where: { id: entry.id },
        data:  { [plan.fillField]: wanted },
      })
      painted += 1
    } catch (err) {
      note('warn', `"${tab}" row ${rowNumber} could not be coloured: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  try {
    if (pendingQueries.length > 0) {
      try {
        // Both workbooks were created empty for this system, so the query tab is
        // laid out here rather than assumed to exist.
        const { created, headerMismatch } = await ensureWorksheet(ref, config.sheetName, QUERY_LAYOUT, sessionId)
        if (created) note('info', `Created the "${config.sheetName}" tab`)
        if (headerMismatch) {
          // Columns are written by position. Under the old 13-column header every
          // value from G onwards would land one column left of where it belongs.
          throw new Error(
            `"${config.sheetName}" has data under a header that is not the expected `
            + `${QUERY_LAYOUT.header.length}-column layout (A–${QUERY_LAYOUT.lastColumn}: … Replied By, `
            + 'Response (hrs), SLA, Mails in Thread, Last Mail, AI Summary). Nothing was written. '
            + 'In Configuration → Target workbook, press "Keep this header" to carry on writing into '
            + 'the columns as they stand, or "Restore standard layout" to put the layout back with '
            + 'every existing row copied to an archive tab first.',
          )
        }
        const queryLayout = await layoutFor(ref, config.sheetName, QUERY_LAYOUT)

        // Two pending entries for one query never become two rows…
        const block = await foldDuplicatesInBlock(pendingQueries, queryKeysFor, note)

        // …and anything a previous sync already put on the sheet is claimed, not
        // written twice — see claimAlreadyWrittenRows.
        const { toAppend, claimed } = await claimAlreadyWrittenRows(
          block, queryKeysFor, ref, config.sheetName, queryLayout, sessionId, plan,
        )
        if (claimed > 0) {
          note('warn', `${claimed} row(s) were already on "${config.sheetName}" from an earlier sync — pointed at them instead of appending duplicates`)
        }

        const rows = toAppend.map(e => buildSheetRow(e, config.writeStatusColumn, config.slaHours))
        if (rows.length > 0) {
          const result = await appendRows(rows, { sessionId, ref, sheetName: config.sheetName, layout: queryLayout })
          // Row numbers are stored per entry so a row can be rewritten later.
          await recordRows(toAppend, result.firstRow, config.sheetName)
          appended += result.rows
          note('success', `Appended ${result.rows} row(s) to "${config.sheetName}" at rows ${result.firstRow}–${result.lastRow}`)

          // A query answered before its row was ever written — a reply that
          // landed while auto-write was off — is green from the moment it lands.
          for (let i = 0; i < toAppend.length; i += 1) {
            await paintRow(toAppend[i], result.firstRow + i, config.sheetName, queryLayout)
          }
        }
      } catch (err) {
        await failBlock(pendingQueries, err instanceof Error ? err.message : String(err), 'query')
      }
    }

    if (pendingExcluded.length > 0) {
      try {
        const { created, headerMismatch } = await ensureWorksheet(ref, config.excludedSheetName, EXCLUDED_LAYOUT, sessionId)
        if (created) note('info', `Created the "${config.excludedSheetName}" tab for mail that is not a query`)
        if (headerMismatch) {
          throw new Error(
            `"${config.excludedSheetName}" has data under an unexpected header. Nothing was written. `
            + 'Use "Keep this header" or "Restore standard layout" in Configuration → Target workbook.',
          )
        }
        const excludedLayout = await layoutFor(ref, config.excludedSheetName, EXCLUDED_LAYOUT)


        const block = await foldDuplicatesInBlock(pendingExcluded, excludedKeysFor, note)

        const { toAppend, claimed } = await claimAlreadyWrittenRows(
          block, excludedKeysFor, ref, config.excludedSheetName, excludedLayout, sessionId, plan,
        )
        if (claimed > 0) {
          note('warn', `${claimed} row(s) were already on "${config.excludedSheetName}" from an earlier sync — pointed at them instead of appending duplicates`)
        }

        const rows = toAppend.map(buildExcludedRow)
        if (rows.length > 0) {
          const result = await appendExcludedRows(rows, {
            sessionId, ref, sheetName: config.excludedSheetName, layout: excludedLayout,
          })
          await recordRows(toAppend, result.firstRow, config.excludedSheetName)
          appended += result.rows
          note('success', `Appended ${result.rows} non-query mail(s) to "${config.excludedSheetName}" at rows ${result.firstRow}–${result.lastRow}`)
        }
      } catch (err) {
        await failBlock(pendingExcluded, err instanceof Error ? err.message : String(err), 'non-query')
      }
    }

    // Where those rows have actually got to, in case the team inserted or
    // deleted rows above them since they were written — see `locateDirtyRows`.
    const dirtyQueries  = dirty.filter(e => !isExcluded(e))
    const dirtyExcluded = dirty.filter(e => isExcluded(e))
    // Not fatal, on the same principle as the append guard: leaving entries
    // unverified restores the old behaviour, while letting a range read fail the
    // sync would cost the team every rewrite in the batch.
    const located = new Map<string, number | null>()
    try {
      if (dirtyQueries.length > 0) {
        const found = await locateDirtyRows(
          dirtyQueries, queryKeysFor, ref, config.sheetName,
          await layoutFor(ref, config.sheetName, QUERY_LAYOUT), sessionId, plan)
        found.forEach((row, id) => located.set(id, row))
      }
      if (dirtyExcluded.length > 0) {
        const found = await locateDirtyRows(
          dirtyExcluded, excludedKeysFor, ref, config.excludedSheetName,
          await layoutFor(ref, config.excludedSheetName, EXCLUDED_LAYOUT), sessionId, plan)
        found.forEach((row, id) => located.set(id, row))
      }
    } catch (err) {
      located.clear()
      note('warn',
        'Could not check that the rows about to be rewritten are still the right rows: '
        + `${err instanceof Error ? err.message : String(err)}. They were rewritten by stored row `
        + 'number, as before.')
    }
    let moved = 0

    for (const entry of dirty) {
      const tab = tabFor(entry)
      const stored = entry[plan.rowField]!
      const found  = located.get(entry.id)

      // Verified missing — not merely unverified, which reads as undefined.
      if (found === null) {
        failed += 1
        await prisma.queryMonitorEntry.update({
          where: { id: entry.id },
          data: {
            [plan.statusField]: 'FAILED',
            [plan.errorField]:
              `Row ${stored} on "${tab}" no longer holds this query — it was not found anywhere `
              + 'near where it was written. Rows were probably inserted, deleted or re-sorted by '
              + 'hand. Nothing was written, so no hand-typed line was overwritten; find the row '
              + 'and correct it, or clear it and use "Retry failed writes" to append it again.',
          },
        }).catch(() => {})
        note('error',
          `"${tab}" row ${stored} no longer holds "${displaySubject(entry.subject).slice(0, 50)}" — `
          + 'skipped rather than overwrite whatever is standing there now',
          { entryId: entry.id, storedRow: stored })
        continue
      }

      const rowNumber = found ?? stored
      if (found !== undefined && found !== stored) {
        moved += 1
        await prisma.queryMonitorEntry.update({
          where: { id: entry.id },
          data:  { [plan.rowField]: found },
        }).catch(() => {})
      }

      try {
        if (isExcluded(entry)) {
          await updateExcludedRow(rowNumber, buildExcludedRow(entry), { sessionId, ref, sheetName: tab })
        } else {
          await updateRow(rowNumber, buildSheetRow(entry, config.writeStatusColumn, config.slaHours), { sessionId, ref, sheetName: tab })
          // The rewrite that matters most is the one a reply caused, and this is
          // where that row turns green.
          await paintRow(entry, rowNumber, tab, await layoutFor(ref, tab, QUERY_LAYOUT))
        }
        await prisma.queryMonitorEntry.update({
          where: { id: entry.id },
          data: {
            [plan.statusField]: 'SYNCED',
            [plan.errorField]:  null,
            ...(plan.target === 'primary' ? { syncedAt: new Date() } : {}),
          },
        })
        updated += 1
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        failed += 1
        await prisma.queryMonitorEntry.update({
          where: { id: entry.id },
          data:  { [plan.statusField]: 'FAILED', [plan.errorField]: msg.slice(0, 500) },
        }).catch(() => {})
        note('error', `"${tab}" row ${rowNumber} update failed: ${msg}`)
      }
    }

    if (updated > 0) {
      note('success', `Rewrote ${updated} existing row(s) with the current handler, reply time and status`)
    }
    if (moved > 0) {
      note('warn',
        `${moved} row(s) had moved since they were written — rows were inserted or deleted by hand `
        + 'above them. The stored row numbers were corrected to where the rows actually are, so the '
        + 'rewrites landed on the right lines.')
    }
    if (painted > 0) {
      note('info', `${painted} row(s) recoloured — answered queries are green`)
    }
  } finally {
    await closeSession(ref, sessionId)
  }

  return { target: plan.target, appended, updated, failed }
}

/**
 * Re-run the exclusion patterns over entries that have not been written yet.
 *
 * Editing the pattern list should fix the backlog too, but only where it is
 * still safe: an entry already in a sheet keeps its classification, because
 * moving it would leave an orphan row behind on the other tab.
 */
export async function reclassifyUnsyncedEntries(): Promise<{ toExcluded: number; toQuery: number; scanned: number }> {
  const config   = await getConfig()
  const patterns = config.excludeEnabled ? parseExcludePatterns(config.excludePatterns) : []

  // Unwritten in *both* workbooks — a row that exists anywhere would be orphaned
  // on its old tab by the move.
  const entries = await prisma.queryMonitorEntry.findMany({
    where: {
      sheetRow: null, backupSheetRow: null,
      syncStatus: { in: ['PENDING', 'DIRTY', 'FAILED'] },
    },
    select: { id: true, subject: true, mailKind: true },
    take:   2000,
  })

  let toExcluded = 0
  let toQuery    = 0

  for (const entry of entries) {
    const { kind, reason } = classifySubject(entry.subject, patterns)
    if (kind === entry.mailKind) continue

    await prisma.queryMonitorEntry.update({
      where: { id: entry.id },
      data: {
        mailKind: kind, excludeReason: reason?.slice(0, 180) ?? null,
        // Neither workbook has it yet (the query filters on that), so both are
        // simply re-queued for the tab the new classification points at.
        syncStatus: 'PENDING', syncError: null,
        backupSyncStatus: 'PENDING', backupSyncError: null,
      },
    })
    if (kind === 'EXCLUDED') toExcluded += 1
    else toQuery += 1
  }

  return { toExcluded, toQuery, scanned: entries.length }
}

// ── Duplicate clean-up ───────────────────────────────────────────────────────

export interface DuplicateSweepResult {
  scanned:     number
  merged:      number
  rowsRemoved: number
  /** Per workbook and tab: what was taken out, or why it could not be. */
  workbooks:   { target: WorkbookTarget; tab: string; rows: number; error?: string }[]
}

/** Which tab an entry's row lives on in a given workbook. Mirrors `syncOneWorkbook`. */
function tabOf(
  entry: QueryMonitorEntry, cfg: { sheetName: string; excludedSheetName: string },
  target: WorkbookTarget,
): string {
  const byKind = entry.mailKind === 'EXCLUDED' ? cfg.excludedSheetName : cfg.sheetName
  return target === 'primary' ? (entry.sheetTab ?? byKind) : byKind
}

/**
 * Fold the duplicates that are already in the workbook onto one row each.
 *
 * Thread merging only stops *new* duplicates. The rows written before it existed
 * — three lines of "Re: URGENT QUOTE | 3501051 | …" one under the other — are
 * cleaned up here: the earliest row of each thread is kept and updated, the rest
 * are deleted from the sheet and their entries marked MERGED.
 *
 * Deleting shifts every row below up by one, so the stored row pointers are
 * renumbered in the same pass; get that wrong and later rewrites would land on
 * the wrong rows. Only columns A–N move — the lists the team keeps to the right
 * of them are not aligned to our rows and are left where they are.
 *
 * Deliberately an admin action, not something a sweep does on its own.
 */
export async function mergeDuplicateEntries(): Promise<DuplicateSweepResult> {
  const cfg    = await getConfig()
  const cutoff = startDateBoundary(cfg.startDate)

  const entries = await prisma.queryMonitorEntry.findMany({
    where:   { mergedIntoId: null, ...(cutoff ? { receivedAt: { gte: cutoff } } : {}) },
    orderBy: { receivedAt: 'asc' },
    include: { matches: true },
    take:    5000,
  })

  /** Thread identity → the entry that keeps the row. Both keys point at it. */
  const roots = new Map<string, EntryWithMatches>()
  const duplicates: { entry: EntryWithMatches; root: EntryWithMatches }[] = []
  /** Root id → what the merge has accumulated onto it. */
  const growth = new Map<string, {
    toList: string[]; followUps: number; lastMessageAt: Date; duplicateReason: string
  }>()

  for (const entry of entries) {
    const subjectKey = subjectKeyFor(entry)
    const keys = [entry.conversationId, subjectKey].filter((k): k is string => !!k)
    const root = keys.map(k => roots.get(k)).find(Boolean)

    if (!root) {
      // First mail of this thread — it keeps its row, and answers to both keys.
      for (const key of keys) roots.set(key, entry)
      continue
    }

    // A duplicate can carry a key the root has never been seen under (the same
    // subject sent as a fresh mail), so its keys join the root's.
    for (const key of keys) if (!roots.has(key)) roots.set(key, root)

    duplicates.push({ entry, root })
    const acc = growth.get(root.id) ?? {
      toList: splitHandlers(root.toList), followUps: root.followUpCount,
      lastMessageAt: root.lastMessageAt ?? root.receivedAt,
      duplicateReason: root.duplicateReason ?? '',
    }
    acc.toList.push(...splitHandlers(entry.toList))
    acc.followUps += 1
    if (entry.receivedAt > acc.lastMessageAt) acc.lastMessageAt = entry.receivedAt
    acc.duplicateReason = appendDuplicateReason(acc.duplicateReason, duplicateReasonFor(entry, root))
    growth.set(root.id, acc)
  }

  /** target → tab → the row numbers this clean-up frees up. */
  const removals = new Map<WorkbookTarget, Map<string, number[]>>()
  const noteRemoval = (target: WorkbookTarget, tab: string, row: number) => {
    const byTab = removals.get(target) ?? new Map<string, number[]>()
    byTab.set(tab, [...(byTab.get(tab) ?? []), row])
    removals.set(target, byTab)
  }

  for (const { entry, root } of duplicates) {
    if (entry.sheetRow)       noteRemoval('primary', tabOf(entry, cfg, 'primary'), entry.sheetRow)
    if (entry.backupSheetRow) noteRemoval('backup',  tabOf(entry, cfg, 'backup'),  entry.backupSheetRow)

    // The duplicate's mail is part of the thread the root now stands for, so its
    // ledger moves with it — otherwise the kept row would under-count itself by
    // exactly the mails this fold just took off the sheet.
    await reassignThreadEvents(entry.id, root.id)

    await prisma.queryMonitorEntry.update({
      where: { id: entry.id },
      data: {
        mergedIntoId:     root.id,
        threadKey:        root.threadKey ?? threadKeyFor(root),
        subjectKey:       subjectKeyFor(entry),
        syncStatus:       'MERGED',
        backupSyncStatus: 'MERGED',
        syncError:        null,
        backupSyncError:  null,
        // The row it used to own is about to be deleted from the workbook.
        sheetRow:         null,
        sheetTab:         null,
        backupSheetRow:   null,
      },
    })
  }

  // The kept rows inherit everything their duplicates knew.
  for (const [rootId, acc] of Array.from(growth.entries())) {
    const root = entries.find(e => e.id === rootId)!
    const toList = joinHandlers(acc.toList)
    const owner  = root.handlerNames.trim() || autoFileHandler(splitHandlers(toList))
    // Recomputed after the events were moved above, so the kept row's counts,
    // forward chain and reply type describe the whole folded thread.
    const ledger = await rollUpEntry(rootId)
    await prisma.queryMonitorEntry.update({
      where: { id: rootId },
      data: {
        toList,
        handlerNames:  owner,
        followUpCount: acc.followUps,
        lastMessageAt: acc.lastMessageAt,
        threadKey:     root.threadKey ?? threadKeyFor(root),
        subjectKey:    subjectKeyFor(root),
        ...ledgerPatch(ledger),
        duplicateReason: acc.duplicateReason,
        // The thread just got longer than the stored summary was written from —
        // this is what makes the next sweep re-read it.
        replySummaryEvents: 0,
        ...(toList !== root.toList || owner !== root.handlerNames ? dirtyPatch(root) : {}),
      },
    })
  }

  const workbooks: DuplicateSweepResult['workbooks'] = []
  let rowsRemoved = 0

  for (const [target, byTab] of Array.from(removals.entries())) {
    if (target === 'backup' && !cfg.backupEnabled) continue

    let ref: SheetRef
    try {
      ref = await resolveSheetRef(false, target)
    } catch (err) {
      for (const [tab, rows] of Array.from(byTab.entries())) {
        workbooks.push({ target, tab, rows: 0, error: err instanceof Error ? err.message : String(err) })
      }
      continue
    }

    const sessionId = await openSession(ref)
    try {
      for (const [tab, rows] of Array.from(byTab.entries())) {
        const base: SheetLayout = tab === cfg.excludedSheetName ? EXCLUDED_LAYOUT : QUERY_LAYOUT
        const layout = await layoutFor(ref, tab, base)
        try {
          const removed = await deleteRowsAt(ref, tab, rows, layout, sessionId)
          await renumberAfterDelete(target, tab, rows, cfg)
          rowsRemoved += removed
          workbooks.push({ target, tab, rows: removed })
        } catch (err) {
          workbooks.push({ target, tab, rows: 0, error: err instanceof Error ? err.message : String(err) })
        }
      }
    } finally {
      await closeSession(ref, sessionId)
    }
  }

  return { scanned: entries.length, merged: duplicates.length, rowsRemoved, workbooks }
}

/**
 * Pull the stored row pointers up behind rows that were just deleted.
 *
 * Everything that sat below a deleted row is now one row higher per deletion
 * above it. Left unadjusted, the next "reply landed" rewrite would overwrite an
 * unrelated query.
 */
export async function renumberAfterDelete(
  target: WorkbookTarget, tab: string, deleted: number[],
  cfg: { sheetName: string; excludedSheetName: string },
): Promise<void> {
  const rowField = target === 'primary' ? 'sheetRow' : 'backupSheetRow'

  const survivors = await prisma.queryMonitorEntry.findMany({
    where: { [rowField]: { not: null } },
  })

  for (const entry of survivors) {
    if (tabOf(entry, cfg, target) !== tab) continue
    const row = entry[rowField]
    if (row === null) continue
    const next = remapRowNumber(row, deleted)
    if (next === row) continue
    await prisma.queryMonitorEntry.update({
      where: { id: entry.id },
      data:  { [rowField]: next },
    })
  }
}

export interface RebaseResult {
  requeued:  number
  retired:   number
  startDate: string
}

/**
 * Point the collected mail at a freshly configured workbook.
 *
 * Changing the workbook URL alone is not enough: every entry still remembers the
 * row it owns in the *old* file, so the next sweep would try to rewrite rows in
 * a workbook nothing is reading any more. This forgets those row numbers for
 * everything from the start date onwards, so the entries are appended to the new
 * file as if for the first time, and retires the older backlog.
 *
 * Nothing is deleted from the old workbook — it stays exactly as the team left
 * it. Run this once, after saving the new URLs.
 */
export async function rebaseToNewWorkbook(): Promise<RebaseResult> {
  const config = await getConfig()
  const cutoff = startDateBoundary(config.startDate)

  // Follow-ups are left MERGED: they never owned a row in the old file and must
  // not be given one in the new one — their thread's root carries them.
  const requeued = await prisma.queryMonitorEntry.updateMany({
    where: { mergedIntoId: null, ...(cutoff ? { receivedAt: { gte: cutoff } } : {}) },
    data: {
      sheetRow: null, sheetTab: null, syncStatus: 'PENDING', syncError: null,
      syncedAt: null,
      backupSheetRow: null, backupSyncStatus: 'PENDING', backupSyncError: null,
    },
  })

  // Older entries keep their place in the *previous* file, but that row number
  // means nothing here — held onto, it would aim a later rewrite at an unrelated
  // row of the new workbook.
  const retired = cutoff
    ? await prisma.queryMonitorEntry.updateMany({
        where: { mergedIntoId: null, receivedAt: { lt: cutoff } },
        data: {
          syncStatus: 'SKIPPED', backupSyncStatus: 'SKIPPED',
          sheetRow: null, sheetTab: null, backupSheetRow: null,
        },
      })
    : { count: 0 }

  return { requeued: requeued.count, retired: retired.count, startDate: config.startDate }
}

export interface RecolourResult {
  target:   WorkbookTarget
  painted:  number
  cleared:  number
  failed:   number
  /** Rows still out of step after the cap — press again to carry on. */
  remaining: number
  error?:   string
}

/**
 * Bring the row colours on a workbook up to date in one pass.
 *
 * A sweep only ever paints rows it is already writing, so on the day the
 * highlight goes in every query answered *before* it is on the sheet in white.
 * This is the catch-up for that, and the repair for a row someone recoloured by
 * hand. It writes no values whatsoever — only fills.
 *
 * Capped per press because each row is its own Graph call: a workbook with
 * thousands of answered queries would otherwise run past the function timeout
 * and leave the job half done with nothing recording where it got to. The count
 * of what is left comes back, so pressing it again continues.
 */
export async function recolourRepliedRows(
  target: WorkbookTarget = 'primary', limit = 300,
): Promise<RecolourResult> {
  const config = await getConfig()
  const plan   = target === 'primary' ? PRIMARY_PLAN : BACKUP_PLAN
  const base: RecolourResult = { target, painted: 0, cleared: 0, failed: 0, remaining: 0 }

  const cutoff  = startDateBoundary(config.startDate)
  const inRange = cutoff ? { receivedAt: { gte: cutoff } } : {}
  const wantedGreen = config.highlightReplied ? REPLIED_ROW_FILL : null

  // Rows whose colour is not what the current settings say it should be: an
  // answered query that is not green yet, or a row carrying a fill it should no
  // longer have (the query was reopened, or highlighting was switched off).
  const where = {
    ...inRange,
    mailKind: 'QUERY' as const,
    [plan.rowField]: { not: null },
    OR: [
      { replyStatus: 'REPLIED', [plan.fillField]: { not: wantedGreen } },
      { replyStatus: { not: 'REPLIED' }, [plan.fillField]: { not: null } },
    ],
  }

  const total   = await prisma.queryMonitorEntry.count({ where })
  const entries = await prisma.queryMonitorEntry.findMany({
    where, orderBy: { receivedAt: 'desc' }, take: limit,
  })
  if (entries.length === 0) return base

  let ref: SheetRef
  try {
    ref = await resolveSheetRef(false, target)
  } catch (err) {
    return { ...base, remaining: total, error: err instanceof Error ? err.message : String(err) }
  }

  const sessionId = await openSession(ref)
  let painted = 0
  let cleared = 0
  let failed  = 0

  try {
    // One layout lookup per tab, not per row — under an adopted header this is a
    // stored-mapping read, and there are only ever a couple of tabs in play.
    const layouts = new Map<string, SheetLayout>()
    const layoutOf = async (tab: string) => {
      const known = layouts.get(tab)
      if (known) return known
      const resolved = await layoutFor(ref, tab, QUERY_LAYOUT)
      layouts.set(tab, resolved)
      return resolved
    }

    for (const entry of entries) {
      const rowNumber = entry[plan.rowField]
      if (!rowNumber) continue
      const tab = (target === 'primary' ? entry.sheetTab : null) ?? config.sheetName
      const wanted = rowFillFor(entry, config.highlightReplied)

      try {
        await setRowFill(ref, tab, rowNumber, await layoutOf(tab), wanted, sessionId)
        await prisma.queryMonitorEntry.update({
          where: { id: entry.id },
          data:  { [plan.fillField]: wanted },
        })
        if (wanted) painted += 1
        else cleared += 1
      } catch {
        failed += 1
      }
    }
  } finally {
    await closeSession(ref, sessionId)
  }

  return {
    target, painted, cleared, failed,
    remaining: Math.max(0, total - painted - cleared),
  }
}

/** Re-queue an entry for both workbooks after a hand edit in the dashboard. */
export async function markEntryDirty(entryId: string): Promise<void> {
  const entry = await prisma.queryMonitorEntry.findUnique({ where: { id: entryId } })
  if (!entry) return
  await prisma.queryMonitorEntry.update({
    where: { id: entryId },
    data: {
      syncStatus:       entry.sheetRow       ? 'DIRTY' : 'PENDING',
      backupSyncStatus: entry.backupSheetRow ? 'DIRTY' : 'PENDING',
    },
  })
}

export { overrideSet }
