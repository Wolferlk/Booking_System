import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { extractBookingFromText } from '@/lib/openai'
import { extractTextFromDocx } from '@/lib/parsers/docx-parser'
import { extractTextFromXlsx, parsePNLXlsx } from '@/lib/parsers/xlsx-parser'

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)

  const role = session.user.role
  if (!['BT_USER', 'AC_USER', 'SUPER_ADMIN'].includes(role)) {
    return buildApiError('Forbidden', 403)
  }

  const formData = await req.formData()
  const file = formData.get('file') as File | null
  const type = formData.get('type') as string | null // 'booking' | 'pnl'

  if (!file) return buildApiError('No file provided')

  const buffer = Buffer.from(await file.arrayBuffer())
  const fileName = file.name.toLowerCase()

  let extractedText = ''

  if (fileName.endsWith('.docx')) {
    extractedText = await extractTextFromDocx(buffer)
  } else if (fileName.endsWith('.xlsx') || fileName.endsWith('.xls')) {
    extractedText = extractTextFromXlsx(buffer)
  } else if (fileName.endsWith('.txt') || fileName.endsWith('.csv')) {
    extractedText = buffer.toString('utf-8')
  } else {
    return buildApiError('Unsupported file type. Use .docx, .xlsx, or .csv')
  }

  if (!extractedText.trim()) {
    return buildApiError('Could not extract text from the file')
  }

  let parsedData: Record<string, unknown> = {}

  if (type === 'pnl' && (fileName.endsWith('.xlsx') || fileName.endsWith('.xls'))) {
    // Parse P&L spreadsheet directly — no AI needed, column format is known
    const result = parsePNLXlsx(buffer)
    parsedData = result as unknown as Record<string, unknown>
  } else if (type === 'booking') {
    parsedData = await extractBookingFromText(extractedText)
  } else {
    parsedData = { rawText: extractedText.slice(0, 5000) }
  }

  return buildApiSuccess({
    fileName: file.name,
    fileSize: file.size,
    extractedText: extractedText.slice(0, 1000), // preview
    parsedData,
  })
}
