/**
 * QC Auto-Send — triggered automatically when a booking advances to QC1_PASS or QC2_PASS.
 * QC1: sends WhatsApp Msg 1 (basic confirmation) + agent email
 * QC2: sends WhatsApp Msg 2 (full details with agenda + PDF) + customer email
 */

import { prisma } from '@/lib/prisma'
import { sendAgentConfirmationEmail } from '@/lib/send-agent-email'
import { generateConfirmationPdf, generateFullDetailsPdf } from '@/lib/generate-booking-pdf'
import { mkdir, writeFile } from 'fs/promises'
import path from 'path'

const META_API_VERSION = process.env.WHATSAPP_API_VERSION?.trim() || 'v20.0'

function getTeamName(operationCountry: string | null | undefined): string {
  if (operationCountry === 'VIETNAM')            return 'Vietnam Ground Operation Team'
  if (operationCountry === 'SRILANKA')           return 'Sri Lanka Ground Operation Team'
  if (operationCountry === 'SINGAPORE')          return 'Singapore Ground Operation Team'
  if (operationCountry === 'MALAYSIA')           return 'Malaysia Ground Operation Team'
  if (operationCountry === 'SINGAPORE_MALAYSIA') return 'Singapore & Malaysia Ground Operation Team'
  return 'Apple Holidays Team'
}

async function sendWhatsAppMessage(params: {
  to: string
  name: string
  message: string
  pdfBuffer?: Buffer
  pdfFilename?: string
  pdfCaption?: string
}): Promise<void> {
  const accessToken   = process.env.WHATSAPP_ACCESS_TOKEN?.trim()
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID?.trim()

  if (accessToken && phoneNumberId) {
    const baseUrl = `https://graph.facebook.com/${META_API_VERSION}/${phoneNumberId}`
    const headers = { Authorization: `Bearer ${accessToken}` }

    await fetch(`${baseUrl}/messages`, {
      method:  'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to:   params.to,
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
      const uploadRes  = await fetch(`${baseUrl}/media`, { method: 'POST', headers, body: mediaForm })
      const uploadJson = await uploadRes.json() as { id?: string }
      if (uploadJson.id) {
        await fetch(`${baseUrl}/messages`, {
          method:  'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            to: params.to,
            type: 'document',
            document: { id: uploadJson.id, filename: params.pdfFilename, caption: params.pdfCaption ?? 'Apple Holidays — Tour Confirmation' },
          }),
        })
      }
    }
    return
  }

  const notifySecret = process.env.WHATSAPP_NOTIFY_SECRET?.trim()
  if (notifySecret) {
    await fetch('https://travel-parser-live.aahaas.com/v1/notify/whatsapp', {
      method:  'POST',
      headers: { 'x-notify-secret': notifySecret, 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: params.to, name: params.name, message: params.message }),
    })
  }
}

// ── QC1 auto-send ─────────────────────────────────────────────────────────────

export async function triggerQC1AutoSend(bookingRef: string): Promise<void> {
  const booking = await prisma.booking.findUnique({
    where: { bookingRef },
    include: {
      passengers: { orderBy: [{ isLead: 'desc' }, { name: 'asc' }] },
    },
  })
  if (!booking) return

  const now = new Date()

  // Agent confirmation email (Type-1)
  try {
    await sendAgentConfirmationEmail(bookingRef)
    await prisma.booking.update({
      where: { bookingRef },
      data: { qcPassedAt: booking.qcPassedAt ?? now, qcAutoEmailSentAt: now },
    })
  } catch (err) {
    console.error(`[QC1] Email failed for ${bookingRef}:`, err)
  }

  // WhatsApp Msg 1 — basic confirmation to customer
  const waPhone =
    (booking as unknown as { contactWhatsapp?: string | null }).contactWhatsapp ??
    (booking as unknown as { contactPhone?: string | null }).contactPhone
  if (!waPhone) return

  try {
    const lead      = booking.passengers[0]
    const firstName = (lead?.name ?? 'Guest').split(' ')[0]
    const arrDate   = booking.arrivalDate.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
    const depDate   = booking.departureDate.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
    const paxLine   = `${booking.paxAdults} Adult${booking.paxAdults !== 1 ? 's' : ''}${booking.paxChildren > 0 ? `, ${booking.paxChildren} Children` : ''}`

    const message = `Hello ${firstName},
Greetings from Apple Holidays! 🌟

Your booking has been *confirmed*. Please find the attached *Tour Confirmation* for your upcoming trip.

📋 *Booking Reference:* ${bookingRef}
📅 *Travel Dates:* ${arrDate} – ${depDate}
👥 *Passengers:* ${paxLine}

Kindly review the attached PDF and confirm:
✅ All passenger names & passport details are correct
✅ Accommodation and itinerary are as expected
✅ Flight details (if any) are accurate

We kindly request:
1️⃣ Meal preference — Vegetarian or Non-Vegetarian?
2️⃣ Any special assistance required?

*Emergency Contacts:*
📞 Helen: +84 94 959 15 36
📞 Senthoor: +91 95852 22335
📞 Tina: +84 94 516 95 95

Please reply with your confirmation at the earliest.
Thank you! 🙏
*Apple Holidays Team*`

    const pdfBuffer  = await generateConfirmationPdf(booking)
    const pdfFilename = `AppleHolidays-${bookingRef}-Confirmation-${Date.now()}.pdf`
    const uploadDir   = path.join(process.cwd(), 'public', 'uploads', 'whatsapp')
    await mkdir(uploadDir, { recursive: true })
    await writeFile(path.join(uploadDir, pdfFilename), pdfBuffer)

    const normPhone = waPhone.replace(/\D/g, '')
    await sendWhatsAppMessage({ to: normPhone, name: lead?.name ?? 'Guest', message, pdfBuffer, pdfFilename })

    await Promise.all([
      prisma.whatsAppMessage.create({
        data: {
          bookingRef,
          phone:      normPhone,
          direction:  'outbound',
          body:       message,
          status:     'sent',
          senderName: 'QC1 Auto-Send',
        },
      }),
      prisma.booking.update({
        where: { bookingRef },
        data: { qcPassedAt: booking.qcPassedAt ?? now, qcAutoWaSentAt: now },
      }),
    ])
  } catch (err) {
    console.error(`[QC1] WhatsApp failed for ${bookingRef}:`, err)
  }
}

