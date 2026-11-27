import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { extractTextFromDocx } from '@/lib/parsers/docx-parser'
import { generateAgendaForBooking } from '@/lib/agenda-ai-generate'

export const dynamic = 'force-dynamic'

/**
 * AI Generate / upload-a-TQ on the agenda page. Returns the generated items —
 * the page saves them. The generation itself lives in lib/agenda-ai-generate.ts,
 * shared with the background auto-generate sweep.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { ref: string } },
) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)

  const role = session.user.role
  if (!['BT_USER', 'GT_USER', 'GT_VN_USER', 'TE_USER', 'GT_TE_USER', 'AC_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN'].includes(role)) {
    return buildApiError('Forbidden', 403)
  }

  // ── Extract document text (when TQ file uploaded) ────────────────────────
  let tqDocumentText = ''

  const contentType = req.headers.get('content-type') ?? ''
  if (contentType.includes('multipart/form-data')) {
    const formData = await req.formData()
    const file = formData.get('file') as File | null
    if (!file) return buildApiError('No file provided')

    const buffer = Buffer.from(await file.arrayBuffer())
    const fileName = file.name.toLowerCase()
    if (fileName.endsWith('.docx')) {
      tqDocumentText = await extractTextFromDocx(buffer)
    } else if (fileName.endsWith('.txt')) {
      tqDocumentText = buffer.toString('utf-8')
    } else {
      return buildApiError('Upload a .docx or .txt Travel Quotation or TC file')
    }
  }

  const result = await generateAgendaForBooking(params.ref, { tqDocumentText })
  if (!result.ok) return buildApiError(result.error, result.status)

  return buildApiSuccess(
    { items: result.items, confirmationDescriptions: result.confirmationDescriptions },
    `Generated ${result.items.length} agenda items`,
  )
}
