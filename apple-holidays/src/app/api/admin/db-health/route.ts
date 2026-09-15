/**
 * Database Health — the read side of Settings → Database Health.
 *
 * Reports what this running process actually resolved, not what the .env is
 * supposed to say. That distinction has mattered on this codebase before: local
 * .env and the Amplify environment have drifted, and a diagnosis read off the
 * wrong one sends you chasing the wrong fault.
 *
 * Everything here is read-only. The GET runs SELECTs against information_schema
 * and SHOW STATUS; it changes nothing. The POST writes a single row to
 * `system_settings` and nothing else.
 */
import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { describeDbTuning } from '@/lib/db-tuning'
import { hasReplica, replicaLagSeconds, invalidateReplicaSwitch } from '@/lib/prisma-read'
import { DB_HEALTH_SETTINGS, DEFAULT_SWEEP_MINUTES } from '@/lib/db-health-settings'

export const dynamic = 'force-dynamic'

const ADMIN_ROLES = ['SUPER_ADMIN', 'ULTRA_SUPER_ADMIN']

/** The indexes `npm run db:indexes` maintains, mirrored here for the status list. */
const EXPECTED_INDEXES = [
  { table: 'bookings', name: 'idx_bookings_createdAt', columns: ['createdAt'], why: 'File-handler sweep date window (every 5 min)' },
  { table: 'bookings', name: 'idx_bookings_status_createdAt', columns: ['status', 'createdAt'], why: 'Portal link welcome sweep' },
  { table: 'bookings', name: 'idx_bookings_status_arrivalDate', columns: ['status', 'arrivalDate'], why: 'Portal link reminder and D-3 queues' },
  { table: 'bookings', name: 'idx_bookings_isNumber', columns: ['isNumber'], why: 'Apple System reference lookups' },
  { table: 'flights', name: 'idx_flights_date', columns: ['date'], why: "Today's flights on the overview screens" },
]

type Row = Record<string, unknown>

/** Which of the expected indexes are actually on the connected database. */
async function indexStatus() {
  const rows = await prisma.$queryRawUnsafe<Row[]>(
    `SELECT TABLE_NAME AS t, INDEX_NAME AS i, SEQ_IN_INDEX AS s, COLUMN_NAME AS c
       FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME IN ('bookings', 'flights')
      ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX`,
  )

  const byTableIndex = new Map<string, string[]>()
  for (const r of rows) {
    const key = `${String(r.t)}::${String(r.i)}`
    byTableIndex.set(key, [...(byTableIndex.get(key) ?? []), String(r.c)])
  }

  return EXPECTED_INDEXES.map(spec => {
    // An index with the same leading columns does the same job under a
    // different name — count it as present rather than telling an operator to
    // create a duplicate.
    const match = Array.from(byTableIndex.entries()).find(
      ([key, cols]) =>
        key.startsWith(`${spec.table}::`) && spec.columns.every((c, i) => cols[i] === c),
    )
    return {
      ...spec,
      present: Boolean(match),
      presentAs: match ? match[0].split('::')[1] : null,
    }
  })
}

/** Connection counters, when the app user is allowed to read them. */
async function connectionStats() {
  try {
    const status = await prisma.$queryRawUnsafe<Row[]>(
      `SHOW GLOBAL STATUS WHERE Variable_name IN ('Threads_connected', 'Threads_running', 'Max_used_connections')`,
    )
    const vars = await prisma.$queryRawUnsafe<Row[]>(
      `SHOW GLOBAL VARIABLES WHERE Variable_name = 'max_connections'`,
    )
    const read = (list: Row[], name: string) => {
      const hit = list.find(r => String(r.Variable_name) === name)
      const n = Number(hit?.Value)
      return Number.isFinite(n) ? n : null
    }
    return {
      threadsConnected: read(status, 'Threads_connected'),
      threadsRunning: read(status, 'Threads_running'),
      maxUsedConnections: read(status, 'Max_used_connections'),
      maxConnections: read(vars, 'max_connections'),
    }
  } catch {
    // SHOW GLOBAL STATUS needs PROCESS on some RDS parameter groups. Not having
    // it is a permissions fact, not a health problem — report nothing rather
    // than failing the whole screen.
    return null
  }
}

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session || !ADMIN_ROLES.includes(session.user.role)) return buildApiError('Forbidden', 403)

  const tuning = describeDbTuning()

  const [settingRows, indexes, connections, lag, connectedDb] = await Promise.all([
    prisma.systemSetting.findMany({
      where: { key: { in: DB_HEALTH_SETTINGS.map(s => s.key) } },
    }),
    indexStatus().catch(() => null),
    connectionStats(),
    replicaLagSeconds().catch(() => null),
    prisma
      .$queryRawUnsafe<Row[]>('SELECT DATABASE() AS db, VERSION() AS v')
      .then(r => ({ database: String(r[0]?.db ?? ''), version: String(r[0]?.v ?? '') }))
      .catch(() => null),
  ])

  const saved: Record<string, string> = {}
  settingRows.forEach(r => { saved[r.key] = r.value })

  return buildApiSuccess({
    connectedDb,
    tuning,
    replica: {
      ...tuning.replica,
      /** Whether this process has a replica client at all, after the env checks. */
      active: hasReplica(),
      lagSeconds: lag,
      /** Unset means on — configuring a replica host is itself the opt-in. */
      readsEnabled: saved[DB_HEALTH_SETTINGS[0].key] !== 'false',
    },
    indexes,
    connections,
    settings: {
      db_replica_reads_enabled: saved.db_replica_reads_enabled ?? 'true',
      file_handler_sweep_minutes: saved.file_handler_sweep_minutes ?? String(DEFAULT_SWEEP_MINUTES),
    },
  })
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session || !ADMIN_ROLES.includes(session.user.role)) return buildApiError('Forbidden', 403)

  const { key, value } = (await req.json()) as { key?: string; value?: string }
  const spec = DB_HEALTH_SETTINGS.find(s => s.key === key)
  if (!spec) return buildApiError('Unknown setting')

  const check = spec.validate(String(value ?? ''))
  if (!check.ok) return buildApiError(check.error)

  await prisma.systemSetting.upsert({
    where: { key: spec.key },
    create: { key: spec.key, value: check.value },
    update: { value: check.value },
  })

  // The replica gate is cached for a minute so it does not become a per-query
  // round trip; drop the cache so a toggle here takes effect on the next query
  // instead of up to 60 s later.
  if (spec.key === 'db_replica_reads_enabled') invalidateReplicaSwitch()

  return buildApiSuccess(null, 'Saved')
}
