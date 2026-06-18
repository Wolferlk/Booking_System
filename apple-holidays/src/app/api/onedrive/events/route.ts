import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  if (!['SUPER_ADMIN', 'ULTRA_SUPER_ADMIN'].includes(session.user.role)) {
    return buildApiError('Forbidden', 403)
  }

  const { searchParams } = new URL(req.url)
  const driveKey  = searchParams.get('driveKey')
  const status    = searchParams.get('status')
  const limit     = parseInt(searchParams.get('limit') ?? '100', 10)

  const events = await prisma.oneDriveEvent.findMany({
    where: {
      ...(driveKey ? { driveType: driveKey }  : {}),
      ...(status   ? { status: status as never } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take:    Math.min(limit, 500),
  })

  const stats = await prisma.oneDriveEvent.groupBy({
    by: ['driveType', 'eventType', 'status'],
    _count: { _all: true },
  })

  const deltaTokens = await prisma.oneDriveDeltaToken.findMany()

  return buildApiSuccess({ events, stats, deltaTokens })
}

export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  if (session.user.role !== 'ULTRA_SUPER_ADMIN') return buildApiError('Forbidden', 403)

  const { driveKey } = await req.json().catch(() => ({})) as { driveKey?: string }

  if (driveKey) {
    await prisma.oneDriveDeltaToken.deleteMany({ where: { driveKey } })
    return buildApiSuccess(null, `Delta token reset for ${driveKey}. Next sync will do a full scan.`)
  }

  await prisma.oneDriveDeltaToken.deleteMany()
  return buildApiSuccess(null, 'All delta tokens reset. Next sync will do a full scan.')
}
