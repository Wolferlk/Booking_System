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
Generate a detailed day-by-day tour agenda from the provided booking/document data.

OPERATIONAL RULES (must follow exactly):
${conditions}

Return a JSON object with key "items" containing an array. Each item:
{
  "date": "YYYY-MM-DD",
  "location": "city/area name",
  "fromPoint": "departure point or null",
  "toPoint": "destination or activity name",
  "details": "full operational description with timing, instructions",
  "mealPlan": "B (breakfast) | L (lunch) | D (dinner) | BL | BD | LD | BLD | null",
  "meetingTime": "HH:MM or null",
  "serviceType": "PVT_TRANSFER | SIC_TRANSFER | OWN_ARRANGEMENT"
}

Rules:
- Airport transfer on arrival: international → +1 hour, domestic → +30 min after landing
- Airport transfer on departure: 3 hours before flight
- SIC service: set meetingTime to pickup window (e.g. "07:30")
- Private service: meetingTime from itinerary details or null
- Ticket-only days: mealPlan=null, meetingTime=null, serviceType=OWN_ARRANGEMENT
- Include every day from arrival to departure
- Split multi-city days into separate items
- Be specific about locations (hotel, airport, pier, etc.)`

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
