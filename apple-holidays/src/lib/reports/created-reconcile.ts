/**
 * Why the daily report says 72 and the bookings list says something else.
 *
 * ## The two numbers are counting different things, on purpose
 *
 * The list counts **intake**: rows whose `createdAt` falls inside the day. The
 * daily report leads with the **cohort**: the confirmations AppleSystem raised
 * inside the day, matched to whatever booking here carries that reference —
 * whenever it was filed. See `apple-cohort.ts` for why the mails were moved
 * onto that basis: three systems each counted the same day their own way and
 * produced 42, 50 and 42 for a day upstream had confirmed 38.
 *
 * So they differ by exactly two populations, and neither is an error:
 *
 *   • **entered here later** — confirmed inside the day, filed here after
 *     midnight. On the report; not in the list's day.
 *   • **earlier confirmations** — filed here inside the day against a
 *     confirmation raised on an earlier day. In the list's day; not on the
 *     report.
 *
 *   `report = intake − earlier confirmations + entered later`
 *
 * That identity is the whole module. It is what lets the bookings list print
 * the report's figure beside its own and *say why they differ*, instead of
 * leaving somebody to discover the gap and assume one of the two is broken.
 *
 * ## Scope
 *
 * The cohort is B2B AppleSystem only — the storefront files its own order and
 * never produces an OPS booking, so B2C is excluded upstream and the B2B intake
 * is what gets compared. The ledger holds no country, so this is a whole-day,
 * all-countries answer; the caller is responsible for saying so when the user's
 * own filters are narrower.
 *
 * Read-only, and it never throws: an unreachable accounts database comes back
 * `available: false`, which is the same state that makes the report itself fall
 * back to counting plain intake.
 */
import { prisma } from '@/lib/prisma'
import { isB2cBooking } from '@/lib/booking-source'
import { createdDayStart, opsToday } from '@/lib/booking-date-window'
import { collectAppleCohort, cohortKey } from './apple-cohort'
import { shiftDate, DEFAULT_REPORT_TZ } from './report-window'

export interface CreatedReconcile {
  /** Inclusive local dates the comparison covers. */
  from: string
  to: string
  timezone: string
  /** False when the accounts ledger could not be read — then only intake is real. */
  available: boolean
  error: string | null
  /** Confirmations AppleSystem raised in the window, cancellations included. */
  upstream: number
  cancelledUpstream: number
  /** The figure the daily report leads with. */
  reportTotal: number
  /** Every booking filed here inside the window — what the list counts. */
  opsIntake: number
  /** …of those, the B2B ones, which is the population the cohort compares to. */
  opsIntakeB2B: number
  /** On the report, filed here on a later day. */
  enteredLater: number
  /** Filed here in the window against a confirmation raised earlier. */
  earlierConfirmations: number
  /** Confirmed upstream, nothing here at all. The only one to act on. */
  missing: number
  /** When the ledger sweep last covered these dates; `null` = never. */
  sweptAt: string | null
}

/** "VN41054" as this system usually stores it — "VN 41054". */
function spacedRef(key: string): string {
  const m = /^([A-Z]+)(\d.*)$/.exec(key)
  return m ? `${m[1]} ${m[2]}` : key
}

/**
 * The bookings held here for a set of cohort keys — one row per confirmation,
 * as this system actually stores it.
 *
 * Asked for in both spellings because this system stores "VN 41054" and the
 * ledger keys it "VN41054"; the match itself is made on the normalised key, so
 * a row that came back only because of the LIKE-free `in` on the other spelling
 * is still checked against the cohort before it counts.
 *
 * This is `reportTotal` in set form: the same rows the report's headline
 * counts, which is what lets the list show them rather than only their number.
 */
async function heldForCohort(
  keys: Set<string>,
): Promise<Map<string, { bookingRef: string; createdAt: Date }>> {
  const refs = Array.from(keys)
  const rows = refs.length
    ? await prisma.booking.findMany({
        where: {
          OR: [
            { bookingRef: { in: refs } },
            { bookingRef: { in: refs.map(spacedRef) } },
          ],
        },
        select: { bookingRef: true, createdAt: true },
      })
    : []

  const held = new Map<string, { bookingRef: string; createdAt: Date }>()
  for (const row of rows) {
    const key = cohortKey(row.bookingRef)
    if (!key || !keys.has(key) || held.has(key)) continue
    held.set(key, { bookingRef: row.bookingRef, createdAt: row.createdAt })
  }
  return held
}

/**
 * Reconcile one window's intake against the report's cohort.
 *
 * `from`/`to` are inclusive `yyyy-mm-dd` operations-timezone dates — the same
 * spelling `ReportWindow` uses, so a caller can hand this the exact days the
 * mail was cut for.
 */
