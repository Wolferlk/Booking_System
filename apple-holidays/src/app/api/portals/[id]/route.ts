/**
 * PATCH  /api/portals/[id]  — edit a portal, or turn it on/off
 * DELETE /api/portals/[id]  — turn it off (never removes the row)
 *
 * These rows live in the Accounts database and are read by Payable 1.0 when it
 * decides who to pay, so this app edits them but does not delete them: a
 * ticket already bought through a portal carries its name, and Accounts can
 * remove one that has never been used from its own settings page.
 */
import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { hasPermission } from '@/lib/rbac'
import {
  findPortal, setPortalActive, updatePortal,
  PORTAL_COUNTRIES, PORTAL_KINDS, type PortalCountry, type PortalKind,
} from '@/lib/portals'
import type { UserRole } from '@prisma/client'

export const dynamic = 'force-dynamic'

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)

  const role = session.user.role as UserRole
  if (!hasPermission(role, 'admin:override')) return buildApiError('Forbidden', 403)

  const id = Number(params.id)
  if (!Number.isInteger(id) || id <= 0) return buildApiError('Not a portal.')

  const body = await req.json().catch(() => null)
  if (!body) return buildApiError('Send the changes to make.')

  const actor = `${session.user.name || session.user.email} (OPS)`

  try {
    const portal = await findPortal(id)
    if (!portal) return buildApiError('That portal is no longer on the list.', 404)

    // A bare {isActive} is the toggle, not an edit — it must not blank every
    // other field by treating the absent ones as cleared.
    const keys = Object.keys(body)
    if (keys.length === 1 && keys[0] === 'isActive') {
      await setPortalActive(id, body.isActive !== false, actor)

      return buildApiSuccess(
        { id },
        body.isActive !== false
          ? `“${portal.name}” is available again.`
          : `“${portal.name}” is off the list. Tickets already bought through it are untouched.`,
      )
    }

    const country = String(body.country ?? portal.country).toUpperCase()
    if (!(country in PORTAL_COUNTRIES)) return buildApiError('That is not a country we buy in.')

    const kind = String(body.kind ?? portal.kind)
    if (!(kind in PORTAL_KINDS)) return buildApiError('That is not a kind of portal.')

    const name = String(body.name ?? portal.name).trim()
    if (!name) return buildApiError('A portal needs a name.')

    await updatePortal(id, {
      country: country as PortalCountry,
      name,
      kind: kind as PortalKind,
      categories: body.categories === undefined
        ? portal.categories
        : (Array.isArray(body.categories) && body.categories.length ? body.categories.map(String) : null),
      supplierName: body.supplierName ?? portal.supplierName,
      currency: body.currency ?? portal.currency,
      contactName: body.contactName ?? portal.contactName,
      contactPhone: body.contactPhone ?? portal.contactPhone,
      contactEmail: body.contactEmail ?? portal.contactEmail,
      notes: body.notes ?? portal.notes,
      isActive: body.isActive === undefined ? portal.isActive : body.isActive !== false,
      sortOrder: Number(body.sortOrder ?? portal.sortOrder),
    }, actor)

    return buildApiSuccess({ id }, `“${name}” updated — the Accounts board sees the change too.`)
  } catch (err) {
    console.error('[portals] update failed:', err)
    const detail = err instanceof Error ? err.message : ''
    return buildApiError(detail || 'Could not save that portal.', 502)
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)

  const role = session.user.role as UserRole
  if (!hasPermission(role, 'admin:override')) return buildApiError('Forbidden', 403)

  const id = Number(params.id)
  if (!Number.isInteger(id) || id <= 0) return buildApiError('Not a portal.')

  try {
    const portal = await findPortal(id)
    if (!portal) return buildApiError('That portal is no longer on the list.', 404)

    await setPortalActive(id, false, `${session.user.name || session.user.email} (OPS)`)

    return buildApiSuccess(
      { id },
      `“${portal.name}” is off the list for new purchases. Nothing already bought through it changes.`,
    )
  } catch (err) {
    console.error('[portals] deactivate failed:', err)
    return buildApiError('Could not turn that portal off.', 502)
  }
}
