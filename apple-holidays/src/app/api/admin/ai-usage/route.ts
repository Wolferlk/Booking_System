import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'

const CALL_LABELS: Record<string, string> = {
  booking_extraction:  'Booking Extraction',
  pnl_extraction:      'PNL Extraction',
  pnl_classify:        'PNL Classify',
  agenda_generation:   'Agenda Generation',
  ticket_details:      'Ticket Details',
  ai_suggestion:       'AI Suggestion',
  onedrive_pnl_parse:  'OneDrive PNL Parse',
  other:               'Other',
}

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session || !['SUPER_ADMIN', 'ULTRA_SUPER_ADMIN'].includes(session.user.role)) {
    return buildApiError('Forbidden', 403)
  }

  const now   = new Date()
  const day1  = new Date(now); day1.setHours(0, 0, 0, 0)
  const day7  = new Date(now); day7.setDate(now.getDate() - 7)
  const day30 = new Date(now); day30.setDate(now.getDate() - 30)

  const [todayLogs, weekLogs, monthLogs, recentLogs, byType] = await Promise.all([
    prisma.aiUsageLog.aggregate({
      where: { createdAt: { gte: day1 } },
      _sum: { totalTokens: true, estimatedCostUsd: true },
      _count: { id: true },
    }),
    prisma.aiUsageLog.aggregate({
      where: { createdAt: { gte: day7 } },
      _sum: { totalTokens: true, estimatedCostUsd: true },
      _count: { id: true },
    }),
    prisma.aiUsageLog.aggregate({
      where: { createdAt: { gte: day30 } },
      _sum: { totalTokens: true, estimatedCostUsd: true },
      _count: { id: true },
    }),
    prisma.aiUsageLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: 50,
    }),
    prisma.aiUsageLog.groupBy({
      by: ['callType', 'model'],
      where: { createdAt: { gte: day30 } },
      _sum: { totalTokens: true, promptTokens: true, completionTokens: true, estimatedCostUsd: true },
      _count: { id: true },
      orderBy: { _sum: { totalTokens: 'desc' } },
    }),
  ])

  // Daily breakdown for last 14 days
  const day14 = new Date(now); day14.setDate(now.getDate() - 14)
  const rawDailyLogs = await prisma.aiUsageLog.findMany({
    where: { createdAt: { gte: day14 } },
    select: { createdAt: true, totalTokens: true, estimatedCostUsd: true },
  })

  const dailyMap: Record<string, { tokens: number; cost: number; calls: number }> = {}
  for (const log of rawDailyLogs) {
    const key = log.createdAt.toISOString().slice(0, 10)
    if (!dailyMap[key]) dailyMap[key] = { tokens: 0, cost: 0, calls: 0 }
    dailyMap[key].tokens += log.totalTokens
    dailyMap[key].cost   += log.estimatedCostUsd
    dailyMap[key].calls  += 1
  }

  const daily = Object.entries(dailyMap)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, v]) => ({ date, ...v }))

  return buildApiSuccess({
    summary: {
      today: {
        tokens: todayLogs._sum.totalTokens ?? 0,
        cost:   todayLogs._sum.estimatedCostUsd ?? 0,
        calls:  todayLogs._count.id,
      },
      week: {
        tokens: weekLogs._sum.totalTokens ?? 0,
        cost:   weekLogs._sum.estimatedCostUsd ?? 0,
        calls:  weekLogs._count.id,
      },
      month: {
        tokens: monthLogs._sum.totalTokens ?? 0,
        cost:   monthLogs._sum.estimatedCostUsd ?? 0,
        calls:  monthLogs._count.id,
      },
    },
    byType: byType.map(r => ({
      callType:    r.callType,
      label:       CALL_LABELS[r.callType] ?? r.callType,
      model:       r.model,
      calls:       r._count.id,
      totalTokens: r._sum.totalTokens ?? 0,
      promptTokens: r._sum.promptTokens ?? 0,
      completionTokens: r._sum.completionTokens ?? 0,
      cost:        r._sum.estimatedCostUsd ?? 0,
    })),
    daily,
    recent: recentLogs.map(r => ({
      id:          r.id,
      callType:    r.callType,
      label:       CALL_LABELS[r.callType] ?? r.callType,
      model:       r.model,
      promptTokens: r.promptTokens,
      completionTokens: r.completionTokens,
      totalTokens: r.totalTokens,
      cost:        r.estimatedCostUsd,
      bookingRef:  r.bookingRef,
      source:      r.source,
      createdAt:   r.createdAt.toISOString(),
    })),
  })
}
