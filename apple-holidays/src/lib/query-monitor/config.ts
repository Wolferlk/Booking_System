/**
 * Query Monitor configuration — settings, mailboxes and sender rules.
 *
 * All three are runtime-editable from the admin UI; nothing here reads env vars
 * except the Graph credentials, which live in graph-client.ts.
 */
import { prisma } from '@/lib/prisma'
import { DEFAULTS, SEED_MAILBOXES, SEED_SENDER_RULES, SETTINGS } from './constants'
import { startOfDayInTz } from './dates'

export interface QueryMonitorConfig {
  enabled:           boolean
  intervalMinutes:   number
  lookbackHours:     number
  autoWrite:         boolean
  sheetUrl:          string
  sheetName:         string
  writeStatusColumn: boolean
  captureUnmatched:  boolean
  aiEnabled:         boolean
  /** GPT reads every new mail and writes a one-sentence summary into the sheet. */
  aiSummaryEnabled:  boolean
  slaHours:          number
  replyChaseDays:    number
  /** One row per thread: a follow-up rewrites the query's row instead of adding one. */
  threadMergeEnabled: boolean
  /** How far back a follow-up may reach to find the row it belongs to, in days. */
  threadWindowDays:   number
  excludeEnabled:    boolean
  excludePatterns:   string
  excludedSheetName: string
  /** Tab the OpenAI spend report is rewritten onto — owned entirely by the app. */
  aiUsageSheetName:  string
  /** Tab the daily mail counts are rewritten onto — also owned by the app. */
  dailyStatsSheetName: string
  /** How many days back the daily counts cover. */
  dailyStatsDays:      number
  /** Rewrite the daily counts at the end of every sweep. */
  dailyStatsAutoWrite: boolean
  /** Tab every collected mail is rewritten onto, unfiltered — also the app's. */
  allMailsSheetName:   string
  /** How many days of mail that tab covers, newest first. */
  allMailsDays:        number
  /** Rewrite the all-mail tab at the end of every sweep. */
  allMailsAutoWrite:   boolean
  /** Paint a query's row green in the workbook once it has been answered. */
  highlightReplied:    boolean
  /** `YYYY-MM-DD`. Mail older than this is collected but never written. */
  startDate:         string
  backupEnabled:     boolean
  backupSheetUrl:    string
  lastRunAt:         string | null
}

/**
 * The instant the cut-off date begins, in the sheet's timezone — a mail at
 * 02:00 local on the 5th is a 5th-of-August query and must not be filtered out.
 * Null when the setting is blank, which means "no cut-off".
 */
export function startDateBoundary(startDate: string): Date | null {
  return startOfDayInTz(startDate.trim())
}

// ── Settings ─────────────────────────────────────────────────────────────────

export async function getSetting(key: string): Promise<string | null> {
  const row = await prisma.systemSetting.findUnique({ where: { key } })
  return row?.value ?? null
}

export async function setSetting(key: string, value: string): Promise<void> {
  await prisma.systemSetting.upsert({
    where:  { key },
    create: { key, value },
    update: { value },
  })
}

