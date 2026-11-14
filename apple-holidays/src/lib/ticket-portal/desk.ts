/**
 * Ticket Issue Desk — buying a ticket on GlobalTix or Cebu from the Tickets page.
 *
 *   compare → hold → WhatsApp code → pay → details saved on the ticket
 *                 ↘ release          ↘ cancel (GlobalTix; Cebu is cancelled on Cebu)
 *
 * Rules that protect money:
 *   · Pay and Cancel need a WhatsApp code bound to that booking and amount.
 *   · Every purchase gate of the Purchase button (G2, G3, G4) applies here too.
 *   · The status moves atomically before a portal is called, so a double click
 *     cannot pay twice; the live record is read first, so a retry cannot either.
 *   · No answer from a portal means "unknown", never "failed" — the row is locked
 *     until Check status reads the portal's own record.
 *   · Only tickets and this desk's own tables are written.
 *
 * Main Backend's Cebu cancel route needs a cart row these orders do not have, so
 * a paid Cebu order is cancelled on Cebu and recorded here from Cebu's own answer.
 */
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { putUpload } from '@/lib/storage'
import { logActivity } from '@/lib/activity'
import { isInCountryScope, type OperationCountry } from '@/lib/country-detection'
import { STORE_BOOKED_PREFIX } from '@/lib/b2c-placement'
import { listPortals, portalCountriesFor, portalPurchaseBlocker, slugFor } from '@/lib/portals'
import { clearApprovalPurchased, markApprovalPurchased, purchaseBlocker } from '@/lib/ticket-approvals'
import { directIssueEnabled } from '@/lib/ticket-direct-issue'
import { backendGet, backendPost } from './backend'
import { aiMatch, catalog, productOptions, type CatalogProduct } from './catalog'
import { getPortalConfig, type PortalConfig } from './config'
import { consumeOtp, issueOtp, type OtpPurpose } from './otp'
import {
  PROVIDER_LABEL, classifyStatus, estimateCost, nameCovers, num, pickOption, pickQuantities, r2, rankCandidates,
  readCebuOrder, readGlobaltixBooking, str, type Estimate, type PortalOption, type PortalRecord, type Provider,
} from './shapes'

const MAX_QTY = 40
const IN_FLIGHT_MS = 90_000

export class DeskError extends Error {
  constructor(message: string, public status = 422) { super(message) }
}

export interface DeskUser { id: string; name?: string | null; email?: string | null; role: string; country?: string | null }

const actorName = (u: DeskUser) => u.name || u.email || 'Staff'
const clip = (v: unknown, n = 60_000) => (v === undefined ? null : JSON.stringify(v).slice(0, n))
const why = (res: any) => str(res?.error?.message) ?? str(typeof res?.error === 'string' ? res.error : null) ?? str(res?.message) ?? 'no reason given'
const label = (p: string) => PROVIDER_LABEL[p as Provider] ?? p
const today = () => new Date().toISOString().slice(0, 10)

/* ── loading ────────────────────────────────────────────────────────── */

/** What the desk reads with every ticket. The bulk desk reads the same, so the same helpers apply. */
export const DESK_TICKET_INCLUDE = {
  pnlLine: true,
  agendaItem: { select: { date: true } },
  booking: {
    select: {
      id: true, bookingRef: true, agent: true, status: true, operationCountry: true, arrivalDate: true, paxAdults: true, paxChildren: true,
      passengers: { select: { name: true, isLead: true, contact: true } },
    },
  },
} satisfies Prisma.TicketInclude

export async function loadTicket(ticketId: string, user: DeskUser) {
  const ticket = await prisma.ticket.findUnique({ where: { id: ticketId }, include: DESK_TICKET_INCLUDE })
  if (!ticket) throw new DeskError('Ticket not found', 404)
  const scope = user.country as OperationCountry | undefined | null
  if (scope && scope !== 'ALL' && !isInCountryScope(ticket.booking.operationCountry as OperationCountry, scope)) {
    throw new DeskError('This booking belongs to another country.', 403)
  }
  return ticket
}
export type LoadedTicket = Awaited<ReturnType<typeof loadTicket>>

/** A fact written into a ticket's notes ("Visit: 2026-11-20 · Pax: ad 2 ch 1 · …"). */
function noteFact(notes: string | null | undefined, label: string): string | null {
  const part = (notes ?? '').split(' · ').map(p => p.trim()).find(p => p.startsWith(label))
  return part ? part.slice(label.length).trim() || null : null
}

/**
 * Why this ticket cannot use the desk at all, in words. Null when it can.
 *
 * Aahaas B2C bookings use the desk too since 2026-11-10. The one B2C case that
 * stays refused is a line the store itself already bought through a portal
 * (b2c-placement marks it) — buying it here would pay twice.
 */
export async function deskBlocker(t: LoadedTicket, config: PortalConfig): Promise<string | null> {
  if (!config.enabled) return 'The Ticket Issue Desk is switched off in Settings.'
  if (t.booking.status === 'CANCELLED') return 'This booking is cancelled.'
  const storeBooked = noteFact(t.notes, STORE_BOOKED_PREFIX)
  if (storeBooked) return `The Aahaas store already booked this ticket through ${storeBooked}. Check it on AahaasFlow — it must not be bought twice.`
  return null
}

/** The same gates as the Purchase button. Null when buying is allowed. */
export async function purchaseGate(t: { id: string; category: string | null; pnlLine: { paymentStatus: string } | null }, country: OperationCountry | null, portalName: string) {
  const direct = await directIssueEnabled()
  if (!direct && t.pnlLine && t.pnlLine.paymentStatus !== 'CONFIRMED') return 'The P&L payment is not confirmed by Accounts yet (G2).'
  const g3 = portalPurchaseBlocker(country, { category: t.category, portalName })
  if (g3) return g3
  return direct ? null : purchaseBlocker(country, { id: t.id, category: t.category })
}

