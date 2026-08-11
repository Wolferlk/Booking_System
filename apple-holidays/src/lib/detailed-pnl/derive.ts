/**
 * Detailed P&L — the derivation.
 *
 * A faithful port of the server half of the Accounts app's Detailed P&L:
 *
 *   AppleSystemApiService::extractPnlSummary / ::extractPnlBreakdown
 *   AsPnlController::productRows / ::transportLegs / ::routeCity
 *                  / ::childCount / ::isTransferName
 *   AppleSystemContentService::name / ::vehicleName
 *   DbPnlController::detail / ::resolveNames
 *
 * It turns one stored `as_payload` into exactly the JSON DbPnlController::detail
 * answers with, so the ported renderer (render.ts) can consume it unchanged and
 * the two systems cannot drift into two sets of figures.
 *
 * The one deliberate difference: AppleSystemContentService::resolve() may page
 * the live Apple System API when an id misses the cached catalogue. This app
 * reads the Accounts database and nothing else, so an unresolved id falls back
 * the same way the Accounts side does when its catalogue is cold — to the
 * itinerary name, and failing that to "<Type> #<id>".
 */
import type {
  AsPayload, BreakdownRow, Catalogues, DetailPayload, Json, JsonRecord,
  PnlSummary, ProductRow, ResolvedNames, TransportLeg,
} from './types'
import type { DetailedPnlRow } from './db'

/* ============================================================
 |  Defensive accessors
 * ============================================================ */

/** A numeric reading of anything the payload can hold. Mirrors the renderer's pnum(). */
export function pnum(v: Json): number {
  if (typeof v === 'number') return isFinite(v) ? v : 0
  const n = parseFloat(String(v ?? '').replace(/[^0-9.\-]/g, ''))
  return isFinite(n) ? n : 0
}

/** Apple's API returns some collections as arrays and others as id-keyed objects. */
export function asArray(v: Json): Json[] {
  if (Array.isArray(v)) return v
  if (v && typeof v === 'object') return Object.values(v)
  return []
}

/** A plain object at `key`, or an empty one. Never throws on a `false` section. */
export function obj(v: Json): JsonRecord {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as JsonRecord) : {}
}

/** Walk a dotted path, stopping at the first non-object. */
export function at(root: Json, path: string): Json {
  let node: Json = root
  for (const part of path.split('.')) {
    if (!node || typeof node !== 'object') return undefined
    node = (node as JsonRecord)[part]
  }
  return node
}

function str(v: Json): string {
  return v == null ? '' : String(v)
}

/* ============================================================
 |  Country metadata — AppleSystemApiService::COUNTRIES
 * ============================================================ */

const COUNTRIES: Record<string, [string, string, string]> = {
  '62':  ['Sri Lanka', 'LK', '🇱🇰'],
  '63':  ['Malaysia',  'MY', '🇲🇾'],
  '64':  ['Singapore', 'SG', '🇸🇬'],
  '256': ['Vietnam',   'VN', '🇻🇳'],
}

export function countryMetaByCode(code: string | null | undefined): { name: string; code: string; flag: string } {
  const want = String(code ?? '').toUpperCase()
  for (const [, meta] of Object.entries(COUNTRIES)) {
    if (meta[1] === want) return { name: meta[0], code: meta[1], flag: meta[2] }
  }
  return { name: want || '—', code: want, flag: '🏳️' }
}

/* ============================================================
 |  AppleSystemApiService
 * ============================================================ */

