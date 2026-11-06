/** Live bookings to offer in the "add bookings" picker. */
import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { canManageGroups, findCandidates, groupsErrorResponse } from '@/lib/wa-groups/server'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  if (!canManageGroups(session.user.role)) return buildApiError('Forbidden', 403)
  const q = req.nextUrl.searchParams.get('q') ?? ''
  const window = req.nextUrl.searchParams.get('window') ?? 'next14'
  try {
    return buildApiSuccess(await findCandidates({ q, window, role: session.user.role }))
  } catch (err) {
    return groupsErrorResponse(err)
  }
}
