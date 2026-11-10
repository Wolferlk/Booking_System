/**
 * B2C ORDER → THE RIGHT PLACES ON THE BOOKING.
 *
 * The importer brings an Aahaas store order in as a booking with P&L lines and
 * itinerary rows only, so the Tickets page, Flights and Accommodation cards of
 * a B2C booking stayed empty (user, 2026-11-10: "if having tickets hotels
 * flights like product find correctly and add booking details suitable places").
 * This reads the store order and fills them:
 *
 *   attraction / activity / meal / education lines → DRAFT tickets
 *       (linked to their P&L line, so the Purchase gates and the Ticket Issue
 *       Desk work exactly as for an AppleSystem booking)
 *   hotel lines   → Accommodation rows (dates, room, board from the booked stay)
 *   flight bookings → Flight rows (each segment) + any traveller not yet listed
 *
 * SAFETY — the same rules as "Create Tickets from API":
 *   · Create-only. Nothing existing is changed or deleted, so a hand edit, a
 *     purchased ticket or an amendment someone already typed in is never lost.
 *   · Idempotent. Tickets carry the "B2C line #<id>" tag their P&L line has;
 *     hotels match on hotel + check-in, flights on flight number + date. A
 *     second run adds nothing.
 *   · Data-protection locks are obeyed (flights, accommodations, passengers).
 *   · The store is read-only (b2c-db's guard). Transport and tax lines are not
 *     tickets; ground transport stays with the driver flow.
 *   · A line the store already booked through a portal itself (GlobalTix,
 *     Cebu, Bridgify) still gets a ticket so Ground sees it, but the ticket says
 *     so and the Issue Desk refuses it — it must never be bought twice.
 */
import { prisma } from '@/lib/prisma'
import {
  fetchFlightBookings, fetchHotelStayBlobs, fetchOrderProducts, isB2cConfigured,
  type B2cFlightBooking, type B2cOrderProduct,
} from '@/lib/b2c-db'
import { toPnlCategory } from '@/lib/b2c-booking-map'
import { resolveLiveOrderId } from '@/lib/b2c-order-chain'
import { isB2cOriginBooking } from '@/lib/b2c-booking-sync'
import { ticketDataFromRow } from '@/lib/flight-ticket/store-ticket'
import { loadChildGuard } from '@/lib/data-protection-server'
import { clearNoTicketsMark } from '@/lib/no-tickets-clear'

export class B2cPlacementError extends Error {
  constructor(message: string, public status = 422) { super(message) }
}

/** The tag a B2C ticket shares with its P&L line ("B2C line #123 (checkout …)"). */
export const B2C_LINE_TAG = 'B2C line #'
/** Written on a ticket the store already bought through a portal. Read by the Issue Desk. */
export const STORE_BOOKED_PREFIX = 'Booked by the store via '

/** Store providers that are themselves ticket portals — the store has already bought these. */
const STORE_PORTALS: Record<string, string> = { globaltix: 'GlobalTix', cebu: 'Cebu', bridgify: 'Bridgify' }

/** P&L categories that are bought as tickets. Hotels, flights, transport and tax have their own homes. */
const TICKET_CATEGORIES = new Set(['TICKETS', 'CRUISE', 'WATER', 'GUIDES', 'MEALS', 'OTHER'])

const HOTEL_CATEGORY_ID = 4

export interface PlacementReport {
  orderId: number
  tickets: { created: number; skipped: number; storeBooked: number }
  hotels: { created: number; skipped: number; locked: boolean }
  flights: { created: number; skipped: number; locked: boolean }
  passengers: { created: number; locked: boolean }
  warnings: string[]
}

/* ── small pure helpers ─────────────────────────────────────────────── */

const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : 0
}
const r2 = (n: number) => Math.round(n * 100) / 100
const str = (v: unknown): string | null => (v === null || v === undefined || String(v).trim() === '' ? null : String(v).trim())
const day = (d: Date | string) => (typeof d === 'string' ? d.slice(0, 10) : d.toISOString().slice(0, 10))
const norm = (v: string | null | undefined) => (v ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '')

