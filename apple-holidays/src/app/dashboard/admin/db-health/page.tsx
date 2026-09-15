'use client'

/**
 * Settings → Database Health.
 *
 * One screen for the load this app puts on the primary database: what the
 * running process resolved for its connection pool, whether reads are going to
 * a replica, which performance indexes are actually present, and the two knobs
 * an operator can turn without a redeploy.
 *
 * It deliberately reports *resolved* values rather than echoing the .env. This
 * codebase has had production drift from local config before, and a health
 * screen that reads the wrong environment is worse than no health screen.
 */
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import {
  Database, Loader2, RefreshCw, CheckCircle2, AlertTriangle, XCircle,
  Gauge, Server, Split, Timer, Terminal,
} from 'lucide-react'
import Header from '@/components/layout/header'
import { Card, CardHeader, CardBody } from '@/components/ui/card'
import { readApiResponse } from '@/lib/utils'

interface Pool {
  connectionLimit: number
  poolTimeout: number
  connectTimeout: number
}

interface IndexRow {
  table: string
  name: string
  columns: string[]
  why: string
  present: boolean
  presentAs: string | null
}

interface Payload {
  connectedDb: { database: string; version: string } | null
  tuning: {
    primary: { host: string | null; database: string | null; pool: Pool }
    replica: { configured: boolean; host: string | null; url: string | null; pool: Pool; envEnabled: boolean }
  }
  replica: {
    configured: boolean
    host: string | null
    active: boolean
    lagSeconds: number | null
    readsEnabled: boolean
    pool: Pool
  }
  indexes: IndexRow[] | null
  connections: {
    threadsConnected: number | null
    threadsRunning: number | null
    maxUsedConnections: number | null
    maxConnections: number | null
  } | null
  settings: {
    db_replica_reads_enabled: string
    file_handler_sweep_minutes: string
  }
}

function Field({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="py-2">
      <div className="text-xs uppercase tracking-wide text-slate-400">{label}</div>
      <div className="text-sm text-slate-800 font-medium break-all">{value}</div>
      {hint && <div className="text-xs text-slate-500 mt-0.5">{hint}</div>}
    </div>
  )
}

