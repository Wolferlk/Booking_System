/**
 * Guest automation for one booking.
 *
 *  GET   switches (auto messages / auto AI calls), the approval journey
 *        (request → reminders → allowed), and the AI-call service state.
 *  POST  { action: 'set', kinds: ['messages'|'calls'], on: boolean, reason?,
 *          verificationId?, verificationCode? }
 *          Turning OFF requires the emailed code (GUEST_AUTOMATION_OFF), bound
 *          to exactly these kinds. Turning ON needs no code.
 *        { action: 'start' } — send the approval request + register now
 *          (restarts a finished journey).
 */
import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { canSeeAllCountries } from '@/lib/rbac'
import { isInCountryScope } from '@/lib/country-detection'
import { requireVerification, VERIFY_ACTION } from '@/lib/action-verification'
import { logActivity, ACTION } from '@/lib/activity'
import { getApprovalEntry } from '@/lib/te/call-approvals'
import { getGuestAutoSwitches, getEngageJourney, SETTING_ENGAGE_ON_ASSIGN } from '@/lib/guest-auto-switches'
import { autoEngageGuest, setGuestAutomation, MAX_REMINDERS } from '@/lib/guest-automation'
import { GUEST_AUTOMATION_ROLES, guestAutomationKinds, guestAutomationTarget } from '@/lib/guest-automation-access'
import type { UserRole } from '@prisma/client'

export const dynamic = 'force-dynamic'

async function gate(ref: string) {
  const session = await getServerSession(authOptions)
  if (!session) return { error: buildApiError('Unauthorized', 401) }
  const role = session.user.role as UserRole
  if (!GUEST_AUTOMATION_ROLES.includes(role)) return { error: buildApiError('Forbidden', 403) }
  const booking = await prisma.booking.findUnique({
    where: { bookingRef: ref },
    select: { bookingRef: true, operationCountry: true, contactWhatsapp: true },
  })
  if (!booking) return { error: buildApiError('Booking not found', 404) }
  const userCountry = session.user.country as string | undefined
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (!canSeeAllCountries(role, userCountry as any) && userCountry && userCountry !== 'ALL' &&
      !isInCountryScope(booking.operationCountry, userCountry)) {
    return { error: buildApiError('Forbidden', 403) }
  }
  return { session, role, booking }
}

async function snapshot(bookingRef: string, whatsapp: string | null) {
  const [switches, journey, svc, onAssign] = await Promise.all([
    getGuestAutoSwitches(bookingRef),
    getEngageJourney(bookingRef),
    prisma.tbl_te_service.findUnique({ where: { booking_ref: bookingRef }, select: { status: true, call_phone: true } }).catch(() => null),
    prisma.systemSetting.findUnique({ where: { key: SETTING_ENGAGE_ON_ASSIGN } }),
  ])
  const ledger = whatsapp ? await getApprovalEntry(whatsapp).catch(() => null) : null
  return {
    switches,
    journey,
    maxReminders: MAX_REMINDERS,
    allowedCalls: Boolean(ledger?.approvedAt) || journey?.approval.stage === 'allowed',
    aiService: svc ? { status: svc.status, callPhone: svc.call_phone } : null,
    engageOnAssign: onAssign?.value !== 'false',
  }
}

export async function GET(_req: NextRequest, { params }: { params: { ref: string } }) {
  const g = await gate(params.ref)
  if ('error' in g) return g.error
  return buildApiSuccess(await snapshot(g.booking.bookingRef, g.booking.contactWhatsapp))
}

export async function POST(req: NextRequest, { params }: { params: { ref: string } }) {
  const g = await gate(params.ref)
  if ('error' in g) return g.error
  const { session, booking } = g
  const actor = session.user.name || session.user.email || 'staff'
  const body = await req.json().catch(() => ({})) as Record<string, unknown>

  if (body.action === 'start') {
    const r = await autoEngageGuest({ bookingRef: booking.bookingRef, actor, trigger: 'manual', force: true })
    if (r.status === 'skipped') return buildApiError(r.reason ?? 'Could not start')
    await logActivity({
      userId: session.user.id, action: ACTION.BOOKING_UPDATED, entityType: 'Booking', entityId: booking.bookingRef,
      details: { guestAutomation: 'approval-request-started', approval: r.approval, registration: r.registration },
    })
    return buildApiSuccess({ result: r, ...(await snapshot(booking.bookingRef, booking.contactWhatsapp)) })
  }

  if (body.action !== 'set') return buildApiError('Unknown action')
  const kinds = guestAutomationKinds(body.kinds)
  if (kinds.length === 0) return buildApiError('Choose messages and/or calls')
  const on = body.on === true

  if (!on) {
    const denied = await requireVerification(body, {
      userId: session.user.id,
      action: VERIFY_ACTION.GUEST_AUTOMATION_OFF,
      target: guestAutomationTarget(booking.bookingRef, kinds),
    })
    if (denied) return denied
  }

  const notes: string[] = []
  for (const kind of kinds) {
    const r = await setGuestAutomation({
      bookingRef: booking.bookingRef, kind, on, actor,
      reason: typeof body.reason === 'string' ? body.reason.slice(0, 300) : null,
    })
    if (r.note) notes.push(r.note)
  }
  await logActivity({
    userId: session.user.id, action: ACTION.BOOKING_UPDATED, entityType: 'Booking', entityId: booking.bookingRef,
    details: { guestAutomation: { kinds, on, otpVerified: !on, reason: body.reason ?? null, notes } },
  })
  return buildApiSuccess({ notes, ...(await snapshot(booking.bookingRef, booking.contactWhatsapp)) })
}
