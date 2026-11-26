/**
 * B2C destination resolver — where a store order really goes.
 *
 * The store never records a destination for an order, and its per-line places
 * are unreliable: hotel ids used to be read as lifestyle ids (Vietnam order
 * 16404 became "Negombo, Sri Lanka"), Ratehawk hotels carry no city, some
 * contracted hotels store a street as their city, and a trip that starts with
 * a one-night stopover was filed under the stopover.
 *
 * So every signal on the order is gathered into one evidence pack (products,
 * line labels, hotel addresses, Ratehawk regions, chauffeur legs, flight
 * airports), scored deterministically, and handed to the model, which returns
 * the trip as an ordered list of stops with a city for every day and every
 * line. The answer is then checked against the evidence before anything uses it:
 *
 *  - the country must be one the order actually shows signs of;
 *  - a city the gazetteer knows must belong to the country it was given;
 *  - line / day references must exist; dates must lie inside the trip;
 *  - confidence must clear {@link MIN_CONFIDENCE}.
 *
 * Any failure — no API key, network, bad JSON, a rejected answer — yields
 * `{ ok: false }` and the caller leaves the destination EMPTY. A wrong
 * destination routes a file to the wrong country team; an empty one is
 * visible and gets fixed.
 *
 * The validated plan is saved per booking (`system_settings`
 * `b2c_destination:{ref}`) so hotel placement and agenda generation use the
 * same answer without calling the model again.
 */
import openai, { logAiUsage } from './openai'
import { prisma } from './prisma'
import { describeRoute, type ParsedFlightBooking } from './b2c-flight'
import type { B2cOrderProduct, B2cTransportLeg } from './b2c-db'
import { operationCountryFromAirportCode, operationCountryFromIso, operationCountryFromText } from './b2c-country'
import { cleanCity, looksLikeStreet } from './b2c-hotel-place'
import { place } from './ops-geo'

// ─── Types ────────────────────────────────────────────────────────────────────

export type DestCountry = 'VIETNAM' | 'SRILANKA' | 'SINGAPORE' | 'MALAYSIA'
const DEST_COUNTRIES: readonly DestCountry[] = ['VIETNAM', 'SRILANKA', 'SINGAPORE', 'MALAYSIA']
const COUNTRY_LABEL: Record<DestCountry, string> = {
  VIETNAM: 'Vietnam', SRILANKA: 'Sri Lanka', SINGAPORE: 'Singapore', MALAYSIA: 'Malaysia',
}

export interface EvidenceLine {
  /** `L{checkouts_more_data.id}` or `T{leg_id}` — what the model answers with. */
  ref: string
  kind: 'hotel' | 'activity' | 'education' | 'flight' | 'transport'
  date: string | null
  name: string
  label?: string
  time?: string
  location?: string
  storeCountry?: string
  storeCity?: string
  address?: string
  supplier?: string
  route?: string
}

export interface DestinationEvidence {
  orderId: number
  arrival: string | null
  departure: string | null
  lines: EvidenceLine[]
  flights: { route: string; from: string | null; to: string | null }[]
  /** Deterministic pre-score: country → weight. Hotels weigh most. */
  countryVotes: Partial<Record<DestCountry, number>>
}

export interface DestinationStop {
  city: string
  country: DestCountry | null
  from: string | null
  to: string | null
  nights: number | null
}

export interface DestinationPlan {
  operationCountry: DestCountry | null
  /** Human text for `Booking.tourDestination`: "Hanoi, Da Nang & Ho Chi Minh City". */
  tourDestination: string | null
  primaryCity: string | null
  stops: DestinationStop[]
  dayCities: { date: string; city: string }[]
  lineCities: { ref: string; city: string; country: DestCountry | null }[]
  /** Store data the model judged wrong — shown to staff, never acted on silently. */
  conflicts: { ref: string; issue: string }[]
  confidence: number
  reasoning: string
  model: string
}

export type DestinationOutcome =
  | { ok: true; plan: DestinationPlan; evidence: DestinationEvidence }
  | { ok: false; reason: string; evidence: DestinationEvidence | null }

const MODEL = 'gpt-4o'
const MIN_CONFIDENCE = 0.5
const MAX_LINES = 80
const SETTING_PREFIX = 'b2c_destination:'

