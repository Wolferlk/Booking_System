/**
 * POST — resolve this booking's placeholder file handler ("30sundays Aahaas")
 * into the real name recorded against its IS number in apple_quote_ai.
 *
 * The manual counterpart to the 10-minute automatic sweep; driven by the button
 * next to File Handler on the booking detail page. Reads the quote database
 * read-only and writes nothing but `bookings.fileHandler`.
 */
import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { resolveFileHandlerForBooking } from '@/lib/file-handler-resolve'

export const dynamic = 'force-dynamic'

export async function POST(
  _req: NextRequest,
  { params }: { params: { ref: string } },
) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)

  try {
    const outcome = await resolveFileHandlerForBooking(params.ref, session.user.id)
    return buildApiSuccess(outcome)
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Resolve failed'
    return buildApiError(msg, msg === 'Booking not found' ? 404 : 500)
  }
}
