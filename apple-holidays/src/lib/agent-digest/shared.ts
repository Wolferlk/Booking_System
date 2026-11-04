/**
 * Agent Daily Digest — types, defaults and renderers shared by the server and
 * the designer page. No server imports: safe in the client, so the live
 * preview on the page is rendered by exactly the same code that sends.
 *
 * A digest is a daily WhatsApp / email to an agent (e.g. 30 Sundays) built
 * from "blocks". Each block picks bookings by a date basis relative to the
 * send day:
 *
 *   ON_GROUND   — guests in country on that day (arrival ≤ day ≤ departure)
 *   ARRIVAL     — arriving that day
 *   TOUR_START  — first agenda (MC) line falls on that day
 *   ACTIVITY    — has an agenda line on that day
 *   DEPARTURE   — departing that day
 *
 * and shows each booking either line by line (ITEM — the day's agenda lines
 * with driver, vehicle, driver vendor, guide and tour vendor) or as one tour
 * summary (TOUR — everyone allocated across the whole trip).
 *
 * Never carries driver rates or any money: this goes to an external agent.
 */

export const DIGEST_COUNTRIES = ['SRILANKA', 'VIETNAM', 'SINGAPORE', 'MALAYSIA'] as const
export type DigestCountry = (typeof DIGEST_COUNTRIES)[number]

export const DIGEST_COUNTRY_META: Record<DigestCountry, { label: string; short: string; tz: string; emoji: string }> = {
  SRILANKA:  { label: 'Sri Lanka', short: 'LK', tz: 'Asia/Colombo',      emoji: '🇱🇰' },
  VIETNAM:   { label: 'Vietnam',   short: 'VN', tz: 'Asia/Ho_Chi_Minh',  emoji: '🇻🇳' },
  SINGAPORE: { label: 'Singapore', short: 'SG', tz: 'Asia/Singapore',    emoji: '🇸🇬' },
  MALAYSIA:  { label: 'Malaysia',  short: 'MY', tz: 'Asia/Kuala_Lumpur', emoji: '🇲🇾' },
}

export const DIGEST_TIMEZONES = [
  { value: 'Asia/Colombo',      label: 'Colombo (UTC+5:30)' },
  { value: 'Asia/Kolkata',      label: 'India (UTC+5:30)' },
  { value: 'Asia/Ho_Chi_Minh',  label: 'Ho Chi Minh (UTC+7)' },
  { value: 'Asia/Singapore',    label: 'Singapore (UTC+8)' },
  { value: 'Asia/Kuala_Lumpur', label: 'Kuala Lumpur (UTC+8)' },
  { value: 'Asia/Dubai',        label: 'Dubai (UTC+4)' },
]

export type DateBasis = 'ON_GROUND' | 'ARRIVAL' | 'TOUR_START' | 'ACTIVITY' | 'DEPARTURE'
export type BlockScope = 'ITEM' | 'TOUR'

export const BASIS_META: Record<DateBasis, { label: string; hint: string; emoji: string }> = {
  ON_GROUND:  { label: 'On ground',   hint: 'Guests in country that day (arrival → departure)', emoji: '🟢' },
  ARRIVAL:    { label: 'Arrival date', hint: 'Arriving that day',                               emoji: '🛬' },
  TOUR_START: { label: 'Tour start',  hint: 'First agenda / MC line is that day',              emoji: '🚩' },
  ACTIVITY:   { label: 'Activity date', hint: 'Has an agenda / MC line that day',              emoji: '🎟️' },
  DEPARTURE:  { label: 'Departure date', hint: 'Leaving that day',                             emoji: '🛫' },
}

export const SCOPE_META: Record<BlockScope, { label: string; hint: string }> = {
  ITEM: { label: 'Agenda lines', hint: 'Each MC / agenda line of the day with its driver, guide and vendor' },
  TOUR: { label: 'Whole tour',   hint: 'One card per booking with everyone allocated across the trip' },
}

export interface DigestBlock {
  id: string
  label: string
  basis: DateBasis
  /** Days from the send day: 0 = same day, 1 = next day, -1 = yesterday. */
  offset: number
  scope: BlockScope
  enabled: boolean
}

export interface DigestFields {
  tripNo: boolean
  isNumber: boolean
  leadGuest: boolean
  pax: boolean
  dayOfTour: boolean
  hotel: boolean
  flight: boolean
  time: boolean
  route: boolean
  serviceType: boolean
  driver: boolean
  driverPhone: boolean
  vehicle: boolean
  driverVendor: boolean
  guide: boolean
  guidePhone: boolean
  tourVendor: boolean
  tourVendorPhone: boolean
  movementNote: boolean
  /** Flag lines that still have nobody allocated ("⚠ driver pending"). */
  flagMissing: boolean
}

