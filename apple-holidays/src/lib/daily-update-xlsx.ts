/**
 * The Daily Update sheet as a workbook.
 *
 * Split out of the route so the auth check and the rendering are separable —
 * the route decides who may ask, this decides what they get, and the builder
 * can be exercised without standing up a session.
 *
 * SheetJS's community build writes no cell styling, so the sheet earns its
 * legibility structurally instead: a merged banner carrying the window and the
 * filters, an autofilter on the header row, sized columns, and the two
 * follow-up tabs the desk actually acts on.
 */

import * as XLSX from 'xlsx'
import {
  DATE_FIELD_LABELS, summarise, resolveRange, pinsToday,
  type DailyUpdateQuery, type DailyUpdateRow,
} from '@/lib/daily-update'

const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : ''

const fmtDateTime = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString('en-GB', {
        day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
      })
    : ''

/** "in 3 days" / "today" / "landed 2 days ago" — the column the desk scans first. */
function whenLabel(days: number): string {
  if (days === 0) return 'TODAY'
  if (days === 1) return 'Tomorrow'
  if (days > 1) return `in ${days} days`
  if (days === -1) return 'landed yesterday'
  return `landed ${Math.abs(days)} days ago`
}

/** Contact block, collapsed onto one cell so the sheet stays narrow enough to print. */
function contactCell(phone: string | null, whatsapp: string | null, email: string | null): string {
  const parts: string[] = []
  if (phone) parts.push(phone)
  if (whatsapp && whatsapp !== phone) parts.push(`WA ${whatsapp}`)
  if (email) parts.push(email)
  return parts.join('\n')
}

