/**
 * WhatsApp chat groups: reads, trip material sends, and the automation sweep.
 *
 * A chat group belongs to one booking and holds many contacts. It sends the
 * messages the booking pages already send, so guests get the same daily plan and
 * the same PDFs whichever screen triggered them. Trip materials go to the guest
 * and family in the group, not to drivers, guides or agents. In a real WhatsApp
 * group there is one shared audience, so they go to the whole group.
 *
 * "Already sent" is read from whatsapp_messages, not from wa_group_sends, so it
 * also sees sends from the booking page and the global daily plan, and it carries
 * Meta's delivered/read/failed status.
 */
import { createHash } from 'crypto'
import type { OperationCountry, Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { buildApiError } from '@/lib/utils'
import { briefingDayLabel, normalisePhone, whatsappInboxCountry, WHATSAPP_STAFF_ROLES } from '@/lib/whatsapp'
import {
  SETTING_BRIEFING_TIME_PREFIX, TAG_DAILY_BRIEFING,
  addDays, briefingTargetsSameDay, briefingTimezone, contactPhone, deliverToGuest, liveBookingWhere,
  normaliseBriefingTime, nowInTz, sendDailyBriefingForBooking, timeToMinutes,
} from '@/lib/customer-whatsapp-automation'
import { buildBookingPdf } from '@/lib/booking-whatsapp-delivery'
import {
  BOOKING_DETAILS_BODY, BOOKING_DOCS_TAG, bookingDetailsParams, paxLabel, readBookingFacts, renderBody, sendBookingDocTemplate,
} from '@/lib/booking-details-template'
import { listVersionLinks } from '@/lib/b2c-version-links'
import { syncDeliveryReceipts } from '@/lib/whatsapp-shared-inbox-sync'
import { sendRealGroupDocument, sendRealGroupText } from './meta-groups'
import { formatDriverDetails, formatFlightDetails, formatHotelDetails, formatItinerary, type DriverLine } from './messages'
import {
  SETUP_NEEDED_ERROR, isGroupColor, isGroupKind, isParticipantRole,
  type ContactSuggestion, type GroupActivity, type GroupCandidate, type GroupChannel, type GroupColor, type GroupCoverage,
  type GroupDetail, type GroupKind, type GroupMember, type GroupMode, type GroupParticipant, type GroupSendOutcome,
  type GroupSummary, type GuestBrief,
} from './shared'

/** Same roles as the booking page's customer WhatsApp panel. */
const MANAGE_ROLES = ['BT_USER', 'GT_USER', 'GT_VN_USER', 'TE_USER', 'GT_TE_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN']

export const canViewGroups = (role: string) => (WHATSAPP_STAFF_ROLES as readonly string[]).includes(role)
export const canManageGroups = (role: string) => MANAGE_ROLES.includes(role)

const TRIP_TAGS = {
  flights: '[TRIP-FLIGHTS]', hotels: '[TRIP-HOTELS]', itinerary: '[TRIP-ITINERARY]', driver: '[TRIP-DRIVER]',
} as const

const DOC_LABELS = { day7: 'Tour Confirmation (PDF)', day3: 'Full Tour Details & Vouchers (PDF)' } as const

const COVERAGE_LOOKBACK_DAYS = 120
/** A message that did not reach the guest does not count as sent. */
const UNDELIVERED = new Set(['failed', 'retried'])

/** How long after its set time an automatic send may still go out. */
const AUTO_WINDOW_MINUTES = 240
const AUTO_DOCS_PER_RUN = 6
const AUTO_RUN_BUDGET_MS = 200_000

export function groupsErrorResponse(err: unknown) {
  if ((err as { code?: string })?.code === 'P2021') return buildApiError(SETUP_NEEDED_ERROR, 503)
  console.error('[WaGroups]', err)
  return buildApiError(err instanceof Error ? err.message.slice(0, 200) : 'Something went wrong', 500)
}

const isoDay = (d: Date) => d.toISOString().slice(0, 10)
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000)

/** Movements that need a driver, as the QC check counts them. */
function driverAllocation(items: { serviceType: string | null; assignment: { driverId: string | null; driverName: string | null } | null }[]) {
  const need = items.filter(i => i.serviceType !== 'OWN_ARRANGEMENT')
  return { driverItems: need.length, driversAssigned: need.filter(i => i.assignment?.driverId || i.assignment?.driverName?.trim()).length }
}

// ── Access ───────────────────────────────────────────────────────────────────

/**
 * The Vietnam desk sees a group only when every booking in it is Vietnamese, the
 * same line the inbox draws, so no other country's guests leak through a group.
 */
function allowedForCountry(country: OperationCountry | null, memberCountries: (OperationCountry | null)[]) {
  return !country || memberCountries.every(c => c === country)
}

export async function accessibleGroup(id: string, role: string) {
  const group = await prisma.waBookingGroup.findFirst({ where: { id, archivedAt: null } })
  if (!group) return null
  const country = whatsappInboxCountry(role)
  if (!country) return group
  const members = await prisma.waBookingGroupMember.findMany({ where: { groupId: id }, select: { bookingRef: true } })
  const bookings = await prisma.booking.findMany({
    where: { bookingRef: { in: members.map(m => m.bookingRef) } }, select: { operationCountry: true },
  })
  return allowedForCountry(country, bookings.map(b => b.operationCountry)) ? group : null
}

// ── Reads ────────────────────────────────────────────────────────────────────

