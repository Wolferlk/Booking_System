/**
 * Agenda auto-generate: builds a new booking's movement chart in the background
 * about a minute after the booking lands, so the chart is ready before anyone
 * opens the agenda page.
 *
 * Why this exists: mail and OneDrive intake (which called `upsertAgenda` at
 * intake) are hard-disabled. Bookings now come in through the Apple System and
 * B2C watchers, which never built a chart, so the chart was only built when
 * someone first opened the agenda page and sat through the spinner.
 *
 * ── Safety ───────────────────────────────────────────────────────────────────
 *  • It only fills an EMPTY chart. The emptiness check runs again inside the
 *    save transaction, so a chart someone saved while the AI was working is
 *    never overwritten.
 *  • One run per booking at a time, across processes. The claim is an
 *    optimistic compare-and-set on a `system_settings` row
 *    (`agenda_autogen:<ref>`), which also holds the run's status for the page.
 *  • Failures back off (2 → 10 → 30 min) and stop after MAX_ATTEMPTS, so a
 *    booking the AI cannot handle does not burn tokens every tick.
 *  • It does not notify drivers or touch assignments. A new chart has none.
 *  • The switch is Settings → AI Token Controls → "Auto-Generate Agenda"
 *    (`ai_auto_agenda_generate`, ON unless set to 'false'). Turning it off
 *    stops the sweep. The page still builds a chart on open, as it did before.
 */
import { prisma } from '@/lib/prisma'
import { parse12h } from '@/lib/clock-time'
import { normaliseServiceType } from '@/lib/service-types'
import { logBookingEvent } from '@/lib/booking-logs'
import { generateAgendaForBooking, type GeneratedAgendaItem } from '@/lib/agenda-ai-generate'

// ── Tunables (env overrides; defaults are what was asked for) ─────────────────
const envNum = (name: string, fallback: number) => {
  const n = Number(process.env[name])
  return Number.isFinite(n) && n >= 0 ? n : fallback
}
/** How long after creation before the sweep builds the chart. */
export const AUTOGEN_DELAY_SEC   = envNum('AGENDA_AUTOGEN_DELAY_SEC', 60)
/** Only bookings created within this window are swept, so the backlog is never trawled. */
export const AUTOGEN_WINDOW_HRS  = envNum('AGENDA_AUTOGEN_WINDOW_HOURS', 72)
/** Charts built per tick. Each is one gpt-4o call (~20–60 s). */
export const AUTOGEN_BATCH       = Math.max(1, envNum('AGENDA_AUTOGEN_BATCH', 2))
export const MAX_ATTEMPTS        = 3
const BACKOFF_MIN                = [2, 10, 30]
/** A "running" claim older than this is treated as a crashed run and can be retaken. */
const STALE_RUN_MS               = 10 * 60_000

export const KEY = (ref: string) => `agenda_autogen:${ref}`
const SWITCH_KEY = 'ai_auto_agenda_generate'

export type AutoGenState = 'running' | 'done' | 'exists' | 'failed' | 'waiting'
/** 'backfill' = the Settings "create missing agendas" job (lib/agenda-backfill.ts). */
export type AutoGenTrigger = 'sweep' | 'page-open' | 'cron-http' | 'backfill'

export type AutoGenStatus = {
  state: AutoGenState
  trigger: AutoGenTrigger
  attempts: number
  startedAt: string
  finishedAt?: string | null
  items?: number
  descriptions?: number
  error?: string | null
  nextAttemptAt?: string | null
}

export function parseStatus(raw: string | null | undefined): AutoGenStatus | null {
  if (!raw) return null
  try {
    const s = JSON.parse(raw) as AutoGenStatus
    return s && typeof s.state === 'string' ? s : null
  } catch { return null }
}

export async function readAutoGenStatus(ref: string): Promise<AutoGenStatus | null> {
  const row = await prisma.systemSetting.findUnique({ where: { key: KEY(ref) } }).catch(() => null)
  return parseStatus(row?.value)
}