/** extractPnlSummary — the invoicing figures. cost.total is the SELLING price. */
export function extractPnlSummary(pnl: JsonRecord): PnlSummary {
  const info = obj(pnl.quotation_info)
  const sellingTotal = at(pnl, 'cost.total')
  const costTotal    = at(pnl, 'cost_without_markup.total')
  const profitLoss   = pnl.profit_loss

  return {
    agent_name:    info.agent_name == null ? null : String(info.agent_name),
    is_number:     info.is_number == null ? null : String(info.is_number),
    total_pax:     Math.trunc(pnum(info.total_pax)),
    nights:        Math.trunc(pnum(info.nights)),
    days:          Math.trunc(pnum(info.days)),
    currency:      info.currency ? String(info.currency) : 'USD',
    exchange_rate: info.exchange_rate == null ? 1 : pnum(info.exchange_rate),
    is_local:      Boolean(info.is_local),
    selling_total: sellingTotal == null ? null : pnum(sellingTotal),
    cost_total:    costTotal == null ? null : pnum(costTotal),
    profit_loss:   profitLoss == null || String(profitLoss).trim() === '' || isNaN(Number(profitLoss))
                     ? null : Number(profitLoss),
  }
}

/** extractPnlBreakdown — cost components, sell vs buy. */
export function extractPnlBreakdown(pnl: JsonRecord): BreakdownRow[] {
  const sell = obj(pnl.cost)
  const buy  = obj(pnl.cost_without_markup)

  const components: Array<[string, string, (c: JsonRecord) => Json]> = [
    ['hotel',           'Hotel',           c => at(c, 'hotel.cost')],
    ['cruise',          'Cruise',          c => (c.cruise && typeof c.cruise === 'object' ? at(c, 'cruise.cost') : 0)],
    ['attraction',      'Attractions',     c => at(c, 'attraction.cost')],
    ['transport',       'Transport',       c => at(c, 'transport.cost.total')],
    ['hotel_transport', 'Hotel Transfers', c => at(c, 'hotel_transport.total')],
    ['meal',            'Meals',           c => at(c, 'meal.cost.total')],
    ['supplement',      'Supplements',     c => at(c, 'supplement.total')],
    // Free-text charges. A booking quoted as free text files its whole
    // itinerary here, so leaving it out under-states the breakdown badly.
    ['other',           'Other Charges',   c => (c.other && typeof c.other === 'object' ? at(c, 'other.cost') : 0)],
  ]

  const rows: BreakdownRow[] = []
  for (const [key, label, resolve] of components) {
    const sellVal = pnum(resolve(sell))
    const buyVal  = pnum(resolve(buy))
    if (sellVal === 0 && buyVal === 0) continue   // don't show empty lines
    rows.push({ key, label, sell: sellVal, buy: buyVal, margin: sellVal - buyVal })
  }

  // Guide cost lives outside the cost object.
  const guide = pnum(at(pnl, 'guide_data.total'))
  if (guide !== 0) {
    rows.push({ key: 'guide', label: 'Guide', sell: guide, buy: guide, margin: 0 })
  }

  return rows
}

/* ============================================================
 |  AsPnlController helpers
 * ============================================================ */

/**
 * Children travelling. `child` is NOT a third category on top of cwb/cnb — it
 * is their sum — so adding all three double-counts every child.
 */
export function childCount(pax: JsonRecord): number {
  const split = Math.trunc(pnum(pax.cwb)) + Math.trunc(pnum(pax.cnb))
  return split > 0 ? split : Math.trunc(pnum(pax.child))
}

/**
 * The city an itinerary day ends in, read off its route. Only the explicit
 * arrow separates legs — a bare "-" or the word "to" appears inside place names
 * and splitting on either mangles more routes than it resolves.
 */
export function routeCity(route: string): string {
  // The PHP carries a /u flag; every character in the class is BMP, so the
  // pattern is identical without it (and this project targets ES5 lib).
  const legs = String(route ?? '').trim().split(/\s*(?:->|→|–>)\s*/).filter(p => p !== '')
  return (legs.length ? legs[legs.length - 1] : '').trim()
}

/**
 * Does this activity belong under Tour Transfers rather than Attraction?
 *
 * Every `city_tour` is sold as a vehicle-and-driver service, so the whole type
 * moves. Otherwise it is the route wording that decides: a "TRANSFER ONLY"
 * service, or a point-to-point route naming a transport node. A trailing
 * "| SIC Transfers" states the basis a tour is quoted on, not that the line is
 * a transfer, so it alone never moves a row.
 */