// ─── Evidence ─────────────────────────────────────────────────────────────────

const clip = (v: unknown, n = 160): string | undefined => {
  const s = String(v ?? '').replace(/\s+/g, ' ').trim()
  return s ? s.slice(0, n) : undefined
}
const ymd = (v: unknown): string | null => {
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(v ?? ''))
  return m ? m[1] : null
}
const KIND: Record<number, EvidenceLine['kind']> = { 3: 'activity', 4: 'hotel', 5: 'education', 6: 'flight' }
const WEIGHT: Record<EvidenceLine['kind'], number> = { hotel: 3, activity: 1, education: 1, transport: 1, flight: 2 }

export function buildDestinationEvidence(input: {
  orderId: number
  arrival?: string | null
  departure?: string | null
  products: B2cOrderProduct[]
  transportLegs?: B2cTransportLeg[]
  flights?: ParsedFlightBooking[]
}): DestinationEvidence {
  const lines: EvidenceLine[] = []
  for (const p of input.products) {
    const kind = KIND[Number(p.category_id)] ?? 'activity'
    if (kind === 'flight') continue // described from the parsed ticket below
    lines.push({
      ref: `L${p.id}`,
      kind,
      date: ymd(p.service_date),
      name: clip(p.product_name) ?? clip(p.sku) ?? `Line ${p.id}`,
      label: clip(p.line_label),
      time: clip(p.time_slot, 40),
      location: clip(p.service_location, 80),
      storeCountry: clip(p.product_country, 20),
      storeCity: clip(p.product_city, 60),
      address: clip(p.hotel_address, 200),
      supplier: clip(p.provider, 30),
    })
  }
  for (const l of input.transportLegs ?? []) {
    lines.push({
      ref: `T${l.leg_id}`,
      kind: 'transport',
      date: ymd(l.travel_date),
      name: `${clip(l.kind, 20) ?? 'transfer'} transfer`,
      route: `${clip(l.from_label, 100) ?? '?'} → ${clip(l.to_label, 100) ?? '?'}`,
    })
  }
  const flights = (input.flights ?? []).map((f) => ({
    route: describeRoute(f) ?? '',
    from: f.originCode,
    to: f.destinationCode,
  })).filter((f) => f.route)

  // Deterministic votes. The store country is trusted least for hotels with a
  // product row (the id-collision bug); text and addresses count as well.
  const countryVotes: Partial<Record<DestCountry, number>> = {}
  const vote = (c: string | null, w: number) => {
    if (c && (DEST_COUNTRIES as readonly string[]).includes(c)) {
      countryVotes[c as DestCountry] = (countryVotes[c as DestCountry] ?? 0) + w
    }
  }
  for (const l of lines) {
    const w = WEIGHT[l.kind]
    vote(operationCountryFromIso(l.storeCountry), w)
    vote(operationCountryFromText(l.name, l.label, l.location, l.address, l.route), w)
  }
  for (const f of flights) vote(operationCountryFromAirportCode(f.to), WEIGHT.flight)

  return {
    orderId: input.orderId,
    arrival: input.arrival ?? null,
    departure: input.departure ?? null,
    lines: lines.slice(0, MAX_LINES),
    flights,
    countryVotes,
  }
}

// ─── Model call ───────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are the destination analyst for a travel operations company with ground teams in
VIETNAM, SRILANKA, SINGAPORE and MALAYSIA. You receive every line of one customer order from
an online travel store and must work out WHERE THE TRIP ACTUALLY GOES.

The store's own place fields (storeCountry, storeCity) are frequently WRONG:
 - a hotel's storeCity/storeCountry may belong to an unrelated product with the same id
   (e.g. a Hanoi hotel labelled "Negombo, LK");
 - some hotels have a street as their city, or no city at all;
 - "location" may be empty or a pickup area.
Trust, in this order: hotel addresses and hotel names; product names and labels that name
places ("Hanoi Night Food Tour", "Danang Airport to Hotel"); transfer routes; flight airport
codes (HAN, DAD, SGN, CMB, SIN, KUL…); and only then storeCity/storeCountry. When signals
disagree, the majority of the trip (hotel nights first) wins, and you report the outlier
in "conflicts".

