/**
 * Bulk Issue Desk — buy many tickets in one sitting.
 *
 *   scan a date window → tickets grouped by product ("KL Bird Park Entrance · 6")
 *   → match a group on GlobalTix / Cebu once, priced per ticket by its own date and party
 *   → cart → hold every line (each through hold(), every single-ticket rule applies)
 *   → ONE WhatsApp code for the whole cart → each hold paid through payHeld()
 *
 * The one code is bound to the cart: the exact set of holds, their references and
 * their amounts. Add, drop or re-price a line and the code stops working. Once
 * used it approves that cart for APPROVAL_WINDOW_MS, so the screen can pay the
 * lines one request at a time (a single request paying 20 portals would outlast
 * the server's time limit). Each hold still moves reserved → confirming atomically,
 * so nothing can be paid twice.
 *
 * Reads: tickets, bookings, this desk's own tables. Writes: only what hold(),
 * payHeld() and issueOtp() already write.
 */
import { createHash } from 'crypto'
import type { OperationCountry, Prisma, UserRole } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { logActivity } from '@/lib/activity'
import { countryScope } from '@/lib/country-detection'
import { canSeeAllCountries } from '@/lib/rbac'
import { aiMatch, catalog, productOptions, type CatalogProduct } from './catalog'
import { getPortalConfig } from './config'
import {
  DESK_TICKET_INCLUDE, DeskError, assertCanBuy, bookingView, cleanName, countryCodes, deskBlocker, loadBooking,
  loadTicket, paxOf, payHeld, purchaseGate, visitDateOf, type DeskUser, type LoadedTicket,
} from './desk'
import { consumeOtp, findApproval, issueOtp } from './otp'
import {
  PROVIDER_LABEL, estimateCost, pickOption, pickQuantities, rankCandidates, type Estimate, type PortalOption, type Provider,
} from './shapes'

const MAX_WINDOW_DAYS = 62
const MAX_SCAN = 600
const MAX_GROUP = 60
const MAX_CART = 40
export const APPROVAL_WINDOW_MS = 15 * 60_000

/** Not bought on a ticket portal: hotels, transfers, flights, guides. */
const NOT_PORTAL = ['HOTEL', 'TRANSPORT', 'FLIGHT_TICKETS', 'GUIDES']

const isoDay = (d: Date) => d.toISOString().slice(0, 10)
const sha = (v: string) => createHash('sha256').update(v).digest('hex')
const groupWords = (name: string) =>
  cleanName(name).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, ' ').trim()

/* ── 1. scan ────────────────────────────────────────────────────────── */

export interface ScanLine {
  ticketId: string
  ticketName: string
  category: string | null
  bookingRef: string
  agent: string | null
  visitDate: string
  pax: { adults: number; children: number }
  customerName: string
  customerMobile: string
  quote: { amount: number | null; currency: string }
  /** A live portal booking already on this ticket (held, paying, unknown). */
  live: ReturnType<typeof bookingView> | null
  blocked: string | null
}

export interface ScanGroup {
  key: string
  name: string
  countries: string[]
  lines: ScanLine[]
  dates: { from: string; to: string }
  pax: { adults: number; children: number }
  quoteTotal: { amount: number; currency: string } | null
  held: number
}

function scopeFor(user: DeskUser, override: string | null) {
  const own = user.country ?? 'ALL'
  const country = canSeeAllCountries(user.role as UserRole, own as OperationCountry) ? (override || null) : own
  return countryScope(country)
}

