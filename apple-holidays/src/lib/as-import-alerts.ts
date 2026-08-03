/**
 * Failure alerting for the AppleSystem confirmations importer.
 *
 * When an import run dies — the classic case being the upstream stalling until
 * every rung of the retry ladder in `applesystem.ts` is spent — the failure used
 * to live only inside the run-history card on /dashboard/new-as-booking, where
 * nobody saw it until someone happened to open that tab. A whole day of
 * confirmations could quietly go un-imported.
 *
 * This module makes a failed run impossible to miss:
 *   1. it records the failure in `system_settings` (KV, key `as_import_alerts`),
 *      which the dashboard surfaces as a modal to the next staff member to log in;
 *   2. it emails the IT team (sasindu@aahaas.com by default) straight away.
 *
 * Both are best-effort: alerting must never take down an import run, so every
 * public function here swallows its own errors.
 */

import { randomUUID } from 'crypto'
import { prisma } from '@/lib/prisma'
import { sendMailViaGraph } from '@/lib/send-mail'

const ALERTS_KEY = 'as_import_alerts'

/** How many alerts we retain in the KV log (acknowledged ones included). */
const MAX_ALERTS = 20

/** Cap on a single alert's message, so one verbose upstream error can't dominate. */
const MAX_MESSAGE = 1_200

/**
 * Byte budget for the serialized alert log. `system_settings.value` is a MySQL
 * TEXT column (65,535 bytes) and a write that overruns it throws — which is
 * exactly how the sibling `as_import_jobs` log broke the importer. Retaining
 * only 20 alerts leaves this far from the ceiling, but the guard makes overrun
 * impossible rather than merely unlikely.
 */
const MAX_ALERTS_BYTES = 48_000

/**
 * A repeat of the *same* failure inside this window neither creates a new alert
 * nor sends a new email — it just bumps the existing one's counter. Without it a
 * flapping upstream would mail IT once per retry.
 */
const DEDUP_WINDOW_MS = Number(process.env.AS_ALERT_DEDUP_MS || 30 * 60 * 1000)

/** Where failure notifications go. Comma-separated lists are supported. */
const ALERT_TO = process.env.AS_ALERT_EMAIL || 'sasindu@aahaas.com'
const ALERT_CC = process.env.AS_ALERT_CC || ''

const APP_URL = (process.env.NEXTAUTH_URL || 'https://ops.aahaas.com').replace(/\/+$/, '')

export type AsAlertSeverity = 'error' | 'warning'

export interface AsImportAlert {
  id: string
  /** ISO timestamp of the first occurrence. */
  at: string
  /** ISO timestamp of the most recent occurrence (same as `at` unless repeated). */
  lastAt: string
  /** How many times this same failure has happened inside the dedup window. */
  occurrences: number
  severity: AsAlertSeverity
  title: string
  message: string
  /** Stable identity used for deduplication. */
  signature: string
  jobId?: string | null
  jobMode?: 'auto' | 'manual'
  dateFrom?: string
  dateTo?: string
  totalFound?: number
  totalCreated?: number
  totalErrors?: number
  /** Whether the IT notification email went out. */
  emailed: boolean
  emailError?: string | null
  acknowledgedAt?: string | null
  acknowledgedBy?: string | null
}

// ── KV storage ────────────────────────────────────────────────────────────────

async function readAlerts(): Promise<AsImportAlert[]> {
  try {
    const row = await prisma.systemSetting.findUnique({ where: { key: ALERTS_KEY } })
    if (!row?.value) return []
    const parsed = JSON.parse(row.value)
    return Array.isArray(parsed) ? (parsed as AsImportAlert[]) : []
  } catch {
    return []
  }
}

/** Serialize within the byte budget, dropping the oldest alerts if it overruns. */
function serializeAlerts(alerts: AsImportAlert[]): string {
  const list = alerts.slice(0, MAX_ALERTS)
  let out = JSON.stringify(list)
  while (list.length > 1 && Buffer.byteLength(out, 'utf8') > MAX_ALERTS_BYTES) {
    list.pop()
    out = JSON.stringify(list)
  }
  return out
}

async function writeAlerts(alerts: AsImportAlert[]): Promise<void> {
  const value = serializeAlerts(alerts)
  await prisma.systemSetting.upsert({
    where: { key: ALERTS_KEY },
    update: { value },
    create: { key: ALERTS_KEY, value },
  })
}

