/**
 * The Accounts system's supplier registry ("Suppliers Manage"), as the list a
 * transport movement's supplier is picked from.
 *
 * Two of its tables can be the party a transfer is paid to:
 *
 *   supplier_bank_details  source `supplier_bank` — companies (transport
 *                          operators, ticket platforms …). OPS may ADD a row
 *                          here when the supplier is not registered yet.
 *   driver_bank_details    source `driver` — a driver paid direct. Read only.
 *
 * The source names are the Accounts system's own (payable_supplier_links.
 * supplier_source), so a pick made here means the same thing over there.
 *
 * Bank details never leave the Accounts database: the reads below only ask
 * whether an account number is on file. Registering from OPS takes the name,
 * type, country and contact only — Accounts adds the bank details itself, the
 * same separation of duty as Reservation forwarding a proforma that Accounts
 * pays. Runs over the ACCOUNTS_DB_* connection in accounts-db.ts.
 */
import type { RowDataPacket } from 'mysql2/promise'
import { accountsQuery, accountsWrite } from './accounts-db'

export type SupplierSource = 'supplier_bank' | 'driver'
export const SUPPLIER_SOURCES: SupplierSource[] = ['supplier_bank', 'driver']
export const SUPPLIER_SOURCE_LABEL: Record<SupplierSource, string> = { supplier_bank: 'Supplier', driver: 'Driver payee' }

export interface AccountsSupplier {
  source: SupplierSource
  id: number
  name: string
  businessType: string | null
  country: string | null
  phone: string | null
  /** An account number is on file — the supplier can be paid without chasing details. */
  hasBank: boolean
  active: boolean
}

/** A supplier as a movement or line points at it. */
export interface SupplierRef {
  source: SupplierSource
  id: number
  name: string
  country: string | null
}

export class SupplierInputError extends Error {}

/** Raised by registerSupplier when names already in the registry look like the same company. */
export class SupplierDuplicateError extends Error {
  constructor(public candidates: AccountsSupplier[]) {
    super('A supplier with a very similar name is already registered.')
  }
}

export function isSupplierSource(v: unknown): v is SupplierSource {
  return v === 'supplier_bank' || v === 'driver'
}

/** OPS countries → the ISO-2 codes the registry is keyed by. */
export function supplierCountriesFor(country: string | null | undefined): string[] {
  switch (String(country ?? '').toUpperCase()) {
    case 'SINGAPORE': return ['SG']
    case 'MALAYSIA': return ['MY']
    case 'SINGAPORE_MALAYSIA': return ['SG', 'MY']
    case 'SRILANKA': return ['LK']
    case 'VIETNAM': return ['VN']
    default: return []
  }
}

// ── Name matching ───────────────────────────────────────────────────────────

/** Words that say what kind of company it is, not which one. */
const NOISE = new Set([
  'pte', 'ltd', 'limited', 'sdn', 'bhd', 'berhad', 'pvt', 'private', 'co', 'company', 'inc', 'llc', 'plc',
  'enterprise', 'enterprises', 'services', 'service', 'the', 'and', 'mr', 'mrs', 'ms',
])

const fold = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')

/** "SURESH Transport Sdn. Bhd." → ['suresh', 'transport'] */
export function nameTokens(s: string | null | undefined): string[] {
  return fold(String(s ?? '')).replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(t => t && !NOISE.has(t))
}

/** A driver / vendor name as a stable key: tokens, sorted. */
export function partyKey(s: string | null | undefined): string | null {
  const t = nameTokens(s)
  return t.length ? Array.from(new Set(t)).sort().join(' ').slice(0, 191) : null
}

/**
 * How well a registry name fits a typed name, 0…1. Whole-token overlap first;
 * a token that starts the other ("sures" / "suresh") counts most of a hit, so
 * the list still answers while the desk is typing.
 */