export async function scan(user: DeskUser, input: { from: string; to: string; q?: string | null; country?: string | null; includeAll?: boolean }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.from) || !/^\d{4}-\d{2}-\d{2}$/.test(input.to)) throw new DeskError('Give a from and to date.')
  const from = new Date(`${input.from}T00:00:00.000Z`)
  const to = new Date(`${input.to}T23:59:59.999Z`)
  if (to < from) throw new DeskError('The window ends before it starts.')
  if ((to.getTime() - from.getTime()) / 86_400_000 > MAX_WINDOW_DAYS) throw new DeskError(`Pick a window of ${MAX_WINDOW_DAYS} days or less.`)

  const config = await getPortalConfig()
  if (!config.enabled) throw new DeskError('The Ticket Issue Desk is switched off in Settings.', 409)

  const scope = scopeFor(user, input.country ?? null)
  const q = input.q?.trim().slice(0, 80) || null
  const range = { gte: from, lte: to }

  const where: Prisma.TicketWhereInput = {
    status: 'DRAFT',
    activated: true,
    booking: { status: { not: 'CANCELLED' }, ...(scope ? { operationCountry: { in: scope } } : {}) },
    AND: [
      { OR: [{ agendaItem: { date: range } }, { agendaItemId: null, booking: { arrivalDate: range } }] },
      // SQL's NOT IN drops NULLs, so an uncategorised ticket is kept on purpose.
      ...(input.includeAll ? [] : [{ OR: [{ category: null }, { category: { notIn: NOT_PORTAL } }] }]),
    ],
    ...(q ? { type: { contains: q } } : {}),
  }
  const tickets = await prisma.ticket.findMany({ where, include: DESK_TICKET_INCLUDE, take: MAX_SCAN + 1, orderBy: { createdAt: 'asc' } })
  const truncated = tickets.length > MAX_SCAN
  const list = tickets.slice(0, MAX_SCAN)

  const live = list.length
    ? await prisma.ticketPortalBooking.findMany({ where: { ticketId: { in: list.map(t => t.id) }, liveKey: { not: null } } })
    : []
  const liveBy = new Map(live.map(b => [b.ticketId, b]))

  const groups = new Map<string, ScanGroup>()
  for (const t of list) {
    const countries = countryCodes(t)
    const key = `${countries.join(',')}|${groupWords(t.type)}`
    const lead = t.booking.passengers.find(p => p.isLead) ?? t.booking.passengers[0]
    const row = liveBy.get(t.id)
    const line: ScanLine = {
      ticketId: t.id,
      ticketName: t.type,
      category: t.category,
      bookingRef: t.booking.bookingRef,
      agent: t.booking.agent,
      visitDate: visitDateOf(t),
      pax: paxOf(t),
      customerName: lead?.name ?? '',
      customerMobile: lead?.contact ?? '',
      quote: { amount: t.totalCost === null ? null : Number(t.totalCost), currency: t.currency },
      live: row ? bookingView(row) : null,
      blocked: await deskBlocker(t, config),
    }
    const g = groups.get(key) ?? {
      key, name: cleanName(t.type) || t.type, countries, lines: [], dates: { from: line.visitDate, to: line.visitDate },
      pax: { adults: 0, children: 0 }, quoteTotal: null, held: 0,
    }
    g.lines.push(line)
    groups.set(key, g)
  }

  const out = Array.from(groups.values()).map(g => {
    g.lines.sort((a, b) => a.visitDate.localeCompare(b.visitDate) || a.bookingRef.localeCompare(b.bookingRef))
    g.dates = { from: g.lines[0].visitDate, to: g.lines[g.lines.length - 1].visitDate }
    g.pax = g.lines.reduce((a, l) => ({ adults: a.adults + l.pax.adults, children: a.children + l.pax.children }), { adults: 0, children: 0 })
    const cur = g.lines[0].quote.currency
    g.quoteTotal = g.lines.every(l => l.quote.currency === cur && l.quote.amount !== null)
      ? { amount: Math.round(g.lines.reduce((a, l) => a + (l.quote.amount ?? 0), 0) * 100) / 100, currency: cur }
      : null
    g.held = g.lines.filter(l => l.live).length
    return g
  }).sort((a, b) => b.lines.length - a.lines.length || a.dates.from.localeCompare(b.dates.from))

  return {
    window: { from: input.from, to: input.to },
    tickets: list.length,
    truncated,
    groups: out,
    approvers: config.recipients.map(r => r.name),
    otpReady: config.recipients.length > 0,
    providers: config.providers,
  }
}