/** "23/12/2026", "2026-12-23", "2026-12-23 00:00:00" → "2026-12-23". */
export function ymd(value: unknown): string | null {
  const v = str(value)
  if (!v) return null
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(v)
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
  return null
}

function addDays(d: string, n: number): string {
  const x = new Date(`${d}T00:00:00Z`)
  x.setUTCDate(x.getUTCDate() + n)
  return x.toISOString().slice(0, 10)
}
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000)

function parseBlob(raw: unknown): any {
  if (!raw) return null
  if (typeof raw === 'object') return raw
  try { return JSON.parse(String(raw)) } catch { return null }
}

/** Does a ticket's notes carry exactly this tag (not "#12" inside "#123")? */
export function notesHaveTag(notes: string | null | undefined, tag: string): boolean {
  return (notes ?? '').split(' · ').some(p => p.trim() === tag)
}

/** Which portal already sold this line, when the store bought it itself. */
export function storePortalOf(provider: string | null | undefined): string | null {
  return STORE_PORTALS[(provider ?? '').trim().toLowerCase()] ?? null
}

/** The P&L line a store line was imported as. */
export function pnlLineFor(lines: { id: string; notes: string | null }[], storeLineId: number): string | null {
  const head = `${B2C_LINE_TAG}${storeLineId} `
  const exact = `${B2C_LINE_TAG}${storeLineId}`
  return lines.find(l => (l.notes ?? '').startsWith(head) || (l.notes ?? '').split(' · ')[0] === exact)?.id ?? null
}

/** A DRAFT ticket for one store line, or null when the line is not bought as a ticket. */
export function ticketFromLine(p: B2cOrderProduct): {
  type: string; category: string; qty: number; costPerUnit: number | null; totalCost: number | null
  currency: string; supplier: string | null; notes: string; storeBooked: string | null
} | null {
  if (p.category_id === HOTEL_CATEGORY_ID) return null
  const category = toPnlCategory(p.maincat_type, p.product_name)
  if (!TICKET_CATEGORIES.has(category)) return null
  const name = str(p.product_name) ?? (p.sku && p.sku !== 'N/A' ? p.sku : null)
  if (!name) return null

  const adults = Math.max(0, Math.trunc(num(p.adult_quantity)))
  const children = Math.max(0, Math.trunc(num(p.child_quantity)))
  const qty = Math.max(1, adults + children || Math.trunc(num(p.quantity)) || 1)
  const cost = num(p.net_cost_amount)
  const storeBooked = storePortalOf(p.provider)
  const notes = [
    `${B2C_LINE_TAG}${p.id}`,
    p.service_date ? `Visit: ${ymd(p.service_date) ?? p.service_date}` : null,
    p.time_slot ? `Time: ${String(p.time_slot).trim()}` : null,
    `Pax: ad ${adults} ch ${children}`,
    p.product_country ? `Country: ${String(p.product_country).trim().toUpperCase()}` : null,
    p.service_location ? `Location: ${String(p.service_location).trim()}` : null,
    storeBooked ? `${STORE_BOOKED_PREFIX}${storeBooked}` : null,
  ].filter(Boolean).join(' · ')

  return {
    type: name.slice(0, 191),
    category,
    qty,
    costPerUnit: cost > 0 ? r2(cost / qty) : null,
    totalCost: cost > 0 ? r2(cost) : null,
    currency: (str(p.base_currency) ?? 'USD').toUpperCase().slice(0, 8),
    supplier: str(p.vendor_name)?.slice(0, 191) ?? null,
    notes,
    storeBooked,
  }
}

