/**
 * The daily auto-send for the AI voice-call report.
 *
 * One schedule, not many: this report has a single shape and ops wants it in
 * their inbox once a day, so the configuration is a single JSON document in
 * `SystemSetting` rather than the list-of-schedules model the ops booking report
 * uses. It borrows that feature's two hard-won pieces — the claim-before-build
 * double-send guard and the Graph mailer — because the same two workers (the
 * in-process minute tick and the HTTP cron) can fire at the same instant.
 */
import { randomUUID } from 'crypto'
import { prisma } from '@/lib/prisma'
import { sendReportMail } from '@/lib/reports/report-mailer'
import {
  clockInTz, dateInTz, DEFAULT_REPORT_TZ, formatClock, shiftDate,
} from '@/lib/reports/report-window'
import { normalizeEmails } from '@/lib/reports/report-schedules'
import {
  collectCallReport, renderCallReportCsv,
  type CallReportData, type CallReportFilters,
} from './call-report-data'
import { renderCallReportHtml, renderCallReportSubject } from './call-report-html'

export const CALL_REPORT_KEY = 'te_call_report_schedule'

/** How late a missed slot may still fire — matches the ops report's grace. */
const CATCHUP_GRACE_MINUTES = Number(process.env.REPORT_CATCHUP_GRACE_MINUTES ?? '720')

const MAX_RUN_LOG = 30

const DASHBOARD_URL = (process.env.NEXTAUTH_URL || '').replace(/\/$/, '')
  ? `${(process.env.NEXTAUTH_URL || '').replace(/\/$/, '')}/dashboard/te/ai-call-report`
  : null

/** Which day the emailed report covers, relative to the morning it is sent. */
export type CallReportCoverage = 'today' | 'yesterday' | 'this_month'

export interface CallReportScheduleConfig {
  enabled: boolean
  hour: number
  minute: number
  timezone: string
  coverage: CallReportCoverage
  to: string[]
  cc: string[]
  bcc: string[]
  replyTo: string | null
  subjectPrefix: string | null
  attachCsv: boolean
  /** Don't send when the window has no assigned calls at all. */
  skipIfEmpty: boolean
  maxRows: number
  updatedAt: string | null
  updatedBy: string | null
  lastRunKey: string | null
  lastRunAt: string | null
  lastStatus: 'ok' | 'error' | 'skipped' | null
  lastError: string | null
  lastRecipients: number | null
}

export interface CallReportRunLog {
  id: string
  trigger: 'schedule' | 'manual' | 'cron-http' | 'test'
  triggeredBy: string | null
  status: 'ok' | 'error' | 'skipped'
  recipients: number
  coverage: CallReportCoverage
  windowFrom: string
  windowTo: string
  assigned: number
  done: number
  pending: number
  urgent: number
  error: string | null
  at: string
  durationMs: number
}

interface StoredDocument {
  config: CallReportScheduleConfig
  runs: CallReportRunLog[]
}

export const DEFAULT_CALL_REPORT_CONFIG: CallReportScheduleConfig = {
  enabled: false,
  hour: 8,
  minute: 30,
  timezone: DEFAULT_REPORT_TZ,
  coverage: 'today',
  to: [],
  cc: [],
  bcc: [],
  replyTo: null,
  subjectPrefix: null,
  attachCsv: true,
  skipIfEmpty: false,
  maxRows: 200,
  updatedAt: null,
  updatedBy: null,
  lastRunKey: null,
  lastRunAt: null,
  lastStatus: null,
  lastError: null,
  lastRecipients: null,
}

export class CallReportConfigError extends Error {}

// ─── Persistence ──────────────────────────────────────────────────────────────

