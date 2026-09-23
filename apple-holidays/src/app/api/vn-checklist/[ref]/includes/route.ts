import { NextRequest } from 'next/server'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { checklistSession } from '@/lib/vn-checklist/access'
import { draftsFromIncludes } from '@/lib/vn-checklist/server'

export const dynamic = 'force-dynamic'

/** GET — draft rows from the products picked on this booking's agenda. Nothing is saved. */
export async function GET(_req: NextRequest, { params }: { params: { ref: string } }) {
  const auth = await checklistSession(true)
  if ('error' in auth) return buildApiError(auth.error, auth.status)
  try {
    return buildApiSuccess(await draftsFromIncludes(decodeURIComponent(params.ref)))
  } catch (err) {
    return buildApiError(err instanceof Error ? err.message : 'Could not read the agenda includes', 500)
  }
}
