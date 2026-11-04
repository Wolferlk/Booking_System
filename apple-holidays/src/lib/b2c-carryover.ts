/**
 * Aahaas B2C **carry-over** — move the team's work from a replaced store
 * version onto the active booking, after Travel Experience has checked it.
 *
 * When the customer amends a booking in the store, the new version becomes its
 * own ops booking (see b2c-version-links): 15726 (V1, replaced) → 15833 (V2,
 * active). The store data on V2 is new, but everything the TEAM did on V1 is
 * not in the store and would be lost: hotel reconfirmations, the AI-call plan,
 * the custom daily-message time, notes and contacts typed in by hand.
 *
 * ── Same shape as the B2B update (as-booking-sync.ts) ───────────────────────
 *   preview → every proposed carry-over item, nothing written
 *   apply   → only the ticked items, with any value TE edited, refused if the
 *             preview went stale (fingerprint) — nobody applies what they
 *             didn't see
 *
 * Pre-ticking follows the three-way rule: V2 empty → carry (pre-ticked);
 * V2 already holds something different → shown, NOT pre-ticked, TE decides
 * (and can edit the value). Store-sourced fields (dates, pax, hotels, prices)
 * are never carried — the amendment is the point.
 *
 * ── Live data safety ────────────────────────────────────────────────────────
 *   • No schema change: state lives in system_settings (`b2c_carryover:{ref}`).
 *   • Nothing is deleted, anywhere. V2 only gains rows / fills fields; the only
 *     writes to V1 are the two explicit "old version" items (pause its AI calls,
 *     stop its daily messages, cancel its stale queued messages) — all
 *     reversible, all un-tickable.
 *   • Ops DB writes for V2 happen in ONE transaction; the booking is snapshotted
 *     as a new version afterwards. AI-call service calls (external) run after
 *     the transaction and each one's result is recorded on its own.
 *   • Applying needs a Travel Experience (or admin) role, and it is recorded:
 *     who confirmed, when, and every item's result.
 */
import { createHash } from 'crypto'
import type { Prisma } from '@prisma/client'
import { prisma } from './prisma'
import { buildStayKey } from './precheck-shared'
import { passengerNameKey } from './passenger-note-key'
import { SETTING_BRIEFING_TIME_PREFIX } from './customer-whatsapp-automation'
import { tePatch, tePost } from './te/te-api'
import { appendVersionAndSnapshot, snapshotInitialVersion } from './booking-versions'
import { logActivity } from './activity'
import { getVersionLinks, refreshVersionLinks, type B2cVersionLink } from './b2c-version-links'

export const B2C_CARRYOVER_PREFIX = 'b2c_carryover:'

/** Who may confirm a carry-over: Travel Experience, plus admins. */
export const CARRYOVER_CONFIRM_ROLES = ['TE_USER', 'GT_TE_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN'] as const

export type CarryGroup = 'Manual edits' | 'Guest notes & contacts' | 'Hotel reconfirmations' | 'AI calls' | 'Daily WhatsApp' | 'Old version'

export interface CarryItem {
  key: string
  group: CarryGroup
  label: string
  /** What the replaced booking has. */
  from: string | null
  /** What the active booking has now. */
  to: string | null
  /** The value that will be written (editable items take TE's edit instead). */
  value: string | null
  editable: boolean
  recommended: boolean
  warning?: string
}

export interface CarryState {
  fromRef: string
  toRef: string
  at: string
  by: string
  byRole: string
  applied: { key: string; label: string; ok: boolean; note?: string }[]
  skipped: string[]
  newVersion: number | null
}

export interface CarryPreview {
  fromRef: string
  toRef: string
  items: CarryItem[]
  /** Read-only facts TE should know (results of V1's calls, what is NOT carried). */
  info: string[]
  fingerprint: string
  state: CarryState | null
}

export class CarryOverError extends Error {
  constructor(message: string, public status = 400) { super(message) }
}

// ── Fields ───────────────────────────────────────────────────────────────────

