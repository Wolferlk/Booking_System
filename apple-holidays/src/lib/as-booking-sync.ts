/**
 * AppleSystem **full booking sync** — refresh an already-imported booking's
 * *content* from the upstream quotation, in place.
 *
 * The import path (`importMappedBooking`) is idempotent: it short-circuits on a
 * known `bookingRef` and never rewrites it. That is correct for imports, but it
 * means a booking whose dates, pax, hotels or itinerary were amended in
 * AppleSystem after confirmation keeps the old copy forever. The two existing
 * refetch endpoints only rewrite the itinerary or the accommodations; this one
 * refreshes everything the AppleSystem quote actually carries.
 *
 * ── What it will NEVER touch ─────────────────────────────────────────────────
 * Workflow state is ours, not AppleSystem's. A sync must be safe to run on a
 * live file that is already half-operated, so it never writes:
 *
 *   status, version, operationCountry, createdById, clientUserId,
 *   the operation checklist (qcPassedAt, recheckCompletedAt, qcAuto*SentAt,
 *   clientPortalUnlockedAt), hotelOnly*, every cancel* field,
 *   cancellationDeadline, tickets, driver allocations, agenda, P&L, payments,
 *   feedback, and the StatusEvent timeline.
 *
 * It writes a plain activity-log entry, not a StatusEvent — refreshing content
 * is not a workflow transition.
 *
 * ── Non-destructive rules ────────────────────────────────────────────────────
 * "Refresh from upstream" must not become "delete what ops typed in":
 *
 *   • Scalars are only overwritten when AppleSystem sends a non-empty value.
 *     An empty/missing upstream field leaves the stored value exactly as it is,
 *     so a locally-filled agent phone or note can never be blanked by a sync.
 *   • Itinerary and accommodations are replaced (that is the point), but only
 *     when upstream actually returned rows — an empty upstream list is refused,
 *     never applied. Locally-entered columns AppleSystem does not know about
 *     (itinerary inclusions/exclusions, hotel address/contact) are carried
 *     across onto the matching new row.
 *   • Passengers and emergency contacts are only *seeded* when the booking has
 *     none. AppleSystem sends the lead guest name alone, so overwriting a
 *     manually-built pax list with one name would be pure data loss.
 *
 * ── Sync state storage ───────────────────────────────────────────────────────
 * The "last updated from API" marker lives in `system_settings` under
 * `as_sync_state:<bookingRef>` — deliberately **no schema change and no
 * migration**, because the live DB carries drift and must not be pushed to.
 */

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { mapQuoteToBooking, ASMappingError, type MappedBookingInput } from '@/lib/as-booking-map'
import { fetchQuoteForRef, ASLookupError } from '@/lib/as-quote-lookup'
import { logActivity, ACTION } from '@/lib/activity'

// ── Sync state (system_settings KV, one row per booking) ─────────────────────

export const SYNC_STATE_PREFIX = 'as_sync_state:'

export function syncStateKey(bookingRef: string): string {
  return `${SYNC_STATE_PREFIX}${bookingRef}`
}

export interface AsSyncState {
  /** ISO timestamp of the last successful sync. */
  at: string
  /** Display name of whoever ran it, or 'Automatic (pre-arrival)'. */
  by: string
  mode: 'manual' | 'prearrival'
  quotationNo: string | null
  revision: number | null
  /** Field / section names that actually changed on that run. */
  changed: string[]
}

/** Last successful sync for one booking, or null if it has never been synced. */
export async function getSyncState(bookingRef: string): Promise<AsSyncState | null> {
  const row = await prisma.systemSetting.findUnique({ where: { key: syncStateKey(bookingRef) } })
  if (!row) return null
  try {
    const parsed = JSON.parse(row.value) as AsSyncState
    return parsed && typeof parsed.at === 'string' ? parsed : null
  } catch {
    return null
  }
}

