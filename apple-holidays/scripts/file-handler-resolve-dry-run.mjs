/**
 * Dry run for the 30 Sundays file-handler resolution — READ-ONLY.
 *
 *   node scripts/file-handler-resolve-dry-run.mjs
 *
 * Lists the bookings whose File Handler is still the "30sundays Aahaas"
 * placeholder and what each one WOULD be renamed to, using the same join the
 * app performs (bookings.isNumber → apple_quote_ai.tbl_corporate_parties.
 * is_number → file_handler). SELECT only — it never writes to either database.
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

const base = {
  host: cfg.QUOTE_AI_DB_HOST || cfg.DB_HOST,
  port: Number(cfg.QUOTE_AI_DB_PORT || cfg.DB_PORT || 3306),
  user: cfg.QUOTE_AI_DB_USERNAME || cfg.DB_USERNAME,
  password: cfg.QUOTE_AI_DB_PASSWORD || cfg.DB_PASSWORD,
  ssl: { rejectUnauthorized: false },
  dateStrings: true,
  multipleStatements: false,
}

const key      = (v) => (v ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')
const isKey    = (v) => (v ?? '').replace(/\s+/g, '').toUpperCase().trim()
const PLACEHOLDER = '30sundays Aahaas'

const ops = await mysql.createConnection({ ...base, database: cfg.CHAT_OPS_SCHEMA || 'apple_booking_system' })
const [bookings] = await ops.query(
  "SELECT bookingRef, isNumber, fileHandler, createdAt FROM bookings WHERE fileHandler LIKE '%sundays%' ORDER BY createdAt DESC",
)
await ops.end()

const pending = bookings.filter((b) => key(b.fileHandler) === key(PLACEHOLDER))
console.log(`bookings holding "${PLACEHOLDER}": ${pending.length}`)

const quote = await mysql.createConnection({ ...base, database: cfg.QUOTE_AI_DB_DATABASE || 'apple_quote_ai' })
const [parties] = await quote.query(
  'SELECT is_number, file_handler FROM tbl_corporate_parties WHERE is_number IS NOT NULL ORDER BY updated_at ASC, thread_id ASC',
)
await quote.end()

const byIs = new Map()
for (const p of parties) {
  const name = (p.file_handler ?? '').trim()
  if (!name || key(name) === key(PLACEHOLDER)) continue
  byIs.set(isKey(p.is_number), name)
}

let would = 0
for (const b of pending) {
  const hit = byIs.get(isKey(b.isNumber || b.bookingRef))
  if (!hit) continue
  would++
  console.log(`  ${b.bookingRef.padEnd(10)} ${b.fileHandler}  →  ${hit}`)
}
console.log(`\nwould replace: ${would}   no match yet: ${pending.length - would}`)
