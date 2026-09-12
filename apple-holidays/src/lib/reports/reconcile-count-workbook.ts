/**
 * The count check as a workbook — the panel's arithmetic with the bookings
 * under it.
 *
 * The chip on the bookings list explains in three rows why the daily report
 * says one number and the list says another. That settles the argument on
 * screen and settles nothing in the meeting afterwards, where somebody wants
 * the names. This file is that: one tab per population, every booking on it,
 * and a reason column saying — for that specific file, with its own dates — why
 * it counts on one side and not the other.
 *
 * The rules are the periodic workbook's, for the same reasons (`report-workbook.ts`):
 * one population per sheet, row 1 names it, row 2 explains it, row 4 is the
 * header, data from row 5; numbers written as numbers; money never blended
 * across currencies; no styling, because SheetJS's community build writes none.
 *
 * Two tabs hold no bookings at all and are the point of the file: "Reconciliation",
 * which is the identity the panel prints, laid out so every line can be traced
 * to a tab; and "Why They Differ", which is the argument in prose for a reader
 * who was not in the conversation the file came out of.
 */
import * as XLSX from 'xlsx'
import type { ReconcileBucket, ReconcileDetail, ReconcileRow } from './created-reconcile-detail'

type Cell = string | number | null | undefined

interface SheetSpec {
  name: string
  title: string
  description: string
  headers: string[]
  rows: Cell[][]
  widths?: number[]
  emptyNote?: string
}

function addSheet(wb: XLSX.WorkBook, spec: SheetSpec): void {
  const aoa: Cell[][] = [
    [spec.title],
    [spec.description],
    [],
    spec.headers,
    ...(spec.rows.length ? spec.rows : [[spec.emptyNote ?? 'Nothing in this window.']]),
  ]

  const ws = XLSX.utils.aoa_to_sheet(aoa as unknown[][])
  const cols = spec.headers.length

  ws['!cols'] = spec.headers.map((h, i) => ({ wch: spec.widths?.[i] ?? Math.min(40, Math.max(11, h.length + 3)) }))
  ws['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: Math.max(0, cols - 1) } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: Math.max(0, cols - 1) } },
  ]
  ws['!rows'] = [{ hpt: 22 }, { hpt: 30 }]

  if (spec.rows.length) {
    ws['!autofilter'] = {
      ref: XLSX.utils.encode_range({ s: { r: 3, c: 0 }, e: { r: 3 + spec.rows.length, c: Math.max(0, cols - 1) } }),
    }
  }

  XLSX.utils.book_append_sheet(wb, ws, spec.name.slice(0, 31))
}

/** Tab names, fixed so the file's contents page and its tabs cannot disagree. */
const TAB: Record<ReconcileBucket, string> = {
  matched: 'On Both',
  earlier: 'Earlier Confirmation',
  later: 'Filed Here Later',
  missing: 'Missing Here',
  b2c: 'Storefront B2C',
}

const BOOKING_HEADERS = [
  'Booking ref', 'IS number', 'Lead passenger', 'Agent', 'Country', 'Status',
  'Pax', 'Arrival', 'Departure', 'Quoted', 'Currency', 'Filed here',
  'On the report', 'In this list', 'Cancelled upstream', 'P&L raised', 'Invoiced',
  'Why it sits here',
]

const BOOKING_WIDTHS = [14, 14, 26, 22, 14, 12, 6, 12, 12, 12, 9, 18, 13, 12, 17, 11, 10, 120]

const yesNo = (v: boolean | null) => (v === null ? '—' : v ? 'Yes' : 'No')
const stamp = (v: string | null) => (v ? `${v.slice(0, 10)} ${v.slice(11, 16)}` : '')

function bookingRow(r: ReconcileRow): Cell[] {
  return [
    r.bookingRef, r.isNumber ?? '', r.leadPassenger ?? '', r.agent ?? '', r.country ?? '', r.status ?? '',
    r.pax ?? '', r.arrivalDate ?? '', r.departureDate ?? '',
    r.quotedTotal ?? '', r.quotedTotal === null ? '' : r.currency ?? '',
    stamp(r.filedHere),
    yesNo(r.onReport), yesNo(r.inList),
    yesNo(r.cancelledUpstream), yesNo(r.pnlPresent), yesNo(r.invoicePresent),
    r.reason,
  ]
}

function windowWords(d: ReconcileDetail): string {
  const pretty = (iso: string) =>
    new Date(`${iso}T00:00:00.000Z`).toLocaleDateString('en-GB', { timeZone: 'UTC', day: '2-digit', month: 'short', year: 'numeric' })
  return d.from === d.to ? pretty(d.from) : `${pretty(d.from)} → ${pretty(d.to)}`
}

