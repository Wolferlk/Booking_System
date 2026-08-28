/**
 * Building, sending and logging one auto-report.
 *
 * `runSchedule()` is the only path that sends mail — the in-process scheduler,
 * the HTTP cron route and the dashboard's "Send now" button all funnel through
 * it, so there is exactly one place where the double-send guard, the run log and
 * the error handling live.
 */
import { randomUUID } from 'crypto'
import openai, { logAiUsage } from '@/lib/openai'
import { collectReportData, type ReportData } from './report-data'
import { renderReportCsv, renderReportEmail, renderReportSubject } from './report-html'
import { collectReconcileData, type ReconcileReportData } from './reconcile-report-data'
import {
  renderReconcileCsv, renderReconcileEmail, renderReconcileSubject,
} from './reconcile-report-html'
import { sendReportMail } from './report-mailer'
import {
  appendRun, claimRunSlot, isAutoReportEnabled, listSchedules, recordScheduleRun,
  releaseRunSlot, type ReportRunLog, type ReportSchedule,
} from './report-schedules'
import {
  clockInTz, dateInTz, dayOfMonth, dayOfWeek, daysInMonth, formatClock,
  PERIOD_LABEL, shiftDate,
} from './report-window'

/**
 * How late a missed slot may still fire. Long enough to survive a deploy or a
 * cold serverless morning; short enough that a week-old outage doesn't dump a
 * stale report into everyone's inbox on recovery.
 */
const CATCHUP_GRACE_MINUTES = Number(process.env.REPORT_CATCHUP_GRACE_MINUTES ?? '720')

const DASHBOARD_URL = (process.env.NEXTAUTH_URL || '').replace(/\/$/, '')
  ? `${(process.env.NEXTAUTH_URL || '').replace(/\/$/, '')}/dashboard/reports`
  : null

export type RunTrigger = ReportRunLog['trigger']

export interface RunOutcome {
  scheduleId: string
  scheduleName: string
  status: 'ok' | 'error' | 'skipped'
  reason?: string
  recipients: number
  subject?: string
  counts: ReportRunLog['counts']
  error?: string
}

// ─── Due-time evaluation ──────────────────────────────────────────────────────

export interface DueCheck {
  due: boolean
  /** Local date that identifies this firing — also the double-send guard key. */
  runKey: string
  reason: string
  /** Minutes since the slot opened; negative means it has not opened yet. */
  minutesLate: number
}

/** Does `date` (yyyy-mm-dd, local) fall on the schedule's chosen day? */
function isScheduledDay(s: ReportSchedule, date: string): boolean {
  if (s.period === 'DAILY') return true
  if (s.period === 'WEEKLY') return dayOfWeek(date) === s.dayOfWeek
  // dayOfMonth 0 is the sentinel for "last day", so short months still get a report.
  const target = s.dayOfMonth === 0 ? daysInMonth(date) : s.dayOfMonth
  return dayOfMonth(date) === target
}

export function checkDue(s: ReportSchedule, now: Date = new Date()): DueCheck {
  const today = dateInTz(now, s.timezone)
  const { hour, minute } = clockInTz(now, s.timezone)
  const nowMinutes = hour * 60 + minute
  const slotMinutes = s.hour * 60 + s.minute

  if (!s.enabled) return { due: false, runKey: today, reason: 'disabled', minutesLate: 0 }
  if (!isScheduledDay(s, today)) return { due: false, runKey: today, reason: 'not a scheduled day', minutesLate: 0 }

  const minutesLate = nowMinutes - slotMinutes
  if (minutesLate < 0) {
    return { due: false, runKey: today, reason: `sends at ${formatClock(s.hour, s.minute)}`, minutesLate }
  }
  if (s.lastRunKey === today) {
    return { due: false, runKey: today, reason: 'already sent today', minutesLate }
  }
  if (minutesLate > CATCHUP_GRACE_MINUTES) {
    return { due: false, runKey: today, reason: 'missed slot — too late to catch up', minutesLate }
  }
  return { due: true, runKey: today, reason: 'due', minutesLate }
}

