/**
 * Driver Brief — the file, arranged the way it is read out loud to a driver.
 *
 * Every other view of a booking is arranged for the desk: a table of movements,
 * a P&L, a chart. None of them is readable to somebody on a phone call with a
 * driver who has not seen the file, because that conversation runs in a fixed
 * order — *who are you driving with, who are the guests, when do they land,
 * where do they sleep, where do you take them, what is already paid for* — and
 * the answer to each has to be one screen, not one column of a spreadsheet.
 *
 * So this module returns the booking as an ordered deck of slides, each one
 * self-contained, plus the AI talking points that turn a row of data into a
 * sentence somebody can actually say. It is read-only over the booking: the
 * single thing the feature writes is the brief record itself (`driver_briefs`),
 * which is the evidence that the conversation happened.
 *
 * Deliberately absent: money. `Assignment.driverRate`, the driver advance and
 * every P&L figure are excluded from the payload, because this deck is opened
 * on a screen a driver can see and a driver never sees our rates — the same
 * rule the driver-facing WhatsApp messages follow.
 */
import { prisma } from '@/lib/prisma'
import openai, { logAiUsage } from '@/lib/openai'
import { resolveIsHotelOnly, movementNeedsDriver } from '@/lib/driver-requirement'
import { serviceTypeLabel } from '@/lib/service-types'

const MODEL = () => process.env.OPENAI_DRIVER_BRIEF_MODEL || process.env.OPENAI_JOURNEY_MODEL || 'gpt-4o-mini'

// ── Slides ───────────────────────────────────────────────────────────────────

/** The deck's fixed running order. The UI never reorders these. */
export const BRIEF_SLIDES = [
  'driver', 'overview', 'flights', 'hotels', 'movements', 'tickets', 'notes',
] as const
export type BriefSlideId = (typeof BRIEF_SLIDES)[number]

// ── Shapes ───────────────────────────────────────────────────────────────────

export interface BriefVehicle {
  type: string
  plateNo: string
  brand: string | null
  model: string | null
  capacity: number | null
  photoInside: string | null
  photoOutside: string | null
}

export interface BriefDriver {
  id: string | null
  name: string
  phone: string | null
  photoUrl: string | null
  email: string | null
  licenseNo: string | null
  isActive: boolean
  country: string | null
  vehicle: BriefVehicle | null
  vendorName: string | null
  vendorPhone: string | null
  /**
   * `primary` is the driver on the Sri Lanka allocation board — the one the
   * file is allocated to. `movement` is a driver named on individual movement
   * rows only. A file can have both: a main driver plus a transfer driver for
   * the airport run, and the brief has to name every one of them.
   */
  role: 'primary' | 'movement'
  /** Movement dates this driver personally covers, ISO yyyy-mm-dd. */
  dates: string[]
  movementCount: number
  /** Vehicle plate typed straight onto a movement, when there is no registered vehicle. */
  vehiclePlate: string | null
  vehicleType: string | null
}

export interface BriefFlight {
  id: string
  flightNo: string
  date: string
  airline: string | null
  fromApt: string
  depTime: string
  toApt: string
  arrTime: string
  notes: string | null
  /** First flight of the file = the one the driver meets at the airport. */
  kind: 'arrival' | 'departure' | 'internal'
}

export interface BriefHotel {
  id: string
  hotel: string
  city: string
  checkIn: string
  checkOut: string
  nights: number
  roomType: string | null
  mealType: string | null
  address: string | null
  contact: string | null
  ownArrangement: boolean
}

export interface BriefMovement {
  id: string
  date: string
  dayNo: number
  location: string
  fromPoint: string | null
  toPoint: string | null
  details: string | null
  serviceType: string
  serviceLabel: string
  timeFrom: string | null
  timeTo: string | null
  meetingTime: string | null
  mealPlan: string | null
  noDriverNeeded: boolean
  driverName: string | null
  driverPhone: string | null
  guideName: string | null
  guidePhone: string | null
  notes: string | null
  ticketCount: number
}

