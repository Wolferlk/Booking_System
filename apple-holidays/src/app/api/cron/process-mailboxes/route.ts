import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import {
  getConfiguredMailboxes,
  extractEmailSourceTextForUser,
} from '@/lib/mail-processor'
import { processMailboxEmail } from '@/lib/incoming-mail-automation'
import type { ProcessedEmail } from '@/lib/mail-processor'
import { getLessCreditModeEnabled, RECENT_MAIL_WINDOW_MINUTES } from '@/lib/mail-mode'
import { upsertCachedMailMessage, syncMailboxEmailsToDb, listUnprocessedDbEmails } from '@/lib/mail-cache'
import { fetchImapPayableEmails, fetchImapAttachments, IMAP_PNL_USER } from '@/lib/imap-pnl'

export const dynamic = 'force-dynamic'

function unauthorized() {
  return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
}

async function processEmailBatch(
  emails: ProcessedEmail[],
  mailboxUser: string,
  kind: 'TOUR_CONFIRMATION' | 'PNL',
  summaries: Array<{ mailbox: string; checked: number; processed: number; skipped: number }>,
) {
  let processed = 0
  let skipped = 0

  for (const email of emails) {
    // Dedup: skip emails already marked processed in systemSetting (guards against
    // race conditions when the webhook and cron fire at the same time)
    const dedupKey = `processed_email_${email.graphId}`
    const already = await prisma.systemSetting.findUnique({ where: { key: dedupKey } })
    if (already) { skipped += 1; continue }

    try {
      await upsertCachedMailMessage({
        email,
        mailboxUser,
        mailboxKind: kind,
        status: 'RECEIVED',
      }).catch(() => {})

      // Body is already cached in rawBody; this call only hits Graph API for attachments
      const { rawText, attachments } = await extractEmailSourceTextForUser(mailboxUser, email)
      const result = await processMailboxEmail({ ...email, rawBody: rawText }, kind, attachments)

      await prisma.systemSetting.upsert({
        where:  { key: dedupKey },
        update: { value: `${result.bookingRef}|${new Date().toISOString()}` },
        create: { key: dedupKey, value: `${result.bookingRef}|${new Date().toISOString()}` },
      })
      await upsertCachedMailMessage({
        email,
        mailboxUser,
        mailboxKind: kind,
        bookingRef: result.bookingRef,
        status: 'PROCESSED',
        processedAt: new Date().toISOString(),
      }).catch(() => {})
      processed += 1
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      await upsertCachedMailMessage({
        email,
        mailboxUser,
        mailboxKind: kind,
        status: 'ERROR',
      }).catch(() => {})
      await prisma.systemSetting.upsert({
        where:  { key: 'mailbox_cron_last_error' },
        update: { value: `${new Date().toISOString()} | ${mailboxUser} | ${msg.slice(0, 500)}` },
        create: { key: 'mailbox_cron_last_error', value: `${new Date().toISOString()} | ${msg.slice(0, 500)}` },
      })
    }
  }

  summaries.push({ mailbox: mailboxUser, checked: emails.length, processed, skipped })
}

// ── IMAP payable mailbox processor ───────────────────────────────────────────
// Runs only when IMAP2_USERNAME is set AND is not already covered by GRAPH_PNL_USER.
// Fetches PNL emails via IMAP, processes each one into a booking PNL, and records
// a dedup key so re-runs skip already-processed messages.

