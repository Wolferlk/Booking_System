import openai from '@/lib/openai'
import { extractTextFromDocx } from '@/lib/parsers/docx-parser'
import { extractTextFromXlsx } from '@/lib/parsers/xlsx-parser'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse = require('pdf-parse') as (buf: Buffer) => Promise<{ text: string }>

// ── Types ────────────────────────────────────────────────────────────────────

export interface ProcessedEmail {
  uid: number
  graphId: string
  subject: string
  from: string
  fromName: string
  to: string[]
  cc: string[]
  date: string
  type: 'TOUR_CONFIRMATION' | 'PNL' | 'UNKNOWN'
  rawBody: string
  bodyHtml: string
  folder: string
  isRead: boolean
  hasAttachments: boolean
  importance: string
  conversationId: string
  parsed: Record<string, unknown> | null
  error?: string
}

export type MailboxKind = 'TOUR_CONFIRMATION' | 'PNL'

export interface MailboxConfig {
  user: string
  kind: MailboxKind
  label: string
}

export interface EmailAttachment {
  name: string
  contentType: string
  size?: number
  buffer: Buffer
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
  // Additional TC sections
  valueAddedServices: string | null
  packageIncludes: string | null
  packageExcludes: string | null
  importantNotes: string | null
  tips: string | null
  otherNote: string | null
  clientRequest: string | null
  // TC confirmation specific fields
  cntlNumber: string | null
  isNumber: string | null
  dealName: string | null
  tourDestination: string | null
  chauffeurContact: string | null
  languagePreference: string | null
  specialOccasions: string | null
  checkedBy: string | null
  reconfirmBy: string | null
  // Agent contact details
  agentEmail: string | null
  agentPhone: string | null
  agentWhatsapp: string | null
  agentCountry: string | null
  agentAddress: string | null
  // Lead customer contact details
  contactEmail: string | null
  contactPhone: string | null
  contactWhatsapp: string | null
  contactCountry: string | null
  contactAddress: string | null
  passengers: { name: string; type: string; isLead: boolean; passport?: string | null; nationality?: string | null; contact?: string | null; age?: number | null }[]
  flights: { flightNo: string; date: string; fromApt: string; depTime?: string; toApt: string; arrTime?: string; airline?: string; notes?: string }[]
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

export function detectEmailType(subject: string, body: string): 'TOUR_CONFIRMATION' | 'PNL' | 'UNKNOWN' {
  const s = subject.toLowerCase()
  const b = body.toLowerCase().slice(0, 3000)

  // Check PNL signals FIRST — PNL emails also contain "is number" so TQ check must come after
  if (
    s.includes('pnl') || s.includes('p&l') || s.includes('costing') || s.includes('pricing') ||
    b.includes('mmt rate') || b.includes('sic rate') || b.includes('cost per person') ||
    b.includes('pvt rate') || b.includes('hotels/cruises') || b.includes('room night') ||
    b.includes('driver accomodation') || b.includes('bata') || b.includes('quotation_no') ||
    (b.includes('transport') && b.includes('is number'))
  ) {
    return 'PNL'
  }

  if (
    s.includes('quotation') || s.includes('tour confirmation') || s.includes('confirmation') ||
    b.includes('tour confirmation') || b.includes('tour ref') || b.includes('is number') ||
    b.includes('arrival date') || b.includes('no. of guests') || b.includes('itinerary:')
  ) {
    return 'TOUR_CONFIRMATION'
  }

  return 'UNKNOWN'
}

export function getConfiguredMailboxes(): MailboxConfig[] {
  const mailboxes: MailboxConfig[] = []

  const tqUser = process.env.Outlookmail_USERNAME?.trim()
  if (tqUser) {
    mailboxes.push({
      user: tqUser,
      kind: 'TOUR_CONFIRMATION',
      label: 'Travel Quotation',
    })
  }

  const pnlUser = (process.env.GRAPH_PNL_USER ?? '').trim()
  if (pnlUser && pnlUser !== tqUser) {
    mailboxes.push({
      user: pnlUser,
      kind: 'PNL',
      label: 'Travel P&L',
    })
  }

  return mailboxes
}

// ── Email body pre-processing ─────────────────────────────────────────────────

// Isolates the "TOUR CONFIRMATION" block from an email thread.
// Email threads embed previous replies below the current message; the TC is
// often in a quoted reply while the most-recent message is just "please see attached".
// We extract from the TC header to the next forwarded-message boundary.
function extractTCSection(text: string): string {
  const tcIdx = text.search(/\bTOUR\s+CONFIRMATION\b/i)
  if (tcIdx === -1) return text                     // no marker — return as-is

  const start   = Math.max(0, tcIdx - 1000)         // include greeting + hotel context above TC header

  // Reply/forward boundary patterns (HTML-stripped or plain text email threads):
  // 1. "From: Name <email@…> Sent/Date:" — standard Outlook thread header
  // 2. "From: Name < email > Sent:" — with spaces around angle brackets (HTML-stripped)
  // 3. Newline followed by "From:" at line start (forwarded message in plain text)
  const afterTC = text.slice(tcIdx)
  const boundary = afterTC.match(
    /From:\s+\S[^<\n]{0,120}[<\s][\w.+-]+@[\w.-]+[>\s]\s+(?:Sent|Date)\s*:/i
  )
  // Allow up to 12000 chars so the full TC (hotel table, itinerary, inclusions) is captured
  const end = tcIdx + (boundary?.index ?? Math.min(afterTC.length, 12000))

  const section = text.slice(start, end).trim()
  return section.length > 200 ? section : text
}

// Isolates the PNL/costing block from an email thread.
function extractPNLSection(text: string): string {
  // Look for PNL table headers or IS Number label that appears in PNL emails
  const pnlIdx = text.search(/(?:mmt\s*rate|sic\s*rate|pvt\s*rate|hotels\/cruises|transport.*is number)/i)
  if (pnlIdx === -1) return text

  const start   = Math.max(0, pnlIdx - 500)
  const afterPN = text.slice(pnlIdx)
  const boundary = afterPN.match(/From:\s+\S[^<\n]{0,80}<[^>]+>\s+(?:Sent|Date):/i)
  const end = pnlIdx + (boundary?.index ?? Math.min(afterPN.length, 9000))

  const section = text.slice(start, end).trim()
  return section.length > 200 ? section : text
}

// ── OpenAI extraction ─────────────────────────────────────────────────────────

const TOUR_CONFIRMATION_PROMPT = `You are a travel booking extraction expert for AppleHolidays (Vietnam, Sri Lanka, Singapore, Malaysia).
Extract ALL booking details from the Tour Confirmation section below. The text may be extracted from an email thread — ignore any surrounding email headers, greetings, or reply noise and focus on the block starting with "TOUR CONFIRMATION" or the main booking confirmation content.

Return ONLY valid JSON matching this exact schema:
{
  "bookingRef": "The IS Number — MUST start with VN, IS, SG, or MY followed by digits only (e.g. VN40120, IS48375, SG22232, MY40586). Look for the 'IS Number:' label in the confirmation body. Strip all spaces: 'VN 40120' → 'VN40120'. NEVER put a CNTL number (e.g. 471416CNTL) or a pure numeric agent ID here. Return null if no IS/VN/SG/MY number is found.",
  "cntlNumber": "CNTL/Quotation number — digits followed by CNTL or CNTL followed by digits (e.g. '471416CNTL', '463720CNTL', 'CNTL459773'). Look for this in the 'Tour Ref:' field, NOT in the IS Number field. This is a SEPARATE field from bookingRef. Return null if absent.",
  "agentBookingId": "Agent's non-CNTL booking ID / reference number from the email subject or booking form (e.g. 402011138462). Do NOT put CNTL numbers here — use cntlNumber for those.",
  "agent": "Agent company name (e.g. 30 Sundays, Make My Trip, Tours Experts)",
  "fileHandler": "File handler or account manager name listed in the confirmation (e.g. Sangeetha Priya, Yogi, Shehan Jayakody)",
  "arrivalDate": "YYYY-MM-DD",
  "departureDate": "YYYY-MM-DD",
  "paxAdults": number,
  "paxChildren": number,
  "quotedTotal": number or null — ACTIVELY LOOK FOR the total package price. Search for: 'Total Tour Cost', 'Total Package Price', 'Net Rate', 'Total Amount', 'Package Cost', 'Tour Price', 'Grand Total', 'Total Cost', 'Package Rate', 'Total (USD)', 'Total (INR)'. Extract the NUMERIC value only (no currency symbols). If multiple totals appear, use the one labelled as the overall package total. Return null ONLY if truly absent from the document.,
  "currency": "USD — or extract the actual currency code if explicitly stated (e.g. USD, INR, SGD, LKR, MYR, AUD). Default to USD.",
  "terms": "full terms and conditions text or null",
  "exclusions": "exclusions text or null",
  "packageIncludes": "Full text of 'Package Includes' / 'Inclusions' / 'What's Included' section — copy verbatim. Return null if not found.",
  "packageExcludes": "Full text of 'Package Excludes' / 'Exclusions' / 'Not Included' / 'Package Exclusions' section — copy verbatim. Return null if not found.",
  "tips": "Full text of any 'Tips' / 'Gratuities' / 'Driver Tips' / 'Guide Tips' section — copy verbatim. Return null if not found.",
  "importantNotes": "Full text of 'Important Notes' / 'Please Note' / 'Note' section — copy verbatim. Return null if not found.",
  "isNumber": "IS/VN/SG/MY number exactly as written (e.g. VN19785, IS48375, SG22232, MY40586) — look for 'IS Number:' label in the confirmation body. MUST start with VN, IS, SG, or MY followed by digits only. Return null if not found.",
  "dealName": "Deal name or booking title from the email subject or confirmation header (e.g. 'Rakshitha - Vietnam - 060626', 'Arpit Jain - Sri Lanka'). Strip the agent booking ID and country prefix/suffix from the subject line if present.",
  "tourDestination": "Exact primary destination country or region as named in the TC (e.g. 'Vietnam', 'Sri Lanka', 'Singapore & Malaysia', 'Bali'). Infer from IS number prefix (VN=Vietnam, IS=Sri Lanka, SG/MY=Singapore & Malaysia) or email content. Do NOT shorten or truncate.",
  "chauffeurContact": "Chauffeur or tour guide contact information as listed in the confirmation — may be a name and phone, or 'Will Advice'. Return null if not found.",
  "languagePreference": "Guest preferred language (e.g. 'English', 'Hindi', 'Tamil'). Look for 'Language Preference' or similar field. Return null if not specified.",
  "specialOccasions": "Any special occasions mentioned (e.g. 'Honeymoon', 'Anniversary', 'Birthday'). Return null if not mentioned.",
  "checkedBy": "Name of person who checked or verified the booking (look for 'Checked by:' label). Return null if not found.",
  "reconfirmBy": "Name or date for reconfirmation (look for 'Reconfirm by:' label). Return null if not found.",
  "agentEmail": "agent company email address or null",
  "agentPhone": "agent phone number in international format with country code (e.g. +91 9876543210, +94 77 123 4567, +1 212 555 0100) or null",
  "agentWhatsapp": "agent WhatsApp number in international format with country code or null",
  "agentCountry": "agent country or null",
  "agentAddress": "agent full office/mailing address or null",
  "contactEmail": "lead customer/passenger email address or null",
  "contactPhone": "lead customer/tourist phone number in international format with country code (e.g. +91 9876543210) or null",
  "contactWhatsapp": "lead customer/tourist WhatsApp number in international format with country code or null",
  "contactCountry": "lead customer country or nationality or null",
  "contactAddress": "lead customer home/mailing address or null",
  "emergencyContacts": [{ "name": "string", "phone": "phone in international format with country code or null", "role": "string or null" }],
  "passengers": [{ "name": "string", "type": "ADULT or CHILD", "isLead": true/false, "age": "number or null", "passport": "passport document number ONLY — e.g. 'N1234567' or 'A9876543'. NEVER put a phone number here. If you see a phone/mobile number next to a passenger, put it in 'contact', not 'passport'. Return null if no passport number is found.", "nationality": "string or null — passenger nationality/country", "contact": "string or null — personal phone, mobile or WhatsApp of this specific passenger (NOT a passport number). Return null if not found.", "mealPreference": "string or null — e.g. 'Vegetarian', 'Vegan', 'Halal', 'Jain', 'Non-Vegetarian', 'Gluten-Free'. Look for 'Meal Preference', 'Food Preference', 'Dietary Requirement', 'Special Meal' fields per passenger, or a booking-level note. Return null if not specified." }],
  "flights": [{ "flightNo": "EXACT flight number as printed — e.g. 'VJ815', '6E204', 'SQ456'. Normalise: remove spaces between airline code and number ('VJ 815' → 'VJ815'). Never fabricate a number.", "date": "YYYY-MM-DD — the DEPARTURE date of this flight leg", "fromApt": "3-letter IATA departure airport code — NEVER city name", "depTime": "HH:MM 24-hour — convert 12h to 24h ('06:10 AM' → '06:10', '02:30 PM' → '14:30'). Null only if truly absent.", "toApt": "3-letter IATA arrival airport code", "arrTime": "HH:MM 24-hour arrival time. If arrival is next day, still return the time (e.g. '01:15'). Null only if truly absent.", "airline": "full airline name or null", "notes": "any extra info (terminal, baggage, stops) or null" }],
  "accommodations": [{ "hotel": "ONLY the actual hotel/resort/villa name (e.g. 'Novotel Hanoi', 'La Siesta Hotel'). NEVER include airport names, transfer directions, or route text. If the TC shows 'Airport to Hotel Name', the hotel field is just 'Hotel Name'.", "city": "city name", "checkIn": "YYYY-MM-DD", "checkOut": "YYYY-MM-DD", "nights": number, "roomType": "string or null", "mealType": "BB/HB/FB/null" }],
  "itineraryItems": [{ "dayNo": number, "date": "YYYY-MM-DD", "title": "COPY THE COMPLETE OFFICIAL TOUR/ACTIVITY/TRANSFER NAME VERBATIM — never shorten, paraphrase, or truncate. Example: 'Vin Wonder & Safari Combo tickets & Grand World Transfer' must be kept in full. NEVER use generic labels like 'Various Attractions', 'City Tour', 'Day Tour'. Copy the full official name exactly as written.", "description": "COPY THE EXACT DESCRIPTION TEXT FROM THE TC VERBATIM — do NOT omit, shorten or summarise any part. For airport transfer items, include the associated flight details (flight number, departure/arrival times) from the TC in this field. Return null only if no description exists.", "serviceType": "PVT_TRANSFER|SIC_TRANSFER|FLIGHT|INTERNAL_TOUR|ACCOMMODATION|OWN_ARRANGEMENT — CRITICAL: if the word 'SIC' appears in the title or description, ALWAYS use SIC_TRANSFER; airport road transfers are always PVT_TRANSFER" }],
  "pnlLines": []
}

IS NUMBER EXTRACTION (CRITICAL):
- Look for MULTIPLE possible labels: "IS Number:", "IS No:", "Confirmation Number", "Conf No", "Conf. No.", "Tour Confirmation No"
- MakeMyTrip emails use "Confirmation Number VN20012" — this IS the IS number, not a separate field
- The IS number also frequently appears in the email subject after a "//" separator: "// VN20012"
- Prefix rules: VN = Vietnam, IS = Sri Lanka, SG = Singapore, MY = Malaysia. Examples: VN40123, IS23492, MY40586, SG57685
- Extract EXACTLY as written, including the prefix letters (e.g. "VN20012" not "20012")
- Remove spaces: "VN 20012" → "VN20012"
- Return null ONLY if truly absent — never guess or fabricate
- NEVER use the agent's booking ID (e.g. "IN1B1782458946313") as the IS number — those are numeric-only or start with non-VN/IS/SG/MY prefixes

ITINERARY EXTRACTION (CRITICAL):
- Extract EVERY single day and service from the TC: airport transfers, SIC tours, private tours, internal flights, hotel stays, cruises, day trips
- A single calendar day CAN have MULTIPLE itinerary items — extract ALL of them separately. Example: "1st transfer - Hanoi Hotel to Hanoi Bus Station Transfer / 2nd transfer - Sapa Sleeper Bus by Inter bus Line / 3rd transfer - Moana Cafe + Rainbow Slide + Alpine Coaster | Private Transfer from Sapa" → 3 separate items on the same date.
- NEVER merge or collapse multiple services on the same day into one entry.
- For internal/domestic flights, ALWAYS extract THREE separate items: (1) Departure road transfer (e.g. "Da Nang Hotel to Da Nang Airport Transfer"), (2) The flight leg itself (e.g. "Flight DAD→HAN"), (3) Arrival road transfer (e.g. "Hanoi Airport to Hanoi Hotel Transfer"). Do NOT miss the arrival transfer.
- "title" must be the COMPLETE official tour name from the TC — NEVER shorten, paraphrase, or truncate any words. Example: "Vin Wonder & Safari Combo tickets & Grand World Transfer" must be kept in full — do NOT shorten to "Vin Wonder & Safari".
- "description" must be the exact description text from the TC — copy it verbatim. For airport transfer items, include the associated flight details (flight number, departure/arrival times) from the TC.
- "serviceType" classification:
  - If the word "SIC" appears in the title or description → ALWAYS "SIC_TRANSFER" (never PVT for SIC items)
  - Airport road transfer (arrival/departure) → "PVT_TRANSFER"
  - Internal/domestic flight → "FLIGHT"
  - Private tour, private cruise, private day trip → "PVT_TRANSFER"
  - Hotel check-in/stay → "ACCOMMODATION"
  - Leisure / free day / own arrangement → "OWN_ARRANGEMENT"
  - Ticket-only / entrance-only (no vehicle) → "INTERNAL_TOUR"

DATE EXTRACTION:
- Support all formats: DD/MM/YYYY, DD-MM-YYYY, DD.MM.YYYY, Month DD YYYY, DD Month YYYY, YYYY-MM-DD
- Always convert to YYYY-MM-DD in output
- Assign correct date to EACH itinerary item, flight, and accommodation

LOCATION ACCURACY:
- tourDestination: exact country/region as stated in the TC — never abbreviate or generalise
- itineraryItems location: exact city, area, or landmark as stated in the TC

IMPORTANT: bookingRef MUST be the IS Number ONLY — always starts with VN, IS, SG, or MY followed by digits (e.g. VN40120, IS48375, SG22232, MY40586). NEVER use CNTL numbers (e.g. 471416CNTL) or pure numeric agent IDs as bookingRef. CNTL numbers go ONLY in the cntlNumber field. If no IS/VN/SG/MY number exists in the email, return null for bookingRef.

DEAL NAME: Usually found in the email subject between the agent booking ID and date codes — e.g. subject "Quotation | 402011387896 | Rakshitha - Vietnam - 060626 | ..." → dealName is "Rakshitha - Vietnam - 060626".
For pax names, extract from "Guests Name" or similar sections. If only one name is given, mark as isLead:true.
FLIGHT EXTRACTION (CRITICAL — extract EVERY flight leg):
- Scan for: "Flight", "Flight No", "Flight Number", "Air Ticket", "Airline", "✈", table columns with flight codes
- Extract EACH flight leg separately (e.g. outbound + return = 2 entries)
- Flight number formats in TCs: "VJ815", "VJ 815", "VietJet 815", "6E 204", "SQ456" — always normalise to code+number with no space
- IATA airport codes: HAN=Hanoi, DAD=Da Nang, SGN=Ho Chi Minh City, HUI=Hue, CXR=Nha Trang, PQC=Phu Quoc, VII=Vinh, BMV=Buon Ma Thuot, VCA=Can Tho, CMB=Colombo, KUL=Kuala Lumpur, SIN=Singapore, BOM/BOM=Mumbai, DEL=Delhi, MAA=Chennai, HYD=Hyderabad, BLR=Bangalore, CCU=Kolkata, DXB=Dubai, AUH=Abu Dhabi
- If airport code is not given but city/airport name is, convert to IATA code
- Times: always 24-hour HH:MM. Convert "6:10 AM" → "06:10", "2:30 PM" → "14:30", "0610" → "06:10"
- Date: use the DEPARTURE date. If the TC shows flight as part of a day's schedule, use that day's date
- NEVER skip flights — if a flight appears anywhere in the TC, include it in flights[]
For airports, use 3-letter IATA codes (HAN=Hanoi, DAD=Da Nang, SGN=Ho Chi Minh, CMB=Colombo, KUL=Kuala Lumpur, SIN=Singapore, BOM=Mumbai, DEL=Delhi, etc.).
Date format must be YYYY-MM-DD strictly.
CONTACT EXTRACTION: Scan all of — email From/Reply-To headers, email signatures, booking form fields, "Contact Details" / "Guest Info" sections, and footers. Extract BOTH agent (sender company) and customer/tourist (traveller) contacts separately.
GUEST PHONE FIELDS: MakeMyTrip and similar agents include fields like "Lead Pax Contact Number", "Guest Contact Number", or "Lead Passenger Contact" — these are the tourist/customer phone numbers; always map them to contactPhone/contactWhatsapp.
PHONE FORMAT: Always use international format with + country code. Common codes: India +91, Sri Lanka +94, USA/Canada +1, UK +44, Australia +61, Singapore +65, UAE +971, Vietnam +84, Malaysia +60, Thailand +66. If a number is given in local format without country code, infer the code from the agent's or customer's stated country. For MakeMyTrip bookings, the agent is Indian (+91) — apply +91 to unqualified 10-digit numbers starting with 6, 7, 8, or 9.
MEAL PREFERENCES: Look for "Meal Preference", "Food Preference", "Dietary Requirement", "Special Meal Request", "Veg/Non-Veg" fields. If per-passenger preferences are listed, set them on each passenger's mealPreference field. Common values: "Vegetarian", "Vegan", "Halal", "Jain", "Non-Vegetarian", "Gluten-Free", "No Pork". Normalise to title-case.`

const PNL_PROMPT = `You are a P&L extraction expert for AppleHolidays (MMT Vietnam).
Extract the booking IS Number and all cost line items from this email/document.

The data may come from TWO formats — handle both:

FORMAT A — HTML email body (sections like "Hotels/Cruises", "Transport", "Meals", etc.)
- Header area contains: Tour No, IS Number, Agent, No. Pax, No. Night, Currency
- Each section (Hotels/Cruises / Transport / Meals / Tickets etc.) is a table
- Use the "Total" or rightmost numeric column as the cost → put it in mmtRate
- Skip rows where Total is 0 or empty

FORMAT B — XLSX/CSV spreadsheet
- Columns: Activity | MMT Rate | SIC Rate | PVT Rate PP | AD Entrance | CH Entrance | Other Rate
- Use each column value directly

CRITICAL — Booking Reference:
1. Look for "Tour No" OR "IS Number:" OR "IS:" label in the body
   - "Tour No= #469083" or "Tour No: #469083" → strip the "#" → bookingRef is "469083"
   - "IS Number: IS 48369" → strip spaces → bookingRef is "IS48369"
   - PREFER "Tour No" over "IS Number" when both exist
2. Also check the subject line (e.g. "PNL:#464045" or "VN19579 P&L" → extract the number)
3. Strip "#" prefix and ALL SPACES: "#469083" → "469083", "VN 19679" → "VN19679"
4. Return only alphanumeric characters — no spaces, dashes, slashes, or "#"

Return ONLY valid JSON (no markdown):
{
  "bookingRef": "Tour No or IS Number cleaned (e.g. SG46903, IS48369, VN19679)",
  "paxAdults": number,
  "paxChildren": number,
  "pnlLines": [
    {
      "activity": "item/expense name",
      "category": "HOTEL|TICKETS|GUIDES|MEALS|CRUISE|WATER|TRANSPORT|TAX_FEES|FLIGHT_TICKETS|OTHER",
      "mmtRate": number (agent charge OR total cost from HTML — use Total column),
      "sicRate": 0,
      "pvtRatePP": 0,
      "adEntrance": 0,
      "chEntrance": 0,
      "otherRate": 0
    }
  ]
}

Category mapping:
- Hotels, resorts, accommodation, Best Western, check-in/out → HOTEL
- Ha Long cruise, junk, boat, yacht → CRUISE
- Airport transfer, travel km, vehicle, Bata, Paging, highway, driver → TRANSPORT
- Ba Na Hills, entrance, cable car, tickets, night show → TICKETS
- Guide fee, walking tour, city tour, sightseeing → GUIDES
- Kayaking, water sports, snorkelling → WATER
- Domestic/international flight, air ticket → FLIGHT_TICKETS
- Meals, lunch, dinner, breakfast, restaurant, water bottles → MEALS
- Visa, tax, insurance, service charge → TAX_FEES
- Profit, margin, commission, overhead, other cost → OTHER

IMPORTANT: pnlLines must NOT be empty if the email contains a cost table.`

export async function extractBookingFromEmail(emailBody: string, emailType: 'TOUR_CONFIRMATION' | 'PNL', emailSubject?: string): Promise<ExtractedBooking> {
  const prompt = emailType === 'TOUR_CONFIRMATION' ? TOUR_CONFIRMATION_PROMPT : PNL_PROMPT

  // Pre-extract the relevant section from the email thread to reduce noise.
  // OneDrive TC files are already clean; email threads embed the TC in quoted replies.
  const relevantBody = emailType === 'TOUR_CONFIRMATION'
    ? extractTCSection(emailBody)
    : extractPNLSection(emailBody)

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      { role: 'system', content: prompt },
      { role: 'user', content: `Extract from this tour confirmation:\n\n${relevantBody.slice(0, 14000)}` },
    ],
    response_format: { type: 'json_object' },
    temperature: 0.1,
  })

  const content = response.choices[0]?.message?.content
  if (!content) throw new Error('OpenAI returned empty response — check API key and quota at platform.openai.com/account/billing')

  const parsed = JSON.parse(content) as Partial<ExtractedBooking>

  // Use the TC-isolated section for server-side regex too — prevents false matches from
  // quoted email thread replies above/below the actual TC block.
  // (extractTCSection returns the full body unchanged when no TC marker is found.)
  const regexText = relevantBody

  const tourRefOverride = emailType === 'TOUR_CONFIRMATION'
    ? extractTourRefFromText(regexText)
    : extractPnlTourNoFromText(regexText)

  // Authoritative server-side IS number.
  // Try the isolated TC section first; fall back to the full body and subject line.
  const isNumberOverride =
    extractIsNumberFromBody(regexText) ??
    extractIsNumberFromBody(emailBody) ??
    (emailSubject ? extractIsNumberFromSubject(emailSubject) : null)

  const regexPhone = emailType === 'TOUR_CONFIRMATION'
    ? extractGuestPhoneFromText(regexText)
    : null

  // bookingRef MUST be the IS number (VN/IS/SG/MY prefix) — NEVER use tour ref or CNTL number.
  // Priority: server-side regex from TC section/body/subject > GPT isNumber > GPT bookingRef
  // (only if it validates as a proper IS number). Tour Ref stored in cntlNumber, not booking ID.
  const parsedBookingRefAsIs: string | null = (() => {
    const raw = String(parsed.bookingRef ?? '').replace(/\s+/g, '').toUpperCase()
    return /^(VN|IS|SG|MY)\d{3,}$/.test(raw) ? raw : null
  })()

  // Some agents (e.g. 30 Sundays) put the IS number in the "Tour Ref" field directly,
  // e.g. "Tour Ref VN40120". If the Tour Ref value is itself a valid IS number, use it.
  const tourRefAsIs: string | null = (() => {
    if (!tourRefOverride) return null
    const raw = tourRefOverride.replace(/\s+/g, '').toUpperCase()
    return /^(VN|IS|SG|MY)\d{3,}$/.test(raw) ? raw : null
  })()

  const resolvedIsNumber = isNumberOverride ?? parsed.isNumber ?? parsedBookingRefAsIs ?? tourRefAsIs ?? null

  return {
    bookingRef:       resolvedIsNumber,
    agentBookingId:   parsed.agentBookingId   ?? null,
    agent:            parsed.agent            ?? null,
    fileHandler:      parsed.fileHandler      ?? null,
    arrivalDate:      parsed.arrivalDate      ?? null,
    departureDate:    parsed.departureDate    ?? null,
    paxAdults:        Number(parsed.paxAdults  ?? 0),
    paxChildren:      Number(parsed.paxChildren ?? 0),
    quotedTotal:      parsed.quotedTotal      ? Number(parsed.quotedTotal) : null,
    currency:         parsed.currency         ?? 'USD',
    terms:            parsed.terms            ?? null,
    exclusions:       parsed.exclusions       ?? null,
    valueAddedServices: (parsed as Record<string, unknown>).valueAddedServices as string | null ?? null,
    packageIncludes:    (parsed as Record<string, unknown>).packageIncludes    as string | null ?? null,
    packageExcludes:    (parsed as Record<string, unknown>).packageExcludes    as string | null ?? null,
    importantNotes:     (parsed as Record<string, unknown>).importantNotes     as string | null ?? null,
    tips:               (parsed as Record<string, unknown>).tips               as string | null ?? null,
    otherNote:          (parsed as Record<string, unknown>).otherNote          as string | null ?? null,
    clientRequest:      (parsed as Record<string, unknown>).clientRequest      as string | null ?? null,
    cntlNumber:       (emailType === 'TOUR_CONFIRMATION'
                        ? extractCntlFromBody(regexText) ?? extractCntlFromBody(emailBody)
                        : null)
                      ?? (tourRefOverride && /^\d+CNTL$/i.test(tourRefOverride) ? tourRefOverride.toUpperCase() : null)
                      ?? (parsed as Record<string, unknown>).cntlNumber as string | null ?? null,
    isNumber:         resolvedIsNumber,
    dealName:         parsed.dealName         ?? null,
    tourDestination:  parsed.tourDestination  ?? null,
    chauffeurContact: parsed.chauffeurContact ?? null,
    languagePreference: parsed.languagePreference ?? null,
    specialOccasions: parsed.specialOccasions ?? null,
    checkedBy:        parsed.checkedBy        ?? null,
    reconfirmBy:      parsed.reconfirmBy      ?? null,
    agentEmail:       parsed.agentEmail       ?? null,
    agentPhone:       parsed.agentPhone       ?? null,
    agentWhatsapp:    parsed.agentWhatsapp    ?? null,
    agentCountry:     parsed.agentCountry     ?? null,
    agentAddress:     parsed.agentAddress     ?? null,
    contactEmail:     parsed.contactEmail     ?? null,
    contactPhone:     parsed.contactPhone     ?? regexPhone ?? null,
    contactWhatsapp:  parsed.contactWhatsapp  ?? regexPhone ?? null,
    contactCountry:   parsed.contactCountry   ?? null,
    contactAddress:   parsed.contactAddress   ?? null,
    passengers: (parsed.passengers ?? []).map((p: Record<string, unknown>) => ({
      name:           String(p.name ?? ''),
      type:           String(p.type ?? 'ADULT'),
      isLead:         Boolean(p.isLead ?? false),
      age:            p.age != null ? Number(p.age) : null,
      passport:       (p.passport as string | null) ?? null,
      nationality:    (p.nationality as string | null) ?? null,
      contact:        (p.contact as string | null) ?? null,
      mealPreference: (p.mealPreference as string | null) ?? null,
    })),
    flights:          parsed.flights          ?? [],
    accommodations:   parsed.accommodations   ?? [],
    itineraryItems:   parsed.itineraryItems   ?? [],
    emergencyContacts: parsed.emergencyContacts ?? [],
    pnlLines:         parsed.pnlLines         ?? [],
  }
}

