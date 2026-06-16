import OpenAI from 'openai'

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
})

export default openai

// ─── System prompts ──────────────────────────────────────────────────────

const BOOKING_EXTRACTION_PROMPT = `You are a travel booking data extraction assistant for AppleHolidays.
Extract structured booking data from the provided tour confirmation document text.
Return ONLY valid JSON matching the schema below. If a field is not found, use null.

Schema:
{
  "bookingRef": "string (prefer Tour Ref / Tour No when present, e.g. 469182CNTL)",
  "agentBookingId": "string or null",
  "agent": "string (e.g. Make My Trip)",
  "fileHandler": "string or null",
  "arrivalDate": "ISO date string YYYY-MM-DD",
  "departureDate": "ISO date string YYYY-MM-DD",
  "paxAdults": "number",
  "paxChildren": "number",
  "quotedTotal": "number",
  "currency": "string (default USD)",
  "amendmentNote": "string or null",
  "terms": "string or null",
  "exclusions": "string or null",
  "policyNotes": "string or null",

  "agentEmail": "string or null — email address of the travel agent / booking company (found in From:, CC:, agent signature, or booking header)",
  "agentPhone": "string or null — phone/mobile number of the travel agent or company",
  "agentWhatsapp": "string or null — WhatsApp number of the agent (if labeled WA: or WhatsApp: separately from phone)",
  "agentCountry": "string or null — country of the travel agent company",

  "contactEmail": "string or null — personal email of the lead tourist / end customer (found in passenger section, 'Guest Email', or different domain from agent)",
  "contactPhone": "string or null — personal mobile/phone of the lead tourist",
  "contactWhatsapp": "string or null — WhatsApp of the lead tourist (if labeled separately, else same as contactPhone)",
  "contactCountry": "string or null — home country or nationality country of the lead tourist",

  "passengers": [
    {
      "name": "string",
      "type": "ADULT or CHILD",
      "age": "number or null",
      "isLead": "boolean",
      "passport": "string or null",
      "nationality": "string or null",
      "contact": "string or null — personal phone or WhatsApp of this specific passenger if mentioned"
    }
  ],
  "flights": [
    {
      "flightNo": "string",
      "date": "ISO date string YYYY-MM-DD",
      "fromApt": "string",
      "depTime": "string HH:MM",
      "toApt": "string",
      "arrTime": "string HH:MM",
      "airline": "string or null"
    }
  ],
  "accommodations": [
    {
      "city": "string",
      "hotel": "string",
      "checkIn": "ISO date string YYYY-MM-DD",
      "checkOut": "ISO date string YYYY-MM-DD",
      "address": "string or null",
      "contact": "string or null",
      "nights": "number",
      "roomType": "string or null",
      "mealType": "string or null"
    }
  ],
  "itineraryItems": [
    {
      "dayNo": "number",
      "date": "ISO date string YYYY-MM-DD",
      "title": "string",
      "description": "string or null",
      "inclusions": ["array of strings"],
      "exclusions": ["array of strings"]
    }
  ],
  "emergencyContacts": [
    {
      "name": "string",
      "phone": "string or null",
      "role": "string or null"
    }
  ]
}

Contact classification rules:
- Agent contact (agentEmail / agentPhone): belongs to the travel agency or booking company — found in email headers (From/Reply-To/CC), booking office signatures, or labelled "Agent:", "Company:", "Booking Office:"
- Customer contact (contactEmail / contactPhone): belongs to the end traveller — found in passenger list, labelled "Guest:", "Tourist:", "Traveller:", "Customer:", or is a personal mobile number next to the lead passenger
- If a single phone is present with no label, assign it to contactPhone
- If a single email is present with no label, assign it to agentEmail (confirmation emails usually come from the agent)
- Extract ALL phone numbers and emails found; classify each carefully as agent or customer
- WhatsApp numbers are often explicitly labeled "WA:" or are the same as the customer mobile

Be precise and complete. Do not invent data.
Important: if the document includes both a Tour Ref and an IS Number, use the Tour Ref as bookingRef because the PNL email will link back to it.`

const PNL_EXTRACTION_PROMPT = `You are a financial data extraction assistant for AppleHolidays travel bookings.
Extract P&L (profit & loss) data from the provided Excel/CSV content.
Return ONLY valid JSON matching the schema below.

Schema:
{
  "paxAdults": "number",
  "paxChildren": "number",
  "lineItems": [
    {
      "activity": "string (activity/service name)",
      "category": "one of: HOTEL, TICKETS, GUIDES, MEALS, CRUISE, WATER, TRANSPORT, TAX_FEES, FLIGHT_TICKETS, OTHER",
      "mmtRate": "number (revenue per person, what was sold to agent)",
      "sicRate": "number (SIC/shared cost per person)",
      "pvtRatePP": "number (private transfer cost per person)",
      "adEntrance": "number (adult entrance fee)",
      "chEntrance": "number (child entrance fee)",
      "otherRate": "number",
      "notes": "string or null"
    }
  ]
}`

// ─── Extraction functions ────────────────────────────────────────────────

