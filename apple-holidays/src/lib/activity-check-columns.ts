/**
 * The column catalogue for Activity Check exports.
 *
 * One definition list, used three times: the screen's column picker renders
 * from it, the Excel writer reads values through it, and the printed report
 * picks its columns from it. That is what makes "customise the export" a real
 * feature rather than three lists that drift — adding a column here adds it to
 * the picker, the sheet and the PDF at once.
 *
 * The chosen set travels in the query string as `cols=a,b,c`, *in the user's
 * order*, so re-ordering columns in the picker re-orders them in the file.
 */

import { SERVICE_TYPE_LABELS } from '@/lib/service-types'
import type { ActivityRow } from '@/lib/activity-check'

export type ColumnKey =
  | 'date' | 'weekday' | 'dayNo' | 'daysAway'
  | 'bookingRef' | 'isNumber' | 'cntlNumber' | 'agentBookingId' | 'status' | 'country'
  | 'agent' | 'fileHandler'
  | 'guestName' | 'guestPhone' | 'guestEmail' | 'guestWhatsapp'
  | 'paxAdults' | 'paxChildren' | 'paxInfants' | 'totalPax'
  | 'arrivalDate' | 'departureDate'
  | 'source' | 'activity' | 'location' | 'fromPoint' | 'toPoint'
  | 'serviceType' | 'meetingTime' | 'timeFrom' | 'timeTo' | 'mealPlan'
  | 'details' | 'counterpart' | 'flags'
  | 'driverName' | 'driverPhone' | 'vehicle' | 'vendorName'
  | 'guideName' | 'guidePhone' | 'tourVendorName' | 'tourVendorPhone' | 'assigned'
  | 'matchedTerms' | 'matchedFields' | 'snippet' | 'bookingUrl'

export type ColumnGroup = 'When' | 'Booking' | 'Guest' | 'Activity' | 'Ground' | 'Match'

export type ColumnDef = {
  key:   ColumnKey
  label: string
  group: ColumnGroup
  /** Excel column width, in characters. */
  width: number
  /** Long free text — wrapped in the sheet, truncated in the printed report. */
  wide?: boolean
  value: (row: ActivityRow) => string | number
}

const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : ''

/** "in 3 days" / "TODAY" / "5 days ago" — the column a roster is scanned by. */
export function whenLabel(days: number): string {
  if (days === 0) return 'TODAY'
  if (days === 1) return 'Tomorrow'
  if (days === -1) return 'Yesterday'
  return days > 0 ? `in ${days} days` : `${Math.abs(days)} days ago`
}

/** The operational flags worth carrying into a sheet, as one short cell. */
function flagsOf(row: ActivityRow): string {
  const flags: string[] = []
  if (row.cancelled) flags.push('CANCELLED')
  if (row.hotelOnly) flags.push('Hotel only file')
  if (row.isLeisure) flags.push('Leisure day')
  if (row.isHotelOnly) flags.push('Own transport')
  if (row.source === 'AGENDA' && !row.assigned && !row.isLeisure && !row.isHotelOnly) {
    flags.push('No driver')
  }
  return flags.join(', ')
}

const or = (v: string | null | undefined) => (v ?? '').trim()

