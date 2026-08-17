import { prisma } from '@/lib/prisma'

// ─────────────────────────────────────────────────────────────────────────────
// Booking versioning
//
// When a NEW Tour-Confirmation document arrives for a booking that already
// exists (matched by IS number / CNTL / agent booking id), the pipeline
// overwrites the live booking in place. To preserve history we snapshot the
// full booking (core + document-derived children) into `BookingVersion` on
// every amendment, and expose a restore/rollback that re-points the live
// booking to a chosen version.
//
// Restore only rehydrates the TC-document-derived data (booking core fields,
// passengers, flights, accommodations, itinerary, emergency contacts, agenda
// items) — the same set the amendment pipeline already destroys and recreates.
// Operational/financial records (PNL, tickets, payments, driver assignments)
// are deliberately left untouched.
// ─────────────────────────────────────────────────────────────────────────────

export type VersionSource = 'mail' | 'onedrive' | 'restore' | 'manual'

// Children captured in a snapshot (mirrors the fields written by
// replaceBookingChildren / upsertAgenda in incoming-mail-automation.ts).
const SNAPSHOT_INCLUDE = {
  passengers:        true,
  flights:           true,
  accommodations:    true,
  itineraryItems:    true,
  emergencyContacts: true,
  tourAgenda:        { include: { items: { orderBy: [{ date: 'asc' as const }, { sortOrder: 'asc' as const }] } } },
  pnl:               { include: { lineItems: { orderBy: { sortOrder: 'asc' as const } } } },
}

/** Serialize the current full booking state into a JSON string for docSnapshot. */
export async function serializeBookingSnapshot(bookingId: string): Promise<string | null> {
  const booking = await prisma.booking.findUnique({
    where:   { id: bookingId },
    include: SNAPSHOT_INCLUDE,
  })
  if (!booking) return null
  return JSON.stringify(booking, (_key, value) =>
    // Prisma Decimal instances serialize as objects — coerce to number.
    typeof value === 'object' && value !== null && typeof (value as { toNumber?: () => number }).toNumber === 'function'
      ? (value as { toNumber: () => number }).toNumber()
      : value,
  )
}

/** Upsert a BookingVersion row for a specific version number (idempotent). */
export async function snapshotBooking(
  bookingId: string,
  versionNo: number,
  opts: { createdById: string; source: VersionSource; amendmentNote?: string | null },
) {
  const docSnapshot = await serializeBookingSnapshot(bookingId)
  return prisma.bookingVersion.upsert({
    where:  { bookingId_versionNo: { bookingId, versionNo } },
    create: {
      bookingId,
      versionNo,
      source:        opts.source,
      docSnapshot,
      amendmentNote: opts.amendmentNote ?? null,
      createdById:   opts.createdById,
    },
    update: {
      source:        opts.source,
      docSnapshot,
      ...(opts.amendmentNote !== undefined ? { amendmentNote: opts.amendmentNote } : {}),
    },
  })
}

/**
 * Ensure the booking's CURRENT version has a snapshot before it gets
 * overwritten by an incoming amendment. Back-fills legacy bookings created
 * before versioning existed. Call this BEFORE applying the amendment update.
 */
export async function recordAmendmentVersion(
  bookingId: string,
  opts: { createdById: string; source: VersionSource },
) {
  const booking = await prisma.booking.findUnique({
    where:  { id: bookingId },
    select: { version: true },
  })
  if (!booking) return
  const existing = await prisma.bookingVersion.findUnique({
    where:  { bookingId_versionNo: { bookingId, versionNo: booking.version } },
    select: { id: true },
  })
  if (!existing) {
    await snapshotBooking(bookingId, booking.version, {
      createdById: opts.createdById,
      source:      opts.source,
    })
  }
}

/**
 * After an amendment overwrite has been applied, bump the booking's version
 * and snapshot the new state. Call this AFTER replaceBookingChildren /
 * upsertAgenda have run.
 */