/* ── 2. match one group ─────────────────────────────────────────────── */

export interface GroupCandidate {
  key: string
  provider: Provider
  productId: string
  name: string
  city: string | null
  image: string | null
  confidence: 'high' | 'medium' | 'low'
  why: string | null
  options: PortalOption[]
  optionsError: string | null
}

export interface MatchLine {
  ticketId: string
  gate: string | null
  blocked: string | null
  picks: Record<string, { optionId: string; qty: Record<string, number>; estimate: Estimate | null }>
}

export async function matchGroup(user: DeskUser, input: { ticketIds: string[]; q?: string | null; fresh?: boolean }) {
  const ids = Array.from(new Set((input.ticketIds ?? []).map(String))).slice(0, MAX_GROUP)
  if (!ids.length) throw new DeskError('Pick the tickets to match.')
  const tickets: LoadedTicket[] = []
  for (const id of ids) tickets.push(await loadTicket(id, user))
  const config = await getPortalConfig()
  if (!config.enabled) throw new DeskError('The Ticket Issue Desk is switched off in Settings.', 409)

  const first = tickets[0]
  const q = input.q?.trim() || null
  const name = q ?? cleanName(first.type)
  const codes = countryCodes(first)
  const providers = (['globaltix', 'cebu'] as Provider[]).filter(p => config.providers[p])

  const lanes: Record<Provider, { state: 'ok' | 'error' | 'off' | 'none'; error: string | null }> = {
    globaltix: { state: 'off', error: null },
    cebu: { state: 'off', error: null },
  }
  const shortlist: (CatalogProduct & { score: number })[] = []
  await Promise.all(providers.map(async provider => {
    const cc = provider === 'cebu' ? codes.filter(c => c === 'SG' || c === 'MY') : codes
    if (!cc.length) { lanes[provider].state = 'none'; return }
    const read = await Promise.allSettled(cc.map(c => catalog(provider, c, input.fresh)))
    const items = read.flatMap(r => (r.status === 'fulfilled' ? r.value : []))
    const failed = read.find(r => r.status === 'rejected') as PromiseRejectedResult | undefined
    if (!items.length && failed) { lanes[provider].state = 'error'; lanes[provider].error = failed.reason?.message ?? 'not read'; return }
    lanes[provider].state = 'none'
    shortlist.push(...rankCandidates(name, items, 10))
  }))

  const ai = q ? null : await aiMatch({
    ticket: name, others: [], bookingRef: `bulk:${first.booking.bookingRef}`,
    shortlist: shortlist.map(p => ({ key: `${p.provider}:${p.id}`, name: p.name, city: p.city })),
  })
  const aiByKey = new Map((ai ?? []).map(m => [m.key, m]))
  const rank = { high: 3, medium: 2, low: 1 } as const

  const candidates: GroupCandidate[] = []
  await Promise.all(providers.map(async provider => {
    const mine = shortlist.filter(p => p.provider === provider)
    const top = (ai ? mine.filter(p => aiByKey.has(`${provider}:${p.id}`)) : mine)
      .sort((a, b) => rank[aiByKey.get(`${provider}:${b.id}`)?.confidence ?? 'low'] - rank[aiByKey.get(`${provider}:${a.id}`)?.confidence ?? 'low'] || b.score - a.score)
      .slice(0, 3)
    const got = await Promise.all(top.map(async (p): Promise<GroupCandidate> => {
      const key = `${provider}:${p.id}`
      const m = aiByKey.get(key)
      let options: PortalOption[] = [], optionsError: string | null = null
      try {
        options = await productOptions(provider, p.id, input.fresh)
        if (!options.length) optionsError = `${PROVIDER_LABEL[provider]} lists no tickets for this product.`
      } catch (err) {
        optionsError = err instanceof Error ? err.message : 'Tickets could not be read.'
      }
      return {
        key, provider, productId: p.id, name: p.name, city: p.city, image: p.image,
        confidence: m?.confidence ?? (p.score >= 0.75 ? 'medium' : 'low'),
        why: m?.why ?? (ai ? null : `${Math.round(p.score * 100)}% of the words match.`),
        options, optionsError,
      }
    }))
    candidates.push(...got)
    if (lanes[provider].state !== 'error' && got.length) lanes[provider].state = 'ok'
  }))
  candidates.sort((a, b) => rank[b.confidence] - rank[a.confidence])

  // Gates read Accounts; a few at a time keeps that database calm.
  const lines: MatchLine[] = []
  for (let i = 0; i < tickets.length; i += 6) {
    lines.push(...await Promise.all(tickets.slice(i, i + 6).map(async (t): Promise<MatchLine> => {
      const blocked = await deskBlocker(t, config) ?? (t.status !== 'DRAFT' ? 'This ticket has already been purchased.' : null)
      const gate = blocked ? null : await purchaseGate(t, t.booking.operationCountry as OperationCountry, 'portal')
      const pax = paxOf(t)
      const visit = visitDateOf(t)
      const picks: MatchLine['picks'] = {}
      for (const c of candidates) {
        const option = pickOption(c.options, [t.type])
        if (!option) continue
        const qty = pickQuantities(option, pax)
        picks[c.key] = { optionId: option.id, qty, estimate: estimateCost(option, qty, visit) }
      }
      return { ticketId: t.id, gate, blocked, picks }
    })))
  }

  return {
    searchedFor: name,
    countries: codes,
    lanes,
    candidates,
    lines,
    ai: { used: Boolean(ai), note: q ? null : ai ? null : 'AI matching was not available, so these are matched by shared words only. Check each one.' },
    readAt: new Date().toISOString(),
  }
}

