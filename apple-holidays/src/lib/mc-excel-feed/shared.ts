/**
 * MC Excel Feed — OPS → Excel movement chart, shared definitions.
 *
 * Every movement (agenda line) of every booking arriving on or after a start
 * date (1 Dec 2026 by default) is written into one SharePoint / OneDrive
 * workbook, one row per movement, ordered by arrival date, and kept up to date
 * as bookings are created and charts change.
 *
 * Two kinds of column, and the whole design rests on keeping them apart:
 *
 *   OPS columns  — filled from the booking and its agenda. OPS owns them and
 *                  rewrites them whenever OPS changes (edit them in OPS).
 *   Desk columns — Meeting Time, Vendor, Type of Car, QC… typed by the desk.
 *                  OPS NEVER writes a single cell in them, not even a blank.
 *
 * A row is tied to its movement by "Agenda Line ID". A chart save recreates
 * agenda lines under new ids, so the save records old → new pairs
 * (`carryMcExcelFeed`) and the sync also re-attaches rows by content — the
 * desk's typing stays on the row of the movement it was typed for.
 *
 * Client-safe: no Prisma, no Graph.
 */

/**
 *   ops  — OPS writes, the desk reads (edit in OPS).
 *   desk — the desk types, OPS never writes.
 *   both — Meeting Time and Driver Details: whichever side changed since the
 *          last sync wins; a change on both sides is a conflict a person settles.
 */
export type ColumnSource = 'ops' | 'desk' | 'both'
export type ListKey = 'channel' | 'serviceType' | 'mealPlan' | 'location' | 'car' | 'qc' | 'tickets' | 'mealPref'

export interface FeedColumn {
  key: string
  header: string
  source: ColumnSource
  /** Normalised header spellings that map to this column (header text, not position). */
  aliases: string[]
  width: number
  kind?: 'date' | 'int' | 'text' | 'id' | 'formula' | 'time'
  list?: ListKey
  hint: string
}

/** The two-way columns, and the FeedRow fields they compare. */
export const TWO_WAY_KEYS = ['meetingTime', 'driver'] as const
export type TwoWayKey = (typeof TWO_WAY_KEYS)[number]

/** Normalise a header for matching: lower case, letters and digits only. */
export const normHeader = (v: unknown): string => String(v ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '')

