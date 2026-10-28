/**
 * Read the Aahaas e-ticket PDF ("Aahaas-ETicket-<REF>.pdf") back into ticket
 * data. It is the issued document — passenger names beside their own e-ticket
 * numbers, the airline PNR, the real flight times — so it is the most exact
 * source a printed ticket can have.
 *
 * The PDF's text layer comes out in reading order but not always one label per
 * line: side-by-side cells (CMB … IXM, 08:15 … 09:15) can merge or swap. So
 * fixed rows are read by label, and each flight block by *what its tokens look
 * like* (an IATA code, an HH:MM, a "Tue, 10 Nov 2026"), in order. Anything not
 * found stays null and is reported, never guessed.
 */
import { cityForAirport } from './airports'
import type { FlightTicketData, TicketPassenger, TicketPoint, TicketSegment } from './types'

const MONTHS: Record<string, string> = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
}

/** "Tue, 10 Nov 2026" / "10 Nov 2026" → "2026-11-10". */
export function isoFromLongDate(text: string): string | null {
  const m = /(\d{1,2})\s+([A-Za-z]{3})[a-z]*\s+(\d{4})/.exec(text)
  if (!m) return null
  const mm = MONTHS[m[2].toLowerCase()]
  return mm ? `${m[3]}-${mm}-${m[1].padStart(2, '0')}` : null
}

