/**
 * Activity Check → the printable report as HTML.
 *
 * The same document the PDF is printed from, opened in the user's own browser.
 * It needs no Chromium on the server, so it is both the fast path and the
 * fallback when the PDF engine is unavailable — the page carries its own Print
 * button, and the browser's "Save as PDF" produces the same file.
 */

import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildApiError } from '@/lib/utils'
import { ACTIVITY_CHECK_ROLES, parseActivityCheckQuery, fetchActivityRows } from '@/lib/activity-check'
import { parseColumns } from '@/lib/activity-check-columns'
import { buildActivityCheckHtml } from '@/lib/activity-check-html'
import type { UserRole } from '@prisma/client'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

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
  // `download=1` saves the file; the default opens it in a tab to print from.
  const asFile = req.nextUrl.searchParams.get('download') === '1'

  try {
    const { rows, truncated } = await fetchActivityRows(q, scope, { now, rowCap: 3_000 })
    const html = buildActivityCheckHtml(rows, q, columns, now, {
      generatedBy: session.user.name ?? null,
      truncated,
      interactive: true,
    })

    const slug = q.terms.join('-').replace(/[^a-zA-Z0-9-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 50)
    const name = `activity-check${slug ? `-${slug.toLowerCase()}` : ''}-${now.toISOString().slice(0, 10)}.html`

    return new Response(html, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Disposition': `${asFile ? 'attachment' : 'inline'}; filename="${name}"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (error) {
    console.error('[activity-check/export-html]', error)
    return buildApiError(error instanceof Error ? error.message : 'Failed to build the activity report', 500)
  }
}
