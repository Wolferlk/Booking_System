/**
 * Create Missing Agendas — Settings backfill for bookings whose movement chart
 * was never built.
 *
 * The 30 s auto-generate sweep (lib/agenda-auto-generate.ts) only looks at
 * bookings created in the last 72 h, so files that landed before it existed —
 * or that it gave up on — keep an empty chart until someone opens the agenda
 * page. This job lets an admin pick an ARRIVAL-date range and have every empty
 * chart in it built in the background, nearest arrival first.
 *
 * ── How it runs ──────────────────────────────────────────────────────────────
 *  • One job at a time, stored in `system_settings` (`agenda_backfill_job`).
 *  • The agenda auto-generate scheduler calls `runAgendaBackfillTick()` after
 *    each sweep (every 30 s, re-armed from the end of the run), so it survives
 *    the browser being closed. The cron route calls it too.
 *  • Every booking goes through `autoGenerateAgenda(ref, 'backfill')` — the
 *    same per-booking claim, the same "only fill an EMPTY chart" check inside
 *    the save transaction, the same backoff. A chart someone saved by hand is
 *    never touched.
 *  • Skipped on purpose: cancelled / pending-cancellation files, Hotel Only
 *    files (the agenda is waived), and files with no itinerary to build from.
 *  • Progress is read back from the per-booking status rows, so nothing has to
 *    count across processes.
 */
import type { BookingStatus } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import {
  autoGenerateAgenda, mayStart, parseStatus, KEY, MAX_ATTEMPTS,
  type AutoGenStatus,
} from '@/lib/agenda-auto-generate'

const JOB_KEY = 'agenda_backfill_job'
const envNum = (name: string, fallback: number) => {
  const n = Number(process.env[name])
  return Number.isFinite(n) && n > 0 ? n : fallback
}
/** Charts built at the same time per tick. Each is one gpt-4o call (~20–60 s). */
export const BACKFILL_CONCURRENCY = Math.min(5, envNum('AGENDA_BACKFILL_CONCURRENCY', 3))
/** Rough gpt-4o tokens per chart — the figure the AI Token Controls card uses. */
export const TOKENS_PER_CHART = 7_500
/** Longest range one job may cover. */
export const MAX_RANGE_DAYS = 400

export type BackfillJob = {
  state: 'running' | 'stopped' | 'finished'
  from: string            // YYYY-MM-DD, arrival date, inclusive
  to: string              // YYYY-MM-DD, arrival date, inclusive
  total: number           // buildable empty charts when the job started
  startedAt: string
  startedBy: string
  finishedAt?: string | null
  stoppedBy?: string | null
}

const DAY_MS = 86_400_000
const ACTIVE = { notIn: ['CANCELLED', 'PENDING_CANCELLATION'] as BookingStatus[] }
const EMPTY_CHART = { OR: [{ tourAgenda: { is: null } }, { tourAgenda: { is: { items: { none: {} } } } }] }

/** Parse a YYYY-MM-DD arrival date into the UTC-midnight instant it is stored as. */
export function parseDay(raw: unknown): Date | null {
  const text = typeof raw === 'string' ? raw.trim() : ''
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null
  const d = new Date(`${text}T00:00:00.000Z`)
  return Number.isNaN(d.getTime()) ? null : d
}

export function validateRange(from: unknown, to: unknown): { from: Date; toExclusive: Date; fromText: string; toText: string } | string {
  const f = parseDay(from), t = parseDay(to)
  if (!f || !t) return 'Pick both a From and a To arrival date (YYYY-MM-DD)'
  if (t < f) return 'The To date is before the From date'
  if ((t.getTime() - f.getTime()) / DAY_MS > MAX_RANGE_DAYS) return `Pick a range of ${MAX_RANGE_DAYS} days or less`
  return { from: f, toExclusive: new Date(t.getTime() + DAY_MS), fromText: String(from), toText: String(to) }
}

function parseJob(raw: string | null | undefined): BackfillJob | null {
  if (!raw) return null
  try {
    const j = JSON.parse(raw) as BackfillJob
    return j && typeof j.state === 'string' ? j : null
  } catch { return null }
}

export async function readBackfillJob(): Promise<BackfillJob | null> {
  const row = await prisma.systemSetting.findUnique({ where: { key: JOB_KEY } }).catch(() => null)
  return parseJob(row?.value)
}

async function writeJob(job: BackfillJob) {
  const value = JSON.stringify(job)
  await prisma.systemSetting.upsert({ where: { key: JOB_KEY }, create: { key: JOB_KEY, value }, update: { value } })
}

export function backfillKilledByEnv(): boolean {
  return process.env.AGENDA_AUTOGEN_SWEEP === 'off'
}

