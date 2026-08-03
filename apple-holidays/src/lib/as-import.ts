/**
 * AppleSystem confirmations bulk-importer + run log.
 *
 * Pulls *confirmed* (status 2) quotations from AppleSystem by their creation
 * date and creates local bookings for each, reusing the exact same idempotent
 * pipeline as the single "Import to System" action:
 *
 *   getQuoteTemplate → mapQuoteToBooking → importMappedBooking
 *
 * Because `importMappedBooking` short-circuits on an existing `bookingRef`, a
 * re-run (or the daily job overlapping a manual range) never duplicates a
 * booking — it is simply counted as `skipped`. Nothing is ever modified.
 *
 * Both the daily 6 AM scheduler and the manual range API call `runAsImport`.
 * Settings and run history are stored in `system_settings` (KV) — no dedicated
 * table — as decided for this feature.
 */

import { randomUUID } from 'crypto'
import { prisma } from '@/lib/prisma'
import {
  listByCreateDate,
  listBookings,
  getQuoteTemplate,
  withAsRetryBudget,
  AS_IMPORT_RETRY_BUDGET_MS,
} from '@/lib/applesystem'
import { mapQuoteToBooking, ASMappingError } from '@/lib/as-booking-map'
import { importMappedBooking, getAutomationUserId } from '@/lib/as-booking-import'
import { detectCountryFromRef, type OperationCountry } from '@/lib/country-detection'
import { getCancellationDeadline } from '@/lib/utils'
import { raiseAsImportAlert } from '@/lib/as-import-alerts'

// ── Settings keys (system_settings) ───────────────────────────────────────────
export const SETTING_ENABLED       = 'as_auto_import_enabled'
export const SETTING_HOUR          = 'as_auto_import_hour'
export const SETTING_MINUTE        = 'as_auto_import_minute'
export const SETTING_LAST_RUN_DATE = 'as_auto_import_last_run_date'
const  JOBS_KEY                    = 'as_import_jobs'

/** How many recent runs we retain in the KV log. */
const MAX_JOBS = 30
/** Defensive cap on per-job event rows (a single day is normally well under this). */
const MAX_EVENTS = 400
/** Per-event message cap — a stack-trace-ish upstream error must not eat the log. */
const MAX_EVENT_MESSAGE = 240

/**
 * Byte budget for the serialized job log.
 *
 * `system_settings.value` is a MySQL TEXT column, which holds 65,535 **bytes**.
 * Retaining 30 runs × up to 400 events grew straight through that ceiling, and
 * once it did, every `writeJobs` upsert failed with "the provided value is too
 * long for the column's type" — which meant `appendJob` threw before the run
 * even started, silently disabling both the daily import and "Run yesterday now".
 *
 * So the log is now serialized to fit, shedding detail in order of how little it
 * is missed (see {@link serializeJobs}), with headroom left under the hard limit.
 */
const MAX_JOBS_BYTES = 56_000

export interface AsImportSettings {
  enabled: boolean
  hour:    number   // 0-23, default 6
  minute:  number   // 0-59, default 0
}

export async function getAsImportSettings(): Promise<AsImportSettings> {
  const rows = await prisma.systemSetting.findMany({
    where: { key: { in: [SETTING_ENABLED, SETTING_HOUR, SETTING_MINUTE] } },
  })
  const map: Record<string, string> = {}
  rows.forEach((r) => { map[r.key] = r.value })
  return {
    // Ships ON: absent setting defaults to enabled.
    enabled: map[SETTING_ENABLED] !== 'false',
    hour:    parseInt(map[SETTING_HOUR]   ?? '6', 10),
    minute:  parseInt(map[SETTING_MINUTE] ?? '0', 10),
  }
}

export async function saveAsImportSettings(s: AsImportSettings): Promise<void> {
  const pairs: [string, string][] = [
    [SETTING_ENABLED, s.enabled ? 'true' : 'false'],
    [SETTING_HOUR,    String(s.hour)],
    [SETTING_MINUTE,  String(s.minute)],
  ]
  await Promise.all(pairs.map(([key, value]) =>
    prisma.systemSetting.upsert({ where: { key }, update: { value }, create: { key, value } }),
  ))
}

// ── Job log (single JSON array in system_settings) ─────────────────────────────

export type ImportResultKind = 'created' | 'skipped' | 'error'

export interface ImportEvent {
  ref: string | null
  quotationNo: string
  country: string | null
  result: ImportResultKind
  message?: string
}

export interface CountryTally { created: number; skipped: number; errors: number }

