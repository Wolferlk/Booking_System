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
import type { B2cOrderLineTravellers, B2cPassengerDetail } from './b2c-db'
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
