import { prisma } from './prisma'
import {
  getConfiguredMailboxes,
  extractEmailSourceTextForUser,
  autoSubscribe,
} from './mail-processor'
import { processMailboxEmail } from './incoming-mail-automation'
import { getLessCreditModeEnabled, RECENT_MAIL_WINDOW_MINUTES } from './mail-mode'
import { AUTO_MAIL_HARD_DISABLED, ONEDRIVE_AUTO_POLL_HARD_DISABLED } from './automation-switches'
import {
  upsertCachedMailMessage,
  syncMailboxEmailsToDb,
  listUnprocessedDbEmails,
} from './mail-cache'
import { fetchImapPayableEmails, fetchImapAttachments, IMAP_PNL_USER } from './imap-pnl'
import { startImapIdleWatcher } from './imap-idle-watcher'
import type { ProcessedEmail } from './mail-processor'

// ─────────────────────────────────────────────────────────────────────────────
// Individual email processor — same dedup + error pattern as the cron route
// ─────────────────────────────────────────────────────────────────────────────

async function processOne(
  email: ProcessedEmail,
  mailboxUser: string,
  kind: 'TOUR_CONFIRMATION' | 'PNL',
) {
  const dedupKey = `processed_email_${email.graphId}`
  const already = await prisma.systemSetting.findUnique({ where: { key: dedupKey } })
  if (already) return 'skipped'

  await upsertCachedMailMessage({ email, mailboxUser, mailboxKind: kind, status: 'RECEIVED' }).catch(() => {})

  const { rawText, attachments } = await extractEmailSourceTextForUser(mailboxUser, email)
  const result = await processMailboxEmail({ ...email, rawBody: rawText }, kind, attachments)

  if (result.status === 'PNL_WAITING') {
    // No matching TQ booking yet — store as WAITING so the next cron retries it
    // Do NOT write the dedup key, allowing future re-processing when TQ arrives
    await upsertCachedMailMessage({
      email, mailboxUser, mailboxKind: kind,
      bookingRef: result.bookingRef, status: 'WAITING',
    }).catch(() => {})
    console.log(`[Scheduler] PNL Tour No ${result.bookingRef} — waiting for TQ, will retry`)
    return 'waiting'
  }

  await prisma.systemSetting.upsert({
    where:  { key: dedupKey },
    update: { value: `${result.bookingRef}|${new Date().toISOString()}` },
    create: { key: dedupKey, value: `${result.bookingRef}|${new Date().toISOString()}` },
  })
  await upsertCachedMailMessage({
    email, mailboxUser, mailboxKind: kind,
    bookingRef: result.bookingRef, status: 'PROCESSED',
    processedAt: new Date().toISOString(),
  }).catch(() => {})

  console.log(`[Scheduler] ✓ ${kind} → booking ${result.bookingRef}`)
  return 'processed'
}

// ─────────────────────────────────────────────────────────────────────────────
// Graph mailbox batch (TQ + PNL via Microsoft Graph)
// ─────────────────────────────────────────────────────────────────────────────

