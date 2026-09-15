/**
 * Database health snapshot — read-only.
 *
 * Answers "why is the primary at 99.8% CPU?" with the server's own counters
 * instead of a guess. Every statement is a SHOW or an information_schema
 * SELECT; it writes nothing and takes no locks, so it is safe to run against
 * live at any time, including while the instance is struggling.
 *
 * ── How to read the output ───────────────────────────────────────────────────
 * The counters are cumulative since the last restart, so treat them as "what
 * this server has been doing", not "what it is doing this second". The three
 * that matter:
 *
 *   rows scanned per query   Handler_read_rnd_next / Questions. This is the
 *                            full-table-scan counter. Anything above a few
 *                            hundred means queries are reading their way
 *                            through tables rather than seeking an index, and
 *                            scanning rows that are already in RAM is pure CPU.
 *   buffer pool hit ratio    Below ~99% means the working set does not fit in
 *                            RAM and the instance is I/O bound. Above it, the
 *                            CPU is being spent on scanning, not on waiting.
 *                            These two want opposite fixes, which is why they
 *                            are read together.
 *   peak connections         Once Max_used_connections reaches max_connections,
 *                            new connections are refused — that is where Prisma
 *                            P1001 and P2024 come from, and no index will fix it.
 *
 * Usage:
 *   npx tsx scripts/db-health.mts
 */
import nextEnv from '@next/env'
import mysql from 'mysql2/promise'

nextEnv.loadEnvConfig(process.cwd())

/** Schemas on this instance worth sizing. Others are reported in the total. */
const SCHEMAS = ['apple_booking_system', 'invoice_processor']

type Row = Record<string, any>

const num = (v: unknown) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}
const fmt = (n: number) => n.toLocaleString()
const gb = (bytes: number) => `${(bytes / 1024 ** 3).toFixed(1)} GB`

