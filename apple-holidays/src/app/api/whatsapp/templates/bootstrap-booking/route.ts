/**
 * One-click registration of the customer booking-documents WhatsApp template.
 *
 * The booking-details dialog and the movement-chart dialog both deliver through
 * `aahaas_booking_details` — an APPROVED template with the PDF in its DOCUMENT
 * header — because that is the only thing WhatsApp delivers to a customer who
 * has not messaged the ops number in the last 24 hours. Until Meta approves it,
 * every send fails with error 132001 and the desk is told exactly that.
 *
 *   GET  — preview the exact body that would be submitted
 *   POST — submit it to Meta for review (a name that already exists comes back
 *          as an error, which is how you tell it was already registered)
 */
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { createMetaTemplate, uploadTemplateHeaderHandle, WHATSAPP_STAFF_ROLES } from '@/lib/whatsapp'
import {
  TEMPLATE_BOOKING_DETAILS,
  BOOKING_DETAILS_BODY,
  BOOKING_DETAILS_EXAMPLES,
  BOOKING_DETAILS_TEMPLATE_LANG,
  sampleBookingDetailsPdf,
} from '@/lib/booking-details-template'
import type { UserRole } from '@prisma/client'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

const FOOTER = 'AppleHolidays Operations'

function guard(role: string) {
  return (WHATSAPP_STAFF_ROLES as readonly string[]).includes(role as UserRole)
}

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  if (!guard(session.user.role)) return buildApiError('Forbidden', 403)

  return buildApiSuccess({
    name:         TEMPLATE_BOOKING_DETAILS,
    language:     BOOKING_DETAILS_TEMPLATE_LANG,
    category:     'UTILITY',
    headerFormat: 'DOCUMENT',
    bodyText:     BOOKING_DETAILS_BODY,
    bodyExamples: BOOKING_DETAILS_EXAMPLES,
    footerText:   FOOTER,
  })
}

export async function POST() {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  if (!guard(session.user.role)) return buildApiError('Forbidden', 403)

  try {
    // A media header needs an uploaded sample before Meta will review it.
    const headerHandle = await uploadTemplateHeaderHandle(
      await sampleBookingDetailsPdf(),
      'BookingDetails-sample.pdf',
    )

    const created = await createMetaTemplate({
      name:         TEMPLATE_BOOKING_DETAILS,
      category:     'UTILITY',
      language:     BOOKING_DETAILS_TEMPLATE_LANG,
      bodyText:     BOOKING_DETAILS_BODY,
      bodyExamples: BOOKING_DETAILS_EXAMPLES,
      headerFormat: 'DOCUMENT',
      headerHandle,
      footerText:   FOOTER,
    })

    return buildApiSuccess(
      created,
      `Template "${created.name}" submitted to Meta for review (status ${created.status})`,
    )
  } catch (err) {
    return buildApiError(err instanceof Error ? err.message : String(err), 502)
  }
}
