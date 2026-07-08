import { prisma } from '@/lib/prisma'
import { DRIVE_CONFIGS, scanDriveByTargetDate, type ScanResult } from './onedrive-monitor'

// ── Settings keys stored in system_settings ───────────────────────────────────
export const SETTING_ENABLED      = 'auto_booking_create_enabled'
export const SETTING_DAYS_AHEAD   = 'auto_booking_create_days_ahead'
export const SETTING_HOUR         = 'auto_booking_create_hour'
export const SETTING_MINUTE       = 'auto_booking_create_minute'
export const SETTING_LAST_RUN_DATE = 'auto_booking_create_last_run_date'

export interface AutoCreateSettings {
  enabled:    boolean
  daysAhead:  number   // default 10
  hour:       number   // 0-23, default 6
  minute:     number   // 0-59, default 0
}

export async function getAutoCreateSettings(): Promise<AutoCreateSettings> {
  const rows = await prisma.systemSetting.findMany({
    where: { key: { in: [SETTING_ENABLED, SETTING_DAYS_AHEAD, SETTING_HOUR, SETTING_MINUTE] } },
  })
  const map: Record<string, string> = {}
  rows.forEach(r => { map[r.key] = r.value })

  return {
    enabled:   map[SETTING_ENABLED]    === 'true',
    daysAhead: parseInt(map[SETTING_DAYS_AHEAD] ?? '10',  10),
    hour:      parseInt(map[SETTING_HOUR]        ?? '6',   10),
    minute:    parseInt(map[SETTING_MINUTE]       ?? '0',   10),
  }
}

export async function saveAutoCreateSettings(s: AutoCreateSettings): Promise<void> {
  const pairs: [string, string][] = [
    [SETTING_ENABLED,    s.enabled ? 'true' : 'false'],
    [SETTING_DAYS_AHEAD, String(s.daysAhead)],
    [SETTING_HOUR,       String(s.hour)],
    [SETTING_MINUTE,     String(s.minute)],
  ]
  await Promise.all(pairs.map(([key, value]) =>
    prisma.systemSetting.upsert({ where: { key }, update: { value }, create: { key, value } })
  ))
}

// ── Job runner ────────────────────────────────────────────────────────────────

export interface BookingCreateJobResult {
  jobId:        string
  targetDate:   string   // YYYY-MM-DD
  results:      ScanResult[]
  totalCreated: number
  totalUpdated: number
  totalErrors:  number
  durationMs:   number
}

export async function runBookingCreateForDate(
  targetDate:     Date,
  triggeredBy:    string = 'auto',
  driveKeys?:     string[],
  preCreatedJobId?: string,
): Promise<BookingCreateJobResult> {
  const job = preCreatedJobId
    ? { id: preCreatedJobId }
    : await prisma.oneDriveBookingJob.create({
        data: { targetDate, triggeredBy, status: 'running' },
      })

  const start   = Date.now()
  const configs = driveKeys
    ? DRIVE_CONFIGS.filter(c => driveKeys.includes(c.key))
    : DRIVE_CONFIGS

  const results: ScanResult[] = []
  let totalCreated = 0, totalUpdated = 0, totalErrors = 0

  for (const cfg of configs) {
    try {
      console.log(`[AutoCreate] Scanning ${cfg.key} for ${targetDate.toISOString().slice(0, 10)}`)
      const r = await scanDriveByTargetDate(cfg, targetDate)
      results.push(r)
      totalCreated += r.bookingsCreated
      totalUpdated += r.bookingsUpdated
      totalErrors  += r.errors
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[AutoCreate] ${cfg.key} error:`, msg)
      results.push({
        driveKey: cfg.key, label: cfg.label,
        scanned: 0, bookingsCreated: 0, bookingsUpdated: 0, pnlsUpdated: 0,
        errors: 1, events: [],
      })
      totalErrors += 1
    }
  }

  const durationMs = Date.now() - start

  await prisma.oneDriveBookingJob.update({
    where: { id: job.id },
    data: {
      status:       'done',
      results:      JSON.stringify(results),
      totalCreated,
      totalUpdated,
      totalErrors,
      durationMs,
      completedAt:  new Date(),
    },
  })

  console.log(`[AutoCreate] Done — ${targetDate.toISOString().slice(0, 10)}: created=${totalCreated} updated=${totalUpdated} errors=${totalErrors} (${durationMs}ms)`)

  return {
    jobId:      job.id,
    targetDate: targetDate.toISOString().slice(0, 10),
    results,
    totalCreated,
    totalUpdated,
    totalErrors,
    durationMs,
  }
}

// ── Cron entry point ──────────────────────────────────────────────────────────

let _lastFiredDate = ''   // tracks last date we fired so we don't double-fire

export async function maybeRunAutoBookingCreate(): Promise<void> {
  try {
    const settings = await getAutoCreateSettings()
    if (!settings.enabled) return

    const now    = new Date()
    const nowH   = now.getHours()
    const nowM   = now.getMinutes()
    const today  = now.toISOString().slice(0, 10)

    // Fire only once per day at the scheduled time (±1 minute window)
    if (nowH !== settings.hour || nowM !== settings.minute) return
    if (_lastFiredDate === today) return

    // Persist last run date so server restarts don't double-fire
    const lastRunRow = await prisma.systemSetting.findUnique({ where: { key: SETTING_LAST_RUN_DATE } })
    if (lastRunRow?.value === today) {
      _lastFiredDate = today
      return
    }

    _lastFiredDate = today
    await prisma.systemSetting.upsert({
      where:  { key: SETTING_LAST_RUN_DATE },
      update: { value: today },
      create: { key: SETTING_LAST_RUN_DATE, value: today },
    })

    // Calculate target date
    const target = new Date(now)
    target.setDate(target.getDate() + settings.daysAhead)
    target.setHours(0, 0, 0, 0)

    console.log(`[AutoCreate] Daily trigger — target date: ${target.toISOString().slice(0, 10)}`)
    await runBookingCreateForDate(target, 'auto')
  } catch (err) {
    console.error('[AutoCreate] maybeRunAutoBookingCreate error:', err)
  }
}
