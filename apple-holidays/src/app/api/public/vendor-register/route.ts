import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { normalizeEmail } from '@/lib/credential-match'
import { VendorRegisterError, registerVendor } from '@/lib/vendor-register'
import { notifyStaffOfVendorSignup } from '@/lib/mobile/signup'

export const dynamic = 'force-dynamic'

// POST — vendor self-registration (creates a new vendor, pending admin approval).
// The same function backs the Aahaas app's "Register as vendor".
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const vendor = await registerVendor(body)
    await notifyStaffOfVendorSignup(vendor.id, 'WEB')

    return buildApiSuccess(
      { id: vendor.id, name: vendor.name, pending: true },
      'Registration submitted! Please wait for admin approval before logging in.'
    )
  } catch (err) {
    if (err instanceof VendorRegisterError) return buildApiError(err.message)
    const message = err instanceof Error ? err.message : String(err)
    console.error('[vendor-register] POST error:', message)
    // Surface DB schema errors clearly
    if (message.includes('Unknown column') || message.includes("doesn't exist")) {
      return buildApiError('Database schema is out of date. Run: npx prisma db push', 500)
    }
    return buildApiError('Registration failed. Please try again.', 500)
  }
}

// GET — check if an email is already registered (for form validation)
export async function GET(req: NextRequest) {
  const email = req.nextUrl.searchParams.get('email')
  const wanted = normalizeEmail(email)
  // Blank never "exists" — vendor rows created from the admin side can carry an empty
  // string in this column, and an equality lookup matched every one of them.
  if (!wanted) return buildApiSuccess({ exists: false })
  try {
    const rows = await prisma.vehicleVendor.findMany({ select: { email: true } })
    return buildApiSuccess({ exists: rows.some(v => normalizeEmail(v.email) === wanted) })
  } catch {
    return buildApiSuccess({ exists: false })
  }
}
