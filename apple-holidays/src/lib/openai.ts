import OpenAI from 'openai'

function getOpenAIKey() {
  const apiKey = process.env.OPENAI_API_KEY?.trim()
  if (!apiKey) return undefined

  if (/^https?:\/\//i.test(apiKey)) {
    throw new Error('Invalid OPENAI_API_KEY: expected an OpenAI secret key, but found a URL.')
  }

  return apiKey
}

// const openai = new OpenAI({
//   apiKey: process.env.OPENAI_API_KEY,
// })


const openai = new OpenAI({
  apiKey: getOpenAIKey(),
})

export default openai

// ─── AI Usage Logger ─────────────────────────────────────────────────────

const COST_PER_M = {
  'gpt-4o':       { input: 2.50,  output: 10.00 },
  'gpt-4o-mini':  { input: 0.15,  output: 0.60  },
}

export async function logAiUsage(params: {
  callType: string
  model: string
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number } | null | undefined
  bookingRef?: string | null
  source?: string
}) {
  if (!params.usage) return
  const rates = COST_PER_M[params.model as keyof typeof COST_PER_M] ?? { input: 2.50, output: 10.00 }
  const cost = (params.usage.prompt_tokens / 1_000_000 * rates.input) +
               (params.usage.completion_tokens / 1_000_000 * rates.output)

  const ref = params.bookingRef ? ` [${params.bookingRef}]` : ''
  console.log(
    `\x1b[35m[AI]\x1b[0m ${params.callType} (${params.model})` +
    `  prompt:\x1b[33m${params.usage.prompt_tokens}\x1b[0m` +
    `  completion:\x1b[33m${params.usage.completion_tokens}\x1b[0m` +
    `  total:\x1b[33m${params.usage.total_tokens}\x1b[0m` +
    `  cost:\x1b[32m$${cost.toFixed(4)}\x1b[0m${ref}`
  )

  try {
    const { prisma } = await import('@/lib/prisma')
    await prisma.aiUsageLog.create({
      data: {
        callType:         params.callType,
        model:            params.model,
        promptTokens:     params.usage.prompt_tokens,
        completionTokens: params.usage.completion_tokens,
        totalTokens:      params.usage.total_tokens,
        estimatedCostUsd: cost,
        bookingRef:       params.bookingRef ?? null,
        source:           params.source ?? null,
      },
    })
  } catch { /* never let logging crash the main flow */ }
}

// ─── System prompts ──────────────────────────────────────────────────────

