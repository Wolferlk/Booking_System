/**
 * GET  /api/mobile/trips/[ref]/tickets  — the trip's entrance tickets, day by
 *      day, with what has been uploaded and how many are still missing.
 * POST /api/mobile/trips/[ref]/tickets  (multipart: name, qty, date, files…)
 *      — a ticket ops did not have, bought at the gate. See lib/mobile/tickets.
 */
import { NextRequest } from 'next/server'
import { buildApiSuccess } from '@/lib/utils'
import { requireDriver } from '@/lib/mobile/auth'
import { mobileRoute } from '@/lib/mobile/http'
import { addDriverTicket, tripTickets } from '@/lib/mobile/tickets'
import { requireTrip } from '../_trip'

export const dynamic = 'force-dynamic'

export const GET = mobileRoute('trip-tickets', async (req: NextRequest, { params }: { params: { ref: string } }) => {
  const actor = await requireDriver(req)
  const trip = await requireTrip(actor.driverId, params.ref)
  return buildApiSuccess(await tripTickets(actor.driverId, trip))
})

export const POST = mobileRoute('trip-ticket-add', async (req: NextRequest, { params }: { params: { ref: string } }) => {
  const actor = await requireDriver(req)
  const trip = await requireTrip(actor.driverId, params.ref)
  // The DOM lib FormData typing on this project lacks .get(); the runtime object has it.
  const form = (await req.formData()) as unknown as Parameters<typeof addDriverTicket>[2]
  await addDriverTicket(actor, trip, form)
  return buildApiSuccess(await tripTickets(actor.driverId, trip))
})
