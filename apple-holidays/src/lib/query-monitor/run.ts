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
import { getConfig, listActiveMailboxes, setSetting } from './config'
import { classifySubject, parseExcludePatterns } from './classify'
import {
  fetchInboxSince, fetchSentConversationMap, findReplyForConversation,
  type MonitoredMessage,
} from './collect'
import { extractByRules, extractWithAi } from './extract'
import { toExcelDateSerial, toExcelDateTimeSerial } from './dates'
import {
  EXCLUDED_LAYOUT, appendExcludedRows, appendRows, closeSession, ensureWorksheet,
  openSession, resolveSheetRef, updateExcludedRow, updateRow,
  type ExcludedRowValues, type SheetRef, type SheetRowValues,
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
    fileHandler:    entry.handlerNames,
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
    reason:       entry.excludeReason ?? 'Not a query',
    destination:  entry.destination ?? '',
    cntl:         entry.cntl ?? '',
  }
}

function computeReplyStatus(receivedAt: Date, repliedAt: Date | null, slaHours: number): ReplyStatus {
  if (repliedAt) return 'REPLIED'
  const ageHours = (Date.now() - receivedAt.getTime()) / 3_600_000
  return ageHours > slaHours ? 'OVERDUE' : 'PENDING'
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
  const windowFrom = new Date(Date.now() - lookbackHours * 3_600_000)
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
        const handlerNames = group.handlers
          .map(h => h.handlerName)
          .filter((name, i, all) => all.indexOf(name) === i)
          .join(', ')

        const existing = await prisma.queryMonitorEntry.findUnique({
          where:   { dedupKey: group.dedupKey },
          include: { matches: true },
        })

        if (existing) {
          // Already known — only the handler list can grow (a colleague was
          // CC'd late, or their mailbox was activated after the first sweep).
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

          const merged = [
            ...existing.handlerNames.split(',').map(s => s.trim()).filter(Boolean),
            ...newHandlers.map(h => h.handlerName),
          ].filter((name, i, all) => all.indexOf(name) === i).join(', ')

          await prisma.queryMonitorEntry.update({
            where: { id: existing.id },
            data: {
              handlerNames: merged,
              // Already in the sheet? Mark it for a rewrite rather than a new row.
              syncStatus:   existing.sheetRow ? 'DIRTY' : existing.syncStatus,
            },
          })
          counters.entriesUpdated += 1
          log.add('info', `Handler added to existing query "${message.subject.slice(0, 60)}" → ${merged}`)
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
            handlerNames,
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
          log.add('success', `New query "${created.subject.slice(0, 60)}" — ${handlerNames} · ${sender.salesPerson}`, {
            entryId: created.id, destination, travelDate: travelDate?.toISOString() ?? null, source,
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
    if (!repliedAt && nextStatus === entry.replyStatus) continue

    await prisma.queryMonitorEntry.update({
      where: { id: entry.id },
      data: {
        repliedAt:   repliedAt ?? entry.repliedAt,
        replyStatus: nextStatus,
        // A row already in the sheet needs its Status / Replied time rewritten.
        syncStatus:  entry.sheetRow ? 'DIRTY' : entry.syncStatus,
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
      })
    }
  }

  if (detected > 0) log.add('success', `${detected} repl${detected === 1 ? 'y' : 'ies'} detected`)
  return detected
}

// ── Sheet sync ───────────────────────────────────────────────────────────────

export interface SyncResult {
  appended: number
  updated:  number
  failed:   number
}

/**
 * Write everything outstanding to the workbook: PENDING entries are appended in
 * one contiguous block per tab (cheap — a single range PATCH each), DIRTY
 * entries are rewritten in place at the row they already own.
 *
 * Two destinations, one pass. Entries classified QUERY go to the master query
 * sheet; everything the exclusion patterns caught goes to the "other mail" tab,
 * which is created on first use if the workbook has no such tab yet.
 *
 * Safe to call by hand from the UI, which is how a review-first team gets rows
 * into the sheet while auto-write is still off.
 */
export async function syncEntriesToSheet(log?: RunLog, limit = 200): Promise<SyncResult> {
  const note = (level: StepLevel, msg: string, meta?: Record<string, unknown>) => log?.add(level, msg, meta)

  const pending = await prisma.queryMonitorEntry.findMany({
    where:   { syncStatus: 'PENDING' },
    orderBy: { receivedAt: 'asc' },
    take:    limit,
  })
  const dirty = await prisma.queryMonitorEntry.findMany({
    where:   { syncStatus: 'DIRTY', sheetRow: { not: null } },
    orderBy: { receivedAt: 'asc' },
    take:    limit,
  })

  if (pending.length === 0 && dirty.length === 0) {
    note('info', 'Sheet already up to date — nothing to write')
    return { appended: 0, updated: 0, failed: 0 }
  }

  const config = await getConfig()
  let ref: SheetRef
  try {
    ref = await resolveSheetRef()
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    note('error', `Cannot reach the workbook: ${msg}`)
    return { appended: 0, updated: 0, failed: pending.length + dirty.length }
  }

  const isExcluded = (e: QueryMonitorEntry) => e.mailKind === 'EXCLUDED'
  const pendingQueries  = pending.filter(e => !isExcluded(e))
  const pendingExcluded = pending.filter(isExcluded)

  const sessionId = await openSession(ref)
  let appended = 0
  let updated  = 0
  let failed   = 0

  /** Mark a whole failed block, so the next sync retries it rather than losing it. */
  const failBlock = async (entries: QueryMonitorEntry[], msg: string, what: string) => {
    failed += entries.length
    await prisma.queryMonitorEntry.updateMany({
      where: { id: { in: entries.map(e => e.id) } },
      data:  { syncStatus: 'FAILED', syncError: msg.slice(0, 500) },
    })
    note('error', `Append failed for ${entries.length} ${what} row(s): ${msg}`)
  }

  const recordRows = async (entries: QueryMonitorEntry[], firstRow: number, tab: string) =>
    Promise.all(entries.map((entry, i) =>
      prisma.queryMonitorEntry.update({
        where: { id: entry.id },
        data: {
          sheetRow:   firstRow + i,
          sheetTab:   tab,
          syncStatus: 'SYNCED',
          syncedAt:   new Date(),
          syncError:  null,
        },
      }),
    ))

  try {
    if (pendingQueries.length > 0) {
      try {
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
        const { created } = await ensureWorksheet(ref, config.excludedSheetName, EXCLUDED_LAYOUT, sessionId)
        if (created) note('info', `Created the "${config.excludedSheetName}" tab for mail that is not a query`)

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
      // Entries written before the two-tab split have no sheetTab — they can
      // only be on the query sheet, which is where they are rewritten.
      const tab = entry.sheetTab ?? config.sheetName
      try {
        if (isExcluded(entry)) {
          await updateExcludedRow(entry.sheetRow!, buildExcludedRow(entry), { sessionId, ref, sheetName: tab })
        } else {
          await updateRow(entry.sheetRow!, buildSheetRow(entry, config.writeStatusColumn), { sessionId, ref, sheetName: tab })
        }
        await prisma.queryMonitorEntry.update({
          where: { id: entry.id },
          data:  { syncStatus: 'SYNCED', syncedAt: new Date(), syncError: null },
        })
        updated += 1
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        failed += 1
        await prisma.queryMonitorEntry.update({
          where: { id: entry.id },
          data:  { syncStatus: 'FAILED', syncError: msg.slice(0, 500) },
        }).catch(() => {})
        note('error', `"${tab}" row ${entry.sheetRow} update failed: ${msg}`)
      }
    }

    if (updated > 0) note('success', `Rewrote ${updated} existing row(s) with new reply times`)
  } finally {
    await closeSession(ref, sessionId)
  }

  return { appended, updated, failed }
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

  const entries = await prisma.queryMonitorEntry.findMany({
    where:  { sheetRow: null, syncStatus: { in: ['PENDING', 'DIRTY', 'FAILED'] } },
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
      data:  { mailKind: kind, excludeReason: reason?.slice(0, 180) ?? null, syncStatus: 'PENDING', syncError: null },
    })
    if (kind === 'EXCLUDED') toExcluded += 1
    else toQuery += 1
  }

  return { toExcluded, toQuery, scanned: entries.length }
}

/** Re-queue an entry for the sheet after a hand edit in the dashboard. */
export async function markEntryDirty(entryId: string): Promise<void> {
  const entry = await prisma.queryMonitorEntry.findUnique({ where: { id: entryId } })
  if (!entry) return
  await prisma.queryMonitorEntry.update({
    where: { id: entryId },
    data:  { syncStatus: entry.sheetRow ? 'DIRTY' : 'PENDING' },
  })
}

export { overrideSet }