export const FEED_COLUMNS: FeedColumn[] = [
  { key: 'band',        header: '#',                    source: 'ops',  width: 5,  kind: 'formula', aliases: ['#', 'bkg', 'bkgno', 'bookingnumber'], hint: 'Booking number on this sheet — a formula that drives the two booking colours. Do not type here' },
  { key: 'arrival',    header: 'Booking Arrival Date', source: 'ops',  width: 14, kind: 'date', aliases: ['bookingarrivaldate', 'arrivaldate', 'arrival', 'bookingarrival'], hint: 'Booking arrival date — rows are ordered by it' },
  { key: 'channel',     header: 'B2B / B2C',            source: 'ops',  width: 9,  list: 'channel', aliases: ['b2bb2c', 'b2borb2c', 'channel', 'b2bc'], hint: 'B2C = Aahaas storefront order, B2B = agent booking' },
  { key: 'ref',         header: 'VN Number',            source: 'ops',  width: 12, aliases: ['vnnumber', 'vnno', 'isnumber', 'bookingref', 'tourref', 'bookingno', 'refno'], hint: 'IS / tour reference' },
  { key: 'cntl',        header: 'CNTL Number',          source: 'ops',  width: 13, aliases: ['cntlnumber', 'cntlno', 'cntl'], hint: 'AppleSystem control number' },
  { key: 'lineId',      header: 'Agenda Line ID',       source: 'ops',  width: 12, kind: 'id', aliases: ['agendalineid', 'lineid', 'agendaid', 'agendaitemid', 'movementid'], hint: 'Ties the row to its OPS movement — do not edit or clear' },
  { key: 'date',        header: 'Movement Date',        source: 'ops',  width: 14, kind: 'date', aliases: ['movementdate', 'date', 'servicedate', 'day'], hint: 'Date of this movement' },
  { key: 'guest',       header: 'Name of Guests',       source: 'ops',  width: 22, aliases: ['nameofguests', 'nameofguest', 'guestname', 'guestnames', 'guests', 'leadguest'], hint: 'Lead guest' },
  { key: 'guestContact',header: 'Guest Contact',        source: 'ops',  width: 17, aliases: ['guestcontact', 'guestcontactnumber', 'guestphone', 'contact', 'contactnumber', 'guestmobile'], hint: 'Lead guest phone (else the booking contact number)' },
  { key: 'adults',      header: 'Adult Count',          source: 'ops',  width: 8,  kind: 'int', aliases: ['adultcount', 'adults', 'adult', 'adt'], hint: 'Adults on the booking' },
  { key: 'children',    header: 'Child Count',          source: 'ops',  width: 8,  aliases: ['childcount', 'child', 'children', 'chd'], hint: 'Children (infants shown as "+ n Infant")' },
  { key: 'location',    header: 'Location',             source: 'ops',  width: 14, list: 'location', aliases: ['location', 'city'], hint: 'Agenda Location' },
  { key: 'from',        header: 'From',                 source: 'ops',  width: 22, aliases: ['from', 'pickup', 'pickupfrom'], hint: 'Agenda From' },
  { key: 'to',          header: 'To/Tours',             source: 'ops',  width: 34, aliases: ['totours', 'to', 'tours', 'toactivity', 'totour'], hint: 'Agenda To / Activity' },
  { key: 'description', header: 'Tour Description',     source: 'ops',  width: 48, aliases: ['tourdescription', 'description', 'details', 'tourdetails'], hint: 'Agenda Details / Timings' },
  { key: 'meal',        header: 'Meal Plan',            source: 'ops',  width: 14, list: 'mealPlan', aliases: ['mealplan', 'meal', 'meals'], hint: 'Agenda Meal Plan' },
  { key: 'meetingTime', header: 'Meeting Time',         source: 'both', width: 11, kind: 'time', aliases: ['meetingtime', 'pickuptime'], hint: 'Both ways — from the agenda; a change typed here goes back to the agenda' },
  { key: 'serviceType', header: 'Service Type',         source: 'ops',  width: 20, list: 'serviceType', aliases: ['servicetype', 'service'], hint: 'Agenda Service Type' },
  { key: 'vendor',      header: 'Vendor',               source: 'desk', width: 18, aliases: ['vendor', 'vendors', 'supplier'], hint: 'Desk column — OPS never writes here' },
  { key: 'driver',      header: 'Driver Details',       source: 'both', width: 26, aliases: ['driverdetails', 'driver', 'drivers', 'driverinfo', 'drivername', 'drivercontact'], hint: 'Both ways — "Name · phone" from the agenda; a driver typed here goes back to the agenda' },
  { key: 'agentId',     header: 'Agent - ID',           source: 'ops',  width: 18, aliases: ['agentid'], hint: 'Agency id (AppleSystem)' },
  { key: 'agentName',   header: 'Agent - Name',         source: 'ops',  width: 18, aliases: ['agentname', 'agent', 'touroperator'], hint: 'Agent / tour operator' },
  { key: 'car',         header: 'Type of Car',          source: 'desk', width: 12, list: 'car', aliases: ['typeofcar', 'cartype', 'vehicle', 'vehicletype'], hint: 'Desk column — OPS never writes here' },
  { key: 'textMessage', header: 'Text Message',         source: 'desk', width: 14, aliases: ['textmessage', 'message', 'sms'], hint: 'Desk column — OPS never writes here' },
  { key: 'localContact',header: 'Local Contact',        source: 'desk', width: 16, aliases: ['localcontact'], hint: 'Desk column — OPS never writes here' },
  { key: 'qc',          header: 'QC Checked',           source: 'desk', width: 10, list: 'qc', aliases: ['qcchecked', 'qc', 'qccheck'], hint: 'Desk column — OPS never writes here' },
  { key: 'tickets',     header: 'TICKETS',              source: 'desk', width: 12, list: 'tickets', aliases: ['tickets', 'ticket'], hint: 'Desk column — OPS never writes here' },
  { key: 'mealPref',    header: 'Meal Preference',      source: 'desk', width: 14, list: 'mealPref', aliases: ['mealpreference', 'mealpref'], hint: 'Desk column — OPS never writes here' },
  { key: 'specialNote', header: 'SPECIAL NOTE',         source: 'desk', width: 20, aliases: ['specialnote', 'specialnotes'], hint: 'Desk column — OPS never writes here' },
  { key: 'note',        header: 'Note',                 source: 'desk', width: 20, aliases: ['note', 'notes'], hint: 'Desk column — OPS never writes here' },
  { key: 'issues',      header: 'Issues',               source: 'desk', width: 18, aliases: ['issues', 'issue'], hint: 'Desk column — OPS never writes here' },
  { key: 'issuesResp',  header: 'Issues Responsible',   source: 'desk', width: 16, aliases: ['issuesresponsible', 'issueresponsible', 'responsible'], hint: 'Desk column — OPS never writes here' },
  { key: 'dinner',      header: 'Dinner',               source: 'desk', width: 12, aliases: ['dinner'], hint: 'Desk column — OPS never writes here' },
  { key: 'total',       header: 'Total',                source: 'desk', width: 10, aliases: ['total'], hint: 'Desk column — OPS never writes here' },
  { key: 'xe',          header: 'XE',                   source: 'desk', width: 10, aliases: ['xe'], hint: 'Desk column — OPS never writes here' },
  { key: 'guide',       header: 'Guide',                source: 'desk', width: 14, aliases: ['guide', 'guides'], hint: 'Desk column — OPS never writes here' },
  { key: 'status',      header: 'OPS Status',           source: 'ops',  width: 18, aliases: ['opsstatus', 'opssync', 'syncstatus'], hint: 'Active / Leisure day / Removed in OPS / Cancelled — rows are never deleted' },
]