/** The stay behind a hotel line, from `hotel_prebooking.bookingdataset` (as AahaasFlow reads it). */
export function stayFromBlob(raw: unknown): {
  name: string | null; city: string | null; address: string | null
  checkIn: string | null; checkOut: string | null; nights: number | null
  roomType: string | null; meal: string | null
} | null {
  const ds = parseBlob(raw)
  if (!ds || typeof ds !== 'object') return null
  const hd = ds.hotelMainRequest?.hotelData ?? {}
  const rq = ds.hotelRatesRequest ?? {}
  const cd = ds.customerDetails ?? {}
  const req = cd.customer_request ?? {}
  const nightsOf = Object.entries(cd.mealAllocation ?? {})
    .map(([d, plan]) => ({ date: ymd(d), plan: str(plan) }))
    .filter(x => x.date && x.plan)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)))

  const checkIn = ymd(cd.check_in) ?? ymd(ds.CheckInDate) ?? ymd(req.CheckInDate) ?? nightsOf[0]?.date ?? null
  const checkOutRaw = ymd(cd.check_out) ?? ymd(ds.CheckOutDate) ?? ymd(req.CheckOutDate)
  const stated = num(ds.NoOfNights) || num(req.NoOfNights) || null
  const nights = stated ?? (checkIn && checkOutRaw ? daysBetween(checkIn, checkOutRaw) : null) ?? (nightsOf.length || null)
  const checkOut = checkOutRaw ?? (checkIn && nights ? addDays(checkIn, nights) : null)
  const rooms = (Array.isArray(cd.room_allocation) ? cd.room_allocation : []).map((a: any) => str(a?.roomType)).filter(Boolean) as string[]
  const boards = Array.from(new Set([...nightsOf.map(x => x.plan as string), str(ds.MealPlan) ?? str(req.MealPlan)].filter(Boolean) as string[]))

  return {
    name: str(hd.hotelName),
    city: str(hd.city),
    address: str(hd.address),
    checkIn,
    checkOut,
    nights,
    roomType: str(cd.room_category) ?? str(rq.RoomTypeName) ?? (Array.from(new Set(rooms)).join(', ') || null),
    meal: boards.join(', ') || null,
  }
}

/* ── the run ────────────────────────────────────────────────────────── */

/** Order id behind a B2C booking: the ref is the store order id, the IS number its fallback. */
function baseOrderIdOf(b: { bookingRef: string; isNumber: string | null }): number {
  return Number(/^\d+$/.test(b.bookingRef) ? b.bookingRef : b.isNumber)
}

