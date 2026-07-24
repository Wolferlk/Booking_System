import { NextRequest } from 'next/server'
import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import type { OperationCountry } from '@prisma/client'

export const dynamic = 'force-dynamic'

// POST — file handler self-registration. Creates a pending account (isActive:false)
// that an ultra/super admin must approve before login is possible.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const { name, email, phone, whatsappPhone, password, country } = body

    if (!name?.trim())  return buildApiError('Full name is required')
    if (!email?.trim()) return buildApiError('Email is required')
    if (!password || password.length < 6) return buildApiError('Password must be at least 6 characters')

    const existing = await prisma.fileHandler.findFirst({
      where: { email: email.trim().toLowerCase() },
    })
    if (existing) return buildApiError('An account with this email already exists. Please contact admin if you need help.')

    const hashed = await bcrypt.hash(password, 10)

    const handler = await prisma.fileHandler.create({
      data: {
        name: name.trim(),
        email: email.trim().toLowerCase(),
        phone: phone?.trim() || null,
        whatsappPhone: whatsappPhone?.trim() || null,
        password: hashed,
        isRegistered: true,
        isActive: false,
        country: (country as OperationCountry) || 'ALL',
      },
    })

    return buildApiSuccess(
      { id: handler.id, name: handler.name, pending: true },
      'Registration submitted! Please wait for admin approval before logging in.',
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[filehandler-register] POST error:', message)
    if (message.includes('Unknown column') || message.includes("doesn't exist")) {
      return buildApiError('Database schema is out of date. The file_handlers table has not been created yet.', 500)
    }
    return buildApiError('Registration failed. Please try again.', 500)
  }
}

// GET — check if an email is already registered (live form validation)
export async function GET(req: NextRequest) {
  const email = req.nextUrl.searchParams.get('email')
  if (!email) return buildApiSuccess({ exists: false })
  try {
    const existing = await prisma.fileHandler.findFirst({
      where: { email: email.trim().toLowerCase() },
      select: { id: true },
    })
    return buildApiSuccess({ exists: !!existing })
  } catch {
    return buildApiSuccess({ exists: false })
  }
}
