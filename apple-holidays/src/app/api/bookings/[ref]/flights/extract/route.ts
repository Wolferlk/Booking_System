/**
 * POST /api/bookings/[ref]/flights/extract
 *
 * Accepts a multipart upload (image or PDF) and uses AI vision to extract
 * flight details from the document.  Returns an array of flight segments
 * ready to be merged into the booking's flight edit form.
 *
 * Also accepts JSON body { itemId, itemName } to process a cloud file
 * from the booking's linked OneDrive folder, or JSON { text } for flight
 * details pasted into the AI Auto-fill popup.
 */
import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { extractFlightsFromImage, extractFlightsFromText } from '@/lib/openai'
import { resolveBookingDriveFolder } from '@/lib/onedrive-monitor'
import { downloadDriveItem } from '@/lib/graph-client'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ ref: string }> },
) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)

  const allowed = ['TE_USER', 'BT_USER', 'GT_TE_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN']
  if (!allowed.includes(session.user.role)) return buildApiError('Forbidden', 403)

  const { ref } = await params

  // ── Cloud file / pasted text mode ────────────────────────────────────────────
  const contentType = req.headers.get('content-type') ?? ''
  if (contentType.includes('application/json')) {
    const body = await req.json() as { itemId?: string; itemName?: string; text?: string }
    const { itemId, itemName, text } = body

    // Pasted free-form flight text (AI auto-fill popup)
    if (text !== undefined) {
      if (!String(text).trim()) return buildApiError('Paste some flight text first')
      const flights = await extractFlightsFromText(String(text))
      return buildApiSuccess(
        { flights, source: 'pasted text' },
        flights.length ? undefined : 'No flight details found in the text',
      )
    }

    if (!itemId || !itemName) return buildApiError('itemId and itemName are required')

    const folder = await resolveBookingDriveFolder(ref)
    if (!folder) return buildApiError('No OneDrive folder linked to this booking', 404)

    let buffer: Buffer
    try {
      buffer = await downloadDriveItem(folder.driveId, itemId)
    } catch (err) {
      return buildApiError(`Failed to download file: ${err instanceof Error ? err.message : String(err)}`, 500)
    }

    const ext = itemName.split('.').pop()?.toLowerCase() ?? 'bin'
    const isImage = /^(jpe?g|png|webp|gif)$/.test(ext)
    const mimeType = isImage ? `image/${ext === 'jpg' ? 'jpeg' : ext}` : 'application/pdf'
    const base64 = buffer.toString('base64')

    const flights = await extractFlightsFromImage(base64, mimeType)
    return buildApiSuccess({ flights, source: itemName })
  }

  // ── Device upload mode ───────────────────────────────────────────────────────
  const formData = await req.formData()
  const file = formData.get('file') as File | null
  if (!file) return buildApiError('No file provided')

  const buffer = Buffer.from(await file.arrayBuffer())
  const fileName = file.name.toLowerCase()
  const ext = fileName.split('.').pop() ?? 'bin'
  const isImage = /^(jpe?g|jpg|png|webp|gif)$/.test(ext)
  const mimeType = file.type || (isImage ? `image/${ext === 'jpg' ? 'jpeg' : ext}` : 'application/pdf')

  if (!isImage && !fileName.endsWith('.pdf')) {
    return buildApiError('Only image files (JPG, PNG, WebP) or PDF are supported for flight extraction')
  }

  const base64 = buffer.toString('base64')
  const flights = await extractFlightsFromImage(base64, mimeType)

  if (flights.length === 0) {
    return buildApiSuccess({ flights: [], source: file.name }, 'No flight segments found in the file')
  }

  return buildApiSuccess({ flights, source: file.name })
}
