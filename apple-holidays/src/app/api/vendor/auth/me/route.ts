import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { getVendorSession } from '@/lib/vendor-auth'

export const dynamic = 'force-dynamic'

export async function GET() {
  const vendor = await getVendorSession()
  if (!vendor) return buildApiError('Unauthorized', 401)
  return buildApiSuccess(vendor)
}