// ── Public read/ack API ───────────────────────────────────────────────────────

/** All retained alerts, newest first. */
export async function listAsImportAlerts(): Promise<AsImportAlert[]> {
  return readAlerts()
}

/** Only the alerts nobody has acknowledged yet — what the login modal shows. */
export async function listOpenAsImportAlerts(): Promise<AsImportAlert[]> {
  return (await readAlerts()).filter((a) => !a.acknowledgedAt)
}

/**
 * Mark one alert (or all of them) as seen. Acknowledgement is global, not
 * per-user: once anyone on the team has picked the failure up, it stops
 * interrupting everybody else's login.
 */
export async function acknowledgeAsImportAlerts(
  by: string,
  id?: string,
): Promise<number> {
  const alerts = await readAlerts()
  const now = new Date().toISOString()
  let changed = 0

  for (const a of alerts) {
    if (a.acknowledgedAt) continue
    if (id && a.id !== id) continue
    a.acknowledgedAt = now
    a.acknowledgedBy = by
    changed++
  }

  if (changed > 0) await writeAlerts(alerts)
  return changed
}

// ── Raising an alert ──────────────────────────────────────────────────────────

export interface RaiseAlertInput {
  severity: AsAlertSeverity
  title: string
  message: string
  /** Defaults to `title + message` — override to group varying messages together. */
  signature?: string
  jobId?: string | null
  jobMode?: 'auto' | 'manual'
  dateFrom?: string
  dateTo?: string
  totalFound?: number
  totalCreated?: number
  totalErrors?: number
}

function splitAddresses(raw: string): string[] {
  return raw.split(',').map((s) => s.trim()).filter((s) => s.includes('@'))
}

/**
 * Record a failure and notify IT.
 *
 * Never throws — a broken mailbox or a DB hiccup must not turn a partial import
 * failure into a crashed process. Returns the stored alert, or null if it was
 * deduplicated into an existing one or could not be stored at all.
 */
export async function raiseAsImportAlert(input: RaiseAlertInput): Promise<AsImportAlert | null> {
  const signature = input.signature ?? `${input.title}::${input.message}`
  const now = new Date()
  const nowIso = now.toISOString()

  try {
    const alerts = await readAlerts()

    // Same failure, recently, still unacknowledged → count it, don't re-mail.
    const dup = alerts.find(
      (a) =>
        a.signature === signature &&
        !a.acknowledgedAt &&
        now.getTime() - new Date(a.lastAt ?? a.at).getTime() < DEDUP_WINDOW_MS,
    )
    if (dup) {
      dup.lastAt = nowIso
      dup.occurrences = (dup.occurrences ?? 1) + 1
      await writeAlerts(alerts)
      console.warn(`[AsImportAlert] repeat of "${input.title}" (${dup.occurrences}×) — email suppressed`)
      return null
    }

    const alert: AsImportAlert = {
      id: randomUUID(),
      at: nowIso,
      lastAt: nowIso,
      occurrences: 1,
      severity: input.severity,
      title: input.title,
      message: input.message.length > MAX_MESSAGE ? `${input.message.slice(0, MAX_MESSAGE)}…` : input.message,
      signature,
      jobId: input.jobId ?? null,
      jobMode: input.jobMode,
      dateFrom: input.dateFrom,
      dateTo: input.dateTo,
      totalFound: input.totalFound,
      totalCreated: input.totalCreated,
      totalErrors: input.totalErrors,
      emailed: false,
      emailError: null,
      acknowledgedAt: null,
      acknowledgedBy: null,
    }

    // Store first, mail second — the dashboard alert must survive a mail outage.
    alerts.unshift(alert)
    await writeAlerts(alerts)

    try {
      const to = splitAddresses(ALERT_TO)
      if (to.length === 0) throw new Error('No AS_ALERT_EMAIL recipient configured')
      await sendMailViaGraph({
        to: to[0],
        cc: [...to.slice(1), ...splitAddresses(ALERT_CC)],
        subject: `[AppleSystem import ${input.severity === 'error' ? 'FAILED' : 'warning'}] ${input.title}`,
        bodyHtml: buildAlertEmail(alert),
      })
      alert.emailed = true
    } catch (err) {
      alert.emailError = err instanceof Error ? err.message : String(err)
      console.error('[AsImportAlert] email failed:', alert.emailError)
    }

    await writeAlerts(alerts)
    console.warn(`[AsImportAlert] raised "${input.title}" (emailed=${alert.emailed})`)
    return alert
  } catch (err) {
    console.error('[AsImportAlert] could not raise alert:', err instanceof Error ? err.message : err)
    return null
  }
}

