/**
 * Run the Aahaas B2C import on demand from the B2C control centre.
 *
 * The only write path staff can trigger by hand. It INSERTS new bookings only —
 * an existing ref is left untouched, and a ref already held by a non-B2C booking
 * is reported as a conflict rather than overwritten. Nothing is ever written to the
 * Aahaas store itself, which this app only ever reads.
 *
 * `?dryRun=1` computes the same result and writes nothing.
 */
import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { hasPermission } from '@/lib/rbac'
import { runB2cImport } from '@/lib/b2c-import'
import type { UserRole } from '@prisma/client'

export const dynamic = 'force-dynamic'
// A backfill over every upcoming order can take a while on a cold connection.
export const maxDuration = 300

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)

  const role = session.user.role as UserRole
  // Creating bookings is the operation being performed, so gate on that.
  if (role === 'CLIENT' || !hasPermission(role, 'booking:create')) {
    return buildApiError('Forbidden — you do not have permission to create bookings', 403)
  }

  const body = (await req.json().catch(() => ({}))) as {
    mode?: 'nightly' | 'backfill'
    dryRun?: boolean
    limit?: number
  }
  const dryRun = body.dryRun === true || req.nextUrl.searchParams.get('dryRun') === '1'
  const mode = body.mode === 'nightly' ? 'nightly' : 'backfill'

  try {
    const summary = await runB2cImport({
      mode,
      dryRun,
      limit: body.limit,
      trigger: 'manual',
      triggeredBy: session.user.email ?? session.user.name ?? null,
    })
    return buildApiSuccess(
      summary,
      dryRun
        ? `Preview complete — ${summary.created.length} would be created`
        : `Import complete — ${summary.created.length} created, ${summary.alreadyImported.length} already present`,
    )
  } catch (err) {
    console.error('[POST /api/b2c/import]', err)
    return buildApiError(err instanceof Error ? err.message : 'Import failed', 500)
  }
}
