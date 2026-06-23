import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { testImapConnection, lastImapError, IMAP_PNL_USER } from '@/lib/imap-pnl'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  if (!['BT_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN'].includes(session.user.role)) return buildApiError('Forbidden', 403)

  const result = await testImapConnection()

  return buildApiSuccess({
    ...result,
    lastError: lastImapError,
    env: {
      IMAP_HOST:      process.env.IMAP_HOST ?? '(not set)',
      IMAP_PORT:      process.env.IMAP_PORT ?? '(not set)',
      IMAP2_USERNAME: process.env.IMAP2_USERNAME ? `${process.env.IMAP2_USERNAME}` : '(not set)',
      IMAP2_PASSWORD: process.env.IMAP2_PASSWORD ? `set (${process.env.IMAP2_PASSWORD.length} chars)` : '(not set)',
    },
  })
}