const IS_PREFIX_RE = /^(VN|IS|SG|MY)\d{3,}$/

function cleanIS(raw: string): string | null {
  const c = raw.replace(/\s+/g, '').toUpperCase()
  return IS_PREFIX_RE.test(c) ? c : null
}

// Extract IS number from explicit labels in the email body.
// Recognises all common formats from 30 Sundays, MakeMyTrip, and other agents.
function extractIsNumberFromBody(text: string): string | null {
  const patterns = [
    // "IS Number: VN40120" / "IS Number VN 40120" / "IS No. VN40120"
    /\bis\s*(?:numb(?:er?)?|no\.?)\s*[:\s=]*([A-Z]{2}\s*\d{3,})/i,
    // "Confirmation Number VN40120" / "Conf No: SG22232" — MakeMyTrip format
    /\bconf(?:irmation)?\s*(?:numb(?:er?)?|no\.?)\s*[:\s=]*([A-Z]{2}\s*\d{3,})/i,
    // "IS : VN40120" — label with colon only (no "Number" word)
    /\bis\s*:\s*([A-Z]{2}\s*\d{4,})/i,
    // Newline-separated table cell: "IS Number\nVN40120" or "IS Number\n VN 40120"
    /\bis\s*(?:numb(?:er?)?|no\.?)\s*[\r\n]+\s*([A-Z]{2}\s*\d{3,})/i,
    // "IS Number VN 40120 No. of Guests" — IS number before "No. of Guests"
    /\bis\s*(?:numb(?:er?)?|no\.?)\s+([A-Z]{2}\s*\d{3,})\s*No\.?\s*of/i,
    // "IS Numbe IS48512" — truncated label (HTML stripping drops trailing "r" from "Number")
    /\bis\s*numbe?\b[^a-zA-Z]{0,20}([A-Z]{2}\d{3,})/i,
    // Broad fallback: "IS Number/Numbe/Numb" label with up to 20 non-letter chars before value
    // Catches HTML-stripped table cells, extra punctuation, unusual whitespace between label and value
    /\bis\s*numb(?:er?)?\b[^a-zA-Z]{0,20}([A-Z]{2}\d{3,})/i,
    // "Booking ref VN40120" / "Booking reference VN40120" — some agents use Booking Ref label
    /\bbooking\s+ref(?:erence)?\s*[:\s=]*([A-Z]{2}\s*\d{4,})/i,
    // Absolute last resort: standalone IS-number-format token in the TC body
    // VN + 5+ digits: safe because VN airline flight numbers use only 3-4 digits (VN815, VN3145)
    // IS/SG/MY + 4+ digits: safe as these prefixes don't match common airline codes
    /\b(VN\d{5,}|IS\d{4,}|SG\d{4,}|MY\d{4,})\b/,
  ]
  for (const re of patterns) {
    const m = text.match(re)
    if (m?.[1]) {
      const v = cleanIS(m[1])
      if (v) return v
    }
  }
  return null
}

