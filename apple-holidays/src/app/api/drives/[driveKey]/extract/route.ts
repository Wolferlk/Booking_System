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
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse = require('pdf-parse') as (buf: Buffer) => Promise<{ text: string }>

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

  // AI extraction — reuse the same OpenAI call as the upload route
  const { default: OpenAI } = await import('openai')
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

  const prompt = `
You are a travel booking data extractor. Extract structured booking data from the following tour confirmation document.

Return ONLY valid JSON (no markdown fences) with these fields:
{
  "bookingRef": "string or null",
  "agentBookingId": "string or null",
  "agent": "string — travel agent/company name",
  "fileHandler": "string or null — internal handler name",
  "arrivalDate": "YYYY-MM-DD or null",
  "departureDate": "YYYY-MM-DD or null",
  "paxAdults": number,
  "paxChildren": number,
  "quotedTotal": number,
  "currency": "USD|INR|SGD|VND|LKR|MYR",
  "terms": "string or null",
  "exclusions": "string or null",
  "policyNotes": "string or null",
  "amendmentNote": "string or null",
  "agentEmail": "string or null",
  "agentPhone": "string or null",
  "agentWhatsapp": "string or null",
  "contactEmail": "string or null",
  "contactPhone": "string or null",
  "contactWhatsapp": "string or null",
  "passengers": [{ "name": "string", "type": "ADULT|CHILD", "age": number|null, "isLead": boolean, "passport": "string or null", "nationality": "string or null" }],
  "flights": [{ "flightNo": "string", "date": "YYYY-MM-DD", "fromApt": "string", "depTime": "HH:MM", "toApt": "string", "arrTime": "HH:MM", "airline": "string", "notes": "string or null" }],
  "accommodations": [{ "city": "string", "hotel": "string", "checkIn": "YYYY-MM-DD", "checkOut": "YYYY-MM-DD", "nights": number, "roomType": "string", "mealType": "string", "address": "string" }],
  "itineraryItems": [{ "dayNo": number, "date": "YYYY-MM-DD", "title": "string", "description": "string" }],
  "emergencyContacts": [{ "name": "string", "phone": "string", "role": "string" }]
}

Document:
${text.slice(0, 12000)}
`

  try {
    const resp = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0,
    })
    const raw = resp.choices[0]?.message?.content ?? '{}'
    const extracted = JSON.parse(raw.replace(/^```json?\s*/i, '').replace(/```\s*$/, ''))
    return buildApiSuccess({ extracted, sourceFile: itemName })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return buildApiError(`AI extraction failed: ${msg}`, 500)
  }
}
