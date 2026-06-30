import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { extractTextFromDocx } from '@/lib/parsers/docx-parser'
import openai from '@/lib/openai'
import fs from 'fs'
import path from 'path'

export const dynamic = 'force-dynamic'
const CONDITIONS_PATH = path.join(process.cwd(), 'public', 'Generating_Agenda_conditions.md')

function loadConditions(): string {
  try { return fs.readFileSync(CONDITIONS_PATH, 'utf-8') } catch { return '' }
}

function formatFlight(f: {
  flightNo: string; airline?: string | null
  fromApt: string; depTime: string; toApt: string; arrTime: string
}): string {
  const airline = f.airline ? ` (${f.airline})` : ''
  return `✈ Flight ${f.flightNo}${airline} | ${f.fromApt} → ${f.toApt} | Dep: ${f.depTime} | Arr: ${f.arrTime}`
}

/**
 * Normalise an airport point to "CODE Airport" or "City Airport".
 * - Bare 3-letter IATA code (e.g. "PQC") → "PQC Airport"
 * - City/name without "Airport" → append " Airport"
 * - Already has "Airport" → unchanged
 * - Hotel / pier / non-airport → unchanged
 */
function normaliseAirportPoint(raw: string, isAirport: boolean): string {
  if (!raw || !isAirport) return raw
  const s = raw.trim()
  // Already labelled
  if (/airport/i.test(s)) return s
  // Bare 3-letter IATA code
  if (/^[A-Z]{3}$/.test(s)) return `${s} Airport`
  // Short string that looks like a code with extra chars
  if (/^[A-Z]{3}\b/.test(s)) return `${s} Airport`
  // Full city/country name — just append Airport
  return `${s} Airport`
}

