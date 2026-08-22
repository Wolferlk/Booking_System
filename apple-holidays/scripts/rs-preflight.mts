/**
 * Reservation Team — READ-ONLY pre-flight check.
 *
 * Run this before applying either migration file. It writes nothing: every
 * statement is a SELECT against information_schema or a COUNT. It reports
 *
 *   1. which database you are actually connected to,
 *   2. whether the eight new tables already exist (and whether they hold rows),
 *   3. the live `users.role` ENUM definition, and whether it already has RS_USER,
 *   4. the character set / collation the rest of the database uses, so you can
 *      confirm the CREATE TABLE statements match it,
 *   5. row counts on the tables the module reads, as a before/after baseline.
 *
 * Usage:
 *   npx tsx scripts/rs-preflight.mts
 */
import nextEnv from '@next/env'
import mysql from 'mysql2/promise'

nextEnv.loadEnvConfig(process.cwd())

/**
 * `.env` defines DB_DATABASE twice — `apple_booking_system` at the top and
 * `invoice_processor` further down for the accounts connection. Whichever the
 * loader keeps, this script must not guess: the booking database is named
 * explicitly, and can be overridden for a staging run.
 */
const DATABASE = process.env.RS_TARGET_DB?.trim() || 'apple_booking_system'

const NEW_TABLES = [
  'hotel_reservations', 'reservation_options', 'reservation_special_requests',
  'reservation_events', 'hotel_contracts', 'hotel_contract_rates',
  'proforma_invoices', 'credit_notes',
]

const BASELINE_TABLES = [
  'bookings', 'accommodations', 'users', 'hotel_profiles',
  'hotel_reconfirmations', 'pnl_line_items',
]

function line(label: string, value: unknown) {
  console.log(`  ${label.padEnd(30)} ${value}`)
}

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

  console.log('\n── Connection ─────────────────────────────────────────────')
  line('database', (await q<any>('SELECT DATABASE() d'))[0].d)
  line('server', (await q<any>('SELECT VERSION() v'))[0].v)
  line('user', (await q<any>('SELECT CURRENT_USER() u'))[0].u)

  console.log('\n── Target tables ──────────────────────────────────────────')
  const present = await q<any>(
    `SELECT TABLE_NAME n, TABLE_COLLATION c FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME IN (${NEW_TABLES.map(() => '?').join(',')})`,
    [DATABASE, ...NEW_TABLES],
  )
  if (present.length === 0) {
    line('status', 'none exist yet — clear to create all eight')
  } else {
    for (const row of present) {
      const [{ n }] = await q<any>(`SELECT COUNT(*) n FROM \`${row.n}\``)
      line(row.n, `EXISTS, ${n} row(s), ${row.c}`)
    }
    console.log('\n  Tables that already exist are skipped by CREATE TABLE IF NOT EXISTS.')
    console.log('  If any of them holds rows, do NOT run the rollback file.')
  }

  console.log('\n── users.role ENUM ────────────────────────────────────────')
  const roleCol = (await q<any>(
    `SELECT COLUMN_TYPE t, IS_NULLABLE n, COLUMN_DEFAULT d FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'users' AND COLUMN_NAME = 'role'`,
    [DATABASE],
  ))[0]
  if (!roleCol) {
    line('status', 'users.role NOT FOUND — stop and investigate')
  } else {
    line('current type', roleCol.t)
    line('nullable / default', `${roleCol.n} / ${roleCol.d ?? 'none'}`)
    line('has RS_USER', String(roleCol.t).includes("'RS_USER'") ? 'YES — step 2 already applied' : 'no — step 2 needed')
    const byRole = await q<any>('SELECT role, COUNT(*) n FROM users GROUP BY role ORDER BY n DESC')
    line('users by role', byRole.map(r => `${r.role}=${r.n}`).join(', '))
  }

  console.log('\n── Collation in use elsewhere ─────────────────────────────')
  const collations = await q<any>(
    `SELECT TABLE_COLLATION c, COUNT(*) n FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE'
      GROUP BY TABLE_COLLATION ORDER BY n DESC`,
    [DATABASE],
  )
  for (const row of collations) line(row.c ?? '(none)', `${row.n} table(s)`)
  const dominant = collations[0]?.c
  if (dominant && dominant !== 'utf8mb4_unicode_ci') {
    console.log(`\n  ⚠  The migration file creates tables as utf8mb4_unicode_ci, but most`)
    console.log(`     tables here are ${dominant}. Edit the COLLATE clause in`)
    console.log(`     scripts/sql/reservation-team-01-tables.sql to match before applying.`)
  }

  console.log('\n── Baseline row counts (compare again after applying) ──────')
  for (const t of BASELINE_TABLES) {
    try {
      const [{ n }] = await q<any>(`SELECT COUNT(*) n FROM \`${t}\``)
      line(t, n)
    } catch {
      line(t, '(not present)')
    }
  }

  console.log('')
  await conn.end()
}

main().catch(e => {
  console.error('\nPre-flight FAILED:', e.code ?? '', e.message)
  process.exit(1)
})
