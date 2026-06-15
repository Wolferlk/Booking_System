import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { waitUntil } from '@vercel/functions'
import {
  lookupSubscription,
  fetchMessageByIdForUser,
  extractEmailSourceTextForUser,
} from '@/lib/mail-processor'
import { processMailboxEmail } from '@/lib/incoming-mail-automation'
import { upsertCachedMailMessage } from '@/lib/mail-cache'

export const dynamic = 'force-dynamic'

function validationResponse(token: string) {
  return new NextResponse(decodeURIComponent(token), {
    status: 200,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  })
}

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('validationToken')
  if (token) return validationResponse(token)
  return new NextResponse('Webhook OK', { status: 200 })
}

export async function POST(req: NextRequest) {
  const validationToken = req.nextUrl.searchParams.get('validationToken')
  if (validationToken) return validationResponse(validationToken)

  let body: GraphNotificationPayload
  try {
    body = await req.json() as GraphNotificationPayload
  } catch {
    return new NextResponse('Bad Request', { status: 400 })
  }

  const secret = process.env.WEBHOOK_SECRET ?? 'aahaas-webhook-secret'

  waitUntil(
    processNotifications(body.value ?? [], secret).catch(err =>
      console.error('[Webhook] processing error:', err),
    ),
  )

  return new NextResponse(null, { status: 202 })
}

async function processNotifications(notifications: GraphNotification[], secret: string) {
  for (const notif of notifications) {
    if (notif.clientState !== secret) {
      console.warn('[Webhook] invalid clientState, skipping')
      continue
    }
    if (notif.changeType !== 'created') continue

    const graphId = notif.resourceData?.id
    if (!graphId) continue

    // Dedup — skip if already processed
    const dedupKey = `processed_email_${graphId}`
    const already  = await prisma.systemSetting.findUnique({ where: { key: dedupKey } })
    if (already) {
      console.log('[Webhook] already processed, skipping', graphId)
      continue
    }

    // Resolve which mailbox this subscription belongs to
    let mailboxUser = process.env.Outlookmail_USERNAME ?? ''
    let mailboxKind: 'TOUR_CONFIRMATION' | 'PNL' = 'TOUR_CONFIRMATION'

    const sub = await lookupSubscription(notif.subscriptionId)
    if (sub) {
      mailboxUser = sub.user
      mailboxKind = sub.kind
    } else {
      // Legacy subscription created before multi-mailbox support — default to TQ mailbox
      console.warn('[Webhook] subscriptionId not in DB, defaulting to TQ mailbox:', notif.subscriptionId)
    }

    if (!mailboxUser) {
      console.warn('[Webhook] no mailbox user resolved, skipping', graphId)
      continue
    }

    console.log(`[Webhook] new ${mailboxKind} email (${mailboxUser}), graphId:`, graphId)

    const email = await fetchMessageByIdForUser(mailboxUser, graphId)
    if (!email) {
      console.warn('[Webhook] could not fetch message', graphId)
      continue
    }

    await upsertCachedMailMessage({
      email,
      mailboxUser,
      mailboxKind,
      status: 'RECEIVED',
    }).catch(() => {})

    try {
      const { rawText, attachments } = await extractEmailSourceTextForUser(mailboxUser, email)
      const result = await processMailboxEmail({ ...email, rawBody: rawText }, mailboxKind, attachments)

      await prisma.systemSetting.upsert({
        where:  { key: dedupKey },
        update: { value: `${result.bookingRef}|${new Date().toISOString()}` },
        create: { key: dedupKey, value: `${result.bookingRef}|${new Date().toISOString()}` },
      })

      await upsertCachedMailMessage({
        email,
        mailboxUser,
        mailboxKind,
        bookingRef: result.bookingRef,
        status: 'PROCESSED',
        processedAt: new Date().toISOString(),
      }).catch(() => {})

      console.log(`[Webhook] ✓ processed ${mailboxKind} → booking ${result.bookingRef}`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[Webhook] processing failed:', msg)
      await upsertCachedMailMessage({
        email,
        mailboxUser,
        mailboxKind,
        status: 'ERROR',
      }).catch(() => {})
      await prisma.systemSetting.upsert({
        where:  { key: 'webhook_last_error' },
        update: { value: `${new Date().toISOString()} | ${mailboxUser} | ${graphId} | ${msg.slice(0, 500)}` },
        create: { key: 'webhook_last_error', value: `${new Date().toISOString()} | ${mailboxUser} | ${graphId} | ${msg.slice(0, 500)}` },
      })
    }
  }
}

interface GraphNotificationPayload { value?: GraphNotification[] }

interface GraphNotification {
  subscriptionId: string
  changeType: string
  clientState: string
  resourceData?: { id?: string }
}
