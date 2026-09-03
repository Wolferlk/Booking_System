import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { requireMailbox } from '@/lib/mailbox/guard'
import { buildTokens, renderTemplate, TOKEN_CATALOGUE } from '@/lib/mailbox/tokens'
import {
  matchAgentForBooking, agentAddresses, internalRecipients, getMailTestMode,
} from '@/lib/mailbox/resolve'
import { normaliseAddresses } from '@/lib/mailbox/send'

export const dynamic = 'force-dynamic'

/**
 * Everything the compose window needs, in one round trip: the booking's facts,
 * the auto-detected agent and why it matched, the ready-made recipient lines,
 * the active templates already rendered against this booking, and the
 * correspondence so far.
 *
 * Rendering server-side rather than shipping raw templates to the browser keeps
 * one substitution implementation. A preview that differs from what is sent is
 * worse than no preview, and two renderers eventually differ.
 */
export async function GET(req: NextRequest) {
  const gate = await requireMailbox('use')
  if ('error' in gate) return gate.error

  const ref = req.nextUrl.searchParams.get('ref')?.trim()
  if (!ref) return buildApiError('Booking reference is required')

  const booking = await prisma.booking.findUnique({
    where: { bookingRef: ref },
    include: {
      passengers:     { orderBy: [{ isLead: 'desc' }, { name: 'asc' }] },
      accommodations: { orderBy: { checkIn: 'asc' } },
      flights:        { orderBy: { date: 'asc' } },
    },
  })
  if (!booking) return buildApiError('Booking not found', 404)

  const [match, templates, internal, testMode, threads] = await Promise.all([
    matchAgentForBooking(booking),
    prisma.mailTemplate.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    }),
    internalRecipients(),
    getMailTestMode(),
    prisma.mailThread.findMany({
      where: { bookingRef: ref },
      orderBy: { lastMessageAt: 'desc' },
      include: {
        agent:    { select: { id: true, name: true } },
        template: { select: { id: true, name: true } },
        _count:   { select: { messages: true } },
      },
    }),
  ])

  const tokens = buildTokens(booking, gate.actor, match.agent)
  const fromDirectory = agentAddresses(match.agent)

  // The booking's own `agentEmail` is a real address even when the directory has
  // never heard of this operator, so it seeds the To line as a fallback. Without
  // it, an un-catalogued agent would open the window empty and look broken.
  const suggestedTo = fromDirectory.to.length
    ? fromDirectory.to
    : normaliseAddresses([booking.agentEmail])

  const suggestedCc = normaliseAddresses([
    ...fromDirectory.cc,
    // The traveller's own contact address, when it is a different person.
    ...(booking.contactEmail && booking.contactEmail !== booking.agentEmail ? [booking.contactEmail] : []),
  ])

  return buildApiSuccess({
    booking: {
      bookingRef: booking.bookingRef,
      agent: booking.agent,
      agentEmail: booking.agentEmail,
      contactEmail: booking.contactEmail,
      fileHandler: booking.fileHandler,
      status: booking.status,
      arrivalDate: booking.arrivalDate,
      departureDate: booking.departureDate,
      operationCountry: booking.operationCountry,
      leadPassenger: tokens.leadPassenger,
      paxSummary: tokens.paxSummary,
    },
    detection: {
      reason: match.reason,
      agent: match.agent,
      candidates: match.candidates,
      /// True when the agent line came from the directory rather than the
      /// booking's own field — the compose window says which, out loud.
      fromDirectory: fromDirectory.to.length > 0,
    },
    suggestedTo,
    suggestedCc,
    internal,
    lockedCc: internal.filter(r => r.alwaysCc).map(r => r.email),
    testMode,
    tokens,
    tokenCatalogue: TOKEN_CATALOGUE,
    templates: templates.map(t => ({
      id: t.id,
      code: t.code,
      name: t.name,
      description: t.description,
      category: t.category,
      audience: t.audience,
      attachPdf: t.attachPdf,
      ccEmails: Array.isArray(t.ccEmails) ? t.ccEmails : [],
      subject:  renderTemplate(t.subject,  tokens),
      bodyHtml: renderTemplate(t.bodyHtml, tokens),
      rawSubject:  t.subject,
      rawBodyHtml: t.bodyHtml,
    })),
    threads: threads.map(t => ({
      id: t.id,
      subject: t.subject,
      toAddresses: t.toAddresses,
      ccAddresses: t.ccAddresses,
      status: t.status,
      replyCount: t.replyCount,
      unreadReplies: t.unreadReplies,
      lastMessageAt: t.lastMessageAt,
      createdAt: t.createdAt,
      sentByName: t.sentByName,
      agentName: t.agent?.name ?? null,
      templateName: t.template?.name ?? null,
      messageCount: t._count.messages,
    })),
  })
}
