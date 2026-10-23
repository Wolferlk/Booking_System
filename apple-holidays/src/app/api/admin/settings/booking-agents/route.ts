/**
 * Distinct agent names on bookings, busiest first — feeds the Super Partners
 * picker on the settings page so admins pick real spellings instead of guessing.
 * Read-only.
 */
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'

export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session || !['SUPER_ADMIN', 'ULTRA_SUPER_ADMIN'].includes(session.user.role)) return buildApiError('Forbidden', 403)

  const groups = await prisma.booking.groupBy({
    by: ['agent'],
    where: { agent: { not: null } },
    _count: { agent: true },
  })
  const agents = groups
    .map(g => ({ name: (g.agent ?? '').trim(), count: g._count.agent }))
    .filter(a => a.name.length > 0)
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))

  return buildApiSuccess(agents)
}
