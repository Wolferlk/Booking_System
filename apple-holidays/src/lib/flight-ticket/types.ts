/**
 * One printable flight ticket set — everything the A4 duplex sheet prints.
 *
 * Built from the Aahaas e-ticket PDF (the issued document, most exact), from
 * the store's flight booking (when no PDF is at hand), and finally from what
 * the desk typed in the print dialog. Every field is optional except what the
 * sheet cannot be drawn without; a missing value prints as "—", never a guess.
 */

export interface TicketPassenger {
  name: string
  /** Adult / Child / Infant, as the e-ticket says. */
  type: string | null
  /** 13-digit e-ticket number, only when it is known to be THIS passenger's. */
  eticket: string | null
}

export interface TicketPoint {
  code: string
  /** Airport name as printed on the e-ticket, e.g. "Colombo - Bandaranaike International Airport". */
  airport: string | null
  /** City for the big FROM / TO lettering, resolved from the IATA code. */
  city: string | null
  /** 'HH:MM' local time. */
  time: string | null
  /** 'YYYY-MM-DD'. */
  date: string | null
}

export interface TicketSegment {
  airline: string | null
  /** e.g. "UL 137". */
  flightNo: string | null
  cabin: string | null
  status: string | null
  from: TicketPoint
  to: TicketPoint
  /** e.g. "1h", "2h 35m". */
  duration: string | null
  checkedBaggage: string | null
  cabinBaggage: string | null
  meal: string | null
}

export interface FlightTicketData {
  orderId: string | null
  /** Aahaas booking reference (the GDS record), e.g. MRTKUG. */
  bookingRef: string | null
  /** The airline's own locator, e.g. DAR8EW — what web check-in asks for. */
  airlinePnr: string | null
  status: string | null
  issuedOn: string | null
  passengers: TicketPassenger[]
  segments: TicketSegment[]
  contact: { phone: string | null; email: string | null }
  refundable: string | null
  dateChange: string | null
  source: 'eticket-pdf' | 'store' | 'manual'
  /** Things the desk should check before printing. */
  warnings: string[]
}

export type DuplexFlip = 'long' | 'short'

export interface TicketPrintOptions {
  /** How the printer turns the sheet: long edge (default on most printers) or short edge. */
  flip: DuplexFlip
  /** Nudge the back side, in mm, to correct a printer's duplex drift. */
  backOffsetX: number
  backOffsetY: number
  /** Crop marks for the guillotine. */
  cropMarks: boolean
  /** One ticket per passenger per flight (default), or one per passenger for the whole trip. */
  perSegment: boolean
}

export const DEFAULT_PRINT_OPTIONS: TicketPrintOptions = {
  flip: 'long',
  backOffsetX: 0,
  backOffsetY: 0,
  cropMarks: true,
  perSegment: true,
}
