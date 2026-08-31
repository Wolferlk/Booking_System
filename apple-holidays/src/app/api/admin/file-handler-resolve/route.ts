/**
 * GET  — how many bookings still hold the "30sundays Aahaas" placeholder.
 * POST — replace all of them with the real handler from apple_quote_ai.
 *
 * Admin-only, and the write side is the same guarded sweep the scheduler runs:
 * the quote database is read-only, and only `bookings.fileHandler` on rows that
 * still hold the placeholder is written.
 */
import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { countPlaceholderBookings, resolveAllFileHandlers, PLACEHOLDER_FILE_HANDLER } from '@/lib/file-handler-resolve'
import { isQuoteAiConfigured, quoteAiDatabaseName } from '@/lib/quote-ai-db'
import type { UserRole } from '@prisma/client'

export const dynamic = 'force-dynamic'

function assertAdmin(role: UserRole | undefined): string | null {
  if (!role) return 'Unauthorized'
  return ['SUPER_ADMIN', 'ULTRA_SUPER_ADMIN'].includes(role) ? null : 'Forbidden — admin only'
}

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  const denied = assertAdmin(session.user.role as UserRole)
  if (denied) return buildApiError(denied, 403)

  return buildApiSuccess({
    placeholder: PLACEHOLDER_FILE_HANDLER,
    pending:     await countPlaceholderBookings(),
    configured:  isQuoteAiConfigured(),
    schema:      quoteAiDatabaseName(),
  })
}

export async function POST(_req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  const denied = assertAdmin(session.user.role as UserRole)
  if (denied) return buildApiError(denied, 403)

  try {
    return buildApiSuccess(await resolveAllFileHandlers(session.user.id))
  } catch (err) {
    return buildApiError(err instanceof Error ? err.message : 'Replace failed', 500)
  }
}