async function readDocument(): Promise<StoredDocument> {
  const row = await prisma.systemSetting.findUnique({ where: { key: CALL_REPORT_KEY } })
  if (!row?.value) return { config: { ...DEFAULT_CALL_REPORT_CONFIG }, runs: [] }
  try {
    const parsed = JSON.parse(row.value) as Partial<StoredDocument>
    return {
      config: { ...DEFAULT_CALL_REPORT_CONFIG, ...(parsed.config ?? {}) },
      runs: Array.isArray(parsed.runs) ? parsed.runs : [],
    }
  } catch {
    console.warn('[CallReport] schedule holds unparseable JSON — falling back to defaults')
    return { config: { ...DEFAULT_CALL_REPORT_CONFIG }, runs: [] }
  }
}

async function writeDocument(doc: StoredDocument): Promise<void> {
  const json = JSON.stringify({ config: doc.config, runs: doc.runs.slice(0, MAX_RUN_LOG) })
  await prisma.systemSetting.upsert({
    where: { key: CALL_REPORT_KEY },
    update: { value: json },
    create: { key: CALL_REPORT_KEY, value: json },
  })
}

/** Re-read immediately before writing, so a concurrent save is not clobbered. */
async function mutate(fn: (doc: StoredDocument) => StoredDocument): Promise<StoredDocument> {
  const next = fn(await readDocument())
  await writeDocument(next)
  return next
}

export async function getCallReportSchedule(): Promise<CallReportScheduleConfig> {
  return (await readDocument()).config
}

export async function listCallReportRuns(): Promise<CallReportRunLog[]> {
  return (await readDocument()).runs
}

function clamp(n: unknown, min: number, max: number, fallback: number): number {
  const v = Number(n)
  if (!Number.isFinite(v)) return fallback
  return Math.min(max, Math.max(min, Math.trunc(v)))
}

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback
}

export async function saveCallReportSchedule(
  input: Record<string, unknown>,
  actor?: string | null,
): Promise<CallReportScheduleConfig> {
  const current = await getCallReportSchedule()

  const timezone = String(input.timezone ?? current.timezone).trim() || DEFAULT_REPORT_TZ
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone })
  } catch {
    throw new CallReportConfigError(`"${timezone}" is not a valid IANA timezone.`)
  }

  const to = input.to !== undefined ? normalizeEmails(input.to) : current.to
  const enabled = bool(input.enabled, current.enabled)
  if (enabled && !to.length) {
    throw new CallReportConfigError('Add at least one "To" recipient before turning the daily email on.')
  }

  const coverage = ['today', 'yesterday', 'this_month'].includes(String(input.coverage))
    ? (input.coverage as CallReportCoverage)
    : current.coverage

  const replyToList = input.replyTo !== undefined ? normalizeEmails(input.replyTo) : null

  const config: CallReportScheduleConfig = {
    ...current,
    enabled,
    hour: clamp(input.hour ?? current.hour, 0, 23, 8),
    minute: clamp(input.minute ?? current.minute, 0, 59, 30),
    timezone,
    coverage,
    to,
    cc: input.cc !== undefined ? normalizeEmails(input.cc) : current.cc,
    bcc: input.bcc !== undefined ? normalizeEmails(input.bcc) : current.bcc,
    replyTo: replyToList ? replyToList[0] ?? null : current.replyTo,
    subjectPrefix: (String(input.subjectPrefix ?? current.subjectPrefix ?? '').trim() || null)?.slice(0, 40) ?? null,
    attachCsv: bool(input.attachCsv, current.attachCsv),
    skipIfEmpty: bool(input.skipIfEmpty, current.skipIfEmpty),
    maxRows: clamp(input.maxRows ?? current.maxRows, 20, 500, 200),
    updatedAt: new Date().toISOString(),
    updatedBy: actor ?? current.updatedBy,
  }

  await mutate(doc => ({ ...doc, config }))
  return config
}

// ─── Due-time evaluation ──────────────────────────────────────────────────────

export interface CallReportDueCheck {
  due: boolean
  runKey: string
  reason: string
}

