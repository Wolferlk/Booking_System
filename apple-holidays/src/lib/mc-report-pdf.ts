/**
 * MC Report → PDF: the column catalog, report templates and the HTML document.
 *
 * One pure builder renders the document for all three places it is seen: the
 * live preview inside Report Studio, the browser-print fallback, and the
 * server's Chromium PDF (`/api/mc-report/export-pdf`). So what the desk sees
 * in the preview is exactly what is printed.
 *
 * The rows printed are the rows the chart is showing — every filter, the
 * advanced ones included, has already run on the page. The old print view
 * re-fetched by date and silently dropped the advanced filters, so a
 * "driver = SURESH" chart printed everybody's movements.
 *
 * Money never reaches a driver: `McPdfRow` has no driver rate at all, and the
 * desk's internal figures (KM budget, package cost, budget transfer) are
 * flagged `internal` so Report Studio can warn when they are switched on in a
 * sheet that is grouped by driver.
 */

import type { AdvancedFilters } from '@/lib/mc-report-filters'
import {
  EMPTY_FILTERS, FLOW_OPTIONS, TIME_BUCKETS, DRIVER_STATES, TRIP_STAGES, FLAGS, airportName,
} from '@/lib/mc-report-filters'

// ─── Row ─────────────────────────────────────────────────────────────────────

/** A movement as printed — flattened on the page, so the server needs no lookups. */
export interface McPdfRow {
  id:          string
  date:        string
  time:        string | null      // "HH:MM" — flight time first, then meeting time
  vnCode:      string
  isNumber:    string | null
  agentRef:    string | null
  leadGuest:   string | null
  agent:       string | null
  location:    string
  country:     string | null
  adults:      number
  children:    number
  from:        string | null
  to:          string | null
  details:     string | null
  mealPlan:    string | null
  service:     string             // short label
  flow:        'arrival' | 'departure' | 'both' | null
  airport:     string | null
  flights:     string[]           // "UL 504 · CMB 08:40"
  leisure:     boolean
  hotelOnly:   boolean
  noDriver:    boolean
  vendor:      string | null
  driver:      string | null
  driverPhone: string | null
  vehicle:     string | null
  plate:       string | null
  guide:       string | null
  guidePhone:  string | null
  tourVendor:  string | null
  tourVendorPhone: string | null
  mealPrefs:   string
  specialReq:  string
  ticketsControl: string | null
  status:      string
  cancelled:   boolean
  cancelPending: boolean
  done:        boolean
  budgetKm:    number | null
  actualKm:    number | null
  packageCost: number | null
  budgetTransfer: string | null   // "SGD 120"
}

// ─── Columns ─────────────────────────────────────────────────────────────────

export type McPdfColumnKey =
  | 'seq' | 'date' | 'time' | 'tourRef' | 'leadGuest' | 'agent' | 'location' | 'pax'
  | 'from' | 'to' | 'route' | 'details' | 'service' | 'flow' | 'flights'
  | 'meal' | 'mealPref' | 'specialReq'
  | 'driver' | 'driverPhone' | 'vehicle' | 'guide' | 'tourVendor'
  | 'ticketsControl' | 'status'
  | 'budgetKm' | 'actualKm' | 'packageCost' | 'budgetTransfer'
  | 'tick' | 'notes'

export type McPdfColumnGroup = 'Essentials' | 'Route & service' | 'Guests' | 'Allocation' | 'Desk' | 'Internal figures' | 'Sign-off'

export interface McPdfColumn {
  key:    McPdfColumnKey
  label:  string
  group:  McPdfColumnGroup
  hint:   string
  /** Relative width — the table is fixed-layout so long details wrap, never overflow. */
  width:  number
  align?: 'left' | 'center' | 'right'
  /** Desk money / KM — never on a sheet that is handed to a driver. */
  internal?: boolean
}

