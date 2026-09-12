/**
 * The count check as a downloadable workbook.
 *
 * Same window, same rows, same reasons as the detail route — rendered into a
 * file with one tab per population and two tabs of explanation, so the answer
 * survives leaving the screen it was asked on. See `reconcile-count-workbook.ts`
 * for what each tab holds and why the file explains itself.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildApiError } from '@/lib/utils'
import { parseReconcileWindow } from '@/lib/reports/created-reconcile'
import { reconcileCreatedDetail } from '@/lib/reports/created-reconcile-detail'
import { renderReconcileWorkbook, reconcileWorkbookFilename } from '@/lib/reports/reconcile-count-workbook'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  if (session.user.role === 'CLIENT') return buildApiError('Forbidden', 403)

  const window = parseReconcileWindow(req.nextUrl.searchParams)
  if ('error' in window) return buildApiError(window.error, 400)

  try {
    const detail = await reconcileCreatedDetail(window.from, window.to)
    const buf = renderReconcileWorkbook(detail, { generatedBy: session.user.name ?? null })

    return new NextResponse(new Uint8Array(buf), {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${reconcileWorkbookFilename(detail)}"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (err) {
    console.error('[GET /api/bookings/report-count/workbook]', err)
    return buildApiError('Could not build the reconciliation workbook', 500)
  }
}