export interface BriefTicket {
  id: string
  type: string
  category: string | null
  qty: number
  status: string
  activated: boolean
  supplier: string | null
  reference: string | null
  notes: string | null
  date: string | null
  location: string | null
}

export interface BriefPassenger {
  name: string
  type: string
  isLead: boolean
  contact: string | null
  passportNo: string | null
  nationality: string | null
}

export interface BriefRecord {
  status: 'pending' | 'in_progress' | 'completed'
  notes: string
  slidesSeen: Record<string, boolean>
  startedAt: string | null
  completedAt: string | null
  briefedByName: string | null
  driverName: string | null
}

export interface DriverBriefPayload {
  bookingRef: string
  isNumber: string | null
  cntlNumber: string | null
  agent: string | null
  fileHandler: string | null
  status: string
  country: string | null
  tourDestination: string | null
  arrivalDate: string
  departureDate: string
  nights: number
  /** Days until arrival. Negative once the tour has started. */
  daysToArrival: number
  paxAdults: number
  paxChildren: number
  contactPhone: string | null
  contactEmail: string | null
  importantNotes: string | null
  hotelOnly: boolean
  passengers: BriefPassenger[]
  leadName: string | null
  drivers: BriefDriver[]
  primaryDriver: BriefDriver | null
  flights: BriefFlight[]
  hotels: BriefHotel[]
  movements: BriefMovement[]
  tickets: BriefTicket[]
  /** Movements that still have nobody on them — read out as a warning. */
  unassignedDates: string[]
  brief: BriefRecord
  ai: BriefAi | null
}

// ── AI talking points ────────────────────────────────────────────────────────

export interface BriefAi {
  /** One sentence the briefer can open with. */
  headline: string
  /** Per-slide bullets: what to actually say on that screen. */
  sections: { slide: BriefSlideId; points: string[] }[]
  /** The things that go wrong on this specific file. */
  watchOuts: string[]
  /** Questions the driver should be asked to confirm he understood. */
  questions: string[]
  generatedAt: string
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const iso = (d: Date | string | null | undefined): string =>
  d ? new Date(d).toISOString().slice(0, 10) : ''

function dayDiff(from: Date, to: Date): number {
  const a = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate())
  const b = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate())
  return Math.round((b - a) / 86_400_000)
}

/** Today at UTC midnight — every date in this module is a calendar date. */
export function todayUtc(): Date {
  const n = new Date()
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate()))
}

// ── Payload ──────────────────────────────────────────────────────────────────

/**
 * Everything the deck shows, for one booking. Returns null when the ref is
 * unknown — the caller turns that into a 404 rather than an empty deck, because
 * an empty deck read to a driver is worse than no deck.
 */