export async function placeB2cOrder(bookingRef: string): Promise<PlacementReport> {
  const booking = await prisma.booking.findUnique({
    where: { bookingRef },
    select: {
      id: true, bookingRef: true, isNumber: true, agent: true, status: true, tourDestination: true,
      passengers: { select: { name: true } },
      flights: { select: { flightNo: true, date: true, fromApt: true, toApt: true } },
      accommodations: { select: { hotel: true, checkIn: true } },
      tickets: { select: { notes: true } },
      pnl: { select: { lineItems: { select: { id: true, notes: true } } } },
    },
  })
  if (!booking) throw new B2cPlacementError('Booking not found', 404)
  if (!(await isB2cOriginBooking(booking.id, booking.agent))) {
    throw new B2cPlacementError('This is not an Aahaas B2C booking.', 409)
  }
  if (booking.status === 'CANCELLED') throw new B2cPlacementError('This booking is cancelled — nothing was added.', 409)
  if (!isB2cConfigured()) throw new B2cPlacementError('The Aahaas store database is not configured on this server.', 503)

  const baseOrderId = baseOrderIdOf(booking)
  if (!Number.isInteger(baseOrderId) || baseOrderId <= 0) {
    throw new B2cPlacementError(`Cannot tell which store order ${booking.bookingRef} came from.`, 422)
  }
  const { liveOrderId: orderId } = await resolveLiveOrderId(baseOrderId)

  const [products, flightRows] = await Promise.all([
    fetchOrderProducts([orderId]),
    fetchFlightBookings([orderId]).catch((): B2cFlightBooking[] => []),
  ])
  const hotelLines = products.filter(p => p.category_id === HOTEL_CATEGORY_ID)
  const warnings: string[] = []
  const stays = new Map<number, ReturnType<typeof stayFromBlob>>()
  if (hotelLines.length) {
    try {
      for (const row of await fetchHotelStayBlobs(hotelLines.map(p => Number(p.checkout_id)))) {
        stays.set(Number(row.line_id), stayFromBlob(row.bookingdataset))
      }
    } catch (err) {
      warnings.push(`Hotel stay details unreadable, used the order line dates: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  const guard = await loadChildGuard(booking.id)
  const report: PlacementReport = {
    orderId,
    tickets: { created: 0, skipped: 0, storeBooked: 0 },
    hotels: { created: 0, skipped: 0, locked: guard.isLocked('accommodations') },
    flights: { created: 0, skipped: 0, locked: guard.isLocked('flights') },
    passengers: { created: 0, locked: guard.isLocked('passengers') },
    warnings,
  }

  /* tickets */
  const pnlLines = booking.pnl?.lineItems ?? []
  for (const p of products) {
    const t = ticketFromLine(p)
    if (!t) continue
    if (booking.tickets.some(x => notesHaveTag(x.notes, `${B2C_LINE_TAG}${p.id}`))) { report.tickets.skipped++; continue }
    await prisma.ticket.create({
      data: {
        bookingId: booking.id,
        pnlLineId: pnlLineFor(pnlLines, Number(p.id)),
        type: t.type, category: t.category, qty: t.qty,
        costPerUnit: t.costPerUnit, totalCost: t.totalCost, currency: t.currency,
        supplier: t.supplier, notes: t.notes, status: 'DRAFT',
      },
    })
    report.tickets.created++
    if (t.storeBooked) report.tickets.storeBooked++
  }
  if (report.tickets.created > 0) await clearNoTicketsMark(booking.id).catch(() => { /* a stale mark only hides a hint */ })

  /* hotels */
  if (!report.hotels.locked) {
    for (const p of hotelLines) {
      const stay = stays.get(Number(p.checkout_id)) ?? null
      const checkIn = stay?.checkIn ?? ymd(p.service_date)
      if (!checkIn) { warnings.push(`Hotel line #${p.id} has no check-in date — add it by hand.`); continue }
      const nights = Math.max(1, stay?.nights ?? (stay?.checkOut ? daysBetween(checkIn, stay.checkOut) : 0) ?? 1)
      const checkOut = stay?.checkOut && stay.checkOut > checkIn ? stay.checkOut : addDays(checkIn, nights)
      const hotel = (stay?.name ?? str(p.product_name) ?? 'Hotel').slice(0, 191)
      if (booking.accommodations.some(a => norm(a.hotel) === norm(hotel) && day(a.checkIn) === checkIn)) { report.hotels.skipped++; continue }
      await prisma.accommodation.create({
        data: {
          bookingId: booking.id,
          hotel,
          city: (stay?.city ?? str(p.product_city) ?? str(p.service_location) ?? booking.tourDestination ?? '—').slice(0, 191),
          checkIn: new Date(`${checkIn}T00:00:00Z`),
          checkOut: new Date(`${checkOut}T00:00:00Z`),
          nights: daysBetween(checkIn, checkOut) || nights,
          address: stay?.address ?? null,
          roomType: stay?.roomType?.slice(0, 191) ?? null,
          mealType: stay?.meal?.slice(0, 191) ?? null,
        },
      })
      booking.accommodations.push({ hotel, checkIn: new Date(`${checkIn}T00:00:00Z`) })
      report.hotels.created++
    }
  }

  /* flights + travellers — the latest store row is the live booking after a reissue */
  const latest = flightRows[flightRows.length - 1]
  if (latest) {
    const data = ticketDataFromRow(orderId, latest)
    if (!report.flights.locked) {
      for (const s of data.segments) {
        const date = s.from.date
        if (!date || !s.from.code || !s.to.code) continue
        const flightNo = (s.flightNo ?? 'TBA').slice(0, 191)
        const dup = booking.flights.some(f => day(f.date) === date && (
          s.flightNo ? norm(f.flightNo) === norm(s.flightNo) : f.fromApt.toUpperCase() === s.from.code && f.toApt.toUpperCase() === s.to.code
        ))
        if (dup) { report.flights.skipped++; continue }
        await prisma.flight.create({
          data: {
            bookingId: booking.id,
            flightNo,
            date: new Date(`${date}T00:00:00Z`),
            fromApt: s.from.code,
            toApt: s.to.code,
            depTime: s.from.time ?? '',
            arrTime: s.to.time ?? '',
            airline: s.airline?.slice(0, 191) ?? null,
            notes: [data.bookingRef ? `Aahaas store PNR ${data.bookingRef}` : 'Aahaas store order', data.airlinePnr ? `Airline PNR ${data.airlinePnr}` : null, s.cabin].filter(Boolean).join(' · ').slice(0, 191),
          },
        })
        booking.flights.push({ flightNo, date: new Date(`${date}T00:00:00Z`), fromApt: s.from.code, toApt: s.to.code })
        report.flights.created++
      }
    }
    if (!report.passengers.locked) {
      const known = new Set(booking.passengers.map(p => personKey(p.name)))
      for (const person of data.passengers) {
        const key = personKey(person.name)
        if (!key || known.has(key)) continue
        known.add(key)
        await prisma.passenger.create({
          data: {
            bookingId: booking.id,
            name: person.name.slice(0, 191),
            type: /child|infant/i.test(person.type ?? '') ? 'CHILD' : 'ADULT',
            isLead: booking.passengers.length === 0 && report.passengers.created === 0,
          },
        })
        report.passengers.created++
      }
    }
  }

  return report
}

const PLACED_KEY = 'b2c_placed:'

/**
 * The importer's call: place a booking's store order once, and remember it in
 * `system_settings` so later runs do not re-read the store for it (the button
 * is there for a later amendment). Bookings imported before 2026-11-10 get the
 * same one-time fill on the next run. Never throws.
 */
export async function placeOnceForImport(bookingRef: string): Promise<{ done: boolean; message: string | null }> {
  const key = `${PLACED_KEY}${bookingRef}`
  try {
    if (await prisma.systemSetting.findUnique({ where: { key }, select: { key: true } })) return { done: false, message: null }
    const r = await placeB2cOrder(bookingRef)
    const value = JSON.stringify({ at: new Date().toISOString(), orderId: r.orderId, tickets: r.tickets.created, hotels: r.hotels.created, flights: r.flights.created, passengers: r.passengers.created })
    await prisma.systemSetting.upsert({ where: { key }, update: { value }, create: { key, value } })
    return { done: true, message: describePlacement(r) }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.warn(`[b2c-placement] ${bookingRef}: ${message}`)
    return { done: false, message: `${bookingRef}: tickets/hotels/flights not placed — ${message}` }
  }
}

/** "MR JOHN SMITH" and "John Smith" are one traveller. */
function personKey(name: string | null | undefined): string {
  return (name ?? '').toLowerCase().replace(/\b(mr|mrs|ms|miss|mstr|master|dr)\b\.?/g, ' ').replace(/[^a-z]+/g, '')
}

/** One line for a toast. */
export function describePlacement(r: PlacementReport): string {
  const parts: string[] = []
  if (r.tickets.created) parts.push(`${r.tickets.created} ticket${r.tickets.created === 1 ? '' : 's'}${r.tickets.storeBooked ? ` (${r.tickets.storeBooked} already booked by the store)` : ''}`)
  if (r.hotels.created) parts.push(`${r.hotels.created} hotel${r.hotels.created === 1 ? '' : 's'}`)
  if (r.flights.created) parts.push(`${r.flights.created} flight${r.flights.created === 1 ? '' : 's'}`)
  if (r.passengers.created) parts.push(`${r.passengers.created} traveller${r.passengers.created === 1 ? '' : 's'}`)
  const locked = [r.flights.locked && 'flights', r.hotels.locked && 'hotels', r.passengers.locked && 'passengers'].filter(Boolean)
  const tail = locked.length ? ` ${locked.join(', ')} locked, left as they were.` : ''
  if (!parts.length) return `Everything on store order ${r.orderId} is already on this booking.${tail}`
  return `Added from store order ${r.orderId}: ${parts.join(', ')}.${tail}`
}