const DATE_RE = /(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*,?\s+\d{1,2}\s+[A-Za-z]{3}[a-z]*\s+\d{4}/g
const TIME_RE = /\b([01]\d|2[0-3]):[0-5]\d\b/g
const IS_TIME = /^([01]\d|2[0-3]):[0-5]\d$/
const CABINS = 'Premium Economy|Economy|Business|First'
// "Srilankan Airlines  UL 137  Economy  Confirmed"
const SEGMENT_HEAD_RE = new RegExp(`^(.+?)\\s+([A-Z0-9]{2})\\s?(\\d{1,4}[A-Z]?)\\s+(${CABINS})\\b\\s*([A-Za-z]+)?\\s*$`)

function after(lines: string[], label: RegExp): string | null {
  const i = lines.findIndex((l) => label.test(l))
  if (i < 0) return null
  // The value is either on the label's own line ("Refundable Yes") or the next one.
  const rest = lines[i].replace(label, '').trim()
  if (rest) return rest
  return lines[i + 1]?.trim() || null
}

function point(code: string, airportName: string | null, time: string | null, date: string | null): TicketPoint {
  return { code, airport: airportName, city: cityForAirport(code), time, date }
}

function parseSegment(head: RegExpExecArray, body: string[]): TicketSegment {
  const text = body.join('\n')
  // Standalone 3-letter codes, in order, excluding airline/cabin words.
  // A side-by-side pair can come out on one line ("CMB IXM").
  const codes = body.filter((l) => /^[A-Z]{3}(\s+[A-Z]{3})*$/.test(l)).flatMap((l) => l.split(' '))
  const from = codes[0] ?? null
  const to = codes.find((c) => c !== from) ?? null

  const times = text.match(TIME_RE) ?? []
  const dates = (text.match(DATE_RE) ?? []).map(isoFromLongDate)

  // The airport's name is the line right after its code, when it is prose.
  const nameAfter = (code: string | null) => {
    if (!code) return null
    const i = body.indexOf(code)
    const next = i >= 0 ? body[i + 1] : undefined
    return next && !/^[A-Z]{3}$/.test(next) && !IS_TIME.test(next) && /[a-z]/.test(next) ? next : null
  }

  const label = (re: RegExp) => after(body, re)

  return {
    airline: head[1].trim(),
    flightNo: `${head[2]} ${head[3]}`,
    cabin: head[4],
    status: head[5] ?? null,
    from: point(from ?? '', nameAfter(from), times[0] ?? null, dates[0] ?? null),
    to: point(to ?? '', nameAfter(to), times[1] ?? null, dates[1] ?? dates[0] ?? null),
    duration: /^\d+h(?:\s*\d+m)?$/m.exec(text)?.[0] ?? null,
    checkedBaggage: label(/^CHECKED BAGGAGE\b/i),
    cabinBaggage: label(/^CABIN BAGGAGE\b/i),
    meal: label(/^MEAL\b/i),
  }
}

export function parseAahaasEticketText(raw: string): FlightTicketData {
  const lines = raw.split(/\r?\n/).map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean)
  const all = lines.join('\n')
  const warnings: string[] = []

  const orderId = /Order\s*#\s*(\d+)/i.exec(all)?.[1] ?? null
  const issuedOn = (() => { const m = /Issued\s+([^·\n]+)/i.exec(all); return m ? isoFromLongDate(m[1]) : null })()

  const bookingRef = after(lines, /^BOOKING REFERENCE\b/i)?.split(' ')[0] ?? null
  const pnrLine = after(lines, /^AIRLINE PNR\b/i)
  const airlinePnr = pnrLine?.split(' ')[0] ?? null
  const status = (pnrLine?.split(' ').slice(1).join(' ') || /\b(TICKETED|ON HOLD|CANCELLED)\b/.exec(all)?.[1]) ?? null

  // "1 Dhivya Sathananthan Adult 6039015987907"
  const passengers: TicketPassenger[] = []
  for (const l of lines) {
    const m = /^(\d{1,2})\s+(.+?)\s+(Adult|Child|Infant)\s+(\d{13})?\s*$/i.exec(l)
    if (m) passengers.push({ name: m[2].trim(), type: m[3], eticket: m[4] ?? null })
  }
  if (passengers.length === 0) warnings.push('No passengers were found on the e-ticket — add them before printing.')
  if (passengers.some((p) => !p.eticket)) warnings.push('Some passengers have no e-ticket number on the PDF.')

  // Flight blocks run from one airline header to the next, inside the itinerary.
  const start = lines.findIndex((l) => /^FLIGHT ITINERARY$/i.test(l))
  const stop = lines.findIndex((l, i) => i > start && /^FARE CONDITIONS/i.test(l))
  const itinerary = start >= 0 ? lines.slice(start + 1, stop > start ? stop : undefined) : lines
  const segments: TicketSegment[] = []
  let head: RegExpExecArray | null = null
  let body: string[] = []
  for (const l of itinerary) {
    const h = SEGMENT_HEAD_RE.exec(l)
    if (h) {
      if (head) segments.push(parseSegment(head, body))
      head = h
      body = []
    } else if (head) {
      body.push(l)
    }
  }
  if (head) segments.push(parseSegment(head, body))
  if (segments.length === 0) warnings.push('No flight was found on the e-ticket — add the flight before printing.')
  for (const s of segments) {
    if (!s.from.code || !s.to.code) warnings.push(`${s.flightNo ?? 'A flight'}: the airports could not be read.`)
    if (!s.from.time || !s.from.date) warnings.push(`${s.flightNo ?? 'A flight'}: the departure time or date could not be read.`)
  }

  const contactPhone = after(lines, /^Contact on Booking\b/i)
  const contactEmail = after(lines, /^E-?mail\b/i)

  return {
    orderId,
    bookingRef,
    airlinePnr,
    status,
    issuedOn,
    passengers,
    segments,
    contact: {
      phone: contactPhone && /\d{6,}/.test(contactPhone) ? contactPhone : null,
      email: contactEmail && /@/.test(contactEmail) ? contactEmail.toLowerCase() : null,
    },
    refundable: after(lines, /^Refundable\b/i),
    dateChange: after(lines, /^Date Change\b/i),
    source: 'eticket-pdf',
    warnings,
  }
}

/** True when the text looks like an Aahaas e-ticket at all. */
export function looksLikeAahaasEticket(text: string): boolean {
  return /E-TICKET/i.test(text) && /(BOOKING REFERENCE|AIRLINE PNR)/i.test(text)
}