/**
 * Which AppleSystem date the import window filters on: the quotation's creation
 * date (the default, used by the daily job) or the tour's arrival date.
 */
export type ImportDateField = 'create' | 'arrival'

export interface ImportJob {
  id: string
  mode: 'auto' | 'manual'
  dateField?: ImportDateField  // absent on jobs logged before arrival import existed => 'create'
  dateFrom: string           // YYYY-MM-DD (window bounds, interpreted per `dateField`)
  dateTo: string
  status: 'running' | 'done' | 'error'
  startedAt: string          // ISO
  completedAt: string | null
  durationMs: number | null
  totalFound: number
  totalCreated: number
  totalSkipped: number
  totalErrors: number
  countryCounts: Record<string, CountryTally>
  events: ImportEvent[]
  errorMessage?: string
}

async function readJobs(): Promise<ImportJob[]> {
  try {
    const row = await prisma.systemSetting.findUnique({ where: { key: JOBS_KEY } })
    if (!row?.value) return []
    const parsed = JSON.parse(row.value)
    return Array.isArray(parsed) ? (parsed as ImportJob[]) : []
  } catch {
    return []
  }
}

function byteLen(s: string): number {
  return Buffer.byteLength(s, 'utf8')
}

/**
 * Serialize the run log so it always fits {@link MAX_JOBS_BYTES}.
 *
 * Detail is shed in the order it is least missed, stopping as soon as the
 * payload fits:
 *   1. older runs drop their per-booking event lists — the UI only ever renders
 *      events for the newest run (and for whichever run is being polled live),
 *      so the tallies older runs keep are all anyone actually reads;
 *   2. the surviving runs cap their own event lists, newest run last;
 *   3. as a final fallback, the oldest runs are dropped entirely.
 *
 * Step 3 is effectively unreachable — a run stripped to its tallies is a few
 * hundred bytes — but it guarantees the write can never fail on length.
 */
function serializeJobs(jobs: ImportJob[]): string {
  const base = jobs.slice(0, MAX_JOBS)

  const fits = (list: ImportJob[]): string | null => {
    const out = JSON.stringify(list)
    return byteLen(out) <= MAX_JOBS_BYTES ? out : null
  }

  const asIs = fits(base)
  if (asIs) return asIs

  // 1 — keep full events on only the newest few runs.
  for (const keepFull of [5, 3, 1]) {
    const out = fits(base.map((j, i) => (i < keepFull ? j : { ...j, events: [] })))
    if (out) return out
  }

  // 2 — cap the newest run's own events too.
  for (const cap of [120, 40, 10, 0]) {
    const out = fits(base.map((j, i) => ({ ...j, events: i === 0 ? j.events.slice(0, cap) : [] })))
    if (out) return out
  }

  // 3 — drop the oldest runs until it fits.
  const stripped = base.map((j) => ({ ...j, events: [] }))
  while (stripped.length > 1) {
    stripped.pop()
    const out = fits(stripped)
    if (out) return out
  }
  return JSON.stringify(stripped)
}

async function writeJobs(jobs: ImportJob[]): Promise<void> {
  const value = serializeJobs(jobs)
  await prisma.systemSetting.upsert({
    where: { key: JOBS_KEY },
    update: { value },
    create: { key: JOBS_KEY, value },
  })
}

async function appendJob(job: ImportJob): Promise<void> {
  const jobs = await readJobs()
  jobs.unshift(job)
  await writeJobs(jobs)
}

async function patchJob(id: string, patch: Partial<ImportJob>): Promise<void> {
  const jobs = await readJobs()
  const idx = jobs.findIndex((j) => j.id === id)
  if (idx === -1) return
  jobs[idx] = { ...jobs[idx], ...patch }
  await writeJobs(jobs)
}

export async function listJobs(): Promise<ImportJob[]> {
  return readJobs()
}

export async function getJob(id: string): Promise<ImportJob | null> {
  const jobs = await readJobs()
  return jobs.find((j) => j.id === id) ?? null
}

/** Most recent finished (or running) auto job, for the settings summary. */
export async function getLastJob(mode?: 'auto' | 'manual'): Promise<ImportJob | null> {
  const jobs = await readJobs()
  const scoped = mode ? jobs.filter((j) => j.mode === mode) : jobs
  return scoped[0] ?? null
}

// ── The importer ───────────────────────────────────────────────────────────────

export interface RunAsImportParams {
  fromDate: string         // YYYY-MM-DD
  toDate: string           // YYYY-MM-DD
  /** Which upstream date the window filters on. Defaults to 'create'. */
  dateField?: ImportDateField
  mode: 'auto' | 'manual'
  triggeredById?: string   // defaults to the automation user
}

