/**
 * GET — per-movement WhatsApp send summary for one booking, for the "sent"
 * badges on the movement chart. One query for the whole chart rather than one
 * per movement. Also says whether the feature is switched on, so the chart can
 * hide the button without a second call.
 */
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { loadMovementWaConfig, movementSendSummary } from '@/lib/movement-whatsapp'

export const dynamic = 'force-dynamic'

export async function GET(_req: Request, { params }: { params: { ref: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)

  const [config, summary] = await Promise.all([
    loadMovementWaConfig(),
    movementSendSummary(params.ref),
  ])
  return buildApiSuccess({ enabled: config.enabled, summary })
}
