/**
 * Driver-Auto — requests, approvals and the actual assignment write.
 *
 * Safety rules this file keeps:
 *
 *  • A trip is only ever assigned against its LIVE state (`loadTrip`) — never
 *    against what the driver saw on their board an hour ago.
 *  • It never overwrites a driver or vendor already on a movement. Writes to
 *    `assignments` only fill empty rows (or create missing ones), and only the
 *    driver fields — guide, tour vendor, notes and rate are left untouched.
 *  • Two drivers taking the same trip in the same second cannot both win: the
 *    winning claim takes `lockKey = tripKey`, and that column is UNIQUE.
 *  • The agreed rate is never set here and never sent to a driver.
 */
import { prisma } from '@/lib/prisma'
import { logActivity } from '@/lib/activity'
import { sendMailViaGraph } from '@/lib/send-mail'
import { syncSlAllocationFromAgenda } from '@/lib/sl-driver-allocation-sync'
import { sendDriverAssignment, type DriverMovement } from '@/lib/driver-assignment-whatsapp'
import type { Prisma } from '@prisma/client'
import { assignmentHasParty, loadTrip, publicTrip } from './open-trips'
import {
  addDays, boardUrl, readSettings, resolveParty, partnerServes, ymdOf,
  type ResolvedParty,
} from './server'
import {
  DA_COUNTRY_META, fmtTripDay, isDaCountry, partyKey,
  type ClaimStatus, type ClaimView, type OpenTrip, type PartyType,
} from './shared'

export class DaError extends Error {
  constructor(message: string, public status = 400, public code = 'bad_request') {
    super(message)
  }
}

type ClaimRow = Prisma.DriverTripClaimGetPayload<Record<string, never>>

export function toClaimView(c: ClaimRow): ClaimView {
  return {
    id: c.id,
    kind: c.kind as ClaimView['kind'],
    tripKey: c.tripKey,
    bookingRef: c.bookingRef,
    bookingId: c.bookingId,
    agendaItemId: c.agendaItemId,
    country: c.country,
    tripDate: ymdOf(c.tripDate),
    tripEndDate: c.tripEndDate ? ymdOf(c.tripEndDate) : null,
    partyType: c.partyType as PartyType,
    partyId: c.partyId,
    partyKey: partyKey(c.partyType as PartyType, c.partyId),
    partyName: c.partyName,
    partyPhone: c.partyPhone,
    status: c.status as ClaimStatus,
    driverNote: c.driverNote,
    decisionNote: c.decisionNote,
    decidedByName: c.decidedByName,
    decidedAt: c.decidedAt?.toISOString() ?? null,
    assignedAt: c.assignedAt?.toISOString() ?? null,
    createdAt: c.createdAt.toISOString(),
    notifyResult: c.notifyResult,
    snapshot: (c.snapshot as Partial<OpenTrip> | null) ?? null,
  }
}

// ── What a party is already doing ────────────────────────────────────────────

/**
 * Trips this driver/vendor already holds between two dates — from movement
 * assignments and from Sri Lanka booking-level allocations. Labels read
 * "IS1234 · Tue 14 Oct".
 */
export async function partyCommitments(
  type: PartyType, id: string, fromYmd: string, toYmd: string,
): Promise<{ date: string; bookingRef: string }[]> {
  const from = new Date(`${fromYmd}T00:00:00.000Z`)
  const to = new Date(`${toYmd}T23:59:59.999Z`)
  const who = type === 'DRIVER' ? { driverId: id } : { vendorId: id }

  const [assignments, slAllocs] = await Promise.all([
    prisma.assignment.findMany({
      where: { ...who, agendaItem: { date: { gte: from, lte: to } } },
      select: { agendaItem: { select: { date: true, agenda: { select: { booking: { select: { bookingRef: true, status: true } } } } } } },
    }),
    prisma.sriLankaDriverAllocation.findMany({
      where: { ...who, booking: { arrivalDate: { lte: to }, departureDate: { gte: from } } },
      select: { booking: { select: { bookingRef: true, arrivalDate: true, status: true } } },
    }),
  ])

  const out = new Map<string, { date: string; bookingRef: string }>()
  for (const a of assignments) {
    const b = a.agendaItem.agenda.booking
    if (b.status === 'CANCELLED') continue
    const date = ymdOf(a.agendaItem.date)
    out.set(`${b.bookingRef}|${date}`, { date, bookingRef: b.bookingRef })
  }
  for (const s of slAllocs) {
    if (s.booking.status === 'CANCELLED') continue
    const date = ymdOf(s.booking.arrivalDate)
    if (!Array.from(out.values()).some(v => v.bookingRef === s.booking.bookingRef)) {
      out.set(`${s.booking.bookingRef}|${date}`, { date, bookingRef: s.booking.bookingRef })
    }
  }
  return Array.from(out.values()).sort((a, b) => a.date.localeCompare(b.date))
}