export function buildDailyUpdateWorkbook(
  rows: DailyUpdateRow[],
  q: DailyUpdateQuery,
  now = new Date(),
): Buffer {
  const stats = summarise(rows)
  const { start, end } = resolveRange(q, now)

  const wb = XLSX.utils.book_new()
  wb.Props = {
    Title:   'Apple Holidays — Daily Update Sheet',
    Subject: `${DATE_FIELD_LABELS[q.dateField]} ${fmtDate(start.toISOString())} – ${fmtDate(end.toISOString())}`,
    Author:  'Apple Holidays MMT',
    CreatedDate: now,
  }

  // ── Sheet 1: the sheet itself ───────────────────────────────────────────────
  // Four banner rows above the table carry the context a printed or forwarded
  // copy loses: which window it covers, who ran it, and what was filtered out.
  const HEADERS = [
    '#', 'Flag', 'Booking Ref', 'IS Number', 'CNTL Number',
    'Travel Dates', 'Nights', 'Arrival', 'Departure', 'When',
    'Guest Name', 'Guest Contact',
    'Agent', 'Agent Contact',
    'Pax (A/C/I)', 'Total Pax', 'File Handler', 'Country', 'Status',
    'Booking Created', 'Last Updated',
  ]

  const banner: unknown[][] = [
    ['APPLE HOLIDAYS MMT — DAILY UPDATE SHEET'],
    [`Window: ${DATE_FIELD_LABELS[q.dateField]} — ${fmtDate(start.toISOString())} to ${fmtDate(end.toISOString())}${pinsToday(q) ? '  ·  plus everything created today' : ''}`],
    [
      `Generated: ${fmtDateTime(now.toISOString())}`,
      '', '',
      `Bookings: ${stats.total}`, '', '',
      `Created today: ${stats.createdToday}`, '', '',
      `Arriving today: ${stats.arrivingToday}`, '', '',
      `Total pax: ${stats.totalPax}`, '', '',
      `Missing IS/CNTL: ${stats.missingIds}`,
    ],
    [
      `Filters — Agent: ${q.agent || 'All'}  ·  Country: ${q.country || 'As permitted'}  ·  Search: ${q.search || 'None'}  ·  Cancelled: ${q.includeCancelled ? 'included' : 'excluded'}`,
    ],
    [],
  ]

  const body: unknown[][] = rows.map((r: DailyUpdateRow, i) => ([
    i + 1,
    r.createdToday ? 'NEW TODAY' : r.cancelled ? 'CANCELLED' : r.amended ? 'AMENDED' : '',
    r.bookingRef,
    r.isNumber ?? '— missing —',
    r.cntlNumber ?? '— missing —',
    `${fmtDate(r.arrivalDate)} → ${fmtDate(r.departureDate)}`,
    r.nights,
    fmtDate(r.arrivalDate),
    fmtDate(r.departureDate),
    whenLabel(r.daysToArrival),
    r.guestName ?? '',
    contactCell(r.guestPhone, r.guestWhatsapp, r.guestEmail),
    r.agent ?? '',
    contactCell(r.agentPhone, r.agentWhatsapp, r.agentEmail),
    `${r.paxAdults}/${r.paxChildren}/${r.paxInfants}`,
    r.totalPax,
    r.fileHandler ?? '',
    r.operationCountry ?? '',
    r.status,
    fmtDateTime(r.createdAt),
    fmtDateTime(r.updatedAt),
  ]))

  const ws = XLSX.utils.aoa_to_sheet([...banner, HEADERS, ...body])

  ws['!cols'] = [
    { wch: 4 }, { wch: 11 }, { wch: 16 }, { wch: 14 }, { wch: 14 },
    { wch: 26 }, { wch: 7 }, { wch: 13 }, { wch: 13 }, { wch: 15 },
    { wch: 26 }, { wch: 30 },
    { wch: 24 }, { wch: 30 },
    { wch: 12 }, { wch: 10 }, { wch: 18 }, { wch: 18 }, { wch: 20 },
    { wch: 20 }, { wch: 20 },
  ]

  // The banner spans the table so it reads as a title rather than as data in A1.
  ws['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: HEADERS.length - 1 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: HEADERS.length - 1 } },
    { s: { r: 3, c: 0 }, e: { r: 3, c: HEADERS.length - 1 } },
  ]

  const headerRow = banner.length          // 0-indexed row of HEADERS
  // An autofilter on the header row, so the recipient can re-slice the sheet
  // without coming back for another export. (Frozen panes are deliberately not
  // attempted: the community build of SheetJS writes no pane element, so the
  // setting would be silently dropped — the autofilter is what actually lands.)
  ws['!autofilter'] = { ref: XLSX.utils.encode_range(
    { s: { r: headerRow, c: 0 }, e: { r: headerRow + rows.length, c: HEADERS.length - 1 } },
  ) }
  ws['!rows'] = [{ hpt: 26 }, { hpt: 18 }]

  XLSX.utils.book_append_sheet(wb, ws, 'Daily Update')

  // ── Sheet 2: today's intake on its own ─────────────────────────────────────
  const todayRows = rows.filter(r => r.createdToday)
  const wsToday = XLSX.utils.aoa_to_sheet([
    [`BOOKINGS CREATED TODAY — ${fmtDate(now.toISOString())}`],
    [],
    ['Booking Ref', 'IS Number', 'CNTL Number', 'Guest', 'Guest Contact', 'Agent', 'Arrival', 'Departure', 'Pax', 'Created At'],
    ...todayRows.map(r => ([
      r.bookingRef, r.isNumber ?? '', r.cntlNumber ?? '', r.guestName ?? '',
      contactCell(r.guestPhone, r.guestWhatsapp, r.guestEmail),
      r.agent ?? '', fmtDate(r.arrivalDate), fmtDate(r.departureDate), r.totalPax, fmtDateTime(r.createdAt),
    ])),
  ])
  wsToday['!cols'] = [
    { wch: 16 }, { wch: 14 }, { wch: 14 }, { wch: 26 }, { wch: 30 },
    { wch: 24 }, { wch: 13 }, { wch: 13 }, { wch: 6 }, { wch: 20 },
  ]
  XLSX.utils.book_append_sheet(wb, wsToday, 'Created Today')

  // ── Sheet 3: the exceptions worth chasing ──────────────────────────────────
  const missing = rows.filter(r => !r.isNumber || !r.cntlNumber)
  const wsMissing = XLSX.utils.aoa_to_sheet([
    ['FILES MISSING AN IS OR CNTL NUMBER'],
    ['These can be filled in directly on the Daily Update screen.'],
    [],
    ['Booking Ref', 'Missing', 'Guest', 'Agent', 'Arrival', 'Days To Arrival', 'File Handler'],
    ...missing.map(r => ([
      r.bookingRef,
      [!r.isNumber ? 'IS Number' : null, !r.cntlNumber ? 'CNTL Number' : null].filter(Boolean).join(' + '),
      r.guestName ?? '', r.agent ?? '', fmtDate(r.arrivalDate), r.daysToArrival, r.fileHandler ?? '',
    ])),
  ])
  wsMissing['!cols'] = [{ wch: 16 }, { wch: 24 }, { wch: 26 }, { wch: 24 }, { wch: 13 }, { wch: 16 }, { wch: 18 }]
  XLSX.utils.book_append_sheet(wb, wsMissing, 'Missing IS-CNTL')

  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer
}
