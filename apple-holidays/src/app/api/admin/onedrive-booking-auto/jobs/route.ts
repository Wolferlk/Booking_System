import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session || !['ULTRA_SUPER_ADMIN', 'SUPER_ADMIN'].includes(session.user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { searchParams } = new URL(req.url)
  const limit = Math.min(100, Number(searchParams.get('limit') ?? '20'))

  const jobs = await prisma.oneDriveBookingJob.findMany({
    orderBy: { createdAt: 'desc' },
    take: limit,
  })

  return NextResponse.json(jobs)
}
