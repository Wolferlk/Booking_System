/**
 * Aahaas B2C order importer.
 *
 * Reads upcoming travel orders from the live Aahaas store (read-only) and
 * persists each as a native ops `Booking` marked with `agent = 'Aahaas B2C'`
 * (see `booking-source.ts` — the channel is derived from that field so this
 * feature needs no schema change to the live ops database). Because they are
 * ordinary bookings, everything downstream — tour agenda, driver assignment,
 * ticket issuing, P&L sign-off, contact logs, WhatsApp — works on them with no
 * special-casing. That is the whole point of importing rather than building a
 * parallel B2C screen.
 *
 * Two entry points share this module and the same DB dedup guard so they can
 * coexist without double-importing: the node-cron scheduler
 * (`b2c-import-scheduler.ts`) and the HTTP route (`/api/cron/b2c-import`).
 */
import { prisma } from './prisma'
import {
  fetchFlightBookings,
  fetchOrderCustomers,
  fetchOrderHeaders,
  fetchOrderProducts,
  isB2cConfigured,
} from './b2c-db'
import { mapB2cOrder } from './b2c-booking-map'
import { parseFlightBooking } from './b2c-flight'
import { isB2cBooking } from './booking-source'
import { getAutomationUserId } from './as-booking-import'
import type { B2cSkipReason, MappedB2cBooking } from './b2c-booking-map'

export const SETTING_ENABLED       = 'auto_b2c_import_enabled'
export const SETTING_HOUR          = 'auto_b2c_import_hour'
export const SETTING_MINUTE        = 'auto_b2c_import_minute'
export const SETTING_LAST_RUN_DATE = 'auto_b2c_import_last_run_date'
/** KV log of recent runs, newest first — powers the B2C page's activity feed. */
export const SETTING_RUN_LOG       = 'auto_b2c_import_runs'

/** How many recent runs to retain in the KV log. */
const MAX_RUNS = 25

/** Nightly default: 00:30 in `AUTO_BOOKING_TZ`, i.e. just after midnight. */
const DEFAULT_HOUR = 0
const DEFAULT_MINUTE = 30

export interface B2cImportSettings {
  enabled: boolean
  hour: number
  minute: number
}

export async function getB2cImportSettings(): Promise<B2cImportSettings> {
  const rows = await prisma.systemSetting.findMany({
    where: { key: { in: [SETTING_ENABLED, SETTING_HOUR, SETTING_MINUTE] } },
  })
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value])) as Record<string, string>
  const hour = parseInt(map[SETTING_HOUR] ?? String(DEFAULT_HOUR), 10)
  const minute = parseInt(map[SETTING_MINUTE] ?? String(DEFAULT_MINUTE), 10)
  return {
    // Opt-out rather than opt-in, matching the other automations.
    enabled: map[SETTING_ENABLED] !== 'false',
    hour: Number.isFinite(hour) && hour >= 0 && hour <= 23 ? hour : DEFAULT_HOUR,
    minute: Number.isFinite(minute) && minute >= 0 && minute <= 59 ? minute : DEFAULT_MINUTE,
  }
}

export async function saveB2cImportSettings(s: B2cImportSettings): Promise<void> {
  const pairs: [string, string][] = [
    [SETTING_ENABLED, s.enabled ? 'true' : 'false'],
    [SETTING_HOUR, String(s.hour)],
    [SETTING_MINUTE, String(s.minute)],
  ]
  await Promise.all(
    pairs.map(([key, value]) =>
      prisma.systemSetting.upsert({ where: { key }, update: { value }, create: { key, value } }),
    ),
  )
}

// ─── Run summary ──────────────────────────────────────────────────────────────

export interface B2cImportSummary {
  /** Who/what started the run — shown in the activity feed. */
  trigger?: 'scheduler' | 'cron-http' | 'manual'
  triggeredBy?: string | null
  /** True for a preview: everything is computed, nothing is written. */
  dryRun?: boolean
  mode: 'nightly' | 'backfill'
  bookedFrom: string | null
  upcomingFrom: string
  candidates: number
  created: string[]
  alreadyImported: string[]
  /** Ref exists but belongs to a non-B2C booking — never overwritten. */
  conflicts: { bookingRef: string; reason: string }[]
  skipped: { orderId: number; reason: B2cSkipReason; detail: string }[]
  failed: { orderId: number; error: string }[]
  startedAt: string
  finishedAt: string
}

// ─── Import ───────────────────────────────────────────────────────────────────

export interface RunB2cImportOptions {
  /** 'nightly' imports recently-booked orders; 'backfill' sweeps all upcoming. */
  mode?: 'nightly' | 'backfill'
  /**
   * Compute the full result but write NOTHING. Used by the B2C page's preview so
   * staff can see exactly what an import would create before committing to it.
   */
  dryRun?: boolean
  trigger?: 'scheduler' | 'cron-http' | 'manual'
  triggeredBy?: string | null
  /** Persist the summary to the run log. Off for previews. */
  log?: boolean
  /**
   * 'YYYY-MM-DD' inclusive floor on `booked_date`. Nightly only.
   * Defaults to *yesterday* in the scheduler timezone: the job runs just after
   * midnight, so "today's orders" from a user's point of view are the ones placed
   * on the day that has just ended.
   */
  bookedFrom?: string | null
  /** 'YYYY-MM-DD' travel-date floor. Defaults to today. */
  upcomingFrom?: string
  limit?: number
}

