/**
 * What may happen to a booking *after* it has been cancelled.
 *
 * Until now `CANCELLED` was the end of the line: an approved cancellation was
 * terminal, so a file cancelled by mistake — wrong ref pasted, an agent who
 * changed their mind an hour later, a duplicate raised against the live
 * booking instead of the draft — could only be rebuilt by hand, losing the
 * itinerary, the passengers and the whole audit trail with it.
 *
 * So a cancellation now has two shapes, and this module is the single place
 * that decides which one applies:
 *
 *   Recoverable  — the default. The booking is cancelled and reads as
 *                  cancelled everywhere, but for a limited window the people
 *                  named here can pull it back to exactly the status it held
 *                  before the request. Nothing is deleted at any point.
 *
 *   Full cancel  — a deliberate, sealed cancellation. The file is closed for
 *                  good: no recovery, at any time, by anybody. It is the
 *                  answer to "this booking is never coming back" — a chargeback
 *                  written off, a duplicate cleared out of the pipeline.
 *
 * Both live in `system_settings` (plain key/value rows, no schema change), and
 * the seal itself is recorded as an append-only `StatusEvent` marker rather
 * than a column, so nothing on the booking is ever overwritten to set it.
 */

import type { BookingStatus, UserRole } from '@prisma/client'

/* ── Setting keys ───────────────────────────────────────────────────────── */

export const CANCEL_POLICY_KEYS = {
  recoveryEnabled:    'cancel_recovery_enabled',
  recoveryWindowDays: 'cancel_recovery_window_days',
  recoveryAudience:   'cancel_recovery_audience',
  recoveryReason:     'cancel_recovery_require_reason',
  recoveryNotify:     'cancel_recovery_notify',
  fullEnabled:        'cancel_full_enabled',
  fullAudience:       'cancel_full_audience',
  fullConfirmRef:     'cancel_full_confirm_ref',
} as const

/* ── Who is allowed to act ──────────────────────────────────────────────── */

/**
 * Audiences, widest last. Each one contains the ones above it, so a policy is
 * a single choice rather than a checkbox grid that can be left in a state
 * nobody meant (accounts off, ops on).
 */
export type CancelAudience = 'admins' | 'accounts' | 'ops'

const ADMIN_ROLES: UserRole[] = ['SUPER_ADMIN', 'ULTRA_SUPER_ADMIN']
const ACCOUNTS_ROLES: UserRole[] = [...ADMIN_ROLES, 'AC_USER']
/** The desks that raise cancellations in the first place. */
const OPS_ROLES: UserRole[] = [...ACCOUNTS_ROLES, 'BT_USER', 'TE_USER', 'GT_VN_USER']

export const AUDIENCE_ROLES: Record<CancelAudience, UserRole[]> = {
  admins:   ADMIN_ROLES,
  accounts: ACCOUNTS_ROLES,
  ops:      OPS_ROLES,
}

export const AUDIENCE_LABELS: Record<CancelAudience, { title: string; blurb: string }> = {
  admins: {
    title: 'Admins only',
    blurb: 'Super Admin and Ultra Super Admin.',
  },
  accounts: {
    title: 'Accounts + Admins',
    blurb: 'The desk that signed the cancellation off can also undo it.',
  },
  ops: {
    title: 'Ops desks + Accounts + Admins',
    blurb: 'Anyone who can raise a cancellation can also ask for it back.',
  },
}

export function roleInAudience(role: UserRole | string, audience: CancelAudience): boolean {
  return AUDIENCE_ROLES[audience].includes(role as UserRole)
}

/* ── The policy itself ──────────────────────────────────────────────────── */

export interface CancellationPolicy {
  /** Cancelled bookings can be pulled back to their pre-cancellation status. */
  recoveryEnabled: boolean
  /** Days after the cancellation in which recovery is still open. 0 = no limit. */
  recoveryWindowDays: number
  recoveryAudience: CancelAudience
  /** A recovery has to say why, the same way the cancellation did. */
  recoveryRequireReason: boolean
  /** Tell the original requester and the accounts desk that it came back. */
  recoveryNotify: boolean
  /** The sealed, never-recoverable cancellation is offered at all. */
  fullEnabled: boolean
  fullAudience: CancelAudience
  /** Sealing asks for the booking reference to be typed out first. */
  fullConfirmRef: boolean
}