function clashLabels(list: { date: string; bookingRef: string }[], trip: OpenTrip): string[] {
  const driven = new Set(trip.legs.filter(l => l.driven).map(l => l.date))
  if (driven.size === 0) driven.add(trip.startDate)
  return list
    .filter(c => c.bookingRef !== trip.bookingRef && (driven.has(c.date) || (trip.kind === 'BOOKING' && c.date >= trip.startDate && c.date <= trip.endDate)))
    .map(c => `${c.bookingRef} · ${fmtTripDay(c.date)}`)
}

function seatsFit(party: ResolvedParty, trip: OpenTrip): boolean | null {
  if (!party.capacity || party.capacity <= 0) return null
  return trip.pax <= party.capacity
}

// ── Driver side ──────────────────────────────────────────────────────────────

export interface RequestResult {
  claim: ClaimView
  mode: 'pending' | 'assigned'
  message: string
}

/** A driver/vendor asks for (or, with approval off, takes) one open trip. */
export async function requestTrip(party: ResolvedParty, tripKey: string, note?: string | null): Promise<RequestResult> {
  if (!party.isActive) throw new DaError('Your profile is not active. Please contact operations.', 403, 'inactive')

  const live = await loadTrip(tripKey)
  if (!live.open) {
    throw new DaError(
      live.reason === 'allocated' ? 'Sorry — this trip has just been allocated.' : 'This trip is no longer available.',
      409, 'taken',
    )
  }
  const trip = live.trip
  if (!isDaCountry(trip.country) || !partnerServes(party.country, trip.country)) {
    throw new DaError('This trip is outside your registered country.', 403, 'country')
  }

  const settings = await readSettings()
  const cs = settings.countries[trip.country]
  if (party.type === 'VENDOR' && !cs.includeVendors) throw new DaError('Vendors cannot take trips in this country.', 403, 'vendor_off')

  const existing = await prisma.driverTripClaim.findFirst({
    where: { tripKey, partyType: party.type, partyId: party.id, status: 'PENDING' },
  })
  if (existing) {
    return { claim: toClaimView(existing), mode: 'pending', message: 'You have already requested this trip.' }
  }

  const pendingCount = await prisma.driverTripClaim.count({
    where: { partyType: party.type, partyId: party.id, status: 'PENDING' },
  })
  if (pendingCount >= settings.maxPendingPerParty) {
    throw new DaError(`You already have ${pendingCount} requests waiting. Please wait for those to be answered.`, 429, 'too_many')
  }

  const commitments = await partyCommitments(party.type, party.id, trip.startDate, trip.endDate)
  const clashes = clashLabels(commitments, trip)
  const fits = seatsFit(party, trip)

  if (!cs.requireApproval) {
    // First come, first served — but never into a clash or an over-full vehicle;
    // those still go to a person.
    if (clashes.length) throw new DaError(`You already have a trip on these dates (${clashes.join(', ')}).`, 409, 'clash')
    if (fits === false) throw new DaError(`This trip is for ${trip.pax} guests — more than your vehicle seats (${party.capacity}).`, 409, 'capacity')
  }

  const created = await prisma.driverTripClaim.create({
    data: {
      kind: trip.kind,
      tripKey: trip.key,
      bookingId: trip.bookingId,
      bookingRef: trip.bookingRef,
      agendaItemId: trip.agendaItemId,
      country: trip.country,
      tripDate: new Date(`${trip.startDate}T00:00:00.000Z`),
      tripEndDate: new Date(`${trip.endDate}T00:00:00.000Z`),
      snapshot: { ...publicTrip(trip), leadGuest: trip.leadGuest ?? null, agent: trip.agent ?? null } as unknown as Prisma.InputJsonValue,
      partyType: party.type,
      partyId: party.id,
      partyName: party.name,
      partyPhone: party.phone,
      status: 'PENDING',
      driverNote: note?.trim().slice(0, 500) || null,
    },
  })

  if (cs.requireApproval) {
    return {
      claim: toClaimView(created),
      mode: 'pending',
      message: 'Request sent. Operations will confirm it — you will get a WhatsApp message once approved.',
    }
  }

  const committed = await commitClaim(created.id, { system: true })
  return { claim: committed, mode: 'assigned', message: 'Trip confirmed — it is yours. Details are on their way by WhatsApp.' }
}

