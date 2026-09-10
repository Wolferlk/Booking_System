/**
 * Activity Check → PDF, printed from the HTML report through Chromium.
 *
 * When the host has no usable Chromium the caller is told so explicitly rather
 * than shown a stack trace: the HTML download is the same document and needs no
 * browser on the server, so the UI offers that instead.
 */

import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildApiError } from '@/lib/utils'
import { ACTIVITY_CHECK_ROLES, parseActivityCheckQuery, fetchActivityRows } from '@/lib/activity-check'
import { parseColumns } from '@/lib/activity-check-columns'
import { buildActivityCheckPdf } from '@/lib/activity-check-pdf'
import { PdfEngineUnavailableError } from '@/lib/html-to-pdf'
import type { UserRole } from '@prisma/client'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
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
  const portrait = req.nextUrl.searchParams.get('orientation') === 'portrait'

  try {
    // Capped below the sheet's limit: a PDF is a printout, and 1200 rows is
    // already a thick document.
    const { rows, truncated } = await fetchActivityRows(q, scope, { now, rowCap: 1_200 })
    const pdf = await buildActivityCheckPdf(rows, q, columns, now, {
      generatedBy: session.user.name ?? null,
      truncated,
      landscape: !portrait,
    })

    const slug = q.terms.join('-').replace(/[^a-zA-Z0-9-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 50)
    const name = `activity-check${slug ? `-${slug.toLowerCase()}` : ''}-${now.toISOString().slice(0, 10)}.pdf`

    return new Response(new Uint8Array(pdf), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${name}"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (error) {
    if (error instanceof PdfEngineUnavailableError) {
      console.error('[activity-check/export-pdf] no PDF engine:', error.message)
      return buildApiError(
        'PDF rendering is unavailable on this server. Use the HTML download and print it from your browser — it is the same document.',
        503,
      )
    }
    console.error('[activity-check/export-pdf]', error)
    return buildApiError(error instanceof Error ? error.message : 'Failed to generate the activity PDF', 500)
  }
}
