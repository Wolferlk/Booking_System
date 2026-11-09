/**
 * Ticket Issue Desk — the pure pieces: reading what GlobalTix and Cebu answer
 * (through Main Backend), matching products by name, and costing a pick.
 * No server imports, so the desk screen recalculates with this same code.
 *
 * The readers follow n8n-project's flow.portals.js, which is proven against the
 * real payloads.
 */

export type Provider = 'globaltix' | 'cebu'

export const PROVIDER_LABEL: Record<Provider, string> = { globaltix: 'GlobalTix', cebu: 'Cebu' }

export interface PortalTicket {
  id: string
  name: string
  currency: string | null
  selling?: number | null
  nett?: number | null
  /** Cebu prices each ticket by date. */
  prices?: Record<string, number>
  dates?: string[]
}

export interface PortalQuestion {
  id: string | number
  question: string
  type: string
  optional: boolean
  options: { key: string; value: string }[]
}

export interface PortalOption {
  id: string
  name: string
  currency: string | null
  kind: string
  date_required: boolean
  questions: PortalQuestion[]
  tickets: PortalTicket[]
}

export interface Estimate {
  amount: number
  currency: string | null
  count: number
  /** No date yet — the lowest date's price stands in. */
  from: boolean
  /** The portal does not sell a picked ticket on that date. */
  closed: boolean
}

export const str = (v: unknown): string | null => {
  const t = String(v ?? '').trim()
  return t && t !== 'null' ? t : null
}
export const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(String(v).replace(/,/g, ''))
  return Number.isFinite(n) ? n : null
}
export const r2 = (v: number | null | undefined): number | null =>
  v === null || v === undefined || !Number.isFinite(v) ? null : Math.round(v * 100) / 100

