import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import bcrypt from 'bcryptjs'
import type { UserRole } from '@prisma/client'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  if (session.user.role !== 'SUPER_ADMIN') return buildApiError('Forbidden', 403)

  const users = await prisma.user.findMany({
    select: {
      id: true, email: true, name: true, role: true,
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
  if (session.user.role !== 'SUPER_ADMIN') return buildApiError('Forbidden', 403)

  const { email, name, password, role, phone } = await req.json()

  if (!email || !name || !password || !role) {
    return buildApiError('email, name, password, and role are required')
  }

  if (password.length < 6) {
    return buildApiError('Password must be at least 6 characters')
  }

  const existing = await prisma.user.findUnique({ where: { email } })
  if (existing) return buildApiError('Email already registered')

  const hashed = await bcrypt.hash(password, 12)

  const user = await prisma.user.create({
    data: { email, name, password: hashed, role: role as UserRole, phone: phone || null },
    select: {
      id: true, email: true, name: true, role: true,
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