export async function listGroups(role: string): Promise<GroupSummary[]> {
  const groups = await prisma.waBookingGroup.findMany({ where: { archivedAt: null }, orderBy: { createdAt: 'desc' } })
  if (groups.length === 0) return []
  const ids = groups.map(g => g.id)
  const [members, participants, channels, lines] = await Promise.all([
    prisma.waBookingGroupMember.findMany({ where: { groupId: { in: ids } }, select: { groupId: true, bookingRef: true } }),
    prisma.waGroupParticipant.findMany({ where: { groupId: { in: ids }, removedAt: null }, select: { groupId: true, phone: true, createdAt: true } }),
    prisma.waGroupChannel.findMany({ where: { groupId: { in: ids } }, select: { groupId: true, mode: true } }),
    prisma.waGroupMessage.findMany({
      where: { groupId: { in: ids } }, orderBy: { createdAt: 'desc' }, take: 500,
      select: { groupId: true, body: true, createdAt: true, kind: true },
    }),
  ])
  const bookings = await prisma.booking.findMany({
    where:  { bookingRef: { in: Array.from(new Set(members.map(m => m.bookingRef))) } },
    select: { bookingRef: true, isNumber: true, operationCountry: true },
  })
  const inbound = participants.length ? await prisma.whatsAppMessage.findMany({
    where: {
      phone: { in: Array.from(new Set(participants.map(p => p.phone))) }, direction: 'inbound',
      createdAt: { gte: new Date(Date.now() - 30 * 86400000) },
    },
    orderBy: { createdAt: 'desc' }, take: 500,
    select: { phone: true, body: true, createdAt: true, read: true },
  }) : []

  const byRef = new Map(bookings.map(b => [b.bookingRef, b]))
  const country = whatsappInboxCountry(role)

  return groups.flatMap(g => {
    const rows = members.filter(m => m.groupId === g.id).flatMap(m => {
      const b = byRef.get(m.bookingRef)
      return b ? [b] : []
    })
    if (!allowedForCountry(country, rows.map(r => r.operationCountry))) return []
    const people = participants.filter(p => p.groupId === g.id)
    const mode = (channels.find(c => c.groupId === g.id)?.mode ?? 'inbox') as GroupMode
    // A real group's replies arrive in its own timeline, not in private chats.
    const heard = mode === 'whatsapp' ? [] : inbound.filter(m => people.some(p => p.phone === m.phone && p.createdAt <= m.createdAt))
    const own = lines.find(l => l.groupId === g.id)
    const newest = heard[0] && (!own || heard[0].createdAt > own.createdAt) ? heard[0] : own
    return [{
      id: g.id, name: g.name, color: (isGroupColor(g.color) ? g.color : 'emerald') as GroupColor,
      bookingRef: rows[0]?.bookingRef ?? null,
      shownRef:   rows[0] ? rows[0].isNumber || rows[0].bookingRef : null,
      country:    rows[0]?.operationCountry ?? null,
      participants: people.length,
      mode,
      lastText:   (newest?.body ?? '').slice(0, 90),
      lastAt:     newest?.createdAt.toISOString() ?? null,
      unread:     heard.filter(m => !m.read).length,
      autoCount:  [g.autoDaily, g.autoDay7, g.autoDay3, g.autoDriver].filter(Boolean).length,
    }]
  }).sort((a, b) => (b.lastAt ?? '').localeCompare(a.lastAt ?? ''))
}

interface CoverageRow { bookingRef: string; senderName: string | null; status: string; createdAt: Date; body: string | null; waMessageId: string | null }

function kindOfMessage(m: CoverageRow): GroupKind | null {
  const tag = m.senderName ?? ''
  if (tag.startsWith(TAG_DAILY_BRIEFING)) return 'daily'
  if (tag.startsWith(BOOKING_DOCS_TAG)) {
    if (m.body?.includes(`Attached: ${DOC_LABELS.day3}`)) return 'day3'
    if (m.body?.includes(`Attached: ${DOC_LABELS.day7}`)) return 'day7'
    return null
  }
  for (const k of ['flights', 'hotels', 'itinerary', 'driver'] as const) {
    if (tag.startsWith(TRIP_TAGS[k])) return k
  }
  return null
}

async function readCoverageRows(refs: string[]): Promise<CoverageRow[]> {
  const [private_, group] = await Promise.all([readPrivateCoverage(refs), prisma.waGroupMessage.findMany({
    where:  { bookingRef: { in: refs }, tag: { not: null } },
    select: { bookingRef: true, tag: true, status: true, createdAt: true, body: true, waMessageId: true },
  })])
  return [...private_, ...group.map(({ tag, ...m }) => ({ ...m, senderName: tag }))]
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
}

function readPrivateCoverage(refs: string[]): Promise<CoverageRow[]> {
  return prisma.whatsAppMessage.findMany({
    where: {
      bookingRef: { in: refs },
      direction:  'outbound',
      createdAt:  { gte: new Date(Date.now() - COVERAGE_LOOKBACK_DAYS * 86400000) },
      OR: [TAG_DAILY_BRIEFING, BOOKING_DOCS_TAG, ...Object.values(TRIP_TAGS)].map(t => ({ senderName: { startsWith: t } })),
    },
    orderBy: { createdAt: 'desc' },
    select:  { bookingRef: true, senderName: true, status: true, createdAt: true, body: true, waMessageId: true },
  })
}

/** Has this guest already had this message? `date` picks the trip day for the daily plan. */
async function alreadySent(ref: string, kind: GroupKind, date?: string): Promise<boolean> {
  const rows = await readCoverageRows([ref])
  return rows.some(m => {
    if (kindOfMessage(m) !== kind || UNDELIVERED.has(m.status)) return false
    return kind !== 'daily' || !date || Boolean(m.body?.includes(briefingDayLabel(`${date}T00:00:00.000Z`)))
  })
}