const tokens = (t: unknown) =>
  String(t ?? '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, ' ').split(' ').filter(Boolean)

/** Words that say nothing about which attraction a product is. */
const NOISE = new Set(['ticket', 'tickets', 'entrance', 'entry', 'admission', 'the', 'and', 'with', 'for', 'only', 'from', 'pass'])
const words = (t: unknown) => tokens(t).filter(w => w.length > 2 && !NOISE.has(w))

/** Rank catalogue products by the words they share with a name. Best first, 0..1. */
export function rankCandidates<T extends { name: string | null }>(name: string, catalogue: T[], limit = 6): (T & { score: number })[] {
  const mine = new Set(words(name))
  if (!mine.size) return []
  return catalogue
    .map(p => {
      const theirs = new Set(words(p.name))
      const shared = Array.from(mine).filter(w => theirs.has(w)).length
      return { ...p, score: r2(Math.min(1, shared / Math.max(1, Math.min(mine.size, theirs.size || 1)))) as number }
    })
    .filter(p => p.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
}

/** Does this product's name plainly include that other ticket? (A combo.) */
export function nameCovers(productName: string, otherTicketName: string): boolean {
  const theirs = new Set(words(productName))
  const other = words(otherTicketName)
  return other.length > 0 && other.filter(w => theirs.has(w)).length / other.length >= 0.75
}

/** Options as booking needs them. Nett is what Aahaas pays. */
export function shapeGlobaltixOptions(res: any): PortalOption[] {
  return (Array.isArray(res?.data) ? res.data : []).map((opt: any): PortalOption => {
    const dateRequired = opt.visitDate?.required === true
    const kind = str(opt.ticketTypeName) ?? (opt.isCapacity && dateRequired ? 'timeslot' : dateRequired ? 'fixed-date' : 'open-ended')
    return {
      id: String(opt.id),
      name: str(opt.name) ?? `Option ${opt.id}`,
      currency: str(opt.currency),
      kind,
      date_required: kind !== 'open-ended',
      questions: (Array.isArray(opt.questions) ? opt.questions : []).map((q: any) => ({
        id: q.id,
        question: str(q.question) ?? `Question ${q.id}`,
        type: str(q.type) ?? 'FREETEXT',
        optional: Boolean(q.optional),
        options: (Array.isArray(q.optionList) ? q.optionList : []).map((o: any) => ({ key: String(o.key), value: str(o.value) ?? String(o.key) })),
      })),
      tickets: (Array.isArray(opt.ticketType) ? opt.ticketType : []).map((t: any) => ({
        id: String(t.id),
        name: str(t.name) ?? `Ticket ${t.id}`,
        selling: r2(num(t.selling_price)),
        nett: r2(num(t.nettPrice)),
        currency: str(t.currency) ?? str(opt.currency),
      })),
    }
  }).filter((o: PortalOption) => o.tickets.length)
}

export function shapeCebuOptions(res: any, sku: string): PortalOption[] {
  const d = res?.data && typeof res.data === 'object' ? res.data : {}
  const tickets: PortalTicket[] = (Array.isArray(d.tickets) ? d.tickets : []).map((t: any) => {
    const days = (Array.isArray(t.available_dates) ? t.available_dates : [])
      .map((x: any) => ({ date: str(x?.date)?.slice(0, 10) ?? null, price: r2(num(x?.price)) }))
      .filter((x: any) => x.date)
    const priced = days.filter((x: any) => x.price !== null)
    return {
      id: String(t.sku_id ?? ''),
      name: str(t.title) ?? str(t.name) ?? str(t.sku_name) ?? `Ticket ${t.sku_id}`,
      currency: str(t.currency) ?? 'SGD',
      dates: days.map((x: any) => x.date),
      prices: Object.fromEntries(priced.map((x: any) => [x.date, x.price])),
      nett: priced.length ? Math.min(...priced.map((x: any) => x.price)) : null,
    }
  }).filter((t: PortalTicket) => t.id)
  if (!tickets.length) return []
  return [{
    id: String(d.sku_id ?? sku),
    name: str(d.title) ?? 'Cebu tickets',
    currency: tickets[0].currency,
    kind: 'fixed-date',
    date_required: true,
    questions: [],
    tickets,
  }]
}

/** Σ quantity × nett for this pick. Null when a picked ticket has no price. */
export function estimateCost(option: PortalOption | null | undefined, qty: Record<string, number>, visit: string | null): Estimate | null {
  if (!option) return null
  let amount = 0, count = 0, from = false, closed = false
  for (const t of option.tickets) {
    const n = Number(qty?.[t.id] || 0)
    if (!n) continue
    count += n
    let unit: number | null | undefined = t.nett ?? null
    if (t.prices) {
      const day = visit ? t.prices[visit] : undefined
      if (day !== undefined && day !== null) unit = day
      else if (visit) closed = true
      else from = true
    }
    if (unit === null || unit === undefined) return null
    amount += n * unit
  }
  if (!count) return null
  return { amount: r2(amount) as number, currency: option.currency, count, from, closed }
}

/** The option whose name shares the most words with the hints; the first on a tie. */
export function pickOption(options: PortalOption[], hints: (string | null | undefined)[]): PortalOption | null {
  const want = new Set(hints.filter(Boolean).flatMap(tokens))
  let best = options[0] ?? null, top = -1
  for (const o of options) {
    const score = tokens(o.name).filter(w => want.has(w)).length
    if (score > top) { best = o; top = score }
  }
  return best
}

/** Quantities for the travellers: adults on the adult ticket, children on the child one. */
export function pickQuantities(option: PortalOption | null, pax: { adults: number; children: number }): Record<string, number> {
  if (!option?.tickets.length) return {}
  const adults = Math.max(0, pax.adults || 0), children = Math.max(0, pax.children || 0)
  const named = (w: string) => option.tickets.find(t => tokens(t.name).includes(w))
  const adult = named('adult'), child = named('child')
  const out: Record<string, number> = {}
  const add = (id: string, n: number) => { if (n > 0) out[id] = (out[id] ?? 0) + n }
  if (adult || child) {
    add((adult ?? option.tickets[0]).id, adults || (children ? 0 : 1))
    add((child ?? adult ?? option.tickets[0]).id, children)
  } else {
    add(option.tickets[0].id, adults + children || 1)
  }
  return out
}

/* ── what the portal says about a booking ───────────────────────────── */

export interface PortalRecord {
  reference: string
  status: string | null
  e_ticket_url: string | null
  view_ticket_url: string | null
  codes: { name: string | null; code: string | null; quantity: number | null; redeem_until: string | null; qr: string | null }[]
  links: { label: string; url: string }[]
  read_at: string
}

export function readGlobaltixBooking(res: any, reference: string): PortalRecord {
  const d = res?.data
  if (!d || res?.success === false) {
    throw new Error(`GlobalTix did not return booking ${reference} — ${str(typeof res?.error === 'string' ? res.error : res?.error?.message) ?? 'no booking came back'}.`)
  }
  const qr = (v: unknown) => (/^(data:image\/|https?:\/\/)/.test(str(v) ?? '') ? str(v) : null)
  return {
    reference: str(d.referenceNumber) ?? reference,
    status: str(d.status),
    e_ticket_url: str(d.eTicketUrl),
    view_ticket_url: str(d.viewTicketUrl),
    codes: (Array.isArray(d.tickets) ? d.tickets : []).map((t: any) => ({
      name: str(t.name), code: str(t.code), quantity: num(t.quantity_total), redeem_until: str(t.redeemEnd), qr: qr(t.qrcode),
    })),
    links: [],
    read_at: new Date().toISOString(),
  }
}

export function readCebuOrder(res: any, reference: string): PortalRecord {
  const d = res?.data
  if (!d || typeof d !== 'object' || res?.success === false) {
    throw new Error(`Cebu did not return order ${reference} — ${str(res?.message) ?? 'no order came back'}.`)
  }
  const links: { label: string; url: string }[] = []
  const walk = (v: any, key: string, depth: number) => {
    if (links.length >= 6 || depth > 4 || v === null || v === undefined) return
    if (typeof v === 'string') {
      if (/^https?:\/\//i.test(v) && !links.some(l => l.url === v)) links.push({ label: key.replace(/_/g, ' '), url: v })
    } else if (typeof v === 'object') {
      for (const [k, x] of Object.entries(v)) walk(x, Array.isArray(v) ? key : k, depth + 1)
    }
  }
  walk(d, 'voucher', 0)
  const items = Array.isArray(d.items) ? d.items : Array.isArray(d.order_items) ? d.order_items : []
  return {
    reference: str(d.order_ref_id) ?? reference,
    status: str(d.status) ?? str(d.order_status),
    e_ticket_url: null,
    view_ticket_url: null,
    codes: items.map((i: any) => ({
      name: str(i.title ?? i.name ?? i.sku_name ?? i.sku_id), code: str(i.voucher_code ?? i.code ?? i.voucher_no), quantity: num(i.quantity), redeem_until: null, qr: null,
    })),
    links,
    read_at: new Date().toISOString(),
  }
}

/** What a portal's status word means. 'held' covers anything not clearly paid or ended. */
export function classifyStatus(provider: Provider, status: string | null): 'paid' | 'cancelled' | 'ended' | 'held' {
  const s = String(status ?? '')
  if (/cancel|revok|refund/i.test(s)) return 'cancelled'
  if (/void|releas|expir|fail/i.test(s)) return 'ended'
  if (provider === 'globaltix') return s.toUpperCase() === 'CONFIRMED' ? 'paid' : 'held'
  return /\b(paid|confirmed|completed|issued)\b/i.test(s) && !/\bun ?paid|not paid/i.test(s) ? 'paid' : 'held'
}
