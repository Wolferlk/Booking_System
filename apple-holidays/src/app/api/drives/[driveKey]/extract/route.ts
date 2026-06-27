/**
 * POST /api/drives/[driveKey]/extract
 * Body: { itemId: string; itemName: string }
 *
 * Downloads a file from the specified drive and extracts booking data from it
 * using the AI booking parser (same pipeline as /api/upload for booking docs).
 * Returns extracted booking fields ready to fill the New Booking form.
 */
import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { resolveDriveByKey, DRIVE_CONFIGS } from '@/lib/onedrive-monitor'
import { downloadDriveItem } from '@/lib/graph-client'
import { extractTextFromDocx } from '@/lib/parsers/docx-parser'
import { extractBookingFromText } from '@/lib/openai'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse = require('pdf-parse') as (buf: Buffer) => Promise<{ text: string }>

export const dynamic    = 'force-dynamic'
export const maxDuration = 60

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ driveKey: string }> },
) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)

  const allowed = ['GT_USER', 'TE_USER', 'GT_TE_USER', 'BT_USER', 'AC_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN']
  if (!allowed.includes(session.user.role)) return buildApiError('Forbidden', 403)

  const { driveKey } = await params

  if (!DRIVE_CONFIGS.find(c => c.key === driveKey)) {
    return buildApiError(`Unknown drive key: ${driveKey}`, 400)
  }

  const { itemId, itemName } = (await req.json()) as { itemId: string; itemName: string }
  if (!itemId || !itemName) return buildApiError('itemId and itemName are required')

  let resolved
  try {
    resolved = await resolveDriveByKey(driveKey)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return buildApiError(`Could not resolve drive: ${msg}`, 502)
  }
  if (!resolved) return buildApiError('Could not resolve drive', 500)
  const { driveId } = resolved

  // Download file
  let buffer: Buffer
  try {
    buffer = await downloadDriveItem(driveId, itemId)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return buildApiError(`Failed to download file: ${msg}`, 500)
  }

  // Extract text
  let text = ''
  const lower = itemName.toLowerCase()
  try {
    if (lower.endsWith('.docx') || lower.endsWith('.doc')) {
      text = await extractTextFromDocx(buffer)
    } else if (lower.endsWith('.pdf')) {
      const result = await pdfParse(buffer)
      text = result.text ?? ''
    } else if (lower.endsWith('.txt') || lower.endsWith('.csv')) {
      text = buffer.toString('utf-8')
    }
  } catch {
    text = ''
  }

  if (!text.trim()) {
    return buildApiError('Could not extract text from this file type. Only .docx, .pdf, and .txt are supported.', 422)
  }

  try {
    const extracted = await extractBookingFromText(text, itemName)
    return buildApiSuccess({ extracted, sourceFile: itemName })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return buildApiError(`AI extraction failed: ${msg}`, 500)
  }
}
