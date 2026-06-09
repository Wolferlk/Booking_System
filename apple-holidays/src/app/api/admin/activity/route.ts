import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  if (session.user.role !== 'SUPER_ADMIN') return buildApiError('Forbidden', 403)

  const { searchParams } = new URL(req.url)
  const userId = searchParams.get('userId') ?? undefined
  const action = searchParams.get('action') ?? undefined
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '100'), 200)
  const page = parseInt(searchParams.get('page') ?? '1')

  const where = {
    ...(userId && { userId }),
    ...(action && { action }),
  }

  const [logs, total] = await Promise.all([
    prisma.activityLog.findMany({
      where,
      include: {
        user: { select: { id: true, name: true, email: true, role: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: (page - 1) * limit,
    }),
    prisma.activityLog.count({ where }),
  ])

  return buildApiSuccess({ logs, total, page, limit })
}
