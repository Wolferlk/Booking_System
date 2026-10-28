/**
 * Read the Aahaas e-ticket PDF ("Aahaas-ETicket-<REF>.pdf") back into ticket
 * data. It is the issued document — passenger names beside their own e-ticket
 * numbers, the airline PNR, the real flight times — so it is the most exact
 * source a printed ticket can have.
 *
 * ⚠️ THE PDF'S HEADINGS AND CODES ARE LETTER-SPACED. Its CSS spaces out
 * "BOOKING REFERENCE", the booking reference itself and the airline PNR, so the
 * text layer (pdf-parse) gives them one letter at a time:
 *
 *     "B O O K I N G R E F E R E N C E"   "M R T K U G"
 *     "D A R 8 E W T I C K E T E D"       ← PNR and status, the gap between them lost
 *
 * So every line made of single characters is collapsed first, labels are
 * compared with spaces removed, and a glued PNR is split off the known status
 * words. Plain lines ("1 Dhivya Sathananthan Adult 6039015987907") are left as
 * they are. Anything not found stays null and is reported, never guessed.
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

const DATE_LINE = /^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*,?\s+\d{1,2}\s+[A-Za-z]{3}[a-z]*\s+\d{4}$/
const TIME_LINE = /^([01]\d|2[0-3]):[0-5]\d$/
const CODE_LINE = /^[A-Z]{3}(\s+[A-Z]{3})*$/
const DURATION_LINE = /^(\d+)\s*h(?:\s*(\d+)\s*m)?$|^(\d+)\s*m$/i
const CABINS = 'Premium Economy|Economy|Business|First'
// "Srilankan Airlines UL 137 Economy Confirmed" — the carrier code may be letters+digit ("6E", "8D").
const SEGMENT_HEAD = new RegExp(`^(.+?)\\s+([A-Z0-9]{2})\\s?(\\d{1,4}[A-Z]?)\\s+(${CABINS})\\b\\s*(.*)$`)
// Status words the e-ticket prints beside the airline PNR, longest first.
const STATUSES = ['PARTIALLYTICKETED', 'TICKETED', 'CONFIRMED', 'CANCELLED', 'CANCELED', 'REFUNDED', 'ONHOLD', 'PENDING', 'ISSUED', 'VOIDED', 'VOID', 'HOLD']

interface Line {
  text: string
  /** Spaces and case removed — what labels are matched on. */
  key: string
}

/** A line of single characters ("M R T K U G") is letter-spaced text — put it back together. */
function normalise(raw: string): Line[] {
  return raw
    .split(/\r?\n/)
    .map((l) => l.replace(/[ \t ]+/g, ' ').trim())
    .filter(Boolean)
    .map((l) => {
      const spaced = /^(\S )+\S$/.test(l) && l.length >= 5
      const text = spaced ? l.replace(/ /g, '') : l
      return { text, key: text.replace(/\s+/g, '').toUpperCase() }
    })
}

const indexOf = (lines: Line[], key: string, from = 0) => {
  for (let i = from; i < lines.length; i++) if (lines[i].key === key) return i
  return -1
}

/** The value printed under a heading (the next line). */
function under(lines: Line[], key: string): string | null {
  const i = indexOf(lines, key)
  return i >= 0 ? lines[i + 1]?.text ?? null : null
}

/** "Refundable Yes" — a label and its value on one plain line. */
function inline(lines: Line[], label: RegExp): string | null {
  for (const l of lines) {
    const m = label.exec(l.text)
    if (m) return l.text.slice(m[0].length).trim() || null
  }
  return null
}

/** "DAR8EWTICKETED" → { pnr: "DAR8EW", status: "TICKETED" }. */
export function splitPnrStatus(raw: string | null): { pnr: string | null; status: string | null } {
  const t = (raw ?? '').replace(/\s+/g, '').toUpperCase()
  if (!t) return { pnr: null, status: null }
  for (const st of STATUSES) {
    if (t.endsWith(st) && t.length > st.length) {
      const pnr = t.slice(0, -st.length)
      if (/^[A-Z0-9]{5,8}$/.test(pnr)) return { pnr, status: st === 'ONHOLD' ? 'ON HOLD' : st }
    }
  }
  return /^[A-Z0-9]{5,8}$/.test(t) ? { pnr: t, status: null } : { pnr: null, status: null }
}

function duration(text: string): string | null {
  const m = DURATION_LINE.exec(text)
  if (!m) return null
  if (m[3]) return `${Number(m[3])}m`
  return m[2] ? `${Number(m[1])}h ${Number(m[2])}m` : `${Number(m[1])}h`
}

function point(code: string, airportName: string | null, time: string | null, date: string | null): TicketPoint {
  return { code, airport: airportName, city: cityForAirport(code), time, date }
}

function parseSegment(head: RegExpExecArray, body: Line[]): TicketSegment {
  // A side-by-side pair can come out on one line ("CMB IXM").
  const codes = body.filter((l) => CODE_LINE.test(l.text)).flatMap((l) => l.text.split(' '))
  const from = codes[0] ?? ''
  const to = codes.find((c, i) => i > 0 && c !== from) ?? ''
  const times = body.filter((l) => TIME_LINE.test(l.text)).map((l) => l.text)
  const dates = body.filter((l) => DATE_LINE.test(l.text)).map((l) => isoFromLongDate(l.text))

  // The airport's name is the line right after its code, when it is prose.
  const nameAfter = (code: string) => {
    const i = body.findIndex((l) => l.text === code)
    const next = i >= 0 ? body[i + 1]?.text : undefined
    return next && /[a-z]/.test(next) && !DATE_LINE.test(next) ? next : null
  }

  const status = head[5].trim()
  return {
    airline: head[1].trim(),
    flightNo: `${head[2]} ${head[3]}`,
    cabin: head[4],
    status: status || null,
    from: point(from, nameAfter(from), times[0] ?? null, dates[0] ?? null),
    to: point(to, nameAfter(to), times[1] ?? null, dates[1] ?? dates[0] ?? null),
    duration: body.map((l) => duration(l.text)).find(Boolean) ?? null,
    checkedBaggage: under(body, 'CHECKEDBAGGAGE'),
    cabinBaggage: under(body, 'CABINBAGGAGE'),
    meal: under(body, 'MEAL'),
  }
}

