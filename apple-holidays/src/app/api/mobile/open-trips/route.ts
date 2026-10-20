/**
 * Driver-Auto inside the app — the same open-trip board a driver gets as a
 * WhatsApp link (/driver-board), signed in instead of link-gated.
 *
 *   GET  /api/mobile/open-trips
 *   POST /api/mobile/open-trips  { action: 'request', tripKey, note? } | { action: 'withdraw', claimId }
 *
 * All rules (approval, clashes, seats, max pending) are the Driver-Auto ones
 * in lib/driver-auto/claims.ts — nothing is re-implemented here.
 */
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { buildApiSuccess } from '@/lib/utils'
import { requireDriver } from '@/lib/mobile/auth'
import { refuseForSandbox } from '@/lib/mobile/sandbox'
import { MobileError, mobileRoute, readJson } from '@/lib/mobile/http'
import { listOpenTrips, publicTrip } from '@/lib/driver-auto/open-trips'
import { DaError, partyCommitments, requestTrip, toClaimView, withdrawClaim } from '@/lib/driver-auto/claims'
import { addDays, isDaTableMissing, localToday, readSettings, resolveParty, tabsForPartner } from '@/lib/driver-auto/server'
import { DA_COUNTRY_META } from '@/lib/driver-auto/shared'

export const dynamic = 'force-dynamic'

async function party(req: NextRequest) {
  const actor = await requireDriver(req)
  const p = await resolveParty('DRIVER', actor.driverId)
  if (!p) throw new MobileError('Driver not found.', 404)
  return p
}

export const GET = mobileRoute('open-trips', async (req: NextRequest) => {
  const p = await party(req)
  const settings = await readSettings()
  const tabs = tabsForPartner(p.country)
  const today = tabs[0] ? localToday(tabs[0]) : new Date().toISOString().slice(0, 10)

  let claims: ReturnType<typeof toClaimView>[] = []
  let enabled = true
  try {
    const rows = await prisma.driverTripClaim.findMany({
      where: { partyType: 'DRIVER', partyId: p.id, createdAt: { gte: new Date(Date.now() - 30 * 86_400_000) } },
      orderBy: { createdAt: 'desc' }, take: 50,
    })
    claims = rows.map(toClaimView).map(c => ({
      ...c, partyPhone: null, decidedByName: null,
      // The snapshot keeps staff-only fields (agent, lead guest) — not for the driver.
      snapshot: c.snapshot ? { ...c.snapshot, agent: undefined, leadGuest: undefined } : null,
    }))
  } catch (err) {
    if (!isDaTableMissing(err)) throw err
    enabled = false
  }
  if (!enabled) return buildApiSuccess({ enabled: false, today, trips: [], claims: [] })

  const pending = new Map(claims.filter(c => c.status === 'PENDING').map(c => [c.tripKey, c.id]))
  const busy = new Set((await partyCommitments('DRIVER', p.id, today, addDays(today, settings.horizonDays + 30))).map(c => c.date))
  const trips = (await Promise.all(tabs.map(async c => (await listOpenTrips(c, settings.horizonDays)).map(t => {
    const dates = t.legs.filter(l => l.driven).map(l => l.date)
    return {
      ...publicTrip(t),
      countryLabel: DA_COUNTRY_META[c].label,
      requireApproval: settings.countries[c].requireApproval,
      myRequestId: pending.get(t.key) ?? null,
      busy: (dates.length ? dates : [t.startDate]).some(d => busy.has(d)),
      fits: p.capacity ? t.pax <= p.capacity : null,
    }
  })))).flat().sort((a, b) => a.startDate.localeCompare(b.startDate))

  // Day-by-day detail for the trip screen: what each movement involves and where
  // the guests sleep. Still no agent, guest name or contact — the driver does not
  // hold this trip yet.
  const itemIds = Array.from(new Set(trips.flatMap(t => t.legs.map(l => l.agendaItemId)).filter(Boolean)))
  const bookingIds = Array.from(new Set(trips.map(t => t.bookingId)))
  const [items, stays] = await Promise.all([
    itemIds.length
      ? prisma.agendaItem.findMany({ where: { id: { in: itemIds } }, select: { id: true, details: true, mealPlan: true, timeTo: true } })
      : Promise.resolve([]),
    bookingIds.length
      ? prisma.accommodation.findMany({
          where: { bookingId: { in: bookingIds }, ownArrangement: false },
          select: { bookingId: true, hotel: true, city: true, checkIn: true, checkOut: true },
        })
      : Promise.resolve([]),
  ])
  const itemById = new Map(items.map(i => [i.id, i]))
  const ymd = (d: Date) => d.toISOString().slice(0, 10)
  const detailed = trips.map(t => ({
    ...t,
    legs: t.legs.map(l => {
      const i = itemById.get(l.agendaItemId)
      return { ...l, details: i?.details?.trim().slice(0, 600) || null, mealPlan: i?.mealPlan ?? null, timeTo: i?.timeTo ?? null }
    }),
    stays: stays
      .filter(s => s.bookingId === t.bookingId)
      .map(s => ({ hotel: s.hotel, city: s.city, checkIn: ymd(s.checkIn), checkOut: ymd(s.checkOut) })),
  }))

  return buildApiSuccess({ enabled: true, today, trips: detailed, claims })
})

export const POST = mobileRoute('open-trips-action', async (req: NextRequest) => {
  const p = await party(req)
  await refuseForSandbox(p.id, 'claiming an open trip')
  const body = await readJson<{ action?: string; tripKey?: string; claimId?: string; note?: string }>(req)
  try {
    if (body.action === 'request') {
      if (!body.tripKey || !/^[BM]:[A-Za-z0-9_-]{6,64}$/.test(body.tripKey)) throw new MobileError('Unknown trip')
      const r = await requestTrip(p, body.tripKey, body.note)
      return buildApiSuccess({ mode: r.mode, claim: { ...r.claim, partyPhone: null } }, r.message)
    }
    if (body.action === 'withdraw') {
      if (!body.claimId) throw new MobileError('Unknown request')
      const claim = await withdrawClaim(p, body.claimId)
      return buildApiSuccess({ claim: { ...claim, partyPhone: null } }, 'Request withdrawn.')
    }
    throw new MobileError('Unknown action')
  } catch (err) {
    if (err instanceof DaError) throw new MobileError(err.message, err.status, err.code)
    if (isDaTableMissing(err)) throw new MobileError('Trip requests are not switched on yet. Please contact operations.', 503)
    throw err
  }
})
