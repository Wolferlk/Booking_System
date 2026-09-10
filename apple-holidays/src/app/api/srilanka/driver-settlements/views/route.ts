/**
 * The Driver Settlement Register's saved layouts.
 *
 *   GET  — this user's views.
 *   PUT  — replace this user's views with the set in the body.
 *
 * A layout is a preference, so the gate is only "may this person open the
 * register at all" (`pnl:read`) — the same grant the screen runs on. Nothing
 * here reads or writes a figure; hiding a money column does not hide the money,
 * which is why a read-only user may still arrange their own screen.
 *
 * The set is always written whole. See `sl-settlement-views-server.ts`.
 */
import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { hasPermission } from '@/lib/rbac'
import { loadRegisterViews, saveRegisterViews } from '@/lib/sl-settlement-views-server'
import type { UserRole } from '@prisma/client'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

async function guard() {
  const session = await getServerSession(authOptions)
  if (!session) return { error: buildApiError('Unauthorized', 401) }

  const role = session.user.role as UserRole
  if (!hasPermission(role, 'pnl:read')) return { error: buildApiError('Forbidden', 403) }

  const userId = session.user.id
  if (!userId) return { error: buildApiError('This session carries no user', 401) }

  return { userId }
}

export async function GET() {
  const g = await guard()
  if (g.error) return g.error

  return buildApiSuccess({ views: await loadRegisterViews(g.userId!) })
}

export async function PUT(req: NextRequest) {
  const g = await guard()
  if (g.error) return g.error

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return buildApiError('Expected a JSON body', 400)
  }

  const views = (body as { views?: unknown })?.views
  if (!Array.isArray(views)) return buildApiError('Expected { views: [...] }', 400)

  try {
    return buildApiSuccess({ views: await saveRegisterViews(g.userId!, views) })
  } catch (err) {
    console.error('[srilanka/driver-settlements/views] write', err)
    return buildApiError('Failed to save the layout', 500)
  }
}
