/**
 * GET /api/b2b-flights/[id] — one confirmed B2B booking with every component
 * expanded. Read-only; 404 for anything that is not confirmed.
 */
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { getB2bBooking } from '@/lib/b2b-flights'
import { isB2bConfigured } from '@/lib/b2b-db'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return buildApiError('Unauthorized', 401)
  if (session.user.role === 'CLIENT') return buildApiError('Forbidden', 403)
  if (!isB2bConfigured()) return buildApiError('B2B database is not configured', 503)

  const id = Number(params.id)
  if (!Number.isInteger(id) || id <= 0) return buildApiError('Invalid booking id', 400)

  try {
    const booking = await getB2bBooking(id)
    if (!booking) return buildApiError('Booking not found, or not confirmed', 404)
    return buildApiSuccess(booking)
  } catch (err) {
    return buildApiError(err instanceof Error ? err.message : 'Failed to read the B2B booking', 502)
  }
}