export default function DatabaseHealthPage() {
  const [data, setData] = useState<Payload | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<string | null>(null)
  const [sweepDraft, setSweepDraft] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/admin/db-health', { cache: 'no-store' })
      const body = await readApiResponse<Payload>(res)
      if (!body.success || !body.data) {
        toast.error(body.error ?? 'Could not read database health')
        return
      }
      setData(body.data)
      setSweepDraft(body.data.settings.file_handler_sweep_minutes)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const save = useCallback(async (key: string, value: string) => {
    setSaving(key)
    try {
      const res = await fetch('/api/admin/db-health', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, value }),
      })
      const body = await readApiResponse(res)
      if (!body.success) {
        toast.error(body.error ?? 'Could not save')
        return
      }
      toast.success('Saved')
      await load()
    } finally {
      setSaving(null)
    }
  }, [load])

  const missingIndexes = data?.indexes?.filter(i => !i.present) ?? []

  return (
    <div className="min-h-screen bg-slate-50">
      <Header
        title="Database Health"
        subtitle="Connection pooling, read-replica routing and the indexes the schedulers depend on"
        actions={
          <button
            onClick={() => void load()}
            disabled={loading}
            className="inline-flex items-center gap-2 px-3 py-2 text-sm rounded-lg border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-50"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            Refresh
          </button>
        }
      />

      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        {loading && !data && (
          <Card><CardBody className="p-10 flex items-center justify-center text-slate-500 gap-2">
            <Loader2 className="w-5 h-5 animate-spin" /> Reading database health…
          </CardBody></Card>
        )}

        {data && (
          <>
            {/* ── Where this process is actually connected ───────────────── */}
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <Server className="w-4 h-4 text-slate-500" />
                  <h2 className="font-semibold text-slate-800">Primary connection</h2>
                </div>
                <p className="text-xs text-slate-500 mt-1">
                  Resolved by the running process — not read back from .env.
                </p>
              </CardHeader>
              <CardBody className="px-6 pb-5 grid sm:grid-cols-2 gap-x-8">
                <Field label="Host" value={data.tuning.primary.host ?? '—'} />
                <Field
                  label="Connected database"
                  value={data.connectedDb?.database || '—'}
                  hint={
                    data.connectedDb &&
                    data.tuning.primary.database &&
                    data.connectedDb.database !== data.tuning.primary.database
                      ? `⚠ DB_DATABASE says "${data.tuning.primary.database}" — the process is on "${data.connectedDb.database}"`
                      : undefined
                  }
                />
                <Field label="Server" value={data.connectedDb?.version || '—'} />
                <Field
                  label="Pool cap"
                  value={`${data.tuning.primary.pool.connectionLimit} connections`}
                  hint={`pool_timeout ${data.tuning.primary.pool.poolTimeout}s · connect_timeout ${data.tuning.primary.pool.connectTimeout}s`}
                />
              </CardBody>
            </Card>

            {/* ── Live connection counters ───────────────────────────────── */}
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <Gauge className="w-4 h-4 text-slate-500" />
                  <h2 className="font-semibold text-slate-800">Connections right now</h2>
                </div>
              </CardHeader>
              <CardBody className="px-6 pb-5">
                {data.connections ? (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                    {[
                      ['In use', data.connections.threadsConnected],
                      ['Running', data.connections.threadsRunning],
                      ['Peak since restart', data.connections.maxUsedConnections],
                      ['Server maximum', data.connections.maxConnections],
                    ].map(([label, n]) => (
                      <div key={String(label)} className="rounded-lg border border-slate-200 p-3">
                        <div className="text-2xl font-semibold text-slate-800">{n ?? '—'}</div>
                        <div className="text-xs text-slate-500">{label}</div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-slate-500">
                    The application database user is not permitted to read <code className="text-xs">SHOW GLOBAL STATUS</code>,
                    so live connection counters are unavailable. This is a privilege setting, not a fault —
                    read the same numbers from the RDS console.
                  </p>
                )}
              </CardBody>
            </Card>

            {/* ── Replica routing ────────────────────────────────────────── */}
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <Split className="w-4 h-4 text-slate-500" />
                  <h2 className="font-semibold text-slate-800">Read-replica routing</h2>
                </div>
                <p className="text-xs text-slate-500 mt-1">
                  Background sweeps and the read-only dashboard aggregates go to the replica; every write stays on the primary.
                </p>
              </CardHeader>
              <CardBody className="px-6 pb-5">
                {data.replica.configured ? (
                  <>
                    <div className="grid sm:grid-cols-2 gap-x-8">
                      <Field label="Replica host" value={data.replica.host ?? '—'} />
                      <Field
                        label="Replica pool cap"
                        value={`${data.replica.pool.connectionLimit} connections`}
                      />
                      <Field
                        label="Replication lag"
                        value={
                          data.replica.lagSeconds == null
                            ? 'not readable'
                            : `${data.replica.lagSeconds}s behind primary`
                        }
                        hint={
                          data.replica.lagSeconds == null
                            ? 'Needs the REPLICATION CLIENT privilege — check lag in the RDS console instead.'
                            : undefined
                        }
                      />
                    </div>

                    <label className="mt-4 flex items-start gap-3 rounded-lg border border-slate-200 p-4">
                      <input
                        type="checkbox"
                        className="mt-1"
                        checked={data.replica.readsEnabled}
                        disabled={saving === 'db_replica_reads_enabled'}
                        onChange={e => void save('db_replica_reads_enabled', e.target.checked ? 'true' : 'false')}
                      />
                      <span>
                        <span className="text-sm font-medium text-slate-800">Route read-only queries to the replica</span>
                        <span className="block text-xs text-slate-500 mt-0.5">
                          Turn this off to send every query back to the primary — the fast way back to
                          known-good behaviour if a replica ever falls badly behind. Takes effect on the
                          next query; no redeploy needed.
                        </span>
                      </span>
                    </label>
                  </>
                ) : (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                    <div className="flex items-center gap-2 font-medium">
                      <AlertTriangle className="w-4 h-4" /> No replica configured — all reads are on the primary
                    </div>
                    <p className="mt-2 text-amber-800">
                      Set <code className="text-xs">DB_READ_HOST</code> in the environment to start using one. It reuses the
                      primary&apos;s port, database, user and password, so the read side cannot drift onto a
                      different schema:
                    </p>
                    <pre className="mt-2 text-xs bg-white/70 rounded p-2 overflow-x-auto">DB_READ_HOST=aahaas-prod-database-5.crgimm6mohf1.ap-southeast-1.rds.amazonaws.com</pre>
                    <p className="mt-2 text-amber-800">
                      Set it in the Amplify environment, not only in local <code className="text-xs">.env</code> —
                      production reads its own configuration.
                    </p>
                  </div>
                )}
              </CardBody>
            </Card>

            {/* ── Indexes ────────────────────────────────────────────────── */}
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <Database className="w-4 h-4 text-slate-500" />
                  <h2 className="font-semibold text-slate-800">Scheduler indexes</h2>
                </div>
                <p className="text-xs text-slate-500 mt-1">
                  Without these, each sweep reads the whole table. Checked live against this database.
                </p>
              </CardHeader>
              <CardBody className="px-6 pb-5">
                {data.indexes ? (
                  <div className="space-y-2">
                    {data.indexes.map(ix => (
                      <div
                        key={`${ix.table}.${ix.name}`}
                        className="flex items-start gap-3 rounded-lg border border-slate-200 p-3"
                      >
                        {ix.present
                          ? <CheckCircle2 className="w-4 h-4 text-emerald-500 mt-0.5 flex-shrink-0" />
                          : <XCircle className="w-4 h-4 text-rose-500 mt-0.5 flex-shrink-0" />}
                        <div className="min-w-0">
                          <div className="text-sm font-medium text-slate-800">
                            {ix.table} ({ix.columns.join(', ')})
                          </div>
                          <div className="text-xs text-slate-500">{ix.why}</div>
                          {ix.present && ix.presentAs && ix.presentAs !== ix.name && (
                            <div className="text-xs text-slate-400 mt-0.5">present as “{ix.presentAs}”</div>
                          )}
                        </div>
                      </div>
                    ))}

                    {missingIndexes.length > 0 && (
                      <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
                        <div className="flex items-center gap-2 text-sm font-medium text-slate-800">
                          <Terminal className="w-4 h-4" />
                          {missingIndexes.length} index{missingIndexes.length === 1 ? '' : 'es'} missing
                        </div>
                        <p className="text-xs text-slate-600 mt-1">
                          Creating an index adds no rows and changes none. The migration builds them online
                          (<code>ALGORITHM=INPLACE, LOCK=NONE</code>), so the app keeps serving throughout.
                          Check first, then apply:
                        </p>
                        <pre className="mt-2 text-xs bg-white rounded p-2 overflow-x-auto">npm run db:indexes
npm run db:indexes -- --apply</pre>
                        <p className="text-xs text-slate-500 mt-2">
                          Never use <code>prisma db push</code> here — live has drifted from schema.prisma and a
                          push would try to reconcile all of it.
                        </p>
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-sm text-slate-500">Index state could not be read from this database.</p>
                )}
              </CardBody>
            </Card>

            {/* ── Sweep cadence ──────────────────────────────────────────── */}
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <Timer className="w-4 h-4 text-slate-500" />
                  <h2 className="font-semibold text-slate-800">Sweep cadence</h2>
                </div>
              </CardHeader>
              <CardBody className="px-6 pb-5">
                <div className="flex flex-wrap items-end gap-3">
                  <label className="text-sm">
                    <span className="block text-slate-700 mb-1">File-handler resolve sweep, every</span>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min={2}
                        max={120}
                        value={sweepDraft}
                        onChange={e => setSweepDraft(e.target.value)}
                        className="w-24 px-3 py-2 rounded-lg border border-slate-200 text-sm"
                      />
                      <span className="text-sm text-slate-600">minutes</span>
                      <button
                        onClick={() => void save('file_handler_sweep_minutes', sweepDraft)}
                        disabled={
                          saving === 'file_handler_sweep_minutes' ||
                          sweepDraft === data.settings.file_handler_sweep_minutes
                        }
                        className="px-3 py-2 text-sm rounded-lg bg-slate-900 text-white disabled:opacity-40"
                      >
                        {saving === 'file_handler_sweep_minutes' ? 'Saving…' : 'Save'}
                      </button>
                    </div>
                  </label>
                </div>
                <p className="text-xs text-slate-500 mt-3">
                  This is the sweep that replaces the “30sundays Aahaas” placeholder handler. It was the most
                  frequent of the background jobs at every 5 minutes. Raising it to 10–15 minutes roughly halves
                  or thirds its share of database load; the trade is that a placeholder handler stays on a new
                  booking for that much longer. The change is picked up on the next tick — no restart.
                </p>
              </CardBody>
            </Card>
          </>
        )}
      </div>
    </div>
  )
}
