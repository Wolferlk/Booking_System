/**
 * "Retry all failed" for the WhatsApp inbox — resend every outbound message
 * that Meta reported as not delivered since a given moment (the desk's "today").
 *
 * What is stored is the text, not how it was sent: a row does not remember its
 * template name or parameters. So a retry sends the TEXT again the same way a
 * desk reply would (see /api/whatsapp/send): free-form inside the 24h window,
 * the guest-message template for a booking's guest outside it, otherwise the
 * re-engagement template. Only rows whose body IS what the recipient saw are
 * resent: desk replies and the guest daily plan / feedback invite. Other
 * automations log a note ("Sent … via template …"), a placeholder or send a
 * PDF alongside, so those — and attachments — are listed as skipped instead.
 *
 * A retried row moves to status `retried` (so a second click cannot send it
 * twice) and the resend is logged as a new row under the same sender tag.
 */
import { prisma } from '@/lib/prisma'
import {
  findBookingByPhone, isWithin24hWindow, normalisePhone, sendViaMetaApi, sendViaMetaTemplate,
} from '@/lib/whatsapp'
import { sendGuestMessageTemplate, GuestTemplateUnavailableError } from '@/lib/guest-message-template'
import { failureDetailsFor, NON_RETRYABLE_FAILURES } from '@/lib/whatsapp-shared-inbox-sync'
import { rowsInScope } from '@/lib/whatsapp-message-report'

/** Meta's code for "the business account has a payment problem". */
const BILLING_BLOCK = 131042
/** Sends per request — keeps one call well inside the serverless time limit. */
export const RETRY_BATCH = 40

export interface FailedItem {
  id: string
  phone: string
  bookingRef: string
  tag: string
  preview: string
  createdAt: Date
  code: number | null
  reason: string | null
  /** Why this one will not be retried; null when it will be. */
  skip: string | null
}

export interface FailedSummary {
  items: FailedItem[]
  retryable: number
  skipped: number
  /** Today's failures include Meta's billing block — a retry will most likely fail the same way. */
  billingBlocked: boolean
}

/** The guest-message template wraps the desk's text; a retry re-wraps it, so unwrap first. */
const GUEST_WRAPPER = /^Hello .+?, here is an update about your trip \(booking .+?\):\n\n([\s\S]*?)\n\nIf you have any questions, simply reply to this message/

function retryText(body: string | null): string {
  const text = (body ?? '').trim()
  const wrapped = GUEST_WRAPPER.exec(text)
  return wrapped ? wrapped[1].trim() : text
}

/** Automations whose logged body is the exact text the guest received. */
const RESENDABLE_TAGS = ['[DAILY-BRIEFING]', '[FEEDBACK-REQUEST]']

/** A desk reply (staff name) or an automation whose body can be sent again as-is. */
function resendable(senderName: string | null): boolean {
  const s = (senderName ?? '').trim()
  if (!s || /Auto-Send$/.test(s)) return false
  return s.startsWith('[') ? RESENDABLE_TAGS.some(t => s.startsWith(t)) : true
}

function tagOf(senderName: string | null): string {
  return /^\[[A-Z0-9-]+\]/.exec(senderName ?? '')?.[0] ?? (senderName ? 'Desk' : 'System')
}