/** Typed in ops only — the store never sends these. */
const OPS_FIELDS: { key: string; label: string; long?: boolean }[] = [
  { key: 'chauffeurContact', label: 'Chauffeur / tour guide contact', long: true },
  { key: 'fileHandler', label: 'File handler' },
  { key: 'checkedBy', label: 'Booking confirmed by' },
  { key: 'reconfirmBy', label: 'Operation ready by' },
  { key: 'languagePreference', label: 'Language preference' },
  { key: 'specialOccasions', label: 'Special occasions', long: true },
  { key: 'dealName', label: 'Deal name' },
  { key: 'cntlNumber', label: 'CNTL no.' },
  { key: 'agentBookingId', label: 'Agent ref. no.' },
  { key: 'onedriveFolderUrl', label: 'Drive folder' },
  { key: 'valueAddedServices', label: 'Value added services', long: true },
  { key: 'packageIncludes', label: 'Package includes', long: true },
  { key: 'packageExcludes', label: 'Package excludes', long: true },
  { key: 'terms', label: 'Terms', long: true },
  { key: 'exclusions', label: 'Exclusions', long: true },
  { key: 'policyNotes', label: 'Policy notes', long: true },
  { key: 'importantNotes', label: 'Important notes', long: true },
  { key: 'tips', label: 'Tips', long: true },
  { key: 'otherNote', label: 'Other note', long: true },
  { key: 'clientRequest', label: 'Client request', long: true },
]

/** Store-sourced, but ops often corrects them — offered, never pre-ticked when V2 has a value. */
const CONTACT_FIELDS: { key: string; label: string }[] = [
  { key: 'contactWhatsapp', label: 'Guest WhatsApp' },
  { key: 'contactPhone', label: 'Guest contact number' },
  { key: 'contactEmail', label: 'Guest email' },
]

const ALL_FIELD_KEYS = new Set([...OPS_FIELDS, ...CONTACT_FIELDS].map((f) => f.key))

const norm = (v: unknown) => (v == null ? '' : String(v).replace(/\r\n/g, '\n').trim())
const digits = (v: unknown) => norm(v).replace(/\D/g, '')

// ── Loading ──────────────────────────────────────────────────────────────────

const bookingSelect = {
  id: true, bookingRef: true, agent: true, status: true, version: true, arrivalDate: true, departureDate: true,
  ...Object.fromEntries(Array.from(ALL_FIELD_KEYS).map((k) => [k, true])),
  passengers: { select: { name: true } },
  emergencyContacts: { select: { name: true, phone: true, role: true }, orderBy: { id: 'asc' } },
  accommodations: { select: { id: true, hotel: true, checkIn: true, checkOut: true, nights: true, roomType: true, mealType: true }, orderBy: { checkIn: 'asc' } },
  _count: { select: { tickets: true, payments: true } },
  tourAgenda: { select: { _count: { select: { items: true } } } },
  slDriverAllocation: { select: { id: true } },
} satisfies Prisma.BookingSelect

type Loaded = Prisma.BookingGetPayload<{ select: typeof bookingSelect }>

async function loadBooking(ref: string): Promise<Loaded> {
  const b = await prisma.booking.findUnique({ where: { bookingRef: ref }, select: bookingSelect })
  if (!b) throw new CarryOverError(`Booking ${ref} not found`, 404)
  return b
}

/** The replaced booking to carry from: the newest older version that has an ops booking. */
async function resolvePair(toRef: string, fromRef?: string | null): Promise<{ link: B2cVersionLink; fromRef: string }> {
  let link = (await getVersionLinks([toRef])).get(toRef) ?? null
  if (!link) link = (await refreshVersionLinks([toRef]).catch(() => new Map<string, B2cVersionLink>())).get(toRef) ?? null
  if (!link) throw new CarryOverError('This booking has no earlier store version in ops.', 404)
  if (link.state !== 'active') throw new CarryOverError(`Booking ${toRef} is a replaced version — carry over onto ${link.activeRef ?? 'the active booking'} instead.`, 409)
  const me = link.versions.find((v) => v.ref === toRef)
  const older = link.versions.filter((v) => v.ref && v.ref !== toRef && v.version < (me?.version ?? Infinity))
  const pick = fromRef ? older.find((v) => v.ref === fromRef) : older[older.length - 1]
  if (!pick?.ref) throw new CarryOverError(fromRef ? `${fromRef} is not an earlier version of ${toRef}.` : 'No earlier version of this booking is in ops.', 404)
  return { link, fromRef: pick.ref }
}

