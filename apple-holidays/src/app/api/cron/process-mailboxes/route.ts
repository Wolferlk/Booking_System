import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import {
  getConfiguredMailboxes,
  fetchUnprocessedEmailsForUser,
  extractEmailSourceTextForUser,
} from '@/lib/mail-processor'
import { processMailboxEmail } from '@/lib/incoming-mail-automation'
import type { ProcessedEmail } from '@/lib/mail-processor'
import { getLessCreditModeEnabled, RECENT_MAIL_WINDOW_MINUTES } from '@/lib/mail-mode'
import { upsertCachedMailMessage } from '@/lib/mail-cache'

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
        update: { value: `${new Date().toISOString()} | ${mailboxUser} | ${msg.slice(0, 5)}` },
        create: { key: 'mailbox_cron_last_error', value: `${new Date().toISOString()} | ${msg.slice(0, 500)}` },
      })
    }
  }

  summaries.push({ mailbox: mailboxUser, checked: emails.length, processed, skipped })
}

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET ?? process.env.WEBHOOK_SECRET}`) {
    return unauthorized()
  }

  const summaries: Array<{ mailbox: string; checked: number; processed: number; skipped: number }> = []
  const lessCreditMode = await getLessCreditModeEnabled()
  const cutoffMs = RECENT_MAIL_WINDOW_MINUTES * 60 * 1000

  // All mailboxes (TQ + PNL) are fetched via Microsoft Graph API
  // getConfiguredMailboxes() returns:
  //   • confirm.booking@aahaas.com   → TOUR_CONFIRMATION (Azure_* credentials)
  //   • accounts.payable@aahaas.com  → PNL               (GRAPH_* credentials)
  const mailboxes = getConfiguredMailboxes()
  for (const mailbox of mailboxes) {
    const emails = await fetchUnprocessedEmailsForUser(mailbox.user, 25, 'inbox').catch(() => [] as ProcessedEmail[])
    const scopedEmails = lessCreditMode
      ? emails.filter(email => Date.now() - new Date(email.date).getTime() <= cutoffMs)
      : emails
    await processEmailBatch(scopedEmails, mailbox.user, mailbox.kind, summaries)
  }

  return NextResponse.json({ ok: true, summaries })
}
