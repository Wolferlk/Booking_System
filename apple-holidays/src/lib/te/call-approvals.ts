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
import { normalizePhone } from './te-api'

export const APPROVALS_KEY = 'te_call_approvals'

/** Ledger is keyed by digits-only phone; oldest entries drop past this size. */
const MAX_ENTRIES = 3000

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

async function readLedger(): Promise<Ledger> {
  const row = await prisma.systemSetting.findUnique({ where: { key: APPROVALS_KEY } })
  if (!row?.value) return {}
  try {
    const parsed = JSON.parse(row.value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Ledger) : {}
  } catch {
    console.warn('[TE approvals] ledger holds unparseable JSON — starting empty')
    return {}
  }
}

async function writeLedger(ledger: Ledger): Promise<void> {
  let entries = Object.entries(ledger)
  if (entries.length > MAX_ENTRIES) {
    // Keep approved numbers and the most recent requests; a dropped stale entry
    // only costs the report an "approval unknown", never a wrong "approved".
    entries = entries
      .sort((a, b) => (b[1].approvedAt ?? b[1].requestedAt ?? '').localeCompare(a[1].approvedAt ?? a[1].requestedAt ?? ''))
      .slice(0, MAX_ENTRIES)
  }
  const json = JSON.stringify(Object.fromEntries(entries))
  await prisma.systemSetting.upsert({
    where: { key: APPROVALS_KEY },
    update: { value: json },
    create: { key: APPROVALS_KEY, value: json },
  })
}

/** Re-read before write so two admins approving at once cannot clobber each other. */
async function mutate(fn: (l: Ledger) => Ledger): Promise<void> {
  await writeLedger(fn(await readLedger()))
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

  await mutate(ledger => {
    const prev = ledger[key]
    return {
      ...ledger,
      [key]: {
        phone: key,
        bookingRef: opts.bookingRef ?? prev?.bookingRef ?? null,
        requestedAt: now,
        requestedBy: opts.actor ?? prev?.requestedBy ?? null,
        approvedAt: opts.alreadyApproved ? prev?.approvedAt ?? now : prev?.approvedAt ?? null,
      },
    }
  })
}

/** Mark a number as approved — from `already_allowed`, or from a connected call. */
export async function markApproved(phone: string, at: string = new Date().toISOString()): Promise<void> {
  const key = normalizePhone(phone)
  if (!key) return
  await mutate(ledger => {
    const prev = ledger[key]
    if (prev?.approvedAt) return ledger
    return {
      ...ledger,
      [key]: {
        phone: key,
        bookingRef: prev?.bookingRef ?? null,
        requestedAt: prev?.requestedAt ?? null,
        requestedBy: prev?.requestedBy ?? null,
        approvedAt: at,
      },
    }
  })
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
  approved: 'Approved',
  pending: 'Awaiting customer',
  not_requested: 'Not sent',
}
