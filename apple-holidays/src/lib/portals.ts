/**
 * Ticket portals — the shared list of places a ticket can be bought.
 *
 * Malaysia, Singapore and Vietnam do not buy their attraction tickets at the
 * gate. The ground team buys them through a reseller portal (Cebu, Global Tix,
 * Travel Vago, Be My Guest) or from an agent by name, and *that* is who
 * Accounts owes the money to. So the portal is recorded on the ticket when it
 * is issued (Ticket.portalId / portalName), and Payable 1.0 reads it back onto
 * the payable line it pays.
 *
 * The list itself lives in the Accounts database, in `payment_portals`. One
 * table, both systems: this module reads and writes it directly (through
 * accountsWrite, which refuses to touch anything else over there), and the
 * Accounts app manages the same rows at Settings → Ticket Portals. A portal
 * added on either side is live on both immediately, with no sync job to drift.
 *
 * @see Accounts: database/migrations/2026_08_13_180000_create_payment_portals_table.php
 */
import type { RowDataPacket } from 'mysql2/promise'
import { accountsQuery, accountsWrite } from './accounts-db'
import type { OperationCountry } from '@prisma/client'

/** The country codes the registry files portals under. */
export type PortalCountry = 'MY' | 'SG' | 'VN' | 'LK'

export const PORTAL_COUNTRIES: Record<PortalCountry, string> = {
  MY: 'Malaysia',
  SG: 'Singapore',
  VN: 'Vietnam',
  LK: 'Sri Lanka',
}

/** Operations whose tickets are bought through a portal at all. */
export const PORTAL_REQUIRED_COUNTRIES: PortalCountry[] = ['MY', 'SG', 'VN']

/** Ticket categories whose purchase is blocked without a portal. */
export const PORTAL_REQUIRED_CATEGORIES = ['TICKETS', 'ATTRACTION']

export const PORTAL_KINDS = {
  portal: 'Booking portal',
  agent: 'Agent / person',
  direct: 'Direct purchase',
  bank: 'Bank transfer',
} as const

export type PortalKind = keyof typeof PORTAL_KINDS

export interface Portal {
  id: number
  country: PortalCountry
  name: string
  slug: string
  kind: PortalKind
  categories: string[] | null
  supplierName: string | null
  currency: string | null
  contactName: string | null
  contactPhone: string | null
  contactEmail: string | null
  notes: string | null
  isActive: boolean
  sortOrder: number
  updatedBy: string | null
}

export interface PortalInput {
  country: PortalCountry
  name: string
  kind?: PortalKind
  categories?: string[] | null
  supplierName?: string | null
  currency?: string | null
  contactName?: string | null
  contactPhone?: string | null
  contactEmail?: string | null
  notes?: string | null
  isActive?: boolean
  sortOrder?: number
}

/**
 * "Global Tix" → "globaltix".
 *
 * The registry is unique per country on this, and Payable 1.0 compares portals
 * on it too — so a portal typed with different spacing or casing in the two
 * systems is still one portal. Must stay identical to PaymentPortal::slugFor()
 * on the Accounts side.
 */
export function slugFor(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '')
}

/**
 * Which registry country a booking's operation buys through.
 *
 * SINGAPORE_MALAYSIA is one desk running two operations with different portal
 * lists (Cebu is Singapore's, Travel Vago is Malaysia's), so it is not one
 * country here — the caller passes the booking's own country and a combined
 * desk sees both lists.
 */
export function portalCountriesFor(country: OperationCountry | null | undefined): PortalCountry[] {
  switch (country) {
    case 'SINGAPORE':          return ['SG']
    case 'MALAYSIA':           return ['MY']
    case 'SINGAPORE_MALAYSIA': return ['SG', 'MY']
    case 'VIETNAM':            return ['VN']
    case 'SRILANKA':           return ['LK']
    case 'ALL':                return ['SG', 'MY', 'VN', 'LK']
    default:                   return []
  }
}

/** Does a booking in this operation have to name a portal before purchase? */
export function portalRequiredFor(country: OperationCountry | null | undefined): boolean {
  const codes = portalCountriesFor(country)
  return codes.length > 0 && codes.every(c => PORTAL_REQUIRED_COUNTRIES.includes(c))
}

