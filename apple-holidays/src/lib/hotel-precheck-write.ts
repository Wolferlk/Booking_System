/**
 * Pre-checking write path — reconfirmation records and hotel profiles.
 *
 * Two invariants hold everywhere in this module:
 *
 *  1. A `hotel_reconfirmations` row materialises lazily. Browsing the queue
 *     writes nothing; the row appears the first time a person records
 *     something about the stay, seeded from the live booking data.
 *  2. Every change appends a `hotel_reconfirmation_events` row. That table is
 *     never updated and never deleted from — it is the evidence of who spoke
 *     to which hotel, when, and on what channel.
 *
 * The Accounts master list (`invoice_processor.hotel_details`) is never
 * written to from here. See `accounts-hotels-db.ts`.
 */
import type { HotelConfirmStatus, HotelContactKind, HotelProfileSource, Prisma } from '@prisma/client'
import { prisma } from './prisma'
import { normalizeHotelName } from './hotel-match'
import { buildStayKey, daysBetween } from './hotel-precheck'
import { normalizePhone } from './hotel-contact'

export interface Actor {
  name?: string | null
  email?: string | null
}

function actorLabel(a: Actor): string | null {
  return a.name?.trim() || a.email?.trim() || null
}

// ─── Reconfirmation records ──────────────────────────────────────────────────

/**
 * Find the reconfirmation row for a stay, creating it from the live
 * accommodation if it does not exist yet.
 *
 * Seeding reads the booking rather than trusting the client: the caller sends
 * a stay key, and the room/pax/date defaults come from the database so a stale
 * browser tab can never write yesterday's itinerary back over an amendment.
 */
export async function ensureReconfirmation(stayKey: string, actor: Actor) {
  const existing = await prisma.hotelReconfirmation.findUnique({ where: { stayKey } })
  if (existing) return existing

  const [bookingRef, normHotel, checkInKey] = stayKey.split('::')
  if (!bookingRef || !checkInKey) throw new Error(`Malformed stay key: ${stayKey}`)

  const booking = await prisma.booking.findUnique({
    where: { bookingRef },
    select: {
      bookingRef: true, paxAdults: true, paxChildren: true, paxInfants: true,
      accommodations: {
        select: {
          id: true, hotel: true, city: true, checkIn: true, checkOut: true,
          nights: true, roomType: true, mealType: true, ownArrangement: true,
        },
      },
    },
  })
  if (!booking) throw new Error(`Booking ${bookingRef} not found`)

  const accom = booking.accommodations.find(
    a => normalizeHotelName(a.hotel) === normHotel &&
         a.checkIn.toISOString().slice(0, 10) === checkInKey,
  )
  if (!accom) throw new Error(`No hotel stay on ${bookingRef} matches this key — the booking may have been amended.`)

  // An exact-name hotel profile is a certain match; link it straight away.
  const profile = await prisma.hotelProfile.findUnique({
    where: { normalizedName: normalizeHotelName(accom.hotel) },
    select: { id: true },
  })

  const created = await prisma.hotelReconfirmation.create({
    data: {
      stayKey,
      bookingRef: booking.bookingRef,
      accommodationId: accom.id,
      hotelProfileId: profile?.id ?? null,
      hotelName: accom.hotel,
      city: accom.city,
      checkIn: accom.checkIn,
      checkOut: accom.checkOut,
      nights: accom.nights || Math.max(0, daysBetween(accom.checkIn, accom.checkOut)),
      roomType: accom.roomType,
      mealType: accom.mealType,
      adults: booking.paxAdults,
      children: booking.paxChildren,
      infants: booking.paxInfants,
      status: accom.ownArrangement ? 'NOT_REQUIRED' : 'PENDING',
      createdBy: actorLabel(actor),
      updatedBy: actorLabel(actor),
    },
  })

  await logEvent(created.id, {
    action: 'created',
    toStatus: created.status,
    note: 'Reconfirmation record opened',
    actor,
  })

  return created
}