export const OPS_KEYS = FEED_COLUMNS.filter(c => c.source === 'ops').map(c => c.key)
export const COLUMN_BY_KEY = new Map(FEED_COLUMNS.map(c => [c.key, c]))

/** Columns a sync cannot run without: without them rows cannot be tied to movements. */
export const REQUIRED_KEYS = ['lineId', 'ref', 'date'] as const

/** The cell values OPS owns for one movement. Dates are yyyy-mm-dd here. */
export interface FeedRow {
  lineId: string
  bookingRef: string
  arrival: string
  channel: 'B2B' | 'B2C'
  ref: string
  cntl: string
  date: string
  guest: string
  guestContact: string
  /** The agenda's stored meeting time ("07:30", or free text like "on arrival"). */
  meetingTime: string
  /** The movement's driver as stored on its assignment. */
  driverName: string
  driverPhone: string
  /** Why a driver typed in Excel may not be written to this movement (null = it may). */
  driverLock: string | null
  adults: number
  children: number | string
  location: string
  from: string
  to: string
  description: string
  meal: string
  serviceType: string
  agentId: string
  agentName: string
  status: string
  /** A cancelled booking: existing rows get the status, no new rows are added. */
  noInsert: boolean
  sortOrder: number
}

export type FeedCellValue = string | number

export const STATUS = {
  active: 'Active',
  leisure: 'Leisure day',
  hotelOnly: 'Hotel only',
  removed: 'Removed in OPS',
  cancelled: 'Booking cancelled',
  cancelRequested: 'Cancellation requested',
} as const

/** Statuses that grey the row out. */
export const INACTIVE_STATUSES: string[] = [STATUS.removed, STATUS.cancelled]

// ── Settings ─────────────────────────────────────────────────────────────────

export const FEED_SETTINGS = {
  config: 'mc_xl_feed_config',
  state: 'mc_xl_feed_state',
  runs: 'mc_xl_feed_runs',
  lock: 'mc_xl_feed_lock',
  sheetRef: 'mc_xl_feed_sheet_ref',
  /** Per booking: the line ids on (or deliberately deleted from) the sheet. */
  rowsPrefix: 'mc_xl_feed_rows:',
  /** Per booking: agenda line ids carried by chart saves, sheet id → current id. */
  aliasPrefix: 'mc_xl_feed_alias:',
  /** Booking colours OPS painted on a workbook without the OPS layout. */
  paint: 'mc_xl_feed_paint',
} as const

