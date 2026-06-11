import { simpleParser } from 'mailparser'
import openai from '@/lib/openai'

// ── Types ────────────────────────────────────────────────────────────────────

export interface ProcessedEmail {
  uid: number
  subject: string
  from: string
  date: string
  type: 'TOUR_CONFIRMATION' | 'PNL' | 'UNKNOWN'
  rawBody: string
  parsed: Record<string, unknown> | null
  error?: string
}

export interface ExtractedBooking {
  bookingRef: string | null
  agentBookingId: string | null
  agent: string | null
  fileHandler: string | null
  arrivalDate: string | null
  departureDate: string | null
  paxAdults: number
  paxChildren: number
  quotedTotal: number | null
  currency: string
  terms: string | null
  exclusions: string | null
  passengers: { name: string; type: string; isLead: boolean }[]
  flights: { flightNo: string; date: string; fromApt: string; depTime?: string; toApt: string; arrTime?: string; airline?: string }[]
  accommodations: { hotel: string; city: string; checkIn: string; checkOut: string; nights: number; roomType?: string; mealType?: string }[]
  itineraryItems: { dayNo: number; date: string; title: string; description?: string }[]
  emergencyContacts: { name: string; phone?: string; role?: string }[]
  pnlLines: {
    activity: string
    category: string
    mmtRate: number
    sicRate: number
    pvtRatePP: number
    adEntrance: number
    chEntrance: number
    otherRate: number
  }[]
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function detectEmailType(subject: string, body: string): 'TOUR_CONFIRMATION' | 'PNL' | 'UNKNOWN' {
  const s = subject.toLowerCase()
  const b = body.toLowerCase().slice(0, 2000)

  if (
    s.includes('quotation') || s.includes('tour confirmation') || s.includes('confirmation') ||
    b.includes('tour confirmation') || b.includes('tour ref') || b.includes('is number') ||
    b.includes('arrival date') || b.includes('no. of guests') || b.includes('itinerary:')
  ) {
    return 'TOUR_CONFIRMATION'
  }

  if (
    s.includes('pnl') || s.includes('costing') || s.includes('pricing') ||
    b.includes('mmt rate') || b.includes('sic rate') || b.includes('cost per person') ||
    b.includes('pvt rate') || b.includes('profit')
  ) {
    return 'PNL'
  }

  return 'UNKNOWN'
}

// ── OpenAI extraction ────────────────────────────────────────────────────────

const TOUR_CONFIRMATION_PROMPT = `You are a Vietnam travel booking extraction expert for AppleHolidays (MMT Vietnam).
Extract ALL booking details from this email thread. Focus on the MOST RECENT tour confirmation section.

Return ONLY valid JSON matching this exact schema:
{
  "bookingRef": "IS Number or Tour Ref or internal booking reference (e.g. VN19730, 468600CNTL)",
  "agentBookingId": "Agent's booking ID (e.g. 402011138462)",
  "agent": "Agent company name (e.g. 30 Sundays, Make My Trip)",
  "fileHandler": "File handler name (e.g. Yogi)",
  "arrivalDate": "YYYY-MM-DD",
  "departureDate": "YYYY-MM-DD",
  "paxAdults": number,
  "paxChildren": number,
  "quotedTotal": number or null,
  "currency": "USD",
  "terms": "full terms and conditions text or null",
  "exclusions": "exclusions text or null",
  "emergencyContacts": [{ "name": "string", "phone": "string or null", "role": "string or null" }],
  "passengers": [{ "name": "string", "type": "ADULT or CHILD", "isLead": true/false }],
  "flights": [{ "flightNo": "string", "date": "YYYY-MM-DD", "fromApt": "IATA code", "depTime": "HH:MM or null", "toApt": "IATA code", "arrTime": "HH:MM or null", "airline": "string or null" }],
  "accommodations": [{ "hotel": "hotel name", "city": "city name", "checkIn": "YYYY-MM-DD", "checkOut": "YYYY-MM-DD", "nights": number, "roomType": "string or null", "mealType": "BB/HB/FB/null" }],
  "itineraryItems": [{ "dayNo": number, "date": "YYYY-MM-DD", "title": "short activity title", "description": "detailed description or null" }],
  "pnlLines": []
}

IMPORTANT: Extract the IS Number as bookingRef (format: VN#####). If no IS Number, use Tour Ref.
For pax names, extract from "Guests Name" or similar sections. If only one name is given, mark as isLead:true.
For airports, use 3-letter IATA codes (HAN=Hanoi, DAD=Da Nang, SGN=Ho Chi Minh, etc.).
Date format must be YYYY-MM-DD strictly.`

const PNL_PROMPT = `You are a P&L extraction expert for AppleHolidays (MMT Vietnam).
Extract cost line items from this email. Focus on the pricing/costing table.

Return ONLY valid JSON:
{
  "bookingRef": "IS Number or reference number",
  "paxAdults": number,
  "paxChildren": number,
  "pnlLines": [
    {
      "activity": "service/activity name",
      "category": "one of: HOTEL, TICKETS, GUIDES, MEALS, CRUISE, WATER, TRANSPORT, TAX_FEES, FLIGHT_TICKETS, OTHER",
      "mmtRate": number (rate charged to agent per person),
      "sicRate": number (SIC cost per person, 0 if not applicable),
      "pvtRatePP": number (private vehicle cost per person, 0 if not applicable),
      "adEntrance": number (adult entrance fee, 0 if not applicable),
      "chEntrance": number (child entrance fee, 0 if not applicable),
      "otherRate": number (any other cost, 0 if not applicable)
    }
  ]
}

Category rules for Vietnam:
- Airport/hotel transfers → TRANSPORT
- Ha Long cruise, boat trips → CRUISE
- Hotel stays → HOTEL
- Ba Na Hills, entrance tickets, cable car → TICKETS
- Walking tours, guided tours, city tours → GUIDES
- Kayaking, water sports → WATER
- Flights → FLIGHT_TICKETS
- Meals at restaurants → MEALS
- Visa, tax, service charge → TAX_FEES`

export async function extractBookingFromEmail(emailBody: string, emailType: 'TOUR_CONFIRMATION' | 'PNL'): Promise<ExtractedBooking> {
  const prompt = emailType === 'TOUR_CONFIRMATION' ? TOUR_CONFIRMATION_PROMPT : PNL_PROMPT

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      { role: 'system', content: prompt },
      { role: 'user', content: `Extract from this email:\n\n${emailBody.slice(0, 14000)}` },
    ],
    response_format: { type: 'json_object' },
    temperature: 0.1,
  })

  const content = response.choices[0]?.message?.content
  if (!content) throw new Error('OpenAI returned empty response')

  const parsed = JSON.parse(content) as Partial<ExtractedBooking>

  return {
    bookingRef:       parsed.bookingRef       ?? null,
    agentBookingId:   parsed.agentBookingId   ?? null,
    agent:            parsed.agent            ?? null,
    fileHandler:      parsed.fileHandler      ?? null,
    arrivalDate:      parsed.arrivalDate      ?? null,
    departureDate:    parsed.departureDate    ?? null,
    paxAdults:        Number(parsed.paxAdults  ?? 2),
    paxChildren:      Number(parsed.paxChildren ?? 0),
    quotedTotal:      parsed.quotedTotal      ? Number(parsed.quotedTotal) : null,
    currency:         parsed.currency         ?? 'USD',
    terms:            parsed.terms            ?? null,
    exclusions:       parsed.exclusions       ?? null,
    passengers:       parsed.passengers       ?? [],
    flights:          parsed.flights          ?? [],
    accommodations:   parsed.accommodations   ?? [],
    itineraryItems:   parsed.itineraryItems   ?? [],
    emergencyContacts: parsed.emergencyContacts ?? [],
    pnlLines:         parsed.pnlLines         ?? [],
  }
}