const memberSelect = {
  bookingRef: true, isNumber: true, agent: true, status: true, operationCountry: true,
  arrivalDate: true, departureDate: true, paxAdults: true, paxChildren: true, paxInfants: true,
  contactWhatsapp: true, contactPhone: true,
  passengers:     { where: { isLead: true }, take: 1, select: { name: true } },
  flights:        { select: { id: true } },
  accommodations: { where: { ownArrangement: false }, select: { id: true } },
  itineraryItems: { select: { id: true } },
  tourAgenda:     { select: { items: { select: { serviceType: true, assignment: { select: { driverId: true, driverName: true } } } } } },
} satisfies Prisma.BookingSelect

export async function getGroupDetail(id: string, role: string): Promise<GroupDetail | null> {
  const group = await accessibleGroup(id, role)
  if (!group) return null

  const memberRows = await prisma.waBookingGroupMember.findMany({ where: { groupId: id }, select: { bookingRef: true }, orderBy: { createdAt: 'asc' }, take: 1 })
  const refs = memberRows.map(m => m.bookingRef)
  const [bookings, live, links, sends, peopleRows, channelRow] = await Promise.all([
    prisma.booking.findMany({ where: { bookingRef: { in: refs } }, select: memberSelect, orderBy: { arrivalDate: 'asc' } }),
    liveBookingWhere().then(w => prisma.booking.findMany({ where: { AND: [w, { bookingRef: { in: refs } }] }, select: { bookingRef: true } })),
    listVersionLinks().catch(() => []),
    prisma.waGroupSend.findMany({ where: { groupId: id }, orderBy: { createdAt: 'desc' }, take: 40 }),
    prisma.waGroupParticipant.findMany({ where: { groupId: id, removedAt: null }, orderBy: { createdAt: 'asc' } }),
    prisma.waGroupChannel.findUnique({ where: { groupId: id } }),
  ])
  const participants: GroupParticipant[] = peopleRows.map(p => ({
    id: p.id, phone: p.phone, name: p.name, role: isParticipantRole(p.role) ? p.role : 'other', joinState: p.joinState,
  }))
  const channel: GroupChannel = {
    mode: (channelRow?.mode ?? 'inbox') as GroupMode, inviteLink: channelRow?.inviteLink ?? null, lastError: channelRow?.lastError ?? null,
  }
  const audience = channel.mode === 'whatsapp' ? channelRow?.waGroupId ?? null : participants.find(p => MATERIAL_ROLES.has(p.role))?.phone ?? null
  const liveRefs = new Set(live.map(b => b.bookingRef))
  const replaced = new Set(links.filter(l => l.state === 'superseded').map(l => l.ref))

  let coverageRows = refs.length ? await readCoverageRows(refs) : []
  const unsettled = coverageRows.filter(m => m.waMessageId && m.status !== 'read' && m.status !== 'failed').map(m => m.waMessageId!)
  if (unsettled.length && await syncDeliveryReceipts(unsettled).catch(() => 0)) coverageRows = await readCoverageRows(refs)

  const members: GroupMember[] = bookings.map(b => {
    const localToday = nowInTz(briefingTimezone(b.operationCountry, b.bookingRef)).date
    const arrival = isoDay(b.arrivalDate)
    const departure = isoDay(b.departureDate)
    const coverage: GroupMember['coverage'] = {}
    const dailyBodies: string[] = []
    for (const m of coverageRows) {
      if (m.bookingRef !== b.bookingRef) continue
      const kind = kindOfMessage(m)
      if (!kind) continue
      const seen: GroupCoverage | undefined = coverage[kind]
      if (seen) seen.count++
      else coverage[kind] = { at: m.createdAt.toISOString(), status: m.status, count: 1 }
      if (kind === 'daily' && !UNDELIVERED.has(m.status) && m.body) dailyBodies.push(m.body)
    }
    const dailyDates: string[] = []
    for (let d = arrival, n = 0; d <= departure && n < 60; d = addDays(d, 1), n++) {
      const label = briefingDayLabel(`${d}T00:00:00.000Z`)
      if (dailyBodies.some(body => body.includes(label))) dailyDates.push(d)
    }
    const phone = b.contactWhatsapp || b.contactPhone
    return {
      bookingRef: b.bookingRef,
      isNumber:   b.isNumber,
      leadName:   b.passengers[0]?.name ?? null,
      agent:      b.agent,
      status:     b.status,
      country:    b.operationCountry,
      arrival, departure,
      pax:        paxLabel(b.paxAdults, b.paxChildren, b.paxInfants),
      phone:      audience ?? (phone ? normalisePhone(phone) || null : null),
      blocked:    replaced.has(b.bookingRef) ? 'Replaced by a newer version'
                : liveRefs.has(b.bookingRef) ? null
                : b.status === 'DRAFT' ? 'Still a draft' : 'Cancelled',
      localToday,
      daysToArrival: daysBetween(localToday, arrival),
      stage:      localToday < arrival ? 'upcoming' : localToday > departure ? 'finished' : 'in-trip',
      readiness: {
        flights:   b.flights.length,
        hotels:    b.accommodations.length,
        itinerary: b.itineraryItems.length,
        ...driverAllocation(b.tourAgenda?.items ?? []),
      },
      coverage,
      dailyDates,
    }
  })

  const nameOf = new Map(members.map(m => [m.bookingRef, m.leadName]))
  const activity: GroupActivity[] = sends.map(s => ({
    id: s.id, bookingRef: s.bookingRef, leadName: nameOf.get(s.bookingRef) ?? null,
    kind: (isGroupKind(s.kind) ? s.kind : 'daily'), trigger: s.trigger === 'auto' ? 'auto' : 'manual',
    status: s.status, detail: s.detail, targetDate: s.targetDate, sentByName: s.sentByName,
    createdAt: s.createdAt.toISOString(),
  }))

  return {
    id: group.id, name: group.name, color: isGroupColor(group.color) ? group.color : 'emerald',
    autoDaily: group.autoDaily, dailyTime: group.dailyTime, autoDay7: group.autoDay7, autoDay3: group.autoDay3,
    autoDriver: group.autoDriver, docTime: group.docTime,
    canManage: canManageGroups(role),
    member: members[0] ?? null,
    participants, channel, activity,
  }
}

