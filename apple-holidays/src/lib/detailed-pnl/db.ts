/**
 * Detailed P&L — the read side.
 *
 * Everything the Booking system's Detailed P&L shows comes out of the Accounts
 * database, read-only:
 *
 *   pnl_records.as_payload   the whole Apple System quotation payload the
 *                            Accounts app's `as-pnl:sync` mirrored in. This is
 *                            the single source the Accounts Detailed P&L modal
 *                            derives every figure from, so reading it here (and
 *                            deriving the same way — see derive.ts) is what
 *                            makes the two screens agree.
 *   cache                    the Apple System content catalogues (id → name),
 *                            which Laravel's database cache store keeps as
 *                            PHP-serialized maps.
 *
 * No statement in this file writes. The Accounts DB is another application's
 * production database and this app is a reader of it.
 */
import type { RowDataPacket } from 'mysql2/promise'
import { accountsQuery } from '../accounts-db'
import { phpUnserialize, asNameMap, type PhpArray } from './php-unserialize'
import type { AsPayload, Catalogues, VehicleRecord } from './types'

/** The pnl_records columns the Detailed P&L needs. */
export interface DetailedPnlRow {
  id: number
  is_number: string | null
  tour_ref: string | null
  invoice_number: string | null
  agent_name: string | null
  country_code: string | null
  currency: string | null
  total_pax: number | null
  as_quotation_no: string | null
  as_reference_id: string | null
  as_revision: number | null
  status: string | null
  pnl_approval_status: string | null
  payload: AsPayload | null
  /**
   * The payload exactly as stored. Kept alongside the parsed object because
   * JSON.parse loses the order the API wrote its id-keyed rate maps in, and
   * the attraction name zip depends on it — see derive.ts::extractKeyOrder.
   */
  rawPayload: string | null
}

/**
 * Normalise a booking reference for matching: upper-cased, every space removed.
 *
 * The two systems write the same booking two ways — the Booking system holds
 * "VN41054" and the Accounts DB holds "VN 41054" — so neither side's spacing
 * can be trusted and both are stripped before comparing.
 */
export function normaliseRef(value: string | null | undefined): string {
  return String(value ?? '').toUpperCase().replace(/\s+/g, '')
}

const RECORD_COLUMNS = `id, is_number, tour_ref, invoice_number, agent_name, country_code,
                        currency, total_pax, as_quotation_no, as_reference_id, as_revision,
                        status, pnl_approval_status, as_payload`

interface RawRecordRow extends RowDataPacket {
  as_payload: string | null
  [key: string]: unknown
}

function toRecord(row: RawRecordRow): DetailedPnlRow {
  let payload: AsPayload | null = null
  if (typeof row.as_payload === 'string' && row.as_payload !== '') {
    try {
      payload = JSON.parse(row.as_payload) as AsPayload
    } catch {
      payload = null                  // corrupt payload reads as "no P&L stored"
    }
  }
  return {
    id:                  Number(row.id),
    is_number:           (row.is_number as string) ?? null,
    tour_ref:            (row.tour_ref as string) ?? null,
    invoice_number:      (row.invoice_number as string) ?? null,
    agent_name:          (row.agent_name as string) ?? null,
    country_code:        (row.country_code as string) ?? null,
    currency:            (row.currency as string) ?? null,
    total_pax:           row.total_pax == null ? null : Number(row.total_pax),
    as_quotation_no:     (row.as_quotation_no as string) ?? null,
    as_reference_id:     row.as_reference_id == null ? null : String(row.as_reference_id),
    as_revision:         row.as_revision == null ? null : Number(row.as_revision),
    status:              (row.status as string) ?? null,
    pnl_approval_status: (row.pnl_approval_status as string) ?? null,
    payload,
    rawPayload: typeof row.as_payload === 'string' ? row.as_payload : null,
  }
}

/**
 * The stored P&L for one booking, matched on IS number ignoring spacing.
 *
 * Mirrors DbPnlController::findRecord on the Accounts side: only rows the
 * Apple System sync wrote (`source = 'apple_system_api'`) are eligible, and the
 * highest revision wins — an amended booking must cost on its latest amendment,
 * never on the revision that happened to be synced first.
 *
 * The IS number is compared with spaces stripped on BOTH sides, so the Booking
 * system's "VN41054" finds the Accounts DB's "VN 41054". The LIKE only narrows
 * the scan; the exact decision is the normalised comparison in SQL, so
 * "IS4883" can never match "IS48832".
 */
export async function fetchStoredPnlByIsNumber(isNumber: string): Promise<DetailedPnlRow | null> {
  const key = normaliseRef(isNumber)
  if (!key) return null

  const rows = await accountsQuery<RawRecordRow>(
    `SELECT ${RECORD_COLUMNS}
       FROM pnl_records
      WHERE deleted_at IS NULL
        AND source = 'apple_system_api'
        AND REPLACE(UPPER(is_number), ' ', '') = ?
      ORDER BY as_revision DESC, id DESC
      LIMIT 1`,
    [key],
  )
  return rows.length ? toRecord(rows[0]) : null
}

/**
 * Same lookup, widened to the other identifiers a booking can be known by.
 *
 * IS number is the contract the two systems share and is always tried first;
 * tour ref and invoice number only answer for bookings whose IS number has not
 * reached the Accounts DB yet.
 */