export const MC_PDF_COLUMNS: McPdfColumn[] = [
  { key: 'seq',        label: '#',              group: 'Essentials',      hint: 'Running number',                       width: 3,  align: 'center' },
  { key: 'date',       label: 'Date',           group: 'Essentials',      hint: '17 Oct 2026',                          width: 8 },
  { key: 'time',       label: 'Time',           group: 'Essentials',      hint: 'Flight time, else meeting time',       width: 6 },
  { key: 'tourRef',    label: 'Tour Ref',       group: 'Essentials',      hint: 'Tour ref + IS number + agent ref',     width: 9 },
  { key: 'leadGuest',  label: 'Lead Guest',     group: 'Guests',          hint: 'Lead passenger',                       width: 12 },
  { key: 'pax',        label: 'Pax',            group: 'Guests',          hint: 'Adults + children',                    width: 5,  align: 'center' },
  { key: 'agent',      label: 'Agent',          group: 'Guests',          hint: 'Tour operator',                        width: 10 },
  { key: 'mealPref',   label: 'Meal Pref.',     group: 'Guests',          hint: 'Veg ×2, Halal…',                       width: 9 },
  { key: 'specialReq', label: 'Special Requests', group: 'Guests',        hint: 'Movement + booking requests',          width: 14 },
  { key: 'location',   label: 'Location',       group: 'Route & service', hint: 'City of the movement',                 width: 9 },
  { key: 'from',       label: 'From',           group: 'Route & service', hint: 'Pickup point',                         width: 11 },
  { key: 'to',         label: 'To',             group: 'Route & service', hint: 'Drop point',                           width: 11 },
  { key: 'route',      label: 'Route',          group: 'Route & service', hint: 'From → To in one column',              width: 16 },
  { key: 'details',    label: 'Details',        group: 'Route & service', hint: 'What happens on this movement',        width: 20 },
  { key: 'service',    label: 'Service',        group: 'Route & service', hint: 'PVT / SIC / Own…',                     width: 7 },
  { key: 'flow',       label: 'Movement',       group: 'Route & service', hint: 'Arrival / departure + airport',        width: 8 },
  { key: 'flights',    label: 'Flights',        group: 'Route & service', hint: 'Flight numbers & times',               width: 11 },
  { key: 'meal',       label: 'Meal',           group: 'Route & service', hint: 'BB / HB / FB…',                        width: 5,  align: 'center' },
  { key: 'driver',     label: 'Driver / Vendor', group: 'Allocation',     hint: 'Who is allocated',                     width: 11 },
  { key: 'driverPhone', label: 'Driver Phone',  group: 'Allocation',      hint: 'Driver contact number',                width: 9 },
  { key: 'vehicle',    label: 'Vehicle',        group: 'Allocation',      hint: 'Type + plate',                         width: 9 },
  { key: 'guide',      label: 'Guide',          group: 'Allocation',      hint: 'Guide + phone',                        width: 10 },
  { key: 'tourVendor', label: 'Tour Vendor',    group: 'Allocation',      hint: 'Tour vendor + phone',                  width: 10 },
  { key: 'ticketsControl', label: 'Tickets Control', group: 'Desk',       hint: 'Vietnam desk note',                    width: 10 },
  { key: 'status',     label: 'Status',         group: 'Desk',            hint: 'Booking status',                       width: 8 },
  { key: 'budgetKm',   label: 'Budget KM',      group: 'Internal figures', hint: 'Sri Lanka',                           width: 6,  align: 'right', internal: true },
  { key: 'actualKm',   label: 'Actual KM',      group: 'Internal figures', hint: 'Sri Lanka',                           width: 6,  align: 'right', internal: true },
  { key: 'packageCost', label: 'Package Cost',  group: 'Internal figures', hint: 'Sri Lanka, LKR',                      width: 8,  align: 'right', internal: true },
  { key: 'budgetTransfer', label: 'Budget Transfer', group: 'Internal figures', hint: 'Singapore / Malaysia',           width: 8,  align: 'right', internal: true },
  { key: 'tick',       label: '✓',              group: 'Sign-off',        hint: 'Empty tick box per row',               width: 3,  align: 'center' },
  { key: 'notes',      label: 'Notes',          group: 'Sign-off',        hint: 'Blank column to write on',             width: 12 },
]

const COLUMN_BY_KEY = new Map(MC_PDF_COLUMNS.map(c => [c.key, c]))
export const MC_PDF_COLUMN_GROUPS: McPdfColumnGroup[] = ['Essentials', 'Guests', 'Route & service', 'Allocation', 'Desk', 'Internal figures', 'Sign-off']

export function pdfColumn(key: McPdfColumnKey): McPdfColumn | undefined {
  return COLUMN_BY_KEY.get(key)
}

export function sanitizeColumns(keys: unknown): McPdfColumnKey[] {
  if (!Array.isArray(keys)) return DEFAULT_COLUMNS
  const out = Array.from(new Set(keys.filter((k): k is McPdfColumnKey => typeof k === 'string' && COLUMN_BY_KEY.has(k as McPdfColumnKey))))
  return out.length ? out : DEFAULT_COLUMNS
}

export const DEFAULT_COLUMNS: McPdfColumnKey[] = [
  'seq', 'date', 'time', 'tourRef', 'leadGuest', 'agent', 'location', 'pax',
  'from', 'to', 'details', 'meal', 'service', 'driver', 'vehicle',
]

// ─── Template ────────────────────────────────────────────────────────────────

export type McGroupBy = 'none' | 'date' | 'driver' | 'agent' | 'location' | 'tourRef' | 'service'
export const GROUP_BY_OPTIONS: { key: McGroupBy; label: string }[] = [
  { key: 'none',     label: 'No grouping' },
  { key: 'date',     label: 'Date' },
  { key: 'driver',   label: 'Driver / Vendor' },
  { key: 'agent',    label: 'Agent' },
  { key: 'location', label: 'Location' },
  { key: 'tourRef',  label: 'Tour file' },
  { key: 'service',  label: 'Service type' },
]

export type McDateMode = 'keep' | 'today' | 'tomorrow' | 'next7' | 'thisWeek' | 'nextWeek' | 'thisMonth'
export const DATE_MODES: { key: McDateMode; label: string }[] = [
  { key: 'keep',      label: 'Whatever range is on screen' },
  { key: 'today',     label: 'Today' },
  { key: 'tomorrow',  label: 'Tomorrow' },
  { key: 'next7',     label: 'Next 7 days' },
  { key: 'thisWeek',  label: 'This week' },
  { key: 'nextWeek',  label: 'Next week' },
  { key: 'thisMonth', label: 'This month' },
]

