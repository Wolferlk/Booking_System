/**
 * POST /api/mobile/trips/[ref]/handover  { kind: 'HANDOVER' | 'FEEDBACK_WAIVER', reason }
 *
 *   HANDOVER         "I can't continue this trip" — Sri Lanka runs one driver
 *                    per round trip, so a change of driver is an ops decision.
 *                    Ops picks the new driver on the web (SL Driver Allocation
 *                    / movement chart as today); approving here marks this
 *                    driver's session HANDED_OVER.
 *   FEEDBACK_WAIVER  the guest will not fill the form — ops can let the driver
 *                    finish without it.
 */
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { buildApiSuccess } from '@/lib/utils'
import { requireDriver } from '@/lib/mobile/auth'
import { MobileError, mobileRoute, readJson } from '@/lib/mobile/http'
import { notifyStaff } from '@/lib/mobile/notify'
import { requireTrip } from '../_trip'

export const dynamic = 'force-dynamic'

const KINDS = ['HANDOVER', 'FEEDBACK_WAIVER'] as const

export const POST = mobileRoute('trip-handover', async (req: NextRequest, { params }: { params: { ref: string } }) => {
  const actor = await requireDriver(req)
  const trip = await requireTrip(actor.driverId, params.ref)
  const body = await readJson<{ kind?: string; reason?: string }>(req)
  const kind = KINDS.includes(body.kind as never) ? (body.kind as (typeof KINDS)[number]) : 'HANDOVER'
  const reason = String(body.reason ?? '').trim()
  if (reason.length < 3) throw new MobileError('Please say why in a few words.')

  const open = await prisma.mobileDriverRequest.findFirst({
    where: { driverId: actor.driverId, bookingRef: trip.bookingRef, kind, status: 'PENDING' },
  })
  if (open) return buildApiSuccess({ requestId: open.id, already: true })

  const r = await prisma.mobileDriverRequest.create({
    data: { driverId: actor.driverId, driverName: actor.name, kind, bookingRef: trip.bookingRef, reason: reason.slice(0, 1000) },
  })
  await notifyStaff(trip.country, {
    kind: 'DRIVER_REQUEST',
    title: kind === 'HANDOVER' ? `Driver change needed · ${trip.fileNo}` : `Feedback waiver · ${trip.fileNo}`,
    body: `${actor.name}: ${reason.slice(0, 140)}`,
    data: { requestId: r.id, bookingRef: trip.bookingRef },
    dedupeKey: `req:${r.id}`,
  }).catch(err => console.error('[mobile handover notify]', err))
  return buildApiSuccess({ requestId: r.id, already: false })
})