export function isTransferName(name: string, type = ''): boolean {
  if (type === 'city_tour') return true

  const route = String(name ?? '').toLowerCase().split('|')[0].trim()
  if (/\btransfers?\s+only\b/.test(route)) return true

  return route.includes(' to ')
    && /\b(airport|hotel|station|port|pier|jetty|terminal)\b/.test(route)
}

/**
 * The tour's journeys, grouped one per destination reached, in travel order.
 *
 * `distance` is metres and `actual_distance` kilometres — an observation, not a
 * documented contract, so the scale is confirmed against the tour total rather
 * than assumed. The test is which candidate lands nearer the total, not whether
 * it reconciles: the API's own total does not always sum its legs.
 */
export function transportLegs(pnl: JsonRecord): TransportLeg[] {
  const mileage = obj(at(pnl, 'cost.transport.transport_data.mileage') ?? at(pnl, 'budget.transport.mileage'))
  const each = mileage.each_details
  if (!each || typeof each !== 'object') return []

  interface Grouped { from: string; to: string; hops: number; raw: number }
  const legs: Grouped[] = []
  let raw = 0

  for (const group of asArray(each)) {
    if (!group || typeof group !== 'object') continue

    const hops: Array<{ from: string; to: string }> = []
    let groupRaw = 0
    for (const leg of asArray(group)) {
      if (!leg || typeof leg !== 'object') continue
      const l = leg as JsonRecord
      const from = str(l.from_name).trim()
      const to   = str(l.to_name).trim()
      if (from === '' && to === '') continue
      const distance = pnum(l.distance)
      raw += distance
      groupRaw += distance
      hops.push({ from, to })
    }
    if (!hops.length) continue

    // The group is one journey: it starts where its first hop starts and ends
    // at the destination the group is keyed by (its last hop's `to`).
    legs.push({ from: hops[0].from, to: hops[hops.length - 1].to, hops: hops.length, raw: groupRaw })
  }
  if (!legs.length) return []

  // Reconcile the leg distances against the tour total to learn their unit.
  const total = pnum(mileage.actual_distance)
  let divisor: number | null = null
  if (total > 0 && raw > 0) {
    const plausible = (v: number) => v / total >= 0.5 && v / total <= 2.0
    if (plausible(raw / 1000)) divisor = 1000
    else if (plausible(raw)) divisor = 1
  }

  return legs.map(leg => ({
    from: leg.from !== '' ? leg.from : '—',
    to:   leg.to !== '' ? leg.to : '—',
    km:   divisor && leg.raw > 0 ? Math.round((leg.raw / divisor) * 10) / 10 : null,
    hops: leg.hops,
  }))
}

/* ============================================================
 |  Catalogue lookups — AppleSystemContentService
 * ============================================================ */

function catalogueName(catalogues: Catalogues, type: string, id: string | number): string | null {
  const map = type === 'attraction' ? catalogues.attraction
            : type === 'city_tour'  ? catalogues.city_tour
            : type === 'excursion'  ? catalogues.excursion
            : null
  if (!map) return null
  const name = map[String(id)]
  return typeof name === 'string' && name.trim() !== '' ? name.trim() : null
}

/** "APV2 (5 SEAT) · 1–4 pax" — vehicleName(). */
export function vehicleName(catalogues: Catalogues, id: Json): string | null {
  const v = catalogues.vehicle[String(id ?? '')]
  if (!v || !v.name.trim()) return null

  let label = v.name.trim()
  const min = v.pax_min || 0
  const max = v.pax_max || 0
  if (max > 0) label += ` · ${min && min !== max ? `${min}–${max}` : max} pax`
  return label
}

/* ============================================================
 |  productRows — the Attraction / Tour Transfers tables
 * ============================================================ */

const PRODUCT_LABELS: Array<[string, string]> = [
  ['attraction', 'Attraction'],
  ['city_tour',  'City Tour'],
  ['excursion',  'Excursion'],
]