export async function buildDriverBrief(bookingRef: string): Promise<DriverBriefPayload | null> {
  const booking = await prisma.booking.findUnique({
    where: { bookingRef },
    select: {
      id: true, bookingRef: true, isNumber: true, cntlNumber: true, agent: true,
      fileHandler: true, status: true, operationCountry: true, tourDestination: true,
      arrivalDate: true, departureDate: true, paxAdults: true, paxChildren: true,
      contactPhone: true, contactEmail: true, importantNotes: true, hotelOnly: true,
      passengers: {
        orderBy: [{ isLead: 'desc' }, { name: 'asc' }],
        select: { name: true, type: true, isLead: true, contact: true, passport: true, nationality: true },
      },
      flights: {
        orderBy: [{ date: 'asc' }],
        select: {
          id: true, flightNo: true, date: true, airline: true, fromApt: true,
          depTime: true, toApt: true, arrTime: true, notes: true,
        },
      },
      accommodations: {
        orderBy: { checkIn: 'asc' },
        select: {
          id: true, hotel: true, city: true, checkIn: true, checkOut: true, nights: true,
          roomType: true, mealType: true, address: true, contact: true, ownArrangement: true,
        },
      },
      tickets: {
        orderBy: { createdAt: 'asc' },
        select: {
          id: true, type: true, category: true, qty: true, status: true, activated: true,
          supplier: true, reference: true, notes: true,
          agendaItem: { select: { date: true, location: true } },
        },
      },
      tourAgenda: {
        select: {
          items: {
            orderBy: [{ date: 'asc' }, { sortOrder: 'asc' }],
            select: {
              id: true, date: true, location: true, fromPoint: true, toPoint: true,
              details: true, serviceType: true, timeFrom: true, timeTo: true,
              meetingTime: true, mealPlan: true, isLeisure: true, isHotelOnly: true,
              _count: { select: { tickets: true } },
              assignment: {
                select: {
                  driverName: true, driverPhone: true, vehicleType: true, vehiclePlate: true,
                  guideName: true, guidePhone: true, notes: true, vendorName: true,
                  driver: {
                    select: {
                      id: true, name: true, phone: true, photoUrl: true, email: true,
                      licenseNo: true, isActive: true, country: true,
                      vehicle: {
                        select: {
                          type: true, plateNo: true, brand: true, model: true,
                          capacity: true, photoInside: true, photoOutside: true,
                        },
                      },
                      vendorOwner: { select: { name: true, phone: true } },
                    },
                  },
                },
              },
            },
          },
        },
      },
      slDriverAllocation: {
        select: {
          vehicleType: true, notes: true, isEmergency: true,
          vendor: { select: { name: true, phone: true } },
          driver: {
            select: {
              id: true, name: true, phone: true, photoUrl: true, email: true,
              licenseNo: true, isActive: true, country: true,
              vehicle: {
                select: {
                  type: true, plateNo: true, brand: true, model: true,
                  capacity: true, photoInside: true, photoOutside: true,
                },
              },
              vendorOwner: { select: { name: true, phone: true } },
            },
          },
        },
      },
    },
  })

  if (!booking) return null

  const record = await prisma.driverBrief.findUnique({ where: { bookingRef } })

  // ── Movements ──────────────────────────────────────────────────────────
  const rawItems = booking.tourAgenda?.items ?? []
  const firstDate = rawItems.length ? new Date(rawItems[0].date) : new Date(booking.arrivalDate)

  const movements: BriefMovement[] = rawItems.map(it => {
    const a = it.assignment
    return {
      id: it.id,
      date: iso(it.date),
      dayNo: dayDiff(firstDate, new Date(it.date)) + 1,
      location: it.location,
      fromPoint: it.fromPoint,
      toPoint: it.toPoint,
      details: it.details,
      serviceType: it.serviceType,
      serviceLabel: serviceTypeLabel(it.serviceType),
      timeFrom: it.timeFrom,
      timeTo: it.timeTo,
      meetingTime: it.meetingTime,
      mealPlan: it.mealPlan,
      // A leisure or hotel-only day is not an unassigned day — nobody is meant
      // to drive it. Reusing the shared rule keeps the deck's warnings in step
      // with the allocation board's counters.
      noDriverNeeded: !movementNeedsDriver(it) || resolveIsHotelOnly(it),
      driverName: a?.driver?.name ?? a?.driverName ?? null,
      driverPhone: a?.driver?.phone ?? a?.driverPhone ?? null,
      guideName: a?.guideName ?? null,
      guidePhone: a?.guidePhone ?? null,
      notes: a?.notes ?? null,
      ticketCount: it._count.tickets,
    }
  })

  // ── Drivers ────────────────────────────────────────────────────────────
  // The allocation board's driver is the primary; movement rows can name
  // others. Both are collected, de-duplicated by driver id (falling back to
  // name+phone for ad-hoc drivers typed straight onto a row), and the dates
  // each one personally covers are attached — that list is what makes the
  // difference between "you have the whole tour" and "you have the airport run".
  const drivers = new Map<string, BriefDriver>()

  const keyFor = (id: string | null, name: string, phone: string | null) =>
    id ? `id:${id}` : `ad:${name.toLowerCase()}|${(phone ?? '').replace(/\D/g, '')}`

  const alloc = booking.slDriverAllocation
  if (alloc?.driver) {
    const d = alloc.driver
    drivers.set(keyFor(d.id, d.name, d.phone), {
      id: d.id, name: d.name, phone: d.phone, photoUrl: d.photoUrl, email: d.email,
      licenseNo: d.licenseNo, isActive: d.isActive, country: d.country ?? null,
      vehicle: d.vehicle ?? null,
      vendorName: d.vendorOwner?.name ?? alloc.vendor?.name ?? null,
      vendorPhone: d.vendorOwner?.phone ?? alloc.vendor?.phone ?? null,
      role: 'primary', dates: [], movementCount: 0,
      vehiclePlate: d.vehicle?.plateNo ?? null,
      vehicleType: d.vehicle?.type ?? alloc.vehicleType ?? null,
    })
  }

  for (const it of rawItems) {
    const a = it.assignment
    if (!a) continue
    const name = a.driver?.name ?? a.driverName
    if (!name) continue
    const phone = a.driver?.phone ?? a.driverPhone ?? null
    const k = keyFor(a.driver?.id ?? null, name, phone)

    if (!drivers.has(k)) {
      const d = a.driver
      drivers.set(k, {
        id: d?.id ?? null, name, phone,
        photoUrl: d?.photoUrl ?? null, email: d?.email ?? null,
        licenseNo: d?.licenseNo ?? null, isActive: d?.isActive ?? true,
        country: d?.country ?? null,
        vehicle: d?.vehicle ?? null,
        vendorName: d?.vendorOwner?.name ?? a.vendorName ?? null,
        vendorPhone: d?.vendorOwner?.phone ?? null,
        role: 'movement', dates: [], movementCount: 0,
        vehiclePlate: d?.vehicle?.plateNo ?? a.vehiclePlate ?? null,
        vehicleType: d?.vehicle?.type ?? a.vehicleType ?? null,
      })
    }
    const entry = drivers.get(k)!
    entry.movementCount += 1
    const day = iso(it.date)
    if (day && !entry.dates.includes(day)) entry.dates.push(day)
  }

  const driverList = Array.from(drivers.values()).sort((a, b) =>
    a.role === b.role ? b.movementCount - a.movementCount : a.role === 'primary' ? -1 : 1,
  )
  // With no allocation row, the driver covering the most movements is the one
  // the brief opens on — he is the driver in every practical sense.
  const primary = driverList.find(d => d.role === 'primary') ?? driverList[0] ?? null

  // ── Flights ────────────────────────────────────────────────────────────
  // The first and last sectors are the ones the driver meets and drops; the
  // rest are internal hops he has to get the guests to on time.
  const flights: BriefFlight[] = booking.flights.map((f, i, arr) => ({
    id: f.id, flightNo: f.flightNo, date: iso(f.date), airline: f.airline,
    fromApt: f.fromApt, depTime: f.depTime, toApt: f.toApt, arrTime: f.arrTime,
    notes: f.notes,
    kind: i === 0 ? 'arrival' : i === arr.length - 1 ? 'departure' : 'internal',
  }))

  const arrival = new Date(booking.arrivalDate)
  const departure = new Date(booking.departureDate)

  return {
    bookingRef: booking.bookingRef,
    isNumber: booking.isNumber,
    cntlNumber: booking.cntlNumber,
    agent: booking.agent,
    fileHandler: booking.fileHandler,
    status: booking.status,
    country: booking.operationCountry ?? null,
    tourDestination: booking.tourDestination,
    arrivalDate: iso(arrival),
    departureDate: iso(departure),
    nights: Math.max(0, dayDiff(arrival, departure)),
    daysToArrival: dayDiff(todayUtc(), arrival),
    paxAdults: booking.paxAdults,
    paxChildren: booking.paxChildren,
    contactPhone: booking.contactPhone,
    contactEmail: booking.contactEmail,
    importantNotes: booking.importantNotes,
    hotelOnly: booking.hotelOnly,
    passengers: booking.passengers.map(p => ({
      name: p.name, type: String(p.type), isLead: p.isLead,
      contact: p.contact, passportNo: p.passport, nationality: p.nationality,
    })),
    leadName: booking.passengers.find(p => p.isLead)?.name ?? booking.passengers[0]?.name ?? null,
    drivers: driverList,
    primaryDriver: primary,
    flights,
    hotels: booking.accommodations.map(h => ({
      id: h.id, hotel: h.hotel, city: h.city, checkIn: iso(h.checkIn), checkOut: iso(h.checkOut),
      nights: h.nights, roomType: h.roomType, mealType: h.mealType,
      address: h.address, contact: h.contact, ownArrangement: h.ownArrangement,
    })),
    movements,
    tickets: booking.tickets.map(t => ({
      id: t.id, type: t.type, category: t.category, qty: t.qty, status: String(t.status),
      activated: t.activated, supplier: t.supplier, reference: t.reference, notes: t.notes,
      date: t.agendaItem ? iso(t.agendaItem.date) : null,
      location: t.agendaItem?.location ?? null,
    })),
    unassignedDates: movements
      .filter(m => !m.noDriverNeeded && !m.driverName)
      .map(m => m.date),
    brief: {
      status: (record?.status as BriefRecord['status']) ?? 'pending',
      notes: record?.notes ?? '',
      slidesSeen: (record?.slidesSeen as Record<string, boolean>) ?? {},
      startedAt: record?.startedAt?.toISOString() ?? null,
      completedAt: record?.completedAt?.toISOString() ?? null,
      briefedByName: record?.briefedByName ?? null,
      driverName: record?.driverName ?? null,
    },
    ai: (record?.aiBrief as unknown as BriefAi) ?? null,
  }
}

