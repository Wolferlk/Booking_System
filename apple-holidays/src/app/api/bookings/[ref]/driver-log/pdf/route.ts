import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildApiError } from '@/lib/utils'
import { buildDriverLogView } from '@/lib/driver-log-server'
import { generateDriverLogPdf } from '@/lib/generate-driver-log-pdf'

export const dynamic = 'force-dynamic'

const READ_ROLES = ['AC_USER', 'BT_USER', 'GT_USER', 'GT_VN_USER', 'GT_TE_USER', 'TE_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN']

/** GET — download the Driver Advance Sheet as a PDF. */
export async function GET(
  _req: NextRequest,
  { params }: { params: { ref: string } },
) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  if (!READ_ROLES.includes(session.user.role)) return buildApiError('Forbidden', 403)

  const view = await buildDriverLogView(params.ref)
  if (!view) return buildApiError(`Booking ${params.ref} not found`, 404)

  try {
    const { buffer, filename } = await generateDriverLogPdf(view)
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type':        'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control':       'no-store',
      },
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return buildApiError(`Failed to generate Driver Log PDF: ${msg}`, 500)
  }
}
