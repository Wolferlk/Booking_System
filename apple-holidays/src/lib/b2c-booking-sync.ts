/**
 * Aahaas B2C **booking update** — refresh an already-imported store order in
 * place, as a new booking version.
 *
 * The importer (`b2c-import.ts`) is idempotent: once order 15077 exists here it
 * is never read again, so a customer who changes a date, adds an activity or
 * pays the balance in the store leaves ops working from a stale copy. This is
 * the B2C counterpart of the AppleSystem full sync (`as-booking-sync.ts`); the
 * AppleSystem one must never run on these bookings (see `assertNotB2c`).
 *
 * ── Two steps, always ────────────────────────────────────────────────────────
 * `mode: 'preview'` reads the store (read-only, as always) and returns every
 * proposed change without writing anything. `mode: 'apply'` re-reads the store,
 * recomputes, and writes only the change keys the user ticked. Apply carries the
 * booking version the preview was made against and is refused if somebody else
 * changed the booking in between.
 *
 * ── Three-way merge per field ────────────────────────────────────────────────
 * Each update stores what the store said (`baseline`). Next time, for a field:
 *   store unchanged since baseline, ops changed it  → ours wins, nothing proposed
 *   ops unchanged since baseline, store changed it  → proposed, pre-ticked
 *   both changed                                   → proposed, NOT pre-ticked
 * Without a baseline (first update after import) the store value is proposed,
 * pre-ticked, and the preview is where a human can untick it.
 *
 * ── What it will NEVER touch ─────────────────────────────────────────────────
 * status, the operation checklist, tickets, drivers, agenda, payments,
 * feedback, the StatusEvent timeline, and P&L lines Accounts has confirmed or
 * edited. A P&L line that disappeared from the store order is flagged in its
 * notes, never deleted — tickets and payment proofs can hang off it.
 *
 * ── Versioning ───────────────────────────────────────────────────────────────
 * An apply that writes anything snapshots the current state first (back-filling
 * V1 for bookings imported before versioning reached B2C), then appends a new
 * version with source `b2c` and a note listing what changed.
 */
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import {
  fetchFlightBookings,
  fetchOrderCustomers,
  fetchOrderHeaderById,
  fetchOrderProducts,
  isB2cConfigured,
  type B2cOrderProduct,
} from '@/lib/b2c-db'
import { mapB2cOrder, mapCostToRates, type MappedB2cBooking, type MappedB2cPnlLine } from '@/lib/b2c-booking-map'
import { parseFlightBooking } from '@/lib/b2c-flight'
import { loadOrderTravellers, repairB2cLeadName } from '@/lib/b2c-lead-name'
import { B2C_AGENT_NAME, B2C_IMPORT_NOTE_PREFIX, isB2cOrigin } from '@/lib/booking-source'
import { appendVersionAndSnapshot, recordAmendmentVersion } from '@/lib/booking-versions'
import { logActivity, ACTION } from '@/lib/activity'

// ── Origin ───────────────────────────────────────────────────────────────────

/**
 * Is this booking a B2C store order? Checks every importer marker, so a
 * booking whose `agent` was overwritten is still recognised.
 */
export async function isB2cOriginBooking(bookingId: string, agent: string | null): Promise<boolean> {
  if (isB2cOrigin({ agent })) return true
  const [pnl, importEvent] = await Promise.all([
    prisma.pNL.findUnique({ where: { bookingId }, select: { isPnlData: true } }),
    prisma.statusEvent.findFirst({
      where: { bookingId, note: { startsWith: B2C_IMPORT_NOTE_PREFIX } },
      select: { id: true },
    }),
  ])
  return isB2cOrigin({ agent, pnlData: pnl?.isPnlData, statusNotes: importEvent ? [B2C_IMPORT_NOTE_PREFIX] : [] })
}

// ── Sync state (system_settings KV — no schema change on the live DB) ────────

export const B2C_SYNC_STATE_PREFIX = 'b2c_sync_state:'

export interface B2cSyncState {
  at: string
  by: string
  /** Booking version after this update (unchanged when nothing was written). */
  version: number
  changed: string[]
  syncId?: string
  /** What the Accounts system did with the same update, when it was asked. */
  accounts?: { status: string; message: string | null; versionNo?: number | null; invoice?: string | null }
  /** What the store said for each scalar on this run — the next run's merge base. */
  baseline: Record<string, string | null>
  /** Itinerary row signatures the store sent on this run. */
  itinerarySig: string[]
}

export async function getB2cSyncState(bookingRef: string): Promise<B2cSyncState | null> {
  const row = await prisma.systemSetting.findUnique({ where: { key: B2C_SYNC_STATE_PREFIX + bookingRef } })
  if (!row?.value) return null
  try {
    const parsed = JSON.parse(row.value) as B2cSyncState
    return parsed && typeof parsed.at === 'string' ? parsed : null
  } catch {
    return null
  }
}

