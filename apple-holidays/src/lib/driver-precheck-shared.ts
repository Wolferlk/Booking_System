/**
 * Driver Pre-checking — shared shapes and pure logic.
 *
 * Client-safe by design: `driver-precheck.ts` imports Prisma and the WhatsApp
 * layer, and a single *value* import from it would drag both into the browser
 * bundle. Everything the UI needs to render a movement lives here.
 */

/**
 * Whether the driver for one movement has had their daily WhatsApp briefing.
 *
 * The cron (`/api/cron/driver-notify`) messages every assigned driver on the
 * morning of each movement, and again three hours before pick-up. These are
 * the states that fall out of that, ordered by how much they need a human.
 */
export type BriefingState =
  /** Past movement, driver was needed, briefing never went out. */
  | 'MISSED'
  /** Movement is today and the briefing has not gone out yet. */
  | 'PENDING'
  /** Sent — `sentAt` carries when. */
  | 'SENT'
  /** Future movement; the cron will send it on the day. */
  | 'SCHEDULED'
  /** No driver assigned to this movement yet. */
  | 'NO_DRIVER'
  /** Driver assigned but we hold no phone number, so nothing can be sent. */
  | 'NO_PHONE'
  /** Leisure or hotel-only day — no driver required, nothing to send. */
  | 'NOT_REQUIRED'

export const BRIEFING_META: Record<BriefingState, { label: string; blurb: string }> = {
  MISSED:       { label: 'Not sent',     blurb: 'The day has passed and no briefing went out' },
  PENDING:      { label: 'Due today',    blurb: 'Sends this morning, or three hours before pick-up' },
  SENT:         { label: 'Sent',         blurb: 'The driver has the briefing' },
  SCHEDULED:    { label: 'Scheduled',    blurb: 'Goes out automatically on the day' },
  NO_DRIVER:    { label: 'No driver',    blurb: 'Assign a driver before the briefing can send' },
  NO_PHONE:     { label: 'No number',    blurb: 'The driver has no WhatsApp number on file' },
  NOT_REQUIRED: { label: 'Not required', blurb: 'Leisure or hotel-only day — no driver needed' },
}

/** States that need somebody to act. */
export const BRIEFING_ACTIONABLE: BriefingState[] = ['MISSED', 'NO_DRIVER', 'NO_PHONE']

export interface DriverPrecheckDriver {
  assignmentId: string | null
  /** Set when the movement is linked to a registered driver in the master list. */
  driverId: string | null
  name: string | null
  phone: string | null
  vehicleType: string | null
  vehiclePlate: string | null
  rate: number | null
  rateCurrency: string | null
  vendorName: string | null
  notes: string | null
  /** True when `driverId` points at a driver that no longer exists or is inactive. */
  registeredInactive: boolean
  /** The master record's phone, when it differs from the one on this movement. */
  masterPhone: string | null
}

export interface DriverPrecheckMessage {
  id: string
  body: string
  sentAt: string
  status: string
  phone: string
}

export interface DriverPrecheckDay {
  agendaItemId: string
  dayNo: number
  date: string
  location: string
  fromPoint: string | null
  toPoint: string | null
  details: string | null
  meetingTime: string | null
  serviceType: string
  /** No driver needed on this day (leisure or hotel-only). */
  driverNotRequired: boolean

  driver: DriverPrecheckDriver
  briefing: BriefingState
  /** When the daily briefing was sent (`assignment.waSentAt`). */
  sentAt: string | null
  /** The message that actually went out, when one was found in the log. */
  sentMessage: DriverPrecheckMessage | null
  /**
   * What the briefing will say, rendered from today's data. Always present, so
   * "View" works on a day that has not been sent yet.
   */
  previewMessage: string
  /** Days until this movement — negative once it is in the past. */
  daysAway: number
}

export interface DriverPrecheckStats {
  days: number
  /** Days that actually need a driver. */
  driverDays: number
  assigned: number
  unassigned: number
  sent: number
  missed: number
  pending: number
  noPhone: number
  /** Distinct drivers across the tour. */
  driverCount: number
  /** 0–100 across the days that need a driver. */
  allocation: number
}

export interface DriverPrecheckView {
  bookingRef: string
  isNumber: string | null
  leadGuest: string | null
  operationCountry: string | null
  arrivalDate: string
  departureDate: string
  /** False when the booking has no tour agenda yet — nothing to assign against. */
  hasAgenda: boolean
  /** Global switch state for the daily driver briefing cron. */
  autoBriefingEnabled: boolean
  days: DriverPrecheckDay[]
  stats: DriverPrecheckStats
  /**
   * Driver WhatsApp traffic for this booking that is not tied to a movement —
   * assignment notices, cancellations, advance sheets.
   */
  otherMessages: DriverPrecheckMessage[]
  generatedAt: string
}

/** Registered driver, as offered by the picker. */
export interface DriverOption {
  id: string
  name: string
  phone: string
  isActive: boolean
  country: string | null
  vehicleType: string | null
  vehiclePlate: string | null
  vendorName: string | null
  /** Bookings this driver is already committed to over the same dates. */
  clashes: Array<{ bookingRef: string; date: string; location: string }>
}

/** Roll the per-day states up into the panel's headline counts. */
export function summarizeDriverDays(days: DriverPrecheckDay[]): DriverPrecheckStats {
  const s: DriverPrecheckStats = {
    days: days.length, driverDays: 0, assigned: 0, unassigned: 0,
    sent: 0, missed: 0, pending: 0, noPhone: 0, driverCount: 0, allocation: 0,
  }
  const names: Record<string, true> = Object.create(null) as Record<string, true>

  for (const d of days) {
    if (d.driver.name) {
      const key = (d.driver.driverId ?? d.driver.phone ?? d.driver.name).toLowerCase()
      names[key] = true
    }
    if (d.driverNotRequired) continue

    s.driverDays++
    if (d.driver.name) s.assigned++; else s.unassigned++
    if (d.briefing === 'SENT') s.sent++
    else if (d.briefing === 'MISSED') s.missed++
    else if (d.briefing === 'PENDING') s.pending++
    else if (d.briefing === 'NO_PHONE') s.noPhone++
  }

  s.driverCount = Object.keys(names).length
  s.allocation = s.driverDays === 0 ? 100 : Math.round((s.assigned / s.driverDays) * 100)
  return s
}
