import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'

export const dynamic = 'force-dynamic'

/**
 * GET — read-only flag any authenticated staff member can check to know whether
 * editing of the Accounts PNL panel (adjustments, unlink, version switching,
 * ticket creation, manual linking) is enabled. Defaults to false (view-only).
 * The flag is toggled by admins on the Settings page via /api/admin/settings.
 */
export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)

  const row = await prisma.systemSetting.findUnique({ where: { key: 'ext_pnl_edit_enabled' } })
  return buildApiSuccess({ editEnabled: row?.value === 'true' })
}
