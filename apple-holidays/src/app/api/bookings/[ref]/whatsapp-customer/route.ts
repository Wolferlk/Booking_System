/**
 * Per-booking customer WhatsApp control panel API.
 *  GET  — trip day list (with per-day schedule summary + last-sent status),
 *         feedback-request send status, and any received guest feedback.
 *  POST — manually send a daily briefing for a chosen day, or the feedback form.
 */
import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import type { UserRole } from '@prisma/client'
import {
  sendDailyBriefingForBooking,
  sendFeedbackRequestForBooking,
  TAG_DAILY_BRIEFING,
  TAG_FEEDBACK_REQUEST,
} from '@/lib/customer-whatsapp-automation'

export const dynamic = 'force-dynamic'
const ALLOWED: UserRole[] = ['BT_USER', 'GT_USER', 'TE_USER', 'GT_TE_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN']

function dateStr(d: Date | string): string {
  return new Date(d).toISOString().slice(0, 10)
}

export async function GET(_req: NextRequest, { params }: { params: { ref: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  if (!ALLOWED.includes(session.user.role as UserRole)) return buildApiError('Forbidden', 403)

  const booking = await prisma.booking.findUnique({
    where: { bookingRef: params.ref },
    include: {
      passengers:    { where: { isLead: true }, take: 1 },
      flights:       true,
      accommodations: true,
      tourAgenda:    { include: { items: true } },
      guestFeedback: true,
    },
  })
  if (!booking) return buildApiError('Booking not found', 404)

  // Outbound customer-automation messages already logged for this booking
  const sends = await prisma.whatsAppMessage.findMany({
    where: {
      bookingRef: params.ref,
      direction: 'outbound',
      OR: [
        { senderName: { startsWith: TAG_DAILY_BRIEFING } },
        { senderName: { startsWith: TAG_FEEDBACK_REQUEST } },
      ],
    },
    orderBy: { createdAt: 'desc' },
    select: { id: true, senderName: true, body: true, status: true, createdAt: true },
  })

  // Build the day-by-day list from arrival→departure
  const arr = new Date(dateStr(booking.arrivalDate) + 'T00:00:00.000Z')
  const dep = new Date(dateStr(booking.departureDate) + 'T00:00:00.000Z')
  const agendaItems = booking.tourAgenda?.items ?? []

  const days: {
    dayNo: number
    date: string
    isArrival: boolean
    isDeparture: boolean
    agendaCount: number
    flightCount: number
    checkIn: string | null
    checkOut: string | null
    lastSentAt: string | null
  }[] = []

  const briefingSends = sends.filter(s => s.senderName?.startsWith(TAG_DAILY_BRIEFING))
  // The formatter stamps each briefing body with the target day in long format,
  // so we can tell which day a past send was actually about.
  const longDate = (ds: string) =>
    new Date(ds + 'T00:00:00.000Z').toLocaleDateString('en-GB', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })

  const MAX_DAYS = 60
  let dayNo = 1
  for (let t = arr.getTime(); t <= dep.getTime() && dayNo <= MAX_DAYS; t += 86400000, dayNo++) {
    const ds = new Date(t).toISOString().slice(0, 10)
    const ci = booking.accommodations.find(a => dateStr(a.checkIn) === ds)
    const co = booking.accommodations.find(a => dateStr(a.checkOut) === ds)
    const sentForThisDay = briefingSends.find(s => s.body?.includes(longDate(ds)))
    days.push({
      dayNo,
      date: ds,
      isArrival: ds === dateStr(booking.arrivalDate),
      isDeparture: ds === dateStr(booking.departureDate),
      agendaCount: agendaItems.filter(i => dateStr(i.date) === ds).length,
      flightCount: booking.flights.filter(f => dateStr(f.date) === ds).length,
      checkIn: ci ? `${ci.hotel} (${ci.city})` : null,
      checkOut: co ? `${co.hotel} (${co.city})` : null,
      lastSentAt: sentForThisDay?.createdAt.toISOString() ?? null,
    })
  }

  const feedbackSend = sends.find(s => s.senderName?.startsWith(TAG_FEEDBACK_REQUEST))

  return buildApiSuccess({
    bookingRef:   booking.bookingRef,
    leadName:     booking.passengers[0]?.name ?? null,
    contact:      booking.contactWhatsapp || booking.contactPhone || null,
    hasContact:   Boolean(booking.contactWhatsapp || booking.contactPhone),
    arrivalDate:  dateStr(booking.arrivalDate),
    departureDate: dateStr(booking.departureDate),
    days,
    feedbackRequestSentAt: feedbackSend?.createdAt.toISOString() ?? null,
    feedback: booking.guestFeedback,
    recentSends: sends.slice(0, 20).map(s => ({
      id: s.id,
      type: s.senderName?.startsWith(TAG_FEEDBACK_REQUEST) ? 'feedback' : 'briefing',
      status: s.status,
      createdAt: s.createdAt.toISOString(),
      preview: (s.body ?? '').slice(0, 160),
    })),
  })
}

export async function POST(req: NextRequest, { params }: { params: { ref: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  if (!ALLOWED.includes(session.user.role as UserRole)) return buildApiError('Forbidden', 403)

  const body = await req.json().catch(() => null) as
    | { action: 'briefing'; date: string }
    | { action: 'feedback' }
    | null
  if (!body) return buildApiError('Invalid request body')

  if (body.action === 'briefing') {
    if (!body.date || !/^\d{4}-\d{2}-\d{2}$/.test(body.date)) return buildApiError('A valid date is required')
    // Manual sends always force (bypass daily dedupe) and allow empty ("free day") messages
    const r = await sendDailyBriefingForBooking(params.ref, body.date, { force: true, allowEmpty: true })
    if (!r.ok) return buildApiError(r.reason ?? 'Send failed')
    return buildApiSuccess({ preview: r.message }, `Briefing for ${body.date} sent`)
  }

  if (body.action === 'feedback') {
    const r = await sendFeedbackRequestForBooking(params.ref, { force: true })
    if (!r.ok) return buildApiError(r.reason ?? 'Send failed')
    return buildApiSuccess({ preview: r.message }, 'Feedback form sent')
  }

  return buildApiError('Unknown action')
}