const BOOKING_EXTRACTION_PROMPT = `You are a travel booking data extraction assistant for AppleHolidays.
Extract structured booking data from the provided tour confirmation document text.
Return ONLY valid JSON matching the schema below. If a field is not found, use null.

## CRITICAL — IS Number Extraction (HIGHEST PRIORITY)

The IS Number is the MOST IMPORTANT field. It is always labelled exactly as:
  IS Number: VN40123
  IS Number: IS23492
  IS Number: MY40586
  IS Number: SG57685

Supported prefixes and their meaning:
  VN = Vietnam
  IS = Sri Lanka
  SG = Singapore
  MY = Malaysia

Rules for isNumber:
- Search the ENTIRE document for the label "IS Number:" followed by the code.
- Also check: embedded in Tour Ref after "||" or " / " (e.g. "463720CNTL||SG22228" → SG22228).
- Also check: "Confirmation Number:", "Booking No:", "Reference No:" sections.
- Remove ANY spaces between prefix and digits (e.g. "VN 19785" → "VN19785", "IS 40567" → "IS40567").
- Preserve prefix letters exactly (uppercase).
- NEVER generate or fabricate an IS Number.
- Return null ONLY if the IS Number is truly absent from the document.

Valid examples: VN19785, IS40567, SG56789, MY12345
Invalid (reject): 19785, 40567, VNXXXX, IS-40567

Schema:
{
  "bookingRef": "string — the TC Tour Ref / Tour No exactly as printed (e.g. '469182CNTL', '463720CNTL||SG22228', '459773CNTL / VN19428'). Copy verbatim including any || or / separators.",
  "cntlNumber": "string or null — CNTL/Quotation number if present (digits+CNTL or CNTL+digits, e.g. '463720CNTL', 'CNTL459773'). Extract from bookingRef or document if present. Return null if absent.",
  "agentBookingId": "string or null — agent's own non-CNTL booking/order reference. Do NOT put CNTL numbers here.",
  "agent": "string (e.g. Make My Trip)",
  "fileHandler": "string or null",
  "arrivalDate": "ISO date string YYYY-MM-DD",
  "departureDate": "ISO date string YYYY-MM-DD",
  "paxAdults": "number",
  "paxChildren": "number",
  "quotedTotal": "number",
  "currency": "string (default USD)",
  "amendmentNote": "string or null",
  "terms": "string or null — full Terms and Conditions text",
  "exclusions": "string or null — The Above Package Excludes section",
  "policyNotes": "string or null",

  "valueAddedServices": "string or null — 'Value Added Services' section text verbatim",
  "packageIncludes": "string or null — 'Above Package Includes' section text verbatim",
  "packageExcludes": "string or null — 'The Above Package Excludes' section text verbatim (same as exclusions but kept separately for display)",
  "importantNotes": "string or null — 'IMPORTANT NOTES' or 'Important Note' section text verbatim",
  "tips": "string or null — 'TIPS' section text verbatim",
  "otherNote": "string or null — 'Other Note' or 'Other Notes' section text verbatim",
  "clientRequest": "string or null — 'Client Request' or 'Special Request' section text verbatim",

  "agentEmail": "string or null — email address of the travel agent / booking company (found in From:, CC:, agent signature, or booking header)",
  "agentPhone": "string or null — phone/mobile number of the travel agent or company",
  "agentWhatsapp": "string or null — WhatsApp number of the agent (if labeled WA: or WhatsApp: separately from phone)",
  "agentCountry": "string or null — country of the travel agent company",

  "contactEmail": "string or null — personal email of the lead tourist / end customer (found in passenger section, 'Guest Email', or different domain from agent)",
  "contactPhone": "string or null — personal mobile/phone of the lead tourist",
  "contactWhatsapp": "string or null — WhatsApp of the lead tourist (if labeled separately, else same as contactPhone)",
  "contactCountry": "string or null — home country or nationality country of the lead tourist",

  "isNumber": "string or null — CRITICAL: IS/VN/SG/MY number e.g. VN19005, IS48377, SG22232, MY23122. Extract EXACTLY as written, remove spaces (VN 19785 → VN19785). Labeled 'IS Number:' in the document. ALWAYS extract if present. Return null only if truly absent.",
  "dealName": "string or null — deal name e.g. 'Rakshitha - Vietnam - 060626' (labeled 'Deal Name' in TC)",
  "tourDestination": "string or null — destination country/city e.g. 'Vietnam', 'Sri Lanka', 'Singapore & Malaysia' (labeled 'Destination' in TC)",
  "chauffeurContact": "string or null — chauffeur or tour guide contact details (labeled 'Chauffeur/Tour guide contact' in TC)",
  "languagePreference": "string or null — guests' language preference (labeled 'Guests Language Preference' or similar)",
  "specialOccasions": "string or null — special occasions e.g. honeymoon, birthday (labeled 'Special Occasions' in TC)",
  "checkedBy": "string or null — name of person who checked/verified the TC (labeled 'Checked by' in TC)",
  "reconfirmBy": "string or null — deadline or person for reconfirmation (labeled 'Reconfirm by' in TC)",

  "passengers": [
    {
      "name": "string",
      "type": "ADULT or CHILD",
      "age": "number or null",
      "isLead": "boolean",
      "passport": "string or null — passport DOCUMENT NUMBER only (e.g. 'N1234567', 'A9876543'). NEVER put a phone/mobile number here. If you see a phone number next to a passenger name, put it in 'contact' instead.",
      "nationality": "string or null — passenger nationality or country",
      "contact": "string or null — personal phone, mobile or WhatsApp of this passenger. NEVER put a passport document number here."
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
      "title": "string — EXACT complete title from the TC, copied verbatim. NEVER shorten, paraphrase or replace with generic labels like 'Various Attractions' or 'City Tour'. Copy the full official tour name exactly as written.",
      "description": "string or null — exact description text from TC, copied verbatim. Do NOT omit or summarise. Return null only if no description exists.",
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
Important:
- bookingRef must be the exact TC Tour Ref printed on the document (copy verbatim, including any || or / separators).
- isNumber is CRITICAL — always extract if any IS/VN/SG/MY code appears anywhere in the document.
- agentBookingId is the agent's own internal reference (separate from the TC Tour Ref), or null if absent.
- For valueAddedServices, packageIncludes, packageExcludes, importantNotes, tips, otherNote, clientRequest: copy the section content verbatim as a single string. If the section is absent, return null.`

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

// ─── IS Number helpers ────────────────────────────────────────────────────

const IS_NUMBER_PATTERN = /^(VN|IS|SG|MY)\s*\d+$/i