export async function findCandidates(opts: { q: string; window: string; role: string }): Promise<GroupCandidate[]> {
  const q = opts.q.trim()
  const country = whatsappInboxCountry(opts.role)
  const today = isoDay(new Date())
  const start = new Date(`${today}T00:00:00.000Z`)
  const ahead = (days: number) => new Date(`${addDays(today, days)}T23:59:59.999Z`)

  const windowWhere: Prisma.BookingWhereInput =
      opts.window === 'intrip'  ? { arrivalDate: { lte: start }, departureDate: { gte: start } }
    : opts.window === 'next7'   ? { arrivalDate: { gte: start, lte: ahead(7) } }
    : opts.window === 'next14'  ? { arrivalDate: { gte: start, lte: ahead(14) } }
    : opts.window === 'next30'  ? { arrivalDate: { gte: start, lte: ahead(30) } }
    : { departureDate: { gte: start } }

  const rows = await prisma.booking.findMany({
    where: {
      AND: [
        await liveBookingWhere(),
        country ? { operationCountry: country } : {},
        q.length >= 2
          ? { OR: [
              { bookingRef: { contains: q } }, { isNumber: { contains: q } }, { cntlNumber: { contains: q } },
              { agent: { contains: q } }, { passengers: { some: { name: { contains: q } } } },
            ] }
          : windowWhere,
      ],
    },
    orderBy: { arrivalDate: 'asc' },
    take: 60,
    select: {
      bookingRef: true, isNumber: true, status: true, operationCountry: true, arrivalDate: true, departureDate: true,
      contactWhatsapp: true, contactPhone: true,
      passengers: { where: { isLead: true }, take: 1, select: { name: true } },
    },
  })
  return rows.map(b => ({
    bookingRef: b.bookingRef, isNumber: b.isNumber, leadName: b.passengers[0]?.name ?? null,
    status: b.status, country: b.operationCountry,
    arrival: isoDay(b.arrivalDate), departure: isoDay(b.departureDate),
    hasPhone: Boolean(b.contactWhatsapp || b.contactPhone),
  }))
}

// ── Writes ───────────────────────────────────────────────────────────────────

/** Who trip materials go to in an inbox group. */
const MATERIAL_ROLES = new Set<string>(['guest', 'family'])

/** Link a group to its one booking and bring in the guest. Returns why not, or null. */
export async function attachBooking(groupId: string, ref: string, role: string): Promise<string | null> {
  const country = whatsappInboxCountry(role)
  const b = await prisma.booking.findUnique({
    where:  { bookingRef: ref },
    select: {
      operationCountry: true, contactWhatsapp: true, contactPhone: true,
      passengers: { where: { isLead: true }, take: 1, select: { name: true } },
    },
  })
  if (!b || (country && b.operationCountry !== country)) return 'Booking not found'
  const held = await prisma.waBookingGroupMember.count({ where: { groupId } })
  if (held > 0) return 'This group already has its booking'
  await prisma.waBookingGroupMember.create({ data: { groupId, bookingRef: ref } })
  const phone = normalisePhone(b.contactWhatsapp || b.contactPhone || '')
  if (phone) {
    await prisma.waGroupParticipant.upsert({
      where:  { groupId_phone: { groupId, phone } },
      create: { groupId, phone, name: b.passengers[0]?.name ?? null, role: 'guest' },
      update: { removedAt: null },
    })
  }
  return null
}

/** The open group already on a booking, so one booking keeps one chat. */
export async function findGroupForBooking(ref: string): Promise<string | null> {
  const rows = await prisma.waBookingGroupMember.findMany({ where: { bookingRef: ref }, select: { groupId: true } })
  if (!rows.length) return null
  const open = await prisma.waBookingGroup.findFirst({ where: { id: { in: rows.map(r => r.groupId) }, archivedAt: null }, select: { id: true } })
  return open?.id ?? null
}

export function createGroup(name: string, color: GroupColor, actor: string) {
  return prisma.waBookingGroup.create({ data: { name: name.slice(0, 120), color, createdByName: actor } })
}

/** People on the booking who could join, for the add-contact picker. */
export async function suggestContacts(ref: string): Promise<ContactSuggestion[]> {
  const b = await prisma.booking.findUnique({
    where:  { bookingRef: ref },
    select: {
      contactWhatsapp: true, contactPhone: true, agent: true, agentWhatsapp: true, agentPhone: true,
      passengers: { where: { isLead: true }, take: 1, select: { name: true } },
      tourAgenda: { select: { items: { select: { assignment: { select: {
        driverName: true, driverPhone: true, guideName: true, guidePhone: true,
        driver: { select: { name: true, phone: true } },
        guide:  { select: { name: true, phone: true, whatsappPhone: true } },
      } } } } } },
    },
  })
  if (!b) return []
  const out = new Map<string, ContactSuggestion>()
  const add = (raw: string | null | undefined, name: string | null, role: ContactSuggestion['role'], label: string) => {
    const phone = normalisePhone(raw ?? '')
    if (phone.length >= 7 && !out.has(phone)) out.set(phone, { phone, name, role, label })
  }
  const lead = b.passengers[0]?.name ?? null
  add(b.contactWhatsapp, lead, 'guest', 'Guest WhatsApp')
  add(b.contactPhone, lead, 'guest', 'Guest phone')
  add(b.agentWhatsapp || b.agentPhone, b.agent, 'agent', 'Agent')
  for (const item of b.tourAgenda?.items ?? []) {
    const a = item.assignment
    if (!a) continue
    add(contactPhone(a.driverPhone, a.driver?.phone), a.driverName ?? a.driver?.name ?? null, 'driver', 'Driver')
    add(contactPhone(a.guidePhone, a.guide?.whatsappPhone, a.guide?.phone), a.guideName ?? a.guide?.name ?? null, 'guide', 'Guide')
  }
  return Array.from(out.values())
}