/** Append one immutable audit event. Never throws into the caller's flow. */
export async function logEvent(
  reconfirmId: string,
  e: { action: string; fromStatus?: string | null; toStatus?: string | null; channel?: string | null; note?: string | null; actor: Actor },
) {
  try {
    await prisma.hotelReconfirmationEvent.create({
      data: {
        reconfirmId,
        action: e.action,
        fromStatus: e.fromStatus ?? null,
        toStatus: e.toStatus ?? null,
        channel: e.channel ?? null,
        note: e.note ?? null,
        actorName: e.actor.name ?? null,
        actorEmail: e.actor.email ?? null,
      },
    })
  } catch (err) {
    console.warn('[precheck] event log failed:', (err as Error).message)
  }
}

/** Fields a user may edit on a stay. Everything else is derived or audited. */
export interface ReconfirmPatch {
  status?: HotelConfirmStatus
  confirmationNumber?: string | null
  roomType?: string | null
  roomCategory?: string | null
  roomCount?: number | null
  mealType?: string | null
  adults?: number | null
  children?: number | null
  cwb?: number | null
  cnb?: number | null
  infants?: number | null
  lastChannel?: string | null
  dueAtOverride?: Date | null
  followUpAt?: Date | null
  discrepancyNote?: string | null
  notes?: string | null
  /** Free-text note recorded against this edit in the audit trail. */
  eventNote?: string | null
  /** Stamp lastCheckedAt/By and bump the attempt counter. */
  markChecked?: boolean
}

/**
 * Apply an edit to a stay, materialising the record if needed.
 *
 * A status change and a plain field edit are logged as distinct actions so the
 * timeline reads as a conversation history rather than a diff dump.
 */
export async function updateReconfirmation(stayKey: string, patch: ReconfirmPatch, actor: Actor) {
  const current = await ensureReconfirmation(stayKey, actor)

  const data: Prisma.HotelReconfirmationUpdateInput = { updatedBy: actorLabel(actor) }
  const touched: string[] = []

  const assign = <K extends keyof ReconfirmPatch>(key: K, field: keyof Prisma.HotelReconfirmationUpdateInput) => {
    if (patch[key] === undefined) return
    ;(data as Record<string, unknown>)[field as string] = patch[key]
    touched.push(String(key))
  }

  assign('confirmationNumber', 'confirmationNumber')
  assign('roomType', 'roomType')
  assign('roomCategory', 'roomCategory')
  assign('roomCount', 'roomCount')
  assign('mealType', 'mealType')
  assign('adults', 'adults')
  assign('children', 'children')
  assign('cwb', 'cwb')
  assign('cnb', 'cnb')
  assign('infants', 'infants')
  assign('lastChannel', 'lastChannel')
  assign('dueAtOverride', 'dueAtOverride')
  assign('followUpAt', 'followUpAt')
  assign('discrepancyNote', 'discrepancyNote')
  assign('notes', 'notes')

  const statusChanged = patch.status !== undefined && patch.status !== current.status
  if (patch.status !== undefined) data.status = patch.status

  if (patch.markChecked) {
    data.lastCheckedAt = new Date()
    data.lastCheckedBy = actorLabel(actor)
    data.attempts = { increment: 1 }
  }

  const updated = await prisma.hotelReconfirmation.update({ where: { id: current.id }, data })

  if (statusChanged) {
    await logEvent(current.id, {
      action: 'status_change',
      fromStatus: current.status,
      toStatus: updated.status,
      channel: patch.lastChannel ?? null,
      note: patch.eventNote ?? null,
      actor,
    })
  }
  if (patch.markChecked) {
    await logEvent(current.id, {
      action: 'checked',
      toStatus: updated.status,
      channel: patch.lastChannel ?? null,
      note: patch.eventNote ?? (statusChanged ? null : 'Hotel contacted'),
      actor,
    })
  }
  if (touched.length > 0 && !statusChanged && !patch.markChecked) {
    await logEvent(current.id, {
      action: 'edited',
      note: patch.eventNote ?? `Updated ${touched.join(', ')}`,
      actor,
    })
  }

  return updated
}

