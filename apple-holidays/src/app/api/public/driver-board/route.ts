/**
 * Public Driver-Auto trip board API — no login, gated by the signed link.
 *
 *   GET  ?key=d-<id>&t=<token>
 *        → the party, open trips for their country(s), their requests and the
 *          trips they already hold.
 *   POST { key, t, action: 'request' | 'withdraw', tripKey?, claimId?, note? }
 *
 * What a driver sees here never includes a rate, the agent, or a guest's name
 * on a trip that is not theirs yet.
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { listOpenTrips, publicTrip } from '@/lib/driver-auto/open-trips'
import { DaError, partyCommitments, requestTrip, toClaimView, withdrawClaim } from '@/lib/driver-auto/claims'
import {
  addDays, isDaTableMissing, localToday, readSettings, resolveParty, tabsForPartner, verifyBoardToken, ymdOf,
  type ResolvedParty,
} from '@/lib/driver-auto/server'
import { DA_COUNTRY_META, fileNumberOf, parsePartyKey, type ClaimView, type DaCountry } from '@/lib/driver-auto/shared'

export const dynamic = 'force-dynamic'

function fail(message: string, status = 400) {
  return NextResponse.json({ success: false, error: message }, { status })
}

async function authenticate(key: string | null, token: string | null): Promise<ResolvedParty | NextResponse> {
  const pk = parsePartyKey(key ?? '')
  if (!pk || !token) return fail('This link is not valid.', 401)
  const settings = await readSettings()
  if (!verifyBoardToken(pk.type === 'DRIVER' ? `d-${pk.id}` : `v-${pk.id}`, token, settings.linkEpochs[key!] ?? 0)) {
    return fail('This link has expired or is not valid. Please ask operations for a new one.', 401)
  }
  const party = await resolveParty(pk.type, pk.id)
  if (!party) return fail('This link is not valid.', 401)
  if (!party.isActive) return fail('Your profile is not active. Please contact operations.', 403)
  return party
}

/** Trips this party already drives, next 30 days, grouped per booking. */
async function myTrips(party: ResolvedParty, today: string) {
  const from = new Date(`${today}T00:00:00.000Z`)
  const to = new Date(`${addDays(today, 30)}T23:59:59.999Z`)
  const who = party.type === 'DRIVER' ? { driverId: party.id } : { vendorId: party.id }
  const rows = await prisma.assignment.findMany({
    where: { ...who, agendaItem: { date: { gte: from, lte: to }, agenda: { booking: { status: { notIn: ['CANCELLED', 'PENDING_CANCELLATION', 'AMENDED'] } } } } },
    select: {
      agendaItem: {
        select: {
          date: true, location: true, fromPoint: true, toPoint: true, meetingTime: true, timeFrom: true, sortOrder: true,
          agenda: { select: { booking: { select: {
            bookingRef: true, isNumber: true, cntlNumber: true, paxAdults: true, paxChildren: true,
            passengers: { where: { isLead: true }, take: 1, select: { name: true } },
          } } } },
        },
      },
    },
    take: 300,
  })
  const byRef = new Map<string, {
    bookingRef: string; fileNo: string; leadGuest: string | null; pax: number; startDate: string; endDate: string
    legs: { date: string; time: string | null; route: string }[]
  }>()
  const sorted = rows.map(r => r.agendaItem).sort((a, b) => a.date.getTime() - b.date.getTime() || a.sortOrder - b.sortOrder)
  for (const i of sorted) {
    const b = i.agenda.booking
    const date = ymdOf(i.date)
    const from = i.fromPoint?.trim() || i.location
    const route = i.toPoint?.trim() && i.toPoint.trim() !== from ? `${from} → ${i.toPoint.trim()}` : from
    const entry = byRef.get(b.bookingRef) ?? {
      bookingRef: b.bookingRef, fileNo: fileNumberOf(b), leadGuest: b.passengers[0]?.name ?? null, pax: b.paxAdults + b.paxChildren,
      startDate: date, endDate: date, legs: [],
    }
    entry.endDate = date
    entry.legs.push({ date, time: i.meetingTime || i.timeFrom || null, route })
    byRef.set(b.bookingRef, entry)
  }
  return Array.from(byRef.values()).sort((a, b) => a.startDate.localeCompare(b.startDate))
}

