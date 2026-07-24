import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { getFileHandlerSession } from '@/lib/filehandler-auth'

export const dynamic = 'force-dynamic'

export async function GET() {
  const handler = await getFileHandlerSession()
  if (!handler) return buildApiError('Unauthorized', 401)
  return buildApiSuccess(handler)
}
