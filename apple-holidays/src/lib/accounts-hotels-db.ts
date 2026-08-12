/**
 * Read-only reader for the Accounts system's hotel master list
 * (`invoice_processor.hotel_details`, the "Suppliers Manage → Hotel" tab).
 *
 * That table belongs to the Accounts Laravel app and is live production data:
 * ~841 Sri Lanka hotels with bank and payment-day detail the payables run
 * depends on. **Nothing in this module writes to it.** Contact detail the
 * booking system gathers — WhatsApp numbers, reservation desks, verification —
 * lands in our own `hotel_profiles` overlay instead, keyed by
 * `accountsHotelId`. That keeps the payables master untouched while still
 * letting Pre-checking match against it.
 *
 * Runs over the same ACCOUNTS_DB_* connection as `accounts-db.ts`.
 */
import type { RowDataPacket } from 'mysql2/promise'
import { accountsQuery } from './accounts-db'
import { rankHotelCandidates, type RankedCandidate } from './hotel-match'

export interface AccountsHotel extends Record<string, unknown> {
  id: number
  name: string
  city: string | null
  country_code: string | null
  phone: string | null
  address: string | null
  website: string | null
  payment_basis: string | null
  payment_days_before: number | null
  is_active: number | null
}

interface HotelRow extends RowDataPacket {
  id: number
  hotel_name: string
  country_code: string | null
  phone: string | null
  address: string | null
  website: string | null
  payment_basis: string | null
  payment_days_before: number | null
  is_active: number | null
}

/** `hotel_details` has no city column — the address is the only locality hint. */
const SELECT_COLS =
  'id, hotel_name, country_code, phone, address, website, payment_basis, payment_days_before, is_active'

function toHotel(r: HotelRow): AccountsHotel {
  return {
    id: Number(r.id),
    name: r.hotel_name,
    city: null,
    country_code: r.country_code,
    phone: r.phone,
    address: r.address,
    website: r.website,
    payment_basis: r.payment_basis,
    payment_days_before: r.payment_days_before == null ? null : Number(r.payment_days_before),
    is_active: r.is_active == null ? null : Number(r.is_active),
  }
}

/** Free-text search of the master list. SELECT only. */
export async function searchAccountsHotels(
  query: string,
  opts: { countryCode?: string | null; limit?: number } = {},
): Promise<AccountsHotel[]> {
  const limit = Math.min(Math.max(1, Math.floor(opts.limit ?? 25)), 200)
  const term = query.trim()
  const params: unknown[] = []
  const where: string[] = ['is_active = 1']

  if (term) {
    where.push('hotel_name LIKE ?')
    params.push(`%${term}%`)
  }
  if (opts.countryCode) {
    where.push('country_code = ?')
    params.push(opts.countryCode)
  }

  const rows = await accountsQuery<HotelRow>(
    `SELECT ${SELECT_COLS} FROM hotel_details
     WHERE ${where.join(' AND ')}
     ORDER BY hotel_name ASC
     LIMIT ${limit}`,
    params,
  )
  return rows.map(toHotel)
}

/** One hotel by its master-list id. SELECT only. */
export async function getAccountsHotel(id: number): Promise<AccountsHotel | null> {
  const rows = await accountsQuery<HotelRow>(
    `SELECT ${SELECT_COLS} FROM hotel_details WHERE id = ? LIMIT 1`,
    [Math.floor(id)],
  )
  return rows[0] ? toHotel(rows[0]) : null
}

/**
 * Every active hotel for a country, for in-process fuzzy matching.
 *
 * The whole list is pulled because SQL `LIKE` cannot express the token/bigram
 * scoring in `hotel-match.ts` — "Grand Oriental" would never `LIKE`-match
 * "The Oriental Grand Hotel". At ~841 rows the full scan costs a few
 * milliseconds, so the result is cached briefly rather than re-fetched per
 * stay on a queue page that renders hundreds of them.
 */
const CACHE_TTL_MS = 5 * 60_000
const listCache = new Map<string, { at: number; rows: AccountsHotel[] }>()

export async function allAccountsHotels(countryCode?: string | null): Promise<AccountsHotel[]> {
  const key = countryCode ?? '*'
  const hit = listCache.get(key)
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.rows

  const params: unknown[] = []
  let where = 'is_active = 1'
  if (countryCode) { where += ' AND country_code = ?'; params.push(countryCode) }

  const rows = (await accountsQuery<HotelRow>(
    `SELECT ${SELECT_COLS} FROM hotel_details WHERE ${where} ORDER BY hotel_name ASC`,
    params,
  )).map(toHotel)

  listCache.set(key, { at: Date.now(), rows })
  return rows
}

/** Drop the cached master list (after an out-of-band import, say). */
export function clearAccountsHotelCache() {
  listCache.clear()
}

/** Rank the master list against one booking hotel name. */
export async function matchAccountsHotels(
  hotelName: string,
  city: string | null | undefined,
  countryCode?: string | null,
  limit = 6,
): Promise<RankedCandidate<AccountsHotel>[]> {
  const all = await allAccountsHotels(countryCode)
  return rankHotelCandidates(hotelName, city, all, limit)
}