export const FIELD_GROUPS: { title: string; fields: { key: keyof DigestFields; label: string }[] }[] = [
  { title: 'Booking', fields: [
    { key: 'tripNo', label: 'Trip / file no.' }, { key: 'isNumber', label: 'IS / CNTL no.' },
    { key: 'leadGuest', label: 'Lead guest' }, { key: 'pax', label: 'Pax' },
    { key: 'dayOfTour', label: 'Day X of Y' }, { key: 'hotel', label: 'Tonight’s hotel' },
    { key: 'flight', label: 'Flight (arrival/departure)' },
  ] },
  { title: 'Agenda line', fields: [
    { key: 'time', label: 'Time' }, { key: 'route', label: 'Route / location' },
    { key: 'serviceType', label: 'Service type' }, { key: 'movementNote', label: 'Line note' },
  ] },
  { title: 'Allocation', fields: [
    { key: 'driver', label: 'Driver' }, { key: 'driverPhone', label: 'Driver phone' },
    { key: 'vehicle', label: 'Vehicle' }, { key: 'driverVendor', label: 'Driver vendor' },
    { key: 'guide', label: 'Guide' }, { key: 'guidePhone', label: 'Guide phone' },
    { key: 'tourVendor', label: 'Tour vendor' }, { key: 'tourVendorPhone', label: 'Tour vendor phone' },
    { key: 'flagMissing', label: 'Flag missing allocation' },
  ] },
]

export interface DigestRecipient {
  id: string
  name: string
  phone: string
  email: string
  whatsapp: boolean
  emailOn: boolean
}

export type DigestStyle = 'detailed' | 'compact'
export type StatusFilter = 'ACTIVE' | 'CONFIRMED'

export interface DigestConfig {
  /** Agent match keys (case/punctuation-insensitive). Empty = every agent. */
  agents: string[]
  /** Empty = every country. */
  countries: DigestCountry[]
  statusFilter: StatusFilter
  blocks: DigestBlock[]
  fields: DigestFields
  recipients: DigestRecipient[]
  /** Extra internal copies on every email. */
  ccEmails: string[]
  channels: { whatsapp: boolean; email: boolean }
  style: DigestStyle
  /** Supports {agent} {date} {day} {bookings} {lines} {recipient} {countries}. */
  intro: string
  footer: string
  /** Do not send when every block is empty. */
  skipEmpty: boolean
  /** Add the "view full update" web link to WhatsApp text. */
  includeLink: boolean
}

export interface DigestRuleView {
  id: string
  name: string
  isActive: boolean
  autoSend: boolean
  sendTime: string
  timezone: string
  config: DigestConfig
  createdByName: string | null
  updatedByName: string | null
  updatedAt: string
  lastSentAt: string | null
  lastStatus: string | null
  nextSendAt: string | null
}

export const DEFAULT_FIELDS: DigestFields = {
  tripNo: true, isNumber: true, leadGuest: true, pax: true, dayOfTour: true, hotel: false, flight: true,
  time: true, route: true, serviceType: false,
  driver: true, driverPhone: true, vehicle: true, driverVendor: true,
  guide: true, guidePhone: true, tourVendor: true, tourVendorPhone: true,
  movementNote: false, flagMissing: true,
}

export function newId(prefix = 'x'): string {
  return `${prefix}${Math.random().toString(36).slice(2, 9)}`
}

export function defaultBlocks(): DigestBlock[] {
  return [
    { id: newId('b'), label: 'On ground today',   basis: 'ON_GROUND', offset: 0, scope: 'ITEM', enabled: true },
    { id: newId('b'), label: 'Arriving tomorrow', basis: 'ARRIVAL',   offset: 1, scope: 'TOUR', enabled: true },
  ]
}

export function defaultConfig(): DigestConfig {
  return {
    agents: [],
    countries: [],
    statusFilter: 'ACTIVE',
    blocks: defaultBlocks(),
    fields: { ...DEFAULT_FIELDS },
    recipients: [],
    ccEmails: [],
    channels: { whatsapp: true, email: false },
    style: 'detailed',
    intro: 'Good morning {recipient}! 👋\nHere is the {agent} operations update for {day}.',
    footer: 'Any questions — just reply here.\n— AppleHolidays Operations',
    skipEmpty: true,
    includeLink: true,
  }
}

