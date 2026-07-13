import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import {
  runBookingCreateForDate, runBookingCreateForDateRange, getAutoCreateSettings,
} from '@/lib/auto-booking-create'
import type { ProcessDocType } from '@/lib/onedrive-monitor'
import { prisma } from '@/lib/prisma'

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session || !['ULTRA_SUPER_ADMIN', 'SUPER_ADMIN'].includes(session.user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))

  const triggeredBy = session.user.email ?? session.user.name ?? 'admin'
  const driveKeys: string[] | undefined = Array.isArray(body.driveKeys) ? body.driveKeys : undefined

  // Which document types to process. Default to both to preserve auto behaviour.
  const rawTypes = Array.isArray(body.types) ? body.types : ['TC', 'PNL']
  const types = rawTypes.filter((t: unknown): t is ProcessDocType => t === 'TC' || t === 'PNL')
  if (types.length === 0) {
    return NextResponse.json({ error: 'Select at least one type (TC or PNL)' }, { status: 400 })
  }

  // ── Date-range mode ──────────────────────────────────────────────────────
  if (body.dateFrom || body.dateTo) {
    const dateFrom = new Date(body.dateFrom)
    const dateTo   = new Date(body.dateTo)
    dateFrom.setHours(0, 0, 0, 0)
    dateTo.setHours(0, 0, 0, 0)
    if (isNaN(dateFrom.getTime()) || isNaN(dateTo.getTime())) {
      return NextResponse.json({ error: 'Invalid dateFrom/dateTo' }, { status: 400 })
    }
    if (dateFrom > dateTo) {
      return NextResponse.json({ error: 'dateFrom must be on or before dateTo' }, { status: 400 })
    }

    const job = await prisma.oneDriveBookingJob.create({
      data: { targetDate: dateFrom, triggeredBy: `manual:${triggeredBy}`, status: 'running' },
    })

    void runBookingCreateForDateRange(dateFrom, dateTo, `manual:${triggeredBy}`, driveKeys, job.id, types)
      .catch(err => console.error('[AutoCreate] background range run error:', err))

    return NextResponse.json({ jobId: job.id, status: 'started' })
  }

  // ── Single-date mode ─────────────────────────────────────────────────────
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

  // Create the job record immediately so we can return the jobId now
  const job = await prisma.oneDriveBookingJob.create({
    data: { targetDate, triggeredBy: `manual:${triggeredBy}`, status: 'running' },
  })

  // Fire in background — do NOT await so GCP doesn't hit the 60s gateway timeout
  void runBookingCreateForDate(targetDate, `manual:${triggeredBy}`, driveKeys, job.id, types).catch(err => {
    console.error('[AutoCreate] background run error:', err)
  })

  return NextResponse.json({ jobId: job.id, status: 'started' })
}