export async function isAutoGenEnabled(): Promise<boolean> {
  if (process.env.AGENDA_AUTOGEN_SWEEP === 'off') return false
  const row = await prisma.systemSetting.findUnique({ where: { key: SWITCH_KEY } }).catch(() => null)
  return row?.value !== 'false'
}

function isRunning(s: AutoGenStatus | null): boolean {
  return s?.state === 'running' && Date.now() - Date.parse(s.startedAt) < STALE_RUN_MS
}

/**
 * Whether a run may start now. The sweep respects backoff and the attempt cap;
 * opening the page does not.
 *
 * The backfill (`jobStartedAt` = when the Settings job began) is an explicit
 * operator request, so a booking the sweep gave up on before the job — or one
 * marked done/exists whose chart has since been emptied — gets a fresh go. But
 * each booking gets at most its normal attempts inside one job: once it has
 * failed out, or come back "waiting", since the job started, it is left alone.
 */
export function mayStart(s: AutoGenStatus | null, trigger: AutoGenTrigger, jobStartedAt?: number): boolean {
  if (!s) return true
  if (isRunning(s)) return false
  if (trigger === 'page-open') return true
  if (trigger === 'backfill') {
    const sinceJob = jobStartedAt !== undefined && Date.parse(s.finishedAt ?? s.startedAt) >= jobStartedAt
    if (!sinceJob) return true
    if (s.state === 'running') return true   // stale claim from a crashed run (isRunning ruled out a live one)
    if (s.state === 'waiting') return false
    if (s.state === 'failed' && !s.nextAttemptAt) return false
    if (s.nextAttemptAt && Date.parse(s.nextAttemptAt) > Date.now()) return false
    return s.state === 'failed'
  }
  if (s.state === 'done' || s.state === 'exists') return false
  if (s.state === 'failed' && s.attempts >= MAX_ATTEMPTS) return false
  if (s.nextAttemptAt && Date.parse(s.nextAttemptAt) > Date.now()) return false
  return true
}

/**
 * Compare-and-set claim. Returns the new status if this caller now owns the
 * run, or null if another process got there first.
 */
async function claim(ref: string, prev: { raw: string | null; status: AutoGenStatus | null }, trigger: AutoGenTrigger): Promise<AutoGenStatus | null> {
  const next: AutoGenStatus = {
    state: 'running', trigger,
    attempts: (prev.status?.attempts ?? 0) + (prev.status?.state === 'waiting' ? 0 : 1),
    startedAt: new Date().toISOString(),
  }
  const value = JSON.stringify(next)
  try {
    if (prev.raw === null) {
      await prisma.systemSetting.create({ data: { key: KEY(ref), value } })
      return next
    }
    const res = await prisma.systemSetting.updateMany({ where: { key: KEY(ref), value: prev.raw }, data: { value } })
    return res.count === 1 ? next : null
  } catch {
    return null   // unique-key race on create — someone else claimed it
  }
}

async function finish(ref: string, status: AutoGenStatus): Promise<AutoGenStatus> {
  const value = JSON.stringify({ ...status, finishedAt: new Date().toISOString() })
  await prisma.systemSetting.update({ where: { key: KEY(ref) }, data: { value } }).catch((err) => {
    console.error(`[AgendaAutoGen] ${ref}: could not record status:`, err instanceof Error ? err.message : err)
  })
  return parseStatus(value)!
}

function clock(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null
  const text = String(raw).trim()
  if (!text) return null
  return parse12h(text) ?? text
}

function validDate(raw: unknown): Date | null {
  const text = typeof raw === 'string' ? raw.trim().slice(0, 10) : ''
  if (!text) return null
  const d = new Date(text)
  if (Number.isNaN(d.getTime())) return null
  const y = d.getUTCFullYear()
  return y < 1900 || y > 2200 ? null : d
}