export async function POST(
  req: NextRequest,
  { params }: { params: { ref: string } },
) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)

  const role = session.user.role
  if (!['BT_USER', 'GT_USER', 'TE_USER', 'GT_TE_USER', 'AC_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN'].includes(role)) {
    return buildApiError('Forbidden', 403)
  }

  const booking = await prisma.booking.findUnique({
    where: { bookingRef: params.ref },
    include: {
      passengers: true,
      flights:      { orderBy: { date: 'asc' } },
      accommodations: { orderBy: { checkIn: 'asc' } },
      itineraryItems: { orderBy: { dayNo: 'asc' } },
    },
  })
  if (!booking) return buildApiError('Booking not found', 404)

  // ── Extract document text (when TQ file uploaded) ────────────────────────
  let tqDocumentText = ''

  const contentType = req.headers.get('content-type') ?? ''
  if (contentType.includes('multipart/form-data')) {
    const formData = await req.formData()
    const file = formData.get('file') as File | null
    if (!file) return buildApiError('No file provided')

    const buffer = Buffer.from(await file.arrayBuffer())
    const fileName = file.name.toLowerCase()
    if (fileName.endsWith('.docx')) {
      tqDocumentText = await extractTextFromDocx(buffer)
    } else if (fileName.endsWith('.txt')) {
      tqDocumentText = buffer.toString('utf-8')
    } else {
      return buildApiError('Upload a .docx or .txt Travel Quotation or TC file')
    }
  }

  // ── Structured booking context ────────────────────────────────────────────
  const structuredData = {
    bookingRef:    booking.bookingRef,
    arrivalDate:   booking.arrivalDate,
    departureDate: booking.departureDate,
    paxAdults:     booking.paxAdults,
    paxChildren:   booking.paxChildren,
    accommodations: booking.accommodations.map(a => ({
      hotel: a.hotel, city: a.city,
      checkIn:  new Date(a.checkIn).toISOString().slice(0, 10),
      checkOut: new Date(a.checkOut).toISOString().slice(0, 10),
      nights: a.nights, roomType: a.roomType, mealType: a.mealType,
    })),
    flights: booking.flights.map(f => ({
      date:      new Date(f.date).toISOString().slice(0, 10),
      flightNo:  f.flightNo,
      airline:   f.airline,
      fromApt:   f.fromApt,
      depTime:   f.depTime,
      toApt:     f.toApt,
      arrTime:   f.arrTime,
      formatted: formatFlight(f),
    })),
    // Day topics + full descriptions from the Travel Quotation
    itineraryItems: booking.itineraryItems.map(i => ({
      dayNo:       i.dayNo,
      date:        new Date(i.date).toISOString().slice(0, 10),
      title:       i.title,
      description: i.description ?? null,
    })),
  }

  if (!tqDocumentText.trim() && structuredData.itineraryItems.length === 0) {
    return buildApiError('No itinerary data found — upload a TQ document or process the TC email first')
  }

  const conditions = loadConditions()

  const systemPrompt = `You are a Vietnam/Asia tour operations expert for AppleHolidays (MMT).
Generate a day-by-day movement chart from the booking data provided.
Two data sources are given: structured_booking_data (always) and tq_document_text (if uploaded).

CRITICAL: One day can have ONE OR MORE agenda items (multiple transfers/tours on the same date).
Never collapse multiple movements into one. Read the TQ carefully and extract EVERY transfer,
tour, and movement — even if they are on the same day.

${conditions ? `OPERATIONAL RULES:\n${conditions}\n` : ''}

════════════════════════════════════════════════════════════════
FIELD DEFINITIONS — READ CAREFULLY:

● "location"  = City or area name ONLY (e.g., "Hanoi", "Da Nang", "Ha Long", "Hoi An",
                "Ho Chi Minh City", "Colombo", "Singapore").
                Do NOT put the activity title here. Just the geographic location name.
                Examples:
                  "Ha Long"          (for a cruise day)
                  "Da Nang"          (for a city tour)
                  "Hanoi"            (for an arrival transfer)
                  "Ninh Binh"        (for a Ninh Binh day trip)
                  "Ho Chi Minh City" (for HCMC departure)

● "fromPoint" = Exact pickup point: hotel name, "CODE Airport", pier name.
● "toPoint"   = For TRANSFERS: exact destination (hotel name, "CODE Airport", pier name).
                For TOURS/ACTIVITIES: the SHORT activity caption — what the activity IS called.
                Examples:
                  "Halong Bay Cruise"          (for a cruise day)
                  "Ba Na Hills & Golden Bridge" (for Ba Na day trip)
                  "Hoi An Ancient Town"         (for Hoi An tour)
                  "Marble Mountain"             (for Marble Mountain visit)
                  "HAN Airport"                 (for airport transfer)
                  "Vinpearl Land"               (for theme park visit)
● "details"   = TWO PARTS MERGED INTO ONE PARAGRAPH (see details rules below).
● "mealPlan"  = "B", "L", "D", "BL", "BD", "LD", "BLD" — only when explicitly included.
● "meetingTime" = "HH:MM" — the ACTUAL departure/pickup time of the transport.
                For SIC: exact bus/vehicle departure time.
                For PVT: exact pickup time from hotel.
                Null for OWN_ARRANGEMENT and ACCOMMODATION.
● "serviceType"  = "PVT_TRANSFER" | "SIC_TRANSFER" | "OWN_ARRANGEMENT" | "INTERNAL_TOUR".
                  PVT_TRANSFER = Private Transfer (default when not clearly stated)
                  SIC_TRANSFER = Shared bus/coach (mentions "SIC")
                  OWN_ARRANGEMENT = Guest arranges own transport / free day / leisure
                  INTERNAL_TOUR = Tickets only / entry ticket / activity without transfer
● "timeFrom"    = For SIC_TRANSFER ONLY: earliest time guest should arrive at pickup point
                  (30 minutes BEFORE the bus/vehicle departs = meetingTime minus 30 min).
                  Format "HH:MM". Null for all other service types.
● "timeTo"      = For SIC_TRANSFER ONLY: bus/vehicle departure time (same as meetingTime).
                  Format "HH:MM". Null for all other service types.
                  Example: bus leaves 08:30 → timeFrom="08:00", timeTo="08:30", meetingTime="08:30"

════════════════════════════════════════════════════════════════
DETAILS FIELD — TWO-PART STRUCTURE (MANDATORY):

PART 1 — TQ Description (corrected):
  Take itineraryItem.description verbatim, correct grammar and spelling, improve clarity.
  Preserve all original activities, attractions, and inclusions — do NOT add or remove anything.
  If description is null or empty, write a 1–2 sentence summary from the title.

PART 2 — Operational / Logistic Info:
  Add: pickup time, exact pickup spot, vehicle type, journey duration, driver instructions,
  drop-off point. For airport days: include the full formatted flight line.

Merge PART 1 and PART 2 into 3–6 natural sentences in a single paragraph.
The description content comes FIRST, then the logistics at the end.

DETAILS EXAMPLES:
— Airport arrival (PVT):
  "Private airport transfer from [CODE] Airport to [hotel]. ✈ Flight VJ815 (VietJet) | SGN → HAN | Dep: 06:10 | Arr: 08:20.
   Driver will be waiting at the arrivals hall holding a name board. Private air-conditioned car, journey approx. 40 minutes.
   Driver assists with luggage. Check-in at hotel after arrival."

— Airport departure (PVT):
  "Private transfer from [hotel] to [CODE] Airport for departure flight. ✈ Flight VJ123 | HAN → SGN | Dep: 14:30 | Arr: 16:45.
   Pickup from hotel lobby at [meetingTime] (3 hours before departure). Please have passports and boarding documents ready.
   Driver assists with check-in baggage. Drop-off at departures terminal."

— SIC full-day tour (merge description + logistics):
  "Explore Ninh Binh's iconic landscapes: visit Bai Dinh Pagoda (Vietnam's largest pagoda complex),
   take a scenic boat ride through Trang An's karst caves, and hike to the panoramic viewpoint at Hang Mua.
   Lunch included at a local restaurant. SIC pickup from hotel lobby at 07:30 — please be in the lobby 5 minutes early.
   Shared air-conditioned minibus with English-speaking guide. Return to hotel approximately 18:30."

— Private full-day tour:
  "Visit the ancient town of Hoi An, a UNESCO World Heritage Site, strolling the lantern-lit streets and exploring
   Japanese merchant houses and the iconic Japanese Covered Bridge. Dinner included at a riverside restaurant.
   Private pickup from hotel at 08:00. Air-conditioned private car. Return to hotel by 21:00."

— Cruise day:
  "Full day aboard Halong Cozy Bay Cruise on the stunning UNESCO-listed Halong Bay. Explore limestone caves,
   enjoy kayaking, fresh seafood lunch and dinner included on board, and watch the sunset from the sundeck.
   SIC pickup from hotel lobby at 07:30. Shared AC minibus to Tuan Chau pier (~2.5 hrs). Board cruise at 12:00."

════════════════════════════════════════════════════════════════
AIRPORT POINTS — MANDATORY FORMAT:
For ANY item involving an airport (arrival, departure, transit):
  - fromPoint or toPoint MUST use format: "CODE Airport" or "City Airport"
  - Examples: "PQC Airport", "HAN Airport", "SGN Airport", "CMB Airport", "KUL Airport", "SIN Airport"
  - If code is known use 3-letter IATA code: PQC = Phu Quoc, HAN = Hanoi, SGN = Ho Chi Minh City,
    DAD = Da Nang, HUI = Hue, CXR = Nha Trang, CMB = Colombo, KUL = Kuala Lumpur, SIN = Singapore
  - NEVER set airport points without the word "Airport"

════════════════════════════════════════════════════════════════
FLIGHT DETAILS — MANDATORY FOR AIRPORT DAYS:
  1. Find matching flight(s) in flights[] where flight.date = agenda item date.
  2. Include the pre-formatted flight.formatted string in the details field.
  3. meetingTime: arrival → arrTime + 30 min; departure → depTime − 3 hours.
  4. serviceType MUST be PVT_TRANSFER (never SIC for airport transfers).

════════════════════════════════════════════════════════════════
SERVICE TYPE RULES (use EXACTLY one of these values):
  - The word "SIC" appears EXPLICITLY in the ACTIVITY TITLE → SIC_TRANSFER; set timeFrom/timeTo
  - "OWN" / leisure / free day / at own pace → OWN_ARRANGEMENT; meetingTime = null
  - Entry tickets / sightseeing activities without vehicle / tickets only → INTERNAL_TOUR; meetingTime = null
  - ALL other transfers (airport, inter-city, road, private, cruise, waterfall, nature tour, hotel pickup) → PVT_TRANSFER
  - Airport road transfer (arrival or departure) → ALWAYS PVT_TRANSFER
  - "Private Transfer" or "Private basis" mentioned in the activity → ALWAYS PVT_TRANSFER, never SIC_TRANSFER
  - Waterfalls, mountains, parks, nature activities WITHOUT explicit "SIC" in the title → PVT_TRANSFER

FIRST AND LAST ITEM RULE (CRITICAL):
  - The FIRST agenda item (arrival day) MUST be PVT_TRANSFER (airport → hotel)
    unless the first day is clearly a flight or OWN_ARRANGEMENT.
  - The LAST agenda item (departure day) MUST be PVT_TRANSFER (hotel → airport)
    unless it is clearly a flight or OWN_ARRANGEMENT.
  - If the TQ does not mention the service type for arrival/departure transfers,
    DEFAULT to PVT_TRANSFER (Private Transfer).

MULTI-TRANSFER DAYS:
  - A single day can have MULTIPLE agenda items (e.g., airport arrival transfer + hotel check-in,
    or a morning tour + evening dinner transfer).
  - Never skip a transfer because another item exists on the same day.
  - Split every distinct movement into its own item with its own date.

MEETING TIME DEFAULTS:
  - Arrival transfer: flight arrTime + 30 min
  - Departure transfer: flight depTime − 3 hours
  - SIC full-day: meetingTime=07:30, timeFrom=07:00, timeTo=07:30
  - SIC half-day AM: meetingTime=08:00, timeFrom=07:30, timeTo=08:00
  - SIC half-day PM: meetingTime=13:00, timeFrom=12:30, timeTo=13:00
  - SIC cruise embarkation: meetingTime=07:30, timeFrom=07:00, timeTo=07:30
  - Private full-day tour: meetingTime=08:00
  - Private half-day AM tour: meetingTime=08:00
  - Private half-day PM tour: meetingTime=13:00
  - INTERNAL_TOUR (ticket only, entrance): set meetingTime to the activity start time if known, else 08:00
  - OWN_ARRANGEMENT: meetingTime=null, timeFrom=null, timeTo=null

SERVICE TYPE DEFAULTS when not clearly mentioned:
  - If ACTIVITY TITLE explicitly contains "SIC" → SIC_TRANSFER
  - If title mentions "OWN" or is a free/leisure day → OWN_ARRANGEMENT
  - If title is about entry tickets, sightseeing only (no vehicle) → INTERNAL_TOUR; meetingTime=08:00
  - "Private" or "Private Transfer" in title/description → PVT_TRANSFER (never SIC)
  - EVERYTHING ELSE → PVT_TRANSFER (default; never leave ambiguous)

ADDITIONAL RULES:
  - Cover every day from arrivalDate to departureDate inclusive
  - Split multi-city days as separate items (each movement = one item)
  - Meals: only set if explicitly included in the package for that day
  - Never leave location empty — always put the city/area name
  - NEVER include passenger names, passport numbers, guest ages, or personal guest details in ANY field (details, fromPoint, toPoint, location). The movement chart is operational — it must not contain personal guest data.
  - Package Includes service type mapping: if an item says "on Private Basis" or "Private Transfer" → PVT_TRANSFER; "Shared Transfers" or "SIC" → SIC_TRANSFER; "Half-day tour" or "Full-day" with no qualifier → PVT_TRANSFER by default.
  - For days where the day-by-day section is in image format (not extracted), RECONSTRUCT the itinerary using Package Includes — map each Package Include line to the correct date based on hotel city and check-in/check-out dates.

════════════════════════════════════════════════════════════════
Return ONLY a JSON object: { "items": [ { all 9 fields required: date, location, fromPoint, toPoint, details, mealPlan, meetingTime, timeFrom, timeTo, serviceType } ] }`

  const userContent = `Generate the movement chart for booking ${params.ref}.

=== structured_booking_data ===
${JSON.stringify(structuredData, null, 2)}

=== tq_document_text ===
${tqDocumentText
    ? tqDocumentText.slice(0, 9000)
    : '(No document uploaded — derive all content from itineraryItems in structured_booking_data)'
  }`

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user',   content: userContent },
    ],
    response_format: { type: 'json_object' },
    temperature: 0.1,
  })

  const aiContent = response.choices[0]?.message?.content
  if (!aiContent) return buildApiError('AI returned empty response')

  const parsed = JSON.parse(aiContent)
  const rawItems: Record<string, unknown>[] = Array.isArray(parsed) ? parsed
    : parsed.items ?? parsed.agenda ?? parsed.days ?? []

  // ── Post-process ─────────────────────────────────────────────────────────
  const AIRPORT_ROAD_RE  = /\b(airport|terminal|arr\.|dep\.|arrival|departure)\b/i
  const FLIGHT_RE        = /\b(fly|flight|✈|airline|airways)\b/i
  const SIC_RE           = /\bsic\b/i
  const VALID_TYPES      = new Set(['PVT_TRANSFER','SIC_TRANSFER','OWN_ARRANGEMENT','FLIGHT','INTERNAL_TOUR','ACCOMMODATION'])

  // Helper: subtract minutes from HH:MM string
  function subtractMinutes(time: string, mins: number): string {
    const [h, m] = time.split(':').map(Number)
    const total  = h * 60 + m - mins
    const hh     = Math.max(0, Math.floor(total / 60))
    const mm     = Math.max(0, total % 60)
    return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
  }

  const items = rawItems.map(item => {
    const from = String(item.fromPoint ?? '')
    const to   = String(item.toPoint   ?? '')
    const loc  = String(item.location  ?? '')
    const det  = String(item.details   ?? '')

    const isAirportRoad = AIRPORT_ROAD_RE.test(from) || AIRPORT_ROAD_RE.test(to)

    let serviceType = VALID_TYPES.has(String(item.serviceType)) ? String(item.serviceType) : 'PVT_TRANSFER'
    let meetingTime = item.meetingTime as string | null | undefined
    let timeFrom    = item.timeFrom   as string | null | undefined
    let timeTo      = item.timeTo     as string | null | undefined

    // Override with deterministic rules (content signals beat AI classification)
    // OWN_ARRANGEMENT is ONLY kept when the AI explicitly set it (TC must mention it)
    if (isAirportRoad || FLIGHT_RE.test(loc) || FLIGHT_RE.test(det)) {
      // Airport or flight day → always Private Transfer
      serviceType = 'PVT_TRANSFER'
    } else if (SIC_RE.test(loc) || SIC_RE.test(to)) {
      // "SIC" explicitly in location/destination → force SIC
      serviceType = 'SIC_TRANSFER'
    } else if (serviceType === 'SIC_TRANSFER') {
      // AI said SIC but no "SIC" in loc/to → validate against full content
      const SHARED_RE = /\b(sic|shared|sharing)\b/i
      if (!SHARED_RE.test(loc) && !SHARED_RE.test(to) && !SHARED_RE.test(det) && !SHARED_RE.test(from)) {
        // No SIC/Shared signal anywhere — revert to Private
        serviceType = 'PVT_TRANSFER'
      }
    }

    // For SIC: ensure timeFrom/timeTo (join-window) are set
    if (serviceType === 'SIC_TRANSFER') {
      if (meetingTime && (!timeFrom || !timeTo)) {
        // Auto-calculate 30-min window: timeFrom = meetingTime - 30min, timeTo = meetingTime
        timeFrom = subtractMinutes(String(meetingTime), 30)
        timeTo   = String(meetingTime)
      } else if (timeFrom && !timeTo) {
        // Only timeFrom set — derive timeTo as timeFrom + 30min
        const [h, m] = String(timeFrom).split(':').map(Number)
        const total  = h * 60 + m + 30
        timeTo = `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
        if (!meetingTime) meetingTime = timeTo
      }
    } else {
      // Non-SIC items: clear timeFrom/timeTo
      timeFrom = null
      timeTo   = null
    }

    // Default meetingTime for PVT/INTERNAL_TOUR when AI left it null
    if ((serviceType === 'PVT_TRANSFER' || serviceType === 'INTERNAL_TOUR') && !meetingTime && !isAirportRoad) {
      meetingTime = '08:00'
    }

    // Normalise airport fromPoint / toPoint labels
    const normFrom = normaliseAirportPoint(from, isAirportRoad)
    const normTo   = normaliseAirportPoint(to, isAirportRoad)

    return {
      ...item,
      serviceType,
      meetingTime: meetingTime ?? null,
      timeFrom:    timeFrom    ?? null,
      timeTo:      timeTo      ?? null,
      fromPoint:   normFrom,
      toPoint:     normTo,
    }
  })

  // ── Enforce first & last items are PVT_TRANSFER ───────────────────────────
  const NON_TRANSFER_TYPES = new Set(['OWN_ARRANGEMENT', 'INTERNAL_TOUR'])

  if (items.length > 0) {
    const first = items[0]
    if (!NON_TRANSFER_TYPES.has(first.serviceType) && first.serviceType !== 'PVT_TRANSFER') {
      items[0] = { ...first, serviceType: 'PVT_TRANSFER', timeFrom: null, timeTo: null }
    }
  }
  if (items.length > 1) {
    const last = items[items.length - 1]
    if (!NON_TRANSFER_TYPES.has(last.serviceType) && last.serviceType !== 'PVT_TRANSFER') {
      items[items.length - 1] = { ...last, serviceType: 'PVT_TRANSFER', timeFrom: null, timeTo: null }
    }
  }

  return buildApiSuccess({ items }, `Generated ${items.length} agenda items`)
}