/** Workbook names the OPS layout defines: its presence means the sheet colours itself. */
export const LAYOUT_NAME = 'OPS_FEED_LAYOUT'
/** The banner cell the sync stamps with "last synced …". */
export const STAMP_NAME = 'OPS_FEED_STAMP'

/**
 * Booking colours: every booking's rows share one soft fill, and neighbouring
 * bookings alternate between the two (odd bookings take `a`, even take `b`).
 * Soft enough to read black text on and print, strong enough to see a booking
 * end on any screen. The admin picks the pair in Settings.
 */
export type BandPair = 'grey-sky' | 'grey-mint' | 'grey-peach' | 'grey-white'
export const BAND_PAIRS: Record<BandPair, { label: string; a: string; b: string }> = {
  'grey-sky': { label: 'Soft grey + sky', a: '#E7EAEE', b: '#DBEAFB' },
  'grey-mint': { label: 'Soft grey + mint', a: '#E7EAEE', b: '#DCF2E5' },
  'grey-peach': { label: 'Soft grey + peach', a: '#E7EAEE', b: '#FCE8D8' },
  'grey-white': { label: 'Soft grey + white', a: '#E7EAEE', b: '#FFFFFF' },
}
export const DEFAULT_BAND_PAIR: BandPair = 'grey-sky'
export const bandPairOf = (v: unknown): BandPair => (typeof v === 'string' && v in BAND_PAIRS ? v as BandPair : DEFAULT_BAND_PAIR)

/** Header colours (and the default booking colours) — one palette for the layout and for OPS painting. */
export const PALETTE = {
  bandA: BAND_PAIRS[DEFAULT_BAND_PAIR].a,
  bandB: BAND_PAIRS[DEFAULT_BAND_PAIR].b,
  ops: '#0F766E',       // teal — OPS writes
  desk: '#FEF3C7',      // amber — desk types
  deskText: '#92400E',
  both: '#6D28D9',      // violet — both ways
  banner: '#0F172A',
} as const

export const DEFAULT_FEED_URL =
  'https://aahaas-my.sharepoint.com/:x:/p/sasindu/IQA-0icZdwz8QI67NC707tEXAVX3Fh9Wk8LJnEI516QQDOU?e=I8OmbZ'

export type FeedCountry = 'VIETNAM' | 'SRILANKA' | 'SINGAPORE_MALAYSIA'

export interface FeedConfig {
  sheetUrl: string
  tabName: string
  /** yyyy-mm-dd — bookings arriving on or after this date are in the feed. */
  startDate: string
  countries: FeedCountry[]
  /** Automatic sync. Ships OFF: nothing is written until an admin switches it on. */
  enabled: boolean
  intervalMin: number
  /** sorted: new rows are inserted at their arrival-date position; append: added at the bottom. */
  placement: 'sorted' | 'append'
  /** Grey out rows whose movement was removed / booking cancelled. */
  greyInactive: boolean
  /**
   * Excel → OPS for Meeting Time and Driver Details. Writes to the live agenda,
   * so it has its own switch and ships OFF; while off, Excel edits are shown in
   * the preview as "waiting" and left in the sheet untouched.
   */
  writeBack: boolean
  /** Two booking colours painted by OPS on a workbook without the OPS layout (the layout colours itself). */
  bandColors: boolean
  /** Which two soft colours the bookings alternate between. */
  bandPair: BandPair
}

export const DEFAULT_FEED_CONFIG: FeedConfig = {
  sheetUrl: DEFAULT_FEED_URL,
  tabName: 'Movements',
  startDate: '2026-12-01',
  countries: ['VIETNAM'],
  enabled: false,
  intervalMin: 10,
  placement: 'sorted',
  greyInactive: true,
  writeBack: false,
  bandColors: true,
  bandPair: DEFAULT_BAND_PAIR,
}

