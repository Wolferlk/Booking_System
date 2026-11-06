/**
 * WhatsApp booking groups — what the browser and the server both need to know.
 * No server imports here: the inbox page bundles this file.
 */

export const GROUP_KINDS = ['daily', 'day7', 'day3', 'flights', 'hotels', 'itinerary', 'driver'] as const
export type GroupKind = (typeof GROUP_KINDS)[number]

export function isGroupKind(v: unknown): v is GroupKind {
  return typeof v === 'string' && (GROUP_KINDS as readonly string[]).includes(v)
}

export const KIND_META: Record<GroupKind, { label: string; short: string; blurb: string }> = {
  daily:     { label: 'Daily plan',      short: 'Daily',   blurb: "The day's movements, pick-ups, hotel and tickets" },
  day7:      { label: 'Day-7 document',  short: 'Day-7',   blurb: 'Tour Confirmation PDF, a week before arrival' },
  day3:      { label: 'Day-3 document',  short: 'Day-3',   blurb: 'Full Tour Details & Vouchers PDF, three days before' },
  flights:   { label: 'Flight details',  short: 'Flights', blurb: 'Every flight on the booking, in order' },
  hotels:    { label: 'Accommodation',   short: 'Hotels',  blurb: 'Hotels, dates, room and meal plan' },
  itinerary: { label: 'Itinerary',       short: 'Plan',    blurb: 'Day-by-day outline of the whole trip' },
  driver:    { label: 'Driver details',  short: 'Driver',  blurb: 'Who is driving, their number and the vehicle' },
}

/** How each group is tinted. Full class names, so Tailwind keeps them. */
export const GROUP_COLORS = {
  emerald: { hero: 'from-emerald-500 via-green-600 to-teal-700',   dot: 'bg-emerald-500', soft: 'bg-emerald-50 text-emerald-700' },
  sky:     { hero: 'from-sky-500 via-blue-600 to-indigo-700',      dot: 'bg-sky-500',     soft: 'bg-sky-50 text-sky-700' },
  violet:  { hero: 'from-violet-500 via-purple-600 to-fuchsia-700', dot: 'bg-violet-500', soft: 'bg-violet-50 text-violet-700' },
  amber:   { hero: 'from-amber-500 via-orange-500 to-rose-600',    dot: 'bg-amber-500',   soft: 'bg-amber-50 text-amber-700' },
  rose:    { hero: 'from-rose-500 via-pink-600 to-fuchsia-700',    dot: 'bg-rose-500',    soft: 'bg-rose-50 text-rose-700' },
  slate:   { hero: 'from-slate-600 via-slate-700 to-slate-900',    dot: 'bg-slate-600',   soft: 'bg-slate-100 text-slate-700' },
} as const
export type GroupColor = keyof typeof GROUP_COLORS

export function isGroupColor(v: unknown): v is GroupColor {
  return typeof v === 'string' && v in GROUP_COLORS
}

/** Answer to any groups call before apply-wa-booking-groups.sh has been run. */
export const SETUP_NEEDED_ERROR = 'wa-groups-setup-needed'

export interface GroupSummary {
  id: string
  name: string
  color: GroupColor
  total: number
  inTrip: number
  arrivingSoon: number
  /** Days until the soonest arrival still ahead, if any. */
  nextArrivalDays: number | null
  autoCount: number
}

export interface GroupCoverage {
  at: string
  status: string
  count: number
}

export interface GroupMember {
  bookingRef: string
  isNumber: string | null
  leadName: string | null
  agent: string | null
  status: string
  country: string | null
  arrival: string
  departure: string
  pax: string
  phone: string | null
  /** Why nothing can be sent to this booking, or null when it is live. */
  blocked: string | null
  /** The guest's own calendar day, so "today" means their today. */
  localToday: string
  daysToArrival: number
  stage: 'upcoming' | 'in-trip' | 'finished'
  readiness: { flights: number; hotels: number; itinerary: number; driverItems: number; driversAssigned: number }
  coverage: Partial<Record<GroupKind, GroupCoverage>>
  /** Trip days whose daily plan has already gone out. */
  dailyDates: string[]
}

export interface GroupActivity {
  id: string
  bookingRef: string
  leadName: string | null
  kind: GroupKind
  trigger: 'manual' | 'auto'
  status: string
  detail: string | null
  targetDate: string | null
  sentByName: string | null
  createdAt: string
}

export interface GroupUpcoming {
  date: string
  time: string
  kind: GroupKind
  bookingRef: string
  leadName: string | null
}

export interface GroupDetail {
  id: string
  name: string
  color: GroupColor
  autoDaily: boolean
  dailyTime: string
  autoDay7: boolean
  autoDay3: boolean
  autoDriver: boolean
  docTime: string
  canManage: boolean
  members: GroupMember[]
  activity: GroupActivity[]
  upcoming: GroupUpcoming[]
}

export interface GroupCandidate {
  bookingRef: string
  isNumber: string | null
  leadName: string | null
  status: string
  country: string | null
  arrival: string
  departure: string
  hasPhone: boolean
}

export interface GroupSendOutcome {
  status: 'sent' | 'failed' | 'skipped'
  detail: string | null
}

/** Can this kind go to this member on this day? Returns the reason it can't. */
export function memberBlocker(m: GroupMember, kind: GroupKind, date?: string): string | null {
  if (m.blocked) return m.blocked
  if (!m.phone) return 'No WhatsApp number'
  if (kind === 'flights' && m.readiness.flights === 0) return 'No flights on file'
  if (kind === 'hotels' && m.readiness.hotels === 0) return 'No hotels on file'
  if (kind === 'itinerary' && m.readiness.itinerary === 0) return 'No itinerary on file'
  if (kind === 'driver' && m.readiness.driversAssigned === 0) return 'No driver assigned yet'
  if (kind === 'daily' && date && (date < m.arrival || date > m.departure)) return 'Not travelling that day'
  return null
}

/** The booking at a glance, for the chat side panel and the AI's context. No prices or rates. */
export interface GuestBrief {
  bookingRef: string
  shownRef: string
  leadName: string | null
  status: string
  agent: string | null
  country: string | null
  arrival: string
  departure: string
  pax: string
  flights: { flightNo: string; airline: string | null; date: string; from: string; to: string; dep: string; arr: string }[]
  hotels: { hotel: string; city: string; checkIn: string; checkOut: string; nights: number; room: string | null; meal: string | null }[]
  itinerary: { dayNo: number; date: string; title: string }[]
  drivers: { name: string; phone: string | null; vehicle: string | null; plate: string | null }[]
  /** The day that matters now: today on trip, else arrival day. */
  focusDate: string
  focusPlan: { time: string | null; title: string; driver: string | null }[]
}

export interface ReplySuggestions {
  /** One line on what the guest wants. */
  summary: string
  replies: { label: string; text: string }[]
}
