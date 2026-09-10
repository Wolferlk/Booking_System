/**
 * POST /api/srilanka/driver-settlements/export — the register as a workbook.
 *
 * POST rather than GET because a download now carries a layout: which columns,
 * in which order, under which headings. That will not fit in a query string
 * once somebody has renamed six of them, and a layout in a URL is a layout that
 * gets truncated by a proxy on the way past.
 *
 * The *filters* still travel as a query string, exactly as the screen sends
 * them, so the rows in the sheet are the rows on the screen — the window is
 * re-read here rather than uploaded, because a browser that had been left open
 * for an hour would otherwise download an hour-old set of figures.
 */
import { NextRequest, NextResponse } from 'next/server'
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
import { buildSettlementWorkbook } from '@/lib/sl-settlement-xlsx'
import type { UserRole } from '@prisma/client'

export const dynamic = 'force-dynamic'
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
    // No body, or an unreadable one: the shipped layout is a fine download.
  }

  try {
    const result = await fetchDriveLogRows(toDriveLogQuery(q))

    let packages = new Map<string, number>()
    try {
      packages = await savedPackageCosts(result.rows.map(r => r.bookingRef))
    } catch (err) {
      console.error('[driver-settlements/export] package costs', err)
    }

    const rows = sortRegisterRows(
      applyRegisterFilters(
        result.rows.map(r => toRegisterRow(r, packages.get(r.bookingRef) ?? null)), q),
      q)

    const buf = buildSettlementWorkbook(rows, q, view, new Date(), session.user.name ?? null)
    const stamp = q.from === q.to ? q.from : `${q.from}_${q.to}`

    return new NextResponse(new Uint8Array(buf), {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="driver-settlements-${stamp}.xlsx"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (err) {
    console.error('[driver-settlements/export]', err)
    return buildApiError(err instanceof Error ? err.message : 'Failed to build the settlement sheet', 500)
  }
}
