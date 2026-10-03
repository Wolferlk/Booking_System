/**
 * Driver-Auto (Allocating) — types and constants shared by the staff board,
 * the public driver board and the server. No server imports: safe in the client.
 *
 * The component lets drivers and vehicle vendors pick up trips that nobody has
 * been allocated to yet, inside a D-N window (default D-10):
 *
 *   • Sri Lanka   — the whole booking is one trip (a round trip, one driver).
 *   • VN / SG / MY — every movement is its own trip.
 *
 * Each registered driver/vendor gets a personal tokenised link (no login). A
 * request either waits for staff approval or — when a country's approval
 * switch is off — assigns the trip straight away, first come first served.
 */

export const DA_COUNTRIES = ['SRILANKA', 'VIETNAM', 'SINGAPORE', 'MALAYSIA'] as const
export type DaCountry = (typeof DA_COUNTRIES)[number]

export const DA_COUNTRY_META: Record<DaCountry, {
  label: string
  short: string
  tz: string
  /** What one trip is in this country. */
  unit: 'BOOKING' | 'MOVEMENT'
  accent: string
}> = {
  SRILANKA:  { label: 'Sri Lanka', short: 'LK', tz: 'Asia/Colombo',     unit: 'BOOKING',  accent: 'amber'   },
  VIETNAM:   { label: 'Vietnam',   short: 'VN', tz: 'Asia/Ho_Chi_Minh', unit: 'MOVEMENT', accent: 'rose'    },
  SINGAPORE: { label: 'Singapore', short: 'SG', tz: 'Asia/Singapore',   unit: 'MOVEMENT', accent: 'sky'     },
  MALAYSIA:  { label: 'Malaysia',  short: 'MY', tz: 'Asia/Kuala_Lumpur', unit: 'MOVEMENT', accent: 'emerald' },
}

export function isDaCountry(v: unknown): v is DaCountry {
  return typeof v === 'string' && (DA_COUNTRIES as readonly string[]).includes(v)
}

export type PartyType = 'DRIVER' | 'VENDOR'

export type ClaimStatus =
  | 'PENDING'
  | 'APPROVED'
  | 'AUTO_ASSIGNED'
  | 'REJECTED'
  | 'WITHDRAWN'
  | 'SUPERSEDED'
  | 'STALE'
  | 'RELEASED'

export const CLAIM_STATUS_META: Record<ClaimStatus, { label: string; tone: string; driverLabel: string }> = {
  PENDING:       { label: 'Awaiting approval', tone: 'amber',   driverLabel: 'Waiting for approval' },
  APPROVED:      { label: 'Approved',          tone: 'emerald', driverLabel: 'Confirmed — this trip is yours' },
  AUTO_ASSIGNED: { label: 'Auto-assigned',     tone: 'emerald', driverLabel: 'Confirmed — this trip is yours' },
  REJECTED:      { label: 'Declined',          tone: 'rose',    driverLabel: 'Not approved' },
  WITHDRAWN:     { label: 'Withdrawn',         tone: 'slate',   driverLabel: 'You withdrew this request' },
  SUPERSEDED:    { label: 'Given to another',  tone: 'slate',   driverLabel: 'Allocated to another driver' },
  STALE:         { label: 'Trip changed',      tone: 'slate',   driverLabel: 'The trip changed — please check again' },
  RELEASED:      { label: 'Released',          tone: 'slate',   driverLabel: 'Released by operations' },
}

export const WON_STATUSES: ClaimStatus[] = ['APPROVED', 'AUTO_ASSIGNED']

/** Per-country switches. Defaults are the safe ones: approve first, send nothing. */
export interface DaCountrySettings {
  /** true → every request waits for staff. false → first request is assigned directly. */
  requireApproval: boolean
  /** Send the daily "open trips" link automatically at `sendHour` local time. */
  autoSend: boolean
  /** Vehicle vendors receive the link and can take trips too. */
  includeVendors: boolean
  /** Also email the link to partners who have an email address. */
  emailEnabled: boolean
}

export interface DaSettings {
  horizonDays: number
  /** Local hour (0-23) in each country's own timezone. */
  sendHour: number
  /** Cap on open requests one driver may hold at once. */
  maxPendingPerParty: number
  countries: Record<DaCountry, DaCountrySettings>
  /** Party keys ('d-<id>' / 'v-<id>') that never receive the daily link. */
  excluded: string[]
  /** Bumped to revoke a party's link. Missing = 0. */
  linkEpochs: Record<string, number>
}

export const DEFAULT_COUNTRY_SETTINGS: DaCountrySettings = {
  requireApproval: true,
  autoSend: false,
  includeVendors: true,
  emailEnabled: true,
}

