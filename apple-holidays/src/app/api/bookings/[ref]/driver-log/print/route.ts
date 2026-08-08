import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildApiError } from '@/lib/utils'
import { buildDriverLogView } from '@/lib/driver-log-server'
import { renderDriverLogHtml } from '@/lib/generate-driver-log-pdf'

export const dynamic = 'force-dynamic'

const READ_ROLES = ['AC_USER', 'BT_USER', 'GT_USER', 'GT_VN_USER', 'GT_TE_USER', 'TE_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN']

/**
 * GET — the Driver Advance Sheet as a printable HTML page.
 *
 * This is the download path used by the UI: the page opens in a new tab and
 * fires the browser's print dialog, where the user picks "Save as PDF". It needs
 * no server-side Chromium, which is what made the old direct-PDF download fail
 * on the arm64 serverless host.
 *
 * `?print=0` opens the sheet without auto-printing (plain preview).
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { ref: string } },
) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  if (!READ_ROLES.includes(session.user.role)) return buildApiError('Forbidden', 403)

  const view = await buildDriverLogView(params.ref)
  if (!view) return buildApiError(`Booking ${params.ref} not found`, 404)

  const autoPrint = req.nextUrl.searchParams.get('print') !== '0'

  return new NextResponse(renderDriverLogHtml(view, { autoPrint }), {
    status: 200,
    headers: {
      'Content-Type':  'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  })
}
