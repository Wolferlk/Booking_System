/**
 * Scheduler performance indexes — check, and optionally apply.
 *
 * Adds the secondary indexes the hourly sweeps need in order to stop
 * full-scanning `bookings` and `flights` on aahaas-prod-database-4.
 *
 * ── Safety ───────────────────────────────────────────────────────────────────
 * This script cannot lose data. It only ever runs SELECTs against
 * information_schema and `ALTER TABLE ... ADD INDEX`. There is no DROP, no
 * UPDATE, no DELETE, and no CREATE/ALTER of any column. Before each index it
 * verifies that the table exists, that every column of the index exists, and
 * that an equivalent index is not already present — so re-running it is a
 * no-op, and schema drift on live shows up as a clear skip rather than an error.
 *
 * Each ALTER uses ALGORITHM=INPLACE, LOCK=NONE, so the table stays readable and
 * writable while the index builds and the live app keeps serving. If the server
 * rejects those options for a table, the index is reported as needing a
 * maintenance window rather than being forced through with a blocking rebuild.
 *
 * Usage:
 *   npx tsx scripts/db-indexes.mts            # report only — writes nothing
 *   npx tsx scripts/db-indexes.mts --apply    # create the missing indexes
 *
 * Do NOT use `prisma db push` for this. Live has drifted from schema.prisma and
 * a push would try to reconcile the whole schema, not just these indexes.
 */
import nextEnv from '@next/env'
import mysql from 'mysql2/promise'

nextEnv.loadEnvConfig(process.cwd())

/**
 * `.env` defines DB_DATABASE twice — `apple_booking_system` at the top and
 * `invoice_processor` further down for the accounts connection, and the loader
 * keeps the last one. Naming the booking database explicitly is the only way
 * this script can be sure which server it is indexing.
 */
const DATABASE = process.env.DB_INDEX_TARGET_DB?.trim() || 'apple_booking_system'

const APPLY = process.argv.includes('--apply')

interface IndexSpec {
  table: string
  name: string
  columns: string[]
  why: string
}

/**
 * The indexes, in priority order. See
 * prisma/sql/2026-09-15-scheduler-performance-indexes.sql for the query each
 * one serves and why the statements in the original brief did not match this
 * schema.
 */
const INDEXES: IndexSpec[] = [
  {
    table: 'bookings',
    name: 'idx_bookings_createdAt',
    columns: ['createdAt'],
    why: 'FileHandlerResolve sweep runs every 5 min and can only seek on this date window',
  },
  {
    table: 'bookings',
    name: 'idx_bookings_status_createdAt',
    columns: ['status', 'createdAt'],
    why: 'PortalLink welcome sweep — status filter narrowed by creation date',
  },
  {
    table: 'bookings',
    name: 'idx_bookings_status_arrivalDate',
    columns: ['status', 'arrivalDate'],
    why: 'PortalLink reminder, D-3 queues and most dashboard counts',
  },
  {
    table: 'bookings',
    name: 'idx_bookings_isNumber',
    columns: ['isNumber'],
    why: 'Apple System reference lookups (AS import, reconcile sweep, drive log)',
  },
  {
    table: 'flights',
    name: 'idx_flights_date',
    columns: ['date'],
    why: "Today's-flights range scan on /api/overview and /api/dashboard/stats",
  },
]

type Row = Record<string, unknown>

