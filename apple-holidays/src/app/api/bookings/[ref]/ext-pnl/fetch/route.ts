import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { fetchPnlById } from '@/lib/accounts-db'

/** POST — force a live re-fetch of the external PNL data for this booking.
 *  Updates the cached snapshot without changing the matched link. */
export async function POST(
  _req: NextRequest,
  { params }: { params: { ref: string } },
) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)

  const booking = await prisma.booking.findUnique({
    where: { bookingRef: params.ref },
    select: { id: true, externalPnlLink: true },
  })
  if (!booking) return buildApiError('Booking not found', 404)
  if (!booking.externalPnlLink) return buildApiError('No PNL link found — link first', 400)

  try {
    const full = await fetchPnlById(booking.externalPnlLink.externalPnlId)
    if (!full) return buildApiError('External PNL record not found or deleted', 404)

    const updated = await prisma.externalPnlLink.update({
      where: { bookingId: booking.id },
      data: {
        cachedRecord:  full.record as object,
        cachedItems:   full.items as object[],
        lastFetchedAt: new Date(),
      },
    })
    return buildApiSuccess(updated)
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'External DB unreachable'
    return buildApiError(msg, 502)
  }
}