export async function getConfig(): Promise<QueryMonitorConfig> {
  const keys = Object.values(SETTINGS)
  const rows = await prisma.systemSetting.findMany({ where: { key: { in: [...keys] } } })
  const map  = new Map(rows.map(r => [r.key, r.value]))

  const str  = (k: string, d: string) => (map.get(k) ?? d).trim()
  const bool = (k: string, d: string) => str(k, d).toLowerCase() === 'true'
  const num  = (k: string, d: string) => {
    const n = Number(str(k, d))
    return Number.isFinite(n) ? n : Number(d)
  }

  return {
    enabled:           bool(SETTINGS.enabled,           DEFAULTS.enabled),
    intervalMinutes:   Math.max(5, num(SETTINGS.intervalMinutes, DEFAULTS.intervalMinutes)),
    lookbackHours:     Math.max(1, num(SETTINGS.lookbackHours,   DEFAULTS.lookbackHours)),
    autoWrite:         bool(SETTINGS.autoWrite,         DEFAULTS.autoWrite),
    sheetUrl:          str(SETTINGS.sheetUrl,           DEFAULTS.sheetUrl),
    sheetName:         str(SETTINGS.sheetName,          DEFAULTS.sheetName),
    writeStatusColumn: bool(SETTINGS.writeStatusColumn, DEFAULTS.writeStatusColumn),
    captureUnmatched:  bool(SETTINGS.captureUnmatched,  DEFAULTS.captureUnmatched),
    aiEnabled:         bool(SETTINGS.aiEnabled,         DEFAULTS.aiEnabled),
    aiSummaryEnabled:  bool(SETTINGS.aiSummaryEnabled,  DEFAULTS.aiSummaryEnabled),
    slaHours:          Math.max(1, num(SETTINGS.slaHours,       DEFAULTS.slaHours)),
    replyChaseDays:    Math.max(1, num(SETTINGS.replyChaseDays, DEFAULTS.replyChaseDays)),
    threadMergeEnabled: bool(SETTINGS.threadMergeEnabled, DEFAULTS.threadMergeEnabled),
    threadWindowDays:   Math.max(1, num(SETTINGS.threadWindowDays, DEFAULTS.threadWindowDays)),
    excludeEnabled:    bool(SETTINGS.excludeEnabled, DEFAULTS.excludeEnabled),
    excludePatterns:   str(SETTINGS.excludePatterns,   DEFAULTS.excludePatterns),
    excludedSheetName: str(SETTINGS.excludedSheetName, DEFAULTS.excludedSheetName)
                       || DEFAULTS.excludedSheetName,
    aiUsageSheetName:  str(SETTINGS.aiUsageSheetName, DEFAULTS.aiUsageSheetName)
                       || DEFAULTS.aiUsageSheetName,
    dailyStatsSheetName: str(SETTINGS.dailyStatsSheetName, DEFAULTS.dailyStatsSheetName)
                         || DEFAULTS.dailyStatsSheetName,
    // Capped: the tab is rewritten whole on every sweep, and a year of days ×
    // mailboxes is a report nobody reads and a payload that times the write out.
    dailyStatsDays:      Math.min(180, Math.max(1, num(SETTINGS.dailyStatsDays, DEFAULTS.dailyStatsDays))),
    dailyStatsAutoWrite: bool(SETTINGS.dailyStatsAutoWrite, DEFAULTS.dailyStatsAutoWrite),
    allMailsSheetName:   str(SETTINGS.allMailsSheetName, DEFAULTS.allMailsSheetName)
                         || DEFAULTS.allMailsSheetName,
    // Capped harder than the daily counts: this tab is one row per *mail*, not
    // per day per mailbox, so 90 days of it is already thousands of rows being
    // laid down again on every sweep.
    allMailsDays:        Math.min(90, Math.max(1, num(SETTINGS.allMailsDays, DEFAULTS.allMailsDays))),
    allMailsAutoWrite:   bool(SETTINGS.allMailsAutoWrite, DEFAULTS.allMailsAutoWrite),
    highlightReplied:    bool(SETTINGS.highlightReplied,    DEFAULTS.highlightReplied),
    startDate:         str(SETTINGS.startDate,      DEFAULTS.startDate),
    backupEnabled:     bool(SETTINGS.backupEnabled, DEFAULTS.backupEnabled),
    backupSheetUrl:    str(SETTINGS.backupSheetUrl, DEFAULTS.backupSheetUrl),
    lastRunAt:         map.get(SETTINGS.lastRunAt) ?? null,
  }
}

/**
 * Persist a partial config. Changing the sheet URL drops the cached drive/item
 * reference so the next sweep resolves the new workbook.
 */
