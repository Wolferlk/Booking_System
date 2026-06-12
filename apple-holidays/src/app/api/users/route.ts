import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import bcrypt from 'bcryptjs'
import type { UserRole } from '@prisma/client'

export async function GET() {
  const users = await prisma.user.findMany({
    select: {
      id: true, email: true, name: true, role: true,
      phone: true, avatar: true, isActive: true, createdAt: true,
    },
    orderBy: { createdAt: 'desc' },
  })

  return buildApiSuccess(users)
}

export async function POST(req: NextRequest) {
  const { email, name, password, role, phone } = await req.json()

  if (!email || !name || !password || !role) {
    return buildApiError('email, name, password, and role are required')
  }

  const existing = await prisma.user.findUnique({ where: { email } })
  if (existing) return buildApiError('Email already registered')

  const hashed = await bcrypt.hash(password, 12)

  const user = await prisma.user.create({
    data: {
      email,
      name,
      password: hashed,
      role: role as UserRole,
      phone,
    },
    select: {
      id: true, email: true, name: true, role: true,
      phone: true, isActive: true, createdAt: true,
    },
  })

  return buildApiSuccess(user, 'User created')
}
