/**
 * Tickets from the Detailed P&L.
 *
 * Tickets used to be created one per `pnl_items` row, which is the Accounts
 * app's flat invoice-line view of a booking — two lines reading "Transport" for
 * a whole Sri Lanka tour. The costing sheet the Detailed P&L renders is the
 * itemised truth: each hotel stay, each attraction, each transfer leg, each
 * transport charge, each meal day. Costing tickets off that gives operations a
 * ticket per thing that actually has to be bought.
 *
 * Idempotency works exactly as the old sync did — every ticket carries a tag in
 * its `notes` and a re-run matches on it — but the tag now names a costing-sheet
 * row (`Detailed P&L #transport:2:guide-fee`) instead of a PNL item id. The key
 * is derived from the section, the row's position within it and its
 * description, so a booking re-costed on a new amendment maps its rows back to
 * the tickets they already produced.
 *
 * PURCHASED / PAID tickets are never touched. Only DRAFT tickets are updated on
 * a resync, and nothing is ever deleted.
 */
import { prisma } from '../prisma'
import { fitTicketType, TICKET_TYPE_MAX } from '../utils'
import { pnum } from './derive'
import type { DetailedPnl } from './render'

export const DETAILED_TAG_PREFIX = 'Detailed P&L #'

/** One purchasable line, as the costing sheet states it. */
export interface TicketSpec {
  /** Stable identity within the booking — the idempotency key. */
  key: string
  /** Ticket.type — what is being bought. */
  name: string
  category: 'HOTEL' | 'TRANSPORT' | 'TICKETS' | 'OTHER'
  qty: number
  totalCost: number
  /** Free-text detail that lands in `notes` ahead of the tag. */
  details: string[]
}

