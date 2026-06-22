import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { extractBookingFromText, classifyPNLCategories, extractPNLFromText } from '@/lib/openai'
import { extractTextFromDocx } from '@/lib/parsers/docx-parser'
import { extractTextFromXlsx, parsePNLXlsx } from '@/lib/parsers/xlsx-parser'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse = require('pdf-parse') as (buf: Buffer) => Promise<{ text: string }>

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)

  const role = session.user.role
  if (!['BT_USER', 'AC_USER', 'TE_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN'].includes(role)) {
    return buildApiError('Forbidden', 403)
  }

  const formData = await req.formData()
  const file = formData.get('file') as File | null
  const type = formData.get('type') as string | null // 'booking' | 'pnl'

  if (!file) return buildApiError('No file provided')

  const buffer = Buffer.from(await file.arrayBuffer())
  const fileName = file.name.toLowerCase()

  let extractedText = ''

  if (fileName.endsWith('.docx') || fileName.endsWith('.doc')) {
    extractedText = await extractTextFromDocx(buffer)
  } else if (fileName.endsWith('.xlsx') || fileName.endsWith('.xls')) {
    extractedText = extractTextFromXlsx(buffer)
  } else if (fileName.endsWith('.txt') || fileName.endsWith('.csv')) {
    extractedText = buffer.toString('utf-8')
  } else if (fileName.endsWith('.pdf')) {
    try {
      const result = await pdfParse(buffer)
      extractedText = result.text ?? ''
    } catch {
      extractedText = ''
    }
  }
  // Any other file type (e.g. .numbers, .ods) — extractedText stays '' and is stored as-is

  if (type === 'pnl' && !extractedText.trim()) {
    // PNL files with no extractable text (binary, scanned PDF) — accepted but no data parsed
    return buildApiSuccess({ fileName: file.name, fileSize: file.size, extractedText: '', parsedData: {} })
  }

  if (type !== 'pnl' && !extractedText.trim()) {
    return buildApiError('Could not extract text from the file')
  }

  let parsedData: Record<string, unknown> = {}

  if (type === 'pnl' && (fileName.endsWith('.xlsx') || fileName.endsWith('.xls')) && extractedText.trim()) {
    // Excel: parse numbers directly, then AI-classify categories
    const result = parsePNLXlsx(buffer)

    if (result.lineItems.length > 0 && process.env.OPENAI_API_KEY) {
      try {
        const activities = result.lineItems.map(l => l.activity)
        const aiCategories = await classifyPNLCategories(activities)
        result.lineItems = result.lineItems.map((item, i) => ({
          ...item,
          category: aiCategories[i] ?? item.category,
        }))
      } catch (err) {
        console.error('OpenAI category classification failed, using keyword fallback:', err)
      }
    }

    parsedData = result as unknown as Record<string, unknown>

  } else if (type === 'pnl' && (fileName.endsWith('.pdf') || fileName.endsWith('.docx') || fileName.endsWith('.doc') || fileName.endsWith('.csv') || fileName.endsWith('.txt')) && extractedText.trim()) {
    // PDF / DOCX / CSV: AI full extraction
    if (!process.env.OPENAI_API_KEY) {
      return buildApiError('OpenAI API key not configured — cannot extract PNL from this file type')
    }
    const ai = await extractPNLFromText(extractedText)
    const rawLines = Array.isArray(ai.lineItems) ? (ai.lineItems as Record<string, unknown>[]) : []
    const lineItems = rawLines
      .map(l => ({
        activity:   String(l.activity   ?? ''),
        category:   String(l.category   ?? 'OTHER'),
        mmtRate:    Number(l.mmtRate    ?? 0),
        sicRate:    Number(l.sicRate    ?? 0),
        pvtRatePP:  Number(l.pvtRatePP  ?? 0),
        adEntrance: Number(l.adEntrance ?? 0),
        chEntrance: Number(l.chEntrance ?? 0),
        otherRate:  Number(l.otherRate  ?? 0),
      }))
      .filter(l => l.activity && (l.mmtRate || l.sicRate || l.pvtRatePP || l.adEntrance || l.otherRate))

    parsedData = {
      bookingRef:  ai.bookingRef ?? null,
      paxAdults:   typeof ai.paxAdults   === 'number' ? ai.paxAdults   : 0,
      paxChildren: typeof ai.paxChildren === 'number' ? ai.paxChildren : 0,
      lineItems,
    }

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