/** Last successful sync for many bookings at once, keyed by bookingRef. */
export async function getSyncStates(bookingRefs: string[]): Promise<Record<string, AsSyncState>> {
  if (bookingRefs.length === 0) return {}
  const rows = await prisma.systemSetting.findMany({
    where: { key: { in: bookingRefs.map(syncStateKey) } },
  })
  const out: Record<string, AsSyncState> = {}
  for (const r of rows) {
    const ref = r.key.slice(SYNC_STATE_PREFIX.length)
    try {
      const parsed = JSON.parse(r.value) as AsSyncState
      if (parsed && typeof parsed.at === 'string') out[ref] = parsed
    } catch {
      /* a corrupt marker is not worth failing a page render over */
    }
  }
  return out
}

async function writeSyncState(bookingRef: string, state: AsSyncState): Promise<void> {
  const value = JSON.stringify(state)
  await prisma.systemSetting.upsert({
    where: { key: syncStateKey(bookingRef) },
    update: { value },
    create: { key: syncStateKey(bookingRef), value },
  })
}

// ── Errors ───────────────────────────────────────────────────────────────────

/** A sync that could not proceed. `status` is the HTTP status the API should use. */
export class AsSyncError extends Error {
  constructor(message: string, public status = 500) {
    super(message)
    this.name = 'AsSyncError'
  }
}

// ── Diffing helpers ──────────────────────────────────────────────────────────

function dateOnly(d: Date | string | null | undefined): string | null {
  if (!d) return null
  const dt = typeof d === 'string' ? new Date(d) : d
  return isNaN(dt.getTime()) ? null : dt.toISOString().slice(0, 10)
}

function nonEmpty(v: string | null | undefined): string | null {
  const s = (v ?? '').trim()
  return s || null
}

/** Case/whitespace-insensitive key for matching an upstream row to a stored one. */
function norm(v: string | null | undefined): string {
  return (v ?? '').trim().toLowerCase()
}

/**
 * Do two row sets carry the same content?
 *
 * Compared as sorted signature multisets rather than index-by-index: rows that
 * tie on the stored sort key (two activities on the same day, two hotels
 * checking in the same date) come back from MySQL in an arbitrary order, and an
 * index-wise comparison would call that a change and rewrite an identical
 * itinerary on every single sync.
 */
function sameRows(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  const x = [...a].sort()
  const y = [...b].sort()
  return x.every((v, i) => v === y[i])
}

export interface FieldChange {
  field: string
  from: string | null
  to: string | null
}

export interface SectionChange {
  section: 'itinerary' | 'accommodations' | 'passengers' | 'emergencyContacts'
  previousCount: number
  newCount: number
  /** Set when the section was intentionally left alone, with the reason why. */
  skipped?: string
}

export interface AsSyncResult {
  bookingRef: string
  quotationNo: string | null
  revision: number | null
  /** Scalar fields that changed, with before/after. */
  fields: FieldChange[]
  /** Child-collection outcomes. */
  sections: SectionChange[]
  /** True when nothing at all differed from what we already had. */
  unchanged: boolean
  syncedAt: string
}

// ── Core ─────────────────────────────────────────────────────────────────────

export interface SyncOptions {
  /** User id for the activity log; omitted for automated runs. */
  actorId?: string | null
  /** Display name recorded in the sync marker. */
  actorName: string
  mode: 'manual' | 'prearrival'
}

/**
 * Fetch `bookingRef` from AppleSystem and refresh its content in place.
 *
 * Throws {@link AsSyncError} (with an HTTP status) for every refusal, and only
 * writes once every guard has passed. The scalar update, the itinerary swap and
 * the accommodation swap all happen inside a single transaction, so a booking is
 * never left half-synced.
 */
