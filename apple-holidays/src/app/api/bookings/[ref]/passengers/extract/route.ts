/**
 * POST /api/bookings/[ref]/passengers/extract
 *
 * Feeds the "AI Auto-fill" popup on the Passengers card. Three input modes,
 * all returning { passengers: [...] } ready to be merged into the passenger
 * edit form:
 *   • multipart with `file`  — an image or PDF (passenger list, passport scan)
 *   • JSON { text }          — pasted free-form passenger text
 *   • JSON { itemId, itemName } — a file from the booking's OneDrive folder
 *
 * Nothing is written to the booking here — the handler reviews and saves.
 */
import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { extractPassengersFromDocument, extractPassengersFromText } from '@/lib/openai'
import { resolveBookingDriveFolder } from '@/lib/onedrive-monitor'
import { downloadDriveItem } from '@/lib/graph-client'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const ALLOWED_ROLES = ['TE_USER', 'BT_USER', 'GT_TE_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN']

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ ref: string }> },
) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  if (!ALLOWED_ROLES.includes(session.user.role)) return buildApiError('Forbidden', 403)

  const { ref } = await params
  const contentType = req.headers.get('content-type') ?? ''

  // ── Pasted text / cloud file mode ──────────────────────────────────────────
  if (contentType.includes('application/json')) {
    const body = await req.json().catch(() => ({})) as { text?: string; itemId?: string; itemName?: string }

    if (body.text !== undefined) {
      if (!String(body.text).trim()) return buildApiError('Paste some passenger text first')
      const passengers = await extractPassengersFromText(String(body.text))
      return buildApiSuccess(
        { passengers, source: 'pasted text' },
        passengers.length ? undefined : 'No passenger details found in the text',
      )
    }

    const { itemId, itemName } = body
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
    const passengers = await extractPassengersFromDocument(buffer.toString('base64'), mimeType)
    return buildApiSuccess(
      { passengers, source: itemName },
      passengers.length ? undefined : 'No passenger details found in the file',
    )
  }

  // ── Device upload mode ─────────────────────────────────────────────────────
  const formData = await req.formData()
  const file = formData.get('file') as File | null
  if (!file) return buildApiError('No file provided')

  const fileName = file.name.toLowerCase()
  const ext = fileName.split('.').pop() ?? 'bin'
  const isImage = /^(jpe?g|png|webp|gif)$/.test(ext)
  if (!isImage && !fileName.endsWith('.pdf')) {
    return buildApiError('Only image files (JPG, PNG, WebP) or PDF are supported')
  }
  const mimeType = file.type || (isImage ? `image/${ext === 'jpg' ? 'jpeg' : ext}` : 'application/pdf')
  const base64 = Buffer.from(await file.arrayBuffer()).toString('base64')

  const passengers = await extractPassengersFromDocument(base64, mimeType)
  return buildApiSuccess(
    { passengers, source: file.name },
    passengers.length ? undefined : 'No passenger details found in the file',
  )
}
