/**
 * Live Ops — everything that is happening *right now*, in one read.
 *
 * The stats endpoint answers "how big is the book": counts of files by status,
 * revenue, what lands today. It cannot answer the question the ground desk
 * actually opens the dashboard with — *who is out there at this minute, where
 * are they, and what is carrying them* — because that answer lives across four
 * tables (booking, agenda item, assignment, flight) and has to be read as one
 * consistent picture or not at all.
 *
 * Strictly read-only: this route only ever issues findMany/count. It is the data
 * behind the dashboard hero map, so it is also on the hot path of the landing
 * page — hence the static gazetteer in `ops-geo` rather than a geocoder, and a
 * hard cap on the row counts it will resolve.
 */

import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { canSeeAllCountries } from '@/lib/rbac'
import { countryScope, userCountryScope } from '@/lib/country-detection'
import { resolveIsLeisure } from '@/lib/leisure-day'
import { resolveIsHotelOnly } from '@/lib/driver-requirement'
import { airport, place, vehicleKind, countryFocus, type OpCountry } from '@/lib/ops-geo'
import type { Prisma, UserRole } from '@prisma/client'

export const dynamic = 'force-dynamic'

/** How many on-ground files the hero will pin. Beyond this the map is noise. */
const MAX_ON_GROUND = 120
/** How many sectors the hero will draw as arcs. */
const MAX_FLIGHTS = 60

const COUNTRY_LABEL: Record<string, string> = {
  VIETNAM: 'Vietnam',
  SRILANKA: 'Sri Lanka',
  SINGAPORE: 'Singapore',
  MALAYSIA: 'Malaysia',
  SINGAPORE_MALAYSIA: 'Singapore & Malaysia',
}

/** The gazetteer knows four operating countries; the legacy combined value is not one. */
function opCountry(c: string | null | undefined): OpCountry | null {
  if (c === 'VIETNAM' || c === 'SRILANKA' || c === 'SINGAPORE' || c === 'MALAYSIA') return c
  return null
}

