import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import type { UserRole } from '@prisma/client'

/** PATCH { folderUrl: string | null } — assign or clear the OneDrive booking folder URL. */
export async function PATCH(
  req: NextRequest,
  { params }: { params: { ref: string } },
) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)

  const role = session.user.role as UserRole
  if (!['BT_USER', 'GT_USER', 'GT_TE_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN'].includes(role)) {
    return buildApiError('Forbidden', 403)
  }

  const body = await req.json().catch(() => null)
  const folderUrl = body?.folderUrl ?? null

  const booking = await prisma.booking.findUnique({ where: { bookingRef: params.ref }, select: { id: true } })
  if (!booking) return buildApiError('Booking not found', 404)

  await prisma.booking.update({
    where: { bookingRef: params.ref },
    data: { onedriveFolderUrl: folderUrl },
  })

  return buildApiSuccess({ folderUrl })
}