/** The row in the shared portal list Accounts pays from. "Global Tix" and "GlobalTix" are one. */
async function registryPortal(country: OperationCountry | null, provider: Provider) {
  try {
    const list = await listPortals(portalCountriesFor(country), { activeOnly: true })
    const want = slugFor(PROVIDER_LABEL[provider]).replace(/[^a-z0-9]/g, '')
    const hit = list.find(p => p.slug.replace(/[^a-z0-9]/g, '') === want)
    return { portalId: hit?.id ?? null, portalName: hit?.name ?? PROVIDER_LABEL[provider] }
  } catch {
    return { portalId: null, portalName: PROVIDER_LABEL[provider] }
  }
}

/* ── the screen's view ──────────────────────────────────────────────── */

const parse = (v: string | null | undefined): any => { try { return v ? JSON.parse(v) : null } catch { return null } }

export function bookingView(b: Awaited<ReturnType<typeof prisma.ticketPortalBooking.findUniqueOrThrow>>) {
  return {
    id: b.id,
    ticketId: b.ticketId,
    provider: b.provider as Provider,
    productId: b.productId,
    productName: b.productName,
    optionName: b.optionName,
    tickets: parse(b.tickets) ?? [],
    alsoCovers: parse(b.alsoCovers) ?? [],
    visitDate: b.visitDate,
    eventTime: b.eventTime,
    customerName: b.customerName,
    reference: b.reference,
    status: b.status,
    amount: b.amount === null ? null : Number(b.amount),
    currency: b.currency,
    lastError: b.lastError,
    details: parse(b.detailsJson) as PortalRecord | null,
    createdByName: b.createdByName,
    confirmedByName: b.confirmedByName,
    confirmedAt: b.confirmedAt,
    createdAt: b.createdAt,
    canCancelHere: b.provider === 'globaltix',
  }
}

export async function deskState(ticketId: string, user: DeskUser) {
  const t = await loadTicket(ticketId, user)
  const config = await getPortalConfig()
  const blocked = await deskBlocker(t, config)
  const bookings = await prisma.ticketPortalBooking.findMany({ where: { ticketId }, orderBy: { createdAt: 'desc' }, take: 20 })
  const gate = blocked || t.status !== 'DRAFT' ? null : await purchaseGate(t, t.booking.operationCountry as OperationCountry, 'portal')
  return {
    blocked,
    gate,
    otpReady: config.recipients.length > 0,
    approvers: config.recipients.map(r => r.name),
    providers: config.providers,
    ticket: { id: t.id, name: t.type, status: t.status, currency: t.currency, totalCost: t.totalCost === null ? null : Number(t.totalCost) },
    bookings: bookings.map(bookingView),
  }
}

/* ── compare ────────────────────────────────────────────────────────── */

export function countryCodes(t: LoadedTicket): string[] {
  // A B2C ticket names its product's own country; the booking's may be unset.
  const own = noteFact(t.notes, 'Country:')?.toUpperCase()
  if (own && /^[A-Z]{2}$/.test(own)) return [own]
  const list = portalCountriesFor(t.booking.operationCountry as OperationCountry | null)
  if (list.length && list.length <= 2) return list
  const prefix = t.booking.bookingRef.slice(0, 2).toUpperCase()
  if (/^[A-Z]{2}$/.test(prefix)) return [prefix === 'IS' ? 'LK' : prefix]
  // A numeric B2C ref says nothing; Singapore is where both portals sell.
  return ['SG']
}

/** The day of the visit: the agenda's, else the date the order named, else arrival. */
export function visitDateOf(t: LoadedTicket): string {
  if (t.agendaItem?.date) return t.agendaItem.date.toISOString().slice(0, 10)
  const named = noteFact(t.notes, 'Visit:')
  if (named && /^\d{4}-\d{2}-\d{2}$/.test(named)) return named
  return t.booking.arrivalDate.toISOString().slice(0, 10)
}

/** Who the ticket is for: the order line's own counts (B2C), else the booking's party. */
export function paxOf(t: LoadedTicket): { adults: number; children: number } {
  const m = /^ad (\d+) ch (\d+)$/.exec(noteFact(t.notes, 'Pax:') ?? '')
  if (m && Number(m[1]) + Number(m[2]) > 0) return { adults: Number(m[1]), children: Number(m[2]) }
  const total = t.booking.paxAdults + t.booking.paxChildren
  return total > 0 ? { adults: t.booking.paxAdults, children: t.booking.paxChildren } : { adults: Math.max(1, t.qty), children: 0 }
}

export const cleanName = (name: string) => name.replace(/\s*[-–]\s*(entrance|entry|admission|ticket)s?\s*$/i, '').trim()

export interface Candidate {
  key: string
  provider: Provider
  productId: string
  name: string
  city: string | null
  image: string | null
  confidence: 'high' | 'medium' | 'low'
  why: string | null
  covers: { id: string; name: string }[]
  options: PortalOption[]
  optionsError: string | null
  pick: { optionId: string; qty: Record<string, number> } | null
  estimate: Estimate | null
}

