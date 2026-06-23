import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { searchPnlRecords } from '@/lib/accounts-db'

/** GET ?q=<search-term> — search the Accounts external PNL database by any identifier. */
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)

  const q = req.nextUrl.searchParams.get('q')?.trim()
  if (!q || q.length < 2) return buildApiError('Query must be at least 2 characters', 400)

  try {
    const results = await searchPnlRecords(q, 30)
    return buildApiSuccess(results)
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'External DB unreachable'
    return buildApiError(msg, 502)
  }
}
