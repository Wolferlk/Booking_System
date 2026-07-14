import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { logActivity, ACTION } from '@/lib/activity'
import type { Prisma, BookingStatus, OperationCountry } from '@prisma/client'

export const dynamic = 'force-dynamic'

type Filters = {
  arrivalFrom?: string
  arrivalTo?: string
  departureFrom?: string
  departureTo?: string
  createdFrom?: string
  createdTo?: string
  statuses?: string[]
  operationCountry?: string
  refContains?: string
}

type Body = {
  mode: 'preview' | 'delete'
  filters?: Filters
  password?: string
}

/** Turn the incoming filters into a Prisma `where` clause. Returns null if no
 *  filter is set at all — we refuse to operate on the whole table by accident. */
function buildWhere(filters: Filters): Prisma.BookingWhereInput | null {
  const and: Prisma.BookingWhereInput[] = []

  const dateRange = (from?: string, to?: string) => {
    const range: { gte?: Date; lte?: Date } = {}
    if (from) range.gte = new Date(from)
    // Inclusive end-of-day so "before July 1" style ranges behave intuitively.
    if (to) { const d = new Date(to); d.setHours(23, 59, 59, 999); range.lte = d }
    return Object.keys(range).length ? range : undefined
  }

  const arrival = dateRange(filters.arrivalFrom, filters.arrivalTo)
  if (arrival) and.push({ arrivalDate: arrival })

  const departure = dateRange(filters.departureFrom, filters.departureTo)
  if (departure) and.push({ departureDate: departure })

  const created = dateRange(filters.createdFrom, filters.createdTo)
  if (created) and.push({ createdAt: created })

  if (filters.statuses && filters.statuses.length > 0) {
    and.push({ status: { in: filters.statuses as BookingStatus[] } })
  }

  if (filters.operationCountry) {
    and.push({ operationCountry: filters.operationCountry as OperationCountry })
  }

  if (filters.refContains && filters.refContains.trim()) {
    and.push({ bookingRef: { contains: filters.refContains.trim() } })
  }

  if (and.length === 0) return null
  return { AND: and }
}

export async function POST(req: NextRequest) {
  // ── Auth: Super Admin only ───────────────────────────────────────────────
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  if (!['SUPER_ADMIN', 'ULTRA_SUPER_ADMIN'].includes(session.user.role)) {
    return buildApiError('Forbidden — Super Admin only', 403)
  }

  const body = (await req.json().catch(() => ({}))) as Body
  const mode = body.mode === 'delete' ? 'delete' : 'preview'
  const where = buildWhere(body.filters ?? {})

  if (!where) {
    return buildApiError('At least one filter is required — refusing to match all bookings', 400)
  }

  // ── Preview: return count + a sample of matches, no password needed ───────
  if (mode === 'preview') {
    const count = await prisma.booking.count({ where })
    const sample = await prisma.booking.findMany({
      where,
      select: {
        bookingRef: true,
        status: true,
        operationCountry: true,
        arrivalDate: true,
        departureDate: true,
        createdAt: true,
      },
      orderBy: { arrivalDate: 'asc' },
      take: 200,
    })
    return buildApiSuccess({ count, sample })
  }

  // ── Delete: require the critical services password ────────────────────────
  const criticalPassword =
    process.env.CRITICAL_SERVICES_PASSWORD ?? process.env.CRITICAL_OPS_PASSWORD
  if (!criticalPassword) {
    return buildApiError('Critical services password is not configured on the server', 500)
  }
  if (!body.password || body.password !== criticalPassword) {
    return buildApiError('Incorrect critical services password', 403)
  }

  const matches = await prisma.booking.findMany({
    where,
    select: { bookingRef: true },
  })
  if (matches.length === 0) return buildApiError('No matching bookings found', 404)

  // Child tables cascade automatically (see schema onDelete: Cascade relations).
  const result = await prisma.booking.deleteMany({ where })

  await logActivity({
    userId: session.user.id,
    action: ACTION.BOOKING_DELETED,
    entityType: 'System',
    entityId: 'filtered-delete',
    details: {
      operation: 'FILTERED_DELETE_BOOKINGS',
      filters: body.filters,
      deletedCount: result.count,
      bookingRefs: matches.map(m => m.bookingRef),
      performedBy: session.user.email,
      performedAt: new Date().toISOString(),
    },
  })

  return buildApiSuccess(
    { deletedCount: result.count },
    `${result.count} booking${result.count !== 1 ? 's' : ''} permanently deleted`,
  )
}
