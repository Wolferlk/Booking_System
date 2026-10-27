import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { canSeeAllCountries } from '@/lib/rbac'
import { isInCountryScope } from '@/lib/country-detection'
import { logActivity } from '@/lib/activity'
import { LOCK_ROLES, LOCK_SECTIONS, type LockSection } from '@/lib/data-protection'
import {
  classifyFlights, getDataProtectionPolicy, listRestorableFlights, readBookingLocks, setSectionLock,
} from '@/lib/data-protection-server'
import type { UserRole } from '@prisma/client'

export const dynamic = 'force-dynamic'

/** Versions scanned for the "N flights can be restored" badge; the dialog scans more. */
const BADGE_VERSIONS = 4

async function loadScopedBooking(ref: string) {
  const session = await getServerSession(authOptions)
  if (!session) return { error: buildApiError('Unauthorized', 401) }
  const role = session.user.role as UserRole
  if (role === 'CLIENT') return { error: buildApiError('Forbidden', 403) }

  const booking = await prisma.booking.findUnique({
    where:  { bookingRef: ref },
    select: { id: true, bookingRef: true, operationCountry: true },
  })
  if (!booking) return { error: buildApiError('Booking not found', 404) }

  const userCountry = session.user.country as string | undefined
  if (!canSeeAllCountries(role, userCountry as never) && userCountry && userCountry !== 'ALL'
      && !isInCountryScope(booking.operationCountry, userCountry)) {
    return { error: buildApiError('Forbidden', 403) }
  }
  return { session, role, booking }
}

// GET /api/bookings/[ref]/data-guard
// Policy, this booking's section locks, which flights a re-sync would keep,
// and how many older flights could be brought back.
export async function GET(_req: NextRequest, { params }: { params: { ref: string } }) {
  const ctx = await loadScopedBooking(params.ref)
  if ('error' in ctx) return ctx.error
  const { booking, role } = ctx

  const [policy, locks, origins] = await Promise.all([
    getDataProtectionPolicy(),
    readBookingLocks(booking.id),
    classifyFlights(booking.id).catch(() => null),
  ])
  const restorable = policy.flightRestore
    ? await listRestorableFlights(booking.id, BADGE_VERSIONS).then(r => r.length).catch(() => 0)
    : 0

  return buildApiSuccess({
    policy,
    locks,
    canLock: Object.fromEntries(LOCK_SECTIONS.map(s => [s, LOCK_ROLES[s].includes(role)])),
    flights: origins,
    restorable,
  })
}

// PUT /api/bookings/[ref]/data-guard   { section, locked, note? }
export async function PUT(req: NextRequest, { params }: { params: { ref: string } }) {
  const ctx = await loadScopedBooking(params.ref)
  if ('error' in ctx) return ctx.error
  const { booking, role, session } = ctx

  const body = await req.json().catch(() => ({})) as { section?: string; locked?: boolean; note?: string }
  const section = body.section as LockSection
  if (!LOCK_SECTIONS.includes(section)) return buildApiError('Unknown section', 400)
  if (!LOCK_ROLES[section].includes(role)) return buildApiError('Forbidden', 403)

  const policy = await getDataProtectionPolicy()
  if (!policy.bookingLocks && body.locked) {
    return buildApiError('Booking locks are switched off in Settings → Data Protection', 400)
  }

  const by = session.user.name || session.user.email || 'Unknown'
  const locks = await setSectionLock(
    booking.id,
    section,
    body.locked ? { by, at: new Date().toISOString(), note: body.note?.trim().slice(0, 300) || null } : null,
  )

  await logActivity({
    userId:     session.user.id,
    action:     body.locked ? 'BOOKING_SECTION_LOCKED' : 'BOOKING_SECTION_UNLOCKED',
    entityType: 'Booking',
    entityId:   booking.id,
    details:    { bookingRef: booking.bookingRef, section, note: body.note ?? null },
  })

  return buildApiSuccess({ locks }, body.locked ? 'Locked' : 'Unlocked')
}