/**
 * Save a generated chart, but only into an empty one. Returns the number of
 * movements written, or null when the booking already had a chart by the time
 * we got here (someone saved one while the AI was working).
 */
async function saveIntoEmptyChart(ref: string, items: GeneratedAgendaItem[]): Promise<number | null> {
  const rows = items
    .map(item => ({ item, date: validDate(item.date) }))
    .filter((r): r is { item: GeneratedAgendaItem; date: Date } => {
      if (!r.date) console.warn(`[AgendaAutoGen] ${ref}: dropped a movement with no usable date (${String(r.item.date ?? 'blank')})`)
      return Boolean(r.date)
    })
  if (rows.length === 0) throw new Error('The AI returned no movements with a usable date')

  return prisma.$transaction(async (tx) => {
    const booking = await tx.booking.findUnique({
      where: { bookingRef: ref },
      select: { id: true, tourAgenda: { select: { id: true, _count: { select: { items: true } } } } },
    })
    if (!booking) throw new Error('Booking not found')
    if (booking.tourAgenda && booking.tourAgenda._count.items > 0) return null

    const agendaId = booking.tourAgenda?.id
      ?? (await tx.tourAgenda.create({ data: { bookingId: booking.id } })).id

    await (tx.agendaItem as any).createMany({
      data: rows.map(({ item, date }, index) => ({
        agendaId,
        date,
        location:    String(item.location ?? ''),
        fromPoint:   item.fromPoint ?? null,
        toPoint:     item.toPoint ?? null,
        details:     item.details ?? null,
        mealPlan:    item.mealPlan ?? null,
        meetingTime: clock(item.meetingTime),
        timeFrom:    clock(item.timeFrom),
        timeTo:      clock(item.timeTo),
        serviceType: normaliseServiceType(item.serviceType) ?? 'OWN_ARRANGEMENT',
        isLeisure:   typeof item.isLeisure === 'boolean' ? item.isLeisure : null,
        sortOrder:   index,
      })),
    })
    return rows.length
  }, { maxWait: 10_000, timeout: 30_000 })
}

async function chartSize(ref: string): Promise<number | null> {
  const b = await prisma.booking.findUnique({
    where: { bookingRef: ref },
    select: { tourAgenda: { select: { _count: { select: { items: true } } } } },
  })
  if (!b) return null
  return b.tourAgenda?._count.items ?? 0
}

/**
 * Build and save the chart for one booking if it has none. Safe to call from
 * anywhere, any number of times: concurrent calls collapse into one run, and
 * the others get the running status back immediately.
 */
