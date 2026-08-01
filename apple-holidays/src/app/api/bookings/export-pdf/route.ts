import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildApiError } from '@/lib/utils'
import { ensurePdfkitDataFiles, loadLogo, loadPdfDocumentCtor } from '@/lib/pdfkit-boot'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

function text(value: unknown): string {
  return String(value ?? '—').replace(/[^\x20-\x7E]/g, '-')
}

function date(value: unknown): string {
  if (!value) return '—'
  return new Date(String(value)).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

export async function GET(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return buildApiError('Unauthorized', 401)

  const url = new URL(req.url)
  const mode = url.searchParams.get('mode') === 'numbers' ? 'numbers' : 'full'
  const query = new URLSearchParams(url.searchParams)
  query.delete('mode')
  query.set('limit', '200')
  query.set('page', '1')

  try {
    // Reuse the All Bookings query so permissions and all active filters remain identical.
    const bookingsResponse = await fetch(`${url.origin}/api/bookings?${query.toString()}`, {
      headers: { cookie: req.headers.get('cookie') ?? '' },
      cache: 'no-store',
    })
    const result = await bookingsResponse.json()
    if (!bookingsResponse.ok || !result.success) {
      return buildApiError(result.error ?? 'Failed to load bookings', bookingsResponse.status || 500)
    }

    const bookings = result.data.bookings as any[]
    await ensurePdfkitDataFiles()
    const PDFDocument = await loadPdfDocumentCtor()
    const logo = await loadLogo()
    const chunks: Buffer[] = []
    const doc = new (PDFDocument as any)({ size: 'A4', margin: 42, bufferPages: true })
    doc.on('data', (chunk: Buffer) => chunks.push(chunk))

    if (logo) {
      try { doc.image(logo, 42, 32, { fit: [42, 42] }) } catch { /* optional logo */ }
    }
    doc.fontSize(17).fillColor('#0f172a').text('Apple Holidays MMT', 94, 35)
    doc.fontSize(9).fillColor('#64748b').text(`Bookings Report - ${mode === 'numbers' ? 'Reference Numbers Only' : 'Full Details'}`, 94, 56)
    doc.fontSize(9).text(`Generated: ${date(new Date())}`, 420, 38, { width: 130, align: 'right' })
    doc.text(`${result.data.total} booking(s) found`, 420, 51, { width: 130, align: 'right' })
    doc.moveTo(42, 86).lineTo(553, 86).strokeColor('#1e293b').stroke()

    let y = 104
    const ensureSpace = (height = 55) => {
      if (y + height > 770) { doc.addPage(); y = 42 }
    }
    for (let i = 0; i < bookings.length; i++) {
      const b = bookings[i]
      ensureSpace(mode === 'numbers' ? 32 : 62)
      const lead = b.passengers?.find((p: any) => p.isLead) ?? b.passengers?.[0]
      doc.fontSize(10).fillColor('#0f172a').font('Helvetica-Bold').text(`${i + 1}. ${text(b.bookingRef)}`, 42, y)
      doc.font('Helvetica').fontSize(8).fillColor('#475569')
      if (mode === 'numbers') {
        doc.text(`IS/VN: ${text(b.isNumber)}   Agent ID: ${text(b.agentBookingId)}   CNTL: ${text(b.cntlNumber)}   Country: ${text(b.operationCountry)}`, 42, y + 15, { width: 511 })
        y += 32
      } else {
        doc.text(`Lead: ${text(lead?.name)}   Agent: ${text(b.agent)}   File Handler: ${text(b.fileHandler)}   Pax: ${Number(b.paxAdults ?? 0) + Number(b.paxChildren ?? 0)}`, 42, y + 16, { width: 511 })
        doc.text(`Arrival: ${date(b.arrivalDate)}   Departure: ${date(b.departureDate)}   Total: ${text(b.currency)} ${text(b.quotedTotal)}   Status: ${text(b.status)}`, 42, y + 30, { width: 511 })
        if ((b.passengers?.length ?? 0) > 1) doc.text(`Passengers: ${b.passengers.map((p: any) => text(p.name)).join(', ')}`, 42, y + 44, { width: 511 })
        y += (b.passengers?.length ?? 0) > 1 ? 62 : 50
      }
      doc.moveTo(42, y - 5).lineTo(553, y - 5).strokeColor('#e2e8f0').stroke()
    }
    if (!bookings.length) doc.fontSize(10).fillColor('#64748b').text('No bookings match the current filters.', 42, y)
    const pdfDone = new Promise<void>((resolve, reject) => { doc.on('end', resolve); doc.on('error', reject) })
    doc.end()
    await pdfDone
    const filename = `bookings-${mode}-${new Date().toISOString().slice(0, 10)}.pdf`
    return new Response(new Uint8Array(Buffer.concat(chunks)), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (error) {
    console.error('[bookings/export-pdf]', error)
    return buildApiError(error instanceof Error ? error.message : 'Failed to generate bookings PDF', 500)
  }
}