/**
 * AsPnlController::productRows.
 *
 * `rates.{type}` carries the COSTED per-person rates; the parallel
 * `{type}_breakdown` carries the gross/selling ones plus the transfer and
 * entrance split. Price off the plain map and fall back to the breakdown only
 * when it is the only one there — the breakdown's higher rates over-state the
 * section.
 *
 * Names come from the catalogue first; failing that from a position-zip against
 * the itinerary's activities of the same type, which is only trusted when the
 * two lists are the same length.
 *
 * IMPORTANT: the breakdown must be walked in INSERTION order, which is the
 * order the API wrote it and the order the itinerary zip assumes. JavaScript
 * objects iterate integer-like keys numerically instead, which silently
 * misaligns every name — so a payload's integer keys are re-ordered back to the
 * order they appear in the raw JSON before zipping (see `orderedKeys`).
 */
export function productRows(
  pnl: JsonRecord,
  itinerary: Json,
  catalogues: Catalogues,
  transfers = false,
  keyOrder?: KeyOrder,
): ProductRow[] {
  const rates    = obj(at(pnl, 'budget.attraction.rates'))
  const pax      = obj(at(pnl, 'quotation_info.pax'))
  const adults   = Math.trunc(pnum(pax.adult))
  const children = childCount(pax)

  // City per itinerary day, as the payload states it; the itinerary's `route`
  // is the fallback.
  const dayCity: Record<string, string> = {}
  for (const [d, c] of Object.entries(obj(pnl.day_city))) {
    const name = str(obj(c).name).trim()
    if (name !== '') dayCity[String(d)] = name
  }

  // Itinerary activities grouped by type, in day order — name plus the day and
  // city it falls on, so the position-zip below carries all three.
  const namesByType: Record<string, Array<{ name: string; day: string; city: string }>> = {}
  for (const day of asArray(itinerary)) {
    const d = obj(day)
    const dayNo = str(d.day).trim()
    const city  = dayCity[dayNo] ?? routeCity(str(d.route))
    for (const act of asArray(d.activities)) {
      const a = obj(act)
      const type = str(a.type)
      const name = str(a.name).trim()
      if (type !== '' && name !== '') {
        ;(namesByType[type] ??= []).push({ name, day: dayNo, city })
      }
    }
  }

  const rows: ProductRow[] = []
  for (const [type, label] of PRODUCT_LABELS) {
    const priced = obj(rates[type])
    const breakdownRaw = obj(rates[`${type}_breakdown`])
    const bd = Object.keys(breakdownRaw).length ? breakdownRaw : priced
    if (!Object.keys(bd).length) continue

    const names = namesByType[type] ?? []
    const ids = orderedKeys(bd, keyOrder?.[Object.keys(breakdownRaw).length ? `${type}_breakdown` : type])
    // Only trust the position-zip when the itinerary lists exactly as many
    // activities of this type as the breakdown has entries.
    const aligned = names.length === ids.length

    let i = 0
    for (const id of ids) {
      const o = bd[id]
      if (!o || typeof o !== 'object') { i++; continue }
      const meta = aligned && names[i] ? names[i] : null
      const name = catalogueName(catalogues, type, id)
        ?? meta?.name
        ?? `${label} #${id}`
      i++
      if (isTransferName(name, type) !== transfers) continue

      const p = obj(priced[id] ?? o)
      const entry = obj(o)
      const aRate = pnum(p.adult)
      const cRate = pnum(p.child)
      rows.push({
        type: label,
        id: String(id),
        name,
        // Day / city drive the sheet's first two columns; the catalogue can
        // name a product the itinerary never dated, so both stay empty rather
        // than guessing when the zip is off.
        day:  meta?.day ?? '',
        city: meta?.city ?? '',
        adultCount: adults,
        adultRate:  aRate,
        childCount: children,
        childRate:  cRate,
        transferRate:      pnum(entry.transfer_rate),
        entranceRate:      pnum(entry.adult_entrance_rate),
        childEntranceRate: pnum(entry.child_entrance_rate),
        total: aRate * adults + cRate * children,
      })
    }
  }
  return rows
}

