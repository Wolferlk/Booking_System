/**
 * VN Vendor Sync — the matcher. Pure: movements + the desk's sheet lines in,
 * one decision per movement out. No database, no network, so it can be run
 * against a downloaded copy of the workbook to see what a sync would do.
 *
 * Why a scorer and not a lookup: the sheet and the movement chart describe the
 * same trip in different words.
 *
 *   sheet line                                   movement (from / to)
 *   ──────────────────────────────────────────   ───────────────────────────────────────
 *   "Pick up from Phu Quoc International Airport" PQC Airport → Night Sea Hotel
 *   "AP HN 2 wwyas"            (both transfers)   HAN Airport → La Passion …  and back
 *   "Phu Quoc Airport to Hotel city center"       Airport → Night Sea Hotel  (location "Arrival")
 *   "SIC Bana Hills with lunch"                   Fivitel → Danang - Bana Hills with Golden Bridge SIC
 *   "Inter hotel Transfer from Central … North"   Night Sea Hotel → Melia Vinpearl Phu Quoc
 *
 * So each pair is scored on what the two can agree about:
 *   - airport transfers: the CITY (airport code, place name, or the tour's own
 *     "Hotel in PQ | Night Sea" lines) and the DIRECTION (pick-up / drop-off /
 *     "2 ways");
 *   - activities: shared words, each weighted by how rare it is across the
 *     sheet — "bana" says far more than "lunch";
 *   - hotel-to-hotel moves: an "inter hotel" line in the same city.
 *
 * A movement takes the best line. Operating vendors (Trans / SIC / cruise) win
 * over ticket sellers for the same movement, and the runner-up is kept as an
 * "also on this movement" note. Only HIGH confidence is ever applied on its
 * own; MEDIUM is offered for one click. Anything else is left alone.
 */

// ── Inputs / outputs ─────────────────────────────────────────────────────────

export interface MatchMovement {
  id: string
  /** yyyy-mm-dd */
  date: string
  location: string | null
  fromPoint: string | null
  toPoint: string | null
  details: string | null
  serviceType: string | null
}

/** One of the booking's hotel stays — tells "Airport → Night Sea Hotel" which city it is in. */
export interface MatchStay {
  hotel: string
  city: string | null
}

export interface MatchLine {
  id: string
  tourCode: string
  sheetRow: number | null
  details: string
  vendor: string | null
  code: string | null
  dates: string | null
}

export type MovementKind = 'AIRPORT_ARRIVAL' | 'AIRPORT_DEPARTURE' | 'FLIGHT' | 'HOTEL_MOVE' | 'ACTIVITY'
export type LineKind = 'AIRPORT' | 'INTER_HOTEL' | 'ACTIVITY'
export type Confidence = 'HIGH' | 'MEDIUM'

export interface Candidate {
  lineId: string
  tourCode: string
  sheetRow: number | null
  details: string
  code: string | null
  vendor: string
  score: number
  why: string
}

export interface MovementDecision {
  movementId: string
  kind: MovementKind
  city: string | null
  /** Null when no line scored high enough to show. */
  best: (Candidate & { confidence: Confidence }) | null
  /** Other vendors that also fit this movement (ticket seller beside the transport, …). */
  also: Candidate[]
}

// ── Thresholds ───────────────────────────────────────────────────────────────

export const HIGH_SCORE = 0.78
export const SHOW_SCORE = 0.55

/** Sheet codes that name who RUNS a movement. */
const OPERATOR_CODES = new Set(['trans', 'sic', 'day cruise', 'cruise', 'transfer', 'tour', 'pvt'])
/** Codes that never describe a movement's vendor. */
const SKIP_CODES = new Set(['hotel', 'guide fee', 'guide', 'f&b', 'fnb', 'meal', 'visa', 'insurance', 'flight'])

/** Vendor cells that are not a vendor: in-house, guide shorthand, typos. */
export function isUsableVendor(raw: string | null | undefined): raw is string {
  const v = String(raw ?? '').trim()
  if (v.length < 2) return false
  if (/^[\d\s.,-]+$/.test(v)) return false
  if (/^(n\/?a|na|tbc|tba|tbd|mmt|hdv|ah|act|none|self|own|x+|-+|\?+|private transfers?|sic transfers?)$/i.test(v)) return false
  return true
}

// ── Text ─────────────────────────────────────────────────────────────────────

