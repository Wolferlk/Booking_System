/**
 * GET /api/public/journey-map-settings
 *
 * The fly-through's pace and camera behaviour, as set on the admin config
 * page. Ungated on purpose: it carries no booking data, and the traveller
 * portal's map needs exactly the same numbers the staff map uses — gating it
 * behind a portal token would mean two sources of truth for one animation.
 */
import { prisma } from '@/lib/prisma'
import { buildApiSuccess } from '@/lib/utils'
import {
  DEFAULT_JM_SETTINGS, JM_SETTING_KEYS, parseJourneyMapSettings,
} from '@/lib/journey-map-settings'

export const dynamic = 'force-dynamic'

const KEYS = Object.values(JM_SETTING_KEYS)

export async function GET() {
  try {
    const rows = await prisma.systemSetting.findMany({ where: { key: { in: [...KEYS] } } })
    const raw: Record<string, string> = {}
    rows.forEach(r => { raw[r.key] = r.value })
    return buildApiSuccess(parseJourneyMapSettings(raw))
  } catch {
    // The map is not worth failing over a settings read — it just animates at
    // the built-in pace instead.
    return buildApiSuccess(DEFAULT_JM_SETTINGS)
  }
}
