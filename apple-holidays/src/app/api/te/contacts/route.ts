import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { canSeeAllCountries } from '@/lib/rbac'
import type { UserRole, OperationCountry } from '@prisma/client'

const ALLOWED_ROLES: UserRole[] = ['TE_USER', 'GT_TE_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN']

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)

  const role = session.user.role as UserRole
  if (!ALLOWED_ROLES.includes(role)) return buildApiError('Forbidden', 403)

  const userCountry = session.user.country as OperationCountry | undefined
  const countryOverride = req.nextUrl.searchParams.get('country') as OperationCountry | null

  const effectiveCountry = canSeeAllCountries(role, userCountry ?? 'ALL')
    ? (countryOverride || null)
    : (userCountry || null)

  const where: Record<string, unknown> = effectiveCountry
    ? { booking: { operationCountry: effectiveCountry } }
    : {}

  const logs = await prisma.contactLog.findMany({
    where,
    include: {
      user: { select: { name: true } },
      booking: { select: { bookingRef: true, operationCountry: true } },
    },
    orderBy: { contactedAt: 'desc' },
    take: 200,
  })

  return buildApiSuccess(logs)
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)

  const role = session.user.role as UserRole
  if (!ALLOWED_ROLES.includes(role)) return buildApiError('Forbidden', 403)

  const body = await req.json()
  const { bookingRef, type, subject, notes } = body
  if (!bookingRef || !type || !subject) return buildApiError('bookingRef, type and subject are required')

  const booking = await prisma.booking.findUnique({ where: { bookingRef } })
  if (!booking) return buildApiError('Booking not found', 404)

  const log = await prisma.contactLog.create({
    data: {
      bookingId:   booking.id,
      userId:      session.user.id,
      type,
      subject,
      notes: notes || null,
      contactedAt: new Date(),
    },
    include: { user: { select: { name: true } } },
  })

  return buildApiSuccess(log, 'Contact logged')
}
