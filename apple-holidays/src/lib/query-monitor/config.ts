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

/** Creates the seed mailboxes the first time the feature is opened. Idempotent. */
export async function ensureSeedMailboxes(): Promise<void> {
  const count = await prisma.queryMonitorMailbox.count()
  if (count > 0) return

  await prisma.queryMonitorMailbox.createMany({
    data: SEED_MAILBOXES.map((m, i) => ({
      email:       m.email.toLowerCase(),
      displayName: m.displayName,
      isActive:    m.isActive,
      sortOrder:   i,
      lastError:   m.lastError ?? null,
    })),
    skipDuplicates: true,
  })
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