export async function withdrawClaim(party: ResolvedParty, claimId: string): Promise<ClaimView> {
  const c = await prisma.driverTripClaim.findUnique({ where: { id: claimId } })
  if (!c || c.partyType !== party.type || c.partyId !== party.id) throw new DaError('Request not found.', 404, 'not_found')
  if (c.status !== 'PENDING') throw new DaError('Only a request still waiting for approval can be withdrawn.', 409, 'not_pending')
  const updated = await prisma.driverTripClaim.update({ where: { id: c.id }, data: { status: 'WITHDRAWN' } })
  return toClaimView(updated)
}

// ── Staff side ───────────────────────────────────────────────────────────────

export interface Actor {
  system?: boolean
  userId?: string
  name?: string
}

export async function rejectClaim(claimId: string, actor: Actor, note?: string | null): Promise<ClaimView> {
  const c = await prisma.driverTripClaim.findUnique({ where: { id: claimId } })
  if (!c) throw new DaError('Request not found.', 404, 'not_found')
  if (c.status !== 'PENDING') throw new DaError(`This request is already ${c.status.toLowerCase()}.`, 409, 'not_pending')
  const updated = await prisma.driverTripClaim.update({
    where: { id: c.id },
    data: {
      status: 'REJECTED',
      decisionNote: note?.trim().slice(0, 500) || null,
      decidedById: actor.userId ?? null,
      decidedByName: actor.name ?? null,
      decidedAt: new Date(),
    },
  })
  if (actor.userId) {
    void logActivity({ userId: actor.userId, action: 'DRIVER_AUTO_REJECTED', entityType: 'Booking', entityId: c.bookingId,
      details: { bookingRef: c.bookingRef, tripKey: c.tripKey, party: c.partyName, note } })
  }
  return toClaimView(updated)
}

/**
 * Approve a request: re-check the trip is still open, take the lock, write the
 * assignment(s), close the competing requests and tell the driver.
 */
