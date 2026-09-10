/**
 * Activity Check → Excel.
 *
 * The columns come from `cols=` in the query string, so the file the user
 * downloads is the column set they built in the picker, in their order. The
 * rest of the query is the identical search the screen ran, which is what
 * guarantees the sheet holds exactly the rows they were looking at.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildApiError } from '@/lib/utils'
import { ACTIVITY_CHECK_ROLES, parseActivityCheckQuery, fetchActivityRows } from '@/lib/activity-check'
import { parseColumns } from '@/lib/activity-check-columns'
import { buildActivityWorkbook } from '@/lib/activity-check-xlsx'
import type { UserRole } from '@prisma/client'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/** A filename that says what the file is without being opened. */
function filename(terms: string[], stamp: string, ext: string): string {
  const slug = terms.join('-').replace(/[^a-zA-Z0-9-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 50)
  return `activity-check${slug ? `-${slug.toLowerCase()}` : ''}-${stamp}.${ext}`
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return buildApiError('Unauthorized', 401)

  const role = session.user.role as UserRole
  if (!ACTIVITY_CHECK_ROLES.includes(role)) return buildApiError('Forbidden', 403)

  const scope = {
    role,
    country:   (session.user as { country?: string }).country,
    countries: (session.user as { countries?: string[] }).countries,
  }

  const now = new Date()
  const q = parseActivityCheckQuery(req.nextUrl.searchParams, now)
  const columns = parseColumns(req.nextUrl.searchParams.get('cols'))

  try {
    // A spreadsheet can carry more than a screen comfortably scrolls, so the
    // row cap here is above the UI's.
    const { rows, truncated } = await fetchActivityRows(q, scope, { now, rowCap: 8_000 })
    const buf = buildActivityWorkbook(rows, q, columns, now, {
      generatedBy: session.user.name ?? null,
      truncated,
    })

    return new NextResponse(new Uint8Array(buf), {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename(q.terms, now.toISOString().slice(0, 10), 'xlsx')}"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (error) {
    console.error('[activity-check/export]', error)
    return buildApiError(error instanceof Error ? error.message : 'Failed to build the activity sheet', 500)
  }
}