export async function compare(ticketId: string, user: DeskUser, opts: { q?: string | null; fresh?: boolean } = {}) {
  const t = await loadTicket(ticketId, user)
  const config = await getPortalConfig()
  const blocked = await deskBlocker(t, config)
  if (blocked) throw new DeskError(blocked, 409)

  const q = opts.q?.trim() || null
  const name = q ?? cleanName(t.type)
  const codes = countryCodes(t)
  const providers = (['globaltix', 'cebu'] as Provider[]).filter(p => config.providers[p])

  const siblings = await prisma.ticket.findMany({
    where: { bookingId: t.bookingId, id: { not: t.id }, status: 'DRAFT' },
    select: { id: true, type: true },
  })

  const lanes: Record<Provider, { state: 'ok' | 'error' | 'off' | 'none'; error: string | null; searched: number; candidates: Candidate[] }> = {
    globaltix: { state: 'off', error: null, searched: 0, candidates: [] },
    cebu: { state: 'off', error: null, searched: 0, candidates: [] },
  }

  const shortlist: (CatalogProduct & { score: number })[] = []
  await Promise.all(providers.map(async provider => {
    // Cebu's catalogue is Singapore's; asking it for anywhere else only wastes the call.
    const cc = provider === 'cebu' ? codes.filter(c => c === 'SG' || c === 'MY') : codes
    if (!cc.length) { lanes[provider].state = 'none'; return }
    const read = await Promise.allSettled(cc.map(c => catalog(provider, c, opts.fresh)))
    const items = read.flatMap(r => (r.status === 'fulfilled' ? r.value : []))
    const failed = read.find(r => r.status === 'rejected') as PromiseRejectedResult | undefined
    lanes[provider].searched = items.length
    if (!items.length && failed) {
      lanes[provider].state = 'error'
      lanes[provider].error = failed.reason?.message ?? 'not read'
      return
    }
    lanes[provider].state = 'none'
    shortlist.push(...rankCandidates(name, items, 12))
  }))

  // Searching by hand means the person already knows what they want.
  const ai = q ? null : await aiMatch({
    ticket: name,
    others: siblings.map(s => s.type),
    shortlist: shortlist.map(p => ({ key: `${p.provider}:${p.id}`, name: p.name, city: p.city })),
    bookingRef: t.booking.bookingRef,
  })
  const aiByKey = new Map((ai ?? []).map(m => [m.key, m]))
  const pax = paxOf(t)
  const visitDate = visitDateOf(t)

  await Promise.all(providers.map(async provider => {
    const mine = shortlist.filter(p => p.provider === provider)
    const top = (ai ? mine.filter(p => aiByKey.has(`${provider}:${p.id}`)) : mine)
      .sort((a, b) => {
        const rank = { high: 3, medium: 2, low: 1 } as const
        const ra = rank[aiByKey.get(`${provider}:${a.id}`)?.confidence ?? 'low'], rb = rank[aiByKey.get(`${provider}:${b.id}`)?.confidence ?? 'low']
        return rb - ra || b.score - a.score
      })
      .slice(0, 4)

    lanes[provider].candidates = await Promise.all(top.map(async (p): Promise<Candidate> => {
      const key = `${provider}:${p.id}`
      const m = aiByKey.get(key)
      let options: PortalOption[] = [], optionsError: string | null = null
      try {
        options = await productOptions(provider, p.id, opts.fresh)
        if (!options.length) optionsError = `${PROVIDER_LABEL[provider]} lists no tickets for this product.`
      } catch (err) {
        optionsError = err instanceof Error ? err.message : 'Tickets could not be read.'
      }
      const option = pickOption(options, [t.type])
      const qty = pickQuantities(option, pax)
      return {
        key, provider, productId: p.id, name: p.name, city: p.city, image: p.image,
        confidence: m?.confidence ?? (p.score >= 0.75 ? 'medium' : 'low'),
        why: m?.why ?? (ai ? null : `${Math.round(p.score * 100)}% of the words match.`),
        covers: m?.covers.length
          ? m.covers.map(n => siblings[n - 1]).filter(Boolean).map(s => ({ id: s.id, name: s.type }))
          : siblings.filter(s => nameCovers(p.name, s.type)).map(s => ({ id: s.id, name: s.type })),
        options,
        optionsError,
        pick: option ? { optionId: option.id, qty } : null,
        estimate: estimateCost(option, qty, visitDate),
      }
    }))
    if (lanes[provider].state !== 'error' && lanes[provider].candidates.length) lanes[provider].state = 'ok'
  }))

  const lead = t.booking.passengers.find(p => p.isLead) ?? t.booking.passengers[0]
  return {
    name: t.type,
    searchedFor: name,
    countries: codes,
    visitDate,
    pax,
    customerName: lead?.name ?? '',
    customerMobile: lead?.contact ?? '',
    quote: { amount: t.totalCost === null ? null : Number(t.totalCost), currency: t.currency },
    lanes,
    ai: { used: Boolean(ai), note: q ? null : ai ? null : 'AI matching was not available, so these are matched by shared words only. Check each one.' },
    readAt: new Date().toISOString(),
  }
}

/* ── hold ───────────────────────────────────────────────────────────── */

export interface HoldInput {
  provider: Provider
  productId: string
  productName?: string
  optionId: string
  qty: Record<string, number>
  visitDate?: string
  eventTime?: string
  answers?: Record<string, string>
  customerName: string
  customerMobile?: string
  alsoCovers?: string[]
}

