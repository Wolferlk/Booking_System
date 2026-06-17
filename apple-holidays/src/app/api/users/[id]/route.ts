import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import bcrypt from 'bcryptjs'
import type { UserRole } from '@prisma/client'

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  if (!['SUPER_ADMIN', 'ULTRA_SUPER_ADMIN'].includes(session.user.role)) return buildApiError('Forbidden', 403)

  const user = await prisma.user.findUnique({
    where: { id: params.id },
    select: {
      id: true, email: true, name: true, role: true,
      phone: true, avatar: true, isActive: true,
      createdAt: true, updatedAt: true,
      _count: { select: { bookingsCreated: true, activityLogs: true } },
    },
  })
  if (!user) return buildApiError('User not found', 404)

  return buildApiSuccess(user)
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  if (!['SUPER_ADMIN', 'ULTRA_SUPER_ADMIN'].includes(session.user.role)) return buildApiError('Forbidden', 403)

  const { id } = params
  const body = await req.json()
  const { name, email, phone, role, isActive, password } = body

  const existing = await prisma.user.findUnique({ where: { id } })
  if (!existing) return buildApiError('User not found', 404)

  // Prevent deactivating own account
  if (id === session.user.id && isActive === false) {
    return buildApiError('You cannot deactivate your own account')
  }

  const updateData: Record<string, unknown> = {}
  if (name !== undefined)   updateData.name = name
  if (phone !== undefined)  updateData.phone = phone || null
  if (role !== undefined)   updateData.role = role as UserRole
  if (isActive !== undefined) updateData.isActive = isActive

  if (email !== undefined && email !== existing.email) {
    const emailTaken = await prisma.user.findFirst({ where: { email, NOT: { id } } })
    if (emailTaken) return buildApiError('Email already in use by another account')
    updateData.email = email
  }

  if (password) {
    if (password.length < 6) return buildApiError('Password must be at least 6 characters')
    updateData.password = await bcrypt.hash(password, 12)
  }

  const user = await prisma.user.update({
    where: { id },
    data: updateData,
    select: {
      id: true, email: true, name: true, role: true,
      phone: true, isActive: true, createdAt: true, updatedAt: true,
      _count: { select: { bookingsCreated: true, activityLogs: true } },
    },
  })

  await prisma.activityLog.create({
    data: {
      userId: session.user.id,
      action: 'USER_UPDATED',
      entityType: 'User',
      entityId: user.id,
      details: JSON.stringify({ updatedFields: Object.keys(updateData) }),
    },
  }).catch(() => {/* non-critical */})

  return buildApiSuccess(user, 'User updated successfully')
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  if (!['SUPER_ADMIN', 'ULTRA_SUPER_ADMIN'].includes(session.user.role)) return buildApiError('Forbidden', 403)

  const { id } = params

  // Prevent self-deletion
  if (id === session.user.id) {
    return buildApiError('You cannot delete your own account')
  }

  // Verify critical service password
  let criticalPassword: string | undefined
  try {
    const body = await req.json()
    criticalPassword = body.criticalPassword
  } catch {
    return buildApiError('Request body is required')
  }

  const configuredPassword = process.env.CRITICAL_OPS_PASSWORD
  if (!configuredPassword) {
    return buildApiError('Critical service password not configured on server', 500)
  }
  if (!criticalPassword || criticalPassword !== configuredPassword) {
    return buildApiError('Invalid critical service password', 403)
  }

  const existing = await prisma.user.findUnique({ where: { id } })
  if (!existing) return buildApiError('User not found', 404)

  await prisma.user.delete({ where: { id } })

  await prisma.activityLog.create({
    data: {
      userId: session.user.id,
      action: 'USER_DELETED',
      entityType: 'User',
      entityId: id,
      details: JSON.stringify({ deletedName: existing.name, deletedEmail: existing.email }),
    },
  }).catch(() => {/* non-critical */})

  return buildApiSuccess(null, 'User deleted successfully')
}
