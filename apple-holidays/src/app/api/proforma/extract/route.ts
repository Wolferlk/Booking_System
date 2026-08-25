/**
 * POST /api/proforma/extract — read an uploaded proforma, write nothing.
 *
 * The clerk drops the PDF into the filing form and gets the form back filled
 * in. That is the whole purpose: the figures on a hotel invoice are already
 * printed, and typing them again is a transcription step that only adds
 * mistakes.
 *
 * **Nothing here touches the database and nothing is stored.** The file is read
 * in memory, handed to the model, and the answer is returned to the form for a
 * person to check. Filing still goes through POST /api/proforma exactly as
 * before, with whatever values the clerk confirms — so a bad read costs a
 * correction in an open form, never a wrong row.
 *
 * A failure is a 200 with `extraction: null` and a reason, not an error status:
 * "the reader could not manage this one" is an ordinary outcome that leaves the
 * clerk typing, which is what they did before this endpoint existed. Only a bad
 * request (no file, wrong type, too large) is a 4xx.
 */
import { NextRequest } from 'next/server'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { guardReservation } from '@/lib/reservation-guard'
import { ACCEPTED_UPLOAD, MAX_UPLOAD_BYTES } from '@/lib/proforma'
import { extractProformaInvoice, ProformaUnreadableError } from '@/lib/proforma-extract'

export const dynamic = 'force-dynamic'
// Reading a long PDF and waiting on the model comfortably exceeds the default.
export const maxDuration = 60

function mimeFor(name: string): string {
  const ext = name.toLowerCase().split('.').pop() ?? ''
  switch (ext) {
    case 'pdf': return 'application/pdf'
    case 'png': return 'image/png'
    case 'webp': return 'image/webp'
    case 'heic': return 'image/heic'
    case 'heif': return 'image/heif'
    default: return 'image/jpeg'
  }
}

export async function POST(req: NextRequest) {
  // The same grant filing needs. Reading an invoice is cheap but it is not
  // free, and it must not be an open door for anyone with a session.
  const g = await guardReservation('proforma:manage')
  if (!g.ok) return g.response

  const form = await req.formData()
  const file = form.get('file')

  if (!(file instanceof File) || file.size === 0) {
    return buildApiError('Attach the invoice document to read it', 422)
  }
  if (!ACCEPTED_UPLOAD.test(file.name)) {
    return buildApiError('Upload a PDF or an image of the invoice', 422)
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return buildApiError(`That file is larger than ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB`, 422)
  }

  const bookingRef = String(form.get('bookingRef') ?? '').trim() || null
  const buffer = Buffer.from(await file.arrayBuffer())
  const mime = file.type && file.type !== 'application/octet-stream' ? file.type : mimeFor(file.name)

  try {
    const extraction = await extractProformaInvoice(buffer, mime, file.name, bookingRef)
    return buildApiSuccess({ extraction, reason: null })
  } catch (err) {
    const readable = err instanceof ProformaUnreadableError
    if (!readable) console.error('[proforma-extract] failed:', err)

    return buildApiSuccess({
      extraction: null,
      reason: readable
        ? (err as Error).message
        : 'The invoice could not be read automatically. Enter the figures by hand.',
    })
  }
}
