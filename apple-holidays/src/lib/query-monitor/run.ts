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
import { toExcelDateSerial, toExcelDateTimeSerial } from './dates'
import {
  EXCLUDED_LAYOUT, QUERY_LAYOUT, appendExcludedRows, appendRows, closeSession,
  ensureWorksheet, openSession, resolveSheetRef, updateExcludedRow, updateRow,
  type ExcludedRowValues, type SheetRef, type SheetRowValues, type WorkbookTarget,
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

// ── Sheet row assembly ───────────────────────────────────────────────────────

export function buildSheetRow(entry: QueryMonitorEntry, writeStatus: boolean): SheetRowValues {
  const status = writeStatus
    ? (REPLY_STATUS_SHEET_LABEL[entry.replyStatus as ReplyStatus] ?? '')
    : ''

  return {
    date:           toExcelDateSerial(entry.receivedAt),
    status,
    subject:        entry.subject.slice(0, 500),
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
  }
}

/** The same entry as a row on the second tab. */
export function buildExcludedRow(entry: QueryMonitorEntry): ExcludedRowValues {
  return {
    date:         toExcelDateSerial(entry.receivedAt),
    receivedTime: toExcelDateTimeSerial(entry.receivedAt),
    subject:      entry.subject.slice(0, 500),
    sender:       entry.fromName || entry.fromDomain,
    senderEmail:  entry.fromAddress,
    fileHandler:  entry.handlerNames,
    toList:       entry.toList,
    reason:       entry.excludeReason ?? 'Not a query',
    destination:  entry.destination ?? '',
    cntl:         entry.cntl ?? '',
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

async function acquireLock(): Promise<boolean> {
  const existing = await prisma.systemSetting.findUnique({ where: { key: SETTINGS.runLock } })
  if (existing) {
    const heldSince = new Date(existing.value).getTime()
    if (Number.isFinite(heldSince) && Date.now() - heldSince < LOCK_TTL_MS) return false
  }
  await setSetting(SETTINGS.runLock, new Date().toISOString())
  return true
}

async function releaseLock(): Promise<void> {
  await prisma.systemSetting.deleteMany({ where: { key: SETTINGS.runLock } })
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
    const ordered = Array.from(groups.values()).sort(
      (a, b) => a.message.receivedAt.getTime() - b.message.receivedAt.getTime(),
    )

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

        const created = await prisma.queryMonitorEntry.create({
          data: {
            dedupKey:       group.dedupKey,
            conversationId: message.conversationId,
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

  // Excluded mail is not measured against the SLA, so it never costs a lookup.
  const open = await prisma.queryMonitorEntry.findMany({
    where:   { mailKind: 'QUERY', replyStatus: { not: 'REPLIED' }, receivedAt: { gte: since } },
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
}

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
            + `${QUERY_LAYOUT.header.length}-column layout (File Handler, TO List, …). `
            + 'Nothing was written — fix the header, or point at a clean tab, then sync again.',
          )
        }

        const rows = pendingQueries.map(e => buildSheetRow(e, config.writeStatusColumn))
        const result = await appendRows(rows, { sessionId, ref, sheetName: config.sheetName })
        // Row numbers are stored per entry so a row can be rewritten later.
        await recordRows(pendingQueries, result.firstRow, config.sheetName)
        appended += result.rows
        note('success', `Appended ${result.rows} row(s) to "${config.sheetName}" at rows ${result.firstRow}–${result.lastRow}`)
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
            `"${config.excludedSheetName}" has data under an unexpected header. Nothing was written.`,
          )
        }

        const rows = pendingExcluded.map(buildExcludedRow)
        const result = await appendExcludedRows(rows, { sessionId, ref, sheetName: config.excludedSheetName })
        await recordRows(pendingExcluded, result.firstRow, config.excludedSheetName)
        appended += result.rows
        note('success', `Appended ${result.rows} non-query mail(s) to "${config.excludedSheetName}" at rows ${result.firstRow}–${result.lastRow}`)
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
          await updateRow(rowNumber, buildSheetRow(entry, config.writeStatusColumn), { sessionId, ref, sheetName: tab })
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

  const requeued = await prisma.queryMonitorEntry.updateMany({
    where: cutoff ? { receivedAt: { gte: cutoff } } : {},
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
        where: { receivedAt: { lt: cutoff } },
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