export const ACCENTS = {
  amber:   { name: 'Apple amber', main: '#d97706', soft: '#fffbeb', ink: '#78350f' },
  emerald: { name: 'Emerald',     main: '#059669', soft: '#ecfdf5', ink: '#064e3b' },
  sky:     { name: 'Sky',         main: '#0284c7', soft: '#f0f9ff', ink: '#0c4a6e' },
  violet:  { name: 'Violet',      main: '#7c3aed', soft: '#f5f3ff', ink: '#4c1d95' },
  rose:    { name: 'Rose',        main: '#e11d48', soft: '#fff1f2', ink: '#881337' },
  slate:   { name: 'Graphite',    main: '#334155', soft: '#f8fafc', ink: '#0f172a' },
} as const
export type McAccent = keyof typeof ACCENTS

export interface McTemplateFilters {
  adv:         AdvancedFilters
  search:      string
  deepSearch:  string
  serviceType: string
  country:     string
  cancelOnly:  boolean
  doneFilter:  'all' | 'pending' | 'done'
}

export interface McTemplateLayout {
  orientation: 'landscape' | 'portrait'
  paper:       'A4' | 'A3'
  density:     'comfortable' | 'compact'
  groupBy:     McGroupBy
  pageBreakPerGroup: boolean
  showStats:   boolean
  showFilters: boolean
  showSignature: boolean
  zebra:       boolean
  accent:      McAccent
}

export interface McTemplateConfig {
  title:    string
  subtitle: string
  notes:    string
  columns:  McPdfColumnKey[]
  dateMode: McDateMode
  filters:  McTemplateFilters
  layout:   McTemplateLayout
}

export interface McReportTemplate {
  id:          string
  name:        string
  description: string
  emoji:       string
  config:      McTemplateConfig
  /** Built-in starters are code, not rows — they cannot be edited or deleted. */
  builtIn?:    boolean
  ownerId?:    string
  ownerName?:  string | null
  shared?:     boolean
  updatedAt?:  string
  useCount?:   number
}

export const EMPTY_TEMPLATE_FILTERS: McTemplateFilters = {
  adv: EMPTY_FILTERS, search: '', deepSearch: '', serviceType: '', country: '', cancelOnly: false, doneFilter: 'all',
}

export const DEFAULT_LAYOUT: McTemplateLayout = {
  orientation: 'landscape', paper: 'A4', density: 'comfortable', groupBy: 'none', pageBreakPerGroup: false,
  showStats: true, showFilters: true, showSignature: false, zebra: true, accent: 'amber',
}

export const DEFAULT_CONFIG: McTemplateConfig = {
  title: 'Movement Coordination Report', subtitle: '', notes: '',
  columns: DEFAULT_COLUMNS, dateMode: 'keep', filters: EMPTY_TEMPLATE_FILTERS, layout: DEFAULT_LAYOUT,
}

const starter = (
  id: string, emoji: string, name: string, description: string,
  c: { columns: McPdfColumnKey[]; dateMode?: McDateMode; adv?: Partial<AdvancedFilters>; layout?: Partial<McTemplateLayout>; title?: string; subtitle?: string },
): McReportTemplate => ({
  id: `builtin:${id}`, builtIn: true, emoji, name, description,
  config: {
    ...DEFAULT_CONFIG,
    title: c.title ?? name, subtitle: c.subtitle ?? '',
    columns: c.columns, dateMode: c.dateMode ?? 'keep',
    // Starters change *what kind* of movements print, never who or where — the
    // driver / agent / city on screen is kept when one is picked.
    filters: { ...EMPTY_TEMPLATE_FILTERS, adv: { ...EMPTY_FILTERS, cancelled: 'hide', ...c.adv } },
    layout: { ...DEFAULT_LAYOUT, ...c.layout },
  },
})

export const STARTER_TEMPLATES: McReportTemplate[] = [
  starter('duty', '🚐', 'Driver Duty Sheet', 'One page per driver — times, guests, pickups and a sign-off box. No rates, no money.', {
    columns: ['seq', 'date', 'time', 'tourRef', 'leadGuest', 'pax', 'from', 'to', 'details', 'flights', 'vehicle', 'tick'],
    layout: { groupBy: 'driver', pageBreakPerGroup: true, showSignature: true, accent: 'emerald', showStats: false },
    subtitle: 'Please confirm each movement with a tick',
  }),
  starter('arrivals', '🛬', 'Airport Arrivals Board', 'Everyone landing, with flight, meet time and who is meeting them.', {
    columns: ['time', 'flights', 'tourRef', 'leadGuest', 'pax', 'flow', 'to', 'driver', 'driverPhone', 'vehicle'],
    adv: { flow: 'arrivals' },
    layout: { groupBy: 'date', accent: 'sky' },
  }),
  starter('departures', '🛫', 'Departures Run Sheet', 'Airport drops in time order — hotel pickup to terminal.', {
    columns: ['time', 'flights', 'tourRef', 'leadGuest', 'pax', 'from', 'flow', 'driver', 'driverPhone', 'vehicle', 'tick'],
    adv: { flow: 'departures' },
    layout: { groupBy: 'date', accent: 'violet' },
  }),
  starter('chase', '🚨', 'Unallocated Chase List', 'Every movement still waiting for a driver or vendor.', {
    columns: ['date', 'time', 'tourRef', 'agent', 'leadGuest', 'pax', 'location', 'route', 'service', 'notes'],
    adv: { driver: ['needs'] },
    layout: { groupBy: 'date', accent: 'rose' },
  }),
  starter('agent', '🤝', 'Agent Movement Statement', 'Per-agent summary of their guests’ movements — ready to send.', {
    columns: ['date', 'time', 'tourRef', 'leadGuest', 'pax', 'route', 'service', 'meal', 'status'],
    layout: { groupBy: 'agent', pageBreakPerGroup: true, accent: 'slate' },
  }),
  starter('ops', '📋', 'Daily Ops Overview', 'The whole day by date with totals — the morning briefing printout.', {
    columns: ['seq', 'time', 'tourRef', 'leadGuest', 'agent', 'location', 'pax', 'route', 'details', 'service', 'driver', 'vehicle', 'specialReq'],
    layout: { groupBy: 'date', accent: 'amber', density: 'compact' },
  }),
]

