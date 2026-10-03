/**
 * POST /api/driver-auto/send   { country, dryRun?, only?: string[] }
 *
 * "Send now" / "Test" for the morning open-trips message. Same once-a-day
 * guard as the schedule: a party already messaged today is skipped.
 */
import { NextRequest } from 'next/server'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { logActivity } from '@/lib/activity'
import { requireDaStaff } from '@/lib/driver-auto/api-auth'
import { sendBoardLinks } from '@/lib/driver-auto/notify'
import { isDaCountry } from '@/lib/driver-auto/shared'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function POST(req: NextRequest) {
  const staff = await requireDaStaff()
  if ('error' in staff) return buildApiError(staff.error, staff.status)

  let body: { country?: string; dryRun?: boolean; only?: string[] }
  try { body = await req.json() } catch { return buildApiError('Invalid JSON', 400) }
  if (!isDaCountry(body.country)) return buildApiError('Unknown country', 400)
  if (!staff.countries.includes(body.country)) return buildApiError('Outside your country scope', 403)

  try {
    const summary = await sendBoardLinks({
      country: body.country,
      trigger: 'manual',
      dryRun: !!body.dryRun,
      only: Array.isArray(body.only) && body.only.length ? body.only.filter(x => typeof x === 'string') : undefined,
      sentByName: staff.name,
    })
    if (!body.dryRun) {
      void logActivity({ userId: staff.userId, action: 'DRIVER_AUTO_SEND', entityType: 'Country', entityId: body.country,
        details: { trips: summary.trips, whatsapp: summary.whatsappSent, email: summary.emailSent, failed: summary.failed, only: body.only } })
    }
    const msg = summary.dryRun
      ? `Dry run — ${summary.recipients} recipient(s), ${summary.trips} open trip(s). Nothing was sent.`
      : summary.reason ?? `WhatsApp ${summary.whatsappSent} · email ${summary.emailSent} · skipped ${summary.skipped} · failed ${summary.failed}`
    return buildApiSuccess(summary, msg)
  } catch (err) {
    console.error('[driver-auto send]', err)
    return buildApiError(err instanceof Error ? err.message : 'Send failed', 500)
  }
}