export async function extractBookingFromText(documentText: string): Promise<Record<string, unknown>> {
  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      { role: 'system', content: BOOKING_EXTRACTION_PROMPT },
      {
        role: 'user',
        content: `Extract booking data from this document:\n\n${documentText.slice(0, 12000)}`,
      },
    ],
    response_format: { type: 'json_object' },
    temperature: 0.1,
  })

  const content = response.choices[0]?.message?.content
  if (!content) throw new Error('OpenAI returned empty response')
  return JSON.parse(content)
}

// Intelligently classify activity names into P&L categories using GPT
export async function classifyPNLCategories(activities: string[]): Promise<string[]> {
  if (!activities.length) return []

  const prompt = `You are a Vietnam travel operations expert classifying P&L line items for AppleHolidays (MMT Vietnam).

CATEGORIES (pick exactly one per activity):
- HOTEL: accommodation stays only — hotel/resort/villa/homestay check-in or check-out (NO transfers)
- TRANSPORT: ANY transfer or vehicle service — private transfers, airport↔hotel transfers, cab, taxi, private car, bus, SIC transfer, limousine, shuttle
- CRUISE: Ha Long Bay cruise, boat trips, yacht, river cruise, junk boat, overnight cruise
- GUIDES: guided day tours, sightseeing tours, city tours, walking tours, SIC tours (not cruise/tickets)
- TICKETS: entrance tickets, admission, cable car, theme park, night shows, "Ba Na", attraction passes, combo tickets
- WATER: water sports, kayaking, snorkeling, diving, swimming, surfing
- FLIGHT_TICKETS: airline/domestic flight tickets
- MEALS: restaurant meals, food tours (NOT meals included in a package)
- TAX_FEES: visa, tax, insurance, service fee, surcharge
- OTHER: anything else

IMPORTANT RULES:
- "Private Transfer" / "Private Transfers" → ALWAYS TRANSPORT, even if the name contains "Hotel" or "Airport"
- "[Hotel] to Airport" or "Airport to [Hotel]" → TRANSPORT (it is a vehicle service, not accommodation)
- "SIC transfer" alone → TRANSPORT; "SIC tour/cruise" → GUIDES or CRUISE
- Pure hotel/resort name with no transfer keyword → HOTEL
- "Ha Long / Halong / cruise / boat / overnight cruise" → CRUISE
- "Fansipan / trekking / hiking / sightseeing" → GUIDES
- "Ticket / entrance / cable car / theme park / VinWonders / Aquatopia / Safari combo" → TICKETS
- "Two-way transfer between cities / cab / Grab / taxi / limousine" → TRANSPORT

Return JSON: { "categories": ["HOTEL", "CRUISE", ...] } — same order as input, one per activity.

Activities:
${activities.map((a, i) => `${i + 1}. ${a}`).join('\n')}`

  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: 'Return only valid JSON object with a "categories" array. No explanations.' },
      { role: 'user', content: prompt },
    ],
    response_format: { type: 'json_object' },
    temperature: 0,
  })

  const content = response.choices[0]?.message?.content
  if (!content) return activities.map(() => 'OTHER')

  const parsed = JSON.parse(content) as { categories?: string[] }
  const result = parsed.categories ?? []
  // Pad if OpenAI returns fewer items than expected
  while (result.length < activities.length) result.push('OTHER')
  return result
}

export async function extractPNLFromText(sheetText: string): Promise<Record<string, unknown>> {
  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      { role: 'system', content: PNL_EXTRACTION_PROMPT },
      {
        role: 'user',
        content: `Extract P&L data from this spreadsheet content:\n\n${sheetText.slice(0, 12000)}`,
      },
    ],
    response_format: { type: 'json_object' },
    temperature: 0.1,
  })

  const content = response.choices[0]?.message?.content
  if (!content) throw new Error('OpenAI returned empty response')
  return JSON.parse(content)
}

export async function generateAgendaFromBooking(bookingData: Record<string, unknown>): Promise<unknown[]> {
  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: `You are a travel operations assistant. Generate a day-by-day tour agenda from the booking data.
For each day/activity return JSON array items with:
{
  "date": "ISO date",
  "location": "city name",
  "fromPoint": "pickup location or null",
  "toPoint": "destination or activity name",
  "details": "timing and operational details",
  "mealPlan": "B/L/D/BD/BL/BLD or null",
  "meetingTime": "HH:MM or null",
  "serviceType": "PVT_TRANSFER or SIC_TRANSFER or OWN_ARRANGEMENT"
}
Return ONLY a JSON array.`,
      },
      {
        role: 'user',
        content: `Generate agenda from:\n${JSON.stringify(bookingData, null, 2).slice(0, 8000)}`,
      },
    ],
    response_format: { type: 'json_object' },
    temperature: 0.2,
  })

  const content = response.choices[0]?.message?.content
  if (!content) return []
  const parsed = JSON.parse(content)
  return Array.isArray(parsed) ? parsed : parsed.items ?? parsed.agenda ?? []
}

export async function getBookingAISuggestion(
  question: string,
  bookingContext: string,
): Promise<string> {
  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: `You are a helpful travel booking assistant for AppleHolidays.
Answer questions about bookings concisely and helpfully.
Booking context: ${bookingContext.slice(0, 4000)}`,
      },
      { role: 'user', content: question },
    ],
    temperature: 0.3,
    max_tokens: 500,
  })

  return response.choices[0]?.message?.content ?? 'Unable to generate response.'
}
