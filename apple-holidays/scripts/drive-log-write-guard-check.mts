/**
 * Check the Drive Log's write boundary — `npm run drivelog:guard`.
 *
 * The Drive Log is the one place in this app that writes into the Accounts
 * database over a connection privileged enough to move money. It is allowed
 * exactly one table, `sl_transport_settlement_requests`, and within that table
 * exactly its own half of the row: the desk states a figure, Payable 1.0
 * decides and pays it, and neither side writes the other's columns.
 *
 * Nothing enforces the *column* half of that at runtime — the statements are
 * hand-written, and a hand-written column list is exactly the kind of thing that
 * drifts. So it is enforced here instead, against three sources of truth that
 * are checked for agreement rather than trusted:
 *
 *   1. the migration, for what columns exist and which half each belongs to;
 *   2. the actual SQL in src/lib/sl-transport-actuals.ts;
 *   3. the live `accountsWrite` table guard.
 *
 * Three questions:
 *   a. does every column the app writes actually exist?
 *   b. does the app ever assign a value to a column that is the accounts
 *      system's to write?
 *   c. does the table guard still accept this table and refuse the money ones?
 *
 * No database and no credentials — it reads source and tests strings.
 */
import { readFileSync } from 'fs'
import { join } from 'path'

const ROOT = join(import.meta.dirname, '..')
const MIGRATION = join(
  ROOT, '..', '..', 'Accounts_system', 'email-invoice-processor', 'database', 'migrations',
  '2026_08_20_170000_create_sl_transport_settlement_requests_table.php',
)
const WRITER = join(ROOT, 'src', 'lib', 'sl-transport-actuals.ts')

const TABLE = 'sl_transport_settlement_requests'

/**
 * Columns the accounts system owns.
 *
 * `recorded_*` and `history` are its record of what it did — this app must
 * never assign them at all. The `decided_*` trio is different: re-opening a
 * request that was sent back has to clear last week's rejection, or the desk
 * reads the wrong reason against a figure that has since changed. So they may
 * be set to NULL and to nothing else, which is the same licence
 * `ticket-approvals.ts` takes for the same reason.
 */
const NEVER_WRITTEN = /^(recorded_|history$)/
const NULL_ONLY = ['decided_by', 'decided_at', 'decision_note']

let failures = 0
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${label}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures++
}

/* ── The schema, from the migration ────────────────────────────────────────── */

const migration = readFileSync(MIGRATION, 'utf8')

// `$table->decimal('actual_package_cost_lkr', 15, 2)` and friends.
const columns = new Set<string>(
  [...migration.matchAll(/\$table->\w+\(\s*'([a-z_]+)'/g)].map(m => m[1]),
)
// `$table->id()` and `$table->timestamps()` declare columns without naming them.
columns.add('id'); columns.add('created_at'); columns.add('updated_at')

check(`migration declares the table's columns`, columns.size >= 30, `${columns.size} found`)
for (const required of ['ops_booking_id', 'actual_package_cost_lkr', 'actual_balance_payable_lkr', 'status']) {
  check(`schema has ${required}`, columns.has(required))
}

/* ── The statements the app actually issues ────────────────────────────────── */

const writer = readFileSync(WRITER, 'utf8')

// Every accountsWrite(`…`) template literal in the module.
const statements = [...writer.matchAll(/accountsWrite\(\s*`([\s\S]*?)`/g)].map(m => m[1])

check('the writer issues statements', statements.length > 0, `${statements.length} found`)

for (const [i, sql] of statements.entries()) {
  const label = `statement ${i + 1} (${sql.trim().split(/\s+/).slice(0, 2).join(' ').toLowerCase()})`

  // (c) one table, and it is the allowlisted one.
  const tables = [...sql.matchAll(/(?:insert\s+into|update|delete\s+from)\s+`?(\w+)`?/gi)].map(m => m[1])
  check(`${label}: targets only ${TABLE}`, tables.every(t => t === TABLE), tables.join(', '))

  // (a) every column named exists. Both shapes: the INSERT's paren list, and
  // the UPDATE's `col = ?` assignments.
  const assigned = new Set<string>()

  const insertCols = sql.match(/insert\s+into\s+`?\w+`?\s*\(([\s\S]*?)\)\s*values/i)
  if (insertCols) {
    for (const c of insertCols[1].split(',')) {
      const name = c.trim().replace(/`/g, '')
      if (name) assigned.add(name)
    }
  }

  for (const m of sql.matchAll(/(\w+)\s*=\s*(NULL|\?|NOW\(\)|[\w+\s\d]+)/gi)) {
    // Skip the WHERE clause — matching a row is not writing it.
    const before = sql.slice(0, m.index ?? 0)
    if (/\bwhere\b/i.test(before)) continue
    assigned.add(m[1])
  }

  const unknown = [...assigned].filter(c => !columns.has(c))
  check(`${label}: every column exists in the schema`, unknown.length === 0, unknown.join(', '))

  // (b) nothing from the accounts system's half is assigned a value.
  const forbidden = [...assigned].filter(c => NEVER_WRITTEN.test(c))
  check(`${label}: writes no recorded_*/history column`, forbidden.length === 0, forbidden.join(', '))

  for (const col of NULL_ONLY) {
    if (!assigned.has(col)) continue
    // Every assignment of this column in this statement must be `= NULL`.
    const nonNull = [...sql.matchAll(new RegExp(`${col}\\s*=\\s*([^,\\s]+)`, 'gi'))]
      .filter(m => m[1].toUpperCase() !== 'NULL')
    check(`${label}: ${col} is only ever cleared, never set`, nonNull.length === 0,
      nonNull.map(m => m[1]).join(', '))
  }
}

/* ── The live table guard ──────────────────────────────────────────────────── */

const { accountsWrite } = await import('../src/lib/accounts-db')

async function refuses(sql: string): Promise<boolean> {
  try { await accountsWrite(sql) } catch (e) { return /Refused/.test((e as Error).message) }
  return false
}

for (const sql of [
  'UPDATE payable_payments SET amount = 0 WHERE id = 1',
  'INSERT INTO payable_records (id) VALUES (1)',
  'DELETE FROM pnl_records WHERE id = 1',
  'UPDATE generated_invoices SET paid_amount = 0 WHERE id = 1',
  'UPDATE sl_driver_advances SET override_lkr = 0 WHERE id = 1',
  'UPDATE sl_driver_advance_snapshots SET amount_lkr = 0 WHERE id = 1',
  `UPDATE ${TABLE} SET status = 'x'; DROP TABLE pnl_records`,
]) {
  check(`guard refuses: ${sql.slice(0, 54)}`, await refuses(sql))
}

for (const sql of [
  `INSERT INTO ${TABLE} (ops_booking_id) VALUES (?)`,
  `UPDATE ${TABLE} SET status = 'pending' WHERE id = ?`,
]) {
  check(`guard allows: ${sql.slice(0, 54)}`, !(await refuses(sql)))
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
