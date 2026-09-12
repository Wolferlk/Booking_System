/**
 * The count check, opened up: every booking behind every number on the panel.
 *
 * `created-reconcile.ts` answers "why does the report say 74 and the list say
 * 72?" with four counts. That is enough to stop somebody assuming one of the
 * two is broken — and not enough to do anything else with. The first question
 * after "they differ by two" is always "which two", and until now the only way
 * to answer it was to rebuild the report's window out of list filters by hand,
 * which cannot be done at all: half the cohort sits outside the window the list
 * can filter to.
 *
 * So this module returns the same reconciliation as rows. Every booking lands
 * in exactly one bucket, each bucket carries the sentence that explains why it
 * is where it is, and the buckets add back up to the identity the panel prints:
 *
 *   report = B2B intake − earlier confirmations + entered later
 *
 * The row's `reason` is written per row rather than per bucket, because the
 * reason for a given file is a date — "confirmed 11 Sep, filed here 12 Sep" —
 * and a bucket label cannot carry that. A reader who disagrees with a number
 * can then argue with a specific booking instead of with the arithmetic.
 *
 * Read-only, and it never throws for a ledger problem: an unreachable accounts
 * database comes back `available: false` with the intake buckets still filled,
 * which is the same state the report itself falls back to.
 */
import { prisma } from '@/lib/prisma'
import { isB2cBooking } from '@/lib/booking-source'
import { createdDayStart } from '@/lib/booking-date-window'
import { collectAppleCohort, cohortKey, type CohortEntry } from './apple-cohort'
import { shiftDate, DEFAULT_REPORT_TZ } from './report-window'

/** The five populations the two figures are made of. Every row is in one. */
export type ReconcileBucket = 'matched' | 'earlier' | 'later' | 'missing' | 'b2c'

export interface ReconcileBucketMeta {
  key: ReconcileBucket
  /** Tab name in the workbook, heading on the screen. */
  label: string
  /** What it does to the arithmetic: on both, list only, report only, neither. */
  effect: string
  /** Why this population exists at all — the same sentence in both places. */
  explain: string
  count: number
}

export interface ReconcileRow {
  bucket: ReconcileBucket
  /** As a person reads it — "VN 41914". */
  bookingRef: string
  isNumber: string | null
  leadPassenger: string | null
  agent: string | null
  country: string | null
  status: string | null
  pax: number | null
  arrivalDate: string | null
  departureDate: string | null
  quotedTotal: number | null
  currency: string | null
  /** When this system filed it. Null for a confirmation with no booking here. */
  filedHere: string | null
  /** Counted by the daily report's headline figure. */
  onReport: boolean
  /** Counted by the bookings list filtered to this window. */
  inList: boolean
  /** Ledger state, where upstream knows the booking at all. */
  cancelledUpstream: boolean | null
  pnlPresent: boolean | null
  invoicePresent: boolean | null
  /** Why this row is in this bucket, in one sentence, with its dates in it. */
  reason: string
}

export interface ReconcileDetail {
  from: string
  to: string
  timezone: string
  /** False when the accounts ledger could not be read — then only intake is real. */
  available: boolean
  error: string | null
  generatedAt: string
  sweptAt: string | null
  /** Confirmations AppleSystem raised in the window, cancellations included. */
  upstream: number
  cancelledUpstream: number
  /** The figure the daily report leads with. */
  reportTotal: number
  /** Every booking filed here inside the window — what the list counts. */
  opsIntake: number
  opsIntakeB2B: number
  enteredLater: number
  earlierConfirmations: number
  missing: number
  buckets: ReconcileBucketMeta[]
  rows: ReconcileRow[]
}

/** "VN41054" as this system usually stores it — "VN 41054". */
function spacedRef(key: string): string {
  const m = /^([A-Z]+)(\d.*)$/.exec(key)
  return m ? `${m[1]} ${m[2]}` : key
}

const BOOKING_SELECT = {
  bookingRef: true, isNumber: true, agent: true, status: true,
  operationCountry: true, arrivalDate: true, departureDate: true,
  paxAdults: true, paxChildren: true, paxInfants: true,
  quotedTotal: true, currency: true, createdAt: true,
  passengers: { where: { isLead: true }, select: { name: true }, take: 1 },
} as const

type BookingRow = {
  bookingRef: string
  isNumber: string | null
  agent: string | null
  status: string
  operationCountry: string | null
  arrivalDate: Date
  departureDate: Date
  paxAdults: number
  paxChildren: number
  paxInfants: number
  quotedTotal: unknown
  currency: string
  createdAt: Date
  passengers: { name: string }[]
}

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null)
const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null)

/** "12 Sep" — how every reason sentence spells a date. */
function readable(d: Date | string | null | undefined): string {
  if (!d) return 'an unknown date'
  const date = typeof d === 'string' ? new Date(`${d.slice(0, 10)}T00:00:00.000Z`) : d
  return date.toLocaleDateString('en-GB', { timeZone: 'UTC', day: '2-digit', month: 'short' })
}

