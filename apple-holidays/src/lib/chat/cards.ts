/**
 * Openable record cards — the OPS half.
 *
 * Someone drops an IS number into a message and picks Invoice, P&L, Booking or
 * Agenda. The receiver clicks and reads the real record in place, whichever
 * system they happen to be sitting in and whether or not they have a login on
 * the system that owns the data.
 *
 * Two functions, and the split matters:
 *
 *   preview()   the small snapshot stored ON the message at send time — what the
 *               bubble prints, so the thread scrolls instantly.
 *   buildDocument()  the live read, done on every click. Figures in a popup are
 *               always today's figures; a snapshot is never allowed to pass for
 *               the current state of an invoice.
 *
 * The neutral document shape (hero + stats + sections) is identical to the one
 * app/Services/Chat/ChatCardService.php returns, so the same renderer draws all
 * four types in both products.
 *
 * Bookings and agendas come from this app's own Prisma. Invoices and P&L are
 * READ (never written) from the Accounts database over the existing accounts-db
 * connection.
 */
import type { RowDataPacket } from 'mysql2'
import { prisma } from '@/lib/prisma'
import { accountsQuery } from '@/lib/accounts-db'
import { CARDS, normaliseRef, type CardType } from './config'

export interface CardPreview {
  title: string
  subtitle: string | null
  meta: Array<{ label: string; value: string }>
  status: string
  status_tone: 'good' | 'bad' | 'warn' | 'neutral'
}

export interface CardSection {
  title: string
  type: 'table' | 'rows' | 'text'
  columns?: string[]
  rows?: Array<Array<string | number | null>> | Array<[string, string | number | null]>
  text?: string
}

export interface CardDocument {
  type: string
  ref: string
  title: string
  subtitle: string | null
  accent: string
  badges: Array<{ label: string; tone: string }>
  stats: Array<{ label: string; value: string; tone?: string }>
  sections: CardSection[]
  footnote: string
  read_at: string
}

/* ── formatting ────────────────────────────────────────────────────────────── */

