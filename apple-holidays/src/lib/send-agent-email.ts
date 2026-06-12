import { prisma } from '@/lib/prisma'
import { generateBookingHtml } from '@/lib/generate-booking-html'
import { htmlToPdf } from '@/lib/html-to-pdf'
import { sendMailViaGraph, getAgentEmail, buildAgentConfirmationEmail } from '@/lib/send-mail'

/**
 * Generates the agent confirmation PDF and sends the email.
 * Shared by the auto-send (on GT_VERIFIED) and the manual send button.
 */
export async function sendAgentConfirmationEmail(ref: string): Promise<void> {
  const booking = await prisma.booking.findUnique({
    where: { bookingRef: ref },
    include: {
      passengers:        { orderBy: [{ isLead: 'desc' }, { name: 'asc' }] },
      flights:           { orderBy: { date: 'asc' } },
      accommodations:    { orderBy: { checkIn: 'asc' } },
      itineraryItems:    { orderBy: { dayNo: 'asc' } },
      emergencyContacts: true,
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

  const html      = generateBookingHtml(booking)
  const filename  = `${ref}-confirmation.pdf`
  const pdfBuffer = await htmlToPdf(html, filename)

  const agentEmail = getAgentEmail(booking as { agentEmail?: string | null })
  const bodyHtml   = buildAgentConfirmationEmail(booking)

  await sendMailViaGraph({
    to: agentEmail,
    subject: `Booking Confirmed — ${ref} (${booking.agent ?? 'Apple Holidays'})`,
    bodyHtml,
    attachment: {
      name: `AppleHolidays-${ref}-Confirmation.pdf`,
      contentType: 'application/pdf',
      buffer: pdfBuffer,
    },
  })

  console.log(`[email] Confirmation sent to ${agentEmail} for booking ${ref}`)
}
