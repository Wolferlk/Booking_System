/**
 * Where a printed ticket's details come from, put together.
 *
 *   1. The issued e-ticket, fetched from the Aahaas booking API — the same PDF
 *      the guest was emailed (`flights/sendTicketEmail`, mode=download; it
 *      returns the file and sends nothing). Read with the PDF parser, so the
 *      desk no longer has to download and re-upload it.
 *   2. The store's flight booking (`store-ticket.ts`) — the GDS record. Fills
 *      whatever the PDF lacks, and is the second opinion it is checked against.
 *
 * Both are read-only. Each can fail on its own; the dialog still works from
 * whichever answered, an uploaded PDF, or typing.
 */
import { extractTextFromPdf } from '@/lib/parsers/pdf-parser'
import { looksLikeAahaasEticket, parseAahaasEticketText } from './eticket-parse'
import { ticketDataFromStore } from './store-ticket'
import type { FlightTicketData, TicketSegment } from './types'

const GATEWAY = (process.env.AAHAAS_GATEWAY_URL || 'https://gateway.aahaas.com').replace(/\/+$/, '')

/** The issued e-ticket for an order, parsed. Null when none is issued (yet). Throws on a network failure. */
export async function ticketDataFromIssuedEticket(orderId: number): Promise<FlightTicketData | null> {
  const res = await fetch(`${GATEWAY}/api/flights/sendTicketEmail`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/pdf' },
    body: JSON.stringify({ order_id: orderId, mode: 'download' }),
    signal: AbortSignal.timeout(25_000),
    cache: 'no-store',
  })
  if (!res.ok || !(res.headers.get('content-type') ?? '').includes('pdf')) return null
  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.subarray(0, 5).toString('latin1') !== '%PDF-') return null
  const text = await extractTextFromPdf(buf)
  if (!looksLikeAahaasEticket(text)) return null
  const data = parseAahaasEticketText(text)
  // Another order's ticket must never be printed for this one.
  if (data.orderId && data.orderId !== String(orderId)) return null
  return { ...data, source: 'aahaas-eticket' }
}

const norm = (n: string) => n.toLowerCase().replace(/[^a-z]/g, '')
const nameKey = (n: string) => n.toLowerCase().split(/[^a-z]+/).filter(Boolean).sort().join(' ')
const sameLeg = (a: TicketSegment, b: TicketSegment) => a.from.code === b.from.code && a.to.code === b.to.code

/**
 * The e-ticket, with gaps filled from the store booking — never the other way
 * round. A passenger's ticket number is only taken from the store when the
 * store paired it with that same name. Pure.
 */
export function mergeTicketData(primary: FlightTicketData, extra: FlightTicketData | null): FlightTicketData {
  if (!extra) return primary
  const storePax = new Map(extra.passengers.map((p) => [nameKey(p.name), p]))
  const passengers = primary.passengers.length
    ? primary.passengers.map((p) => {
      const s = storePax.get(nameKey(p.name))
      return { ...p, type: p.type ?? s?.type ?? null, eticket: p.eticket ?? s?.eticket ?? null }
    })
    : extra.passengers
  const segments = primary.segments.length
    ? primary.segments.map((g) => {
      const s = extra.segments.find((x) => sameLeg(g, x) && (!g.from.date || !x.from.date || g.from.date === x.from.date))
      if (!s) return g
      const pt = (a: TicketSegment['from'], b: TicketSegment['from']) => ({
        code: a.code, airport: a.airport ?? b.airport, city: a.city ?? b.city, time: a.time ?? b.time, date: a.date ?? b.date,
      })
      return {
        airline: g.airline ?? s.airline, flightNo: g.flightNo ?? s.flightNo, cabin: g.cabin ?? s.cabin, status: g.status ?? s.status,
        from: pt(g.from, s.from), to: pt(g.to, s.to), duration: g.duration ?? s.duration,
        checkedBaggage: g.checkedBaggage ?? s.checkedBaggage, cabinBaggage: g.cabinBaggage ?? s.cabinBaggage, meal: g.meal ?? s.meal,
      }
    })
    : extra.segments
  return {
    ...primary,
    bookingRef: primary.bookingRef ?? extra.bookingRef,
    airlinePnr: primary.airlinePnr ?? extra.airlinePnr,
    status: primary.status ?? extra.status,
    passengers,
    segments,
    contact: { phone: primary.contact.phone ?? extra.contact.phone, email: primary.contact.email ?? extra.contact.email },
    refundable: primary.refundable ?? extra.refundable,
    dateChange: primary.dateChange ?? extra.dateChange,
    warnings: [...crossCheck(primary, extra), ...primary.warnings],
  }
}

