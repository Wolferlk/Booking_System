import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import bcrypt from 'bcryptjs'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import type { OperationCountry } from '@prisma/client'

export const dynamic = 'force-dynamic'

async function requireAdmin() {
  const session = await getServerSession(authOptions)
  if (!session) return { error: buildApiError('Unauthorized', 401) }
  if (!['SUPER_ADMIN', 'ULTRA_SUPER_ADMIN'].includes(session.user.role)) return { error: buildApiError('Forbidden', 403) }
  return { session }
}

// GET — list every file handler (pending + active), newest first.
export async function GET() {
  const { error } = await requireAdmin()
  if (error) return error

  const handlers = await prisma.fileHandler.findMany({
    orderBy: [{ isActive: 'asc' }, { createdAt: 'desc' }],
    select: {
      id: true, name: true, email: true, phone: true, whatsappPhone: true,
      country: true, isActive: true, createdAt: true, approvedAt: true,
      approvedBy: true, lastLoginAt: true,
      _count: { select: { logs: true } },
    },
  })

  const pending = handlers.filter(h => !h.isActive).length
  return buildApiSuccess({ handlers, counts: { total: handlers.length, pending } })
}

// POST — admin creates a file handler directly (pre-approved).
export async function POST(req: NextRequest) {
  const { error } = await requireAdmin()
  if (error) return error

  const body = await req.json().catch(() => ({}))
  const { name, email, phone, whatsappPhone, password, country } = body
  if (!name?.trim())  return buildApiError('Name is required')
  if (!email?.trim()) return buildApiError('Email is required')
  if (!password || password.length < 6) return buildApiError('Password must be at least 6 characters')

  const existing = await prisma.fileHandler.findFirst({ where: { email: email.trim().toLowerCase() } })
  if (existing) return buildApiError('A file handler with this email already exists')

  const handler = await prisma.fileHandler.create({
    data: {
      name: name.trim(),
      email: email.trim().toLowerCase(),
      phone: phone?.trim() || null,
      whatsappPhone: whatsappPhone?.trim() || null,
      password: await bcrypt.hash(password, 10),
      country: (country as OperationCountry) || 'ALL',
      isRegistered: true,
      isActive: true,
      approvedAt: new Date(),
    },
    select: { id: true, name: true, email: true, isActive: true },
  })
  return buildApiSuccess(handler, 'File handler created')
}
