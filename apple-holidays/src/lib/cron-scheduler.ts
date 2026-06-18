import { prisma } from './prisma'
import {
  getConfiguredMailboxes,
  extractEmailSourceTextForUser,
  autoSubscribe,
} from './mail-processor'
import { processMailboxEmail } from './incoming-mail-automation'
import { getLessCreditModeEnabled, RECENT_MAIL_WINDOW_MINUTES } from './mail-mode'
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
  console.log('[Scheduler] process-mailboxes started')
  try {
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

// ─────────────────────────────────────────────────────────────────────────────
// Scheduler entry point — called once from instrumentation.ts on server boot
// ─────────────────────────────────────────────────────────────────────────────

let started = false

export function startCronJobs() {
  if (started) return
  started = true

  const FIVE_MIN   = 5  * 60  * 1000
  const TWELVE_HRS = 12 * 3600 * 1000

  // IMAP IDLE watcher — real-time push for accounts.payable@aahaas.com
  // Starts immediately; the 5-min cron below acts as a safety-net fallback.
  startImapIdleWatcher()

  // Delayed first runs so the server is fully ready before processing starts
  setTimeout(() => { jobRenewWebhook() },     15_000)   // 15 s after boot
  setTimeout(() => { jobProcessMailboxes() }, 30_000)   // 30 s after boot

  setInterval(() => { jobProcessMailboxes() }, FIVE_MIN)
  setInterval(() => { jobRenewWebhook() },     TWELVE_HRS)

  console.log('[Scheduler] Started — IDLE watcher (instant), process-mailboxes every 5 min, renew-webhook every 12 h')
}
