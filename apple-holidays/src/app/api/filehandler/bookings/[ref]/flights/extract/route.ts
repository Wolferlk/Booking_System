import { NextRequest } from 'next/server'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { getFileHandlerSession } from '@/lib/filehandler-auth'
import { extractFlightsFromImage, extractFlightsFromText } from '@/lib/openai'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * POST /api/filehandler/bookings/[ref]/flights/extract
 *
 * Two modes, both returning { flights: [...] } ready to auto-fill the flight form:
 *  • multipart with `file` — an image or PDF, read by GPT-4o vision
 *  • JSON { text } — pasted free-form flight text, parsed + corrected by GPT-4o
 *
 * This only extracts; nothing is written to the booking until the handler
 * confirms and the flights POST endpoint saves them.
 */
export async function POST(req: NextRequest) {
  const handler = await getFileHandlerSession()
  if (!handler) return buildApiError('Unauthorized', 401)

  const contentType = req.headers.get('content-type') ?? ''

  // ── Pasted-text mode ──────────────────────────────────────────────────────
  if (contentType.includes('application/json')) {
    const { text } = await req.json().catch(() => ({}))
    if (!text || !String(text).trim()) return buildApiError('Paste some flight text first')
    const flights = await extractFlightsFromText(String(text))
    return buildApiSuccess(
      { flights, source: 'pasted text' },
      flights.length ? undefined : 'No flight details found in the text',
    )
  }

  // ── File-upload mode (image / PDF) ────────────────────────────────────────
  const formData = await req.formData()
  const file = formData.get('file') as File | null
  if (!file) return buildApiError('No file provided')

  const ext = file.name.toLowerCase().split('.').pop() ?? 'bin'
  const isImage = /^(jpe?g|png|webp|gif)$/.test(ext)
  if (!isImage && !file.name.toLowerCase().endsWith('.pdf')) {
    return buildApiError('Only image files (JPG, PNG, WebP) or PDF are supported')
  }
  const mimeType = file.type || (isImage ? `image/${ext === 'jpg' ? 'jpeg' : ext}` : 'application/pdf')
  const base64 = Buffer.from(await file.arrayBuffer()).toString('base64')

  const flights = await extractFlightsFromImage(base64, mimeType)
  return buildApiSuccess(
    { flights, source: file.name },
    flights.length ? undefined : 'No flight segments found in the file',
  )
}
