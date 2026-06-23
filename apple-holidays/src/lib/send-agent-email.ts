import { prisma } from '@/lib/prisma'
import { generateConfirmationPdf } from '@/lib/generate-booking-pdf'
import { sendMailViaGraph, getAgentEmail, buildAgentConfirmationEmail } from '@/lib/send-mail'

const DEFAULT_TEST_EMAIL_1 = 'sasiofficial25@gmail.com'
const DEFAULT_TEST_EMAIL_2 = 'sasindu@aahaas.com'

// Internal CC addresses — always included on production sends
const TQ_CC_EMAIL  = 'confirm.booking@aahaas.com'

async function getMailSettings(): Promise<{
  useTestData: boolean
  testEmail1: string
  testEmail2: string
}> {
  const rows = await prisma.systemSetting.findMany({
    where: { key: { in: ['use_test_data', 'test_email_1', 'test_email_2'] } },
  })
  const map: Record<string, string> = {}
  rows.forEach(r => { map[r.key] = r.value })
  return {
    useTestData: map['use_test_data'] === 'true',
    testEmail1:  map['test_email_1'] ?? DEFAULT_TEST_EMAIL_1,
    testEmail2:  map['test_email_2'] ?? DEFAULT_TEST_EMAIL_2,
  }
}

/**
 * Generates the agent confirmation PDF and sends the email.
 * Shared by the auto-send (on GT_VERIFIED) and the manual send button.
 * Respects the use_test_data system setting.
 */
export async function sendAgentConfirmationEmail(
  ref: string,
  opts?: { cc?: string[] },
): Promise<void> {
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

  const { useTestData, testEmail1, testEmail2 } = await getMailSettings()

  const pdfBuffer = await generateConfirmationPdf(booking)
  const bodyHtml  = buildAgentConfirmationEmail(booking)

  let toEmail: string
  let ccEmails: string[]

  if (useTestData) {
    toEmail  = testEmail1
    ccEmails = [testEmail2]
    console.log(`[email] TEST MODE — redirecting to ${toEmail}, CC: ${ccEmails.join(', ')}`)
  } else {
    toEmail  = getAgentEmail(booking as { agentEmail?: string | null })

    // Load saved CC list from the original booking email's To+CC headers
    let storedCc: string[] = []
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    try { storedCc = JSON.parse((booking as any).ccEmails ?? '[]') } catch { /* ok */ }

    // Always include contactEmail (guest); add caller-supplied extras
    const contactEmail = (booking as { contactEmail?: string | null }).contactEmail
    const extraCc = opts?.cc ?? []
    const autoCc = contactEmail && contactEmail !== toEmail ? [contactEmail] : []
    // Always CC the TQ mailbox for traceability (sender is already confirm.booking@aahaas.com
    // but the inbox copy may be filtered — an explicit CC lands in a separate thread)
    const internalCc = toEmail !== TQ_CC_EMAIL ? [TQ_CC_EMAIL] : []
    const combined = [...storedCc, ...autoCc, ...internalCc, ...extraCc]
    ccEmails = Array.from(new Set(combined)).filter(e => Boolean(e) && e !== toEmail)
  }

  await sendMailViaGraph({
    to:         toEmail,
    cc:         ccEmails.length > 0 ? ccEmails : undefined,
    subject:    `Booking Confirmed — ${ref} (${booking.agent ?? 'Apple Holidays'})`,
    bodyHtml,
    attachment: {
      name:        `AppleHolidays-${ref}-Confirmation.pdf`,
      contentType: 'application/pdf',
      buffer:      pdfBuffer,
    },
  })

  console.log(`[email] Confirmation sent to ${toEmail}${ccEmails.length ? ` CC: ${ccEmails.join(', ')}` : ''} for booking ${ref}`)
}
