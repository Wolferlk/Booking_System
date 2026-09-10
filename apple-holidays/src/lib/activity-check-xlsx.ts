/**
 * The Activity Check result as a workbook.
 *
 * The main sheet is whatever columns the user picked, in the order they picked
 * them — that is the whole point of the picker, and it is why this writer walks
 * `ColumnDef.value` rather than hard-coding a row shape. The analysis tabs
 * beside it are fixed: they are the questions that follow the list, and they
 * are the same aggregates the screen is showing, so an emailed file and the
 * screen it came from can never disagree.
 *
 * SheetJS's community build writes no cell styling, so legibility is
 * structural: a banner carrying the search that produced the file, an
 * autofilter on the header row, and column widths from the catalogue.
 */

import * as XLSX from 'xlsx'
import {
  resolveRange, ACTIVITY_FIELD_LABELS,
  type ActivityCheckQuery, type ActivityRow,
} from '@/lib/activity-check'
import { resolveColumns, whenLabel, type ColumnKey } from '@/lib/activity-check-columns'
import { summarise } from '@/lib/activity-check-stats'

const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : ''

const SOURCE_LABELS: Record<string, string> = {
  BOTH: 'Agenda + Itinerary', AGENDA: 'Agenda (movement chart) only', ITINERARY: 'Itinerary only',
}

/**
 * The search, in one sentence, so the file explains itself six weeks later
 * when somebody finds it in a mail thread.
 */
export function describeSearch(q: ActivityCheckQuery, now = new Date()): string {
  const { start, end } = resolveRange(q, now)
  const parts = [
    q.terms.length ? `Keywords: ${q.terms.join(q.matchMode === 'all' ? ' AND ' : ' OR ')}` : 'All activities',
    `${fmtDate(start.toISOString())} → ${fmtDate(end.toISOString())}`,
    SOURCE_LABELS[q.source],
  ]
  if (q.fields.length < 4) parts.push(`Searched in: ${q.fields.map(f => ACTIVITY_FIELD_LABELS[f]).join(', ')}`)
  if (q.fuzzy) parts.push('Typo-tolerant')
  if (q.serviceTypes.length) parts.push(`Service types: ${q.serviceTypes.length} selected`)
  if (q.agent) parts.push(`Agent: ${q.agent}`)
  if (q.country) parts.push(`Country: ${q.country}`)
  if (q.booking) parts.push(`Booking filter: ${q.booking}`)
  if (q.unassignedOnly) parts.push('Unassigned movements only')
  if (q.includeCancelled) parts.push('Cancelled files included')
  return parts.join('  ·  ')
}

