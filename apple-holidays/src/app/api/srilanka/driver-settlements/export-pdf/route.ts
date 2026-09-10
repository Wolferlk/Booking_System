/**
 * POST /api/srilanka/driver-settlements/export-pdf — the printable register.
 *
 * Same shape as the workbook route next door, and for the same reason: the
 * filters travel as a query string and the layout travels in the body. See
 * `../export/route.ts`.
 */
import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildApiError } from '@/lib/utils'
import { hasPermission } from '@/lib/rbac'
import { fetchDriveLogRows } from '@/lib/sl-drive-log-server'
import { savedPackageCosts } from '@/lib/sl-settlement-docs-server'
import {
  applyRegisterFilters, parseRegisterQuery, sortRegisterRows, toDriveLogQuery, toRegisterRow,
} from '@/lib/sl-settlement-register'
import { defaultView, normaliseView } from '@/lib/sl-settlement-columns'
import { buildSettlementPdf } from '@/lib/sl-settlement-pdf'
import type { UserRole } from '@prisma/client'

export const dynamic = 'force-dynamic'
// Chromium needs the Node runtime and time to spin up.
export const runtime = 'nodejs'
export const maxDuration = 60

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)

  const role = session.user.role as UserRole
  if (!hasPermission(role, 'pnl:read')) return buildApiError('Forbidden', 403)

  const q = parseRegisterQuery(req.nextUrl.searchParams)

  let view = defaultView()
  try {
    const body = await req.json()
    if (body?.view) view = normaliseView(body.view, 'download')
  } catch {
    // No body, or an unreadable one: the shipped layout prints perfectly well.
  }

  try {
    const result = await fetchDriveLogRows(toDriveLogQuery(q))

    let packages = new Map<string, number>()
    try {
      packages = await savedPackageCosts(result.rows.map(r => r.bookingRef))
    } catch (err) {
      console.error('[driver-settlements/export-pdf] package costs', err)
    }

    const rows = sortRegisterRows(
      applyRegisterFilters(
        result.rows.map(r => toRegisterRow(r, packages.get(r.bookingRef) ?? null)), q),
      q)

    const pdf = await buildSettlementPdf(rows, q, view, new Date(), session.user.name ?? null)
    const stamp = q.from === q.to ? q.from : `${q.from}_${q.to}`

    return new Response(new Uint8Array(pdf), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="driver-settlements-${stamp}.pdf"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (err) {
    console.error('[driver-settlements/export-pdf]', err)
    return buildApiError(err instanceof Error ? err.message : 'Failed to generate the register PDF', 500)
  }
}
