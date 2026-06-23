import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import bcrypt from 'bcryptjs'
import type { UserRole, OperationCountry } from '@prisma/client'
import { isRoleAllowedInCountry } from '@/lib/rbac'

const VALID_COUNTRIES: OperationCountry[] = ['VIETNAM', 'SRILANKA', 'SINGAPORE_MALAYSIA', 'ALL']

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  if (!['SUPER_ADMIN', 'ULTRA_SUPER_ADMIN'].includes(session.user.role)) return buildApiError('Forbidden', 403)

  const sessionCountry = (session.user as any).country as string | undefined
  const countryOverride = req.nextUrl.searchParams.get('country')

  // SUPER_ADMIN with a specific country only sees users in their country
  // ULTRA_SUPER_ADMIN (country=ALL) can filter via ?country= param
  let countryWhere: Record<string, unknown> = {}
  if (sessionCountry && sessionCountry !== 'ALL') {
    countryWhere = { country: sessionCountry }
  } else if (countryOverride && countryOverride !== 'ALL') {
    countryWhere = { country: countryOverride }
  }

  const users = await prisma.user.findMany({
    where: countryWhere,
    select: {
      id: true, email: true, name: true, role: true, country: true,
      phone: true, avatar: true, isActive: true,
      createdAt: true, updatedAt: true,
      _count: {
        select: { bookingsCreated: true, activityLogs: true },
      },
    },
    orderBy: { createdAt: 'desc' },
  })

  return buildApiSuccess(users)
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  if (!['SUPER_ADMIN', 'ULTRA_SUPER_ADMIN'].includes(session.user.role)) return buildApiError('Forbidden', 403)

  const { email, name, password, role, phone, country: countryBody } = await req.json()

  if (!email || !name || !password || !role) {
    return buildApiError('email, name, password, and role are required')
  }

  if (password.length < 6) {
    return buildApiError('Password must be at least 6 characters')
  }

  // Determine the country to assign to this user
  let assignedCountry: OperationCountry
  const sessionCountry = (session.user as any).country as OperationCountry | undefined

  if (session.user.role === 'ULTRA_SUPER_ADMIN') {
    // Ultra admin must specify a valid country
    if (!countryBody || !VALID_COUNTRIES.includes(countryBody)) {
      return buildApiError('Country is required and must be valid')
    }
    assignedCountry = countryBody as OperationCountry
  } else {
    // SUPER_ADMIN: force their own country, or remain global if they are the ALL-country admin
    assignedCountry = (sessionCountry && sessionCountry !== 'ALL')
      ? sessionCountry
      : (countryBody && VALID_COUNTRIES.includes(countryBody) ? countryBody : 'ALL')
  }

  if (!isRoleAllowedInCountry(role as UserRole, assignedCountry)) {
    return buildApiError(`Role ${role} cannot be assigned to ${assignedCountry}`)
  }

  const existing = await prisma.user.findUnique({ where: { email } })
  if (existing) return buildApiError('Email already registered')

  const hashed = await bcrypt.hash(password, 12)

  const user = await prisma.user.create({
    data: { email, name, password: hashed, role: role as UserRole, phone: phone || null, country: assignedCountry },
    select: {
      id: true, email: true, name: true, role: true, country: true,
      phone: true, isActive: true, createdAt: true, updatedAt: true,
      _count: { select: { bookingsCreated: true, activityLogs: true } },
    },
  })

  await prisma.activityLog.create({
    data: {
      userId: session.user.id,
      action: 'USER_CREATED',
      entityType: 'User',
      entityId: user.id,
      details: JSON.stringify({ name: user.name, email: user.email, role: user.role }),
    },
  }).catch(() => {/* non-critical */})

  return buildApiSuccess(user, 'User created successfully')
}
