/**
 * The Drive Log's settlement paperwork for one booking.
 *
 *   GET    ?ref=…   the pack in force, plus the draft the systems would build
 *                   today, the guest's two login-free links (which the QR card
 *                   prints as codes) and any reason a costed figure is missing.
 *   PUT    ?ref=…   save the desk's edited pack. Replaces the row wholesale.
 *   DELETE ?ref=…   throw the saved pack away and go back to the draft.
 *
 * ---- Who may use it ----
 *
 * Reading runs on `pnl:read`, the same gate as the Drive Log itself — the
 * transport sheet carries what a booking costs. Writing needs `assignment:edit`
 * or `pnl:view_profit`, which is the Sri Lankan ground desk, Accounts and the
 * admins: the people who actually hand these sheets to a driver.
 *
 * ---- What it writes ----
 *
 * One row in this system's own `sl_settlement_docs`, keyed by booking ref.
 * Nothing else, in either database. The accounts database is read from and
 * never written to, and no booking, agenda, allocation or P&L row is touched by
 * any path in this file.
 */
import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { hasPermission } from '@/lib/rbac'
import { loadDocState, resetDocPack, saveDocPack } from '@/lib/sl-settlement-docs-server'
import { guestLinks } from '@/lib/sl-settlement-qr'
import type { UserRole } from '@prisma/client'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

/** The booking ref off the query string, or null when it is missing or absurd. */
function bookingRef(req: NextRequest): string | null {
  const ref = (req.nextUrl.searchParams.get('ref') ?? '').trim()
  return ref && ref.length <= 60 ? ref : null
}

const canWrite = (role: UserRole) =>
  hasPermission(role, 'assignment:edit') || hasPermission(role, 'pnl:view_profit')

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)

  const role = session.user.role as UserRole
  if (!hasPermission(role, 'pnl:read')) return buildApiError('Forbidden', 403)

  const ref = bookingRef(req)
  if (!ref) return buildApiError('A booking reference is required.', 400)

  try {
    const state = await loadDocState(ref)
    if (!state) return buildApiError(`Booking ${ref} was not found.`, 404)
    return buildApiSuccess({ ...state, canWrite: canWrite(role), links: guestLinks(ref) })
  } catch (err) {
    console.error('[drive-log/documents GET]', err)
    return buildApiError('The settlement documents could not be loaded.', 500)
  }
}

export async function PUT(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)

  const role = session.user.role as UserRole
  if (!canWrite(role)) {
    return buildApiError('Only the operations desk, Accounts and admins may edit settlement documents.', 403)
  }

  const ref = bookingRef(req)
  if (!ref) return buildApiError('A booking reference is required.', 400)

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return buildApiError('The request body was not valid JSON.', 400)
  }

  try {
    const state = await saveDocPack(ref, (body as { pack?: unknown })?.pack ?? body, session.user.name ?? session.user.email ?? null)
    if (!state) return buildApiError(`Booking ${ref} was not found.`, 404)
    return buildApiSuccess({ ...state, canWrite: true, links: guestLinks(ref) })
  } catch (err) {
    console.error('[drive-log/documents PUT]', err)
    return buildApiError('The settlement documents could not be saved.', 500)
  }
}

export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)

  const role = session.user.role as UserRole
  if (!canWrite(role)) {
    return buildApiError('Only the operations desk, Accounts and admins may reset settlement documents.', 403)
  }

  const ref = bookingRef(req)
  if (!ref) return buildApiError('A booking reference is required.', 400)

  try {
    const state = await resetDocPack(ref)
    if (!state) return buildApiError(`Booking ${ref} was not found.`, 404)
    return buildApiSuccess({ ...state, canWrite: true, links: guestLinks(ref) })
  } catch (err) {
    console.error('[drive-log/documents DELETE]', err)
    return buildApiError('The saved documents could not be cleared.', 500)
  }
}
