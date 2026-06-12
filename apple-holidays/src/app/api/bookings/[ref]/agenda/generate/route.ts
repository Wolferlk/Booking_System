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
  if (!['BT_USER', 'GT_USER', 'SUPER_ADMIN'].includes(role)) {
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
  "toPoint": "exact destination — hotel name, airport code, attraction",
  "details": "full operational description with timing, vehicle type, instructions",
  "mealPlan": "B | L | D | BL | BD | LD | BLD | null",
  "meetingTime": "HH:MM — REQUIRED for all transfers and tours, null only for ticket-only/OWN_ARRANGEMENT",
  "serviceType": "PVT_TRANSFER | SIC_TRANSFER | OWN_ARRANGEMENT"
}

MEETING TIME — CRITICAL RULES (always fill this field):
- International arrival transfer: flight arrTime + 45 min (e.g. lands 14:20 → meetingTime "15:05")
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
  const items = Array.isArray(parsed) ? parsed
    : parsed.items ?? parsed.agenda ?? parsed.days ?? []

  return buildApiSuccess({ items }, `Generated ${items.length} agenda items`)
}
