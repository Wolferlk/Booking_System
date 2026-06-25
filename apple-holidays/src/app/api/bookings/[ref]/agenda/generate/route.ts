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

${conditions ? `OPERATIONAL RULES:\n${conditions}\n` : ''}

════════════════════════════════════════════════════════════════
FIELD DEFINITIONS — READ CAREFULLY:

● "location"  = The EXACT day topic/title from the Travel Quotation.
                Copy itineraryItem.title verbatim — do NOT shorten, paraphrase, or generalise it.
                Examples:
                  "Full-day Halong Cozy Bay Cruise Day Tour (SIC transfer + SIC cruise)"
                  "Ninh Binh Bai Dinh Trang An Hang Mua SIC"
                  "Bana Hills with Golden Bridge SIC"
                  "Marble Mountain - Hoi An Ancient Town with Dinner SIC"
                  "Airport to Hotel | Private Transfers"
                  "Hotel to Airport | Private Transfers"

● "fromPoint" = Exact pickup point: hotel name, "CODE Airport", pier name.
● "toPoint"   = Exact destination: hotel name, "CODE Airport", attraction/pier name.
● "details"   = TWO PARTS MERGED INTO ONE PARAGRAPH (see details rules below).
● "mealPlan"  = "B", "L", "D", "BL", "BD", "LD", "BLD" — only when explicitly included.
● "meetingTime" = "HH:MM" (required for PVT_TRANSFER and SIC_TRANSFER; null for OWN_ARRANGEMENT).
● "serviceType"  = "PVT_TRANSFER" | "SIC_TRANSFER" | "FLIGHT" | "INTERNAL_TOUR" | "ACCOMMODATION" | "OWN_ARRANGEMENT".
● "timeFrom"    = "HH:MM" pickup/start time for SIC_TRANSFER items only; null for all others.
● "timeTo"      = "HH:MM" estimated return/end time for SIC_TRANSFER items only; null for all others.

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
  - Domestic/internal flight → FLIGHT; meetingTime = depTime minus 3 hours
  - Airport road transfer (arrival or departure) → PVT_TRANSFER always
  - "SIC" in title → SIC_TRANSFER; set timeFrom (pickup) and timeTo (return)
  - Private tour / cruise / day trip → INTERNAL_TOUR
  - "Private" / "PVT" inter-city road transfer → PVT_TRANSFER
  - Hotel check-in / accommodation stay → ACCOMMODATION; meetingTime = null
  - Leisure / free day / at own pace / OWN → OWN_ARRANGEMENT, meetingTime = null

MEETING TIME DEFAULTS:
  - Arrival transfer: flight arrTime + 30 min
  - Departure transfer: flight depTime − 3 hours
  - SIC full-day: 07:30  |  SIC half-day AM: 08:00  |  SIC half-day PM: 13:00
  - SIC cruise embarkation: 07:30  |  Private full-day: 08:00
  - OWN_ARRANGEMENT: null

ADDITIONAL RULES:
  - One item per day (arrivalDate → departureDate inclusive); split multi-city days as separate legs
  - Meals: only set if explicitly included in the package for that day
  - Never leave location empty or generic

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
  const LEISURE_RE       = /\b(leisure|free day|free time|at leisure|relax|no activ|own arrangement)\b/i
  const ACCOMMODATION_RE = /\b(check.?in|check.?out|hotel stay)\b/i
  const SIC_RE           = /\bsic\b/i
  const VALID_TYPES      = new Set(['PVT_TRANSFER','SIC_TRANSFER','OWN_ARRANGEMENT','FLIGHT','INTERNAL_TOUR','ACCOMMODATION'])

  const items = rawItems.map(item => {
    const from = String(item.fromPoint ?? '')
    const to   = String(item.toPoint   ?? '')
    const loc  = String(item.location  ?? '')
    const det  = String(item.details   ?? '')

    const isAirportRoad = AIRPORT_ROAD_RE.test(from) || AIRPORT_ROAD_RE.test(to)

    let serviceType = VALID_TYPES.has(String(item.serviceType)) ? String(item.serviceType) : 'OWN_ARRANGEMENT'
    let meetingTime = item.meetingTime as string | null | undefined

    // Override with deterministic rules (content signals beat AI classification)
    if (FLIGHT_RE.test(loc) || FLIGHT_RE.test(det)) {
      serviceType = 'FLIGHT'
    } else if (isAirportRoad) {
      serviceType = 'PVT_TRANSFER'
    } else if (SIC_RE.test(loc)) {
      serviceType = 'SIC_TRANSFER'
    } else if (LEISURE_RE.test(det) || LEISURE_RE.test(loc)) {
      serviceType = 'OWN_ARRANGEMENT'
      meetingTime = null
    } else if (ACCOMMODATION_RE.test(det) || ACCOMMODATION_RE.test(loc)) {
      serviceType = 'ACCOMMODATION'
      meetingTime = null
    }

    // Normalise airport fromPoint / toPoint labels
    const normFrom = normaliseAirportPoint(from, isAirportRoad)
    const normTo   = normaliseAirportPoint(to, isAirportRoad)

    return {
      ...item,
      serviceType,
      meetingTime,
      timeFrom: item.timeFrom ?? null,
      timeTo:   item.timeTo   ?? null,
      fromPoint: normFrom,
      toPoint: normTo,
    }
  })

  return buildApiSuccess({ items }, `Generated ${items.length} agenda items`)
}