/**
 * Where the e-ticket and the store booking disagree — a reissue, a renamed
 * passenger, a moved flight. Said out loud; neither side is silently preferred.
 */
export function crossCheck(pdf: FlightTicketData, store: FlightTicketData | null): string[] {
  if (!store) return []
  const w: string[] = []
  if (store.bookingRef && pdf.bookingRef && store.bookingRef !== pdf.bookingRef) {
    w.push(`Booking reference ${pdf.bookingRef} on the e-ticket differs from ${store.bookingRef} in the Aahaas store — the flight may have been reissued. Check which is current.`)
  }
  const storeNames = new Set(store.passengers.map((p) => nameKey(p.name)))
  const unknown = storeNames.size ? pdf.passengers.filter((p) => !storeNames.has(nameKey(p.name))).map((p) => p.name) : []
  if (unknown.length) w.push(`Not on the store booking: ${unknown.join(', ')}. Check the passenger names.`)
  if (storeNames.size && storeNames.size !== pdf.passengers.length) {
    w.push(`The store booking has ${storeNames.size} passenger(s), the e-ticket ${pdf.passengers.length}.`)
  }
  for (const p of pdf.passengers) {
    const s = store.passengers.find((x) => nameKey(x.name) === nameKey(p.name) || norm(x.name) === norm(p.name))
    if (p.eticket && s?.eticket && p.eticket !== s.eticket) w.push(`${p.name}: e-ticket ${p.eticket} on the PDF, ${s.eticket} in the store — check which is current.`)
  }
  for (const g of pdf.segments) {
    const s = store.segments.find((x) => sameLeg(g, x))
    if (!s) continue
    if (g.from.date && s.from.date && g.from.date !== s.from.date) w.push(`${g.flightNo ?? `${g.from.code}–${g.to.code}`}: ${g.from.date} on the e-ticket, ${s.from.date} in the store — the flight may have moved.`)
    else if (g.from.time && s.from.time && g.from.time !== s.from.time) w.push(`${g.flightNo ?? `${g.from.code}–${g.to.code}`}: departs ${g.from.time} on the e-ticket, ${s.from.time} in the store — check for a schedule change.`)
  }
  return w
}

/**
 * Everything known about an order's tickets, best source first. Each source's
 * failure is reported in `notes`, not thrown.
 */
export async function loadTicketData(orderId: number): Promise<{ data: FlightTicketData | null; notes: string[] }> {
  const notes: string[] = []
  const [issued, store] = await Promise.all([
    ticketDataFromIssuedEticket(orderId).catch((e) => { notes.push(`The issued e-ticket could not be fetched from Aahaas (${(e as Error).message}).`); return null }),
    ticketDataFromStore(orderId).catch((e) => { notes.push(`The store booking could not be read (${(e as Error).message}).`); return null }),
  ])
  if (issued) return { data: mergeTicketData(issued, store), notes }
  if (store) {
    notes.push('No issued e-ticket was found at Aahaas — details are from the store booking. Upload the e-ticket PDF if you have it.')
    return { data: store, notes }
  }
  return { data: null, notes }
}