export async function runB2cImport(opts: RunB2cImportOptions = {}): Promise<B2cImportSummary> {
  const startedAt = new Date().toISOString()
  const mode = opts.mode ?? 'nightly'
  const tz = process.env.AUTO_BOOKING_TZ || 'Asia/Colombo'
  const today = dateInTz(new Date(), tz)
  const upcomingFrom = opts.upcomingFrom ?? today
  const bookedFrom = mode === 'nightly' ? (opts.bookedFrom ?? addDays(today, -1)) : null

  const dryRun = opts.dryRun === true

  const summary: B2cImportSummary = {
    trigger: opts.trigger ?? 'manual',
    triggeredBy: opts.triggeredBy ?? null,
    dryRun,
    mode, bookedFrom, upcomingFrom,
    candidates: 0, created: [], alreadyImported: [],
    conflicts: [], skipped: [], failed: [],
    startedAt, finishedAt: startedAt,
  }

  if (!isB2cConfigured()) {
    summary.failed.push({ orderId: 0, error: 'B2C database is not configured' })
    return finish(summary, opts)
  }

  const headers = await fetchOrderHeaders({ upcomingFrom, bookedFrom, limit: opts.limit })
  summary.candidates = headers.length
  if (headers.length === 0) return finish(summary, opts)

  const orderIds = headers.map((h) => Number(h.order_id))

  // Three bulk reads rather than per-order queries — one round trip each.
  const [products, customers, flightRows] = await Promise.all([
    fetchOrderProducts(orderIds),
    fetchOrderCustomers(orderIds),
    fetchFlightBookings(orderIds),
  ])

  const productsByOrder = groupBy(products, (p) => Number(p.order_id))
  const customerByOrder = new Map(customers.map((c) => [Number(c.order_id), c]))
  const flightsByOrder = groupBy(
    flightRows.map((r) => parseFlightBooking(r)),
    (f) => f.orderId,
  )

  const automationUserId = await getAutomationUserId()

  for (const header of headers) {
    const orderId = Number(header.order_id)
    try {
      const result = mapB2cOrder({
        header,
        products: productsByOrder.get(orderId) ?? [],
        customer: customerByOrder.get(orderId),
        flights: flightsByOrder.get(orderId) ?? [],
      })

      if (!result.ok) {
        summary.skipped.push({ orderId, reason: result.reason, detail: result.detail })
        continue
      }

      // Preview mode: report what *would* happen without writing anything.
      if (dryRun) {
        const existing = await prisma.booking.findUnique({
          where: { bookingRef: result.booking.bookingRef },
          select: { agent: true },
        })
        if (!existing) summary.created.push(result.booking.bookingRef)
        else if (isB2cBooking(existing.agent)) summary.alreadyImported.push(result.booking.bookingRef)
        else summary.conflicts.push({
          bookingRef: result.booking.bookingRef,
          reason: 'bookingRef already used by a non-B2C booking',
        })
        continue
      }

      const outcome = await persistB2cBooking(result.booking, automationUserId)
      if (outcome === 'created') summary.created.push(result.booking.bookingRef)
      else if (outcome === 'exists') summary.alreadyImported.push(result.booking.bookingRef)
      else {
        summary.conflicts.push({
          bookingRef: result.booking.bookingRef,
          reason: 'bookingRef already used by a non-B2C booking',
        })
      }
    } catch (err) {
      summary.failed.push({ orderId, error: err instanceof Error ? err.message : String(err) })
    }
  }

  return finish(summary, opts)
}

/**
 * Stamp the finish time and, unless this was a preview, append the summary to the
 * run log. Logging is best-effort: a failed log write must never fail an import
 * that already succeeded.
 */
async function finish(
  summary: B2cImportSummary,
  opts: RunB2cImportOptions,
): Promise<B2cImportSummary> {
  summary.finishedAt = new Date().toISOString()
  const shouldLog = opts.log ?? opts.dryRun !== true
  if (shouldLog) {
    try {
      const runs = await getRunLog()
      await prisma.systemSetting.upsert({
        where: { key: SETTING_RUN_LOG },
        update: { value: JSON.stringify([summary, ...runs].slice(0, MAX_RUNS)) },
        create: { key: SETTING_RUN_LOG, value: JSON.stringify([summary]) },
      })
    } catch {
      /* activity feed is a convenience, never a correctness requirement */
    }
  }
  return summary
}