/** Re-shape anything stored or posted into a complete, safe config. */
export function sanitizeConfig(raw: unknown): McTemplateConfig {
  const c = (raw && typeof raw === 'object' ? raw : {}) as Partial<McTemplateConfig>
  const f = (c.filters && typeof c.filters === 'object' ? c.filters : {}) as Partial<McTemplateFilters>
  const l = (c.layout && typeof c.layout === 'object' ? c.layout : {}) as Partial<McTemplateLayout>
  const text = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '')
  const pick = <T extends string>(v: unknown, allowed: readonly T[], fb: T): T => (allowed.includes(v as T) ? (v as T) : fb)
  const bool = (v: unknown, fb: boolean) => (typeof v === 'boolean' ? v : fb)
  const adv = (f.adv && typeof f.adv === 'object' ? { ...EMPTY_FILTERS, ...f.adv } : EMPTY_FILTERS) as AdvancedFilters
  return {
    title:    text(c.title, 120) || DEFAULT_CONFIG.title,
    subtitle: text(c.subtitle, 200),
    notes:    text(c.notes, 1000),
    columns:  sanitizeColumns(c.columns),
    dateMode: pick(c.dateMode, DATE_MODES.map(d => d.key), 'keep'),
    filters: {
      adv,
      search:      text(f.search, 100),
      deepSearch:  text(f.deepSearch, 100),
      serviceType: text(f.serviceType, 60),
      country:     text(f.country, 40),
      cancelOnly:  bool(f.cancelOnly, false),
      doneFilter:  pick(f.doneFilter, ['all', 'pending', 'done'] as const, 'all'),
    },
    layout: {
      orientation: pick(l.orientation, ['landscape', 'portrait'] as const, 'landscape'),
      paper:       pick(l.paper, ['A4', 'A3'] as const, 'A4'),
      density:     pick(l.density, ['comfortable', 'compact'] as const, 'comfortable'),
      groupBy:     pick(l.groupBy, GROUP_BY_OPTIONS.map(g => g.key), 'none'),
      pageBreakPerGroup: bool(l.pageBreakPerGroup, false),
      showStats:   bool(l.showStats, true),
      showFilters: bool(l.showFilters, true),
      showSignature: bool(l.showSignature, false),
      zebra:       bool(l.zebra, true),
      accent:      pick(l.accent, Object.keys(ACCENTS) as McAccent[], 'amber'),
    },
  }
}

// ─── Filter summary ──────────────────────────────────────────────────────────

/** Human chips for the filters behind a view — printed under the title. */
export function describeFilters(f: McTemplateFilters, serviceLabel?: (v: string) => string): string[] {
  const out: string[] = []
  const a = f.adv
  const label = <K extends string>(list: { key: K; label: string }[], keys: K[]) =>
    keys.map(k => list.find(x => x.key === k)?.label ?? k).join(', ')
  if (a.flow !== 'all') out.push(FLOW_OPTIONS.find(o => o.key === a.flow)?.label ?? a.flow)
  if (a.drivers.length)   out.push(`Driver / vendor: ${a.drivers.join(', ')}`)
  if (a.agents.length)    out.push(`Agent: ${a.agents.join(', ')}`)
  if (a.locations.length) out.push(`City: ${a.locations.join(', ')}`)
  if (a.airports.length)  out.push(`Airport: ${a.airports.map(c => `${c} ${airportName(c)}`).join(', ')}`)
  if (a.times.length)     out.push(`Time: ${label(TIME_BUCKETS, a.times)}`)
  if (a.driver.length)    out.push(label(DRIVER_STATES, a.driver))
  if (a.stages.length)    out.push(label(TRIP_STAGES, a.stages))
  if (a.flags.length)     out.push(label(FLAGS, a.flags))
  if (a.cancelled === 'hide') out.push('Cancelled files hidden')
  if (a.cancelled === 'only') out.push('Cancelled files only')
  if (f.search)      out.push(`Tour ref: “${f.search}”`)
  if (f.deepSearch)  out.push(`Search: “${f.deepSearch}”`)
  if (f.serviceType) out.push(`Service: ${serviceLabel ? serviceLabel(f.serviceType) : f.serviceType}`)
  if (f.country)     out.push(`Country: ${f.country.replace(/_/g, ' ')}`)
  if (f.cancelOnly)  out.push('Awaiting cancellation approval')
  if (f.doneFilter !== 'all') out.push(f.doneFilter === 'done' ? 'Done only' : 'Pending only')
  return out
}

