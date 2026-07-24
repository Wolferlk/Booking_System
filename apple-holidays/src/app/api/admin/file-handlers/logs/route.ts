import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'

export const dynamic = 'force-dynamic'

// GET — all file-handler activity logs. Optional filters: ?handlerId=&action=
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  if (!['SUPER_ADMIN', 'ULTRA_SUPER_ADMIN'].includes(session.user.role)) return buildApiError('Forbidden', 403)

  const handlerId = req.nextUrl.searchParams.get('handlerId')
  const action    = req.nextUrl.searchParams.get('action')
  const take      = Math.min(Number(req.nextUrl.searchParams.get('take') ?? 200), 500)

  const logs = await prisma.fileHandlerLog.findMany({
    where: {
      ...(handlerId ? { fileHandlerId: handlerId } : {}),
      ...(action ? { action } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take,
    select: {
      id: true, fileHandlerName: true, action: true, bookingRef: true,
      isNumber: true, cntlNumber: true, operationCountry: true, details: true, createdAt: true,
    },
  })
  return buildApiSuccess({ logs })
}
