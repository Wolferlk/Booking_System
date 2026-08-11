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
  REPLY_STATUS_SHEET_LABEL, SETTINGS, UNMATCHED_SALES_PERSON,
  type ReplyStatus, type RunStatus, type RunTrigger,
} from './constants'
import { getConfig, listActiveMailboxes, setSetting, startDateBoundary } from './config'
import { classifySubject, parseExcludePatterns } from './classify'
import {
  fetchInboxSince, fetchSentConversationMap, findReplyForConversation,
  type MonitoredMessage,
} from './collect'
import { extractByRules, extractWithAi } from './extract'
import {
  isoDateInTz, startOfDayInTz, toExcelDateSerial, toExcelDateTimeSerial,
} from './dates'
import {
  displaySubject, hasReference, normalizeSubject, subjectKeyFor, threadKeyFor,
} from './thread'
import { summarizeMail } from './summarize'
import {
  EXCLUDED_LAYOUT, QUERY_LAYOUT, appendExcludedRows, appendRows, closeSession,
  deleteRowsAt, ensureWorksheet, findLastDataRow, layoutFor, openSession, readValuesRange,
  remapRowNumber, resolveSheetRef, updateExcludedRow, updateRow,
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

interface MessageGroup {
  dedupKey: string
  message:  MonitoredMessage
  handlers: { mailboxId: string; handlerName: string; graphId: string; receivedAt: Date }[]
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
 * The row that already stands for this mail's thread, if there is one.
 *
 * `dedupKeyFor` recognises one mail seen in several inboxes; this recognises the
 * *next* mail of a conversation the sheet already carries — the chaser, the
 * "any update?", the agent replying into their own thread. Without it each of
 * those takes a row of its own and the sheet shows the same subject three times.
 *
 * The earliest match wins: that entry is the query as it was first asked, and it
 * is the one whose Allocation time the SLA is measured from.
 */
async function findThreadRoot(
  message: MonitoredMessage, subjectKey: string | null, since: Date,
): Promise<EntryWithMatches | null> {
  const identities: Prisma.QueryMonitorEntryWhereInput[] = []
  if (message.conversationId) identities.push({ conversationId: message.conversationId })
  if (subjectKey)             identities.push({ subjectKey })

  if (identities.length > 0) {
    const root = await prisma.queryMonitorEntry.findFirst({
      // A follow-up folds into the thread's own root, never into another
      // follow-up — merged entries own no row to rewrite.
      where:   { mergedIntoId: null, receivedAt: { gte: since }, OR: identities },
      orderBy: { receivedAt: 'asc' },
      include: { matches: true },
    })
    if (root) return root
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
async function findSameDayResend(message: MonitoredMessage): Promise<EntryWithMatches | null> {
  const day = startOfDayInTz(isoDateInTz(message.receivedAt))
  if (!day || !message.fromAddress) return null

  const nextDay = new Date(day.getTime() + 24 * 3_600_000)
  const sameDay = await prisma.queryMonitorEntry.findMany({
    where: {
      mergedIntoId: null,
      fromAddress:  message.fromAddress,
      receivedAt:   { gte: day, lt: nextDay },
    },
    orderBy: { receivedAt: 'asc' },
    include: { matches: true },
    take:    50,
  })

  const subject = normalizeSubject(message.subject)
  return sameDay.find(entry => normalizeSubject(entry.subject) === subject) ?? null
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
      })),
      skipDuplicates: true,
    })
  }

  const toList = joinHandlers([
    ...splitHandlers(root.toList),
    ...newHandlers.map(h => h.handlerName),
  ])
  const owner = root.handlerNames.trim() || autoFileHandler(splitHandlers(toList))

  // The row always changes now: "Mails in Thread" goes up by one and "Last Mail"
  // moves to this mail's timestamp. That is the whole trade for not giving the
  // chaser a line of its own — the row has to say that the chaser happened.
  await prisma.queryMonitorEntry.update({
    where: { id: root.id },
    data: {
      toList,
      handlerNames:  owner,
      followUpCount: { increment: 1 },
      lastMessageAt: message.receivedAt,
      ...dirtyPatch(root),
    },
  })

  return { toList, rewrite: true }
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
    // One owner in F, everyone who received it in G. Blank F is deliberate: it
    // is the team's cue that nobody has picked the query up yet.
    fileHandler:    entry.handlerNames,
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
    // The chasers that did not get rows of their own are counted here instead,
    // so nothing is hidden — the sheet says "3 mails" on one line.
    threadCount:    entry.followUpCount + 1,
    lastMail:       toExcelDateTimeSerial(entry.lastMessageAt ?? entry.receivedAt),
    aiSummary:      entry.aiSummary ?? '',
  }
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
 */