export interface GroupPatch {
  name?: string; color?: string; autoDaily?: boolean; dailyTime?: string
  autoDay7?: boolean; autoDay3?: boolean; autoDriver?: boolean; docTime?: string
}

/** Returns the reason a patch is invalid, or null once it is saved. */
export async function updateGroup(id: string, p: GroupPatch): Promise<string | null> {
  const data: Prisma.WaBookingGroupUpdateInput = {}
  if (p.name !== undefined) {
    if (!p.name.trim()) return 'A group needs a name'
    data.name = p.name.trim().slice(0, 120)
  }
  if (p.color !== undefined) {
    if (!isGroupColor(p.color)) return 'Unknown colour'
    data.color = p.color
  }
  for (const k of ['dailyTime', 'docTime'] as const) {
    if (p[k] === undefined) continue
    const t = normaliseBriefingTime(p[k])
    if (!t) return 'Time must be HH:MM (24-hour)'
    data[k] = t
  }
  for (const k of ['autoDaily', 'autoDay7', 'autoDay3', 'autoDriver'] as const) {
    if (typeof p[k] === 'boolean') data[k] = p[k]
  }
  await prisma.waBookingGroup.update({ where: { id }, data })
  return null
}

export async function archiveGroup(id: string) {
  await prisma.waBookingGroup.update({
    where: { id },
    data:  { archivedAt: new Date(), autoDaily: false, autoDay7: false, autoDay3: false, autoDriver: false },
  })
}

// ── Composing ────────────────────────────────────────────────────────────────

type TextKind = keyof typeof TRIP_TAGS

async function loadTripText(ref: string) {
  return prisma.booking.findUnique({
    where: { bookingRef: ref },
    select: {
      bookingRef: true, isNumber: true, status: true, agent: true, operationCountry: true,
      arrivalDate: true, departureDate: true, paxAdults: true, paxChildren: true, paxInfants: true,
      passengers:     { where: { isLead: true }, take: 1, select: { name: true } },
      flights:        { orderBy: [{ date: 'asc' }, { depTime: 'asc' }] },
      accommodations: { where: { ownArrangement: false }, orderBy: { checkIn: 'asc' } },
      itineraryItems: { orderBy: [{ dayNo: 'asc' }, { date: 'asc' }], select: { dayNo: true, date: true, title: true } },
      tourAgenda: {
        select: {
          items: {
            orderBy: [{ date: 'asc' }, { sortOrder: 'asc' }],
            select: {
              date: true, meetingTime: true, timeFrom: true, location: true, fromPoint: true, toPoint: true,
              assignment: {
                select: {
                  driverName: true, driverPhone: true, vehicleType: true, vehiclePlate: true,
                  driver: { select: { name: true, phone: true } },
                },
              },
            },
          },
        },
      },
    },
  })
}

/** One entry per driver, with the days they cover. Rates are never read. */
function driverLines(b: NonNullable<Awaited<ReturnType<typeof loadTripText>>>): DriverLine[] {
  const byDriver = new Map<string, DriverLine>()
  for (const item of b.tourAgenda?.items ?? []) {
    const a = item.assignment
    const name = (a?.driverName ?? a?.driver?.name ?? '').trim()
    if (!a || !name) continue
    const phone = contactPhone(a.driverPhone, a.driver?.phone)
    const key = `${name}|${phone ?? ''}|${a.vehiclePlate ?? ''}`
    const line = byDriver.get(key) ?? { name, phone, vehicle: a.vehicleType, plate: a.vehiclePlate, dates: [] }
    line.dates.push(item.date)
    byDriver.set(key, line)
  }
  return Array.from(byDriver.values())
}

/** The text for a trip-details kind, or why there is nothing to send. */
async function composeTripText(ref: string, kind: TextKind): Promise<{ text: string; driverPrint?: string } | { empty: string }> {
  const b = await loadTripText(ref)
  if (!b) return { empty: 'Booking not found' }
  const shownRef = b.isNumber || b.bookingRef
  if (kind === 'flights') {
    return b.flights.length ? { text: formatFlightDetails(shownRef, b.flights) } : { empty: 'No flights on file' }
  }
  if (kind === 'hotels') {
    return b.accommodations.length ? { text: formatHotelDetails(shownRef, b.accommodations) } : { empty: 'No hotels on file' }
  }
  if (kind === 'itinerary') {
    return b.itineraryItems.length ? { text: formatItinerary(shownRef, b.itineraryItems) } : { empty: 'No itinerary on file' }
  }
  const lines = driverLines(b)
  if (!lines.length) return { empty: 'No driver assigned yet' }
  const print = lines.map(l => `${l.name}|${l.phone ?? ''}|${l.plate ?? ''}`).sort().join(';')
  return { text: formatDriverDetails(shownRef, lines), driverPrint: createHash('sha1').update(print).digest('hex').slice(0, 16) }
}