function checkedDate(input: HoldInput, optionName: string) {
  const d = String(input.visitDate ?? '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new DeskError(`“${optionName}” needs a visit date.`)
  if (d < today()) throw new DeskError('The visit date has passed.')
  return d
}

function checkedTickets(option: PortalOption, qty: Record<string, number>) {
  const out: { id: string; name: string; qty: number; nett: number | null | undefined; currency: string | null }[] = []
  for (const [id, raw] of Object.entries(qty ?? {})) {
    const n = Number(raw)
    if (!n) continue
    const t = option.tickets.find(x => x.id === String(id))
    if (!t) throw new DeskError(`Ticket ${id} is not part of “${option.name}”.`)
    if (!Number.isInteger(n) || n < 1 || n > MAX_QTY) throw new DeskError(`“${t.name}”: a quantity is a whole number from 1 to ${MAX_QTY}.`)
    out.push({ id: t.id, name: t.name, qty: n, nett: t.nett, currency: t.currency ?? option.currency })
  }
  if (!out.length) throw new DeskError('Pick at least one ticket.')
  return out
}

async function buildHold(input: HoldInput, trackingFor: (rowId: string) => string, name: string) {
  // Always read fresh: this is what will really be sent and charged.
  const options = await productOptions(input.provider, input.productId, true)

  if (input.provider === 'cebu') {
    const opt = options[0]
    if (!opt) throw new DeskError(`Cebu lists no tickets for product ${input.productId}.`)
    const visitDate = checkedDate(input, opt.name)
    const tickets = checkedTickets(opt, input.qty).map(t => {
      const nett = opt.tickets.find(x => x.id === t.id)?.prices?.[visitDate]
      if (nett === undefined || nett === null) throw new DeskError(`Cebu does not sell “${t.name}” on ${visitDate}.`, 409)
      return { ...t, nett }
    })
    const mobile = String(input.customerMobile ?? '').replace(/[^\d+]/g, '')
    const digits = mobile.replace(/\D/g, '').length
    if (digits < 6 || digits > 15) throw new DeskError('Cebu needs a contact number for the order.')
    return {
      opt, tickets, visitDate, eventTime: null as string | null, mobile,
      send: (rowId: string) => ({
        path: '/api/cebu/flow/order',
        body: {
          product_id: input.productId,
          tickets: tickets.map(t => ({ sku_id: t.id, quantity: t.qty, booking_date: visitDate })),
          tracking_no: trackingFor(rowId),
          customer_name: name,
          customer_mobile: mobile,
        },
      }),
      read: (res: any) => ({ ok: res?.success === true, ref: str(res?.data?.order_ref_id), amount: r2(num(res?.data?.total ?? res?.data?.total_amount ?? res?.total_amount)) }),
    }
  }

  const opt = options.find(o => o.id === String(input.optionId))
  if (!opt) throw new DeskError(`That ticket option is not on GlobalTix product ${input.productId}.`)
  const tickets = checkedTickets(opt, input.qty)
  const visitDate = opt.date_required ? checkedDate(input, opt.name) : null
  let eventTime: string | null = null
  if (opt.kind === 'timeslot') {
    const time = String(input.eventTime ?? '').trim()
    if (!/^\d{2}:\d{2}(:\d{2})?$/.test(time)) throw new DeskError(`“${opt.name}” needs a time slot.`)
    eventTime = `${visitDate}T${time.length === 5 ? `${time}:00` : time}`
  }
  const answers: { id: string | number; answer: string }[] = []
  for (const q of opt.questions) {
    const a = String(input.answers?.[String(q.id)] ?? '').trim().slice(0, 300)
    if (!a && !q.optional) throw new DeskError(`GlobalTix needs an answer to “${q.question}”.`)
    if (a && q.options.length && !q.options.some(o => o.key === a)) throw new DeskError(`“${q.question}”: pick one of GlobalTix's answers.`)
    if (a) answers.push({ id: q.id, answer: a })
  }
  const [first, ...rest] = name.split(' ')
  return {
    opt, tickets, visitDate, eventTime, mobile: null as string | null,
    send: (rowId: string) => ({
      path: '/api/globaltix/product/booking/reserve',
      body: {
        tickets: tickets.map(t => ({
          id: t.id, quantity: t.qty, type: opt.kind,
          ...(opt.date_required ? { visitDate } : {}),
          ...(eventTime ? { eventTime } : {}),
          ...(answers.length ? { questions: answers } : {}),
        })),
        cart_id: trackingFor(rowId),
        customerData: [{ FirstName: first, MiddleName: '', LastName: rest.join(' ') }],
      },
    }),
    read: (res: any) => ({ ok: Boolean(res?.success), ref: str(res?.data?.referenceNumber), amount: r2(num(res?.data?.amount)) }),
  }
}

export async function hold(ticketId: string, input: HoldInput, user: DeskUser) {
  const t = await loadTicket(ticketId, user)
  const config = await getPortalConfig()
  const blocked = await deskBlocker(t, config)
  if (blocked) throw new DeskError(blocked, 409)
  if (t.status !== 'DRAFT') throw new DeskError('This ticket has already been purchased.', 409)
  if (!t.activated) throw new DeskError('Activate this ticket before issuing it.', 409)
  if (input.provider !== 'globaltix' && input.provider !== 'cebu') throw new DeskError('Pick GlobalTix or Cebu.')
  if (!config.providers[input.provider]) throw new DeskError(`${PROVIDER_LABEL[input.provider]} is switched off in Settings.`, 409)
  const productId = String(input.productId ?? '').trim()
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(productId)) throw new DeskError('That is not a portal product id.')
  const name = String(input.customerName ?? '').replace(/\s+/g, ' ').trim()
  if (name.length < 2 || name.length > 120) throw new DeskError('Give the traveller’s name for the booking.')

  const also = Array.from(new Set((input.alsoCovers ?? []).map(String))).filter(id => id !== t.id).slice(0, 8)
  if (also.length) {
    const found = await prisma.ticket.count({ where: { id: { in: also }, bookingId: t.bookingId, status: 'DRAFT' } })
    if (found !== also.length) throw new DeskError('A ticket this combo should cover is not open on this booking any more.', 409)
    const live = await prisma.ticketPortalBooking.count({ where: { ticketId: { in: also }, liveKey: { not: null } } })
    if (live) throw new DeskError('A ticket this combo should cover already has a portal booking.', 409)
  }

  const order = await buildHold({ ...input, productId }, rowId => `OPS-${t.booking.bookingRef}-${rowId.slice(-10)}`.slice(0, 64), name)

  let row
  try {
    row = await prisma.ticketPortalBooking.create({
      data: {
        ticketId: t.id, bookingId: t.bookingId, bookingRef: t.booking.bookingRef,
        provider: input.provider, productId, productName: str(input.productName)?.slice(0, 255) ?? null,
        optionId: order.opt.id, optionName: order.opt.name.slice(0, 255), kind: order.opt.kind.slice(0, 32),
        tickets: JSON.stringify(order.tickets), alsoCovers: JSON.stringify(also),
        visitDate: order.visitDate, eventTime: order.eventTime, customerName: name.slice(0, 191), customerMobile: order.mobile,
        status: 'reserving', currency: order.opt.currency, liveKey: t.id,
        createdById: user.id, createdByName: actorName(user).slice(0, 191),
      },
    })
  } catch (err) {
    if ((err as { code?: string }).code === 'P2002') throw new DeskError('This ticket already has a live portal booking. Release it first.', 409)
    throw err
  }

  const { path, body } = order.send(row.id)
  const portal = PROVIDER_LABEL[input.provider]
  let res: any
  try {
    res = await backendPost(path, body)
  } catch (err) {
    const message = `${portal} did not take the hold — ${(err as Error).message}`
    await prisma.ticketPortalBooking.update({ where: { id: row.id }, data: { status: 'failed', liveKey: null, lastError: message.slice(0, 500) } })
    throw new DeskError(message, 502)
  }
  const got = order.read(res)
  if (!got.ok || !got.ref) {
    const message = `${portal} refused the hold — ${why(res)}`
    await prisma.ticketPortalBooking.update({ where: { id: row.id }, data: { status: 'failed', liveKey: null, lastError: message.slice(0, 500), reserveJson: clip(res) } })
    throw new DeskError(message, 502)
  }
  // The portal's figure is what will be charged; ours only stands in if it gives none.
  const amount = got.amount ?? r2(order.tickets.reduce((a, x) => a + x.qty * Number(x.nett ?? 0), 0))
  const updated = await prisma.ticketPortalBooking.update({
    where: { id: row.id },
    data: { status: 'reserved', reference: got.ref, amount, reserveJson: clip(res), lastError: null },
  })
  await logActivity({ userId: user.id, action: 'TICKET_PORTAL_HOLD', entityType: 'Ticket', entityId: t.id, details: { provider: input.provider, reference: got.ref, amount, currency: order.opt.currency } })
  return bookingView(updated)
}

