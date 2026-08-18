import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { canSeeAllCountries } from '@/lib/rbac'
import { isInCountryScope } from '@/lib/country-detection'
import { DAILY_UPDATE_EDIT_ROLES } from '@/lib/daily-update'
import { callLogType, callKindFromType, isCallKind } from '@/lib/daily-update-calls'
import type { UserRole } from '@prisma/client'

export const dynamic = 'force-dynamic'

/**
 * Manual call entries for the Daily Update sheet.
 *
 * Only ever touches `ContactLog` rows this feature wrote — every handler
 * re-checks the `DU_CALL_*` type prefix before it edits or deletes anything, so
 * a guessed id belonging to some other part of the system cannot be reached
 * through here. AI call records are read-only and have no route at all.
 */

type Guard =
  | { ok: true; bookingId: string; userId: string }
  | { ok: false; response: Response }

/** Auth, role and country scoping — identical in shape to the booking routes. */
async function guard(bookingRef: string): Promise<Guard> {
  const session = await getServerSession(authOptions)
  if (!session?.user) return { ok: false, response: buildApiError('Unauthorized', 401) }

  const role = session.user.role as UserRole
  if (!DAILY_UPDATE_EDIT_ROLES.includes(role)) {
    return { ok: false, response: buildApiError('Forbidden', 403) }
  }

  const booking = await prisma.booking.findUnique({
    where: { bookingRef },
    select: { id: true, operationCountry: true },
  })
  if (!booking) return { ok: false, response: buildApiError('Booking not found', 404) }

  const userCountry = session.user.country as string | undefined
  if (
    !canSeeAllCountries(role, (userCountry ?? 'ALL') as never) &&
    userCountry && userCountry !== 'ALL' &&
    !isInCountryScope(booking.operationCountry, userCountry)
  ) {
    return { ok: false, response: buildApiError('Forbidden', 403) }
  }

  return { ok: true, bookingId: booking.id, userId: session.user.id }
}

type ParsedCall =
  | { ok: true; summary: string; notes: string | null; at: Date }
  | { ok: false; error: string }

/** A call needs a summary and a time it happened; notes are optional. */
function readBody(body: Record<string, unknown>): ParsedCall {
  const summary = String(body.summary ?? '').trim()
  const notes   = String(body.notes ?? '').trim()
  const rawAt   = String(body.at ?? '').trim()

  if (!summary) return { ok: false, error: 'A short summary of the call is required' }
  if (summary.length > 500) return { ok: false, error: 'Summary is too long (500 characters max)' }

  // A blank time means "now" — logging a call you just made should not require
  // filling in a timestamp.
  const at = rawAt ? new Date(rawAt) : new Date()
  if (isNaN(at.getTime())) return { ok: false, error: 'That call date and time is not valid' }
  // Guard against a mistyped year putting a call decades away.
  if (at.getTime() > Date.now() + 86_400_000) {
    return { ok: false, error: 'A call cannot be logged in the future' }
  }

  return { ok: true, summary, notes: notes || null, at }
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  const bookingRef = String(body.bookingRef ?? '').trim()
  const kind = body.kind

  if (!bookingRef) return buildApiError('bookingRef is required')
  if (!isCallKind(kind)) return buildApiError('Unknown call type')

  const g = await guard(bookingRef)
  if (!g.ok) return g.response

  const parsed = readBody(body)
  if (!parsed.ok) return buildApiError(parsed.error)

  const log = await prisma.contactLog.create({
    data: {
      bookingId:   g.bookingId,
      userId:      g.userId,
      type:        callLogType(kind),
      subject:     parsed.summary,
      notes:       parsed.notes,
      contactedAt: parsed.at,
    },
    include: { user: { select: { name: true } } },
  })

  return buildApiSuccess({
    id:        log.id,
    source:    'MANUAL' as const,
    at:        log.contactedAt.toISOString(),
    summary:   log.subject,
    notes:     log.notes,
    by:        log.user?.name ?? null,
    outcome:   null,
    sentiment: null,
  }, 'Call logged')
}

export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  const id = String(body.id ?? '').trim()
  if (!id) return buildApiError('id is required')

  const existing = await prisma.contactLog.findUnique({
    where: { id },
    select: { id: true, type: true, booking: { select: { bookingRef: true } } },
  })
  // Only rows this feature wrote are editable here.
  if (!existing || !callKindFromType(existing.type)) return buildApiError('Call entry not found', 404)

  const g = await guard(existing.booking.bookingRef)
  if (!g.ok) return g.response

  const parsed = readBody(body)
  if (!parsed.ok) return buildApiError(parsed.error)

  const log = await prisma.contactLog.update({
    where: { id },
    data: { subject: parsed.summary, notes: parsed.notes, contactedAt: parsed.at },
    include: { user: { select: { name: true } } },
  })

  return buildApiSuccess({
    id:        log.id,
    source:    'MANUAL' as const,
    at:        log.contactedAt.toISOString(),
    summary:   log.subject,
    notes:     log.notes,
    by:        log.user?.name ?? null,
    outcome:   null,
    sentiment: null,
  }, 'Call updated')
}

export async function DELETE(req: NextRequest) {
  const id = (req.nextUrl.searchParams.get('id') ?? '').trim()
  if (!id) return buildApiError('id is required')

  const existing = await prisma.contactLog.findUnique({
    where: { id },
    select: { id: true, type: true, booking: { select: { bookingRef: true } } },
  })
  if (!existing || !callKindFromType(existing.type)) return buildApiError('Call entry not found', 404)

  const g = await guard(existing.booking.bookingRef)
  if (!g.ok) return g.response

  await prisma.contactLog.delete({ where: { id } })
  return buildApiSuccess({ id }, 'Call entry removed')
}
