/**
 * Who is actually travelling on an Aahaas B2C order.
 *
 * The store's customer record is the *account* that paid ("admin6611"), not the
 * traveller. The real names are typed in at checkout per product line and kept
 * in `aahaas_passenger_details` (see `fetchOrderLineTravellers`). This module
 * turns those rows into a single lead-traveller name per order.
 *
 * Pure — no DB access — so it can be exercised with fixtures.
 */
import type { B2cOrderLineBookingNames, B2cOrderLineTravellers, B2cPassengerDetail } from './b2c-db'
import { passengerNameKey } from './passenger-note-key'

export interface OrderTravellers {
  /** Best guess at the lead traveller, or null when no line carries a name. */
  leadName: string | null
  /** Distinct adult traveller names, lead first. */
  adults: string[]
}

/**
 * `travel_buddy_*_id` is a comma list ("12,13") on most rows and a JSON array
 * ("[12,13]") on some; both are accepted. Anything not a positive integer is
 * dropped rather than trusted, because these ids are later inlined into SQL.
 */
export function parseTravellerIds(raw: string | null | undefined): number[] {
  if (!raw) return []
  const text = String(raw).trim()
  let parts: unknown[] = text.split(',')
  if (text.startsWith('[')) {
    try {
      const parsed = JSON.parse(text)
      if (Array.isArray(parsed)) parts = parsed
    } catch {
      parts = text.replace(/[[\]"]/g, '').split(',')
    }
  }
  const ids: number[] = []
  for (const p of parts) {
    const n = Number(String(p).trim())
    if (Number.isInteger(n) && n > 0 && !ids.includes(n)) ids.push(n)
  }
  return ids
}

/** Every passenger id referenced by these lines — what to fetch next. */
export function collectPassengerIds(lines: B2cOrderLineTravellers[]): number[] {
  const ids = new Set<number>()
  for (const l of lines) {
    for (const id of parseTravellerIds(l.adult_ids)) ids.add(id)
    for (const id of parseTravellerIds(l.child_ids)) ids.add(id)
  }
  return Array.from(ids)
}

/**
 * "rithika  ANNADURAI" stays as typed unless the whole name is one case, in
 * which case it is title-cased so a shouted or lower-case entry reads like a
 * name on vouchers. Mixed case is assumed deliberate ("McDonald", "de Silva").
 */
export function formatPassengerName(p: Pick<B2cPassengerDetail, 'passenger_first_name' | 'passenger_last_name'>): string | null {
  const joined = `${p.passenger_first_name ?? ''} ${p.passenger_last_name ?? ''}`.replace(/\s+/g, ' ').trim()
  if (!joined || joined === '-') return null
  const oneCase = joined === joined.toLowerCase() || joined === joined.toUpperCase()
  if (!oneCase) return joined
  return joined.toLowerCase().replace(/(^|[\s'-])(\S)/g, (_, sep: string, ch: string) => sep + ch.toUpperCase())
}

/**
 * Pick the lead traveller for one order.
 *
 * Customers re-enter themselves on every product, often creating a new
 * passenger row each time, so travellers are matched by normalised name rather
 * than by id. The lead is the adult who appears on the most lines — the person
 * the whole trip is built around — with ties going to whoever appears first on
 * the earliest line (the first adult entered at checkout).
 */
export function resolveOrderTravellers(
  lines: B2cOrderLineTravellers[],
  passengersById: Map<number, B2cPassengerDetail>,
): OrderTravellers {
  const tally = new Map<string, { name: string; lines: number; firstSeen: number }>()
  let seen = 0

  for (const line of lines) {
    const onThisLine = new Set<string>()
    for (const id of parseTravellerIds(line.adult_ids)) {
      const p = passengersById.get(id)
      const name = p ? formatPassengerName(p) : null
      if (!name) continue
      const key = passengerNameKey(name)
      if (!key || onThisLine.has(key)) continue
      onThisLine.add(key)
      const entry = tally.get(key)
      if (entry) entry.lines += 1
      else tally.set(key, { name, lines: 1, firstSeen: seen })
      seen += 1
    }
  }

  const ranked = Array.from(tally.values()).sort((a, b) => b.lines - a.lines || a.firstSeen - b.firstSeen)
  return { leadName: ranked[0]?.name ?? null, adults: ranked.map((r) => r.name) }
}

// ─── Names held on the booking rows ──────────────────────────────────────────

/**
 * What the storefront writes when nobody filled the form in — "Adult 1",
 * "Guest Adult 3", "undefined undefined". Same list as the accounts system's
 * B2cTravellerService, so both systems agree on who counts as a name.
 */
const PLACEHOLDERS = [
  /^undefined(\s+undefined)*$/i,
  /^guest$/i,
  /^(guest\s+)?(adult|child|children|infant|pax|traveler|traveller|passenger)(\s*\d+|\s+(one|two|three|four|five|six|seven|eight|nine|ten))?$/i,
  /^n\/?a$/i,
  /^null$/i,
  /^-+$/,
]
const TITLE = /^(mr|mrs|ms|miss|mx|mstr|master|dr|prof|rev)\.?\s+/i
const TRAILING_NOTE = /\s*\([^)]*\)\s*$/

/**
 * One typed name, tidied — or null when it is a placeholder, not a person.
 * The title is dropped ("Mr Ann Silva" → "Ann Silva") to match the names
 * {@link formatPassengerName} produces, and one-case entries are title-cased.
 */
export function cleanTravellerName(raw: string | null | undefined): string | null {
  const name = String(raw ?? '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim()
  const bare = name.replace(TITLE, '').replace(TRAILING_NOTE, '').trim()
  if (!bare || PLACEHOLDERS.some((re) => re.test(bare))) return null
  return formatPassengerName({ passenger_first_name: name.replace(TITLE, '').trim(), passenger_last_name: null })
}

/** Hotel `paxDetails` → names. Entries are `{Title, FirstName, MiddleName, LastName}`. */
function hotelPaxNames(json: string | null): string[] {
  if (!json) return []
  let pax: unknown
  try { pax = JSON.parse(json) } catch { return [] }
  if (typeof pax === 'string') { try { pax = JSON.parse(pax) } catch { return [] } }
  if (!Array.isArray(pax)) return []
  return pax
    .map((p) => {
      if (!p || typeof p !== 'object') return null
      const o = p as Record<string, unknown>
      const part = (k: string) => (typeof o[k] === 'string' ? (o[k] as string) : '')
      return cleanTravellerName([part('FirstName'), part('MiddleName'), part('LastName')].join(' '))
    })
    .filter((n): n is string => !!n)
}

/**
 * Every real name on an order's booking rows, lead first and de-duplicated —
 * the first name on the earliest line, which is who the order is for when the
 * account that paid is a shared login like "admin6611".
 */
export function bookingRowNames(lines: B2cOrderLineBookingNames[]): string[] {
  const out = new Map<string, string>()
  const add = (n: string | null) => {
    if (!n) return
    const key = passengerNameKey(n)
    if (key && !out.has(key)) out.set(key, n)
  }
  for (const l of lines) {
    for (const n of String(l.ls_adults ?? '').split(',')) add(cleanTravellerName(n))
    add(cleanTravellerName(l.student_name))
    for (const n of hotelPaxNames(l.hotel_pax)) add(n)
  }
  // Lifestyle children are listed after every adult rather than interleaved.
  for (const l of lines) {
    for (const n of String(l.ls_children ?? '').split(',')) add(cleanTravellerName(n))
  }
  return Array.from(out.values())
}

/**
 * Fill in from the booking rows what checkout travellers did not name. Names
 * from `aahaas_passenger_details` always win; booking-row names only stand in
 * when that left the order with no lead.
 */
export function withBookingRowNames(travellers: OrderTravellers | undefined, names: string[]): OrderTravellers | undefined {
  if (travellers?.leadName || names.length === 0) return travellers
  return { leadName: names[0], adults: names }
}