export const COLUMNS: ColumnDef[] = [
  // When
  { key: 'date',       label: 'Activity date', group: 'When', width: 14, value: r => fmtDate(r.date) },
  { key: 'weekday',    label: 'Day',           group: 'When', width: 11, value: r => r.weekday },
  { key: 'dayNo',      label: 'Tour day',      group: 'When', width: 9,  value: r => (r.dayNo ? `D${r.dayNo}` : '') },
  { key: 'daysAway',   label: 'When',          group: 'When', width: 13, value: r => whenLabel(r.daysAway) },

  // Booking
  { key: 'bookingRef',     label: 'Booking ref',   group: 'Booking', width: 13, value: r => r.bookingRef },
  { key: 'isNumber',       label: 'IS number',     group: 'Booking', width: 13, value: r => or(r.isNumber) },
  { key: 'cntlNumber',     label: 'CNTL number',   group: 'Booking', width: 13, value: r => or(r.cntlNumber) },
  { key: 'agentBookingId', label: 'Agent ref',     group: 'Booking', width: 15, value: r => or(r.agentBookingId) },
  { key: 'status',         label: 'Status',        group: 'Booking', width: 13, value: r => r.status },
  { key: 'country',        label: 'Country',       group: 'Booking', width: 12, value: r => or(r.operationCountry) },
  { key: 'agent',          label: 'Agent',         group: 'Booking', width: 20, value: r => or(r.agent) },
  { key: 'fileHandler',    label: 'File handler',  group: 'Booking', width: 18, value: r => or(r.fileHandler) },
  { key: 'arrivalDate',    label: 'Arrival',       group: 'Booking', width: 14, value: r => fmtDate(r.arrivalDate) },
  { key: 'departureDate',  label: 'Departure',     group: 'Booking', width: 14, value: r => fmtDate(r.departureDate) },

  // Guest
  { key: 'guestName',     label: 'Lead guest',   group: 'Guest', width: 24, value: r => or(r.guestName) },
  { key: 'guestPhone',    label: 'Guest phone',  group: 'Guest', width: 16, value: r => or(r.guestPhone) },
  { key: 'guestWhatsapp', label: 'Guest WA',     group: 'Guest', width: 16, value: r => or(r.guestWhatsapp) },
  { key: 'guestEmail',    label: 'Guest email',  group: 'Guest', width: 26, value: r => or(r.guestEmail) },
  { key: 'paxAdults',     label: 'Adults',       group: 'Guest', width: 8,  value: r => r.paxAdults },
  { key: 'paxChildren',   label: 'Children',     group: 'Guest', width: 9,  value: r => r.paxChildren },
  { key: 'paxInfants',    label: 'Infants',      group: 'Guest', width: 8,  value: r => r.paxInfants },
  { key: 'totalPax',      label: 'Total pax',    group: 'Guest', width: 10, value: r => r.totalPax },

  // Activity
  { key: 'source',      label: 'Source',        group: 'Activity', width: 11, value: r => (r.source === 'AGENDA' ? 'Agenda' : 'Itinerary') },
  { key: 'activity',    label: 'Activity',      group: 'Activity', width: 46, wide: true, value: r => r.activity },
  { key: 'location',    label: 'Location',      group: 'Activity', width: 16, value: r => or(r.location) },
  { key: 'fromPoint',   label: 'From',          group: 'Activity', width: 22, value: r => or(r.fromPoint) },
  { key: 'toPoint',     label: 'To',            group: 'Activity', width: 30, value: r => or(r.toPoint) },
  { key: 'serviceType', label: 'Service type',  group: 'Activity', width: 22,
    value: r => (r.serviceType ? SERVICE_TYPE_LABELS[r.serviceType] ?? r.serviceType : '') },
  { key: 'meetingTime', label: 'Meeting time',  group: 'Activity', width: 13, value: r => or(r.meetingTime) },
  { key: 'timeFrom',    label: 'Time from',     group: 'Activity', width: 11, value: r => or(r.timeFrom) },
  { key: 'timeTo',      label: 'Time to',       group: 'Activity', width: 11, value: r => or(r.timeTo) },
  { key: 'mealPlan',    label: 'Meal plan',     group: 'Activity', width: 13, value: r => or(r.mealPlan) },
  { key: 'details',     label: 'Details',       group: 'Activity', width: 70, wide: true, value: r => or(r.details) },
  { key: 'counterpart', label: 'Matching itinerary / agenda', group: 'Activity', width: 60, wide: true,
    value: r => {
      if (!r.counterpart) return ''
      const c = r.counterpart
      const head = c.source === 'ITINERARY' ? `Itinerary${c.dayNo ? ` D${c.dayNo}` : ''}` : 'Agenda'
      return [`[${head}] ${c.activity}`, or(c.details)].filter(Boolean).join('\n')
    } },
  { key: 'flags',       label: 'Flags',         group: 'Activity', width: 20, value: flagsOf },

  // Ground
  { key: 'driverName',      label: 'Driver',        group: 'Ground', width: 20, value: r => or(r.driverName) },
  { key: 'driverPhone',     label: 'Driver phone',  group: 'Ground', width: 16, value: r => or(r.driverPhone) },
  { key: 'vehicle',         label: 'Vehicle',       group: 'Ground', width: 20,
    value: r => [or(r.vehicleType), or(r.vehiclePlate)].filter(Boolean).join(' · ') },
  { key: 'vendorName',      label: 'Transport vendor', group: 'Ground', width: 20, value: r => or(r.vendorName) },
  { key: 'guideName',       label: 'Guide',         group: 'Ground', width: 20, value: r => or(r.guideName) },
  { key: 'guidePhone',      label: 'Guide phone',   group: 'Ground', width: 16, value: r => or(r.guidePhone) },
  { key: 'tourVendorName',  label: 'Tour vendor',   group: 'Ground', width: 20, value: r => or(r.tourVendorName) },
  { key: 'tourVendorPhone', label: 'Tour vendor phone', group: 'Ground', width: 18, value: r => or(r.tourVendorPhone) },
  { key: 'assigned',        label: 'Assigned?',     group: 'Ground', width: 11,
    value: r => (r.source !== 'AGENDA' ? '' : r.assigned ? 'Yes' : 'No') },

  // Match
  { key: 'matchedTerms',  label: 'Matched keyword(s)', group: 'Match', width: 24, value: r => r.matchedTerms.join(', ') },
  { key: 'matchedFields', label: 'Matched in',         group: 'Match', width: 20, value: r => r.matchedFields.join(', ') },
  { key: 'snippet',       label: 'Match context',      group: 'Match', width: 60, wide: true, value: r => r.snippet },
  { key: 'bookingUrl',    label: 'Booking link',       group: 'Match', width: 44,
    value: r => `${process.env.NEXTAUTH_URL ?? ''}/dashboard/bookings/${r.bookingRef}` },
]