export function checkCallReportDue(c: CallReportScheduleConfig, now: Date = new Date()): CallReportDueCheck {
  const today = dateInTz(now, c.timezone)
  if (!c.enabled) return { due: false, runKey: today, reason: 'daily email is off' }
  if (!c.to.length) return { due: false, runKey: today, reason: 'no recipients' }

  const { hour, minute } = clockInTz(now, c.timezone)
  const minutesLate = (hour * 60 + minute) - (c.hour * 60 + c.minute)

  if (minutesLate < 0) return { due: false, runKey: today, reason: `sends at ${formatClock(c.hour, c.minute)}` }
  if (c.lastRunKey === today) return { due: false, runKey: today, reason: 'already sent today' }
  if (minutesLate > CATCHUP_GRACE_MINUTES) return { due: false, runKey: today, reason: 'missed slot — too late to catch up' }
  return { due: true, runKey: today, reason: 'due' }
}

export function nextCallReportRunAt(c: CallReportScheduleConfig, now: Date = new Date()): string | null {
  if (!c.enabled) return null
  const today = dateInTz(now, c.timezone)
  const { hour, minute } = clockInTz(now, c.timezone)
  const past = hour * 60 + minute >= c.hour * 60 + c.minute
  const date = past || c.lastRunKey === today ? shiftDate(today, 1) : today
  return `${date}T${formatClock(c.hour, c.minute)}:00`
}

/** Claim the slot before building anything — the loser of a race stands down. */
async function claimSlot(runKey: string): Promise<boolean> {
  let claimed = false
  await mutate(doc => {
    if (doc.config.lastRunKey === runKey) return doc
    claimed = true
    return { ...doc, config: { ...doc.config, lastRunKey: runKey, lastRunAt: new Date().toISOString() } }
  })
  return claimed
}

async function releaseSlot(runKey: string): Promise<void> {
  await mutate(doc => doc.config.lastRunKey === runKey
    ? { ...doc, config: { ...doc.config, lastRunKey: null } }
    : doc)
}

// ─── Building & sending ───────────────────────────────────────────────────────

/** The filters a coverage setting turns into on the day it fires. */
export function coverageFilters(c: CallReportScheduleConfig, now: Date = new Date()): CallReportFilters {
  const today = dateInTz(now, c.timezone)
  if (c.coverage === 'this_month') return { scope: 'month', month: today.slice(0, 7), timezone: c.timezone }
  if (c.coverage === 'yesterday') return { scope: 'day', date: shiftDate(today, -1), timezone: c.timezone }
  return { scope: 'day', date: today, timezone: c.timezone }
}

export const COVERAGE_LABEL: Record<CallReportCoverage, string> = {
  today: "Today's assigned calls",
  yesterday: "Yesterday's calls and results",
  this_month: 'This month to date',
}

export interface BuiltCallReport {
  data: CallReportData
  subject: string
  html: string
  csv: string
}

export async function buildCallReportEmail(
  c: CallReportScheduleConfig,
  opts: { now?: Date; testSend?: boolean } = {},
): Promise<BuiltCallReport> {
  const now = opts.now ?? new Date()
  const data = await collectCallReport(coverageFilters(c, now), { now })
  return {
    data,
    subject: renderCallReportSubject(data, c.subjectPrefix, opts.testSend),
    html: renderCallReportHtml(data, {
      dashboardUrl: DASHBOARD_URL,
      testSend: opts.testSend,
      maxRows: c.maxRows,
    }),
    csv: renderCallReportCsv(data),
  }
}

export interface CallReportRunResult {
  status: 'ok' | 'error' | 'skipped'
  reason?: string
  recipients: number
  subject?: string
  error?: string
  data?: CallReportData
}

export interface RunCallReportOptions {
  trigger: CallReportRunLog['trigger']
  triggeredBy?: string | null
  now?: Date
  /** Bypass the once-a-day guard — used by "Send now". */
  force?: boolean
  /** Send to these addresses instead of the configured list (test sends). */
  overrideTo?: string[]
  testSend?: boolean
}

async function appendRun(log: CallReportRunLog): Promise<void> {
  await mutate(doc => ({ ...doc, runs: [log, ...doc.runs].slice(0, MAX_RUN_LOG) }))
}

async function recordRunState(patch: Partial<CallReportScheduleConfig>): Promise<void> {
  await mutate(doc => ({ ...doc, config: { ...doc.config, ...patch } }))
}

