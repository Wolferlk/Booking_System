/**
 * Excel → Agenda auto-update — the global switch.
 *
 * GET   — the setting and the last run (any signed-in staff user).
 * POST  { mode: 'OFF' | 'AUTO', intervalMin? } — SUPER_ADMIN / ULTRA_SUPER_ADMIN only.
 */
import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { getMcAutoConfig, getMcAutoState, isMcAdmin, saveMcAutoConfig } from '@/lib/vn-mc-import/config'

export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  const [config, lastRun] = await Promise.all([getMcAutoConfig(), getMcAutoState()])
  return buildApiSuccess({ ...config, lastRun, canAdmin: isMcAdmin(session.user.role) })
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  if (!isMcAdmin(session.user.role)) return buildApiError('Only admins can switch the Excel auto-update', 403)
  const body = await req.json().catch(() => ({})) as { mode?: unknown; intervalMin?: unknown }
  try {
    const config = await saveMcAutoConfig({
      ...(body.mode === 'OFF' || body.mode === 'AUTO' ? { mode: body.mode } : {}),
      ...(body.intervalMin !== undefined ? { intervalMin: Number(body.intervalMin) } : {}),
    })
    console.log(`[Excel auto-update] ${session.user.email ?? session.user.id} set mode=${config.mode} interval=${config.intervalMin}m`)
    return buildApiSuccess({ ...config, lastRun: await getMcAutoState(), canAdmin: true })
  } catch (err) {
    return buildApiError(err instanceof Error ? err.message : 'Could not save', 400)
  }
}