// ─── HTML ────────────────────────────────────────────────────────────────────

export function esc(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

function fmtDate(iso: string, long = false): string {
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso)
  if (isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-GB', long
    ? { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' }
    : { day: '2-digit', month: 'short', year: 'numeric' })
}

function to12(t: string | null): string {
  if (!t || !/^\d{1,2}:\d{2}/.test(t)) return t ?? ''
  const [h, m] = t.split(':').map(Number)
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`
}

const dash = '<span class="mute">—</span>'
const or = (v: string | null | undefined) => (v && v.trim() ? esc(v) : dash)
const num = (n: number | null) => (n == null ? dash : n.toLocaleString('en-US', { maximumFractionDigits: 1 }))

function cell(key: McPdfColumnKey, r: McPdfRow, idx: number): string {
  switch (key) {
    case 'seq':       return `<span class="mute b">${idx + 1}</span>`
    case 'date':      return `<span class="b nw">${esc(fmtDate(r.date))}</span>`
    case 'time':      return r.time ? `<span class="time">${esc(to12(r.time))}</span>` : dash
    case 'tourRef':   return `<span class="ref${r.cancelled ? ' strike' : ''}">${esc(r.vnCode)}</span>`
      + (r.cancelled ? `<div class="tag tag-red">${r.cancelPending ? 'Cancelling' : 'Cancelled'}</div>` : '')
      + (r.isNumber && r.isNumber !== r.vnCode ? `<div class="sub blue">IS ${esc(r.isNumber)}</div>` : '')
      + (r.agentRef ? `<div class="sub violet">${esc(r.agentRef)}</div>` : '')
    case 'leadGuest': return r.leadGuest ? `<span class="b">${esc(r.leadGuest)}</span>` : dash
    case 'agent':     return or(r.agent)
    case 'location':  return or(r.location)
    case 'pax':       return `<span class="pax">${r.adults}</span>${r.children ? `<span class="paxc">+${r.children}C</span>` : ''}`
    case 'from':      return or(r.from)
    case 'to':        return or(r.to)
    case 'route':     return r.from || r.to ? `${or(r.from)} <span class="arrow">→</span> ${or(r.to)}` : dash
    case 'details':   return r.details ? `<span class="details">${esc(r.details)}</span>` : dash
    case 'service':   return `<span class="tag">${esc(r.service)}</span>`
      + (r.leisure ? '<div class="tag tag-amber">Leisure</div>' : '')
      + (r.hotelOnly ? '<div class="tag tag-pink">Hotel only</div>' : '')
    case 'flow': {
      if (!r.flow) return dash
      const t = r.flow === 'arrival' ? ['Arrival', 'tag-green'] : r.flow === 'departure' ? ['Departure', 'tag-blue'] : ['Arr + Dep', 'tag-violet']
      return `<span class="tag ${t[1]}">${t[0]}</span>${r.airport ? `<div class="sub">${esc(r.airport)}</div>` : ''}`
    }
    case 'flights':   return r.flights.length ? r.flights.map(f => `<div class="flt">${esc(f)}</div>`).join('') : dash
    case 'meal':      return r.mealPlan ? `<span class="tag">${esc(r.mealPlan)}</span>` : dash
    case 'mealPref':  return or(r.mealPrefs)
    case 'specialReq': return r.specialReq ? `<span class="req">${esc(r.specialReq)}</span>` : dash
    case 'driver':
      if (r.noDriver) return '<span class="sub amber b">No driver needed</span>'
      if (!r.vendor && !r.driver) return '<span class="tag tag-red">Unallocated</span>'
      return `${r.vendor ? `<span class="b">${esc(r.vendor)}</span>` : ''}${r.driver && r.driver !== r.vendor ? `<div class="sub">${esc(r.driver)}</div>` : ''}`
    case 'driverPhone': return r.driverPhone ? `<span class="nw">${esc(r.driverPhone)}</span>` : dash
    case 'vehicle':   return r.vehicle || r.plate
      ? `${r.vehicle ? esc(r.vehicle) : ''}${r.plate ? `<div class="plate">${esc(r.plate)}</div>` : ''}` : dash
    case 'guide':     return r.guide ? `${esc(r.guide)}${r.guidePhone ? `<div class="sub">${esc(r.guidePhone)}</div>` : ''}` : dash
    case 'tourVendor': return r.tourVendor ? `${esc(r.tourVendor)}${r.tourVendorPhone ? `<div class="sub">${esc(r.tourVendorPhone)}</div>` : ''}` : dash
    case 'ticketsControl': return or(r.ticketsControl)
    case 'status':    return `<span class="tag${r.cancelled ? ' tag-red' : ''}">${esc(r.status)}</span>${r.done ? '<div class="tag tag-green">Done</div>' : ''}`
    case 'budgetKm':  return num(r.budgetKm)
    case 'actualKm':  return num(r.actualKm)
    case 'packageCost': return num(r.packageCost)
    case 'budgetTransfer': return or(r.budgetTransfer)
    case 'tick':      return '<span class="box"></span>'
    case 'notes':     return ''
  }
}

function groupKey(r: McPdfRow, by: McGroupBy): string {
  switch (by) {
    case 'date':     return r.date.slice(0, 10)
    case 'driver':   return r.noDriver ? '~No driver needed' : (r.vendor || r.driver || r.tourVendor || '~Unallocated')
    case 'agent':    return r.agent || '~No agent'
    case 'location': return r.location || '~No location'
    case 'tourRef':  return r.vnCode
    case 'service':  return r.service
    default:         return ''
  }
}

function groupTitle(key: string, by: McGroupBy, rows: McPdfRow[]): string {
  if (by === 'date') return fmtDate(key, true)
  if (key.startsWith('~')) return key.slice(1)
  if (by === 'tourRef') {
    const r = rows[0]
    return `${key}${r?.leadGuest ? ` · ${r.leadGuest}` : ''}${r?.agent ? ` · ${r.agent}` : ''}`
  }
  if (by === 'driver') {
    const r = rows.find(x => x.driverPhone || x.vehicle)
    const extra = [r?.driverPhone, [r?.vehicle, r?.plate].filter(Boolean).join(' ')].filter(Boolean).join(' · ')
    return `${key}${extra ? ` <span class="gextra">${esc(extra)}</span>` : ''}`
  }
  return key
}

export interface McPdfMeta {
  dateFrom:    string
  dateTo:      string
  generatedBy: string | null
  generatedAt: Date
  filterChips: string[]
  /** Logo as a URL (preview) or a data: URI (server PDF). */
  logoSrc?:    string | null
  /** The preview adds a soft page frame; the PDF does not. */
  preview?:    boolean
  /** Browser-print fallback: open the print dialog once it has rendered. */
  autoPrint?:  boolean
}

export function buildMcReportHtml(rows: McPdfRow[], config: McTemplateConfig, meta: McPdfMeta): string {
  const { layout } = config
  const accent = ACCENTS[layout.accent] ?? ACCENTS.amber
  const cols = config.columns.map(k => COLUMN_BY_KEY.get(k)).filter((c): c is McPdfColumn => !!c)
  const totalWidth = cols.reduce((s, c) => s + c.width, 0) || 1
  const compact = layout.density === 'compact'

  const live = rows.filter(r => !r.cancelled)
  const adults = live.reduce((s, r) => s + r.adults, 0)
  const children = live.reduce((s, r) => s + r.children, 0)
  const files = new Set(live.map(r => r.vnCode)).size
  const arrivals = live.filter(r => r.flow === 'arrival' || r.flow === 'both').length
  const departures = live.filter(r => r.flow === 'departure' || r.flow === 'both').length
  const unallocated = live.filter(r => !r.noDriver && !r.vendor && !r.driver && !r.tourVendor).length
  const cancelled = rows.length - live.length

  // Groups keep the chart's own order: first appearance wins.
  const groups: { key: string; rows: McPdfRow[] }[] = []
  if (layout.groupBy === 'none') groups.push({ key: '', rows })
  else {
    const map = new Map<string, McPdfRow[]>()
    for (const r of rows) {
      const k = groupKey(r, layout.groupBy)
      const list = map.get(k)
      if (list) list.push(r); else map.set(k, [r])
    }
    const keys = Array.from(map.keys())
    if (layout.groupBy === 'date') keys.sort()
    else keys.sort((a, b) => (a.startsWith('~') ? 1 : 0) - (b.startsWith('~') ? 1 : 0) || a.localeCompare(b))
    for (const k of keys) groups.push({ key: k, rows: map.get(k)! })
  }

  const range = meta.dateFrom && meta.dateTo
    ? meta.dateFrom === meta.dateTo ? fmtDate(meta.dateFrom, true) : `${fmtDate(meta.dateFrom)} → ${fmtDate(meta.dateTo)}`
    : 'All dates'
  const stamp = meta.generatedAt.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })

  const colgroup = `<colgroup>${cols.map(c => `<col style="width:${((c.width / totalWidth) * 100).toFixed(2)}%">`).join('')}</colgroup>`
  const thead = `<thead><tr>${cols.map(c => `<th class="${c.align ?? 'left'}">${esc(c.label)}</th>`).join('')}</tr></thead>`

  let seq = 0
  const tables = groups.map((g, gi) => {
    const gLive = g.rows.filter(r => !r.cancelled)
    const gPax = gLive.reduce((s, r) => s + r.adults + r.children, 0)
    const body = g.rows.map(r => {
      const i = seq++
      return `<tr class="${r.cancelled ? 'cx' : ''}${r.done ? ' dn' : ''}">${cols.map(c =>
        `<td class="${c.align ?? 'left'}${c.key === 'notes' ? ' notes' : ''}">${cell(c.key, r, i)}</td>`).join('')}</tr>`
    }).join('')
    const head = layout.groupBy === 'none' ? '' : `
      <div class="ghead">
        <div class="gtitle">${groupTitle(g.key, layout.groupBy, g.rows)}</div>
        <div class="gmeta">${gLive.length} movement${gLive.length === 1 ? '' : 's'} · ${gPax} pax${g.rows.length > gLive.length ? ` · ${g.rows.length - gLive.length} cancelled` : ''}</div>
      </div>`
    const breakBefore = layout.pageBreakPerGroup && gi > 0 ? ' pb' : ''
    return `<section class="group${breakBefore}">${head}<table>${colgroup}${thead}<tbody>${body}</tbody></table>
      ${layout.showSignature && layout.pageBreakPerGroup ? signature() : ''}</section>`
  }).join('')

  function signature() {
    const who = layout.groupBy === 'driver' ? ['Prepared by', 'Driver acknowledgement', 'Date'] : ['Prepared by', 'Checked by', 'Approved by']
    return `<div class="sign">${who.map(w => `<div><div class="line"></div><span>${w}</span></div>`).join('')}</div>`
  }

  const stats = [
    ['Movements', String(live.length), cancelled ? `${cancelled} cancelled` : ''],
    ['Files', String(files), ''],
    ['Pax', String(adults + children), `${adults} A · ${children} C`],
    ['Arrivals', String(arrivals), ''],
    ['Departures', String(departures), ''],
    ['Unallocated', String(unallocated), unallocated ? 'needs a driver' : 'all covered'],
  ]

  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(config.title)}</title>
<style>
  @page { size: ${layout.paper} ${layout.orientation}; margin: 10mm 9mm 12mm; }
  * { box-sizing: border-box; }
  html, body { margin: 0; background: ${meta.preview ? '#e2e8f0' : '#fff'}; }
  body { font-family: 'Inter', 'Segoe UI', Arial, Helvetica, sans-serif; color: #0f172a; font-size: ${compact ? 8.5 : 9.5}px;
         -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .page { background: #fff; ${meta.preview ? 'margin: 14px auto; padding: 22px 24px; max-width: 1180px; box-shadow: 0 10px 30px rgba(15,23,42,.18); border-radius: 6px;' : ''} }
  .mast { display: flex; justify-content: space-between; align-items: stretch; gap: 16px; padding-bottom: 10px; border-bottom: 3px solid ${accent.main}; }
  .brand { display: flex; gap: 10px; align-items: center; }
  .brand img { width: 38px; height: 38px; object-fit: contain; }
  .brand .co { font-size: 9px; letter-spacing: .14em; text-transform: uppercase; color: ${accent.main}; font-weight: 800; }
  .brand h1 { margin: 1px 0 0; font-size: 18px; line-height: 1.15; font-weight: 800; color: ${accent.ink}; }
  .brand .subt { margin-top: 2px; color: #64748b; font-size: 10px; }
  .when { text-align: right; display: flex; flex-direction: column; justify-content: center; }
  .when .range { font-size: 12px; font-weight: 800; color: #0f172a; }
  .when .gen { font-size: 8.5px; color: #94a3b8; margin-top: 2px; }
  .chips { margin: 8px 0 0; display: flex; flex-wrap: wrap; gap: 4px; }
  .chip { background: ${accent.soft}; color: ${accent.ink}; border: 1px solid ${accent.main}33; border-radius: 999px; padding: 2px 8px; font-size: 8.5px; font-weight: 600; }
  .note { margin-top: 8px; padding: 7px 10px; border-left: 3px solid ${accent.main}; background: ${accent.soft}; color: ${accent.ink}; font-size: 9.5px; white-space: pre-wrap; border-radius: 0 4px 4px 0; }
  .stats { display: grid; grid-template-columns: repeat(6, 1fr); gap: 6px; margin: 10px 0 4px; }
  .stat { border: 1px solid #e2e8f0; border-radius: 6px; padding: 6px 8px; }
  .stat .v { font-size: 15px; font-weight: 800; color: ${accent.ink}; line-height: 1; }
  .stat .l { font-size: 7.5px; text-transform: uppercase; letter-spacing: .08em; color: #94a3b8; margin-top: 3px; font-weight: 700; }
  .stat .s { font-size: 7.5px; color: #64748b; margin-top: 1px; }
  .group { margin-top: 12px; }
  .group.pb { break-before: page; page-break-before: always; }
  .ghead { display: flex; justify-content: space-between; align-items: baseline; padding: 5px 9px; background: ${accent.main}; color: #fff; border-radius: 5px 5px 0 0; break-after: avoid; }
  .gtitle { font-size: 11px; font-weight: 800; }
  .gextra { font-weight: 500; opacity: .85; font-size: 9px; margin-left: 6px; }
  .gmeta { font-size: 8.5px; opacity: .9; font-weight: 600; }
  table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  thead { display: table-header-group; }
  th { background: #0f172a; color: #fff; font-size: ${compact ? 7.5 : 8}px; text-transform: uppercase; letter-spacing: .05em; padding: ${compact ? '4px 5px' : '5px 6px'}; font-weight: 700; border-right: 1px solid #334155; }
  td { padding: ${compact ? '3px 5px' : '5px 6px'}; border-bottom: 1px solid #e2e8f0; vertical-align: top; word-wrap: break-word; overflow-wrap: anywhere; }
  ${layout.zebra ? 'tbody tr:nth-child(even) td { background: #f8fafc; }' : ''}
  tr { break-inside: avoid; page-break-inside: avoid; }
  tr.cx td { background: #fff1f2 !important; color: #9f1239; }
  tr.dn td:first-child { box-shadow: inset 3px 0 0 #10b981; }
  .left { text-align: left; } .center { text-align: center; } .right { text-align: right; }
  .mute { color: #cbd5e1; } .b { font-weight: 700; } .nw { white-space: nowrap; }
  .sub { font-size: .88em; color: #64748b; margin-top: 1px; } .blue { color: #2563eb; } .violet { color: #7c3aed; } .amber { color: #b45309; }
  .ref { font-family: 'SF Mono', Menlo, Consolas, monospace; font-weight: 800; color: ${accent.ink}; }
  .strike { text-decoration: line-through; }
  .time { font-weight: 800; white-space: nowrap; color: ${accent.ink}; }
  .pax { font-weight: 800; color: #1d4ed8; } .paxc { color: #7c3aed; font-weight: 700; margin-left: 2px; }
  .arrow { color: ${accent.main}; font-weight: 800; }
  .details { color: #475569; } .req { color: #9a3412; }
  .tag { display: inline-block; padding: 1px 5px; border-radius: 3px; font-size: .86em; font-weight: 700; background: #f1f5f9; color: #475569; margin-top: 1px; }
  .tag-red { background: #ffe4e6; color: #9f1239; } .tag-green { background: #dcfce7; color: #166534; }
  .tag-blue { background: #dbeafe; color: #1e40af; } .tag-violet { background: #ede9fe; color: #5b21b6; }
  .tag-amber { background: #fef3c7; color: #b45309; } .tag-pink { background: #fce7f3; color: #be185d; }
  .flt { font-size: .92em; font-weight: 600; }
  .flt + .flt { margin-top: 2px; }
  .plate { font-family: Menlo, Consolas, monospace; font-weight: 700; color: #0f172a; font-size: .9em; }
  .box { display: inline-block; width: 11px; height: 11px; border: 1.4px solid #64748b; border-radius: 2px; }
  td.notes { border-bottom: 1px dotted #94a3b8; }
  .sign { display: grid; grid-template-columns: repeat(3, 1fr); gap: 28px; margin: 22px 4px 4px; break-inside: avoid; }
  .sign .line { border-bottom: 1px solid #0f172a; height: 26px; }
  .sign span { font-size: 8.5px; color: #64748b; text-transform: uppercase; letter-spacing: .08em; font-weight: 700; }
  .foot { margin-top: 14px; padding-top: 6px; border-top: 1px solid #e2e8f0; display: flex; justify-content: space-between; color: #94a3b8; font-size: 8px; }
  .empty { padding: 50px 0; text-align: center; color: #94a3b8; font-size: 12px; }
  @media print { html, body { background: #fff; } .page { margin: 0; padding: 0; box-shadow: none; max-width: none; } }
</style></head><body><div class="page">
  <header class="mast">
    <div class="brand">
      ${meta.logoSrc ? `<img src="${esc(meta.logoSrc)}" alt="">` : ''}
      <div>
        <div class="co">Apple Holidays MMT</div>
        <h1>${esc(config.title)}</h1>
        ${config.subtitle ? `<div class="subt">${esc(config.subtitle)}</div>` : ''}
      </div>
    </div>
    <div class="when">
      <div class="range">${esc(range)}</div>
      <div class="gen">${rows.length} movement${rows.length === 1 ? '' : 's'} · Generated ${esc(stamp)}${meta.generatedBy ? ` by ${esc(meta.generatedBy)}` : ''}</div>
    </div>
  </header>
  ${layout.showFilters && meta.filterChips.length ? `<div class="chips">${meta.filterChips.map(c => `<span class="chip">${esc(c)}</span>`).join('')}</div>` : ''}
  ${config.notes.trim() ? `<div class="note">${esc(config.notes.trim())}</div>` : ''}
  ${layout.showStats && rows.length ? `<div class="stats">${stats.map(([l, v, s]) => `<div class="stat"><div class="v">${esc(v)}</div><div class="l">${esc(l)}</div>${s ? `<div class="s">${esc(s)}</div>` : ''}</div>`).join('')}</div>` : ''}
  ${rows.length === 0 ? '<div class="empty">No movements match this view.</div>' : tables}
  ${layout.showSignature && !layout.pageBreakPerGroup && rows.length ? signature() : ''}
  <div class="foot"><span>Apple Holidays MMT · ${esc(config.title)} · Confidential</span><span>${esc(stamp)}</span></div>
</div>${meta.autoPrint ? '<script>window.addEventListener("load",function(){setTimeout(function(){window.print()},350)})</script>' : ''}</body></html>`
}

export function pdfFileName(config: McTemplateConfig, dateFrom: string, dateTo: string): string {
  const slug = config.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'mc-report'
  return `${slug}-${dateFrom || 'all'}${dateTo && dateTo !== dateFrom ? `_to_${dateTo}` : ''}.pdf`
}
