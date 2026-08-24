/**
 * The standing copy number — read by anyone who sends documents, changed by an
 * admin.
 *
 *   GET  what every driver document is currently shadowed to, and whether that
 *        number is usable. The send dialog shows this before the send, so the
 *        desk knows where the second copy is going rather than discovering it
 *        in someone else's chat.
 *   PUT  { enabled, phone, label } — set it. Admin only.
 *
 * ---- Why the write is narrower than the read ----
 *
 * The copy is the company's audit trail of what left the building. A desk that
 * can point it at a different number is a desk that can quietly stop copying,
 * so changing it is an administrative act and reading it is not.
 */
import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { hasPermission } from '@/lib/rbac'
import { readDriverDocCopy, saveDriverDocCopy } from '@/lib/sl-driver-doc-copy'
import { normaliseSriLankanPhone } from '@/lib/sl-phone'
import type { UserRole } from '@prisma/client'

export const dynamic = 'force-dynamic'

const ADMIN_ROLES = new Set<string>(['SUPER_ADMIN', 'ULTRA_SUPER_ADMIN'])

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)

  const role = session.user.role as UserRole
  if (!hasPermission(role, 'pnl:read')) return buildApiError('Forbidden', 403)

  const config = await readDriverDocCopy()
  return buildApiSuccess({ ...config, canEdit: ADMIN_ROLES.has(role) })
}

export async function PUT(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)

  const role = session.user.role as UserRole
  if (!ADMIN_ROLES.has(role)) {
    return buildApiError('Only an administrator may change the number driver documents are copied to.', 403)
  }

  let body: { enabled?: unknown; phone?: unknown; label?: unknown }
  try {
    body = await req.json()
  } catch {
    return buildApiError('The request body was not valid JSON.', 400)
  }

  const enabled = body.enabled === true
  const phone   = typeof body.phone === 'string' ? body.phone : ''
  const label   = typeof body.label === 'string' ? body.label : ''

  // Refused *before* it is written, not after. A saved-but-unusable contact is
  // the worst of both: the settings screen reads as configured and not one copy
  // is ever sent. Turning copying off with a blank number is fine — that is how
  // it is switched off.
  if (enabled) {
    const read = normaliseSriLankanPhone(phone)
    if (!read.ok) {
      return buildApiError(
        read.reason ?? 'That number cannot be read as a phone number, so the copies would go nowhere.',
        422,
      )
    }
  }

  const config = await saveDriverDocCopy({ enabled, phone, label })
  return buildApiSuccess({ ...config, canEdit: true })
}
