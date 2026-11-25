/**
 * B2C one-way transfer chains on the movement chart.
 *
 * The storefront sells transport as one-way, spot-to-spot legs. A day out is a
 * chain of them — Hotel → Night Safari → Jumbo Seafood → Hotel is three legs —
 * while the attraction ticket or the restaurant is a separate product with no
 * transport in it. On the chart that has to read as one plan:
 *
 *  1. every leg is its own row (matched one-to-one, by direction — the coverage
 *     net in the generate route puts back any leg the model dropped);
 *  2. the day's legs run in chain order, each product right after the leg that
 *     takes the guest there;
 *  3. each product row says which one-way transfer we booked to it and from it
 *     — or that a direction was not booked, so it is the guest's own;
 *  4. on a multi-leg day each leg row says "leg k of n" and shows the whole route.
 *
 * Pure: no DB. Places are matched on the day by their distinctive words, so
 * "Gardens by the Bay & Singapore Flyer" covers both the Gardens ticket and the
 * Singapore Flyer ticket. A bare "Hotel" is the guest's hotel that night
 * (`resolvePoint`).
 */
import { splitRouteLabel } from './b2c-booking-map'

export interface ChainSource {
  date: string
  title: string
  description: string | null
}

export interface ChainItem {
  date?: unknown
  fromPoint?: string | null
  toPoint?: string | null
  details?: string | null
  serviceType: string
}

export interface TransferLeg {
  /** Index of the itinerary row this leg came from. */
  src: number
  date: string
  from: string
  to: string
  basis: 'Private' | 'SIC'
  title: string
}

export type ResolvePoint = (label: string, date: string) => string

/** First line of a product remark — also how a re-run spots one already there. */
export const PRODUCT_TRANSFER_NOTE_HEAD = 'Transport not included in this product — one-way transfer(s) arranged separately by us:'

const MOVE_RE = /\b(transfer|transport|pick[\s-]?up|drop[\s-]?off|chauffeur)\b/i
const SHARED_RE = /\b(sic|shared|sharing|seat[\s-]*in[\s-]*coach)\b/i
/** A tour that brings its own vehicle is not a ticket-only product. */
const OWN_VEHICLE_TOUR_RE = /\b(private|pvt)\b.*\btour\b|\btour\b.*\b(private|pvt)\b|\(private vehicle\)/i
const LODGING_RE = /\b(hotels?|resorts?|villas?|inn|hostels?|apartments?|guest\s*house|bungalows?)\b/i
const AIRPORT_RE = /\b(airport|terminal)\b/i
const REPEAT_TAG_RE = /\s*\((outbound|return|\d+ of \d+)\)\s*$/i

/** Words that say nothing about which place it is. */
const STOP = new Set([
  'the', 'and', 'with', 'for', 'from', 'into', 'only', 'one', 'way',
  'ticket', 'tickets', 'admission', 'entrance', 'entry', 'standard', 'tourist', 'adult', 'child',
  'open', 'dated', 'combo', 'pass', 'private', 'pvt', 'sic', 'shared', 'transfer', 'transfers',
  'hotel', 'resort', 'airport', 'international', 'terminal', 'within', 'city', 'limit', 'limits',
])

const norm = (s: unknown) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
const tokensOf = (s: unknown) =>
  Array.from(new Set(norm(s).split(' ').filter(t => t.length >= 3 && !STOP.has(t))))
const day = (v: unknown) => String(v ?? '').slice(0, 10)