// Extract CNTL number from email body.
// Handles: "471416CNTL", "CNTL471416", "Tour Ref 471416 CNTL" (space between digits and CNTL).
function extractCntlFromBody(text: string): string | null {
  const patterns = [
    // "471416CNTL" — digits immediately followed by CNTL
    /\b(\d{4,}CNTL)\b/i,
    // "CNTL471416" — CNTL followed by digits
    /\bCNTL(\d{4,})\b/i,
    // "Tour Ref 471416 CNTL" or "Tour Ref: 471416 CNTL" — space between number and CNTL keyword
    /\btour\s*ref(?:erence)?\s*[:=#-]?\s*(\d{4,})\s+CNTL\b/i,
    // Quotation number patterns
    /\bquot(?:ation)?\s*(?:no\.?|numb(?:er?)?)\s*[:\s=]*(\d{4,}CNTL)\b/i,
    /\bquot(?:ation)?\s*(?:no\.?|numb(?:er?)?)\s*[:\s=]*(\d{4,})\s+CNTL\b/i,
  ]
  for (const re of patterns) {
    const m = text.match(re)
    if (m?.[1]) {
      const v = m[1].replace(/\s+/g, '').toUpperCase()
      // Normalise: if captured group is just digits, append CNTL
      const cntl = /^\d+$/.test(v) ? `${v}CNTL` : v
      if (/^\d+CNTL$/.test(cntl) || /^CNTL\d+$/.test(cntl)) return cntl
    }
  }
  return null
}

// Extract IS number from the email subject line.
// Handles the common forwarded-TC format "// VN20012" at the end of the subject.
function extractIsNumberFromSubject(subject: string): string | null {
  // Split on one or more / or | or — delimiters, check each segment
  const segments = subject.split(/[/|—–-]+/)
  for (const seg of segments) {
    const v = cleanIS(seg.trim())
    if (v) return v
  }
  return null
}

function extractGuestPhoneFromText(text: string): string | null {
  // Match MakeMyTrip / agent-style labels for guest/lead passenger contact numbers
  const patterns = [
    /(?:guest\s+contact\s+number|lead\s+pax\s+contact\s+(?:number|no\.?)|lead\s+passenger\s+contact(?:\s+number)?|customer\s+(?:phone|mobile|contact)(?:\s+number)?)\s*[:\-]?\s*([+\d][\d\s\-().]{6,18}\d)/gi,
  ]

  for (const re of patterns) {
    const match = re.exec(text)
    if (match?.[1]) {
      const raw = match[1].replace(/[\s\-().]/g, '')
      // 10-digit Indian mobile (starts with 6-9) → add +91
      if (/^[6-9]\d{9}$/.test(raw)) return `+91${raw}`
      // Already has country code prefix
      if (raw.startsWith('+') && raw.length >= 10) return raw
      if (/^\d{11,13}$/.test(raw)) return `+${raw}`
    }
  }
  return null
}

function cleanReference(value: string | null | undefined): string | null {
  const cleaned = String(value ?? '').replace(/[^A-Z0-9]/gi, '').toUpperCase()
  return cleaned.length >= 4 ? cleaned : null
}

function extractTourRefFromText(text: string): string | null {
  const match = text.match(/tour\s*ref(?:erence)?\s*[:=#-]?\s*([A-Z0-9][A-Z0-9-]*)/i)
  const ref = cleanReference(match?.[1])
  if (!ref || ref.length < 4) return null
  // Pure numeric values are likely a CNTL number with the "CNTL" suffix split onto a new
  // line by HTML table rendering (e.g. "471416\nCNTL" → captures only "471416").
  // These must NOT become the bookingRef — they go to cntlNumber via extractCntlFromBody.
  if (/^\d+$/.test(ref)) return null
  return ref
}

function extractPnlTourNoFromText(text: string): string | null {
  const match = text.match(/tour\s*no(?:\.|:|=)?\s*#?\s*([A-Z0-9][A-Z0-9-]*)/i)
  if (match?.[1]) return cleanReference(match[1])

  const subjectMatch = text.match(/pnl\s*[:#-]?\s*#?\s*([A-Z0-9][A-Z0-9-]*)/i)
  return cleanReference(subjectMatch?.[1])
}

// ── Microsoft Graph API email reader ─────────────────────────────────────────

export async function getGraphToken(credentialSet: 'default' | 'pnl' = 'default'): Promise<string> {
  let tenantId: string | undefined
  let clientId: string | undefined
  let clientSecret: string | undefined

  if (credentialSet === 'pnl' && process.env.GRAPH_CLIENT_ID && process.env.GRAPH_CLIENT_SECRET) {
    tenantId     = process.env.GRAPH_TENANT_ID ?? process.env.Azure_TENANT_ID
    clientId     = process.env.GRAPH_CLIENT_ID
    clientSecret = process.env.GRAPH_CLIENT_SECRET
  } else {
    tenantId     = process.env.Azure_TENANT_ID
    clientId     = process.env.Azure_CLIENT_ID
    clientSecret = process.env.Azure_CLIENT_SECRET
  }

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

function isPnlMailboxUser(user: string): boolean {
  const pnlUser = process.env.GRAPH_PNL_USER?.trim()
  return !!pnlUser && user === pnlUser
}

interface GraphMessage {
  id: string
  subject?: string
  from?: { emailAddress?: { address?: string; name?: string } }
  toRecipients?: { emailAddress?: { address?: string; name?: string } }[]
  ccRecipients?:  { emailAddress?: { address?: string; name?: string } }[]
  receivedDateTime?: string
  bodyPreview?: string
  body?: { contentType?: string; content?: string }
  isRead?: boolean
  hasAttachments?: boolean
  importance?: string
  conversationId?: string
  parentFolderId?: string
  inferenceClassification?: string
}

interface GraphFolder { id: string; displayName: string }

async function graphGet<T>(token: string, url: string): Promise<T> {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Graph ${res.status}: ${err.slice(0, 300)}`)
  }
  return res.json() as Promise<T>
}

async function graphGetAllPages<T>(token: string, url: string): Promise<T[]> {
  const items: T[] = []
  let nextUrl: string | undefined = url
  while (nextUrl) {
    const page: { value: T[]; '@odata.nextLink'?: string } = await graphGet(token, nextUrl)
    items.push(...(page.value ?? []))
    nextUrl = page['@odata.nextLink']
  }
  return items
}

async function fetchAttachmentsForMessage(token: string, base: string, graphMessageId: string): Promise<EmailAttachment[]> {
  type GraphAttachment = {
    name?: string
    contentType?: string
    size?: number
    contentBytes?: string
    '@odata.type'?: string
  }

  const url = `${base}/messages/${graphMessageId}/attachments?$top=50`

  try {
    const attachments = await graphGetAllPages<GraphAttachment>(token, url)
    return attachments
      .filter(att => (att['@odata.type'] ?? '').includes('fileAttachment') && att.contentBytes)
      .map(att => ({
        name: att.name ?? 'attachment.bin',
        contentType: att.contentType ?? 'application/octet-stream',
        size: att.size ?? 0,
        buffer: Buffer.from(att.contentBytes ?? '', 'base64'),
      }))
  } catch {
    return []
  }
}

async function buildAttachmentText(attachment: EmailAttachment): Promise<string> {
  const fileName = attachment.name.toLowerCase()

  if (fileName.endsWith('.docx') || fileName.endsWith('.doc')) {
    return extractTextFromDocx(attachment.buffer)
  }

  if (fileName.endsWith('.xlsx') || fileName.endsWith('.xls')) {
    return extractTextFromXlsx(attachment.buffer)
  }

  if (fileName.endsWith('.txt') || fileName.endsWith('.csv')) {
    return attachment.buffer.toString('utf-8')
  }

  if (fileName.endsWith('.pdf')) {
    try {
      const result = await pdfParse(attachment.buffer)
      return result.text ?? ''
    } catch { return '' }
  }

  return ''
}

function parseBody(msg: GraphMessage): { text: string; html: string } {
  const content = msg.body?.content ?? ''
  const type = msg.body?.contentType ?? 'text'
  if (type === 'html') {
    // Strip HTML preserving document structure so field labels stay adjacent to their values.
    // Table cells (td/th) close tags → space (keeps "IS Number SG40011" on one line).
    // Block elements (tr/p/div/li/br) → newline (separates rows and paragraphs).
    // This mirrors the clean text produced by docx/XLSX parsers used in OneDrive processing.
    const stripped = content
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/t[dh]\b[^>]*>/gi, ' ')                           // td/th close → space
      .replace(/<\/t[rh]\b[^>]*>|<\/(?:p|div|li|h[1-6])\b[^>]*>/gi, '\n')  // block close → newline
      .replace(/<[^>]+>/g, '')                                       // strip remaining tags
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&#\d+;/g, '')                                        // remove numeric entities (emoji)
      .replace(/&[a-z]{2,8};/gi, ' ')                               // remove other named entities
      .replace(/[ \t]{2,}/g, ' ')                                    // multiple spaces → one
      .replace(/\n[ \t]+/g, '\n')                                    // trim leading spaces after newline
      .replace(/[ \t]+\n/g, '\n')                                    // trim trailing spaces before newline
      .replace(/\n{3,}/g, '\n\n')                                    // max 2 consecutive newlines
      .trim()
    return { text: stripped, html: content }
  }
  return { text: content, html: '' }
}

export async function fetchUnprocessedEmails(
  limit = 50,
  folder: 'inbox' | 'all' = 'all',
): Promise<ProcessedEmail[]> {
  const user = process.env.Outlookmail_USERNAME
  if (!user) throw new Error('Outlookmail_USERNAME not set')

  return fetchUnprocessedEmailsForUser(user, limit, folder)
}

export async function fetchUnprocessedEmailsForUser(
  user: string,
  limit = 50,
  folder: 'inbox' | 'all' = 'all',
  options?: { since?: string },
): Promise<ProcessedEmail[]> {
  if (!user) throw new Error('Mailbox user not set')

  const token = await getGraphToken(isPnlMailboxUser(user) ? 'pnl' : 'default')
  const base  = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(user)}`
  const select = 'id,subject,from,toRecipients,ccRecipients,receivedDateTime,body,bodyPreview,isRead,hasAttachments,importance,conversationId,parentFolderId,inferenceClassification'

  // Build folder ID → name map
  const folderMap = new Map<string, string>()
  if (folder === 'all') {
    try {
      const folders = await graphGetAllPages<GraphFolder>(token, `${base}/mailFolders?$top=50`)
      folders.forEach(f => folderMap.set(f.id, f.displayName))
      // Also fetch child folders
      for (const f of folders) {
        try {
          const children = await graphGetAllPages<GraphFolder>(token, `${base}/mailFolders/${f.id}/childFolders?$top=50`)
          children.forEach(c => folderMap.set(c.id, `${f.displayName} / ${c.displayName}`))
        } catch { /* skip */ }
      }
    } catch { /* folder map is optional */ }
  }

  const filter = options?.since
    ? `&$filter=${encodeURIComponent(`receivedDateTime ge ${options.since}`)}`
    : ''
  const url = folder === 'inbox'
    ? `${base}/mailFolders/inbox/messages?$top=${Math.min(limit, 999)}&$orderby=receivedDateTime desc&$select=${select}${filter}`
    : `${base}/messages?$top=${Math.min(limit, 999)}&$orderby=receivedDateTime desc&$select=${select}${filter}`

  const messages = await graphGetAllPages<GraphMessage>(token, url)
  const limited  = messages.slice(0, limit)

  // Mailbox identity is the authoritative source of email type —
  // content-based detection is unreliable (TQ bodies contain PNL keywords like "transport"/"is number")
  const tqUser  = (process.env.Outlookmail_USERNAME ?? '').trim()
  const pnlUser = (process.env.GRAPH_PNL_USER ?? '').trim()
  const forcedType: ProcessedEmail['type'] | null =
    user === tqUser  && tqUser  ? 'TOUR_CONFIRMATION' :
    user === pnlUser && pnlUser ? 'PNL'               : null

  const results: ProcessedEmail[] = limited.map((msg, i) => {
    const { text, html } = parseBody(msg)
    const subject  = msg.subject ?? ''
    const bodyText = text || msg.bodyPreview || ''

    return {
      uid:            i + 1,
      graphId:        msg.id,
      subject,
      from:           msg.from?.emailAddress?.address ?? '',
      fromName:       msg.from?.emailAddress?.name ?? '',
      to:             (msg.toRecipients ?? []).map(r => r.emailAddress?.address ?? '').filter(Boolean),
      cc:             (msg.ccRecipients  ?? []).map(r => r.emailAddress?.address ?? '').filter(Boolean),
      date:           msg.receivedDateTime ?? new Date().toISOString(),
      type:           forcedType ?? detectEmailType(subject, bodyText),
      rawBody:        bodyText.slice(0, 30000),
      bodyHtml:       html.slice(0, 100000),
      folder:         folderMap.get(msg.parentFolderId ?? '') ?? (msg.inferenceClassification === 'focused' ? 'Focused' : 'Inbox'),
      isRead:         msg.isRead ?? true,
      hasAttachments: msg.hasAttachments ?? false,
      importance:     msg.importance ?? 'normal',
      conversationId: msg.conversationId ?? '',
      parsed:         null,
    }
  })

  return results
}

// Fetch a single message by Graph message ID (used by webhook)
export async function fetchMessageById(graphMessageId: string): Promise<ProcessedEmail | null> {
  const user = process.env.Outlookmail_USERNAME
  if (!user) return null

  return fetchMessageByIdForUser(user, graphMessageId)
}

export async function fetchMessageByIdForUser(
  user: string,
  graphMessageId: string,
): Promise<ProcessedEmail | null> {
  if (!user) return null

  const token = await getGraphToken(isPnlMailboxUser(user) ? 'pnl' : 'default')
  const select = 'id,subject,from,toRecipients,ccRecipients,receivedDateTime,body,bodyPreview,isRead,hasAttachments,importance,conversationId,parentFolderId,inferenceClassification'
  const url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(user)}/messages/${graphMessageId}?$select=${select}`

  try {
    const msg: GraphMessage = await graphGet(token, url)
    const { text, html } = parseBody(msg)
    const subject = msg.subject ?? ''
    const bodyText = text || msg.bodyPreview || ''

    return {
      uid:            0,
      graphId:        msg.id,
      subject,
      from:           msg.from?.emailAddress?.address ?? '',
      fromName:       msg.from?.emailAddress?.name ?? '',
      to:             (msg.toRecipients ?? []).map(r => r.emailAddress?.address ?? '').filter(Boolean),
      cc:             (msg.ccRecipients  ?? []).map(r => r.emailAddress?.address ?? '').filter(Boolean),
      date:           msg.receivedDateTime ?? new Date().toISOString(),
      type:           detectEmailType(subject, bodyText),
      rawBody:        bodyText.slice(0, 30000),
      bodyHtml:       html.slice(0, 100000),
      folder:         'Inbox',
      isRead:         msg.isRead ?? false,
      hasAttachments: msg.hasAttachments ?? false,
      importance:     msg.importance ?? 'normal',
      conversationId: msg.conversationId ?? '',
      parsed:         null,
    }
  } catch {
    return null
  }
}

export async function fetchMessageAttachmentsForUser(
  user: string,
  graphMessageId: string,
): Promise<EmailAttachment[]> {
  if (!user) return []

  // IMAP emails use a synthetic "imap2_<uid>" graphId — route to IMAP fetcher
  if (graphMessageId.startsWith('imap2_')) {
    const { fetchImapAttachments } = await import('@/lib/imap-pnl')
    return fetchImapAttachments(graphMessageId)
  }

  const token = await getGraphToken(isPnlMailboxUser(user) ? 'pnl' : 'default')
  const base  = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(user)}`
  return fetchAttachmentsForMessage(token, base, graphMessageId)
}

export async function extractEmailSourceTextForUser(
  user: string,
  email: ProcessedEmail,
): Promise<{ rawText: string; attachments: EmailAttachment[] }> {
  const attachments = email.hasAttachments
    ? await fetchMessageAttachmentsForUser(user, email.graphId)
    : []

  const supportedTexts = await Promise.all(attachments.map(buildAttachmentText))
  const attachmentText = supportedTexts.filter(Boolean).join('\n\n')

  // For TC emails that have a docx/pdf attachment: put the attachment text FIRST so
  // extractTCSection and all regex functions find the clean document content before
  // the noisy email thread (quoted replies, signatures, etc.).
  // This mirrors how OneDrive processing works — it reads the TC.docx directly.
  const hasTCDoc = email.type === 'TOUR_CONFIRMATION'
    && attachmentText.trim().length > 200
    && attachments.some(a => /\.(docx?|pdf)$/i.test(a.name))

  return {
    rawText: hasTCDoc
      ? [attachmentText, email.rawBody].filter(Boolean).join('\n\n')
      : [email.rawBody, attachmentText].filter(Boolean).join('\n\n'),
    attachments,
  }
}

// ── Webhook subscription — DB-persisted, multi-mailbox ───────────────────────

import { prisma } from '@/lib/prisma'

async function dbGet(key: string): Promise<string | null> {
  try {
    const row = await prisma.systemSetting.findUnique({ where: { key } })
    return row?.value ?? null
  } catch { return null }
}

async function dbSet(key: string, value: string) {
  await prisma.systemSetting.upsert({
    where:  { key },
    update: { value },
    create: { key, value },
  })
}

function notificationUrl(): string {
  const raw = (process.env.APP_URL ?? process.env.NEXTAUTH_URL ?? '').replace(/\/+$/, '')
  return `${raw.replace(/^http:\/\//i, 'https://')}/api/mail/webhook`
}

// Per-user DB key helpers
function skSubId(user: string)     { return `webhook_sub_id_${user}` }
function skSubExpiry(user: string) { return `webhook_sub_expiry_${user}` }
function skSubUser(subId: string)  { return `webhook_sub_user_${subId}` }
function skSubKind(subId: string)  { return `webhook_sub_kind_${subId}` }

async function ensureWebhookSubscriptionForUser(
  user: string,
  kind: MailboxKind,
  token: string,
  url: string,
  secret: string,
): Promise<string> {
  const savedId      = await dbGet(skSubId(user))
  const savedExpiry  = await dbGet(skSubExpiry(user))
  const now          = new Date()
  const nextExpiry   = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000)

  if (savedId && savedExpiry && new Date(savedExpiry) > now) {
    const r = await fetch(`https://graph.microsoft.com/v1.0/subscriptions/${savedId}`, {
      method:  'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify({ expirationDateTime: nextExpiry.toISOString() }),
    })
    if (r.ok) {
      await dbSet(skSubExpiry(user), nextExpiry.toISOString())
      console.log(`[Webhook] renewed ${kind} subscription for ${user}:`, savedId)
      return savedId
    }
    console.warn(`[Webhook] PATCH failed for ${user} (${r.status}), recreating`)
  }

  const res = await fetch('https://graph.microsoft.com/v1.0/subscriptions', {
    method:  'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      changeType:         'created',
      notificationUrl:    url,
      resource:           `users/${user}/mailFolders/inbox/messages`,
      expirationDateTime: nextExpiry.toISOString(),
      clientState:        secret,
    }),
  })

  const json = await res.json() as { id?: string; error?: { message?: string; code?: string } }
  if (!json.id) {
    throw new Error(
      `Subscription failed for ${user} [url: ${url}]: ` +
      (json.error?.message ?? JSON.stringify(json)),
    )
  }

  await Promise.all([
    dbSet(skSubId(user),      json.id),
    dbSet(skSubExpiry(user),  nextExpiry.toISOString()),
    dbSet(skSubUser(json.id), user),
    dbSet(skSubKind(json.id), kind),
  ])

  console.log(`[Webhook] created ${kind} subscription for ${user}:`, json.id)
  return json.id
}

// Subscribe all configured mailboxes and return their subscription IDs
export async function ensureAllWebhookSubscriptions(): Promise<string[]> {
  const url       = notificationUrl()
  const secret    = process.env.WEBHOOK_SECRET ?? 'aahaas-webhook-secret'
  const mailboxes = getConfiguredMailboxes()

  const ids: string[] = []
  for (const mb of mailboxes) {
    try {
      const mbToken = await getGraphToken(isPnlMailboxUser(mb.user) ? 'pnl' : 'default')
      const id = await ensureWebhookSubscriptionForUser(mb.user, mb.kind, mbToken, url, secret)
      ids.push(id)
    } catch (err) {
      console.error(`[Webhook] subscription failed for ${mb.user}:`, err instanceof Error ? err.message : err)
    }
  }
  return ids
}

// Look up which mailbox user+kind a subscription ID belongs to
export async function lookupSubscription(subscriptionId: string): Promise<{ user: string; kind: MailboxKind } | null> {
  const [user, kind] = await Promise.all([
    dbGet(skSubUser(subscriptionId)),
    dbGet(skSubKind(subscriptionId)),
  ])
  if (!user || !kind) return null
  return { user, kind: kind as MailboxKind }
}

// Backward-compat: subscribe only the TQ mailbox
export async function ensureWebhookSubscription(): Promise<string> {
  const url    = notificationUrl()
  const secret = process.env.WEBHOOK_SECRET ?? 'aahaas-webhook-secret'
  const token  = await getGraphToken()
  const tqUser = process.env.Outlookmail_USERNAME
  if (!tqUser) throw new Error('Outlookmail_USERNAME not set')
  return ensureWebhookSubscriptionForUser(tqUser, 'TOUR_CONFIRMATION', token, url, secret)
}

export async function getSubscriptionStatus(): Promise<{
  active: boolean
  id: string | null
  expiry: string | null
  url: string
  mailboxes: Array<{ user: string; kind: MailboxKind; active: boolean; id: string | null; expiry: string | null; source?: string }>
}> {
  const url      = notificationUrl()
  const now      = new Date()
  const mailboxes = getConfiguredMailboxes()

  const statuses = await Promise.all(mailboxes.map(async mb => {
    const id        = await dbGet(skSubId(mb.user))
    const expiryStr = await dbGet(skSubExpiry(mb.user))
    const expiry    = expiryStr ? new Date(expiryStr) : null
    return { user: mb.user, kind: mb.kind, active: !!(id && expiry && expiry > now), id: id ?? null, expiry: expiryStr ?? null, source: 'graph' as 'graph' | 'imap' }
  }))

  const primary = statuses[0]
  return {
    active:    statuses.some(s => s.active),
    id:        primary?.id ?? null,
    expiry:    primary?.expiry ?? null,
    url,
    mailboxes: statuses,
  }
}

// Called on startup and by cron — silently registers/renews all mailboxes
export async function autoSubscribe(): Promise<void> {
  const url = notificationUrl()
  if (url.includes('localhost') || url.includes('127.0.0.1')) return
  try {
    await ensureAllWebhookSubscriptions()
  } catch (err) {
    console.error('[Webhook] auto-subscribe failed:', err instanceof Error ? err.message : err)
  }
}