/** Next firing as an ISO instant, for the UI countdown. */
export function nextRunAt(s: ReportSchedule, now: Date = new Date()): string | null {
  if (!s.enabled) return null
  const { hour, minute } = clockInTz(now, s.timezone)
  const today = dateInTz(now, s.timezone)
  const past = hour * 60 + minute >= s.hour * 60 + s.minute

  for (let i = 0; i <= 400; i++) {
    const date = shiftDate(today, i)
    if (!isScheduledDay(s, date)) continue
    if (i === 0 && (past || s.lastRunKey === today)) continue
    return `${date}T${formatClock(s.hour, s.minute)}:00`
  }
  return null
}

export function describeCadence(s: ReportSchedule): string {
  const at = `${formatClock(s.hour, s.minute)} ${s.timezone}`
  if (s.period === 'DAILY') return `Every day at ${at}`
  if (s.period === 'WEEKLY') {
    const day = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][s.dayOfWeek] ?? 'Monday'
    return `Every ${day} at ${at}`
  }
  const dom = s.dayOfMonth === 0 ? 'the last day' : `day ${s.dayOfMonth}`
  return `Monthly on ${dom} at ${at}`
}

// ─── AI narrative ─────────────────────────────────────────────────────────────

/**
 * Three sentences of plain-English context above the numbers. Best-effort: the
 * report is the deliverable, so any AI failure is logged and dropped rather than
 * allowed to block the send.
 */
async function buildNarrative(d: ReportData): Promise<string | null> {
  if (!process.env.OPENAI_API_KEY) return null

  const facts = {
    period: PERIOD_LABEL[d.window.period],
    range: `${d.window.fromDate} to ${d.window.toDate}`,
    created: { total: d.created.total, previous: d.created.previousTotal, b2b: d.created.channel.b2b, b2c: d.created.channel.b2c, byCountry: d.created.byCountry.map(c => ({ c: c.label, n: c.bookings })) },
    onGround: { total: d.onGround.total, pax: d.onGround.pax, byCountry: d.onGround.byCountry.map(c => ({ c: c.label, n: c.bookings })) },
    // The integration's own health. Given to the model because a day where the
    // two systems disagree is the day the narrative should lead with it.
    appleSystemParity: {
      confirmedUpstream: d.parity.upstreamConfirmed,
      createdInSystem: d.parity.systemHeld,
      missing: d.parity.missing,
      autoImported: d.parity.createdByAutomation,
      autoRefreshed: d.parity.refreshed,
      autoCancelled: d.parity.cancelled,
      flaggedForReview: d.parity.flagged,
    },
    arrivingNext3Days: {
      total: d.readiness.total,
      tomorrow: d.readiness.tomorrow,
      notReady: d.readiness.notReady,
      tomorrowNotReady: d.readiness.tomorrowNotReady,
      pending: {
        clientConfirmation: d.readiness.pendingClient,
        driverAllocation: d.readiness.pendingDriver,
        tickets: d.readiness.pendingTickets,
        qc: d.readiness.pendingQc,
      },
    },
    // The D-10 breach counts, with the top reasons. Given to the model so the
    // narrative can say *why* a week is going wrong, not only that it is.
    guestReconfirmation: {
      travellingWithin10Days: d.reconfirm.total,
      pastDeadline: d.reconfirm.breached,
      withRecordedReason: d.reconfirm.explained,
      noReasonRecorded: d.reconfirm.unexplained,
      topReasons: d.reconfirm.byReason.slice(0, 3).map(r => ({ reason: r.label, n: r.count })),
    },
    complaints: { total: d.complaints.total, open: d.complaints.open, resolved: d.complaints.resolved, highOpen: d.complaints.highSeverityOpen, topCategories: d.complaints.byCategory.slice(0, 3) },
    upcoming: { total: d.upcoming.total, next7: d.upcoming.next7, next30: d.upcoming.next30 },
  }

  try {
    const res = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.2,
      max_tokens: 220,
      messages: [
        {
          role: 'system',
          content: 'You write the opening summary of a travel operations report for senior managers. '
            + 'Exactly three sentences, plain English, no markdown, no bullet points, no greeting. '
            + 'Sentence 1: booking intake and how it compares with the previous period. '
            + 'Sentence 2: what is happening on the ground and what arrives in the next three days. '
            + 'Sentence 3: the single thing that needs attention today — prefer an unready arrival '
            + '(missing client confirmation, driver, tickets or QC) over anything else, or state that nothing is outstanding. '
            + 'Only use the numbers given. Never invent a figure.',
        },
        { role: 'user', content: JSON.stringify(facts) },
      ],
    })

    await logAiUsage({ callType: 'report_narrative', model: 'gpt-4o-mini', usage: res.usage, source: 'report' })
    return res.choices[0]?.message?.content?.trim() || null
  } catch (err) {
    console.warn('[Reports] narrative failed:', err instanceof Error ? err.message : err)
    return null
  }
}

