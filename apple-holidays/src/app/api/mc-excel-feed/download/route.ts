/**
 * MC Excel Feed — downloads. Read-only: builds a file from OPS, touches no workbook.
 *
 *   ?kind=template  the empty dropdown-ready layout (to start a workbook by hand)
 *   ?kind=copy      the same layout with every movement OPS would write today
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import type { UserRole } from '@prisma/client'
import { authOptions } from '@/lib/auth'
import { hasPermission } from '@/lib/rbac'
import { buildApiError } from '@/lib/utils'
import { getFeedConfig } from '@/lib/mc-excel-feed/config'
import { loadFeed, usedListValues } from '@/lib/mc-excel-feed/source'
import { buildFeedWorkbook } from '@/lib/mc-excel-feed/template'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  const role = session.user.role as UserRole
  if (role === 'CLIENT' || !hasPermission(role, 'agenda:read')) return buildApiError('Forbidden', 403)

  const kind = req.nextUrl.searchParams.get('kind') === 'copy' ? 'copy' : 'template'
  const config = await getFeedConfig()
  const [lists, feed] = await Promise.all([
    usedListValues(config).catch(() => ({})),
    kind === 'copy' ? loadFeed(config) : Promise.resolve(null),
  ])
  const buf = await buildFeedWorkbook({ tabName: config.tabName, lists, rows: feed?.rows })
  const day = new Date().toISOString().slice(0, 10)
  const name = kind === 'copy' ? `MC Feed — OPS copy ${day}.xlsx` : 'MC Feed — template.xlsx'
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${name.replace(/[^\x20-\x7e]/g, '-')}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      'Cache-Control': 'no-store',
    },
  })
}