function windowWords(from: string, to: string): string {
  return from === to ? readable(from) : `${readable(from)} → ${readable(to)}`
}

function base(b: BookingRow): Omit<ReconcileRow, 'bucket' | 'onReport' | 'inList' | 'reason'
  | 'cancelledUpstream' | 'pnlPresent' | 'invoicePresent'> {
  return {
    bookingRef: b.bookingRef,
    isNumber: b.isNumber,
    leadPassenger: b.passengers[0]?.name ?? null,
    agent: b.agent,
    country: b.operationCountry ? String(b.operationCountry).replace(/_/g, ' ') : null,
    status: b.status,
    pax: b.paxAdults + b.paxChildren + b.paxInfants,
    arrivalDate: day(b.arrivalDate),
    departureDate: day(b.departureDate),
    quotedTotal: b.quotedTotal === null || b.quotedTotal === undefined ? null : Number(b.quotedTotal),
    currency: b.currency ?? null,
    filedHere: iso(b.createdAt),
  }
}

/**
 * The bookings held here for a set of cohort keys, in both spellings this
 * system and the ledger use ("VN 41054" here, "VN41054" there). The match is
 * made on the normalised key either way, so a row that only came back because
 * of the other spelling is still checked before it counts.
 */
async function heldForCohort(keys: Set<string>): Promise<Map<string, BookingRow>> {
  const refs = Array.from(keys)
  const rows = refs.length
    ? ((await prisma.booking.findMany({
        where: { OR: [{ bookingRef: { in: refs } }, { bookingRef: { in: refs.map(spacedRef) } }] },
        select: BOOKING_SELECT,
      })) as unknown as BookingRow[])
    : []

  const held = new Map<string, BookingRow>()
  for (const row of rows) {
    const key = cohortKey(row.bookingRef)
    if (!key || !keys.has(key) || held.has(key)) continue
    held.set(key, row)
  }
  return held
}

function ledgerNote(e: CohortEntry): string {
  const bits: string[] = []
  if (e.cancelled) bits.push('cancelled upstream')
  if (!e.pnlPresent) bits.push('no P&L yet')
  if (!e.invoicePresent) bits.push('not invoiced yet')
  return bits.length ? ` (${bits.join(', ')})` : ''
}

/**
 * One window's reconciliation, booking by booking.
 *
 * `from`/`to` are inclusive `yyyy-mm-dd` operations-timezone dates — the same
 * spelling the daily report is cut for, so the rows here are the ones behind
 * that morning's figure and not an approximation of them.
 */