/** Link (or, with `null`, unlink) a stay to a hotel profile. */
export async function linkStayToHotel(stayKey: string, hotelProfileId: string | null, actor: Actor) {
  const current = await ensureReconfirmation(stayKey, actor)
  const updated = await prisma.hotelReconfirmation.update({
    where: { id: current.id },
    data: { hotelProfileId, updatedBy: actorLabel(actor) },
  })

  let name: string | null = null
  if (hotelProfileId) {
    name = (await prisma.hotelProfile.findUnique({
      where: { id: hotelProfileId }, select: { name: true },
    }))?.name ?? null
  }

  await logEvent(current.id, {
    action: hotelProfileId ? 'linked' : 'unlinked',
    note: hotelProfileId ? `Linked to hotel "${name ?? hotelProfileId}"` : 'Hotel link removed',
    actor,
  })

  return updated
}

// ─── Hotel profiles ──────────────────────────────────────────────────────────

export interface HotelProfileInput {
  name: string
  city?: string | null
  countryCode?: string
  accountsHotelId?: number | null
  accountsHotelName?: string | null
  address?: string | null
  website?: string | null
  phone?: string | null
  email?: string | null
  whatsapp?: string | null
  whatsappVerified?: boolean
  googleMapsUrl?: string | null
  source?: HotelProfileSource
  notes?: string | null
  aiResearch?: Prisma.InputJsonValue
}

/**
 * Create or update a hotel profile, keyed on the normalised name.
 *
 * Upsert rather than create because two staff working two bookings will
 * inevitably add the same hotel minutes apart; the unique `normalizedName`
 * makes the second one an edit instead of a duplicate.
 */
export async function saveHotelProfile(input: HotelProfileInput, actor: Actor) {
  const normalizedName = normalizeHotelName(input.name)
  if (!normalizedName) throw new Error('A hotel name is required')

  const cc = (input.countryCode ?? 'LK').toUpperCase().slice(0, 2)
  const whatsapp = input.whatsapp ? (normalizePhone(input.whatsapp, cc).e164 ?? input.whatsapp) : input.whatsapp

  const shared = {
    name: input.name.trim(),
    city: input.city ?? undefined,
    countryCode: cc,
    accountsHotelId: input.accountsHotelId ?? undefined,
    accountsHotelName: input.accountsHotelName ?? undefined,
    address: input.address ?? undefined,
    website: input.website ?? undefined,
    phone: input.phone ?? undefined,
    email: input.email ?? undefined,
    whatsapp: whatsapp ?? undefined,
    whatsappVerified: input.whatsappVerified ?? undefined,
    googleMapsUrl: input.googleMapsUrl ?? undefined,
    notes: input.notes ?? undefined,
    ...(input.aiResearch !== undefined
      ? { aiResearch: input.aiResearch, aiResearchedAt: new Date() }
      : {}),
  }

  return prisma.hotelProfile.upsert({
    where: { normalizedName },
    create: {
      ...shared,
      normalizedName,
      source: input.source ?? 'MANUAL',
      createdBy: actorLabel(actor),
      updatedBy: actorLabel(actor),
    },
    update: {
      ...shared,
      // `source` records where a profile *originated* — an edit never rewrites it.
      updatedBy: actorLabel(actor),
    },
    include: { channels: true },
  })
}

export interface ContactChannelInput {
  kind: HotelContactKind
  label?: string | null
  value: string
  isPrimary?: boolean
  verified?: boolean
  guessed?: boolean
  notes?: string | null
}

/**
 * Add a contact channel to a hotel.
 *
 * Numbers are normalised to E.164 and deduplicated on it, so "077 123 4567"
 * added twice in two different spellings does not become two rows. Promoting a
 * channel to primary demotes the previous primary of the same kind in the same
 * transaction — two primaries would make the "which number do I ring" question
 * ambiguous again.
 */
