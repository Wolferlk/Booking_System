import { buildApiSuccess } from '@/lib/utils'
import { clearFileHandlerCookie } from '@/lib/filehandler-auth'

export const dynamic = 'force-dynamic'

export async function POST() {
  clearFileHandlerCookie()
  return buildApiSuccess(null, 'Logged out')
}