export function autoFileHandler(toList: string[]): string {
  return toList.length === 1 ? toList[0] : ''
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
    const mailboxes = await listActiveMailboxes()
    if (mailboxes.length === 0) log.add('warn', 'No active mailboxes configured')

    const groups = new Map<string, MessageGroup>()
    /** mailboxId → conversationId → first reply sent. */
    const sentMaps = new Map<string, Map<string, Date>>()

    for (const mailbox of mailboxes) {
      try {
        const messages = await fetchInboxSince(mailbox.email, windowFrom)
        counters.mailboxesScanned += 1
        counters.messagesSeen += messages.length

        // Sent Items across the chase window, so replies to older still-open
        // queries are picked up in the same pass without extra calls.
        const sentSince = new Date(Date.now() - config.replyChaseDays * 86_400_000)
        sentMaps.set(mailbox.id, await fetchSentConversationMap(mailbox.email, sentSince))

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
            })),
            skipDuplicates: true,
          })

          const merged = joinHandlers([
            ...splitHandlers(existing.toList),
            ...newHandlers.map(h => h.handlerName),
          ])

          // A second recipient means the owner is no longer obvious, but an owner
          // already chosen — by a reply or by hand — is never taken back.
          const owner = existing.handlerNames.trim() || autoFileHandler(splitHandlers(merged))

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
        // One query, one row: the chaser rewrites that row instead of adding a
        // second line with the same subject under it.
        const subjectKey = subjectKeyFor(message)
        const root = config.threadMergeEnabled
          ? await findThreadRoot(message, subjectKey, threadWindowFrom)
          : null

        if (root) {
          const { toList: mergedList } = await mergeFollowUp(root, group, run.id)
          counters.entriesUpdated += 1
          log.add('info',
            `Follow-up on "${displaySubject(message.subject).slice(0, 60)}" — folded into `
            + (root.sheetRow ? `row ${root.sheetRow}` : 'the query it belongs to')
            + `, now ${root.followUpCount + 2} mail(s) on one row (TO list ${mergedList})`,
            { entryId: root.id, followUps: root.followUpCount + 1 })
          continue
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
            handlerNames:   autoFileHandler(splitHandlers(toList)),
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
              })),
            },
          },
        })

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
    counters.repliesDetected = await detectReplies(sentMaps, config.replyChaseDays, config.slaHours, log)

    // ── 4. Push to the workbook ─────────────────────────────────────────────
    if (config.autoWrite) {
      const sync = await syncEntriesToSheet(log)
      counters.rowsAppended = sync.appended
      counters.rowsUpdated  = sync.updated
    } else {
      const pending = await prisma.queryMonitorEntry.count({ where: { syncStatus: { in: ['PENDING', 'DIRTY'] } } })
      log.add('warn', `Auto-write is OFF — ${pending} row(s) held in review. Turn it on (or press "Sync to sheet") to write them.`)
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

/**
 * Fills in "Replied time" for open queries. Bulk-matches against the Sent Items
 * map first (free), then falls back to a per-thread lookup for the handful of
 * older threads that fell outside it. Anything past the SLA with no reply is
 * flipped to OVERDUE so the sheet shows it in red.
 *
 * This is what keeps yesterday's rows honest. A query raised at 16:00 and
 * answered at 09:00 the next morning is out of every lookback window by the time
 * the reply lands, so replies are chased for `chaseDays` regardless of when the
 * mail arrived: the reply time, the status **and** the file handler are all
 * written back into rows that were appended days ago.
 */
async function detectReplies(
  sentMaps: Map<string, Map<string, Date>>,
  chaseDays: number,
  slaHours: number,
  log: RunLog,
): Promise<number> {
  const since = new Date(Date.now() - chaseDays * 86_400_000)

  // Excluded mail is not measured against the SLA, so it never costs a lookup —
  // nor do follow-ups, whose reply state is the root row's to carry.
  const open = await prisma.queryMonitorEntry.findMany({
    where: {
      mailKind: 'QUERY', mergedIntoId: null,
      replyStatus: { not: 'REPLIED' }, receivedAt: { gte: since },
    },
    include: { matches: { include: { mailbox: true } } },
    orderBy: { receivedAt: 'asc' },
    take:    500,
  })

  let detected = 0
  let targetedLookups = 0
  const TARGETED_LOOKUP_BUDGET = 40

  for (const entry of open) {
    let repliedAt: Date | null = null
    let repliedBy: string | null = null

    if (entry.conversationId) {
      for (const match of entry.matches) {
        const sent = sentMaps.get(match.mailboxId)?.get(entry.conversationId)
        if (sent && sent >= entry.receivedAt && (!repliedAt || sent < repliedAt)) {
          repliedAt = sent
          repliedBy = match.handlerName
        }
      }

      // Older thread, no bulk hit — ask Graph about this one conversation.
      if (!repliedAt && targetedLookups < TARGETED_LOOKUP_BUDGET) {
        for (const match of entry.matches) {
          targetedLookups += 1
          const sent = await findReplyForConversation(
            match.mailbox.email, entry.conversationId, entry.receivedAt,
          )
          // The loop stops at the first hit, so there is nothing to compare against.
          if (sent) {
            repliedAt = sent
            repliedBy = match.handlerName
            break
          }
        }
      }
    }

    const nextStatus = computeReplyStatus(entry.receivedAt, repliedAt, slaHours)

    // Whoever answered owns the query. This is how a mail sent to six handlers
    // gets a File Handler without anyone touching the dashboard — but a name
    // already chosen by hand is left alone.
    const overrides = overrideSet(entry)
    const newOwner = repliedBy && !entry.handlerNames.trim() && !overrides.has('handlerNames')
      ? repliedBy
      : null

    if (!repliedAt && !newOwner && nextStatus === entry.replyStatus) continue

    await prisma.queryMonitorEntry.update({
      where: { id: entry.id },
      data: {
        repliedAt:   repliedAt ?? entry.repliedAt,
        replyStatus: nextStatus,
        // Who actually answered, kept whether or not they became the owner —
        // on a mail sent to six handlers this is the only record of it.
        ...(repliedBy ? { repliedBy } : {}),
        ...(newOwner ? { handlerNames: newOwner } : {}),
        // A row already in a sheet needs its Status / Replied time rewritten.
        ...dirtyPatch(entry),
      },
    })

    if (repliedAt) {
      detected += 1
      await prisma.queryMonitorMatch.updateMany({
        where: { entryId: entry.id, handlerName: repliedBy ?? undefined },
        data:  { repliedAt },
      }).catch(() => {})
      log.add('info', `Reply found for "${entry.subject.slice(0, 50)}" by ${repliedBy ?? 'team'}`, {
        entryId: entry.id, repliedAt: repliedAt.toISOString(),
        ...(newOwner ? { fileHandlerAssigned: newOwner } : {}),
      })
    }
  }

  if (detected > 0) log.add('success', `${detected} repl${detected === 1 ? 'y' : 'ies'} detected`)
  return detected
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
}

const PRIMARY_PLAN: WorkbookPlan = {
  target: 'primary', label: 'workbook',
  rowField: 'sheetRow', statusField: 'syncStatus', errorField: 'syncError',
}

const BACKUP_PLAN: WorkbookPlan = {
  target: 'backup', label: 'backup workbook',
  rowField: 'backupSheetRow', statusField: 'backupSyncStatus', errorField: 'backupSyncError',
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
    const winner = keys.map(k => winnerByKey.get(k)).find(Boolean)

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

    // The surviving row has to say the second mail happened — that is the whole
    // trade for not giving it a line of its own.
    winner.followUpCount += 1
    const last = winner.lastMessageAt ?? winner.receivedAt
    if (entry.receivedAt > last) winner.lastMessageAt = entry.receivedAt

    await prisma.queryMonitorEntry.update({
      where: { id: winner.id },
      data:  { followUpCount: winner.followUpCount, lastMessageAt: winner.lastMessageAt },
    })

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

        /** Every identity this entry's row would answer to. */
        const queryKeys = (e: QueryMonitorEntry) => {
          const row = buildSheetRow(e, config.writeStatusColumn, config.slaHours)
          return [
            writtenRowKey(row.date, row.allocationTime, row.subject),
            ...sameQueryKeys(row.date, row.subject, e.fromAddress),
          ]
        }

        // Two pending entries for one query never become two rows…
        const block = await foldDuplicatesInBlock(pendingQueries, queryKeys, note)

        // …and anything a previous sync already put on the sheet is claimed, not
        // written twice — see claimAlreadyWrittenRows.
        const { toAppend, claimed } = await claimAlreadyWrittenRows(
          block, queryKeys, ref, config.sheetName, queryLayout, sessionId, plan,
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

        const excludedKeys = (e: QueryMonitorEntry) => {
          const row = buildExcludedRow(e)
          return [
            writtenRowKey(row.date, row.receivedTime, row.subject),
            ...sameQueryKeys(row.date, row.subject, e.fromAddress),
          ]
        }

        const block = await foldDuplicatesInBlock(pendingExcluded, excludedKeys, note)

        const { toAppend, claimed } = await claimAlreadyWrittenRows(
          block, excludedKeys, ref, config.excludedSheetName, excludedLayout, sessionId, plan,
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

    for (const entry of dirty) {
      const tab = tabFor(entry)
      const rowNumber = entry[plan.rowField]!
      try {
        if (isExcluded(entry)) {
          await updateExcludedRow(rowNumber, buildExcludedRow(entry), { sessionId, ref, sheetName: tab })
        } else {
          await updateRow(rowNumber, buildSheetRow(entry, config.writeStatusColumn, config.slaHours), { sessionId, ref, sheetName: tab })
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
  const growth = new Map<string, { toList: string[]; followUps: number; lastMessageAt: Date }>()

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
    }
    acc.toList.push(...splitHandlers(entry.toList))
    acc.followUps += 1
    if (entry.receivedAt > acc.lastMessageAt) acc.lastMessageAt = entry.receivedAt
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
    await prisma.queryMonitorEntry.update({
      where: { id: rootId },
      data: {
        toList,
        handlerNames:  owner,
        followUpCount: acc.followUps,
        lastMessageAt: acc.lastMessageAt,
        threadKey:     root.threadKey ?? threadKeyFor(root),
        subjectKey:    subjectKeyFor(root),
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
