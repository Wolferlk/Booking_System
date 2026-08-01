import { NextRequest } from 'next/server'
import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/prisma'
import { apiOk, apiFail, readJsonBody, runRoute, str } from '@/lib/public-api/fh-http'
import type { OperationCountry } from '@prisma/client'

export const dynamic = 'force-dynamic'

const COUNTRIES = ['ALL', 'VIETNAM', 'SRILANKA', 'SINGAPORE_MALAYSIA', 'SINGAPORE', 'MALAYSIA']

/**
 * POST /api/public/fh/v1/auth/register  — **no token required**
 *
 * File-handler self-registration, same as the portal's sign-up form. Creates a
 * pending account (`isActive: false`) that an ultra/super admin must approve
 * before it can log in. Registering does not grant API access on its own.
 */
export async function POST(req: NextRequest) {
  return runRoute('auth/register', async (requestId) => {
    const body = await readJsonBody(req)

    const name = str(body, 'name', 'full_name')
    const email = str(body, 'email')
    const password = body.password === undefined ? '' : String(body.password)
    const phone = str(body, 'phone')
    const whatsapp = str(body, 'whatsapp_phone', 'whatsappPhone', 'whatsapp')
    const country = (str(body, 'country') || 'ALL').toUpperCase()

    if (!name) return apiFail('name is required', 422, 'NAME_REQUIRED', requestId)
    if (!email) return apiFail('email is required', 422, 'EMAIL_REQUIRED', requestId)
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return apiFail('email is not a valid address', 422, 'EMAIL_INVALID', requestId)
    }
    if (password.length < 6) {
      return apiFail('password must be at least 6 characters', 422, 'PASSWORD_TOO_SHORT', requestId)
    }
    if (!COUNTRIES.includes(country)) {
      return apiFail(`country must be one of ${COUNTRIES.join(', ')}`, 422, 'INVALID_COUNTRY', requestId)
    }

    const existing = await prisma.fileHandler.findFirst({ where: { email: email.toLowerCase() }, select: { id: true } })
    if (existing) {
      return apiFail('An account with this email already exists', 409, 'ALREADY_REGISTERED', requestId)
    }

    const handler = await prisma.fileHandler.create({
      data: {
        name,
        email: email.toLowerCase(),
        phone: phone ?? null,
        whatsappPhone: whatsapp ?? null,
        password: await bcrypt.hash(password, 10),
        isRegistered: true,
        isActive: false,
        country: country as OperationCountry,
      },
    })

    return apiOk(
      {
        id: handler.id,
        name: handler.name,
        email: handler.email,
        country: handler.country,
        pending_approval: true,
        message: 'Registration submitted — an admin must approve the account before it can log in',
      },
      201,
      requestId,
    )
  })
}

/**
 * GET /api/public/fh/v1/auth/register?email=…  — **no token required**
 *
 * Live "is this email already taken?" check for a sign-up form. Deliberately
 * returns nothing but a boolean.
 */
export async function GET(req: NextRequest) {
  return runRoute('auth/register-check', async (requestId) => {
    const email = req.nextUrl.searchParams.get('email')?.trim()
    if (!email) return apiFail('email query parameter is required', 422, 'EMAIL_REQUIRED', requestId)

    const existing = await prisma.fileHandler.findFirst({
      where: { email: email.toLowerCase() },
      select: { id: true, isActive: true },
    })
    return apiOk(
      { email: email.toLowerCase(), exists: !!existing, approved: existing?.isActive ?? false },
      200,
      requestId,
    )
  })
}