export const FEED_COUNTRIES: { value: FeedCountry; label: string }[] = [
  { value: 'VIETNAM', label: 'Vietnam' },
  { value: 'SRILANKA', label: 'Sri Lanka' },
  { value: 'SINGAPORE_MALAYSIA', label: 'Singapore / Malaysia' },
]

// ── Runs ─────────────────────────────────────────────────────────────────────

export interface FeedCounts {
  feedRows: number
  sheetRows: number
  added: number
  updatedRows: number
  updatedCells: number
  rekeyed: number
  markedInactive: number
  deletedInExcel: number
  duplicates: number
  unchanged: number
  /** Excel → OPS changes (Meeting Time / Driver Details) planned or applied. */
  toOps: number
  /** Excel edits not applied: write-back switched off, or a row that takes no driver. */
  toOpsWaiting: number
  /** Changed on both sides since the last sync — left alone until settled. */
  conflicts: number
}

export interface FeedRun {
  id: string
  at: string
  finishedAt: string | null
  trigger: 'CRON' | 'MANUAL' | 'PREVIEW'
  by: string | null
  status: 'SUCCESS' | 'NO_CHANGE' | 'FAILED' | 'SKIPPED'
  counts: FeedCounts | null
  error: string | null
  warnings: string[]
  durationMs: number | null
}

export const EMPTY_COUNTS: FeedCounts = {
  feedRows: 0, sheetRows: 0, added: 0, updatedRows: 0, updatedCells: 0, rekeyed: 0,
  markedInactive: 0, deletedInExcel: 0, duplicates: 0, unchanged: 0, toOps: 0, toOpsWaiting: 0, conflicts: 0,
}

/** What the preview shows for one planned change. */
export interface PlanSample {
  kind: 'add' | 'update' | 'inactive' | 'rekey' | 'deleted' | 'toOps' | 'conflict'
  row: number | null
  bookingRef: string
  date: string
  label: string
  changes?: { column: string; from: string; to: string }[]
  /** toOps / conflict: which cell, and the two sides' compare keys (used to settle a conflict). */
  field?: TwoWayKey
  sheetLineId?: string
  opsKey?: string
  xlKey?: string
  /** toOps that will not be applied, and why. */
  waiting?: string
}

// ── Two-way values ───────────────────────────────────────────────────────────

const pad2 = (n: number) => String(n).padStart(2, '0')

