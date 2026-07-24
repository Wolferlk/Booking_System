import { prisma } from '@/lib/prisma'
import { hasPermission } from '@/lib/rbac'
import { logActivity } from '@/lib/activity'
import {
  OPS_TOOLS, EDITABLE_BOOKING_FIELDS, EDITABLE_ACCOMMODATION_FIELDS,
  EDITABLE_AGENDA_FIELDS, NAVIGABLE_ROUTES, SERVICE_TYPES, BOOKING_STATUSES,
  type OpsTool,
} from './registry'
import { actorMaySee, countryWhere, loadBookingSnapshot, type OpsActor } from './context'
import type { ServiceType } from '@prisma/client'

/**
 * The single choke point where an agent-proposed action becomes a real change.
 *
 * Order of checks, all mandatory:
 *   1. tool is in the registry           (nothing else is reachable, ever)
 *   2. actor holds a required permission (re-derived from the session role)
 *   3. actor's country scope covers the target record
 *   4. arguments are validated + coerced against the field whitelists
 *   5. the write happens, and is recorded in the activity log
 *
 * There is no delete, cancel, status-change, bulk, or raw-SQL path in here by
 * design. `assertNonDestructive` is a second net in case one is ever added
 * without thinking it through.
 */

export interface ExecResult {
  ok:       boolean
  message:  string
  /** Client-side follow-up, e.g. navigate somewhere or refresh the page. */
  effect?:  { type: 'navigate'; href: string } | { type: 'refresh' }
  data?:    unknown
}

class OpsError extends Error {}

const fail = (message: string): ExecResult => ({ ok: false, message })

// ── Guards ────────────────────────────────────────────────────────────────

const DESTRUCTIVE = /\b(delete|drop|truncate|destroy|purge|wipe|reset|cancel|deleteMany|bulk[-_]?delete)\b/i

function assertNonDestructive(tool: string) {
  if (DESTRUCTIVE.test(tool)) {
    throw new OpsError('Destructive operations are not available to OPS_AI.')
  }
}

function requirePermission(actor: OpsActor, tool: OpsTool) {
  if (!tool.permission?.length) return
  const allowed = tool.permission.some(p => hasPermission(actor.role, p))
  if (!allowed) {
    throw new OpsError(`Your role (${actor.role}) is not permitted to ${tool.label.toLowerCase()}.`)
  }
}

// ── Coercion ──────────────────────────────────────────────────────────────

