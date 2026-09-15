/**
 * Read-only Prisma client, pointed at a read replica.
 *
 * ── What this is for ─────────────────────────────────────────────────────────
 * The background sweeps (AsWatchScheduler, PortalLinkScheduler, the file-handler
 * resolve sweep) and the heavy report screens do far more reading than writing,
 * and every one of those reads was landing on the primary while three replicas
 * sat at ~2% CPU. Routing those reads here moves the scan cost off the box that
 * also has to serve the live app's writes.
 *
 * ── The rule for using it ────────────────────────────────────────────────────
 * A replica is behind the primary by a small, unbounded amount. So:
 *
 *   ✅ Use {@link readDb} for shortlists over a *closed past window*, for
 *      reporting, for counts, and for anything whose follow-up write is guarded
 *      (an `updateMany` that re-asserts the value it expects to replace).
 *   ❌ Never use it for a read-modify-write on fresh rows, for an existence
 *      check that decides whether to create a row, or for anything read back
 *      immediately after writing it. Those stay on `prisma`.
 *
 * When no replica is configured — or when an operator switches replica reads off
 * on Settings → Database Health — `readDb()` returns the primary client. That is
 * exactly today's behaviour, so nothing here can break by being unconfigured.
 */
import { PrismaClient } from '@prisma/client'
import { prisma } from './prisma'
import { replicaUrl } from './db-tuning'

const globalForRead = globalThis as unknown as {
  prismaRead?: PrismaClient
  prismaReadUrl?: string
}

/**
 * The replica client, or null when no replica is configured.
 *
 * Cached on globalThis for the same reason the primary is — Next.js re-evaluates
 * modules in production, and a fresh PrismaClient per evaluation would recreate
 * the very connection storm this change exists to stop.
 */
function replicaClient(): PrismaClient | null {
  const url = replicaUrl()
  if (!url) return null

  if (globalForRead.prismaRead && globalForRead.prismaReadUrl === url) {
    return globalForRead.prismaRead
  }
  if (globalForRead.prismaRead) {
    void globalForRead.prismaRead.$disconnect().catch(() => {})
  }

  globalForRead.prismaReadUrl = url
  globalForRead.prismaRead = new PrismaClient({
    datasources: { db: { url } },
    log: ['error'],
  })
  return globalForRead.prismaRead
}

// ── Runtime kill switch ──────────────────────────────────────────────────────
// Read from system_settings so an operator can flip replica reads off without a
// redeploy — if a replica ever falls badly behind, that switch is the fast way
// back to known-good behaviour.
//
// Cached for CACHE_MS so the gate does not itself become a per-query round trip.
// It fails *open* (replica stays on) because the settings read goes to the
// primary, and the whole point of this module is to stop leaning on the primary.

const SETTING_KEY = 'db_replica_reads_enabled'
const CACHE_MS = 60_000

let cachedEnabled = true
let cachedAt = 0

async function replicaReadsEnabled(): Promise<boolean> {
  if (Date.now() - cachedAt < CACHE_MS) return cachedEnabled
  cachedAt = Date.now()
  try {
    const row = await prisma.systemSetting.findUnique({ where: { key: SETTING_KEY } })
    // Unset means on: configuring a replica host is itself the opt-in.
    cachedEnabled = row?.value !== 'false'
  } catch {
    cachedEnabled = true
  }
  return cachedEnabled
}

/** Drop the cached switch so a UI toggle takes effect on the next query. */
export function invalidateReplicaSwitch(): void {
  cachedAt = 0
}

/**
 * The client to use for a read-only query.
 *
 * Returns the replica when one is configured and switched on, and the primary
 * otherwise. Read the usage rule at the top of this file before calling it.
 */
export async function readDb(): Promise<PrismaClient> {
  const replica = replicaClient()
  if (!replica) return prisma
  if (!(await replicaReadsEnabled())) return prisma
  return replica
}

/** Whether this process has a replica configured at all — for the health screen. */
export function hasReplica(): boolean {
  return replicaClient() !== null
}

/**
 * Ask the replica how far behind it is, in seconds.
 *
 * `SHOW REPLICA STATUS` needs REPLICATION CLIENT, which the app user may not
 * hold; when it is refused, or the server is too old for the modern spelling,
 * this returns null rather than treating a permissions problem as lag.
 */
export async function replicaLagSeconds(): Promise<number | null> {
  const replica = replicaClient()
  if (!replica) return null

  for (const sql of ['SHOW REPLICA STATUS', 'SHOW SLAVE STATUS']) {
    try {
      const rows = await replica.$queryRawUnsafe<Record<string, unknown>[]>(sql)
      const row = rows?.[0]
      if (!row) continue
      const raw = row['Seconds_Behind_Master'] ?? row['Seconds_Behind_Source']
      if (raw == null) continue
      const n = Number(raw)
      return Number.isFinite(n) ? n : null
    } catch {
      // Try the other spelling; if both fail we simply have no lag reading.
    }
  }
  return null
}
