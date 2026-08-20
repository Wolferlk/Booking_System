/**
 * GET /api/srilanka/drive-log/export-pdf — the Drive Log as a printable statement.
 *
 * Same query string as the screen and the workbook; see the export route.
 */
import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildApiError } from '@/lib/utils'
import { hasPermission } from '@/lib/rbac'
import { parseDriveLogQuery } from '@/lib/sl-drive-log'
import { fetchDriveLogRows } from '@/lib/sl-drive-log-server'
import { buildDriveLogPdf } from '@/lib/sl-drive-log-pdf'
import type { UserRole } from '@prisma/client'

export const dynamic = 'force-dynamic'
// Chromium needs the Node runtime and time to spin up.
export const runtime = 'nodejs'
export const maxDuration = 60

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)

  const role = session.user.role as UserRole
  if (!hasPermission(role, 'pnl:read')) return buildApiError('Forbidden', 403)

  const q = parseDriveLogQuery(req.nextUrl.searchParams)
  const now = new Date()

  try {
    const { rows } = await fetchDriveLogRows(q, now)
    const pdf = await buildDriveLogPdf(rows, q, now, session.user.name ?? null)
    const stamp = q.from === q.to ? q.from : `${q.from}_${q.to}`

    return new Response(new Uint8Array(pdf), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="drive-log-${stamp}.pdf"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (err) {
    console.error('[drive-log/export-pdf]', err)
    return buildApiError(err instanceof Error ? err.message : 'Failed to generate the drive log PDF', 500)
  }
}
