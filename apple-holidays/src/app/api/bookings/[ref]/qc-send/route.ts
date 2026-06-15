import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { sendAgentConfirmationEmail } from '@/lib/send-agent-email'
import { generateConfirmationPdf } from '@/lib/generate-booking-pdf'
import { mkdir, writeFile } from 'fs/promises'
import path from 'path'

const META_API_VERSION = process.env.WHATSAPP_API_VERSION?.trim() || 'v20.0'

function computeQCStatus(booking: {
  status: string
  tourAgenda?: {
    items: Array<{
      serviceType?: string | null
      assignment?: { driverId?: string | null } | null
    }>
  } | null
  tickets: Array<{ activated: boolean; status: string }>
}) {
  const confirmedStatuses = ['GT_VERIFIED', 'OPERATIONS_READY', 'CLIENT_LIVE', 'IN_PROGRESS', 'COMPLETED']

  const clientConfirmed = confirmedStatuses.includes(booking.status)

  const agendaItems = booking.tourAgenda?.items ?? []
  const driverItems = agendaItems.filter(i => i.serviceType !== 'OWN_ARRANGEMENT')
  const driverAllocationComplete =
    driverItems.length === 0 || driverItems.every(i => i.assignment?.driverId)

  const activeTickets = booking.tickets.filter(t => t.activated)
  const ticketsActivated =
    activeTickets.length === 0 || activeTickets.every(t => t.status === 'PURCHASED' || t.status === 'PAID')

  const allPass = clientConfirmed && driverAllocationComplete && ticketsActivated

  return {
    clientConfirmed,
    driverAllocationComplete,
    ticketsActivated,
    allPass,
    driverItemCount: driverItems.length,
    activeTicketCount: activeTickets.length,
  }
}

async function sendWhatsAppMessage(params: {
  to: string
  name: string
  message: string
  pdfBuffer?: Buffer
  pdfFilename?: string
}) {
  const accessToken   = process.env.WHATSAPP_ACCESS_TOKEN?.trim()
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID?.trim()

  if (accessToken && phoneNumberId) {
    const baseUrl = `https://graph.facebook.com/${META_API_VERSION}/${phoneNumberId}`
    const headers = { Authorization: `Bearer ${accessToken}` }

    await fetch(`${baseUrl}/messages`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: params.to,
        type: 'text',
        text: { body: params.message },
      }),
    })

    if (params.pdfBuffer && params.pdfFilename) {
      const mediaForm = new FormData()
      mediaForm.append('messaging_product', 'whatsapp')
      const buf = params.pdfBuffer.buffer.slice(
        params.pdfBuffer.byteOffset,
        params.pdfBuffer.byteOffset + params.pdfBuffer.byteLength,
      ) as ArrayBuffer
      mediaForm.append('file', new Blob([buf], { type: 'application/pdf' }), params.pdfFilename)

      const uploadRes = await fetch(`${baseUrl}/media`, { method: 'POST', headers, body: mediaForm })
      const uploadJson = await uploadRes.json() as { id?: string }
      if (uploadJson.id) {
        await fetch(`${baseUrl}/messages`, {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            to: params.to,
            type: 'document',
            document: { id: uploadJson.id, filename: params.pdfFilename, caption: 'Tour confirmation PDF' },
          }),
        })
      }
    }
    return true
  }

  const notifySecret = process.env.WHATSAPP_NOTIFY_SECRET?.trim()
  if (notifySecret) {
    await fetch('https://travel-parser-live.aahaas.com/v1/notify/whatsapp', {
      method: 'POST',
      headers: { 'x-notify-secret': notifySecret, 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: params.to, name: params.name, message: params.message }),
    })
    return true
  }

  return false
}