/**
 * Recovery ships ON with a two-week window: the mistakes this exists for
 * surface within hours, and an open-ended undo on a cancelled file is how a
 * booking quietly comes back to life months after the money was settled.
 *
 * The sealed full cancel ships OFF. It is irreversible, so it is opted into
 * deliberately rather than found by accident.
 */
export const DEFAULT_CANCEL_POLICY: CancellationPolicy = {
  recoveryEnabled: true,
  recoveryWindowDays: 14,
  recoveryAudience: 'accounts',
  recoveryRequireReason: true,
  recoveryNotify: true,
  fullEnabled: false,
  fullAudience: 'admins',
  fullConfirmRef: true,
}

/** Window presets offered in the settings card. 0 is "no limit". */
export const RECOVERY_WINDOW_STEPS = [1, 3, 7, 14, 30, 90, 0] as const

export function windowLabel(days: number): string {
  if (days <= 0) return 'No limit'
  if (days === 1) return '24 hours'
  if (days % 7 === 0 && days < 30) return `${days / 7} week${days === 7 ? '' : 's'}`
  return `${days} days`
}

function bool(v: string | null | undefined, fallback: boolean): boolean {
  if (v == null || v === '') return fallback
  return v === 'true' || v === '1'
}

function audience(v: string | null | undefined, fallback: CancelAudience): CancelAudience {
  return v === 'admins' || v === 'accounts' || v === 'ops' ? v : fallback
}

/**
 * The slice of `system_settings` this policy owns, spelled out rather than
 * taken as a bare string map so the settings page's own typed `Settings`
 * interface can be passed straight in.
 */
export interface CancellationSettingsSlice {
  cancel_recovery_enabled?: string | null
  cancel_recovery_window_days?: string | null
  cancel_recovery_audience?: string | null
  cancel_recovery_require_reason?: string | null
  cancel_recovery_notify?: string | null
  cancel_full_enabled?: string | null
  cancel_full_audience?: string | null
  cancel_full_confirm_ref?: string | null
}

/** Read the policy out of a raw `system_settings` key/value map. */
export function parseCancellationPolicy(raw: CancellationSettingsSlice): CancellationPolicy {
  const days = Number(raw.cancel_recovery_window_days)
  return {
    recoveryEnabled:       bool(raw.cancel_recovery_enabled, DEFAULT_CANCEL_POLICY.recoveryEnabled),
    recoveryWindowDays:    Number.isFinite(days) && days >= 0 && days <= 3650
      ? Math.floor(days)
      : DEFAULT_CANCEL_POLICY.recoveryWindowDays,
    recoveryAudience:      audience(raw.cancel_recovery_audience, DEFAULT_CANCEL_POLICY.recoveryAudience),
    recoveryRequireReason: bool(raw.cancel_recovery_require_reason, DEFAULT_CANCEL_POLICY.recoveryRequireReason),
    recoveryNotify:        bool(raw.cancel_recovery_notify, DEFAULT_CANCEL_POLICY.recoveryNotify),
    fullEnabled:           bool(raw.cancel_full_enabled, DEFAULT_CANCEL_POLICY.fullEnabled),
    fullAudience:          audience(raw.cancel_full_audience, DEFAULT_CANCEL_POLICY.fullAudience),
    fullConfirmRef:        bool(raw.cancel_full_confirm_ref, DEFAULT_CANCEL_POLICY.fullConfirmRef),
  }
}

/* ── The seal, written into the status trail ────────────────────────────── */

/**
 * A full cancel is recorded by prefixing its `StatusEvent` note with this
 * marker rather than by setting a column. The trail is append-only, so the
 * seal cannot be lost to a later write, and reading it back costs one query
 * that every booking page already makes.
 */