export const COLUMN_BY_KEY: Record<string, ColumnDef> = Object.fromEntries(COLUMNS.map(c => [c.key, c]))

export const COLUMN_GROUPS: ColumnGroup[] = ['When', 'Booking', 'Guest', 'Activity', 'Ground', 'Match']

/**
 * What you get if you never touch the picker: enough to act on a row without
 * opening the booking, and narrow enough to print.
 */
export const DEFAULT_COLUMNS: ColumnKey[] = [
  'date', 'weekday', 'dayNo', 'bookingRef', 'isNumber', 'agent', 'guestName', 'totalPax',
  'source', 'activity', 'location', 'serviceType', 'meetingTime',
  'driverName', 'tourVendorName', 'matchedTerms',
]

/** Every column — the "give me everything" button in the picker. */
export const ALL_COLUMN_KEYS: ColumnKey[] = COLUMNS.map(c => c.key)

/**
 * Named starting points for the picker. Each desk asks the same question of
 * this screen from a different angle, and a preset is faster than 40 checkboxes.
 */
export const COLUMN_PRESETS: { id: string; label: string; hint: string; columns: ColumnKey[] }[] = [
  {
    id: 'standard', label: 'Standard', hint: 'The default operational set',
    columns: DEFAULT_COLUMNS,
  },
  {
    id: 'ops', label: 'Ground ops', hint: 'Who is driving, guiding and supplying each movement',
    columns: ['date', 'weekday', 'bookingRef', 'activity', 'location', 'serviceType', 'meetingTime',
      'timeFrom', 'timeTo', 'totalPax', 'driverName', 'driverPhone', 'vehicle', 'vendorName',
      'guideName', 'tourVendorName', 'assigned', 'flags'],
  },
  {
    id: 'sales', label: 'Sales & agents', hint: 'Volume by agent and file, with guest contacts',
    columns: ['date', 'bookingRef', 'isNumber', 'agentBookingId', 'agent', 'fileHandler', 'status',
      'guestName', 'guestPhone', 'guestEmail', 'paxAdults', 'paxChildren', 'paxInfants', 'totalPax',
      'activity', 'matchedTerms'],
  },
  {
    id: 'content', label: 'Full detail', hint: 'Descriptions and the matching itinerary text',
    columns: ['date', 'dayNo', 'bookingRef', 'source', 'activity', 'location', 'fromPoint', 'toPoint',
      'serviceType', 'details', 'counterpart', 'matchedTerms', 'matchedFields', 'snippet'],
  },
  {
    id: 'everything', label: 'Everything', hint: 'All available columns',
    columns: ALL_COLUMN_KEYS,
  },
]

/**
 * Reads `cols=` off a query string.
 *
 * Unknown keys are dropped rather than rejected — a bookmarked URL from before
 * a column was renamed should still produce a sheet — and an empty result
 * falls back to the default set so a download is never a zero-column file.
 */
export function parseColumns(raw: string | null): ColumnKey[] {
  const wanted = (raw ?? '').split(',').map(s => s.trim()).filter(Boolean)
  const seen = new Set<string>()
  const picked = wanted.filter(k => {
    if (!COLUMN_BY_KEY[k] || seen.has(k)) return false
    seen.add(k)
    return true
  }) as ColumnKey[]
  return picked.length ? picked : DEFAULT_COLUMNS
}

export function resolveColumns(keys: ColumnKey[]): ColumnDef[] {
  return keys.map(k => COLUMN_BY_KEY[k]).filter(Boolean)
}