export async function fetchStoredPnl(opts: {
  isNumber?: string | null
  tourRef?: string | null
  invoiceNumber?: string | null
}): Promise<{ record: DetailedPnlRow; matchedBy: string } | null> {
  const attempts: Array<{ field: string; value: string | null | undefined }> = [
    { field: 'is_number',      value: opts.isNumber },
    { field: 'tour_ref',       value: opts.tourRef },
    { field: 'invoice_number', value: opts.invoiceNumber },
  ]

  for (const { field, value } of attempts) {
    const key = normaliseRef(value)
    if (!key) continue
    const rows = await accountsQuery<RawRecordRow>(
      `SELECT ${RECORD_COLUMNS}
         FROM pnl_records
        WHERE deleted_at IS NULL
          AND source = 'apple_system_api'
          AND REPLACE(UPPER(\`${field}\`), ' ', '') = ?
        ORDER BY as_revision DESC, id DESC
        LIMIT 1`,
      [key],
    )
    if (rows.length) return { record: toRecord(rows[0]), matchedBy: field }
  }
  return null
}

/* ============================================================
 |  Content catalogues
 * ============================================================ */

/**
 * Laravel's cache key prefix. `config/cache.php` builds it as
 * `Str::slug(APP_NAME) . '-cache-'`, and the Accounts app leaves APP_NAME at
 * its default, so the stored keys read "laravel-cache-as_content:attraction".
 */
const CACHE_PREFIX = process.env.ACCOUNTS_CACHE_PREFIX ?? 'laravel-cache-'

/** The catalogues AppleSystemContentService keeps, under `as_content:<name>`. */
const CATALOGUE_KEYS = ['attraction', 'city_tour', 'excursion', 'vehicle'] as const

/**
 * Process-level memo. The Accounts side memoises these per request for the same
 * reason: one Detailed P&L resolves hundreds of ids, and each catalogue is a
 * quarter-megabyte row on RDS. Ten minutes is far shorter than the week-long
 * TTL the Accounts app writes them with, so a re-synced catalogue is picked up
 * quickly while a page never pays for the read twice.
 */
const MEMO_TTL_MS = 10 * 60 * 1000
let memo: { at: number; value: Catalogues } | null = null

const EMPTY_CATALOGUES: Catalogues = {
  attraction: {}, city_tour: {}, excursion: {}, vehicle: {},
}

interface CacheRow extends RowDataPacket {
  key: string
  value: string | null
  expiration: number | null
}

/**
 * id → name for every Apple System catalogue, read out of the Accounts app's
 * cache table.
 *
 * Expired rows are skipped: Laravel's database store treats a row past its
 * expiration as a miss, and the Accounts app's own name lookups would return
 * nothing for it, so honouring the expiry is what keeps the two sides showing
 * the same label (or the same bare id) for a given booking.
 *
 * A catalogue that cannot be read for any reason yields an empty map, which is
 * exactly the un-synced state AppleSystemContentService::names() degrades to —
 * the row then falls back to its itinerary name, and only failing that to
 * "Attraction #<id>".
 */
export async function fetchCatalogues(): Promise<Catalogues> {
  if (memo && Date.now() - memo.at < MEMO_TTL_MS) return memo.value

  const keys = CATALOGUE_KEYS.map(c => `${CACHE_PREFIX}as_content:${c}`)
  let rows: CacheRow[] = []
  try {
    rows = await accountsQuery<CacheRow>(
      `SELECT \`key\`, \`value\`, expiration FROM cache WHERE \`key\` IN (?, ?, ?, ?)`,
      keys,
    )
  } catch {
    // No cache table, no grant on it, or the read failed — degrade to bare ids
    // rather than failing the whole P&L.
    return EMPTY_CATALOGUES
  }

  const nowSeconds = Math.floor(Date.now() / 1000)
  const out: Catalogues = { attraction: {}, city_tour: {}, excursion: {}, vehicle: {} }

  for (const row of rows) {
    if (row.expiration != null && Number(row.expiration) <= nowSeconds) continue
    const name = String(row.key).slice(`${CACHE_PREFIX}as_content:`.length)
    const parsed = phpUnserialize(row.value)
    if (!parsed || typeof parsed !== 'object') continue

    if (name === 'vehicle') {
      out.vehicle = toVehicleMap(parsed)
    } else if (name === 'attraction' || name === 'city_tour' || name === 'excursion') {
      out[name] = asNameMap(parsed)
    }
  }

  memo = { at: Date.now(), value: out }
  return out
}

/** The vehicle catalogue's per-id record: {name, pax_min, pax_max, country}. */
function toVehicleMap(parsed: PhpArray): Record<string, VehicleRecord> {
  const out: Record<string, VehicleRecord> = {}
  for (const [id, v] of Object.entries(parsed)) {
    if (!v || typeof v !== 'object') continue
    const name = typeof v.name === 'string' ? v.name.trim() : ''
    if (!name) continue
    out[id] = {
      name,
      pax_min: Number(v.pax_min ?? 0) || 0,
      pax_max: Number(v.pax_max ?? 0) || 0,
      country: String(v.country ?? ''),
    }
  }
  return out
}

/** Drop the memo — for tests and for an explicit refresh. */
export function clearCatalogueMemo(): void {
  memo = null
}
