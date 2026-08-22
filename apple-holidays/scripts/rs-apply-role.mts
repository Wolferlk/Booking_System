/**
 * Reservation Team — step 2 of 2: widen the live `users.role` ENUM with RS_USER.
 *
 * This is the ONLY change the module makes to an existing table, so it is done
 * by a script rather than a static .sql file: the ALTER is built from the
 * column definition actually in the database, not from what schema.prisma
 * believes it to be. The live schema is known to carry drift, and a static
 * ALTER written against the wrong value list would silently drop roles.
 *
 * What it does:
 *   - reads the current ENUM definition,
 *   - stops if RS_USER is already there (idempotent),
 *   - appends 'RS_USER' as the LAST value, preserving every existing value in
 *     its existing order, so no stored row changes meaning,
 *   - preserves NOT NULL and the current DEFAULT,
 *   - prints the exact statement and, without --apply, stops there.
 *
 * Appending to the end of a MySQL/MariaDB ENUM is a metadata-only change: the
 * ordinal of every existing value is unchanged, so no row is rewritten and no
 * data can be lost. Re-ordering or removing a value would NOT be safe, and this
 * script never does either.
 *
 * Usage:
 *   npx tsx scripts/rs-apply-role.mts            # dry run — prints the ALTER
 *   npx tsx scripts/rs-apply-role.mts --apply    # executes it
 */
import nextEnv from '@next/env'
import mysql from 'mysql2/promise'

nextEnv.loadEnvConfig(process.cwd())

const DATABASE = process.env.RS_TARGET_DB?.trim() || 'apple_booking_system'
const APPLY = process.argv.includes('--apply')

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

  const col = (await q<any>(
    `SELECT COLUMN_TYPE t, IS_NULLABLE n, COLUMN_DEFAULT d, COLUMN_COMMENT c
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'users' AND COLUMN_NAME = 'role'`,
    [DATABASE],
  ))[0]

  if (!col) throw new Error('users.role not found — stop and investigate')

  const currentType = String(col.t)
  console.log('database    :', DATABASE)
  console.log('current type:', currentType)

  if (currentType.includes("'RS_USER'")) {
    console.log('\n✓ RS_USER is already present. Nothing to do.')
    await conn.end()
    return
  }

  const values = [...currentType.matchAll(/'((?:[^']|'')*)'/g)].map(m => m[1])
  if (values.length === 0) throw new Error(`could not parse ENUM values from: ${currentType}`)

  const newValues = [...values, 'RS_USER']
  const notNull = col.n === 'NO' ? ' NOT NULL' : ' NULL'
  const dflt = col.d == null ? '' : ` DEFAULT '${String(col.d).replace(/'/g, "''")}'`
  const comment = col.c ? ` COMMENT '${String(col.c).replace(/'/g, "''")}'` : ''
  const sql =
    'ALTER TABLE `users` MODIFY COLUMN `role` ENUM(' +
    newValues.map(v => `'${v.replace(/'/g, "''")}'`).join(', ') +
    `)${notNull}${dflt}${comment}`

  console.log('\nexisting values preserved in order:', values.join(', '))
  console.log('appending                         : RS_USER (last — no ordinal changes)')
  console.log('\nStatement:\n  ' + sql + ';\n')

  const [{ n }] = await q<any>('SELECT COUNT(*) n FROM users')
  console.log(`users table holds ${n} row(s); none are read or written by this change.`)

  if (!APPLY) {
    console.log('\nDry run — nothing executed. Re-run with --apply to execute.')
    await conn.end()
    return
  }

  await conn.query(sql)
  const after = (await q<any>(
    `SELECT COLUMN_TYPE t FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'users' AND COLUMN_NAME = 'role'`,
    [DATABASE],
  ))[0]
  const [{ n: after_n }] = await q<any>('SELECT COUNT(*) n FROM users')
  console.log('\n✓ Applied.')
  console.log('new type    :', after.t)
  console.log(`users rows  : ${n} before, ${after_n} after`)
  if (n !== after_n) console.error('⚠  ROW COUNT CHANGED — investigate immediately.')

  await conn.end()
}

main().catch(e => {
  console.error('\nFAILED:', e.code ?? '', e.message)
  process.exit(1)
})