export const FULL_CANCEL_MARKER = '[FULL-CANCEL]'
export const RECOVERY_MARKER = '[RECOVERED]'

/** True if any event in the trail sealed this booking. */
export function isSealed(events: { note: string | null }[]): boolean {
  return events.some(e => e.note?.startsWith(FULL_CANCEL_MARKER))
}

/**
 * The cancellation record folded into the recovery event's note, so a booking
 * that comes back still carries who cancelled it, why, and what it cost —
 * even though the live columns are cleared for the next cancellation to use.
 */
export interface CancellationSnapshot {
  status: BookingStatus
  restoredTo: BookingStatus
  cancelledByName: string | null
  cancelledByEmail: string | null
  cancellationReason: string | null
  cancellationFees: unknown
  cancellationFeeTotal: string | null
  cancelRequestedAt: string | null
  cancelledAt: string | null
  cancelDecidedByName: string | null
  cancelDecidedAt: string | null
  cancelDecisionNote: string | null
}

export function buildRecoveryNote(reason: string, snapshot: CancellationSnapshot): string {
  return `${RECOVERY_MARKER} Cancellation reversed — booking restored to ${snapshot.restoredTo.replace(/_/g, ' ')}. `
    + `Reason: ${reason}\nPreserved cancellation record: ${JSON.stringify(snapshot)}`
}

/* ── Is this particular booking recoverable, right now, by this person? ─── */

export type RecoveryBlock =
  | 'not-cancelled'
  | 'policy-off'
  | 'sealed'
  | 'window-expired'
  | 'role'

export const RECOVERY_BLOCK_MESSAGES: Record<RecoveryBlock, string> = {
  'not-cancelled':  'Only a cancelled booking can be recovered',
  'policy-off':     'Cancellation recovery is switched off in Settings',
  'sealed':         'This booking was fully cancelled — a sealed cancellation can never be recovered',
  'window-expired': 'The recovery window for this cancellation has closed',
  'role':           'Your role is not allowed to recover a cancelled booking',
}

export interface RecoveryVerdict {
  allowed: boolean
  block: RecoveryBlock | null
  /** Status the booking would return to. */
  restoreTo: BookingStatus
  /** When the window shuts. Null when there is no limit or no clock started. */
  expiresAt: Date | null
  sealed: boolean
}

/**
 * The one place recovery eligibility is decided, so the button on the booking
 * page and the API route it calls can never disagree about the answer.
 *
 * The window is measured from the moment the cancellation actually took effect
 * (`cancelledAt`), falling back to the accounts decision and then the request —
 * an older row missing the first two is treated as having no clock rather than
 * as expired, so history is never locked out by a field that was never filled.
 */
export function evaluateRecovery(input: {
  policy: CancellationPolicy
  role: UserRole | string
  status: BookingStatus
  cancelPrevStatus: BookingStatus | null
  cancelledAt: Date | null
  cancelDecidedAt: Date | null
  cancelRequestedAt: Date | null
  sealed: boolean
  now?: Date
}): RecoveryVerdict {
  const { policy, role, status, sealed } = input
  const now = input.now ?? new Date()
  const restoreTo = (input.cancelPrevStatus ?? 'BT_CONFIRMED') as BookingStatus

  const clock = input.cancelledAt ?? input.cancelDecidedAt ?? input.cancelRequestedAt
  const expiresAt = policy.recoveryWindowDays > 0 && clock
    ? new Date(clock.getTime() + policy.recoveryWindowDays * 86_400_000)
    : null

  const verdict = (block: RecoveryBlock | null): RecoveryVerdict => ({
    allowed: block === null, block, restoreTo, expiresAt, sealed,
  })

  if (status !== 'CANCELLED') return verdict('not-cancelled')
  if (sealed) return verdict('sealed')
  if (!policy.recoveryEnabled) return verdict('policy-off')
  if (expiresAt && now > expiresAt) return verdict('window-expired')
  if (!roleInAudience(role, policy.recoveryAudience)) return verdict('role')
  return verdict(null)
}