/** Quick-start designs for the "New digest" gallery. */
export const DIGEST_PRESETS: { key: string; title: string; blurb: string; emoji: string; build: () => Partial<DigestConfig> & { name: string } }[] = [
  {
    key: 'agent-daily', title: 'Agent daily ops', emoji: '🌅',
    blurb: 'Today on ground line by line + tomorrow’s arrivals. The 30 Sundays morning update.',
    build: () => ({ name: '30 Sundays — daily ops', agents: ['30 Sundays', '30sundays', 'Thirty Sundays'], blocks: defaultBlocks() }),
  },
  {
    key: 'tomorrow', title: 'Tomorrow’s plan', emoji: '🌙',
    blurb: 'Evening send: every agenda line for tomorrow with who is driving and guiding.',
    build: () => ({
      name: 'Tomorrow’s plan',
      blocks: [{ id: newId('b'), label: 'Tomorrow’s services', basis: 'ACTIVITY', offset: 1, scope: 'ITEM', enabled: true }],
      intro: 'Good evening {recipient} 🌙\nHere is the plan for {day}.',
    }),
  },
  {
    key: 'arrivals', title: 'Arrivals radar', emoji: '🛬',
    blurb: 'Arrivals today and tomorrow with flight, hotel and the whole tour’s team.',
    build: () => ({
      name: 'Arrivals radar',
      blocks: [
        { id: newId('b'), label: 'Arriving today',    basis: 'ARRIVAL', offset: 0, scope: 'TOUR', enabled: true },
        { id: newId('b'), label: 'Arriving tomorrow', basis: 'ARRIVAL', offset: 1, scope: 'TOUR', enabled: true },
      ],
      fields: { ...DEFAULT_FIELDS, hotel: true },
    }),
  },
  {
    key: 'blank', title: 'Blank canvas', emoji: '✨',
    blurb: 'Start empty and build your own blocks.',
    build: () => ({ name: 'New digest', blocks: [] }),
  },
]

// ── Normalising stored / submitted config ───────────────────────────────────

const BASES: DateBasis[] = ['ON_GROUND', 'ARRIVAL', 'TOUR_START', 'ACTIVITY', 'DEPARTURE']

function str(v: unknown, max = 500): string {
  return typeof v === 'string' ? v.slice(0, max) : ''
}

export function normaliseConfig(raw: unknown): DigestConfig {
  const d = defaultConfig()
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<DigestConfig>
  const blocks = Array.isArray(r.blocks) ? r.blocks : d.blocks
  const fieldsIn = (r.fields && typeof r.fields === 'object' ? r.fields : {}) as Partial<DigestFields>
  const fields = { ...DEFAULT_FIELDS }
  for (const k of Object.keys(fields) as (keyof DigestFields)[]) {
    if (typeof fieldsIn[k] === 'boolean') fields[k] = fieldsIn[k] as boolean
  }
  return {
    agents: Array.isArray(r.agents) ? Array.from(new Set(r.agents.map(a => str(a, 120).trim()).filter(Boolean))).slice(0, 30) : [],
    countries: Array.isArray(r.countries) ? r.countries.filter((c): c is DigestCountry => (DIGEST_COUNTRIES as readonly string[]).includes(c as string)) : [],
    statusFilter: r.statusFilter === 'CONFIRMED' ? 'CONFIRMED' : 'ACTIVE',
    blocks: blocks.slice(0, 8).map((b: Partial<DigestBlock>) => ({
      id: str(b.id, 40) || newId('b'),
      label: str(b.label, 80).trim() || BASIS_META[BASES.includes(b.basis as DateBasis) ? b.basis as DateBasis : 'ON_GROUND'].label,
      basis: BASES.includes(b.basis as DateBasis) ? b.basis as DateBasis : 'ON_GROUND',
      offset: Math.max(-7, Math.min(30, Math.round(Number(b.offset) || 0))),
      scope: b.scope === 'TOUR' ? 'TOUR' : 'ITEM',
      enabled: b.enabled !== false,
    })),
    fields,
    recipients: (Array.isArray(r.recipients) ? r.recipients : []).slice(0, 40).map((p: Partial<DigestRecipient>) => ({
      id: str(p.id, 40) || newId('r'),
      name: str(p.name, 120).trim(),
      phone: str(p.phone, 40).trim(),
      email: str(p.email, 200).trim(),
      whatsapp: p.whatsapp !== false,
      emailOn: p.emailOn === true,
    })).filter(p => p.name || p.phone || p.email),
    ccEmails: Array.isArray(r.ccEmails) ? r.ccEmails.map(e => str(e, 200).trim()).filter(isEmail).slice(0, 20) : [],
    channels: {
      whatsapp: r.channels?.whatsapp !== false,
      email: r.channels?.email === true,
    },
    style: r.style === 'compact' ? 'compact' : 'detailed',
    intro: typeof r.intro === 'string' ? r.intro.slice(0, 1000) : d.intro,
    footer: typeof r.footer === 'string' ? r.footer.slice(0, 1000) : d.footer,
    skipEmpty: r.skipEmpty !== false,
    includeLink: r.includeLink !== false,
  }
}