export async function commitClaim(claimId: string, actor: Actor, note?: string | null): Promise<ClaimView> {
  const c = await prisma.driverTripClaim.findUnique({ where: { id: claimId } })
  if (!c) throw new DaError('Request not found.', 404, 'not_found')
  if (c.status !== 'PENDING') throw new DaError(`This request is already ${c.status.toLowerCase()}.`, 409, 'not_pending')

  const party = await resolveParty(c.partyType as PartyType, c.partyId)
  if (!party) throw new DaError('The driver / vendor on this request no longer exists.', 409, 'party_gone')

  const live = await loadTrip(c.tripKey)
  if (!live.open) {
    await prisma.driverTripClaim.update({
      where: { id: c.id },
      data: { status: live.reason === 'allocated' ? 'SUPERSEDED' : 'STALE', decidedAt: new Date(), decidedByName: actor.name ?? 'System' },
    })
    throw new DaError(
      live.reason === 'allocated'
        ? 'This trip has already been allocated (on the movement chart or to another request).'
        : 'This trip no longer exists in its requested form — the movement chart was re-saved or the booking closed. Ask the driver to request it again.',
      409, live.reason === 'allocated' ? 'taken' : 'stale',
    )
  }

  // The trip is open again although an older claim still holds its lock — the
  // driver was removed on the movement chart since. Release that lock.
  await prisma.driverTripClaim.updateMany({
    where: { lockKey: c.tripKey, NOT: { id: c.id } },
    data: { lockKey: null, status: 'RELEASED' },
  })

  const won: ClaimStatus = actor.system ? 'AUTO_ASSIGNED' : 'APPROVED'
  try {
    await prisma.driverTripClaim.update({
      where: { id: c.id },
      data: {
        lockKey: c.tripKey,
        status: won,
        decisionNote: note?.trim().slice(0, 500) || null,
        decidedById: actor.userId ?? null,
        decidedByName: actor.system ? 'Auto (first come)' : actor.name ?? null,
        decidedAt: new Date(),
      },
    })
  } catch (err) {
    if ((err as { code?: string })?.code === 'P2002') {
      await prisma.driverTripClaim.update({ where: { id: c.id }, data: { status: 'SUPERSEDED', decidedAt: new Date() } })
      throw new DaError('Another driver took this trip a moment ago.', 409, 'taken')
    }
    throw err
  }

  let written: { items: number }
  try {
    written = await writeAssignments(live.trip, party)
  } catch (err) {
    // Roll the claim back so the trip is not shown as won when nothing was written.
    await prisma.driverTripClaim.update({
      where: { id: c.id },
      data: { lockKey: null, status: err instanceof DaError && err.code === 'taken' ? 'SUPERSEDED' : 'PENDING', decidedAt: null, decidedById: null, decidedByName: null },
    })
    throw err
  }

  await prisma.driverTripClaim.updateMany({
    where: { tripKey: c.tripKey, status: 'PENDING', NOT: { id: c.id } },
    data: { status: 'SUPERSEDED', decidedAt: new Date(), decidedByName: actor.system ? 'Auto (first come)' : actor.name ?? null },
  })

  const notifyResult = await notifyAssigned(live.trip, party)
  const final = await prisma.driverTripClaim.update({
    where: { id: c.id },
    data: { assignedAt: new Date(), notifyResult },
  })

  if (actor.userId) {
    void logActivity({ userId: actor.userId, action: 'DRIVER_AUTO_APPROVED', entityType: 'Booking', entityId: c.bookingId,
      details: { bookingRef: c.bookingRef, tripKey: c.tripKey, party: party.name, items: written.items, notifyResult } })
  }
  console.log(`[DriverAuto] ${won} ${c.tripKey} (${c.bookingRef}) → ${party.name}; ${written.items} movement(s); ${notifyResult}`)
  return toClaimView(final)
}

// ── The assignment write ─────────────────────────────────────────────────────

function partyAssignmentData(party: ResolvedParty) {
  return party.type === 'DRIVER'
    ? {
        driverId: party.id, vendorId: null, vendorName: null,
        driverName: party.name, driverPhone: party.phone,
        vehicleType: party.vehicleType, vehiclePlate: party.vehiclePlate,
      }
    : {
        // Same shape the SL allocation board writes for a vendor pick.
        driverId: null, vendorId: party.id, vendorName: party.name,
        driverName: party.name, driverPhone: party.phone,
        vehicleType: null, vehiclePlate: null,
      }
}

/**
 * Fills the empty driver slot on each driven movement of the trip. A movement
 * that gained a driver since `loadTrip` is left alone; for a single-movement
 * trip that means the request lost the race.
 */