export function parseAahaasEticketText(raw: string): FlightTicketData {
  const lines = normalise(raw)
  const all = lines.map((l) => l.text).join('\n')
  const warnings: string[] = []
  if (!lines.some((l) => l.key === 'FLIGHTITINERARY')) warnings.push('The flight itinerary section was not found in this PDF.')

  const orderId = /Order\s*#\s*(\d+)/i.exec(all)?.[1] ?? null
  const issuedOn = (() => { const m = /Issued\s+([^·\n]+)/i.exec(all); return m ? isoFromLongDate(m[1]) : null })()

  const refRaw = under(lines, 'BOOKINGREFERENCE')?.replace(/\s+/g, '').toUpperCase() ?? null
  const bookingRef = refRaw && /^[A-Z0-9]{5,8}$/.test(refRaw) ? refRaw : null
  const { pnr: airlinePnr, status } = splitPnrStatus(under(lines, 'AIRLINEPNR'))

  // "1 Dhivya Sathananthan Adult 6039015987907" — between the passenger heading and the itinerary.
  const paxStart = lines.findIndex((l) => l.key.startsWith('PASSENGERS&'))
  const itinStart = indexOf(lines, 'FLIGHTITINERARY')
  const passengers: TicketPassenger[] = []
  for (const l of lines.slice(paxStart >= 0 ? paxStart : 0, itinStart >= 0 ? itinStart : undefined)) {
    const m = /^(\d{1,2})\s+(.+?)\s+(Adult|Child|Infant)\s*(\d{13})?\s*$/i.exec(l.text)
    if (m) passengers.push({ name: m[2].trim(), type: m[3][0].toUpperCase() + m[3].slice(1).toLowerCase(), eticket: m[4] ?? null })
  }

  // Flight blocks run from one airline header to the next, inside the itinerary.
  const itinEnd = lines.findIndex((l, i) => i > itinStart && l.key.startsWith('FARECONDITIONS'))
  const itinerary = itinStart >= 0 ? lines.slice(itinStart + 1, itinEnd > itinStart ? itinEnd : undefined) : []
  const segments: TicketSegment[] = []
  let head: RegExpExecArray | null = null
  let body: Line[] = []
  for (const l of itinerary) {
    const h = SEGMENT_HEAD.exec(l.text)
    if (h) {
      if (head) segments.push(parseSegment(head, body))
      head = h
      body = []
    } else if (head) {
      body.push(l)
    }
  }
  if (head) segments.push(parseSegment(head, body))

  const contactPhone = inline(lines, /^Contact on Booking\b/i)
  const contactEmail = inline(lines, /^E-?mail\b/i)

  const data: FlightTicketData = {
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
    refundable: inline(lines, /^Refundable\b/i),
    dateChange: inline(lines, /^Date Change\b/i),
    source: 'eticket-pdf',
    // Completeness is checked live in the print dialog (checkTicketData), so
    // it follows the desk's edits; these are notes about the source alone.
    warnings,
  }
  return data
}

/**
 * Everything a printed ticket must carry, checked — so a gap is said out loud
 * before printing instead of showing up as "—" on a guest's ticket.
 */
export function checkTicketData(d: FlightTicketData): string[] {
  const w: string[] = []
  if (!d.bookingRef) w.push('Booking reference not found.')
  if (!d.airlinePnr) w.push('Airline PNR not found — guests need it for web check-in.')
  if (d.passengers.length === 0) w.push('No passengers found.')
  for (const p of d.passengers) if (!p.eticket) w.push(`${p.name}: no e-ticket number.`)
  const tickets = d.passengers.map((p) => p.eticket).filter(Boolean)
  if (new Set(tickets).size !== tickets.length) w.push('Two passengers have the same e-ticket number.')
  if (d.segments.length === 0) w.push('No flight found.')
  d.segments.forEach((s, i) => {
    const n = s.flightNo ?? `Flight ${i + 1}`
    if (!/^[A-Z]{3}$/.test(s.from.code) || !/^[A-Z]{3}$/.test(s.to.code)) w.push(`${n}: airports not read.`)
    if (!s.from.date || !s.from.time) w.push(`${n}: departure date or time not read.`)
    if (!s.to.time) w.push(`${n}: arrival time not read.`)
    if (!s.flightNo) w.push(`Flight ${i + 1}: flight number not read.`)
    if (s.from.date && s.to.date && s.to.date < s.from.date) w.push(`${n}: arrives before it departs — check the dates.`)
  })
  return w
}

/** True when the text looks like an Aahaas e-ticket at all. */
export function looksLikeAahaasEticket(text: string): boolean {
  const keys = normalise(text).map((l) => l.key)
  return keys.some((k) => k.startsWith('E-TICKET')) && keys.some((k) => k === 'BOOKINGREFERENCE' || k === 'AIRLINEPNR')
}