export async function runCallReport(opts: RunCallReportOptions): Promise<CallReportRunResult> {
  const startedAt = Date.now()
  const config = await getCallReportSchedule()
  const now = opts.now ?? new Date()
  const runKey = dateInTz(now, config.timezone)

  const recipients = opts.overrideTo?.length ? opts.overrideTo : config.to
  if (!recipients.length) {
    return { status: 'skipped', reason: 'no recipients configured', recipients: 0 }
  }

  const finish = async (
    result: CallReportRunResult,
    data?: CallReportData,
  ): Promise<CallReportRunResult> => {
    await appendRun({
      id: randomUUID(),
      trigger: opts.trigger,
      triggeredBy: opts.triggeredBy ?? null,
      status: result.status,
      recipients: result.recipients,
      coverage: config.coverage,
      windowFrom: data?.window.fromDate ?? runKey,
      windowTo: data?.window.toDate ?? runKey,
      assigned: data?.totals.calls.assigned ?? 0,
      done: data?.totals.calls.done ?? 0,
      pending: data?.totals.calls.pending ?? 0,
      urgent: data?.totals.urgentBookings ?? 0,
      error: result.error ?? result.reason ?? null,
      at: new Date().toISOString(),
      durationMs: Date.now() - startedAt,
    }).catch(err => console.warn('[CallReport] run log write failed:', err))
    return result
  }

  if (!opts.force && !(await claimSlot(runKey))) {
    return finish({ status: 'skipped', reason: 'already sent for this slot', recipients: 0 })
  }

  try {
    const built = await buildCallReportEmail(config, { now, testSend: opts.testSend })

    if (config.skipIfEmpty && !opts.force && built.data.totals.calls.assigned === 0) {
      await recordRunState({
        lastRunKey: runKey, lastRunAt: new Date().toISOString(),
        lastStatus: 'skipped', lastError: null, lastRecipients: 0,
      })
      return finish({ status: 'skipped', reason: 'no calls in the window', recipients: 0, data: built.data }, built.data)
    }

    const sent = await sendReportMail({
      to: recipients,
      cc: opts.overrideTo?.length ? [] : config.cc,
      bcc: opts.overrideTo?.length ? [] : config.bcc,
      replyTo: config.replyTo,
      subject: built.subject,
      html: built.html,
      attachments: config.attachCsv
        ? [{
            name: `ai-call-report-${built.data.window.fromDate}${built.data.window.toDate !== built.data.window.fromDate ? `-to-${built.data.window.toDate}` : ''}.csv`,
            contentType: 'text/csv',
            content: built.csv,
          }]
        : [],
    })

    await recordRunState({
      // A forced test must not consume the real slot for the day.
      lastRunKey: opts.force && opts.testSend ? config.lastRunKey : runKey,
      lastRunAt: new Date().toISOString(),
      lastStatus: 'ok',
      lastError: null,
      lastRecipients: sent.recipients,
    })

    console.log(`[CallReport] sent to ${sent.recipients} recipient(s) — ${built.data.totals.calls.assigned} assigned, ${built.data.totals.calls.pending} pending`)
    return finish(
      { status: 'ok', recipients: sent.recipients, subject: built.subject, data: built.data },
      built.data,
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[CallReport] run failed:', message)

    // Hand the slot back so the next tick retries a transient failure.
    if (!opts.force) await releaseSlot(runKey).catch(() => {})
    await recordRunState({
      lastRunAt: new Date().toISOString(),
      lastStatus: 'error',
      lastError: message.slice(0, 500),
      lastRecipients: 0,
    }).catch(() => {})

    return finish({ status: 'error', error: message, recipients: 0 })
  }
}

/** Called by both the minute tick and the HTTP cron. */
export async function runDueCallReport(now: Date = new Date()): Promise<CallReportRunResult | null> {
  const config = await getCallReportSchedule()
  if (!checkCallReportDue(config, now).due) return null
  return runCallReport({ trigger: 'schedule', now })
}