async function safe<T>(work: Promise<T>, fallback: T): Promise<T> {
  try { return await work } catch { return fallback }
}

// ── Preview ──────────────────────────────────────────────────────────────────

interface Plan {
  preview: CarryPreview
  from: Loaded
  to: Loaded
  /** Data the apply step needs per item key. */
  payload: Map<string, unknown>
}

async function plan(toRef: string, fromRefHint?: string | null): Promise<Plan> {
  const { fromRef } = await resolvePair(toRef, fromRefHint)
  const [from, to] = await Promise.all([loadBooking(fromRef), loadBooking(toRef)])
  const items: CarryItem[] = []
  const info: string[] = []
  const payload = new Map<string, unknown>()

  // 1. Fields typed in by hand ------------------------------------------------
  const fieldSets: [typeof OPS_FIELDS, CarryGroup, boolean][] = [
    [OPS_FIELDS, 'Manual edits', false],
    [CONTACT_FIELDS, 'Guest notes & contacts', true],
  ]
  for (const [list, group, storeSourced] of fieldSets) {
    for (const f of list) {
      const a = norm((from as Record<string, unknown>)[f.key])
      const b = norm((to as Record<string, unknown>)[f.key])
      if (!a) continue
      const same = storeSourced ? (digits(a) && digits(a) === digits(b)) || a.toLowerCase() === b.toLowerCase() : a === b
      if (same) continue
      items.push({
        key: `field:${f.key}`, group, label: f.label,
        from: a, to: b || null, value: a, editable: true,
        recommended: !b,
        warning: b ? `The updated booking already says "${b.slice(0, 80)}${b.length > 80 ? '…' : ''}" — keep it unless the old value is right.` : undefined,
      })
    }
  }

  // 2. Passenger special notes -----------------------------------------------
  const [fromNotes, toNotes] = await Promise.all([
    safe(prisma.passengerSpecialNote.findMany({ where: { bookingRef: fromRef }, orderBy: { nameKey: 'asc' } }), [] as { nameKey: string; passengerName: string; note: string }[]),
    safe(prisma.passengerSpecialNote.findMany({ where: { bookingRef: toRef } }), [] as { nameKey: string; passengerName: string; note: string }[]),
  ])
  const toNoteKeys = new Map(toNotes.map((n) => [n.nameKey, n.note]))
  const toPaxKeys = new Set(to.passengers.map((p) => passengerNameKey(p.name)))
  for (const n of fromNotes) {
    if (norm(toNoteKeys.get(n.nameKey)) === norm(n.note)) continue
    const key = `paxnote:${n.nameKey}`
    const onV2 = toPaxKeys.has(n.nameKey)
    items.push({
      key, group: 'Guest notes & contacts', label: `Special note · ${n.passengerName}`,
      from: n.note, to: toNoteKeys.get(n.nameKey) ?? null, value: n.note, editable: true,
      recommended: onV2 && !toNoteKeys.has(n.nameKey),
      warning: !onV2 ? `${n.passengerName} is not on the updated passenger list (name changed or removed).` : toNoteKeys.has(n.nameKey) ? 'The updated booking already has a different note for this guest.' : undefined,
    })
    payload.set(key, { nameKey: n.nameKey, passengerName: n.passengerName })
  }

  // 3. Emergency contacts ------------------------------------------------------
  const toContact = new Set(to.emergencyContacts.map((c) => digits(c.phone) || c.name.toLowerCase()))
  from.emergencyContacts.forEach((c, i) => {
    if (toContact.has(digits(c.phone) || c.name.toLowerCase())) return
    const key = `emergency:${i}`
    items.push({
      key, group: 'Guest notes & contacts', label: `Emergency contact · ${c.name}`,
      from: [c.name, c.phone, c.role].filter(Boolean).join(' · '), to: null, value: null, editable: false, recommended: true,
    })
    payload.set(key, c)
  })

  // 4. Reconfirm delay note ----------------------------------------------------
  const [fromDelay, toDelay] = await Promise.all([
    safe(prisma.bookingReconfirmDelay.findUnique({ where: { bookingRef: fromRef } }), null),
    safe(prisma.bookingReconfirmDelay.findUnique({ where: { bookingRef: toRef } }), null),
  ])
  if (fromDelay && !toDelay) {
    items.push({
      key: 'reconfirm-delay', group: 'Hotel reconfirmations', label: 'Client reconfirmation delay',
      from: `${fromDelay.reason}${fromDelay.note ? ` — ${fromDelay.note}` : ''}${fromDelay.dueAt ? ` (due ${fromDelay.dueAt.toISOString().slice(0, 10)})` : ''}`,
      to: null, value: null, editable: false, recommended: true,
    })
    payload.set('reconfirm-delay', fromDelay)
  }

  // 5. Hotel reconfirmations ---------------------------------------------------
  const [fromRec, toRec] = await Promise.all([
    safe(prisma.hotelReconfirmation.findMany({ where: { bookingRef: fromRef }, orderBy: [{ checkIn: 'asc' }, { stayKey: 'asc' }] }), []),
    safe(prisma.hotelReconfirmation.findMany({ where: { bookingRef: toRef }, select: { stayKey: true, status: true } }), [] as { stayKey: string; status: string }[]),
  ])
  const toRecByKey = new Map(toRec.map((r) => [r.stayKey, r.status]))
  for (const r of fromRec) {
    const worked = r.status !== 'PENDING' || r.confirmationNumber || r.notes || r.attempts > 0
    if (!worked) continue
    const newKey = buildStayKey(toRef, r.hotelName, r.checkIn)
    const stay = to.accommodations.find((a) => buildStayKey(toRef, a.hotel, a.checkIn) === newKey)
    const what = `${r.hotelName} · ${r.checkIn.toISOString().slice(0, 10)} · ${r.status}${r.confirmationNumber ? ` · conf ${r.confirmationNumber}` : ''}`
    if (!stay) {
      info.push(`Hotel reconfirmation NOT carried: ${what} — this stay is not in the updated booking (hotel or check-in changed). Tell the hotel and reconfirm the new stay.`)
      continue
    }
    const existing = toRecByKey.get(newKey)
    if (existing && existing !== 'PENDING') continue   // already worked on V2
    const changed = stay.nights !== r.nights || norm(stay.roomType) !== norm(r.roomType) || norm(stay.mealType) !== norm(r.mealType)
    const key = `hotel:${newKey}`
    items.push({
      key, group: 'Hotel reconfirmations', label: `Reconfirmation · ${r.hotelName}`,
      from: what, to: existing ? 'Pending' : 'Not started', value: null, editable: false,
      recommended: !changed,
      warning: changed ? `Stay changed (${r.nights}N ${r.roomType ?? ''} → ${stay.nights}N ${stay.roomType ?? ''}) — the old confirmation may not cover it. Reconfirm with the hotel.` : undefined,
    })
    payload.set(key, { rec: r, stay, newKey })
  }

  // 6. AI calls -----------------------------------------------------------------
  const [fromSvc, toSvc, toEngage] = await Promise.all([
    safe(prisma.tbl_te_service.findUnique({ where: { booking_ref: fromRef } }), null),
    safe(prisma.tbl_te_service.findUnique({ where: { booking_ref: toRef } }), null),
    safe(prisma.systemSetting.findUnique({ where: { key: 'b2c_guest_engage:' + toRef } }), null),
  ])
  if (fromSvc) {
    const planOf = (s: NonNullable<typeof fromSvc>) =>
      [
        `${s.schedule_mode === 'interval' ? `every ${s.interval_count} ${s.interval_unit}` : 'daily'} at ${s.call_time}`,
        s.reconfirm_enabled ? `reconfirm ${s.reconfirm_days_before ?? 5}d before${s.reconfirm_call_time ? ` at ${s.reconfirm_call_time}` : ''}` : 'no reconfirm call',
        s.post_tour_enabled ? `post-tour ${s.post_tour_days_after ?? 3}d after${s.post_tour_call_time ? ` at ${s.post_tour_call_time}` : ''}` : 'no post-tour call',
        `phone ${s.call_phone || s.customer_phone || '—'}`,
      ].join(' · ')
    const fromPlan = planOf(fromSvc)
    const staffStopped = fromSvc.status !== 'active'
    if (!toSvc) {
      items.push({
        key: 'ai:register', group: 'AI calls', label: `Register AI calls on ${toRef} with the old plan`,
        from: `${fromSvc.status} · ${fromPlan}`, to: 'Not registered', value: null, editable: false,
        recommended: !staffStopped,
        warning: staffStopped ? `Calls on ${fromRef} were ${fromSvc.status} by staff — only register if that no longer applies.` : undefined,
      })
    } else if (planOf(toSvc) !== fromPlan) {
      const autoRegistered = /"outcome":"registered"/.test(toEngage?.value ?? '')
      items.push({
        key: 'ai:plan', group: 'AI calls', label: `Use the old call plan on ${toRef}`,
        from: fromPlan, to: `${toSvc.status} · ${planOf(toSvc)}`, value: null, editable: false,
        recommended: autoRegistered && !staffStopped,
        warning: autoRegistered ? undefined : `${toRef} was registered by hand — its plan may be deliberate.`,
      })
    }
    payload.set('ai:svc', fromSvc)
    if (fromSvc.status === 'active') {
      items.push({
        key: 'old:pause-calls', group: 'Old version', label: `Pause AI calls on old booking ${fromRef}`,
        from: 'active', to: 'paused', value: null, editable: false, recommended: true,
        warning: 'Otherwise the guest is called for both versions.',
      })
    }
    // What V1's calls already learned — shown, never copied.
    const rec = await safe(prisma.tbl_te_reconfirmation.findFirst({ where: { booking_ref: fromRef }, orderBy: { created_at: 'desc' } }), null)
    if (rec) {
      const bits = [
        rec.outcome && `outcome ${rec.outcome}`,
        rec.dates_ok && `dates ${rec.dates_ok}`, rec.flight_ok && `flight ${rec.flight_ok}`, rec.pax_ok && `pax ${rec.pax_ok}`,
        rec.requested_change && `asked to change: "${rec.requested_change}"`,
        rec.special_requests && `special requests: "${rec.special_requests}"`,
      ].filter(Boolean)
      info.push(`Reconfirmation call on ${fromRef} (${rec.created_at.toISOString().slice(0, 10)}): ${bits.join(' · ') || rec.summary || 'no details'}. Check the updated booking covers it.`)
    }
  }

  // 7. Daily WhatsApp ----------------------------------------------------------
  const [fromTime, toTime] = await Promise.all([
    safe(prisma.systemSetting.findUnique({ where: { key: SETTING_BRIEFING_TIME_PREFIX + fromRef } }), null),
    safe(prisma.systemSetting.findUnique({ where: { key: SETTING_BRIEFING_TIME_PREFIX + toRef } }), null),
  ])
  const fromT = norm(fromTime?.value)
  const toT = norm(toTime?.value)
  // "OFF" on V1 may be the old-version stop itself (applied earlier) — never carry that.
  if (fromT && fromT !== 'OFF' && fromT !== toT) {
    items.push({
      key: 'daily:time', group: 'Daily WhatsApp', label: 'Custom daily message time',
      from: fromT, to: toT || 'Default time', value: fromT, editable: true, recommended: !toT,
      warning: toT ? `${toRef} already has its own time (${toT}).` : undefined,
    })
  }
  if (fromT !== 'OFF') {
    items.push({
      key: 'old:daily-off', group: 'Old version', label: `Stop daily WhatsApp messages on old booking ${fromRef}`,
      from: fromT || 'Default time', to: 'OFF', value: null, editable: false, recommended: true,
      warning: 'Otherwise the guest gets the old plan as well as the new one.',
    })
  }
  const queued = await safe(prisma.whatsAppMessage.count({ where: { bookingRef: fromRef, direction: 'outbound', status: 'pending' } }), 0)
  if (queued > 0) {
    items.push({
      key: 'old:queue-cancel', group: 'Old version', label: `Cancel ${queued} queued WhatsApp message${queued > 1 ? 's' : ''} on ${fromRef}`,
      from: `${queued} waiting for the guest's reply`, to: 'cancelled', value: null, editable: false, recommended: true,
      warning: 'They were written for the old version. Re-send from the updated booking if still needed.',
    })
  }

  // 8. Not carried — say so ----------------------------------------------------
  const agendaItems = from.tourAgenda?._count.items ?? 0
  if (agendaItems > 0) info.push(`${fromRef} has an agenda with ${agendaItems} item(s) and its driver / vehicle assignments — not copied (the trip may have changed). Rebuild or check the agenda on ${toRef}.`)
  if (from._count.tickets > 0) info.push(`${fromRef} has ${from._count.tickets} ticket(s) — not moved. Check them against ${toRef}.`)
  if (from._count.payments > 0) info.push(`${fromRef} has ${from._count.payments} payment record(s) — Accounts keeps these on the chain; not moved.`)
  if (from.slDriverAllocation) info.push(`${fromRef} has a Sri Lanka driver allocation — not moved. Allocate on ${toRef}.`)

  const fingerprint = createHash('sha256')
    .update(JSON.stringify(items.map((i) => [i.key, i.from, i.to, i.value])))
    .digest('hex').slice(0, 24)

  return {
    preview: { fromRef, toRef, items, info, fingerprint, state: await getCarryState(toRef) },
    from, to, payload,
  }
}