// ── QC2 auto-send ─────────────────────────────────────────────────────────────

export async function triggerQC2AutoSend(bookingRef: string): Promise<void> {
  const booking = await prisma.booking.findUnique({
    where: { bookingRef },
    include: {
      passengers:        { orderBy: [{ isLead: 'desc' }, { name: 'asc' }] },
      accommodations:    { orderBy: { checkIn: 'asc' } },
      flights:           { orderBy: { date: 'asc' } },
      itineraryItems:    { orderBy: { dayNo: 'asc' } },
      emergencyContacts: true,
      tourAgenda: {
        include: {
          items: {
            orderBy: [{ date: 'asc' }, { sortOrder: 'asc' }],
            include: { assignment: { include: { driver: true } } },
          },
        },
      },
      tickets: { orderBy: { createdAt: 'asc' } },
    },
  })
  if (!booking) return

  const waPhone =
    (booking as unknown as { contactWhatsapp?: string | null }).contactWhatsapp ??
    (booking as unknown as { contactPhone?: string | null }).contactPhone
  if (!waPhone) return

  const now       = new Date()
  const lead      = booking.passengers[0]
  const firstName = (lead?.name ?? 'Guest').split(' ')[0]
  const arrDate   = booking.arrivalDate.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
  const depDate   = booking.departureDate.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
  const teamName  = getTeamName((booking as unknown as { operationCountry?: string | null }).operationCountry)

  const message = `Hello ${firstName},
Greetings from ${teamName}! 🌟

Please find the *Full Tour Details & Vouchers* for your upcoming trip.

*Booking Reference:* ${bookingRef}
*Travel Dates:* ${arrDate} – ${depDate}

This document includes:
✅ Complete day-by-day itinerary & tour agenda
✅ Driver & vehicle assignments
✅ All tickets and voucher receipts

Please keep this document handy throughout your travel.

*Emergency Contacts:*
📞 Helen: +84 94 959 15 36
📞 Senthoor Pandian: +91 95852 22335
📞 Tina: +84 94 516 95 95

Wishing you a wonderful trip! ✈️
*${teamName}*`

  try {
    const normPhone   = waPhone.replace(/\D/g, '')
    const pdfBuffer   = await generateFullDetailsPdf(booking)
    const pdfFilename = `AppleHolidays-${bookingRef}-FullDetails-${Date.now()}.pdf`
    const uploadDir   = path.join(process.cwd(), 'public', 'uploads', 'whatsapp')
    await mkdir(uploadDir, { recursive: true })
    await writeFile(path.join(uploadDir, pdfFilename), pdfBuffer)

    await sendWhatsAppMessage({
      to: normPhone, name: lead?.name ?? 'Guest', message,
      pdfBuffer, pdfFilename,
      pdfCaption: 'Apple Holidays — Full Tour Details & Vouchers',
    })

    await prisma.whatsAppMessage.create({
      data: {
        bookingRef,
        phone:      normPhone,
        direction:  'outbound',
        body:       message,
        status:     'sent',
        senderName: 'QC2 Auto-Send',
      },
    })

    await prisma.booking.update({
      where: { bookingRef },
      data: { qcPassedAt: booking.qcPassedAt ?? now },
    })
  } catch (err) {
    console.error(`[QC2] WhatsApp failed for ${bookingRef}:`, err)
  }

  // QC2 also sends a customer-facing email via agent confirmation (with full booking PDF)
  try {
    await sendAgentConfirmationEmail(bookingRef)
  } catch (err) {
    console.error(`[QC2] Email failed for ${bookingRef}:`, err)
  }
}