/**
 * Why the systems disagree, in plain English.
 *
 * The model is given *only* the counts and the causes `deriveFindings()` already
 * proved from the rows — never the raw data — and is asked to explain, not to
 * investigate. That boundary is the point: an explanation that invents a cause
 * is worse than no explanation, because somebody will act on it. The findings
 * themselves are rendered whether or not this succeeds, so a failure here costs
 * the prose and nothing else.
 */
async function buildReconcileNarrative(d: ReconcileReportData): Promise<string | null> {
  if (!process.env.OPENAI_API_KEY) return null

  const facts = {
    period: PERIOD_LABEL[d.window.period],
    range: `${d.window.fromDate} to ${d.window.toDate}`,
    balanced: d.balanced,
    b2b: {
      appleSystem: {
        confirmed: d.b2b.as.confirmed,
        notConfirmed: d.b2b.as.unconfirmed,
        otherStatuses: d.b2b.as.other,
        confirmationsWithNoIsNumber: d.b2b.as.unnumbered,
        reachable: d.b2b.as.available,
      },
      bookingSystem: {
        createdInWindow: d.b2b.ops.created,
        holdsConfirmations: d.b2b.ops.held,
        missingConfirmations: d.b2b.ops.missing.length,
        cancelledInWindow: d.b2b.ops.cancelled,
      },
      accounts: {
        reachable: d.b2b.accounts.available,
        confirmationsWithPnl: d.b2b.accounts.withPnl,
        confirmationsWithInvoice: d.b2b.accounts.withInvoice,
        producedInWindow: {
          pnlBookingsByOrigin: d.b2b.accounts.output.pnls.bookingsByOrigin,
          invoiceBookingsByOrigin: d.b2b.accounts.output.invoices.bookingsByOrigin,
        },
      },
      verdict: d.b2b.check.verdict,
    },
    b2c: d.b2c.available
      ? {
          orders: d.b2c.orders,
          filedInOps: d.b2c.opsHeld,
          withPnl: d.b2c.withPnl,
          invoiced: d.b2c.withInvoice,
          verdict: d.b2c.check.verdict,
        }
      : { unavailable: d.b2c.error },
    provenCauses: d.findings.map(f => ({ severity: f.severity, cause: f.title, explanation: f.detail })),
  }

  try {
    const res = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.1,
      max_tokens: 320,
      messages: [
        {
          role: 'system',
          content: 'You explain a daily reconciliation between four systems — the Apple System (upstream '
            + 'confirmations), the booking system, the accounts system (P&Ls and invoices) and the Aahaas B2C '
            + 'storefront — to senior managers. Three to five sentences, plain English, no markdown, no bullet '
            + 'points, no greeting. If everything balances, say so in one sentence and stop. Otherwise: state '
            + 'which count is short and by how much, then explain why using ONLY the causes listed in '
            + '"provenCauses", then say what should be done first. Never invent a cause, a number or a booking '
            + 'reference that is not in the data you are given. If the data does not explain the gap, say '
            + 'plainly that the cause is not evident from the counts and that the named bookings need checking '
            + 'by hand.',
        },
        { role: 'user', content: JSON.stringify(facts) },
      ],
    })

    await logAiUsage({ callType: 'reconcile_narrative', model: 'gpt-4o-mini', usage: res.usage, source: 'report' })
    return res.choices[0]?.message?.content?.trim() || null
  } catch (err) {
    console.warn('[Reports] reconciliation explanation failed:', err instanceof Error ? err.message : err)
    return null
  }
}