export async function bumpVersionAndSnapshot(
  bookingId: string,
  opts: { createdById: string; source: VersionSource; amendmentNote?: string | null },
) {
  const updated = await prisma.booking.update({
    where:  { id: bookingId },
    data:   { version: { increment: 1 } },
    select: { version: true },
  })
  await snapshotBooking(bookingId, updated.version, {
    createdById:   opts.createdById,
    source:        opts.source,
    amendmentNote: opts.amendmentNote ?? null,
  })
  return updated.version
}

/** Write the initial v1 snapshot for a brand-new booking (best-effort). */
export async function snapshotInitialVersion(
  bookingId: string,
  opts: { createdById: string; source: VersionSource },
) {
  await snapshotBooking(bookingId, 1, opts)
}

// Booking core fields restored from a snapshot (everything document-derived,
// excluding identity/relationship/operational fields).
const RESTORABLE_CORE_FIELDS = [
  'agent', 'fileHandler', 'arrivalDate', 'departureDate', 'paxAdults', 'paxChildren',
  'paxInfants', 'quotedTotal', 'currency', 'cancellationDeadline', 'terms', 'exclusions',
  'policyNotes', 'agentBookingId', 'cntlNumber', 'isNumber', 'dealName', 'tourDestination',
  'chauffeurContact', 'languagePreference', 'specialOccasions', 'checkedBy', 'reconfirmBy',
  'agentEmail', 'agentPhone', 'agentWhatsapp', 'agentCountry', 'agentAddress',
  'contactEmail', 'contactPhone', 'contactWhatsapp', 'contactCountry', 'contactAddress',
  'valueAddedServices', 'packageIncludes', 'packageExcludes', 'importantNotes', 'tips',
  'otherNote', 'clientRequest', 'operationCountry',
] as const

type SnapshotShape = Record<string, unknown> & {
  passengers?: Record<string, unknown>[]
  flights?: Record<string, unknown>[]
  accommodations?: Record<string, unknown>[]
  itineraryItems?: Record<string, unknown>[]
  emergencyContacts?: Record<string, unknown>[]
  tourAgenda?: { items?: Record<string, unknown>[] } | null
}

const d = (v: unknown) => (v ? new Date(v as string) : null)

/**
 * Restore (switch active version): re-point the live booking to `versionNo`.
 * Overwrites booking core fields + document-derived children from the snapshot,
 * sets booking.version = versionNo, and leaves PNL/tickets/payments untouched.
 * Immutable snapshots are kept so the user can switch back and forth.
 */
