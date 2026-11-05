/**
 * What an Aahaas B2C order is worth, in the currency the customer paid AND the
 * store's base currency — the figures AahaasFlow shows on its order page
 * (order value, product total, paid, balance), plus the invoice that goes with
 * them. Read-only: every statement goes through `b2cQuery()`'s guard.
 *
 * Where each figure lives (same reads as n8n-project `flow.ledger.js`):
 *
 *   tbl_checkout_ids     the order: total / paid / balance / discount, in the
 *                        order currency (what the customer was charged in)
 *   tbl_checkouts        one row per product: currency, total / paid / balance
 *   checkouts_more_data  `base_currency` and `base_paid_rate` — the order-day
 *                        rate, "order currency × rate = base currency". The
 *                        OPS P&L is in the base currency (net_total_amount).
 *
 * The rate is the store's own, fixed when the order was placed — never a live
 * market rate — so the two columns always reconcile with what Accounts and
 * AahaasFlow see.
 */
import type mysql from 'mysql2/promise'
import { b2cQuery, fetchFlightBookings, fetchOrderCustomers, FLIGHT_CATEGORY_ID } from './b2c-db'
import { describeRoute, parseFlightBooking, type ParsedFlightBooking } from './b2c-flight'

/** `tbl_checkout_ids.channel` → the label AahaasFlow uses for it. */
export const B2C_CHANNELS: Record<string, string> = {
  call: 'AI Voice',
  whatsapp: 'AI WhatsApp',
  travel_quote_gpt: 'AI Chat',
  web: 'AI Web',
  app: 'AI Mobile',
  facebook: 'Facebook',
  instagram: 'Instagram',
  b2b_portal: 'B2B portal',
  unrecorded: 'Not recorded',
}

const CATEGORY_NAMES: Record<number, string> = {
  1: 'Essentials', 2: 'Non essentials', 3: 'Lifestyle', 4: 'Hotel', 5: 'Education', 6: 'Flight',
}

const CANCELLED = /^(cancel|cancelled|refunded|amended)$/i

export interface Amount {
  /** In the order currency (what the customer paid in). */
  order: number | null
  /** The same amount in the base currency, at the order-day rate. */
  base: number | null
}

export interface B2cInvoiceLine {
  lineId: number
  title: string
  detail: string | null
  category: string
  serviceDate: string | null
  quantity: number
  currency: string | null
  total: number | null
  cancelled: boolean
}

export interface B2cOrderMoney {
  orderId: number
  bookedAt: string | null
  channel: string
  channelLabel: string
  payCategory: string | null
  paymentType: string | null
  paymentStatus: string | null
  checkoutStatus: string | null
  orderCurrency: string | null
  baseCurrency: string | null
  /** Order currency → base currency multiplier (`base_paid_rate`). */
  rate: number | null
  /** "1 USD = 335.57 LKR" — how people quote it. */
  rateLabel: string | null
  orderValue: Amount
  productTotal: Amount
  discount: Amount
  paid: Amount
  balance: Amount
  settled: boolean
  lines: B2cInvoiceLine[]
  billTo: { name: string | null; email: string | null; phone: string | null }
  /** Where the e-ticket went, when the order has a flight. */
  ticketContact: { email: string | null; phone: string | null } | null
  pnrs: string[]
  firstService: string | null
  lastService: string | null
  aahaasFlowUrl: string
}

interface HeaderRow extends mysql.RowDataPacket {
  order_id: number
  checkout_date: string | null
  total_amount: string | number | null
  paid_amount: string | number | null
  balance_amount: string | number | null
  discount_amount: string | number | null
  payment_type: string | null
  pay_category: string | null
  payment_status: string | null
  checkout_status: string | null
  channel: string | null
}

