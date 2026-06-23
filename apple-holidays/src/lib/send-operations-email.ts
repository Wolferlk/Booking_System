import { prisma } from '@/lib/prisma'
import { generateFullDetailsPdf } from '@/lib/generate-booking-pdf'
import { sendMailViaGraph, getAgentEmail, buildOperationsReadyEmail } from '@/lib/send-mail'

const TQ_CC_EMAIL = 'confirm.booking@aahaas.com'

/**
 * Generates the Operations Ready PDF (includes tickets + drivers) and sends the email.
 * Triggered automatically when booking moves to OPERATIONS_READY.
 */
export async function sendOperationsReadyEmail(ref: string): Promise<void> {
  const booking = await prisma.booking.findUnique({
    where: { bookingRef: ref },
    include: {
      passengers:        { orderBy: [{ isLead: 'desc' }, { name: 'asc' }] },
      flights:           { orderBy: { date: 'asc' } },
      accommodations:    { orderBy: { checkIn: 'asc' } },
      itineraryItems:    { orderBy: { dayNo: 'asc' } },
      emergencyContacts: true,
      tickets: {
        where:   { activated: true },
        include: {
          pnlLine:    { select: { activity: true, category: true } },
          agendaItem: { select: { date: true, location: true } },
        },
      },
      tourAgenda: {
        include: {
          items: {
            orderBy: [{ date: 'asc' }, { sortOrder: 'asc' }],
            include: { assignment: true },
          },
        },
      },
    },
  })

  if (!booking) throw new Error(`Booking not found: ${ref}`)

  const pdfBuffer = await generateFullDetailsPdf(booking)

  const agentEmail = getAgentEmail(booking as { agentEmail?: string | null })
  const bodyHtml   = buildOperationsReadyEmail(booking)
  const ccEmails   = agentEmail !== TQ_CC_EMAIL ? [TQ_CC_EMAIL] : []

  await sendMailViaGraph({
    to: agentEmail,
    cc: ccEmails.length > 0 ? ccEmails : undefined,
    subject: `Operations Ready — ${ref} (${booking.agent ?? 'Apple Holidays'})`,
    bodyHtml,
    attachment: {
      name: `AppleHolidays-${ref}-OperationsReady.pdf`,
      contentType: 'application/pdf',
      buffer: pdfBuffer,
    },
  })

  console.log(`[email] Operations Ready email sent to ${agentEmail}${ccEmails.length ? ` CC: ${ccEmails.join(', ')}` : ''} for booking ${ref}`)
}