// ─── Reading ─────────────────────────────────────────────────────────────────

interface PortalRow extends RowDataPacket {
  id: number
  country: string
  name: string
  slug: string
  kind: string
  categories: string | null
  supplier_name: string | null
  currency: string | null
  contact_name: string | null
  contact_phone: string | null
  contact_email: string | null
  notes: string | null
  is_active: number
  sort_order: number
  updated_by: string | null
}

const COLUMNS = `id, country, name, slug, kind, categories, supplier_name, currency,
                 contact_name, contact_phone, contact_email, notes, is_active, sort_order, updated_by`

function toPortal(row: PortalRow): Portal {
  let categories: string[] | null = null
  if (row.categories) {
    try {
      // MySQL JSON comes back parsed on some driver versions and as a string on
      // others; both are handled rather than assuming one.
      const parsed = typeof row.categories === 'string' ? JSON.parse(row.categories) : row.categories
      categories = Array.isArray(parsed) && parsed.length ? parsed.map(String) : null
    } catch {
      categories = null
    }
  }

  return {
    id: Number(row.id),
    country: row.country as PortalCountry,
    name: row.name,
    slug: row.slug,
    kind: (row.kind as PortalKind) ?? 'portal',
    categories,
    supplierName: row.supplier_name,
    currency: row.currency,
    contactName: row.contact_name,
    contactPhone: row.contact_phone,
    contactEmail: row.contact_email,
    notes: row.notes,
    isActive: Boolean(row.is_active),
    sortOrder: Number(row.sort_order ?? 0),
    updatedBy: row.updated_by,
  }
}

/**
 * The portals of one or more countries, in the order they should be offered.
 *
 * Soft-deleted rows are excluded here rather than filtered by the caller: a
 * deleted portal is gone from both systems, and nothing in this app has any
 * business seeing one.
 */
export async function listPortals(
  countries: PortalCountry[],
  opts: { activeOnly?: boolean } = {},
): Promise<Portal[]> {
  if (!countries.length) return []

  const placeholders = countries.map(() => '?').join(', ')
  const rows = await accountsQuery<PortalRow>(
    `SELECT ${COLUMNS}
       FROM payment_portals
      WHERE deleted_at IS NULL
        AND country IN (${placeholders})
        ${opts.activeOnly ? 'AND is_active = 1' : ''}
      ORDER BY country, sort_order, name`,
    countries,
  )

  return rows.map(toPortal)
}

export async function findPortal(id: number): Promise<Portal | null> {
  const rows = await accountsQuery<PortalRow>(
    `SELECT ${COLUMNS} FROM payment_portals WHERE id = ? AND deleted_at IS NULL LIMIT 1`,
    [id],
  )

  return rows.length ? toPortal(rows[0]) : null
}

/**
 * The portals a ticket in this booking may be bought through.
 *
 * Category-restricted portals drop out for other categories — but only while
 * something is left. A restriction that would leave the ground team with an
 * empty dropdown is ignored, because being unable to record where a ticket was
 * bought is worse than offering a portal that is rarely the right one.
 */
export async function portalsForTicket(
  country: OperationCountry | null | undefined,
  category: string | null | undefined,
): Promise<Portal[]> {
  const all = await listPortals(portalCountriesFor(country), { activeOnly: true })
  if (!category) return all

  const cat = category.toUpperCase()
  const fits = all.filter(p => !p.categories || p.categories.some(c => c.toUpperCase() === cat))

  return fits.length ? fits : all
}

// ─── Writing ─────────────────────────────────────────────────────────────────

function normalise(input: PortalInput) {
  const categories = input.categories && input.categories.length
    ? JSON.stringify(input.categories.map(c => c.toUpperCase()))
    : null

  return {
    country: input.country.toUpperCase(),
    name: input.name.trim(),
    slug: slugFor(input.name),
    kind: input.kind ?? 'portal',
    categories,
    supplierName: input.supplierName?.trim() || null,
    currency: input.currency?.trim().toUpperCase() || null,
    contactName: input.contactName?.trim() || null,
    contactPhone: input.contactPhone?.trim() || null,
    contactEmail: input.contactEmail?.trim() || null,
    notes: input.notes?.trim() || null,
    isActive: input.isActive === false ? 0 : 1,
    sortOrder: Number.isFinite(input.sortOrder) ? Number(input.sortOrder) : 50,
  }
}