// ── Email template ────────────────────────────────────────────────────────────

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function row(label: string, value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return ''
  return `<tr><td class="label">${esc(label)}</td><td>${esc(String(value))}</td></tr>`
}

function buildAlertEmail(a: AsImportAlert): string {
  const when = new Date(a.at).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
  const isError = a.severity === 'error'
  const window = a.dateFrom
    ? (a.dateFrom === a.dateTo ? a.dateFrom : `${a.dateFrom} → ${a.dateTo}`)
    : null

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${esc(a.title)}</title>
  <style>
    body { margin:0;padding:0;background:#f8fafc;font-family:Arial,Helvetica,sans-serif; }
    .wrapper { max-width:600px;margin:32px auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,0.1); }
    .header { background:${isError ? '#7f1d1d' : '#78350f'};padding:24px 32px; }
    .header h1 { margin:0;color:#fff;font-size:20px;font-weight:800; }
    .header p { margin:4px 0 0;color:#fecaca;font-size:12px; }
    .body { padding:24px 32px; }
    .banner { background:${isError ? '#fef2f2' : '#fffbeb'};border:1px solid ${isError ? '#fecaca' : '#fde68a'};border-radius:6px;padding:12px 16px;margin-bottom:20px; }
    .banner p { margin:0;color:${isError ? '#991b1b' : '#92400e'};font-size:14px;font-weight:700; }
    .banner small { display:block;margin-top:6px;color:${isError ? '#b91c1c' : '#b45309'};font-size:12px;font-weight:400;line-height:1.5; }
    table { width:100%;border-collapse:collapse;margin-bottom:20px; }
    th { text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:0.8px;color:#64748b;padding:6px 10px;background:#f1f5f9;border-bottom:1px solid #e2e8f0; }
    td { font-size:13px;color:#1e293b;padding:8px 10px;border-bottom:1px solid #f1f5f9; }
    td.label { font-weight:600;color:#475569;width:42%; }
    .btn { display:inline-block;background:#1e293b;color:#fff !important;text-decoration:none;font-size:13px;font-weight:700;padding:10px 20px;border-radius:6px; }
    .footer { background:#f8fafc;border-top:1px solid #e2e8f0;padding:16px 32px;text-align:center; }
    .footer p { margin:0;font-size:11px;color:#94a3b8; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="header">
      <h1>Apple Holidays &middot; Booking System</h1>
      <p>AppleSystem import ${isError ? 'failure' : 'warning'} &mdash; IT notification</p>
    </div>
    <div class="body">
      <div class="banner">
        <p>${esc(a.title)}</p>
        <small>${esc(a.message)}</small>
      </div>

      <table>
        <tr><th colspan="2">Run details</th></tr>
        ${row('When', when)}
        ${row('Import type', a.jobMode === 'auto' ? 'Daily auto-import' : a.jobMode === 'manual' ? 'Manual run' : null)}
        ${row('Date window', window)}
        ${row('Quotations found', a.totalFound)}
        ${row('Bookings created', a.totalCreated)}
        ${row('Failed items', a.totalErrors)}
        ${row('Job ID', a.jobId)}
      </table>

      <p style="font-size:13px;color:#475569;line-height:1.6;margin:0 0 18px;">
        The importer already retried the AppleSystem call five times with a progressively
        longer timeout before giving up, so this is very likely an upstream outage or a
        genuinely slow query rather than a transient blip. Confirmations in this window
        have <strong>not</strong> been imported &mdash; re-run the range once AppleSystem is healthy.
      </p>

      <p style="margin:0 0 8px;">
        <a class="btn" href="${APP_URL}/dashboard/new-as-booking">Open the import dashboard</a>
      </p>
    </div>
    <div class="footer">
      <p>Sent automatically by the AppleHolidays Booking System importer.</p>
      <p style="margin-top:4px;">Staff are also alerted in-app the next time they sign in.</p>
    </div>
  </div>
</body>
</html>
`
}