// ─── Building ─────────────────────────────────────────────────────────────────

/**
 * A rendered report, in the three forms the send path needs, plus the two
 * verdicts about it the runner acts on.
 *
 * `counts`, `isEmpty` and `window` are computed here rather than in
 * `runSchedule()` on purpose: they are the only things the send path needs to
 * know about a report's *content*, and putting them on the result is what lets
 * one send path serve two entirely different report shapes.
 */
export interface BuiltReport {
  data: ReportData | ReconcileReportData
  subject: string
  html: string
  csv: string
  /** Local date range the report covers — names the CSV and the run log. */
  window: { fromDate: string; toDate: string }
  counts: ReportRunLog['counts']
  /** True when the window holds nothing worth anyone's inbox. */
  isEmpty: boolean
  /** Basename for the CSV attachment, without the extension. */
  csvName: string
}

type BuildShape = Pick<
  ReportSchedule,
  'name' | 'reportType' | 'period' | 'timezone' | 'countries' | 'sections' | 'subjectPrefix' | 'aiSummary' | 'maxRows'
>

export async function buildReport(
  s: BuildShape,
  opts: { now?: Date; testSend?: boolean; anchorDate?: string | null } = {},
): Promise<BuiltReport> {
  return s.reportType === 'RECONCILIATION'
    ? buildReconciliation(s, opts)
    : buildOpsReport(s, opts)
}

async function buildOpsReport(
  s: BuildShape,
  opts: { now?: Date; testSend?: boolean; anchorDate?: string | null },
): Promise<BuiltReport> {
  const data = await collectReportData({
    period: s.period,
    timezone: s.timezone,
    countries: s.countries,
    now: opts.now,
    anchorDate: opts.anchorDate,
    maxRows: s.maxRows,
  })

  const narrative = s.aiSummary ? await buildNarrative(data) : null

  return {
    data,
    subject: renderReportSubject(data, { prefix: s.subjectPrefix ?? undefined, testSend: opts.testSend }),
    html: renderReportEmail(data, {
      sections: s.sections,
      narrative,
      dashboardUrl: DASHBOARD_URL,
      scheduleName: s.name,
      testSend: opts.testSend,
    }),
    csv: renderReportCsv(data),
    window: { fromDate: data.window.fromDate, toDate: data.window.toDate },
    counts: {
      created: data.created.total,
      onGround: data.onGround.total,
      complaints: data.complaints.total,
      upcoming: data.upcoming.total,
    },
    isEmpty: isEmptyOpsReport(data),
    csvName: 'ops-report',
  }
}