export async function restoreBookingVersion(bookingId: string, versionNo: number) {
  const version = await prisma.bookingVersion.findUnique({
    where: { bookingId_versionNo: { bookingId, versionNo } },
  })
  if (!version?.docSnapshot) {
    throw new Error(`No snapshot found for booking ${bookingId} version ${versionNo}`)
  }
  const snap = JSON.parse(version.docSnapshot) as SnapshotShape

  // Core booking fields to restore.
  const core: Record<string, unknown> = {}
  for (const f of RESTORABLE_CORE_FIELDS) {
    if (!(f in snap)) continue
    core[f] = ['arrivalDate', 'departureDate', 'cancellationDeadline'].includes(f)
      ? d(snap[f])
      : snap[f]
  }

  await prisma.$transaction(async tx => {
    await tx.booking.update({
      where: { id: bookingId },
      data:  { ...core, version: versionNo },
    })

    // Passengers / flights / accommodations / itinerary / emergency contacts.
    await tx.passenger.deleteMany({ where: { bookingId } })
    await tx.flight.deleteMany({ where: { bookingId } })
    await tx.accommodation.deleteMany({ where: { bookingId } })
    await tx.itineraryItem.deleteMany({ where: { bookingId } })
    await tx.emergencyContact.deleteMany({ where: { bookingId } })

    if (snap.passengers?.length) {
      await tx.passenger.createMany({
        data: snap.passengers.map(p => ({
          bookingId,
          name:           String(p.name ?? ''),
          type:           (p.type === 'CHILD' ? 'CHILD' : 'ADULT') as 'ADULT' | 'CHILD',
          isLead:         Boolean(p.isLead),
          age:            (p.age as number | null) ?? null,
          passport:       (p.passport as string | null) ?? null,
          nationality:    (p.nationality as string | null) ?? null,
          contact:        (p.contact as string | null) ?? null,
          mealPreference: (p.mealPreference as string | null) ?? null,
        })),
      })
    }

    if (snap.flights?.length) {
      await tx.flight.createMany({
        data: snap.flights.map(f => ({
          bookingId,
          flightNo: String(f.flightNo ?? ''),
          date:     d(f.date) ?? new Date(),
          fromApt:  String(f.fromApt ?? ''),
          depTime:  String(f.depTime ?? ''),
          toApt:    String(f.toApt ?? ''),
          arrTime:  String(f.arrTime ?? ''),
          airline:  (f.airline as string | null) ?? null,
          notes:    (f.notes as string | null) ?? null,
        })),
      })
    }

    if (snap.accommodations?.length) {
      await tx.accommodation.createMany({
        data: snap.accommodations.map(a => ({
          bookingId,
          hotel:    String(a.hotel ?? ''),
          city:     String(a.city ?? ''),
          checkIn:  d(a.checkIn) ?? new Date(),
          checkOut: d(a.checkOut) ?? new Date(),
          nights:   (a.nights as number) ?? 0,
          roomType: (a.roomType as string | null) ?? null,
          mealType: (a.mealType as string | null) ?? null,
          address:  (a.address as string | null) ?? null,
          contact:  (a.contact as string | null) ?? null,
          // Restoring a snapshot must restore who held the reservation too,
          // otherwise a rollback silently turns own-arrangement stays into
          // company-arranged ones. See `lib/own-arrangement.ts`.
          ownArrangement: (a.ownArrangement as boolean | null) ?? false,
        })),
      })
    }

    if (snap.itineraryItems?.length) {
      await tx.itineraryItem.createMany({
        data: snap.itineraryItems.map(i => ({
          bookingId,
          dayNo:       (i.dayNo as number) ?? 0,
          date:        d(i.date) ?? new Date(),
          title:       String(i.title ?? '').slice(0, 1000),
          description: (i.description as string | null) ?? null,
          inclusions:  (i.inclusions as string | null) ?? null,
          exclusions:  (i.exclusions as string | null) ?? null,
        })),
      })
    }

    if (snap.emergencyContacts?.length) {
      await tx.emergencyContact.createMany({
        data: snap.emergencyContacts.map(ec => ({
          bookingId,
          name:  String(ec.name ?? ''),
          phone: (ec.phone as string | null) ?? null,
          role:  (ec.role as string | null) ?? null,
        })),
      })
    }

    // Agenda items: recreate under the existing (or a new) TourAgenda.
    // Assignments on the current agenda items are dropped (cascade) — same as
    // what a normal amendment does today.
    const agendaItems = snap.tourAgenda?.items ?? []
    let agenda = await tx.tourAgenda.findUnique({ where: { bookingId } })
    if (!agenda && agendaItems.length) {
      agenda = await tx.tourAgenda.create({ data: { bookingId } })
    }
    if (agenda) {
      await tx.agendaItem.deleteMany({ where: { agendaId: agenda.id } })
      if (agendaItems.length) {
        await tx.agendaItem.createMany({
          data: agendaItems.map((it, idx) => ({
            agendaId:    agenda!.id,
            date:        d(it.date) ?? new Date(),
            location:    String(it.location ?? ''),
            fromPoint:   (it.fromPoint as string | null) ?? null,
            toPoint:     (it.toPoint as string | null) ?? null,
            details:     (it.details as string | null) ?? null,
            mealPlan:    (it.mealPlan as string | null) ?? null,
            meetingTime: (it.meetingTime as string | null) ?? null,
            timeFrom:    (it.timeFrom as string | null) ?? null,
            timeTo:      (it.timeTo as string | null) ?? null,
            serviceType: (it.serviceType as string | null) ?? 'OWN_ARRANGEMENT',
            sortOrder:   (it.sortOrder as number) ?? idx,
          })) as never,
        })
      }
    }
  })

  return versionNo
}
