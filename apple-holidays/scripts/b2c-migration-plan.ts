/**
 * OPTIONAL upgrade helper — generates (does NOT run) the SQL that would bring
 * extra Aahaas destinations into ops as first-class countries.
 *
 *   npx tsx scripts/b2c-migration-plan.ts
 *
 * The B2C import does NOT need this. It ships with no schema change: the sales
 * channel is derived from `Booking.agent` (see `src/lib/booking-source.ts`), and
 * orders for markets ops does not operate are imported unscoped with the
 * destination kept in `tourDestination`.
 *
 * Run this only if you decide to give Thailand / Maldives / UAE / Indonesia /
 * Mauritius their own ops country, so those bookings become country-scoped and
 * badged. It exists because the change is easy to get wrong: Prisma maps an enum
 * to a *per-column* MySQL ENUM, so EVERY column using OperationCountry must learn
 * the new values or an insert carrying one fails at runtime. This script finds all
 * of them from `information_schema` rather than trusting a hand-written list.
 *
 * Steps if you do it: add the values to `enum OperationCountry` in the Prisma
 * schema and to `ISO_TO_OPERATION` in `b2c-country.ts` (the airport table already
 * covers them), then apply the SQL below with `prisma db execute` — never
 * `prisma db push`, which would try to "correct" unrelated drifted tables.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import mysql from 'mysql2/promise'

const NEW_COUNTRIES = ['THAILAND', 'MALDIVES', 'UAE', 'INDONESIA', 'MAURITIUS'] as const

function loadEnv(): void {
  let raw: string
  try { raw = readFileSync(join(process.cwd(), '.env'), 'utf8') } catch { return }
  for (const line of raw.split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line)
    if (!m || process.env[m[1]] !== undefined) continue
    let v = m[2].trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    process.env[m[1]] = v
  }
}

interface EnumCol {
  TABLE_NAME: string
  COLUMN_NAME: string
  COLUMN_TYPE: string
  IS_NULLABLE: string
  COLUMN_DEFAULT: string | null
}

/**
 * Rebuild the DEFAULT clause for a MODIFY COLUMN.
 *
 * MariaDB's `information_schema.COLUMN_DEFAULT` is not a plain value: a column
 * with no default reports the literal text `NULL`, and a string default is
 * reported already single-quoted (`'ALL'`). Treating it as a raw value produces
 * `DEFAULT 'NULL'` (the four-character string) or `DEFAULT ''ALL''` (a syntax
 * error), so both cases are normalised here.
 */
function defaultClause(c: EnumCol): string {
  const raw = c.COLUMN_DEFAULT
  const nullable = c.IS_NULLABLE === 'YES'

  if (raw === null || raw.trim().toUpperCase() === 'NULL') {
    return nullable ? 'DEFAULT NULL' : ''
  }
  const trimmed = raw.trim()
  // Already quoted by information_schema — pass through untouched.
  if (trimmed.startsWith("'") && trimmed.endsWith("'") && trimmed.length >= 2) {
    return `DEFAULT ${trimmed}`
  }
  return `DEFAULT '${trimmed.replace(/'/g, "''")}'`
}

async function main() {
  loadEnv()
  const database = (process.env.DB_DATABASE ?? '').trim()
  console.log(`Target ops database: ${database} @ ${process.env.DB_HOST}\n`)

  const conn = await mysql.createConnection({
    host: process.env.DB_HOST!, port: Number(process.env.DB_PORT ?? 3306),
    user: process.env.DB_USERNAME!, password: process.env.DB_PASSWORD!,
    database, ssl: { rejectUnauthorized: false }, connectTimeout: 20000,
  })

  // 1. Does bookingSource already exist?
  const [srcRows] = await conn.query<(EnumCol & mysql.RowDataPacket)[]>(
    `SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT
       FROM information_schema.columns
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'bookings' AND COLUMN_NAME = 'bookingSource'`,
    [database],
  )

  const statements: string[] = []

  if (srcRows.length > 0) {
    console.log(`bookings.bookingSource ALREADY EXISTS as ${srcRows[0].COLUMN_TYPE} — no change needed.`)
  } else {
    statements.push(
      `ALTER TABLE \`bookings\` ADD COLUMN \`bookingSource\` ENUM('B2B','B2C') NOT NULL DEFAULT 'B2B';`,
    )
    statements.push(
      `CREATE INDEX \`bookings_bookingSource_idx\` ON \`bookings\` (\`bookingSource\`);`,
    )
  }

  // 2. Every ENUM column carrying the OperationCountry values.
  const [enumCols] = await conn.query<(EnumCol & mysql.RowDataPacket)[]>(
    `SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT
       FROM information_schema.columns
      WHERE TABLE_SCHEMA = ?
        AND DATA_TYPE = 'enum'
        AND COLUMN_TYPE LIKE '%SRILANKA%'
      ORDER BY TABLE_NAME, COLUMN_NAME`,
    [database],
  )

  console.log(`\nOperationCountry ENUM columns found: ${enumCols.length}`)
  for (const c of enumCols) {
    const missing = NEW_COUNTRIES.filter((v) => !c.COLUMN_TYPE.includes(`'${v}'`))
    console.log(
      `  ${c.TABLE_NAME}.${c.COLUMN_NAME} — ${missing.length === 0 ? 'up to date' : `missing ${missing.join(', ')}`}`,
    )
    if (missing.length === 0) continue

    // Rebuild the full value list, preserving existing order and appending the new
    // values, then restate nullability and default so ALTER does not drop them.
    const existing = (c.COLUMN_TYPE.match(/'((?:[^']|'')*)'/g) ?? []).map((s) => s.slice(1, -1))
    const values = [...existing, ...missing].map((v) => `'${v}'`).join(',')
    const nullClause = c.IS_NULLABLE === 'YES' ? 'NULL' : 'NOT NULL'
    const defClause = defaultClause(c)
    statements.push(
      `ALTER TABLE \`${c.TABLE_NAME}\` MODIFY COLUMN \`${c.COLUMN_NAME}\` ENUM(${values}) ${nullClause} ${defClause}`.trim() + ';',
    )
  }

  await conn.end()

  console.log('\n' + '='.repeat(78))
  if (statements.length === 0) {
    console.log('Nothing to do — the live schema already matches.')
    return
  }
  console.log(`SQL TO APPLY (${statements.length} statement(s)) — review before running:\n`)
  statements.forEach((s) => console.log(s))
  console.log('\nAll are additive: new nullable/defaulted column, and ENUM value additions.')
  console.log('No column is dropped, renamed, or narrowed; no row is modified.')
}

main().catch((err) => {
  console.error('Failed:', err instanceof Error ? err.message : err)
  process.exit(1)
})