async function buildReconciliation(
  s: BuildShape,
  opts: { now?: Date; testSend?: boolean; anchorDate?: string | null },
): Promise<BuiltReport> {
  const data = await collectReconcileData({
    period: s.period,
    timezone: s.timezone,
    now: opts.now,
    anchorDate: opts.anchorDate,
    maxRows: s.maxRows,
  })

  // Asked for only when there is something to explain — a balanced day needs no
  // paragraph, and paying for one on every quiet morning is waste.
  if (s.aiSummary && !data.balanced) {
    data.narrative = await buildReconcileNarrative(data)
  }

  return {
    data,
    subject: renderReconcileSubject(data, { prefix: s.subjectPrefix ?? undefined, testSend: opts.testSend }),
    html: renderReconcileEmail(data, {
      sections: s.sections,
      dashboardUrl: DASHBOARD_URL,
      scheduleName: s.name,
      testSend: opts.testSend,
    }, s.maxRows),
    csv: renderReconcileCsv(data),
    window: { fromDate: data.window.fromDate, toDate: data.window.toDate },
    // Mapped onto the shared run-log shape: `created` carries the upstream
    // confirmation count and `complaints` the number of proven causes, which is
    // what makes a run row readable at a glance in the history list.
    counts: {
      created: data.b2b.as.confirmed,
      onGround: data.b2c.orders,
      complaints: data.findings.length,
      upcoming: data.b2b.check.pnlShort + data.b2b.check.invoiceShort + data.b2b.check.opsShort,
    },
    isEmpty: isEmptyReconciliation(data),
    csvName: 'reconciliation',
  }
}

/** True when the window holds nothing worth anyone's inbox. */
function isEmptyOpsReport(d: ReportData): boolean {
  // A parity gap is never "empty". On a genuinely quiet day the AppleSystem
  // integration losing a confirmation is the *only* thing that happened, and
  // suppressing the mail would hide precisely the failure it was added to catch.
  if (d.parity.available && !d.parity.inParity) return false
  if (d.parity.cancelled > 0 || d.parity.flagged > 0) return false

  // Imminent arrivals count as content even on a dead day — an unallocated
  // driver for a tour landing tomorrow is exactly the mail nobody should miss.
  return d.created.total === 0 && d.complaints.total === 0
    && d.onGround.total === 0 && d.readiness.total === 0
}

/**
 * A reconciliation is empty only when there was genuinely nothing to reconcile
 * *and* the check could be completed.
 *
 * An unbalanced day is never empty — that is the mail. Neither is a day a
 * system could not be read on: "we could not check" has to reach somebody,
 * because the alternative is silence that looks exactly like success.
 */
function isEmptyReconciliation(d: ReconcileReportData): boolean {
  if (!d.balanced) return false
  if (d.b2b.check.unchecked || d.b2c.check.unchecked) return false
  if (d.findings.length > 0) return false
  return d.b2b.as.total === 0 && d.b2c.orders === 0 && d.b2b.ops.created === 0
}

// ─── Running ──────────────────────────────────────────────────────────────────

export interface RunScheduleOptions {
  trigger: RunTrigger
  triggeredBy?: string | null
  now?: Date
  /** Bypass the once-per-slot guard — used by "Send now". */
  force?: boolean
  /** Override the recipient list, e.g. to send a test to just yourself. */
  overrideTo?: string[]
  testSend?: boolean
}

