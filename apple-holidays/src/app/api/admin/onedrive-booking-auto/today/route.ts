import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Return today's most recent completed job for the notification banner
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const tomorrow = new Date(today)
  tomorrow.setDate(tomorrow.getDate() + 1)

  const job = await prisma.oneDriveBookingJob.findFirst({
    where: {
      createdAt: { gte: today, lt: tomorrow },
      status:    'done',
    },
    orderBy: { createdAt: 'desc' },
    select: {
      id:           true,
      targetDate:   true,
      triggeredBy:  true,
      totalCreated: true,
      totalUpdated: true,
      totalErrors:  true,
      completedAt:  true,
    },
  })

  return NextResponse.json({ job })
}
