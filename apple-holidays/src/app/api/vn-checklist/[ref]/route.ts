import { NextRequest } from 'next/server'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { checklistSession } from '@/lib/vn-checklist/access'
import { ChecklistError, isMissingTable, loadChecklist, saveChecklist, type SaveInput } from '@/lib/vn-checklist/server'
import { CHECKLIST_NOT_INSTALLED } from '@/lib/vn-checklist/shared'

export const dynamic = 'force-dynamic'

function fail(err: unknown) {
  if (err instanceof ChecklistError) return buildApiError(err.message, err.status)
  if (isMissingTable(err)) return buildApiError(CHECKLIST_NOT_INSTALLED, 503)
  return buildApiError(err instanceof Error ? err.message : 'Checklist failed', 500)
}

/** GET — the booking's checklist, its live fallbacks, and whether it is installed. */
export async function GET(_req: NextRequest, { params }: { params: { ref: string } }) {
  const auth = await checklistSession()
  if ('error' in auth) return buildApiError(auth.error, auth.status)
  try {
    return buildApiSuccess(await loadChecklist(decodeURIComponent(params.ref)))
  } catch (err) {
    return fail(err)
  }
}

/** PUT — save the whole sheet (header + rows). Rows not sent are removed. */
export async function PUT(req: NextRequest, { params }: { params: { ref: string } }) {
  const auth = await checklistSession(true)
  if ('error' in auth) return buildApiError(auth.error, auth.status)
  const body = await req.json().catch(() => null) as SaveInput | null
  if (!body || !Array.isArray(body.items) || typeof body.header !== 'object') return buildApiError('Invalid checklist')
  if (body.items.length > 300) return buildApiError('A checklist can hold at most 300 rows')
  const u = auth.session.user
  try {
    const saved = await saveChecklist(decodeURIComponent(params.ref), body, { id: u.id, name: u.name, role: u.role as string })
    return buildApiSuccess(saved, 'Checklist saved')
  } catch (err) {
    return fail(err)
  }
}