/** Everything the side panel and the AI need about one booking. Never reads a price. */
export async function getGuestBrief(ref: string): Promise<GuestBrief | null> {
  const b = await loadTripText(ref)
  if (!b) return null
  const today = nowInTz(briefingTimezone(b.operationCountry, ref)).date
  const arrival = isoDay(b.arrivalDate)
  const departure = isoDay(b.departureDate)
  const focusDate = today < arrival || today > departure ? arrival : today
  const items = b.tourAgenda?.items ?? []
  return {
    bookingRef: b.bookingRef,
    shownRef:   b.isNumber || b.bookingRef,
    leadName:   b.passengers[0]?.name ?? null,
    status:     b.status,
    agent:      b.agent,
    country:    b.operationCountry,
    arrival, departure,
    pax:        paxLabel(b.paxAdults, b.paxChildren, b.paxInfants),
    flights: b.flights.map(f => ({
      flightNo: f.flightNo, airline: f.airline, date: isoDay(f.date), from: f.fromApt, to: f.toApt, dep: f.depTime, arr: f.arrTime,
    })),
    hotels: b.accommodations.map(h => ({
      hotel: h.hotel, city: h.city, checkIn: isoDay(h.checkIn), checkOut: isoDay(h.checkOut), nights: h.nights, room: h.roomType, meal: h.mealType,
    })),
    itinerary: b.itineraryItems.map(i => ({ dayNo: i.dayNo, date: isoDay(i.date), title: i.title })),
    drivers: driverLines(b).map(({ name, phone, vehicle, plate }) => ({ name, phone, vehicle, plate })),
    focusDate,
    focusPlan: items.filter(i => isoDay(i.date) === focusDate).map(i => ({
      time:   i.meetingTime || i.timeFrom || null,
      title:  i.fromPoint && i.toPoint ? `${i.fromPoint} → ${i.toPoint}` : i.location,
      driver: i.assignment?.driverName ?? i.assignment?.driver?.name ?? null,
    })),
  }
}

export async function previewGroupMessage(
  ref: string, kind: GroupKind, date: string | undefined, note: string | undefined,
): Promise<{ text: string | null; attachment: string | null; empty?: string }> {
  if (kind === 'day7' || kind === 'day3') {
    const facts = await readBookingFacts(ref)
    if (!facts) return { text: null, attachment: null, empty: 'Booking not found' }
    return { text: renderBody(BOOKING_DETAILS_BODY, bookingDetailsParams(facts, DOC_LABELS[kind], note)), attachment: DOC_LABELS[kind] }
  }
  if (kind === 'daily') {
    if (!date) return { text: null, attachment: null, empty: 'Pick a day' }
    const r = await sendDailyBriefingForBooking(ref, date, { force: true, allowEmpty: true, dryRun: true })
    return r.ok ? { text: r.message ?? '', attachment: null } : { text: null, attachment: null, empty: r.reason }
  }
  const composed = await composeTripText(ref, kind)
  return 'empty' in composed ? { text: null, attachment: null, empty: composed.empty } : { text: composed.text, attachment: null }
}

// ── Sending ──────────────────────────────────────────────────────────────────

const UNCONFIRMED_NOTE =
  'Sent as plain text outside the guest\'s 24h window and the guest template is unavailable, so Meta may drop it.'

interface Audience { waGroupId: string | null; people: { phone: string; name: string | null }[] }

/** A real group's id, or the guest and family in it, or else the booking's own contact. */
async function audienceFor(groupId: string, b: { contactWhatsapp: string | null; contactPhone: string | null }, lead: string | null): Promise<Audience> {
  const channel = await prisma.waGroupChannel.findUnique({ where: { groupId } })
  if (channel?.mode === 'whatsapp' && channel.waGroupId) return { waGroupId: channel.waGroupId, people: [] }
  const rows = await prisma.waGroupParticipant.findMany({ where: { groupId, removedAt: null } })
  const people = rows.filter(p => MATERIAL_ROLES.has(p.role)).map(p => ({ phone: p.phone, name: p.name }))
  if (people.length) return { waGroupId: null, people }
  const own = normalisePhone(b.contactWhatsapp || b.contactPhone || '')
  return { waGroupId: null, people: own ? [{ phone: own, name: lead }] : [] }
}

const TAG_OF = { ...TRIP_TAGS, daily: TAG_DAILY_BRIEFING, day7: BOOKING_DOCS_TAG, day3: BOOKING_DOCS_TAG }

