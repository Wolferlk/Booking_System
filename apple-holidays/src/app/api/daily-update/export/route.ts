import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildApiError } from '@/lib/utils'
import {
  DAILY_UPDATE_ROLES, parseDailyUpdateQuery, fetchDailyUpdateRows, sortDailyUpdateRows,
  countCreatedToday,
} from '@/lib/daily-update'
import { buildDailyUpdateWorkbook } from '@/lib/daily-update-xlsx'
import type { UserRole } from '@prisma/client'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return buildApiError('Unauthorized', 401)

  const role = session.user.role as UserRole
  if (!DAILY_UPDATE_ROLES.includes(role)) return buildApiError('Forbidden', 403)

  const scope = {
    role,
    country:   (session.user as { country?: string }).country,
    countries: (session.user as { countries?: string[] }).countries,
  }

  const q = parseDailyUpdateQuery(req.nextUrl.searchParams)
  const now = new Date()

  try {
    const [rows, bookedToday] = await Promise.all([
      fetchDailyUpdateRows(q, scope, 1500, now).then(r => sortDailyUpdateRows(r, q)),
      countCreatedToday(q, scope, now),
    ])
    const buf = buildDailyUpdateWorkbook(rows, q, now, bookedToday)
    const stamp = now.toISOString().slice(0, 10)

    return new NextResponse(new Uint8Array(buf), {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="daily-update-${stamp}.xlsx"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (error) {
    console.error('[daily-update/export]', error)
    return buildApiError(error instanceof Error ? error.message : 'Failed to build the daily update sheet', 500)
  }
}
