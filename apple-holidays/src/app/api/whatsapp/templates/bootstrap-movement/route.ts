/**
 * One-click registration of the movement-briefing template with Meta.
 *
 *   GET  — the exact body, examples and current status
 *   POST — submit it for review under the name set in Settings (UTILITY)
 *
 * Admin only: it creates a template on the shared WABA.
 */
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { createMetaTemplate } from '@/lib/whatsapp'
import { loadMovementWaConfig, movementTemplateStatus } from '@/lib/movement-whatsapp'
import {
  MOVEMENT_BRIEF_BODY,
  MOVEMENT_BRIEF_EXAMPLES,
  MOVEMENT_BRIEF_FOOTER,
} from '@/lib/movement-whatsapp-shared'

export const dynamic = 'force-dynamic'

const ADMIN = ['SUPER_ADMIN', 'ULTRA_SUPER_ADMIN']

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  if (!ADMIN.includes(session.user.role)) return buildApiError('Forbidden', 403)

  const config = await loadMovementWaConfig()
  return buildApiSuccess({
    name:     config.templateName,
    language: config.lang,
    category: 'UTILITY',
    body:     MOVEMENT_BRIEF_BODY,
    footer:   MOVEMENT_BRIEF_FOOTER,
    examples: MOVEMENT_BRIEF_EXAMPLES,
    status:   await movementTemplateStatus(config, true),
  })
}

export async function POST() {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  if (!ADMIN.includes(session.user.role)) return buildApiError('Forbidden', 403)

  const config = await loadMovementWaConfig()
  try {
    const created = await createMetaTemplate({
      name:         config.templateName,
      category:     'UTILITY',
      language:     config.lang,
      bodyText:     MOVEMENT_BRIEF_BODY,
      bodyExamples: MOVEMENT_BRIEF_EXAMPLES,
      footerText:   MOVEMENT_BRIEF_FOOTER,
    })
    const status = await movementTemplateStatus(config, true)
    return buildApiSuccess({ name: created.name, status }, `Template "${created.name}" submitted — status ${created.status}`)
  } catch (err) {
    return buildApiError(err instanceof Error ? err.message : String(err), 422)
  }
}
