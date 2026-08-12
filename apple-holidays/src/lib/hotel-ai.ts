/**
 * AI hotel-contact research.
 *
 * When a hotel on a booking is not in the Accounts master list — or is there
 * but with no phone number — staff would otherwise go hunting through Google.
 * This asks GPT with live web search for the property's official contact
 * details and returns them as strict JSON for review.
 *
 * The result is a *suggestion*, never truth. Everything it returns arrives in
 * the UI unsaved, with its sources attached, and a human decides what to keep.
 * Numbers it infers rather than reads (a mobile line implying WhatsApp) are
 * flagged `guessed` so nobody mistakes a heuristic for a verified desk line.
 */
import openai, { logAiUsage } from './openai'
import { normalizePhone, inferWhatsapp, type NormalizedPhone } from './hotel-contact'

const SEARCH_MODEL = process.env.OPENAI_SEARCH_MODEL || 'gpt-4o'

export interface AiHotelPhone {
  label: string
  value: string
  e164: string | null
  isMobile: boolean
  isWhatsapp: boolean
  guessed: boolean
}

export interface AiHotelResult {
  officialName: string | null
  city: string | null
  country: string | null
  address: string | null
  website: string | null
  email: string | null
  googleMapsUrl: string | null
  phones: AiHotelPhone[]
  whatsapp: string | null
  whatsappGuessed: boolean
  /** The model's own 0–100 confidence that it found the right property. */
  confidence: number
  /** Source URLs the model cited. */
  sources: string[]
  /** Anything the model wants to flag — closed property, renamed, ambiguous. */
  note: string | null
  /** Raw model text, kept for audit. */
  raw: string
}

const PROMPT = `You are a travel-operations research assistant for Apple Holidays.

Find the OFFICIAL contact details of the hotel described by the user, using live web search.
Prefer, in order: the hotel's own website, its Google Business listing, and major OTA
listings (Booking.com, Agoda, TripAdvisor). Ignore aggregator spam and phone-directory
scrapers.

Rules:
- Only report details you actually saw on a source. Never invent a phone number.
- Report phone numbers in full international format with the country code.
- If you find a dedicated WhatsApp / mobile reservations number, report it separately.
- If you cannot confidently identify the property, set confidence below 50 and explain
  in "note" (e.g. several properties share this name, or the hotel appears closed).

Reply with ONLY a JSON object, no markdown fence, in exactly this shape:
{
  "officialName": string|null,
  "city": string|null,
  "country": string|null,
  "address": string|null,
  "website": string|null,
  "email": string|null,
  "googleMapsUrl": string|null,
  "phones": [{ "label": string, "number": string }],
  "whatsapp": string|null,
  "confidence": number,
  "sources": [string],
  "note": string|null
}`

/** Pull the first JSON object out of a model reply that may be fenced or chatty. */
function parseJsonBlock(text: string): Record<string, unknown> | null {
  const cleaned = text.replace(/^```(?:json)?/gm, '').replace(/```$/gm, '').trim()
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start === -1 || end <= start) return null
  try {
    return JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>
  } catch {
    return null
  }
}

function str(v: unknown): string | null {
  const s = typeof v === 'string' ? v.trim() : ''
  return s ? s : null
}

/**
 * Research one hotel's contact details.
 *
 * `countryCode` drives phone normalisation — a Sri Lankan "077 123 4567" and a
 * Vietnamese one normalise to entirely different E.164 numbers, so the caller
 * must pass the operating country rather than let the model guess it.
 */
export async function researchHotelContacts(opts: {
  hotelName: string
  city?: string | null
  country?: string | null
  countryCode?: string
  bookingRef?: string | null
}): Promise<AiHotelResult> {
  const cc = opts.countryCode ?? 'LK'
  const where = [opts.city, opts.country].filter(Boolean).join(', ')
  const query = `Hotel: "${opts.hotelName}"${where ? ` in ${where}` : ''}.`

  const res = await openai.responses.create({
    model: SEARCH_MODEL,
    tools: [{ type: 'web_search_preview' }],
    input: `${PROMPT}\n\n${query}`,
    // The Responses API typings in this SDK version do not cover the preview
    // web-search tool; the same cast is used by fetchDestinationImageFromWeb.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyRes = res as any
  const raw: string = anyRes.output_text ?? ''

  await logAiUsage({
    callType: 'hotel_contact_research',
    model: SEARCH_MODEL,
    usage: anyRes.usage
      ? {
          prompt_tokens:     anyRes.usage.input_tokens ?? 0,
          completion_tokens: anyRes.usage.output_tokens ?? 0,
          total_tokens:      anyRes.usage.total_tokens ?? 0,
        }
      : null,
    bookingRef: opts.bookingRef ?? null,
    source: 'precheck',
  })

  const parsed = parseJsonBlock(raw)
  if (!parsed) {
    throw new Error('The AI reply could not be read as JSON. Try again, or add the details manually.')
  }

  // ── Phones
  const rawPhones = Array.isArray(parsed.phones) ? parsed.phones : []
  const seen = new Set<string>()
  const phones: AiHotelPhone[] = []

  for (const p of rawPhones) {
    const entry = p as Record<string, unknown>
    const value = str(entry.number) ?? str(entry.value)
    if (!value) continue
    const n: NormalizedPhone = normalizePhone(value, cc)
    const dedupeKey = n.e164 ?? value.replace(/\D/g, '')
    if (seen.has(dedupeKey)) continue
    seen.add(dedupeKey)
    phones.push({
      label: str(entry.label) ?? 'Phone',
      value,
      e164: n.e164,
      isMobile: n.isMobile,
      isWhatsapp: false,
      guessed: false,
    })
  }

  // ── WhatsApp: reported outright, else inferred from a mobile line.
  const reportedWa = str(parsed.whatsapp)
  let whatsapp: string | null = null
  let whatsappGuessed = false

  if (reportedWa) {
    whatsapp = normalizePhone(reportedWa, cc).e164 ?? reportedWa
  } else {
    const inferred = inferWhatsapp(phones.map(p => p.e164 ?? p.value), cc)
    if (inferred) { whatsapp = inferred.e164; whatsappGuessed = true }
  }
  if (whatsapp) {
    const hit = phones.find(p => p.e164 === whatsapp)
    if (hit) { hit.isWhatsapp = true; hit.guessed = whatsappGuessed }
  }

  const sources = Array.isArray(parsed.sources)
    ? parsed.sources.map(s => str(s)).filter((s): s is string => !!s)
    : []

  const confidenceRaw = Number(parsed.confidence)

  return {
    officialName:  str(parsed.officialName),
    city:          str(parsed.city),
    country:       str(parsed.country),
    address:       str(parsed.address),
    website:       str(parsed.website),
    email:         str(parsed.email),
    googleMapsUrl: str(parsed.googleMapsUrl),
    phones,
    whatsapp,
    whatsappGuessed,
    confidence: Number.isFinite(confidenceRaw) ? Math.max(0, Math.min(100, confidenceRaw)) : 0,
    sources,
    note: str(parsed.note),
    raw,
  }
}