export async function previewCarryOver(toRef: string, fromRef?: string | null): Promise<CarryPreview> {
  return (await plan(toRef, fromRef)).preview
}

// ── State ────────────────────────────────────────────────────────────────────

export async function getCarryState(toRef: string): Promise<CarryState | null> {
  const row = await prisma.systemSetting.findUnique({ where: { key: B2C_CARRYOVER_PREFIX + toRef } }).catch(() => null)
  try { return row?.value ? (JSON.parse(row.value) as CarryState) : null } catch { return null }
}

// ── Apply ────────────────────────────────────────────────────────────────────

export async function applyCarryOver(params: {
  toRef: string
  fromRef: string
  fingerprint: string
  selection: { key: string; value?: string | null }[]
  actor: { id: string; name: string; role: string }
}): Promise<CarryState> {
  const { toRef, actor } = params
  if (!(CARRYOVER_CONFIRM_ROLES as readonly string[]).includes(actor.role)) {
    throw new CarryOverError('Only Travel Experience (or an admin) can confirm a carry-over.', 403)
  }
  const p = await plan(toRef, params.fromRef)
  if (p.preview.fingerprint !== params.fingerprint) {
    throw new CarryOverError('Something changed on one of the bookings since you opened this review. Reload and check again.', 409)
  }
  const byKey = new Map(p.preview.items.map((i) => [i.key, i]))
  const picked = params.selection.filter((s) => byKey.has(s.key))
  const valueOf = (s: { key: string; value?: string | null }) => {
    const item = byKey.get(s.key)!
    return item.editable && s.value !== undefined ? norm(s.value) : norm(item.value)
  }
  const fromRef = p.preview.fromRef
  const results: CarryState['applied'] = []
  const note = `Carried over from ${fromRef} (store amendment) — confirmed by ${actor.name}`

  // ── Ops DB writes for the active booking: one transaction ──────────────────
  const fieldData: Record<string, string | null> = {}
  for (const s of picked.filter((s) => s.key.startsWith('field:'))) {
    const k = s.key.slice('field:'.length)
    if (ALL_FIELD_KEYS.has(k)) fieldData[k] = valueOf(s) || null
  }
  if (Object.keys(fieldData).length) {
    const hasVersion = await prisma.bookingVersion.count({ where: { bookingId: p.to.id } })
    if (!hasVersion) await snapshotInitialVersion(p.to.id, { createdById: actor.id, source: 'b2c' }).catch(() => null)
  }

  const dbKeys = picked.filter((s) => /^(field:|paxnote:|emergency:|hotel:|reconfirm-delay$|daily:time$|old:daily-off$|old:queue-cancel$)/.test(s.key))
  await prisma.$transaction(async (tx) => {
    if (Object.keys(fieldData).length) {
      await tx.booking.update({ where: { id: p.to.id }, data: fieldData })
    }
    for (const s of dbKeys) {
      const item = byKey.get(s.key)!
      if (s.key.startsWith('paxnote:')) {
        const { nameKey, passengerName } = p.payload.get(s.key) as { nameKey: string; passengerName: string }
        const text = valueOf(s).slice(0, 1000)
        if (!text) continue
        await tx.passengerSpecialNote.upsert({
          where: { bookingRef_nameKey: { bookingRef: toRef, nameKey } },
          create: { bookingRef: toRef, nameKey, passengerName: passengerName.slice(0, 191), note: text, updatedById: actor.id, updatedByName: actor.name },
          update: { note: text, updatedById: actor.id, updatedByName: actor.name },
        })
      } else if (s.key.startsWith('emergency:')) {
        const c = p.payload.get(s.key) as { name: string; phone: string | null; role: string | null }
        await tx.emergencyContact.create({ data: { bookingId: p.to.id, name: c.name, phone: c.phone, role: c.role } })
      } else if (s.key === 'reconfirm-delay') {
        const d = p.payload.get(s.key) as { reason: string; note: string | null; dueAt: Date | null }
        await tx.bookingReconfirmDelay.create({
          data: { bookingRef: toRef, reason: d.reason, note: [d.note, `(${note})`].filter(Boolean).join(' '), dueAt: d.dueAt, recordedBy: actor.name },
        })
      } else if (s.key.startsWith('hotel:')) {
        const { rec, stay, newKey } = p.payload.get(s.key) as {
          rec: Awaited<ReturnType<typeof prisma.hotelReconfirmation.findMany>>[number]
          stay: Loaded['accommodations'][number]
          newKey: string
        }
        const carried = {
          bookingRef: toRef, accommodationId: stay.id, hotelProfileId: rec.hotelProfileId, hotelName: rec.hotelName, city: rec.city,
          checkIn: stay.checkIn, checkOut: stay.checkOut, nights: stay.nights,
          roomType: stay.roomType ?? rec.roomType, roomCategory: rec.roomCategory, roomCount: rec.roomCount,
          mealType: stay.mealType ?? rec.mealType, adults: rec.adults, children: rec.children, cwb: rec.cwb, cnb: rec.cnb, infants: rec.infants,
          status: rec.status, confirmationNumber: rec.confirmationNumber, lastChannel: rec.lastChannel, attempts: rec.attempts,
          lastCheckedAt: rec.lastCheckedAt, lastCheckedBy: rec.lastCheckedBy, dueAtOverride: rec.dueAtOverride, followUpAt: rec.followUpAt,
          discrepancyNote: rec.discrepancyNote,
          notes: [rec.notes, `[${note}]`].filter(Boolean).join('\n'),
          updatedBy: actor.name,
        }
        const row = await tx.hotelReconfirmation.upsert({
          where: { stayKey: newKey },
          create: { stayKey: newKey, ...carried, createdBy: actor.name },
          update: carried,
        })
        await tx.hotelReconfirmationEvent.create({
          data: { reconfirmId: row.id, action: 'CARRIED_OVER', fromStatus: 'PENDING', toStatus: rec.status, note, actorName: actor.name },
        })
      } else if (s.key === 'daily:time') {
        const v = valueOf(s).toUpperCase()
        if (!/^([01]\d|2[0-3]):[0-5]\d$|^OFF$/.test(v)) throw new CarryOverError(`Daily message time must be HH:MM or OFF (got "${v}").`)
        const key = SETTING_BRIEFING_TIME_PREFIX + toRef
        await tx.systemSetting.upsert({ where: { key }, update: { value: v }, create: { key, value: v } })
      } else if (s.key === 'old:daily-off') {
        const key = SETTING_BRIEFING_TIME_PREFIX + fromRef
        await tx.systemSetting.upsert({ where: { key }, update: { value: 'OFF' }, create: { key, value: 'OFF' } })
      } else if (s.key === 'old:queue-cancel') {
        await tx.whatsAppMessage.updateMany({
          where: { bookingRef: fromRef, direction: 'outbound', status: 'pending' },
          data: { status: 'cancelled' },
        })
      }
      results.push({ key: s.key, label: item.label, ok: true })
    }
    for (const k of Object.keys(fieldData)) results.push({ key: `field:${k}`, label: byKey.get(`field:${k}`)!.label, ok: true })
  }, { timeout: 20_000 })

  let newVersion: number | null = null
  if (Object.keys(fieldData).length) {
    newVersion = await appendVersionAndSnapshot(p.to.id, { createdById: actor.id, source: 'b2c', amendmentNote: note }).catch(() => null)
  }

  // ── AI-call service (external): after the DB, each result recorded ─────────
  const svc = p.payload.get('ai:svc') as NonNullable<Awaited<ReturnType<typeof prisma.tbl_te_service.findUnique>>> | undefined
  const schedule = svc
    ? {
        mode: svc.schedule_mode || 'agenda',
        call_time: svc.call_time || '18:00',
        retry_gap_min: svc.retry_gap_min ?? 15,
        ...(svc.schedule_mode === 'interval' && { interval_count: svc.interval_count ?? 10, interval_unit: svc.interval_unit ?? 'minute', start_at: 'now' }),
        reconfirm: svc.reconfirm_enabled
          ? { enabled: true, days_before: svc.reconfirm_days_before ?? 5, ...(svc.reconfirm_call_time && { call_time: svc.reconfirm_call_time }) }
          : { enabled: false },
        post_tour: svc.post_tour_enabled
          ? { enabled: true, days_after: svc.post_tour_days_after ?? 3, ...(svc.post_tour_call_time && { call_time: svc.post_tour_call_time }) }
          : { enabled: false },
      }
    : null
  for (const s of picked.filter((s) => s.key.startsWith('ai:') || s.key === 'old:pause-calls')) {
    const item = byKey.get(s.key)!
    try {
      if (s.key === 'ai:register' && svc && schedule) {
        const phone = digits(svc.call_phone || svc.customer_phone)
        if (!phone) throw new Error('the old booking has no call phone')
        const res = await tePost<{ ok?: boolean; message?: string; service?: unknown }>('intake', { bookingRef: toRef, phone, schedule })
        if (res?.ok === false && !res.service) throw new Error(res.message ?? 'registration refused')
      } else if (s.key === 'ai:plan' && schedule) {
        const { reconfirm, post_tour, ...base } = schedule
        await tePatch(`services/${encodeURIComponent(toRef)}`, base)
        await tePatch(`services/${encodeURIComponent(toRef)}`, { reconfirm })
        await tePatch(`services/${encodeURIComponent(toRef)}`, { post_tour })
      } else if (s.key === 'old:pause-calls') {
        await tePatch(`services/${encodeURIComponent(fromRef)}/status`, { status: 'paused' })
      }
      results.push({ key: s.key, label: item.label, ok: true })
    } catch (err) {
      results.push({ key: s.key, label: item.label, ok: false, note: err instanceof Error ? err.message : String(err) })
    }
  }

  const pickedKeys = new Set(picked.map((s) => s.key))
  const state: CarryState = {
    fromRef, toRef, at: new Date().toISOString(), by: actor.name, byRole: actor.role,
    applied: results,
    skipped: p.preview.items.filter((i) => !pickedKeys.has(i.key)).map((i) => i.label),
    newVersion,
  }
  const key = B2C_CARRYOVER_PREFIX + toRef
  await prisma.systemSetting.upsert({ where: { key }, update: { value: JSON.stringify(state) }, create: { key, value: JSON.stringify(state) } })
  await logActivity({
    userId: actor.id, action: 'B2C_CARRY_OVER', entityType: 'Booking', entityId: p.to.id,
    details: { fromRef, toRef, applied: results.map((r) => `${r.ok ? '✓' : '✗'} ${r.label}`), skipped: state.skipped },
  })
  return state
}
