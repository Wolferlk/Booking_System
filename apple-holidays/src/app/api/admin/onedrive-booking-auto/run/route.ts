import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { runBookingCreateForDate, getAutoCreateSettings } from '@/lib/auto-booking-create'
import { prisma } from '@/lib/prisma'

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session || !['ULTRA_SUPER_ADMIN', 'SUPER_ADMIN'].includes(session.user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))

  // Determine target date
  let targetDate: Date
  if (body.targetDate) {
    targetDate = new Date(body.targetDate)
    targetDate.setHours(0, 0, 0, 0)
    if (isNaN(targetDate.getTime())) {
      return NextResponse.json({ error: 'Invalid targetDate' }, { status: 400 })
    }
  } else {
    const settings = await getAutoCreateSettings()
    targetDate = new Date()
    targetDate.setDate(targetDate.getDate() + settings.daysAhead)
    targetDate.setHours(0, 0, 0, 0)
  }

  const triggeredBy = session.user.email ?? session.user.name ?? 'admin'
  const driveKeys: string[] | undefined = Array.isArray(body.driveKeys) ? body.driveKeys : undefined

  // Create the job record immediately so we can return the jobId now
  const job = await prisma.oneDriveBookingJob.create({
    data: { targetDate, triggeredBy: `manual:${triggeredBy}`, status: 'running' },
  })

  // Fire in background — do NOT await so GCP doesn't hit the 60s gateway timeout
  void runBookingCreateForDate(targetDate, `manual:${triggeredBy}`, driveKeys, job.id).catch(err => {
    console.error('[AutoCreate] background run error:', err)
  })

  return NextResponse.json({ jobId: job.id, status: 'started' })
}
