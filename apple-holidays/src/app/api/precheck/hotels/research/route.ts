import { NextRequest } from 'next/server'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { guardPrecheck } from '@/lib/precheck-guard'
import { researchHotelContacts } from '@/lib/hotel-ai'

export const dynamic = 'force-dynamic'
// Live web search plus a model round-trip regularly runs past the default
// serverless budget.
export const maxDuration = 120

/**
 * POST /api/precheck/hotels/research — ask AI to find a hotel's contacts.
 *
 * Returns suggestions only. Nothing is saved: the client shows the result with
 * its sources and confidence, and a human chooses what to keep before any
 * write happens. That separation is the point — an unverified scraped number
 * must never silently become the number staff ring at D-10.
 */
export async function POST(req: NextRequest) {
  const guard = await guardPrecheck()
  if (!guard.ok) return guard.response

  if (!process.env.OPENAI_API_KEY?.trim()) {
    return buildApiError('AI lookup is not configured on this server (OPENAI_API_KEY missing).', 503)
  }

  let body: Record<string, unknown>
  try {
    body = await req.json() as Record<string, unknown>
  } catch {
    return buildApiError('Invalid JSON body')
  }

  const hotelName = String(body.hotelName ?? '').trim()
  if (!hotelName) return buildApiError('A hotel name is required')

  try {
    const result = await researchHotelContacts({
      hotelName,
      city: body.city == null ? null : String(body.city),
      country: body.country == null ? null : String(body.country),
      countryCode: body.countryCode ? String(body.countryCode).toUpperCase().slice(0, 2) : 'LK',
      bookingRef: body.bookingRef == null ? null : String(body.bookingRef),
    })
    return buildApiSuccess(result)
  } catch (e) {
    console.error('[precheck/research]', e)
    return buildApiError(`AI lookup failed: ${(e as Error).message}`, 502)
  }
}
