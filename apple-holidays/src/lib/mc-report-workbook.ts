/**
 * The MC Report's Excel export — built in the browser from the rows on screen.
 *
 * Replaces the two flat SheetJS tabs ("Movements" + a key/value "Summary") with
 * the house workbook (`@/lib/excel-kit`): an Overview dashboard, the full
 * movement chart, and the cuts the desk otherwise builds by hand — who still
 * needs a driver, the airport runs, each driver's and guide's load, a location
 * × date heatmap, stays, requests and cancellations.
 *
 * The page flattens its rows into `McSheetRow` first (it owns the service-type,
 * flow and allocation rules); this file only lays them out. Driver rates are
 * deliberately not part of the row — the chart is passed around, and rates are
 * internal.
 */
import {
  P, SERIES, Canvas, SheetPlan, newWorkbook, downloadWorkbook, shortDay, groupBy, dateRange,
  type Col, type Measure,
} from '@/lib/excel-kit'

export interface McSheetRow {
  date: string
  ref: string
  isNumber: string
  agentBookingId: string
  country: string
  location: string
  adults: number
  children: number
  from: string
  to: string
  details: string
  mealPlan: string
  meetingTime: string
  /** "HH:MM" the movement works to — flight time first, then the meeting time. */
  time: string
  service: string
  /** Private / SIC / Own arrangement / Accommodation / Other. */
  serviceGroup: string
  leisure: boolean
  hotelOnly: boolean
  hotelOnlyBooking: boolean
  nights: number | null
  checkOut: string
  vendor: string
  driver: string
  vehicle: string
  plate: string
  guide: string
  guidePhone: string
  tourVendor: string
  tourVendorPhone: string
  leadGuest: string
  agent: string
  status: string
  cancelled: boolean
  cancelPending: boolean
  cancelRequestedAt: string | null
  cancelRequestedBy: string
  waitingDays: number | null
  cancelReason: string
  cancelFee: number | null
  currency: string
  allocation: 'Allocated' | 'Needs allocation' | 'N/A'
  /** "Arrival", "Departure", "Arrival + departure" or "". */
  flow: string
  airport: string
  flight: string
  tripStage: string
  done: boolean
  doneBy: string
  ticketsControl: string
  arrFlights: string
  depFlights: string
  budgetKm: number | null
  actualKm: number | null
  kmVariance: number | null
  packageCost: number | null
  budgetTransfer: number | null
  transferCurrency: string
  specialRequest: string
  bookingRequests: string
  mealPrefs: string
}

export interface McExportOptions {
  rows: McSheetRow[]
  dateFrom: string
  dateTo: string
  /** Plain words for any search / filters behind `rows`. */
  filterLabel: string
}

const pax = (r: McSheetRow) => r.adults + r.children
const sumPax = (rs: McSheetRow[]) => rs.reduce((s, r) => s + pax(r), 0)
const files = (rs: McSheetRow[]) => new Set(rs.map(r => r.ref)).size

const tint = (r: McSheetRow): string | null =>
  r.cancelled ? P.cancelled : r.cancelPending ? P.pendingWash : r.done ? P.okWash : r.hotelOnlyBooking ? P.hotelWash : r.leisure ? P.zebra : null