/** Sends one kind of material. Throws or returns a failure; never logs to wa_group_sends. */
async function dispatch(o: {
  groupId: string; ref: string; kind: GroupKind; date?: string; note?: string; actor: string; force: boolean; allowEmptyDay: boolean
}): Promise<GroupSendOutcome> {
  const { ref, kind } = o
  if (kind === 'daily' && !o.date) return { status: 'failed', detail: 'No trip day chosen' }

  const b = await prisma.booking.findUnique({
    where:  { bookingRef: ref },
    select: { contactWhatsapp: true, contactPhone: true, passengers: { where: { isLead: true }, take: 1, select: { name: true } } },
  })
  if (!b) return { status: 'failed', detail: 'Booking not found' }
  const lead = b.passengers[0]?.name ?? null
  const audience = await audienceFor(o.groupId, b, lead)
  const isDoc = kind === 'day7' || kind === 'day3'
  const doc = isDoc ? await buildBookingPdf(ref, kind === 'day7' ? 'confirmation' : 'full', 'pdf') : null
  const timeline = (body: string, recipients: number, extra: { tag?: string; waMessageId?: string | null } = {}) =>
    prisma.waGroupMessage.create({
      data: { groupId: o.groupId, bookingRef: ref, direction: 'outbound', senderName: o.actor, body, kind, recipients, status: 'sent', ...extra },
    })

  if (audience.waGroupId) {
    if (doc) {
      const label = DOC_LABELS[kind as 'day7' | 'day3']
      const id = await sendRealGroupDocument(audience.waGroupId, doc, o.note || label)
      await timeline(`Attached: ${label}`, 1, { tag: BOOKING_DOCS_TAG, waMessageId: id })
      return { status: 'sent', detail: null }
    }
    const p = await previewGroupMessage(ref, kind, o.date, o.note)
    if (!p.text) return { status: 'skipped', detail: p.empty ?? 'Nothing to send' }
    const id = await sendRealGroupText(audience.waGroupId, p.text)
    await timeline(p.text, 1, { tag: TAG_OF[kind], waMessageId: id })
    return { status: 'sent', detail: null }
  }

  if (audience.people.length === 0) return { status: 'skipped', detail: 'No WhatsApp number' }

  const composed = isDoc || kind === 'daily' ? null : await composeTripText(ref, kind)
  if (composed && 'empty' in composed) return { status: 'skipped', detail: composed.empty }

  let sent = 0
  let text = doc ? `Attached: ${DOC_LABELS[kind as 'day7' | 'day3']}` : composed?.text ?? ''
  const problems: string[] = []
  for (const [i, person] of audience.people.entries()) {
    const who = person.name ?? `+${person.phone}`
    try {
      if (kind === 'daily') {
        const r = await sendDailyBriefingForBooking(ref, o.date!, { force: o.force || i > 0, allowEmpty: o.allowEmptyDay, to: person.phone })
        if (r.ok) { sent++; text = r.message ?? text; if (r.unconfirmed) problems.push(`${who}: ${UNCONFIRMED_NOTE}`) }
        else if (i === 0 && /Already sent|Nothing scheduled/.test(r.reason ?? '')) return { status: 'skipped', detail: r.reason ?? null }
        else problems.push(`${who}: ${r.reason ?? 'Send failed'}`)
      } else if (doc) {
        await sendBookingDocTemplate({
          bookingRef: ref, to: person.phone, document: doc, attachedLabel: DOC_LABELS[kind as 'day7' | 'day3'], note: o.note,
          senderName: o.actor, baseUrl: process.env.APP_URL ?? process.env.NEXTAUTH_URL,
        })
        sent++
      } else {
        const tag = `${TAG_OF[kind]} ${person.name ?? 'Guest'}`
        const r = await deliverToGuest({ phone: person.phone, text, guestName: person.name, bookingRef: ref, tag })
        if (!r.ok) { problems.push(`${who}: ${r.reason ?? 'Send failed'}`); continue }
        await prisma.whatsAppMessage.create({
          data: { bookingRef: ref, phone: person.phone, direction: 'outbound', body: text, waMessageId: r.waMessageId, status: 'sent', senderName: tag },
        })
        sent++
        if (r.unconfirmed) problems.push(`${who}: ${UNCONFIRMED_NOTE}`)
      }
    } catch (err) {
      problems.push(`${who}: ${(err instanceof Error ? err.message : String(err)).slice(0, 200)}`)
    }
  }
  if (sent === 0) return { status: 'failed', detail: problems.join(' ').slice(0, 400) || 'Send failed' }
  await timeline(text, sent)
  return { status: 'sent', detail: problems.length ? problems.join(' ').slice(0, 400) : null }
}

/** Claim, send, record. A taken `dedupeKey` means another run owns it: returns null. */
async function sendAndLog(o: {
  groupId: string; ref: string; kind: GroupKind; date?: string; note?: string; actor: string
  trigger: 'manual' | 'auto'; dedupeKey?: string; force: boolean; allowEmptyDay: boolean
}): Promise<GroupSendOutcome | null> {
  let logId: string
  try {
    const row = await prisma.waGroupSend.create({
      data: {
        groupId: o.groupId, bookingRef: o.ref, kind: o.kind, trigger: o.trigger, status: 'sending',
        targetDate: o.date ?? null, dedupeKey: o.dedupeKey ?? null, sentByName: o.actor,
      },
      select: { id: true },
    })
    logId = row.id
  } catch (err) {
    if ((err as { code?: string })?.code === 'P2002') return null
    throw err
  }

  let outcome: GroupSendOutcome
  try {
    outcome = await dispatch(o)
  } catch (err) {
    outcome = { status: 'failed', detail: (err instanceof Error ? err.message : String(err)).slice(0, 400) }
  }
  await prisma.waGroupSend.update({ where: { id: logId }, data: { status: outcome.status, detail: outcome.detail } })
  return outcome
}

/** A desk send to one booking. `resend` is the desk's explicit "send it again". */
export async function sendFromDesk(o: {
  groupId: string; ref: string; kind: GroupKind; date?: string; note?: string; resend: boolean; actor: string
}): Promise<GroupSendOutcome> {
  const liveWhere = await liveBookingWhere()
  const live = await prisma.booking.findFirst({
    where:  { AND: [liveWhere, { bookingRef: o.ref }] },
    select: { arrivalDate: true, departureDate: true },
  })
  if (!live) return { status: 'skipped', detail: 'Booking is not live (cancelled, draft or replaced)' }
  if (o.kind === 'daily' && o.date && (o.date < isoDay(live.arrivalDate) || o.date > isoDay(live.departureDate))) {
    return { status: 'skipped', detail: 'Not travelling that day' }
  }
  if (!o.resend && await alreadySent(o.ref, o.kind, o.date)) return { status: 'skipped', detail: 'Already sent' }
  const r = await sendAndLog({ ...o, trigger: 'manual', force: true, allowEmptyDay: true })
  return r ?? { status: 'skipped', detail: 'Already being sent' }
}

// ── Automation ───────────────────────────────────────────────────────────────

export interface GroupAutomationResult { sent: number; skipped: number; failed: number }

/**
 * The sweep — call every few minutes. Everything fires in the guest's timezone,
 * inside a window after the group's set time, so switching a rule on at night
 * never messages guests in the small hours:
 *
 *   Daily plan      every trip day at dailyTime (before noon = today's plan, else
 *                   tomorrow's, same rule as the global plan). Respects a booking
 *                   whose daily plan was turned OFF.
 *   Day-7 / Day-3   on exactly that day, at docTime. Never for a guest who already
 *                   has the document. Day-3 waits until drivers are fully assigned,
 *                   since the document lists them.
 *   Driver details  from the day before arrival to departure, once drivers are
 *                   fully assigned, and again if the driver line-up changes.
 */
