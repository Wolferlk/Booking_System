/**
 * The Driver-Auto open-trip board as the Aahaas app shows it, for a signed-in
 * freelance driver or a vehicle vendor. All rules (approval, clashes, seats,
 * max pending) are the Driver-Auto ones in lib/driver-auto/claims.ts — nothing
 * is re-implemented here.
 *
 * A vendor's own drivers never get this board: their trips come from the vendor.
 */
import { prisma } from '@/lib/prisma'
import { buildApiSuccess } from '@/lib/utils'
import { listOpenTrips, publicTrip } from '@/lib/driver-auto/open-trips'
import { DaError, partyCommitments, requestTrip, toClaimView, withdrawClaim } from '@/lib/driver-auto/claims'
import { addDays, isDaTableMissing, localToday, readSettings, tabsForPartner, type ResolvedParty } from '@/lib/driver-auto/server'
import { DA_COUNTRY_META } from '@/lib/driver-auto/shared'
import { MobileError } from './http'

/** What the party can field: a driver's own vehicle, or a vendor's whole active fleet. */
async function fleetOf(p: ResolvedParty) {
  if (p.type === 'DRIVER') return { drivers: 1, maxSeats: p.capacity }
  const [drivers, top] = await Promise.all([
    prisma.driver.count({ where: { vendorId: p.id, isActive: true } }),
    prisma.vehicle.findFirst({ where: { vendorId: p.id, isActive: true }, orderBy: { capacity: 'desc' }, select: { capacity: true } }),
  ])
  return { drivers, maxSeats: top?.capacity ?? null }
}

export async function openTripBoard(p: ResolvedParty) {
  const settings = await readSettings()
  const tabs = tabsForPartner(p.country).filter(c => p.type === 'DRIVER' || settings.countries[c].includeVendors)
  const today = tabs[0] ? localToday(tabs[0]) : new Date().toISOString().slice(0, 10)

  if (p.type === 'DRIVER' && p.vendorId) {
    return buildApiSuccess({ enabled: false, vendorManaged: true, vendorName: p.vendorName, today, trips: [], claims: [] })
  }

  let claims: ReturnType<typeof toClaimView>[] = []
  let enabled = true
  try {
    const rows = await prisma.driverTripClaim.findMany({
      where: { partyType: p.type, partyId: p.id, createdAt: { gte: new Date(Date.now() - 30 * 86_400_000) } },
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

  const fleet = await fleetOf(p)
  const pending = new Map(claims.filter(c => c.status === 'PENDING').map(c => [c.tripKey, c.id]))
  // Bookings held per day: a driver is busy at one, a vendor once every driver is out.
  const perDay = new Map<string, Set<string>>()
  for (const c of await partyCommitments(p.type, p.id, today, addDays(today, settings.horizonDays + 30))) {
    if (!perDay.has(c.date)) perDay.set(c.date, new Set())
    perDay.get(c.date)!.add(c.bookingRef)
  }
  const freeOn = (d: string) => Math.max(fleet.drivers, 1) - (perDay.get(d)?.size ?? 0)
  const trips = (await Promise.all(tabs.map(async c => (await listOpenTrips(c, settings.horizonDays)).map(t => {
    const dates = t.legs.filter(l => l.driven).map(l => l.date)
    const days = dates.length ? dates : [t.startDate]
    const free = Math.min(...days.map(freeOn))
    return {
      ...publicTrip(t),
      countryLabel: DA_COUNTRY_META[c].label,
      requireApproval: settings.countries[c].requireApproval,
      myRequestId: pending.get(t.key) ?? null,
      busy: free <= 0,
      freeDrivers: p.type === 'VENDOR' ? Math.max(free, 0) : null,
      fits: fleet.maxSeats ? t.pax <= fleet.maxSeats : null,
    }
  })))).flat().sort((a, b) => a.startDate.localeCompare(b.startDate))

  // Day-by-day detail for the trip screen: what each movement involves and where
  // the guests sleep. Still no agent, guest name or contact — the party does not
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

  return buildApiSuccess({ enabled: true, today, fleet: p.type === 'VENDOR' ? fleet : null, trips: detailed, claims })
}

export async function openTripAction(p: ResolvedParty, body: { action?: string; tripKey?: string; claimId?: string; note?: string }) {
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
}
