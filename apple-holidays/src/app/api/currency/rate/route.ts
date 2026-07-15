import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import {
  getConversionRate, isExchangeConfigured,
  SUPPORTED_TARGET_CURRENCIES, CURRENCY_LABEL,
} from '@/lib/currency'

export const dynamic = 'force-dynamic'

/**
 * GET /api/currency/rate?from=USD&to=LKR
 * Returns the live conversion rate (from → to) for display-only currency
 * translation on the Driver Advance Sheet. Any signed-in staff user may read it.
 */
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)

  if (!isExchangeConfigured()) {
    return buildApiError('Currency conversion is not configured (missing EXCHANGERATE_API_KEY)', 503)
  }

  const { searchParams } = new URL(req.url)
  const from = searchParams.get('from') ?? 'USD'
  const to   = searchParams.get('to')   ?? 'USD'

  try {
    const result = await getConversionRate(from, to)
    return buildApiSuccess({
      ...result,
      supported: SUPPORTED_TARGET_CURRENCIES,
      labels: CURRENCY_LABEL,
    })
  } catch (err) {
    return buildApiError(err instanceof Error ? err.message : 'Rate lookup failed', 502)
  }
}
