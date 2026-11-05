import { NextRequest } from 'next/server'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { setVendorCookie } from '@/lib/vendor-auth'
import { VendorLoginError, authenticateVendor } from '@/lib/vendor-login'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  try {
    const { vendorId, credential, password } = await req.json()
    const vendor = await authenticateVendor({ vendorId, credential, password })

    setVendorCookie(vendor.id)

    return buildApiSuccess({
      id: vendor.id,
      name: vendor.name,
      email: vendor.email,
      country: vendor.country,
    }, 'Logged in')
  } catch (err) {
    if (err instanceof VendorLoginError) return buildApiError(err.message, err.status)
    console.error('[vendor-login]', err)
    return buildApiError('Login failed. Please try again.', 500)
  }
}
