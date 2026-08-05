/**
 * Auto-report schedules — stored as JSON in `SystemSetting`, not as a table.
 *
 * The live ops database carries schema drift, so every feature that can avoid a
 * migration does (same reasoning as the B2C importer). Schedules are low-volume
 * configuration — a handful of rows read once a minute — and a JSON document in
 * `system_settings` is a better fit than a migration against a production DB
 * with real booking data.
 *
 * Writes go through `mutateSchedules()`, which re-reads immediately before it
 * writes so two admins saving at once cannot clobber each other's rows.
 */
import { randomUUID } from 'crypto'
import { prisma } from '@/lib/prisma'
import { DEFAULT_REPORT_TZ, REPORT_PERIODS, type ReportPeriod } from './report-window'

export const SCHEDULES_KEY = 'auto_report_schedules'
export const RUNS_KEY = 'auto_report_runs'
export const MASTER_SWITCH_KEY = 'auto_report_enabled'

const MAX_RUN_LOG = 60
const MAX_SCHEDULES = 40

export interface ReportSections {
  created: boolean
  onGround: boolean
  /** Arrivals over the next three days with their operational checklist. */
  readiness: boolean
  complaints: boolean
  upcoming: boolean
}

export interface ReportSchedule {
  id: string
  name: string
  enabled: boolean
  period: ReportPeriod
  /** Local send time in `timezone`. */
  hour: number
  minute: number
  timezone: string
  /** WEEKLY only: 0 = Sunday … 6 = Saturday. */
  dayOfWeek: number
  /** MONTHLY only: 1–28, or 0 meaning "last day of the month". */
  dayOfMonth: number
  to: string[]
  cc: string[]
  bcc: string[]
  replyTo: string | null
  subjectPrefix: string | null
  /** Empty = all countries. Accepts `UNASSIGNED` for un-scoped bookings. */
  countries: string[]
  sections: ReportSections
  /** Attach the flat CSV export of every row in the report. */
  attachCsv: boolean
  /** Have GPT write the two-sentence summary at the top. */
  aiSummary: boolean
  /** Skip the send entirely when the window produced no bookings and no complaints. */
  skipIfEmpty: boolean
  maxRows: number
  createdAt: string
  updatedAt: string
  createdBy: string | null
  /** Guard key of the last successful fire — the local date it covered. */
  lastRunKey: string | null
  lastRunAt: string | null
  lastStatus: 'ok' | 'error' | 'skipped' | null
  lastError: string | null
  lastRecipients: number | null
}

export interface ReportRunLog {
  id: string
  scheduleId: string | null
  scheduleName: string
  period: ReportPeriod
  trigger: 'schedule' | 'manual' | 'cron-http' | 'test'
  triggeredBy: string | null
  status: 'ok' | 'error' | 'skipped'
  recipients: number
  windowFrom: string
  windowTo: string
  counts: { created: number; onGround: number; complaints: number; upcoming: number }
  error: string | null
  startedAt: string
  finishedAt: string
  durationMs: number
}

// ─── Validation ───────────────────────────────────────────────────────────────

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function normalizeEmails(input: unknown): string[] {
  const raw = Array.isArray(input)
    ? input
    : String(input ?? '').split(/[,;\n]/)
  const seen = new Set<string>()
  const out: string[] = []
  for (const item of raw) {
    const addr = String(item ?? '').trim().toLowerCase()
    if (!addr || !EMAIL_RE.test(addr) || seen.has(addr)) continue
    seen.add(addr)
    out.push(addr)
  }
  return out.slice(0, 50)
}

function clamp(n: unknown, min: number, max: number, fallback: number): number {
  const v = Number(n)
  if (!Number.isFinite(v)) return fallback
  return Math.min(max, Math.max(min, Math.trunc(v)))
}

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback
}

const VALID_COUNTRIES = new Set([
  'VIETNAM', 'SRILANKA', 'SINGAPORE_MALAYSIA', 'SINGAPORE', 'MALAYSIA', 'UNASSIGNED',
])

export class ScheduleValidationError extends Error {}

