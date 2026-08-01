import { NextRequest, NextResponse } from 'next/server'
import { requireCaller } from '@/lib/public-api/fh-api-auth'
import { apiOk, runRoute, FhApiError } from '@/lib/public-api/fh-http'
import { logFhAction, requireBooking } from '@/lib/public-api/fh-actions'
import { buildFhPdfFileName, type FhPdfBooking } from '@/lib/filehandler-booking-html'
import { generateFhBookingPdf } from '@/lib/filehandler-booking-pdf'

export const dynamic = 'force-dynamic'
// PDFKit renders in-process (no headless browser), so it needs the Node runtime
// but only a small time budget.
export const runtime = 'nodejs'
export const maxDuration = 30

/**
 * GET /api/public/fh/v1/bookings/{ref}/pdf
 *
 * The "Booking Update" PDF — the same document the portal downloads, filename
 * `<IS>_<CNTL>CNTL_Updates.PDF`.
 *
 * Returns the binary by default. Add `?format=base64` to get it inside the JSON
 * envelope instead, which is easier for integrations that cannot stream files.
 */
export async function GET(req: NextRequest, { params }: { params: { ref: string } }) {
  return runRoute('pdf/download', async (requestId) => {
    const caller = await requireCaller(req, 'document:read')
    const booking = await requireBooking(decodeURIComponent(params.ref))

    const doc = booking as unknown as FhPdfBooking
    const filename = buildFhPdfFileName(doc)

    let pdf: Buffer
    try {
      pdf = await generateFhBookingPdf(doc, { generatedBy: caller.handler.name })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to generate the PDF'
      throw new FhApiError(msg, 502, 'PDF_FAILED')
    }

    await logFhAction(caller, booking, 'PDF_GENERATED', `Generated ${filename}`)

    if ((req.nextUrl.searchParams.get('format') || '').toLowerCase() === 'base64') {
      return apiOk(
        {
          filename,
          content_type: 'application/pdf',
          size_bytes: pdf.length,
          content_base64: pdf.toString('base64'),
          message: `Generated ${filename}`,
        },
        200,
        requestId,
      )
    }

    return new NextResponse(new Uint8Array(pdf), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': String(pdf.length),
        'Cache-Control': 'no-store',
        'x-request-id': requestId,
      },
    })
  })
}