function emptyTally(): CountryTally { return { created: 0, skipped: 0, errors: 0 } }

function countryKey(c: OperationCountry | null): string { return c ?? 'UNKNOWN' }

function tally(job: ImportJob, country: OperationCountry | null): CountryTally {
  const key = countryKey(country)
  if (!job.countryCounts[key]) job.countryCounts[key] = emptyTally()
  return job.countryCounts[key]
}

function pushEvent(job: ImportJob, ev: ImportEvent): void {
  if (job.events.length >= MAX_EVENTS) return
  job.events.push(
    ev.message && ev.message.length > MAX_EVENT_MESSAGE
      ? { ...ev, message: `${ev.message.slice(0, MAX_EVENT_MESSAGE)}…` }
      : ev,
  )
}

function newJob(params: RunAsImportParams): ImportJob {
  return {
    id: randomUUID(),
    mode: params.mode,
    dateField: params.dateField ?? 'create',
    dateFrom: params.fromDate,
    dateTo: params.toDate,
    status: 'running',
    startedAt: new Date().toISOString(),
    completedAt: null,
    durationMs: null,
    totalFound: 0,
    totalCreated: 0,
    totalSkipped: 0,
    totalErrors: 0,
    countryCounts: {},
    events: [],
  }
}

/**
 * The single import loop. Mutates + periodically persists the given (already
 * appended) job record: lists status-2 confirmations in the job's date window
 * (create date or arrival date, per `job.dateField`) and runs each through the
 * idempotent import pipeline, tallying per country.
 * Per-item failures are recorded and never abort the run.
 */
async function executeJob(job: ImportJob, triggeredById: string): Promise<void> {
  // Nothing is waiting on this run, so give every AppleSystem call inside it the
  // full escalating-timeout ladder rather than the short interactive budget.
  return withAsRetryBudget(AS_IMPORT_RETRY_BUDGET_MS, () => executeJobInner(job, triggeredById))
}

async function executeJobInner(job: ImportJob, triggeredById: string): Promise<void> {
  const start = Date.now()
  try {
    const { items } = job.dateField === 'arrival'
      ? await listBookings({
          fromArrivalDate: job.dateFrom,
          toArrivalDate: job.dateTo,
          statuses: ['2'],
        })
      : await listByCreateDate({
          fromCreateDate: job.dateFrom,
          toCreateDate: job.dateTo,
          statuses: ['2'],
        })
    job.totalFound = items.length
    await patchJob(job.id, { totalFound: job.totalFound }).catch(() => {})

    for (const it of items) {
      const quotationNo = String(it.quotation_no ?? '').trim()
      // The template endpoint keys on the row's `id`; its `reference_id` field is
      // just the quotation number and returns an empty "NA" stub when sent here.
      const referenceId = String(it.id ?? it.reference_id ?? '').trim()
      if (!quotationNo || !referenceId) {
        job.totalErrors++
        pushEvent(job, { ref: null, quotationNo, country: null, result: 'error', message: 'Missing quotation/reference id' })
        continue
      }

      try {
        const quote = (await getQuoteTemplate(quotationNo, referenceId)) as unknown as Record<string, unknown>
        const mapped = mapQuoteToBooking(quote, { fallbackIsNumber: it.is_number })
        const country = mapped.operationCountry ?? detectCountryFromRef(mapped.bookingRef)
        if (!country) {
          job.totalErrors++
          tally(job, null).errors++
          pushEvent(job, { ref: mapped.bookingRef, quotationNo, country: null, result: 'error', message: 'Could not determine destination country' })
          continue
        }

        const { booking, alreadyExists } = await importMappedBooking(mapped, country, {
          createdById: triggeredById,
          cancellationDeadline: getCancellationDeadline(mapped.arrivalDate),
        })

        if (alreadyExists) {
          job.totalSkipped++
          tally(job, country).skipped++
          pushEvent(job, { ref: booking.bookingRef, quotationNo, country: countryKey(country), result: 'skipped' })
        } else {
          job.totalCreated++
          tally(job, country).created++
          pushEvent(job, { ref: booking.bookingRef, quotationNo, country: countryKey(country), result: 'created' })
        }
      } catch (err) {
        job.totalErrors++
        const msg = err instanceof ASMappingError ? err.message : err instanceof Error ? err.message : String(err)
        pushEvent(job, { ref: null, quotationNo, country: null, result: 'error', message: msg })
      }

      // Persist progress periodically so the poller shows a live count.
      if ((job.totalCreated + job.totalSkipped + job.totalErrors) % 3 === 0) {
        await patchJob(job.id, { ...job }).catch(() => {})
      }
    }

    job.status = 'done'
  } catch (err) {
    job.status = 'error'
    job.errorMessage = err instanceof Error ? err.message : String(err)
    console.error('[AsImport] run failed:', job.errorMessage)
  } finally {
    job.completedAt = new Date().toISOString()
    job.durationMs = Date.now() - start
    await patchJob(job.id, { ...job }).catch(() => {})
    console.log(`[AsImport] ${job.mode} ${job.dateField ?? 'create'} ${job.dateFrom}→${job.dateTo}: found=${job.totalFound} created=${job.totalCreated} skipped=${job.totalSkipped} errors=${job.totalErrors} (${job.durationMs}ms)`)
    await notifyOnFailure(job)
  }
}