// ── AI ───────────────────────────────────────────────────────────────────────

const AI_PROMPT = `You are a Sri Lanka / South-East Asia ground operations supervisor writing the
crib sheet an ops officer reads aloud to a tour driver on the phone, one screen at a time.

You are given ONE booking as JSON. Write what the officer should SAY. Not a summary of the data —
the officer can already see the data. Say the thing the data implies that a driver would otherwise
get wrong: a pre-dawn airport pickup, a same-day hotel change, a long drive squeezed after a late
landing, a child in the party, a leisure day he must not turn up for, an entrance ticket he must
collect rather than buy, a departure he has to leave three hours early for.

Rules:
- Second person, addressed to the driver ("You pick them up at...", "Do not...").
- Short spoken sentences. Under 22 words each. No markdown, no bullets characters, no emoji.
- Use real names, real times, real places from the JSON. Never invent a fact that is not there.
- If a section has nothing worth saying beyond the obvious, return fewer points, not filler.
- NEVER mention money, rates, costs, commission, advances or margins. The driver must not hear them.
- Times are local. Dates as "Mon 31 Aug".

Return STRICT JSON, no prose around it:
{
  "headline": "one sentence naming the driver, guest party and the shape of the trip",
  "sections": [
    { "slide": "driver",    "points": ["..."] },
    { "slide": "overview",  "points": ["..."] },
    { "slide": "flights",   "points": ["..."] },
    { "slide": "hotels",    "points": ["..."] },
    { "slide": "movements", "points": ["..."] },
    { "slide": "tickets",   "points": ["..."] }
  ],
  "watchOuts": ["the things that go wrong on THIS file, 2-5 items"],
  "questions": ["questions to ask the driver back so you know he understood, 2-4 items"]
}
Every "points" array holds 2 to 5 strings. Omit a section entirely if the booking carries no such data.`

