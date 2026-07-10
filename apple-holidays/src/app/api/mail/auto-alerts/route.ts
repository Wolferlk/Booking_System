import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import {
  getTqAutoAlerts,
  getTqAutoStatus,
  setTqAutoEnabled,
  runTqAutoProcess,
} from '@/lib/tq-auto-scheduler'

export const dynamic = 'force-dynamic'

const ADMIN_ROLES = ['SUPER_ADMIN', 'ULTRA_SUPER_ADMIN']

// GET → current status + recent auto-process alert batches
export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  if (!ADMIN_ROLES.includes(session.user.role)) return buildApiError('Forbidden', 403)

  const [status, alerts] = await Promise.all([getTqAutoStatus(), getTqAutoAlerts()])
  return buildApiSuccess({ status, alerts })
}

// POST → toggle the scheduler on/off, or trigger an immediate run
//   body: { action: 'enable' | 'disable' | 'run' }
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  if (!ADMIN_ROLES.includes(session.user.role)) return buildApiError('Forbidden', 403)

  const { action } = await req.json().catch(() => ({ action: '' })) as { action?: string }

  if (action === 'enable' || action === 'disable') {
    await setTqAutoEnabled(action === 'enable')
    const status = await getTqAutoStatus()
    return buildApiSuccess({ status })
  }

  if (action === 'run') {
    const result = await runTqAutoProcess('manual')
    const [status, alerts] = await Promise.all([getTqAutoStatus(), getTqAutoAlerts()])
    return buildApiSuccess({ result, status, alerts })
  }

  return buildApiError('Unknown action — expected enable | disable | run', 400)
}
