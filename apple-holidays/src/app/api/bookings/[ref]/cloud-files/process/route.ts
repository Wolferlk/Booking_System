/**
 * POST /api/bookings/[ref]/cloud-files/process
 * Body: { itemId: string; mode: 'ticket' | 'pnl' }
 *
 * Downloads a specific file from the booking's OneDrive folder and either:
 *   mode=ticket : runs AI extraction, saves the file locally, returns extracted details
 *   mode=pnl    : parses the file as a PNL costing sheet, saves line items to DB
 */
import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { resolveBookingDriveFolder } from '@/lib/onedrive-monitor'
import { downloadDriveItem } from '@/lib/graph-client'
import { extractTicketDetails, classifyPNLCategories, extractPNLFromText } from '@/lib/openai'
import { parsePNLXlsx } from '@/lib/parsers/xlsx-parser'
import { extractTextFromDocx } from '@/lib/parsers/docx-parser'
import { writeFile, mkdir } from 'fs/promises'
import path from 'path'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse = require('pdf-parse') as (buf: Buffer) => Promise<{ text: string }>

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ ref: string }> },
) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  const { ref } = await params

  const body = await req.json() as { itemId: string; itemName: string; mode: 'ticket' | 'pnl' }
  const { itemId, itemName, mode } = body
  if (!itemId || !itemName || !mode) return buildApiError('itemId, itemName and mode are required')

  // Only GT/AC/TE and admins can process drive files
  const allowed = ['GT_USER', 'TE_USER', 'BT_USER', 'AC_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN']
  if (!allowed.includes(session.user.role)) return buildApiError('Forbidden', 403)

  // Resolve the booking's drive folder
  const folder = await resolveBookingDriveFolder(ref)
  if (!folder) return buildApiError('No OneDrive folder linked to this booking yet', 404)

  // Download the file
  let buffer: Buffer
  try {
    buffer = await downloadDriveItem(folder.driveId, itemId)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return buildApiError(`Failed to download file: ${msg}`, 500)
  }

  // ── TICKET mode ─────────────────────────────────────────────────────────────
  if (mode === 'ticket') {
    // Save locally
    const ext      = itemName.split('.').pop()?.toLowerCase() ?? 'bin'
    const safeName = `ticket-cloud-${Date.now()}.${ext}`
    const uploadDir = path.join(process.cwd(), 'public', 'uploads', 'tickets')
    await mkdir(uploadDir, { recursive: true })
    await writeFile(path.join(uploadDir, safeName), buffer)

    const fileUrl  = `/uploads/tickets/${safeName}`
    const isImage  = /\.(jpe?g|png|webp|gif)$/i.test(itemName)
    const fileType = isImage ? 'image' : 'pdf'

    // AI extraction
    let extracted: Awaited<ReturnType<typeof extractTicketDetails>> = {}
    if (process.env.OPENAI_API_KEY) {
      const mimeType = isImage ? `image/${ext === 'jpg' ? 'jpeg' : ext}` : 'application/pdf'
      const base64   = buffer.toString('base64')
      extracted      = await extractTicketDetails(base64, mimeType, itemName)
    }

    return buildApiSuccess({ fileUrl, fileName: itemName, fileType, extracted })
  }

  // ── PNL mode ─────────────────────────────────────────────────────────────────
  if (mode === 'pnl') {
    // Parse the file into structured PNL data
    type PNLParsed = {
      bookingRef?: string
      paxAdults: number
      paxChildren: number
      lineItems: {
        activity: string; category: string
        mmtRate: number; sicRate: number; pvtRatePP: number
        adEntrance: number; chEntrance: number; otherRate: number
      }[]
    }
    let parsed: PNLParsed

    if (/\.pdf$/i.test(itemName)) {
      const text = (await pdfParse(buffer)).text ?? ''
      if (text.trim().length < 20) return buildApiError('PDF has no extractable text (scanned?)', 422)
      const ai = await extractPNLFromText(text)
      parsed = normalisePNLAI(ai, ref)
    } else if (/\.docx?$/i.test(itemName)) {
      const text = await extractTextFromDocx(buffer)
      if (text.trim().length < 20) return buildApiError('Word doc has no extractable text', 422)
      const ai = await extractPNLFromText(text)
      parsed = normalisePNLAI(ai, ref)
    } else {
      // Excel / CSV
      try {
        const raw = parsePNLXlsx(buffer)
        parsed = { ...raw, lineItems: raw.lineItems }
      } catch {
        return buildApiError('File is not parseable as a PNL (try xlsx, docx, or pdf)', 422)
      }
    }

    // AI category classification
    let lines = parsed.lineItems
    if (lines.length > 0 && process.env.OPENAI_API_KEY) {
      try {
        const cats = await classifyPNLCategories(lines.map(l => l.activity))
        lines = lines.map((l, i) => ({ ...l, category: cats[i] ?? l.category }))
      } catch { /* keep keyword-based categories */ }
    }

    // Find booking
    const booking = await prisma.booking.findUnique({ where: { bookingRef: ref } })
    if (!booking) return buildApiError('Booking not found', 404)

    const paxAdults   = parsed.paxAdults   || booking.paxAdults
    const paxChildren = parsed.paxChildren || booking.paxChildren

    // Upsert PNL
    let pnl = await prisma.pNL.findUnique({ where: { bookingId: booking.id } })
    if (!pnl) {
      pnl = await prisma.pNL.create({ data: { bookingId: booking.id, paxAdults, paxChildren } })
    } else {
      pnl = await prisma.pNL.update({ where: { id: pnl.id }, data: { paxAdults, paxChildren } })
    }

    // Replace line items
    await prisma.pNLLineItem.deleteMany({ where: { pnlId: pnl.id } })

    const TICKETABLE = new Set(['HOTEL', 'TICKETS', 'CRUISE', 'WATER', 'GUIDES', 'FLIGHT_TICKETS'])
    let sortOrder = 0
    for (const line of lines) {
      const created = await prisma.pNLLineItem.create({
        data: {
          pnlId:      pnl.id,
          activity:   line.activity,
          category:   line.category as never,
          mmtRate:    line.mmtRate,
          sicRate:    line.sicRate,
          pvtRatePP:  line.pvtRatePP,
          adEntrance: line.adEntrance,
          chEntrance: line.chEntrance,
          otherRate:  line.otherRate,
          sortOrder:  sortOrder++,
        },
      })

      // Auto-create tickets for ticketable categories
      if (TICKETABLE.has(line.category)) {
        const existingTicket = await prisma.ticket.findFirst({
          where: { bookingId: booking.id, pnlLineId: created.id },
        })
        if (!existingTicket) {
          await prisma.ticket.create({
            data: {
              bookingId: booking.id,
              pnlLineId: created.id,
              type:      line.activity,
              qty:       paxAdults + paxChildren || 1,
              currency:  'USD',
              activated: false,
              status:    'DRAFT',
            },
          })
        }
      }
    }

    return buildApiSuccess({
      pnlId:       pnl.id,
      linesImported: lines.length,
      paxAdults,
      paxChildren,
      sourceFile: itemName,
    }, `PNL imported from ${itemName}: ${lines.length} line items`)
  }

  return buildApiError('Invalid mode', 400)
}

function normalisePNLAI(ai: Record<string, unknown>, fallbackRef: string) {
  const rawLines = Array.isArray(ai.lineItems) ? (ai.lineItems as Record<string, unknown>[]) : []
  return {
    bookingRef:  (ai.bookingRef as string | undefined) ?? fallbackRef,
    paxAdults:   typeof ai.paxAdults   === 'number' ? ai.paxAdults   : 0,
    paxChildren: typeof ai.paxChildren === 'number' ? ai.paxChildren : 0,
    lineItems: rawLines
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
      .filter(l => l.activity && (l.mmtRate || l.sicRate || l.pvtRatePP || l.adEntrance || l.otherRate)),
  }
}
