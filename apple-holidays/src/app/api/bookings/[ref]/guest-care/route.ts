/**
 * Guest care for one booking — the parts of the guest journey the WhatsApp
 * inbox's trip panel shows next to the Autopilot snapshot:
 *
 *   • Pre-trip reconfirmation  — AI call record and/or manual log entries
 *   • On-ground calls          — same, during the trip
 *   • Post-tour feedback       — the post-tour call plus the digital form
 *   • WhatsApp call approval   — sent / approved, from the approval ledger
 *   • Daily-plan send time     — so the panel can say when the next plan goes
 *
 * GET only, strictly read-only: every value comes from the loaders the Daily
 * Update sheet already uses (`daily-update-calls-data.ts`). Same role and
 * country gate as `/guest-automation`.
 */
import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { canSeeAllCountries } from '@/lib/rbac'
import { isInCountryScope } from '@/lib/country-detection'
import { GUEST_AUTOMATION_ROLES } from '@/lib/guest-automation-access'
import {
  fetchCallsForBookings, fetchFeedbackFormsForBookings, fetchCallApprovalsForBookings,
} from '@/lib/daily-update-calls-data'
import { emptyCalls } from '@/lib/daily-update-calls'
import { emptyFeedbackForm } from '@/lib/daily-update-feedback'
import { emptyCallApproval } from '@/lib/daily-update-approval'
import {
  SETTING_DAILY_BRIEFING, SETTING_FEEDBACK_REQUEST, briefingTargetsSameDay, briefingTimezone,
  getBookingBriefingTime, getDefaultBriefingTime,
} from '@/lib/customer-whatsapp-automation'
import type { UserRole } from '@prisma/client'

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, { params }: { params: { ref: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  const role = session.user.role as UserRole
  if (!GUEST_AUTOMATION_ROLES.includes(role)) return buildApiError('Forbidden', 403)

  const booking = await prisma.booking.findUnique({
    where: { bookingRef: params.ref },
    select: { id: true, bookingRef: true, operationCountry: true, contactWhatsapp: true, contactPhone: true },
  })
  if (!booking) return buildApiError('Booking not found', 404)

  const userCountry = session.user.country as string | undefined
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (!canSeeAllCountries(role, userCountry as any) && userCountry && userCountry !== 'ALL' &&
      !isInCountryScope(booking.operationCountry, userCountry)) {
    return buildApiError('Forbidden', 403)
  }

  const one = [{ id: booking.id, bookingRef: booking.bookingRef }]
  const [calls, forms, approvals, override, defaultTime, settings] = await Promise.all([
    fetchCallsForBookings(one).catch(() => null),
    fetchFeedbackFormsForBookings(one).catch(() => null),
    fetchCallApprovalsForBookings([{ ...one[0], guestWhatsapp: booking.contactWhatsapp, guestPhone: booking.contactPhone }]).catch(() => null),
    getBookingBriefingTime(booking.bookingRef).catch(() => null),
    getDefaultBriefingTime().catch(() => '18:00'),
    prisma.systemSetting.findMany({
      where: { key: { in: [SETTING_DAILY_BRIEFING, SETTING_FEEDBACK_REQUEST] } },
      select: { key: true, value: true },
    }).catch(() => []),
  ])

  const on = (key: string) => settings.find(s => s.key === key)?.value !== 'false'
  const time = override === 'OFF' ? null : (override ?? defaultTime)

  return buildApiSuccess({
    calls: calls?.[booking.id] ?? emptyCalls(),
    feedbackForm: forms?.[booking.id] ?? emptyFeedbackForm(),
    approval: approvals?.[booking.id] ?? emptyCallApproval(),
    briefing: {
      /** "HH:MM" local to the trip, or null when this booking's auto plan is OFF. */
      time,
      custom: override != null,
      /** A morning send briefs that same day; an evening send briefs the next day. */
      sameDay: time ? briefingTargetsSameDay(time) : false,
      timezone: briefingTimezone(booking.operationCountry, booking.bookingRef),
      enabled: on(SETTING_DAILY_BRIEFING),
    },
    feedbackAuto: on(SETTING_FEEDBACK_REQUEST),
  })
}
