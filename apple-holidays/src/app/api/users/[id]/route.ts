import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import bcrypt from 'bcryptjs'
import type { UserRole } from '@prisma/client'

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const { id } = params
  const body = await req.json()
  const { name, email, phone, role, isActive, password } = body

  const existing = await prisma.user.findUnique({ where: { id } })
  if (!existing) return buildApiError('User not found', 404)

  const updateData: Record<string, unknown> = {}
  if (name !== undefined) updateData.name = name
  if (email !== undefined) {
    const emailTaken = await prisma.user.findFirst({ where: { email, NOT: { id } } })
    if (emailTaken) return buildApiError('Email already in use')
    updateData.email = email
  }
  if (phone !== undefined) updateData.phone = phone
  if (role !== undefined) updateData.role = role as UserRole
  if (isActive !== undefined) updateData.isActive = isActive
  if (password) updateData.password = await bcrypt.hash(password, 12)

  const user = await prisma.user.update({
    where: { id },
    data: updateData,
    select: {
      id: true, email: true, name: true, role: true,
      phone: true, isActive: true, createdAt: true,
    },
  })

  return buildApiSuccess(user, 'User updated')
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const { id } = params

  const existing = await prisma.user.findUnique({ where: { id } })
  if (!existing) return buildApiError('User not found', 404)

  await prisma.user.delete({ where: { id } })

  return buildApiSuccess(null, 'User deleted')
}
