/**
 * GET  /api/mobile/requests  — the driver's requests to ops and their answers
 * POST /api/mobile/requests  { kind: 'HELP', reason, lat?, lng?, bookingRef? }
 *
 * HELP is the big red "I need help" button: breakdown, accident, guest issue.
 * It pushes to every app-using ops person for the driver's country at once,
 * with the driver's position as a map link.
 */
import { NextRequest } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { buildApiSuccess } from '@/lib/utils'
import { requireDriver } from '@/lib/mobile/auth'
import { MobileError, mobileRoute, readJson } from '@/lib/mobile/http'
import { notifyStaff } from '@/lib/mobile/notify'

export const dynamic = 'force-dynamic'

const TOPICS = ['BREAKDOWN', 'ACCIDENT', 'GUEST', 'ROUTE', 'OTHER']

export const GET = mobileRoute('requests', async (req: NextRequest) => {
  const actor = await requireDriver(req)
  const items = await prisma.mobileDriverRequest.findMany({
    where: { driverId: actor.driverId }, orderBy: { createdAt: 'desc' }, take: 30,
    select: { id: true, kind: true, bookingRef: true, reason: true, status: true, decisionNote: true, decidedAt: true, createdAt: true, payload: true },
  })
  return buildApiSuccess({ items })
})

export const POST = mobileRoute('requests-create', async (req: NextRequest) => {
  const actor = await requireDriver(req)
  const body = await readJson<{ kind?: string; topic?: string; reason?: string; lat?: number; lng?: number; bookingRef?: string }>(req)
  if (body.kind !== 'HELP') throw new MobileError('Unknown request.')
  const topic = TOPICS.includes(String(body.topic)) ? String(body.topic) : 'OTHER'
  const lat = Number(body.lat), lng = Number(body.lng)
  const hasPos = Number.isFinite(lat) && Number.isFinite(lng) && !(lat === 0 && lng === 0)
  const r = await prisma.mobileDriverRequest.create({
    data: {
      driverId: actor.driverId, driverName: actor.name, kind: 'HELP',
      bookingRef: body.bookingRef?.slice(0, 64) || null,
      reason: String(body.reason ?? '').slice(0, 1000) || null,
      payload: { topic, ...(hasPos ? { lat, lng, map: `https://maps.google.com/?q=${lat},${lng}` } : {}) } as Prisma.InputJsonValue,
    },
  })
  await notifyStaff(actor.country, {
    kind: 'DRIVER_HELP',
    title: `🚨 ${actor.name} needs help (${topic.toLowerCase()})`,
    body: [body.bookingRef, body.reason].filter(Boolean).join(' — ') || 'Call the driver now.',
    data: { requestId: r.id, ...(hasPos ? { lat, lng } : {}) },
    dedupeKey: `req:${r.id}`,
  })
  return buildApiSuccess({ id: r.id })
})