/**
 * Turn a failed (or partially failed) run into an in-app alert + an IT email.
 *
 * Two distinct failures are worth waking someone for:
 *   - the run itself died — typically AppleSystem stalling past every rung of the
 *     retry ladder — so *nothing* in the window was imported;
 *   - the run completed but individual confirmations could not be mapped, which
 *     leaves specific bookings missing while everything looks green.
 *
 * Best-effort by construction: `raiseAsImportAlert` never throws.
 */
async function notifyOnFailure(job: ImportJob): Promise<void> {
  const window = job.dateFrom === job.dateTo ? job.dateFrom : `${job.dateFrom} → ${job.dateTo}`
  const label = job.mode === 'auto' ? 'Daily auto-import' : 'Manual import'
  const field = job.dateField === 'arrival' ? 'arrival date' : 'create date'

  if (job.status === 'error') {
    await raiseAsImportAlert({
      severity: 'error',
      title: `${label} failed for ${window}`,
      message:
        `${job.errorMessage ?? 'Unknown error'} — no confirmations were imported for this ${field} window. ` +
        `Re-run the range from the New Booking · AppleSystem page once AppleSystem responds again.`,
      // Group by run + the failing operation, not the exact wording (elapsed times
      // vary run to run and would defeat the dedup window otherwise).
      signature: `run-failed::${job.mode}::${(job.errorMessage ?? '').replace(/[\d.]+s/g, 'Ns')}`,
      jobId: job.id,
      jobMode: job.mode,
      dateFrom: job.dateFrom,
      dateTo: job.dateTo,
      totalFound: job.totalFound,
      totalCreated: job.totalCreated,
      totalErrors: job.totalErrors,
    })
    return
  }

  if (job.totalErrors > 0) {
    const samples = job.events
      .filter((e) => e.result === 'error')
      .slice(0, 5)
      .map((e) => `${e.ref ?? `q${e.quotationNo}`}: ${e.message ?? 'unknown error'}`)
      .join(' · ')
    await raiseAsImportAlert({
      severity: 'warning',
      title: `${label} finished with ${job.totalErrors} failed booking${job.totalErrors === 1 ? '' : 's'} (${window})`,
      message:
        `${job.totalCreated} created, ${job.totalSkipped} already present, ${job.totalErrors} could not be imported. ` +
        (samples ? `First failures — ${samples}` : ''),
      signature: `items-failed::${job.mode}::${job.dateFrom}::${job.dateTo}`,
      jobId: job.id,
      jobMode: job.mode,
      dateFrom: job.dateFrom,
      dateTo: job.dateTo,
      totalFound: job.totalFound,
      totalCreated: job.totalCreated,
      totalErrors: job.totalErrors,
    })
  }
}

/**
 * Run an import to completion and return the finished job. Awaited by the daily
 * scheduler (which itself is fired in the background).
 */
export async function runAsImport(params: RunAsImportParams): Promise<ImportJob> {
  const triggeredById = params.triggeredById ?? (await getAutomationUserId())
  const job = newJob(params)
  await appendJob(job)
  await executeJob(job, triggeredById)
  return job
}

/**
 * Fire-and-forget: create the job row, return its id immediately, and run the
 * import in the background. Used by HTTP handlers so the request returns fast
 * and the UI polls `import-jobs/[id]`.
 */
export async function startAsImport(params: RunAsImportParams): Promise<string> {
  const triggeredById = params.triggeredById ?? (await getAutomationUserId())
  const job = newJob(params)
  await appendJob(job)
  void executeJob(job, triggeredById).catch((err) => {
    console.error('[AsImport] background run error:', err instanceof Error ? err.message : err)
  })
  return job.id
}
