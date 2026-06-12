import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { fetchUnprocessedEmails } from '@/lib/mail-processor'

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  if (!['BT_USER', 'SUPER_ADMIN'].includes(session.user.role)) return buildApiError('Forbidden', 403)

  const limit  = Math.min(Number(req.nextUrl.searchParams.get('limit')  ?? '50'), 500)
  const folder = (req.nextUrl.searchParams.get('folder') ?? 'all') as 'inbox' | 'all'

  try {
    const emails = await fetchUnprocessedEmails(limit, folder)
    return buildApiSuccess(emails)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('Mail fetch error:', message)
    return buildApiError(message, 500)
  }
}
