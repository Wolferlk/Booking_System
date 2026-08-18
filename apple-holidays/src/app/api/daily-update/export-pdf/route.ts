import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildApiError } from '@/lib/utils'
import {
  DAILY_UPDATE_ROLES, parseDailyUpdateQuery, fetchDailyUpdateRows, sortDailyUpdateRows,
} from '@/lib/daily-update'
import { buildDailyUpdatePdf } from '@/lib/daily-update-pdf'
import type { UserRole } from '@prisma/client'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

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
    // Capped below the sheet's own limit: a PDF is a printout, and 800 rows is
    // already 30-odd pages of it.
    const rows = sortDailyUpdateRows(await fetchDailyUpdateRows(q, scope, 800, now), q)
    const pdf = await buildDailyUpdatePdf(rows, q, now, { generatedBy: session.user.name ?? null })
    const stamp = now.toISOString().slice(0, 10)

    return new Response(new Uint8Array(pdf), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="daily-update-${stamp}.pdf"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (error) {
    console.error('[daily-update/export-pdf]', error)
    return buildApiError(error instanceof Error ? error.message : 'Failed to generate the daily update PDF', 500)
  }
}
