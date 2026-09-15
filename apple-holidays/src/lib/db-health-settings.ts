/**
 * The database-load settings an operator can change from Settings → Database
 * Health, with their validation.
 *
 * Kept apart from the API route so the settings are defined once and both the
 * route and the schedulers that consume them agree on the key names, the
 * defaults and the accepted range — a scheduler reading a key the UI never
 * writes is exactly the kind of drift this file exists to prevent.
 */
import { prisma } from './prisma'

/** Default cadence of the file-handler resolve sweep, in minutes. */
export const DEFAULT_SWEEP_MINUTES = 5
/** Floor and ceiling for that cadence. Below 2 min the sweep starts overlapping. */
export const MIN_SWEEP_MINUTES = 2
export const MAX_SWEEP_MINUTES = 120

type Check = { ok: true; value: string } | { ok: false; error: string }

function boolean(raw: string): Check {
  if (raw !== 'true' && raw !== 'false') return { ok: false, error: 'Expected true or false' }
  return { ok: true, value: raw }
}

function minutes(raw: string): Check {
  const n = Number.parseInt(raw, 10)
  if (!Number.isFinite(n) || n < MIN_SWEEP_MINUTES || n > MAX_SWEEP_MINUTES) {
    return { ok: false, error: `Expected a whole number of minutes between ${MIN_SWEEP_MINUTES} and ${MAX_SWEEP_MINUTES}` }
  }
  return { ok: true, value: String(n) }
}

export const DB_HEALTH_SETTINGS = [
  {
    key: 'db_replica_reads_enabled',
    label: 'Route read-only queries to the replica',
    validate: boolean,
  },
  {
    key: 'file_handler_sweep_minutes',
    label: 'File-handler resolve sweep interval',
    validate: minutes,
  },
] as const

/**
 * How often the file-handler sweep should run, in milliseconds.
 *
 * Read fresh on each tick so a change on the settings screen takes effect on
 * the following pass rather than needing a restart. Any unreadable or invalid
 * value falls back to the default — a bad settings row must never be able to
 * stop the sweep or turn it into a hot loop.
 */
export async function fileHandlerSweepMs(): Promise<number> {
  try {
    const row = await prisma.systemSetting.findUnique({
      where: { key: 'file_handler_sweep_minutes' },
    })
    const n = Number.parseInt(row?.value ?? '', 10)
    if (Number.isFinite(n) && n >= MIN_SWEEP_MINUTES && n <= MAX_SWEEP_MINUTES) {
      return n * 60_000
    }
  } catch {
    // Settings unreadable — fall through to the default.
  }
  return DEFAULT_SWEEP_MINUTES * 60_000
}
