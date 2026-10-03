/**
 * PUT /api/driver-auto/settings — save the Driver-Auto switches.
 *
 * Writes exactly one `system_settings` row (`driver_auto_settings`). The body
 * is merged onto the stored settings, so the client can send just what changed
 * (e.g. `{ countries: { VIETNAM: { requireApproval: false } } }`).
 */
import { NextRequest } from 'next/server'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { logActivity } from '@/lib/activity'
import { requireDaStaff } from '@/lib/driver-auto/api-auth'
import { readSettings, writeSettings } from '@/lib/driver-auto/server'
import { DA_COUNTRIES, type DaSettings } from '@/lib/driver-auto/shared'

export const dynamic = 'force-dynamic'

export async function PUT(req: NextRequest) {
  const staff = await requireDaStaff()
  if ('error' in staff) return buildApiError(staff.error, staff.status)

  let body: Partial<DaSettings>
  try { body = await req.json() } catch { return buildApiError('Invalid JSON', 400) }

  const current = await readSettings()
  const countries = { ...current.countries }
  for (const c of DA_COUNTRIES) {
    const patch = body.countries?.[c]
    if (!patch) continue
    // A user scoped to one country may only change that country's switches.
    if (!staff.countries.includes(c)) return buildApiError(`You cannot change ${c} settings`, 403)
    countries[c] = { ...countries[c], ...patch }
  }

  const next: DaSettings = {
    ...current,
    horizonDays: body.horizonDays ?? current.horizonDays,
    sendHour: body.sendHour ?? current.sendHour,
    maxPendingPerParty: body.maxPendingPerParty ?? current.maxPendingPerParty,
    countries,
  }
  const saved = await writeSettings(next)
  void logActivity({ userId: staff.userId, action: 'DRIVER_AUTO_SETTINGS', entityType: 'SystemSetting', entityId: 'driver_auto_settings', details: { change: body } })
  return buildApiSuccess(saved, 'Settings saved')
}
