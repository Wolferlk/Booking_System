import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { extractTextFromDocx } from '@/lib/parsers/docx-parser'
import openai from '@/lib/openai'
import fs from 'fs'
import path from 'path'

const CONDITIONS_PATH = path.join(process.cwd(), 'public', 'Generating_Agenda_conditions.md')

function loadConditions(): string {
  try {
    return fs.readFileSync(CONDITIONS_PATH, 'utf-8')
  } catch {
    return ''
  }
}

/** Format flight details into a compact string for the prompt */
function formatFlight(f: {
  flightNo: string; airline?: string | null
  fromApt: string; depTime: string
  toApt: string; arrTime: string
}): string {
  const airline = f.airline ? ` (${f.airline})` : ''
  return `Flight: ${f.flightNo}${airline} | ${f.fromApt} → ${f.toApt} | Dep: ${f.depTime} | Arr: ${f.arrTime}`
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
      flights: { orderBy: { date: 'asc' } },
      accommodations: { orderBy: { checkIn: 'asc' } },
      itineraryItems: { orderBy: { dayNo: 'asc' } },
    },
  })

  if (!booking) return buildApiError('Booking not found', 404)

  // ── Extract document text (if TQ file was uploaded) ───────────────────────
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
      return buildApiError('Upload a .docx or .txt tour confirmation file')
    }
  }

  // ── Build structured booking context (always included) ────────────────────
  const flightsByDate: Record<string, typeof booking.flights[0][]> = {}
  for (const f of booking.flights) {
    const key = new Date(f.date).toISOString().slice(0, 10)
    if (!flightsByDate[key]) flightsByDate[key] = []
    flightsByDate[key].push(f)
  }

  const structuredData = {
    bookingRef: booking.bookingRef,
    arrivalDate: booking.arrivalDate,
    departureDate: booking.departureDate,
    paxAdults: booking.paxAdults,
    paxChildren: booking.paxChildren,
    accommodations: booking.accommodations.map(a => ({
      hotel: a.hotel, city: a.city,
      checkIn: new Date(a.checkIn).toISOString().slice(0, 10),
      checkOut: new Date(a.checkOut).toISOString().slice(0, 10),
      nights: a.nights, roomType: a.roomType, mealType: a.mealType,
    })),
    // Flights — each entry includes formatted details for easy injection into agenda
    flights: booking.flights.map(f => ({
      date: new Date(f.date).toISOString().slice(0, 10),
      flightNo: f.flightNo,
      airline: f.airline,
      fromApt: f.fromApt,
      depTime: f.depTime,
      toApt: f.toApt,
      arrTime: f.arrTime,
      formatted: formatFlight(f),
    })),
    // Itinerary from Travel Quotation — titles MUST be used as activity names
    itineraryItems: booking.itineraryItems.map(i => ({
      dayNo: i.dayNo,
      date: new Date(i.date).toISOString().slice(0, 10),
      title: i.title,
      description: i.description ?? null,
    })),
  }

  if (!tqDocumentText.trim() && structuredData.itineraryItems.length === 0) {
    return buildApiError('No itinerary data found — upload a TQ document or process the TC email first')
  }

  const conditions = loadConditions()

  const systemPrompt = `You are a Vietnam/Asia tour operations expert for AppleHolidays (MMT).
Generate a detailed day-by-day movement chart. You will receive two sections of data:
1. structured_booking_data — always present; contains flights, accommodations, and TQ itinerary items
2. tq_document_text — present if a Travel Quotation file was uploaded (may be empty)

OPERATIONAL RULES (follow exactly):
${conditions}

═══════════════════════════════════════════════════════════════════════
ITINERARY TITLES — HIGHEST PRIORITY RULE:
The structured_booking_data.itineraryItems array contains the EXACT day-by-day activity titles
extracted from the Travel Quotation. These are the AUTHORITATIVE topic names.

For EVERY agenda day:
1. Find the matching itineraryItem by date (or dayNo if dates differ slightly)
2. Use the itineraryItem.title VERBATIM as the "location" field (do NOT paraphrase it)
   Examples of correct location values:
   - "Full-day Halong Cozy Bay Cruise Day Tour (SIC transfer + SIC cruise)"
   - "Ninh Binh Bai Dinh Trang An Hang Mua SIC"
   - "Bana Hills with Golden Bridge SIC"
   - "Airport to Hotel | Private Transfers"
3. Use the itineraryItem.description (if present) to enrich the "details" field
4. If no matching itineraryItem exists for a date, derive the title from tq_document_text

If itineraryItems is empty (no TQ processed yet), use tq_document_text to infer day activities.

═══════════════════════════════════════════════════════════════════════
FLIGHT DETAILS — MANDATORY FOR AIRPORT TRANSFER DAYS:
The structured_booking_data.flights array contains actual flight data.

For ANY agenda day that involves an airport arrival OR departure:
1. Find the matching flight(s) from flights[] where flight.date matches the agenda date
2. ALWAYS include the flight details in the "details" field using this format:
   "[Flight: VJ815 (VietJet Air) | HAN → SGN | Dep: 09:35 | Arr: 11:30]"
   Each flight has a pre-formatted "formatted" field — use it directly.
3. Set fromPoint or toPoint to the airport code (e.g. "HAN Airport", "SGN Airport", "CMB Airport")
4. meetingTime for arrival: flight.arrTime + 30 min
5. meetingTime for departure: flight.depTime − 3 hours

IMPORTANT: If itinerary title says "Airport to Hotel" or "Hotel to Airport", it is ALWAYS a
flight day — look up the flight by date from the flights array and include all details.

═══════════════════════════════════════════════════════════════════════
Return a JSON object with key "items" containing an array. Each item MUST have ALL fields:
{
  "date": "YYYY-MM-DD",
  "location": "EXACT itinerary title from TQ (never generic, never empty)",
  "fromPoint": "exact pickup — hotel name, airport code, pier name",
  "toPoint": "exact destination — hotel name, airport code, attraction name",
  "details": "<RICH OPERATIONAL TEXT — 2–4 sentences, 50–100 words>",
  "mealPlan": "B | L | D | BL | BD | LD | BLD | null",
  "meetingTime": "HH:MM — REQUIRED for all transfers and tours, null only for OWN_ARRANGEMENT",
  "serviceType": "PVT_TRANSFER | SIC_TRANSFER | OWN_ARRANGEMENT"
}

DETAILS FIELD must include:
1. Exact pickup time and spot (hotel lobby, arrivals hall, pier gate)
2. Vehicle/transport mode ("Air-conditioned private car", "SIC shared minibus", "cruise ship")
3. Approximate journey time or distance
4. Guest instructions (name board at airport, luggage help, check-in reminder, SIC readiness)
5. Drop-off location
6. For airport days: the full flight line from the formatted flight string

DETAILS EXAMPLES:
- Airport arrival (PVT): "Private airport pickup at [meetingTime] (~30 min after landing). [Flight details]. Driver waiting at arrivals hall with name board. Air-conditioned private car to [hotel], approx 40 min. Driver assists with luggage."
- Airport departure (PVT): "Pickup from hotel lobby at [meetingTime] (3 hrs before [depTime]). [Flight details]. Private car to airport, driver assists with bags. Have passports and docs ready. Drop-off at departures."
- SIC tour: "SIC pickup at hotel lobby at [meetingTime] — be in lobby 5 min early. Shared AC minibus. Tour: [location/title]. Guide provided. Return ~[time]. [Meals]."
- Private tour/transfer: "Private pickup at [fromPoint] at [meetingTime]. AC private vehicle to [toPoint], ~[X] hrs. [Highlights from description]. Driver assists with luggage."
- Leisure/OWN: "Free day in [location]. No guide or transport. [Highlights from description]. Hotel concierge available."

SERVICE TYPE:
- Airport/flight day → PVT_TRANSFER (NEVER SIC for airport)
- "SIC" in title → SIC_TRANSFER
- "Private" or "PVT" in title → PVT_TRANSFER
- Leisure / free day / at own pace / OWN → OWN_ARRANGEMENT, meetingTime = null
- Cruise → PVT_TRANSFER (embarkation/disembarkation)

MEETING TIME:
- International arrival: arrTime + 30 min
- Domestic arrival: arrTime + 30 min
- Departure: depTime − 3 hours
- SIC full-day tour: 07:30
- SIC half-day morning: 08:00
- SIC half-day afternoon: 13:00
- Private full-day: 08:00
- Cruise embarkation: 07:30
- OWN_ARRANGEMENT: null

ADDITIONAL RULES:
- Generate one item per day from arrivalDate to departureDate
- Split multi-city movement into separate items per leg
- Meals: only set if explicitly included in the package`

  const userContent = `Generate the tour agenda for booking ${params.ref}.

--- structured_booking_data ---
${JSON.stringify(structuredData, null, 2)}

--- tq_document_text ---
${tqDocumentText ? tqDocumentText.slice(0, 8000) : '(No document uploaded — use itineraryItems from structured_booking_data above)'}`

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent },
    ],
    response_format: { type: 'json_object' },
    temperature: 0.1,
  })

  const content = response.choices[0]?.message?.content
  if (!content) return buildApiError('AI returned empty response')

  const parsed = JSON.parse(content)
  const rawItems: Record<string, unknown>[] = Array.isArray(parsed) ? parsed
    : parsed.items ?? parsed.agenda ?? parsed.days ?? []

  // Post-process: hard-enforce airport → PVT_TRANSFER, leisure → OWN_ARRANGEMENT
  const AIRPORT_RE = /\b(airport|terminal|apt|arr\.|dep\.|arrival|departure|fly|flight)\b/i
  const LEISURE_RE = /\b(leisure|free day|free time|at leisure|relax|no activ|own arrangement)\b/i

  const items = rawItems.map(item => {
    const from = String(item.fromPoint ?? '')
    const to   = String(item.toPoint   ?? '')
    const loc  = String(item.location  ?? '')
    const det  = String(item.details   ?? '')

    if (AIRPORT_RE.test(from) || AIRPORT_RE.test(to) || AIRPORT_RE.test(det) || AIRPORT_RE.test(loc)) {
      return { ...item, serviceType: 'PVT_TRANSFER' }
    }
    if (LEISURE_RE.test(det) || LEISURE_RE.test(loc)) {
      return { ...item, serviceType: 'OWN_ARRANGEMENT', meetingTime: null }
    }
    return item
  })

  return buildApiSuccess({ items }, `Generated ${items.length} agenda items`)
}
