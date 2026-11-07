/**
 * POST /api/agent-digest/preview — build a digest for a day WITHOUT sending or
 * saving anything. Body: { name, config, runDate, ruleId? }. Pure read.
 */
import { NextRequest } from 'next/server'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { requireDaStaff } from '@/lib/driver-auto/api-auth'
import { buildPayload } from '@/lib/agent-digest/server'
import { normaliseConfig, todayIn } from '@/lib/agent-digest/shared'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const staff = await requireDaStaff()
  if ('error' in staff) return buildApiError(staff.error, staff.status)
  try {
    const body = await req.json()
    const runDate = typeof body.runDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.runDate) ? body.runDate : todayIn('Asia/Colombo')
    const config = normaliseConfig(body.config)
    const ruleId = typeof body.ruleId === 'string' ? body.ruleId : null
    const payload = await buildPayload(config, runDate, String(body.name ?? 'Preview'), ruleId)
    return buildApiSuccess({ payload })
  } catch (err) {
    return buildApiError(err instanceof Error ? err.message : 'Preview failed', 500)
  }
}