export function normalizeISNumber(raw: string | null | undefined): string | null {
  if (!raw) return null
  const cleaned = raw.replace(/\s+/g, '').toUpperCase()
  return IS_NUMBER_PATTERN.test(cleaned) ? cleaned : null
}

export function extractISNumberFromText(text: string): string | null {
  const match = text.match(/IS\s*Number\s*[:\-]\s*((VN|IS|SG|MY)\s*\d+)/i)
  if (match) return normalizeISNumber(match[1])
  return null
}

// ─── Extraction functions ────────────────────────────────────────────────

export async function extractBookingFromText(documentText: string, bookingRef?: string): Promise<Record<string, unknown>> {
  // Regex pre-extraction as ground truth for IS Number (AI may miss it)
  const regexISNumber = extractISNumberFromText(documentText)

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      { role: 'system', content: BOOKING_EXTRACTION_PROMPT },
      {
        role: 'user',
        content: `Extract booking data from this document:\n\n${documentText.slice(0, 14000)}`,
      },
    ],
    response_format: { type: 'json_object' },
    temperature: 0.1,
  })
  await logAiUsage({ callType: 'booking_extraction', model: 'gpt-4o', usage: response.usage, bookingRef, source: 'onedrive' })

  const content = response.choices[0]?.message?.content
  if (!content) throw new Error('OpenAI returned empty response')
  const result = JSON.parse(content) as Record<string, unknown>

  // Normalize the AI-extracted IS Number; fall back to regex if AI missed it
  const aiISNumber = normalizeISNumber(result.isNumber as string | null)
  result.isNumber = aiISNumber ?? regexISNumber

  return result
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

  await logAiUsage({ callType: 'pnl_classify', model: 'gpt-4o-mini', usage: response.usage, source: 'pnl' })
  const content = response.choices[0]?.message?.content
  if (!content) return activities.map(() => 'OTHER')

  const parsed = JSON.parse(content) as { categories?: string[] }
  const result = parsed.categories ?? []
  // Pad if OpenAI returns fewer items than expected
  while (result.length < activities.length) result.push('OTHER')
  return result
}

export async function extractPNLFromText(sheetText: string, bookingRef?: string): Promise<Record<string, unknown>> {
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
  await logAiUsage({ callType: 'pnl_extraction', model: 'gpt-4o', usage: response.usage, bookingRef, source: 'upload' })

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

export async function extractTicketDetails(
  fileBase64: string,
  mimeType: string,
  ticketType: string,
): Promise<{
  reference?: string
  supplier?: string
  date?: string
  notes?: string
  driverName?: string
  driverPhone?: string
  vehicleType?: string
  vehicleNumber?: string
}> {
  const isImage = mimeType.startsWith('image/')
  const messages: Parameters<typeof openai.chat.completions.create>[0]['messages'] = isImage
    ? [
        {
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: { url: `data:${mimeType};base64,${fileBase64}`, detail: 'high' },
            },
            {
              type: 'text',
              text: `This is a ticket, voucher, or confirmation document for: "${ticketType}".
Extract the following as JSON (use null for anything not found):
{
  "reference": "booking/confirmation/ticket reference number",
  "supplier": "company or provider name",
  "date": "date of service (YYYY-MM-DD or as shown)",
  "notes": "any important instructions, meeting point, dress code, or details",
  "driverName": "driver name if this is a transfer/transport ticket",
  "driverPhone": "driver phone if visible",
  "vehicleType": "vehicle type if this is a transfer (Car, Van, Bus, etc.)",
  "vehicleNumber": "vehicle number plate if visible"
}
Return only valid JSON.`,
            },
          ],
        },
      ]
    : [
        {
          role: 'user',
          content: `This is a PDF ticket/voucher for: "${ticketType}". The text content is below. Extract key details as JSON (null for missing):
{"reference": null, "supplier": null, "date": null, "notes": null, "driverName": null, "driverPhone": null, "vehicleType": null, "vehicleNumber": null}
The fileBase64 is not provided for PDF. Return empty JSON: {}`,
        },
      ]

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages,
      temperature: 0,
      max_tokens: 400,
      response_format: { type: 'json_object' },
    })
    await logAiUsage({ callType: 'ticket_details', model: 'gpt-4o', usage: response.usage, source: 'manual' })
    const content = response.choices[0]?.message?.content ?? '{}'
    return JSON.parse(content)
  } catch {
    return {}
  }
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

  await logAiUsage({ callType: 'ai_suggestion', model: 'gpt-4o', usage: response.usage, source: 'manual' })
  return response.choices[0]?.message?.content ?? 'Unable to generate response.'
}
