import { NextRequest } from 'next/server'
import { requireCaller } from '@/lib/public-api/fh-api-auth'
import { apiOk, runRoute, FhApiError } from '@/lib/public-api/fh-http'
import { addFlights, requireBooking, serializeFlight } from '@/lib/public-api/fh-actions'
import { extractFlightsFromImage, extractFlightsFromText } from '@/lib/openai'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

const IMAGE_EXT = /^(jpe?g|png|webp|gif)$/

/**
 * POST /api/public/fh/v1/bookings/{ref}/flights/extract
 *
 * Reads flight segments out of a ticket with GPT-4o. Three input modes:
 *
 *  • `{"text": "…"}`                      — pasted e-ticket text
 *  • `{"file_base64": "…", "file_name": "ticket.pdf"}` — base64 image or PDF
 *  • `multipart/form-data` with `file`    — the same upload the portal sends
 *
 * By default nothing is written: the parsed segments come back for the caller to
 * confirm. Add `save=true` (query or body) to append them to the booking in the
 * same call.
 */
export async function POST(req: NextRequest, { params }: { params: { ref: string } }) {
  return runRoute('flights/extract', async (requestId) => {
    const caller = await requireCaller(req, 'ai:extract')
    const booking = await requireBooking(decodeURIComponent(params.ref))

    const contentType = req.headers.get('content-type') ?? ''
    const querySave = /^(1|true|yes)$/i.test(req.nextUrl.searchParams.get('save') || '')

    let flights: unknown[]
    let source: string
    let save = querySave

    if (contentType.includes('multipart/form-data')) {
      const form = await req.formData()
      const file = form.get('file') as File | null
      if (!file) throw new FhApiError('No file provided in the "file" field', 422, 'FILE_REQUIRED')
      save = save || /^(1|true|yes)$/i.test(String(form.get('save') ?? ''))

      const { base64, mimeType } = readUpload(file.name, Buffer.from(await file.arrayBuffer()), file.type)
      flights = await extractFlightsFromImage(base64, mimeType)
      source = file.name
    } else {
      const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
      save = save || body.save === true || String(body.save ?? '').toLowerCase() === 'true'

      const fileB64 = typeof body.file_base64 === 'string' ? body.file_base64 : undefined
      if (fileB64) {
        const name = String(body.file_name ?? body.filename ?? 'upload.pdf')
        // Tolerate a full data: URL as well as a bare base64 payload.
        const payload = fileB64.includes(',') && fileB64.startsWith('data:') ? fileB64.split(',')[1] : fileB64
        const { base64, mimeType } = readUpload(name, Buffer.from(payload, 'base64'), String(body.mime_type ?? ''))
        flights = await extractFlightsFromImage(base64, mimeType)
        source = name
      } else {
        const text = String(body.text ?? '').trim()
        if (!text) {
          throw new FhApiError('Send "text", "file_base64", or a multipart "file"', 422, 'INPUT_REQUIRED')
        }
        flights = await extractFlightsFromText(text)
        source = 'pasted text'
      }
    }

    // The extractor returns portal-shaped keys (flightNo/fromApt/…), which
    // `readFlight` already accepts alongside the snake_case public spelling.
    if (save && flights.length) {
      const created = await addFlights(caller, booking, flights)
      return apiOk(
        {
          source,
          count: created.length,
          saved: true,
          flights: created.map(serializeFlight),
          message: `Extracted and saved ${created.length} flight${created.length === 1 ? '' : 's'} from ${source}`,
        },
        201,
        requestId,
      )
    }

    return apiOk(
      {
        source,
        count: flights.length,
        saved: false,
        flights,
        message: flights.length
          ? `Extracted ${flights.length} flight segment${flights.length === 1 ? '' : 's'} — POST them to /flights to save`
          : 'No flight details were found',
      },
      200,
      requestId,
    )
  })
}

/** Validate an upload and hand back what the vision call needs. */
function readUpload(name: string, buffer: Buffer, declaredType: string) {
  const ext = name.toLowerCase().split('.').pop() ?? 'bin'
  const isImage = IMAGE_EXT.test(ext)
  if (!isImage && !name.toLowerCase().endsWith('.pdf')) {
    throw new FhApiError('Only image files (JPG, PNG, WebP, GIF) or PDF are supported', 422, 'UNSUPPORTED_FILE')
  }
  if (!buffer.length) throw new FhApiError('The uploaded file is empty', 422, 'EMPTY_FILE')
  if (buffer.length > 10 * 1024 * 1024) {
    throw new FhApiError('The file is larger than 10 MB', 413, 'FILE_TOO_LARGE')
  }
  const mimeType = declaredType || (isImage ? `image/${ext === 'jpg' ? 'jpeg' : ext}` : 'application/pdf')
  return { base64: buffer.toString('base64'), mimeType }
}
