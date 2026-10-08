/**
 * Movement WhatsApp briefing — the parts both the browser and the server need.
 *
 * One movement (one agenda item) is sent on its own to the people running it:
 * the driver, the transport vendor, the guide and the tour vendor. It goes out
 * through an APPROVED Meta template because most of these numbers never write
 * to the ops line, so they sit outside WhatsApp's 24h window where free-form
 * text is accepted by Meta and then silently dropped.
 *
 * Everything here is pure so the Settings preview, the send dialog and the
 * actual send render the *same* text — what staff read is what lands on the
 * phone. The server half (DB reads, sending, logging) is movement-whatsapp.ts.
 *
 * Settings are one JSON row (`movement_whatsapp_config`) in system_settings,
 * the same approach as `flight_pickup_rules` — no schema change.
 */

// ── Config ───────────────────────────────────────────────────────────────────

export const MOVEMENT_WA_CONFIG_KEY = 'movement_whatsapp_config'
export const MOVEMENT_WA_DEFAULT_TEMPLATE = 'apple_holidays_movement_brief'

/**
 * Log tag on whatsapp_messages.senderName: `[MOVEMENT:<agendaItemId>] Driver · Name`.
 * Deliberately NOT starting with `[DRIVER` — the driver-assignment
 * reconciliation reads that prefix to decide who is "briefed" on a booking,
 * and a one-off movement send must not change its answer.
 */
export const MOVEMENT_TAG_PREFIX = '[MOVEMENT:'

export type MovementRole = 'driver' | 'vendor' | 'guide' | 'tourVendor' | 'other'

export const MOVEMENT_ROLE_LABEL: Record<MovementRole, string> = {
  driver:     'Driver',
  vendor:     'Transport Vendor',
  guide:      'Guide',
  tourVendor: 'Tour Vendor',
  other:      'Other',
}

export interface MovementWaConfig {
  /** Master switch — off hides the send button on every movement. */
  enabled: boolean
  /** Approved Meta template name. Must keep the 8 body variables in this order. */
  templateName: string
  lang: string
  /** Which recipients are ticked when the dialog opens. */
  defaultRoles: Record<Exclude<MovementRole, 'other'>, boolean>
  /** Add the guest's own contact number to the Guests line (driver meets them). */
  shareGuestContact: boolean
  /** Tell each recipient who else is on the movement (driver ↔ guide ↔ vendor). */
  shareCrewContacts: boolean
  /**
   * When the recipient is inside the 24h window, follow the template with the
   * full, untrimmed details as free text (a template caps at 1024 characters).
   */
  fullDetailFollowUp: boolean
  /** Same text to the same number within this many minutes needs a confirm. 0 = off. */
  duplicateGuardMin: number
}

export const DEFAULT_MOVEMENT_WA_CONFIG: MovementWaConfig = {
  enabled: true,
  templateName: MOVEMENT_WA_DEFAULT_TEMPLATE,
  lang: 'en',
  defaultRoles: { driver: true, vendor: true, guide: true, tourVendor: true },
  shareGuestContact: false,
  shareCrewContacts: true,
  fullDetailFollowUp: true,
  duplicateGuardMin: 30,
}

/** Tolerant parse — a missing or half-written row falls back field by field. */
export function parseMovementWaConfig(raw: string | null | undefined): MovementWaConfig {
  const d = DEFAULT_MOVEMENT_WA_CONFIG
  let j: Partial<MovementWaConfig> = {}
  try { j = raw ? JSON.parse(raw) : {} } catch { j = {} }
  const bool = (v: unknown, f: boolean) => (typeof v === 'boolean' ? v : f)
  const roles = (j.defaultRoles ?? {}) as Partial<MovementWaConfig['defaultRoles']>
  const name = String(j.templateName ?? '').trim().toLowerCase()
  const guard = Number(j.duplicateGuardMin)
  return {
    enabled:            bool(j.enabled, d.enabled),
    // Meta template names are lowercase letters, digits and underscores only.
    templateName:       /^[a-z0-9_]{1,512}$/.test(name) ? name : d.templateName,
    lang:               String(j.lang ?? '').trim() || d.lang,
    defaultRoles: {
      driver:     bool(roles.driver,     d.defaultRoles.driver),
      vendor:     bool(roles.vendor,     d.defaultRoles.vendor),
      guide:      bool(roles.guide,      d.defaultRoles.guide),
      tourVendor: bool(roles.tourVendor, d.defaultRoles.tourVendor),
    },
    shareGuestContact:  bool(j.shareGuestContact,  d.shareGuestContact),
    shareCrewContacts:  bool(j.shareCrewContacts,  d.shareCrewContacts),
    fullDetailFollowUp: bool(j.fullDetailFollowUp, d.fullDetailFollowUp),
    duplicateGuardMin:  Number.isFinite(guard) ? Math.min(1440, Math.max(0, Math.round(guard))) : d.duplicateGuardMin,
  }
}

// ── Template ─────────────────────────────────────────────────────────────────