export async function reconcileCreatedDetail(from: string, to: string): Promise<ReconcileDetail> {
  const window = { gte: createdDayStart(from), lt: createdDayStart(shiftDate(to, 1)) }
  const windowLabel = windowWords(from, to)

  const [cohort, intakeRaw] = await Promise.all([
    collectAppleCohort({ fromDate: from, toDate: to }),
    prisma.booking.findMany({ where: { createdAt: window }, select: BOOKING_SELECT }),
  ])
  const intake = intakeRaw as unknown as BookingRow[]

  const rows: ReconcileRow[] = []
  const b2b = intake.filter(b => !isB2cBooking(b.agent))
  const b2c = intake.filter(b => isB2cBooking(b.agent))

  for (const b of b2c) {
    rows.push({
      ...base(b),
      bucket: 'b2c',
      onReport: false,
      inList: true,
      cancelledUpstream: null, pnlPresent: null, invoicePresent: null,
      reason:
        `Storefront order filed here ${readable(b.createdAt)}. The daily report is B2B Apple System only — `
        + 'Aahaas B2C files its own order and never raises an Apple System confirmation, so it is in this list and not on the report.',
    })
  }

  if (!cohort.available) {
    // No ledger, no cohort: every B2B booking is simply intake, and the caller
    // is told the comparison is unavailable rather than shown a fabricated one.
    for (const b of b2b) {
      rows.push({
        ...base(b),
        bucket: 'matched',
        onReport: true,
        inList: true,
        cancelledUpstream: null, pnlPresent: null, invoicePresent: null,
        reason: `Filed here ${readable(b.createdAt)}. The accounts ledger could not be read, so this window counts plain intake and nothing can be matched against a confirmation.`,
      })
    }

    return {
      from, to, timezone: DEFAULT_REPORT_TZ,
      available: false, error: cohort.error,
      generatedAt: new Date().toISOString(), sweptAt: cohort.sweptAt,
      upstream: 0, cancelledUpstream: 0,
      reportTotal: intake.length,
      opsIntake: intake.length, opsIntakeB2B: b2b.length,
      enteredLater: 0, earlierConfirmations: 0, missing: 0,
      buckets: bucketMeta(rows, windowLabel),
      rows,
    }
  }

  const held = await heldForCohort(cohort.keys)

  for (const e of cohort.entries) {
    const b = held.get(e.key)

    if (!b) {
      if (e.cancelled) continue // withdrawn upstream — never owed a booking here
      rows.push({
        bucket: 'missing',
        bookingRef: e.ref,
        isNumber: e.ref,
        leadPassenger: null, agent: null, country: null, status: null, pax: null,
        arrivalDate: null, departureDate: null, quotedTotal: null, currency: null,
        filedHere: null,
        onReport: true,
        inList: false,
        cancelledUpstream: e.cancelled,
        pnlPresent: e.pnlPresent,
        invoicePresent: e.invoicePresent,
        reason:
          `Apple System confirmed this in ${windowLabel} and there is no booking here at all${ledgerNote(e)}. `
          + 'This is the only line on the reconciliation worth chasing — the rest is two systems counting different days.',
      })
      continue
    }

    const insideWindow = b.createdAt >= window.gte && b.createdAt < window.lt

    rows.push({
      ...base(b),
      bucket: insideWindow ? 'matched' : 'later',
      onReport: true,
      inList: insideWindow,
      cancelledUpstream: e.cancelled,
      pnlPresent: e.pnlPresent,
      invoicePresent: e.invoicePresent,
      reason: insideWindow
        ? `Confirmed by Apple System in ${windowLabel} and filed here ${readable(b.createdAt)}, inside the same window${ledgerNote(e)}. On both counts.`
        : `Confirmed by Apple System in ${windowLabel} but filed here ${readable(b.createdAt)}, outside it${ledgerNote(e)}. `
          + 'The booking is not missing — it arrived after the window closed, so the report counts it and a list filtered to the window cannot show it.',
    })
  }

  for (const b of b2b) {
    const key = cohortKey(b.bookingRef)
    if (key && cohort.keys.has(key)) continue // already placed as matched above
    rows.push({
      ...base(b),
      bucket: 'earlier',
      onReport: false,
      inList: true,
      cancelledUpstream: null, pnlPresent: null, invoicePresent: null,
      reason:
        `Filed here ${readable(b.createdAt)} against a confirmation Apple System did not raise in ${windowLabel} `
        + '— an earlier day, or one the ledger has not keyed to this reference. In this list, not on the report.',
    })
  }

  const enteredLater = rows.filter(r => r.bucket === 'later').length
  const earlier      = rows.filter(r => r.bucket === 'earlier').length
  const missing      = rows.filter(r => r.bucket === 'missing').length

  return {
    from, to, timezone: DEFAULT_REPORT_TZ,
    available: true, error: null,
    generatedAt: new Date().toISOString(),
    sweptAt: cohort.sweptAt,
    upstream: cohort.total,
    cancelledUpstream: cohort.cancelled,
    reportTotal: held.size,
    opsIntake: intake.length,
    opsIntakeB2B: b2b.length,
    enteredLater,
    earlierConfirmations: earlier,
    missing,
    buckets: bucketMeta(rows, windowLabel),
    rows,
  }
}

/** The buckets in reading order, each with the sentence that justifies it. */
function bucketMeta(rows: ReconcileRow[], windowLabel: string): ReconcileBucketMeta[] {
  const count = (k: ReconcileBucket) => rows.filter(r => r.bucket === k).length
  return [
    {
      key: 'matched',
      label: 'On both',
      effect: 'On the report · in this list',
      explain: `Confirmed by Apple System in ${windowLabel} and filed here in the same window. These are the bookings the two counts agree on, and they are the bulk of any day.`,
      count: count('matched'),
    },
    {
      key: 'earlier',
      label: 'Earlier confirmation',
      effect: 'In this list · not on the report',
      explain: `Filed here inside ${windowLabel} against a confirmation raised on an earlier day. The list counts them because the file was opened here today; the report does not, because the confirmation was not raised today. Neither is wrong.`,
      count: count('earlier'),
    },
    {
      key: 'later',
      label: 'Filed here later',
      effect: 'On the report · not in this list',
      explain: `Confirmed by Apple System inside ${windowLabel} and filed here after the window closed. The booking exists; it simply carries a later created date, which is why a list filtered to the window cannot show it.`,
      count: count('later'),
    },
    {
      key: 'missing',
      label: 'Missing here',
      effect: 'On the report · no booking here at all',
      explain: 'Confirmed upstream with nothing filed here, cancellations excluded. This is the only bucket that represents a real gap — everything else on this file is two systems answering two different questions.',
      count: count('missing'),
    },
    {
      key: 'b2c',
      label: 'Storefront (B2C)',
      effect: 'In this list · outside the report entirely',
      explain: 'Aahaas B2C orders filed here in the window. The daily report is B2B Apple System only, so these never appear on it — they explain any gap between this list\'s total and its B2B half.',
      count: count('b2c'),
    },
  ]
}
