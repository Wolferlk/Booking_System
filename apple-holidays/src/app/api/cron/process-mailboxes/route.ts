import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import {
  getConfiguredMailboxes,
  fetchUnprocessedEmailsForUser,
  extractEmailSourceTextForUser,
} from '@/lib/mail-processor'
import { processMailboxEmail } from '@/lib/incoming-mail-automation'

export const dynamic = 'force-dynamic'

function unauthorized() {
  return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
}

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET ?? process.env.WEBHOOK_SECRET}`) {
    return unauthorized()
  }

  const mailboxes = getConfiguredMailboxes()
  if (mailboxes.length === 0) {
    return NextResponse.json({ ok: false, error: 'No mailboxes configured' }, { status: 400 })
  }

  const summaries: Array<{
    mailbox: string
    checked: number
    processed: number
    skipped: number
  }> = []

  for (const mailbox of mailboxes) {
    const emails = await fetchUnprocessedEmailsForUser(mailbox.user, 25, 'inbox')
    let processed = 0
    let skipped = 0

    for (const email of emails) {
      const dedupKey = `processed_email_${email.graphId}`
      const already = await prisma.systemSetting.findUnique({ where: { key: dedupKey } })
      if (already) {
        skipped += 1
        continue
      }

      try {
        const { rawText, attachments } = await extractEmailSourceTextForUser(mailbox.user, email)
        const result = await processMailboxEmail({ ...email, rawBody: rawText }, mailbox.kind, attachments)
        await prisma.systemSetting.upsert({
          where: { key: dedupKey },
          update: { value: `${result.bookingRef}|${new Date().toISOString()}` },
          create: { key: dedupKey, value: `${result.bookingRef}|${new Date().toISOString()}` },
        })
        processed += 1
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        await prisma.systemSetting.upsert({
          where: { key: 'mailbox_cron_last_error' },
          update: { value: `${new Date().toISOString()} | ${mailbox.user} | ${msg.slice(0, 500)}` },
          create: { key: 'mailbox_cron_last_error', value: `${new Date().toISOString()} | ${mailbox.user} | ${msg.slice(0, 500)}` },
        })
      }
    }

    summaries.push({
      mailbox: mailbox.user,
      checked: emails.length,
      processed,
      skipped,
    })
  }

  return NextResponse.json({ ok: true, summaries })
}