Return ONLY a JSON object with exactly these keys:
{
  "operationCountry": "VIETNAM" | "SRILANKA" | "SINGAPORE" | "MALAYSIA" | "NONE",
  "stops": [ { "city": "Hanoi", "countryIso": "VN", "from": "YYYY-MM-DD", "to": "YYYY-MM-DD", "nights": 2 } ],
  "primaryCity": "the city with the most nights",
  "dayCities": [ { "date": "YYYY-MM-DD", "city": "Hanoi" } ],
  "lineCities": [ { "ref": "L123", "city": "Da Nang", "countryIso": "VN" } ],
  "conflicts": [ { "ref": "L123", "issue": "storeCity says Negombo but the hotel address is in Hanoi" } ],
  "confidence": 0.0-1.0,
  "reasoning": "one or two sentences"
}

Rules:
 - operationCountry = the country where most of the trip takes place, among the four.
   "NONE" when the trip is entirely outside them. Never guess a country the lines do not support.
 - stops: the cities stayed in / visited, in travel order, with the dates spent there. Use the
   common English city name ("Ho Chi Minh City", not a street, ward or district; "Da Nang" not
   "Hai Chau"). Day trips from a base (Ninh Binh from Hanoi, Ba Na Hills from Da Nang) do NOT
   become stops — the base city stays the stop.
 - dayCities: one entry per date from arrival to departure inclusive — the city the guest is
   based in that day; on a moving day, the city they arrive in.
 - lineCities: one entry for EVERY line ref given — the city where that service happens
   (for a hotel: the city the hotel is in; for a transfer: its destination city).
 - Use only places supported by the data. If you genuinely cannot tell, lower "confidence".`

/** Ask the model. Never throws — every failure becomes `{ ok: false }`. */
export async function resolveDestinationWithAI(
  evidence: DestinationEvidence,
  opts: { bookingRef?: string | null } = {},
): Promise<DestinationOutcome> {
  if (evidence.lines.length === 0 && evidence.flights.length === 0) {
    return { ok: false, reason: 'no order lines to analyse', evidence }
  }
  try {
    const response = await openai.chat.completions.create(
      {
        model: MODEL,
        temperature: 0,
        max_tokens: 3000,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          {
            role: 'user',
            content: `Order ${evidence.orderId}. Trip ${evidence.arrival ?? '?'} → ${evidence.departure ?? '?'}.\n` +
              `Deterministic country score (hint only, may be wrong): ${JSON.stringify(evidence.countryVotes)}\n\n` +
              `=== lines ===\n${JSON.stringify(evidence.lines)}\n\n=== flights ===\n${JSON.stringify(evidence.flights)}`,
          },
        ],
      },
      { timeout: 60_000 },
    )
    await logAiUsage({
      callType: 'b2c-destination',
      model: response.model || MODEL,
      usage: response.usage,
      bookingRef: opts.bookingRef ?? String(evidence.orderId),
      source: 'b2c-destination-ai',
    }).catch(() => { /* usage logging never blocks */ })

    if (response.choices[0]?.finish_reason === 'length') {
      return { ok: false, reason: 'AI answer was cut off', evidence }
    }
    const raw = response.choices[0]?.message?.content
    if (!raw) return { ok: false, reason: 'AI returned an empty answer', evidence }
    let parsed: unknown
    try { parsed = JSON.parse(raw) } catch { return { ok: false, reason: 'AI answer was not valid JSON', evidence } }
    return validatePlan(parsed, evidence, response.model || MODEL)
  } catch (err) {
    return { ok: false, reason: `AI call failed: ${err instanceof Error ? err.message : String(err)}`, evidence }
  }
}

// ─── Validation ───────────────────────────────────────────────────────────────

const normKey = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd')
  .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

function toCountry(raw: unknown): DestCountry | null {
  const s = String(raw ?? '').trim().toUpperCase()
  if ((DEST_COUNTRIES as readonly string[]).includes(s)) return s as DestCountry
  return operationCountryFromIso(s) as DestCountry | null
}

/** A city string the model returned, or null when it is not usable as a city. */
function cityOf(raw: unknown): string | null {
  const s = String(raw ?? '').replace(/\s+/g, ' ').trim()
  if (!s || s.length > 60 || looksLikeStreet(s)) return null
  return cleanCity(s)
}

/** The gazetteer's country for an exact city name, when it knows the city. */
function knownCountry(city: string): DestCountry | null {
  const hit = place(city)
  return hit && normKey(hit.name) === normKey(city) ? (hit.country as DestCountry) : null
}

/** "Hanoi", "Hanoi & Da Nang", "Hanoi, Da Nang & Ho Chi Minh City". */
export function formatDestination(cities: string[]): string | null {
  const unique: string[] = []
  for (const c of cities) if (c && !unique.some((u) => normKey(u) === normKey(c))) unique.push(c)
  if (unique.length === 0) return null
  const text = unique.length === 1 ? unique[0]
    : `${unique.slice(0, -1).join(', ')} & ${unique[unique.length - 1]}`
  return text.slice(0, 191)
}

export function validatePlan(raw: unknown, evidence: DestinationEvidence, model: string): DestinationOutcome {
  const fail = (reason: string): DestinationOutcome => ({ ok: false, reason, evidence })
  if (!raw || typeof raw !== 'object') return fail('AI answer is not an object')
  const r = raw as Record<string, any>

  const confidence = Math.max(0, Math.min(1, Number(r.confidence)))
  if (!Number.isFinite(confidence) || confidence < MIN_CONFIDENCE) {
    return fail(`AI confidence too low (${Number.isFinite(confidence) ? confidence.toFixed(2) : 'none'})`)
  }

  const country = String(r.operationCountry ?? '').toUpperCase() === 'NONE' ? null : toCountry(r.operationCountry)
  // Hallucination guard: the chosen country must have support in the order.
  const allText = normKey(JSON.stringify(evidence.lines) + JSON.stringify(evidence.flights))
  if (country) {
    const voted = (evidence.countryVotes[country] ?? 0) > 0
    const named = allText.includes(normKey(COUNTRY_LABEL[country]))
    if (!voted && !named) return fail(`AI chose ${country} but no line of the order points there`)
  }

  const inTrip = (d: unknown): string | null => {
    const v = ymd(d)
    if (!v) return null
    if (evidence.arrival && v < shift(evidence.arrival, -1)) return null
    if (evidence.departure && v > shift(evidence.departure, 1)) return null
    return v
  }

  const conflicts: DestinationPlan['conflicts'] = []
  const stops: DestinationStop[] = []
  for (const s of Array.isArray(r.stops) ? r.stops : []) {
    const city = cityOf(s?.city)
    if (!city) continue
    let stopCountry = toCountry(s?.countryIso)
    const gaz = knownCountry(city)
    if (gaz && stopCountry && gaz !== stopCountry) {
      conflicts.push({ ref: '-', issue: `AI placed ${city} in ${stopCountry}; it is in ${gaz} — corrected` })
      stopCountry = gaz
    }
    const nights = Number(s?.nights)
    stops.push({
      city,
      country: stopCountry ?? gaz,
      from: inTrip(s?.from),
      to: inTrip(s?.to),
      nights: Number.isFinite(nights) && nights >= 0 && nights < 60 ? Math.round(nights) : null,
    })
  }
  if (stops.length === 0) return fail('AI returned no usable cities')
  // A trip filed under a country must actually stop there.
  if (country && !stops.some((s) => s.country === country || s.country === null)) {
    return fail(`AI country ${country} matches none of its own stops`)
  }

  const refs = new Set(evidence.lines.map((l) => l.ref))
  const lineCities: DestinationPlan['lineCities'] = []
  for (const l of Array.isArray(r.lineCities) ? r.lineCities : []) {
    const ref = String(l?.ref ?? '')
    const city = cityOf(l?.city)
    if (!refs.has(ref) || !city || lineCities.some((x) => x.ref === ref)) continue
    lineCities.push({ ref, city, country: knownCountry(city) ?? toCountry(l?.countryIso) })
  }

  const dayCities: DestinationPlan['dayCities'] = []
  for (const d of Array.isArray(r.dayCities) ? r.dayCities : []) {
    const date = inTrip(d?.date)
    const city = cityOf(d?.city)
    if (date && city && !dayCities.some((x) => x.date === date)) dayCities.push({ date, city })
  }
  dayCities.sort((a, b) => a.date.localeCompare(b.date))

  for (const c of Array.isArray(r.conflicts) ? r.conflicts : []) {
    const issue = String(c?.issue ?? '').trim().slice(0, 300)
    if (issue) conflicts.push({ ref: String(c?.ref ?? '-').slice(0, 20), issue })
  }

  // Cities of the main country first, in travel order; others (a stopover) after.
  const ordered = [...stops].sort((a, b) => (a.from ?? '').localeCompare(b.from ?? ''))
  const main = country ? ordered.filter((s) => s.country === country || s.country === null) : ordered
  const primary = cityOf(r.primaryCity)
  return {
    ok: true,
    evidence,
    plan: {
      operationCountry: country,
      tourDestination: formatDestination(main.map((s) => s.city)),
      primaryCity: primary && stops.some((s) => normKey(s.city) === normKey(primary)) ? primary : main[0]?.city ?? null,
      stops: ordered,
      dayCities,
      lineCities,
      conflicts: conflicts.slice(0, 20),
      confidence,
      reasoning: String(r.reasoning ?? '').trim().slice(0, 500),
      model,
    },
  }
}

function shift(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

// ─── Stored plan ──────────────────────────────────────────────────────────────

export interface StoredDestination {
  at: string
  ok: boolean
  reason?: string
  plan?: DestinationPlan
}

export async function saveDestination(bookingRef: string, outcome: DestinationOutcome): Promise<void> {
  const key = `${SETTING_PREFIX}${bookingRef}`
  const value = JSON.stringify(outcome.ok
    ? { at: new Date().toISOString(), ok: true, plan: outcome.plan }
    : { at: new Date().toISOString(), ok: false, reason: outcome.reason })
  await prisma.systemSetting.upsert({ where: { key }, update: { value }, create: { key, value } })
}

/** The saved plan for a booking, or null. Never throws. */
export async function loadDestinationPlan(bookingRef: string): Promise<DestinationPlan | null> {
  try {
    const row = await prisma.systemSetting.findUnique({ where: { key: `${SETTING_PREFIX}${bookingRef}` } })
    const v = row?.value ? (JSON.parse(row.value) as StoredDestination) : null
    return v?.ok && v.plan ? v.plan : null
  } catch {
    return null
  }
}

// ─── Lookups used by placement and agenda ─────────────────────────────────────

/** City the plan gives a store line (`checkouts_more_data.id`). */
export function cityForLine(plan: DestinationPlan | null, lineId: number | string): string | null {
  return plan?.lineCities.find((l) => l.ref === `L${lineId}`)?.city ?? null
}

/** City the guest is based in on a date. */
export function cityForDate(plan: DestinationPlan | null, date: string): string | null {
  if (!plan) return null
  const d = date.slice(0, 10)
  const exact = plan.dayCities.find((x) => x.date === d)?.city
  if (exact) return exact
  const stop = plan.stops.find((s) => s.from && s.to && s.from <= d && d <= s.to)
  return stop?.city ?? null
}

/** Is `location` one of the trip's own cities (loosely: "Hanoi" ~ "Hanoi Old Quarter")? */
export function isTripCity(plan: DestinationPlan, location: string | null | undefined): boolean {
  const loc = normKey(location ?? '')
  if (!loc) return false
  const cities = [...plan.stops.map((s) => s.city), ...plan.dayCities.map((d) => d.city), ...plan.lineCities.map((l) => l.city)]
  return cities.some((c) => {
    const k = normKey(c)
    return k === loc || loc.includes(k) || k.includes(loc)
  })
}

/** One line for logs / toasts: "Vietnam — Hanoi, Da Nang & Ho Chi Minh City (93%)". */
export function describePlan(plan: DestinationPlan): string {
  const country = plan.operationCountry ? COUNTRY_LABEL[plan.operationCountry] : 'outside ops countries'
  return `${country} — ${plan.tourDestination ?? '?'} (${Math.round(plan.confidence * 100)}%)`
}