/* ── one booking's steps ────────────────────────────────────────────── */

export async function loadBooking(ticketId: string, bookingId: string, user: DeskUser) {
  const t = await loadTicket(ticketId, user)
  const b = await prisma.ticketPortalBooking.findFirst({ where: { id: bookingId, ticketId } })
  if (!b) throw new DeskError('That portal booking is not on this ticket.', 404)
  return { t, b, provider: b.provider as Provider }
}

const otpSubject = (b: { id: string; reference: string | null; amount: unknown }) =>
  ({ id: b.id, reference: b.reference ?? '', amount: String(b.amount ?? '') })

export async function assertCanBuy(t: LoadedTicket, provider: Provider) {
  const { portalName } = await registryPortal(t.booking.operationCountry as OperationCountry, provider)
  const gate = await purchaseGate(t, t.booking.operationCountry as OperationCountry, portalName)
  if (gate) throw new DeskError(gate, 422)
}

export async function sendCode(ticketId: string, bookingId: string, purpose: OtpPurpose, user: DeskUser) {
  const { t, b, provider } = await loadBooking(ticketId, bookingId, user)
  const config = await getPortalConfig()
  const blocked = await deskBlocker(t, config)
  if (blocked) throw new DeskError(blocked, 409)
  if (purpose === 'CONFIRM') {
    if (b.status !== 'reserved' || !b.reference) throw new DeskError(`This booking is ${b.status} — only a held booking can be paid.`, 409)
    await assertCanBuy(t, provider)
  } else {
    if (b.status !== 'confirmed' || !b.reference) throw new DeskError('Only a paid booking can be cancelled.', 409)
    if (provider === 'cebu') throw new DeskError('A paid Cebu order is cancelled on Cebu. Then press Check status here.', 409)
  }
  const result = await issueOtp({
    config,
    booking: otpSubject(b),
    purpose,
    requestedById: user.id,
    details: {
      action: purpose === 'CONFIRM' ? 'Issue ticket' : 'Cancel issued ticket',
      bookingRef: t.booking.bookingRef,
      ticket: b.productName ?? t.type,
      portal: `${label(provider)} (${b.reference})`,
      amountText: `${b.currency ?? ''} ${Number(b.amount ?? 0).toFixed(2)}`.trim(),
      requestedBy: actorName(user),
    },
  })
  await logActivity({ userId: user.id, action: 'TICKET_PORTAL_CODE_SENT', entityType: 'Ticket', entityId: t.id, details: { purpose, reference: b.reference } })
  return result
}

/** Read the portal's own record of a booking. Throws if it cannot. */
async function readLive(provider: Provider, reference: string): Promise<PortalRecord> {
  const ref = encodeURIComponent(reference)
  return provider === 'cebu'
    ? readCebuOrder(await backendGet(`/api/cebu/flow/order/${ref}`), reference)
    : readGlobaltixBooking(await backendGet(`/api/globaltix/product/booking/details/${ref}`), reference)
}

export async function confirm(ticketId: string, bookingId: string, code: string, user: DeskUser) {
  const { t, b, provider } = await loadBooking(ticketId, bookingId, user)
  const blocked = await deskBlocker(t, await getPortalConfig())
  if (blocked) throw new DeskError(blocked, 409)
  if (b.status === 'confirmed') return bookingView(b)
  if (b.status !== 'reserved' || !b.reference) throw new DeskError(`This booking is ${b.status} — only a held booking can be paid.`, 409)
  await assertCanBuy(t, provider)
  await consumeOtp({ booking: otpSubject(b), purpose: 'CONFIRM', code })
  return payHeld(t, b, provider, user)
}

export type PortalBookingRow = Awaited<ReturnType<typeof prisma.ticketPortalBooking.findUniqueOrThrow>>

/**
 * Pay one held booking. The caller has already checked the approval — a code
 * for this booking (confirm), or a cart approval bound to it (bulk.ts).
 */
