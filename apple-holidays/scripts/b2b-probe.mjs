/**
 * Read-only connectivity probe for the Aahaas B2B (Flights) module.
 *
 *   node scripts/b2b-probe.mjs
 *
 * Confirms that the schema named by DB_DATABASE_B2B (falling back to
 * DB_DATABASE_B2C) actually carries b2b_bookings and its four component tables,
 * and prints the confirmed-booking count. SELECT/SHOW only — this script has no
 * write path and is safe against the live database.
 */
import mysql from 'mysql2/promise'
import fs from 'fs'
import path from 'path'

const envPath = path.join(process.cwd(), '.env')
const env = fs.existsSync(envPath)
  ? Object.fromEntries(
      fs.readFileSync(envPath, 'utf8')
        .split('\n')
        .filter((l) => l.trim() && !l.trim().startsWith('#') && l.includes('='))
        .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '')]),
    )
  : {}

const cfg = { ...env, ...process.env }
const database = cfg.DB_DATABASE_B2B || cfg.DB_DATABASE_B2C

if (!cfg.DB_HOST || !database) {
  console.error('DB_HOST and DB_DATABASE_B2B (or DB_DATABASE_B2C) must be set.')
  process.exit(1)
}

const conn = await mysql.createConnection({
  host: cfg.DB_HOST,
  port: Number(cfg.DB_PORT || 3306),
  user: cfg.DB_USERNAME,
  password: cfg.DB_PASSWORD,
  database,
  ssl: { rejectUnauthorized: false },
  dateStrings: true,
  multipleStatements: false,
})

console.log(`schema: ${database} @ ${cfg.DB_HOST}`)

const TABLES = [
  'b2b_bookings',
  'b2b_booking_flights',
  'b2b_booking_hotels',
  'b2b_booking_insurances',
  'b2b_booking_lifestyles',
]

for (const t of TABLES) {
  const [found] = await conn.query('SHOW TABLES LIKE ?', [t])
  if (!found.length) {
    console.log(`  ${t.padEnd(24)} MISSING`)
    continue
  }
  const [rows] = await conn.query(`SELECT COUNT(*) AS n FROM \`${t}\``)
  console.log(`  ${t.padEnd(24)} ${String(rows[0].n).padStart(8)} rows`)
}

const [confirmed] = await conn.query(
  "SELECT COUNT(*) AS n FROM b2b_bookings WHERE status = 'confirmed' AND deleted_at IS NULL",
)
console.log(`\nconfirmed bookings (what the page lists): ${confirmed[0].n}`)

await conn.end()
