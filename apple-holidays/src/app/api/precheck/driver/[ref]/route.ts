import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { guardPrecheck } from '@/lib/precheck-guard'
import { buildDriverPrecheck } from '@/lib/driver-precheck'

export const dynamic = 'force-dynamic'

/**
 * GET /api/precheck/driver/[ref] — the Drivers tab for one booking.
 *
 * Read-only. Returns every movement with its assigned driver, the state of the
 * daily WhatsApp briefing, and both the message that was sent and a preview of
 * the one that will be.
 */
export async function GET(_req: NextRequest, { params }: { params: { ref: string } }) {
  const guard = await guardPrecheck()
  if (!guard.ok) return guard.response
  const { session } = guard

  const ref = decodeURIComponent(params.ref).trim()

  const booking = await prisma.booking.findUnique({
    where: { bookingRef: ref },
    select: { operationCountry: true },
  })
  if (!booking) return buildApiError('Booking not found', 404)

  if (session.countries && !(booking.operationCountry && session.countries.includes(booking.operationCountry))) {
    return buildApiError('Forbidden', 403)
  }

  try {
    const view = await buildDriverPrecheck(ref)
    if (!view) return buildApiError('Booking not found', 404)
    return buildApiSuccess(view)
  } catch (e) {
    console.error('[precheck/driver]', e)
    return buildApiError(`Could not load driver pre-checking for ${ref}: ${(e as Error).message}`, 500)
  }
}
