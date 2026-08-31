/**
 * Read-only probe for the apple_quote_ai schema (tbl_corporate_parties).
 *
 *   node scripts/quote-ai-probe.mjs
 *
 * SHOW/SELECT only — no write path. Prints the table shape and a few sample
 * rows so the agent-resolution mapping can be built against the real columns.
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
const database = cfg.QUOTE_AI_DB_DATABASE || 'apple_quote_ai'

const conn = await mysql.createConnection({
  host: cfg.QUOTE_AI_DB_HOST || cfg.DB_HOST,
  port: Number(cfg.QUOTE_AI_DB_PORT || cfg.DB_PORT || 3306),
  user: cfg.QUOTE_AI_DB_USERNAME || cfg.DB_USERNAME,
  password: cfg.QUOTE_AI_DB_PASSWORD || cfg.DB_PASSWORD,
  ssl: { rejectUnauthorized: false },
  dateStrings: true,
  multipleStatements: false,
})

console.log(`host: ${cfg.QUOTE_AI_DB_HOST || cfg.DB_HOST}  schema: ${database}`)
const [dbs] = await conn.query('SHOW DATABASES LIKE ?', [database])
console.log('schema present:', dbs.length > 0)
if (!dbs.length) { await conn.end(); process.exit(0) }

const [cols] = await conn.query(
  'SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION',
  [database, 'tbl_corporate_parties'],
)
console.log('\ncolumns:')
for (const c of cols) console.log(`  ${c.COLUMN_NAME.padEnd(32)} ${c.DATA_TYPE}`)

const [[{ n }]] = await conn.query(`SELECT COUNT(*) AS n FROM \`${database}\`.tbl_corporate_parties`)
console.log(`\nrows: ${n}`)

const [sample] = await conn.query(`SELECT * FROM \`${database}\`.tbl_corporate_parties ORDER BY 1 DESC LIMIT 5`)
console.log('\nsample:')
console.log(JSON.stringify(sample, null, 2).slice(0, 4000))

await conn.end()