export function buildActivityWorkbook(
  rows: ActivityRow[],
  q: ActivityCheckQuery,
  columnKeys: ColumnKey[],
  now = new Date(),
  opts: { generatedBy?: string | null; truncated?: boolean } = {},
): Buffer {
  const wb = XLSX.utils.book_new()
  const columns = resolveColumns(columnKeys)
  const stats = summarise(rows, q)

  // ── Sheet 1: the activities, in the user's own columns ────────────────────
  const banner: unknown[][] = [
    ['ACTIVITY CHECK — Apple Holidays MMT'],
    [describeSearch(q, now)],
    [
      `${stats.activities} activities · ${stats.bookings} bookings · ${stats.pax} pax` +
      (stats.unassigned ? ` · ${stats.unassigned} movements with no driver` : '') +
      (opts.truncated ? ' · RESULTS CAPPED — narrow the window' : ''),
    ],
    [
      `Generated ${now.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })}` +
      (opts.generatedBy ? ` by ${opts.generatedBy}` : ''),
    ],
    [],
  ]

  const header = columns.map(c => c.label)
  const body = rows.map(r => columns.map(c => c.value(r)))

  const ws = XLSX.utils.aoa_to_sheet([...banner, header, ...body])
  ws['!cols'] = columns.map(c => ({ wch: c.width }))
  // Merge each banner line across the full width so it reads as a title block
  // rather than four values stranded in column A.
  ws['!merges'] = banner
    .map((_, i) => ({ s: { r: i, c: 0 }, e: { r: i, c: Math.max(0, columns.length - 1) } }))
    .slice(0, 4)
  ws['!autofilter'] = {
    ref: XLSX.utils.encode_range({
      s: { r: banner.length, c: 0 },
      e: { r: banner.length + Math.max(0, rows.length), c: Math.max(0, columns.length - 1) },
    }),
  }
  XLSX.utils.book_append_sheet(wb, ws, 'Activities')

  // ── Sheet 2: per keyword ──────────────────────────────────────────────────
  // The answer to "how much Ba Na Hills, how much Ninh Binh" when several
  // keywords went in at once.
  if (stats.byTerm.length) {
    const aoa: unknown[][] = [[
      'Keyword', 'Activities', 'Bookings', 'Pax', 'First date', 'Last date', 'Title variants',
    ]]
    for (const t of stats.byTerm) {
      aoa.push([t.label, t.count, t.bookings, t.pax, fmtDate(t.firstDate), fmtDate(t.lastDate), t.variants])
    }
    const sheet = XLSX.utils.aoa_to_sheet(aoa)
    sheet['!cols'] = [{ wch: 34 }, { wch: 12 }, { wch: 11 }, { wch: 8 }, { wch: 14 }, { wch: 14 }, { wch: 15 }]
    XLSX.utils.book_append_sheet(wb, sheet, 'By Keyword')
  }

  // ── Sheet 3: the calendar ─────────────────────────────────────────────────
  if (stats.byDay.length) {
    const aoa: unknown[][] = [['Date', 'Day', 'Activities', 'Bookings', 'Pax', 'Booking refs']]
    for (const d of stats.byDay) {
      const refs = Array.from(new Set(rows.filter(r => r.date.slice(0, 10) === d.date).map(r => r.bookingRef)))
      aoa.push([fmtDate(`${d.date}T00:00:00`), d.weekday, d.count, d.bookings, d.pax, refs.join(', ')])
    }
    const sheet = XLSX.utils.aoa_to_sheet(aoa)
    sheet['!cols'] = [{ wch: 14 }, { wch: 6 }, { wch: 11 }, { wch: 10 }, { wch: 8 }, { wch: 80 }]
    XLSX.utils.book_append_sheet(wb, sheet, 'By Date')
  }

  // ── Sheet 4: one row per file ─────────────────────────────────────────────
  // The activities sheet repeats a booking once per movement; this collapses it,
  // which is the shape you want when the sheet is going to an agent or a vendor.
  const byBooking = new Map<string, ActivityRow[]>()
  for (const r of rows) {
    const list = byBooking.get(r.bookingRef)
    if (list) list.push(r)
    else byBooking.set(r.bookingRef, [r])
  }
  const bookingAoa: unknown[][] = [[
    'Booking Ref', 'IS Number', 'Status', 'Country', 'Agent', 'File Handler', 'Lead Guest',
    'Guest Phone', 'Guest Email', 'Pax', 'Arrival', 'Departure',
    'Matched activities', 'Activity dates', 'Activities', 'Keywords matched',
  ]]
  for (const [ref, list] of Array.from(byBooking.entries())) {
    const first = list[0]
    const dates = Array.from(new Set(list.map(r => fmtDate(r.date))))
    const titles = Array.from(new Set(list.map(r => r.activity)))
    const terms = Array.from(new Set(list.flatMap(r => r.matchedTerms)))
    bookingAoa.push([
      ref, first.isNumber ?? '', first.status, first.operationCountry ?? '', first.agent ?? '',
      first.fileHandler ?? '', first.guestName ?? '', first.guestPhone ?? '', first.guestEmail ?? '',
      first.totalPax, fmtDate(first.arrivalDate), fmtDate(first.departureDate),
      list.length, dates.join(', '), titles.join('\n'), terms.join(', '),
    ])
  }
  const wsBookings = XLSX.utils.aoa_to_sheet(bookingAoa)
  wsBookings['!cols'] = [
    { wch: 14 }, { wch: 14 }, { wch: 13 }, { wch: 12 }, { wch: 22 }, { wch: 18 }, { wch: 24 },
    { wch: 16 }, { wch: 26 }, { wch: 7 }, { wch: 13 }, { wch: 13 },
    { wch: 12 }, { wch: 34 }, { wch: 60 }, { wch: 26 },
  ]
  wsBookings['!autofilter'] = {
    ref: XLSX.utils.encode_range({
      s: { r: 0, c: 0 },
      e: { r: Math.max(0, bookingAoa.length - 1), c: bookingAoa[0].length - 1 },
    }),
  }
  XLSX.utils.book_append_sheet(wb, wsBookings, 'By Booking')

  // ── Sheet 5: the breakdowns, stacked ──────────────────────────────────────
  // Four small tables on one tab rather than four near-empty tabs.
  const breakdown: unknown[][] = []
  const push = (title: string, buckets: { label: string; count: number; bookings: number; pax: number }[]) => {
    if (!buckets.length) return
    breakdown.push([title], ['', 'Activities', 'Bookings', 'Pax'])
    for (const b of buckets) breakdown.push([b.label, b.count, b.bookings, b.pax])
    breakdown.push([])
  }
  push('TOP ACTIVITIES', stats.byActivity)
  push('BY LOCATION', stats.byLocation)
  push('BY SERVICE TYPE', stats.byServiceType)
  push('BY AGENT', stats.byAgent)
  push('BY VENDOR / TOUR VENDOR', stats.byVendor)
  const wsBreak = XLSX.utils.aoa_to_sheet(breakdown.length ? breakdown : [['No data']])
  wsBreak['!cols'] = [{ wch: 60 }, { wch: 12 }, { wch: 11 }, { wch: 8 }]
  XLSX.utils.book_append_sheet(wb, wsBreak, 'Breakdown')

  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer
}
