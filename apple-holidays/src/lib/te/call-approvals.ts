/**
 * WhatsApp call-approval ledger.
 *
 * A customer must accept a WhatsApp message before the bot is allowed to place
 * automated voice calls to their number. The upstream TE service owns that
 * permission, but it only answers per-number and only at the moment approval is
 * requested (`already_allowed` on the POST) — there is no list endpoint the
 * report could read. So ops keeps its own ledger: every approval request sent
 * from the dashboard is recorded here, and the state is resolved later by
 * combining the ledger with evidence from the call log.
 *
 * Stored as JSON in `SystemSetting` for the same reason the auto-report
 * schedules are — the live database carries schema drift and this is
 * low-volume configuration, not booking data. See `report-schedules.ts`.
 */
import { prisma } from '@/lib/prisma'
import { normalizePhone, teGet } from './te-api'

export const APPROVALS_KEY = 'te_call_approvals'

/**
 * One `SystemSetting` row per number, keyed `te_call_approval:<digits>`.
 *
 * The ledger used to be a single JSON blob under `APPROVALS_KEY`, but
 * `system_settings.value` is a TEXT column (64 KB) — it filled up after a few
 * hundred numbers and every later write failed silently, so sends from the
 * booking page never reached the Ops Board. The legacy blob is still read and
 * merged underneath the per-number rows; it is never written again.
 */
const ENTRY_PREFIX = 'te_call_approval:'

export type ApprovalState = 'approved' | 'pending' | 'not_requested'

export interface ApprovalEntry {
  phone: string
  bookingRef: string | null
  /** When the approval WhatsApp was last sent from ops. */
  requestedAt: string | null
  requestedBy: string | null
  /** Set once the customer accepted (upstream reported `already_allowed`). */
  approvedAt: string | null
}

type Ledger = Record<string, ApprovalEntry>

function parseJson<T>(value: string | null | undefined): T | null {
  if (!value) return null
  try { return JSON.parse(value) as T } catch { return null }
}

async function readLegacyBlob(): Promise<Ledger> {
  const row = await prisma.systemSetting.findUnique({ where: { key: APPROVALS_KEY } })
  const parsed = parseJson<Ledger>(row?.value)
  if (row?.value && !parsed) console.warn('[TE approvals] legacy ledger holds unparseable JSON — ignoring it')
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
}

async function readLedger(): Promise<Ledger> {
  const [legacy, rows] = await Promise.all([
    readLegacyBlob(),
    prisma.systemSetting.findMany({ where: { key: { startsWith: ENTRY_PREFIX } } }),
  ])
  const ledger: Ledger = { ...legacy }
  for (const row of rows) {
    const entry = parseJson<ApprovalEntry>(row.value)
    if (entry?.phone) ledger[entry.phone] = entry
  }
  return ledger
}

async function readEntry(key: string): Promise<ApprovalEntry | undefined> {
  const row = await prisma.systemSetting.findUnique({ where: { key: ENTRY_PREFIX + key } })
  return parseJson<ApprovalEntry>(row?.value) ?? (await readLegacyBlob())[key]
}

async function writeEntry(entry: ApprovalEntry): Promise<void> {
  const json = JSON.stringify(entry)
  await prisma.systemSetting.upsert({
    where: { key: ENTRY_PREFIX + entry.phone },
    update: { value: json },
    create: { key: ENTRY_PREFIX + entry.phone, value: json },
  })
}

export async function recordApprovalRequest(opts: {
  phone: string
  bookingRef?: string | null
  actor?: string | null
  alreadyApproved?: boolean
}): Promise<void> {
  const key = normalizePhone(opts.phone)
  if (!key) return
  const now = new Date().toISOString()

  const prev = await readEntry(key)
  await writeEntry({
    phone: key,
    bookingRef: opts.bookingRef ?? prev?.bookingRef ?? null,
    requestedAt: now,
    requestedBy: opts.actor ?? prev?.requestedBy ?? null,
    approvedAt: opts.alreadyApproved ? prev?.approvedAt ?? now : prev?.approvedAt ?? null,
  })
}

/** Mark a number as approved — from `already_allowed`, or from a connected call. */
export async function markApproved(
  phone: string,
  at: string = new Date().toISOString(),
  bookingRef?: string | null,
): Promise<void> {
  const key = normalizePhone(phone)
  if (!key) return
  const prev = await readEntry(key)
  if (prev?.approvedAt) return
  await writeEntry({
    phone: key,
    bookingRef: prev?.bookingRef ?? bookingRef ?? null,
    requestedAt: prev?.requestedAt ?? null,
    requestedBy: prev?.requestedBy ?? null,
    approvedAt: at,
  })
}

/**
 * Meta's real permission state for a batch of numbers, via the upstream
 * `GET approval?to=` — the same check behind the "Customer allows calls" chip on
 * the booking page. Numbers that come back allowed are written to the ledger, so
 * the next read does not have to ask again.
 *
 * Bounded on purpose: a board load must not wait on a slow upstream, so each
 * lookup has a short timeout and a number that fails is simply left out of the
 * result (the caller keeps whatever the ledger said). Results are cached for a
 * few minutes per server instance.
 */
const LIVE_TTL_MS = 10 * 60_000
const LIVE_TIMEOUT_MS = 4_000
const LIVE_CONCURRENCY = 8
const liveCache = new Map<string, { allowed: boolean; at: number }>()

export async function checkLivePermissions(
  targets: { phone: string; bookingRef?: string | null }[],
): Promise<Map<string, boolean>> {
  const out = new Map<string, boolean>()
  const queue: { phone: string; bookingRef?: string | null }[] = []
  const seen = new Set<string>()
  for (const t of targets) {
    const key = normalizePhone(t.phone)
    if (key.length < 8 || seen.has(key)) continue
    seen.add(key)
    const hit = liveCache.get(key)
    if (hit && Date.now() - hit.at < LIVE_TTL_MS) out.set(key, hit.allowed)
    else queue.push({ phone: key, bookingRef: t.bookingRef })
  }

  async function worker() {
    for (let t = queue.shift(); t; t = queue.shift()) {
      try {
        const res = await Promise.race([
          teGet<{ checked?: boolean; allowed?: boolean | null }>('approval', { to: t.phone }),
          new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), LIVE_TIMEOUT_MS)),
        ])
        if (typeof res?.allowed !== 'boolean') continue
        liveCache.set(t.phone, { allowed: res.allowed, at: Date.now() })
        out.set(t.phone, res.allowed)
        if (res.allowed) await markApproved(t.phone, undefined, t.bookingRef).catch(() => {})
      } catch { /* upstream slow or down — keep the ledger's answer */ }
    }
  }
  await Promise.all(Array.from({ length: LIVE_CONCURRENCY }, worker))
  return out
}

export async function getApprovalLedger(): Promise<Ledger> {
  return readLedger()
}

/**
 * Resolve the approval state of one number.
 *
 * `hasConnectedCall` is the strongest signal available: the bot cannot place a
 * WhatsApp call at all until the customer has accepted, so a call that actually
 * connected proves approval even when ops sent the request from somewhere the
 * ledger never saw.
 */
export function resolveApprovalState(
  entry: ApprovalEntry | undefined,
  hasConnectedCall: boolean,
): ApprovalState {
  if (entry?.approvedAt || hasConnectedCall) return 'approved'
  if (entry?.requestedAt) return 'pending'
  return 'not_requested'
}

export const APPROVAL_LABEL: Record<ApprovalState, string> = {
  approved: 'Accepted',
  pending: 'Sent',
  not_requested: 'Not sent',
}