export async function reconcileCreated(from: string, to: string): Promise<CreatedReconcile> {
  const base: CreatedReconcile = {
    from, to, timezone: DEFAULT_REPORT_TZ,
    available: false, error: null,
    upstream: 0, cancelledUpstream: 0,
    reportTotal: 0, opsIntake: 0, opsIntakeB2B: 0,
    enteredLater: 0, earlierConfirmations: 0, missing: 0,
    sweptAt: null,
  }

  const window = { gte: createdDayStart(from), lt: createdDayStart(shiftDate(to, 1)) }

  const [cohort, intake] = await Promise.all([
    collectAppleCohort({ fromDate: from, toDate: to }),
    prisma.booking.findMany({
      where: { createdAt: window },
      select: { bookingRef: true, agent: true },
    }),
  ])

  base.opsIntake = intake.length
  const b2b = intake.filter(r => !isB2cBooking(r.agent))
  base.opsIntakeB2B = b2b.length

  if (!cohort.available) {
    // Exactly what the report does without a readable ledger: fall back to this
    // system's own intake. The two then agree by definition, and the caller is
    // told the comparison is unavailable rather than shown a fabricated match.
    return { ...base, error: cohort.error, reportTotal: base.opsIntake, sweptAt: cohort.sweptAt }
  }

  const held = await heldForCohort(cohort.keys)

  return {
    ...base,
    available: true,
    upstream: cohort.total,
    cancelledUpstream: cohort.cancelled,
    reportTotal: held.size,
    enteredLater: Array.from(held.values())
      .filter(h => !(h.createdAt >= window.gte && h.createdAt < window.lt)).length,
    earlierConfirmations: b2b.filter(r => {
      const key = cohortKey(r.bookingRef)
      return !key || !cohort.keys.has(key)
    }).length,
    missing: cohort.entries.filter(e => !e.cancelled && !held.has(e.key)).length,
    sweptAt: cohort.sweptAt,
  }
}

/**
 * The single day, or range, a set of list filters is asking about — or `null`
 * when the filters are not a created-date question at all.
 *
 * The comparison only means anything against a window the report could also
 * have been cut for, so anything else (an arrival-date filter, no date filter,
 * a range wider than a month) declines rather than guessing.
 */
export function reconcilableWindow(
  dateField: string,
  dateFrom: string | null,
  dateTo: string | null,
): { from: string; to: string } | null {
  if (dateField !== 'createdAt') return null
  if (!dateFrom || !dateTo) return null
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateFrom) || !/^\d{4}-\d{2}-\d{2}$/.test(dateTo)) return null
  if (dateFrom > dateTo) return null
  return { from: dateFrom, to: dateTo }
}

/** The refs behind the report's figure, ready to hand to a `bookingRef in (…)`. */
export interface CohortRefs {
  /** False when the accounts ledger could not be read — then `refs` means nothing. */
  available: boolean
  error: string | null
  /** `bookingRef` as this system stores it, one per confirmation held here. */
  refs: string[]
}

/**
 * The bookings behind the daily report's figure for a window.
 *
 * The chip prints the report's number next to the list's; this is what lets
 * somebody then *open* that number. The set returned is exactly the one
 * `reconcileCreated` counts as `reportTotal`, resolved through the same
 * key-matching, so the list the button opens cannot disagree with the figure
 * the button was printed under.
 *
 * Confirmations upstream has raised but nothing here holds (`missing`) are not
 * in this set and cannot be — there is no row to show. That is the one number
 * on the panel the list can never account for, and the panel says so.
 *
 * Never throws for a ledger problem: an unreadable ledger comes back
 * `available: false` so the caller can decline rather than filter to nothing,
 * which would read as "the report's bookings are gone".
 */
export async function cohortBookingRefs(from: string, to: string): Promise<CohortRefs> {
  const cohort = await collectAppleCohort({ fromDate: from, toDate: to })
  if (!cohort.available) return { available: false, error: cohort.error, refs: [] }

  const held = await heldForCohort(cohort.keys)
  return {
    available: true,
    error: null,
    refs: Array.from(held.values(), h => h.bookingRef),
  }
}

/**
 * The window a request is asking about — `preset=today|yesterday`, or an
 * explicit `from`/`to` pair.
 *
 * Shared by the comparison route and the workbook route so the figure on the
 * panel and the file downloaded from it can never be cut for different days,
 * which would be the one failure this whole reconciliation exists to prevent.
 *
 * Presets resolve against the operations timezone rather than the browser's, so
 * "yesterday" here and "yesterday" on the list name the same day.
 */
export function parseReconcileWindow(
  params: URLSearchParams,
  maxSpanDays = 31,
): { from: string; to: string } | { error: string } {
  const preset = params.get('preset')

  if (preset === 'today' || preset === 'yesterday') {
    const day = preset === 'today' ? opsToday() : shiftDate(opsToday(), -1)
    return { from: day, to: day }
  }

  const rawFrom = params.get('from')
  const rawTo   = params.get('to')
  if (!rawFrom || !rawTo || !/^\d{4}-\d{2}-\d{2}$/.test(rawFrom) || !/^\d{4}-\d{2}-\d{2}$/.test(rawTo)) {
    return { error: 'A from and to date are required (yyyy-mm-dd)' }
  }

  const from = rawFrom <= rawTo ? rawFrom : rawTo
  const to   = rawFrom <= rawTo ? rawTo   : rawFrom

  // A month is already far wider than anything anybody reconciles by eye.
  let span = 1
  for (let d = from; d < to; d = shiftDate(d, 1)) {
    if (++span > maxSpanDays) {
      return { error: `That range is wider than ${maxSpanDays} days — narrow it to compare against the report` }
    }
  }

  return { from, to }
}