/** "Private - Singapore Hotel - One way Transfer ( Within City Limit Only" → "Singapore Hotel". */
function cleanPlace(label: string): string {
  return label
    .replace(/\(.*$/, '')
    .replace(/^\s*(private|pvt|sic|shared)\s*(transfer)?\s*[-–—:]\s*/i, '')
    .replace(/\s*[-–—|]\s*(one[\s-]*way|round[\s-]*trip|return|private|sic|shared)\b.*$/i, '')
    .trim()
}

/**
 * The attraction(s) a leg end names: "Gardens by the Bay & Singapore Flyer" →
 * two; "Captains Marina, Balapitiya" → "Captains Marina". Hotels and airports
 * are left out — "Singapore Hotel" must not match every "Singapore …" ticket.
 */
function attractionsOf(label: string): string[] {
  return cleanPlace(label)
    .split(/\s*(?:&|\+|\/|\band\b)\s*/i)
    .map(p => p.split(',')[0].trim())
    .filter(p => p && !LODGING_RE.test(p) && !AIRPORT_RE.test(p))
}

/** Most of a place's distinctive words appear in the product title. */
function placeInTitle(place: string, title: string): boolean {
  const words = tokensOf(place)
  if (words.length === 0) return false
  const hay = ` ${norm(title)} `
  return words.filter(w => hay.includes(` ${w} `)).length / words.length >= 0.6
}

/** A leg end is the place this product is at. */
export function legEndIsProduct(end: string, productTitle: string): boolean {
  return attractionsOf(end).some(p => placeInTitle(p, productTitle))
}

/**
 * How alike two place labels are, 0–1. Two lodgings where one is a bare "Hotel"
 * are the same place; two airports are the same place (the model writes
 * "CMB Airport" for "Bandaranaike International Airport").
 */
function placeSimilarity(a: unknown, b: unknown): number {
  const sa = String(a ?? ''), sb = String(b ?? '')
  if (!sa.trim() || !sb.trim()) return 0
  const ta = tokensOf(sa), tb = tokensOf(sb)
  if (LODGING_RE.test(sa) && LODGING_RE.test(sb) && (ta.length === 0 || tb.length === 0)) return 1
  if (AIRPORT_RE.test(sa) && AIRPORT_RE.test(sb)) return 1
  if (ta.length === 0 || tb.length === 0) return 0
  const hits = ta.filter(t => tb.includes(t)).length
  return hits / Math.min(ta.length, tb.length) >= 0.6 ? hits / Math.max(ta.length, tb.length) : 0
}

const samePlace = (a: string, b: string) => placeSimilarity(a, b) > 0

/**
 * A row's From/To names this leg end (the store label, or that night's hotel).
 * A hotel end the store words generically ("Singapore Hotel") still weakly
 * matches the row's real hotel name ("Marina Bay Sands") — the leg's other end
 * has to match properly, and a better-named row still wins.
 */
function pointScore(point: unknown, end: string, date: string, resolve: ResolvePoint): number {
  const score = Math.max(placeSimilarity(point, end), placeSimilarity(point, resolve(end, date)))
  if (score > 0) return score
  const p = String(point ?? '').trim()
  return p && LODGING_RE.test(end) && !AIRPORT_RE.test(p) ? 0.05 : 0
}

// ─── Legs ──────────────────────────────────────────────────────────────────────

/** "Hotel to Night Safari – Private Transfer" / "Private transfer: A to B" → a leg. */
export function transferLegOf(row: ChainSource, src: number): TransferLeg | null {
  const title = row.title.replace(REPEAT_TAG_RE, '').trim()
  if (!MOVE_RE.test(title)) return null
  const route = splitRouteLabel(title.replace(/^\s*(private|pvt|sic|shared)\s+transfer\s*:\s*/i, ''))
  if (!route) return null
  const from = cleanPlace(route.from)
  const to = cleanPlace(route.to)
  // The generic product name "… Hotel / Sightseeing / Restaurant to Hotel / …"
  // (no per-line label on the store) is not a real route.
  if (!from || !to || from.includes('/') || to.includes('/')) return null
  const basis = SHARED_RE.test(title) && !/\b(private|pvt)\b/i.test(title) ? 'SIC' : 'Private'
  return { src, date: row.date, from, to, basis, title: row.title }
}

export function transferLegsOf(sources: ChainSource[]): TransferLeg[] {
  return sources.map((s, i) => transferLegOf(s, i)).filter((l): l is TransferLeg => l !== null)
}

/**
 * Pair every leg with its own agenda row: same day, From and To going the leg's
 * direction, each row used once. The best-named row wins, so the transfer row
 * "Hotel → Night Safari" beats a ticket row the model gave a From. Falls back to
 * a row that carries the leg's whole title. Returns legIndex → rowIndex.
 */
export function matchLegRows(items: ChainItem[], legs: TransferLeg[], resolve: ResolvePoint): Map<number, number> {
  const rowOf = new Map<number, number>()
  const used = new Set<number>()
  legs.forEach((leg, k) => {
    let best = -1
    let bestScore = 0
    items.forEach((it, i) => {
      if (used.has(i) || day(it.date) !== leg.date) return
      const from = pointScore(it.fromPoint, leg.from, leg.date, resolve)
      const to = pointScore(it.toPoint, leg.to, leg.date, resolve)
      if (from === 0 || to === 0) return
      if (from + to > bestScore) { best = i; bestScore = from + to }
    })
    if (best < 0) {
      const key = norm(leg.title.replace(REPEAT_TAG_RE, ''))
      best = items.findIndex((it, i) => !used.has(i) && day(it.date) === leg.date
        && norm(`${it.toPoint ?? ''} ${it.details ?? ''}`).includes(key))
    }
    if (best >= 0) { used.add(best); rowOf.set(k, best) }
  })
  return rowOf
}

/**
 * A day's legs in travel order: start where nothing arrives (or at the hotel),
 * then always take the leg leaving from where the last one ended. Store order
 * breaks ties, so an unconnected leg keeps its place.
 */
export function orderDayChain(legs: TransferLeg[]): TransferLeg[] {
  const left = [...legs]
  const out: TransferLeg[] = []
  const pickStart = () =>
    left.find(l => !left.some(o => o !== l && samePlace(o.to, l.from)))
    ?? left.find(l => LODGING_RE.test(l.from))
    ?? left[0]
  let cur: TransferLeg | undefined = pickStart()
  while (cur) {
    out.push(cur)
    left.splice(left.indexOf(cur), 1)
    if (left.length === 0) break
    const from: string = cur.to
    cur = left.find(l => samePlace(l.from, from)) ?? pickStart()
  }
  return out
}

/** "Value Hotel Thomson → Night Safari → Jumbo Seafood → Value Hotel Thomson". */
function routeLine(chain: TransferLeg[], resolve: ResolvePoint): string {
  let text = ''
  chain.forEach((l, k) => {
    const from = resolve(l.from, l.date), to = resolve(l.to, l.date)
    if (k === 0) text = `${from} → ${to}`
    else if (samePlace(chain[k - 1].to, l.from)) text += ` → ${to}`
    else text += ` | ${from} → ${to}`
  })
  return text
}

// ─── Products (tickets, restaurants, activities) ──────────────────────────────

/** A storefront product with no transport of its own: ticket, restaurant, activity. */
function isTransportFreeProduct(row: ChainSource): boolean {
  const desc = String(row.description ?? '').trim()
  if (/^(hotels?|transport|flights?)\b/i.test(desc)) return false
  if (MOVE_RE.test(row.title) || SHARED_RE.test(row.title) || OWN_VEHICLE_TOUR_RE.test(row.title)) return false
  return /^lifestyle\b/i.test(desc) || /\b(ticket|tickets|admission|entrance|entry)\b/i.test(row.title)
}

/** Word overlap over the longer side — 1 when both name the same thing. */
function titleSimilarity(a: unknown, b: unknown): number {
  const x = tokensOf(a), y = tokensOf(b)
  if (x.length === 0 || y.length === 0) return 0
  return x.filter(t => y.includes(t)).length / Math.max(x.length, y.length)
}

/** The product's own row on the chart — preferring one that is not a leg row. */
function productRow(items: ChainItem[], src: ChainSource, legRows: Set<number>): number {
  const pick = (allowLegRows: boolean) => {
    let best = -1
    let bestScore = 0
    items.forEach((it, i) => {
      if (day(it.date) !== src.date || (!allowLegRows && legRows.has(i))) return
      let score = titleSimilarity(it.toPoint, src.title)
      if (score < 0.5 && norm(it.details).includes(norm(src.title))) score = 0.5
      if (it.serviceType === 'INTERNAL_TOUR') score += 0.01
      if (score > bestScore) { best = i; bestScore = score }
    })
    return bestScore >= 0.5 ? best : -1
  }
  const own = pick(false)
  return own >= 0 ? own : pick(true)
}

// ─── Put it together ──────────────────────────────────────────────────────────

/**
 * Order each day's legs into a chain (products after the leg that reaches
 * them) and add the remarks. Rows not part of a chain keep their positions.
 */
export function arrangeTransferChains<T extends ChainItem>(
  items: T[],
  sources: ChainSource[],
  resolve: ResolvePoint = l => l,
): { items: T[]; legs: number; legRows: number; productsNoted: number } {
  const legs = transferLegsOf(sources)
  if (legs.length === 0) return { items, legs: 0, legRows: 0, productsNoted: 0 }

  const rowOfLeg = matchLegRows(items, legs, resolve)
  const legRowSet = new Set(Array.from(rowOfLeg.values()))
  const describe = (l: TransferLeg) => `one-way ${l.basis} Transfer, ${resolve(l.from, l.date)} → ${resolve(l.to, l.date)}`

  const notes = new Map<number, string[]>()
  const addNote = (row: number, text: string) => notes.set(row, [...(notes.get(row) ?? []), text])

  // Chains per day, over the legs that have a row.
  const dates = Array.from(new Set(legs.map(l => l.date)))
  const chainOf = new Map<string, TransferLeg[]>()
  for (const d of dates) {
    chainOf.set(d, orderDayChain(legs.filter((l, k) => l.date === d && rowOfLeg.has(k))))
  }
  const rowOf = (l: TransferLeg) => rowOfLeg.get(legs.indexOf(l))!

  // Products: which leg reaches them, which leaves them.
  const placeAfter = new Map<number, number[]>()   // leg row → product rows right after it
  const placeBefore = new Map<number, number[]>()  // leg row → product rows right before it
  let productsNoted = 0
  sources.forEach(src => {
    if (!isTransportFreeProduct(src)) return
    const chain = chainOf.get(src.date) ?? []
    const allDay = legs.filter(l => l.date === src.date)
    const inbound = allDay.filter(l => legEndIsProduct(l.to, src.title))
    const outbound = allDay.filter(l => legEndIsProduct(l.from, src.title))
    if (inbound.length === 0 && outbound.length === 0) return
    const row = productRow(items, src, legRowSet)
    if (row < 0) return

    const lines = [
      PRODUCT_TRANSFER_NOTE_HEAD,
      ...(inbound.length ? inbound.map(l => `• To here: ${describe(l)}`) : ['• To here: no transfer booked (guest\'s own arrangement)']),
      ...(outbound.length ? outbound.map(l => `• From here: ${describe(l)}`) : ['• From here: no transfer booked (guest\'s own arrangement)']),
    ]
    if (chain.length > 1) lines.push(`• Today's transfer route: ${routeLine(chain, resolve)}`)
    addNote(row, lines.join('\n'))
    productsNoted++

    if (legRowSet.has(row)) return // the model merged it into a leg row — nothing to move
    const reach = chain.find(l => inbound.includes(l))
    const leave = chain.find(l => outbound.includes(l))
    if (reach) placeAfter.set(rowOf(reach), [...(placeAfter.get(rowOf(reach)) ?? []), row])
    else if (leave) placeBefore.set(rowOf(leave), [...(placeBefore.get(rowOf(leave)) ?? []), row])
  })

  // Leg rows on a multi-leg day: position and the whole route.
  chainOf.forEach(chain => {
    if (chain.length < 2) return
    const route = routeLine(chain, resolve)
    chain.forEach((l, k) => addNote(rowOf(l), `One-way transfer — leg ${k + 1} of ${chain.length} today. Route: ${route}`))
  })

  // Reorder: within the slots a day's chain rows already occupy.
  const order = items.map((_, i) => i)
  chainOf.forEach(chain => {
    if (chain.length === 0) return
    const seq: number[] = []
    const push = (i: number) => { if (!seq.includes(i)) seq.push(i) }
    for (const l of chain) {
      const r = rowOf(l)
      ;(placeBefore.get(r) ?? []).forEach(push)
      push(r)
      ;(placeAfter.get(r) ?? []).forEach(push)
    }
    const slots = [...seq].sort((a, b) => a - b)
    slots.forEach((slot, k) => { order[slot] = seq[k] })
  })

  const out = order.map(i => {
    const it = items[i]
    const add = notes.get(i)
    if (!add) return it
    const current = String(it.details ?? '').trim()
    const fresh = Array.from(new Set(add)).filter(n => !current.includes(n))
    return fresh.length ? { ...it, details: [current, ...fresh].filter(Boolean).join('\n\n') } : it
  })
  return { items: out, legs: legs.length, legRows: rowOfLeg.size, productsNoted }
}
