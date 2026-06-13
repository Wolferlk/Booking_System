import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  if (!['BT_USER', 'SUPER_ADMIN'].includes(session.user.role)) return buildApiError('Forbidden', 403)

  const { graphIds } = await req.json() as { graphIds: string[] }
  if (!Array.isArray(graphIds) || graphIds.length === 0) return buildApiSuccess([])

  const keys = graphIds.map(id => `processed_email_${id}`)
  const rows = await prisma.systemSetting.findMany({ where: { key: { in: keys } } })

  const processed = rows.map(row => {
    const graphId = row.key.replace('processed_email_', '')
    const [bookingRef, processedAt] = row.value.split('|')
    return { graphId, bookingRef, processedAt: processedAt ?? null }
  })

  return buildApiSuccess(processed)
}
