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

export async function POST(
  req: NextRequest,
  { params }: { params: { ref: string } },
) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)

  const role = session.user.role
  if (!['BT_USER', 'GT_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN'].includes(role)) {
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

  let documentText = ''

  const contentType = req.headers.get('content-type') ?? ''
  if (contentType.includes('multipart/form-data')) {
    const formData = await req.formData()
    const file = formData.get('file') as File | null
    if (!file) return buildApiError('No file provided')

    const buffer = Buffer.from(await file.arrayBuffer())
    const fileName = file.name.toLowerCase()

    if (fileName.endsWith('.docx')) {
      documentText = await extractTextFromDocx(buffer)
    } else if (fileName.endsWith('.txt')) {
      documentText = buffer.toString('utf-8')
    } else {
      return buildApiError('Upload a .docx or .txt tour confirmation file')
    }
  } else {
    // Use booking data itself as the source
    documentText = JSON.stringify({
      bookingRef: booking.bookingRef,
      arrivalDate: booking.arrivalDate,
      departureDate: booking.departureDate,
      paxAdults: booking.paxAdults,
      paxChildren: booking.paxChildren,
      flights: booking.flights,
      accommodations: booking.accommodations,
      itineraryItems: booking.itineraryItems,
    }, null, 2)
  }

  if (!documentText.trim()) {
    return buildApiError('Could not read document content')
  }

  const conditions = loadConditions()

  const systemPrompt = `You are a Vietnam tour operations expert for AppleHolidays (MMT Vietnam).
Generate a detailed day-by-day movement chart from the provided booking/document data.

OPERATIONAL RULES (follow exactly):
${conditions}

Return a JSON object with key "items" containing an array. Each item MUST have ALL fields:
{
  "date": "YYYY-MM-DD",
  "location": "city/area name (never empty)",
  "fromPoint": "exact pickup — hotel name, airport code, pier name",
  "toPoint": "exact destination — hotel name, airport code, attraction name",
  "details": "<RICH OPERATIONAL TEXT — see rules below>",
  "mealPlan": "B | L | D | BL | BD | LD | BLD | null",
  "meetingTime": "HH:MM — REQUIRED for all transfers and tours, null only for ticket-only/OWN_ARRANGEMENT",
  "serviceType": "PVT_TRANSFER | SIC_TRANSFER | OWN_ARRANGEMENT"
}

DETAILS FIELD — MANDATORY RICHNESS RULES:
The "details" field must be a complete operational briefing (2–4 sentences, 50–100 words). It MUST include:
1. Exact pickup time and precise pickup spot (hotel lobby, airport arrivals hall, pier gate, etc.)
2. Vehicle / transport mode: "Air-conditioned private car", "SIC shared minibus", "overnight sleeper train", "cruise ship", etc.
3. Approximate journey time or distance to destination
4. Guest instructions: name board at airport, luggage assistance, check-in time reminder, what to bring, SIC readiness reminder
5. Drop-off location with any relevant note (hotel name, pier, area)

DETAILS EXAMPLES BY TYPE:
- Airport arrival (PVT): "Private airport pickup at [meetingTime] (approx. 45 min after landing). Driver will be waiting at the arrivals hall holding a name board with guest name. Air-conditioned private car transfer to [hotel] in [city]. Journey approx. 40 minutes. Driver will assist with all luggage."
- Airport departure (PVT): "Pickup from hotel lobby at [meetingTime] (3 hours before [depTime] flight). Air-conditioned private car to [airport]. Driver will assist with check-in bags. Please ensure passports and flight documents are ready. Drop-off at departures terminal."
- SIC city tour: "SIC pickup from hotel lobby at [meetingTime]. Please be in the lobby 5 minutes early. Shared air-conditioned minibus with other guests. Tour visits [toPoint] with local guide. Return to hotel approx. [end time]. Lunch [included/not included]."
- Private transfer city-to-city: "Private pickup from [fromPoint] at [meetingTime]. Air-conditioned private vehicle transfer to [toPoint]. Journey approx. [X] hours via scenic route. Rest stops en route. Driver will assist with luggage at arrival."
- Leisure/OWN: "Free day at leisure in [location]. No guide or transport arranged. Guests may explore [highlights] at their own pace. Hotel concierge available for assistance. [Meal note if applicable]."
- Cruise embarkation (PVT): "Pickup from hotel lobby at [meetingTime]. Private air-conditioned transfer to [pier]. Board [cruise name] at approx. [time]. Cabin allocation on arrival. [Meal inclusions]. Welcome briefing by cruise crew."

MEETING TIME — CRITICAL RULES (always fill this field):
- International arrival transfer: flight arrTime + 30 min (e.g. lands 14:20 → meetingTime "15:05")
- Domestic arrival transfer: flight arrTime + 30 min (e.g. lands 10:00 → meetingTime "10:30")
- Departure transfer: flight depTime − 3 hours (e.g. departs 09:30 → meetingTime "06:30")
- SIC full-day tour: "07:30" (default)
- SIC half-day morning: "08:00" (default)
- SIC half-day afternoon: "13:00" (default)
- SIC night show / evening: "18:30" (default)
- SIC cruise embarkation: "07:30" (default)
- Private full-day: "08:00" (use itinerary time if given, else this default)
- Private half-day morning: "08:30" (default)
- Ticket-only / OWN_ARRANGEMENT (no guide, no driver): null
- NEVER leave meetingTime null for PVT_TRANSFER or SIC_TRANSFER items

SERVICE TYPE — MANDATORY RULES (override everything else):
- ANY item involving an airport, terminal, or flight connection → serviceType = "PVT_TRANSFER" (NEVER SIC or OWN for airport transfers)
- Leisure day / free time / at leisure / no guide / hotel only → serviceType = "OWN_ARRANGEMENT", meetingTime = null
- Explicitly "SIC" or "shared" tour → serviceType = "SIC_TRANSFER"
- Private tour, cruise, city-to-city transfer → serviceType = "PVT_TRANSFER"
- Ticket/entrance only (no driver, no guide) → serviceType = "OWN_ARRANGEMENT", meetingTime = null

ADDITIONAL RULES:
- Include every single day from arrival date to departure date
- Split multi-city movement into separate items per leg
- Meals: only set if explicitly included in the package for that day`

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: `Generate the tour agenda for booking ${params.ref}:\n\n${documentText.slice(0, 12000)}`,
      },
    ],
    response_format: { type: 'json_object' },
    temperature: 0.1,
  })

  const content = response.choices[0]?.message?.content
  if (!content) return buildApiError('AI returned empty response')

  const parsed = JSON.parse(content)
  const rawItems: Record<string, unknown>[] = Array.isArray(parsed) ? parsed
    : parsed.items ?? parsed.agenda ?? parsed.days ?? []

  // Post-process: enforce airport → PVT_TRANSFER and leisure → OWN_ARRANGEMENT
  const AIRPORT_RE = /\b(airport|terminal|apt|arr\.|dep\.|arrival|departure|fly|flight)\b/i
  const LEISURE_RE = /\b(leisure|free day|free time|at leisure|relax|no activ|own arrangement|check.?in|check.?out)\b/i

  const items = rawItems.map(item => {
    const from = String(item.fromPoint ?? '')
    const to   = String(item.toPoint   ?? '')
    const loc  = String(item.location  ?? '')
    const det  = String(item.details   ?? '')
    if (AIRPORT_RE.test(from) || AIRPORT_RE.test(to) || AIRPORT_RE.test(det)) {
      return { ...item, serviceType: 'PVT_TRANSFER' }
    }
    if (LEISURE_RE.test(det) || LEISURE_RE.test(loc)) {
      return { ...item, serviceType: 'OWN_ARRANGEMENT', meetingTime: null }
    }
    return item
  })

  return buildApiSuccess({ items }, `Generated ${items.length} agenda items`)
}
