import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { getFileHandlerSession } from '@/lib/filehandler-auth'

export const dynamic = 'force-dynamic'

// Fields a file handler may edit here. Kept to contact + notes; flights and
// hotels have their own endpoints.
const EDITABLE = [
  'agentEmail', 'agentPhone', 'agentWhatsapp',
  'contactEmail', 'contactPhone', 'contactWhatsapp',
  'importantNotes',
] as const

// PATCH — update agent contact, guest/tourist contact, and important notes.
export async function PATCH(req: NextRequest, { params }: { params: { ref: string } }) {
  const handler = await getFileHandlerSession()
  if (!handler) return buildApiError('Unauthorized', 401)

  const booking = await prisma.booking.findUnique({
    where: { bookingRef: params.ref },
    select: { id: true, bookingRef: true, isNumber: true, cntlNumber: true, operationCountry: true, fileHandler: true },
  })
  if (!booking) return buildApiError('Booking not found', 404)

  const body = await req.json().catch(() => ({}))
  const data: Record<string, string | null> = {}
  const changed: string[] = []
  for (const key of EDITABLE) {
    if (key in body) {
      const v = typeof body[key] === 'string' ? body[key].trim() : ''
      data[key] = v || null
      changed.push(key)
    }
  }
  if (changed.length === 0) return buildApiError('Nothing to update')

  if (!booking.fileHandler) data.fileHandler = handler.name

  await prisma.booking.update({ where: { bookingRef: params.ref }, data })

  await prisma.fileHandlerLog.create({
    data: {
      fileHandlerId: handler.id,
      fileHandlerName: handler.name,
      action: 'DETAILS_UPDATED',
      bookingId: booking.id,
      bookingRef: booking.bookingRef,
      isNumber: booking.isNumber,
      cntlNumber: booking.cntlNumber,
      operationCountry: booking.operationCountry,
      details: `Updated ${changed.join(', ')}`,
    },
  })

  return buildApiSuccess(null, 'Details updated')
}
