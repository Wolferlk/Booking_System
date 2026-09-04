import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { directIssueEnabled } from '@/lib/ticket-direct-issue'

export const dynamic = 'force-dynamic'

/**
 * GET — is direct ticket issuing on?
 *
 * Read-only, and readable by any signed-in staff member: the tickets page uses
 * it to decide whether to draw the approval panel and the payment gate at all.
 * The switch itself is set by an admin on the Settings page, behind the
 * critical-services password (see /api/admin/settings).
 *
 * This endpoint only ever decides what the screen *offers*. Every gate it
 * relaxes is enforced again on the server — the purchase route reads the same
 * switch for itself and refuses the purchase if it disagrees — so a client
 * lying about this buys nothing.
 */
export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)

  return buildApiSuccess({ directIssue: await directIssueEnabled() })
}