/** Recent import runs, newest first. Never throws — a bad row reads as empty. */
export async function getRunLog(): Promise<B2cImportSummary[]> {
  try {
    const row = await prisma.systemSetting.findUnique({ where: { key: SETTING_RUN_LOG } })
    if (!row?.value) return []
    const parsed = JSON.parse(row.value)
    return Array.isArray(parsed) ? (parsed as B2cImportSummary[]) : []
  } catch {
    return []
  }
}

type PersistOutcome = 'created' | 'exists' | 'conflict'

/**
 * Create the Booking (+ lead passenger, itinerary, P&L) for a mapped order.
 *
 * Idempotent on `bookingRef`. An existing B2C booking with the same ref is left
 * untouched; an existing **B2B** booking is reported as a conflict and never
 * modified — a numeric Aahaas order id must not be able to overwrite an agent
 * booking that happens to share the ref.
 *
 * `agent` is set from `mapped.agent` (always `B2C_AGENT_NAME`), which is what
 * marks the booking's sales channel.
 */
async function persistB2cBooking(
  mapped: MappedB2cBooking,
  createdById: string,
): Promise<PersistOutcome> {
  const existing = await prisma.booking.findUnique({
    where: { bookingRef: mapped.bookingRef },
    select: { id: true, agent: true },
  })
  if (existing) return isB2cBooking(existing.agent) ? 'exists' : 'conflict'

  const arrival = new Date(`${mapped.arrivalDate}T00:00:00Z`)
  const departure = new Date(`${mapped.departureDate}T00:00:00Z`)

  await prisma.$transaction(async (tx) => {
    const booking = await tx.booking.create({
      data: {
        bookingRef: mapped.bookingRef,
        isNumber: mapped.isNumber,
        agent: mapped.agent,
        arrivalDate: arrival,
        departureDate: departure,
        paxAdults: mapped.paxAdults,
        paxChildren: mapped.paxChildren,
        paxInfants: mapped.paxInfants,
        quotedTotal: mapped.quotedTotal,
        currency: mapped.currency,
        operationCountry: mapped.operationCountry,
        tourDestination: mapped.tourDestination,
        contactEmail: mapped.contactEmail,
        contactPhone: mapped.contactPhone,
        // The store's WhatsApp number is the same contact number.
        contactWhatsapp: mapped.contactPhone,
        contactCountry: mapped.contactCountry,
        createdById,
        passengers: mapped.leadPassengerName
          ? { create: [{ name: mapped.leadPassengerName, type: 'ADULT', isLead: true }] }
          : undefined,
        itineraryItems: {
          create: mapped.itineraryItems.map((i) => ({
            dayNo: i.dayNo,
            date: new Date(`${i.date}T00:00:00Z`),
            title: i.title,
            description: i.description,
          })),
        },
      },
      select: { id: true },
    })

    // P&L is created alongside so Accounts sees the real cost/sell split
    // immediately instead of waiting for a spreadsheet that will never arrive.
    if (mapped.pnlLines.length > 0) {
      await tx.pNL.create({
        data: {
          bookingId: booking.id,
          paxAdults: mapped.paxAdults,
          paxChildren: mapped.paxChildren,
          isPnlData: mapped.source as object,
          lineItems: {
            create: mapped.pnlLines.map((l) => ({
              activity: l.activity,
              category: l.category,
              mmtRate: l.mmtRate,
              sicRate: l.sicRate,
              pvtRatePP: l.pvtRatePP,
              adEntrance: l.adEntrance,
              chEntrance: l.chEntrance,
              otherRate: l.otherRate,
              paymentStatus: l.paymentStatus,
              sortOrder: l.sortOrder,
              notes: l.notes,
            })),
          },
        },
      })
    }

    await tx.statusEvent.create({
      data: {
        bookingId: booking.id,
        toState: 'DRAFT',
        actorId: createdById,
        note: `Imported from Aahaas B2C (order ${mapped.bookingRef}, ${mapped.pnlLines.length} product line(s))`,
      },
    })
  })

  return 'created'
}

// ─── Dedup guard shared by the scheduler and the HTTP route ───────────────────

export async function getLastRunDate(): Promise<string | null> {
  const row = await prisma.systemSetting.findUnique({ where: { key: SETTING_LAST_RUN_DATE } })
  return row?.value ?? null
}

export async function setLastRunDate(date: string): Promise<void> {
  await prisma.systemSetting.upsert({
    where: { key: SETTING_LAST_RUN_DATE },
    update: { value: date },
    create: { key: SETTING_LAST_RUN_DATE, value: date },
  })
}

// ─── Small helpers ────────────────────────────────────────────────────────────

/** Calendar date (YYYY-MM-DD) for `d` as seen in `tz`. */
export function dateInTz(d: Date, tz: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d)
}

/** Shift a 'YYYY-MM-DD' date by whole days, in UTC so DST cannot skew it. */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

function groupBy<T>(rows: T[], key: (row: T) => number): Map<number, T[]> {
  const out = new Map<number, T[]>()
  for (const row of rows) {
    const k = key(row)
    const list = out.get(k)
    if (list) list.push(row)
    else out.set(k, [row])
  }
  return out
}