/** "Guide Fee" → "guide-fee"; keeps the tag readable and stable. */
function slug(s: string): string {
  return String(s ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'line'
}

export function detailedTicketTag(key: string): string {
  return `${DETAILED_TAG_PREFIX}${key}`
}

/**
 * Every line of the costing sheet that represents something to buy.
 *
 * Three kinds of row are deliberately left out, because none of them is a
 * purchase:
 *   - `info` transport rows (driver / guide accommodation), which the API
 *     prices inside the hotel costing and the sheet already brackets;
 *   - rows totalling zero, which state "not charged here" rather than an order;
 *   - the unitemised balancing lines, which are a reconciliation against the
 *     API's section figure, not a supplier's invoice.
 */
export function ticketSpecsFromDetailed(detail: DetailedPnl): TicketSpec[] {
  const { tables, dayDates } = detail
  const specs: TicketSpec[] = []

  const dayNote = (day: string | number): string | null => {
    const key = String(pnum(day as never) || '')
    if (!key) return null
    const date = dayDates[key]
    return `Day ${key}${date ? ` · ${date}` : ''}`
  }

  /* ---------- Hotels — one ticket per stay ---------- */
  tables.stays.forEach((h, i) => {
    if (!h.total) return
    const rooms = pnum(h.sgl.rooms) + pnum(h.dbl.rooms) + pnum(h.tpl.rooms)
    specs.push({
      key: `hotel:${i}:${slug(h.name)}`,
      name: h.name,
      category: 'HOTEL',
      qty: rooms || 1,
      totalCost: h.total,
      details: [
        h.type ? `Type: ${h.type}` : null,
        h.stay || null,
        h.cat || null,
        h.meal && h.meal !== '—' ? `Meal plan: ${h.meal}` : null,
        h.nights ? `${h.nights} night${h.nights === 1 ? '' : 's'}` : null,
        rooms ? `${rooms} room${rooms === 1 ? '' : 's'}` : null,
      ].filter((x): x is string => Boolean(x)),
    })
  })

  /* ---------- Attraction + Tour Transfers — one ticket per product ---------- */
  const productSections: Array<['product' | 'transfer', typeof tables.products, 'TICKETS' | 'TRANSPORT']> = [
    ['product',  tables.products,  'TICKETS'],
    ['transfer', tables.transfers, 'TRANSPORT'],
  ]
  for (const [section, rows, category] of productSections) {
    rows.forEach((p, i) => {
      if (!p.total) return
      const adults = pnum(p.adultCount), children = pnum(p.childCount)
      specs.push({
        key: `${section}:${i}:${slug(p.id || p.name)}`,
        name: p.name,
        category,
        qty: (adults + children) || 1,
        totalCost: p.total,
        details: [
          p.type ? `Type: ${p.type}` : null,
          p.day ? dayNote(p.day) : null,
          p.city ? `City: ${p.city}` : null,
          adults ? `Adults: ${adults}${p.adultRate ? ` @ ${p.adultRate}` : ''}` : null,
          children ? `Children: ${children}${p.childRate ? ` @ ${p.childRate}` : ''}` : null,
        ].filter((x): x is string => Boolean(x)),
      })
    })
  }

  /* ---------- Transport — one ticket per charged line ---------- */
  tables.transport.forEach((t, i) => {
    // `info` rows are priced under the hotel costing, and the sheet brackets
    // their amount for exactly that reason — they are not a purchase here.
    if (t.info || !t.total) return
    specs.push({
      key: `transport:${i}:${slug(t.desc)}`,
      name: t.desc,
      category: 'TRANSPORT',
      // A ticket's qty is how many of the thing are being bought, which is only
      // the sheet's count when the charge is billed in countable units — days
      // of bata, nights of accommodation, a quantity of sundries. A distance is
      // not a quantity: a 980 km transfer is one vehicle hire, so it takes
      // qty 1 and keeps its distance in the notes below.
      qty: ['Days', 'Nights', 'Qty'].includes(t.unit) ? pnum(t.count as never) || 1 : 1,
      totalCost: t.total,
      details: [
        t.sub || null,
        t.count !== '' && t.unit && t.unit !== 'NA' ? `${t.count} ${t.unit}` : null,
        t.rate !== '' && pnum(t.rate as never) ? `Rate: ${t.rate}` : null,
      ].filter((x): x is string => Boolean(x)),
    })
  })

  /* ---------- Meals — one ticket per costed day ---------- */
  const SLOT_NAMES: Record<string, string> = { '1': 'Breakfast', '2': 'Lunch', '3': 'Dinner' }
  tables.meals.forEach(m => {
    if (!m.total) return
    const slots = Object.entries(m.slots)
      .filter(([, sl]) => sl.adultRate || sl.childRate)
      .map(([k]) => SLOT_NAMES[k])
      .filter(Boolean)
    specs.push({
      key: `meal:day-${m.day}`,
      name: `Meals — Day ${m.day}`,
      category: 'OTHER',
      qty: (m.adults + m.children) || 1,
      totalCost: m.total,
      details: [
        dayNote(m.day),
        slots.length ? slots.join(', ') : null,
        m.adults ? `Adults: ${m.adults}` : null,
        m.children ? `Children: ${m.children}` : null,
      ].filter((x): x is string => Boolean(x)),
    })
  })

  // Ad-hoc meals the API filed under cost.other.
  tables.mealExtras.forEach((x, i) => {
    if (!x.total) return
    specs.push({
      key: `meal-extra:${i}:${slug(x.label)}`,
      name: x.label,
      category: 'OTHER',
      qty: pnum(x.count as never) || 1,
      totalCost: x.total,
      details: [
        SLOT_NAMES[x.slot] ? `Meal: ${SLOT_NAMES[x.slot]}` : null,
        x.rate ? `Rate: ${x.rate}` : null,
        'Billed under the API other costs',
      ].filter((x): x is string => Boolean(x)),
    })
  })

  /* ---------- Others ---------- */
  tables.others.forEach((o, i) => {
    // The unitemised balance is a reconciliation against the API's own figure,
    // not a charge anyone raises an order against.
    if (!o.total || /—\s*unitemised$/.test(o.desc)) return
    specs.push({
      key: `other:${i}:${slug(o.desc)}`,
      name: o.desc,
      category: 'OTHER',
      // Same rule as the transport lines: only a countable unit is a quantity.
      qty: ['Days', 'Nights', 'Qty'].includes(o.unit) ? pnum(o.count as never) || 1 : 1,
      totalCost: o.total,
      details: [
        o.sub || null,
        o.count !== '' && o.unit && o.unit !== 'NA' ? `${o.count} ${o.unit}` : null,
        o.rate !== '' && pnum(o.rate as never) ? `Rate: ${o.rate}` : null,
      ].filter((x): x is string => Boolean(x)),
    })
  })

  return specs
}

export interface SyncResult { created: number; updated: number; skipped: number }

function noteFor(spec: TicketSpec): string {
  // A name too long for `Ticket.type` is not lost — it is kept in full here,
  // where the column is TEXT.
  const fullName = spec.name.length > TICKET_TYPE_MAX ? `Full name: ${spec.name}` : null
  return [fullName, ...spec.details, detailedTicketTag(spec.key)].filter(Boolean).join(' · ')
}

/**
 * Create tickets for costing-sheet lines that have none; when `resync` is true,
 * also refresh existing DRAFT tickets from the latest costing.
 *
 * Never deletes, and never modifies a ticket that has left DRAFT — a purchased
 * ticket is a commitment already made, and a re-costed booking must not rewrite
 * what was bought.
 */
export async function syncTicketsFromDetailed(
  bookingId: string,
  detail: DetailedPnl,
  opts: { resync?: boolean } = {},
): Promise<SyncResult> {
  const resync = opts.resync ?? false
  const specs = ticketSpecsFromDetailed(detail)
  if (!specs.length) return { created: 0, updated: 0, skipped: 0 }

  const existing = await prisma.ticket.findMany({
    where: { bookingId },
    select: { id: true, status: true, notes: true },
  })

  // Map "Detailed P&L #<key>" → the ticket already carrying it.
  const tagToTicket = new Map<string, { id: string; status: string }>()
  for (const t of existing) {
    for (const part of (t.notes ?? '').split(' · ')) {
      if (part.startsWith(DETAILED_TAG_PREFIX)) tagToTicket.set(part, { id: t.id, status: t.status })
    }
  }

  let created = 0, updated = 0, skipped = 0

  for (const spec of specs) {
    const tag = detailedTicketTag(spec.key)
    const found = tagToTicket.get(tag)
    const data = {
      type:      fitTicketType(spec.name),
      category:  spec.category,
      qty:       Math.max(1, Math.round(spec.qty)),
      totalCost: spec.totalCost,
      currency:  detail.currency,
      notes:     noteFor(spec),
    }

    if (!found) {
      await prisma.ticket.create({ data: { bookingId, ...data, status: 'DRAFT' } })
      created++
    } else if (resync && found.status === 'DRAFT') {
      await prisma.ticket.update({ where: { id: found.id }, data })
      updated++
    } else {
      skipped++
    }
  }

  return { created, updated, skipped }
}