async function writeAssignments(trip: OpenTrip, party: ResolvedParty): Promise<{ items: number }> {
  const data = partyAssignmentData(party)
  const itemIds = trip.legs.filter(l => l.driven).map(l => l.agendaItemId)
  let items = 0

  for (const agendaItemId of itemIds) {
    const existing = await prisma.assignment.findUnique({
      where: { agendaItemId },
      select: { id: true, driverId: true, vendorId: true, driverName: true, vendorName: true, vehicleType: true },
    })
    if (!existing) {
      try {
        await prisma.assignment.create({ data: { agendaItemId, ...data } })
        items++
      } catch (err) {
        if ((err as { code?: string })?.code !== 'P2002') throw err
      }
      continue
    }
    if (assignmentHasParty(existing)) continue
    // Keep a vehicle type the desk already chose for this movement.
    const res = await prisma.assignment.updateMany({
      where: { id: existing.id, driverId: null, vendorId: null },
      data: { ...data, vehicleType: existing.vehicleType ?? data.vehicleType },
    })
    items += res.count
  }

  if (trip.kind === 'MOVEMENT' && items === 0) {
    throw new DaError('Another driver was put on this movement a moment ago.', 409, 'taken')
  }

  if (trip.kind === 'BOOKING') {
    const current = await prisma.sriLankaDriverAllocation.findUnique({
      where: { bookingId: trip.bookingId },
      select: { driverId: true, vendorId: true, vehicleType: true },
    })
    if (current && (current.driverId || current.vendorId)) {
      if (items === 0) throw new DaError('This booking was allocated a moment ago.', 409, 'taken')
    } else {
      const who = party.type === 'DRIVER' ? { driverId: party.id, vendorId: null } : { driverId: null, vendorId: party.id }
      const vehicleType = current?.vehicleType ?? party.vehicleType ?? null
      await prisma.sriLankaDriverAllocation.upsert({
        where: { bookingId: trip.bookingId },
        create: { bookingId: trip.bookingId, ...who, vehicleType, changedAt: new Date() },
        update: { ...who, vehicleType, changedAt: new Date() },
      })
    }
    try {
      await syncSlAllocationFromAgenda(trip.bookingId)
    } catch (err) {
      console.error('[DriverAuto] SL allocation sync failed (non-fatal):', err)
    }
  }

  return { items }
}

// ── Telling the driver ───────────────────────────────────────────────────────

async function notifyAssigned(trip: OpenTrip, party: ResolvedParty): Promise<string> {
  const notes: string[] = []
  const driven = trip.legs.filter(l => l.driven)
  const movements: DriverMovement[] = driven.length
    ? driven.map(l => ({
        date: `${l.date}T00:00:00.000Z`, location: l.location, fromPoint: l.from, toPoint: l.to,
        details: null, meetingTime: l.time,
      }))
    : [{
        date: `${trip.startDate}T00:00:00.000Z`, location: trip.cities.join(', ') || 'Sri Lanka round trip',
        fromPoint: 'Arrival', toPoint: `Departure ${fmtTripDay(trip.endDate)}`, details: null, meetingTime: trip.startTime,
      }]

  // WhatsApp — the existing approved assignment template. Never carries a rate.
  if (party.phone) {
    try {
      const wa = await sendDriverAssignment({
        bookingRef: trip.bookingRef,
        driverName: party.name,
        driverPhone: party.phone,
        paxAdults: trip.paxAdults,
        paxChildren: trip.paxChildren,
        leadPassenger: trip.leadGuest ?? null,
        vehicleType: party.vehicleType,
        vehiclePlate: party.vehiclePlate,
        movements,
      })
      notes.push(wa.ok ? 'WhatsApp sent' : `WhatsApp not sent (${wa.reason})`)
    } catch (err) {
      notes.push(`WhatsApp failed (${err instanceof Error ? err.message : String(err)})`)
    }
  } else {
    notes.push('No phone — WhatsApp not sent')
  }

  if (party.email) {
    try {
      const settings = await readSettings()
      await sendMailViaGraph({
        to: party.email,
        subject: `Trip confirmed — ${trip.bookingRef} · ${fmtTripDay(trip.startDate, { year: true })}`,
        bodyHtml: assignedEmailHtml(trip, party, boardUrl(party.key, settings)),
      })
      notes.push('email sent')
    } catch (err) {
      notes.push(`email failed (${err instanceof Error ? err.message : String(err)})`)
    }
  }
  return notes.join(' · ')
}

function esc(s: string | null | undefined): string {
  return String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]!))
}

