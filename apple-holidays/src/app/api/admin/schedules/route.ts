import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { getTqAutoStatus } from '@/lib/tq-auto-scheduler'
import { getAsImportSettings, getLastJob } from '@/lib/as-import'
import { getAutoCreateSettings } from '@/lib/auto-booking-create'
import { AUTO_MAIL_HARD_DISABLED, ONEDRIVE_AUTO_POLL_HARD_DISABLED } from '@/lib/automation-switches'

export const dynamic = 'force-dynamic'

const TZ = process.env.AUTO_BOOKING_TZ || 'Asia/Colombo'

type Category = 'Mail' | 'Bookings' | 'Customer' | 'Ops'

interface TogglePayload {
  endpoint: string
  protected: boolean
  payloadOn: Record<string, unknown>
  payloadOff: Record<string, unknown>
}

interface ScheduleJob {
  id: string
  label: string
  description: string
  category: Category
  cadence: string
  timezone?: string
  enabled: boolean
  controllable: boolean
  toggle?: TogglePayload
  lastRunAt: string | null
  lastResult: string | null
  lastError: string | null
  /** Rendered as a small pill instead of the usual ON/OFF (e.g. TQ-Auto). */
  stateBadge?: string
}

/** Parse the `ISO | ... | message` error-log format written by the schedulers. */
function parseErrorLog(value?: string | null): { at: string | null; message: string } | null {
  if (!value) return null
  const parts = value.split('|').map((s) => s.trim())
  const at = parts[0] && !isNaN(Date.parse(parts[0])) ? new Date(parts[0]).toISOString() : null
  const message = parts.slice(1).join(' | ') || parts[0] || ''
  return { at, message }
}

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session || !['SUPER_ADMIN', 'ULTRA_SUPER_ADMIN'].includes(session.user.role)) {
    return buildApiError('Forbidden', 403)
  }

  // Batch-read the SystemSetting keys we need, plus the helper-backed summaries.
  const KEYS = [
    'auto_mail_enabled', 'auto_onedrive_enabled', 'scheduler_last_error', 'tq_auto_last_error',
    'as_auto_import_last_run_date', 'auto_booking_create_last_run_date',
    'customer_whatsapp_last_run_date', 'agenda_auto_email_last_run_date',
    'driver_log_auto_send_enabled',
  ]
  const [rows, tq, asSettings, asLastJob, autoBooking, lastDriveJob] = await Promise.all([
    prisma.systemSetting.findMany({ where: { key: { in: KEYS } } }),
    getTqAutoStatus().catch(() => null),
    getAsImportSettings().catch(() => ({ enabled: false, hour: 6, minute: 0 })),
    getLastJob('auto').catch(() => null),
    getAutoCreateSettings().catch(() => ({ enabled: false, daysAhead: 10, hour: 4, minute: 0 })),
    prisma.oneDriveBookingJob.findFirst({ orderBy: { createdAt: 'desc' } }).catch(() => null),
  ])
  const s: Record<string, string> = {}
  rows.forEach((r) => { s[r.key] = r.value })

  // Both are hard-disabled in code — the DB toggles below are powerless, so the
  // UI must report OFF regardless of what the SystemSetting rows say.
  const autoMailOn = !AUTO_MAIL_HARD_DISABLED          && s['auto_mail_enabled'] === 'true'
  const onedriveOn = !ONEDRIVE_AUTO_POLL_HARD_DISABLED && s['auto_onedrive_enabled'] === 'true'
  const schedulerErr = parseErrorLog(s['scheduler_last_error'])
  const tqErr = parseErrorLog(s['tq_auto_last_error'])

  const asSummary = asLastJob
    ? `found ${asLastJob.totalFound}, created ${asLastJob.totalCreated}, skipped ${asLastJob.totalSkipped}, errors ${asLastJob.totalErrors}`
    : null
  const driveSummary = lastDriveJob
    ? `created ${lastDriveJob.totalCreated}, updated ${lastDriveJob.totalUpdated}, errors ${lastDriveJob.totalErrors}`
    : null

  const jobs: ScheduleJob[] = [
    // ── Mail ──────────────────────────────────────────────────────────────────
    {
      id: 'auto-mail',
      label: 'Auto Mail Processing',
      description: 'Extracts TC / P&L emails and creates bookings automatically. Permanently disabled in code — mail is still received and cached, process it manually with the Process button in Mail Inbox.',
      category: 'Mail',
      cadence: 'Every 5 min + real-time (IMAP IDLE / webhook)',
      enabled: autoMailOn,
      controllable: !AUTO_MAIL_HARD_DISABLED,
      stateBadge: AUTO_MAIL_HARD_DISABLED ? 'Disabled in code' : undefined,
      toggle: {
        endpoint: '/api/admin/settings',
        protected: true,
        payloadOn:  { key: 'auto_mail_enabled', value: 'true' },
        payloadOff: { key: 'auto_mail_enabled', value: 'false' },
      },
      lastRunAt: schedulerErr?.at ?? null,
      lastResult: null,
      lastError: schedulerErr?.message ?? null,
    },
    {
      id: 'imap-idle',
      label: 'IMAP IDLE Watcher',
      description: 'Real-time push watcher for the accounts-payable mailbox. Mirrors Auto Mail Processing — skips when that is OFF.',
      category: 'Mail',
      cadence: 'Real-time',
      enabled: autoMailOn,
      controllable: false,
      stateBadge: AUTO_MAIL_HARD_DISABLED ? 'Disabled in code' : undefined,
      lastRunAt: null,
      lastResult: autoMailOn ? 'Active' : 'Idle (manual only)',
      lastError: null,
    },
    {
      id: 'tq-auto',
      label: 'TQ Auto-Process',
      description: 'Legacy 5-minute TQ mailbox auto-processor. Permanently disabled in code.',
      category: 'Mail',
      cadence: 'Every 5 min',
      enabled: false,
      controllable: false,
      stateBadge: 'Disabled in code',
      lastRunAt: tq?.lastRunAt ?? null,
      lastResult: tq?.lastResult ?? null,
      lastError: tqErr?.message ?? null,
    },
    // ── Bookings ────────────────────────────────────────────────────────────────
    {
      id: 'as-import',
      label: 'AS Confirmations Import',
      description: "Imports yesterday's confirmed (Status 2) AppleSystem quotations as bookings.",
      category: 'Bookings',
      cadence: `Daily ${String(asSettings.hour).padStart(2, '0')}:${String(asSettings.minute).padStart(2, '0')}`,
      timezone: TZ,
      enabled: asSettings.enabled,
      controllable: true,
      toggle: {
        endpoint: '/api/as-bookings-v2/auto-import',
        protected: false,
        payloadOn:  { enabled: true },
        payloadOff: { enabled: false },
      },
      lastRunAt: s['as_auto_import_last_run_date'] ? `${s['as_auto_import_last_run_date']}T00:00:00Z` : null,
      lastResult: asSummary,
      lastError: null,
    },
    {
      id: 'auto-booking-create',
      label: 'Auto Booking Create (OneDrive)',
      description: 'Scans SharePoint/OneDrive folders and creates bookings from TC / P&L files for the target date.',
      category: 'Bookings',
      cadence: `Daily ${String(autoBooking.hour).padStart(2, '0')}:${String(autoBooking.minute).padStart(2, '0')}`,
      timezone: TZ,
      enabled: autoBooking.enabled,
      controllable: true,
      toggle: {
        endpoint: '/api/admin/onedrive-booking-auto/settings',
        protected: false,
        payloadOn:  { enabled: true,  daysAhead: autoBooking.daysAhead, hour: autoBooking.hour, minute: autoBooking.minute },
        payloadOff: { enabled: false, daysAhead: autoBooking.daysAhead, hour: autoBooking.hour, minute: autoBooking.minute },
      },
      lastRunAt: s['auto_booking_create_last_run_date'] ? `${s['auto_booking_create_last_run_date']}T00:00:00Z` : null,
      lastResult: driveSummary,
      lastError: lastDriveJob?.errorMessage ?? null,
    },
    {
      id: 'onedrive-poll',
      label: 'Auto OneDrive Poll',
      description: 'Polls SharePoint/OneDrive drives for new TC / P&L files and processes them. Permanently disabled in code — manual scans from the admin OneDrive page still work.',
      category: 'Bookings',
      cadence: 'Every 3–5 min',
      enabled: onedriveOn,
      controllable: !ONEDRIVE_AUTO_POLL_HARD_DISABLED,
      stateBadge: ONEDRIVE_AUTO_POLL_HARD_DISABLED ? 'Disabled in code' : undefined,
      toggle: {
        endpoint: '/api/admin/settings',
        protected: true,
        payloadOn:  { key: 'auto_onedrive_enabled', value: 'true' },
        payloadOff: { key: 'auto_onedrive_enabled', value: 'false' },
      },
      lastRunAt: null,
      lastResult: null,
      lastError: null,
    },
    // ── Customer ────────────────────────────────────────────────────────────────
    {
      id: 'customer-whatsapp',
      label: 'Customer WhatsApp Messaging',
      description: 'Sends the scheduled customer WhatsApp messages (arrival briefings etc.).',
      category: 'Customer',
      cadence: 'Daily 18:00',
      timezone: TZ,
      enabled: true,
      controllable: false,
      lastRunAt: s['customer_whatsapp_last_run_date'] ? `${s['customer_whatsapp_last_run_date']}T00:00:00Z` : null,
      lastResult: null,
      lastError: null,
    },
    {
      id: 'agenda-auto-send',
      label: 'Agenda Auto-Send',
      description: 'Emails the tour agenda PDF to customers arriving in a few days.',
      category: 'Customer',
      cadence: 'Daily',
      timezone: TZ,
      enabled: true,
      controllable: false,
      lastRunAt: s['agenda_auto_email_last_run_date'] ? `${s['agenda_auto_email_last_run_date']}T00:00:00Z` : null,
      lastResult: null,
      lastError: null,
    },
    {
      id: 'customer-daily-briefing',
      label: 'Customer Daily Briefing',
      description: 'Vercel cron — daily customer briefing messages.',
      category: 'Customer',
      cadence: 'Daily 11:00',
      enabled: true,
      controllable: false,
      lastRunAt: null,
      lastResult: null,
      lastError: null,
    },
    {
      id: 'customer-feedback-request',
      label: 'Customer Feedback Request',
      description: 'Vercel cron — post-tour feedback requests.',
      category: 'Customer',
      cadence: 'Daily 11:00',
      enabled: true,
      controllable: false,
      lastRunAt: null,
      lastResult: null,
      lastError: null,
    },
    // ── Ops ──────────────────────────────────────────────────────────────────────
    {
      id: 'driver-log-autosend',
      label: 'Driver Log Auto-Send',
      description: 'Sends the Sri Lanka driver advance sheet (PDF / WhatsApp) the day before the tour.',
      category: 'Ops',
      cadence: 'Daily 18:00',
      timezone: TZ,
      enabled: s['driver_log_auto_send_enabled'] === 'true',
      controllable: false,
      lastRunAt: null,
      lastResult: null,
      lastError: null,
    },
    {
      id: 'driver-notify',
      label: 'Driver Notify',
      description: 'Vercel cron — driver notifications for upcoming assignments.',
      category: 'Ops',
      cadence: 'Hourly + daily 23:00',
      enabled: true,
      controllable: false,
      lastRunAt: null,
      lastResult: null,
      lastError: null,
    },
    {
      id: 'webhook-renew',
      label: 'Webhook Renewal',
      description: 'Renews the Microsoft Graph mailbox subscriptions so real-time push keeps working.',
      category: 'Ops',
      cadence: 'Every 12 h',
      enabled: true,
      controllable: false,
      lastRunAt: null,
      lastResult: null,
      lastError: null,
    },
    {
      id: 'feedback-summary',
      label: 'Feedback Summary',
      description: 'Aggregates and emails the customer feedback summary.',
      category: 'Ops',
      cadence: 'Every 6 h',
      enabled: true,
      controllable: false,
      lastRunAt: null,
      lastResult: null,
      lastError: null,
    },
    {
      id: 'cancellation-mail-watch',
      label: 'Cancellation Mail Watch',
      description: 'Detects cancellations approved in the Apple Accounts system and sends the cancellation notice.',
      category: 'Ops',
      cadence: 'Every 2 min',
      enabled: true,
      controllable: false,
      lastRunAt: null,
      lastResult: null,
      lastError: null,
    },
  ]

  const summary = {
    total: jobs.length,
    enabled: jobs.filter((j) => j.enabled).length,
    disabled: jobs.filter((j) => !j.enabled).length,
    withErrors: jobs.filter((j) => !!j.lastError).length,
  }

  return buildApiSuccess({ jobs, summary, autoMailEnabled: autoMailOn, timezone: TZ })
}