async function writeB2cSyncState(bookingRef: string, state: B2cSyncState): Promise<void> {
  const key = B2C_SYNC_STATE_PREFIX + bookingRef
  const value = JSON.stringify(state)
  await prisma.systemSetting.upsert({ where: { key }, update: { value }, create: { key, value } })
}

// ── Types ────────────────────────────────────────────────────────────────────

export class B2cSyncError extends Error {
  constructor(message: string, public status = 500) {
    super(message)
    this.name = 'B2cSyncError'
  }
}

const SCALAR_KEYS = [
  'agent', 'isNumber', 'arrivalDate', 'departureDate',
  'paxAdults', 'paxChildren', 'paxInfants', 'quotedTotal', 'currency',
  'contactEmail', 'contactPhone', 'contactWhatsapp', 'contactCountry',
  'tourDestination', 'operationCountry',
] as const
type ScalarKey = (typeof SCALAR_KEYS)[number]

export type B2cChangeKey = ScalarKey | 'itinerary' | 'pnl' | 'leadPassenger'

const LABELS: Record<B2cChangeKey, string> = {
  agent: 'Sales channel (agent)',
  isNumber: 'IS number',
  arrivalDate: 'Arrival date',
  departureDate: 'Departure date',
  paxAdults: 'Adults',
  paxChildren: 'Children',
  paxInfants: 'Infants',
  quotedTotal: 'Order total',
  currency: 'Currency',
  contactEmail: 'Customer email',
  contactPhone: 'Customer phone',
  contactWhatsapp: 'Customer WhatsApp',
  contactCountry: 'Customer nationality',
  tourDestination: 'Destination',
  operationCountry: 'Operation country',
  itinerary: 'Itinerary',
  pnl: 'P&L lines',
  leadPassenger: 'Lead passenger',
}

export interface B2cChange {
  key: B2cChangeKey
  label: string
  from: string | null
  to: string | null
  /** Changed here since the last update AND changed in the store — a real disagreement. */
  editedHere: boolean
  /** Pre-ticked in the preview. */
  recommended: boolean
  note?: string
}

export interface B2cItinRow { dayNo: number; date: string; title: string; description: string | null }

export interface B2cPnlPlan {
  added: { activity: string; category: string; sell: number; cost: string }[]
  updated: { activity: string; fields: string[] }[]
  /** Lines the store changed that were left alone, with the reason. */
  protectedLines: { activity: string; reason: string }[]
  /** Lines no longer in the store order — flagged in notes, never deleted. */
  removedUpstream: string[]
  createPnl: boolean
  locked: boolean
}

export interface B2cSyncResult {
  mode: 'preview' | 'apply'
  bookingRef: string
  orderId: number
  /** Booking version the preview was made against / the version after apply. */
  version: number
  /** Set on apply when a new version was written. */
  newVersion: number | null
  changes: B2cChange[]
  /** Keys actually written (apply only). */
  applied: B2cChangeKey[]
  itinerary: { previous: B2cItinRow[]; next: B2cItinRow[] } | null
  pnl: B2cPnlPlan
  store: {
    bookedDate: string | null
    checkoutStatus: string | null
    paymentStatus: string | null
    total: string | null
    paid: string | null
    balance: string | null
    currency: string
    productLines: number
  }
  warnings: string[]
  lastUpdate: { at: string; by: string; version: number } | null
  unchanged: boolean
  at: string
}

export interface B2cSyncOptions {
  mode: 'preview' | 'apply'
  actorId: string
  actorName: string
  /** apply: keys the user ticked. Anything else is left exactly as it is. */
  keys?: B2cChangeKey[]
  /** apply: the booking version the preview was made against. */
  expectedVersion?: number
  /**
   * Shared with the Accounts half of the same update (b2c_order_versions.sync_id
   * there), so the two systems' versions can be read as one event.
   */
  syncId?: string
}

// ── Small helpers ────────────────────────────────────────────────────────────

function dateOnly(d: Date | string | null | undefined): string | null {
  if (!d) return null
  const dt = typeof d === 'string' ? new Date(d) : d
  return isNaN(dt.getTime()) ? null : dt.toISOString().slice(0, 10)
}

function nonEmpty(v: string | null | undefined): string | null {
  const s = (v ?? '').trim()
  return s || null
}

function norm(v: string | null | undefined): string {
  return (v ?? '').trim().toLowerCase()
}

function same(a: string | null | undefined, b: string | null | undefined): boolean {
  return norm(a) === norm(b)
}

function sameRows(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  const x = [...a].sort()
  const y = [...b].sort()
  return x.every((v, i) => v === y[i])
}

