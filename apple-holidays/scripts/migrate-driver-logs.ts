/**
 * One-off, idempotent data migration:
 *   SystemSetting rows keyed `driver_log_{bookingRef}`  →  DriverLog table.
 *
 * SAFETY:
 *   • Reads SystemSetting, writes DriverLog. Never deletes or mutates any
 *     SystemSetting row — the old snapshots stay exactly where they are.
 *   • Skips the global settings keys (tour/fuel pct, auto-send switch, last-run).
 *   • Skips a booking that already has a DriverLog row (re-runnable safely).
 *   • Skips a snapshot whose bookingRef no longer exists (FK would reject it).
 *
 * Run:  npx tsx scripts/migrate-driver-logs.ts
 */
import { PrismaClient } from '@prisma/client'
import type { DriverLogSnapshot } from '../src/lib/driver-log'

const prisma = new PrismaClient()

// Global driver-log settings — NOT per-booking snapshots. Never migrate these.
const GLOBAL_KEYS = new Set([
  'driver_log_tour_advance_pct',
  'driver_log_fuel_advance_pct',
  'driver_log_auto_send_enabled',
  'driver_log_auto_send_last_run_date',
])

async function main() {
  const rows = await prisma.systemSetting.findMany({
    where: { key: { startsWith: 'driver_log_' } },
  })

  const snapshots = rows.filter(r => !GLOBAL_KEYS.has(r.key))
  console.log(`Found ${snapshots.length} per-booking driver_log_* snapshot(s).`)

  let migrated = 0, skippedExisting = 0, skippedNoBooking = 0, skippedBad = 0

  for (const row of snapshots) {
    const bookingRef = row.key.replace(/^driver_log_/, '')

    let snap: DriverLogSnapshot
    try {
      snap = JSON.parse(row.value) as DriverLogSnapshot
    } catch {
      console.warn(`  ! ${bookingRef}: unparseable JSON — skipped`)
      skippedBad++
      continue
    }

    // Already migrated? leave as-is (re-runnable).
    if (await prisma.driverLog.findUnique({ where: { bookingRef } })) {
      skippedExisting++
      continue
    }

    // FK safety: the booking must still exist.
    if (!(await prisma.booking.findUnique({ where: { bookingRef }, select: { bookingRef: true } }))) {
      console.warn(`  ! ${bookingRef}: booking not found — skipped (snapshot left in SystemSetting)`)
      skippedNoBooking++
      continue
    }

    await prisma.driverLog.create({
      data: {
        bookingRef,
        currency:    snap.currency || 'USD',
        tourPct:     Number.isFinite(snap.tourPct) ? snap.tourPct : 0,
        fuelPct:     Number.isFinite(snap.fuelPct) ? snap.fuelPct : 0,
        driverPhone: snap.driverPhone ?? null,
        lines:       (snap.lines ?? []) as object,
        notes:       snap.notes ?? '',
        autoSend:    !!snap.autoSend,
        waSentAt:    snap.waSentAt ? new Date(snap.waSentAt) : null,
        updatedBy:   snap.updatedBy ?? null,
        updatedAt:   snap.updatedAt ? new Date(snap.updatedAt) : new Date(),
      },
    })
    migrated++
    console.log(`  ✓ ${bookingRef}`)
  }

  console.log(
    `\nDone. migrated=${migrated} skippedExisting=${skippedExisting} ` +
    `skippedNoBooking=${skippedNoBooking} skippedBad=${skippedBad}`,
  )
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