export function fold(s: string | null | undefined): string {
  return String(s ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .toLowerCase()
}

/** Multi-word names that should count as one word. Order matters (longest first). */
const PHRASES: [RegExp, string][] = [
  [/\bho chi minh( city)?\b/g, 'hcm'], [/\bsai ?gon\b/g, 'hcm'], [/\btan son nhat\b/g, 'hcm'],
  [/\bha ?noi\b/g, 'hanoi'], [/\bnoi bai\b/g, 'hanoi'],
  [/\bda ?nang\b/g, 'danang'], [/\bhoi ?an\b/g, 'hoian'], [/\bphu ?quoc\b/g, 'phuquoc'],
  [/\bnha ?trang\b/g, 'nhatrang'], [/\bcam ?ranh\b/g, 'nhatrang'], [/\bda ?lat\b/g, 'dalat'],
  [/\bha ?long\b/g, 'halong'], [/\blan ha\b/g, 'lanha'], [/\bninh ?binh\b/g, 'ninhbinh'], [/\bsa ?pa\b/g, 'sapa'],
  [/\bba ?na( hills?)?\b/g, 'bana'], [/\bvin ?wonders?\b/g, 'vinwonders'], [/\bvin ?pearl\b/g, 'vinpearl'],
  [/\bvin ?safari\b/g, 'safari'], [/\bgrand ?world\b/g, 'grandworld'], [/\bcu ?chi\b/g, 'cuchi'],
  [/\btam ?coc\b/g, 'tamcoc'], [/\bhoa? ?lu\b/g, 'hoalu'], [/\btrang ?an\b/g, 'trangan'], [/\bhang ?mua\b|\bmua cave\b/g, 'muacave'],
  [/\bmy ?son\b/g, 'myson'], [/\bmy ?tho\b/g, 'mytho'], [/\bcan ?tho\b/g, 'cantho'], [/\bben ?tre\b/g, 'bentre'],
  [/\bgolden (hands? )?bridge\b/g, 'goldenbridge'], [/\bbasket ?boat\b/g, 'basketboat'],
  [/\bmarble mountains?\b/g, 'marble'], [/\bcable ?car\b/g, 'cablecar'], [/\bsun ?world\b/g, 'sunworld'],
  [/\bhon thom\b/g, 'honthom'], [/\bkiss bridge\b/g, 'kissbridge'], [/\bsung ?sot\b/g, 'sungsot'], [/\bti ?top\b/g, 'titop'],
  [/\bmuong hoa\b/g, 'muonghoa'], [/\bcat ?cat\b/g, 'catcat'], [/\bwater ?park\b/g, 'waterpark'],
  [/\bh\s*\/\s*d\b|\bhalf[- ]day\b/g, 'halfday'], [/\bf\s*\/\s*d\b|\bfull[- ]day\b/g, 'fullday'],
  [/\bcar at disposal\b/g, 'disposal'], [/\bcity tour\b/g, 'citytour'], [/\bwater puppet\w*\b/g, 'waterpuppet'],
]

const STOP = new Set([
  'the', 'and', 'with', 'from', 'to', 'of', 'in', 'at', 'for', 'a', 'an', 'by', 'on', 'or', 'via', 'per', 'incl', 'including',
  'tour', 'tours', 'trip', 'transfer', 'transfers', 'shared', 'private', 'pvt', 'sic', 'pp', 'include', 'includes', 'included',
  'ticket', 'tickets', 'adult', 'adults', 'child', 'children', 'pax', 'only', 'way', 'ways', 'return', 'one', 'two', 'plus',
  'day', 'days', 'hotel', 'hotels', 'standard', 'general', 'access', 'without', 'combo', 'option', 'service', 'services',
  'ei', 'nl', 'te', 'mmt', 'car', 'van', 'bus', 'free', 'visit', 'visiting', 'center', 'centre', 'area', 'city',
])

const stem = (t: string) => (t.length > 4 && t.endsWith('s') && !t.endsWith('ss') ? t.slice(0, -1) : t)

export function tokens(s: string | null | undefined): string[] {
  let t = fold(s)
  for (const [re, rep] of PHRASES) t = t.replace(re, ` ${rep} `)
  const out: string[] = []
  for (const raw of t.split(/[^a-z0-9]+/)) {
    if (raw.length < 2 || STOP.has(raw) || /^\d+$/.test(raw)) continue
    const w = stem(raw)
    if (!out.includes(w)) out.push(w)
  }
  return out
}

// ── Places ───────────────────────────────────────────────────────────────────

/** Canonical city → how it is written. `abbr` only counts as a whole UPPER-CASE word. */
const CITIES: { city: string; re: RegExp; iata: string[]; abbr: string[] }[] = [
  { city: 'hanoi',     re: /\bha ?noi\b|\bnoi bai\b/,                         iata: ['HAN'], abbr: ['HN'] },
  { city: 'hcm',       re: /\bho chi minh\b|\bsai ?gon\b|\btan son nhat\b|\bhcmc?\b/, iata: ['SGN'], abbr: ['HCM', 'HCMC', 'SGN'] },
  { city: 'danang',    re: /\bda ?nang\b|\bhoi ?an\b/,                        iata: ['DAD'], abbr: ['DN', 'DAD', 'HA'] },
  { city: 'phuquoc',   re: /\bphu ?quoc\b/,                                   iata: ['PQC'], abbr: ['PQ', 'PQC'] },
  { city: 'nhatrang',  re: /\bnha ?trang\b|\bcam ?ranh\b/,                    iata: ['CXR'], abbr: ['NT', 'CXR'] },
  { city: 'dalat',     re: /\bda ?lat\b|\blien khuong\b/,                     iata: ['DLI'], abbr: ['DL', 'DLI'] },
  { city: 'hue',       re: /\bhue\b|\bphu bai\b/,                             iata: ['HUI'], abbr: ['HUE', 'HUI'] },
  { city: 'halong',    re: /\bha ?long\b|\bvan don\b|\blan ha\b/,             iata: ['VDO'], abbr: ['HL', 'VDO'] },
  { city: 'haiphong',  re: /\bhai ?phong\b|\bcat bi\b/,                       iata: ['HPH'], abbr: ['HP', 'HPH'] },
  { city: 'cantho',    re: /\bcan ?tho\b/,                                    iata: ['VCA'], abbr: ['VCA'] },
  { city: 'quynhon',   re: /\bquy ?nhon\b|\bphu cat\b/,                       iata: ['UIH'], abbr: ['UIH'] },
  { city: 'sapa',      re: /\bsa ?pa\b/,                                      iata: [],      abbr: ['SP'] },
  { city: 'ninhbinh',  re: /\bninh ?binh\b|\btam ?coc\b|\btrang ?an\b|\bhoa ?lu\b/, iata: [], abbr: ['NB'] },
]

/** Places that are day trips from the same base, so a city mismatch inside one group is not a contradiction. */
const REGION: Record<string, string> = {
  hanoi: 'north', halong: 'north', ninhbinh: 'north', sapa: 'north', haiphong: 'north',
  danang: 'central', hue: 'central', quynhon: 'central',
  hcm: 'south', cantho: 'south',
  phuquoc: 'phuquoc', nhatrang: 'nhatrang', dalat: 'dalat',
}

const ALL_IATA = new Set(CITIES.flatMap(c => c.iata))

/** The first city a piece of text names, or null. */
export function cityOf(text: string | null | undefined, opts: { abbr?: boolean } = {}): string | null {
  const raw = String(text ?? '')
  if (!raw.trim()) return null
  const f = fold(raw)
  let best: { city: string; at: number } | null = null
  const hit = (city: string, at: number) => { if (at >= 0 && (!best || at < best.at)) best = { city, at } }
  for (const c of CITIES) {
    const m = c.re.exec(f)
    if (m) hit(c.city, m.index)
    for (const code of [...c.iata, ...(opts.abbr ? c.abbr : [])]) {
      const m2 = new RegExp(`(^|[^A-Za-z])${code}([^A-Za-z]|$)`).exec(raw)
      if (m2) hit(c.city, m2.index)
    }
  }
  return best ? (best as { city: string }).city : null
}

const AIRPORT_WORD = /\bairports?\b|\bapt\b|\bsan bay\b|\bterminal\b|\bintl\b|\binternational airport\b/

/** An endpoint ("PQC Airport", "SGN", "Noi Bai") that is an airport. */
export function isAirportEndpoint(text: string | null | undefined): boolean {
  const raw = String(text ?? '').trim()
  if (!raw) return false
  if (/^[A-Z]{3}$/.test(raw)) return true                       // any IATA code on its own ("BOM", "SGN")
  const f = fold(raw)
  if (AIRPORT_WORD.test(f)) return true
  if (/\bnoi bai\b|\btan son nhat\b|\bcam ranh\b|\blien khuong\b|\bphu bai\b/.test(f) && raw.length < 40) return true
  return Array.from(ALL_IATA).some(code => new RegExp(`(^|[^A-Za-z])${code}([^A-Za-z]|$)`).test(raw)) && raw.length < 30
}

const HOTEL_WORD = /\b(hotel|resort|villa|villas|homestay|hostel|suites?|inn|residence|boutique|lodge|apartment|retreat|melia|novotel|sheraton|intercontinental|marriott|hilton|pullman|mercure|ibis|sofitel|wyndham|radisson|movenpick|citadines|somerset|premier village|fusion|vinholidays|best western|holiday inn|hyatt|accor|la siesta)\b/

// ── Line analysis ────────────────────────────────────────────────────────────

type Dir = 'ARR' | 'DEP' | 'BOTH' | null

/**
 * What a sheet line can stand for. One line can be several things at once —
 * the desk often writes "Da Lat Airport to Hotel + Tour 01: Dalat to
 * Langbiang…" or "AP PQ 2 ways + Sunset Town … + Inter hotel" on one row.
 */
interface LineInfo {
  line: MatchLine
  kind: LineKind
  codeKey: string
  operator: boolean
  /** Airport transfer, and which way. */
  airport: boolean
  dir: Dir
  /** The city of the AIRPORT this line talks about ("Halong to Hanoi Airport" → hanoi). */
  airportCity: string | null
  interHotel: boolean
  /** Ordered cities for a city-to-city move ("Hanoi - Halong one way"). */
  route: string[]
  /** "Hanoi - Sapa - Hanoi": covers the way back too. */
  routeReturns: boolean
  /** Has enough activity words to be matched by text as well. */
  textual: boolean
  city: string | null
  toks: string[]
  dayRange: [number, number] | null
  month: number | null
}

/** Every city a text names, in the order it names them. */
export function citiesIn(text: string | null | undefined): string[] {
  const raw = String(text ?? '')
  const f = fold(raw)
  const hits: { city: string; at: number }[] = []
  for (const c of CITIES) {
    const re = new RegExp(c.re.source, 'g')
    let m: RegExpExecArray | null
    while ((m = re.exec(f))) hits.push({ city: c.city, at: m.index })
    for (const code of [...c.iata, ...c.abbr]) {
      const re2 = new RegExp(`(^|[^A-Za-z])${code}(?=[^A-Za-z]|$)`, 'g')
      while ((m = re2.exec(raw))) hits.push({ city: c.city, at: m.index + m[1].length })
    }
  }
  hits.sort((a, b) => a.at - b.at)
  const out: string[] = []
  for (const h of hits) if (out[out.length - 1] !== h.city) out.push(h.city)
  return out
}

function lineDirection(text: string): Dir {
  const f = fold(text)
  if (/(^|[^0-9])2\s*[wư]\w*|\btwo[- ]?ways?\b|\bround[- ]?trip\b|\bboth ways?\b|\bpick ?up (and|&) drop|\barrival (and|&) departure\b|\bapt?\s*-\s*hotel\s*-\s*apt?\b/.test(f)) return 'BOTH'
  if (/\bpick[- ]?up\b|\barrival\b|\bdon\b|\bmeet (and|&) greet\b/.test(f) && !/\bdrop[- ]?off\b|\bdeparture\b/.test(f)) return 'ARR'
  if (/\bdrop[- ]?(off)?\b|\bdeparture\b|\btien\b|\bsee off\b/.test(f) && !/\bpick[- ]?up\b|\barrival\b/.test(f)) return 'DEP'
  // "Phu Quoc Airport to Hotel" / "Hanoi Hotel to Airport": which side of "to" is the airport?
  const parts = f.split(/\s(?:to|->|→)\s/)
  if (parts.length >= 2) {
    const left = parts[0], right = parts.slice(1).join(' ')
    const l = AIRPORT_WORD.test(left) || /\bap\b/.test(left)
    const r = AIRPORT_WORD.test(right) || /\bap\b/.test(right)
    if (l && !r) return 'ARR'
    if (r && !l) return 'DEP'
  }
  return null
}

/** The city sitting next to the airport word: "Halong to Hanoi Airport" → hanoi, "AP PQ 2 ways" → phuquoc. */
function airportCityOf(text: string): string | null {
  // The desk's shorthand: "AP HN 2 ways", "AP Hn2 w ways", "A PHN 2 ways", "P HN 1 way".
  const short = /^\s*a?\s?p\s*([a-z]{2,4}?)(?=\d|\s|$)/.exec(fold(text))
  if (short) {
    const hit = CITIES.find(c => c.abbr.some(a => a.toLowerCase() === short[1]) || c.iata.some(a => a.toLowerCase() === short[1]))
    if (hit) return hit.city
  }
  const parts = text.split(/\s(?:to|->|→|\+|\|)\s/i)
  for (const p of parts) {
    const f = fold(p)
    if (AIRPORT_WORD.test(f) || /\bap\b|\bapt\b|\ba p/.test(f) || /\btrain station\b/.test(f)) {
      const c = cityOf(p, { abbr: true })
      if (c) return c
    }
  }
  return cityOf(text, { abbr: true })
}

function parseLineDays(dates: string | null): { range: [number, number]; month: number | null } | null {
  if (!dates) return null
  // "03-06/01", "2/11", "30/10 - 04/11", "06-08/11"
  const m = /(\d{1,2})(?:\/(\d{1,2}))?\s*-\s*(\d{1,2})\/(\d{1,2})/.exec(dates)
  if (m) return { range: [Number(m[1]), Number(m[3])], month: Number(m[4]) }
  const s = /(\d{1,2})\/(\d{1,2})/.exec(dates)
  if (s) return { range: [Number(s[1]), Number(s[1])], month: Number(s[2]) }
  return null
}

/** Words that only say "airport transfer" — what is left decides whether the line is ALSO an activity. */
const TRANSFER_WORDS = new Set(['airport', 'ap', 'apt', 'arrival', 'departure', 'pick', 'pickup', 'up', 'drop', 'off', 'dropoff',
  'train', 'station', 'international', 'intl', 'terminal', 'hotel', 'vehicle', 'cab', 'normal', 'private', 'inter',
  'w', 'wa', 'wy', 'wway', 'wyas', 'wwyas', 'wways', 'ways', 'was', 'way'])

function analyseLine(line: MatchLine): LineInfo | null {
  if (!isUsableVendor(line.vendor)) return null
  const codeKey = fold(line.code).trim()
  if (SKIP_CODES.has(codeKey)) return null
  const f = fold(line.details)
  if (!f.trim()) return null
  // A hotel booking line with an odd code ("Hotel in DN | Sunset Beach").
  if (/^ho\w*l in\b|^room\b|\bnights?\b.*\bhotel\b/.test(f) && !/transfer/.test(f)) return null
  if (/^(guide|gu\w*d|tour guide|hdv)\b/.test(f)) return null

  const airport = AIRPORT_WORD.test(f) || /\bap\b|\bapt\b|^a ?p ?[a-z]{2}\b|^p [a-z]{2}\b/.test(f) || /\btrain station\b/.test(f)
  const interHotel = /\binter[- ]?hotels?\b|\bhotel to hotel\b|\bchange (of )?hotel\b|\bhotel transfer\b(?!.*airport)/.test(f)
  const toks = tokens(line.details)
  const route = citiesIn(line.details)
  const days = parseLineDays(line.dates)
  const activityToks = toks.filter(t => !TRANSFER_WORDS.has(t) && !REGION[t] && t !== 'hoian')
  return {
    line,
    kind: airport ? 'AIRPORT' : interHotel ? 'INTER_HOTEL' : 'ACTIVITY',
    codeKey,
    operator: OPERATOR_CODES.has(codeKey),
    airport,
    dir: airport ? lineDirection(line.details) : null,
    airportCity: airport ? airportCityOf(line.details) : null,
    interHotel,
    route: route.length >= 2 ? route : [],
    routeReturns: route.length >= 3 && route[0] === route[route.length - 1],
    textual: !airport || activityToks.length >= 3,
    city: cityOf(line.details, { abbr: true }),
    toks,
    dayRange: days?.range ?? null,
    month: days?.month ?? null,
  }
}

// ── Movement analysis ────────────────────────────────────────────────────────

interface MoveInfo {
  m: MatchMovement
  kind: MovementKind
  city: string | null
  fromCity: string | null
  toCity: string | null
  toks: string[]
}

const hotelKey = (s: string | null | undefined) =>
  fold(s).replace(/\b(hotel|resort|the|gm|holidays? selections?|by|and|spa)\b/g, ' ').replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim()

/**
 * Where each of the trip's hotels is: the tour's "Hotel in PQ | Night Sea"
 * lines, plus the booking's own accommodation list when the caller has it.
 */
function hotelCities(lines: MatchLine[], stays: MatchStay[] = []): { name: string; city: string }[] {
  const out: { name: string; city: string }[] = []
  for (const st of stays) {
    const city = cityOf(st.city) ?? cityOf(st.hotel)
    const name = hotelKey(st.hotel)
    if (city && name.length >= 3) out.push({ name, city })
  }
  for (const l of lines) {
    const code = fold(l.code).trim()
    const f = fold(l.details)
    if (code !== 'hotel' && !/^ho\w*l in\b/.test(f)) continue
    const city = cityOf(l.details, { abbr: true })
    const name = hotelKey(l.vendor)
    if (city && name.length >= 3) out.push({ name, city })
  }
  return out
}

/** Just a place name ("Phu Quoc", "Da Nang") — not a hotel, not an activity. */
const isOnlyPlace = (s: string | null | undefined) => {
  const t = tokens(s)
  return t.length > 0 && t.every(x => REGION[x] || x === 'hoian')
}

function analyseMovement(m: MatchMovement, hotels: { name: string; city: string }[]): MoveInfo {
  const fromA = isAirportEndpoint(m.fromPoint)
  const toRaw = m.toPoint ?? ''
  const toF = fold(toRaw)
  // The chart sometimes puts the whole activity in "to": "Pick Up from Phu Quoc International Airport → Phu Quoc".
  const toSaysPickup = /\bpick[- ]?up from\b[^→>]*airport|\barrival\b[^→>]*airport/.test(toF)
  const toSaysDrop = /\bdrop[- ]?(off)?\b[^→>]*\b(to|at)\b[^→>]*airport|\bdeparture\b[^→>]*airport/.test(toF)
  const toA = !toSaysPickup && isAirportEndpoint(toRaw)

  const hotelCity = (s: string | null) => {
    const k = hotelKey(s)
    if (k.length < 3 || isOnlyPlace(s)) return null
    return hotels.find(h => k.includes(h.name) || (k.length >= 4 && h.name.includes(k)))?.city ?? null
  }
  const isHotel = (s: string | null) => {
    const f = fold(s)
    if (!f.trim() || isOnlyPlace(s)) return false
    return HOTEL_WORD.test(f) || hotelCity(s) !== null
  }

  let kind: MovementKind
  if (toSaysPickup || (fromA && !toA)) kind = 'AIRPORT_ARRIVAL'
  else if (toSaysDrop || (toA && !fromA)) kind = 'AIRPORT_DEPARTURE'
  else if (fromA && toA) kind = 'FLIGHT'
  else {
    const fromH = isHotel(m.fromPoint)
    const toH = isHotel(m.toPoint) && tokens(m.toPoint).length <= 6
    kind = fromH && toH && fold(m.fromPoint).trim() !== fold(m.toPoint).trim() ? 'HOTEL_MOVE' : 'ACTIVITY'
  }

  // City: airport codes first, then the place names on the movement, then the
  // trip's own hotel list for "Airport → Night Sea Hotel" with no city at all.
  const airportSide = kind === 'AIRPORT_ARRIVAL' ? m.fromPoint : kind === 'AIRPORT_DEPARTURE' ? m.toPoint : null
  let city = cityOf(airportSide) ?? (toSaysPickup || toSaysDrop ? cityOf(m.toPoint) : null)
  city ??= cityOf(m.location)
  city ??= cityOf(m.fromPoint) ?? cityOf(m.toPoint)
  city ??= hotelCity(m.fromPoint) ?? hotelCity(m.toPoint)

  // Ends of the journey, for city-to-city lines ("Hanoi - Halong one way").
  const fromCity = cityOf(m.fromPoint) ?? hotelCity(m.fromPoint)
  const toCity = cityOf(m.toPoint) ?? hotelCity(m.toPoint) ?? (fromCity && cityOf(m.location) !== fromCity ? cityOf(m.location) : null)

  // Activity words: what the movement IS (to-point + the first part of the details).
  const toks = tokens(`${m.toPoint ?? ''} ${(m.details ?? '').slice(0, 160)}`)
  return { m, kind, city, fromCity, toCity, toks }
}

// ── Scoring ──────────────────────────────────────────────────────────────────

/** Inverse document frequency over the sheet's line texts — rare words count more. */
export function buildIdf(allLineTexts: string[]): (t: string) => number {
  const df = new Map<string, number>()
  for (const text of allLineTexts) for (const t of tokens(text)) df.set(t, (df.get(t) ?? 0) + 1)
  const n = Math.max(1, allLineTexts.length)
  return (t: string) => Math.log(1 + n / (1 + (df.get(t) ?? 0)))
}

const sameRegion = (a: string | null, b: string | null) => !a || !b || a === b || (REGION[a] && REGION[a] === REGION[b])

function dayMatches(li: LineInfo, date: string): boolean | null {
  if (!li.dayRange) return null
  const day = Number(date.slice(8, 10))
  const month = Number(date.slice(5, 7))
  const [a, b] = li.dayRange
  if (li.month && li.month !== month && !(a > b)) return false
  return a <= b ? day >= a && day <= b : day >= a || day <= b
}

type Scored = { score: number; why: string }

function airportScore(mi: MoveInfo, li: LineInfo, airportCities: Set<string>): Scored | null {
  if (!li.airport) return null
  const want: Dir = mi.kind === 'AIRPORT_ARRIVAL' ? 'ARR' : 'DEP'
  if (li.dir && li.dir !== 'BOTH' && li.dir !== want) return null
  const dirWhy = li.dir === 'BOTH' ? 'both-way airport line' : li.dir ? (want === 'ARR' ? 'airport pick-up' : 'airport drop-off') : 'airport transfer'
  if (mi.city && li.airportCity) {
    if (mi.city !== li.airportCity) return null
    // "AP HN 1 way" does not say which way — a person should confirm it.
    const oneWay = !li.dir && /\b1\s*way|\bone[- ]?way\b/.test(fold(li.line.details))
    const s = li.dir === want ? 0.97 : li.dir === 'BOTH' ? 0.95 : oneWay ? 0.74 : 0.86
    return { score: s, why: `${dirWhy}${oneWay ? ' (1 way, direction not stated)' : ''} · ${cityLabel(mi.city)}` }
  }
  // "Doris Cruise → Airport" sits in Ha Long, which has no airport line; the
  // only airport city on the sheet in the same region is the one meant.
  if (mi.city && li.airportCity && REGION[mi.city] && REGION[mi.city] === REGION[li.airportCity]) {
    const regional = Array.from(airportCities).filter(c => REGION[c] === REGION[mi.city as string])
    if (regional.length === 1 && !airportCities.has(mi.city)) {
      const s = li.dir === want ? 0.89 : li.dir === 'BOTH' ? 0.87 : 0.7
      return { score: s, why: `${dirWhy} · ${cityLabel(li.airportCity)} (nearest airport to ${cityLabel(mi.city)})` }
    }
  }
  // One side does not say where. Only safe when the tour has a single airport city.
  if (airportCities.size === 1) {
    return { score: li.dir === want ? 0.72 : 0.68, why: `${dirWhy} · only airport city on the sheet` }
  }
  return null
}

function routeScore(mi: MoveInfo, li: LineInfo): Scored | null {
  if (!li.route.length || !mi.fromCity || !mi.toCity || mi.fromCity === mi.toCity) return null
  for (let i = 0; i < li.route.length - 1; i++) {
    if (li.route[i] === mi.fromCity && li.route[i + 1] === mi.toCity) {
      return { score: 0.88, why: `${cityLabel(mi.fromCity)} → ${cityLabel(mi.toCity)} transfer` }
    }
  }
  return null
}

function textScore(mi: MoveInfo, li: LineInfo, idf: (t: string) => number): Scored | null {
  if (!li.textual || !li.toks.length || !mi.toks.length) return null
  if (!sameRegion(mi.city, li.city)) return null
  const mset = new Set(mi.toks)
  const lineToks = li.airport ? li.toks.filter(t => !TRANSFER_WORDS.has(t)) : li.toks
  let shared = 0, lineMass = 0, moveMass = 0
  const hits: string[] = []
  for (const t of lineToks) {
    const w = idf(t)
    lineMass += w
    if (mset.has(t)) { shared += w; hits.push(t) }
  }
  for (const t of mi.toks) moveMass += idf(t)
  if (!shared) return null
  const containment = shared / lineMass                          // how much of the line the movement covers
  const moveCover = shared / moveMass                            // how much of the movement the line covers
  const dice = (2 * shared) / (lineMass + moveMass)              // overall overlap
  // A combined line ("Airport to hotel + Tour 01: …") is long; judge it by how
  // well it covers the movement rather than the other way round.
  const cover = li.airport || lineToks.length > 10 ? Math.max(containment, moveCover * 0.9) : containment
  let score = 0.7 * cover + 0.3 * Math.min(1, dice * 1.6)
  // A line that is only a place name ("SIC Hanoi H/D Tour" → hanoi) proves little on its own.
  const placeOnly = hits.every(h => REGION[h] || h === 'hoian' || h === 'halfday' || h === 'fullday')
  if (placeOnly) score = Math.min(score, 0.62)
  if (hits.length === 1 && lineToks.length > 2) score *= 0.85
  return { score: Math.min(0.99, score), why: `matches "${hits.slice(0, 4).join(', ')}"` }
}

function scorePair(mi: MoveInfo, li: LineInfo, idf: (t: string) => number, airportCities: Set<string>): Scored | null {
  const dm = dayMatches(li, mi.m.date)
  if (dm === false) return null
  const dayBonus = dm === true ? 0.05 : 0
  const pick = (...xs: (Scored | null)[]): Scored | null => {
    const best = xs.filter((x): x is Scored => x !== null).sort((a, b) => b.score - a.score)[0]
    return best ? { score: Math.min(0.99, best.score + dayBonus), why: best.why } : null
  }

  if (mi.kind === 'FLIGHT') return null
  if (mi.kind === 'AIRPORT_ARRIVAL' || mi.kind === 'AIRPORT_DEPARTURE') return pick(airportScore(mi, li, airportCities))

  let hotel: Scored | null = null
  if (mi.kind === 'HOTEL_MOVE' && li.interHotel && sameRegion(mi.city, li.city)) {
    hotel = { score: mi.city && li.city ? 0.86 : 0.7, why: `hotel-to-hotel transfer${mi.city ? ` · ${cityLabel(mi.city)}` : ''}` }
  }
  // An "inter hotel" line names no activity, so it only ever fits a hotel move.
  const text = li.interHotel && !li.textual ? null : (li.interHotel && mi.kind !== 'HOTEL_MOVE' && !li.airport ? null : textScore(mi, li, idf))
  return pick(hotel, routeScore(mi, li), text)
}

const CITY_LABEL: Record<string, string> = {
  hanoi: 'Hanoi', hcm: 'Ho Chi Minh', danang: 'Da Nang', phuquoc: 'Phu Quoc', nhatrang: 'Nha Trang', dalat: 'Da Lat',
  hue: 'Hue', halong: 'Ha Long', haiphong: 'Hai Phong', cantho: 'Can Tho', quynhon: 'Quy Nhon', sapa: 'Sa Pa', ninhbinh: 'Ninh Binh',
}
export const cityLabel = (c: string | null) => (c ? CITY_LABEL[c] ?? c : '')

// ── Booking-level match ──────────────────────────────────────────────────────

/**
 * Decide a vendor for every movement of one booking from that booking's sheet
 * lines. `idf` should be built over the whole sheet (buildIdf) so word weights
 * are stable from booking to booking.
 */
export function matchBooking(
  movements: MatchMovement[], lines: MatchLine[], idf: (t: string) => number, stays: MatchStay[] = [],
): MovementDecision[] {
  const hotels = hotelCities(lines, stays)
  const infos = lines.map(analyseLine).filter((x): x is LineInfo => x !== null)
  const airportCities = new Set(infos.filter(i => i.airport && i.airportCity).map(i => i.airportCity as string))
  const moves = movements.map(m => analyseMovement(m, hotels))

  // "Doris Cruise → Airport": the flight leg that day says which airport.
  for (const mi of moves) {
    if (mi.kind !== 'AIRPORT_ARRIVAL' && mi.kind !== 'AIRPORT_DEPARTURE') continue
    const side = mi.kind === 'AIRPORT_ARRIVAL' ? mi.m.fromPoint : mi.m.toPoint
    if (cityOf(side)) continue
    const flights = moves.filter(o => o.kind === 'FLIGHT' && o.m.date === mi.m.date)
    const cities = new Set(flights
      .map(f => cityOf(mi.kind === 'AIRPORT_DEPARTURE' ? f.m.fromPoint : f.m.toPoint))
      .filter((c): c is string => c !== null))
    if (cities.size === 1) mi.city = Array.from(cities)[0]
  }

  // "Arrival | Airport → Prague Hotel" names no city, but the other movements
  // that day do. Borrow it only when they all agree.
  for (const mi of moves) {
    if (mi.city) continue
    const sameDay = new Set(moves.filter(o => o !== mi && o.m.date === mi.m.date && o.city).map(o => o.city as string))
    if (sameDay.size === 1) mi.city = Array.from(sameDay)[0]
  }

  // Score every pair once.
  const scored = moves.map(mi => infos
    .map(li => {
      const s = scorePair(mi, li, idf, airportCities)
      return s ? { li, ...s } : null
    })
    .filter((x): x is { li: LineInfo; score: number; why: string } => x !== null))

  // Mutual best: a line whose best movement is this one, and vice versa, is the
  // strongest evidence the text scorer can give. Only for activity lines —
  // airport lines legitimately serve two movements.
  const bestMoveForLine = new Map<string, { idx: number; score: number; second: number }>()
  scored.forEach((list, idx) => {
    for (const c of list) {
      if (c.li.kind !== 'ACTIVITY' || c.li.route.length) continue
      const cur = bestMoveForLine.get(c.li.line.id)
      if (!cur) bestMoveForLine.set(c.li.line.id, { idx, score: c.score, second: 0 })
      else if (c.score > cur.score) bestMoveForLine.set(c.li.line.id, { idx, score: c.score, second: cur.score })
      else if (c.score > cur.second) cur.second = c.score
    }
  })

  return moves.map((mi, idx) => {
    const ranked = scored[idx]
      .map(c => {
        let score = c.score
        if (c.li.kind === 'ACTIVITY') {
          const b = bestMoveForLine.get(c.li.line.id)
          if (b && b.idx === idx && b.score - b.second >= 0.15) score = Math.min(0.99, score + 0.08)
          // This line fits another movement much better — unless that one is the
          // same day, where one combined line legitimately covers both.
          else if (b && b.idx !== idx && b.score - c.score >= 0.1 && moves[b.idx].m.date !== mi.m.date) score -= 0.12
        }
        if (c.li.operator) score += 0.03
        return { ...c, score }
      })
      .filter(c => c.score >= SHOW_SCORE - 0.1)
      .sort((a, b) => (Number(b.li.operator) - Number(a.li.operator)) * 0.0001 + (b.score - a.score))

    const toCand = (c: (typeof ranked)[number]): Candidate => ({
      lineId: c.li.line.id, tourCode: c.li.line.tourCode, sheetRow: c.li.line.sheetRow,
      details: c.li.line.details, code: c.li.line.code, vendor: String(c.li.line.vendor).trim(),
      score: Math.round(Math.min(0.99, c.score) * 100) / 100, why: c.why,
    })

    const top = ranked[0]
    if (!top || top.score < SHOW_SCORE) {
      return { movementId: mi.m.id, kind: mi.kind, city: mi.city, best: null, also: [] }
    }

    let confidence: Confidence = top.score >= HIGH_SCORE ? 'HIGH' : 'MEDIUM'
    // A close runner-up of the same class naming someone else: let a person choose.
    const rival = ranked.slice(1).find(c => fold(c.li.line.vendor) !== fold(top.li.line.vendor))
    if (rival && rival.li.operator === top.li.operator && top.score - rival.score < 0.06) confidence = 'MEDIUM'

    const seen = new Set([fold(top.li.line.vendor)])
    const also: Candidate[] = []
    for (const c of ranked.slice(1)) {
      const k = fold(c.li.line.vendor)
      if (seen.has(k) || c.score < SHOW_SCORE) continue
      seen.add(k)
      also.push(toCand(c))
      if (also.length >= 3) break
    }
    return { movementId: mi.m.id, kind: mi.kind, city: mi.city, best: { ...toCand(top), confidence }, also }
  })
}

// ── Vendor directory ─────────────────────────────────────────────────────────

export interface DirectoryEntry {
  id: string
  name: string
  phone: string | null
  source: 'TOUR_VENDOR' | 'VEHICLE_VENDOR'
}

const NAME_NOISE = /\b(travel|travels|tour|tours|tourist|co|ltd|limited|company|jsc|group|transport|transportation|service|services|vietnam|viet nam|vn|the|and|cruises?|bus ?lines?|limo|limousine|agency|trading|corp|corporation)\b/g

function nameForms(name: string): string[] {
  const f = fold(name)
  const forms = new Set<string>()
  const clean = (s: string) => s.replace(/[^a-z0-9]+/g, ' ').replace(NAME_NOISE, ' ').replace(/\s+/g, ' ').trim()
  const full = clean(f.replace(/[()[\]]/g, ' '))
  if (full) forms.add(full)
  const outside = clean(f.replace(/\([^)]*\)|\[[^\]]*\]/g, ' '))
  if (outside) forms.add(outside)
  for (const m of Array.from(f.matchAll(/\(([^)]*)\)/g))) { const c = clean(m[1]); if (c) forms.add(c) }
  // "Cozy travel" also answers to plain "cozy"; keep the raw fold too for very short names.
  const raw = f.replace(/[^a-z0-9]+/g, ' ').trim()
  if (raw) forms.add(raw)
  return Array.from(forms)
}