export const DEFAULT_SETTINGS: DaSettings = {
  horizonDays: 10,
  sendHour: 7,
  maxPendingPerParty: 15,
  countries: {
    SRILANKA:  { ...DEFAULT_COUNTRY_SETTINGS },
    VIETNAM:   { ...DEFAULT_COUNTRY_SETTINGS },
    SINGAPORE: { ...DEFAULT_COUNTRY_SETTINGS },
    MALAYSIA:  { ...DEFAULT_COUNTRY_SETTINGS },
  },
  excluded: [],
  linkEpochs: {},
}

export const HORIZON_CHOICES = [3, 5, 7, 10, 14, 21, 30]

/** One movement as the driver board shows it. Never carries a rate. */
export interface TripLeg {
  agendaItemId: string
  date: string          // YYYY-MM-DD
  time: string | null
  location: string
  from: string | null
  to: string | null
  serviceType: string
  /** False for leisure / hotel-only days inside a round trip. */
  driven: boolean
}

/** An open (unallocated) trip, as both boards render it. */
export interface OpenTrip {
  key: string                 // 'B:<bookingId>' | 'M:<agendaItemId>'
  kind: 'BOOKING' | 'MOVEMENT'
  country: DaCountry
  bookingId: string
  bookingRef: string
  /** IS number (file number) — what the desk and drivers call the file. */
  isNumber: string | null
  /** The file number to show: IS number → CNTL number → booking ref. */
  fileNo: string
  agendaItemId: string | null
  startDate: string           // YYYY-MM-DD
  endDate: string             // YYYY-MM-DD
  days: number
  /** Days from today (local) to the start. 0 = today. */
  daysAway: number
  startTime: string | null
  title: string
  route: string
  cities: string[]
  paxAdults: number
  paxChildren: number
  pax: number
  vehicleType: string | null
  legs: TripLeg[]
  drivenLegs: number
  /** True when the trip has no movement chart yet (SL booking without agenda). */
  noAgenda: boolean
  // Staff-only fields (stripped for the driver board)
  agent?: string | null
  leadGuest?: string | null
  status?: string
  requestCount?: number
}

export interface ClaimView {
  id: string
  kind: 'BOOKING' | 'MOVEMENT'
  tripKey: string
  bookingRef: string
  bookingId: string
  agendaItemId: string | null
  country: string
  tripDate: string
  tripEndDate: string | null
  partyType: PartyType
  partyId: string
  partyKey: string
  partyName: string | null
  partyPhone: string | null
  status: ClaimStatus
  driverNote: string | null
  decisionNote: string | null
  decidedByName: string | null
  decidedAt: string | null
  assignedAt: string | null
  createdAt: string
  notifyResult: string | null
  snapshot: Partial<OpenTrip> | null
  /** Staff-only: other trips this party already drives on overlapping dates. */
  clashes?: string[]
  /** Staff-only: vehicle seats vs pax. null = unknown. */
  fits?: boolean | null
  /** Staff-only: trips this party already holds in the next 30 days. */
  load?: number
  /** Staff-only: false once the trip has been allocated elsewhere. */
  stillOpen?: boolean
}

export interface PartyView {
  key: string               // 'd-<id>' | 'v-<id>'
  type: PartyType
  id: string
  name: string
  phone: string | null
  email: string | null
  country: string | null
  vehicle: string | null
  capacity: number | null
  excluded: boolean
  lastSentAt: string | null
  lastSendStatus: string | null
  /** Staff-only full link, so it can be copied and shared by hand. */
  link?: string
}

/** Same convention as the SL Driver Allocation board: IS → CNTL → ref. */
export function fileNumberOf(b: { isNumber?: string | null; cntlNumber?: string | null; bookingRef: string }): string {
  return b.isNumber?.trim() || b.cntlNumber?.trim() || b.bookingRef
}

/** File number of a claim, from the trip snapshot it was made against. */
export function claimFileNo(c: { bookingRef: string; snapshot: Partial<OpenTrip> | null }): string {
  return c.snapshot?.fileNo?.trim() || c.bookingRef
}

export function partyKey(type: PartyType, id: string): string {
  return `${type === 'DRIVER' ? 'd' : 'v'}-${id}`
}

export function parsePartyKey(key: string): { type: PartyType; id: string } | null {
  const m = /^([dv])-([A-Za-z0-9_-]{6,64})$/.exec(key ?? '')
  if (!m) return null
  return { type: m[1] === 'd' ? 'DRIVER' : 'VENDOR', id: m[2] }
}

/** "Tue 14 Oct" from a YYYY-MM-DD string, read as a calendar date. */
export function fmtTripDay(ymd: string, opts: { year?: boolean } = {}): string {
  const d = new Date(`${ymd}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return ymd
  return d.toLocaleDateString('en-GB', {
    weekday: 'short', day: '2-digit', month: 'short',
    ...(opts.year ? { year: 'numeric' } : {}),
    timeZone: 'UTC',
  })
}

export function fmtDaysAway(n: number): string {
  if (n <= 0) return 'Today'
  if (n === 1) return 'Tomorrow'
  return `In ${n} days`
}