/** Build a complete, safe schedule from untrusted request input. */
export function normalizeSchedule(
  input: Record<string, unknown>,
  existing?: ReportSchedule,
  actor?: string | null,
): ReportSchedule {
  const now = new Date().toISOString()

  const period = REPORT_PERIODS.includes(input.period as ReportPeriod)
    ? (input.period as ReportPeriod)
    : existing?.period ?? 'DAILY'

  const to = input.to !== undefined ? normalizeEmails(input.to) : existing?.to ?? []
  if (!to.length) throw new ScheduleValidationError('At least one "To" recipient is required.')

  const name = String(input.name ?? existing?.name ?? '').trim() || `${period[0]}${period.slice(1).toLowerCase()} report`

  const timezone = String(input.timezone ?? existing?.timezone ?? DEFAULT_REPORT_TZ).trim() || DEFAULT_REPORT_TZ
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone })
  } catch {
    throw new ScheduleValidationError(`"${timezone}" is not a valid IANA timezone.`)
  }

  const countriesInput = Array.isArray(input.countries) ? input.countries : existing?.countries ?? []
  const countries = Array.from(new Set(countriesInput.map(c => String(c).toUpperCase()))).filter(c => VALID_COUNTRIES.has(c))

  const sectionsIn = (input.sections ?? {}) as Record<string, unknown>
  const prevSections = existing?.sections
  const sections: ReportSections = {
    created: bool(sectionsIn.created, prevSections?.created ?? true),
    onGround: bool(sectionsIn.onGround, prevSections?.onGround ?? true),
    // Schedules saved before this section existed carry no flag for it; they get
    // it switched on, because a report about today's operations that omits what
    // lands tomorrow is the weaker default.
    readiness: bool(sectionsIn.readiness, prevSections?.readiness ?? true),
    complaints: bool(sectionsIn.complaints, prevSections?.complaints ?? true),
    upcoming: bool(sectionsIn.upcoming, prevSections?.upcoming ?? true),
  }
  if (!Object.values(sections).some(Boolean)) {
    throw new ScheduleValidationError('Select at least one report section.')
  }

  const replyToList = input.replyTo !== undefined ? normalizeEmails(input.replyTo) : null

  return {
    id: existing?.id ?? randomUUID(),
    name: name.slice(0, 80),
    enabled: bool(input.enabled, existing?.enabled ?? true),
    period,
    hour: clamp(input.hour ?? existing?.hour, 0, 23, 8),
    minute: clamp(input.minute ?? existing?.minute, 0, 59, 0),
    timezone,
    dayOfWeek: clamp(input.dayOfWeek ?? existing?.dayOfWeek, 0, 6, 1),
    dayOfMonth: clamp(input.dayOfMonth ?? existing?.dayOfMonth, 0, 28, 1),
    to,
    cc: input.cc !== undefined ? normalizeEmails(input.cc) : existing?.cc ?? [],
    bcc: input.bcc !== undefined ? normalizeEmails(input.bcc) : existing?.bcc ?? [],
    replyTo: replyToList ? replyToList[0] ?? null : existing?.replyTo ?? null,
    subjectPrefix: (String(input.subjectPrefix ?? existing?.subjectPrefix ?? '').trim() || null)?.slice(0, 40) ?? null,
    countries,
    sections,
    attachCsv: bool(input.attachCsv, existing?.attachCsv ?? false),
    aiSummary: bool(input.aiSummary, existing?.aiSummary ?? false),
    skipIfEmpty: bool(input.skipIfEmpty, existing?.skipIfEmpty ?? false),
    maxRows: clamp(input.maxRows ?? existing?.maxRows, 10, 250, 30),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    createdBy: existing?.createdBy ?? actor ?? null,
    lastRunKey: existing?.lastRunKey ?? null,
    lastRunAt: existing?.lastRunAt ?? null,
    lastStatus: existing?.lastStatus ?? null,
    lastError: existing?.lastError ?? null,
    lastRecipients: existing?.lastRecipients ?? null,
  }
}

// ─── Persistence ──────────────────────────────────────────────────────────────

async function readSetting<T>(key: string, fallback: T): Promise<T> {
  const row = await prisma.systemSetting.findUnique({ where: { key } })
  if (!row?.value) return fallback
  try {
    return JSON.parse(row.value) as T
  } catch {
    console.warn(`[Reports] ${key} holds unparseable JSON — falling back to default`)
    return fallback
  }
}

async function writeSetting(key: string, value: unknown): Promise<void> {
  const json = JSON.stringify(value)
  await prisma.systemSetting.upsert({
    where: { key },
    update: { value: json },
    create: { key, value: json },
  })
}

/**
 * Fill in section flags a stored schedule predates.
 *
 * Sections are added over time but the JSON in `system_settings` is whatever was
 * written the last time someone hit save. Defaulting on read keeps one answer to
 * "is this section on?" — without it the renderer would include a new section
 * (absent ≠ false) while the dashboard card, reading the same row, left it off
 * the "Includes:" line.
 */
