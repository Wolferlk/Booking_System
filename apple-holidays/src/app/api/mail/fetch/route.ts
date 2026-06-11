import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { fetchUnprocessedEmails } from '@/lib/mail-processor'

// GET — list recent inbox emails (subject, type, date)
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  if (!['BT_USER', 'SUPER_ADMIN'].includes(session.user.role)) return buildApiError('Forbidden', 403)

  const limit = Number(req.nextUrl.searchParams.get('limit') ?? '20')

  try {
    const emails = await fetchUnprocessedEmails(limit)
    return buildApiSuccess(emails)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    const stack = err instanceof Error ? err.stack : ''
    console.error('Mail fetch error:', message, '\n', stack)
    return buildApiError(message, 500)
  }
}
