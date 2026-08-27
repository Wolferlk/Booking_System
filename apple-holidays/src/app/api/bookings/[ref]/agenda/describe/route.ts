import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import openai from '@/lib/openai'
import { to12h } from '@/lib/clock-time'

export const dynamic = 'force-dynamic'
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)

  const body = await req.json() as {
    date?: string
    location?: string
    fromPoint?: string
    toPoint?: string
    meetingTime?: string
    serviceType?: string
    mealPlan?: string
    existingDetails?: string
    /**
     * The booking's real flight for this movement, resolved on the client by
     * lib/agenda-flight-link.ts. Present only for airport rows. Without it the
     * model invents a plausible departure time, which is the one number on the
     * page a guest actually acts on.
     */
    flight?: {
      role: 'departure' | 'arrival' | 'sector'
      line: string
      suggestedPickup: string | null
      bufferHours: number
      international: boolean
    } | null
  }

  const { date, location, fromPoint, toPoint, meetingTime, serviceType, mealPlan, existingDetails, flight } = body

  const svcLabel: Record<string, string> = {
    PVT_TRANSFER:    'Private Transfer (air-conditioned private car/van)',
    SIC_TRANSFER:    'SIC Shared Transfer (shared minibus/van with other passengers)',
    OWN_ARRANGEMENT: 'Own Arrangement (no driver or guide provided)',
  }

  const isAirport = /airport|terminal|apt\b/i.test(`${fromPoint} ${toPoint}`)
  const isDeparture = /airport|terminal/i.test(toPoint ?? '') || /departure/i.test(existingDetails ?? '')
  const isArrival = /airport|terminal/i.test(fromPoint ?? '') || /arrival/i.test(existingDetails ?? '')

  let contextHint = ''
  if (flight?.role === 'departure') {
    contextHint = `This is an AIRPORT DEPARTURE transfer for a confirmed flight.`
      + ` The flight is: ${flight.line}.`
      + (flight.suggestedPickup
        ? ` Pickup is ${to12h(flight.suggestedPickup)} — ${flight.bufferHours} hours before departure. State that exact pickup time.`
        : ` Pickup is ${flight.bufferHours} hours before departure.`)
      + ` Mention luggage assistance and a check-in reminder.`
      + (flight.international ? ' Remind them to have passports ready.' : ' Remind them to have photo ID ready.')
      + ` Do NOT invent any time that is not given above.`
  } else if (flight?.role === 'arrival') {
    contextHint = `This is an AIRPORT ARRIVAL transfer for a confirmed flight.`
      + ` The flight is: ${flight.line}.`
      + ` The driver waits in the arrivals hall holding an Apple Holidays name board.`
      + (flight.international
        ? ' Allow for immigration and baggage claim after landing.'
        : ' Allow for baggage claim after landing.')
      + ` Do NOT invent any time that is not given above.`
  } else if (flight?.role === 'sector') {
    contextHint = `This movement IS the flight itself: ${flight.line}.`
      + ` Describe the sector and what the guests do at the airport. Do NOT invent any time that is not given above.`
  } else if (isArrival && isAirport) {
    contextHint = `This is an AIRPORT ARRIVAL transfer. The driver waits at the arrivals hall holding a name board. Mention buffer wait time after landing (international: 45 min, domestic: 30 min). Include approx. road journey time to the hotel.`
  } else if (isDeparture && isAirport) {
    contextHint = `This is an AIRPORT DEPARTURE transfer. Pickup is from the hotel. Mention the 3-hour-before-flight rule, luggage assistance, and check-in reminder.`
  } else if (serviceType === 'SIC_TRANSFER') {
    contextHint = `This is a SHARED/SIC transfer. Mention that pickup is from hotel lobby, shared minibus with other passengers, and that guests should be ready on time.`
  } else if (serviceType === 'OWN_ARRANGEMENT') {
    contextHint = `This is a leisure/own-arrangement segment. Describe what the guest can do at their own pace. No driver or guide is provided.`
  } else {
    contextHint = `This is a private transfer or private tour. Mention the private air-conditioned vehicle, guide (if applicable), and any notable stops or highlights.`
  }

  const prompt = `You are a senior Vietnam tour operations coordinator for Apple Holidays (MMT Vietnam).
Write a rich, operational "Details / Timings" note for the following movement chart item.

Movement item:
- Date: ${date ?? '—'}
- City / Location: ${location ?? '—'}
- Pickup From: ${fromPoint ?? '—'}
- Drop-off / Activity: ${toPoint ?? '—'}
- Meeting Time: ${to12h(meetingTime) || '—'}
- Service Type: ${svcLabel[serviceType ?? ''] ?? serviceType ?? '—'}
- Meal Plan: ${mealPlan || 'None included'}
${flight ? `- Confirmed flight: ${flight.line}` : ''}
${existingDetails ? `- Existing notes: ${existingDetails}` : ''}

Context: ${contextHint}

WRITE a single operational paragraph (2-4 sentences, 50-90 words) that includes:
1. Exact meeting/pickup time and precise location (lobby, arrivals hall, pier, etc.)
2. Vehicle type and comfort level (air-conditioned private car, SIC minibus, etc.)
3. Approximate journey duration to the destination
4. Any guest instructions (name board, luggage, check-in time, what to bring, be ready at X time)
5. Drop-off point with any relevant notes

TONE: Professional, clear, operational. No fluff. Write as if briefing a tour leader.
TIMES: Write every clock time in 12-hour form with AM or PM (e.g. "3:45 PM"), never 24-hour.
Output only the description text — no labels, bullet points, or headings.`

  const completion = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [{ role: 'user', content: prompt }],
    max_tokens: 200,
    temperature: 0.3,
  })

  const description = completion.choices[0]?.message?.content?.trim() ?? ''
  return buildApiSuccess({ description })
}