function bigrams(s: string): string[] {
  const t = s.replace(/\s+/g, '')
  const out: string[] = []
  for (let i = 0; i < t.length - 1; i++) out.push(t.slice(i, i + 2))
  return out
}

function dice(a: string, b: string): number {
  const A = bigrams(a), B = bigrams(b)
  if (!A.length || !B.length) return 0
  const pool = new Map<string, number>()
  for (const x of A) pool.set(x, (pool.get(x) ?? 0) + 1)
  let hit = 0
  for (const x of B) { const n = pool.get(x) ?? 0; if (n) { hit++; pool.set(x, n - 1) } }
  return (2 * hit) / (A.length + B.length)
}

/** How sure we are that a sheet vendor name and a directory name are the same business (0–1). */
export function vendorNameScore(sheetName: string, dirName: string): number {
  let best = 0
  for (const a of nameForms(sheetName)) {
    for (const b of nameForms(dirName)) {
      if (!a || !b) continue
      if (a === b) return 1
      const at = a.split(' '), bt = b.split(' ')
      const aInB = at.every(t => bt.includes(t)), bInA = bt.every(t => at.includes(t))
      if ((aInB || bInA) && Math.min(a.length, b.length) >= 3) best = Math.max(best, 0.92)
      else if (Math.min(a.length, b.length) >= 4) best = Math.max(best, dice(a, b) >= 0.86 ? 0.86 : 0)
    }
  }
  return best
}

export interface DirectoryMatch {
  entry: DirectoryEntry
  score: number
  ambiguous: boolean
}

/** Best directory entry for a sheet vendor name. Tour vendors beat vehicle vendors at equal strength. */
export function matchDirectory(sheetVendor: string, directory: DirectoryEntry[]): DirectoryMatch | null {
  const scored = directory
    .map(entry => ({ entry, score: vendorNameScore(sheetVendor, entry.name) }))
    .filter(x => x.score >= 0.86)
    .sort((a, b) => b.score - a.score || (a.entry.source === 'TOUR_VENDOR' ? -1 : 1) - (b.entry.source === 'TOUR_VENDOR' ? -1 : 1))
  if (!scored.length) return null
  const top = scored[0]
  const ambiguous = scored.some(x => x !== top && x.score === top.score && x.entry.source === top.entry.source
    && fold(x.entry.name) !== fold(top.entry.name))
  return { entry: top.entry, score: top.score, ambiguous }
}
