/**
 * TQ Auto-Process scheduler — NEW, self-contained backend job.
 *
 * Runs entirely inside the always-on Node process (started once at boot from
 * instrumentation.ts). Every 5 minutes it checks the Travel-Quotation mailbox
 * (confirm.booking@aahaas.com — Outlookmail_USERNAME) for NEW mail and processes
 * only those that have not been processed before, then records a per-run "alert
 * batch" summarising how many new bookings were created, grouped by country
 * (e.g. VN-5, SL-10, MY-2). The alerts feed the "Auto-Processed" tab in
 * /dashboard/admin/mail-inbox.
 *
 * Design goals (from the request):
 *   1. Independent of the existing pipeline — this file does not touch
 *      cron-scheduler.ts, process-mailboxes route, or any old function.
 *   2. Never wastes OpenAI tokens on already-processed mail. It shares the SAME
 *      dedup key (`processed_email_{graphId}`) as every other processor, so a mail
 *      handled by the webhook / old cron / this job is processed exactly once,
 *      whichever runs first.
 *   3. Runs on the backend with no user present — node-cron inside the server.
 *
 * Toggle it with the SystemSetting key `tq_auto_scheduler_enabled` (defaults ON).
 */
import * as cron from 'node-cron'
import type { ScheduledTask } from 'node-cron'
import { prisma } from './prisma'
import {
  getConfiguredMailboxes,
  extractEmailSourceTextForUser,
} from './mail-processor'
import type { ProcessedEmail } from './mail-processor'
import { processMailboxEmail } from './incoming-mail-automation'
import {
  upsertCachedMailMessage,
  syncMailboxEmailsToDb,
  listUnprocessedDbEmails,
} from './mail-cache'
import { detectCountryFromRef } from './country-detection'
import type { OperationCountry } from './country-detection'

// ── SystemSetting keys ────────────────────────────────────────────────────────
export const TQ_AUTO_ENABLED_KEY = 'tq_auto_scheduler_enabled'
export const TQ_AUTO_ALERTS_KEY  = 'tq_auto_process_alerts'
export const TQ_AUTO_STATUS_KEY  = 'tq_auto_last_run'

const MAX_ALERTS = 50            // keep the most recent N run summaries
const EVERY_5_MIN = '*/5 * * * *'

// ── Alert shapes (persisted as JSON in SystemSetting) ──────────────────────────
export interface TqAutoCreatedBooking {
  ref: string
  country: string          // short label: VN | SL | SG | MY | SGMY | ?
  isNew: boolean
}

export interface TqAutoAlert {
  id: string
  at: string               // ISO timestamp of the run
  mailbox: string
  checked: number          // unprocessed mails inspected this run
  processed: number        // mails successfully processed this run
  createdCount: number     // NEW bookings created this run
  updatedCount: number     // existing bookings updated this run
  errors: number
  byCountry: Record<string, number>   // e.g. { VN: 5, SL: 10, MY: 2 } — new bookings only
  bookings: TqAutoCreatedBooking[]
}

// ── Country short-label mapping ────────────────────────────────────────────────
function shortCountry(country: OperationCountry | null): string {
  switch (country) {
    case 'VIETNAM':            return 'VN'
    case 'SRILANKA':           return 'SL'
    case 'SINGAPORE':          return 'SG'
    case 'MALAYSIA':           return 'MY'
    case 'SINGAPORE_MALAYSIA': return 'SGMY'
    default:                   return '?'
  }
}

// ── Concurrency guard (single run at a time within this process) ───────────────
let running = false

/**
 * The TQ mailbox is the mailbox configured as TOUR_CONFIRMATION
 * (Outlookmail_USERNAME → confirm.booking@aahaas.com).
 */
function getTqMailbox() {
  return getConfiguredMailboxes().find(m => m.kind === 'TOUR_CONFIRMATION') ?? null
}

export async function isTqAutoEnabled(): Promise<boolean> {
  const row = await prisma.systemSetting.findUnique({ where: { key: TQ_AUTO_ENABLED_KEY } })
  // Default ON: only treat an explicit 'false' as disabled.
  return row?.value !== 'false'
}

export async function setTqAutoEnabled(enabled: boolean): Promise<void> {
  const value = enabled ? 'true' : 'false'
  await prisma.systemSetting.upsert({
    where:  { key: TQ_AUTO_ENABLED_KEY },
    update: { value },
    create: { key: TQ_AUTO_ENABLED_KEY, value },
  })
}

async function readAlerts(): Promise<TqAutoAlert[]> {
  const row = await prisma.systemSetting.findUnique({ where: { key: TQ_AUTO_ALERTS_KEY } })
  if (!row?.value) return []
  try {
    const parsed = JSON.parse(row.value)
    return Array.isArray(parsed) ? parsed as TqAutoAlert[] : []
  } catch {
    return []
  }
}