export async function payHeld(t: LoadedTicket, b: PortalBookingRow, provider: Provider, user: DeskUser) {
  if (b.status !== 'reserved' || !b.reference) throw new DeskError(`This booking is ${b.status} — only a held booking can be paid.`, 409)

  // Only one press gets past this line.
  const moved = await prisma.ticketPortalBooking.updateMany({ where: { id: b.id, status: 'reserved' }, data: { status: 'confirming', lastError: null } })
  if (!moved.count) throw new DeskError('Someone else is already paying this booking.', 409)

  const portal = label(provider)
  try {
    const live = await readLive(provider, b.reference)
    if (classifyStatus(provider, live.status) === 'paid') return finalizeIssue(b.id, t, provider, user, { read_from: 'live record', live })
  } catch (err) {
    console.info('[ticket-portal] live status not read before paying:', (err as Error).message)
  }

  const ref = encodeURIComponent(b.reference)
  let res: any
  try {
    res = await backendPost(provider === 'cebu' ? `/api/cebu/flow/order/${ref}/pay` : `/api/globaltix/product/booking/confirm/${ref}`)
  } catch (err) {
    const message = `${portal} did not answer for ${b.reference} — ${(err as Error).message} Press Check status before trying again.`
    await prisma.ticketPortalBooking.update({ where: { id: b.id }, data: { status: 'unknown', lastError: message.slice(0, 500) } })
    throw new DeskError(message, 504)
  }
  if (!res?.success) {
    const message = `${portal} did not issue ${b.reference} — ${why(res)}`
    await prisma.ticketPortalBooking.update({ where: { id: b.id }, data: { status: 'reserved', lastError: message.slice(0, 500), confirmJson: clip(res) } })
    throw new DeskError(message, 502)
  }
  return finalizeIssue(b.id, t, provider, user, res)
}

/** The portal has been paid: write it onto the ticket(s) and fetch the documents. */
async function finalizeIssue(rowId: string, t: LoadedTicket, provider: Provider, user: DeskUser, answer: unknown) {
  const b = await prisma.ticketPortalBooking.findUniqueOrThrow({ where: { id: rowId } })
  const also: string[] = parse(b.alsoCovers) ?? []
  const lines: { qty: number }[] = parse(b.tickets) ?? []
  const qty = Math.max(1, lines.reduce((a, x) => a + Number(x.qty || 0), 0))
  const amount = Number(b.amount ?? 0)
  const by = actorName(user)
  const now = new Date()
  const { portalId, portalName } = await registryPortal(t.booking.operationCountry as OperationCountry, provider)
  const portalFields = { portalId, portalName, portalRef: b.reference, portalBy: by, portalAt: now, reference: b.reference, status: 'PURCHASED' as const, purchasedAt: now }

  const before = await prisma.ticket.findMany({
    where: { id: { in: [t.id, ...also] } },
    select: { id: true, status: true, purchasedAt: true, reference: true, qty: true, supplier: true, costPerUnit: true, totalCost: true, currency: true, portalId: true, portalName: true, portalRef: true, portalBy: true, portalAt: true, notes: true },
  })

  try {
    await prisma.$transaction([
      prisma.ticket.update({
        where: { id: t.id },
        data: { ...portalFields, qty, supplier: t.supplier ?? label(provider), totalCost: amount, costPerUnit: r2(amount / qty), currency: b.currency ?? t.currency },
      }),
      // A combo is paid once: its cost sits on the main ticket, so Accounts never counts it twice.
      ...before.filter(x => x.id !== t.id).map(x => prisma.ticket.update({
        where: { id: x.id },
        data: {
          ...portalFields, totalCost: 0, costPerUnit: 0,
          notes: [x.notes, `Included in ${label(provider)} combo ${b.reference} (cost on “${t.type}”)`].filter(Boolean).join(' · '),
        },
      })),
      prisma.ticketPortalBooking.update({
        where: { id: rowId },
        data: { status: 'confirmed', confirmedByName: by.slice(0, 191), confirmedAt: now, confirmJson: clip(answer), ticketSnapshot: JSON.stringify(before), lastError: null },
      }),
    ])
  } catch (err) {
    // Paid, but not written. Check status finishes the job from the portal's record.
    const message = `${label(provider)} issued ${b.reference}, but OPS could not save it. Press Check status to finish.`
    await prisma.ticketPortalBooking.update({ where: { id: rowId }, data: { status: 'unknown', lastError: message } }).catch(() => undefined)
    console.error('[ticket-portal] save after payment failed', rowId, err)
    throw new DeskError(message, 500)
  }

  await Promise.all(before.map(x => markApprovalPurchased(x.id, b.reference)))
  await logActivity({ userId: user.id, action: 'TICKET_PORTAL_ISSUED', entityType: 'Ticket', entityId: t.id, details: { provider, reference: b.reference, amount, currency: b.currency, alsoCovers: also } })
  await collectDocuments(rowId, t, provider, user).catch(err => console.warn('[ticket-portal] documents not collected:', err instanceof Error ? err.message : err))
  return bookingView(await prisma.ticketPortalBooking.findUniqueOrThrow({ where: { id: rowId } }))
}

/* ── documents ──────────────────────────────────────────────────────── */

interface StoredFiles { files: { id: string; src: string }[]; receiptUrl: string | null }

async function download(url: string): Promise<{ body: Buffer; type: string } | null> {
  if (!/^https:\/\//i.test(url)) return null
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 12_000)
  try {
    const res = await fetch(url, { signal: controller.signal, redirect: 'follow' })
    if (!res.ok) return null
    const type = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()
    if (type !== 'application/pdf' && !type.startsWith('image/')) return null
    const body = Buffer.from(await res.arrayBuffer())
    return body.length && body.length <= 10 * 1024 * 1024 ? { body, type } : null
  } catch { return null } finally { clearTimeout(timer) }
}

