import { NextRequest } from 'next/server'
import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { setVendorCookie } from '@/lib/vendor-auth'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  try {
    const { vendorId, credential, password } = await req.json()
    if (!password) return buildApiError('Password is required')
    if (!vendorId && !credential) return buildApiError('Email, phone, or company selection is required')

    // Prisma select that explicitly includes the new vendor-portal fields
    const select = {
      id: true, name: true, email: true, phone: true, whatsappPhone: true,
      country: true, isActive: true, isRegistered: true, password: true,
    } as const

    let vendor: Awaited<ReturnType<typeof prisma.vehicleVendor.findFirst>> = null

    if (vendorId) {
      // Login via selected company name (step 2 of company-search flow)
      vendor = await prisma.vehicleVendor.findFirst({
        where: { id: vendorId, isRegistered: true },
        select,
      })
    } else {
      const raw = credential.trim()
      // Detect if input is a phone number: starts with + or is mostly digits
      const isPhone = /^[+\d][\d\s\-().]{4,}$/.test(raw)

      if (isPhone) {
        vendor = await prisma.vehicleVendor.findFirst({
          where: {
            isRegistered: true,
            OR: [
              { phone: { contains: raw } },
              { whatsappPhone: { contains: raw } },
            ],
          },
          select,
        })
      } else {
        // Treat as email
        vendor = await prisma.vehicleVendor.findFirst({
          where: { email: raw.toLowerCase(), isRegistered: true },
          select,
        })
      }
    }

    if (!vendor || !vendor.password) return buildApiError('Invalid credentials', 401)

    const valid = await bcrypt.compare(password, vendor.password)
    if (!valid) return buildApiError('Invalid credentials', 401)

    if (!vendor.isActive) {
      return buildApiError('Your account is pending admin approval. Please contact support.', 403)
    }

    setVendorCookie(vendor.id)

    return buildApiSuccess({
      id: vendor.id,
      name: vendor.name,
      email: vendor.email,
      country: vendor.country,
    }, 'Logged in')
  } catch (err) {
    console.error('[vendor-login]', err)
    return buildApiError('Login failed. Please try again.', 500)
  }
}