/**
 * The exact body registered with Meta (bootstrap-movement). Starts and ends on
 * fixed text and keeps a healthy text-to-variable ratio — Meta rejects a body
 * that opens or closes on a variable, or is "mostly variables".
 */
export const MOVEMENT_BRIEF_BODY =
  '📋 *AppleHolidays — Movement Briefing*\n\n' +
  'Hi {{1}}, please note the service below for booking {{2}}.\n\n' +
  '📅 Date & time: {{3}}\n' +
  '🧭 Service: {{4}}\n' +
  '🛣 Route: {{5}}\n' +
  '👥 Guests: {{6}}\n' +
  '🚘 On this movement: {{7}}\n\n' +
  '📝 Details: {{8}}\n\n' +
  'Please reply OK to confirm you have received this. For any change, contact our operations team on this number.'

export const MOVEMENT_BRIEF_FOOTER = 'AppleHolidays Operations'
export const MOVEMENT_BRIEF_VARIABLES = 8

/** Example values Meta reviews the template against — one per variable. */
export const MOVEMENT_BRIEF_EXAMPLES = [
  'Suresh',
  'IS48305 · Ref MY-20931',
  'Thu, 08 Oct 2026 · Meet 7:00 AM',
  'Private Transfer',
  'Kuala Lumpur: KUL Airport → Furama Bukit Bintang',
  'Mr. Harre · 2 Adults',
  'Car · WXY 1234',
  'Flight AK 38 COK → KUL arrives 5:30 AM. Driver waits at arrivals with a name board.',
]

/** Meta caps the rendered template body at 1024 characters. */
const BODY_LIMIT = 1024

// ── Input shape ──────────────────────────────────────────────────────────────

export interface MovementBriefInput {
  bookingRef: string
  isNumber: string | null
  /** YYYY-MM-DD (date-only; stored at UTC midnight). */
  date: string
  meetingTime: string | null
  timeFrom: string | null
  timeTo: string | null
  serviceTypeLabel: string
  location: string
  fromPoint: string | null
  toPoint: string | null
  details: string | null
  mealPlan: string | null
  isLeisure: boolean
  isHotelOnly: boolean
  leadPassenger: string | null
  paxAdults: number
  paxChildren: number
  paxInfants: number
  guestContact: string | null
  crew: {
    driverName: string | null
    driverPhone: string | null
    vehicleType: string | null
    vehiclePlate: string | null
    vendorName: string | null
    guideName: string | null
    guidePhone: string | null
    tourVendorName: string | null
    tourVendorPhone: string | null
  }
}

