/**
 * The lead passenger as it was *given* for an Aahaas B2C order — the name the
 * desk typed on the Confirm panel, or the one a WhatsApp payment link was made
 * out to — as opposed to the travellers the store's booking rows happen to hold.
 *
 * This is the name AahaasFlow shows (n8n-project `aahaas-flow/flow.lead.js`),
 * and it outranks everything else ops can find: orders placed on the shared
 * `admin6611` login carry that login as their customer, and often no traveller
 * rows at all, so without it the booking page and the accounts reports print
 * a username where the guest's name should be.
 *
 * Pure — rows in, one lead per order out — so it can be checked with fixtures.
 */
import type { B2cLeadSourceRow } from './b2c-db'
import { formatPassengerName } from './b2c-travellers'
import { passengerNameKey } from './passenger-note-key'

export type ConfirmedLeadSource = B2cLeadSourceRow['source']

export interface ConfirmedLead {
  name: string
  email: string | null
  phone: string | null
  source: ConfirmedLeadSource
}

/** AahaasFlow's order: what the desk confirmed, then the payment link, then its own intake row. */
const RANK: Record<ConfirmedLeadSource, number> = { confirmation: 0, 'payment-link': 1, 'flow-booking': 2 }

const clean = (v: unknown): string | null => {
  const t = String(v ?? '').replace(/\s+/g, ' ').trim()
  return t && t !== '-' && t.toLowerCase() !== 'null' && t.toLowerCase() !== 'undefined' ? t : null
}

/**
 * A login, not a person: "admin6611", "admin@it.aahaas.com", a phone number.
 * The same test the accounts system's B2cCustomerNameResolver applies, so the
 * two systems never disagree about what counts as a real name.
 */
export function looksLikeAccountName(name: string | null | undefined): boolean {
  const n = clean(name)
  return !n || /\d|@/.test(n)
}

/** `{ firstName, lastName, … }` in whichever spelling it was stored — mirrors `parseLead`. */
export function parseLeadPassenger(raw: unknown): { name: string; email: string | null; phone: string | null } | null {
  let v = raw
  if (typeof v === 'string') {
    try { v = JSON.parse(v) } catch { return null }
  }
  if (Array.isArray(v)) v = v[0]
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  const pick = (...keys: string[]) => clean(keys.map((k) => o[k]).find((x) => clean(x)))
  const first = pick('firstName', 'first_name', 'firstname', 'givenName')
  const last = pick('lastName', 'last_name', 'lastname', 'surname')
  const joined = [first, last].filter(Boolean).join(' ') || pick('name', 'fullName', 'full_name')
  if (!joined) return null
  return {
    name: joined,
    email: pick('email', 'mail'),
    phone: pick('phone', 'mobile', 'contact', 'contact_number'),
  }
}

/** Valid-looking address, lower-cased; anything else is dropped rather than mailed. */
function cleanEmail(v: unknown): string | null {
  const e = clean(v)?.toLowerCase() ?? null
  return e && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : null
}

/**
 * Every usable lead per order, best first: by source in AahaasFlow's order,
 * then newest row first within a source (the name the desk last typed wins
 * over a retried checkout). Account-like names are dropped here; a name equal
 * to this order's own account is dropped by {@link firstConfirmedLead}.
 */
export function rankConfirmedLeads(rows: B2cLeadSourceRow[]): Map<number, ConfirmedLead[]> {
  // Rows arrive newest-first within each source; a stable sort keeps that.
  const ordered = rows
    .map((r, i) => ({ r, i }))
    .sort((a, b) => (RANK[a.r.source] ?? 9) - (RANK[b.r.source] ?? 9) || a.i - b.i)

  const out = new Map<number, ConfirmedLead[]>()
  for (const { r } of ordered) {
    const orderId = Number(r.order_id)
    if (!Number.isInteger(orderId) || orderId <= 0) continue

    const parsed = parseLeadPassenger(r.lead_passenger)
    const rawName = parsed?.name ?? clean(r.name)
    if (!rawName || looksLikeAccountName(rawName)) continue

    const list = out.get(orderId) ?? []
    if (list.some((l) => passengerNameKey(l.name) === passengerNameKey(rawName))) continue
    const [firstName, ...rest] = rawName.split(' ')
    list.push({
      name: formatPassengerName({ passenger_first_name: firstName, passenger_last_name: rest.join(' ') }) ?? rawName,
      email: cleanEmail(parsed?.email ?? r.email),
      phone: clean(parsed?.phone ?? r.phone),
      source: r.source,
    })
    out.set(orderId, list)
  }
  return out
}

/**
 * The best lead that is not simply the account again — AahaasFlow's intake row
 * falls back to the account name when the desk named nobody.
 */
export function firstConfirmedLead(
  leads: ConfirmedLead[] | undefined,
  accountName: string | null | undefined,
): ConfirmedLead | null {
  const accountKey = clean(accountName) ? passengerNameKey(String(accountName)) : ''
  return leads?.find((l) => !accountKey || passengerNameKey(l.name) !== accountKey) ?? null
}