export async function saveConfig(patch: Partial<Record<keyof QueryMonitorConfig, string | number | boolean>>): Promise<void> {
  const entries: [string, string][] = []
  const put = (key: string, value: unknown) => entries.push([key, String(value)])

  if (patch.enabled           !== undefined) put(SETTINGS.enabled,           !!patch.enabled)
  if (patch.intervalMinutes   !== undefined) put(SETTINGS.intervalMinutes,   Math.max(5, Number(patch.intervalMinutes) || 60))
  if (patch.lookbackHours     !== undefined) put(SETTINGS.lookbackHours,     Math.max(1, Number(patch.lookbackHours) || 3))
  if (patch.autoWrite         !== undefined) put(SETTINGS.autoWrite,         !!patch.autoWrite)
  if (patch.sheetName         !== undefined) put(SETTINGS.sheetName,         String(patch.sheetName).trim())
  if (patch.writeStatusColumn !== undefined) put(SETTINGS.writeStatusColumn, !!patch.writeStatusColumn)
  if (patch.captureUnmatched  !== undefined) put(SETTINGS.captureUnmatched,  !!patch.captureUnmatched)
  if (patch.aiEnabled         !== undefined) put(SETTINGS.aiEnabled,         !!patch.aiEnabled)
  if (patch.aiSummaryEnabled  !== undefined) put(SETTINGS.aiSummaryEnabled,  !!patch.aiSummaryEnabled)
  if (patch.slaHours          !== undefined) put(SETTINGS.slaHours,          Math.max(1, Number(patch.slaHours) || 2))
  if (patch.replyChaseDays    !== undefined) put(SETTINGS.replyChaseDays,    Math.max(1, Number(patch.replyChaseDays) || 7))
  if (patch.threadMergeEnabled !== undefined) put(SETTINGS.threadMergeEnabled, !!patch.threadMergeEnabled)
  if (patch.threadWindowDays   !== undefined) put(SETTINGS.threadWindowDays,   Math.max(1, Number(patch.threadWindowDays) || 30))
  if (patch.excludeEnabled    !== undefined) put(SETTINGS.excludeEnabled,    !!patch.excludeEnabled)
  // Kept verbatim — one pattern per line, and a trailing blank line is harmless.
  if (patch.excludePatterns   !== undefined) put(SETTINGS.excludePatterns,   String(patch.excludePatterns))
  if (patch.excludedSheetName !== undefined) {
    const tab = String(patch.excludedSheetName).trim()
    if (tab) put(SETTINGS.excludedSheetName, tab)
  }
  if (patch.aiUsageSheetName !== undefined) {
    const tab = String(patch.aiUsageSheetName).trim()
    if (tab) put(SETTINGS.aiUsageSheetName, tab)
  }
  if (patch.dailyStatsSheetName !== undefined) {
    const tab = String(patch.dailyStatsSheetName).trim()
    if (tab) put(SETTINGS.dailyStatsSheetName, tab)
  }
  if (patch.dailyStatsDays      !== undefined) put(SETTINGS.dailyStatsDays, Math.min(180, Math.max(1, Number(patch.dailyStatsDays) || 30)))
  if (patch.dailyStatsAutoWrite !== undefined) put(SETTINGS.dailyStatsAutoWrite, !!patch.dailyStatsAutoWrite)
  if (patch.allMailsSheetName !== undefined) {
    const tab = String(patch.allMailsSheetName).trim()
    if (tab) put(SETTINGS.allMailsSheetName, tab)
  }
  if (patch.allMailsDays      !== undefined) put(SETTINGS.allMailsDays, Math.min(90, Math.max(1, Number(patch.allMailsDays) || 30)))
  if (patch.allMailsAutoWrite !== undefined) put(SETTINGS.allMailsAutoWrite, !!patch.allMailsAutoWrite)
  if (patch.highlightReplied    !== undefined) put(SETTINGS.highlightReplied,    !!patch.highlightReplied)

  if (patch.backupEnabled !== undefined) put(SETTINGS.backupEnabled, !!patch.backupEnabled)
  if (patch.startDate     !== undefined) {
    // Blank is legal and means "no cut-off"; anything else must be a real day.
    const day = String(patch.startDate).trim()
    if (day && !/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error('Start date must be YYYY-MM-DD')
    put(SETTINGS.startDate, day)
  }

  // Both workbook URLs drop their cached drive/item reference when they change,
  // so the next write resolves the new file instead of the old one.
  for (const [field, urlKey, refKey] of [
    ['sheetUrl',       SETTINGS.sheetUrl,       SETTINGS.sheetRef],
    ['backupSheetUrl', SETTINGS.backupSheetUrl, SETTINGS.backupSheetRef],
  ] as const) {
    if (patch[field] === undefined) continue
    const url = String(patch[field]).trim()
    const current = await getSetting(urlKey)
    put(urlKey, url)
    if (current && current !== url) {
      await prisma.systemSetting.deleteMany({ where: { key: refKey } })
    }
  }

  for (const [key, value] of entries) await setSetting(key, value)
}

// ── Mailboxes ────────────────────────────────────────────────────────────────

/**
 * Creates the seed mailboxes the first time the feature is opened, and brings
 * the group addresses among them up to date on installs that already have the
 * table. Idempotent.
 *
 * The second half exists for `availcheck@aahaas.com`, which was originally
 * seeded as an inactive USER mailbox with `ErrorInvalidUser` recorded against
 * it — Graph has no mailbox to open, because it is a distribution group. It is
 * switched to ALIAS so its traffic is read off the members' TO/CC lines instead.
 *
 * A group already carrying the ALIAS kind is left completely alone: whether it
 * is active, what it is called and which addresses it answers to are the
 * admin's to change from the UI, and a seed must never take that back.
 */
export async function ensureSeedMailboxes(): Promise<void> {
  const count = await prisma.queryMonitorMailbox.count()

  if (count === 0) {
    await prisma.queryMonitorMailbox.createMany({
      data: SEED_MAILBOXES.map((m, i) => ({
        email:          m.email.toLowerCase(),
        displayName:    m.displayName,
        mailboxKind:    m.kind ?? 'USER',
        aliasAddresses: m.aliasAddresses ?? '',
        isActive:       m.isActive,
        sortOrder:      i,
        lastError:      m.lastError ?? null,
      })),
      skipDuplicates: true,
    })
    return
  }

  for (let i = 0; i < SEED_MAILBOXES.length; i += 1) {
    const seed = SEED_MAILBOXES[i]
    if (seed.kind !== 'ALIAS') continue
    const email = seed.email.toLowerCase()
    const existing = await prisma.queryMonitorMailbox.findUnique({ where: { email } })

    if (!existing) {
      await prisma.queryMonitorMailbox.create({
        data: {
          email, displayName: seed.displayName, mailboxKind: 'ALIAS',
          aliasAddresses: seed.aliasAddresses ?? '', isActive: seed.isActive, sortOrder: i,
        },
      }).catch(() => {})
      continue
    }

    if (existing.mailboxKind === 'ALIAS') continue

    await prisma.queryMonitorMailbox.update({
      where: { id: existing.id },
      data: {
        mailboxKind:    'ALIAS',
        aliasAddresses: existing.aliasAddresses || seed.aliasAddresses || '',
        // It was off only because Graph could not open it. As an alias there is
        // nothing to open, so the reason no longer applies.
        isActive:       true,
        lastError:      null,
      },
    }).catch(() => {})
  }
}

/** Every address a mailbox record answers to, lower-cased. */
export function mailboxAddresses(mailbox: { email: string; aliasAddresses?: string }): string[] {
  return [mailbox.email, ...(mailbox.aliasAddresses ?? '').split(',')]
    .map(a => a.trim().toLowerCase())
    .filter(a => a.includes('@'))
    .filter((a, i, all) => all.indexOf(a) === i)
}

export async function listMailboxes() {
  await ensureSeedMailboxes()
  return prisma.queryMonitorMailbox.findMany({ orderBy: [{ sortOrder: 'asc' }, { email: 'asc' }] })
}

export async function listActiveMailboxes() {
  await ensureSeedMailboxes()
  return prisma.queryMonitorMailbox.findMany({
    where:   { isActive: true },
    orderBy: [{ sortOrder: 'asc' }, { email: 'asc' }],
  })
}

// ── Sender rules ─────────────────────────────────────────────────────────────

export async function ensureSeedSenderRules(): Promise<void> {
  const count = await prisma.queryMonitorSenderRule.count()
  if (count > 0) return

  await prisma.queryMonitorSenderRule.createMany({
    data: SEED_SENDER_RULES.map(r => ({
      pattern:     r.pattern.toLowerCase(),
      matchType:   r.matchType,
      salesPerson: r.salesPerson,
      agent:       r.agent,
      priority:    r.priority ?? 0,
    })),
    skipDuplicates: true,
  })
}

export async function listSenderRules() {
  await ensureSeedSenderRules()
  return prisma.queryMonitorSenderRule.findMany({
    orderBy: [{ priority: 'desc' }, { pattern: 'asc' }],
  })
}