type MissingRow = {
  bookingRef: string
  arrivalDate: Date
  status: string
  operationCountry: string | null
  hotelOnly: boolean
  agent: string | null
  hasItinerary: boolean
}

async function missingInRange(from: Date, toExclusive: Date): Promise<MissingRow[]> {
  const rows = await prisma.booking.findMany({
    where: { arrivalDate: { gte: from, lt: toExclusive }, status: ACTIVE, ...EMPTY_CHART },
    select: {
      bookingRef: true, arrivalDate: true, status: true, operationCountry: true, hotelOnly: true, agent: true,
      _count: { select: { itineraryItems: true } },
    },
    orderBy: [{ arrivalDate: 'asc' }, { bookingRef: 'asc' }],
  })
  return rows.map(r => ({
    bookingRef: r.bookingRef, arrivalDate: r.arrivalDate, status: r.status,
    operationCountry: r.operationCountry, hotelOnly: r.hotelOnly, agent: r.agent,
    hasItinerary: r._count.itineraryItems > 0,
  }))
}

async function statesFor(refs: string[]): Promise<Map<string, AutoGenStatus | null>> {
  const map = new Map<string, AutoGenStatus | null>()
  for (let i = 0; i < refs.length; i += 500) {
    const chunk = refs.slice(i, i + 500)
    const rows = await prisma.systemSetting.findMany({ where: { key: { in: chunk.map(KEY) } } })
    for (const r of rows) map.set(r.key.slice('agenda_autogen:'.length), parseStatus(r.value))
  }
  return map
}

const buildable = (r: MissingRow) => !r.hotelOnly && r.hasItinerary

/** Everything the Settings card shows for a range — counts plus the list of empty charts. */
export async function summariseRange(fromRaw: unknown, toRaw: unknown) {
  const range = validateRange(fromRaw, toRaw)
  if (typeof range === 'string') throw new Error(range)

  const [arrivals, missing] = await Promise.all([
    prisma.booking.count({ where: { arrivalDate: { gte: range.from, lt: range.toExclusive }, status: ACTIVE } }),
    missingInRange(range.from, range.toExclusive),
  ])
  const states = await statesFor(missing.map(m => m.bookingRef))
  const canBuild = missing.filter(buildable)
  const gaveUp = canBuild.filter(m => {
    const s = states.get(m.bookingRef)
    return s?.state === 'failed' && s.attempts >= MAX_ATTEMPTS
  }).length

  const byMonth: Record<string, { missing: number; buildable: number }> = {}
  for (const m of missing) {
    const k = m.arrivalDate.toISOString().slice(0, 7)
    byMonth[k] ??= { missing: 0, buildable: 0 }
    byMonth[k].missing++
    if (buildable(m)) byMonth[k].buildable++
  }

  return {
    from: range.fromText,
    to: range.toText,
    arrivals,
    withAgenda: arrivals - missing.length,
    missing: missing.length,
    buildable: canBuild.length,
    hotelOnly: missing.filter(m => m.hotelOnly).length,
    noItinerary: missing.filter(m => !m.hotelOnly && !m.hasItinerary).length,
    gaveUpBefore: gaveUp,
    estimatedTokens: canBuild.length * TOKENS_PER_CHART,
    byMonth: Object.entries(byMonth).sort(([a], [b]) => a.localeCompare(b)).map(([month, v]) => ({ month, ...v })),
    // The card lists these; capped so a year-wide range stays a light response.
    rows: missing.slice(0, 300).map(m => {
      const s = states.get(m.bookingRef) ?? null
      return {
        bookingRef: m.bookingRef,
        arrivalDate: m.arrivalDate.toISOString().slice(0, 10),
        status: m.status,
        country: m.operationCountry,
        agent: m.agent,
        reason: m.hotelOnly ? 'hotel-only' : !m.hasItinerary ? 'no-itinerary' : null,
        autogen: s ? { state: s.state, attempts: s.attempts, error: s.error ?? null, trigger: s.trigger } : null,
      }
    }),
    rowsTruncated: missing.length > 300,
  }
}