async function runGraphMailboxes(lessCreditMode: boolean, cutoffMs: number) {
  const mailboxes = getConfiguredMailboxes()

  for (const mailbox of mailboxes) {
    await syncMailboxEmailsToDb({
      mailboxUser: mailbox.user,
      mailboxKind:  mailbox.kind,
      limit:        50,
      folder:       'inbox',
    }).catch(() => {})

    const dbEmails = await listUnprocessedDbEmails(mailbox.user, 25).catch(() => [] as ProcessedEmail[])
    const scoped = lessCreditMode
      ? dbEmails.filter(e => Date.now() - new Date(e.date).getTime() <= cutoffMs)
      : dbEmails

    for (const email of scoped) {
      try {
        await processOne(email, mailbox.user, mailbox.kind)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error(`[Scheduler] Graph ${mailbox.kind} failed (${email.graphId}):`, msg)
        await upsertCachedMailMessage({ email, mailboxUser: mailbox.user, mailboxKind: mailbox.kind, status: 'ERROR' }).catch(() => {})
        await prisma.systemSetting.upsert({
          where:  { key: 'scheduler_last_error' },
          update: { value: `${new Date().toISOString()} | ${mailbox.user} | ${msg.slice(0, 500)}` },
          create: { key: 'scheduler_last_error', value: `${new Date().toISOString()} | ${mailbox.user} | ${msg.slice(0, 500)}` },
        })
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// IMAP payable mailbox (accounts.payable@aahaas.com) — PNL emails only
// ─────────────────────────────────────────────────────────────────────────────

async function runImapMailbox(lessCreditMode: boolean, cutoffMs: number) {
  if (!IMAP_PNL_USER) return

  // Skip if the same address is already handled by Graph
  const graphMailboxes = getConfiguredMailboxes()
  if (graphMailboxes.some(mb => mb.user === IMAP_PNL_USER)) return

  const emails = await fetchImapPayableEmails(25).catch(() => [])
  const scoped = lessCreditMode
    ? emails.filter(e => Date.now() - new Date(e.date).getTime() <= cutoffMs)
    : emails

  for (const email of scoped) {
    const dedupKey = `processed_email_${email.graphId}`
    const already = await prisma.systemSetting.findUnique({ where: { key: dedupKey } })
    if (already) continue

    try {
      await upsertCachedMailMessage({ email, mailboxUser: IMAP_PNL_USER, mailboxKind: 'PNL', status: 'RECEIVED' }).catch(() => {})

      const attachments = email.hasAttachments
        ? await fetchImapAttachments(email.graphId).catch(() => [])
        : []

      const result = await processMailboxEmail(email, 'PNL', attachments)

      if (result.status === 'PNL_WAITING') {
        await upsertCachedMailMessage({
          email, mailboxUser: IMAP_PNL_USER, mailboxKind: 'PNL',
          bookingRef: result.bookingRef, status: 'WAITING',
        }).catch(() => {})
        console.log(`[Scheduler] IMAP PNL Tour No ${result.bookingRef} — waiting for TQ, will retry`)
      } else {
        await prisma.systemSetting.upsert({
          where:  { key: dedupKey },
          update: { value: `${result.bookingRef}|${new Date().toISOString()}` },
          create: { key: dedupKey, value: `${result.bookingRef}|${new Date().toISOString()}` },
        })
        await upsertCachedMailMessage({
          email,
          mailboxUser: IMAP_PNL_USER,
          mailboxKind: 'PNL',
          bookingRef:  result.bookingRef,
          status:      'PROCESSED',
          processedAt: new Date().toISOString(),
        }).catch(() => {})
        console.log(`[Scheduler] ✓ IMAP PNL → booking ${result.bookingRef}`)
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[Scheduler] IMAP PNL failed:', msg)
      await upsertCachedMailMessage({ email, mailboxUser: IMAP_PNL_USER, mailboxKind: 'PNL', status: 'ERROR' }).catch(() => {})
      await prisma.systemSetting.upsert({
        where:  { key: 'imap_scheduler_last_error' },
        update: { value: `${new Date().toISOString()} | ${IMAP_PNL_USER} | ${msg.slice(0, 500)}` },
        create: { key: 'imap_scheduler_last_error', value: `${new Date().toISOString()} | ${IMAP_PNL_USER} | ${msg.slice(0, 500)}` },
      })
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Top-level job runners
// ─────────────────────────────────────────────────────────────────────────────

async function jobProcessMailboxes() {
  if (AUTO_MAIL_HARD_DISABLED) {
    console.log('[Scheduler] auto mail reading permanently disabled in code — tick ignored')
    return
  }
  try {
    const mailSetting = await prisma.systemSetting.findUnique({ where: { key: 'auto_mail_enabled' } })
    if (mailSetting?.value !== 'true') {
      console.log('[Scheduler] process-mailboxes disabled — enable in Settings → Automation')
      return
    }
    console.log('[Scheduler] process-mailboxes started')
    const lessCreditMode = await getLessCreditModeEnabled()
    const cutoffMs = RECENT_MAIL_WINDOW_MINUTES * 60 * 1000
    await runGraphMailboxes(lessCreditMode, cutoffMs)
    await runImapMailbox(lessCreditMode, cutoffMs)
    console.log('[Scheduler] process-mailboxes done')
  } catch (err) {
    console.error('[Scheduler] process-mailboxes error:', err instanceof Error ? err.message : err)
  }
}

async function jobRenewWebhook() {
  console.log('[Scheduler] renew-webhook started')
  try {
    await autoSubscribe()
    console.log('[Scheduler] renew-webhook done')
  } catch (err) {
    console.error('[Scheduler] renew-webhook error:', err instanceof Error ? err.message : err)
  }
}

async function jobOneDrivePoll() {
  if (ONEDRIVE_AUTO_POLL_HARD_DISABLED) {
    console.log('[Scheduler] OneDrive auto-poll permanently disabled in code — tick ignored')
    return
  }
  try {
    const driveSetting = await prisma.systemSetting.findUnique({ where: { key: 'auto_onedrive_enabled' } })
    if (driveSetting?.value !== 'true') {
      console.log('[Scheduler] OneDrive poll disabled — enable in Settings → AI Token Controls')
      return
    }
    const { runOneDrivePoll } = await import('./onedrive-monitor')
    await runOneDrivePoll()
  } catch (err) {
    console.error('[Scheduler] OneDrive poll error:', err instanceof Error ? err.message : err)
  }
}

async function jobFeedbackSummary() {
  try {
    const { runAutoFeedbackSummaries } = await import('./send-feedback-summary')
    const result = await runAutoFeedbackSummaries()
    console.log(`[Scheduler] feedback-summary — sent: ${result.sent}, skipped: ${result.skipped}, errors: ${result.errors}`)
  } catch (err) {
    console.error('[Scheduler] feedback-summary error:', err instanceof Error ? err.message : err)
  }
}

async function jobCancellationMailWatch() {
  try {
    const { runCancellationMailWatch } = await import('./cancellation-mail-watcher')
    const r = await runCancellationMailWatch()
    if (r.sent || r.failed) {
      console.log(`[Scheduler] cancellation-mail — sent: ${r.sent}, failed: ${r.failed}, skipped: ${r.skipped}`)
    }
  } catch (err) {
    console.error('[Scheduler] cancellation-mail error:', err instanceof Error ? err.message : err)
  }
}

async function startAutoBookingCreateScheduler() {
  try {
    // node-cron scheduler: fires once daily at the configured time (default 04:00
    // AUTO_BOOKING_TZ). Started once at boot — no per-minute polling, timezone-aware,
    // with boot catch-up. Replaces the old setInterval + exact-minute-match approach.
    const { startAutoBookingScheduler } = await import('./auto-booking-scheduler')
    await startAutoBookingScheduler()
  } catch (err) {
    console.error('[Scheduler] auto-booking-create scheduler error:', err instanceof Error ? err.message : err)
  }
}

async function startAsImportCreateScheduler() {
  try {
    // node-cron scheduler: fires once daily at the configured time (default 06:00
    // AUTO_BOOKING_TZ) and imports yesterday's status-2 AppleSystem confirmations.
    // Started once at boot — timezone-aware, with boot catch-up.
    const { startAsImportScheduler } = await import('./as-import-scheduler')
    await startAsImportScheduler()
  } catch (err) {
    console.error('[Scheduler] as-import scheduler error:', err instanceof Error ? err.message : err)
  }
}

async function startAsWatchLiveScheduler() {
  try {
    // Near-realtime AppleSystem confirmation watch: a self-rescheduling timer that
    // sweeps a rolling create-date window every N minutes (configured in the UI)
    // and imports confirmations as they appear, instead of waiting for the 06:00
    // daily job. Idempotent — it can never duplicate an existing booking.
    const { startAsWatchScheduler } = await import('./as-watch-scheduler')
    await startAsWatchScheduler()
  } catch (err) {
    console.error('[Scheduler] as-watch scheduler error:', err instanceof Error ? err.message : err)
  }
}

async function startAsReconcileParityScheduler() {
  try {
    // AppleSystem parity reconciliation: every 15 min it re-lists the rolling
    // create-date window, imports any confirmation this system is missing,
    // refreshes any whose upstream row has been amended, and cancels any the
    // Apple System has withdrawn. The importers create; this one *verifies*.
    const { startAsReconcileScheduler } = await import('./as-reconcile-scheduler')
    await startAsReconcileScheduler()
  } catch (err) {
    console.error('[Scheduler] as-reconcile scheduler error:', err instanceof Error ? err.message : err)
  }
}

async function startB2cImportCreateScheduler() {
  try {
    // node-cron scheduler: fires once daily just after midnight (default 00:30
    // AUTO_BOOKING_TZ) and imports the Aahaas B2C orders booked that day whose
    // travel is still upcoming. Timezone-aware, with boot catch-up.
    const { startB2cImportScheduler } = await import('./b2c-import-scheduler')
    await startB2cImportScheduler()
  } catch (err) {
    console.error('[Scheduler] b2c-import scheduler error:', err instanceof Error ? err.message : err)
  }
}

async function startCustomerWhatsAppMessagingScheduler() {
  try {
    // node-cron scheduler: fires once daily at CUSTOMER_MSG_SEND_HOUR (default 18:00
    // = 6pm) in CUSTOMER_MSG_TZ. Started once at boot — timezone-aware, with boot
    // catch-up. Replaces the old setInterval(60s) + exact-minute-match approach.
    const { startCustomerWhatsAppScheduler } = await import('./customer-whatsapp-scheduler')
    await startCustomerWhatsAppScheduler()
  } catch (err) {
    console.error('[Scheduler] customer-messaging scheduler error:', err instanceof Error ? err.message : err)
  }
}

async function startPortalLinkWhatsAppMessagingScheduler() {
  try {
    // node-cron scheduler: fires once daily at PORTAL_MSG_SEND_HOUR (default 10:00)
    // in PORTAL_MSG_TZ and WhatsApps the customer trip-portal link — the welcome
    // the day after a booking is created, and the "ready to travel?" reminder
    // 3 days before arrival. Timezone-aware, with boot catch-up.
    const { startPortalLinkWhatsAppScheduler } = await import('./portal-link-whatsapp-scheduler')
    await startPortalLinkWhatsAppScheduler()
  } catch (err) {
    console.error('[Scheduler] portal-link WhatsApp scheduler error:', err instanceof Error ? err.message : err)
  }
}

async function startDriverLogAutoSendScheduler() {
  try {
    // node-cron scheduler: sends tomorrow's Sri Lanka Driver Advance Sheets at
    // DRIVER_LOG_SEND_HOUR (default 18:00 = 6pm the day before) in DRIVER_LOG_TZ
    // (Asia/Colombo). Backend-only — runs even with no user on the app. Gated by
    // the global driver_log_auto_send_enabled switch inside the run function.
    const { startDriverLogScheduler } = await import('./driver-log-scheduler')
    await startDriverLogScheduler()
  } catch (err) {
    console.error('[Scheduler] driver-log auto-send scheduler error:', err instanceof Error ? err.message : err)
  }
}

async function startAgendaAutoEmailScheduler() {
  try {
    // node-cron scheduler: emails the tour confirmation (agenda PDF) to customers
    // arriving in 3 days, at AGENDA_AUTO_EMAIL_HOUR (default 09:00) in
    // AGENDA_AUTO_EMAIL_TZ. Timezone-aware with boot catch-up; gated by the
    // auto_agenda_email_enabled switch inside the run function.
    const { startAgendaAutoSendScheduler } = await import('./agenda-auto-send-scheduler')
    await startAgendaAutoSendScheduler()
  } catch (err) {
    console.error('[Scheduler] agenda auto-email scheduler error:', err instanceof Error ? err.message : err)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ── Master switch ─────────────────────────────────────────────────────────────
const CRON_ENABLED = true

// ─────────────────────────────────────────────────────────────────────────────
// Scheduler entry point — called once from instrumentation.ts on server boot
// ─────────────────────────────────────────────────────────────────────────────

let started = false

export function startCronJobs() {
  if (!CRON_ENABLED) {
    console.log('[Scheduler] Hard-disabled — set CRON_ENABLED = true to re-enable')
    return
  }
  if (started) return
  started = true

  const TWO_MIN    = 2  * 60  * 1000
  const THREE_MIN  = 3  * 60  * 1000
  const FIVE_MIN   = 5  * 60  * 1000
  const SIX_HRS    = 6  * 3600 * 1000
  const TWELVE_HRS = 12 * 3600 * 1000

  // IMAP IDLE watcher — real-time push for accounts.payable@aahaas.com
  // Starts immediately; the 5-min cron below acts as a safety-net fallback.
  startImapIdleWatcher()

  // Delayed first runs so the server is fully ready before processing starts
  setTimeout(() => { jobRenewWebhook() },     15_000)   // 15 s after boot
  if (!AUTO_MAIL_HARD_DISABLED)          setTimeout(() => { jobProcessMailboxes() }, 30_000)   // 30 s after boot
  if (!ONEDRIVE_AUTO_POLL_HARD_DISABLED) setTimeout(() => { jobOneDrivePoll() },     60_000)   // 60 s after boot — OneDrive first run
  setTimeout(() => { jobCancellationMailWatch() }, 45_000)   // 45 s after boot

  // Auto-booking-create: node-cron daily job (timezone-aware, boot catch-up).
  // Started once at boot instead of a per-minute interval.
  void startAutoBookingCreateScheduler()

  // AppleSystem confirmations auto-import: node-cron daily job at 06:00
  // (timezone-aware, boot catch-up). Imports yesterday's status-2 confirmations.
  void startAsImportCreateScheduler()

  // AppleSystem live confirmation watch: interval-based sweep (default every 15
  // min, off until switched on in New Booking - AppleSystem > Live Watch) that
  // creates bookings within minutes of a confirmation rather than next morning.
  void startAsWatchLiveScheduler()

  // AppleSystem parity reconciliation: every 15 min, re-check the rolling
  // create-date window against AppleSystem and repair every way the two can
  // disagree — missing bookings imported, amended ones refreshed, withdrawn
  // ones cancelled. This is the job that guarantees no confirmation is missed;
  // the watch above is the fast path, this is the one that checks its work.
  void startAsReconcileParityScheduler()

  // Aahaas B2C order auto-import: node-cron daily job just after midnight
  // (timezone-aware, boot catch-up). Imports today's orders with upcoming travel.
  void startB2cImportCreateScheduler()

  // Customer WhatsApp messaging: node-cron daily job at 6pm (timezone-aware, boot
  // catch-up). Started once at boot instead of a per-minute interval.
  void startCustomerWhatsAppMessagingScheduler()

  // Customer trip-portal link on WhatsApp: node-cron daily job at 10am — welcome
  // the day after booking creation, "ready to travel?" 3 days before arrival.
  void startPortalLinkWhatsAppMessagingScheduler()

  // Driver Log auto-send: node-cron daily job at 6pm Sri Lanka (day before tour),
  // timezone-aware with boot catch-up. Backend-only, gated by a global switch.
  void startDriverLogAutoSendScheduler()

  // Tour-confirmation auto-email: node-cron daily job, sends the agenda PDF to
  // customers arriving in 3 days. Timezone-aware with boot catch-up.
  void startAgendaAutoEmailScheduler()

  // Auto mail reading and the OneDrive auto-poll are hard-disabled in code
  // (see automation-switches.ts) — don't even schedule their ticks, so no
  // repeating "disabled" noise ends up in the logs.
  if (!AUTO_MAIL_HARD_DISABLED)              setInterval(() => { jobProcessMailboxes() }, FIVE_MIN)
  if (!ONEDRIVE_AUTO_POLL_HARD_DISABLED)     setInterval(() => { jobOneDrivePoll() },     THREE_MIN)
  setInterval(() => { jobRenewWebhook() },         TWELVE_HRS)
  setInterval(() => { jobFeedbackSummary() },      SIX_HRS)
  // Cancellations approved in the Apple Accounts system land straight in the DB —
  // this picks the transition up and sends the cancellation notice.
  setInterval(() => { jobCancellationMailWatch() }, TWO_MIN)

  console.log('[Scheduler] Started — auto mail reading and OneDrive auto-poll are HARD-DISABLED in code (automation-switches.ts); webhook every 12 h, feedback summary every 6 h, cancellation mail watch every 2 min, auto-booking-create via node-cron daily (timezone-aware, boot catch-up), customer WhatsApp messaging via node-cron daily at 6pm (timezone-aware, boot catch-up)')
}
