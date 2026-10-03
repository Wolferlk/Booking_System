/**
 * POST /api/driver-auto/links   { partyKey, action: 'rotate' | 'exclude' | 'include' }
 *
 * rotate  — issue a new link; every link sent before stops working.
 * exclude — stop sending the morning message to this party (the link still works).
 * include — start sending it again.
 */
import { NextRequest } from 'next/server'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { logActivity } from '@/lib/activity'
import { requireDaStaff } from '@/lib/driver-auto/api-auth'
import { boardUrl, readSettings, writeSettings } from '@/lib/driver-auto/server'
import { parsePartyKey } from '@/lib/driver-auto/shared'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const staff = await requireDaStaff()
  if ('error' in staff) return buildApiError(staff.error, staff.status)

  let body: { partyKey?: string; action?: string }
  try { body = await req.json() } catch { return buildApiError('Invalid JSON', 400) }
  const key = body.partyKey ?? ''
  if (!parsePartyKey(key)) return buildApiError('Invalid partyKey', 400)

  const s = await readSettings()
  if (body.action === 'rotate') {
    s.linkEpochs[key] = (s.linkEpochs[key] ?? 0) + 1
  } else if (body.action === 'exclude') {
    if (!s.excluded.includes(key)) s.excluded.push(key)
  } else if (body.action === 'include') {
    s.excluded = s.excluded.filter(k => k !== key)
  } else {
    return buildApiError('action must be rotate, exclude or include', 400)
  }
  const saved = await writeSettings(s)
  void logActivity({ userId: staff.userId, action: 'DRIVER_AUTO_LINK', entityType: 'Partner', entityId: key, details: { action: body.action } })
  return buildApiSuccess(
    { partyKey: key, link: boardUrl(key, saved), excluded: saved.excluded.includes(key) },
    body.action === 'rotate' ? 'New link issued — the old one no longer works' : 'Saved',
  )
}