/** The full movement chart, as the CSV carried it — typed and coloured. */
function movementCols(): Col<McSheetRow>[] {
  return [
    { header: 'Date', width: 12, kind: 'date', value: r => r.date },
    { header: 'Tour ref', width: 13, value: r => r.ref },
    { header: 'Time', width: 7, value: r => r.time },
    { header: 'Service', width: 14, value: r => r.service },
    { header: 'Allocation', width: 13, kind: 'flag', value: r => (r.cancelled ? '' : r.allocation === 'N/A' ? 'N/A' : r.allocation) },
    { header: 'Flow', width: 12, value: r => r.flow },
    { header: 'Lead guest', width: 22, value: r => r.leadGuest },
    { header: 'Adults', width: 7, kind: 'int', value: r => r.adults, total: 'sum' },
    { header: 'Children', width: 8, kind: 'int', value: r => r.children, total: 'sum' },
    { header: 'Location', width: 16, value: r => r.location },
    { header: 'From', width: 22, wrap: true, value: r => r.from },
    { header: 'To', width: 22, wrap: true, value: r => r.to },
    { header: 'Details', width: 40, wrap: true, value: r => r.details },
    { header: 'Meeting time', width: 9, value: r => r.meetingTime },
    { header: 'Meal plan', width: 10, value: r => r.mealPlan },
    { header: 'Vendor', width: 18, value: r => r.vendor },
    { header: 'Driver', width: 18, value: r => r.driver },
    { header: 'Vehicle', width: 13, value: r => r.vehicle },
    { header: 'Plate', width: 11, value: r => r.plate },
    { header: 'Guide', width: 18, value: r => r.guide },
    { header: 'Guide phone', width: 14, value: r => r.guidePhone },
    { header: 'Tour vendor', width: 18, value: r => r.tourVendor },
    { header: 'Tour vendor phone', width: 14, value: r => r.tourVendorPhone },
    { header: 'Agent', width: 18, value: r => r.agent },
    { header: 'IS number', width: 12, value: r => r.isNumber },
    { header: 'Agent booking ID', width: 14, value: r => r.agentBookingId },
    { header: 'Country', width: 12, value: r => r.country },
    { header: 'Booking status', width: 16, value: r => r.status },
    { header: 'Cancel approval', width: 15, kind: 'flag', value: r => (r.cancelPending ? 'Awaiting approval' : r.cancelled ? 'Cancelled' : '') },
    { header: 'Trip stage', width: 10, value: r => r.tripStage },
    { header: 'Leisure', width: 8, kind: 'yes', value: r => (r.leisure ? 'Yes' : '') },
    { header: 'Hotel only', width: 8, kind: 'yes', value: r => (r.hotelOnly ? 'Yes' : '') },
    { header: 'Hotel Only booking', width: 9, kind: 'yes', value: r => (r.hotelOnlyBooking ? 'Yes' : '') },
    { header: 'Nights', width: 7, kind: 'int', value: r => r.nights },
    { header: 'Check out', width: 12, kind: 'date', value: r => r.checkOut || null },
    { header: 'Done', width: 7, kind: 'yes', value: r => (r.done ? 'Yes' : '') },
    { header: 'Done by', width: 14, value: r => r.doneBy },
    { header: 'Tickets control', width: 24, wrap: true, value: r => r.ticketsControl },
    { header: 'Arrival flight', width: 30, wrap: true, value: r => r.arrFlights },
    { header: 'Departure flight', width: 30, wrap: true, value: r => r.depFlights },
    { header: 'Budget KM', width: 10, kind: 'num', value: r => r.budgetKm, total: 'sum' },
    { header: 'Actual KM', width: 10, kind: 'num', value: r => r.actualKm, total: 'sum' },
    { header: 'KM variance', width: 10, kind: 'num', value: r => r.kmVariance, total: 'sum', tone: r => (r.kmVariance == null || r.kmVariance === 0 ? null : r.kmVariance > 0 ? 'bad' : 'good') },
    { header: 'Package cost (LKR)', width: 13, kind: 'money', value: r => r.packageCost, total: 'sum' },
    { header: 'Budget transfer', width: 12, kind: 'money', value: r => r.budgetTransfer },
    { header: 'Transfer currency', width: 9, value: r => r.transferCurrency },
    { header: 'Special request (movement)', width: 30, wrap: true, value: r => r.specialRequest },
    { header: 'Special requests (booking)', width: 34, wrap: true, value: r => r.bookingRequests },
    { header: 'Meal preference', width: 26, wrap: true, value: r => r.mealPrefs },
  ]
}

/** Pick named columns from the full set, in the order given. */
function pick(headers: string[]): Col<McSheetRow>[] {
  const all = movementCols()
  return headers.map(h => all.find(c => c.header === h)!).filter(Boolean)
}