/* ── 3. one code for the whole cart ─────────────────────────────────── */

export interface CartItem { ticketId: string; bookingId: string }

function cleanItems(raw: unknown): CartItem[] {
  const seen = new Set<string>()
  const out: CartItem[] = []
  for (const x of Array.isArray(raw) ? raw : []) {
    const ticketId = String((x as CartItem)?.ticketId ?? ''), bookingId = String((x as CartItem)?.bookingId ?? '')
    if (!ticketId || !bookingId || seen.has(bookingId)) continue
    seen.add(bookingId)
    out.push({ ticketId, bookingId })
  }
  if (!out.length) throw new DeskError('The cart has no held tickets.')
  if (out.length > MAX_CART) throw new DeskError(`A cart pays at most ${MAX_CART} tickets at once.`)
  return out
}

/**
 * The cart as the code is bound to it. Holds keep their reference and amount
 * after payment, so the subject stays the same while the lines are paid.
 */
async function loadCart(rawItems: unknown, user: DeskUser) {
  const items = cleanItems(rawItems)
  const rows: Awaited<ReturnType<typeof loadBooking>>[] = []
  for (const i of items) rows.push(await loadBooking(i.ticketId, i.bookingId, user))
  const sorted = [...rows].sort((a, b) => a.b.id.localeCompare(b.b.id))
  const subject = {
    id: `cart:${sha(sorted.map(r => r.b.id).join('|')).slice(0, 40)}`,
    reference: sha(sorted.map(r => `${r.b.id}:${r.b.reference ?? ''}`).join('|')),
    amount: sorted.map(r => `${r.b.id}=${String(r.b.amount ?? '')} ${r.b.currency ?? ''}`).join('|'),
  }
  return { rows, subject }
}

function totalsText(rows: { b: { amount: unknown; currency: string | null } }[]) {
  const by = new Map<string, number>()
  for (const r of rows) by.set(r.b.currency ?? '', (by.get(r.b.currency ?? '') ?? 0) + Number(r.b.amount ?? 0))
  return Array.from(by.entries()).map(([c, a]) => `${c} ${a.toFixed(2)}`.trim()).join(' + ')
}