export function nameScore(query: string, name: string): number {
  const q = nameTokens(query), n = nameTokens(name)
  if (!q.length || !n.length) return 0
  let hits = 0
  for (const t of q) {
    if (n.includes(t)) hits += 1
    else if (n.some(x => x.startsWith(t) || (t.length >= 4 && t.startsWith(x)))) hits += 0.8
    else if (t.length >= 4 && n.some(x => x.includes(t))) hits += 0.5
  }
  const cover = hits / q.length
  const precise = hits / Math.max(q.length, n.length)
  return Math.round((cover * 0.7 + precise * 0.3) * 1000) / 1000
}

// ── Reads ───────────────────────────────────────────────────────────────────

interface SupplierRow extends RowDataPacket {
  id: number
  name: string
  business_type: string | null
  country_code: string | null
  phone: string | null
  has_bank: number
  is_active: number | null
}

const SUPPLIER_SQL = `SELECT id, supplier_name AS name, business_type, country_code, phone,
  (account_number IS NOT NULL AND TRIM(account_number) <> '') AS has_bank, is_active
  FROM supplier_bank_details`
const DRIVER_SQL = `SELECT id, payee_name AS name, NULL AS business_type, country_code, NULL AS phone,
  (account_number IS NOT NULL AND TRIM(account_number) <> '') AS has_bank, is_active
  FROM driver_bank_details`

function toSupplier(source: SupplierSource, r: SupplierRow): AccountsSupplier {
  return {
    source,
    id: Number(r.id),
    name: String(r.name ?? '').trim(),
    businessType: r.business_type ?? null,
    country: r.country_code ? String(r.country_code).toUpperCase() : null,
    phone: r.phone ?? null,
    hasBank: Number(r.has_bank) === 1,
    active: r.is_active == null ? true : Number(r.is_active) === 1,
  }
}

/**
 * The whole active registry, cached briefly. A few hundred rows: ranking is
 * done here rather than with LIKE, which cannot find "Suresh Transport" from
 * "transport suresh" or forgive a missing "Sdn Bhd".
 */
const CACHE_TTL_MS = 2 * 60_000
let cache: { at: number; rows: AccountsSupplier[] } | null = null

export async function allAccountsSuppliers(): Promise<AccountsSupplier[]> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.rows
  const [suppliers, drivers] = await Promise.all([
    accountsQuery<SupplierRow>(`${SUPPLIER_SQL} WHERE is_active = 1 ORDER BY supplier_name ASC`),
    // A missing or drifted drivers table must not take the supplier list down with it.
    accountsQuery<SupplierRow>(`${DRIVER_SQL} WHERE is_active = 1 ORDER BY payee_name ASC`).catch(err => {
      console.error('[accounts-suppliers] driver_bank_details read failed (non-fatal):', err)
      return [] as SupplierRow[]
    }),
  ])
  const rows = [
    ...suppliers.map(r => toSupplier('supplier_bank', r)),
    ...drivers.map(r => toSupplier('driver', r)),
  ].filter(s => s.name)
  cache = { at: Date.now(), rows }
  return rows
}

export function clearAccountsSupplierCache() { cache = null }

/** One supplier by source and id, active or not — what a save re-resolves before trusting a pick. */
export async function getAccountsSupplier(source: SupplierSource, id: number): Promise<AccountsSupplier | null> {
  if (!isSupplierSource(source) || !Number.isFinite(id) || id <= 0) return null
  const sql = source === 'driver' ? DRIVER_SQL : SUPPLIER_SQL
  const rows = await accountsQuery<SupplierRow>(`${sql} WHERE id = ? LIMIT 1`, [Math.floor(id)])
  return rows[0] ? toSupplier(source, rows[0]) : null
}

export interface SupplierSearch {
  /** Ranked matches for the typed text (or the whole country list when nothing is typed). */
  results: (AccountsSupplier & { score: number })[]
  /** Best fits for the movement's driver / vendor name. */
  suggested: (AccountsSupplier & { score: number })[]
  total: number
}

/**
 * Search the registry. `countries` narrows to those ISO-2 codes (empty = all);
 * `hint` is the movement's driver / vendor, whose close matches come back as
 * suggestions even when nothing is typed.
 */