/* ============================================================
 |  Insertion-order recovery
 * ============================================================ */

/** Raw-JSON key order for the rate maps that get position-zipped. */
export type KeyOrder = Record<string, string[]>

/**
 * The order the API actually wrote each attraction rate map in.
 *
 * `JSON.parse` builds ordinary objects, and an object with integer-like keys
 * iterates them in ascending numeric order — not insertion order. PHP's
 * associative arrays preserve insertion order, so AsPnlController::productRows
 * zips the breakdown against the day-ordered itinerary correctly while a naive
 * JS port zips it against a *sorted* list and mislabels rows whose ids don't
 * happen to ascend with the itinerary.
 *
 * Recovering the order needs the raw text, so the keys are scanned out of the
 * JSON source once, per rate map, before parsing loses them.
 */
export function extractKeyOrder(rawPayload: string): KeyOrder {
  const out: KeyOrder = {}
  // Scoped to budget.attraction.rates. "attraction" alone appears under `cost`
  // and `cost_without_markup` too, so a bare search for the key would read the
  // wrong object entirely.
  const ratesAt = findValueStart(rawPayload, ['pnl', 'budget', 'attraction', 'rates'])
  if (ratesAt == null) return out

  const rateMaps = objectKeysInOrder(rawPayload, ratesAt)
  if (!rateMaps) return out

  for (const [type] of PRODUCT_LABELS) {
    for (const map of [type, `${type}_breakdown`]) {
      const start = rateMaps.get(map)
      if (start == null) continue
      const keys = objectKeysInOrder(rawPayload, start)
      if (keys) out[map] = Array.from(keys.keys())
    }
  }
  return out
}

/**
 * Index of the value at a dotted key path, walking the raw JSON without
 * parsing it. null when any step is missing or is not an object.
 */
function findValueStart(source: string, path: string[]): number | null {
  let at: number | null = skipWs(source, 0)
  for (const key of path) {
    if (at == null) return null
    const entries = objectKeysInOrder(source, at)
    if (!entries) return null
    const next = entries.get(key)
    if (next == null) return null
    at = next
  }
  return at
}

/**
 * The keys of the JSON object beginning at `start`, in SOURCE order, mapped to
 * the index each key's value starts at. null when `start` is not an object —
 * the API writes `false` or `[]` for an empty rate map.
 */
function objectKeysInOrder(source: string, start: number): Map<string, number> | null {
  let i = skipWs(source, start)
  if (source[i] !== '{') return null
  i++

  const out = new Map<string, number>()
  for (;;) {
    i = skipWs(source, i)
    if (source[i] === '}') return out
    if (source[i] !== '"') return out            // malformed — return what we have

    const { value: key, end } = readJsonString(source, i)
    i = skipWs(source, end)
    if (source[i] !== ':') return out
    i = skipWs(source, i + 1)

    // First writing wins, matching PHP: a duplicate key would overwrite the
    // value but keep the original position.
    if (!out.has(key)) out.set(key, i)

    i = skipValue(source, i)
    i = skipWs(source, i)
    if (source[i] === ',') { i++; continue }
    if (source[i] === '}') return out
    return out
  }
}

/** Index just past the JSON value starting at `i`. */
function skipValue(source: string, i: number): number {
  const ch = source[i]
  if (ch === '"') return readJsonString(source, i).end

  if (ch === '{' || ch === '[') {
    let depth = 0
    let j = i
    while (j < source.length) {
      const c = source[j]
      if (c === '"') { j = readJsonString(source, j).end; continue }
      if (c === '{' || c === '[') depth++
      else if (c === '}' || c === ']') {
        depth--
        if (depth === 0) return j + 1
      }
      j++
    }
    return j
  }

  // number / true / false / null — runs until a structural character.
  let j = i
  while (j < source.length && !',}]'.includes(source[j])) j++
  return j
}