async function processImapPayableEmails(
  summaries: Array<{ mailbox: string; checked: number; processed: number; skipped: number }>,
  lessCreditMode: boolean,
  cutoffMs: number,
) {
  if (!IMAP_PNL_USER) return

  // Skip if the same address is already being handled through Microsoft Graph
  const graphMailboxes = getConfiguredMailboxes()
  if (graphMailboxes.some(mb => mb.user === IMAP_PNL_USER)) return

  const emails = await fetchImapPayableEmails(25).catch(() => [])

  const scopedEmails = lessCreditMode
    ? emails.filter(e => Date.now() - new Date(e.date).getTime() <= cutoffMs)
    : emails

  let processed = 0
  let skipped = 0

  for (const email of scopedEmails) {
    const dedupKey = `processed_email_${email.graphId}`
    const already = await prisma.systemSetting.findUnique({ where: { key: dedupKey } })
    if (already) { skipped += 1; continue }

    try {
      await upsertCachedMailMessage({
        email,
        mailboxUser: IMAP_PNL_USER,
        mailboxKind: 'PNL',
        status: 'RECEIVED',
      }).catch(() => {})

      const attachments = email.hasAttachments
        ? await fetchImapAttachments(email.graphId).catch(() => [])
        : []

      const result = await processMailboxEmail(email, 'PNL', attachments)

      await prisma.systemSetting.upsert({
        where:  { key: dedupKey },
        update: { value: `${result.bookingRef}|${new Date().toISOString()}` },
        create: { key: dedupKey, value: `${result.bookingRef}|${new Date().toISOString()}` },
      })
      await upsertCachedMailMessage({
        email,
        mailboxUser: IMAP_PNL_USER,
        mailboxKind: 'PNL',
        bookingRef: result.bookingRef,
        status: 'PROCESSED',
        processedAt: new Date().toISOString(),
      }).catch(() => {})

      console.log(`[IMAP-Cron] ✓ processed PNL → booking ${result.bookingRef}`)
      processed += 1
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[IMAP-Cron] processing failed:', msg)
      await upsertCachedMailMessage({
        email,
        mailboxUser: IMAP_PNL_USER,
        mailboxKind: 'PNL',
        status: 'ERROR',
      }).catch(() => {})
      await prisma.systemSetting.upsert({
        where:  { key: 'imap_cron_last_error' },
        update: { value: `${new Date().toISOString()} | ${IMAP_PNL_USER} | ${msg.slice(0, 500)}` },
        create: { key: 'imap_cron_last_error', value: `${new Date().toISOString()} | ${IMAP_PNL_USER} | ${msg.slice(0, 500)}` },
      })
    }
  }

  summaries.push({ mailbox: `${IMAP_PNL_USER} (IMAP)`, checked: scopedEmails.length, processed, skipped })
}

// ── Cron handler ──────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET ?? process.env.WEBHOOK_SECRET}`) {
    return unauthorized()
  }

  const summaries: Array<{ mailbox: string; checked: number; processed: number; skipped: number }> = []
  const lessCreditMode = await getLessCreditModeEnabled()
  const cutoffMs = RECENT_MAIL_WINDOW_MINUTES * 60 * 1000

  // All mailboxes (TQ + PNL) use Microsoft Graph API via the DB cache layer:
  //   • Incremental sync: only fetches emails newer than the last cron run
  //   • Body already stored in DB from webhook or prior sync — no redundant Graph API calls
  //   • Dedup via systemSetting prevents re-processing even if webhook already handled it
  const mailboxes = getConfiguredMailboxes()

  for (const mailbox of mailboxes) {
    // 1. Incremental Graph API sync — only emails received since last sync timestamp
    await syncMailboxEmailsToDb({
      mailboxUser: mailbox.user,
      mailboxKind: mailbox.kind,
      limit: 50,
      folder: 'inbox',
    }).catch(() => {})

    // 2. Read all unprocessed (status=RECEIVED) emails from DB cache — no additional Graph API calls
    const dbEmails = await listUnprocessedDbEmails(mailbox.user, 25).catch(() => [] as ProcessedEmail[])

    const scopedEmails = lessCreditMode
      ? dbEmails.filter(email => Date.now() - new Date(email.date).getTime() <= cutoffMs)
      : dbEmails

    await processEmailBatch(scopedEmails, mailbox.user, mailbox.kind, summaries)
  }

  // IMAP payable mailbox — runs only if IMAP2_USERNAME is set and not covered by Graph
  await processImapPayableEmails(summaries, lessCreditMode, cutoffMs)

  return NextResponse.json({ ok: true, summaries })
}
