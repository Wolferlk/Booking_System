/**
 * Detailed P&L — the costing sheet renderer.
 *
 * A port of the Accounts app's `resources/views/pnl/partials/detailed-pnl-
 * scripts.blade.php` (renderDetailed and every row builder behind it), kept
 * function for function and comment for comment so the two can be diffed. The
 * Accounts version is the reference implementation; nothing here should be
 * "improved" independently of it.
 *
 * Input is the payload derive.ts builds — the same JSON DbPnlController::detail
 * answers with. Output is the section HTML plus the structured rows behind it,
 * so ticket creation costs off the very lines the sheet displays rather than
 * re-deriving them (see tickets.ts).
 *
 * The only intentional departures from the original:
 *   - jQuery's `esc` is a plain HTML escaper.
 *   - The per-row context the Accounts page keeps in the global AP_CURRENT is
 *     carried on the payload instead (is_number / tour_ref / agent_name /
 *     country_name / country_flag), since this app has no such page state.
 */
import { asArray, at, childCount, obj, pnum } from './derive'
import type { DetailPayload, Json, JsonRecord, ProductRow, ResolvedNames } from './types'

/* ============================================================
 |  Formatting
 * ============================================================ */

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}

export function esc(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, c => HTML_ESCAPES[c])
}

export function num(n: unknown): string {
  return Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function money(n: unknown, c?: string): string {
  return `${c || 'USD'} ${num(n)}`
}

function plClass(v: number): string {
  return v > 0 ? 'profit-pos' : v < 0 ? 'profit-neg' : 'profit-zero'
}

/**
 * Whole figures print whole ("70", "266"), fractions keep two decimals. The
 * costing sheet writes nightly rates that way; num() would pad every one of
 * them to "70.00" and make the occupancy cells unreadable.
 */
function num0(v: unknown): string {
  const n = pnum(v as Json)
  return Number.isInteger(n) ? String(n) : num(n)
}

const MONTHS = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** The API's {year, month, day} date object, as the sheet prints it. */
function fmtHsDate(o: Json): string {
  const d = obj(o)
  if (!d.year) return ''
  const m = MONTHS[parseInt(String(d.month), 10)] || String(d.month)
  return `${parseInt(String(d.day), 10) || d.day} ${m} ${d.year}`
}

/* ============================================================
 |  Row builders
 * ============================================================ */

const MEAL_PLANS: Record<string, string> = { '1': 'BB', '2': 'HB', '3': 'FB', '4': 'AI', '5': 'RO' }

export interface Occupancy { rooms?: Json; rates?: Json; rate_text?: Json; count?: Json; rate?: Json }

export interface StayRow {
  name: string
  type: string
  meal: string
  cat: string
  stay: string
  nights: number
  sgl: JsonRecord
  dbl: JsonRecord
  tpl: JsonRecord
  cwb: JsonRecord
  cnb: JsonRecord
  total: number
}

/**
 * Hotels & Cruises — ONE ROW PER STAY, as the costing sheet lists them.
 *
 * `hotels_cruises` is the priced list; the stay metadata (check-in/out, meal
 * plan, room category) lives in `budget.hotel` and `budget.cruise`, which are
 * SEPARATE maps keyed by the stay's position in the whole itinerary.
 * hotels_cruises, however, lists all hotels first and then the cruises, so
 * walking one flat budget.hotel array by list index paired the cruise with a
 * hotel's dates and dropped the last hotel's entirely. Each type therefore
 * keeps its own cursor. Cruises nest their settings under `cruise_settings`.
 */
export function buildHotelRows(pnl: JsonRecord): StayRow[] {
  const list = asArray(pnl.hotels_cruises)
  const budgets: Record<'hotel' | 'cruise', Json[]> = {
    hotel:  asArray(at(pnl, 'budget.hotel')),
    cruise: asArray(at(pnl, 'budget.cruise')),
  }
  const seen = { hotel: 0, cruise: 0 }

  return list.map(raw => {
    const h = obj(raw)
    const kind: 'hotel' | 'cruise' = h.type === 'cruise' ? 'cruise' : 'hotel'
    const b  = obj(budgets[kind][seen[kind]++])
    const bs = obj(b.cruise_settings ?? b.hotel_settings)
    const ci = fmtHsDate(bs.check_in)
    const co = fmtHsDate(bs.check_out)

    return {
      name: h.name ? String(h.name) : '—',
      type: h.type ? String(h.type) : 'hotel',
      meal: MEAL_PLANS[String(bs.meal_type)] || '—',
      cat:  bs.room_category ? `Cat ${bs.room_category}`
          : bs.cabin_type ? `Cabin ${bs.cabin_type}` : '',
      stay: ci && co ? `${ci} → ${co}` : '',
      nights: pnum(h.nights),
      sgl: obj(h.sgl), dbl: obj(h.dbl), tpl: obj(h.tpl),
      cwb: obj(h.cwb), cnb: obj(h.cnb),
      total: pnum(h.total),
    }
  })
}

/**
 * Does any stay use this occupancy? The sheet only carries the columns a
 * booking actually books — a two-adult tour prints SGL and DBL, never an empty
 * TPL column. CWB / CNB are counted rather than roomed, hence the `count`.
 */
function occUsed(rows: StayRow[], k: 'sgl' | 'dbl' | 'tpl' | 'cwb' | 'cnb'): boolean {
  return rows.some(r => pnum(r[k].rooms) > 0 || pnum(r[k].count) > 0)
}

/**
 * Products & Attractions — the fallback builder.
 *
 * Names are resolved server-side against the itinerary and delivered as
 * res.products; this builder only covers payloads that lack them, and labels
 * rows "<Type> #<id>" because it has no itinerary join to offer.
 */
export function buildProductRows(pnl: JsonRecord): ProductRow[] {
  const rates = obj(at(pnl, 'budget.attraction.rates'))
  const pax   = obj(at(pnl, 'quotation_info.pax'))
  const adultCount = pnum(pax.adult)
  const childs = childCount(pax)

  const out: ProductRow[] = []
  for (const [key, label] of [['attraction', 'Attraction'], ['city_tour', 'City Tour'], ['excursion', 'Excursion']]) {
    const priced = obj(rates[key])
    const breakdown = obj(rates[`${key}_breakdown`])
    const bd = Object.keys(breakdown).length ? breakdown : priced

    for (const id of Object.keys(bd)) {
      const o = obj(bd[id])
      if (!bd[id] || typeof bd[id] !== 'object') continue
      const p = obj(priced[id] ?? o)
      const aRate = pnum(p.adult)
      const cRate = pnum(p.child)
      out.push({
        type: label, id: String(id), name: `${label} #${id}`,
        // The browser cannot do the itinerary join, so this fallback has no day
        // or city; they render as "—" rather than a wrong guess.
        day: '', city: '',
        adultCount, adultRate: aRate,
        childCount: childs, childRate: cRate,
        transferRate:      pnum(o.transfer_rate),
        entranceRate:      pnum(o.adult_entrance_rate),
        childEntranceRate: pnum(o.child_entrance_rate),
        total: aRate * adultCount + cRate * childs,
      })
    }
  }
  return out
}

/**
 * Units for the Transport & Services and Others tables, per the operations
 * team's charge sheet: distance is billed per KM, driver bata and guide fees
 * per DAY, driver/guide accommodation per NIGHT, sundries per QTY, and anything
 * billed as a flat figure reads "NA" rather than being left blank — a blank
 * cell reads as missing data.
 */
const U_KM = 'KM', U_DAYS = 'Days', U_NIGHTS = 'Nights', U_QTY = 'Qty', U_NA = 'NA'

/**
 * Sundries the API files under cost.other as free text. They are counted items,
 * so they take Qty; everything else there is a flat charge (NA).
 */
const DT_QTY_WORDS = /\b(garl(?:a|e)nds?|sim(?:\s*cards?)?|king\s*coconuts?|coconuts?|flowers?|bouquets?|wreaths?)\b/i
function dtUnitFor(desc: unknown): string {
  return DT_QTY_WORDS.test(String(desc ?? '')) ? U_QTY : U_NA
}

/**
 * Driver accommodation — {total, days} off the payload's top-level
 * `accommodation` node.
 *
 * Two other places look like they hold this figure and neither does:
 * cost.transport.transport_data.vehicle.driver_accommodation comes back 0 on
 * every live booking, and the per-stay hotel_settings.driver_accommodation flag
 * is absent on most bookings that are nonetheless charged for the driver's
 * room. pnl.accommodation is the real one.
 */
function driverAccommodation(pnl: JsonRecord): { total: number; days: number } {
  const acc = obj(pnl.accommodation)
  return { total: pnum(acc.total), days: pnum(acc.days) }
}

/**
 * Driver accommodation is a Sri Lanka-only charge. The SL operation runs a tour
 * vehicle for the whole trip and rooms the driver overnight, so the room is a
 * real cost on the sheet. Malaysia, Singapore and Vietnam are quoted as
 * point-to-point transfers with a local driver per leg — there is no driver to
 * room, so the line is dropped rather than printed at zero (a zero row reads as
 * "charged nothing", a different claim from "not charged here").
 */
export function billsDriverAccommodation(res: DetailPayload): boolean {
  const code = String(res.country_code ?? '').toUpperCase()
  if (code) return code === 'LK'
  return true
}

export interface TransportRow {
  desc: string
  sub?: string
  unit: string
  count: number | string
  rate: number | string
  total: number
  info?: boolean
}

/**
 * Transport & Services.
 *
 * Two distinct shapes come back from the live API, and the section handles both:
 *
 *  1. Itemised transfers (MY / SG / VN): the vehicle per-unit rates are all
 *     zero and the real charges live in rates.rate_array — one figure per
 *     transfer leg. Each non-zero entry becomes its own line.
 *  2. Per-unit vehicle model (SL): rate_array is empty and the vehicle exposes
 *     rate/km + bata / paging / highway_charges, with one authoritative running
 *     total (cost.transport.cost.total) but NO per-line totals. That total
 *     decomposes as:
 *         actual_distance × rate + bata × days + paging + highway_charges
 *         + guide + accommodation.total
 *     Bata is per DAY; paging and highway charges are flat per-tour figures
 *     already covering the whole tour, so they are NOT multiplied out. The
 *     driver's room is pnl.accommodation, and the guide is INSIDE this total,
 *     so it must not be added on top of it anywhere.
 *
 * Guide accommodation is billed with the hotel costing, NOT inside
 * cost.transport.cost.total, so it is marked `info` — listed for visibility but
 * excluded from this section's line sum and subtotal.
 */
export function buildTransportRows(
  pnl: JsonRecord,
  names: ResolvedNames | undefined,
  showDriverAcc?: boolean,
): TransportRow[] {
  const driverAcc = showDriverAcc !== false
  const cost = obj(pnl.cost)
  const tr   = obj(cost.transport)
  const td   = obj(tr.transport_data)
  const veh  = obj(td.vehicle)
  const qi   = obj(pnl.quotation_info)
  const guide = obj(pnl.guide_data)
  const rows: TransportRow[] = []

  const km       = pnum(at(td, 'mileage.actual_distance'))
  const vehRate  = pnum(veh.rate)
  const runTotal = pnum(at(tr, 'cost.total'))        // vehicle + running, authoritative
  const rateArrRaw = at(td, 'rates.rate_array')
  const rateArr: Json[] = Array.isArray(rateArrRaw) ? rateArrRaw : []
  const days   = pnum(qi.days)
  const nights = pnum(qi.nights)
  const vehicle = names?.vehicle ? String(names.vehicle) : ''

  // Shape 1 — itemised transfer charges.
  const hasRateArray = rateArr.some(r => pnum(r) !== 0)
  if (hasRateArray) {
    const nonZero = rateArr.filter(r => pnum(r) !== 0)
    const many = nonZero.length > 1
    // Name each charge by the route it pays for. names.legs is the API's
    // mileage.each_details grouped into one journey per destination reached,
    // in travel order — the same unit rate_array prices, so the two line up
    // 1:1. Align by raw index when every rate has a leg, otherwise by the order
    // of the charged legs. If neither count matches, the legs stay numbered
    // rather than risk labelling a charge with someone else's route.
    const legs = Array.isArray(names?.legs) ? names!.legs : []
    const byRaw = legs.length > 0 && legs.length === rateArr.length
    const byCharged = !byRaw && legs.length > 0 && legs.length === nonZero.length
    let idx = 0

    rateArr.forEach((r, i) => {
      const val = pnum(r)
      if (val === 0) return
      idx++
      const leg = byRaw ? legs[i] : byCharged ? legs[idx - 1] : null
      const sub: string[] = []
      if (leg && many) sub.push(`Leg ${idx}`)
      if (idx === 1 && vehicle) sub.push(vehicle)
      // One charge, more than one hop to get there — say so rather than let the
      // end-to-end label imply a single drive.
      if (leg && pnum(leg.hops) > 1) sub.push(`${pnum(leg.hops)} hops`)
      if (leg && leg.km) sub.push(`≈ ${num0(leg.km)} km`)
      if (idx === 1 && km > 0) sub.push(`Total distance ≈ ${num(km)} km`)
      rows.push({
        desc: leg ? `${leg.from} → ${leg.to}` : many ? `Transport — Leg ${idx}` : 'Transport',
        sub: sub.join(' · '),
        unit: U_NA, count: '', rate: '', total: val,
      })
    })

    // Driver accommodation is charged on this shape too, but NOT through the
    // transport total: cost.transport.cost.total equals the rate_array sum to
    // the cent, with pnl.accommodation sitting outside it. Listed for
    // visibility and marked `info` so it stays out of the subtotal.
    const raAcc = driverAccommodation(pnl)
    if (driverAcc && raAcc.total !== 0) {
      rows.push({
        desc: 'Driver Accommodation', sub: 'Billed within the accommodation costing',
        unit: U_NIGHTS, count: raAcc.days || '',
        rate: raAcc.days && raAcc.total ? raAcc.total / raAcc.days : '',
        total: raAcc.total, info: true,
      })
    }
  } else {
    // Shape 2 — per-unit vehicle model.
    const travel = km > 0 ? km * vehRate : 0
    if (travel !== 0) {
      rows.push({ desc: 'Transport', sub: vehicle, unit: U_KM, count: Math.round(km), rate: vehRate, total: travel })
    }
    // Split the rest of the vehicle running total into its own lines.
    const running = runTotal - travel
    const bata = pnum(veh.bata), paging = pnum(veh.paging), highway = pnum(veh.highway_charges)
    let itemised = 0

    if (bata && days) {
      const bataTotal = bata * days
      itemised += bataTotal
      rows.push({ desc: 'Bata', sub: 'Driver bata', unit: U_DAYS, count: days, rate: bata, total: bataTotal })
    }
    if (paging) {
      itemised += paging
      rows.push({ desc: 'Paging', sub: 'Per tour', unit: U_NA, count: '', rate: paging, total: paging })
    }
    // Highway charges print even at zero — the Apple System charge sheet lists
    // them on every SL tour, and a missing row reads as missing data rather
    // than "nothing was charged".
    itemised += highway
    rows.push({ desc: 'Highway Charges', sub: 'Expressway / toll charges', unit: U_NA, count: '', rate: highway, total: highway })

    // Driver accommodation is charged at a flat rate per day; the API gives the
    // total and the day count, so the rate is derived rather than invented.
    // Countries that don't room the driver skip the line entirely and leave the
    // amount out of `itemised`, so anything the payload still carries there
    // falls into the balancing line below instead of going missing.
    if (driverAcc) {
      const dacc = driverAccommodation(pnl)
      itemised += dacc.total
      rows.push({
        desc: 'Driver Accommodation',
        sub: dacc.days ? `Driver roomed for ${dacc.days}${dacc.days === 1 ? ' night' : ' nights'}` : '',
        unit: U_NIGHTS, count: dacc.days || '',
        rate: dacc.days && dacc.total ? dacc.total / dacc.days : '',
        total: dacc.total,
      })
    }

    // The guide rides INSIDE cost.transport.cost.total on this shape, and the
    // decomposition only closes once it is counted. The Guide Fee row further
    // down counts towards the subtotal, so it has to enter `itemised` here as
    // well; otherwise the balancing line pays the guide a second time.
    itemised += pnum(guide.total)

    // Whatever the exposed rates still can't account for. On a guide-only tour
    // this balance IS the guide fee restated: show it for visibility but mark
    // it `info` so it stays out of the subtotal.
    const other = running - itemised
    if (Math.abs(other) > 0.005) {
      const bundledGuide = guideBundledInTransport(pnl)
      rows.push({
        desc: bundledGuide ? 'Guide Transport' : itemised ? 'Other Transport Charges' : 'Vehicle Running Costs',
        sub:  bundledGuide ? 'Already billed under Guide Fee — excluded from the subtotal'
                           : 'Balance of the API transport total after the itemised lines',
        unit: U_NA, count: '', rate: '', total: other, info: bundledGuide,
      })
    }
  }

  const single = (desc: string, val: Json, unit?: string, sub?: string) => {
    const n = pnum(val)
    if (n !== 0) rows.push({ desc, sub: sub || '', unit: unit || U_NA, count: '', rate: '', total: n })
  }
  single('Meal Transfers', at(td, 'meal_transfer.cost'))
  single('Hotel Transfers', at(cost, 'hotel_transport.total'))

  // Guide fee is a day rate; the API exposes only the total, so the per-day
  // rate is derived rather than invented. Printed even at zero — an unguided
  // tour still has to say so explicitly.
  const guideFee = pnum(guide.total)
  rows.push({
    desc: 'Guide Fee', unit: U_DAYS,
    count: days || '', rate: days && guideFee ? guideFee / days : '', total: guideFee,
  })
  // Guide accommodation is per night and, like the driver's, rides with the
  // hotel costing — informational only.
  const guideAcc = pnum(guide.accommodation != null ? guide.accommodation : guide.accommodation_total)
  if (guideAcc) {
    rows.push({
      desc: 'Guide Accommodation', sub: 'Billed within the accommodation costing',
      unit: U_NIGHTS, count: nights || '', rate: nights ? guideAcc / nights : '', total: guideAcc, info: true,
    })
  }

  single('Supplements', at(cost, 'supplement.total'))

  const wb = cost.water_bottle
  if (wb && typeof wb === 'object') {
    const wbCost = pnum(obj(wb).cost)
    if (wbCost !== 0) {
      const wbRate = pnum(at(wb, 'PP.adult.rate'))
      const adults = pnum(at(qi, 'pax.adult'))
      rows.push({
        desc: 'Water',
        sub: wbRate ? `Adult @ ${num(wbRate)}${adults ? ` × ${adults} pax` : ''}` : '',
        unit: U_NA, count: adults || '', rate: wbRate || '', total: wbCost,
      })
    }
  } else {
    single('Water', wb)
  }

  return rows
}

/** The transport lines that count towards the section subtotal — all but `info`. */
function transportCosted(rows: TransportRow[]): TransportRow[] {
  return rows.filter(r => !r.info)
}

/**
 * Guide-only tours carry no vehicle, yet the API still fills
 * cost.transport.cost.total — and for those it duplicates the guide fee there.
 * Adding guide_data.total on top would count the guide twice. Detect that case:
 * no mileage, no vehicle rate, no per-leg transfer array, no itemised vehicle
 * charges, and the transport total equalling the guide fee.
 */
function guideBundledInTransport(pnl: JsonRecord): boolean {
  const cost = obj(pnl.cost)
  const tr = obj(cost.transport), td = obj(tr.transport_data)
  const veh = obj(td.vehicle)
  const km = pnum(at(td, 'mileage.actual_distance'))
  const vehRate = pnum(veh.rate)
  const rateArrRaw = at(td, 'rates.rate_array')
  const rateArr: Json[] = Array.isArray(rateArrRaw) ? rateArrRaw : []
  const hasRateArray = rateArr.some(r => pnum(r) !== 0)
  const itemised = pnum(veh.bata) + pnum(veh.paging) + pnum(veh.highway_charges) + pnum(veh.driver_accommodation)
  const runTotal = pnum(at(tr, 'cost.total'))
  const guideFee = pnum(at(pnl, 'guide_data.total'))

  return km <= 0 && vehRate <= 0 && !hasRateArray && Math.abs(itemised) < 0.005
    && guideFee !== 0 && Math.abs(runTotal - guideFee) < 0.005
}

/**
 * The API's own transport figures, summed — the authority the rendered lines
 * must reconcile to. Shape-1 rate_array entries are components of
 * cost.transport.cost.total, so that total (never the array sum) is the
 * baseline.
 *
 * guide_data.total is NOT a charge of its own: cost.transport.guide is a child
 * of the transport node and is already inside cost.transport.cost.total. The
 * single exception is the guide-only tour, where transport.cost.total IS the
 * guide fee restated: there the total is dropped and the guide counted
 * directly, so the guide is billed once either way.
 */
function transportApiTotal(pnl: JsonRecord, transferSum: number): number {
  const cost = obj(pnl.cost)
  const tr = obj(cost.transport), td = obj(tr.transport_data)
  const wb = cost.water_bottle

  return (guideBundledInTransport(pnl) ? pnum(at(pnl, 'guide_data.total')) : pnum(at(tr, 'cost.total')))
    + pnum(at(td, 'meal_transfer.cost'))
    + pnum(at(cost, 'hotel_transport.total'))
    + pnum(at(cost, 'supplement.total'))
    + (wb && typeof wb === 'object' ? pnum(obj(wb).cost) : pnum(wb))
    + pnum(transferSum)
}

export interface MealRow {
  day: number
  adults: number
  children: number
  slots: Record<string, { adultRate: number; childRate: number; total: number }>
  total: number
}

/**
 * Meals.
 *
 * Restaurant meals live under `meal_rates`, keyed by meal slot 1/2/3 =
 * Breakfast / Lunch / Dinner, as meal_rates.adult[day][slot] per-person rates.
 * Most live bookings carry meal_rates = false (meals are on the hotel plan), so
 * this yields no rows and the section reads "No line items". When present, each
 * day becomes one row; cost.meal.cost.total stays the authoritative total.
 */
export function buildMealRows(pnl: JsonRecord): MealRow[] {
  const mr = pnl.meal_rates
  const pax = obj(at(pnl, 'quotation_info.pax'))
  const adults = pnum(pax.adult)
  const children = childCount(pax)
  if (!mr || typeof mr !== 'object') return []

  const adultDays = obj(obj(mr).adult)
  const childDays = obj(obj(mr).child)
  const dayKeys = (Object.keys(adultDays).length ? Object.keys(adultDays) : Object.keys(childDays))
    .sort((a, b) => pnum(a) - pnum(b))   // numeric day order, top to bottom

  const rows: MealRow[] = []
  for (const day of dayKeys) {
    const a = obj(adultDays[day]), c = obj(childDays[day])
    const slots: MealRow['slots'] = {}
    let dayTotal = 0, any = false

    for (const k of ['1', '2', '3']) {
      const ar = pnum(a[k]), cr = pnum(c[k])
      const t = ar * adults + cr * children
      slots[k] = { adultRate: ar, childRate: cr, total: t }
      dayTotal += t
      if (ar || cr) any = true
    }
    if (any) rows.push({ day: pnum(day), adults, children, slots, total: dayTotal })
  }
  return rows
}

/**
 * Others.
 *
 * Catch-all for anything the API prices that the fixed sections don't render.
 * `cost` is an open-ended map, so rather than hard-coding another list that
 * goes stale, walk every cost key, skip the ones already itemised elsewhere and
 * the non-monetary metadata, and list the rest here.
 */
const DT_COST_RENDERED = ['hotel', 'cruise', 'attraction', 'transport', 'hotel_transport', 'meal', 'supplement', 'water_bottle']
const DT_COST_META     = ['total', 'currency', 'pp', 'pax_cost', 'cost_pp', 'cost_type', 'room_type_cost', 'child_cost', 'cost_cut_pkg']

export interface OtherRow {
  desc: string
  unit: string
  sub: string
  count: number | string
  rate: number | string
  total: number
}

/**
 * Monetary value of an arbitrary cost node: a bare number, or the usual
 * total / cost / cost.total / amount wrappers. null when there's no figure.
 */
function dtAmount(v: Json): number | null {
  if (v == null || v === false || v === '') return null
  if (typeof v === 'number') return v
  if (typeof v === 'string') return /\d/.test(v) ? pnum(v) : null   // pnum maps junk to 0, so gate on a digit
  if (typeof v !== 'object') return null
  const o = obj(v)
  if (typeof o.total === 'number' || typeof o.total === 'string') return pnum(o.total)
  if (typeof o.cost === 'number' || typeof o.cost === 'string') return pnum(o.cost)
  if (o.cost && typeof o.cost === 'object' && obj(o.cost).total != null) return pnum(at(o, 'cost.total'))
  if (o.amount != null) return pnum(o.amount)
  if (o.value != null) return pnum(o.value)
  if (o.rate != null) return pnum(o.rate)
  return null
}

/** "hotel_transport" → "Hotel Transport"; leaves already-readable names alone. */
function dtLabel(key: string): string {
  return String(key).replace(/[_-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

function dtOtherRow(key: string, node: Json, parentLabel: string): OtherRow | null {
  const o = obj(node)
  const name = node && typeof node === 'object' && (o.name || o.description || o.label)
    ? String(o.name || o.description || o.label)
    : dtLabel(key)
  const amt = dtAmount(node)
  if (amt == null || amt === 0) return null
  const desc = parentLabel ? `${parentLabel} — ${name}` : name

  return {
    desc,
    unit: dtUnitFor(desc),
    sub: node && typeof node === 'object' && o.remark ? String(o.remark) : '',
    count: node && typeof node === 'object' && o.count != null ? pnum(o.count) : '',
    rate:  node && typeof node === 'object' && o.rate != null && o.total != null ? pnum(o.rate) : '',
    total: amt,
  }
}

/**
 * The `{cost, PP:{adult:[{text,rate}]}}` shape — how the API itemises `other`.
 * Each PP entry is one charge at a PER-PERSON rate: node.cost equals
 * sum(PP[bucket][].rate) × that bucket's pax count.
 *
 * A booking can carry several buckets for the same charge, and `child` is
 * cwb + cnb, so it is only used when neither split bucket is present —
 * otherwise the children would be counted twice.
 */
function dtPpRows(node: Json, label: string, pax: JsonRecord): OtherRow[] {
  const pp = obj(node).PP
  if (!pp || typeof pp !== 'object') return []

  const counts: Record<string, number> = {
    adult: pnum(pax.adult),
    child: childCount(pax),
    cwb:   pnum(pax.cwb),
    cnb:   pnum(pax.cnb),
  }
  const ppo = obj(pp)
  const buckets = ppo.cwb || ppo.cnb ? ['adult', 'cwb', 'cnb'] : ['adult', 'child']
  const labels: Record<string, string> = { cwb: 'CWB rate', cnb: 'CNB rate', child: 'Child rate' }

  const rows: OtherRow[] = []
  for (const bucket of buckets) {
    const count = counts[bucket]
    for (const raw of asArray(ppo[bucket])) {
      const x = obj(raw)
      const rate = pnum(x.rate)
      if (!rate || !count) continue
      const desc = x.text || x.name ? String(x.text || x.name) : label
      rows.push({ desc, unit: dtUnitFor(desc), sub: labels[bucket] || '', count, rate, total: rate * count })
    }
  }
  return rows
}

/**
 * The `{cost, PQ:[{text,rate}]}` shape — the OTHER itemisation bucket.
 *
 * PQ prices per QUOTATION, not per person: the entry's rate IS the whole
 * charge, already covering the group, so it must NOT be multiplied out by pax
 * the way dtPpRows multiplies a PP rate. PQ always arrives as a flat list.
 */
function dtPqRows(node: Json, label: string): OtherRow[] {
  const pq = obj(node).PQ
  if (!pq || typeof pq !== 'object') return []

  const rows: OtherRow[] = []
  for (const raw of asArray(pq)) {
    const x = obj(raw)
    const rate = pnum(x.rate)
    if (!rate) continue
    const desc = x.text || x.name ? String(x.text || x.name) : label
    rows.push({
      desc, unit: dtUnitFor(desc),
      // Count and rate are deliberately blank rather than "1 × 106.20": the
      // charge has no per-unit rate to quote, and a count of 1 next to a Pax
      // column reading "A9" invites the reader to wonder which one is wrong.
      sub: 'Whole-booking charge', count: '', rate: '', total: rate,
    })
  }
  return rows
}

/**
 * The API files ad-hoc meals under `cost.other` alongside genuinely
 * miscellaneous charges. Meals belong in the Meals section; a train ticket and
 * anything else stays under Others. Nothing in the payload marks the
 * difference, so the description is the only signal available.
 */
const DT_MEAL_SLOT_WORDS: Array<[RegExp, string]> = [[/\bbreakfast\b/i, '1'], [/\blunch\b/i, '2'], [/\bdinner\b/i, '3']]
function dtMealSlotOf(desc: unknown): string | null {
  const s = String(desc ?? '')
  for (const [re, slot] of DT_MEAL_SLOT_WORDS) if (re.test(s)) return slot
  return null
}

/**
 * Transfer wording in a free-text charge name — the JS half of isTransferName,
 * minus the id-typed city_tour rule (a free-text line has no breakdown type).
 */
function dtIsTransferDesc(desc: unknown): boolean {
  const route = String(desc ?? '').toLowerCase().split('|')[0].trim()
  if (/\btransfers?\s+only\b/.test(route)) return true
  return route.includes(' to ') && /\b(airport|hotel|station|port|pier|jetty|terminal)\b/.test(route)
}

/**
 * A sightseeing product rather than a miscellaneous charge. Bookings whose
 * tours are quoted as free text file the whole itinerary under cost.other with
 * an empty budget.attraction.rates, so the wording is the only signal that
 * these are the products the Attraction section exists to show.
 */
const DT_PRODUCT_WORDS = /\b(tours?|sightseeing|excursions?|tickets?|entrance|admission|show|cruise|park|safari|museum|temple|zoo|cable\s*car|speed\s*boat|fishing|trekking|rafting|snorkell?ing|diving|spa|massage)\b/i

/**
 * A tour marker beats a meal word in the same name — half-day tours are quoted
 * with their inclusions spelled out, and the bare word "lunch" would otherwise
 * file a product under Meals. Only these strong markers override; a plain
 * "Dinner at the hotel" still reads as a meal.
 */
const DT_TOUR_MARKERS = /\b(tours?|sightseeing|excursions?|trip|cable\s*car|safari|cruise)\b/i

/** The PVT / SIC prefix the API puts on a quoted tour service — a tour marker in its own right. */
const DT_TOUR_PREFIX = /^\s*\(?\s*(pvt|sic)\b/i
function dtIsTour(desc: unknown): boolean {
  const s = String(desc ?? '')
  return DT_TOUR_PREFIX.test(s) || DT_TOUR_MARKERS.test(s)
}

/**
 * Does the API already price this booking's attractions from
 * budget.attraction.rates? When it does, the Attraction section stands on its
 * own API figure and free-text tour charges out of cost.other must NOT be
 * folded into it — that double-books the section.
 */
function hasAttractionRates(pnl: JsonRecord): boolean {
  const rates = obj(at(pnl, 'budget.attraction.rates'))
  return ['attraction', 'city_tour', 'excursion'].some(k =>
    Object.keys(obj(rates[k])).length > 0 || Object.keys(obj(rates[`${k}_breakdown`])).length > 0)
}

export interface MealExtraRow { label: string; slot: string; rate: number; count: number; total: number }

interface OtherSplit {
  meals: MealExtraRow[]
  products: ProductRow[]
  transport: TransportRow[]
  others: OtherRow[]
}

/**
 * Free-text charges the API lumps into cost.other, routed to the section each
 * one actually belongs to: a meal slot in the name → Meals, transfer wording →
 * Transport, sightseeing wording → Attraction, everything else stays put.
 */
function splitMealCharges(rows: OtherRow[], pax: JsonRecord, attractionRates: boolean): OtherSplit {
  const meals: MealExtraRow[] = [], products: ProductRow[] = [],
        transport: TransportRow[] = [], others: OtherRow[] = []

  for (const r of rows) {
    const slot = dtIsTour(r.desc) ? null : dtMealSlotOf(r.desc)

    if (dtIsTransferDesc(r.desc)) {
      transport.push({ desc: r.desc, sub: r.sub, unit: U_QTY, count: pnum(r.count), rate: pnum(r.rate), total: pnum(r.total) })
    } else if (slot) {
      meals.push({ label: r.desc, slot, rate: pnum(r.rate), count: pnum(r.count), total: pnum(r.total) })
    } else if ((dtIsTour(r.desc) || DT_PRODUCT_WORDS.test(r.desc)) && !attractionRates) {
      // Free-text-only itineraries: the Attraction section has no API rates of
      // its own, so these tour charges are the products it shows. When the API
      // DOES price attractions, the row falls through to Others instead —
      // folding it in would double-book the section.
      //
      // The row is one pax class's share of the charge; keep its own count and
      // rate on the line rather than re-deriving them from the pax block, so an
      // adult line and a CNB line stay distinguishable.
      const isChild = r.sub === 'CWB rate' || r.sub === 'CNB rate' || r.sub === 'Child rate'
      products.push({
        type: isChild ? r.sub.replace(/ rate$/, '') : 'Tour',
        id: '', name: r.desc, day: '', city: '',
        adultCount: isChild ? 0 : pnum(r.count), adultRate: isChild ? 0 : pnum(r.rate),
        childCount: isChild ? pnum(r.count) : 0, childRate: isChild ? pnum(r.rate) : 0,
        transferRate: 0, entranceRate: 0, childEntranceRate: 0,
        total: pnum(r.total),
      })
    } else {
      others.push(r)
    }
  }
  return { meals, products, transport, others }
}

export function buildOtherRows(pnl: JsonRecord): OtherRow[] {
  const cost = obj(pnl.cost)
  const pax = obj(at(pnl, 'quotation_info.pax'))
  const rows: OtherRow[] = []

  for (const key of Object.keys(cost)) {
    if (DT_COST_RENDERED.includes(key) || DT_COST_META.includes(key)) continue
    const node = cost[key]
    if (node == null || node === false) continue

    const label = dtLabel(key)
    const own = dtOtherRow(key, node, '')

    // Itemised charges — one line each, not a lumped total. A node can carry
    // both buckets at once, so they are concatenated rather than treated as
    // alternatives: PP prices per person, PQ prices the booking.
    const itemRows = dtPpRows(node, label, pax).concat(dtPqRows(node, label))
    if (itemRows.length) {
      for (const r of itemRows) rows.push(r)
      // Anything the itemised lines don't account for still has to show.
      const bal = pnum(own?.total) - itemRows.reduce((a, r) => a + r.total, 0)
      if (Math.abs(bal) > 0.01) {
        rows.push({ desc: `${label} — unitemised`, unit: U_NA, sub: '', count: '', rate: '', total: bal })
      }
      continue
    }

    // A node that prices itself but itemises nothing becomes one row…
    if (own) { rows.push(own); continue }

    // …otherwise look one level in for a list/map of priced entries.
    if (typeof node !== 'object') continue
    const n = obj(node)
    for (const coll of [node, n.break_down, n.breakdown, n.items, n.list]) {
      if (!coll || typeof coll !== 'object') continue
      for (const [k, v] of Object.entries(obj(coll))) {
        if (k === 'break_down' || k === 'breakdown' || k === 'items' || k === 'list') continue
        const r = dtOtherRow(k, v, label)
        if (r) rows.push(r)
      }
    }
  }
  return rows
}

/* ============================================================
 |  Presentation helpers
 * ============================================================ */

function dtBlock(
  title: string, colour: string, headCols: string, bodyHtml: string,
  subTotal: number | null, cur: string, note?: string | null,
): string {
  const st = subTotal != null ? `<span class="sub-total">${money(subTotal, cur)}</span>` : ''
  let h = `<div class="dt-block"><div class="dt-block-head"><span class="t">`
        + `<span class="ic" style="background:${colour}"></span>${title}</span>${st}</div>`

  if (bodyHtml) {
    h += `<div class="dt-scroll"><table class="dt-table"><thead><tr>${headCols}</tr></thead>${bodyHtml}</table></div>`
  } else {
    h += `<div class="dt-empty">No line items returned for this section.</div>`
  }
  if (note) h += `<div class="dt-note">${note}</div>`
  return `${h}</div>`
}

/** The fact box the sheet opens with — booking identity and currency terms. */
function dtFacts(pairs: Array<[string, string]>): string {
  let h = '<div class="cs-facts">'
  for (const [l, v] of pairs) h += `<div class="cs-fact"><span class="l">${l}</span><span class="v">${v}</span></div>`
  return `${h}</div>`
}

/** Room type ids as the API's per-person costing keys them. */
const DT_ROOM_TYPES: Record<string, string> = { '1': 'Single', '2': 'Double', '3': 'Triple', '4': 'Quad' }

/**
 * The six costing sections as a categorical series — fixed slot order, never
 * cycled, so Hotels is always blue whichever sections a booking happens to
 * carry. The same colour drives the section's icon and its segment of the
 * composition bar, so the two read as one system. Three of these sit under 3:1
 * on white, which is why the legend always spells out name + amount + share
 * rather than relying on the swatch.
 */
const DT_SERIES = [
  { key: 'hotels',    label: 'Hotels',         colour: '#2a78d6' },
  { key: 'products',  label: 'Attraction',     colour: '#008300' },
  { key: 'transfers', label: 'Tour Transfers', colour: '#e87ba4' },
  { key: 'transport', label: 'Transport',      colour: '#eda100' },
  { key: 'meals',     label: 'Meals',          colour: '#1baf7a' },
  { key: 'others',    label: 'Others',         colour: '#eb6834' },
] as const

type SectionKey = typeof DT_SERIES[number]['key']

/**
 * Where the tour's money goes: one stacked bar across the sections that carry
 * cost, plus a legend that direct-labels every one of them. Sections priced at
 * zero are dropped rather than drawn as a hairline nobody can hit.
 */
function dtFlow(totals: Record<SectionKey, number>, cur: string): string {
  const parts = DT_SERIES.map(s => ({ s, v: pnum(totals[s.key]) })).filter(p => p.v > 0)
  const sum = parts.reduce((a, p) => a + p.v, 0)
  if (!parts.length || sum <= 0) return ''

  let bar = '<div class="dtf-bar">', leg = '<div class="dtf-legend">'
  for (const p of parts) {
    const share = (p.v / sum) * 100
    bar += `<div class="dtf-seg" style="flex:${share.toFixed(4)};background:${p.s.colour}" `
         + `title="${esc(p.s.label)} · ${esc(money(p.v, cur))} · ${share.toFixed(1)}%"></div>`
    leg += `<div class="dtf-item"><span class="sw" style="background:${p.s.colour}"></span>`
         + `<span class="nm">${esc(p.s.label)}</span><span class="am">${num(p.v)}</span>`
         + `<span class="pc">${share.toFixed(1)}%</span></div>`
  }
  return `<div class="dt-flow"><div class="h"><span class="t">Where the cost sits</span>`
       + `<span class="s">${parts.length} priced sections · ${esc(money(sum, cur))}</span></div>`
       + `${bar}</div>${leg}</div>`
}

function dtColour(key: SectionKey): string {
  return DT_SERIES.find(x => x.key === key)?.colour ?? '#475569'
}

const MEAL_PLAN_NAMES: Record<string, string> = {
  BB: 'Bed & Breakfast', HB: 'Half Board', FB: 'Full Board', AI: 'All Inclusive', RO: 'Room Only',
}
function mealBadge(code: string): string {
  const c = String(code ?? '').toUpperCase()
  if (!MEAL_PLAN_NAMES[c]) return '<span class="dt-muted">—</span>'
  return `<span class="mp ${c.toLowerCase()}" title="${esc(MEAL_PLAN_NAMES[c])}">${esc(c)}</span>`
}

/** An occupancy cell as rate chips: one chip per night, then "× rooms". */
function occChips(occ: JsonRecord): string {
  const rooms = pnum(occ.rooms)
  const rates = Array.isArray(occ.rates) && occ.rates.length ? occ.rates : [occ.rate_text ?? 0]
  let h = `<span class="occ${rooms > 0 ? '' : ' off'}">`
  for (const r of rates) h += `<span class="r">${esc(num0(r))}</span>`
  return `${h}<span class="x">×</span><span class="n">${rooms}</span></span>`
}

/** Which room types a stay actually books — "Double", or "Single + Double". */
function stayRoomTypes(h: StayRow): string {
  const out = ([['sgl', 'Single'], ['dbl', 'Double'], ['tpl', 'Triple']] as const)
    .filter(o => pnum(h[o[0]].rooms) > 0).map(o => o[1] as string)
  for (const o of [['cwb', 'CWB'], ['cnb', 'CNB']] as const) {
    if (pnum(h[o[0]].count) > 0) out.push(o[1])
  }
  return out.length ? out.join(' + ') : '—'
}

/** Rooms booked across every adult occupancy of one stay. */
function stayRooms(h: StayRow): number {
  return pnum(h.sgl.rooms) + pnum(h.dbl.rooms) + pnum(h.tpl.rooms)
}

/**
 * Heads sleeping in one stay, split adult / child: adults are however many the
 * rooms sleep (single 1, double 2, triple 3), children are the counted CWB/CNB.
 */
function stayHeads(h: StayRow): { adults: number; children: number } {
  return {
    adults:   pnum(h.sgl.rooms) + pnum(h.dbl.rooms) * 2 + pnum(h.tpl.rooms) * 3,
    children: pnum(h.cwb.count) + pnum(h.cnb.count),
  }
}

/**
 * The arithmetic behind a section total, written out under it: the line totals
 * added up when the list is short enough to read across the footer, otherwise
 * just how many of them were summed. Zero lines are left out. `extra` is the
 * section's balancing term: it joins the equation but is named rather than
 * counted as a line, since it is not one. Negative terms are subtracted rather
 * than printed as "+ -105.00".
 */
function calcNote(values: unknown[], total: number, noun: string, extra?: number): string {
  const vals = values.map(v => pnum(v as Json)).filter(v => Math.abs(v) > 0.004)
  const n = vals.length, bal = pnum(extra), hasBal = Math.abs(bal) > 0.004
  const lead = `${n} ${noun}${n === 1 ? '' : 's'} added up`
    + (hasBal ? (bal > 0 ? ' plus the unitemised balance' : ' less the unitemised balance') : '')

  let list = ''
  if (n && n <= 6) {
    list = vals.map((v, i) => (i === 0 ? (v < 0 ? '−' : '') : (v < 0 ? ' − ' : ' + ')) + num(Math.abs(v))).join('')
    if (hasBal) list += (bal < 0 ? ' − ' : ' + ') + num(Math.abs(bal))
    list += ' = '
  }
  return `${lead} · ${list}${num(total)}`
}

/* ============================================================
 |  renderDetailed
 * ============================================================ */

/** Everything the sheet produced — the HTML, and the rows behind it. */
export interface DetailedPnl {
  html: string
  currency: string
  tables: {
    stays: StayRow[]
    products: ProductRow[]
    transfers: ProductRow[]
    transport: TransportRow[]
    meals: MealRow[]
    mealExtras: MealExtraRow[]
    others: OtherRow[]
  }
  totals: {
    hotels: number
    products: number
    transfers: number
    transport: number
    meals: number
    others: number
    grand: number
    cost: number
    profit: number
    margin: number
  }
  /** Day number → the itinerary date it falls on, for ticket dating. */
  dayDates: Record<string, string>
}

/**
 * The Detailed P&L — the operations costing sheet.
 *
 * Laid out section for section as the signed-off Word costing sheet the
 * operations team costs a tour on: a booking fact box, Hotels with one row per
 * stay and an occupancy column per room type, Attraction and Tour Transfers as
 * two SEPARATE day/city tables, Transport as a plain expense list, and the
 * result block (cost per person, total tour cost, total without markup,
 * profit).
 *
 * Meals and Others are not on the paper sheet, but the live API prices them on
 * bookings the sheet was never drawn for, so they render after Transport rather
 * than silently dropping real cost out of the report.
 */
export function renderDetailed(res: DetailPayload): DetailedPnl {
  const pnl = obj(res.pnl)
  const s = res.summary
  const cur = s.currency || 'USD'
  const qi = obj(pnl.quotation_info)
  const pax = Object.keys(obj(qi.pax)).length ? obj(qi.pax) : obj(res.pax)

  // Products carry itinerary-resolved names, days and cities from the
  // derivation; the payload-only builder is a fallback for older payloads that
  // carry neither.
  //
  // DIVERGENCE FROM THE ACCOUNTS RENDERER (deliberate). The Accounts version
  // tests `res.products.length` alone, so a booking whose products are ALL
  // transfers — every rate is a city_tour, which isTransferName always routes
  // to Tour Transfers — has an empty product list for a legitimate reason and
  // still trips the fallback. buildProductRows does no transfer routing, so it
  // re-emits those same transfers into the Attraction table as unnamed
  // "City Tour #1062" rows (SG 40065 shows four of them, worth 1,405.91,
  // already listed under Tour Transfers).
  //
  // On the Accounts sheet that is cosmetic: the Attraction total is the API's
  // figure, which nets to 0.00 there, and the reconciliation row cancels the
  // bogus lines. Here the same rows would become four duplicate tickets for
  // transfers that already have them, so the fallback is taken only when the
  // derivation produced NOTHING — no products AND no transfers — which is the
  // "older payload" case it was written for. Section and grand totals are
  // unchanged either way.
  const stays     = buildHotelRows(pnl)
  const transfers = (res.transfers ?? []) as ProductRow[]
  const products  = res.products?.length || transfers.length
    ? [...(res.products ?? [])]
    : buildProductRows(pnl)
  const transport = buildTransportRows(pnl, res.names, billsDriverAccommodation(res))
  const meals     = buildMealRows(pnl)

  // Charges the API lumps into cost.other are routed to the section they belong
  // to — meals, transfers and sightseeing products all move out; only genuine
  // sundries stay under Others.
  const otherSplit = splitMealCharges(buildOtherRows(pnl), pax, hasAttractionRates(pnl))
  const mealExtras = otherSplit.meals
  const others = otherSplit.others

  const sum = <T,>(arr: T[], k: keyof T): number => arr.reduce((a, x) => a + pnum(x[k] as Json), 0)

  /* Day N → the date it falls on, off the itinerary, so the "#Day(s)" column
     carries the travel date under the day number instead of leaving the reader
     to count forward from arrival. */
  const dayDates: Record<string, string> = {}
  for (const raw of asArray(res.itinerary)) {
    const d = obj(raw)
    const k = String(pnum(d.day) || '')
    if (k) dayDates[k] = String(d.date_formatted || d.date || '')
  }
  const dayLabel = (day: string | number): string => {
    if (day === '' || day == null) return '—'
    const d = dayDates[String(pnum(day as Json))] || ''
    return `Day ${esc(day)}${d ? `<div class="dt-sub">${esc(d)}</div>` : ''}`
  }

  // Transport and Others price the whole trip rather than one day, so there is
  // no per-row date to show — the itinerary's first/last day date stands in as
  // a trip-span note instead.
  const itinList = asArray(res.itinerary)
  const first = obj(itinList[0]), last = obj(itinList[itinList.length - 1])
  const tripStartDate = itinList.length ? String(first.date_formatted || first.date || '') : ''
  const tripEndDate   = itinList.length ? String(last.date_formatted || last.date || '') : ''
  const tripDateNote  = tripStartDate && tripEndDate
    ? `Trip dates: ${esc(tripStartDate)} → ${esc(tripEndDate)}` : null

  // Their value moves with them: cost.other prices these lines, so each
  // destination section adds its share on top of its own API figure (and
  // Others, which totals only its own lines, sheds it).
  for (const p of otherSplit.products) products.push(p)
  for (const t of otherSplit.transport) transport.push(t)
  const productExtraSum   = sum(otherSplit.products, 'total')
  const transportExtraSum = sum(otherSplit.transport, 'total')

  /* ---------- section totals, API figures winning throughout ---------- */

  const hotelGrand = sum(stays, 'total')

  // Point-to-point transfers are priced INSIDE the attraction costing but get
  // their own table on the sheet, so their value comes out of the attraction
  // subtotal and stands on its own.
  const transferTotal = sum(transfers, 'total')
  const attractionCostRaw = at(pnl, 'cost.attraction.cost')
  const attractionCost = pnum(attractionCostRaw != null ? attractionCostRaw : sum(products, 'total') + transferTotal)
  const attractionTotal = attractionCost - transferTotal + productExtraSum

  // Transfers no longer ride in the transport subtotal — hence the 0.
  const transportTotal = transportApiTotal(pnl, 0) + transportExtraSum

  const mealExtraSum = sum(mealExtras, 'total')
  const mealApiRaw = at(pnl, 'cost.meal.cost.total')
  const mealApiTotal = pnum(mealApiRaw != null ? mealApiRaw : sum(meals, 'total'))
  const mealTotal = mealApiTotal + mealExtraSum
  const otherTotal = sum(others, 'total')

  // The sheet's three result lines, all straight off the API.
  const grand = pnum(s.selling_total != null ? s.selling_total
    : hotelGrand + attractionTotal + transferTotal + transportTotal + mealTotal + otherTotal)
  const costTotal = pnum(s.cost_total != null ? s.cost_total : grand)
  const profitV = pnum(s.profit_loss != null ? s.profit_loss : grand - costTotal)
  const marginV = grand > 0 ? (profitV / grand) * 100 : 0

  /* Item-3 reconciliation. The API's section figure wins; when the rendered
     lines don't sum to it the shortfall is shown as its own row rather than
     silently absorbed into the footer, so the table always adds up on screen. */
  const diffRow = (cols: number, lineSum: number, apiTotal: number): string => {
    const d = pnum(apiTotal) - pnum(lineSum)
    if (Math.abs(d) <= 0.01) return ''
    return `<tr class="dt-recon"><td colspan="${cols}">`
         + `<span class="dt-strong">Unitemised balance (per API total)</span>`
         + `<div class="dt-sub">Line items sum to ${money(lineSum, cur)}; the API prices this section at ${money(apiTotal, cur)}.</div>`
         + `</td><td class="num">${num(d)}</td></tr>`
  }
  /* Every section total states its own arithmetic under the label — the line
     totals it is the sum of — so the footer figure can be checked against the
     rows above it without leaving the sheet. */
  const totalRow = (label: string, cols: number, value: number, calc?: string): string =>
    `<tfoot><tr><td colspan="${cols}">${label}`
    + (calc ? `<div class="dt-calc">${esc(calc)}</div>` : '')
    + `</td><td class="num grand">${num(value)} ${esc(cur)}</td></tr></tfoot>`

  /** A row's amount with the rate × count it came from printed beneath it. */
  const totalCell = (value: number, calc?: string): string =>
    `<td class="num">${num(value)}${calc ? `<div class="dt-calc">${esc(calc)}</div>` : ''}</td>`

  /** The heads a line was priced for. Adults and children stay separate — a
      single "4" hides whether the rate beside it multiplies adults or everyone. */
  const paxCell = (a: number, c: number): string => {
    a = pnum(a); c = pnum(c)
    if (!a && !c) return '<td class="num pax"><span class="dt-muted">—</span></td>'
    return `<td class="num pax"><span class="px">A${a}</span>${c > 0 ? `<span class="px c">C${c}</span>` : ''}</td>`
  }
  // Tour-level pax, for the lines the API prices for the whole group.
  const paxAd = pnum(pax.adult), paxCh = childCount(pax)

  /* ---------- header ---------- */
  const cntl = res.tour_ref || (res.quotation_no ? `${res.quotation_no}CNTL` : '')
  let html = `<div class="dt-head"><div><div class="dt-id">${esc(s.is_number || res.is_number || res.quotation_no)}</div>`
    + `<div class="dt-meta">`
    + `<span class="dt-chip">${esc(res.country_flag || '')} ${esc(res.country_name || '—')}</span>`
    + `<span class="dt-chip"># ${esc(res.quotation_no)}</span>`
    + (cntl ? `<span class="dt-chip">${esc(cntl)}</span>` : '')
    + `<span class="dt-chip">${esc(s.agent_name && s.agent_name !== 'NA' ? s.agent_name : (res.agent_name || '—'))}</span>`
    + `<span class="dt-chip">${esc(s.total_pax || 0)} pax</span>`
    + `<span class="dt-chip">${esc(pnum(s.nights))}N / ${esc(pnum(s.days || qi.days))}D</span>`
    + `</div></div>`
    + `<div class="dt-grand"><div class="l">Total Tour Cost</div><div class="v">${money(grand, cur)}</div>`
    + `<div class="p ${profitV < 0 ? 'down' : 'up'}">${money(profitV, cur)} profit · ${marginV.toFixed(1)}%</div>`
    + `</div></div>`

  /* ---------- fact box ---------- */
  const nights = pnum(s.nights), days = pnum(s.days || qi.days)
  html += dtFacts([
    ['Tour No',       `#${esc(res.reference_id || '—')}`],
    ['Is Number',     esc(s.is_number || res.is_number || '—')],
    ['Agent',         esc(s.agent_name && s.agent_name !== 'NA' ? s.agent_name : (res.agent_name || '—'))],
    ['Currency',      esc(cur)],
    ['No. Adult',     esc(pnum(pax.adult))],
    ['No. Child',     esc(childCount(pax))],
    ['No. Night',     `${esc(nights)}${days ? ` <span class="dt-muted">/ ${esc(days)} days</span>` : ''}`],
    ['Exchange Rate', num(s.exchange_rate != null ? s.exchange_rate : (qi.exchange_rate || 1))],
  ])

  /* ---------- where the cost sits ---------- */
  html += dtFlow({
    hotels: hotelGrand, products: attractionTotal, transfers: transferTotal,
    transport: transportTotal, meals: mealTotal, others: otherTotal,
  }, cur)

  /* ---------- Hotels ----------
     One row per stay. Only the occupancies this booking actually uses get a
     column, so a two-adult tour reads SGL / DBL and never an empty TPL. */
  const occs = ([['sgl', 'SGL'], ['dbl', 'DBL'], ['tpl', 'TPL']] as const).filter(o => occUsed(stays, o[0]))
  const kids = ([['cwb', 'CWB'], ['cnb', 'CNB']] as const).filter(o => occUsed(stays, o[0]))
  // A stay with no occupancy at all still needs one column to sit under.
  const hotelCols: Array<readonly [string, string]> = occs.length + kids.length
    ? [...occs, ...kids] : [['sgl', 'SGL'] as const]

  let hHead = '<th>Name</th>'
  for (const o of hotelCols) hHead += `<th class="num">${o[1]}</th>`
  hHead += '<th>Room Type</th><th>Meal Plan</th><th class="num">No.Of.Rooms</th>'
        + '<th class="num">No.Of.Nights</th><th class="num">Pax</th>'
        + '<th class="num">Cost Per Night</th><th class="num">Total</th>'

  let hb = ''
  if (stays.length) {
    hb = '<tbody>'
    stays.forEach((h, i) => {
      const rooms = stayRooms(h)
      // Per-night cost is derived, not quoted: the API prices the stay as a
      // whole and a hotel booked in two room types has no single nightly rate,
      // so the honest figure is the stay total spread over nights.
      const perNight = h.nights > 0 ? h.total / h.nights : 0
      hb += `<tr><td><div class="dt-strong"><span class="dt-idx">${i + 1}</span>${esc(h.name)}`
          + ` <span class="pill">${esc(h.type)}</span></div>`
          + (h.cat || h.stay ? `<div class="dt-sub">${[esc(h.cat), esc(h.stay)].filter(Boolean).join(' · ')}</div>` : '')
          + '</td>'
      for (const o of hotelCols) {
        const cell = obj((h as unknown as Record<string, JsonRecord>)[o[0]])
        // CWB / CNB are counted heads at a flat rate, not roomed occupancies,
        // so their chip reads "<rate> × <count>" all the same.
        hb += `<td class="num">${o[0] === 'cwb' || o[0] === 'cnb'
          ? `<span class="occ${pnum(cell.count) ? '' : ' off'}"><span class="r">${esc(num0(cell.rate))}</span>`
            + `<span class="x">×</span><span class="n">${pnum(cell.count)}</span></span>`
          : occChips(cell)}</td>`
      }
      const heads = stayHeads(h)
      hb += `<td>${esc(stayRoomTypes(h))}</td>`
          + `<td>${mealBadge(h.meal)}</td>`
          + `<td class="num">${rooms}</td>`
          + `<td class="num">${esc(h.nights || 0)}</td>`
          + paxCell(heads.adults, heads.children)
          + `<td class="num">${num(perNight)}</td>`
          // The stay is priced as a whole, so the checkable arithmetic is its
          // nightly cost over the nights booked.
          + totalCell(h.total, h.nights > 0 ? `${num(perNight)} × ${h.nights}N` : '')
          + '</tr>'
    })
    hb += '</tbody>' + totalRow('Total', hotelCols.length + 7, hotelGrand,
      calcNote(stays.map(h => h.total), hotelGrand, 'stay total'))
  }
  html += dtBlock('Hotels', dtColour('hotels'), hHead, hb, stays.length ? hotelGrand : null, cur)

  /* ---------- Attraction ---------- */
  const prodHead = '<th class="num">#Day(s)</th><th>City</th><th>Attraction</th>'
    + '<th class="num">Adult Entrance Rate</th><th class="num">Child Entrance Rate</th><th class="num">Transfer</th>'
    + '<th class="num">Adult Count</th><th class="num">Child Count</th>'
    + '<th class="num">Pax</th><th class="num">Total</th>'

  const prodBody = (rows: ProductRow[]): string => {
    let b = '<tbody>'
    for (const p of rows) {
      // Row total = adult rate × adults + child rate × children. Entrance /
      // transfer are components of the rate the API already folds in, so they
      // show for reference but are not re-added here.
      const ad = pnum(p.adultCount) || paxAd, ch = pnum(p.childCount)
      const rowTotal = pnum(p.total) || pnum(p.adultRate) * ad + pnum(p.childRate) * ch
      const calc = [
        pnum(p.adultRate) ? `${num0(p.adultRate)} × ${ad}` : '',
        pnum(p.childRate) && ch ? `${num0(p.childRate)} × ${ch}` : '',
      ].filter(Boolean).join(' + ')

      b += `<tr><td class="num">${p.day ? dayLabel(p.day) : '—'}</td>`
        + `<td>${esc(p.city || '—')}</td>`
        + `<td><span class="dt-strong">${esc(p.name)}</span>`
        + (p.type ? ` <span class="pill">${esc(p.type)}</span>` : '') + '</td>'
        + `<td class="num">${num0(p.entranceRate)}</td>`
        + `<td class="num">${num0(p.childEntranceRate)}</td>`
        + `<td class="num">${num0(p.transferRate)}</td>`
        + `<td class="num">${num0(ad)}</td>`
        + `<td class="num">${num0(ch)}</td>`
        + paxCell(ad, ch)
        + totalCell(rowTotal, calc) + '</tr>'
    }
    return b
  }

  let pb = ''
  if (products.length) {
    pb = prodBody(products)
    // The costed total applies SIC / transfer / package rules the plain
    // rate × pax lines can't reproduce; the balance shows as its own row.
    const prodLineSum = sum(products, 'total'), prodBal = attractionTotal - prodLineSum
    pb += diffRow(9, prodLineSum, attractionTotal)
    pb += '</tbody>' + totalRow('Total', 9, attractionTotal,
      calcNote(products.map(p => p.total), attractionTotal, 'line total', prodBal))
  }
  html += dtBlock('Attraction', dtColour('products'), prodHead, pb,
    products.length ? attractionTotal : null, cur,
    transferTotal ? `Excludes ${money(transferTotal, cur)} of point-to-point transfers, listed under Tour Transfers.` : null)

  /* ---------- Tour Transfers ----------
     Same columns as Attraction — they come out of the same attraction costing —
     but their own table and their own total, as the sheet has it. */
  let xb = ''
  if (transfers.length) {
    xb = prodBody(transfers) + '</tbody>' + totalRow('Total', 9, transferTotal,
      calcNote(transfers.map(x => x.total), transferTotal, 'transfer total'))
  }
  html += dtBlock('Tour Transfers', dtColour('transfers'), prodHead, xb,
    transfers.length ? transferTotal : null, cur)

  /* ---------- Transport ---------- */
  let tb = ''
  if (transport.length) {
    tb = '<tbody>'
    for (const t of transport) {
      // `info` rows are priced under another section — greyed, and their amount
      // is bracketed so it never reads as part of this subtotal.
      const qty = t.count === '' ? '' : `${t.count}${t.unit && t.unit !== U_NA ? ` ${t.unit}` : ''}`
      const calc = t.rate !== '' && t.count !== '' && pnum(t.rate as Json) && pnum(t.count as Json)
        ? `${num0(t.rate)} × ${t.count}${t.unit && t.unit !== U_NA ? ` ${t.unit}` : ''}` : ''

      tb += `<tr${t.info ? ' class="dt-info"' : ''}>`
        + `<td><span class="dt-strong">${esc(t.desc)}</span>${t.sub ? `<div class="dt-sub">${esc(t.sub)}</div>` : ''}</td>`
        + `<td class="num">${esc(qty)}</td>`
        + `<td class="num">${t.rate === '' ? '' : num0(t.rate)}</td>`
        + paxCell(paxAd, paxCh)
        + (t.info ? `<td class="num">(${num(t.total)})</td>` : totalCell(t.total, calc)) + '</tr>'
    }
    const trCosted = transportCosted(transport)
    const trLineSum = sum(trCosted, 'total'), trBal = transportTotal - trLineSum
    tb += diffRow(4, trLineSum, transportTotal)
    // Bracketed `info` amounts are priced under another section, so they are
    // deliberately absent from this equation.
    tb += '</tbody>' + totalRow('Total Transport', 4, transportTotal,
      calcNote(trCosted.map(x => x.total), transportTotal, 'charged line', trBal)
      + (transport.length > trCosted.length ? ' · bracketed lines excluded (priced elsewhere)' : ''))
  }
  html += dtBlock('Transport', dtColour('transport'),
    '<th>Expense</th><th class="num">Distance/Days</th><th class="num">Rate</th>'
    + '<th class="num">Pax</th><th class="num">Total</th>',
    tb, transport.length ? transportTotal : null, cur, tripDateNote)

  /* ---------- Meals ----------
     One row per day, split Breakfast / Lunch / Dinner, then any meal charges
     the API filed under cost.other — those are priced inside cost.other, NOT
     inside cost.meal.cost.total, so they add on top of the API's meal figure
     rather than reconciling against it. */
  const mealSlotCell = (sl: MealRow['slots'][string] | undefined, adults: number, children: number): string => {
    if (!sl || (!sl.adultRate && !sl.childRate)) return '<span class="dt-muted">—</span>'
    return `<div>Adult: ${num(sl.adultRate)} × ${esc(adults)}</div>`
         + `<div class="dt-sub">Child: ${num(sl.childRate)} × ${esc(children)}</div>`
  }

  let mb = ''
  if (meals.length || mealExtras.length) {
    mb = '<tbody>'
    for (const m of meals) {
      // Every priced head of the day, in the order the slots are billed.
      const calc = ['1', '2', '3'].reduce<string[]>((a, k) => {
        const sl = m.slots[k]
        if (!sl) return a
        if (pnum(sl.adultRate)) a.push(`${num0(sl.adultRate)} × ${pnum(m.adults)}`)
        if (pnum(sl.childRate) && pnum(m.children)) a.push(`${num0(sl.childRate)} × ${pnum(m.children)}`)
        return a
      }, []).join(' + ')

      mb += `<tr><td class="dt-strong">${m.day ? dayLabel(m.day) : '—'}</td>`
        + `<td>${mealSlotCell(m.slots['1'], m.adults, m.children)}</td>`
        + `<td>${mealSlotCell(m.slots['2'], m.adults, m.children)}</td>`
        + `<td>${mealSlotCell(m.slots['3'], m.adults, m.children)}</td>`
        + paxCell(m.adults, m.children)
        + totalCell(m.total, calc) + '</tr>'
    }
    for (const x of mealExtras) {
      const cell = (slot: string) => slot === x.slot
        ? `<div>${num(x.rate)}${x.count ? ` × ${esc(x.count)}` : ''}</div>`
        : '<span class="dt-muted">—</span>'
      mb += `<tr><td><span class="dt-strong">${esc(x.label)}</span>`
        + `<div class="dt-sub">Billed under the API other costs</div></td>`
        + `<td>${cell('1')}</td><td>${cell('2')}</td><td>${cell('3')}</td>`
        + (pnum(x.count) ? paxCell(x.count, 0) : paxCell(paxAd, paxCh))
        + totalCell(x.total, pnum(x.rate) && pnum(x.count) ? `${num0(x.rate)} × ${pnum(x.count)}` : '') + '</tr>'
    }
    const mealLineSum = sum(meals, 'total') + mealExtraSum, mealBal = mealTotal - mealLineSum
    mb += diffRow(5, mealLineSum, mealTotal)
    mb += '</tbody>' + totalRow('Total', 5, mealTotal,
      calcNote([...meals.map(m => m.total), ...mealExtras.map(x => x.total)], mealTotal, 'meal line', mealBal))
  }
  html += dtBlock('Meals', dtColour('meals'),
    '<th>Day</th><th>Breakfast (Rate × Count)</th><th>Lunch (Rate × Count)</th><th>Dinner (Rate × Count)</th>'
    + '<th class="num">Pax</th><th class="num">Total</th>',
    mb, meals.length || mealExtras.length ? mealTotal : null, cur)

  /* ---------- Others ----------
     Every priced API category the sections above don't cover. Deliberately NO
     reconciliation row against cost.total: that residue is markup/rounding, not
     a cost the customer incurred, and showing it here reads as a phantom
     charge. Others totals exactly what its own lines total. */
  let ob = ''
  if (others.length) {
    ob = '<tbody>'
    for (const o of others) {
      const calc = o.rate !== '' && o.count !== '' && pnum(o.rate as Json) && pnum(o.count as Json)
        ? `${num0(o.rate)} × ${o.count}` : ''
      ob += `<tr><td><span class="dt-strong">${esc(o.desc)}</span>${o.sub ? `<div class="dt-sub">${esc(o.sub)}</div>` : ''}</td>`
        + `<td>${esc(o.unit || dtUnitFor(o.desc))}</td><td class="num">${esc(o.count)}</td>`
        + `<td class="num">${o.rate === '' ? '' : num(o.rate)}</td>`
        + paxCell(paxAd, paxCh)
        + totalCell(o.total, calc) + '</tr>'
    }
    ob += '</tbody>' + totalRow('Total', 5, otherTotal,
      calcNote(others.map(o => o.total), otherTotal, 'line'))
  }
  html += dtBlock('Others', dtColour('others'),
    '<th>Description</th><th>Unit</th><th class="num">Count</th><th class="num">Rate</th>'
    + '<th class="num">Pax</th><th class="num">Total</th>',
    ob, others.length ? otherTotal : null, cur, tripDateNote)

  /* ---------- result block ---------- */
  const pp = Object.keys(obj(res.per_person)).length ? obj(res.per_person) : obj(at(pnl, 'cost.pp'))
  const ppRows: Array<[string, number]> = []
  for (const [k, raw] of Object.entries(obj(pp.adult))) {
    const v = pnum(raw)
    if (v) ppRows.push([`Cost Per Person ${DT_ROOM_TYPES[String(k)] || `Room Type ${k}`}`, v])
  }
  if (pnum(pp.cwb)) ppRows.push(['Cost Per Child With Bed (CWB)', pnum(pp.cwb)])
  if (pnum(pp.cnb)) ppRows.push(['Cost Per Child No Bed (CNB)', pnum(pp.cnb)])

  html += '<div class="cs-result"><table>'
  for (const [label, value] of ppRows) {
    html += `<tr><td>${esc(label)}</td><td class="num">${num(value)} ${esc(cur)}</td></tr>`
  }
  html += `<tr class="hi"><td>Total Tour Cost</td><td class="num">${num(grand)} ${esc(cur)}</td></tr>`
    + `<tr><td>Total Tour Cost Without Markup</td><td class="num">${num(costTotal)} ${esc(cur)}</td></tr>`
    + `<tr class="pl"><td>Profit</td><td class="num ${plClass(profitV)}">${num(profitV)} ${esc(cur)}</td></tr>`
    + '</table></div>'

  return {
    html,
    currency: cur,
    tables: { stays, products, transfers, transport, meals, mealExtras, others },
    totals: {
      hotels: hotelGrand, products: attractionTotal, transfers: transferTotal,
      transport: transportTotal, meals: mealTotal, others: otherTotal,
      grand, cost: costTotal, profit: profitV, margin: marginV,
    },
    dayDates,
  }
}
