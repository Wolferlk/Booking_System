/**
 * POST /api/public/journey-map/:ref/activity?t=…
 *
 * The traveller-facing pin detail. Same research as the operations route, but
 * written for the guest rather than the file handler, and gated by the signed
 * portal-link token instead of a session.
 */
import { NextRequest } from 'next/server'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { verifyPortalLinkToken } from '@/lib/portal-link'
import { buildActivityBrief } from '@/lib/journey-activity'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(
  req: NextRequest,
  { params }: { params: { ref: string } },
) {
  const token = req.nextUrl.searchParams.get('t') ?? ''
  if (!verifyPortalLinkToken(params.ref, token)) {
    return buildApiError('This link is invalid or has expired.', 403)
  }

  const body = await req.json().catch(() => ({})) as {
    place?: string; title?: string; city?: string; country?: string
  }
  const place = (body.place ?? '').trim()
  if (!place) return buildApiError('A place is required', 400)

  const data = await buildActivityBrief({
    place,
    title: body.title,
    city: body.city,
    country: body.country,
    audience: 'guest',
    bookingRef: params.ref,
  })
  return buildApiSuccess(data)
}
