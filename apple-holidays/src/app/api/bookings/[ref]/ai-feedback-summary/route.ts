import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import {
  fetchTEServiceForBooking,
  sendFeedbackSummaryEmail,
  generateAIFeedbackNarrative,
  buildFeedbackSummaryEmail,
  type AIFeedbackResult,
} from '@/lib/send-feedback-summary'
import { prisma } from '@/lib/prisma'
import type { UserRole } from '@prisma/client'

export const dynamic = 'force-dynamic'

const ALLOWED: UserRole[] = ['TE_USER', 'GT_TE_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN']

// ── GET: load TE data for this booking ──────────────────────────────────────
export async function GET(
  _req: NextRequest,
  { params }: { params: { ref: string } },
) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  if (!ALLOWED.includes(session.user.role as UserRole)) return buildApiError('Forbidden', 403)

  const booking = await prisma.booking.findUnique({
    where: { bookingRef: params.ref },
    select: { agentEmail: true, contactEmail: true, agent: true, arrivalDate: true, departureDate: true },
  })
  if (!booking) return buildApiError('Booking not found', 404)

  const { service, feedback, schedule } = await fetchTEServiceForBooking(params.ref)

  return buildApiSuccess({ service, feedback, schedule, booking })
}

// ── POST: generate preview OR send ──────────────────────────────────────────
export async function POST(
  req: NextRequest,
  { params }: { params: { ref: string } },
) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  if (!ALLOWED.includes(session.user.role as UserRole)) return buildApiError('Forbidden', 403)

  let body: {
    action?: 'generate' | 'send'
    extraCc?: string[]
    agentEmailOverride?: string
    aiNarrative?: AIFeedbackResult
  } = {}
  try { body = await req.json() } catch { /* no body */ }

  const booking = await prisma.booking.findUnique({
    where: { bookingRef: params.ref },
    select: { agentEmail: true, contactEmail: true, agent: true, arrivalDate: true, departureDate: true },
  })
  if (!booking) return buildApiError('Booking not found', 404)

  const { service, feedback, schedule } = await fetchTEServiceForBooking(params.ref)

  // ── action=generate: call OpenAI and return narrative + HTML preview ──────
  if (body.action === 'generate') {
    if (!feedback.length) return buildApiError('No feedback records to generate from', 422)

    try {
      const aiNarrative = await generateAIFeedbackNarrative({
        ref:           params.ref,
        agentName:     booking.agent ?? 'Agent',
        customerName:  service?.customer_name,
        arrivalDate:   booking.arrivalDate?.toISOString() ?? null,
        departureDate: booking.departureDate?.toISOString() ?? null,
        feedback,
        schedule,
      })

      const previewHtml = buildFeedbackSummaryEmail({
        ref: params.ref,
        booking: {
          agent:         booking.agent,
          arrivalDate:   booking.arrivalDate?.toISOString(),
          departureDate: booking.departureDate?.toISOString(),
        },
        service,
        feedback,
        schedule,
        aiNarrative,
        isAutoSend: false,
      })

      return buildApiSuccess({ aiNarrative, previewHtml })
    } catch (err) {
      return buildApiError(err instanceof Error ? err.message : 'AI generation failed')
    }
  }

  // ── action=send (default): send the email ─────────────────────────────────
  try {
    await sendFeedbackSummaryEmail(params.ref, {
      extraCc:            body.extraCc,
      agentEmailOverride: body.agentEmailOverride,
      aiNarrative:        body.aiNarrative ?? null,
      generateNarrative:  !body.aiNarrative, // generate if no narrative passed
    })
    return buildApiSuccess(null, 'Feedback summary sent to agent')
  } catch (err) {
    return buildApiError(err instanceof Error ? err.message : 'Failed to send email')
  }
}
