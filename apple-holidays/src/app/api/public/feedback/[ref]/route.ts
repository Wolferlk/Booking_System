/**
 * Public guest feedback form API — no session; access is gated by the signed
 * token embedded in the WhatsApp link (?t=...), verified against the booking ref.
 */
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { verifyFeedbackLinkToken } from '@/lib/customer-whatsapp-automation'
import { verifyPortalLinkToken } from '@/lib/portal-link'

export const dynamic = 'force-dynamic'

/**
 * Access is granted by either the dedicated feedback link token (WhatsApp) or
 * the customer trip portal token — both prove the holder has access to this booking,
 * so the in-portal "Feedback" tab can reuse the same ?t= it already has.
 */
function hasFeedbackAccess(ref: string, token: string): boolean {
  return verifyFeedbackLinkToken(ref, token) || verifyPortalLinkToken(ref, token)
}

const RATINGS = ['EXCELLENT', 'GOOD', 'AVERAGE', 'POOR'] as const
const PURPOSES = ['BUSINESS', 'LEISURE', 'BOTH'] as const

const RATING_FIELDS = [
  'accommodationRoom', 'accommodationFood',
  'restaurantFood', 'restaurantAmbience',
  'transportVehicle', 'transportDriver',
  'overallExperience',
] as const

function validRating(v: unknown): v is (typeof RATINGS)[number] | null {
  return v === null || v === undefined || RATINGS.includes(v as never)
}

export async function GET(req: NextRequest, { params }: { params: { ref: string } }) {
  const token = req.nextUrl.searchParams.get('t') ?? ''
  if (!hasFeedbackAccess(params.ref, token)) {
    return buildApiError('Invalid or expired link', 403)
  }

  const booking = await prisma.booking.findUnique({
    where: { bookingRef: params.ref },
    select: {
      bookingRef:      true,
      arrivalDate:     true,
      departureDate:   true,
      tourDestination: true,
      operationCountry: true,
      passengers:      { where: { isLead: true }, take: 1, select: { name: true } },
      guestFeedback:   { select: { submittedAt: true } },
    },
  })
  if (!booking) return buildApiError('Booking not found', 404)

  return buildApiSuccess({
    bookingRef:       booking.bookingRef,
    leadName:         booking.passengers[0]?.name ?? null,
    arrivalDate:      booking.arrivalDate,
    departureDate:    booking.departureDate,
    tourDestination:  booking.tourDestination,
    operationCountry: booking.operationCountry,
    alreadySubmitted: Boolean(booking.guestFeedback),
    submittedAt:      booking.guestFeedback?.submittedAt ?? null,
  })
}

export async function POST(req: NextRequest, { params }: { params: { ref: string } }) {
  const token = req.nextUrl.searchParams.get('t') ?? ''
  if (!hasFeedbackAccess(params.ref, token)) {
    return buildApiError('Invalid or expired link', 403)
  }

  const booking = await prisma.booking.findUnique({
    where: { bookingRef: params.ref },
    select: { id: true, guestFeedback: { select: { id: true } } },
  })
  if (!booking) return buildApiError('Booking not found', 404)
  if (booking.guestFeedback) return buildApiError('Feedback already submitted for this booking', 409)

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') return buildApiError('Invalid request body')

  const { purpose, remarks, clientName } = body as Record<string, unknown>

  if (purpose != null && !PURPOSES.includes(purpose as never)) {
    return buildApiError('Invalid purpose value')
  }
  for (const field of RATING_FIELDS) {
    if (!validRating((body as Record<string, unknown>)[field])) {
      return buildApiError(`Invalid rating for ${field}`)
    }
  }

  const ratings = Object.fromEntries(
    RATING_FIELDS.map(f => [f, (body as Record<string, unknown>)[f] ?? null]),
  )

  const feedback = await prisma.guestFeedbackForm.create({
    data: {
      bookingId:  booking.id,
      purpose:    (purpose as never) ?? null,
      ...ratings,
      remarks:    typeof remarks === 'string' && remarks.trim() ? remarks.trim().slice(0, 5000) : null,
      clientName: typeof clientName === 'string' && clientName.trim() ? clientName.trim().slice(0, 255) : null,
    },
  })

  return buildApiSuccess({ id: feedback.id, submittedAt: feedback.submittedAt }, 'Thank you for your feedback!')
}