/** A time as the agenda stores it ("HH:MM"), from an Excel time, "7.30 pm", "0730"… else the text itself. */
export function timeKey(v: unknown): string {
  if (v === null || v === undefined || v === '') return ''
  if (typeof v === 'number' && Number.isFinite(v) && v >= 0) {
    // "0730" typed into a General cell arrives as the number 730.
    if (v >= 1 && Number.isInteger(v) && v <= 2359 && v % 100 < 60) return `${pad2(Math.floor(v / 100))}:${pad2(v % 100)}`
    const mins = Math.round((v % 1) * 1440) % 1440
    return `${pad2(Math.floor(mins / 60))}:${pad2(mins % 60)}`
  }
  const s = String(v).trim().replace(/^'/, '')
  if (!s) return ''
  const m = /^(\d{1,2})(?:\s*[:.hH]\s*(\d{2}))?\s*([ap])\.?\s*m?\.?$/i.exec(s)
    ?? /^(\d{1,2})\s*[:.hH]\s*(\d{2})$/.exec(s)
    ?? /^(\d{2})(\d{2})$/.exec(s)
  if (m) {
    let h = Number(m[1])
    const min = Number(m[2] ?? 0)
    const ap = (m[3] ?? '').toLowerCase()
    if (ap === 'p' && h < 12) h += 12
    if (ap === 'a' && h === 12) h = 0
    if (h < 24 && min < 60) return `${pad2(h)}:${pad2(min)}`
  }
  return s.toLowerCase().replace(/\s+/g, ' ')
}

/** "HH:MM" → the Excel time value (a day fraction); anything else is written as text. */
export function timeCell(stored: string): { value: FeedCellValue; format: string } {
  const k = timeKey(stored)
  const m = /^(\d{2}):(\d{2})$/.exec(k)
  if (m) return { value: (Number(m[1]) * 60 + Number(m[2])) / 1440, format: 'h:mm AM/PM' }
  return { value: excelText(stored.trim()), format: 'General' }
}

/** Phone numbers inside free text: runs of 8+ digits, spaces / dashes / dots / brackets allowed, optional +. */
const PHONE_RE = /\+?\(?\d[\d\s().-]{6,}\d/g

export function splitDriverText(text: string): { name: string; phone: string } {
  const s = String(text ?? '').replace(/^'/, '').replace(/\r?\n/g, ' ').trim()
  const phones = (s.match(PHONE_RE) ?? []).filter(p => p.replace(/\D/g, '').length >= 8)
  const phone = phones[0]?.trim() ?? ''
  let name = s
  for (const p of phones) name = name.replace(p, ' ')
  name = name.replace(/\b(tel|ph|phone|mob|mobile|hp|sdt|zalo|whatsapp|wa)\b\.?:?/gi, ' ')
    .replace(/[·|,;/:()[\]-]+/g, ' ').replace(/\s+/g, ' ').trim()
  return { name, phone }
}

const last9 = (phone: string) => phone.replace(/\D/g, '').slice(-9)

/** Compare form of a driver: name (letters/digits, lower case) + the phone's last 9 digits (so +84 / 0 prefixes match). */
export function driverKey(name: string, phone: string): string {
  const n = String(name ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim()
  const p = last9(phone ?? '')
  return n || p ? `${n}|${p}` : ''
}

export function driverText(name: string, phone: string): string {
  return [name.trim(), phone.trim()].filter(Boolean).join(' · ')
}

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return 'never'
  const ms = Date.now() - Date.parse(iso)
  if (!Number.isFinite(ms)) return '—'
  if (ms < 60_000) return 'just now'
  const m = Math.round(ms / 60_000)
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 48) return `${h} h ago`
  return `${Math.round(h / 24)} days ago`
}

// ── Excel cell helpers ───────────────────────────────────────────────────────

const EXCEL_EPOCH = Date.UTC(1899, 11, 30)

/** yyyy-mm-dd → Excel date serial. */
export function toSerial(ymd: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd)
  if (!m) return null
  return Math.round((Date.UTC(+m[1], +m[2] - 1, +m[3]) - EXCEL_EPOCH) / 86_400_000)
}

/** A sheet date cell (serial, or typed text) → yyyy-mm-dd, or null. */
export function cellToYmd(v: unknown): string | null {
  if (typeof v === 'number' && v > 20000 && v < 80000) {
    const d = new Date(EXCEL_EPOCH + Math.round(v) * 86_400_000)
    return d.toISOString().slice(0, 10)
  }
  const s = String(v ?? '').trim()
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s)
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/.exec(s)
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
  const months: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 }
  m = /^(\d{1,2})[\s-]+([a-z]{3})[a-z]*[\s,-]+(\d{4})/i.exec(s)
  if (m && months[m[2].toLowerCase()]) return `${m[3]}-${String(months[m[2].toLowerCase()]).padStart(2, '0')}-${m[1].padStart(2, '0')}`
  return null
}

/** Excel's per-cell limit is 32,767 characters. */
const MAX_CELL = 32_000

/**
 * A text value as it must be sent to Excel: a leading = + - @ would be read as
 * a formula ("- Pick up at 8" → #NAME?), so it is written as literal text.
 */
export function excelText(s: string): string {
  const t = s.length > MAX_CELL ? `${s.slice(0, MAX_CELL)}…` : s
  return /^[=+\-@]/.test(t) ? `'${t}` : t
}

/** Compare form of a cell: what Excel shows, line endings and spacing evened out. */
export function cellKey(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(Math.round(v * 1e6) / 1e6)
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE'
  return String(v).replace(/\r\n?/g, '\n').replace(/^'/, '').replace(/[ \t]+$/gm, '').trim()
}

/** Column index (0-based) → letters. */
export function colLetter(index: number): string {
  let n = index + 1
  let s = ''
  while (n > 0) {
    const r = (n - 1) % 26
    s = String.fromCharCode(65 + r) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}