function coerce(kind: string, raw: unknown, label: string): unknown {
  const s = raw === null || raw === undefined ? '' : String(raw).trim()

  if (kind === 'date') {
    if (!s) throw new OpsError(`${label} cannot be empty.`)
    const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T00:00:00.000Z` : s)
    if (Number.isNaN(d.getTime())) throw new OpsError(`"${s}" is not a valid date for ${label}.`)
    return d
  }
  if (kind === 'int') {
    if (!/^-?\d+$/.test(s)) throw new OpsError(`${label} must be a whole number, got "${s}".`)
    const n = parseInt(s, 10)
    if (n < 0 || n > 100000) throw new OpsError(`${label} is out of range.`)
    return n
  }
  if (kind === 'decimal') {
    if (!/^-?\d+(\.\d+)?$/.test(s)) throw new OpsError(`${label} must be a number, got "${s}".`)
    return parseFloat(s)
  }
  if (kind === 'enum') {
    if (!(SERVICE_TYPES as readonly string[]).includes(s)) throw new OpsError(`"${s}" is not a valid ${label}.`)
    return s as ServiceType
  }
  if (kind === 'text') return s === '' ? null : s.slice(0, 8000)
  return s === '' ? null : s.slice(0, 500)
}

function str(args: Record<string, unknown>, key: string): string | undefined {
  const v = args[key]
  if (v === null || v === undefined) return undefined
  const s = String(v).trim()
  return s === '' ? undefined : s
}

function hhmm(v: string | undefined, label: string): string | undefined {
  if (v === undefined) return undefined
  if (!/^([01]?\d|2[0-3]):[0-5]\d$/.test(v)) throw new OpsError(`${label} must be HH:mm, got "${v}".`)
  return v.padStart(5, '0')
}

async function loadBookingForWrite(bookingRef: string, actor: OpsActor) {
  const booking = await prisma.booking.findUnique({ where: { bookingRef } })
  if (!booking) throw new OpsError(`Booking ${bookingRef} not found.`)
  if (!actorMaySee(actor, booking.operationCountry)) {
    throw new OpsError(`Booking ${bookingRef} is outside your country scope.`)
  }
  return booking
}

// ── Entry point ───────────────────────────────────────────────────────────

export async function executeTool(
  toolName: string,
  args: Record<string, unknown>,
  actor: OpsActor,
): Promise<ExecResult> {
  try {
    assertNonDestructive(toolName)
    const tool = OPS_TOOLS[toolName]
    if (!tool) return fail(`Unknown capability "${toolName}" — refused.`)
    requirePermission(actor, tool)

    switch (toolName) {
      case 'search_bookings':      return await runSearchBookings(args, actor)
      case 'read_booking':         return await runReadBooking(args, actor)
      case 'open_booking':         return await runOpenBooking(args, actor)
      case 'navigate':             return runNavigate(args)
      case 'update_booking_field': return await runUpdateBookingField(args, actor)
      case 'add_agenda_item':      return await runAddAgendaItem(args, actor)
      case 'update_agenda_item':   return await runUpdateAgendaItem(args, actor)
      case 'update_accommodation': return await runUpdateAccommodation(args, actor)
      case 'assign_driver':        return await runAssignDriver(args, actor)
      case 'create_reminder':      return await runCreateReminder(args, actor)
      case 'log_contact':          return await runLogContact(args, actor)
      default:                     return fail(`Capability "${toolName}" has no implementation.`)
    }
  } catch (err) {
    if (err instanceof OpsError) return fail(err.message)
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[OPS_AI] execute failed:', toolName, msg)
    return fail(`Could not complete that: ${msg}`)
  }
}

// ── READ ──────────────────────────────────────────────────────────────────

async function runSearchBookings(args: Record<string, unknown>, actor: OpsActor): Promise<ExecResult> {
  const query  = str(args, 'query')
  const status = str(args, 'status')
  const from   = str(args, 'arrivalFrom')
  const to     = str(args, 'arrivalTo')
  const limit  = Math.min(Math.max(Number(args.limit) || 10, 1), 25)

  const and: Record<string, unknown>[] = []
  const scope = countryWhere(actor)
  if (scope) and.push(scope)

  if (status) {
    if (!(BOOKING_STATUSES as readonly string[]).includes(status)) throw new OpsError(`Unknown status "${status}".`)
    and.push({ status })
  } else {
    and.push({ status: { not: 'CANCELLED' } })
  }

  if (query) {
    and.push({
      OR: [
        { bookingRef:     { contains: query } },
        { isNumber:       { contains: query } },
        { agent:          { contains: query } },
        { fileHandler:    { contains: query } },
        { agentBookingId: { contains: query } },
        { dealName:       { contains: query } },
        { passengers: { some: { name: { contains: query } } } },
      ],
    })
  }

  if (from || to) {
    const range: Record<string, Date> = {}
    if (from) range.gte = coerce('date', from, 'arrivalFrom') as Date
    if (to) {
      const end = coerce('date', to, 'arrivalTo') as Date
      end.setUTCHours(23, 59, 59, 999)
      range.lte = end
    }
    and.push({ arrivalDate: range })
  }

  const rows = await prisma.booking.findMany({
    where: and.length ? { AND: and } : {},
    orderBy: { arrivalDate: 'asc' },
    take: limit,
    select: {
      bookingRef: true, status: true, agent: true, isNumber: true,
      arrivalDate: true, departureDate: true, paxAdults: true, paxChildren: true,
      operationCountry: true, tourDestination: true,
    },
  })

  return {
    ok: true,
    message: rows.length ? `Found ${rows.length} booking${rows.length === 1 ? '' : 's'}.` : 'No bookings matched.',
    data: rows.map(r => ({
      bookingRef: r.bookingRef,
      status: r.status,
      agent: r.agent,
      isNumber: r.isNumber,
      arrivalDate: r.arrivalDate.toISOString().slice(0, 10),
      departureDate: r.departureDate.toISOString().slice(0, 10),
      pax: r.paxAdults + r.paxChildren,
      country: r.operationCountry,
      destination: r.tourDestination,
    })),
  }
}

async function runReadBooking(args: Record<string, unknown>, actor: OpsActor): Promise<ExecResult> {
  const ref = str(args, 'bookingRef')
  if (!ref) throw new OpsError('bookingRef is required.')
  const snap = await loadBookingSnapshot(ref.toUpperCase(), actor)
  if (!snap) throw new OpsError(`Booking ${ref} not found, or outside your country scope.`)
  return { ok: true, message: `Loaded ${snap.bookingRef}.`, data: snap }
}

// ── NAV ───────────────────────────────────────────────────────────────────

async function runOpenBooking(args: Record<string, unknown>, actor: OpsActor): Promise<ExecResult> {
  const ref = str(args, 'bookingRef')
  if (!ref) throw new OpsError('bookingRef is required.')
  await loadBookingForWrite(ref.toUpperCase(), actor)   // existence + scope check
  const href = `/dashboard/bookings/${encodeURIComponent(ref.toUpperCase())}`
  return { ok: true, message: `Opening ${ref.toUpperCase()}`, effect: { type: 'navigate', href } }
}

function runNavigate(args: Record<string, unknown>): ExecResult {
  const path = str(args, 'path')
  if (!path) throw new OpsError('path is required.')
  if (!path.startsWith('/') || path.includes('..') || path.includes('//')) {
    throw new OpsError(`Refusing to navigate to "${path}".`)
  }
  const allowed = NAVIGABLE_ROUTES.some(r => path === r.path || path.startsWith(`${r.path}/`))
  if (!allowed) throw new OpsError(`"${path}" is not a page OPS_AI can open.`)

  const query = (args.query ?? {}) as Record<string, unknown>
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(query)) {
    if (v === null || v === undefined) continue
    if (!/^[a-zA-Z][a-zA-Z0-9_]{0,32}$/.test(k)) continue
    qs.set(k, String(v).slice(0, 200))
  }
  const href = qs.toString() ? `${path}?${qs}` : path
  return { ok: true, message: str(args, 'label') ?? `Opening ${path}`, effect: { type: 'navigate', href } }
}

// ── WRITE ─────────────────────────────────────────────────────────────────

async function runUpdateBookingField(args: Record<string, unknown>, actor: OpsActor): Promise<ExecResult> {
  const ref   = str(args, 'bookingRef')?.toUpperCase()
  const field = str(args, 'field')
  if (!ref)   throw new OpsError('bookingRef is required.')
  if (!field) throw new OpsError('field is required.')

  const spec = EDITABLE_BOOKING_FIELDS[field as keyof typeof EDITABLE_BOOKING_FIELDS]
  if (!spec) throw new OpsError(`"${field}" is not a field OPS_AI may change.`)

  const booking = await loadBookingForWrite(ref, actor)
  const before  = (booking as Record<string, unknown>)[field]
  const value   = coerce(spec.type, args.value, spec.label)

  await prisma.booking.update({ where: { bookingRef: ref }, data: { [field]: value } })

  await logActivity({
    userId: actor.userId,
    action: 'BOOKING_UPDATED',
    entityType: 'Booking',
    entityId: booking.id,
    details: { via: 'OPS_AI', field, before: fmt(before), after: fmt(value) },
  })

  return {
    ok: true,
    message: `${spec.label} on ${ref} is now "${fmt(value) || '—'}".`,
    effect: { type: 'refresh' },
  }
}

async function runAddAgendaItem(args: Record<string, unknown>, actor: OpsActor): Promise<ExecResult> {
  const ref = str(args, 'bookingRef')?.toUpperCase()
  if (!ref) throw new OpsError('bookingRef is required.')
  const location = str(args, 'location')
  if (!location) throw new OpsError('A location or activity name is required.')

  const booking = await loadBookingForWrite(ref, actor)

  // Resolve the target date from either an explicit date or a tour day number.
  let date: Date
  const explicit = str(args, 'date')
  if (explicit) {
    date = coerce('date', explicit, 'date') as Date
  } else {
    const dayNumber = Number(args.dayNumber)
    if (!Number.isInteger(dayNumber) || dayNumber < 1 || dayNumber > 365) {
      throw new OpsError('Give either a date (YYYY-MM-DD) or a dayNumber where day 1 is the arrival day.')
    }
    date = new Date(booking.arrivalDate)
    date.setUTCDate(date.getUTCDate() + dayNumber - 1)
    date.setUTCHours(0, 0, 0, 0)
  }

  if (date < new Date(booking.arrivalDate.getTime() - 86400000) ||
      date > new Date(booking.departureDate.getTime() + 86400000)) {
    throw new OpsError(
      `That date (${date.toISOString().slice(0, 10)}) falls outside the tour window ` +
      `${booking.arrivalDate.toISOString().slice(0, 10)} → ${booking.departureDate.toISOString().slice(0, 10)}.`,
    )
  }

  const agenda = await prisma.tourAgenda.upsert({
    where:  { bookingId: booking.id },
    create: { bookingId: booking.id },
    update: {},
  })

  // Append after the last item on that day so existing rows keep their order.
  const last = await prisma.agendaItem.findFirst({
    where: { agendaId: agenda.id, date },
    orderBy: { sortOrder: 'desc' },
    select: { sortOrder: true },
  })

  const serviceType = str(args, 'serviceType')
  if (serviceType && !(SERVICE_TYPES as readonly string[]).includes(serviceType)) {
    throw new OpsError(`"${serviceType}" is not a valid service type.`)
  }

  const item = await prisma.agendaItem.create({
    data: {
      agendaId:    agenda.id,
      date,
      location:    location.slice(0, 8000),
      details:     str(args, 'details')?.slice(0, 8000),
      fromPoint:   str(args, 'fromPoint')?.slice(0, 8000),
      toPoint:     str(args, 'toPoint')?.slice(0, 8000),
      timeFrom:    hhmm(str(args, 'timeFrom'), 'timeFrom'),
      timeTo:      hhmm(str(args, 'timeTo'), 'timeTo'),
      meetingTime: hhmm(str(args, 'meetingTime'), 'meetingTime'),
      mealPlan:    str(args, 'mealPlan'),
      serviceType: (serviceType as ServiceType) ?? 'OWN_ARRANGEMENT',
      sortOrder:   (last?.sortOrder ?? -1) + 1,
    },
  })

  await logActivity({
    userId: actor.userId,
    action: 'BOOKING_UPDATED',
    entityType: 'AgendaItem',
    entityId: item.id,
    details: { via: 'OPS_AI', op: 'agenda_item_added', bookingRef: ref, date: date.toISOString().slice(0, 10), location },
  })

  return {
    ok: true,
    message: `Added "${location}" to ${ref} on ${date.toISOString().slice(0, 10)}.`,
    effect: { type: 'refresh' },
  }
}

async function runUpdateAgendaItem(args: Record<string, unknown>, actor: OpsActor): Promise<ExecResult> {
  const id = str(args, 'agendaItemId')
  if (!id) throw new OpsError('agendaItemId is required.')

  const item = await prisma.agendaItem.findUnique({
    where: { id },
    include: { agenda: { include: { booking: { select: { bookingRef: true, operationCountry: true } } } } },
  })
  if (!item) throw new OpsError('That agenda item no longer exists.')
  if (!actorMaySee(actor, item.agenda.booking.operationCountry)) {
    throw new OpsError('That agenda item is outside your country scope.')
  }

  const data: Record<string, unknown> = {}
  const changed: string[] = []
  for (const [field, spec] of Object.entries(EDITABLE_AGENDA_FIELDS)) {
    if (args[field] === undefined) continue
    const value = field === 'timeFrom' || field === 'timeTo' || field === 'meetingTime'
      ? hhmm(str(args, field), spec.label)
      : coerce(spec.type, args[field], spec.label)
    data[field] = value
    changed.push(spec.label)
  }
  if (!changed.length) throw new OpsError('Nothing to change — no editable fields were provided.')

  await prisma.agendaItem.update({ where: { id }, data })
  await logActivity({
    userId: actor.userId,
    action: 'BOOKING_UPDATED',
    entityType: 'AgendaItem',
    entityId: id,
    details: { via: 'OPS_AI', op: 'agenda_item_updated', bookingRef: item.agenda.booking.bookingRef, fields: changed },
  })

  return {
    ok: true,
    message: `Updated ${changed.join(', ')} on that agenda item.`,
    effect: { type: 'refresh' },
  }
}

async function runUpdateAccommodation(args: Record<string, unknown>, actor: OpsActor): Promise<ExecResult> {
  const id = str(args, 'accommodationId')
  if (!id) throw new OpsError('accommodationId is required.')

  const acc = await prisma.accommodation.findUnique({
    where: { id },
    include: { booking: { select: { bookingRef: true, operationCountry: true } } },
  })
  if (!acc) throw new OpsError('That accommodation row no longer exists.')
  if (!actorMaySee(actor, acc.booking.operationCountry)) {
    throw new OpsError('That accommodation is outside your country scope.')
  }

  const data: Record<string, unknown> = {}
  const changed: string[] = []
  for (const [field, spec] of Object.entries(EDITABLE_ACCOMMODATION_FIELDS)) {
    if (args[field] === undefined) continue
    data[field] = coerce(spec.type, args[field], spec.label)
    changed.push(spec.label)
  }
  if (!changed.length) throw new OpsError('Nothing to change — no editable fields were provided.')

  await prisma.accommodation.update({ where: { id }, data })
  await logActivity({
    userId: actor.userId,
    action: 'BOOKING_UPDATED',
    entityType: 'Accommodation',
    entityId: id,
    details: { via: 'OPS_AI', op: 'accommodation_updated', bookingRef: acc.booking.bookingRef, fields: changed },
  })

  return { ok: true, message: `Updated ${changed.join(', ')} on ${acc.hotel}.`, effect: { type: 'refresh' } }
}

async function runAssignDriver(args: Record<string, unknown>, actor: OpsActor): Promise<ExecResult> {
  const id = str(args, 'agendaItemId')
  if (!id) throw new OpsError('agendaItemId is required.')

  const item = await prisma.agendaItem.findUnique({
    where: { id },
    include: { agenda: { include: { booking: { select: { bookingRef: true, operationCountry: true } } } } },
  })
  if (!item) throw new OpsError('That agenda item no longer exists.')
  if (!actorMaySee(actor, item.agenda.booking.operationCountry)) {
    throw new OpsError('That agenda item is outside your country scope.')
  }

  const payload = {
    driverName:   str(args, 'driverName')   ?? null,
    driverPhone:  str(args, 'driverPhone')  ?? null,
    vehicleType:  str(args, 'vehicleType')  ?? null,
    vehiclePlate: str(args, 'vehiclePlate') ?? null,
    vendorName:   str(args, 'vendorName')   ?? null,
    notes:        str(args, 'notes')        ?? null,
  }
  if (!payload.driverName && !payload.vendorName) {
    throw new OpsError('Give at least a driver name or a vendor name.')
  }

  await prisma.assignment.upsert({
    where:  { agendaItemId: id },
    create: { agendaItemId: id, ...payload },
    update: payload,
  })

  await logActivity({
    userId: actor.userId,
    action: 'BOOKING_UPDATED',
    entityType: 'Assignment',
    entityId: id,
    details: { via: 'OPS_AI', op: 'driver_assigned', bookingRef: item.agenda.booking.bookingRef, ...payload },
  })

  return {
    ok: true,
    message: `Assigned ${payload.driverName ?? payload.vendorName} to "${item.location.slice(0, 60)}".`,
    effect: { type: 'refresh' },
  }
}

async function runCreateReminder(args: Record<string, unknown>, actor: OpsActor): Promise<ExecResult> {
  const ref = str(args, 'bookingRef')?.toUpperCase()
  const title = str(args, 'title')
  const when  = str(args, 'scheduledAt')
  if (!ref)   throw new OpsError('bookingRef is required.')
  if (!title) throw new OpsError('title is required.')
  if (!when)  throw new OpsError('scheduledAt is required.')

  const booking = await loadBookingForWrite(ref, actor)
  const scheduledAt = new Date(when)
  if (Number.isNaN(scheduledAt.getTime())) throw new OpsError(`"${when}" is not a valid date/time.`)

  const reminder = await prisma.reminder.create({
    data: {
      bookingId:   booking.id,
      userId:      actor.userId,
      type:        str(args, 'type') ?? 'FOLLOW_UP',
      title,
      message:     str(args, 'message') ?? null,
      scheduledAt,
    },
  })

  await logActivity({
    userId: actor.userId, action: 'BOOKING_UPDATED', entityType: 'Reminder', entityId: reminder.id,
    details: { via: 'OPS_AI', op: 'reminder_created', bookingRef: ref, title },
  })

  return { ok: true, message: `Reminder "${title}" set for ${scheduledAt.toLocaleString()}.`, effect: { type: 'refresh' } }
}

async function runLogContact(args: Record<string, unknown>, actor: OpsActor): Promise<ExecResult> {
  const ref     = str(args, 'bookingRef')?.toUpperCase()
  const subject = str(args, 'subject')
  if (!ref)     throw new OpsError('bookingRef is required.')
  if (!subject) throw new OpsError('subject is required.')

  const booking = await loadBookingForWrite(ref, actor)
  const log = await prisma.contactLog.create({
    data: {
      bookingId: booking.id,
      userId:    actor.userId,
      type:      (str(args, 'type') ?? 'OTHER').toUpperCase(),
      subject,
      notes:     str(args, 'notes') ?? null,
    },
  })

  await logActivity({
    userId: actor.userId, action: 'BOOKING_UPDATED', entityType: 'ContactLog', entityId: log.id,
    details: { via: 'OPS_AI', op: 'contact_logged', bookingRef: ref, subject },
  })

  return { ok: true, message: `Contact logged against ${ref}.`, effect: { type: 'refresh' } }
}

// ── Helpers ───────────────────────────────────────────────────────────────

function fmt(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  if (typeof v === 'object' && 'toString' in (v as object)) return String(v)
  return String(v)
}

/**
 * Builds the human-readable "before → after" preview shown on a WRITE action
 * card, so nothing is executed on trust alone. Read-only.
 */
export async function previewAction(
  toolName: string,
  args: Record<string, unknown>,
  actor: OpsActor,
): Promise<{ title: string; lines: { label: string; before?: string; after: string }[] } | null> {
  const tool = OPS_TOOLS[toolName]
  if (!tool || tool.kind !== 'WRITE') return null

  try {
    if (toolName === 'update_booking_field') {
      const ref   = str(args, 'bookingRef')?.toUpperCase()
      const field = str(args, 'field') ?? ''
      const spec  = EDITABLE_BOOKING_FIELDS[field as keyof typeof EDITABLE_BOOKING_FIELDS]
      if (!ref || !spec) return null
      const booking = await prisma.booking.findUnique({ where: { bookingRef: ref } })
      if (!booking || !actorMaySee(actor, booking.operationCountry)) return null
      return {
        title: `${ref} · ${spec.label}`,
        lines: [{ label: spec.label, before: fmt((booking as Record<string, unknown>)[field]) || '—', after: String(args.value ?? '') || '—' }],
      }
    }

    if (toolName === 'add_agenda_item') {
      const ref = str(args, 'bookingRef')?.toUpperCase()
      if (!ref) return null
      const booking = await prisma.booking.findUnique({ where: { bookingRef: ref } })
      if (!booking || !actorMaySee(actor, booking.operationCountry)) return null
      let dateLabel = str(args, 'date') ?? ''
      if (!dateLabel && Number.isInteger(Number(args.dayNumber))) {
        const d = new Date(booking.arrivalDate)
        d.setUTCDate(d.getUTCDate() + Number(args.dayNumber) - 1)
        dateLabel = `${d.toISOString().slice(0, 10)} (day ${Number(args.dayNumber)})`
      }
      const lines = [
        { label: 'Date',     after: dateLabel || '—' },
        { label: 'Activity', after: str(args, 'location') ?? '—' },
      ]
      const details = str(args, 'details');      if (details) lines.push({ label: 'Details', after: details })
      const svc     = str(args, 'serviceType');  if (svc)     lines.push({ label: 'Service', after: svc })
      const tf      = str(args, 'timeFrom')
      const tt      = str(args, 'timeTo')
      if (tf || tt) lines.push({ label: 'Time', after: `${tf ?? '?'} – ${tt ?? '?'}` })
      const meal    = str(args, 'mealPlan');     if (meal)    lines.push({ label: 'Meals', after: meal })
      return { title: `${ref} · new agenda item`, lines }
    }

    if (toolName === 'update_agenda_item' || toolName === 'assign_driver') {
      const item = await prisma.agendaItem.findUnique({
        where: { id: str(args, 'agendaItemId') ?? '' },
        include: { assignment: true, agenda: { include: { booking: { select: { bookingRef: true, operationCountry: true } } } } },
      })
      if (!item || !actorMaySee(actor, item.agenda.booking.operationCountry)) return null

      if (toolName === 'assign_driver') {
        return {
          title: `${item.agenda.booking.bookingRef} · ${item.location.slice(0, 50)}`,
          lines: [
            { label: 'Driver',  before: item.assignment?.driverName ?? '—',   after: str(args, 'driverName') ?? item.assignment?.driverName ?? '—' },
            { label: 'Phone',   before: item.assignment?.driverPhone ?? '—',  after: str(args, 'driverPhone') ?? item.assignment?.driverPhone ?? '—' },
            { label: 'Vehicle', before: item.assignment?.vehiclePlate ?? '—', after: str(args, 'vehiclePlate') ?? item.assignment?.vehiclePlate ?? '—' },
          ],
        }
      }

      const lines: { label: string; before?: string; after: string }[] = []
      for (const [field, spec] of Object.entries(EDITABLE_AGENDA_FIELDS)) {
        if (args[field] === undefined) continue
        lines.push({ label: spec.label, before: fmt((item as Record<string, unknown>)[field]) || '—', after: String(args[field]) })
      }
      return { title: `${item.agenda.booking.bookingRef} · ${item.location.slice(0, 50)}`, lines }
    }

    if (toolName === 'update_accommodation') {
      const acc = await prisma.accommodation.findUnique({
        where: { id: str(args, 'accommodationId') ?? '' },
        include: { booking: { select: { bookingRef: true, operationCountry: true } } },
      })
      if (!acc || !actorMaySee(actor, acc.booking.operationCountry)) return null
      const lines: { label: string; before?: string; after: string }[] = []
      for (const [field, spec] of Object.entries(EDITABLE_ACCOMMODATION_FIELDS)) {
        if (args[field] === undefined) continue
        lines.push({ label: spec.label, before: fmt((acc as Record<string, unknown>)[field]) || '—', after: String(args[field]) })
      }
      return { title: `${acc.booking.bookingRef} · ${acc.hotel}`, lines }
    }

    if (toolName === 'create_reminder') {
      return {
        title: `${str(args, 'bookingRef') ?? ''} · reminder`,
        lines: [
          { label: 'Title', after: str(args, 'title') ?? '—' },
          { label: 'When',  after: str(args, 'scheduledAt') ?? '—' },
          ...(str(args, 'message') ? [{ label: 'Note', after: str(args, 'message')! }] : []),
        ],
      }
    }

    if (toolName === 'log_contact') {
      return {
        title: `${str(args, 'bookingRef') ?? ''} · contact log`,
        lines: [
          { label: 'Channel', after: str(args, 'type') ?? 'OTHER' },
          { label: 'Subject', after: str(args, 'subject') ?? '—' },
          ...(str(args, 'notes') ? [{ label: 'Notes', after: str(args, 'notes')! }] : []),
        ],
      }
    }
  } catch {
    // A preview is a nicety — never let it block the action card from rendering.
  }
  return null
}