async function pushAlert(alert: TqAutoAlert): Promise<void> {
  const existing = await readAlerts()
  const next = [alert, ...existing].slice(0, MAX_ALERTS)
  const value = JSON.stringify(next)
  await prisma.systemSetting.upsert({
    where:  { key: TQ_AUTO_ALERTS_KEY },
    update: { value },
    create: { key: TQ_AUTO_ALERTS_KEY, value },
  })
}

export async function getTqAutoAlerts(): Promise<TqAutoAlert[]> {
  return readAlerts()
}

export interface TqAutoStatus {
  enabled: boolean
  mailbox: string | null
  running: boolean
  lastRunAt: string | null
  lastResult: string | null
}

export async function getTqAutoStatus(): Promise<TqAutoStatus> {
  const [enabled, statusRow] = await Promise.all([
    isTqAutoEnabled(),
    prisma.systemSetting.findUnique({ where: { key: TQ_AUTO_STATUS_KEY } }),
  ])
  let lastRunAt: string | null = null
  let lastResult: string | null = null
  if (statusRow?.value) {
    const [at, ...rest] = statusRow.value.split('|')
    lastRunAt = at || null
    lastResult = rest.join('|') || null
  }
  return {
    enabled,
    mailbox: getTqMailbox()?.user ?? null,
    running,
    lastRunAt,
    lastResult,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Core run — check the TQ mailbox and process only NEW mail
// ─────────────────────────────────────────────────────────────────────────────

export interface TqAutoRunResult {
  ok: boolean
  skipped?: string
  alert?: TqAutoAlert
}

/**
 * @param trigger  where the run came from (scheduler | vercel-cron | manual) — for logs only
 */
export async function runTqAutoProcess(trigger: string = 'scheduler'): Promise<TqAutoRunResult> {
  if (running) {
    console.log('[TQ-Auto] already running — skipping overlapping tick')
    return { ok: true, skipped: 'already-running' }
  }

  if (!(await isTqAutoEnabled())) {
    console.log('[TQ-Auto] disabled — enable in Mail Inbox → Auto-Processed tab')
    return { ok: true, skipped: 'disabled' }
  }

  const mailbox = getTqMailbox()
  if (!mailbox) {
    console.warn('[TQ-Auto] no TQ mailbox configured (Outlookmail_USERNAME) — nothing to do')
    return { ok: true, skipped: 'no-mailbox' }
  }

  running = true
  const startedAt = new Date()
  console.log(`[TQ-Auto] run start (${trigger}) — ${mailbox.user}`)

  const created: TqAutoCreatedBooking[] = []
  let checked = 0
  let processed = 0
  let updatedCount = 0
  let errors = 0

  try {
    // 1. Incremental Graph sync — pulls only mail newer than the last sync into the DB cache.
    await syncMailboxEmailsToDb({
      mailboxUser: mailbox.user,
      mailboxKind: mailbox.kind,
      limit:       50,
      folder:      'inbox',
    }).catch(() => {})

    // 2. Read the mail that has NOT been processed yet (status = RECEIVED) from the cache.
    const dbEmails = await listUnprocessedDbEmails(mailbox.user, 25).catch(() => [] as ProcessedEmail[])
    checked = dbEmails.length

    for (const email of dbEmails) {
      // Shared dedup key — if any other processor already handled this mail, skip it
      // so we never re-run GPT extraction and never spend tokens twice.
      const dedupKey = `processed_email_${email.graphId}`
      const already = await prisma.systemSetting.findUnique({ where: { key: dedupKey } })
      if (already) {
        // This mail was already processed (by this job or any other pipeline) but its
        // cached MailMessage is still RECEIVED, so it keeps reappearing in the window
        // and starves newer mail. Mark it PROCESSED so it leaves the unprocessed pool.
        const [bookingRef] = (already.value || '').split('|')
        await upsertCachedMailMessage({
          email, mailboxUser: mailbox.user, mailboxKind: mailbox.kind,
          bookingRef: bookingRef || undefined, status: 'PROCESSED',
          processedAt: new Date().toISOString(),
        }).catch(() => {})
        continue
      }

      try {
        await upsertCachedMailMessage({
          email, mailboxUser: mailbox.user, mailboxKind: mailbox.kind, status: 'RECEIVED',
        }).catch(() => {})

        // Timestamp taken just before processing — used to tell whether the booking
        // this mail resolves to was CREATED now (createdAt after this) or already
        // existed (an update). processMailboxEmail's public type omits `isNew`, so we
        // derive it here without touching that function.
        const beforeMs = Date.now()

        // Body is cached in rawBody; this call only fetches attachments from Graph.
        const { rawText, attachments } = await extractEmailSourceTextForUser(mailbox.user, email)
        const result = await processMailboxEmail({ ...email, rawBody: rawText }, mailbox.kind, attachments)

        if (result.status === 'PNL_WAITING') {
          // A PNL that has no matching TQ yet — leave it WAITING and DO NOT write the
          // dedup key, so it retries once the matching TQ booking exists.
          await upsertCachedMailMessage({
            email, mailboxUser: mailbox.user, mailboxKind: mailbox.kind,
            bookingRef: result.bookingRef, status: 'WAITING',
          }).catch(() => {})
          continue
        }

        // Mark processed (dedup) + update the cached message.
        await prisma.systemSetting.upsert({
          where:  { key: dedupKey },
          update: { value: `${result.bookingRef}|${new Date().toISOString()}` },
          create: { key: dedupKey, value: `${result.bookingRef}|${new Date().toISOString()}` },
        })
        await upsertCachedMailMessage({
          email, mailboxUser: mailbox.user, mailboxKind: mailbox.kind,
          bookingRef: result.bookingRef, status: 'PROCESSED',
          processedAt: new Date().toISOString(),
        }).catch(() => {})

        processed += 1

        // A booking whose createdAt is at/after beforeMs was created by THIS email —
        // otherwise the email updated a pre-existing booking.
        const booking = await prisma.booking.findUnique({
          where:  { bookingRef: result.bookingRef },
          select: { createdAt: true },
        }).catch(() => null)
        const isNew = booking ? booking.createdAt.getTime() >= beforeMs - 2000 : false

        if (isNew) {
          created.push({
            ref: result.bookingRef,
            country: shortCountry(detectCountryFromRef(result.bookingRef)),
            isNew: true,
          })
        } else {
          updatedCount += 1
        }
        console.log(`[TQ-Auto] ✓ ${isNew ? 'CREATED' : 'updated'} booking ${result.bookingRef}`)
      } catch (err) {
        errors += 1
        const msg = err instanceof Error ? err.message : String(err)
        console.error(`[TQ-Auto] failed (${email.graphId}):`, msg)
        await upsertCachedMailMessage({
          email, mailboxUser: mailbox.user, mailboxKind: mailbox.kind, status: 'ERROR',
        }).catch(() => {})
        await prisma.systemSetting.upsert({
          where:  { key: 'tq_auto_last_error' },
          update: { value: `${new Date().toISOString()} | ${mailbox.user} | ${msg.slice(0, 500)}` },
          create: { key: 'tq_auto_last_error', value: `${new Date().toISOString()} | ${mailbox.user} | ${msg.slice(0, 500)}` },
        }).catch(() => {})
      }
    }

    // Group NEW bookings by country for the alert badges (VN-5, SL-10, MY-2 …)
    const byCountry: Record<string, number> = {}
    for (const b of created) byCountry[b.country] = (byCountry[b.country] ?? 0) + 1

    const alert: TqAutoAlert = {
      id: `${startedAt.getTime()}`,
      at: startedAt.toISOString(),
      mailbox: mailbox.user,
      checked,
      processed,
      createdCount: created.length,
      updatedCount,
      errors,
      byCountry,
      bookings: created,
    }

    // Only persist a visible alert when there was something new to report; still
    // always record the last-run status so the UI can show "last checked".
    if (created.length > 0) await pushAlert(alert)

    const summary = `checked ${checked}, processed ${processed}, created ${created.length}, updated ${updatedCount}, errors ${errors}`
    await prisma.systemSetting.upsert({
      where:  { key: TQ_AUTO_STATUS_KEY },
      update: { value: `${new Date().toISOString()}|${summary}` },
      create: { key: TQ_AUTO_STATUS_KEY, value: `${new Date().toISOString()}|${summary}` },
    }).catch(() => {})

    console.log(`[TQ-Auto] run done — ${summary}`)
    return { ok: true, alert: created.length > 0 ? alert : undefined }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[TQ-Auto] run error:', msg)
    await prisma.systemSetting.upsert({
      where:  { key: TQ_AUTO_STATUS_KEY },
      update: { value: `${new Date().toISOString()}|ERROR: ${msg.slice(0, 300)}` },
      create: { key: TQ_AUTO_STATUS_KEY, value: `${new Date().toISOString()}|ERROR: ${msg.slice(0, 300)}` },
    }).catch(() => {})
    return { ok: false }
  } finally {
    running = false
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// node-cron scheduler — started once at boot from instrumentation.ts
// ─────────────────────────────────────────────────────────────────────────────

let task: ScheduledTask | null = null

export function startTqAutoScheduler(): void {
  if (task) return   // already started in this process

  task = cron.schedule(EVERY_5_MIN, () => {
    void runTqAutoProcess('scheduler')
  })

  // Delayed first run so the server is fully ready before hitting Graph/OpenAI.
  setTimeout(() => { void runTqAutoProcess('boot') }, 45_000)

  console.log('[TQ-Auto] scheduler started — checks the TQ mailbox every 5 min (node-cron)')
}