function withSectionDefaults(s: ReportSchedule): ReportSchedule {
  const sections = (s.sections ?? {}) as Partial<ReportSections>
  return {
    ...s,
    sections: {
      created: sections.created ?? true,
      onGround: sections.onGround ?? true,
      readiness: sections.readiness ?? true,
      complaints: sections.complaints ?? true,
      upcoming: sections.upcoming ?? true,
    },
  }
}

export async function listSchedules(): Promise<ReportSchedule[]> {
  const rows = await readSetting<ReportSchedule[]>(SCHEDULES_KEY, [])
  return Array.isArray(rows) ? rows.map(withSectionDefaults) : []
}

export async function getSchedule(id: string): Promise<ReportSchedule | null> {
  return (await listSchedules()).find(s => s.id === id) ?? null
}

/** Read-modify-write under a fresh read, so concurrent saves merge rather than overwrite. */
async function mutateSchedules(
  fn: (rows: ReportSchedule[]) => ReportSchedule[],
): Promise<ReportSchedule[]> {
  const next = fn(await listSchedules())
  if (next.length > MAX_SCHEDULES) {
    throw new ScheduleValidationError(`A maximum of ${MAX_SCHEDULES} schedules is supported.`)
  }
  await writeSetting(SCHEDULES_KEY, next)
  return next
}

export async function upsertSchedule(
  input: Record<string, unknown>,
  actor?: string | null,
): Promise<ReportSchedule> {
  const id = typeof input.id === 'string' ? input.id : null
  const existing = id ? await getSchedule(id) : null
  if (id && !existing) throw new ScheduleValidationError('Schedule not found.')

  const schedule = normalizeSchedule(input, existing ?? undefined, actor)
  await mutateSchedules(rows =>
    existing ? rows.map(r => (r.id === schedule.id ? schedule : r)) : [...rows, schedule])
  return schedule
}

export async function deleteSchedule(id: string): Promise<boolean> {
  let removed = false
  await mutateSchedules(rows => {
    const next = rows.filter(r => r.id !== id)
    removed = next.length !== rows.length
    return next
  })
  return removed
}

/** Patch only the run-state fields; never touches user-editable configuration. */
export async function recordScheduleRun(
  id: string,
  patch: Pick<ReportSchedule, 'lastRunKey' | 'lastRunAt' | 'lastStatus' | 'lastError' | 'lastRecipients'>,
): Promise<void> {
  await mutateSchedules(rows => rows.map(r => (r.id === id ? { ...r, ...patch } : r)))
}

/**
 * Claim a schedule's slot *before* the report is built.
 *
 * The whole double-send guard rests on this: two workers (the in-process cron
 * and the HTTP cron on a serverless deploy) can tick at the same instant, and
 * report generation takes seconds. Writing `lastRunKey` first means the loser of
 * the race sees the claim and stands down.
 */
export async function claimRunSlot(id: string, runKey: string): Promise<boolean> {
  let claimed = false
  await mutateSchedules(rows => rows.map(r => {
    if (r.id !== id || r.lastRunKey === runKey) return r
    claimed = true
    return { ...r, lastRunKey: runKey, lastRunAt: new Date().toISOString() }
  }))
  return claimed
}

/** Undo a claim when the run could not even start — lets the next tick retry. */
export async function releaseRunSlot(id: string, runKey: string): Promise<void> {
  await mutateSchedules(rows => rows.map(r =>
    r.id === id && r.lastRunKey === runKey ? { ...r, lastRunKey: null } : r))
}

// ─── Run log ──────────────────────────────────────────────────────────────────

export async function listRuns(limit = MAX_RUN_LOG): Promise<ReportRunLog[]> {
  const rows = await readSetting<ReportRunLog[]>(RUNS_KEY, [])
  return (Array.isArray(rows) ? rows : []).slice(0, limit)
}

export async function appendRun(log: ReportRunLog): Promise<void> {
  const rows = await listRuns(MAX_RUN_LOG)
  await writeSetting(RUNS_KEY, [log, ...rows].slice(0, MAX_RUN_LOG))
}

// ─── Master switch ────────────────────────────────────────────────────────────

export async function isAutoReportEnabled(): Promise<boolean> {
  const row = await prisma.systemSetting.findUnique({ where: { key: MASTER_SWITCH_KEY } })
  // Absent = on. A feature nobody has configured has no schedules to fire anyway.
  return row?.value !== 'false'
}

export async function setAutoReportEnabled(enabled: boolean): Promise<void> {
  await prisma.systemSetting.upsert({
    where: { key: MASTER_SWITCH_KEY },
    update: { value: String(enabled) },
    create: { key: MASTER_SWITCH_KEY, value: String(enabled) },
  })
}
