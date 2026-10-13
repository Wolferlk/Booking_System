/**
 * POST /api/mobile/ai/brief  { bookingRef, date? }
 *
 * A short AI briefing of the driver's day in their own language. Cached per
 * driver/day/language for the life of the server instance, so tapping the
 * card twice does not pay twice.
 */
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { buildApiSuccess } from '@/lib/utils'
import { requireDriver } from '@/lib/mobile/auth'
import { MobileError, mobileRoute, readJson } from '@/lib/mobile/http'
import { dayBriefing } from '@/lib/mobile/ai'
import { loadDriverTrip, localTodayFor } from '@/lib/mobile/trips'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const cache = new Map<string, { text: string; at: number }>()

export const POST = mobileRoute('ai-brief', async (req: NextRequest) => {
  const actor = await requireDriver(req)
  const body = await readJson<{ bookingRef?: string; date?: string }>(req)
  if (!body.bookingRef) throw new MobileError('Which trip?')
  const trip = await loadDriverTrip(actor.driverId, body.bookingRef)
  if (!trip) throw new MobileError('This trip is not assigned to you.', 404)
  const date = /^\d{4}-\d{2}-\d{2}$/.test(body.date ?? '') ? body.date! : localTodayFor(trip.country)
  const day = trip.days.find(d => d.date === date)
  if (!day) throw new MobileError('Nothing planned for that day.', 404)
  const account = await prisma.mobileDriverAccount.findUnique({ where: { driverId: actor.driverId }, select: { language: true } })
  const language = account?.language ?? 'en'

  const key = `${actor.driverId}:${trip.bookingRef}:${date}:${language}:${day.movements.length}`
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < 6 * 3_600_000) return buildApiSuccess({ text: hit.text, cached: true })

  const text = await dayBriefing({
    driverName: actor.name, language, fileNo: trip.fileNo, leadGuest: trip.leadGuest, pax: trip.pax,
    day, dayCount: trip.days.length, specialNotes: trip.specialNotes,
  })
  if (!text) throw new MobileError('The assistant is not available right now.', 503, 'ai_unavailable')
  cache.set(key, { text, at: Date.now() })
  return buildApiSuccess({ text, cached: false })
})
