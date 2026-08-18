import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildApiError } from '@/lib/utils'
import {
  DAILY_UPDATE_ROLES, parseDailyUpdateQuery, fetchDailyUpdateRows, sortDailyUpdateRows,
} from '@/lib/daily-update'
import { buildDailyUpdateHtml } from '@/lib/daily-update-html'
import type { UserRole } from '@prisma/client'

export const dynamic = 'force-dynamic'

/**
 * The sheet as a standalone HTML page — the same document the PDF is printed
 * from. `?view=1` opens it in the browser (where it carries its own Print /
 * Save-as-PDF button); without it the file downloads for mailing on.
 */
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
  const inline = req.nextUrl.searchParams.get('view') === '1'
  const now = new Date()

  try {
    const rows = sortDailyUpdateRows(await fetchDailyUpdateRows(q, scope, 1500, now), q)
    const html = buildDailyUpdateHtml(rows, q, now, {
      generatedBy: session.user.name ?? null,
      interactive: inline,
    })
    const stamp = now.toISOString().slice(0, 10)

    return new Response(html, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Disposition': inline
          ? 'inline'
          : `attachment; filename="daily-update-${stamp}.html"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (error) {
    console.error('[daily-update/export-html]', error)
    return buildApiError(error instanceof Error ? error.message : 'Failed to build the daily update sheet', 500)
  }
}
