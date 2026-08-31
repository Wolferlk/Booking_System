/**
 * Driver Brief — the deck, and the record that it was read.
 *
 * `GET`  returns the whole booking arranged as slides (see `src/lib/driver-brief.ts`).
 *        `?ai=1` additionally generates the spoken talking points and caches them
 *        on the brief record; `?ai=refresh` regenerates them even when cached.
 *        The two are split so the deck can open instantly with a driver already
 *        on the line and let the crib sheet catch up.
 *
 * `POST` records progress: slides actually read, the note the briefer typed, and
 *        the sign-off. Opening the deck moves the file from `pending` to
 *        `in_progress` and nothing else — a brief is only complete when somebody
 *        says it is, because the whole point of the record is that a person did
 *        this, not that a page was loaded.
 *
 * `DELETE` reopens a completed brief (the driver changed, or it was signed off
 *        by mistake). The notes survive: they are what was said, and re-opening
 *        does not unsay it.
 */
import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { hasPermission } from '@/lib/rbac'
import { ACTION, logActivity } from '@/lib/activity'
import { BRIEF_SLIDES, buildDriverBrief, generateBriefAi } from '@/lib/driver-brief'
import type { UserRole } from '@prisma/client'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/** Who may sign a brief off. Reading is anyone who may read a booking. */
const BRIEF_WRITE_ROLES: UserRole[] = [
  'GT_USER', 'GT_VN_USER', 'GT_TE_USER', 'TE_USER', 'BT_USER',
  'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN',
]

export async function GET(req: NextRequest, { params }: { params: { ref: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  if (!hasPermission(session.user.role as UserRole, 'booking:read')) {
    return buildApiError('Forbidden', 403)
  }

  const payload = await buildDriverBrief(params.ref)
  if (!payload) return buildApiError('Booking not found', 404)

  const aiMode = req.nextUrl.searchParams.get('ai')
  if (aiMode === '1' || aiMode === 'refresh') {
    const cached = aiMode === '1' ? payload.ai : null
    if (cached) return buildApiSuccess(payload)

    const ai = await generateBriefAi(payload)
    if (ai) {
      payload.ai = ai
      // Cached against the ref rather than the booking id so the crib sheet
      // survives an amendment rewriting the booking's children.
      await prisma.driverBrief.upsert({
        where:  { bookingRef: params.ref },
        update: { aiBrief: ai as unknown as object, aiBriefAt: new Date() },
        create: {
          bookingRef:  params.ref,
          status:      'pending',
          driverId:    payload.primaryDriver?.id ?? null,
          driverName:  payload.primaryDriver?.name ?? null,
          driverPhone: payload.primaryDriver?.phone ?? null,
          aiBrief:     ai as unknown as object,
          aiBriefAt:   new Date(),
        },
      }).catch(err => console.error('[driver-brief] AI cache write failed:', err))
    }
  }

  return buildApiSuccess(payload)
}

export async function POST(req: NextRequest, { params }: { params: { ref: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)

  const role = session.user.role as UserRole
  if (!BRIEF_WRITE_ROLES.includes(role)) return buildApiError('Forbidden', 403)

  const body = (await req.json().catch(() => ({}))) as {
    action?: 'start' | 'progress' | 'complete'
    slidesSeen?: Record<string, boolean>
    notes?: string
  }

  const action = body.action ?? 'progress'

  const payload = await buildDriverBrief(params.ref)
  if (!payload) return buildApiError('Booking not found', 404)

  // Only real slide ids are stored, so a stale client cannot grow the JSON blob
  // with keys nothing will ever read.
  const seen: Record<string, boolean> = {}
  for (const [k, v] of Object.entries(body.slidesSeen ?? {})) {
    if (v && (BRIEF_SLIDES as readonly string[]).includes(k)) seen[k] = true
  }
  const merged = { ...payload.brief.slidesSeen, ...seen }

  const notes = typeof body.notes === 'string' ? body.notes.slice(0, 8000) : undefined
  const now = new Date()

  // The driver is stamped onto the record at every write, not just at sign-off:
  // the brief has to say who was briefed even after the file is re-allocated to
  // somebody else, and that re-allocation is exactly when it matters.
  const driverFields = {
    driverId:    payload.primaryDriver?.id ?? null,
    driverName:  payload.primaryDriver?.name ?? null,
    driverPhone: payload.primaryDriver?.phone ?? null,
  }

  const status =
    action === 'complete' ? 'completed'
    : payload.brief.status === 'completed' ? 'completed'
    : 'in_progress'

  const record = await prisma.driverBrief.upsert({
    where: { bookingRef: params.ref },
    update: {
      ...driverFields,
      status,
      slidesSeen: merged,
      ...(notes !== undefined ? { notes } : {}),
      ...(payload.brief.startedAt ? {} : { startedAt: now }),
      ...(action === 'complete'
        ? { completedAt: now, briefedById: session.user.id, briefedByName: session.user.name ?? session.user.email ?? null }
        : {}),
    },
    create: {
      bookingRef: params.ref,
      ...driverFields,
      status,
      slidesSeen: merged,
      notes: notes ?? '',
      startedAt: now,
      ...(action === 'complete'
        ? { completedAt: now, briefedById: session.user.id, briefedByName: session.user.name ?? session.user.email ?? null }
        : {}),
    },
  })

  if (action === 'complete') {
    await logActivity({
      userId: session.user.id,
      action: ACTION.BOOKING_UPDATED,
      entityType: 'Booking',
      entityId: params.ref,
      details: {
        kind: 'driver_brief_completed',
        driver: payload.primaryDriver?.name ?? null,
        slides: Object.keys(merged).length,
      },
    }).catch(() => {})
  }

  return buildApiSuccess({
    status: record.status,
    slidesSeen: record.slidesSeen as Record<string, boolean>,
    notes: record.notes ?? '',
    completedAt: record.completedAt?.toISOString() ?? null,
    briefedByName: record.briefedByName,
  })
}

export async function DELETE(_req: NextRequest, { params }: { params: { ref: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  if (!BRIEF_WRITE_ROLES.includes(session.user.role as UserRole)) {
    return buildApiError('Forbidden', 403)
  }

  const existing = await prisma.driverBrief.findUnique({ where: { bookingRef: params.ref } })
  if (!existing) return buildApiError('No brief to reopen', 404)

  const record = await prisma.driverBrief.update({
    where: { bookingRef: params.ref },
    data: { status: 'in_progress', completedAt: null },
  })

  return buildApiSuccess({ status: record.status })
}
