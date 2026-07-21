/**
 * Shared pieces for sending the movement-chart (agenda) PDF to customers.
 *
 * Used by:
 *   POST /api/bookings/[ref]/agenda/send   (manual send from the agenda page)
 *   GET  /api/cron/agenda-auto-send        (automatic send 3 days before arrival)
 */
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { PURCHASED_TICKET_STATUSES } from '@/lib/ticket-notes'
import { generateAgendaPdf } from '@/lib/generate-agenda-pdf'
import { sendMailViaGraph } from '@/lib/send-mail'

/** Emergency numbers printed in the customer confirmation email. */
const EMERGENCY_CONTACTS = [
  { name: 'Helen',    phone: '+84 94 959 15 36' },
  { name: 'Senthoor', phone: '+91 95852 22335'  },
  { name: 'Tina',     phone: '+84 94 516 95 95' },
]

/** Everything the agenda PDF generator needs. Shared so both callers stay in sync. */
export const AGENDA_INCLUDE = {
  flights:        { orderBy: { date: 'asc' } },
  accommodations: { orderBy: { checkIn: 'asc' } },
  passengers:     { orderBy: [{ isLead: 'desc' }, { name: 'asc' }] },
  emergencyContacts: true,
  // Purchased/paid only — draft tickets stay internal and never get sent out.
  tickets: {
    where: { activated: true, status: { in: [...PURCHASED_TICKET_STATUSES] } },
    include: {
      pnlLine:    { select: { activity: true, paymentRefNumber: true, category: true } },
      agendaItem: { select: { date: true, location: true, toPoint: true } },
    },
    orderBy: { createdAt: 'asc' },
  },
  tourAgenda: {
    include: {
      items: {
        orderBy: [{ date: 'asc' }, { sortOrder: 'asc' }],
        include: {
          assignment: {
            include: {
              driver: { include: { vehicle: true } },
              vendor: { select: { id: true, name: true, phone: true } },
            },
          },
        },
      },
    },
  },
} satisfies Prisma.BookingInclude

export type AgendaBooking = Prisma.BookingGetPayload<{ include: typeof AGENDA_INCLUDE }>

export function loadAgendaBooking(ref: string) {
  return prisma.booking.findUnique({
    where:   { bookingRef: ref },
    include: AGENDA_INCLUDE,
  })
}

// ── Filename ──────────────────────────────────────────────────────────────────

function safeFilePart(value: string | null | undefined): string {
  return String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
}

export function buildAgendaFileName(booking: {
  bookingRef?: string
  isNumber?: string | null
  passengers?: { name: string; isLead?: boolean }[]
}): string {
  const leadPassenger = booking.passengers?.find(p => p.isLead) ?? booking.passengers?.[0]
  const parts = [
    booking.isNumber?.trim() || null,
    booking.bookingRef?.trim() || null,
    leadPassenger?.name ?? null,
  ].map(safeFilePart).filter(Boolean)

  return `${parts.join('_') || 'agenda'}.pdf`
}

// ── Email body ────────────────────────────────────────────────────────────────

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return '—'
  const date = d instanceof Date ? d : new Date(d)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleDateString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC',
  })
}

/** "2 Adults, 1 Child" — falls back to the passenger list count. */
function paxSummary(booking: {
  paxAdults?: number | null
  paxChildren?: number | null
  paxInfants?: number | null
  passengers?: { name: string }[]
}): string {
  const parts: string[] = []
  const a = booking.paxAdults   ?? 0
  const c = booking.paxChildren ?? 0
  const i = booking.paxInfants  ?? 0
  if (a) parts.push(`${a} Adult${a > 1 ? 's' : ''}`)
  if (c) parts.push(`${c} Child${c > 1 ? 'ren' : ''}`)
  if (i) parts.push(`${i} Infant${i > 1 ? 's' : ''}`)
  if (parts.length === 0 && booking.passengers?.length) {
    parts.push(`${booking.passengers.length} Passenger${booking.passengers.length > 1 ? 's' : ''}`)
  }
  return parts.join(', ') || '—'
}

/** Guest greeting name — lead passenger, else first passenger, else "Guest". */
export function agendaGreetingName(booking: { passengers?: { name: string; isLead?: boolean }[] }): string {
  const lead = booking.passengers?.find(p => p.isLead) ?? booking.passengers?.[0]
  return lead?.name?.trim() || 'Guest'
}