export async function autoGenerateAgenda(ref: string, trigger: AutoGenTrigger, opts: { jobStartedAt?: number } = {}): Promise<AutoGenStatus> {
  const row = await prisma.systemSetting.findUnique({ where: { key: KEY(ref) } }).catch(() => null)
  const prev = { raw: row?.value ?? null, status: parseStatus(row?.value) }

  if (!mayStart(prev.status, trigger, opts.jobStartedAt)) return prev.status!
  const mine = await claim(ref, prev, trigger)
  if (!mine) return (await readAutoGenStatus(ref)) ?? { state: 'running', trigger, attempts: 1, startedAt: new Date().toISOString() }

  const t0 = Date.now()
  try {
    const before = await chartSize(ref)
    if (before === null) return await finish(ref, { ...mine, state: 'failed', attempts: MAX_ATTEMPTS, error: 'Booking not found' })
    if (before > 0) return await finish(ref, { ...mine, state: 'exists', items: before })

    const result = await generateAgendaForBooking(ref)
    if (!result.ok) {
      if (result.noItinerary) {
        // Nothing to build from yet — the itinerary may still be on its way.
        return await finish(ref, { ...mine, state: 'waiting', error: result.error, nextAttemptAt: new Date(Date.now() + 5 * 60_000).toISOString() })
      }
      throw new Error(result.error)
    }

    const saved = await saveIntoEmptyChart(ref, result.items)
    if (saved === null) {
      console.log(`[AgendaAutoGen] ${ref}: a chart was saved while the AI was working — left it alone`)
      return await finish(ref, { ...mine, state: 'exists' })
    }

    const secs = Math.round((Date.now() - t0) / 1000)
    console.log(`[AgendaAutoGen] ✓ ${ref}: ${saved} movement(s) in ${secs}s (${trigger})`)
    await logBookingEvent({
      bookingRef: ref, section: 'agenda', action: 'auto_generated', source: 'automation',
      actor: { name: 'AI Auto-Generate' },
      summary: `Movement chart auto-generated by AI — ${saved} movement${saved === 1 ? '' : 's'}${result.confirmationDescriptions.replaced ? `, ${result.confirmationDescriptions.replaced} description(s) from the confirmation` : ''}`,
      reason: trigger === 'sweep' ? 'Built in the background shortly after the booking was created'
        : trigger === 'backfill' ? 'Built by Settings → Create Missing Agendas (arrival-date backfill)'
        : 'Built when the agenda page was opened',
    }).catch(() => {})

    return await finish(ref, {
      ...mine, state: 'done', items: saved, error: null,
      descriptions: result.confirmationDescriptions.replaced,
    })
  } catch (err) {
    const msg = (err instanceof Error ? err.message : String(err)).slice(0, 500)
    console.error(`[AgendaAutoGen] ✗ ${ref} (attempt ${mine.attempts}/${MAX_ATTEMPTS}):`, msg)
    const wait = BACKOFF_MIN[Math.min(mine.attempts, BACKOFF_MIN.length) - 1] ?? 30
    return await finish(ref, {
      ...mine, state: 'failed', error: msg,
      nextAttemptAt: mine.attempts >= MAX_ATTEMPTS ? null : new Date(Date.now() + wait * 60_000).toISOString(),
    })
  }
}

/**
 * One sweep: new bookings (older than the delay, inside the window) with an
 * itinerary and no chart yet. Builds at most AUTOGEN_BATCH charts, oldest
 * first; the rest wait for the next tick.
 */
export async function runAgendaAutoGenerateSweep(trigger: AutoGenTrigger = 'sweep') {
  const summary = { candidates: 0, built: 0, skipped: 0, failed: 0, refs: [] as string[] }
  if (!(await isAutoGenEnabled())) return { ...summary, disabled: true }

  const now = Date.now()
  const candidates = await prisma.booking.findMany({
    where: {
      createdAt: { gte: new Date(now - AUTOGEN_WINDOW_HRS * 3_600_000), lte: new Date(now - AUTOGEN_DELAY_SEC * 1000) },
      status: { notIn: ['CANCELLED', 'PENDING_CANCELLATION'] },
      itineraryItems: { some: {} },
      OR: [{ tourAgenda: { is: null } }, { tourAgenda: { is: { items: { none: {} } } } }],
    },
    select: { bookingRef: true },
    orderBy: { createdAt: 'asc' },
    take: 50,
  })
  summary.candidates = candidates.length
  if (!candidates.length) return summary

  const states = await prisma.systemSetting.findMany({
    where: { key: { in: candidates.map(c => KEY(c.bookingRef)) } },
  })
  const byKey = new Map(states.map(s => [s.key, parseStatus(s.value)]))
  const due = candidates.filter(c => mayStart(byKey.get(KEY(c.bookingRef)) ?? null, 'sweep'))
  summary.skipped = candidates.length - due.length

  for (const c of due.slice(0, AUTOGEN_BATCH)) {
    const s = await autoGenerateAgenda(c.bookingRef, trigger)
    if (s.state === 'done') { summary.built++; summary.refs.push(c.bookingRef) }
    else if (s.state === 'failed') summary.failed++
    else summary.skipped++
  }
  return summary
}