export function isEmail(v: string | null | undefined): v is string {
  return !!v && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim())
}

export function isTime(v: unknown): v is string {
  return typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v)
}

// ── Agent matching (same rule as super-partners.ts) ─────────────────────────

const compact = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

export function agentMatches(agent: string | null | undefined, keys: string[]): boolean {
  if (!keys.length) return true
  if (!agent?.trim()) return false
  const words = agent.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
  const whole = compact(agent)
  return keys.some(k => {
    const key = compact(k)
    if (!key) return false
    return key.length <= 4 ? words.includes(key) : whole.includes(key)
  })
}

// ── Dates ───────────────────────────────────────────────────────────────────

export function addDays(ymd: string, n: number): string {
  const d = new Date(`${ymd}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

export function todayIn(tz: string, now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}

export function nowHmIn(tz: string, now = new Date()): string {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(now)
  const h = (Number(p.find(x => x.type === 'hour')?.value ?? '0') % 24).toString().padStart(2, '0')
  return `${h}:${p.find(x => x.type === 'minute')?.value ?? '00'}`
}

/** "Wed, 04 Nov 2026". */
export function fmtDay(ymd: string): string {
  const d = new Date(`${ymd}T00:00:00Z`)
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' })
}

export function fmtShort(ymd: string): string {
  const d = new Date(`${ymd}T00:00:00Z`)
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: 'UTC' })
}

export function relDayLabel(offset: number): string {
  if (offset === 0) return 'same day'
  if (offset === 1) return 'next day'
  if (offset === -1) return 'previous day'
  return offset > 0 ? `+${offset} days` : `${offset} days`
}

// ── Payload (what one digest contains) ──────────────────────────────────────

export interface DigestParty { name: string | null; phone: string | null }

export interface DigestItem {
  date: string
  time: string | null
  route: string
  service: string | null
  note: string | null
  isLeisure: boolean
  needsDriver: boolean
  driver: DigestParty | null
  vehicle: string | null
  driverVendor: DigestParty | null
  guide: DigestParty | null
  tourVendor: DigestParty | null
}

export interface DigestBooking {
  ref: string
  tripNo: string
  isNumber: string | null
  cntlNumber: string | null
  agent: string | null
  country: DigestCountry | null
  lead: string | null
  paxAdults: number
  paxChildren: number
  paxInfants: number
  arrival: string
  departure: string
  dayNo: number
  totalDays: number
  hotel: string | null
  flight: string | null
  items: DigestItem[]
  /** TOUR scope: everyone allocated anywhere on the trip, de-duplicated. */
  team: { drivers: (DigestParty & { vehicle: string | null })[]; driverVendors: DigestParty[]; guides: DigestParty[]; tourVendors: DigestParty[] }
  missing: number
}

export interface DigestBlockResult {
  id: string
  label: string
  basis: DateBasis
  scope: BlockScope
  date: string
  bookings: DigestBooking[]
}

export interface DigestPayload {
  ruleName: string
  runDate: string
  agentLabel: string
  countries: DigestCountry[]
  generatedAt: string
  blocks: DigestBlockResult[]
  totals: { bookings: number; lines: number; missing: number }
}

export function isEmptyPayload(p: DigestPayload): boolean {
  return p.blocks.every(b => b.bookings.length === 0)
}

/**
 * A line is only "pending" when it needs transport and NOBODY is on it yet:
 * no driver, no vehicle, no driver vendor and no tour vendor. Any one of those
 * means someone is handling it, so we show what we have instead of a warning.
 */
export function allocationPending(it: Pick<DigestItem, 'needsDriver' | 'driver' | 'vehicle' | 'driverVendor' | 'tourVendor'>): boolean {
  return it.needsDriver && !it.driver?.name && !it.vehicle && !it.driverVendor?.name && !it.tourVendor?.name
}

// ── Rendering ───────────────────────────────────────────────────────────────

export function fillTokens(text: string, p: DigestPayload, recipient: string): string {
  const map: Record<string, string> = {
    agent: p.agentLabel,
    date: fmtShort(p.runDate),
    day: fmtDay(p.runDate),
    bookings: String(p.totals.bookings),
    lines: String(p.totals.lines),
    recipient: recipient || 'team',
    countries: p.countries.length ? p.countries.map(c => DIGEST_COUNTRY_META[c].label).join(', ') : 'all countries',
  }
  return text.replace(/\{(\w+)\}/g, (m, k: string) => (k in map ? map[k] : m))
}

function partyText(p: DigestParty | null, withPhone: boolean): string {
  if (!p?.name && !p?.phone) return ''
  return [p.name, withPhone && p.phone ? p.phone : null].filter(Boolean).join(' · ')
}

function paxText(b: DigestBooking): string {
  const parts = [`${b.paxAdults}A`]
  if (b.paxChildren) parts.push(`${b.paxChildren}C`)
  if (b.paxInfants) parts.push(`${b.paxInfants}I`)
  return parts.join(' ')
}

function bookingHeadline(b: DigestBooking, f: DigestFields): string {
  const ids: string[] = []
  if (f.tripNo) ids.push(b.tripNo)
  if (f.isNumber) {
    for (const v of [b.isNumber, b.cntlNumber]) if (v && v !== b.tripNo && !ids.includes(v)) ids.push(v)
  }
  const head = ids.length ? `*${ids.join(' / ')}*` : `*${b.ref}*`
  const bits = [head]
  if (f.leadGuest && b.lead) bits.push(b.lead)
  if (f.pax) bits.push(paxText(b))
  if (f.dayOfTour && b.totalDays > 0 && b.dayNo >= 1 && b.dayNo <= b.totalDays) bits.push(`Day ${b.dayNo}/${b.totalDays}`)
  return bits.join(' · ')
}

function itemLinesWa(it: DigestItem, f: DigestFields, style: DigestStyle): string[] {
  const out: string[] = []
  const head = [f.time && it.time ? `⏰ ${it.time}` : null, f.route ? it.route : null, f.serviceType && it.service ? `(${it.service})` : null]
    .filter(Boolean).join(' ')
  out.push(`▸ ${head || 'Agenda line'}${it.isLeisure ? ' · 🌴 leisure' : ''}`)
  const sub: string[] = []
  if (f.driver) {
    const d = partyText(it.driver, f.driverPhone)
    const veh = f.vehicle && it.vehicle ? it.vehicle : ''
    if (d || veh) sub.push(`🚗 ${[d, veh].filter(Boolean).join(' · ')}`)
    else if (f.flagMissing && allocationPending(it)) sub.push('⚠️ Driver pending')
  } else if (f.vehicle && it.vehicle) sub.push(`🚗 ${it.vehicle}`)
  if (f.driverVendor) { const v = partyText(it.driverVendor, f.driverPhone); if (v) sub.push(`🏢 ${v}`) }
  if (f.guide) { const g = partyText(it.guide, f.guidePhone); if (g) sub.push(`🧭 Guide: ${g}`) }
  if (f.tourVendor) { const t = partyText(it.tourVendor, f.tourVendorPhone); if (t) sub.push(`🎟️ ${t}`) }
  if (f.movementNote && it.note) sub.push(`📝 ${it.note}`)
  if (style === 'compact') {
    if (sub.length) out[0] += ` — ${sub.join(' | ')}`
  } else {
    for (const s of sub) out.push(`   ${s}`)
  }
  return out
}

function teamLinesWa(b: DigestBooking, f: DigestFields): string[] {
  const out: string[] = []
  if (f.driver) {
    if (b.team.drivers.length) {
      for (const d of b.team.drivers) out.push(`   🚗 ${[partyText(d, f.driverPhone), f.vehicle ? d.vehicle : null].filter(Boolean).join(' · ')}`)
    } else if (f.flagMissing && b.missing > 0) out.push('   ⚠️ Driver pending')
  }
  if (f.driverVendor) for (const v of b.team.driverVendors) out.push(`   🏢 ${partyText(v, f.driverPhone)}`)
  if (f.guide) for (const g of b.team.guides) out.push(`   🧭 Guide: ${partyText(g, f.guidePhone)}`)
  if (f.tourVendor) for (const t of b.team.tourVendors) out.push(`   🎟️ ${partyText(t, f.tourVendorPhone)}`)
  return out
}

/** One string per block — the sender splits long digests on these seams. */
export function renderWhatsAppParts(p: DigestPayload, c: DigestConfig, recipient: string, link?: string | null): string[] {
  const f = c.fields
  const parts: string[] = []
  const intro = fillTokens(c.intro, p, recipient).trim()
  const top = [
    intro,
    `📊 *${p.totals.bookings}* booking${p.totals.bookings === 1 ? '' : 's'} · *${p.totals.lines}* service line${p.totals.lines === 1 ? '' : 's'}${f.flagMissing && p.totals.missing ? ` · ⚠️ ${p.totals.missing} pending` : ''}`,
  ].filter(Boolean).join('\n\n')
  parts.push(top)

  for (const blk of p.blocks) {
    const lines: string[] = [`━━━━━━━━━━━━━━`, `${BASIS_META[blk.basis].emoji} *${blk.label.toUpperCase()}* — ${fmtShort(blk.date)} (${blk.bookings.length})`]
    if (!blk.bookings.length) lines.push('_Nothing scheduled._')
    for (const b of blk.bookings) {
      lines.push('')
      lines.push(`🧾 ${bookingHeadline(b, f)}`)
      if (f.flight && b.flight) lines.push(`   ✈️ ${b.flight}`)
      if (f.hotel && b.hotel) lines.push(`   🏨 ${b.hotel}`)
      if (blk.scope === 'TOUR') {
        lines.push(`   🗓️ ${fmtShort(b.arrival)} → ${fmtShort(b.departure)}`)
        lines.push(...teamLinesWa(b, f))
      } else if (!b.items.length) {
        lines.push('   _No agenda lines this day._')
      } else {
        for (const it of b.items) lines.push(...itemLinesWa(it, f, c.style).map(l => (l.startsWith('▸') ? `   ${l}` : `   ${l}`)))
      }
    }
    parts.push(lines.join('\n'))
  }

  const tail: string[] = []
  if (c.includeLink && link) tail.push(`🔗 Full update: ${link}`)
  const footer = fillTokens(c.footer, p, recipient).trim()
  if (footer) tail.push(footer)
  if (tail.length) parts.push(tail.join('\n\n'))
  return parts
}

export function renderWhatsApp(p: DigestPayload, c: DigestConfig, recipient: string, link?: string | null): string {
  return renderWhatsAppParts(p, c, recipient, link).join('\n\n')
}

/** Splits rendered parts into WhatsApp-sized messages (limit 4096; keep headroom). */
export function chunkParts(parts: string[], max = 3800): string[] {
  const out: string[] = []
  let cur = ''
  for (const part of parts) {
    const pieces = part.length > max ? part.match(new RegExp(`[\\s\\S]{1,${max}}`, 'g')) ?? [part] : [part]
    for (const piece of pieces) {
      if (!cur) cur = piece
      else if (cur.length + 2 + piece.length <= max) cur += `\n\n${piece}`
      else { out.push(cur); cur = piece }
    }
  }
  if (cur) out.push(cur)
  return out
}

const esc = (s: string | null | undefined) =>
  String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]!))

function chip(text: string, bg: string, fg: string): string {
  return `<span style="display:inline-block;background:${bg};color:${fg};border-radius:999px;padding:2px 9px;font-size:11px;font-weight:600;margin:2px 4px 2px 0">${esc(text)}</span>`
}

function partyHtml(icon: string, label: string, p: DigestParty | null, phone: boolean, extra?: string | null): string {
  if (!p?.name && !p?.phone && !extra) return ''
  const tel = phone && p?.phone ? ` <a href="tel:${esc(p.phone.replace(/\s+/g, ''))}" style="color:#0f766e;text-decoration:none">${esc(p.phone)}</a>` : ''
  return `<div style="font-size:12px;color:#334155;margin-top:3px">${icon} <span style="color:#94a3b8">${label}</span> <b>${esc(p?.name ?? '')}</b>${tel}${extra ? ` <span style="color:#64748b">· ${esc(extra)}</span>` : ''}</div>`
}

export function emailSubject(p: DigestPayload): string {
  return `${p.agentLabel} · Daily operations update · ${fmtDay(p.runDate)} (${p.totals.bookings} booking${p.totals.bookings === 1 ? '' : 's'})`
}

export function renderEmailHtml(p: DigestPayload, c: DigestConfig, recipient: string, link?: string | null): string {
  const f = c.fields
  const intro = esc(fillTokens(c.intro, p, recipient)).replace(/\n/g, '<br>')
  const footer = esc(fillTokens(c.footer, p, recipient)).replace(/\n/g, '<br>')

  const blocks = p.blocks.map(blk => {
    const cards = blk.bookings.map(b => {
      const ids = [f.tripNo ? b.tripNo : null, f.isNumber ? b.isNumber : null, f.isNumber ? b.cntlNumber : null]
        .filter((v, i, a): v is string => !!v && a.indexOf(v) === i)
      const chips = [
        f.pax ? chip(`${paxText(b)} pax`, '#eef2ff', '#4338ca') : '',
        f.dayOfTour && b.dayNo >= 1 && b.dayNo <= b.totalDays ? chip(`Day ${b.dayNo}/${b.totalDays}`, '#ecfdf5', '#047857') : '',
        b.country ? chip(DIGEST_COUNTRY_META[b.country].label, '#f1f5f9', '#475569') : '',
        f.flagMissing && b.missing ? chip(`${b.missing} pending`, '#fef2f2', '#b91c1c') : '',
      ].join('')
      const meta = [
        f.flight && b.flight ? `✈️ ${esc(b.flight)}` : '',
        f.hotel && b.hotel ? `🏨 ${esc(b.hotel)}` : '',
        blk.scope === 'TOUR' ? `🗓️ ${esc(fmtShort(b.arrival))} → ${esc(fmtShort(b.departure))}` : '',
      ].filter(Boolean).join(' &nbsp;·&nbsp; ')

      let body = ''
      if (blk.scope === 'TOUR') {
        const t = b.team
        body = [
          ...(f.driver ? t.drivers.map(d => partyHtml('🚗', 'Driver', d, f.driverPhone, f.vehicle ? d.vehicle : null)) : []),
          ...(f.driver && !t.drivers.length && f.flagMissing && b.missing ? ['<div style="font-size:12px;color:#b91c1c;margin-top:3px">⚠️ Driver pending</div>'] : []),
          ...(f.driverVendor ? t.driverVendors.map(v => partyHtml('🏢', 'Driver vendor', v, f.driverPhone)) : []),
          ...(f.guide ? t.guides.map(g => partyHtml('🧭', 'Guide', g, f.guidePhone)) : []),
          ...(f.tourVendor ? t.tourVendors.map(v => partyHtml('🎟️', 'Tour vendor', v, f.tourVendorPhone)) : []),
        ].join('')
      } else if (!b.items.length) {
        body = '<div style="font-size:12px;color:#94a3b8">No agenda lines this day.</div>'
      } else {
        body = b.items.map(it => {
          const head = [f.time && it.time ? `<b style="color:#0f172a">${esc(it.time)}</b>` : '', f.route ? esc(it.route) : '', f.serviceType && it.service ? `<span style="color:#94a3b8">(${esc(it.service)})</span>` : '']
            .filter(Boolean).join(' ')
          const people = [
            f.driver ? (it.driver?.name ? partyHtml('🚗', 'Driver', it.driver, f.driverPhone, f.vehicle ? it.vehicle : null) : partyHtml('🚗', 'Vehicle', null, false, f.vehicle ? it.vehicle : null)) : '',
            f.driver && f.flagMissing && allocationPending(it) ? '<div style="font-size:12px;color:#b91c1c;margin-top:3px">⚠️ Driver pending</div>' : '',
            f.driverVendor ? partyHtml('🏢', 'Driver vendor', it.driverVendor, f.driverPhone) : '',
            f.guide ? partyHtml('🧭', 'Guide', it.guide, f.guidePhone) : '',
            f.tourVendor ? partyHtml('🎟️', 'Tour vendor', it.tourVendor, f.tourVendorPhone) : '',
            f.movementNote && it.note ? `<div style="font-size:12px;color:#64748b;margin-top:3px">📝 ${esc(it.note)}</div>` : '',
          ].join('')
          return `<div style="border-left:3px solid ${it.isLeisure ? '#a7f3d0' : '#5eead4'};padding:6px 0 6px 10px;margin:8px 0">
            <div style="font-size:13px;color:#334155">${head || 'Agenda line'}${it.isLeisure ? ' <span style="color:#059669">· leisure</span>' : ''}</div>${people}</div>`
        }).join('')
      }

      return `<div style="border:1px solid #e2e8f0;border-radius:14px;padding:14px 16px;margin:10px 0;background:#fff">
        <div style="font-size:15px;font-weight:700;color:#0f172a">${esc(ids.join(' / ') || b.ref)}${f.leadGuest && b.lead ? ` <span style="font-weight:500;color:#475569">· ${esc(b.lead)}</span>` : ''}</div>
        <div style="margin-top:4px">${chips}</div>
        ${meta ? `<div style="font-size:12px;color:#64748b;margin-top:6px">${meta}</div>` : ''}
        <div style="margin-top:6px">${body}</div>
      </div>`
    }).join('')
    return `<div style="margin-top:22px">
      <div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#0f766e;font-weight:700">${BASIS_META[blk.basis].emoji} ${esc(blk.label)} · ${esc(fmtShort(blk.date))} · ${blk.bookings.length}</div>
      ${cards || '<div style="font-size:13px;color:#94a3b8;padding:10px 0">Nothing scheduled.</div>'}
    </div>`
  }).join('')

  return `<!doctype html><html><body style="margin:0;background:#f1f5f9;font-family:Segoe UI,Arial,sans-serif">
  <div style="max-width:680px;margin:0 auto;padding:24px">
    <div style="background:linear-gradient(135deg,#0f172a,#134e4a);color:#fff;border-radius:18px;padding:24px">
      <div style="font-size:12px;letter-spacing:.1em;text-transform:uppercase;color:#5eead4">Daily operations update</div>
      <div style="font-size:24px;font-weight:700;margin-top:6px">${esc(p.agentLabel)}</div>
      <div style="font-size:13px;color:#cbd5e1;margin-top:2px">${esc(fmtDay(p.runDate))}</div>
      <div style="margin-top:16px">
        <span style="display:inline-block;background:rgba(255,255,255,.1);border-radius:12px;padding:8px 14px;margin-right:8px"><b style="font-size:20px">${p.totals.bookings}</b><br><span style="font-size:11px;color:#94a3b8">bookings</span></span>
        <span style="display:inline-block;background:rgba(255,255,255,.1);border-radius:12px;padding:8px 14px;margin-right:8px"><b style="font-size:20px">${p.totals.lines}</b><br><span style="font-size:11px;color:#94a3b8">service lines</span></span>
        ${f.flagMissing ? `<span style="display:inline-block;background:${p.totals.missing ? 'rgba(248,113,113,.25)' : 'rgba(255,255,255,.1)'};border-radius:12px;padding:8px 14px"><b style="font-size:20px">${p.totals.missing}</b><br><span style="font-size:11px;color:#94a3b8">pending</span></span>` : ''}
      </div>
    </div>
    <div style="background:#fff;border-radius:18px;padding:20px;margin-top:12px">
      <p style="margin:0;color:#0f172a;font-size:14px;line-height:1.55">${intro}</p>
      ${blocks}
      ${link ? `<div style="margin-top:18px"><a href="${esc(link)}" style="display:inline-block;background:#0f766e;color:#fff;text-decoration:none;font-weight:600;padding:11px 18px;border-radius:10px">Open the live view</a></div>` : ''}
      ${footer ? `<p style="margin:20px 0 0;color:#64748b;font-size:13px;line-height:1.55">${footer}</p>` : ''}
    </div>
  </div></body></html>`
}

// ── WhatsApp template (every WhatsApp send uses it) ─────────────────────────

/** The exact body submitted to Meta as `aahaas_agent_daily_digest`. */
export const AGENT_DIGEST_TEMPLATE_BODY =
  'Hi {{1}}, your daily operations update for {{2}} ({{3}}) is ready: {{4}} bookings and {{5}} service lines, ' +
  'with the allocated driver, guide and vendor details.\n\nView the full update here: {{6}}\n\n' +
  // Meta rejects a body that starts or ends with a variable — keep text after {{6}}.
  'Please reply to this message if anything needs to change.'

function tplParam(v: string): string {
  const clean = v.replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim()
  return clean.length > 180 ? `${clean.slice(0, 177)}…` : clean || '—'
}

/** Template parameters {{1}}…{{6}} for one recipient. */
export function templateParams(p: DigestPayload, recipient: string, link: string): string[] {
  return [recipient || 'there', p.agentLabel, fmtShort(p.runDate), String(p.totals.bookings), String(p.totals.lines), link].map(tplParam)
}

/** What the recipient sees on WhatsApp. */
export function renderTemplateText(params: string[]): string {
  return AGENT_DIGEST_TEMPLATE_BODY.replace(/\{\{\s*(\d+)\s*\}\}/g, (_m, n: string) => params[Number(n) - 1] ?? '')
}