// ── Microsoft Graph API email reader ─────────────────────────────────────────

async function getGraphToken(): Promise<string> {
  const tenantId     = process.env.Azure_TENANT_ID
  const clientId     = process.env.Azure_CLIENT_ID
  const clientSecret = process.env.Azure_CLIENT_SECRET

  if (!tenantId || !clientId || !clientSecret) {
    throw new Error('Azure AD credentials not set (Azure_TENANT_ID / Azure_CLIENT_ID / Azure_CLIENT_SECRET)')
  }

  const res = await fetch(
    `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type:    'client_credentials',
        client_id:     clientId,
        client_secret: clientSecret,
        scope:         'https://graph.microsoft.com/.default',
      }).toString(),
    },
  )

  const json = await res.json() as { access_token?: string; error?: string; error_description?: string }
  if (!json.access_token) {
    throw new Error(`Token request failed: ${json.error_description ?? json.error ?? 'unknown'}`)
  }
  return json.access_token
}

export async function fetchUnprocessedEmails(limit = 10): Promise<ProcessedEmail[]> {
  const user = process.env.Outlookmail_USERNAME
  if (!user) throw new Error('Outlookmail_USERNAME not set')

  const token = await getGraphToken()

  // Fetch latest `limit` messages from inbox
  const url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(user)}/mailFolders/inbox/messages` +
    `?$top=${limit}&$orderby=receivedDateTime desc` +
    `&$select=id,subject,from,receivedDateTime,body,bodyPreview`

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Graph API error ${res.status}: ${err}`)
  }

  const json = await res.json() as { value: GraphMessage[] }
  const messages = json.value ?? []

  const results: ProcessedEmail[] = []

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]
    const subject  = msg.subject ?? ''
    const fromAddr = msg.from?.emailAddress?.address ?? ''
    const date     = msg.receivedDateTime ?? new Date().toISOString()
    const rawBody  = msg.body?.contentType === 'text'
      ? (msg.body.content ?? msg.bodyPreview ?? '')
      : (msg.bodyPreview ?? '')

    // Get full plain-text body if HTML
    let bodyText = rawBody
    if (msg.body?.contentType === 'html' && msg.body.content) {
      try {
        const parsed = await simpleParser(msg.body.content)
        bodyText = parsed.text || rawBody
      } catch {
        bodyText = rawBody
      }
    }

    results.push({
      uid:     i + 1,
      subject,
      from:    fromAddr,
      date,
      type:    detectEmailType(subject, bodyText),
      rawBody: bodyText.slice(0, 20000),
      parsed:  null,
    })
  }

  return results
}

interface GraphMessage {
  id: string
  subject?: string
  from?: { emailAddress?: { address?: string; name?: string } }
  receivedDateTime?: string
  bodyPreview?: string
  body?: { contentType?: string; content?: string }
}
