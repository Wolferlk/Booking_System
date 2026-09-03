import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { requireMailbox, toStringArray } from '@/lib/mailbox/guard'
import { buildTokens, renderTemplate } from '@/lib/mailbox/tokens'
import { sendTrackedMail, normaliseAddresses, mailboxSenderAddress } from '@/lib/mailbox/send'
import { alwaysCcAddresses, getMailTestMode, matchAgentForBooking } from '@/lib/mailbox/resolve'
import { htmlToText } from '@/lib/mailbox/sync'
import { generateConfirmationPdf } from '@/lib/generate-booking-pdf'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

interface SendBody {
  bookingRef?: string
  templateId?: string | null
  agentId?: string | null
  to?: string[] | string
  cc?: string[] | string
  subject?: string
  bodyHtml?: string
  attachPdf?: boolean
}

export async function POST(req: NextRequest) {
  const gate = await requireMailbox('use')
  if ('error' in gate) return gate.error

  const body = await req.json().catch(() => null) as SendBody | null
  if (!body) return buildApiError('Invalid request body')

  const ref = body.bookingRef?.trim() || null

  const booking = ref
    ? await prisma.booking.findUnique({
        where: { bookingRef: ref },
        include: {
          passengers:     { orderBy: [{ isLead: 'desc' }, { name: 'asc' }] },
          accommodations: { orderBy: { checkIn: 'asc' } },
          flights:        { orderBy: { date: 'asc' } },
        },
      })
    : null
  if (ref && !booking) return buildApiError('Booking not found', 404)

  const template = body.templateId
    ? await prisma.mailTemplate.findUnique({ where: { id: body.templateId } })
    : null
  if (body.templateId && !template) return buildApiError('Template not found', 404)

  const agent = body.agentId
    ? await prisma.mailAgent.findUnique({ where: { id: body.agentId } })
    : booking ? (await matchAgentForBooking(booking)).agent : null

  // The body is re-rendered here from the stored template rather than trusted
  // from the client. The browser's preview is a preview; this is the message.
  const tokens = buildTokens(booking, gate.actor, agent)
  const subject  = renderTemplate(body.subject?.trim() || template?.subject || '', tokens)
  const bodyHtml = renderTemplate(body.bodyHtml || template?.bodyHtml || '', tokens)

  if (!subject)  return buildApiError('A subject is required')
  if (!bodyHtml.trim()) return buildApiError('The message body is empty')

  const requestedTo = normaliseAddresses(toStringArray(body.to))
  if (requestedTo.length === 0) return buildApiError('At least one "To" recipient is required')

  // Internal copies are re-added server-side. The compose window shows them as
  // locked chips, but a hand-rolled request could simply omit them — and "every
  // Mail Box send is copied to the Aahaas team" is the kind of rule that is only
  // true if it is true on the server.
  const templateCc = template ? toStringArray(template.ccEmails) : []
  const internalCc = await alwaysCcAddresses()

  let to = requestedTo
  let cc = normaliseAddresses([...toStringArray(body.cc), ...templateCc, ...internalCc])

  // Test mode diverts the whole send, exactly as it does for the existing
  // confirmation sender, so flipping the switch never leaves one path live.
  const testMode = await getMailTestMode()
  if (testMode.enabled) {
    to = normaliseAddresses([testMode.to])
    cc = normaliseAddresses([testMode.cc])
  }

  let attachments: { name: string; contentType: string; buffer: Buffer }[] | undefined
  const wantsPdf = body.attachPdf === true || (body.attachPdf === undefined && template?.attachPdf === true)
  if (wantsPdf && booking) {
    try {
      const full = await prisma.booking.findUnique({
        where: { bookingRef: booking.bookingRef },
        include: {
          passengers:        { orderBy: [{ isLead: 'desc' }, { name: 'asc' }] },
          flights:           { orderBy: { date: 'asc' } },
          accommodations:    { orderBy: { checkIn: 'asc' } },
          itineraryItems:    { orderBy: { dayNo: 'asc' } },
          emergencyContacts: true,
          tourAgenda: { include: { items: { orderBy: [{ date: 'asc' }, { sortOrder: 'asc' }], include: { assignment: true } } } },
        },
      })
      const pdf = await generateConfirmationPdf(full)
      attachments = [{
        name: `AppleHolidays-${booking.bookingRef}.pdf`,
        contentType: 'application/pdf',
        buffer: pdf,
      }]
    } catch (err) {
      // A PDF that will not render must not silently become a mail without one —
      // the operator ticked the box for a reason.
      return buildApiError(`Could not build the booking PDF: ${err instanceof Error ? err.message : 'unknown error'}`)
    }
  }

  // The thread row is written first, as FAILED, so a send that throws still
  // leaves a record of what was attempted and why it did not go.
  const thread = await prisma.mailThread.create({
    data: {
      bookingRef:  ref,
      agentId:     agent?.id ?? null,
      templateId:  template?.id ?? null,
      subject,
      toAddresses: to.join(', '),
      ccAddresses: cc.join(', '),
      mailboxUser: mailboxSenderAddress(),
      status:      'FAILED',
      error:       'Send not completed',
      sentByName:  gate.actor.name,
      sentByEmail: gate.actor.email,
      operationCountry: booking?.operationCountry ?? null,
      lastMessageAt: new Date(),
    },
  })

  try {
    const sent = await sendTrackedMail({
      to, cc, subject, bodyHtml, attachments,
      replyTo: gate.actor.email || undefined,
    })

    const now = new Date()
    await prisma.$transaction([
      prisma.mailThread.update({
        where: { id: thread.id },
        data: {
          status:            'SENT',
          error:             null,
          conversationId:    sent.conversationId,
          internetMessageId: sent.internetMessageId?.slice(0, 190) ?? null,
          graphMessageId:    sent.graphMessageId,
          lastMessageAt:     now,
          lastSyncedAt:      now,
        },
      }),
      prisma.mailThreadMessage.create({
        data: {
          threadId:    thread.id,
          direction:   'OUT',
          graphId:     sent.graphMessageId,
          internetMessageId: sent.internetMessageId?.slice(0, 190) ?? null,
          fromAddress: sent.mailboxUser,
          fromName:    gate.actor.name,
          toAddresses: to.join(', '),
          ccAddresses: cc.join(', '),
          subject,
          bodyHtml,
          bodyText:    htmlToText(bodyHtml).slice(0, 100_000),
          hasAttachments: !!attachments?.length,
          isRead:      true,
          sentAt:      now,
        },
      }),
    ])

    return buildApiSuccess(
      { threadId: thread.id, to, cc, testMode: testMode.enabled },
      testMode.enabled
        ? `Test mode is ON — sent to ${to.join(', ')} instead of the agent.`
        : `Sent to ${to.join(', ')}`,
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Send failed'
    await prisma.mailThread.update({
      where: { id: thread.id },
      data: { status: 'FAILED', error: message.slice(0, 2000) },
    })
    return buildApiError(message, 502)
  }
}