/** The job plus live progress, read back from the per-booking status rows. */
export async function backfillProgress() {
  const job = await readBackfillJob()
  if (!job) return { job: null, progress: null }
  const since = Date.parse(job.startedAt)
  const rows = await prisma.systemSetting.findMany({
    where: { key: { startsWith: 'agenda_autogen:' }, value: { contains: '"trigger":"backfill"' } },
  })
  let built = 0, failed = 0, retrying = 0, waiting = 0, alreadyHad = 0
  const running: string[] = []
  const recent: { bookingRef: string; state: string; items?: number; error?: string | null; at: string }[] = []
  for (const r of rows) {
    const s = parseStatus(r.value)
    if (!s || Date.parse(s.startedAt) < since) continue
    const ref = r.key.slice('agenda_autogen:'.length)
    if (s.state === 'done') built++
    else if (s.state === 'exists') alreadyHad++
    else if (s.state === 'waiting') waiting++
    else if (s.state === 'running') running.push(ref)
    else if (s.state === 'failed') { if (s.nextAttemptAt) retrying++; else failed++ }
    recent.push({ bookingRef: ref, state: s.state, items: s.items, error: s.error ?? null, at: s.finishedAt ?? s.startedAt })
  }
  recent.sort((a, b) => b.at.localeCompare(a.at))
  return {
    job,
    progress: {
      built, failed, retrying, waiting, alreadyHad, running,
      remaining: Math.max(0, job.total - built - failed - alreadyHad - waiting),
      recent: recent.slice(0, 25),
    },
  }
}

export async function startBackfill(fromRaw: unknown, toRaw: unknown, startedBy: string): Promise<BackfillJob> {
  if (backfillKilledByEnv()) throw new Error('Agenda auto-generate is switched off on this server (AGENDA_AUTOGEN_SWEEP=off)')
  const range = validateRange(fromRaw, toRaw)
  if (typeof range === 'string') throw new Error(range)
  const current = await readBackfillJob()
  if (current?.state === 'running') throw new Error(`A job is already running (${current.from} → ${current.to}). Stop it first.`)

  const total = (await missingInRange(range.from, range.toExclusive)).filter(buildable).length
  if (total === 0) throw new Error('Every booking in this range already has an agenda (or cannot have one built)')

  const job: BackfillJob = {
    state: 'running', from: range.fromText, to: range.toText, total,
    startedAt: new Date().toISOString(), startedBy, finishedAt: null,
  }
  await writeJob(job)
  console.log(`[AgendaBackfill] started by ${startedBy}: arrivals ${job.from} → ${job.to}, ${total} chart(s) to build`)
  return job
}

export async function stopBackfill(stoppedBy: string): Promise<BackfillJob | null> {
  const job = await readBackfillJob()
  if (!job || job.state !== 'running') return job
  const next: BackfillJob = { ...job, state: 'stopped', finishedAt: new Date().toISOString(), stoppedBy }
  await writeJob(next)
  console.log(`[AgendaBackfill] stopped by ${stoppedBy}`)
  return next
}

let ticking = false

/**
 * One backfill pass: builds up to BACKFILL_CONCURRENCY empty charts in the
 * job's range, nearest arrival first. Marks the job finished once nothing is
 * left to start and nothing is waiting on a retry.
 */
export async function runAgendaBackfillTick() {
  if (ticking || backfillKilledByEnv()) return null
  const job = await readBackfillJob()
  if (!job || job.state !== 'running') return null
  ticking = true
  try {
    const range = validateRange(job.from, job.to)
    if (typeof range === 'string') return null
    const since = Date.parse(job.startedAt)

    const candidates = (await missingInRange(range.from, range.toExclusive)).filter(buildable)
    const states = await statesFor(candidates.map(c => c.bookingRef))
    const due = candidates.filter(c => mayStart(states.get(c.bookingRef) ?? null, 'backfill', since))
    const pending = candidates.filter(c => {
      const s = states.get(c.bookingRef)
      return s && (s.state === 'running' || (s.state === 'failed' && !!s.nextAttemptAt))
    })

    if (due.length === 0) {
      if (pending.length === 0) {
        // Re-read so a Stop pressed during this pass is not overwritten.
        const latest = await readBackfillJob()
        if (latest?.state === 'running' && latest.startedAt === job.startedAt) {
          await writeJob({ ...latest, state: 'finished', finishedAt: new Date().toISOString() })
          console.log(`[AgendaBackfill] finished: arrivals ${job.from} → ${job.to}`)
        }
      }
      return { built: 0, failed: 0, due: 0 }
    }

    const results = await Promise.all(
      due.slice(0, BACKFILL_CONCURRENCY).map(c =>
        autoGenerateAgenda(c.bookingRef, 'backfill', { jobStartedAt: since })
          .then(s => ({ ref: c.bookingRef, state: s.state }))
          .catch(err => {
            console.error(`[AgendaBackfill] ${c.bookingRef}:`, err instanceof Error ? err.message : err)
            return { ref: c.bookingRef, state: 'failed' as const }
          }),
      ),
    )
    const built = results.filter(r => r.state === 'done')
    const failed = results.filter(r => r.state === 'failed')
    if (built.length || failed.length) {
      console.log(`[AgendaBackfill] built ${built.length}, failed ${failed.length}, ${due.length - results.length} more due${built.length ? ` — ${built.map(r => r.ref).join(', ')}` : ''}`)
    }
    return { built: built.length, failed: failed.length, due: due.length }
  } finally {
    ticking = false
  }
}