export interface MovementBriefRender {
  params: string[]
  /** Template body with the params filled — logged and shown as the preview. */
  text: string
  /** The details line had to be shortened to fit Meta's 1024-character cap. */
  detailsTrimmed: boolean
  /** The untrimmed details, for the optional free-text follow-up. */
  fullDetails: string
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Meta rejects params with newlines, tabs or 4+ consecutive spaces. */
export function flat(value: string | null | undefined): string {
  return String(value ?? '').replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim()
}

function cap(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, Math.max(0, max - 1)).trimEnd()}…` : value
}

/** "15:45" → "3:45 PM"; anything else untouched. Local copy so this file stays dependency-free. */
function to12(raw: string | null | undefined): string {
  const v = String(raw ?? '').trim()
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(v)
  if (!m) return v
  const h = Number(m[1]), min = Number(m[2])
  if (h > 23 || min > 59) return v
  return `${h % 12 === 0 ? 12 : h % 12}:${String(min).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`
}

/** IS number first (that is what the desk and suppliers quote), booking ref after. */
export function bookingLabel(bookingRef: string, isNumber: string | null): string {
  const is = flat(isNumber)
  if (!is || is.toUpperCase() === bookingRef.toUpperCase()) return bookingRef
  const isTxt = /^is/i.test(is) ? is.toUpperCase() : `IS ${is}`
  return `${isTxt} · Ref ${bookingRef}`
}

/** Date-only values are UTC midnight — format in UTC or a western host shifts the day. */
function dateLine(input: MovementBriefInput): string {
  const d = new Date(`${input.date.slice(0, 10)}T00:00:00Z`)
  const day = Number.isNaN(d.getTime())
    ? input.date
    : d.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' })
  const parts = [day]
  if (input.meetingTime) parts.push(`Meet ${to12(input.meetingTime)}`)
  if (input.timeFrom || input.timeTo) {
    parts.push(`Tour ${[to12(input.timeFrom), to12(input.timeTo)].filter(Boolean).join(' – ')}`)
  }
  return parts.join(' · ')
}

function routeLine(input: MovementBriefInput): string {
  const from = flat(input.fromPoint)
  const to   = flat(input.toPoint)
  const loc  = flat(input.location)
  const leg  = from && to ? `${from} → ${to}` : (to || from)
  if (!leg) return loc || '—'
  return loc && !leg.toLowerCase().startsWith(loc.toLowerCase()) ? `${loc}: ${leg}` : leg
}

function paxLine(input: MovementBriefInput, withContact: boolean): string {
  const bits: string[] = [`${input.paxAdults} Adult${input.paxAdults === 1 ? '' : 's'}`]
  if (input.paxChildren > 0) bits.push(`${input.paxChildren} Child${input.paxChildren === 1 ? '' : 'ren'}`)
  if (input.paxInfants > 0) bits.push(`${input.paxInfants} Infant${input.paxInfants === 1 ? '' : 's'}`)
  const pax = bits.join(', ')
  const head = flat(input.leadPassenger) ? `${flat(input.leadPassenger)} · ${pax}` : pax
  return withContact && flat(input.guestContact) ? `${head} · Guest ☎ ${flat(input.guestContact)}` : head
}

/**
 * "Who else is on this movement", tailored to the reader: a driver needs the
 * guide's number, a guide needs the driver's, a vendor needs both. The agreed
 * driver rate is never part of this — it is internal / P&L only.
 */
function crewLine(input: MovementBriefInput, role: MovementRole, shareCrew: boolean): string {
  const c = input.crew
  const vehicle = [flat(c.vehicleType), flat(c.vehiclePlate)].filter(Boolean).join(' ')
  const person = (label: string, name: string | null, phone: string | null) =>
    flat(name) ? `${label} ${flat(name)}${shareCrew && flat(phone) ? ` (${flat(phone)})` : ''}` : ''

  const driver = person('Driver', c.driverName, c.driverPhone)
  const guide  = person('Guide', c.guideName, c.guidePhone)
  const tourV  = person('Tour vendor', c.tourVendorName, c.tourVendorPhone)
  const vendor = flat(c.vendorName) ? `Transport ${flat(c.vendorName)}` : ''

  let parts: string[]
  switch (role) {
    case 'driver':
      parts = [vehicle ? `Your vehicle ${vehicle}` : 'Vehicle TBC', shareCrew ? guide : '', shareCrew ? tourV : '']
      break
    case 'vendor':
      parts = [driver || 'Driver to be allocated by you', vehicle]
      if (shareCrew) parts.push(guide, tourV)
      break
    default:
      parts = [shareCrew || role === 'other' ? driver : '', vehicle, shareCrew ? (role === 'guide' ? tourV : guide) : '', shareCrew ? vendor : '']
  }
  const out = parts.filter(Boolean).join(' · ')
  return out || 'Details to follow from operations'
}

function detailsText(input: MovementBriefInput, note: string | null): string {
  const bits: string[] = []
  if (input.isLeisure) bits.push('Leisure day — no transport required.')
  if (input.isHotelOnly) bits.push('Hotel only — no transport required.')
  if (flat(input.details)) bits.push(flat(input.details))
  if (flat(input.mealPlan)) bits.push(`Meals: ${flat(input.mealPlan)}.`)
  if (flat(note)) bits.push(`Note from operations: ${flat(note)}`)
  return bits.join(' ') || 'No further details.'
}

/** Fill {{1}}…{{n}} — used for the preview and the message log. */
export function fillTemplate(body: string, params: string[]): string {
  return body.replace(/\{\{\s*(\d+)\s*\}\}/g, (_m, n: string) => params[Number(n) - 1] ?? '')
}

// ── Render ───────────────────────────────────────────────────────────────────

/**
 * Build the eight template parameters for one recipient. The details line gets
 * whatever room is left under Meta's 1024-character cap after everything else,
 * so the date, route and contacts are never the part that gets cut.
 */
export function renderMovementBrief(
  input: MovementBriefInput,
  recipient: { role: MovementRole; name: string },
  opts: { config: MovementWaConfig; note?: string | null },
): MovementBriefRender {
  const { config } = opts
  const fixed = [
    cap(flat(recipient.name) || MOVEMENT_ROLE_LABEL[recipient.role], 60),
    cap(bookingLabel(input.bookingRef, input.isNumber), 80),
    cap(dateLine(input), 90),
    cap(flat(input.serviceTypeLabel) || '—', 60),
    cap(routeLine(input), 200),
    cap(paxLine(input, config.shareGuestContact), 160),
    cap(crewLine(input, recipient.role, config.shareCrewContacts), 220),
  ]
  const fullDetails = detailsText(input, opts.note ?? null)

  const withoutDetails = fillTemplate(MOVEMENT_BRIEF_BODY, [...fixed, '']).length
  const room = Math.max(60, BODY_LIMIT - withoutDetails - 4)
  const details = cap(fullDetails, room)
  const params = [...fixed, details]

  return {
    params,
    text: fillTemplate(MOVEMENT_BRIEF_BODY, params),
    detailsTrimmed: details.length < fullDetails.length,
    fullDetails,
  }
}

/** The free-text follow-up sent inside the 24h window when the template had to trim. */
export function movementFollowUpText(input: MovementBriefInput, fullDetails: string): string {
  return [
    `📝 *Full details — ${bookingLabel(input.bookingRef, input.isNumber)}*`,
    `${dateLine(input)} · ${routeLine(input)}`,
    '',
    fullDetails,
  ].join('\n')
}
