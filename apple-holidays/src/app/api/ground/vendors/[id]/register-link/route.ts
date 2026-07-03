import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildApiError, buildApiSuccess } from '@/lib/utils'

export const dynamic = 'force-dynamic'

// Returns the universal vendor self-registration link
export async function GET(_req: NextRequest, { params: _ }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  if (!['GT_USER', 'GT_TE_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN'].includes(session.user.role)) {
    return buildApiError('Forbidden', 403)
  }

  const appUrl = process.env.APP_URL || process.env.NEXTAUTH_URL || 'http://localhost:3000'
  const link   = `${appUrl}/vendor/register`

  return buildApiSuccess({ link })
}
