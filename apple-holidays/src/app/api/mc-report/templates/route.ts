import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { MC_REPORT_ROLES, TemplateError, createTemplate, listTemplates, canEdit } from '@/lib/mc-report-templates'
import type { UserRole } from '@prisma/client'

export const dynamic = 'force-dynamic'

/** GET — the caller's own templates plus every shared one. POST — save a new template. */
export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user) return buildApiError('Unauthorized', 401)
  const role = session.user.role as UserRole
  if (!MC_REPORT_ROLES.includes(role)) return buildApiError('Forbidden', 403)

  const actor = { id: session.user.id, name: session.user.name ?? null, role }
  const templates = await listTemplates(actor)
  return buildApiSuccess(templates.map(t => ({ ...t, canEdit: canEdit(t, actor) })))
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return buildApiError('Unauthorized', 401)
  const role = session.user.role as UserRole
  if (!MC_REPORT_ROLES.includes(role)) return buildApiError('Forbidden', 403)

  const actor = { id: session.user.id, name: session.user.name ?? null, role }
  try {
    const t = await createTemplate(await req.json(), actor)
    return buildApiSuccess({ ...t, canEdit: true })
  } catch (err) {
    if (err instanceof TemplateError) return buildApiError(err.message, err.status)
    console.error('[mc-report/templates] create failed', err)
    return buildApiError('Could not save the template', 500)
  }
}