export async function searchAccountsSuppliers(opts: {
  q?: string | null
  countries?: string[]
  hint?: string | null
  limit?: number
}): Promise<SupplierSearch> {
  const all = await allAccountsSuppliers()
  const codes = (opts.countries ?? []).map(c => c.toUpperCase())
  // A supplier with no country is offered everywhere rather than hidden.
  const pool = codes.length ? all.filter(s => !s.country || codes.includes(s.country)) : all
  const limit = Math.min(Math.max(1, Math.floor(opts.limit ?? 40)), 200)
  const q = String(opts.q ?? '').trim()

  let results: (AccountsSupplier & { score: number })[]
  if (q) {
    const needle = fold(q)
    results = pool
      .map(s => {
        const n = fold(s.name)
        const score = n === needle ? 1.2 : n.startsWith(needle) ? 1.1 : n.includes(needle) ? 1 : nameScore(q, s.name)
        return { ...s, score }
      })
      .filter(s => s.score >= 0.4)
      .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
  } else {
    // Companies before individual payees: transfers are mostly bought from operators.
    results = pool
      .map(s => ({ ...s, score: 0 }))
      .sort((a, b) => (a.source === b.source ? a.name.localeCompare(b.name) : a.source === 'supplier_bank' ? -1 : 1))
  }

  const hint = String(opts.hint ?? '').trim()
  const suggested = hint
    ? pool.map(s => ({ ...s, score: nameScore(hint, s.name) }))
      .filter(s => s.score >= 0.55)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
    : []

  return { results: results.slice(0, limit), suggested, total: pool.length }
}

// ── Register ────────────────────────────────────────────────────────────────

export interface RegisterInput {
  name: string
  country: string
  businessType?: string | null
  phone?: string | null
  address?: string | null
  uen?: string | null
}

const field = (v: unknown, max = 255) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max) || null

/**
 * Add a supplier to supplier_bank_details. An exact name already registered
 * is returned as it is (existed: true) — the registry's own rule is one row per
 * supplier name. A near match ("Suresh Transport" vs "SURESH TRANSPORT SDN
 * BHD") throws SupplierDuplicateError with the candidates unless `force`.
 */
export async function registerSupplier(
  input: RegisterInput,
  opts: { force?: boolean } = {},
): Promise<{ supplier: AccountsSupplier; existed: boolean }> {
  const name = field(input.name)
  const country = String(input.country ?? '').trim().toUpperCase()
  if (!name || name.length < 2) throw new SupplierInputError('Give the supplier a name.')
  if (!/^[A-Z]{2}$/.test(country)) throw new SupplierInputError('Pick the supplier’s country.')

  // Exact name, any country, active or not — Accounts validates supplier_name as unique.
  const exact = await accountsQuery<SupplierRow>(
    `${SUPPLIER_SQL} WHERE LOWER(TRIM(supplier_name)) = LOWER(?) LIMIT 1`, [name],
  )
  if (exact[0]) {
    const s = toSupplier('supplier_bank', exact[0])
    if (!s.active) throw new SupplierInputError(`"${s.name}" is registered but switched off in Suppliers Manage — ask Accounts to reactivate it.`)
    return { supplier: s, existed: true }
  }

  if (!opts.force) {
    clearAccountsSupplierCache()
    const key = nameTokens(name).join(' ')
    const near = (await allAccountsSuppliers())
      .filter(s => !s.country || s.country === country)
      .map(s => ({ s, score: nameTokens(s.name).join(' ') === key ? 1 : nameScore(name, s.name) }))
      .filter(x => x.score >= 0.75)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
      .map(x => x.s)
    if (near.length) throw new SupplierDuplicateError(near)
  }

  const res = await accountsWrite(
    `INSERT INTO supplier_bank_details
       (supplier_name, business_type, phone, address, uen_number, country_code, is_active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 1, NOW(), NOW())`,
    [name, field(input.businessType) ?? 'Transport', field(input.phone), field(input.address), field(input.uen), country],
  )
  clearAccountsSupplierCache()
  const supplier = await getAccountsSupplier('supplier_bank', res.insertId)
  if (!supplier) throw new Error('The supplier was added but could not be read back — search for it by name.')
  return { supplier, existed: false }
}
