import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { MC_REPORT_ROLES, TemplateError, updateTemplate, deleteTemplate } from '@/lib/mc-report-templates'
import type { UserRole } from '@prisma/client'

export const dynamic = 'force-dynamic'

async function actorOf() {
  const session = await getServerSession(authOptions)
  if (!session?.user) return { error: buildApiError('Unauthorized', 401) }
  const role = session.user.role as UserRole
  if (!MC_REPORT_ROLES.includes(role)) return { error: buildApiError('Forbidden', 403) }
  return { actor: { id: session.user.id, name: session.user.name ?? null, role } }
}

/** PUT — update a template you own. DELETE — remove it. */
export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const { actor, error } = await actorOf()
  if (error) return error
  try {
    const t = await updateTemplate(params.id, await req.json(), actor)
    return buildApiSuccess({ ...t, canEdit: true })
  } catch (err) {
    if (err instanceof TemplateError) return buildApiError(err.message, err.status)
    console.error('[mc-report/templates] update failed', err)
    return buildApiError('Could not update the template', 500)
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const { actor, error } = await actorOf()
  if (error) return error
  try {
    await deleteTemplate(params.id, actor)
    return buildApiSuccess({ deleted: true })
  } catch (err) {
    if (err instanceof TemplateError) return buildApiError(err.message, err.status)
    console.error('[mc-report/templates] delete failed', err)
    return buildApiError('Could not delete the template', 500)
  }
}
