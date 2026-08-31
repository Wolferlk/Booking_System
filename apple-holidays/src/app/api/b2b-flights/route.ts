/**
 * GET /api/b2b-flights — confirmed Aahaas B2B bookings (read-only).
 *
 * Query: search, from, to, component, paymentStatus, limit, offset.
 */
import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { listB2bBookings } from '@/lib/b2b-flights'
import { isB2bConfigured, b2bDatabaseName } from '@/lib/b2b-db'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const COMPONENTS = ['all', 'flights', 'hotels', 'insurances', 'lifestyles'] as const

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return buildApiError('Unauthorized', 401)
  if (session.user.role === 'CLIENT') return buildApiError('Forbidden', 403)

  if (!isB2bConfigured()) {
    return buildApiSuccess({
      configured: false,
      database: null,
      bookings: [], total: 0,
      stats: { confirmed: 0, grossByCurrency: [], componentTotals: { flights: 0, hotels: 0, insurances: 0, lifestyles: 0 }, last30Days: 0 },
      warnings: ['B2B database is not configured — set DB_DATABASE_B2B (or DB_DATABASE_B2C) in the environment.'],
      error: null,
    })
  }

  const sp = req.nextUrl.searchParams
  const componentParam = sp.get('component') ?? 'all'
  const component = (COMPONENTS as readonly string[]).includes(componentParam)
    ? (componentParam as (typeof COMPONENTS)[number])
    : 'all'

  try {
    const result = await listB2bBookings({
      search: sp.get('search') ?? undefined,
      from: sp.get('from') ?? undefined,
      to: sp.get('to') ?? undefined,
      component,
      paymentStatus: sp.get('paymentStatus') ?? undefined,
      limit: Number(sp.get('limit') ?? 50),
      offset: Number(sp.get('offset') ?? 0),
    })
    return buildApiSuccess({
      configured: true,
      database: b2bDatabaseName(),
      ...result,
      error: null,
    })
  } catch (err) {
    // A source-side failure should render as a banner, not a blank screen.
    return buildApiSuccess({
      configured: true,
      database: b2bDatabaseName(),
      bookings: [], total: 0,
      stats: { confirmed: 0, grossByCurrency: [], componentTotals: { flights: 0, hotels: 0, insurances: 0, lifestyles: 0 }, last30Days: 0 },
      warnings: [],
      error: err instanceof Error ? err.message : String(err),
    })
  }
}