function assignedEmailHtml(trip: OpenTrip, party: ResolvedParty, link: string): string {
  const rows = trip.legs.filter(l => l.driven).map(l => `
    <tr>
      <td style="padding:8px 10px;border-bottom:1px solid #eef2f7;white-space:nowrap;color:#334155">${esc(fmtTripDay(l.date))}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #eef2f7;color:#0f172a">${esc(l.time ?? '')}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #eef2f7;color:#0f172a">${esc(l.from || l.location)}${l.to ? ` &rarr; ${esc(l.to)}` : ''}</td>
    </tr>`).join('')
  const country = isDaCountry(trip.country) ? DA_COUNTRY_META[trip.country].label : trip.country
  return `<!doctype html><html><body style="margin:0;background:#f1f5f9;font-family:Segoe UI,Arial,sans-serif">
  <div style="max-width:600px;margin:0 auto;padding:24px">
    <div style="background:linear-gradient(135deg,#0f172a,#1e293b);color:#fff;border-radius:16px;padding:22px">
      <div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#34d399">Trip confirmed</div>
      <div style="font-size:22px;font-weight:700;margin-top:6px">${esc(trip.bookingRef)} · ${esc(country)}</div>
      <div style="font-size:13px;color:#cbd5e1;margin-top:4px">${esc(fmtTripDay(trip.startDate, { year: true }))}${trip.days > 1 ? ` – ${esc(fmtTripDay(trip.endDate, { year: true }))} (${trip.days} days)` : ''}</div>
    </div>
    <div style="background:#fff;border-radius:16px;padding:20px;margin-top:12px">
      <p style="margin:0 0 12px;color:#0f172a">Hi ${esc(party.name)}, this trip is now yours.</p>
      <p style="margin:0 0 14px;color:#475569;font-size:14px">Guests: <b>${trip.paxAdults}</b> adult(s)${trip.paxChildren ? `, <b>${trip.paxChildren}</b> child(ren)` : ''}${trip.leadGuest ? ` · Lead guest <b>${esc(trip.leadGuest)}</b>` : ''}</p>
      ${rows ? `<table style="width:100%;border-collapse:collapse;font-size:13px">${rows}</table>` : '<p style="color:#64748b;font-size:13px">The movement chart for this trip is still being prepared — operations will send the full schedule.</p>'}
      <div style="margin-top:18px"><a href="${esc(link)}" style="display:inline-block;background:#10b981;color:#fff;text-decoration:none;font-weight:600;padding:11px 18px;border-radius:10px">Open my trip board</a></div>
      <p style="margin:16px 0 0;color:#94a3b8;font-size:12px">This link is personal to you — please do not share it.</p>
    </div>
  </div></body></html>`
}

// ── Staff read model ─────────────────────────────────────────────────────────

/**
 * Claims for one country: every pending request (with clash / seat / load
 * hints), plus what was decided recently, for the activity feed.
 */
export async function listClaimsForCountry(country: string, openKeys: Set<string>): Promise<ClaimView[]> {
  const since = new Date(Date.now() - 14 * 86_400_000)
  const rows = await prisma.driverTripClaim.findMany({
    where: {
      country,
      OR: [{ status: 'PENDING' }, { updatedAt: { gte: since } }],
    },
    orderBy: { createdAt: 'desc' },
    take: 400,
  })
  const views = rows.map(toClaimView)

  const pending = views.filter(v => v.status === 'PENDING')
  const partyCache = new Map<string, ResolvedParty | null>()
  const commitCache = new Map<string, { date: string; bookingRef: string }[]>()

  await Promise.all(pending.map(async v => {
    v.stillOpen = openKeys.has(v.tripKey)
    if (!partyCache.has(v.partyKey)) partyCache.set(v.partyKey, await resolveParty(v.partyType, v.partyId))
    const party = partyCache.get(v.partyKey)
    if (!commitCache.has(v.partyKey)) {
      const today = new Date().toISOString().slice(0, 10)
      commitCache.set(v.partyKey, await partyCommitments(v.partyType, v.partyId, today, addDays(today, 60)))
    }
    const commitments = commitCache.get(v.partyKey) ?? []
    const snap = v.snapshot as OpenTrip | null
    if (snap?.legs) v.clashes = clashLabels(commitments, { ...snap, bookingRef: v.bookingRef } as OpenTrip)
    v.fits = party && snap ? seatsFit(party, snap) : null
    const in30 = addDays(new Date().toISOString().slice(0, 10), 30)
    v.load = new Set(commitments.filter(x => x.date <= in30).map(x => x.bookingRef)).size
  }))

  return views
}