export async function syncBookingFromAs(
  bookingRef: string,
  opts: SyncOptions,
): Promise<AsSyncResult> {
  const booking = await prisma.booking.findUnique({
    where: { bookingRef },
    select: {
      id: true,
      bookingRef: true,
      isNumber: true,
      cntlNumber: true,
      agentBookingId: true,
      agent: true,
      agentEmail: true,
      fileHandler: true,
      arrivalDate: true,
      departureDate: true,
      paxAdults: true,
      paxChildren: true,
      quotedTotal: true,
      currency: true,
      terms: true,
      packageIncludes: true,
      packageExcludes: true,
      valueAddedServices: true,
      contactEmail: true,
      status: true,
      itineraryItems: {
        orderBy: [{ dayNo: 'asc' }, { date: 'asc' }],
        select: { dayNo: true, date: true, title: true, description: true, inclusions: true, exclusions: true },
      },
      accommodations: {
        orderBy: { checkIn: 'asc' },
        select: {
          city: true, hotel: true, checkIn: true, checkOut: true, nights: true,
          roomType: true, mealType: true, address: true, contact: true, ownArrangement: true,
        },
      },
      passengers: { select: { id: true } },
      emergencyContacts: { select: { id: true } },
    },
  })
  if (!booking) throw new AsSyncError('Booking not found', 404)

  // A cancelled file is a closed record. Refreshing it from upstream would
  // reanimate content nobody is operating on any more.
  if (booking.status === 'CANCELLED') {
    throw new AsSyncError('This booking is cancelled — it is not synced from AppleSystem.', 409)
  }

  // 1. Resolve the ref back to its AppleSystem quote (IS number wins, ref is the
  //    fallback — same resolution the refetch and raw endpoints use).
  const lookupRef = nonEmpty(booking.isNumber) || booking.bookingRef
  let quote
  let row
  try {
    ;({ quote, row } = await fetchQuoteForRef(lookupRef))
  } catch (err) {
    if (err instanceof ASLookupError) throw new AsSyncError(err.message, 404)
    throw new AsSyncError(err instanceof Error ? err.message : 'Failed to reach AppleSystem', 502)
  }

  // 2. Map with the current mapper.
  let mapped: MappedBookingInput
  try {
    mapped = mapQuoteToBooking(quote as unknown as Record<string, unknown>, {
      fallbackIsNumber: row.is_number ?? booking.bookingRef,
    })
  } catch (err) {
    if (err instanceof ASMappingError) throw new AsSyncError(err.message, 422)
    throw new AsSyncError(
      err instanceof Error ? err.message : 'Could not map the AppleSystem quotation',
      500,
    )
  }

  // 3. Refuse to write another booking's quote onto this record. Without this a
  //    fuzzy IS-number match could overwrite a live file wholesale.
  if (mapped.bookingRef !== booking.bookingRef) {
    throw new AsSyncError(
      `AppleSystem returned quotation ${mapped.bookingRef}, which does not match this booking (${booking.bookingRef}). Nothing was changed.`,
      409,
    )
  }

  // ── Scalars: only overwrite when upstream actually sent something ──────────
  const fields: FieldChange[] = []
  // Built dynamically — only the fields upstream actually sent land in here, so
  // it is assembled untyped and asserted into the update shape at the call site.
  const data: Record<string, unknown> = {}

  function setText(field: string, current: string | null, incoming: string | null) {
    const next = nonEmpty(incoming)
    if (next === null) return                       // upstream blank → keep ours
    if (norm(current) === norm(next)) return
    data[field] = next
    fields.push({ field, from: nonEmpty(current), to: next })
  }

  /**
   * Fill a field from upstream only while ours is still empty.
   *
   * Used for the agent reference and agent email: both are routinely typed in
   * by ops on the booking page, and AppleSystem is not authoritative for them.
   * A plain `setText` here would silently overwrite a hand-entered agent ref on
   * the next sync, so upstream may seed these fields but never replace them.
   */
  function fillText(field: string, current: string | null, incoming: string | null) {
    if (nonEmpty(current) !== null) return          // ours wins once set
    const next = nonEmpty(incoming)
    if (next === null) return
    data[field] = next
    fields.push({ field, from: null, to: next })
  }

  function setDate(field: string, current: Date, incoming: string) {
    const next = dateOnly(incoming)
    if (!next) return
    const cur = dateOnly(current)
    if (cur === next) return
    data[field] = new Date(next)
    fields.push({ field, from: cur, to: next })
  }

  function setInt(field: string, current: number, incoming: number) {
    // A zero pax count from upstream is treated as "not sent" rather than as an
    // instruction to zero out a booking that has passengers.
    if (!Number.isFinite(incoming) || incoming <= 0) return
    if (current === incoming) return
    data[field] = incoming
    fields.push({ field, from: String(current), to: String(incoming) })
  }

  setText('isNumber', booking.isNumber, mapped.isNumber)
  setText('cntlNumber', booking.cntlNumber, mapped.cntlNumber)
  setText('agent', booking.agent, mapped.agent)
  fillText('agentBookingId', booking.agentBookingId, mapped.agentBookingId)
  fillText('agentEmail', booking.agentEmail, mapped.agentEmail)
  setText('fileHandler', booking.fileHandler, mapped.fileHandler)
  setDate('arrivalDate', booking.arrivalDate, mapped.arrivalDate)
  setDate('departureDate', booking.departureDate, mapped.departureDate)
  setInt('paxAdults', booking.paxAdults, mapped.paxAdults)
  // Children legitimately go to zero, so it is compared as a plain number — but
  // only when upstream sent a usable adult count, i.e. a real pax block.
  if (mapped.paxAdults > 0 && booking.paxChildren !== mapped.paxChildren) {
    data.paxChildren = mapped.paxChildren
    fields.push({ field: 'paxChildren', from: String(booking.paxChildren), to: String(mapped.paxChildren) })
  }
  if (mapped.quotedTotal != null && Number.isFinite(mapped.quotedTotal)) {
    const cur = booking.quotedTotal == null ? null : Number(booking.quotedTotal)
    if (cur === null || Math.abs(cur - mapped.quotedTotal) > 0.004) {
      data.quotedTotal = mapped.quotedTotal
      fields.push({ field: 'quotedTotal', from: cur === null ? null : cur.toFixed(2), to: mapped.quotedTotal.toFixed(2) })
    }
  }
  setText('currency', booking.currency, mapped.currency)
  setText('terms', booking.terms, mapped.terms)
  setText('packageIncludes', booking.packageIncludes, mapped.packageIncludes)
  setText('packageExcludes', booking.packageExcludes, mapped.packageExcludes)
  setText('valueAddedServices', booking.valueAddedServices, mapped.valueAddedServices)
  setText('contactEmail', booking.contactEmail, mapped.contactEmail)

  // ── Itinerary ─────────────────────────────────────────────────────────────
  const sections: SectionChange[] = []
  const prevItin = booking.itineraryItems.map((i) => ({
    dayNo: i.dayNo,
    date: dateOnly(i.date) ?? '',
    title: i.title,
    description: i.description,
    inclusions: i.inclusions,
    exclusions: i.exclusions,
  }))

  // Carry locally-entered inclusions/exclusions onto the matching new row —
  // AppleSystem does not send them, so a plain replace would drop them.
  const itinExtras = new Map<string, { inclusions: string | null; exclusions: string | null }>()
  for (const p of prevItin) {
    if (p.inclusions || p.exclusions) {
      itinExtras.set(`${p.dayNo}|${p.date}|${norm(p.title)}`, {
        inclusions: p.inclusions,
        exclusions: p.exclusions,
      })
    }
  }

  const itinSig = (i: { dayNo: number; date: string; title: string; description?: string | null }) =>
    [i.dayNo, i.date, norm(i.title), norm(i.description)].join('\u0000')

  const itinChanged =
    mapped.itineraryItems.length > 0 &&
    !sameRows(prevItin.map(itinSig), mapped.itineraryItems.map(itinSig))

  if (mapped.itineraryItems.length === 0) {
    sections.push({
      section: 'itinerary',
      previousCount: prevItin.length,
      newCount: prevItin.length,
      skipped: 'AppleSystem returned no itinerary — the stored one was kept.',
    })
  } else {
    sections.push({
      section: 'itinerary',
      previousCount: prevItin.length,
      newCount: mapped.itineraryItems.length,
      ...(itinChanged ? {} : { skipped: 'Already identical to AppleSystem.' }),
    })
  }

  // ── Accommodations ────────────────────────────────────────────────────────
  const prevAcc = booking.accommodations.map((a) => ({
    city: a.city,
    hotel: a.hotel,
    checkIn: dateOnly(a.checkIn) ?? '',
    checkOut: dateOnly(a.checkOut) ?? '',
    nights: a.nights,
    roomType: a.roomType,
    mealType: a.mealType,
    address: a.address,
    contact: a.contact,
    ownArrangement: a.ownArrangement,
  }))

  // Same idea as the itinerary: address/contact are ops-entered, keep them.
  const accExtras = new Map<string, { address: string | null; contact: string | null }>()
  for (const p of prevAcc) {
    if (p.address || p.contact) {
      accExtras.set(`${p.checkIn}|${norm(p.hotel)}`, { address: p.address, contact: p.contact })
    }
  }

  const accSig = (a: {
    city: string; hotel: string; checkIn: string; checkOut: string; nights: number
    roomType?: string | null; mealType?: string | null; ownArrangement: boolean
  }) => [
    norm(a.hotel), norm(a.city), a.checkIn, a.checkOut, a.nights,
    norm(a.roomType), norm(a.mealType), a.ownArrangement ? '1' : '0',
  ].join('\u0000')

  const accChanged =
    mapped.accommodations.length > 0 &&
    !sameRows(prevAcc.map(accSig), mapped.accommodations.map(accSig))

  if (mapped.accommodations.length === 0) {
    sections.push({
      section: 'accommodations',
      previousCount: prevAcc.length,
      newCount: prevAcc.length,
      skipped: 'AppleSystem returned no accommodations — the stored ones were kept.',
    })
  } else {
    sections.push({
      section: 'accommodations',
      previousCount: prevAcc.length,
      newCount: mapped.accommodations.length,
      ...(accChanged ? {} : { skipped: 'Already identical to AppleSystem.' }),
    })
  }

  // ── Passengers / emergency contacts: seed only ────────────────────────────
  const seedPassengers = booking.passengers.length === 0 && mapped.passengers.length > 0
  sections.push({
    section: 'passengers',
    previousCount: booking.passengers.length,
    newCount: seedPassengers ? mapped.passengers.length : booking.passengers.length,
    ...(seedPassengers
      ? {}
      : {
          skipped: booking.passengers.length
            ? 'Kept — AppleSystem only sends the lead guest, so an existing pax list is never replaced.'
            : 'AppleSystem sent no guest name.',
        }),
  })

  const seedEmergency = booking.emergencyContacts.length === 0 && mapped.emergencyContacts.length > 0
  sections.push({
    section: 'emergencyContacts',
    previousCount: booking.emergencyContacts.length,
    newCount: seedEmergency ? mapped.emergencyContacts.length : booking.emergencyContacts.length,
    ...(seedEmergency
      ? {}
      : {
          skipped: booking.emergencyContacts.length
            ? 'Kept — existing emergency contacts are never replaced.'
            : 'AppleSystem sent no emergency contact.',
        }),
  })

  // ── Write ─────────────────────────────────────────────────────────────────
  const ops: Prisma.PrismaPromise<unknown>[] = []

  if (Object.keys(data).length > 0) {
    // `updatedAt` is @updatedAt, so the row's own timestamp moves too.
    ops.push(prisma.booking.update({
      where: { id: booking.id },
      data: data as Prisma.BookingUpdateInput,
    }))
  }

  if (itinChanged) {
    ops.push(prisma.itineraryItem.deleteMany({ where: { bookingId: booking.id } }))
    ops.push(
      prisma.itineraryItem.createMany({
        data: mapped.itineraryItems.map((i) => {
          const extra = itinExtras.get(`${i.dayNo}|${i.date}|${norm(i.title)}`)
          return {
            bookingId: booking.id,
            dayNo: i.dayNo,
            date: new Date(i.date),
            title: i.title,
            description: i.description || null,
            inclusions: extra?.inclusions ?? null,
            exclusions: extra?.exclusions ?? null,
          }
        }),
      }),
    )
  }

  if (accChanged) {
    ops.push(prisma.accommodation.deleteMany({ where: { bookingId: booking.id } }))
    ops.push(
      prisma.accommodation.createMany({
        data: mapped.accommodations.map((a) => {
          const extra = accExtras.get(`${a.checkIn}|${norm(a.hotel)}`)
          return {
            bookingId: booking.id,
            city: a.city,
            hotel: a.hotel,
            checkIn: new Date(a.checkIn),
            checkOut: new Date(a.checkOut),
            nights: a.nights,
            roomType: a.roomType,
            mealType: a.mealType,
            address: extra?.address ?? (a.address || null),
            contact: extra?.contact ?? null,
            ownArrangement: a.ownArrangement,
          }
        }),
      }),
    )
  }

  if (seedPassengers) {
    ops.push(
      prisma.passenger.createMany({
        data: mapped.passengers.map((p) => ({
          bookingId: booking.id,
          name: p.name,
          // The local enum has no INFANT member; the mapper only ever emits
          // ADULT for the lead guest, so this is a total mapping either way.
          type: p.type === 'CHILD' ? 'CHILD' : 'ADULT',
          age: p.age,
          isLead: p.isLead,
          passport: p.passport || null,
          nationality: p.nationality || null,
        })),
      }),
    )
  }

  if (seedEmergency) {
    ops.push(
      prisma.emergencyContact.createMany({
        data: mapped.emergencyContacts.map((e) => ({
          bookingId: booking.id,
          name: e.name,
          phone: e.phone || null,
          role: e.role || null,
        })),
      }),
    )
  }

  if (ops.length > 0) await prisma.$transaction(ops)

  // ── Marker + audit trail ──────────────────────────────────────────────────
  const changed = [
    ...fields.map((f) => f.field),
    ...(itinChanged ? ['itinerary'] : []),
    ...(accChanged ? ['accommodations'] : []),
    ...(seedPassengers ? ['passengers'] : []),
    ...(seedEmergency ? ['emergencyContacts'] : []),
  ]
  const syncedAt = new Date().toISOString()

  await writeSyncState(booking.bookingRef, {
    at: syncedAt,
    by: opts.actorName,
    mode: opts.mode,
    quotationNo: nonEmpty(row.quotation_no),
    revision: mapped.source.revision,
    changed,
  })

  // Activity log, never a StatusEvent — the status timeline is the append-only
  // record of workflow transitions, and a content refresh is not one.
  if (changed.length > 0 && opts.actorId) {
    await logActivity({
      userId: opts.actorId,
      action: ACTION.BOOKING_UPDATED,
      entityType: 'Booking',
      entityId: booking.id,
      details: {
        op: 'as_full_sync',
        mode: opts.mode,
        bookingRef: booking.bookingRef,
        quotationNo: row.quotation_no,
        fields,
        itinerary: itinChanged ? { previous: prevItin, created: mapped.itineraryItems.length } : null,
        accommodations: accChanged ? { previous: prevAcc, created: mapped.accommodations.length } : null,
        seededPassengers: seedPassengers ? mapped.passengers.length : 0,
        seededEmergencyContacts: seedEmergency ? mapped.emergencyContacts.length : 0,
      },
    }).catch((err) => {
      console.error('[as-sync] activity log failed:', err instanceof Error ? err.message : err)
    })
  }

  return {
    bookingRef: booking.bookingRef,
    quotationNo: nonEmpty(row.quotation_no),
    revision: mapped.source.revision,
    fields,
    sections,
    unchanged: changed.length === 0,
    syncedAt,
  }
}