function money(amount: unknown, currency: unknown): string {
  if (amount === null || amount === undefined || amount === '') return '—'
  const n = Number(amount)
  if (!Number.isFinite(n)) return '—'
  const cur = currency ? `${String(currency).toUpperCase()} ` : ''
  return `${cur}${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function date(value: unknown): string {
  if (!value) return '—'
  const d = new Date(value as string)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

function nightsBetween(a: Date | null, b: Date | null): number {
  if (!a || !b) return 0
  return Math.max(0, Math.round((b.getTime() - a.getTime()) / 86_400_000))
}

function paymentTone(status: string): CardPreview['status_tone'] {
  switch ((status || '').toLowerCase()) {
    case 'paid': case 'settled': case 'complete': case 'completed': return 'good'
    case 'partial': case 'partially_paid': return 'warn'
    case 'overdue': case 'unpaid': return 'bad'
    default: return 'neutral'
  }
}

/* ── resolvers ─────────────────────────────────────────────────────────────── */

/**
 * The two systems write the same reference differently — "IS 48541" here and
 * "IS48541" there — so every lookup compares on a space-stripped, upper-cased
 * form. Same normalisation the Invoice ↔ P&L match page uses.
 */
async function findInvoice(ref: string) {
  const rows = await accountsQuery<RowDataPacket>(
    `SELECT * FROM generated_invoices
     WHERE deleted_at IS NULL
       AND (REPLACE(UPPER(invoice_number), ' ', '') = ? OR REPLACE(UPPER(tour_ref), ' ', '') = ?)
     ORDER BY id DESC LIMIT 1`,
    [ref, ref],
  )
  return rows[0] ?? null
}

async function findPnl(ref: string) {
  const rows = await accountsQuery<RowDataPacket>(
    `SELECT * FROM pnl_records
     WHERE deleted_at IS NULL
       AND (REPLACE(UPPER(is_number), ' ', '') = ?
         OR REPLACE(UPPER(tour_ref), ' ', '') = ?
         OR REPLACE(UPPER(invoice_number), ' ', '') = ?)
     ORDER BY id DESC LIMIT 1`,
    [ref, ref, ref],
  )
  return rows[0] ?? null
}

/**
 * What to call a P&L row.
 *
 * Its own is_number is preferred, but rows imported from mail routinely carry a
 * literal "NA" there and are matched on tour_ref or invoice_number instead.
 * Titling that card "NA" would be worse than useless, so anything uninformative
 * falls through to the next identifier and finally to what was searched for.
 *
 * Mirrors ChatCardService::pnlLabel() in the Accounts app.
 */
function pnlLabel(pnl: RowDataPacket, searched: string): string {
  for (const candidate of [pnl.is_number, pnl.tour_ref, pnl.invoice_number]) {
    const value = String(candidate ?? '').trim()
    if (value && !['NA', 'N/A', '-'].includes(value.toUpperCase())) return value
  }
  return searched
}

/** The booking file, newest amendment first. */
async function findBooking(ref: string) {
  // Prisma has no expression index to match REPLACE(UPPER(...)), so the three
  // spellings a person might type are tried directly. All three columns are
  // indexed or unique, so this stays cheap.
  const spaced = ref.replace(/^([A-Z]+)(\d)/, '$1 $2')
  return prisma.booking.findFirst({
    where: {
      OR: [
        { isNumber: ref }, { isNumber: spaced },
        { bookingRef: ref }, { bookingRef: spaced },
        { cntlNumber: ref },
      ],
    },
    orderBy: { version: 'desc' },
  })
}

/* ── previews ──────────────────────────────────────────────────────────────── */

export async function preview(type: CardType, rawRef: string): Promise<CardPreview | null> {
  const ref = normaliseRef(rawRef)
  if (!ref) return null

  if (type === 'invoice') {
    const inv = await findInvoice(ref)
    if (!inv) return null
    return {
      title: String(inv.invoice_number ?? ref),
      subtitle: (inv.customer_name ?? inv.guest_name ?? null) as string | null,
      meta: [
        { label: 'Date', value: date(inv.invoice_date) },
        { label: 'Amount', value: money(inv.grand_total ?? inv.total_amount, inv.currency) },
      ],
      status: String(inv.payment_status ?? inv.status ?? 'ISSUED').toUpperCase(),
      status_tone: paymentTone(String(inv.payment_status ?? '')),
    }
  }

  if (type === 'pnl') {
    const pnl = await findPnl(ref)
    if (!pnl) return null
    const pl = Number(pnl.profit_loss ?? 0)
    return {
      title: pnlLabel(pnl, ref),
      subtitle: (pnl.guest_name ?? pnl.agent_name ?? null) as string | null,
      meta: [
        { label: 'Sell', value: money(pnl.amount, pnl.currency) },
        { label: 'P&L', value: money(pl, pnl.currency) },
        { label: 'Pax', value: String(pnl.total_pax ?? '—') },
      ],
      status: pl >= 0 ? 'PROFIT' : 'LOSS',
      status_tone: pl >= 0 ? 'good' : 'bad',
    }
  }

  const booking = await findBooking(ref)
  if (!booking) return null

  if (type === 'booking') {
    return {
      title: booking.isNumber || booking.bookingRef,
      subtitle: booking.dealName || booking.agent,
      meta: [
        { label: 'Arrival', value: date(booking.arrivalDate) },
        { label: 'Nights', value: String(nightsBetween(booking.arrivalDate, booking.departureDate)) },
        { label: 'Pax', value: String(booking.paxAdults + booking.paxChildren + booking.paxInfants) },
      ],
      status: String(booking.status).replace(/_/g, ' '),
      status_tone: booking.status === 'CANCELLED' ? 'bad' : 'neutral',
    }
  }

  // agenda
  const agenda = await prisma.tourAgenda.findUnique({
    where: { bookingId: booking.id },
    include: { items: { select: { date: true } } },
  })
  if (!agenda) return null

  const days = new Set(agenda.items.map(i => i.date.toISOString().slice(0, 10))).size
  return {
    title: `${booking.isNumber || booking.bookingRef} · Agenda`,
    subtitle: booking.tourDestination || booking.dealName,
    meta: [
      { label: 'Days', value: String(days) },
      { label: 'Moves', value: String(agenda.items.length) },
      { label: 'From', value: date(booking.arrivalDate) },
    ],
    status: 'ITINERARY',
    status_tone: 'neutral',
  }
}

/* ── live documents ────────────────────────────────────────────────────────── */

export async function buildDocument(type: CardType, rawRef: string): Promise<CardDocument> {
  const ref = normaliseRef(rawRef)
  const built = await build(type, ref)

  if (!built) {
    throw new Error(
      `No ${CARDS[type]?.label ?? type} could be found for “${ref}” right now. `
      + 'It may have been amended, cancelled or archived.',
    )
  }

  return {
    ...built,
    type,
    ref,
    accent: CARDS[type]?.accent ?? '#6366f1',
    // Stamped so a screenshot of the popup is self-dating.
    read_at: new Date().toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }),
  }
}

type PartialDoc = Omit<CardDocument, 'type' | 'ref' | 'accent' | 'read_at'>

async function build(type: CardType, ref: string): Promise<PartialDoc | null> {
  switch (type) {
    case 'invoice': return invoiceDoc(ref)
    case 'pnl': return pnlDoc(ref)
    case 'booking': return bookingDoc(ref)
    case 'agenda': return agendaDoc(ref)
    default: return null
  }
}

async function invoiceDoc(ref: string): Promise<PartialDoc | null> {
  const inv = await findInvoice(ref)
  if (!inv) return null

  const sections: CardSection[] = []

  // `calculations` is free-form JSON written by whichever flow generated the
  // invoice, so every key it might use for lines is tried rather than assumed.
  let calc: Record<string, unknown> = {}
  try { calc = typeof inv.calculations === 'string' ? JSON.parse(inv.calculations) : (inv.calculations ?? {}) } catch { calc = {} }
  const lines = (calc.items ?? calc.lines ?? []) as Array<Record<string, unknown>>

  if (Array.isArray(lines) && lines.length) {
    sections.push({
      title: 'Invoice lines',
      type: 'table',
      columns: ['Description', 'Qty', 'Rate', 'Amount'],
      rows: lines.map(l => [
        String(l.description ?? l.name ?? l.label ?? '—'),
        String(l.qty ?? l.quantity ?? ''),
        money(l.rate ?? l.unit_price, inv.currency),
        money(l.amount ?? l.total, inv.currency),
      ]),
    })
  }

  sections.push({
    title: 'Billing',
    type: 'rows',
    rows: ([
      ['Customer', inv.customer_name],
      ['Guest', inv.guest_name],
      ['Tour ref', inv.tour_ref],
      ['GST number', inv.gst_number],
      ['Sales person', inv.sales_person],
      ['Invoice type', inv.invoice_type],
      inv.is_cancellation ? ['Cancellation invoice', 'Yes'] : null,
    ].filter(r => r && r[1] !== null && r[1] !== '') as Array<[string, string]>),
  })

  sections.push({
    title: 'Payment',
    type: 'rows',
    rows: [
      ['Status', String(inv.payment_status ?? '—').toUpperCase()],
      ['Paid', money(inv.paid_amount, inv.currency)],
      ['Balance', money(inv.balance_amount, inv.currency)],
      ['First payment', date(inv.first_payment_at)],
      ['Last payment', date(inv.last_payment_at)],
    ],
  })

  return {
    title: String(inv.invoice_number ?? ref),
    subtitle: (inv.customer_name ?? inv.guest_name ?? null) as string | null,
    badges: [
      { label: String(inv.payment_status ?? 'UNPAID').toUpperCase(), tone: paymentTone(String(inv.payment_status ?? '')) },
      ...(inv.is_cancellation ? [{ label: 'CANCELLATION', tone: 'bad' }] : []),
      { label: String(inv.currency ?? ''), tone: 'ghost' },
    ].filter(b => b.label),
    stats: [
      { label: 'Subtotal', value: money(inv.total_amount, inv.currency) },
      { label: 'Handling', value: money(inv.handling_fee, inv.currency) },
      { label: 'Grand total', value: money(inv.grand_total, inv.currency) },
      { label: 'Paid', value: money(inv.paid_amount, inv.currency) },
      { label: 'Balance', value: money(inv.balance_amount, inv.currency) },
      { label: 'Date', value: date(inv.invoice_date) },
    ],
    sections,
    footnote: 'Read live from the Accounts system.',
  }
}

async function pnlDoc(ref: string): Promise<PartialDoc | null> {
  const pnl = await findPnl(ref)
  if (!pnl) return null

  const items = await accountsQuery<RowDataPacket>(
    'SELECT * FROM pnl_items WHERE pnl_record_id = ? ORDER BY id ASC', [pnl.id],
  )

  const pl = Number(pnl.profit_loss ?? 0)
  const sell = Number(pnl.amount ?? 0)
  const margin = sell > 0 ? Math.round((pl / sell) * 1000) / 10 : null

  const sections: CardSection[] = []

  if (items.length) {
    sections.push({
      title: 'Cost lines',
      type: 'table',
      columns: ['Type', 'Service', 'Dates', 'Currency', 'Amount', 'Converted'],
      rows: items.map(i => [
        String(i.type ?? '—'),
        String(i.hotel_name ?? i.transport_name ?? i.service_name ?? '—'),
        [i.check_in_date ? date(i.check_in_date) : '', i.check_out_date ? `→ ${date(i.check_out_date)}` : '']
          .filter(Boolean).join(' ') || '—',
        String(i.currency ?? '—'),
        money(i.amount_original, i.currency),
        money(i.amount_converted, pnl.currency),
      ]),
    })
  }

  sections.push({
    title: 'Booking',
    type: 'rows',
    rows: ([
      ['IS number', pnl.is_number],
      ['Tour ref', pnl.tour_ref],
      ['Invoice', pnl.invoice_number],
      ['Guest', pnl.guest_name],
      ['Agent', pnl.agent_name],
      ['Country', pnl.country_code],
      ['Pax', pnl.total_pax],
      ['Nights', pnl.total_nights],
      ['Exchange', pnl.exchange_rate ?? pnl.exchange_rate_used],
    ].filter(r => r[1] !== null && r[1] !== undefined && r[1] !== '') as Array<[string, string]>),
  })

  return {
    title: pnlLabel(pnl, ref),
    subtitle: (pnl.guest_name ?? pnl.agent_name ?? null) as string | null,
    badges: [
      { label: pl >= 0 ? 'PROFIT' : 'LOSS', tone: pl >= 0 ? 'good' : 'bad' },
      ...(pnl.country_code ? [{ label: String(pnl.country_code).toUpperCase(), tone: 'ghost' }] : []),
      ...(pnl.status ? [{ label: String(pnl.status).toUpperCase(), tone: 'neutral' }] : []),
    ],
    stats: [
      { label: 'Sell', value: money(sell, pnl.currency) },
      { label: 'Cost', value: money(sell - pl, pnl.currency) },
      { label: 'P&L', value: money(pl, pnl.currency), tone: pl >= 0 ? 'good' : 'bad' },
      ...(margin !== null ? [{ label: 'Margin', value: `${margin}%`, tone: pl >= 0 ? 'good' : 'bad' }] : []),
      { label: 'Pax', value: String(pnl.total_pax ?? '—') },
      { label: 'Nights', value: String(pnl.total_nights ?? '—') },
    ],
    sections,
    footnote: 'Read live from the Accounts system.',
  }
}

async function bookingDoc(ref: string): Promise<PartialDoc | null> {
  const b = await findBooking(ref)
  if (!b) return null

  const [passengers, accommodations, flights] = await Promise.all([
    prisma.passenger.findMany({ where: { bookingId: b.id }, orderBy: { isLead: 'desc' } }),
    prisma.accommodation.findMany({ where: { bookingId: b.id }, orderBy: { checkIn: 'asc' } }),
    prisma.flight.findMany({ where: { bookingId: b.id }, orderBy: { date: 'asc' } }),
  ])

  const sections: CardSection[] = []

  if (passengers.length) {
    sections.push({
      title: 'Passengers',
      type: 'table',
      columns: ['Name', 'Type', 'Age', 'Passport', 'Nationality'],
      rows: passengers.map(p => [
        p.name + (p.isLead ? '  ★' : ''),
        p.type, p.age ?? '—', p.passport ?? '—', p.nationality ?? '—',
      ]),
    })
  }

  if (accommodations.length) {
    sections.push({
      title: 'Accommodation',
      type: 'table',
      columns: ['Hotel', 'City', 'Check in', 'Check out', 'Nights', 'Room', 'Board'],
      rows: accommodations.map(a => [
        a.hotel + (a.ownArrangement ? ' (own arrangement)' : ''),
        a.city, date(a.checkIn), date(a.checkOut), a.nights, a.roomType ?? '—', a.mealType ?? '—',
      ]),
    })
  }

  if (flights.length) {
    sections.push({
      title: 'Flights',
      type: 'table',
      columns: ['Date', 'Flight', 'Airline', 'From', 'Departs', 'To', 'Arrives'],
      rows: flights.map(f => [
        date(f.date), f.flightNo, f.airline ?? '—', f.fromApt, f.depTime, f.toApt, f.arrTime,
      ]),
    })
  }

  sections.push({
    title: 'File',
    type: 'rows',
    rows: ([
      ['Booking ref', b.bookingRef],
      ['IS number', b.isNumber],
      ['Control no', b.cntlNumber],
      ['Agent', b.agent],
      ['Agent country', b.agentCountry],
      ['File handler', b.fileHandler],
      ['Destination', b.tourDestination],
      ['Deal', b.dealName],
      ['Version', b.version],
      ['Cancellation deadline', b.cancellationDeadline ? date(b.cancellationDeadline) : null],
    ].filter(r => r[1] !== null && r[1] !== undefined && r[1] !== '') as Array<[string, string]>),
  })

  const freeText: Array<[string, string | null]> = [
    ['Client request', b.clientRequest],
    ['Package includes', b.packageIncludes],
    ['Package excludes', b.packageExcludes],
    ['Important notes', b.importantNotes],
  ]
  freeText.forEach(([title, text]) => {
    if (text && text.trim()) sections.push({ title, type: 'text', text })
  })

  return {
    title: b.isNumber || b.bookingRef,
    subtitle: b.dealName || b.agent,
    badges: [
      { label: String(b.status).replace(/_/g, ' '), tone: b.status === 'CANCELLED' ? 'bad' : 'neutral' },
      ...(b.operationCountry ? [{ label: String(b.operationCountry), tone: 'ghost' }] : []),
      ...(b.hotelOnly ? [{ label: 'HOTEL ONLY', tone: 'warn' }] : []),
    ],
    stats: [
      { label: 'Arrival', value: date(b.arrivalDate) },
      { label: 'Departure', value: date(b.departureDate) },
      { label: 'Nights', value: String(nightsBetween(b.arrivalDate, b.departureDate)) },
      { label: 'Adults', value: String(b.paxAdults) },
      { label: 'Children', value: String(b.paxChildren) },
      { label: 'Quoted', value: money(b.quotedTotal, b.currency) },
    ],
    sections,
    footnote: 'Read live from the Operations system.',
  }
}

async function agendaDoc(ref: string): Promise<PartialDoc | null> {
  const b = await findBooking(ref)
  if (!b) return null

  const agenda = await prisma.tourAgenda.findUnique({
    where: { bookingId: b.id },
    include: { items: { orderBy: [{ date: 'asc' }, { sortOrder: 'asc' }] } },
  })
  if (!agenda) return null

  // One section per day, so the popup reads like the itinerary it is rather than
  // one long undifferentiated table.
  const byDay = new Map<string, typeof agenda.items>()
  agenda.items.forEach(i => {
    const key = i.date.toISOString().slice(0, 10)
    const list = byDay.get(key) ?? []
    list.push(i)
    byDay.set(key, list)
  })

  const sections: CardSection[] = Array.from(byDay.entries()).map(([day, items]) => ({
    title: new Date(day).toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' }),
    type: 'table' as const,
    columns: ['Time', 'From', 'To', 'Location / detail', 'Service'],
    rows: items.map(i => [
      [i.timeFrom, i.timeTo].filter(Boolean).join(' – ') || i.meetingTime || '—',
      i.fromPoint || '—',
      i.toPoint || '—',
      [i.location, i.details].filter(Boolean).join(' — ') || '—',
      i.isLeisure ? 'Leisure' : String(i.serviceType).replace(/_/g, ' '),
    ]),
  }))

  return {
    title: `${b.isNumber || b.bookingRef} · Tour agenda`,
    subtitle: b.tourDestination || b.dealName,
    badges: [
      { label: `${sections.length} ${sections.length === 1 ? 'day' : 'days'}`, tone: 'neutral' },
      ...(b.operationCountry ? [{ label: String(b.operationCountry), tone: 'ghost' }] : []),
    ],
    stats: [
      { label: 'Days', value: String(sections.length) },
      { label: 'Movements', value: String(agenda.items.length) },
      { label: 'Arrival', value: date(b.arrivalDate) },
      { label: 'Departure', value: date(b.departureDate) },
    ],
    sections,
    footnote: 'Read live from the Operations system.',
  }
}

/* ── type-ahead ────────────────────────────────────────────────────────────── */

/** Runs on every keystroke in the composer, so it stays prefix-based and small. */
export async function suggest(type: CardType, term: string, limit = 8): Promise<Array<{ ref: string; label: string | null }>> {
  const q = normaliseRef(term)
  if (q.length < 2) return []

  if (type === 'invoice') {
    const rows = await accountsQuery<RowDataPacket>(
      `SELECT invoice_number AS ref, customer_name AS label FROM generated_invoices
       WHERE deleted_at IS NULL AND REPLACE(UPPER(invoice_number), ' ', '') LIKE ?
       ORDER BY id DESC LIMIT ${limit}`,
      [`${q}%`],
    )
    return rows.map(r => ({ ref: String(r.ref), label: r.label as string | null }))
  }

  if (type === 'pnl') {
    const rows = await accountsQuery<RowDataPacket>(
      `SELECT is_number AS ref, guest_name AS label FROM pnl_records
       WHERE deleted_at IS NULL AND REPLACE(UPPER(is_number), ' ', '') LIKE ?
       ORDER BY id DESC LIMIT ${limit}`,
      [`${q}%`],
    )
    return rows.map(r => ({ ref: String(r.ref), label: r.label as string | null }))
  }

  const bookings = await prisma.booking.findMany({
    where: { isNumber: { startsWith: q } },
    select: { isNumber: true, dealName: true },
    orderBy: { createdAt: 'desc' },
    take: limit,
  })
  return bookings
    .filter(b => b.isNumber)
    .map(b => ({ ref: b.isNumber as string, label: b.dealName }))
}
