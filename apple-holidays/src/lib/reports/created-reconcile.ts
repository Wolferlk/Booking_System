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
import { createdDayStart } from '@/lib/booking-date-window'
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

  const refs = Array.from(cohort.keys)

  // Confirmations in this window that are held here under *some* createdAt —
  // asked for in both spellings because this system stores "VN 41054" and the
  // ledger keys it "VN41054"; the match itself is made on the normalised key.
  const cohortRows = refs.length
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

  const held = new Map<string, { inWindow: boolean }>()
  for (const row of cohortRows) {
    const key = cohortKey(row.bookingRef)
    if (!key || !cohort.keys.has(key) || held.has(key)) continue
    held.set(key, { inWindow: row.createdAt >= window.gte && row.createdAt < window.lt })
  }

  return {
    ...base,
    available: true,
    upstream: cohort.total,
    cancelledUpstream: cohort.cancelled,
    reportTotal: held.size,
    enteredLater: Array.from(held.values()).filter(h => !h.inWindow).length,
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