function loadMeasures(): Measure<McSheetRow>[] {
  return [
    { header: 'Movements', value: rs => rs.length, bar: P.brand },
    { header: 'Guests moved', value: rs => sumPax(rs) },
    { header: 'Files', value: rs => files(rs) },
    { header: 'Days worked', value: rs => new Set(rs.map(r => r.date)).size },
    { header: 'Airport runs', value: rs => rs.filter(r => r.flow).length },
    { header: 'Private', value: rs => rs.filter(r => r.serviceGroup === 'Private').length },
    { header: 'SIC', value: rs => rs.filter(r => r.serviceGroup === 'SIC').length },
  ]
}

export function buildMcWorkbook({ rows, dateFrom, dateTo, filterLabel }: McExportOptions) {
  const label = dateFrom || dateTo ? `${dateFrom ? shortDay(dateFrom) : '…'} → ${dateTo ? shortDay(dateTo) : '…'}` : 'All dates'
  const wb = newWorkbook(`MC Report — ${label}`)
  const gen = `Exported ${new Date().toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}`
  const plan = new SheetPlan()

  const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date) || (a.time || '99').localeCompare(b.time || '99') || a.ref.localeCompare(b.ref))
  const live = sorted.filter(r => !r.cancelled)
  const needs = live.filter(r => r.allocation === 'Needs allocation')
  const allocated = live.filter(r => r.allocation === 'Allocated')
  const runs = live.filter(r => r.flow)
  const stays = live.filter(r => r.hotelOnlyBooking)
  const cancels = sorted.filter(r => r.cancelled || r.cancelPending)
  const requests = live.filter(r => r.specialRequest || r.bookingRequests || r.mealPrefs)
  const dates = Array.from(new Set(sorted.map(r => r.date))).sort()
  const span = dates.length ? dateRange(dates[0], dates[dates.length - 1], 120) : []
  const moving = live.filter(r => !r.hotelOnlyBooking)

  plan.table({
    name: 'All Movements', tab: P.brand,
    title: `MC chart — every movement · ${label}`,
    description: 'Every movement the report showed, in date and time order. Cancelled files are greyed and struck through but kept, so nobody turns up for them; cancellation-pending rows are orange; rows the desk ticked Done are green; Hotel Only stays are amber.',
    totals: `${live.length} live movements · ${sumPax(live)} guest-movements · ${files(live)} files · ${needs.length} need allocation · ${cancels.length} cancelled / pending`,
    what: 'Every movement with service, allocation, partners, flights, KM, requests and cancellation detail',
    cols: movementCols(), rows: sorted, rowTint: tint, strike: r => r.cancelled && !r.cancelPending, freezeCols: 2,
  })
  plan.table({
    name: 'Needs Allocation', tab: P.red,
    title: `Needs allocation — ${label}`,
    description: 'Live movements with no driver, transport vendor or tour vendor on them. Leisure days, hotel-only movements and Hotel Only stays need nobody and are left out. Earliest first.',
    totals: `${needs.length} movements · ${sumPax(needs)} guests · ${files(needs)} files · ${new Set(needs.map(r => r.date)).size} days`,
    what: 'Live movements still without a driver, vendor or tour vendor',
    cols: pick(['Date', 'Tour ref', 'Time', 'Service', 'Flow', 'Lead guest', 'Adults', 'Children', 'Location', 'From', 'To', 'Details', 'Agent', 'Country', 'Cancel approval']),
    rows: needs, freezeCols: 2,
    rowTint: r => (r.cancelPending ? P.pendingWash : null),
    empty: 'Every live movement in this export has someone on it.',
  })
  plan.table({
    name: 'Airport Runs', tab: P.blue,
    title: `Airport runs — arrivals & departures · ${label}`,
    description: 'Movements that meet or drop a flight, by date and the time the driver works to (flight time first, then the meeting time).',
    totals: `${runs.filter(r => r.flow.startsWith('Arrival')).length} arrivals · ${runs.filter(r => r.flow.endsWith('eparture')).length} departures · ${sumPax(runs)} guests`,
    what: 'Arrival and departure transfers with flight, airport, time and driver',
    cols: [
      ...pick(['Date', 'Tour ref', 'Time', 'Flow']),
      { header: 'Flight', width: 12, value: r => r.flight },
      { header: 'Airport', width: 9, value: r => r.airport },
      ...pick(['Lead guest', 'Adults', 'Children', 'Allocation', 'Driver', 'Vehicle', 'Plate', 'Vendor', 'From', 'To', 'Location', 'Agent']),
    ],
    rows: runs, freezeCols: 2,
    rowTint: r => (r.allocation === 'Needs allocation' ? 'FFFFF1F2' : null),
    empty: 'No airport runs in this export.',
  })

  type Day = { d: string; rs: McSheetRow[]; cancelled: number }
  const days: Day[] = span.map(d => ({ d, rs: live.filter(r => r.date === d), cancelled: sorted.filter(r => r.date === d && r.cancelled).length }))
  plan.table<Day>({
    name: 'Day by Day', tab: P.indigo,
    title: `Day by day — ${label}`,
    description: 'One row per date: how much moved, how it splits, and what is still unallocated. Bars are drawn to scale inside the cells.',
    what: 'Movements, guests, private / SIC, airport runs and unallocated work per day',
    cols: [
      { header: 'Date', width: 13, kind: 'date', value: x => x.d },
      { header: 'Day', width: 7, value: x => shortDay(x.d).slice(0, 3) },
      { header: 'Movements', width: 11, kind: 'int', value: x => x.rs.length, total: 'sum', bar: P.brand },
      { header: 'Guests moved', width: 11, kind: 'int', value: x => sumPax(x.rs), total: 'sum', bar: P.b2c },
      { header: 'Files', width: 8, kind: 'int', value: x => files(x.rs) },
      { header: 'Private', width: 9, kind: 'int', value: x => x.rs.filter(r => r.serviceGroup === 'Private').length, total: 'sum' },
      { header: 'SIC', width: 8, kind: 'int', value: x => x.rs.filter(r => r.serviceGroup === 'SIC').length, total: 'sum' },
      { header: 'Arrivals', width: 9, kind: 'int', value: x => x.rs.filter(r => r.flow.startsWith('Arrival')).length, total: 'sum', bar: P.green },
      { header: 'Departures', width: 10, kind: 'int', value: x => x.rs.filter(r => r.flow.endsWith('eparture')).length, total: 'sum', bar: P.blue },
      { header: 'Leisure', width: 8, kind: 'int', value: x => x.rs.filter(r => r.leisure).length, total: 'sum' },
      { header: 'Hotel stays', width: 9, kind: 'int', value: x => x.rs.filter(r => r.hotelOnlyBooking).length, total: 'sum' },
      { header: 'Needs allocation', width: 11, kind: 'int', value: x => x.rs.filter(r => r.allocation === 'Needs allocation').length, total: 'sum', tone: x => (x.rs.some(r => r.allocation === 'Needs allocation') ? 'bad' : null) },
      { header: 'Done', width: 7, kind: 'int', value: x => x.rs.filter(r => r.done).length, total: 'sum' },
      { header: 'Cancelled', width: 9, kind: 'int', value: x => x.cancelled, total: 'sum' },
    ],
    rows: days,
    rowTint: x => (x.rs.length ? null : P.zebra),
  })

  if (span.length > 1 && span.length <= 62) {
    const byLoc = groupBy(moving, r => r.location || '—')
    plan.matrix({
      name: 'Location Heatmap', tab: P.green,
      title: `Location × date — movements · ${label}`,
      description: 'Each cell is the number of live movements at that location on that date. Darker is busier — the days a region needs more drivers on standby.',
      what: 'Location × date heatmap of live movements',
      rowHeader: 'Location',
      rows: Array.from(byLoc.keys()).sort((a, b) => byLoc.get(b)!.length - byLoc.get(a)!.length || a.localeCompare(b)),
      cols: span.map(d => ({ key: d, label: shortDay(d) })),
      value: (loc, d) => (byLoc.get(loc) ?? []).filter(r => r.date === d).length,
      color: P.green, colWidth: 11,
    })
  }

  if (allocated.length) {
    plan.breakdown({
      name: 'Drivers & Vendors', tab: P.indigo,
      title: `Driver & vendor load — ${label}`,
      description: 'Allocated live movements grouped by who is running them — the driver when there is one, else the transport vendor, else the tour vendor. Rates are not part of this file.',
      what: 'Each driver / vendor: movements, guests, files, days worked, airport runs',
      rows: allocated, keyHeader: 'Driver / vendor', keyWidth: 30,
      key: r => r.driver || r.vendor || r.tourVendor || '—',
      measures: loadMeasures(),
      notes: [
        { header: 'Vehicles', width: 22, value: rs => Array.from(new Set(rs.map(r => [r.vehicle, r.plate].filter(Boolean).join(' ')).filter(Boolean))).join(', ') },
        { header: 'Dates', width: 30, value: rs => { const d = Array.from(new Set(rs.map(r => r.date))).sort(); return d.length ? `${shortDay(d[0])} → ${shortDay(d[d.length - 1])}` : '' } },
      ],
    })
  }
  const guided = live.filter(r => r.guide)
  if (guided.length) {
    plan.breakdown({
      name: 'Guides', tab: P.b2c,
      title: `Guide load — ${label}`,
      description: 'Live movements with a guide on them, grouped by guide.',
      what: 'Each guide: movements, guests, files and days worked',
      rows: guided, keyHeader: 'Guide', key: r => r.guide, measures: loadMeasures(),
      notes: [{ header: 'Phone', width: 16, value: rs => rs[0]?.guidePhone ?? '' }],
    })
  }
  plan.breakdown({
    name: 'Service Types', tab: P.amber,
    title: `Service mix — ${label}`,
    description: 'Live movements grouped by service type, with how much of each is still unallocated.',
    what: 'Live movements by service type with guests and unallocated count',
    rows: live, keyHeader: 'Service', key: r => r.service,
    measures: [
      { header: 'Movements', value: rs => rs.length, bar: P.amber },
      { header: 'Guests moved', value: rs => sumPax(rs) },
      { header: 'Files', value: rs => files(rs) },
      { header: 'Needs allocation', value: rs => rs.filter(r => r.allocation === 'Needs allocation').length, bar: P.red },
      { header: 'Allocated %', kind: 'pct', total: false, traffic: true, value: rs => { const s = rs.filter(r => r.allocation !== 'N/A'); return s.length ? s.filter(r => r.allocation === 'Allocated').length / s.length : null } },
    ],
  })
  plan.breakdown({
    name: 'Locations', tab: P.green,
    title: `Locations — ${label}`,
    description: 'Live movements grouped by location.',
    what: 'Live movements by location',
    rows: moving, keyHeader: 'Location', key: r => r.location || '—', measures: loadMeasures(),
  })
  plan.breakdown({
    name: 'Agents', tab: P.b2b,
    title: `Agents — ${label}`,
    description: 'Live movements grouped by the agent on the file.',
    what: 'Live movements by agent',
    rows: live, keyHeader: 'Agent', keyWidth: 32, key: r => r.agent || 'No agent', measures: loadMeasures(),
  })
  if (stays.length) {
    plan.table({
      name: 'Hotel Stays', tab: P.amber,
      title: `Hotel Only stays — ${label}`,
      description: 'Accommodation-only files. These are nights in a room, not movements — nobody needs to be allocated.',
      totals: `${stays.length} stays · ${sumPax(stays)} guests · ${stays.reduce((s, r) => s + (r.nights ?? 0), 0)} nights`,
      what: 'Accommodation-only stays with nights and check-out',
      cols: pick(['Date', 'Tour ref', 'Lead guest', 'Adults', 'Children', 'Location', 'Details', 'Nights', 'Check out', 'Meal plan', 'Agent', 'Country']),
      rows: stays,
    })
  }
  if (requests.length) {
    plan.table({
      name: 'Requests & Meals', tab: P.pink,
      title: `Special requests & meal preferences — ${label}`,
      description: 'Every live movement that carries a special request (its own, or the booking’s) or a passenger meal preference — the details a driver or guide should know before pickup.',
      totals: `${requests.length} movements · ${files(requests)} files`,
      what: 'Movements carrying special requests or meal preferences',
      cols: pick(['Date', 'Tour ref', 'Time', 'Service', 'Lead guest', 'Adults', 'Children', 'Location', 'Driver', 'Guide', 'Special request (movement)', 'Special requests (booking)', 'Meal preference']),
      rows: requests, freezeCols: 2,
    })
  }
  plan.table({
    name: 'Cancellations', tab: P.red,
    title: `Cancelled & awaiting approval — ${label}`,
    description: 'Movements on cancelled files, and on files whose cancellation is waiting on accounts. A pending one is still scheduled — and anyone allocated to it is about to be stood down. Waiting 3+ days is in red.',
    totals: `${cancels.filter(r => r.cancelled && !r.cancelPending).length} cancelled · ${cancels.filter(r => r.cancelPending).length} awaiting · ${files(cancels)} files`,
    what: 'Movements on cancelled files and on cancellations awaiting accounts',
    cols: [
      ...pick(['Date', 'Tour ref', 'Cancel approval', 'Service', 'Lead guest', 'Adults', 'Children', 'Location', 'Driver', 'Vendor', 'Agent']),
      { header: 'Requested', width: 16, kind: 'stamp', value: r => r.cancelRequestedAt },
      { header: 'Requested by', width: 16, value: r => r.cancelRequestedBy },
      { header: 'Waiting (days)', width: 9, kind: 'int', value: r => (r.cancelPending ? r.waitingDays : null), tone: r => (r.cancelPending && (r.waitingDays ?? 0) >= 3 ? 'bad' : null) },
      { header: 'Reason', width: 34, wrap: true, value: r => r.cancelReason },
      { header: 'Fee', width: 11, kind: 'money', value: r => r.cancelFee },
      { header: 'Currency', width: 9, value: r => r.currency },
    ],
    rows: cancels,
    rowTint: r => (r.cancelPending ? P.pendingWash : P.cancelled),
    empty: 'No cancelled movements in this export.',
  })
  const km = live.filter(r => r.budgetKm != null || r.actualKm != null || r.packageCost != null)
  if (km.length) {
    plan.table({
      name: 'Sri Lanka KM', tab: P.orange,
      title: `Sri Lanka — KM & package cost · ${label}`,
      description: 'Movements with desk figures typed on them. Variance is actual − budget: red is over budget, green under.',
      totals: `${km.length} movements · budget ${km.reduce((s, r) => s + (r.budgetKm ?? 0), 0).toLocaleString('en-US')} km · actual ${km.reduce((s, r) => s + (r.actualKm ?? 0), 0).toLocaleString('en-US')} km`,
      what: 'Sri Lanka budget vs actual KM, variance and package cost',
      cols: pick(['Date', 'Tour ref', 'Lead guest', 'Service', 'Driver', 'Vehicle', 'Plate', 'From', 'To', 'Budget KM', 'Actual KM', 'KM variance', 'Package cost (LKR)', 'Arrival flight', 'Departure flight']),
      rows: km, freezeCols: 2,
    })
  }
  const tr = live.filter(r => r.budgetTransfer != null)
  if (tr.length) {
    plan.table({
      name: 'SG-MY Transfers', tab: P.b2c,
      title: `Singapore / Malaysia — budget transfers · ${label}`,
      description: 'Movements with a budget transfer typed on them. Currencies are never added together — filter by currency before totalling.',
      what: 'Singapore / Malaysia budget transfers by movement, currency kept apart',
      cols: pick(['Date', 'Tour ref', 'Lead guest', 'Service', 'Driver', 'Vendor', 'From', 'To', 'Budget transfer', 'Transfer currency']),
      rows: tr,
    })
  }

  // ── Overview
  const c = new Canvas(wb, 'Overview', { tab: P.deep })
  c.banner('AppleHolidays Operations · MC Report', `Movement Chart — ${label}`,
    `${gen}${filterLabel ? `   ·   Filters: ${filterLabel}` : ''}   ·   ${sorted.length} rows exported`)
  const arrivals = runs.filter(r => r.flow.startsWith('Arrival')).length
  const departures = runs.filter(r => r.flow.endsWith('eparture')).length
  c.tiles([
    { label: 'Live movements', value: live.length, note: `${files(live)} files · ${dates.length} days`, color: P.brand },
    { label: 'Guests moved', value: sumPax(live), note: `${live.reduce((s, r) => s + r.adults, 0)} adults · ${live.reduce((s, r) => s + r.children, 0)} children`, color: P.b2c },
    { label: 'Needs allocation', value: needs.length, note: needs.length ? `first on ${shortDay(needs[0].date)}` : 'all covered', color: P.red },
    { label: 'Airport runs', value: runs.length, note: `${arrivals} in · ${departures} out`, color: P.blue },
    { label: 'Done', value: live.filter(r => r.done).length, note: 'ticked off by the desk', color: P.green },
    { label: 'Cancelled', value: cancels.length, note: `${cancels.filter(r => r.cancelPending).length} awaiting accounts`, color: P.amber },
  ])

  c.title('Focus')
  c.callout(needs.length ? 'critical' : 'good', `${needs.length} without anyone on them`, needs.length
    ? `Earliest: ${needs.slice(0, 10).map(r => `${r.ref} ${shortDay(r.date)}${r.time ? ` ${r.time}` : ''}`).join(' · ')} — see Needs Allocation.`
    : 'Every live movement has a driver, vendor or tour vendor.')
  const pend = cancels.filter(r => r.cancelPending && r.allocation === 'Allocated')
  if (pend.length) c.callout('warning', `${pend.length} allocated on dying files`, `Someone is allocated against a file whose cancellation is waiting on accounts: ${Array.from(new Set(pend.map(r => r.ref))).slice(0, 10).join(', ')}.`)
  if (requests.length) c.callout('watch', `${requests.length} with requests / meals`, 'Movements carrying a special request or a meal preference — see Requests & Meals.')
  c.gap()

  c.title('Service mix', 'Live movements by service, with what is still unallocated.')
  c.header(['Service', 'Movements', 'Guests', 'Needs allocation', 'Share'], [undefined, P.brand, P.b2c, P.red, P.indigo])
  const sv = Array.from(groupBy(live, r => r.service)).sort((a, b) => b[1].length - a[1].length)
  let f = c.r
  for (const [k, rs] of sv) c.line([k, rs.length, sumPax(rs), rs.filter(r => r.allocation === 'Needs allocation').length, live.length ? rs.length / live.length : null], { alarmCols: [4], kinds: [undefined, undefined, undefined, undefined, 'pct'] })
  c.bars(2, f, c.r - 1, SERIES[0])
  c.gap()

  if (days.length) {
    c.title('Day by day', 'Live movements each day, with the unallocated count. Full detail on the Day by Day tab.')
    c.header(['Day', 'Movements', 'Guests', 'Arrivals', 'Departures', 'Needs allocation'], [undefined, P.brand, P.b2c, P.green, P.blue, P.red])
    f = c.r
    for (const x of days.slice(0, 31)) {
      c.line([shortDay(x.d), x.rs.length, sumPax(x.rs), x.rs.filter(r => r.flow.startsWith('Arrival')).length, x.rs.filter(r => r.flow.endsWith('eparture')).length, x.rs.filter(r => r.allocation === 'Needs allocation').length], { alarmCols: [6] })
    }
    c.bars(2, f, c.r - 1, P.brand)
    if (days.length > 31) c.note(`…and ${days.length - 31} more days on the Day by Day tab.`)
    c.gap()
  }

  c.index(plan.index())
  plan.write(wb, gen)
  return wb
}

export async function downloadMcWorkbook(opts: McExportOptions, filename: string) {
  await downloadWorkbook(buildMcWorkbook(opts), filename)
}
