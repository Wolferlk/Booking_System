import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { DRIVE_CONFIGS, testDriveAccess } from '@/lib/onedrive-monitor'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  if (!session.user.role) return buildApiError('Forbidden', 403)

  const { searchParams } = new URL(req.url)
  const driveKey = searchParams.get('driveKey')
  const cfgs = driveKey
    ? DRIVE_CONFIGS.filter(d => d.key === driveKey)
    : DRIVE_CONFIGS

  if (driveKey && cfgs.length === 0) {
    return buildApiError(`Unknown driveKey "${driveKey}"`, 400)
  }

  const results = await Promise.all(cfgs.map(cfg => testDriveAccess(cfg)))
  return buildApiSuccess({ results })
}