export async function GET(req: NextRequest) {
  const key = req.nextUrl.searchParams.get('key')
  const auth = await authenticate(key, req.nextUrl.searchParams.get('t'))
  if (auth instanceof NextResponse) return auth
  const party = auth

  try {
    const settings = await readSettings()
    const tabs = tabsForPartner(party.country).filter(c => party.type === 'DRIVER' || settings.countries[c].includeVendors)
    const primary: DaCountry | undefined = tabs[0]
    const today = primary ? localToday(primary) : new Date().toISOString().slice(0, 10)

    let claims: ClaimView[] = []
    let setupRequired = false
    try {
      const rows = await prisma.driverTripClaim.findMany({
        where: { partyType: party.type, partyId: party.id, createdAt: { gte: new Date(Date.now() - 30 * 86_400_000) } },
        orderBy: { createdAt: 'desc' },
        take: 100,
      })
      claims = rows.map(toClaimView).map(c => ({ ...c, partyPhone: null, decidedByName: null }))
    } catch (err) {
      if (!isDaTableMissing(err)) throw err
      setupRequired = true
    }
    const myPendingKeys = new Map(claims.filter(c => c.status === 'PENDING').map(c => [c.tripKey, c.id]))

    const commitments = await partyCommitments(party.type, party.id, today, addDays(today, settings.horizonDays + 30))
    const busy = new Set(commitments.map(c => c.date))

    const countries = await Promise.all(tabs.map(async c => {
      const trips = await listOpenTrips(c, settings.horizonDays)
      return {
        country: c,
        label: DA_COUNTRY_META[c].label,
        unit: DA_COUNTRY_META[c].unit,
        requireApproval: settings.countries[c].requireApproval,
        trips: trips.map(t => {
          const drivenDates = t.legs.filter(l => l.driven).map(l => l.date)
          const dates = drivenDates.length ? drivenDates : [t.startDate]
          return {
            ...publicTrip(t),
            myRequestId: myPendingKeys.get(t.key) ?? null,
            busy: dates.some(d => busy.has(d)),
            fits: party.capacity ? t.pax <= party.capacity : null,
          }
        }),
      }
    }))

    return NextResponse.json({
      success: true,
      data: {
        party: {
          name: party.name, type: party.type,
          vehicle: [party.vehicleType, party.vehiclePlate].filter(Boolean).join(' · ') || null,
          capacity: party.capacity,
        },
        today,
        horizonDays: settings.horizonDays,
        setupRequired,
        countries,
        claims,
        myTrips: await myTrips(party, today),
        generatedAt: new Date().toISOString(),
      },
    })
  } catch (err) {
    console.error('[driver-board GET]', err)
    return fail('Could not load your trips right now. Please try again shortly.', 500)
  }
}

export async function POST(req: NextRequest) {
  let body: { key?: string; t?: string; action?: string; tripKey?: string; claimId?: string; note?: string }
  try { body = await req.json() } catch { return fail('Invalid request') }

  const auth = await authenticate(body.key ?? null, body.t ?? null)
  if (auth instanceof NextResponse) return auth
  const party = auth

  try {
    if (body.action === 'request') {
      if (!body.tripKey || !/^[BM]:[A-Za-z0-9_-]{6,64}$/.test(body.tripKey)) return fail('Unknown trip')
      const result = await requestTrip(party, body.tripKey, body.note)
      return NextResponse.json({ success: true, data: { mode: result.mode, claim: { ...result.claim, partyPhone: null } }, message: result.message })
    }
    if (body.action === 'withdraw') {
      if (!body.claimId) return fail('Unknown request')
      const claim = await withdrawClaim(party, body.claimId)
      return NextResponse.json({ success: true, data: { claim: { ...claim, partyPhone: null } }, message: 'Request withdrawn.' })
    }
    return fail('Unknown action')
  } catch (err) {
    if (err instanceof DaError) return fail(err.message, err.status)
    if (isDaTableMissing(err)) return fail('Trip requests are not switched on yet. Please contact operations.', 503)
    console.error('[driver-board POST]', err)
    return fail('Something went wrong. Please try again.', 500)
  }
}