/**
 * The customer-facing tour confirmation email body. Same content for the manual
 * send and the automatic 3-days-before-arrival send; `extraMessage` appends any
 * note the sender typed in the modal.
 */
export function buildAgendaEmailHtml(
  booking: {
    bookingRef: string
    arrivalDate: Date | string
    departureDate: Date | string
    paxAdults?: number | null
    paxChildren?: number | null
    paxInfants?: number | null
    passengers?: { name: string; isLead?: boolean }[]
  },
  extraMessage?: string,
): string {
  const name  = escapeHtml(agendaGreetingName(booking))
  const ref   = escapeHtml(booking.bookingRef)
  const dates = `${fmtDate(booking.arrivalDate)} – ${fmtDate(booking.departureDate)}`
  const pax   = escapeHtml(paxSummary(booking))

  const note = extraMessage?.trim()
    ? `<p style="margin:0 0 16px;padding:12px 14px;background:#fffbeb;border-left:3px solid #d97706;border-radius:4px;white-space:pre-wrap">${escapeHtml(extraMessage.trim())}</p>`
    : ''

  const contacts = EMERGENCY_CONTACTS
    .map(c => `<div style="margin:2px 0">📞 ${escapeHtml(c.name)}: ${escapeHtml(c.phone)}</div>`)
    .join('')

  return `
  <div style="font-family:Arial,Helvetica,sans-serif;color:#1e293b;font-size:14px;line-height:1.6;max-width:640px">
    <p style="margin:0 0 12px">Hello ${name},</p>
    <p style="margin:0 0 16px">Greetings from Apple Holidays! 🌟</p>

    ${note}

    <p style="margin:0 0 16px">
      Your booking has been confirmed. Please find the attached Tour Confirmation for your upcoming trip.
    </p>

    <div style="margin:0 0 16px;padding:14px 16px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px">
      <div style="margin:2px 0">📋 <strong>Booking Reference:</strong> ${ref}</div>
      <div style="margin:2px 0">📅 <strong>Travel Dates:</strong> ${dates}</div>
      <div style="margin:2px 0">👥 <strong>Passengers:</strong> ${pax}</div>
    </div>

    <p style="margin:0 0 8px">Kindly review the attached PDF and confirm:</p>
    <div style="margin:0 0 16px">
      <div style="margin:2px 0">✅ All passenger names &amp; passport details are correct</div>
      <div style="margin:2px 0">✅ Accommodation and itinerary are as expected</div>
      <div style="margin:2px 0">✅ Flight details (if any) are accurate</div>
    </div>

    <p style="margin:0 0 8px">We kindly request:</p>
    <div style="margin:0 0 16px">
      <div style="margin:2px 0">1️⃣ Meal preference — Vegetarian or Non-Vegetarian?</div>
      <div style="margin:2px 0">2️⃣ Any special assistance required?</div>
    </div>

    <p style="margin:0 0 4px"><strong>Emergency Contacts:</strong></p>
    <div style="margin:0 0 16px">${contacts}</div>

    <p style="margin:0 0 4px">Please reply with your confirmation at the earliest.</p>
    <p style="margin:0 0 4px">Thank you! 🙏</p>
    <p style="margin:0"><strong>Apple Holidays Team</strong></p>
  </div>`
}

// ── Send ──────────────────────────────────────────────────────────────────────

/**
 * Generates the agenda PDF for `booking` and emails it with the confirmation body.
 * Throws on failure so callers can decide how to report it.
 */
export async function sendAgendaEmail(opts: {
  booking:      AgendaBooking
  to:           string
  subject?:     string
  extraMessage?: string
  showDrivers?: boolean
}): Promise<void> {
  const { booking, to, subject, extraMessage, showDrivers = false } = opts

  const items = booking.tourAgenda?.items ?? []
  const pdfBuffer = await generateAgendaPdf(
    booking.bookingRef,
    booking as never,
    items as never,
    showDrivers,
  )

  await sendMailViaGraph({
    to,
    subject:  subject?.trim() || `Tour Confirmation — ${booking.bookingRef}`,
    bodyHtml: buildAgendaEmailHtml(booking, extraMessage),
    attachment: {
      name:        buildAgendaFileName(booking),
      contentType: 'application/pdf',
      buffer:      pdfBuffer,
    },
  })
}