async function main() {
  const host = process.env.DB_HOST?.trim()
  const user = process.env.DB_USERNAME?.trim()
  const password = process.env.DB_PASSWORD

  if (!host || !user || password == null) {
    console.error('✗ DB_HOST / DB_USERNAME / DB_PASSWORD are not all set.')
    process.exit(1)
  }

  const conn = await mysql.createConnection({
    host,
    port: Number(process.env.DB_PORT?.trim() || 3306),
    user,
    password,
  })

  try {
    const query = async (sql: string, params: unknown[] = []) =>
      (await conn.query<Row[]>(sql, params))[0]

    const varRows = await query(
      `SHOW GLOBAL VARIABLES WHERE Variable_name IN (
         'version', 'max_connections', 'innodb_buffer_pool_size',
         'long_query_time', 'slow_query_log', 'innodb_io_capacity')`,
    )
    const statRows = await query(
      `SHOW GLOBAL STATUS WHERE Variable_name IN (
         'Uptime', 'Questions', 'Threads_connected', 'Threads_running',
         'Max_used_connections', 'Slow_queries', 'Select_scan',
         'Select_full_join', 'Created_tmp_disk_tables',
         'Handler_read_rnd_next', 'Innodb_buffer_pool_read_requests',
         'Innodb_buffer_pool_reads')`,
    )

    const v: Record<string, string> = {}
    varRows.forEach(r => { v[String(r.Variable_name)] = String(r.Value) })
    const s: Record<string, number> = {}
    statRows.forEach(r => { s[String(r.Variable_name)] = num(r.Value) })

    const uptime = Math.max(s.Uptime, 1)
    const questions = Math.max(s.Questions, 1)
    const rowsPerQuery = s.Handler_read_rnd_next / questions
    const scanRate = s.Select_scan / uptime
    const hitRatio = s.Innodb_buffer_pool_read_requests > 0
      ? 100 * (1 - s.Innodb_buffer_pool_reads / s.Innodb_buffer_pool_read_requests)
      : 0

    console.log(`\n── Server ──────────────────────────────────────────────────`)
    console.log(`  host              ${host}`)
    console.log(`  version           ${v.version}`)
    console.log(`  uptime            ${(uptime / 3600).toFixed(1)} h`)
    console.log(`  buffer pool       ${gb(num(v.innodb_buffer_pool_size))}`)

    console.log(`\n── Load ────────────────────────────────────────────────────`)
    console.log(`  queries/sec       ${(questions / uptime).toFixed(1)}`)
    console.log(`  full scans/sec    ${scanRate.toFixed(2)}  (${((s.Select_scan / questions) * 100).toFixed(0)}% of all queries)`)
    console.log(`  rows scanned/query${String(Math.round(rowsPerQuery)).padStart(8)}   ← the CPU number`)
    console.log(`  joins w/o index   ${fmt(s.Select_full_join)}`)
    console.log(`  on-disk temp tbls ${fmt(s.Created_tmp_disk_tables)}`)
    console.log(`  slow queries      ${fmt(s.Slow_queries)}  (threshold ${v.long_query_time}s, log ${v.slow_query_log})`)

    if (rowsPerQuery > 500) {
      console.log(`\n  ⚠ ${Math.round(rowsPerQuery)} rows read sequentially per query — roughly`)
      console.log(`    ${fmt(Math.round((s.Handler_read_rnd_next / uptime)))} rows/sec scanned. Scanning rows that are`)
      console.log(`    already in RAM is exactly what burns CPU. Find the queries doing it:`)
      console.log(`    lower long_query_time to 1 in the RDS parameter group and read the slow log.`)
    }
    if (hitRatio < 99) {
      console.log(`\n  ⚠ buffer pool hit ratio ${hitRatio.toFixed(2)}% — the working set does not fit`)
      console.log(`    in RAM; this instance is I/O bound, not scan bound.`)
    }

    console.log(`\n── Connections ─────────────────────────────────────────────`)
    console.log(`  in use now        ${fmt(s.Threads_connected)}`)
    console.log(`  running now       ${fmt(s.Threads_running)}`)
    console.log(`  peak since boot   ${fmt(s.Max_used_connections)}`)
    console.log(`  server maximum    ${fmt(num(v.max_connections))}`)
    if (s.Max_used_connections >= num(v.max_connections)) {
      console.log(`\n  ⚠ the connection limit has been reached at least once. New connections`)
      console.log(`    are refused at that point — this is where Prisma P1001 and P2024 come`)
      console.log(`    from, and no index will change it. Cap the client pools instead`)
      console.log(`    (DB_POOL_LIMIT; see Settings → Database Health).`)
    }

    console.log(`\n── Data volume ─────────────────────────────────────────────`)
    for (const schema of SCHEMAS) {
      const [tot] = await query(
        `SELECT COUNT(*) AS n, SUM(data_length + index_length) AS bytes
           FROM information_schema.tables WHERE table_schema = ?`,
        [schema],
      )
      if (!tot || num(tot.n) === 0) continue
      console.log(`\n  ${schema} — ${gb(num(tot.bytes))} across ${fmt(num(tot.n))} tables`)

      const big = await query(
        `SELECT table_name AS t, table_rows AS r, data_length + index_length AS bytes
           FROM information_schema.tables
          WHERE table_schema = ?
          ORDER BY bytes DESC LIMIT 5`,
        [schema],
      )
      for (const r of big) {
        const rows = num(r.r)
        const bytes = num(r.bytes)
        // Bytes per row is the tell for blob-heavy tables: a sweep over one of
        // these moves far more data than its row count suggests.
        const perRow = rows > 0 ? bytes / rows : 0
        const flag = perRow > 20_000 ? '  ← blob-heavy' : ''
        console.log(
          `    ${gb(bytes).padStart(8)}  ${fmt(rows).padStart(9)} rows  ` +
          `${(perRow / 1024).toFixed(0).padStart(4)} KB/row  ${r.t}${flag}`,
        )
      }
    }

    console.log('')
  } finally {
    await conn.end()
  }
}

main().catch(err => {
  console.error('✗ failed:', err instanceof Error ? err.message : err)
  process.exit(1)
})
