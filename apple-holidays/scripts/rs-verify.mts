/**
 * Reservation Team — READ-ONLY post-migration verification.
 *
 * Confirms the eight tables exist with the right shape, that RS_USER is on the
 * users ENUM, and that the tables the module reads are untouched. Writes
 * nothing.
 *
 * Usage:
 *   npx tsx scripts/rs-verify.mts
 */
import nextEnv from '@next/env'
import mysql from 'mysql2/promise'

nextEnv.loadEnvConfig(process.cwd())

const DATABASE = process.env.RS_TARGET_DB?.trim() || 'apple_booking_system'

/** Table → a few columns that must exist, as a shape spot-check. */
const EXPECTED: Record<string, string[]> = {
  hotel_reservations: ['reservationKey', 'bookingRef', 'status', 'checkIn', 'gateSnapshot', 'baseTotalCost'],
  reservation_options: ['reservationId', 'selected', 'selectedReason', 'availability'],
  reservation_special_requests: ['reservationId', 'kind', 'status'],
  reservation_events: ['reservationId', 'action', 'payload', 'createdAt'],
  hotel_contracts: ['hotelProfileId', 'validFrom', 'validTo', 'penaltyTiers'],
  hotel_contract_rates: ['contractId', 'roomType', 'mealPlan'],
  proforma_invoices: ['status', 'matchResult', 'variance', 'totalAmount'],
  credit_notes: ['status', 'expectedAmount', 'chaseCount', 'expectedBy'],
}

const UNTOUCHED = ['bookings', 'accommodations', 'users', 'hotel_profiles', 'hotel_reconfirmations', 'pnl_line_items']

async function main() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT ?? 3306),
    user: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD,
    database: DATABASE,
    connectTimeout: 15_000,
  })
  const q = async <T = any>(sql: string, params: unknown[] = []) =>
    (await conn.query(sql, params))[0] as T[]

  let failures = 0
  const fail = (msg: string) => { failures++; console.log(`  ✗ ${msg}`) }
  const pass = (msg: string) => console.log(`  ✓ ${msg}`)

  console.log(`\n── Tables (${DATABASE}) ───────────────────────────────────`)
  for (const [table, cols] of Object.entries(EXPECTED)) {
    const found = (await q<any>(
      `SELECT COLUMN_NAME c FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`, [DATABASE, table],
    )).map(r => r.c as string)
    if (found.length === 0) { fail(`${table} — MISSING`); continue }
    const missing = cols.filter(c => !found.includes(c))
    if (missing.length) fail(`${table} — missing columns: ${missing.join(', ')}`)
    else {
      const [{ n }] = await q<any>(`SELECT COUNT(*) n FROM \`${table}\``)
      pass(`${table} — ${found.length} columns, ${n} row(s)`)
    }
  }

  console.log('\n── Foreign keys (new tables only) ─────────────────────────')
  const fks = await q<any>(
    `SELECT TABLE_NAME t, REFERENCED_TABLE_NAME r, CONSTRAINT_NAME c
       FROM information_schema.KEY_COLUMN_USAGE
      WHERE TABLE_SCHEMA = ? AND REFERENCED_TABLE_NAME IS NOT NULL
        AND TABLE_NAME IN (${Object.keys(EXPECTED).map(() => '?').join(',')})`,
    [DATABASE, ...Object.keys(EXPECTED)],
  )
  for (const fk of fks) {
    if (Object.keys(EXPECTED).includes(fk.r)) pass(`${fk.t} → ${fk.r}`)
    else fail(`${fk.t} → ${fk.r} — points OUTSIDE the module; not expected`)
  }
  if (fks.length === 0) fail('no foreign keys found among the new tables')

  console.log('\n── users.role ─────────────────────────────────────────────')
  const roleType = String((await q<any>(
    `SELECT COLUMN_TYPE t FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'users' AND COLUMN_NAME = 'role'`,
    [DATABASE],
  ))[0]?.t ?? '')
  if (roleType.includes("'RS_USER'")) pass(`RS_USER present — ${roleType}`)
  else fail(`RS_USER missing — run scripts/rs-apply-role.mts --apply. Current: ${roleType}`)

  console.log('\n── Untouched tables (row counts) ──────────────────────────')
  for (const t of UNTOUCHED) {
    try {
      const [{ n }] = await q<any>(`SELECT COUNT(*) n FROM \`${t}\``)
      console.log(`  ${t.padEnd(24)} ${n}`)
    } catch {
      console.log(`  ${t.padEnd(24)} (not present)`)
    }
  }
  console.log('\n  Compare these against the pre-flight baseline — they must be identical.')

  console.log(failures === 0 ? '\n✓ All checks passed.\n' : `\n✗ ${failures} check(s) failed.\n`)
  await conn.end()
  process.exit(failures === 0 ? 0 : 1)
}

main().catch(e => {
  console.error('\nVerification FAILED:', e.code ?? '', e.message)
  process.exit(1)
})