/** "HH:MM" (or "HH.MM", "1430") as minutes past local midnight. */
function minutesOf(t: string | null | undefined): number | null {
  if (!t) return null
  const m = String(t).trim().match(/^(\d{1,2})[:.\s]?(\d{2})/)
  if (!m) return null
  const h = Number(m[1]); const min = Number(m[2])
  if (!Number.isFinite(h) || !Number.isFinite(min) || h > 23 || min > 59) return null
  return h * 60 + min
}

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return buildApiError('Unauthorized', 401)

    const role = session.user.role as UserRole
    const userCountry = (session.user as any).country as string | undefined
    const userCountries = (session.user as any).countries as string[] | undefined
    const countryOverride = req.nextUrl.searchParams.get('country')

    // Same scoping rule as /api/dashboard/stats — a user must never see a file
    // on this map that they could not open from the bookings list.
    const countryWhere: Record<string, unknown> = {}
    let scope = 'ALL'
    if (!canSeeAllCountries(role, userCountry as any)) {
      const multiScope = userCountryScope(userCountry, userCountries)
      if (multiScope) countryWhere.operationCountry = { in: multiScope }
      scope = userCountry ?? 'ALL'
    } else if (countryOverride && countryOverride !== 'ALL') {
      if (countryOverride === 'SINGAPORE_MALAYSIA') {
        countryWhere.operationCountry = { in: countryScope(countryOverride)! }
      } else {
        countryWhere.operationCountry = countryOverride
      }
      scope = countryOverride
    }

    const now = new Date()
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const todayEnd = new Date(todayStart.getTime() + 86_400_000)

    // ── On the ground: landed but not yet flown home ─────────────────────────
    //
    // Inclusive at both ends on purpose. A file arriving at 23:50 tonight is on
    // the ground as far as the airport rep is concerned, and a file departing at
    // 01:00 tomorrow still has guests in a hotel right now.
    const onGroundWhere: Prisma.BookingWhereInput = {
      ...countryWhere,
      arrivalDate: { lt: todayEnd },
      departureDate: { gte: todayStart },
      status: { notIn: ['CANCELLED'] },
    }

    const flightWhere: Record<string, unknown> = { date: { gte: todayStart, lt: todayEnd } }
    if (Object.keys(countryWhere).length > 0) flightWhere.booking = countryWhere

    const [bookings, agendaToday, flightRows, arrivalsToday, departuresToday] = await Promise.all([
      prisma.booking.findMany({
        where: onGroundWhere,
        select: {
          id: true,
          bookingRef: true,
          agent: true,
          status: true,
          operationCountry: true,
          arrivalDate: true,
          departureDate: true,
          paxAdults: true,
          paxChildren: true,
          paxInfants: true,
          tourDestination: true,
          passengers: { select: { name: true }, take: 1 },
        },
        orderBy: { arrivalDate: 'asc' },
        take: MAX_ON_GROUND,
      }),
      prisma.agendaItem.findMany({
        where: {
          date: { gte: todayStart, lt: todayEnd },
          agenda: { booking: onGroundWhere },
        },
        select: {
          id: true,
          date: true,
          location: true,
          fromPoint: true,
          toPoint: true,
          details: true,
          serviceType: true,
          timeFrom: true,
          meetingTime: true,
          isLeisure: true,
          isHotelOnly: true,
          sortOrder: true,
          agenda: { select: { bookingId: true } },
          assignment: {
            select: {
              driverName: true,
              vehicleType: true,
              vehiclePlate: true,
              vendorName: true,
              guideName: true,
            },
          },
        },
        orderBy: [{ date: 'asc' }, { sortOrder: 'asc' }],
      }),
      prisma.flight.findMany({
        where: flightWhere,
        select: {
          id: true,
          flightNo: true,
          airline: true,
          depTime: true,
          arrTime: true,
          fromApt: true,
          toApt: true,
          booking: {
            select: {
              bookingRef: true, operationCountry: true,
              paxAdults: true, paxChildren: true, status: true,
            },
          },
        },
        orderBy: { depTime: 'asc' },
        take: MAX_FLIGHTS,
      }),
      prisma.booking.count({
        where: { ...countryWhere, arrivalDate: { gte: todayStart, lt: todayEnd }, status: { notIn: ['CANCELLED'] } },
      }),
      prisma.booking.count({
        where: { ...countryWhere, departureDate: { gte: todayStart, lt: todayEnd }, status: { notIn: ['CANCELLED'] } },
      }),
    ])

    // ── Today's movement, per file ───────────────────────────────────────────
    //
    // A file can have several rows today. The first row is the one that says
    // where the guests physically are this morning, so that is the one pinned;
    // the rest only contribute their vehicles to the fleet count.
    const movementsByBooking = new Map<string, typeof agendaToday>()
    for (const it of agendaToday) {
      const id = it.agenda.bookingId
      const list = movementsByBooking.get(id)
      if (list) list.push(it)
      else movementsByBooking.set(id, [it])
    }

    const dayCount = (a: Date, b: Date) =>
      Math.max(1, Math.round((b.getTime() - a.getTime()) / 86_400_000) + 1)

    const onGround = bookings.map(b => {
      const oc = opCountry(b.operationCountry)
      const moves = movementsByBooking.get(b.id) ?? []
      const first = moves[0] ?? null

      // Where to put the pin: today's destination, then today's origin, then the
      // day's named location, then the file's own destination text. A file with
      // no agenda row today is still on the ground — it just has no better
      // answer than "somewhere in the country it was sold for".
      const legFrom = place(first?.fromPoint, oc)
      const legTo = place(first?.toPoint, oc) ?? place(first?.location, oc)
      const pin = legTo ?? legFrom ?? place(b.tourDestination, oc)

      const needsDriver = first
        ? !resolveIsHotelOnly(first) && !resolveIsLeisure(first)
        : false

      const arrival = new Date(b.arrivalDate)
      const departure = new Date(b.departureDate)

      return {
        bookingRef: b.bookingRef,
        status: b.status,
        country: b.operationCountry,
        countryLabel: b.operationCountry ? COUNTRY_LABEL[b.operationCountry] ?? b.operationCountry : null,
        lead: b.passengers[0]?.name ?? null,
        agent: b.agent,
        pax: b.paxAdults + b.paxChildren,
        paxAdults: b.paxAdults,
        paxChildren: b.paxChildren,
        paxInfants: b.paxInfants,
        arrivalDate: arrival.toISOString(),
        departureDate: departure.toISOString(),
        // "Day 3 of 8" — the single most-asked question about a file on the road.
        dayNo: Math.min(dayCount(arrival, departure), Math.max(1, dayCount(arrival, todayStart))),
        totalDays: dayCount(arrival, departure),
        arrivingToday: arrival >= todayStart && arrival < todayEnd,
        departingToday: departure >= todayStart && departure < todayEnd,
        pin: pin ? { name: pin.name, lat: pin.lat, lng: pin.lng } : null,
        // Both ends of today's leg, when both resolve — the hero drives a vehicle
        // along this line. A same-place leg is not a drive and is dropped.
        leg: legFrom && legTo && legFrom.name !== legTo.name
          ? {
              from: { name: legFrom.name, lat: legFrom.lat, lng: legFrom.lng },
              to: { name: legTo.name, lat: legTo.lat, lng: legTo.lng },
            }
          : null,
        movement: first
          ? {
              from: first.fromPoint,
              to: first.toPoint ?? first.location,
              time: first.meetingTime ?? first.timeFrom,
              serviceType: first.serviceType,
              leisure: resolveIsLeisure(first),
              hotelOnly: resolveIsHotelOnly(first),
              needsDriver,
              driver: first.assignment?.driverName ?? null,
              guide: first.assignment?.guideName ?? null,
              vendor: first.assignment?.vendorName ?? null,
              vehicleType: first.assignment?.vehicleType ?? null,
              vehiclePlate: first.assignment?.vehiclePlate ?? null,
              vehicleKind: vehicleKind(first.assignment?.vehicleType),
            }
          : null,
        movementsToday: moves.length,
      }
    })

    // ── Fleet on the road ────────────────────────────────────────────────────
    //
    // Counted off distinct vehicles, not distinct rows: one van doing three
    // movements today is one van on the road. A row with no plate falls back to
    // the driver, because in practice the plate is the field that goes unfilled.
    const seenVehicle = new Set<string>()
    const seenDriver = new Set<string>()
    const seenGuide = new Set<string>()
    const fleetCount = new Map<string, number>()
    let unassignedMovements = 0

    for (const it of agendaToday) {
      const a = it.assignment
      const needsDriver = !resolveIsHotelOnly(it) && !resolveIsLeisure(it)
      if (needsDriver && !a?.driverName && !a?.vehiclePlate) unassignedMovements++
      if (!a) continue
      if (a.driverName?.trim()) seenDriver.add(a.driverName.trim().toLowerCase())
      if (a.guideName?.trim()) seenGuide.add(a.guideName.trim().toLowerCase())

      // `hotel_only` is the allocation board saying this file carries no
      // transport. It is a vehicle type in the column and a vehicle nowhere else,
      // so it must never inflate "vehicles on the road".
      const kind = vehicleKind(a.vehicleType)
      if (kind === 'none') continue

      const key = (a.vehiclePlate?.trim() || a.driverName?.trim() || '').toLowerCase()
      if (!key) continue
      if (seenVehicle.has(key)) continue
      seenVehicle.add(key)
      fleetCount.set(kind, (fleetCount.get(kind) ?? 0) + 1)
    }

    const fleet = Array.from(fleetCount.entries())
      .map(([kind, count]) => ({ kind, count }))
      .sort((a, b) => b.count - a.count)

    // ── Flights, as arcs ─────────────────────────────────────────────────────
    const nowMinutes = now.getHours() * 60 + now.getMinutes()

    const flights = flightRows.map(f => {
      const from = airport(f.fromApt)
      const to = airport(f.toApt)
      const oc = f.booking?.operationCountry ?? null
      const ocLabel = oc ? COUNTRY_LABEL[oc] ?? null : null

      // Which way this sector runs relative to the country we operate it in.
      // Country names, not positions: an internal Hanoi–Da Nang hop and an
      // inbound Dubai–Hanoi are both "arriving at HAN" by position alone.
      const fromHome = !!ocLabel && from?.country === ocLabel
      const toHome = !!ocLabel && to?.country === ocLabel
      const direction: 'arrival' | 'departure' | 'internal' | 'other' =
        fromHome && toHome ? 'internal'
        : toHome ? 'arrival'
        : fromHome ? 'departure'
        : 'other'

      const dep = minutesOf(f.depTime)
      const arr = minutesOf(f.arrTime)
      // Only same-day sectors get a live phase — a red-eye's arrival belongs to
      // tomorrow and would otherwise read as a flight that landed before it left.
      const sameDay = dep != null && arr != null && arr > dep
      const phase: 'scheduled' | 'airborne' | 'landed' | 'unknown' =
        dep == null ? 'unknown'
        : nowMinutes < dep ? 'scheduled'
        : sameDay && nowMinutes >= arr! ? 'landed'
        : sameDay ? 'airborne'
        : 'landed'

      return {
        id: f.id,
        flightNo: f.flightNo,
        airline: f.airline,
        bookingRef: f.booking?.bookingRef ?? null,
        country: oc,
        countryLabel: ocLabel,
        pax: (f.booking?.paxAdults ?? 0) + (f.booking?.paxChildren ?? 0),
        cancelled: f.booking?.status === 'CANCELLED',
        depTime: f.depTime,
        arrTime: f.arrTime,
        depMin: dep,
        arrMin: arr,
        direction,
        phase,
        from: from
          ? { iata: from.iata, city: from.city, country: from.country, lat: from.lat, lng: from.lng }
          : { iata: (f.fromApt ?? '').toUpperCase(), city: null, country: null, lat: null, lng: null },
        to: to
          ? { iata: to.iata, city: to.city, country: to.country, lat: to.lat, lng: to.lng }
          : { iata: (f.toApt ?? '').toUpperCase(), city: null, country: null, lat: null, lng: null },
      }
    })

    // ── Per-country roll-up ──────────────────────────────────────────────────
    const byCountry = new Map<string, { country: string; label: string; pax: number; bookings: number; arrivals: number; departures: number; hex: string }>()
    for (const g of onGround) {
      const key = g.country ?? 'UNASSIGNED'
      const row = byCountry.get(key) ?? {
        country: key,
        label: g.countryLabel ?? 'Unassigned',
        pax: 0, bookings: 0, arrivals: 0, departures: 0,
        hex: countryFocus(key).hex,
      }
      row.pax += g.pax
      row.bookings += 1
      if (g.arrivingToday) row.arrivals += 1
      if (g.departingToday) row.departures += 1
      byCountry.set(key, row)
    }

    const countries = Array.from(byCountry.values()).sort((a, b) => b.pax - a.pax)

    return buildApiSuccess({
      scope,
      generatedAt: now.toISOString(),
      /** Server clock as minutes past midnight — the client animates on from here. */
      nowMinutes,
      totals: {
        paxOnGround: onGround.reduce((n, g) => n + g.pax, 0),
        adultsOnGround: onGround.reduce((n, g) => n + g.paxAdults, 0),
        childrenOnGround: onGround.reduce((n, g) => n + g.paxChildren, 0),
        bookingsOnGround: onGround.length,
        vehiclesOnGround: seenVehicle.size,
        driversOnGround: seenDriver.size,
        guidesOnGround: seenGuide.size,
        movementsToday: agendaToday.length,
        unassignedMovements,
        arrivalsToday,
        departuresToday,
        flightsToday: flights.length,
        airborneNow: flights.filter(f => f.phase === 'airborne').length,
      },
      countries,
      fleet,
      onGround,
      flights,
    })
  } catch (err) {
    console.error('[Live Ops API] error:', err)
    return buildApiError(err instanceof Error ? err.message : 'Internal server error', 500)
  }
}
