import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { sendAgentConfirmationEmail } from '@/lib/send-agent-email'
import type { UserRole } from '@prisma/client'

export async function POST(
  req: NextRequest,
  { params }: { params: { ref: string } },
) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)

  const role = session.user.role as UserRole
  if (!['TE_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN'].includes(role)) return buildApiError('Forbidden', 403)

  const booking = await prisma.booking.findUnique({
    where: { bookingRef: params.ref },
    select: { bookingRef: true },
  })
  if (!booking) return buildApiError('Booking not found', 404)

  let cc: string[] | undefined
  try {
    const body = await req.json() as { cc?: string[] }
    cc = body.cc
  } catch {
    // no body — that's fine
  }

  await sendAgentConfirmationEmail(params.ref, { cc })

  return buildApiSuccess(null, 'Confirmation email sent')
}