/** The row with this country/name already on file, deleted ones included. */
async function findBySlug(country: string, slug: string): Promise<{ id: number; deleted: boolean } | null> {
  const rows = await accountsQuery<RowDataPacket & { id: number; deleted_at: string | null }>(
    `SELECT id, deleted_at FROM payment_portals WHERE country = ? AND slug = ? LIMIT 1`,
    [country.toUpperCase(), slug],
  )

  return rows.length ? { id: Number(rows[0].id), deleted: rows[0].deleted_at !== null } : null
}

/**
 * Add a portal, or bring back one that was turned off under the same name.
 *
 * Reviving rather than duplicating matters: tickets already bought through a
 * portal point at its id, and a second row with the same name would split one
 * payment run in two on the Accounts board.
 */
export async function createPortal(input: PortalInput, actor: string): Promise<{ id: number; revived: boolean }> {
  const p = normalise(input)

  if (!p.name) throw new Error('A portal needs a name.')
  if (!p.slug) throw new Error('That name has no letters or numbers in it.')

  const existing = await findBySlug(p.country, p.slug)

  if (existing) {
    await accountsWrite(
      `UPDATE payment_portals
          SET name = ?, kind = ?, categories = ?, supplier_name = ?, currency = ?,
              contact_name = ?, contact_phone = ?, contact_email = ?, notes = ?,
              is_active = 1, sort_order = ?, updated_by = ?, deleted_at = NULL, updated_at = NOW()
        WHERE id = ?`,
      [p.name, p.kind, p.categories, p.supplierName, p.currency, p.contactName,
        p.contactPhone, p.contactEmail, p.notes, p.sortOrder, actor, existing.id],
    )

    return { id: existing.id, revived: true }
  }

  const { insertId } = await accountsWrite(
    `INSERT INTO payment_portals
       (country, name, slug, kind, categories, supplier_name, currency,
        contact_name, contact_phone, contact_email, notes, is_active, sort_order,
        created_by, updated_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
    [p.country, p.name, p.slug, p.kind, p.categories, p.supplierName, p.currency,
      p.contactName, p.contactPhone, p.contactEmail, p.notes, p.isActive, p.sortOrder,
      actor, actor],
  )

  return { id: insertId, revived: false }
}

export async function updatePortal(id: number, input: PortalInput, actor: string): Promise<void> {
  const p = normalise(input)

  if (!p.name) throw new Error('A portal needs a name.')

  const clash = await findBySlug(p.country, p.slug)
  if (clash && clash.id !== id) {
    throw new Error(`${p.country} already has a portal called “${p.name}”.`)
  }

  await accountsWrite(
    `UPDATE payment_portals
        SET country = ?, name = ?, slug = ?, kind = ?, categories = ?, supplier_name = ?,
            currency = ?, contact_name = ?, contact_phone = ?, contact_email = ?, notes = ?,
            is_active = ?, sort_order = ?, updated_by = ?, updated_at = NOW()
      WHERE id = ? AND deleted_at IS NULL`,
    [p.country, p.name, p.slug, p.kind, p.categories, p.supplierName, p.currency,
      p.contactName, p.contactPhone, p.contactEmail, p.notes, p.isActive, p.sortOrder,
      actor, id],
  )
}

/**
 * Turn a portal on or off for new purchases.
 *
 * There is no delete here on purpose. Tickets and payments already carry a
 * portal's name, and this app is a guest in the Accounts database — removing a
 * row it does not own is not its call. Accounts can delete an unused one from
 * its own settings page.
 */
export async function setPortalActive(id: number, active: boolean, actor: string): Promise<void> {
  await accountsWrite(
    `UPDATE payment_portals SET is_active = ?, updated_by = ?, updated_at = NOW()
      WHERE id = ? AND deleted_at IS NULL`,
    [active ? 1 : 0, actor, id],
  )
}

// ─── Putting a portal on a ticket ────────────────────────────────────────────

export interface PortalSelection {
  portalId: number | null
  portalName: string | null
  portalRef?: string | null
}

/**
 * Turn what the client sent into the portal to store on a ticket.
 *
 * The name is resolved from the registry rather than trusted: a ticket that
 * says "Globl Tix" is a ticket Accounts cannot pay, because the board matches
 * portals on their normalised name. An id that is not on this booking's
 * country's list is refused for the same reason.
 *
 * Passing an explicit empty portal clears it — that is how a mistaken choice is
 * taken back off a ticket that has not been bought yet.
 *
 * @throws with a message meant for the ground team to read.
 */
export async function resolvePortalSelection(
  country: OperationCountry | null | undefined,
  input: { portalId?: unknown; portalName?: unknown; portalRef?: unknown },
): Promise<PortalSelection | undefined> {
  const hasId = input.portalId !== undefined
  const hasName = input.portalName !== undefined

  if (!hasId && !hasName) return undefined            // not being changed

  const id = input.portalId === null || input.portalId === '' ? null : Number(input.portalId)
  const name = typeof input.portalName === 'string' ? input.portalName.trim() : null
  const ref = typeof input.portalRef === 'string' ? input.portalRef.trim() || null : null

  if (!id && !name) return { portalId: null, portalName: null, portalRef: null }

  const available = await listPortals(portalCountriesFor(country), { activeOnly: true })

  const chosen = id
    ? available.find(p => p.id === id)
    : available.find(p => p.slug === slugFor(name ?? ''))

  if (!chosen) {
    throw new Error(
      available.length
        ? 'That portal is not on this country’s list. Pick one of the portals offered, or add it first.'
        : 'No portals have been set up for this country yet. Add one before recording a purchase.',
    )
  }

  return { portalId: chosen.id, portalName: chosen.name, portalRef: ref }
}

/**
 * Why this ticket may not be purchased yet, or null if it may.
 *
 * Malaysia, Singapore and Vietnam buy through resellers, and a purchase with no
 * portal on it is a payment Accounts cannot route: the board falls back to
 * guessing from the supplier's usual portal, which is how the wrong reseller
 * gets paid. Sri Lanka is exempt — its driver buys tickets out of his advance,
 * and there is no portal to name.
 *
 * Non-ticket categories (a hotel, a transfer) may still carry a portal — some
 * of those are bought through Global Tix too — but they are not blocked on it.
 */
export function portalPurchaseBlocker(
  country: OperationCountry | null | undefined,
  ticket: { category: string | null; portalName: string | null },
): string | null {
  if (!portalRequiredFor(country)) return null

  const category = (ticket.category ?? '').toUpperCase()
  if (!PORTAL_REQUIRED_CATEGORIES.includes(category)) return null

  if (ticket.portalName) return null

  return 'Pick the portal this ticket was bought through before marking it purchased — '
    + 'Accounts pays that portal, and without it the payment goes to a guess.'
}

/** How many tickets each portal has been used on — the traffic column. */
export async function portalUsage(countries: PortalCountry[]): Promise<Record<string, { tickets: number; purchased: number }>> {
  if (!countries.length) return {}

  // Counted in this app's own database: the tickets are ours, the list is
  // theirs. Keyed by slug so two spellings of one portal count as one.
  const { prisma } = await import('./prisma')

  const rows = await prisma.ticket.groupBy({
    by: ['portalName', 'status'],
    where: { portalName: { not: null } },
    _count: { _all: true },
  })

  const usage: Record<string, { tickets: number; purchased: number }> = {}
  for (const row of rows) {
    const slug = slugFor(row.portalName ?? '')
    if (!slug) continue
    usage[slug] ??= { tickets: 0, purchased: 0 }
    usage[slug].tickets += row._count._all
    if (row.status === 'PURCHASED' || row.status === 'PAID') {
      usage[slug].purchased += row._count._all
    }
  }

  return usage
}
