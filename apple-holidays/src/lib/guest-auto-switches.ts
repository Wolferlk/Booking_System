/**
 * Per-booking guest automation state — storage only (Prisma, no side effects).
 *
 * Kept free of WhatsApp / call-service imports on purpose: the message sweeps in
 * `customer-whatsapp-automation.ts` and `b2c-guest-engage.ts` read it, and the
 * engage actions in `guest-automation.ts` write it, so a dependency on either
 * would make an import cycle.
 *
 * Two kinds of row, both in `system_settings` (no schema change, low volume):
 *
 *   guest_auto:<REF>    The two switches. Absent = both ON (the default).
 *                       Turning one OFF needs an emailed code (GUEST_AUTOMATION_OFF);
 *                       turning it back ON does not.
 *   guest_engage:<REF>  The approval journey started when a WhatsApp number is
 *                       assigned: approval request → registration → up to two
 *                       24-hour reminders → allowed / no response.
 */
import { prisma } from '@/lib/prisma'

export const SWITCH_PREFIX = 'guest_auto:'
export const ENGAGE_PREFIX = 'guest_engage:'
/** Global kill-switch for "assigning a number engages the guest". Default ON. */
export const SETTING_ENGAGE_ON_ASSIGN = 'auto_guest_engage_on_assign_enabled'

export type GuestAutoKind = 'messages' | 'calls'

export interface GuestAutoSwitches {
  messages: boolean
  calls: boolean
  /** Last change to either switch — the audit line shown on the booking. */
  changedBy: string | null
  changedAt: string | null
  reason: string | null
}

const DEFAULT_SWITCHES: GuestAutoSwitches = { messages: true, calls: true, changedBy: null, changedAt: null, reason: null }

function parse<T>(v: string | null | undefined): T | null {
  if (!v) return null
  try { return JSON.parse(v) as T } catch { return null }
}

const keyOf = (ref: string) => ref.trim().toUpperCase()

export async function getGuestAutoSwitches(bookingRef: string): Promise<GuestAutoSwitches> {
  const row = await prisma.systemSetting.findUnique({ where: { key: SWITCH_PREFIX + keyOf(bookingRef) } })
  return { ...DEFAULT_SWITCHES, ...(parse<Partial<GuestAutoSwitches>>(row?.value) ?? {}) }
}

export async function isGuestAutoOff(bookingRef: string, kind: GuestAutoKind): Promise<boolean> {
  return !(await getGuestAutoSwitches(bookingRef))[kind]
}

/** Booking refs (upper-case) with this automation switched OFF — for sweep filters. */
export async function guestAutoOffRefs(kind: GuestAutoKind): Promise<string[]> {
  const rows = await prisma.systemSetting.findMany({ where: { key: { startsWith: SWITCH_PREFIX } } })
  return rows
    .filter(r => parse<Partial<GuestAutoSwitches>>(r.value)?.[kind] === false)
    .map(r => r.key.slice(SWITCH_PREFIX.length))
}

export async function writeGuestAutoSwitches(bookingRef: string, next: GuestAutoSwitches): Promise<void> {
  const key = SWITCH_PREFIX + keyOf(bookingRef)
  const value = JSON.stringify(next)
  await prisma.systemSetting.upsert({ where: { key }, update: { value }, create: { key, value } })
}

// ─── Approval journey ────────────────────────────────────────────────────────

export type ApprovalStage = 'allowed' | 'requested' | 'rate-limited' | 'failed'

export interface EngageReminder {
  at: string
  /** A fresh call-permission request, or a template text pointing at the earlier one. */
  via: 'approval-request' | 'template-text'
  ok: boolean
  detail?: string
}

export interface GuestEngageJourney {
  phone: string
  startedAt: string
  startedBy: string
  trigger: string
  approval: {
    stage: ApprovalStage
    requestedAt: string | null
    allowedAt: string | null
    lastCheckedAt: string | null
    reminders: EngageReminder[]
    detail?: string
  }
  registration: {
    state: 'registered' | 'existing' | 'skipped' | 'failed'
    at: string
    detail?: string
  }
  /** Set when the journey is over. */
  finished?: { outcome: 'allowed' | 'no-response' | 'stopped'; at: string; detail?: string }
}

export async function getEngageJourney(bookingRef: string): Promise<GuestEngageJourney | null> {
  const row = await prisma.systemSetting.findUnique({ where: { key: ENGAGE_PREFIX + keyOf(bookingRef) } })
  return parse<GuestEngageJourney>(row?.value)
}

export async function writeEngageJourney(bookingRef: string, j: GuestEngageJourney): Promise<void> {
  const key = ENGAGE_PREFIX + keyOf(bookingRef)
  const value = JSON.stringify(j)
  await prisma.systemSetting.upsert({ where: { key }, update: { value }, create: { key, value } })
}

/** Journeys still waiting on the guest's Allow tap. */
export async function openEngageJourneys(): Promise<{ bookingRef: string; journey: GuestEngageJourney }[]> {
  const rows = await prisma.systemSetting.findMany({ where: { key: { startsWith: ENGAGE_PREFIX } } })
  return rows.flatMap(r => {
    const j = parse<GuestEngageJourney>(r.value)
    if (!j || j.finished || j.approval.stage === 'allowed') return []
    return [{ bookingRef: r.key.slice(ENGAGE_PREFIX.length), journey: j }]
  })
}

/**
 * Start reminder tracking for an approval request sent elsewhere (the B2C
 * auto-engage). Never overwrites a journey already running for the same number.
 */
export async function trackApprovalRequest(p: {
  bookingRef: string; phone: string; actor: string; trigger: string
  stage: ApprovalStage; registered: boolean
}): Promise<void> {
  const existing = await getEngageJourney(p.bookingRef)
  if (existing && existing.phone === p.phone && !existing.finished) return
  const now = new Date().toISOString()
  await writeEngageJourney(p.bookingRef, {
    phone: p.phone, startedAt: now, startedBy: p.actor, trigger: p.trigger,
    approval: {
      stage: p.stage,
      requestedAt: p.stage === 'requested' || p.stage === 'rate-limited' ? now : null,
      allowedAt: p.stage === 'allowed' ? now : null,
      lastCheckedAt: now, reminders: [],
    },
    registration: { state: p.registered ? 'registered' : 'skipped', at: now },
    ...(p.stage === 'allowed' ? { finished: { outcome: 'allowed' as const, at: now } } : {}),
  })
}
