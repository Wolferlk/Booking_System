/**
 * My profile.
 *
 * Everyone maintains their own name, phone and photo here — nothing in this
 * route touches anyone else's record, so it needs no role check beyond being
 * signed in. Role, country and active status stay where they belong: with the
 * super admins in /dashboard/users.
 */
import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'

export const dynamic = 'force-dynamic'

const SELECT = {
  id: true, email: true, name: true, role: true, country: true,
  phone: true, avatar: true, isActive: true, createdAt: true, updatedAt: true,
} as const

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return buildApiError('Unauthorized', 401)

  const user = await prisma.user.findUnique({ where: { id: session.user.id }, select: SELECT })
  if (!user) return buildApiError('Your account could not be found.', 404)

  return buildApiSuccess(user)
}

export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return buildApiError('Unauthorized', 401)

  const body = await req.json().catch(() => ({})) as { name?: unknown; phone?: unknown }

  const name = typeof body.name === 'string' ? body.name.trim() : undefined
  const phone = typeof body.phone === 'string' ? body.phone.trim() : undefined

  if (name !== undefined && (name.length < 2 || name.length > 120)) {
    return buildApiError('Your name must be between 2 and 120 characters.', 422)
  }
  if (phone !== undefined && phone.length > 40) {
    return buildApiError('That phone number is too long.', 422)
  }

  // Email is the identity people sign in with — changing it is an admin action,
  // not a self-service one, exactly as in the Accounts app.
  const user = await prisma.user.update({
    where: { id: session.user.id },
    data: {
      ...(name !== undefined ? { name } : {}),
      ...(phone !== undefined ? { phone: phone || null } : {}),
    },
    select: SELECT,
  })

  return buildApiSuccess(user)
}
