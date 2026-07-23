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
import { listByCreateDate, getQuoteTemplate } from '@/lib/applesystem'
import { mapQuoteToBooking, ASMappingError } from '@/lib/as-booking-map'
import { importMappedBooking, getAutomationUserId } from '@/lib/as-booking-import'
import { detectCountryFromRef, type OperationCountry } from '@/lib/country-detection'
import { getCancellationDeadline } from '@/lib/utils'

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

export interface ImportJob {
  id: string
  mode: 'auto' | 'manual'
  dateFrom: string           // YYYY-MM-DD (create-date window)
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

async function writeJobs(jobs: ImportJob[]): Promise<void> {
  const trimmed = jobs.slice(0, MAX_JOBS)
  const value = JSON.stringify(trimmed)
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
  fromCreateDate: string   // YYYY-MM-DD
  toCreateDate: string     // YYYY-MM-DD
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
  if (job.events.length < MAX_EVENTS) job.events.push(ev)
}

function newJob(params: RunAsImportParams): ImportJob {
  return {
    id: randomUUID(),
    mode: params.mode,
    dateFrom: params.fromCreateDate,
    dateTo: params.toCreateDate,
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
 * appended) job record: lists status-2 confirmations in the create-date window
 * and runs each through the idempotent import pipeline, tallying per country.
 * Per-item failures are recorded and never abort the run.
 */
async function executeJob(job: ImportJob, triggeredById: string): Promise<void> {
  const start = Date.now()
  try {
    const { items } = await listByCreateDate({
      fromCreateDate: job.dateFrom,
      toCreateDate: job.dateTo,
      statuses: ['2'],
    })
    job.totalFound = items.length
    await patchJob(job.id, { totalFound: job.totalFound }).catch(() => {})

    for (const it of items) {
      const quotationNo = String(it.quotation_no ?? '').trim()
      const referenceId = String(it.reference_id ?? it.id ?? '').trim()
      if (!quotationNo || !referenceId) {
        job.totalErrors++
        pushEvent(job, { ref: null, quotationNo, country: null, result: 'error', message: 'Missing quotation/reference id' })
        continue
      }

      try {
        const quote = (await getQuoteTemplate(quotationNo, referenceId)) as unknown as Record<string, unknown>
        const mapped = mapQuoteToBooking(quote)
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
    console.log(`[AsImport] ${job.mode} ${job.dateFrom}→${job.dateTo}: found=${job.totalFound} created=${job.totalCreated} skipped=${job.totalSkipped} errors=${job.totalErrors} (${job.durationMs}ms)`)
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