/**
 * The spoken half of the deck.
 *
 * Kept separate from `buildDriverBrief` and cached on the brief record, because
 * the payload has to render instantly when somebody already has a driver on the
 * line — a model call in that path would mean staring at a spinner mid-call. So
 * the deck opens on data first and the talking points arrive after, or come
 * straight back out of `aiBrief` on every reopen.
 *
 * Never throws: a model outage costs the officer his crib sheet, not his deck.
 */
export async function generateBriefAi(payload: DriverBriefPayload): Promise<BriefAi | null> {
  if (!process.env.OPENAI_API_KEY) return null

  // Sent to the model deliberately narrowed: no passport numbers, no contact
  // emails, no money anywhere. What the driver may hear, and nothing else.
  const input = {
    bookingRef: payload.bookingRef,
    country: payload.country,
    tourDestination: payload.tourDestination,
    arrivalDate: payload.arrivalDate,
    departureDate: payload.departureDate,
    nights: payload.nights,
    guests: { adults: payload.paxAdults, children: payload.paxChildren, lead: payload.leadName },
    passengers: payload.passengers.map(p => ({ name: p.name, type: p.type, nationality: p.nationality })),
    importantNotes: payload.importantNotes,
    driver: payload.primaryDriver && {
      name: payload.primaryDriver.name,
      vehicle: payload.primaryDriver.vehicle
        ? `${payload.primaryDriver.vehicle.brand ?? ''} ${payload.primaryDriver.vehicle.model ?? ''} ${payload.primaryDriver.vehicle.plateNo}`.trim()
        : payload.primaryDriver.vehicleType,
      covers: payload.primaryDriver.dates,
    },
    otherDrivers: payload.drivers.filter(d => d !== payload.primaryDriver).map(d => ({
      name: d.name, dates: d.dates, vehicle: d.vehicleType,
    })),
    flights: payload.flights,
    hotels: payload.hotels.map(h => ({
      hotel: h.hotel, city: h.city, checkIn: h.checkIn, checkOut: h.checkOut,
      nights: h.nights, meal: h.mealType, ownArrangement: h.ownArrangement,
    })),
    movements: payload.movements.map(m => ({
      date: m.date, day: m.dayNo, location: m.location, from: m.fromPoint, to: m.toPoint,
      service: m.serviceLabel, timeFrom: m.timeFrom, meetingTime: m.meetingTime,
      meal: m.mealPlan, freeDay: m.noDriverNeeded, driver: m.driverName,
      guide: m.guideName, note: m.details,
    })),
    tickets: payload.tickets.map(t => ({
      type: t.type, qty: t.qty, date: t.date, location: t.location,
      status: t.status, activated: t.activated, supplier: t.supplier,
    })),
    unassignedDates: payload.unassignedDates,
  }

  try {
    const res = await openai.chat.completions.create({
      model: MODEL(),
      temperature: 0.3,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: AI_PROMPT },
        { role: 'user', content: JSON.stringify(input) },
      ],
    })
    await logAiUsage({
      callType: 'driver_brief',
      model: MODEL(),
      usage: res.usage,
      bookingRef: payload.bookingRef,
      source: 'booking',
    })

    const parsed = JSON.parse(res.choices[0]?.message?.content ?? '{}')
    const allowed = new Set<string>(BRIEF_SLIDES)
    const clean = (v: unknown): string[] =>
      Array.isArray(v) ? v.map(x => String(x ?? '').trim()).filter(Boolean).slice(0, 6) : []

    const ai: BriefAi = {
      headline: String(parsed?.headline ?? '').trim(),
      sections: (Array.isArray(parsed?.sections) ? parsed.sections : [])
        .filter((s: { slide?: string }) => allowed.has(String(s?.slide)))
        .map((s: { slide: string; points?: unknown }) => ({
          slide: s.slide as BriefSlideId,
          points: clean(s.points),
        }))
        .filter((s: { points: string[] }) => s.points.length > 0),
      watchOuts: clean(parsed?.watchOuts),
      questions: clean(parsed?.questions),
      generatedAt: new Date().toISOString(),
    }

    return ai.headline || ai.sections.length ? ai : null
  } catch (e) {
    console.warn('[driver-brief] AI briefing failed:', (e as Error).message)
    return null
  }
}