/** Every failed outbound message since `since`, with why it failed and whether it can be retried. */
export async function listFailedSince(since: Date, role: string | undefined | null): Promise<FailedSummary> {
  const rows = await rowsInScope(role, await prisma.whatsAppMessage.findMany({
    where:   { direction: 'outbound', status: 'failed', createdAt: { gte: since } },
    orderBy: { createdAt: 'asc' },
    take:    1000,
    select: {
      id: true, phone: true, bookingRef: true, body: true, senderName: true,
      waMessageId: true, mediaUrl: true, mediaType: true, createdAt: true,
    },
  }))

  const details = await failureDetailsFor(rows.map(r => r.waMessageId).filter((x): x is string => !!x))

  const items: FailedItem[] = rows.map(r => {
    const d = r.waMessageId ? details.get(r.waMessageId) : undefined
    const text = retryText(r.body)
    const skip =
      r.mediaUrl || r.mediaType               ? 'Attachment — resend it from the chat' :
      !resendable(r.senderName)               ? 'Automated send — resend it from the screen that sent it' :
      !text                                   ? 'No text to resend' :
      /^\[Template: /.test(text)              ? 'Template with unknown details — use "Send template" in the chat' :
      d?.code != null && NON_RETRYABLE_FAILURES.has(d.code) ? 'Meta says a retry cannot reach this number' :
      null
    return {
      id: r.id, phone: r.phone, bookingRef: r.bookingRef, tag: tagOf(r.senderName),
      preview: text.replace(/\s+/g, ' ').slice(0, 140), createdAt: r.createdAt,
      code: d?.code ?? null, reason: d?.reason ?? null, skip,
    }
  })

  const retryable = items.filter(i => !i.skip).length
  return {
    items,
    retryable,
    skipped: items.length - retryable,
    billingBlocked: items.some(i => i.code === BILLING_BLOCK),
  }
}

export interface RetryOutcome {
  retried: number
  failed: { id: string; phone: string; error: string }[]
  skipped: number
  /** Retryable rows left for the next batch. */
  remaining: number
}

/** Resend up to RETRY_BATCH of today's failed messages. */
export async function retryFailedSince(since: Date, role: string | undefined | null, staffName: string): Promise<RetryOutcome> {
  const summary = await listFailedSince(since, role)
  const todo = summary.items.filter(i => !i.skip)
  const batch = todo.slice(0, RETRY_BATCH)
  const out: RetryOutcome = { retried: 0, failed: [], skipped: summary.skipped, remaining: todo.length - batch.length }

  for (const item of batch) {
    const row = await prisma.whatsAppMessage.findUnique({
      where:  { id: item.id },
      select: { body: true, senderName: true, status: true },
    })
    if (!row || row.status !== 'failed') continue // another click already took it

    try {
      await resendText({
        phone:      item.phone,
        bookingRef: item.bookingRef,
        text:       retryText(row.body),
        senderName: row.senderName ?? staffName,
      })
      await prisma.whatsAppMessage.update({ where: { id: item.id }, data: { status: 'retried' } })
      out.retried += 1
    } catch (err) {
      out.failed.push({ id: item.id, phone: item.phone, error: err instanceof Error ? err.message : String(err) })
    }
  }
  return out
}

/** One text, sent the way the desk's composer would send it now. Throws when nothing can carry it. */
async function resendText(p: { phone: string; bookingRef: string; text: string; senderName: string }) {
  const phone = normalisePhone(p.phone)
  const log = (body: string, waMessageId: string | null, status = 'sent') =>
    prisma.whatsAppMessage.create({
      data: { bookingRef: p.bookingRef, phone, direction: 'outbound', body, waMessageId, status, senderName: p.senderName },
    })

  if (await isWithin24hWindow(phone)) {
    const result = await sendViaMetaApi({ to: phone, message: p.text })
    if (!result) throw new Error('WhatsApp is not configured')
    await log(p.text, (result.text as { messages?: Array<{ id?: string }> })?.messages?.[0]?.id ?? null)
    return
  }

  // Outside the window: a booking's guest gets the guest-message template.
  const booking = await findBookingByPhone(phone)
  const isGuest = !!booking &&
    [booking.contactWhatsapp, booking.contactPhone].some(n => n && normalisePhone(n) === phone)
  if (booking && isGuest) {
    try {
      const lead = await prisma.passenger.findFirst({
        where:  { bookingId: booking.id, isLead: true },
        select: { name: true },
      })
      const sent = await sendGuestMessageTemplate({
        to: phone, guestName: lead?.name ?? 'Guest', bookingRef: booking.bookingRef, text: p.text,
      })
      for (const part of sent.sent) await log(part.text, part.waMessageId)
      if (sent.unsent) await log(sent.unsent, null, 'pending')
      return
    } catch (err) {
      if (!(err instanceof GuestTemplateUnavailableError)) throw err
    }
  }

  const reengage = process.env.WHATSAPP_REENGAGE_TEMPLATE?.trim()
  if (reengage) {
    const result = await sendViaMetaTemplate({
      to: phone,
      templateName: reengage,
      lang: process.env.WHATSAPP_REENGAGE_TEMPLATE_LANG?.trim() || 'en',
      bodyParams: [p.text],
    })
    if (!result) throw new Error('WhatsApp is not configured')
    await log(p.text, (result.template as { messages?: Array<{ id?: string }> })?.messages?.[0]?.id ?? null)
    return
  }

  throw new Error('Outside the 24h window and no approved template can carry this text')
}
