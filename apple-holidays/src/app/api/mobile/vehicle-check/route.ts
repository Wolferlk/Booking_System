/**
 * GET  /api/mobile/vehicle-check  — renewal clock + last checks
 * POST /api/mobile/vehicle-check  { photos: { front, back, left, right, inside, odometer? }, odometer? }
 *
 * Every 60 days a driver re-sends photos of their vehicle. OpenAI takes a
 * first look (lib/mobile/ai.ts) so an obviously wrong photo can be retaken on
 * the spot; ops approves or rejects on the web or in the staff view. The
 * vehicle's own photos in `vehicles` are only replaced when ops approves.
 */
import { NextRequest } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { buildApiSuccess } from '@/lib/utils'
import { requireDriver } from '@/lib/mobile/auth'
import { MobileError, mobileRoute, readJson } from '@/lib/mobile/http'
import { vehicleCheckState } from '@/lib/mobile/profile'
import { reviewVehiclePhotos, type VehicleAiReview } from '@/lib/mobile/ai'
import { notifyStaff } from '@/lib/mobile/notify'
import { refuseForSandbox } from '@/lib/mobile/sandbox'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const SLOTS = ['front', 'back', 'left', 'right', 'inside', 'odometer'] as const
const REQUIRED = ['front', 'back', 'inside'] as const

export const GET = mobileRoute('vehicle-check', async (req: NextRequest) => {
  const actor = await requireDriver(req)
  const [state, history, driver] = await Promise.all([
    vehicleCheckState(actor.driverId),
    prisma.mobileVehicleCheck.findMany({
      where: { driverId: actor.driverId }, orderBy: { createdAt: 'desc' }, take: 6,
      select: { id: true, status: true, createdAt: true, photos: true, aiReview: true, reviewNote: true, odometer: true },
    }),
    prisma.driver.findUnique({ where: { id: actor.driverId }, select: { vehicle: { select: { type: true, plateNo: true, brand: true, model: true, photoOutside: true, photoInside: true } } } }),
  ])
  return buildApiSuccess({ state, history, vehicle: driver?.vehicle ?? null, slots: SLOTS, required: REQUIRED })
})

export const POST = mobileRoute('vehicle-check-submit', async (req: NextRequest) => {
  const actor = await requireDriver(req)
  await refuseForSandbox(actor.driverId, 'the vehicle check')
  const body = await readJson<{ photos?: Record<string, string>; odometer?: number }>(req)
  const photos: Record<string, string> = {}
  for (const s of SLOTS) {
    const u = body.photos?.[s]
    if (typeof u === 'string' && u.startsWith(`/api/uploads/driver-app/${actor.driverId}/`)) photos[s] = u
  }
  const missing = REQUIRED.filter(s => !photos[s])
  if (missing.length) throw new MobileError(`Please add the ${missing.join(', ')} photo${missing.length > 1 ? 's' : ''}.`)

  const driver = await prisma.driver.findUnique({
    where: { id: actor.driverId },
    select: { vehicleId: true, vehicle: { select: { plateNo: true, brand: true, model: true, type: true } } },
  })
  const ai: VehicleAiReview | null = await Promise.race([
    reviewVehiclePhotos(photos, driver?.vehicle ?? null),
    new Promise<null>(r => setTimeout(() => r(null), 40_000)),
  ])
  const odometer = Number.isFinite(Number(body.odometer)) && Number(body.odometer) > 0 ? Math.round(Number(body.odometer)) : null

  const check = await prisma.mobileVehicleCheck.create({
    data: {
      driverId: actor.driverId, vehicleId: driver?.vehicleId ?? null,
      photos: photos as Prisma.InputJsonValue, odometer,
      aiReview: ai ? (ai as unknown as Prisma.InputJsonValue) : Prisma.JsonNull,
    },
  })
  await notifyStaff(actor.country, {
    kind: 'VEHICLE_CHECK',
    title: `Vehicle photos · ${actor.name}`,
    body: ai ? `AI: ${ai.verdict.replace('_', ' ').toLowerCase()} — ${ai.summary}` : 'New vehicle photos to review.',
    data: { vehicleCheckId: check.id },
    dedupeKey: `vc:${check.id}`,
  }).catch(err => console.error('[mobile vehicle-check notify]', err))

  return buildApiSuccess({ id: check.id, aiReview: ai, state: await vehicleCheckState(actor.driverId) })
})
