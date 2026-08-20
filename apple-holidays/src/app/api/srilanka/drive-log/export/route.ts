/**
 * GET /api/srilanka/drive-log/export — the Drive Log as a workbook.
 *
 * Takes the same query string as the screen, so the download is exactly the
 * view the user was looking at rather than a second, differently-filtered set
 * of numbers.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildApiError } from '@/lib/utils'
import { hasPermission } from '@/lib/rbac'
import { parseDriveLogQuery } from '@/lib/sl-drive-log'
import { fetchDriveLogRows } from '@/lib/sl-drive-log-server'
import { buildDriveLogWorkbook } from '@/lib/sl-drive-log-xlsx'
import type { UserRole } from '@prisma/client'

export const dynamic = 'force-dynamic'
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
    const buf = buildDriveLogWorkbook(rows, q, now, session.user.name ?? null)
    const stamp = q.from === q.to ? q.from : `${q.from}_${q.to}`

    return new NextResponse(new Uint8Array(buf), {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="drive-log-${stamp}.xlsx"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (err) {
    console.error('[drive-log/export]', err)
    return buildApiError(err instanceof Error ? err.message : 'Failed to build the drive log sheet', 500)
  }
}
