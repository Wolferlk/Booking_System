/**
 * GET  /api/driver-auto/template — is the open-trips WhatsApp template approved?
 * POST /api/driver-auto/template — submit it to Meta for review.
 */
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { createMetaTemplate, listMetaTemplates } from '@/lib/whatsapp'
import { requireDaStaff } from '@/lib/driver-auto/api-auth'
import { DRIVER_BOARD_TEMPLATE_DEF } from '@/lib/driver-auto/notify'

export const dynamic = 'force-dynamic'

export async function GET() {
  const staff = await requireDaStaff()
  if ('error' in staff) return buildApiError(staff.error, staff.status)
  try {
    const approved = await listMetaTemplates('APPROVED')
    const ok = approved.some(t => t.name === DRIVER_BOARD_TEMPLATE_DEF.name)
    return buildApiSuccess({ name: DRIVER_BOARD_TEMPLATE_DEF.name, approved: ok, body: DRIVER_BOARD_TEMPLATE_DEF.bodyText })
  } catch (err) {
    return buildApiSuccess({ name: DRIVER_BOARD_TEMPLATE_DEF.name, approved: null, error: err instanceof Error ? err.message : String(err), body: DRIVER_BOARD_TEMPLATE_DEF.bodyText })
  }
}

export async function POST() {
  const staff = await requireDaStaff()
  if ('error' in staff) return buildApiError(staff.error, staff.status)
  try {
    const created = await createMetaTemplate(DRIVER_BOARD_TEMPLATE_DEF)
    return buildApiSuccess(created, `Template ${created.name} submitted to Meta (${created.status})`)
  } catch (err) {
    return buildApiError(err instanceof Error ? err.message : 'Template submission failed', 400)
  }
}