async function main() {
  const host = process.env.DB_HOST?.trim()
  const port = Number(process.env.DB_PORT?.trim() || 3306)
  const user = process.env.DB_USERNAME?.trim()
  const password = process.env.DB_PASSWORD

  if (!host || !user || password == null) {
    console.error('✗ DB_HOST / DB_USERNAME / DB_PASSWORD are not all set — nothing to connect to.')
    process.exit(1)
  }

  const conn = await mysql.createConnection({ host, port, user, password, database: DATABASE })

  try {
    const [verRows] = await conn.query<Row[]>('SELECT VERSION() AS v, DATABASE() AS db')
    console.log(`Connected to ${host}:${port}`)
    console.log(`  database : ${verRows[0]?.db}`)
    console.log(`  server   : ${verRows[0]?.v}`)
    console.log(`  mode     : ${APPLY ? 'APPLY — missing indexes will be created' : 'REPORT ONLY — nothing will be written'}`)
    console.log('')

    let missing = 0
    let created = 0
    let skipped = 0

    for (const spec of INDEXES) {
      const label = `${spec.table}.${spec.name} (${spec.columns.join(', ')})`

      // 1. Does the table exist on this server?
      const [tables] = await conn.query<Row[]>(
        'SELECT table_name FROM information_schema.tables WHERE table_schema = ? AND table_name = ?',
        [DATABASE, spec.table],
      )
      if (tables.length === 0) {
        console.log(`⊘ ${label}\n    skipped — table \`${spec.table}\` does not exist in ${DATABASE}`)
        skipped++
        continue
      }

      // 2. Does every column exist? Guards against schema drift between
      //    schema.prisma and what is actually deployed on live.
      const [cols] = await conn.query<Row[]>(
        'SELECT column_name FROM information_schema.columns WHERE table_schema = ? AND table_name = ?',
        [DATABASE, spec.table],
      )
      const present = new Set(cols.map(c => String(c.column_name ?? c.COLUMN_NAME)))
      const absent = spec.columns.filter(c => !present.has(c))
      if (absent.length) {
        console.log(`⊘ ${label}\n    skipped — column(s) not on live: ${absent.join(', ')}`)
        skipped++
        continue
      }

      // 3. Is this index — or an index with the same leading columns — already
      //    there? A duplicate index costs write throughput and buffer pool for
      //    nothing, so an equivalent one counts as done.
      const [idxRows] = await conn.query<Row[]>(
        `SELECT index_name, seq_in_index, column_name
           FROM information_schema.statistics
          WHERE table_schema = ? AND table_name = ?
          ORDER BY index_name, seq_in_index`,
        [DATABASE, spec.table],
      )
      const byIndex = new Map<string, string[]>()
      for (const r of idxRows) {
        const n = String(r.index_name ?? r.INDEX_NAME)
        const c = String(r.column_name ?? r.COLUMN_NAME)
        byIndex.set(n, [...(byIndex.get(n) ?? []), c])
      }
      const equivalent = Array.from(byIndex.entries()).find(([, cols2]) =>
        spec.columns.every((c, i) => cols2[i] === c),
      )
      if (equivalent) {
        const [name] = equivalent
        console.log(`✓ ${label}\n    already covered by \`${name}\` (${byIndex.get(name)!.join(', ')})`)
        continue
      }

      // 4. Missing. Report the table size so the apply is an informed decision.
      const [sizeRows] = await conn.query<Row[]>(
        `SELECT table_rows AS approx_rows, ROUND(data_length / 1024 / 1024) AS mb
           FROM information_schema.tables
          WHERE table_schema = ? AND table_name = ?`,
        [DATABASE, spec.table],
      )
      const approxRows = Number(sizeRows[0]?.approx_rows ?? 0)
      missing++

      console.log(`● ${label}`)
      console.log(`    MISSING — ${spec.why}`)
      console.log(`    table is ~${approxRows.toLocaleString()} rows / ${sizeRows[0]?.mb ?? '?'} MB`)

      if (!APPLY) {
        console.log('    (report only — re-run with --apply to create it)')
        continue
      }

      const ddl =
        `ALTER TABLE \`${spec.table}\` ` +
        `ADD INDEX \`${spec.name}\` (${spec.columns.map(c => `\`${c}\``).join(', ')}), ` +
        `ALGORITHM=INPLACE, LOCK=NONE`

      const startedAt = Date.now()
      try {
        await conn.query(ddl)
        console.log(`    ✓ created online in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`)
        created++
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        // Duplicate key name — someone applied it between the check and here.
        if (/Duplicate key name/i.test(msg)) {
          console.log('    ✓ already present (created concurrently)')
          continue
        }
        console.log(`    ✗ NOT created — ${msg}`)
        console.log('      The table was left untouched. If the server refused')
        console.log('      ALGORITHM=INPLACE/LOCK=NONE, this index needs a maintenance window.')
      }
    }

    console.log('')
    console.log(`Summary: ${INDEXES.length} checked, ${missing} missing, ${created} created, ${skipped} skipped (not on this schema)`)
    if (!APPLY && missing > 0) {
      console.log('Nothing was written. Re-run with --apply to create the missing indexes.')
    }
  } finally {
    await conn.end()
  }
}

main().catch(err => {
  console.error('✗ failed:', err instanceof Error ? err.message : err)
  process.exit(1)
})
