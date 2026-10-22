/**
 * POST   /api/mobile/trips/[ref]/tickets/[id]/files  (multipart: files…) — upload
 *        photos / PDFs of one of the trip's entrance tickets.
 * DELETE /api/mobile/trips/[ref]/tickets/[id]/files?fileId=  — remove a file
 *        this driver uploaded.
 * Both answer with the trip's tickets, refreshed.
 */
import { NextRequest } from 'next/server'
import { buildApiSuccess } from '@/lib/utils'
import { requireDriver } from '@/lib/mobile/auth'
import { MobileError, mobileRoute } from '@/lib/mobile/http'
import { removeTicketFile, tripTickets, uploadTicketFiles } from '@/lib/mobile/tickets'
import { requireTrip } from '../../../_trip'

export const dynamic = 'force-dynamic'

type Ctx = { params: { ref: string; id: string } }

export const POST = mobileRoute('trip-ticket-files', async (req: NextRequest, { params }: Ctx) => {
  const actor = await requireDriver(req)
  const trip = await requireTrip(actor.driverId, params.ref)
  const form = (await req.formData()) as unknown as Parameters<typeof uploadTicketFiles>[3]
  await uploadTicketFiles(actor, trip, params.id, form)
  return buildApiSuccess(await tripTickets(actor.driverId, trip))
})

export const DELETE = mobileRoute('trip-ticket-file-remove', async (req: NextRequest, { params }: Ctx) => {
  const actor = await requireDriver(req)
  const trip = await requireTrip(actor.driverId, params.ref)
  const fileId = req.nextUrl.searchParams.get('fileId')
  if (!fileId) throw new MobileError('fileId is required.')
  await removeTicketFile(actor.driverId, trip, params.id, fileId)
  return buildApiSuccess(await tripTickets(actor.driverId, trip))
})
