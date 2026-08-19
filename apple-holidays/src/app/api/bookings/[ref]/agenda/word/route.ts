/**
 * GET /api/bookings/[ref]/agenda/word
 *
 * Downloads the movement-chart agenda as a Word (.docx) file.
 * `?showDrivers=false` drops the driver column and the transport roster.
 *
 * The document itself is built in `lib/generate-agenda-docx.ts` so that
 * `agenda/send` can attach the same file to WhatsApp / e-mail.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildApiError } from '@/lib/utils'
import { generateAgendaDocx } from '@/lib/generate-agenda-docx'

export const dynamic = 'force-dynamic'

export async function GET(
  req: NextRequest,
  { params }: { params: { ref: string } },
) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)

  const showDrivers = req.nextUrl.searchParams.get('showDrivers') !== 'false'

  let buffer: Buffer
  try {
    buffer = await generateAgendaDocx(params.ref, showDrivers)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return buildApiError(msg === 'Booking not found' ? msg : `Word generation failed: ${msg}`,
      msg === 'Booking not found' ? 404 : 500)
  }

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      'Content-Type':        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': `attachment; filename="${params.ref}.docx"`,
      'Content-Length':      String(buffer.length),
    },
  })
}