export async function POST(
  req: NextRequest,
  { params }: { params: { ref: string } },
) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  if (!['TE_USER', 'BT_USER', 'SUPER_ADMIN'].includes(session.user.role)) {
    return buildApiError('Forbidden', 403)
  }

  const booking = await prisma.booking.findUnique({
    where: { bookingRef: params.ref },
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
      tickets: { orderBy: { createdAt: 'asc' } },
    },
  })

  if (!booking) return buildApiError('Booking not found', 404)

  const qc = computeQCStatus(booking)
  if (!qc.allPass) {
    return buildApiError('QC checks not all passed — cannot send Type-1 messages', 400)
  }

  const results: { email?: string; whatsapp?: string } = {}
  const now = new Date()

  // Send Type-1 email (tour confirmation to agent)
  try {
    await sendAgentConfirmationEmail(params.ref)
    results.email = 'sent'
    await prisma.booking.update({
      where: { bookingRef: params.ref },
      data: {
        qcPassedAt:        booking.qcPassedAt ?? now,
        qcAutoEmailSentAt: now,
      },
    })
  } catch (err) {
    results.email = `failed: ${err instanceof Error ? err.message : String(err)}`
  }

  // Send Type-1 WhatsApp (confirmation to customer)
  const waPhone = (booking as { contactWhatsapp?: string | null }).contactWhatsapp
    ?? (booking as { contactPhone?: string | null }).contactPhone
  if (waPhone) {
    try {
      const lead = booking.passengers[0]
      const firstName = (lead?.name ?? 'Guest').split(' ')[0]
      const arrDate = booking.arrivalDate.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
      const depDate = booking.departureDate.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
      const paxLine = `${booking.paxAdults} Adults${booking.paxChildren > 0 ? `, ${booking.paxChildren} Children` : ''}`

      const message = `Hello ${firstName},
Greetings from Apple Holidays! 🌟

Please find the attached *Tour Confirmation* for your upcoming trip.

*Booking Reference:* ${params.ref}
*Travel Dates:* ${arrDate} – ${depDate}
*Passengers:* ${paxLine}

Kindly review the attached PDF and confirm:
✅ All passenger names & passport details are correct
✅ Accommodation and itinerary are as expected
✅ Flight details (if any) are accurate

We kindly request the following information:
1️⃣ Meal preference — Vegetarian or Non-Vegetarian?
2️⃣ Any special assistance required for seniors or infants?

*Emergency Contacts:*
📞 Helen: +84 94 959 15 36
📞 Senthoor Pandian: +91 95852 22335
📞 Tina: +84 94 516 95 95

Please reply with your confirmation at the earliest.
Thank you! 🙏
*Apple Holidays Team*`

      const pdfBuffer = await generateConfirmationPdf(booking)
      const pdfFilename = `AppleHolidays-${params.ref}-TourConfirmation-${Date.now()}.pdf`
      const uploadDir = path.join(process.cwd(), 'public', 'uploads', 'whatsapp')
      await mkdir(uploadDir, { recursive: true })
      await writeFile(path.join(uploadDir, pdfFilename), pdfBuffer)

      const normPhone = waPhone.replace(/\D/g, '')
      await sendWhatsAppMessage({
        to: normPhone,
        name: lead?.name ?? 'Guest',
        message,
        pdfBuffer,
        pdfFilename,
      })

      await prisma.whatsAppMessage.create({
        data: {
          bookingRef: params.ref,
          phone:      normPhone,
          direction:  'outbound',
          body:       message,
          status:     'sent',
          senderName: 'QC Auto-Send',
        },
      })

      results.whatsapp = 'sent'
      await prisma.booking.update({
        where: { bookingRef: params.ref },
        data: {
          qcPassedAt:    booking.qcPassedAt ?? now,
          qcAutoWaSentAt: now,
        },
      })
    } catch (err) {
      results.whatsapp = `failed: ${err instanceof Error ? err.message : String(err)}`
    }
  } else {
    results.whatsapp = 'no-phone'
  }

  // Record QC passed timestamp if not already set
  if (!booking.qcPassedAt) {
    await prisma.booking.update({
      where: { bookingRef: params.ref },
      data: { qcPassedAt: now },
    }).catch(() => {/* already updated above */})
  }

  return buildApiSuccess(results, 'QC Type-1 messages sent')
}

export { computeQCStatus }