export async function sendCartCode(rawItems: unknown, user: DeskUser) {
  const { rows, subject } = await loadCart(rawItems, user)
  const config = await getPortalConfig()
  for (const { t, b, provider } of rows) {
    const blocked = await deskBlocker(t, config)
    if (blocked) throw new DeskError(`${t.booking.bookingRef} · ${t.type}: ${blocked}`, 409)
    if (b.status !== 'reserved' || !b.reference) throw new DeskError(`${t.booking.bookingRef} · ${t.type} is ${b.status} — only held tickets go in the cart. Refresh the cart.`, 409)
    await assertCanBuy(t, provider).catch(err => { throw new DeskError(`${t.booking.bookingRef} · ${t.type}: ${(err as Error).message}`, 422) })
  }

  const refs = Array.from(new Set(rows.map(r => r.t.booking.bookingRef)))
  const names = Array.from(new Set(rows.map(r => r.b.productName ?? r.t.type)))
  const portals = (['globaltix', 'cebu'] as Provider[])
    .map(p => ({ p, n: rows.filter(r => r.provider === p).length })).filter(x => x.n)
    .map(x => `${PROVIDER_LABEL[x.p]} ×${x.n}`).join(', ')
  const total = totalsText(rows)

  const result = await issueOtp({
    config,
    booking: subject,
    purpose: 'CONFIRM',
    requestedById: user.id,
    details: {
      action: `Issue ${rows.length} ticket${rows.length === 1 ? '' : 's'} (bulk)`,
      bookingRef: refs.length <= 3 ? refs.join(', ') : `${refs.slice(0, 3).join(', ')} +${refs.length - 3} more`,
      ticket: names.length <= 2 ? names.join(' / ') : `${names.slice(0, 2).join(' / ')} +${names.length - 2} more`,
      portal: portals,
      amountText: total,
      requestedBy: user.name || user.email || 'Staff',
    },
  })
  await logActivity({
    userId: user.id, action: 'TICKET_PORTAL_CART_CODE_SENT', entityType: 'TicketPortalCart', entityId: subject.id,
    details: { lines: rows.map(r => ({ ticketId: r.t.id, reference: r.b.reference, amount: Number(r.b.amount ?? 0), currency: r.b.currency })), total },
  })
  return { ...result, cartId: subject.id, total, count: rows.length }
}

export async function approveCart(rawItems: unknown, code: string, user: DeskUser) {
  const { rows, subject } = await loadCart(rawItems, user)
  for (const { t, b } of rows) {
    if (b.status !== 'reserved') throw new DeskError(`${t.booking.bookingRef} · ${t.type} is ${b.status} now. Refresh the cart and send a new code.`, 409)
  }
  await consumeOtp({ booking: subject, purpose: 'CONFIRM', code })
  await logActivity({ userId: user.id, action: 'TICKET_PORTAL_CART_APPROVED', entityType: 'TicketPortalCart', entityId: subject.id, details: { count: rows.length, total: totalsText(rows) } })
  return { cartId: subject.id, approvedUntil: new Date(Date.now() + APPROVAL_WINDOW_MS).toISOString() }
}

/** Pay one line of an approved cart. */
export async function payCartLine(rawItems: unknown, target: CartItem, user: DeskUser) {
  const { rows, subject } = await loadCart(rawItems, user)
  const line = rows.find(r => r.b.id === String(target?.bookingId) && r.t.id === String(target?.ticketId))
  if (!line) throw new DeskError('That ticket is not in this cart.', 404)
  const { t, b, provider } = line
  if (b.status === 'confirmed') return bookingView(b)

  const approval = await findApproval({ booking: subject, purpose: 'CONFIRM', withinMs: APPROVAL_WINDOW_MS })
  if (!approval) throw new DeskError('This cart is not approved, or the approval has lapsed or the cart changed. Send a new code.', 403)

  const blocked = await deskBlocker(t, await getPortalConfig())
  if (blocked) throw new DeskError(blocked, 409)
  await assertCanBuy(t, provider)
  const paid = await payHeld(t, b, provider, user)
  await logActivity({ userId: user.id, action: 'TICKET_PORTAL_CART_LINE_PAID', entityType: 'Ticket', entityId: t.id, details: { cartId: subject.id, reference: b.reference } })
  return paid
}