export async function runSchedule(s: ReportSchedule, opts: RunScheduleOptions): Promise<RunOutcome> {
  const startedAt = new Date()
  const now = opts.now ?? startedAt
  const runKey = dateInTz(now, s.timezone)
  const emptyCounts = { created: 0, onGround: 0, complaints: 0, upcoming: 0 }

  // Filled in once the report is built; a run that fails before that logs the
  // slot date instead, which is still enough to line the entry up with a schedule.
  let covered: { from: string; to: string } | null = null

  const finish = async (
    status: RunOutcome['status'],
    extra: Partial<RunOutcome> & { counts?: ReportRunLog['counts'] } = {},
  ): Promise<RunOutcome> => {
    const finishedAt = new Date()
    const outcome: RunOutcome = {
      scheduleId: s.id,
      scheduleName: s.name,
      status,
      recipients: extra.recipients ?? 0,
      counts: extra.counts ?? emptyCounts,
      ...(extra.reason ? { reason: extra.reason } : {}),
      ...(extra.subject ? { subject: extra.subject } : {}),
      ...(extra.error ? { error: extra.error } : {}),
    }

    await appendRun({
      id: randomUUID(),
      scheduleId: s.id,
      scheduleName: s.name,
      reportType: s.reportType,
      period: s.period,
      trigger: opts.trigger,
      triggeredBy: opts.triggeredBy ?? null,
      status,
      recipients: outcome.recipients,
      windowFrom: covered?.from ?? runKey,
      windowTo: covered?.to ?? runKey,
      counts: outcome.counts,
      error: outcome.error ?? extra.reason ?? null,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs: finishedAt.getTime() - startedAt.getTime(),
    }).catch(err => console.warn('[Reports] run log write failed:', err))

    return outcome
  }

  // Claim the slot before doing any work — see claimRunSlot().
  if (!opts.force) {
    if (!(await claimRunSlot(s.id, runKey))) {
      return finish('skipped', { reason: 'already sent for this slot' })
    }
  }

  try {
    const built = await buildReport(s, { now, testSend: opts.testSend })
    covered = { from: built.window.fromDate, to: built.window.toDate }

    const counts = built.counts

    if (s.skipIfEmpty && !opts.force && built.isEmpty) {
      await recordScheduleRun(s.id, {
        lastRunKey: runKey,
        lastRunAt: new Date().toISOString(),
        lastStatus: 'skipped',
        lastError: null,
        lastRecipients: 0,
      })
      return finish('skipped', { reason: 'nothing to report', counts })
    }

    const sent = await sendReportMail({
      to: opts.overrideTo?.length ? opts.overrideTo : s.to,
      cc: opts.overrideTo?.length ? [] : s.cc,
      bcc: opts.overrideTo?.length ? [] : s.bcc,
      replyTo: s.replyTo,
      subject: built.subject,
      html: built.html,
      attachments: s.attachCsv
        ? [{
            name: `${built.csvName}-${built.window.fromDate}-to-${built.window.toDate}.csv`,
            contentType: 'text/csv',
            content: built.csv,
          }]
        : [],
    })

    await recordScheduleRun(s.id, {
      lastRunKey: opts.force && opts.testSend ? s.lastRunKey : runKey,
      lastRunAt: new Date().toISOString(),
      lastStatus: 'ok',
      lastError: null,
      lastRecipients: sent.recipients,
    })

    console.log(`[Reports] "${s.name}" (${s.reportType} ${s.period}) sent to ${sent.recipients} recipient(s) — ${JSON.stringify(counts)}`)
    return finish('ok', { recipients: sent.recipients, subject: built.subject, counts })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[Reports] "${s.name}" failed:`, message)

    // Hand the slot back so the next tick retries a transient Graph/DB failure.
    if (!opts.force) await releaseRunSlot(s.id, runKey).catch(() => {})

    await recordScheduleRun(s.id, {
      lastRunKey: s.lastRunKey,
      lastRunAt: new Date().toISOString(),
      lastStatus: 'error',
      lastError: message.slice(0, 500),
      lastRecipients: 0,
    }).catch(() => {})

    return finish('error', { error: message })
  }
}

export interface SweepResult {
  checked: number
  fired: RunOutcome[]
  masterSwitchOff?: boolean
}

/** Evaluate every schedule and run the ones whose slot has opened. */
export async function runDueSchedules(now: Date = new Date()): Promise<SweepResult> {
  if (!(await isAutoReportEnabled())) {
    return { checked: 0, fired: [], masterSwitchOff: true }
  }

  const schedules = await listSchedules()
  const fired: RunOutcome[] = []

  // Sequential on purpose: schedules share one JSON document, and parallel
  // read-modify-write on it would lose run-state updates.
  for (const s of schedules) {
    if (!checkDue(s, now).due) continue
    fired.push(await runSchedule(s, { trigger: 'schedule', now }))
  }

  return { checked: schedules.length, fired }
}