const itinSig = (i: { dayNo: number; date: string; title: string; description?: string | null }) =>
  [i.dayNo, i.date, norm(i.title), norm(i.description)].join('\u0000')

const round2 = (n: number) => Math.round(n * 100) / 100
const dec = (v: unknown) => Number(v ?? 0)

/** `B2C line #123 (checkout 456) · …` → 123. The importer writes this first. */
function storeLineId(notes: string | null | undefined): number | null {
  const m = (notes ?? '').match(/B2C line #(\d+)/)
  return m ? Number(m[1]) : null
}

/** `… · cost 12.00 / sell 15.00 USD · …` → the figures the line was written from. */
function noteFigures(notes: string | null | undefined): { cost: number; sell: number } | null {
  const m = (notes ?? '').match(/cost (-?[\d.]+) \/ sell (-?[\d.]+)/)
  return m ? { cost: Number(m[1]), sell: Number(m[2]) } : null
}

const REMOVED_PREFIX = '[Removed from store order] '

// ── Core ─────────────────────────────────────────────────────────────────────

export async function syncB2cBooking(bookingRef: string, opts: B2cSyncOptions): Promise<B2cSyncResult> {
  const booking = await prisma.booking.findUnique({
    where: { bookingRef },
    select: {
      id: true, bookingRef: true, version: true, status: true, agent: true, isNumber: true,
      arrivalDate: true, departureDate: true, paxAdults: true, paxChildren: true, paxInfants: true,
      quotedTotal: true, currency: true, contactEmail: true, contactPhone: true, contactWhatsapp: true,
      contactCountry: true, tourDestination: true, operationCountry: true,
      itineraryItems: {
        orderBy: [{ dayNo: 'asc' }, { date: 'asc' }],
        select: { dayNo: true, date: true, title: true, description: true, inclusions: true, exclusions: true },
      },
      passengers: { select: { id: true } },
      pnl: {
        select: {
          id: true, lockedAt: true, isPnlData: true, paxAdults: true, paxChildren: true,
          lineItems: {
            orderBy: { sortOrder: 'asc' },
            select: {
              id: true, activity: true, category: true, mmtRate: true, sicRate: true, pvtRatePP: true,
              adEntrance: true, chEntrance: true, otherRate: true, paymentStatus: true,
              paymentConfirmedAt: true, paymentConfirmedBy: true, sortOrder: true, notes: true,
            },
          },
        },
      },
    },
  })
  if (!booking) throw new B2cSyncError('Booking not found', 404)

  if (!(await isB2cOriginBooking(booking.id, booking.agent))) {
    throw new B2cSyncError('This is not an Aahaas B2C booking — use Fetch Data from API instead.', 409)
  }
  if (booking.status === 'CANCELLED') {
    throw new B2cSyncError('This booking is cancelled — it is not updated from the store.', 409)
  }
  if (opts.mode === 'apply' && opts.expectedVersion != null && opts.expectedVersion !== booking.version) {
    throw new B2cSyncError(
      `This booking moved from V${opts.expectedVersion} to V${booking.version} since the preview. Nothing was changed — open Update Booking again.`,
      409,
    )
  }
  if (!isB2cConfigured()) throw new B2cSyncError('The Aahaas store database is not configured on this server.', 503)

  // The B2C importer uses the store order id as the ref; the IS number is the
  // same id, and is the fallback if a ref was ever renamed.
  const orderId = Number(/^\d+$/.test(booking.bookingRef) ? booking.bookingRef : booking.isNumber)
  if (!Number.isInteger(orderId) || orderId <= 0) {
    throw new B2cSyncError(`Cannot tell which store order ${booking.bookingRef} came from.`, 422)
  }

  // ── Read the store (read-only) ─────────────────────────────────────────────
  let header, products: B2cOrderProduct[], customers, flightRows, travellers
  try {
    ;[header, products, customers, flightRows, travellers] = await Promise.all([
      fetchOrderHeaderById(orderId),
      fetchOrderProducts([orderId]),
      fetchOrderCustomers([orderId]),
      fetchFlightBookings([orderId]),
      loadOrderTravellers([orderId]),
    ])
  } catch (err) {
    throw new B2cSyncError(`Could not read the Aahaas store: ${err instanceof Error ? err.message : String(err)}`, 502)
  }

  const customer = customers[0]
  if (!customer) {
    throw new B2cSyncError(`Store order ${orderId} no longer exists (deleted in the store). Nothing was changed.`, 404)
  }
  if (!header) {
    throw new B2cSyncError(`Store order ${orderId} has no dated travel lines any more. Nothing was changed.`, 422)
  }

  const mappedResult = mapB2cOrder({
    header,
    products,
    customer,
    flights: flightRows.map((r) => parseFlightBooking(r)),
    travellers: travellers.byOrder.get(orderId),
  })
  if (!mappedResult.ok) {
    throw new B2cSyncError(`Store order ${orderId} cannot be mapped (${mappedResult.detail}). Nothing was changed.`, 422)
  }
  const mapped: MappedB2cBooking = mappedResult.booking
  if (mapped.bookingRef !== String(orderId)) {
    throw new B2cSyncError(`Store returned order ${mapped.bookingRef}, not ${orderId}. Nothing was changed.`, 409)
  }

  const warnings: string[] = []
  if (travellers.error) warnings.push(`Traveller names unavailable from the store: ${travellers.error}`)
  const checkoutStatus = nonEmpty(customer.checkout_status)
  if (checkoutStatus && /cancel|refund|reject/i.test(checkoutStatus)) {
    warnings.push(`The store marks this order "${checkoutStatus}". Check whether the booking should be cancelled here.`)
  }
  const paxDefaulted = mapped.source.paxResolvedVia === 'defaulted'
  if (paxDefaulted) warnings.push('The store records no passenger counts for this order — pax was left as it is.')

  const state = await getB2cSyncState(booking.bookingRef)
  const base = state?.baseline ?? null

  // ── Scalars ────────────────────────────────────────────────────────────────
  const ours: Record<ScalarKey, string | null> = {
    agent: nonEmpty(booking.agent),
    isNumber: nonEmpty(booking.isNumber),
    arrivalDate: dateOnly(booking.arrivalDate),
    departureDate: dateOnly(booking.departureDate),
    paxAdults: String(booking.paxAdults),
    paxChildren: String(booking.paxChildren),
    paxInfants: String(booking.paxInfants),
    quotedTotal: booking.quotedTotal == null ? null : Number(booking.quotedTotal).toFixed(2),
    currency: nonEmpty(booking.currency),
    contactEmail: nonEmpty(booking.contactEmail),
    contactPhone: nonEmpty(booking.contactPhone),
    contactWhatsapp: nonEmpty(booking.contactWhatsapp),
    contactCountry: nonEmpty(booking.contactCountry),
    tourDestination: nonEmpty(booking.tourDestination),
    operationCountry: booking.operationCountry ?? null,
  }
  const theirs: Record<ScalarKey, string | null> = {
    agent: B2C_AGENT_NAME,
    isNumber: nonEmpty(mapped.isNumber),
    arrivalDate: mapped.arrivalDate,
    departureDate: mapped.departureDate,
    paxAdults: paxDefaulted ? null : String(mapped.paxAdults),
    paxChildren: paxDefaulted ? null : String(mapped.paxChildren),
    paxInfants: paxDefaulted ? null : String(mapped.paxInfants),
    quotedTotal: mapped.quotedTotal == null ? null : mapped.quotedTotal.toFixed(2),
    currency: nonEmpty(mapped.currency),
    contactEmail: nonEmpty(mapped.contactEmail),
    contactPhone: nonEmpty(mapped.contactPhone),
    // The importer seeds WhatsApp from the store phone.
    contactWhatsapp: nonEmpty(mapped.contactPhone),
    contactCountry: nonEmpty(mapped.contactCountry),
    tourDestination: nonEmpty(mapped.tourDestination),
    operationCountry: mapped.operationCountry ?? null,
  }

  const changes: B2cChange[] = []
  for (const key of SCALAR_KEYS) {
    const o = ours[key]
    const t = theirs[key]
    if (t === null) continue                       // store blank → keep ours
    if (same(o, t)) continue

    if (key === 'agent') {
      changes.push({
        key, label: LABELS[key], from: o, to: t, editedHere: false, recommended: true,
        note: 'Restores the B2C channel marker — without it this booking is treated as an agent booking.',
      })
      continue
    }
    if (key === 'operationCountry') {
      // Country decides which team sees the file. Only ever filled, never moved.
      if (o === null) changes.push({ key, label: LABELS[key], from: o, to: t, editedHere: false, recommended: true })
      continue
    }

    if (base && key in base) {
      const b = base[key]
      if (same(b, t)) continue                     // store unchanged → ops edit stands
      const editedHere = !same(b, o)
      changes.push({
        key, label: LABELS[key], from: o, to: t, editedHere, recommended: !editedHere,
        ...(editedHere && { note: `Changed here and in the store (store previously said "${b ?? '—'}").` }),
      })
    } else {
      // No baseline yet. WhatsApp was seeded from the phone at import; one that
      // no longer matches the phone was set here on purpose — leave it.
      if (key === 'contactWhatsapp' && o !== null && !same(o, ours.contactPhone)) continue
      changes.push({ key, label: LABELS[key], from: o, to: t, editedHere: false, recommended: true })
    }
  }

  // ── Itinerary ──────────────────────────────────────────────────────────────
  const prevItin = booking.itineraryItems.map((i) => ({
    dayNo: i.dayNo,
    date: dateOnly(i.date) ?? '',
    title: i.title,
    description: i.description,
    inclusions: i.inclusions,
    exclusions: i.exclusions,
  }))
  const ourSig = prevItin.map(itinSig)
  const theirSig = mapped.itineraryItems.map(itinSig)
  let itinerary: B2cSyncResult['itinerary'] = null
  if (theirSig.length > 0 && !sameRows(ourSig, theirSig)) {
    const baseSig = state?.itinerarySig
    const storeMoved = !baseSig || !sameRows(baseSig, theirSig)
    if (storeMoved) {
      const editedHere = !!baseSig && !sameRows(baseSig, ourSig)
      itinerary = {
        previous: prevItin.map(({ dayNo, date, title, description }) => ({ dayNo, date, title, description })),
        next: mapped.itineraryItems.map((i) => ({ ...i, description: i.description ?? null })),
      }
      changes.push({
        key: 'itinerary', label: LABELS.itinerary,
        from: `${prevItin.length} item(s)`, to: `${mapped.itineraryItems.length} item(s)`,
        editedHere, recommended: !editedHere,
        note: editedHere
          ? 'The itinerary was edited here and also changed in the store. Replacing it loses the edits here.'
          : 'Regenerate the agenda afterwards to carry this into the tour agenda.',
      })
    }
  }

  // ── Lead passenger ─────────────────────────────────────────────────────────
  const seedLead = booking.passengers.length === 0 && !!mapped.leadPassengerName
  let leadRename: { from: string; to: string } | null = null
  if (seedLead) {
    changes.push({
      key: 'leadPassenger', label: LABELS.leadPassenger, from: null, to: mapped.leadPassengerName,
      editedHere: false, recommended: true,
    })
  } else if (isB2cOrigin({ agent: booking.agent })) {
    // Only renames the importer's own store-account fallback; see b2c-lead-name.
    const r = await repairB2cLeadName({
      bookingRef: booking.bookingRef,
      newName: mapped.leadPassengerName,
      via: String(mapped.source.leadPassengerResolvedVia ?? ''),
      accountName: customer.customer_name ?? null,
      apply: false,
      actorId: opts.actorId,
    }).catch(() => null)
    if (r?.status === 'would-rename' && r.from && r.to) {
      leadRename = { from: r.from, to: r.to }
      changes.push({
        key: 'leadPassenger', label: LABELS.leadPassenger, from: r.from, to: r.to,
        editedHere: false, recommended: true, note: 'Replaces the store account name with the real traveller.',
      })
    }
  }

  // ── P&L plan (depends on the pax that will be in force afterwards) ────────
  const picked = (key: B2cChangeKey): boolean => {
    const c = changes.find((x) => x.key === key)
    if (!c) return false
    return opts.mode === 'apply' ? (opts.keys ?? []).includes(key) : c.recommended
  }
  const finalAdults = picked('paxAdults') ? Number(theirs.paxAdults) : booking.paxAdults
  const finalChildren = picked('paxChildren') ? Number(theirs.paxChildren) : booking.paxChildren

  const productByLineId = new Map(products.map((p) => [Number(p.id), p]))
  const plan: B2cPnlPlan = {
    added: [], updated: [], protectedLines: [], removedUpstream: [],
    createPnl: false, locked: !!booking.pnl?.lockedAt,
  }
  const pnlCreates: MappedB2cPnlLine[] = []
  const pnlUpdates: { id: string; data: Prisma.PNLLineItemUpdateInput }[] = []
  const pnlFlags: { id: string; notes: string }[] = []

  /** The store line re-costed against the pax that will actually be on the booking. */
  const lineFor = (l: MappedB2cPnlLine): MappedB2cPnlLine => {
    const p = productByLineId.get(storeLineId(l.notes) ?? -1)
    if (!p) return l
    const r = mapCostToRates(p, finalAdults, finalChildren)
    return {
      ...l,
      adEntrance: r.adEntrance, chEntrance: r.chEntrance, otherRate: r.otherRate,
      notes: l.notes.replace(/rate basis: [\w-]+/, `rate basis: ${r.basis}`),
    }
  }

  if (plan.locked) {
    warnings.push('The P&L is locked — its lines were left alone.')
  } else if (!booking.pnl) {
    if (mapped.pnlLines.length > 0) {
      plan.createPnl = true
      for (const l of mapped.pnlLines.map(lineFor)) {
        pnlCreates.push(l)
        plan.added.push({ activity: l.activity, category: l.category, sell: l.mmtRate, cost: costOf(l, finalAdults, finalChildren) })
      }
    }
  } else {
    const existingById = new Map<number, (typeof booking.pnl.lineItems)[number]>()
    for (const li of booking.pnl.lineItems) {
      const id = storeLineId(li.notes)
      if (id !== null && !existingById.has(id)) existingById.set(id, li)
    }
    const upstreamIds = new Set<number>()
    let nextSort = Math.max(-1, ...booking.pnl.lineItems.map((l) => l.sortOrder)) + 1

    for (const raw of mapped.pnlLines) {
      const l = lineFor(raw)
      const id = storeLineId(l.notes)
      if (id !== null) upstreamIds.add(id)
      const cur = id !== null ? existingById.get(id) : undefined

      if (!cur) {
        pnlCreates.push({ ...l, sortOrder: nextSort++ })
        plan.added.push({ activity: l.activity, category: l.category, sell: l.mmtRate, cost: costOf(l, finalAdults, finalChildren) })
        continue
      }

      const diff: string[] = []
      const data: Prisma.PNLLineItemUpdateInput = {}
      const num = (field: 'mmtRate' | 'adEntrance' | 'chEntrance' | 'otherRate', next: number) => {
        if (Math.abs(dec(cur[field]) - next) > 0.004) { data[field] = next; diff.push(field) }
      }
      num('mmtRate', l.mmtRate)
      num('adEntrance', l.adEntrance)
      num('chEntrance', l.chEntrance)
      num('otherRate', l.otherRate)
      if (cur.activity !== l.activity) { data.activity = l.activity; diff.push('activity') }
      if (cur.category !== l.category) { data.category = l.category; diff.push('category') }
      // Paid in the store since last time → unlock ticketing. Never the reverse.
      if (cur.paymentStatus === 'PENDING' && l.paymentStatus === 'CONFIRMED') {
        data.paymentStatus = 'CONFIRMED'; diff.push('paymentStatus')
      }
      if (diff.length === 0) continue
      if ((cur.notes ?? '') !== l.notes) data.notes = l.notes

      // Accounts' work is never overwritten by a store refresh.
      if (cur.paymentConfirmedAt || cur.paymentConfirmedBy) {
        plan.protectedLines.push({ activity: cur.activity, reason: 'payment confirmed by Accounts' })
        continue
      }
      const figs = noteFigures(cur.notes)
      // P&L totals are computed with the P&L's own pax (see computePNLTotals).
      const pa = booking.pnl.paxAdults
      const pc = booking.pnl.paxChildren
      const oldTotal =
        (dec(cur.sicRate) + dec(cur.pvtRatePP) + dec(cur.otherRate)) * (pa + pc) +
        dec(cur.adEntrance) * pa + dec(cur.chEntrance) * pc
      const tolerance = 0.01 + 0.005 * Math.max(1, pa + pc)
      const handEdited =
        !figs ||
        Math.abs(dec(cur.mmtRate) - round2(figs.sell)) > 0.004 ||
        Math.abs(oldTotal - figs.cost) > tolerance ||
        dec(cur.sicRate) !== 0 || dec(cur.pvtRatePP) !== 0
      if (handEdited) {
        plan.protectedLines.push({ activity: cur.activity, reason: 'figures were edited in the P&L' })
        continue
      }
      pnlUpdates.push({ id: cur.id, data })
      plan.updated.push({ activity: l.activity, fields: diff })
    }

    existingById.forEach((li, id) => {
      if (upstreamIds.has(id)) return
      plan.removedUpstream.push(li.activity)
      if (!(li.notes ?? '').startsWith(REMOVED_PREFIX)) pnlFlags.push({ id: li.id, notes: REMOVED_PREFIX + (li.notes ?? '') })
    })
  }

  const pnlChanges = pnlCreates.length + pnlUpdates.length + pnlFlags.length
  if (pnlChanges > 0) {
    const parts = [
      plan.added.length && `+${plan.added.length} new`,
      plan.updated.length && `${plan.updated.length} updated`,
      pnlFlags.length && `${pnlFlags.length} removed in store (kept, flagged)`,
    ].filter(Boolean)
    changes.push({
      key: 'pnl', label: LABELS.pnl,
      from: booking.pnl ? `${booking.pnl.lineItems.length} line(s)` : 'no P&L',
      to: parts.join(', '),
      editedHere: false, recommended: true,
      ...(plan.protectedLines.length > 0 && {
        note: `${plan.protectedLines.length} line(s) changed in the store were left alone (confirmed or edited by Accounts).`,
      }),
    })
  }
  if (plan.protectedLines.length > 0 && pnlChanges === 0) {
    warnings.push(`${plan.protectedLines.length} P&L line(s) changed in the store but were left alone (confirmed or edited by Accounts).`)
  }

  const at = new Date().toISOString()
  const storeInfo: B2cSyncResult['store'] = {
    bookedDate: header.bookedDate ?? null,
    checkoutStatus,
    paymentStatus: nonEmpty(customer.payment_status),
    total: customer.total_amount ?? null,
    paid: customer.paid_amount ?? null,
    balance: customer.balance_amount ?? null,
    currency: mapped.currency,
    productLines: products.length,
  }
  const lastUpdate = state ? { at: state.at, by: state.by, version: state.version } : null
  const baseResult = {
    bookingRef: booking.bookingRef, orderId, changes, itinerary, pnl: plan,
    store: storeInfo, warnings, lastUpdate, at,
  }

  if (opts.mode === 'preview') {
    return {
      ...baseResult, mode: 'preview', version: booking.version, newVersion: null, applied: [],
      unchanged: changes.length === 0,
    }
  }

  // ── Apply ──────────────────────────────────────────────────────────────────
  const selected = new Set((opts.keys ?? []).filter((k) => changes.some((c) => c.key === k)))
  const applied = changes.filter((c) => selected.has(c.key)).map((c) => c.key)

  const nextBaseline: Record<string, string | null> = {}
  for (const k of SCALAR_KEYS) nextBaseline[k] = theirs[k] ?? base?.[k] ?? null

  let newVersion: number | null = null
  if (applied.length > 0) {
    // Snapshot what is about to be overwritten (back-fills V1 on first update).
    await recordAmendmentVersion(booking.id, { createdById: opts.actorId, source: 'b2c' })

    const data: Record<string, unknown> = {}
    for (const k of SCALAR_KEYS) {
      if (!selected.has(k)) continue
      const v = theirs[k]
      if (k === 'arrivalDate' || k === 'departureDate') data[k] = new Date(`${v}T00:00:00Z`)
      else if (k === 'paxAdults' || k === 'paxChildren' || k === 'paxInfants') data[k] = Number(v)
      else if (k === 'quotedTotal') data[k] = Number(v)
      else data[k] = v
    }

    await prisma.$transaction(async (tx) => {
      if (Object.keys(data).length > 0) {
        await tx.booking.update({ where: { id: booking.id }, data: data as Prisma.BookingUpdateInput })
      }

      if (selected.has('itinerary') && itinerary) {
        // Inclusions/exclusions are typed in ops; the store does not send them.
        const extras = new Map(
          prevItin
            .filter((p) => p.inclusions || p.exclusions)
            .map((p) => [`${p.dayNo}|${p.date}|${norm(p.title)}`, p] as const),
        )
        await tx.itineraryItem.deleteMany({ where: { bookingId: booking.id } })
        await tx.itineraryItem.createMany({
          data: mapped.itineraryItems.map((i) => {
            const extra = extras.get(`${i.dayNo}|${i.date}|${norm(i.title)}`)
            return {
              bookingId: booking.id,
              dayNo: i.dayNo,
              date: new Date(`${i.date}T00:00:00Z`),
              title: i.title,
              description: i.description || null,
              inclusions: extra?.inclusions ?? null,
              exclusions: extra?.exclusions ?? null,
            }
          }),
        })
      }

      if (selected.has('leadPassenger') && seedLead && mapped.leadPassengerName) {
        await tx.passenger.create({
          data: { bookingId: booking.id, name: mapped.leadPassengerName, type: 'ADULT', isLead: true },
        })
      }

      if (selected.has('pnl') && !plan.locked) {
        let pnlId = booking.pnl?.id
        if (!pnlId) {
          pnlId = (await tx.pNL.create({
            data: { bookingId: booking.id, paxAdults: finalAdults, paxChildren: finalChildren, isPnlData: mapped.source as object },
            select: { id: true },
          })).id
        } else {
          await tx.pNL.update({
            where: { id: pnlId },
            data: { paxAdults: finalAdults, paxChildren: finalChildren, isPnlData: mapped.source as object },
          })
        }
        if (pnlCreates.length > 0) {
          await tx.pNLLineItem.createMany({
            data: pnlCreates.map((l) => ({
              pnlId: pnlId!,
              activity: l.activity, category: l.category, mmtRate: l.mmtRate,
              sicRate: l.sicRate, pvtRatePP: l.pvtRatePP, adEntrance: l.adEntrance,
              chEntrance: l.chEntrance, otherRate: l.otherRate, paymentStatus: l.paymentStatus,
              sortOrder: l.sortOrder, notes: l.notes,
            })),
          })
        }
        for (const u of pnlUpdates) await tx.pNLLineItem.update({ where: { id: u.id }, data: u.data })
        for (const f of pnlFlags) await tx.pNLLineItem.update({ where: { id: f.id }, data: { notes: f.notes } })
      } else if (booking.pnl && !plan.locked && (selected.has('paxAdults') || selected.has('paxChildren'))) {
        // Keep the P&L's own pax in step with the booking.
        await tx.pNL.update({ where: { id: booking.pnl.id }, data: { paxAdults: finalAdults, paxChildren: finalChildren } })
      }
    }, { timeout: 30_000 })

    // After `agent` is restored, so the rename's own B2C check passes.
    if (selected.has('leadPassenger') && leadRename) {
      await repairB2cLeadName({
        bookingRef: booking.bookingRef,
        newName: leadRename.to,
        via: String(mapped.source.leadPassengerResolvedVia ?? ''),
        accountName: customer.customer_name ?? null,
        apply: true,
        actorId: opts.actorId,
      }).catch((err) => warnings.push(`Lead passenger rename failed: ${err instanceof Error ? err.message : String(err)}`))
    }

    const note = `Updated from Aahaas store order ${orderId} by ${opts.actorName}${opts.syncId ? ` [sync ${opts.syncId}]` : ''}: ` +
      changes.filter((c) => selected.has(c.key)).map((c) => `${c.label} ${c.from ?? '—'} → ${c.to ?? '—'}`).join('; ')
    newVersion = await appendVersionAndSnapshot(booking.id, {
      createdById: opts.actorId,
      source: 'b2c',
      amendmentNote: note.slice(0, 4000),
    })
  }

  await writeB2cSyncState(booking.bookingRef, {
    at,
    by: opts.actorName,
    version: newVersion ?? booking.version,
    changed: applied,
    ...(opts.syncId && { syncId: opts.syncId }),
    baseline: nextBaseline,
    itinerarySig: theirSig.length > 0 ? theirSig : (state?.itinerarySig ?? ourSig),
  })

  await logActivity({
    userId: opts.actorId,
    action: ACTION.BOOKING_UPDATED,
    entityType: 'Booking',
    entityId: booking.id,
    details: {
      op: 'b2c_store_update',
      bookingRef: booking.bookingRef,
      syncId: opts.syncId ?? null,
      orderId,
      fromVersion: booking.version,
      toVersion: newVersion,
      applied: changes.filter((c) => selected.has(c.key)),
      declined: changes.filter((c) => !selected.has(c.key)).map((c) => c.key),
      pnl: selected.has('pnl') ? plan : null,
      itineraryPrevious: selected.has('itinerary') ? itinerary?.previous : undefined,
    } as unknown as Record<string, unknown>,
  }).catch((err) => console.error('[b2c-sync] activity log failed:', err instanceof Error ? err.message : err))

  return {
    ...baseResult,
    mode: 'apply',
    version: newVersion ?? booking.version,
    newVersion,
    applied,
    unchanged: applied.length === 0,
    lastUpdate: { at, by: opts.actorName, version: newVersion ?? booking.version },
  }
}

/** A line's cost through the ops P&L formula, for the preview. */
function costOf(l: MappedB2cPnlLine, adults: number, children: number): string {
  const total = (l.sicRate + l.pvtRatePP + l.otherRate) * (adults + children) + l.adEntrance * adults + l.chEntrance * children
  return total.toFixed(2)
}

/**
 * Record what the Accounts system did with an update started (or finished)
 * here: appended to the new version's note and kept on the sync marker, so the
 * OPS version names its Accounts twin ("Accounts v3 · AHS-15077R2").
 */
export async function recordAccountsOutcome(
  bookingRef: string,
  newVersion: number | null,
  accounts: NonNullable<B2cSyncState['accounts']>,
): Promise<void> {
  const line = accounts.status === 'ok'
    ? `Accounts: ${[accounts.versionNo ? `v${accounts.versionNo}` : null, accounts.invoice, accounts.message].filter(Boolean).join(' · ')}`
    : `Accounts NOT updated (${accounts.status}): ${accounts.message ?? 'no reason given'}`

  if (newVersion) {
    const booking = await prisma.booking.findUnique({ where: { bookingRef }, select: { id: true } })
    if (booking) {
      const v = await prisma.bookingVersion.findUnique({
        where: { bookingId_versionNo: { bookingId: booking.id, versionNo: newVersion } },
        select: { amendmentNote: true },
      })
      if (v) {
        await prisma.bookingVersion.update({
          where: { bookingId_versionNo: { bookingId: booking.id, versionNo: newVersion } },
          data: { amendmentNote: `${v.amendmentNote ?? ''}\n${line}`.trim().slice(0, 4000) },
        })
      }
    }
  }

  const state = await getB2cSyncState(bookingRef)
  if (state) await writeB2cSyncState(bookingRef, { ...state, accounts })
}