/** The file a reader can hand to somebody who was not in the conversation. */
export function renderReconcileWorkbook(d: ReconcileDetail, opts: { generatedBy?: string | null } = {}): Buffer {
  const wb = XLSX.utils.book_new()
  const when = windowWords(d)

  wb.Props = {
    Title: `Apple Holidays — count check ${d.from}${d.to === d.from ? '' : ` to ${d.to}`}`,
    Subject: 'Daily report figure reconciled against the bookings list',
    Author: 'Apple Holidays OPS',
    CreatedDate: new Date(d.generatedAt),
  }

  const banner =
    `${when} · business days in ${d.timezone} · generated ${stamp(d.generatedAt)} UTC`
    + (opts.generatedBy ? ` by ${opts.generatedBy}` : '')
    + (d.sweptAt ? ` · ledger last swept ${stamp(d.sweptAt)}` : ' · ledger never swept for these dates')

  // ── Contents ───────────────────────────────────────────────────────────────
  const contents: Cell[][] = [
    ['Reconciliation', 'The arithmetic that joins the two numbers, line by line, with the tab each line is drawn from.'],
    ['Why They Differ', 'The same thing in prose: what each system is counting, and which of these numbers is worth acting on.'],
    ...d.buckets.map(b => [TAB[b.key], `${b.count} booking${b.count === 1 ? '' : 's'} — ${b.effect}. ${b.explain}`]),
    [],
    ['HOW TO READ THIS FILE', ''],
    ['The two numbers', `The daily report counts the confirmations Apple System raised in ${when}, whenever they were filed here. The bookings list counts what was filed here inside that window. They are two honest answers to two different questions, and this file is the join between them.`],
    ['The identity', 'Daily report = B2B filed here in the window − earlier confirmations + filed here later. Every booking in this file is on exactly one tab, and the tabs add up to that line.'],
    ['What to act on', d.missing > 0
      ? `"Missing Here" — ${d.missing} confirmation${d.missing === 1 ? '' : 's'} upstream with no booking in this system at all. Nothing else in this file is a fault.`
      : 'Nothing. Every confirmation upstream has a booking here; the whole difference between the two figures is timing and channel.'],
    ['Scope', 'The ledger holds no country, so this is a whole-window, all-countries answer. If the list on screen had a country, source or search filter set, its total will be smaller than anything here and is not expected to match.'],
    ['Dates', `Days are ${d.timezone} business days — the same ones the daily report is cut for. A booking filed at 23:40 UTC belongs to the next morning here.`],
    ['Money', 'Quoted value is written beside its own currency and never totalled across two of them.'],
  ]

  if (!d.available) {
    contents.push([])
    contents.push(['LEDGER UNAVAILABLE', d.error ?? 'The accounts Sync Ledger could not be read for this window.'])
    contents.push(['What that means', 'Without the ledger there are no confirmations to match against, so this file falls back to plain intake — exactly as the daily report itself does. The bucket tabs below are intake, not a reconciliation.'])
  }

  addSheet(wb, {
    name: 'Contents',
    title: `COUNT CHECK — ${when.toUpperCase()}`,
    description: banner,
    headers: ['Sheet', 'What it holds'],
    widths: [24, 130],
    rows: contents,
  })

  // ── Reconciliation ─────────────────────────────────────────────────────────
  const counts = Object.fromEntries(d.buckets.map(b => [b.key, b.count])) as Record<ReconcileBucket, number>

  const recon: Cell[][] = [
    ['Filed here in this window (B2B)', d.opsIntakeB2B, '', 'Starting point', 'Bookings this system created inside the window, storefront excluded.'],
    ['Less: filed against an earlier confirmation', -counts.earlier, TAB.earlier, 'In this list, not on the report', 'The confirmation behind these was raised before the window, so the report does not count them today.'],
    ['Plus: confirmed in this window, filed here later', counts.later, TAB.later, 'On the report, not in this list', 'Filed after the window closed. Present, not missing.'],
    ['DAILY REPORT', d.reportTotal, '', 'What the morning mail leads with', 'The confirmations raised in the window that this system holds a booking for.'],
    [],
    ['Confirmations raised upstream', d.upstream, '', 'Context', 'Everything Apple System confirmed in the window, cancellations included.'],
    ['…of those, cancelled upstream', d.cancelledUpstream, '', 'Context', 'Withdrawn upstream — never owed a booking, P&L or invoice here.'],
    ['…of those, no booking here at all', d.missing, TAB.missing, 'The only real gap', 'Confirmed upstream, nothing filed here. Worth chasing.'],
    [],
    ['This list, unfiltered (all channels)', d.opsIntake, '', 'What the screen counts', 'Every booking filed here in the window, storefront included.'],
    ['…of those, storefront (B2C)', counts.b2c, TAB.b2c, 'Outside the report entirely', 'The report is B2B Apple System only.'],
    ['…of those, matched to this window', counts.matched, TAB.matched, 'On both counts', 'Filed here and confirmed upstream inside the same window.'],
  ]

  addSheet(wb, {
    name: 'Reconciliation',
    title: 'HOW THE TWO NUMBERS MEET',
    description: `Read the first four lines top to bottom: they are the identity the count-check panel prints. Everything below them is context for the same window. Each line names the tab its bookings are on.`,
    headers: ['Line', 'Count', 'Tab', 'Which side it counts on', 'Why'],
    widths: [46, 9, 22, 34, 92, 2],
    rows: recon,
  })

  // ── Why They Differ ────────────────────────────────────────────────────────
  addSheet(wb, {
    name: 'Why They Differ',
    title: 'WHY THE REPORT AND THE LIST DISAGREE',
    description: 'The argument in full, for a reader who was not in the conversation this file came out of.',
    headers: ['Question', 'Answer'],
    widths: [34, 140],
    rows: [
      ['What does the daily report count?',
        `The confirmations Apple System raised inside ${when} — whenever the booking was filed here. It is the same population the accounts invoice and P&L mails report, read from the Sync Ledger, so the three morning mails cannot quote three different numbers for one day.`],
      ['What does the bookings list count?',
        'Rows whose created date falls inside the window — intake. That is the right answer to "what did we open today" and the wrong one to "what did the day confirm".'],
      ['So which is correct?',
        'Both. They are different populations, and the difference is made of exactly two things: files confirmed today but typed up tomorrow, and files typed up today against a confirmation raised earlier.'],
      ['Why can\'t I just filter the list to match?',
        'Because part of the report\'s cohort sits outside any created-date filter by definition — the "Filed Here Later" tab. No arrangement of list filters can produce the report\'s figure; only the reference set can, which is what the panel\'s "View these bookings" button loads.'],
      ['Which number should I act on?',
        d.missing > 0
          ? `"Missing Here" — ${d.missing} confirmation${d.missing === 1 ? '' : 's'} exist${d.missing === 1 ? 's' : ''} upstream with no booking in this system. Everything else reconciles.`
          : 'None of them. Nothing is missing in this window; the gap is timing and channel only.'],
      ['Why is the storefront separate?',
        'Aahaas B2C files its own order and never raises an Apple System confirmation, so it can never appear on the report. It is carried here only to explain the gap between the list\'s total and its B2B half.'],
      ['What does "cancelled upstream" mean here?',
        'The confirmation was withdrawn at Apple System. It still counts as raised in the window, and it is not owed a booking, P&L or invoice here — which is why cancelled confirmations are excluded from the missing count.'],
      ['How current is this?',
        d.sweptAt
          ? `The ledger sweep that these rows come from last covered these dates at ${stamp(d.sweptAt)} UTC. Anything filed or confirmed after that is not in this file.`
          : 'No ledger sweep has covered these dates, so the ledger state on these rows is unverified. That is reported rather than papered over — a window nobody swept reads "not checked", never "balanced".'],
      ['Where do the figures come from?',
        'Confirmations, cancellations, P&L and invoice presence: the accounts Sync Ledger (read-only). Bookings, passengers, pax, value and created dates: this system. Nothing here is typed by hand.'],
    ],
  })

  // ── One tab per population ─────────────────────────────────────────────────
  for (const bucket of d.buckets) {
    const rows = d.rows.filter(r => r.bucket === bucket.key)
    addSheet(wb, {
      name: TAB[bucket.key],
      title: `${bucket.label.toUpperCase()} — ${bucket.effect.toUpperCase()}`,
      description: bucket.explain,
      headers: BOOKING_HEADERS,
      widths: BOOKING_WIDTHS,
      rows: rows.map(bookingRow),
      emptyNote: bucket.key === 'missing'
        ? 'Nothing — every confirmation Apple System raised in this window has a booking here.'
        : 'Nothing in this window.',
    })
  }

  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer
}

/** `count-check-2026-09-11.xlsx` — a name that says what it is unopened. */
export function reconcileWorkbookFilename(d: ReconcileDetail): string {
  return `count-check-${d.from}${d.to === d.from ? '' : `_to_${d.to}`}.xlsx`
}