interface LineRow extends mysql.RowDataPacket {
  line_id: number
  main_category_id: number | null
  status: string | null
  currency: string | null
  total_amount: string | number | null
  quantity: string | number | null
  delivery_date: string | null
  product_name: string | null
  service_date: string | null
  base_currency: string | null
  base_paid_rate: string | number | null
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
const r2 = (n: number | null) => (n === null ? null : Math.round(n * 100) / 100)
const upper = (v: string | null | undefined) => (v && v.trim() ? v.trim().toUpperCase() : null)

/** Base URL of the AahaasFlow board, for "Open in AahaasFlow". */
export function aahaasFlowOrderUrl(orderId: number): string {
  const base = (process.env.AAHAAS_FLOW_URL || 'https://ai.aahaas.com/aahaasFlow').replace(/\/+$/, '')
  return `${base}/#/b2c/order/${orderId}`
}

let channelColumn: { at: number; present: boolean } | null = null

/** `tbl_checkout_ids.channel` was added after launch; probe instead of assuming. */
async function hasChannelColumn(): Promise<boolean> {
  if (channelColumn && Date.now() - channelColumn.at < 30 * 60_000) return channelColumn.present
  const rows = await b2cQuery<mysql.RowDataPacket & { n: number }>(
    `SELECT COUNT(*) AS n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tbl_checkout_ids' AND COLUMN_NAME = 'channel'`,
  )
  channelColumn = { at: Date.now(), present: Number(rows[0]?.n ?? 0) > 0 }
  return channelColumn.present
}

/** Null when the store has no live order by that id. */
export async function fetchB2cOrderMoney(orderId: number): Promise<B2cOrderMoney | null> {
  if (!Number.isInteger(orderId) || orderId <= 0) throw new Error(`Invalid B2C order id: ${String(orderId)}`)

  const withChannel = await hasChannelColumn()
  const [headers, lines, customers, flightRows] = await Promise.all([
    b2cQuery<HeaderRow>(
      `SELECT o.id AS order_id, o.checkout_date, o.total_amount, o.paid_amount, o.balance_amount,
              o.discount_amount, o.payment_type, o.pay_category, o.payment_status, o.checkout_status,
              ${withChannel ? 'o.channel' : 'NULL AS channel'}
         FROM tbl_checkout_ids o
        WHERE o.id = ? AND o.deleted_at IS NULL`,
      [orderId],
    ),
    // The latest cost row per product: a re-priced line leaves its older row behind.
    b2cQuery<LineRow>(
      `SELECT ch.id AS line_id, ch.main_category_id, ch.status, ch.currency, ch.total_amount,
              ch.quantity, ch.delivery_date,
              m.product_name, m.service_date, m.base_currency, m.base_paid_rate
         FROM tbl_checkouts ch
         LEFT JOIN (SELECT checkout_id, MAX(id) AS id
                      FROM checkouts_more_data
                     WHERE order_id = ?
                     GROUP BY checkout_id) last ON last.checkout_id = ch.id
         LEFT JOIN checkouts_more_data m ON m.id = last.id
        WHERE ch.checkout_id = ? AND ch.deleted_at IS NULL
        ORDER BY ch.id`,
      [orderId, orderId],
    ),
    fetchOrderCustomers([orderId]),
    fetchFlightBookings([orderId]),
  ])
  const header = headers[0]
  if (!header) return null

  const flights = flightRows.map((r) => parseFlightBooking(r))
  // The latest booking row is the live ticket after a reissue.
  const flight: ParsedFlightBooking | undefined = flights[flights.length - 1]

  const live = lines.filter((l) => !CANCELLED.test(String(l.status ?? '').trim()))
  const orderCurrency = upper(live[0]?.currency) ?? upper(lines[0]?.currency)
  const baseCurrency = upper(lines.find((l) => l.base_currency)?.base_currency)
  const rate = num(lines.find((l) => num(l.base_paid_rate))?.base_paid_rate)
  const sameCurrency = !orderCurrency || !baseCurrency || orderCurrency === baseCurrency
  const amount = (order: number | null): Amount => ({
    order: r2(order),
    base: order === null ? null : sameCurrency ? r2(order) : rate ? r2(order * rate) : null,
  })

  const productTotal = live.reduce((sum, l) => sum + (num(l.total_amount) ?? 0), 0)
  const orderValue = num(header.total_amount)
  const balance = num(header.balance_amount)

  const invoiceLines: B2cInvoiceLine[] = lines.map((l) => {
    const isFlight = Number(l.main_category_id) === FLIGHT_CATEGORY_ID
    const route = isFlight && flight ? describeRoute(flight) : null
    const title = (l.product_name ?? '').trim() || (route ? `Flight ${route}` : CATEGORY_NAMES[Number(l.main_category_id)] ?? 'Travel service')
    const detail = isFlight && flight
      ? [`Flight`, route, flight.pnr ? `PNR ${flight.pnr}` : null, flight.passengerNames.join(', ') || null].filter(Boolean).join(' · ')
      : null
    return {
      lineId: Number(l.line_id),
      title,
      detail,
      category: CATEGORY_NAMES[Number(l.main_category_id)] ?? 'Other',
      serviceDate: l.service_date ?? l.delivery_date ?? null,
      quantity: num(l.quantity) ?? 1,
      currency: upper(l.currency),
      total: r2(num(l.total_amount)),
      cancelled: CANCELLED.test(String(l.status ?? '').trim()),
    }
  })

  const services = invoiceLines.map((l) => l.serviceDate?.slice(0, 10)).filter((d): d is string => Boolean(d)).sort()
  if (services.length === 0 && flight) {
    const d = flight.firstDepartureDate ?? flight.routeDates[0]
    if (d) services.push(d)
  }

  const channelKey = String(header.channel ?? '').trim().toLowerCase()
  const channel = B2C_CHANNELS[channelKey] ? channelKey
    : /b2b\s*wallet/i.test(String(header.pay_category ?? '')) ? 'b2b_portal' : 'unrecorded'

  const customer = customers[0]
  const oneUsd = rate && !sameCurrency ? 1 / rate : null

  return {
    orderId,
    bookedAt: header.checkout_date ?? null,
    channel,
    channelLabel: B2C_CHANNELS[channel],
    payCategory: header.pay_category?.trim() || null,
    paymentType: header.payment_type?.trim() || null,
    paymentStatus: header.payment_status?.trim() || null,
    checkoutStatus: header.checkout_status?.trim() || null,
    orderCurrency,
    baseCurrency,
    rate: sameCurrency ? 1 : rate,
    rateLabel: oneUsd
      ? `1 ${baseCurrency} = ${oneUsd.toLocaleString('en-US', { maximumFractionDigits: oneUsd >= 10 ? 2 : 4 })} ${orderCurrency}`
      : null,
    orderValue: amount(orderValue),
    productTotal: amount(r2(productTotal)),
    discount: amount(num(header.discount_amount)),
    paid: amount(num(header.paid_amount)),
    balance: amount(balance),
    settled: balance !== null && balance <= 0.01,
    lines: invoiceLines,
    billTo: {
      name: customer?.customer_name?.trim() || null,
      email: customer?.customer_email?.trim() || null,
      phone: customer?.customer_phone?.trim() || null,
    },
    ticketContact: flight && (flight.contactEmail || flight.contactPhone)
      ? { email: flight.contactEmail, phone: flight.contactPhone }
      : null,
    pnrs: Array.from(new Set(flights.map((f) => f.pnr).filter((p): p is string => Boolean(p)))),
    firstService: services[0] ?? null,
    lastService: services[services.length - 1] ?? null,
    aahaasFlowUrl: aahaasFlowOrderUrl(orderId),
  }
}