function skipWs(source: string, i: number): number {
  while (i < source.length && (source[i] === ' ' || source[i] === '\n' || source[i] === '\r' || source[i] === '\t')) i++
  return i
}

/** Read the JSON string literal starting at `start` (a quote). */
function readJsonString(source: string, start: number): { value: string; end: number } {
  let i = start + 1
  let value = ''
  while (i < source.length) {
    const ch = source[i]
    if (ch === '\\') {
      const next = source[i + 1]
      if (next === 'u') {
        value += String.fromCharCode(parseInt(source.slice(i + 2, i + 6), 16))
        i += 6
      } else {
        const map: Record<string, string> = { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f' }
        value += map[next] ?? next
        i += 2
      }
      continue
    }
    if (ch === '"') return { value, end: i + 1 }
    value += ch
    i++
  }
  return { value, end: i }
}

/**
 * A rate map's keys in the API's own order, falling back to the object's own
 * iteration order when the raw text wasn't available.
 */
function orderedKeys(map: JsonRecord, order: string[] | undefined): string[] {
  const own = Object.keys(map)
  if (!order || !order.length) return own
  const known = new Set(own)
  const out = order.filter(k => known.has(k))
  // Anything the scan missed still has to render.
  for (const k of own) if (!out.includes(k)) out.push(k)
  return out
}

/* ============================================================
 |  resolveNames + the whole payload
 * ============================================================ */

/** DbPnlController::resolveNames — vehicle, day cities and transport legs. */
export function resolveNames(pnl: JsonRecord, catalogues: Catalogues): ResolvedNames {
  const vehicleId = at(pnl, 'cost.transport.transport_data.vehicle.vehicle_type')
    ?? at(pnl, 'budget.transport.vehicle.vehicle_type')

  const cities: Record<string, string> = {}
  for (const [day, c] of Object.entries(obj(pnl.day_city))) {
    const name = str(obj(c).name).trim()
    if (name !== '') cities[String(day)] = name
  }

  return {
    vehicle: vehicleId == null ? null : vehicleName(catalogues, vehicleId),
    cities,
    legs: transportLegs(pnl),
  }
}

/**
 * Build the payload DbPnlController::detail answers with, from one stored
 * record. Returns null when the record carries no P&L — the same 404 the
 * Accounts endpoint gives.
 */
export function buildDetailPayload(
  record: DetailedPnlRow,
  catalogues: Catalogues,
  keyOrder?: KeyOrder,
): DetailPayload | null {
  const payload: AsPayload = record.payload ?? {}
  const pnl = obj(payload.pnl)
  const itinerary = payload.itinerary ?? []

  if (!Object.keys(pnl).length) return null

  const meta = countryMetaByCode(record.country_code)

  return {
    success: true,
    quotation_no: record.as_quotation_no,
    reference_id: record.as_reference_id,
    revision: payload.revision != null ? Number(payload.revision) : record.as_revision,
    // The destination country, so the renderer can apply the charges only one
    // operation bills (driver accommodation is Sri Lanka only).
    country_code: record.country_code ?? null,
    // Row context the Accounts page passes through AP_ROWS; supplied here so
    // the header chips read the same on both systems.
    is_number:  record.is_number,
    tour_ref:   record.tour_ref,
    agent_name: record.agent_name,
    country_name: meta.name,
    country_flag: meta.flag,
    approval_status: record.pnl_approval_status,
    summary:       extractPnlSummary(pnl),
    breakdown:     extractPnlBreakdown(pnl),
    hotels:        pnl.hotels_cruises ?? [],
    parties:       payload.parties ?? {},
    accommodation: payload.accommodation ?? [],
    itinerary,
    pax:        obj(at(pnl, 'quotation_info.pax')),
    per_person: obj(at(pnl, 'cost.pp')),
    products:   productRows(pnl, itinerary, catalogues, false, keyOrder),
    transfers:  productRows(pnl, itinerary, catalogues, true,  keyOrder),
    names:      resolveNames(pnl, catalogues),
    pnl,
  }
}
