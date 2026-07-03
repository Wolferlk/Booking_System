import { buildApiSuccess } from '@/lib/utils'
import { clearVendorCookie } from '@/lib/vendor-auth'

export const dynamic = 'force-dynamic'

export async function POST() {
  clearVendorCookie()
  return buildApiSuccess(null, 'Logged out')
}