async function receiptPdf(b: { provider: string; reference: string | null; bookingRef: string; productName: string | null; optionName: string | null; visitDate: string | null; customerName: string | null; amount: unknown; currency: string | null; tickets: string }, by: string) {
  const safe = (v: unknown) => String(v ?? '-').replace(/[^\x20-\x7E]/g, '?').slice(0, 90)
  const doc = await PDFDocument.create()
  const page = doc.addPage([420, 520])
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const font = await doc.embedFont(StandardFonts.Helvetica)
  page.drawText('Portal purchase record', { x: 32, y: 476, size: 18, font: bold, color: rgb(0.1, 0.15, 0.25) })
  page.drawText(`Issued through ${safe(label(b.provider))}`, { x: 32, y: 456, size: 10, font, color: rgb(0.4, 0.45, 0.5) })
  const rows: [string, string][] = [
    ['Booking', safe(b.bookingRef)], ['Portal reference', safe(b.reference)], ['Product', safe(b.productName)], ['Option', safe(b.optionName)],
    ['Visit date', safe(b.visitDate)], ['Guest', safe(b.customerName)],
    ...(parse(b.tickets) ?? []).slice(0, 6).map((x: any): [string, string] => [`${x.qty} x`, safe(x.name)]),
    ['Amount paid', `${safe(b.currency)} ${Number(b.amount ?? 0).toFixed(2)}`], ['Issued by', safe(by)], ['Recorded', new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC'],
  ]
  let y = 420
  for (const [k, v] of rows) {
    page.drawText(k, { x: 32, y, size: 10, font, color: rgb(0.4, 0.45, 0.5) })
    page.drawText(v, { x: 140, y, size: 10, font: bold, color: rgb(0.1, 0.15, 0.25) })
    y -= 24
  }
  return Buffer.from(await doc.save())
}

/**
 * Save the portal's record, its ticket files and a purchase record onto the
 * ticket. Safe to repeat: a file already saved is not saved again.
 */
async function collectDocuments(rowId: string, t: LoadedTicket, provider: Provider, user: DeskUser) {
  const b = await prisma.ticketPortalBooking.findUniqueOrThrow({ where: { id: rowId } })
  if (!b.reference) return
  const live = await readLive(provider, b.reference)
  await prisma.ticketPortalBooking.update({ where: { id: rowId }, data: { detailsJson: clip(live, 2_000_000) } })

  const stored: StoredFiles = parse(b.fileIds) ?? { files: [], receiptUrl: null }
  const wanted = [
    ...(live.e_ticket_url ? [{ url: live.e_ticket_url, label: 'E-ticket' }] : []),
    ...live.links.filter(l => /voucher|ticket|pdf/i.test(`${l.label} ${l.url}`)).map(l => ({ url: l.url, label: `Voucher ${l.label}` })),
  ]
  for (let n = 0; n < wanted.length; n++) {
    const w = wanted[n]
    if (stored.files.some(f => f.src === w.url)) continue
    const got = await download(w.url)
    if (!got) continue
    const ext = got.type === 'application/pdf' ? 'pdf' : got.type.split('/')[1] || 'jpg'
    const fileUrl = await putUpload(`tickets/ticket-${t.id}-${Date.now()}-p${n}.${ext}`, got.body, got.type)
    try {
      const file = await prisma.ticketFile.create({
        data: {
          ticketId: t.id, fileUrl, fileName: `${label(provider)}-${b.reference}-${n + 1}.${ext}`.slice(0, 255),
          fileType: got.type.startsWith('image/') ? 'image' : 'pdf', label: w.label.slice(0, 191), position: 100 + stored.files.length,
          uploadedById: user.id, uploadedByName: 'Ticket Issue Desk',
        },
      })
      stored.files.push({ id: file.id, src: w.url })
    } catch (err) {
      console.warn('[ticket-portal] ticket_files not available:', err instanceof Error ? err.message : err)
      break
    }
  }

  const fresh = await prisma.ticket.findUnique({ where: { id: t.id }, select: { fileUrl: true } })
  if (!fresh?.fileUrl && !stored.receiptUrl) {
    const pdf = await receiptPdf(b, b.confirmedByName ?? actorName(user))
    const fileName = `PORTAL-RECORD-${b.reference}.pdf`
    const fileUrl = await putUpload(`tickets/ticket-${t.id}-${Date.now()}-record.pdf`, pdf, 'application/pdf')
    await prisma.ticket.update({ where: { id: t.id }, data: { fileUrl, fileName, fileType: 'pdf' } })
    stored.receiptUrl = fileUrl
  }
  await prisma.ticketPortalBooking.update({ where: { id: rowId }, data: { fileIds: JSON.stringify(stored) } })
}

/* ── release, cancel, check ─────────────────────────────────────────── */

export async function release(ticketId: string, bookingId: string, user: DeskUser) {
  const { t, b, provider } = await loadBooking(ticketId, bookingId, user)
  if (b.status === 'released') return bookingView(b)
  if (b.status !== 'reserved' || !b.reference) throw new DeskError(b.status === 'confirmed' ? 'A paid booking is cancelled, not released.' : `This booking is ${b.status} — there is no hold to release.`, 409)
  const ref = encodeURIComponent(b.reference)
  const res = provider === 'cebu' ? await backendPost(`/api/cebu/flow/order/${ref}/void`) : await backendGet(`/api/globaltix/product/booking/release/${ref}`)
  if (!res?.success) {
    const message = `${label(provider)} did not release ${b.reference} — ${why(res)}`
    await prisma.ticketPortalBooking.update({ where: { id: b.id }, data: { lastError: message.slice(0, 500), releaseJson: clip(res) } })
    throw new DeskError(message, 502)
  }
  const updated = await prisma.ticketPortalBooking.update({
    where: { id: b.id },
    data: { status: 'released', liveKey: null, releasedByName: actorName(user).slice(0, 191), releaseJson: clip(res), lastError: null },
  })
  await logActivity({ userId: user.id, action: 'TICKET_PORTAL_RELEASED', entityType: 'Ticket', entityId: t.id, details: { provider, reference: b.reference } })
  return bookingView(updated)
}

export async function cancel(ticketId: string, bookingId: string, code: string, user: DeskUser) {
  const { t, b, provider } = await loadBooking(ticketId, bookingId, user)
  if (b.status === 'cancelled') return bookingView(b)
  if (b.status !== 'confirmed' || !b.reference) throw new DeskError('Only a paid booking can be cancelled.', 409)
  if (provider === 'cebu') throw new DeskError('A paid Cebu order is cancelled on Cebu. Then press Check status here.', 409)
  await consumeOtp({ booking: otpSubject(b), purpose: 'CANCEL', code })

  const moved = await prisma.ticketPortalBooking.updateMany({ where: { id: b.id, status: 'confirmed' }, data: { status: 'cancelling', lastError: null } })
  if (!moved.count) throw new DeskError('Someone else is already cancelling this booking.', 409)

  let res: any
  try {
    res = await backendGet(`/api/globaltix/product/booking/cancel/${encodeURIComponent(b.reference)}`)
  } catch (err) {
    const message = `GlobalTix did not answer the cancel for ${b.reference} — ${(err as Error).message} Press Check status.`
    await prisma.ticketPortalBooking.update({ where: { id: b.id }, data: { lastError: message.slice(0, 500) } })
    throw new DeskError(message, 504)
  }
  // Only this word means it was cancelled; a non-refundable ticket answers otherwise.
  if (str(res?.data?.cancellationStatus) !== 'CANCELLED') {
    const message = `GlobalTix did not cancel ${b.reference} — ${str(res?.data?.cancellationStatus) ?? why(res)}`
    await prisma.ticketPortalBooking.update({ where: { id: b.id }, data: { status: 'confirmed', lastError: message.slice(0, 500), releaseJson: clip(res) } })
    throw new DeskError(message, 502)
  }
  return finalizeCancel(b.id, t, provider, user, res)
}

/** Put the ticket(s) back exactly as they were before this portal booking. */
async function finalizeCancel(rowId: string, t: LoadedTicket, provider: Provider, user: DeskUser, answer: unknown) {
  const b = await prisma.ticketPortalBooking.findUniqueOrThrow({ where: { id: rowId } })
  const before: any[] = parse(b.ticketSnapshot) ?? []
  const stored: StoredFiles = parse(b.fileIds) ?? { files: [], receiptUrl: null }
  const date = (v: unknown) => (v ? new Date(String(v)) : null)
  const now = new Date()

  await prisma.$transaction([
    ...before.map(x => prisma.ticket.update({
      where: { id: x.id },
      data: {
        status: x.status, purchasedAt: date(x.purchasedAt), reference: x.reference, qty: x.qty, supplier: x.supplier,
        costPerUnit: x.costPerUnit, totalCost: x.totalCost, currency: x.currency,
        portalId: x.portalId, portalName: x.portalName, portalRef: x.portalRef, portalBy: x.portalBy, portalAt: date(x.portalAt),
        notes: [x.notes, `${label(provider)} ${b.reference} cancelled by ${actorName(user)}`].filter(Boolean).join(' · '),
      },
    })),
    ...(stored.receiptUrl ? [prisma.ticket.updateMany({ where: { id: t.id, fileUrl: stored.receiptUrl }, data: { fileUrl: null, fileName: null, fileType: null } })] : []),
    // A cancelled voucher must not stay where a driver could use it.
    ...(stored.files.length ? [prisma.ticketFile.deleteMany({ where: { id: { in: stored.files.map(f => f.id) } } })] : []),
    prisma.ticketPortalBooking.update({
      where: { id: rowId },
      data: { status: 'cancelled', liveKey: null, cancelledByName: actorName(user).slice(0, 191), cancelledAt: now, releaseJson: clip(answer), lastError: null },
    }),
  ])
  await Promise.all(before.map(x => clearApprovalPurchased(x.id, b.reference)))
  await logActivity({ userId: user.id, action: 'TICKET_PORTAL_CANCELLED', entityType: 'Ticket', entityId: t.id, details: { provider, reference: b.reference } })
  return bookingView(await prisma.ticketPortalBooking.findUniqueOrThrow({ where: { id: rowId } }))
}

/** Read the portal's own record and settle this booking to match it. */
export async function checkStatus(ticketId: string, bookingId: string, user: DeskUser) {
  const { t, b, provider } = await loadBooking(ticketId, bookingId, user)
  if (!b.reference) throw new DeskError('This booking never got a portal reference.', 409)
  if (['confirming', 'cancelling'].includes(b.status) && Date.now() - b.updatedAt.getTime() < IN_FLIGHT_MS) {
    throw new DeskError('This booking is still being processed. Try again in a minute.', 409)
  }

  let live: PortalRecord
  try {
    live = await readLive(provider, b.reference)
  } catch (err) {
    throw new DeskError(err instanceof Error ? err.message : 'The portal could not be read.', 502)
  }
  const state = classifyStatus(provider, live.status)
  const setStatus = (status: string, extra: Record<string, unknown> = {}) =>
    prisma.ticketPortalBooking.update({ where: { id: b.id }, data: { status, lastError: null, detailsJson: clip(live, 2_000_000), ...extra } })

  if (['unknown', 'confirming', 'reserved'].includes(b.status)) {
    if (state === 'paid') return finalizeIssue(b.id, t, provider, user, { read_from: 'check status', live })
    if (state === 'cancelled' || state === 'ended') return bookingView(await setStatus('released', { liveKey: null }))
    return bookingView(await setStatus('reserved'))
  }
  if (['confirmed', 'cancelling'].includes(b.status)) {
    if (state === 'cancelled') return finalizeCancel(b.id, t, provider, user, { read_from: 'check status', live })
    const updated = await setStatus('confirmed')
    await collectDocuments(b.id, t, provider, user).catch(err => console.warn('[ticket-portal] documents not collected:', err instanceof Error ? err.message : err))
    return bookingView(await prisma.ticketPortalBooking.findUniqueOrThrow({ where: { id: updated.id } }))
  }
  return bookingView(b)
}