export async function addContactChannel(hotelId: string, input: ContactChannelInput, actor: Actor) {
  const hotel = await prisma.hotelProfile.findUnique({
    where: { id: hotelId },
    select: { countryCode: true },
  })
  if (!hotel) throw new Error('Hotel profile not found')

  const value = input.value.trim()
  if (!value) throw new Error('A contact value is required')

  const isNumber = input.kind !== 'EMAIL'
  const e164 = isNumber ? normalizePhone(value, hotel.countryCode).e164 : null

  const duplicate = await prisma.hotelContactChannel.findFirst({
    where: {
      hotelId,
      kind: input.kind,
      ...(e164 ? { e164 } : { value }),
    },
  })

  return prisma.$transaction(async tx => {
    if (input.isPrimary) {
      await tx.hotelContactChannel.updateMany({
        where: { hotelId, kind: input.kind, isPrimary: true },
        data: { isPrimary: false },
      })
    }

    const data = {
      kind: input.kind,
      label: input.label ?? null,
      value,
      e164,
      isPrimary: input.isPrimary ?? false,
      verified: input.verified ?? false,
      guessed: input.guessed ?? false,
      notes: input.notes ?? null,
      ...(input.verified ? { verifiedAt: new Date(), verifiedBy: actorLabel(actor) } : {}),
    }

    const channel = duplicate
      ? await tx.hotelContactChannel.update({ where: { id: duplicate.id }, data })
      : await tx.hotelContactChannel.create({ data: { ...data, hotelId, createdBy: actorLabel(actor) } })

    await syncPrimaryFields(tx, hotelId)
    return channel
  })
}

/** Mark a channel verified/unverified, or edit it in place. */
export async function updateContactChannel(
  channelId: string,
  patch: { label?: string | null; value?: string; verified?: boolean; isPrimary?: boolean; notes?: string | null },
  actor: Actor,
) {
  const existing = await prisma.hotelContactChannel.findUnique({
    where: { id: channelId },
    include: { hotel: { select: { id: true, countryCode: true } } },
  })
  if (!existing) throw new Error('Contact not found')

  return prisma.$transaction(async tx => {
    if (patch.isPrimary) {
      await tx.hotelContactChannel.updateMany({
        where: { hotelId: existing.hotelId, kind: existing.kind, isPrimary: true },
        data: { isPrimary: false },
      })
    }

    const value = patch.value?.trim()
    const channel = await tx.hotelContactChannel.update({
      where: { id: channelId },
      data: {
        ...(patch.label !== undefined ? { label: patch.label } : {}),
        ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
        ...(patch.isPrimary !== undefined ? { isPrimary: patch.isPrimary } : {}),
        ...(value
          ? {
              value,
              e164: existing.kind === 'EMAIL' ? null : normalizePhone(value, existing.hotel.countryCode).e164,
            }
          : {}),
        ...(patch.verified !== undefined
          ? {
              verified: patch.verified,
              // Verifying is a human act; it also clears the "guessed" flag.
              ...(patch.verified
                ? { guessed: false, verifiedAt: new Date(), verifiedBy: actorLabel(actor) }
                : { verifiedAt: null, verifiedBy: null }),
            }
          : {}),
      },
    })

    await syncPrimaryFields(tx, existing.hotelId)
    return channel
  })
}

/** Remove a contact channel. */
export async function deleteContactChannel(channelId: string) {
  const existing = await prisma.hotelContactChannel.findUnique({
    where: { id: channelId },
    select: { hotelId: true },
  })
  if (!existing) return
  await prisma.$transaction(async tx => {
    await tx.hotelContactChannel.delete({ where: { id: channelId } })
    await syncPrimaryFields(tx, existing.hotelId)
  })
}

/**
 * Mirror the primary phone / WhatsApp / email onto the profile row.
 *
 * The denormalised columns exist so a 500-row queue can render contact state
 * without joining the channel table for every stay; this keeps them honest
 * after any channel change.
 */
async function syncPrimaryFields(tx: Prisma.TransactionClient, hotelId: string) {
  const channels = await tx.hotelContactChannel.findMany({
    where: { hotelId },
    orderBy: [{ isPrimary: 'desc' }, { verified: 'desc' }, { createdAt: 'asc' }],
  })

  const pick = (kinds: HotelContactKind[]) =>
    channels.find(c => kinds.includes(c.kind))

  const wa = pick(['WHATSAPP'])
  const phone = pick(['PHONE', 'MOBILE']) ?? wa
  const email = pick(['EMAIL'])

  await tx.hotelProfile.update({
    where: { id: hotelId },
    data: {
      phone: phone ? (phone.e164 ?? phone.value) : null,
      whatsapp: wa ? (wa.e164 ?? wa.value) : null,
      whatsappVerified: wa ? wa.verified : false,
      email: email ? email.value : null,
    },
  })
}