export async function runGroupAutomations(): Promise<GroupAutomationResult> {
  const result: GroupAutomationResult = { sent: 0, skipped: 0, failed: 0 }
  let groups
  try {
    groups = await prisma.waBookingGroup.findMany({
      where: { archivedAt: null, OR: [{ autoDaily: true }, { autoDay7: true }, { autoDay3: true }, { autoDriver: true }] },
    })
  } catch (err) {
    if ((err as { code?: string })?.code === 'P2021') return result   // tables not installed yet
    throw err
  }
  if (groups.length === 0) return result

  const members = await prisma.waBookingGroupMember.findMany({
    where: { groupId: { in: groups.map(g => g.id) } }, select: { groupId: true, bookingRef: true },
  })
  const bookings = await prisma.booking.findMany({
    where: { AND: [await liveBookingWhere(), { bookingRef: { in: Array.from(new Set(members.map(m => m.bookingRef))) } }] },
    select: {
      bookingRef: true, operationCountry: true, arrivalDate: true, departureDate: true,
      contactWhatsapp: true, contactPhone: true,
      tourAgenda: { select: { items: { select: { serviceType: true, assignment: { select: { driverId: true, driverName: true } } } } } },
    },
  })
  const byRef = new Map(bookings.map(b => [b.bookingRef, b]))
  const [peopleRows, realGroups] = await Promise.all([
    prisma.waGroupParticipant.findMany({ where: { groupId: { in: groups.map(g => g.id) }, removedAt: null }, select: { groupId: true, role: true } }),
    prisma.waGroupChannel.findMany({ where: { groupId: { in: groups.map(g => g.id) }, mode: 'whatsapp' }, select: { groupId: true } }),
  ])
  const canReach = (groupId: string, b: { contactWhatsapp: string | null; contactPhone: string | null }) =>
    realGroups.some(c => c.groupId === groupId) || peopleRows.some(p => p.groupId === groupId && MATERIAL_ROLES.has(p.role)) ||
    Boolean(b.contactWhatsapp || b.contactPhone)
  const offRows = await prisma.systemSetting.findMany({
    where: { key: { startsWith: SETTING_BRIEFING_TIME_PREFIX }, value: 'OFF' }, select: { key: true },
  })
  const dailyOff = new Set(offRows.map(r => r.key.slice(SETTING_BRIEFING_TIME_PREFIX.length)))

  const startedAt = Date.now()
  let docsLeft = AUTO_DOCS_PER_RUN
  const tally = (o: GroupSendOutcome | null) => {
    if (!o) return
    if (o.status === 'sent') result.sent++
    else if (o.status === 'failed') result.failed++
    else result.skipped++
  }
  const inWindow = (minutes: number, time: string) =>
    minutes >= timeToMinutes(time) && minutes < timeToMinutes(time) + AUTO_WINDOW_MINUTES

  for (const g of groups) {
    for (const m of members.filter(x => x.groupId === g.id)) {
      if (Date.now() - startedAt > AUTO_RUN_BUDGET_MS) return result
      const b = byRef.get(m.bookingRef)
      if (!b || !canReach(g.id, b)) continue

      const ref = b.bookingRef
      const now = nowInTz(briefingTimezone(b.operationCountry, ref))
      const arrival = isoDay(b.arrivalDate)
      const departure = isoDay(b.departureDate)
      const until = daysBetween(now.date, arrival)
      const drivers = driverAllocation(b.tourAgenda?.items ?? [])
      const driversComplete = drivers.driversAssigned === drivers.driverItems
      const base = { groupId: g.id, ref, actor: 'Group automation', trigger: 'auto' as const, force: false, allowEmptyDay: false }

      try {
        if (g.autoDaily && !dailyOff.has(ref) && inWindow(now.minutes, g.dailyTime)) {
          const target = briefingTargetsSameDay(g.dailyTime) ? now.date : addDays(now.date, 1)
          if (target >= arrival && target <= departure && !(await alreadySent(ref, 'daily', target))) {
            tally(await sendAndLog({ ...base, kind: 'daily', date: target, dedupeKey: `daily:${ref}:${target}` }))
          }
        }

        if (inWindow(now.minutes, g.docTime)) {
          for (const [on, kind, days] of [[g.autoDay7, 'day7', 7], [g.autoDay3, 'day3', 3]] as const) {
            if (!on || until !== days || docsLeft <= 0 || await alreadySent(ref, kind)) continue
            if (kind === 'day3' && !driversComplete) {
              await prisma.waGroupSend.create({
                data: {
                  groupId: g.id, bookingRef: ref, kind, trigger: 'auto', status: 'skipped', sentByName: base.actor,
                  detail: `Waiting for drivers (${drivers.driversAssigned} of ${drivers.driverItems} assigned). Assign them, or send it by hand.`,
                  dedupeKey: `day3-wait:${ref}:${now.date}`,
                },
              }).catch(err => { if ((err as { code?: string })?.code !== 'P2002') throw err })
              continue
            }
            docsLeft--
            tally(await sendAndLog({ ...base, kind, dedupeKey: `${kind}:${ref}:${arrival}` }))
          }

          if (g.autoDriver && until <= 1 && now.date <= departure && drivers.driversAssigned > 0 && driversComplete) {
            const composed = await composeTripText(ref, 'driver')
            if ('text' in composed && composed.driverPrint) {
              tally(await sendAndLog({ ...base, kind: 'driver', dedupeKey: `driver:${ref}:${composed.driverPrint}` }))
            }
          }
        }
      } catch (err) {
        result.failed++
        console.error(`[WaGroups] automation failed for ${ref}:`, err instanceof Error ? err.message : err)
      }
    }
  }

  if (result.sent || result.failed) console.log(`[WaGroups] sweep: ${JSON.stringify(result)}`)
  return result
}

