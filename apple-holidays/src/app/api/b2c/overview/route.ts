/**
 * B2C control-centre data: source-side health from the Aahaas store (read-only)
 * plus ops-side import state. Powers the stat tiles on /dashboard/b2c.
 */
import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { bookingSourceWhere } from '@/lib/booking-source'
import {
  getB2cImportSettings,
  getLastRunDate,
  getRunLog,
  dateInTz,
} from '@/lib/b2c-import'
import { fetchOrderHeaders, isB2cConfigured } from '@/lib/b2c-db'

export const dynamic = 'force-dynamic'

const TZ = process.env.AUTO_BOOKING_TZ || 'Asia/Colombo'

export async function GET(_req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  if (session.user.role === 'CLIENT') return buildApiError('Forbidden', 403)

  const today = dateInTz(new Date(), TZ)

  // Source side — a failure here must not blank the whole page, so it is captured
  // and reported as a connection status rather than thrown.
  let sourceUpcoming: number | null = null
  let sourceError: string | null = null
  const configured = isB2cConfigured()
  if (configured) {
    try {
      const headers = await fetchOrderHeaders({ upcomingFrom: today, limit: 1000 })
      sourceUpcoming = headers.length
    } catch (err) {
      sourceError = err instanceof Error ? err.message : String(err)
    }
  }

  const b2cWhere = bookingSourceWhere('B2C')!

  const [settings, lastRunDate, runs, importedTotal, importedUpcoming, byCountryRaw, latestImported] =
    await Promise.all([
      getB2cImportSettings(),
      getLastRunDate(),
      getRunLog(),
      prisma.booking.count({ where: b2cWhere }),
      prisma.booking.count({
        where: { AND: [b2cWhere, { arrivalDate: { gte: new Date(`${today}T00:00:00Z`) } }] },
      }),
      prisma.booking.groupBy({
        by: ['operationCountry'],
        where: b2cWhere,
        _count: { _all: true },
      }),
      prisma.booking.findFirst({
        where: b2cWhere,
        orderBy: { createdAt: 'desc' },
        select: { bookingRef: true, createdAt: true },
      }),
    ])

  const byCountry = byCountryRaw
    .map((r) => ({ country: r.operationCountry ?? 'UNSCOPED', count: r._count._all }))
    .sort((a, b) => b.count - a.count)

  return buildApiSuccess({
    source: {
      configured,
      database: process.env.DB_DATABASE_B2C ?? null,
      readOnly: true,
      upcomingOrders: sourceUpcoming,
      error: sourceError,
    },
    ops: {
      importedTotal,
      importedUpcoming,
      byCountry,
      latestImported,
    },
    schedule: {
      enabled: settings.enabled,
      hour: settings.hour,
      minute: settings.minute,
      timezone: TZ,
      lastRunDate,
      ranToday: lastRunDate === today,
      today,
    },
    runs: runs.slice(0, 10),
  })
}
