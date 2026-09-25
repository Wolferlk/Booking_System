/**
 * MC Report desk figures (`agenda_mc_details`) and the booking context read
 * beside each movement. See prisma/sql/2026-09-25-agenda-mc-details.sql and
 * src/lib/mc-report-fields.ts for which country gets which column.
 *
 * Like tickets-control.ts, everything here tolerates its table not existing yet
 * (the SQL is run on each database by hand): reads come back empty, the
 * chart-save carry-over is skipped, and a write says what to run.
 */
import { prisma } from '@/lib/prisma'
import {
  MC_FIELD_META, SPECIAL_REQUEST_MAX, flightDirection, parseMcNumber, summariseMealPrefs,
  type McBookingRequest, type McDetails, type McFieldKey, type McFlight, type McMealPref,
} from '@/lib/mc-report-fields'

export const MC_DETAILS_NOT_READY =
  'MC Report figures are not set up on this database yet — run prisma/sql/apply-agenda-mc-details.sh.'

export function isMcDetailsMissing(err: unknown): boolean {
  const e = err as { code?: string; message?: string }
  return e?.code === 'P2021' || /agenda_mc_details.*(doesn't exist|does not exist)|1146/i.test(e?.message ?? '')
}

function isTableMissing(err: unknown): boolean {
  const e = err as { code?: string; message?: string }
  return e?.code === 'P2021' || /doesn't exist|does not exist|1146/i.test(e?.message ?? '')
}

type Row = {
  packageCost: unknown; budgetKm: unknown; actualKm: unknown; budgetTransfer: unknown
  currency: string | null; specialRequest: string | null
  updatedByName: string | null; updatedAt: Date
}

const num = (v: unknown) => (v == null ? null : Number(v))

function toDetails(r: Row): McDetails {
  return {
    packageCost:    num(r.packageCost),
    budgetKm:       num(r.budgetKm),
    actualKm:       num(r.actualKm),
    budgetTransfer: num(r.budgetTransfer),
    specialRequest: r.specialRequest ?? null,
    currency:       r.currency ?? null,
    updatedByName:  r.updatedByName ?? null,
    updatedAt:      r.updatedAt.toISOString(),
  }
}

/** Desk figures for many movements at once, keyed by agenda item id. Never throws. */
export async function loadMcDetails(agendaItemIds: string[]): Promise<Record<string, McDetails>> {
  const out: Record<string, McDetails> = {}
  if (!agendaItemIds.length) return out
  try {
    const rows = await prisma.agendaMcDetail.findMany({ where: { agendaItemId: { in: agendaItemIds } } })
    for (const r of rows) out[r.agendaItemId] = toDetails(r)
  } catch (err) {
    if (!isMcDetailsMissing(err)) console.error('[mc-details] load failed (non-fatal):', err)
  }
  return out
}

export class McDetailInputError extends Error {}

/**
 * Set (or, with a blank value, clear) one figure on one movement. The row is
 * removed once every figure on it is empty. Throws McDetailInputError on a bad
 * value, and the Prisma error when the table is missing.
 */
export async function setMcDetail(
  agendaItemId: string,
  bookingRef: string,
  field: McFieldKey,
  raw: unknown,
  currency: string,
  user: { id?: string | null; name?: string | null },
): Promise<McDetails> {
  let value: number | string | null
  if (MC_FIELD_META[field].kind === 'text') {
    value = String(raw ?? '').replace(/\s+/g, ' ').trim().slice(0, SPECIAL_REQUEST_MAX) || null
  } else {
    const n = parseMcNumber(raw)
    if (n !== null && (Number.isNaN(n) || n < 0)) {
      throw new McDetailInputError(`${MC_FIELD_META[field].label} must be a positive number`)
    }
    if (n !== null && n > 9_999_999_999) throw new McDetailInputError(`${MC_FIELD_META[field].label} is too large`)
    value = n === null ? null : Math.round(n * (MC_FIELD_META[field].kind === 'km' ? 10 : 100)) / (MC_FIELD_META[field].kind === 'km' ? 10 : 100)
  }

  const audit = { updatedById: user.id ?? null, updatedByName: user.name ?? null }
  const isMoney = MC_FIELD_META[field].kind === 'money'
  const row = await prisma.agendaMcDetail.upsert({
    where: { agendaItemId },
    create: { agendaItemId, bookingRef, [field]: value, ...(isMoney ? { currency } : {}), ...audit },
    update: { bookingRef, [field]: value, ...(isMoney && value !== null ? { currency } : {}), ...audit },
  })

  const empty = row.packageCost == null && row.budgetKm == null && row.actualKm == null
    && row.budgetTransfer == null && !row.specialRequest
  if (empty) {
    await prisma.agendaMcDetail.deleteMany({ where: { agendaItemId } })
    return {}
  }
  return toDetails(row)
}

/**
 * A chart save recreated this booking's movements under new ids: move each row
 * from the old id to the new one. Same rules as carryTicketsControl — a row
 * whose movement was removed is left where it is, never deleted. Non-fatal.
 */
export async function carryMcDetails(bookingRef: string, pairs: [string, string][]): Promise<void> {
  if (!pairs.length) return
  try {
    const existing = await prisma.agendaMcDetail.findMany({
      where: { bookingRef, agendaItemId: { in: pairs.map(([oldId]) => oldId) } },
      select: { agendaItemId: true },
    })
    if (!existing.length) return
    const newIdFor = new Map(pairs)
    await prisma.$transaction(existing.map(({ agendaItemId }) =>
      prisma.agendaMcDetail.update({
        where: { agendaItemId },
        data: { agendaItemId: newIdFor.get(agendaItemId)! },
      }),
    ))
  } catch (err) {
    if (!isMcDetailsMissing(err)) console.error('[mc-details] carry-over failed (non-fatal):', err)
  }
}

// ── Booking context ───────────────────────────────────────────────────────────

export type McBookingContext = {
  /** Sri Lanka only. Every flight on the file, in date order. */
  flights: McFlight[]
  arrivalDate: string
  departureDate: string
  mealPrefs: McMealPref[]
  requests: McBookingRequest[]
  /** Sri Lanka only — the booking's allocated vehicle type (allocation board). */
  allocationVehicleType: string | null
  /** Sri Lanka only — whole-tour figures from the saved transport settlement sheet. */
  tour: { packageCost: number | null; budgetKm: number | null; actualKm: number | null } | null
}

const day = (d: Date) => d.toISOString().slice(0, 10)
const clean = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim()

/**
 * Everything the report shows about a booking rather than a movement, for every
 * booking in view in a handful of queries. Each optional source (special notes,
 * settlement sheets) may be a table this database does not have yet; a missing
 * one leaves that part empty rather than failing the report.
 */
export async function loadBookingContext(
  bookings: { id: string; bookingRef: string; operationCountry: string | null }[],
): Promise<Map<string, McBookingContext>> {
  const out = new Map<string, McBookingContext>()
  if (!bookings.length) return out

  const ids    = bookings.map(b => b.id)
  const slIds  = bookings.filter(b => b.operationCountry === 'SRILANKA').map(b => b.id)
  const slRefs = bookings.filter(b => b.operationCountry === 'SRILANKA').map(b => b.bookingRef)

  const [base, flights, passengers, allocations] = await Promise.all([
    prisma.booking.findMany({
      where: { id: { in: ids } },
      select: { id: true, bookingRef: true, arrivalDate: true, departureDate: true, clientRequest: true, specialOccasions: true },
    }),
    slIds.length
      ? prisma.flight.findMany({
          where: { bookingId: { in: slIds } },
          select: { bookingId: true, flightNo: true, date: true, fromApt: true, toApt: true, depTime: true, arrTime: true, airline: true },
          orderBy: [{ date: 'asc' }, { depTime: 'asc' }],
        })
      : Promise.resolve([]),
    prisma.passenger.findMany({
      where: { bookingId: { in: ids }, mealPreference: { not: null } },
      select: { bookingId: true, name: true, mealPreference: true },
    }),
    slIds.length
      ? prisma.sriLankaDriverAllocation.findMany({
          where: { bookingId: { in: slIds } },
          select: { bookingId: true, vehicleType: true },
        }).catch(err => { if (!isTableMissing(err)) console.error('[mc-details] allocations', err); return [] })
      : Promise.resolve([]),
  ])

  const refs = base.map(b => b.bookingRef)
  const [notes, packs] = await Promise.all([
    prisma.passengerSpecialNote.findMany({
      where: { bookingRef: { in: refs } },
      select: { bookingRef: true, passengerName: true, note: true },
    }).catch(err => { if (!isTableMissing(err)) console.error('[mc-details] special notes', err); return [] }),
    slRefs.length
      ? prisma.slSettlementDoc.findMany({
          where: { bookingRef: { in: slRefs } },
          select: { bookingRef: true, pack: true },
        }).catch(err => { if (!isTableMissing(err)) console.error('[mc-details] settlement packs', err); return [] })
      : Promise.resolve([]),
  ])

  const group = <T, K>(rows: T[], key: (r: T) => K) => {
    const m = new Map<K, T[]>()
    for (const r of rows) { const k = key(r); const a = m.get(k); if (a) a.push(r); else m.set(k, [r]) }
    return m
  }
  const flightsBy = group(flights, f => f.bookingId)
  const paxBy     = group(passengers, p => p.bookingId)
  const notesBy   = group(notes, n => n.bookingRef)
  const allocBy   = new Map(allocations.map(a => [a.bookingId, a.vehicleType]))
  const figure    = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
  const packBy    = new Map(packs.map(p => {
    const t = (p.pack as { transport?: { packageCost?: unknown; maxMileage?: unknown; km?: unknown } } | null)?.transport
    return [p.bookingRef, t ? { packageCost: figure(t.packageCost), budgetKm: figure(t.maxMileage), actualKm: figure(t.km) } : null]
  }))

  for (const b of base) {
    const arrival = day(b.arrivalDate), departure = day(b.departureDate)
    const requests: McBookingRequest[] = []
    if (clean(b.clientRequest))    requests.push({ source: 'Client request', text: clean(b.clientRequest) })
    if (clean(b.specialOccasions)) requests.push({ source: 'Occasion',       text: clean(b.specialOccasions) })
    for (const n of notesBy.get(b.bookingRef) ?? []) {
      if (clean(n.note)) requests.push({ source: n.passengerName, text: clean(n.note) })
    }
    const tour = packBy.get(b.bookingRef) ?? null

    out.set(b.id, {
      arrivalDate: arrival,
      departureDate: departure,
      flights: (flightsBy.get(b.id) ?? []).map(f => {
        const d = day(f.date)
        const shape = { date: d, fromApt: clean(f.fromApt), toApt: clean(f.toApt) }
        return {
          flightNo: clean(f.flightNo), ...shape,
          depTime: clean(f.depTime), arrTime: clean(f.arrTime), airline: clean(f.airline) || null,
          direction: flightDirection(shape, arrival, departure),
        }
      }),
      mealPrefs: summariseMealPrefs(paxBy.get(b.id) ?? []),
      requests,
      allocationVehicleType: clean(allocBy.get(b.id)) || null,
      tour: tour && (tour.packageCost != null || tour.budgetKm != null || tour.actualKm != null) ? tour : null,
    })
  }
  return out
}
