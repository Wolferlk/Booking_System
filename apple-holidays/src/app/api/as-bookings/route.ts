import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { listBookings, resolveCountryName, type ASBookingListItem } from '@/lib/applesystem'

export const dynamic = 'force-dynamic'

/**
 * GET /api/as-bookings
 * Proxies the AppleSystem quotation list so the bearer token never reaches the browser.
 *
 * Query params:
 *   from    YYYY-MM-DD  (arrival date range start, required — defaults applied if absent)
 *   to      YYYY-MM-DD  (arrival date range end)
 *   status  "1" | "2" | "all"   (default "2" = confirmed)
 *   search  free text — matched against quotation/reference/CNTL numbers
 */
export async function GET(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return buildApiError('Unauthorized', 401)
  if (session.user.role === 'CLIENT') return buildApiError('Forbidden', 403)

  const url = new URL(req.url)

  // Default arrival window: 1 year back → 1 year ahead
  const today = new Date()
  const defFrom = new Date(today.getFullYear() - 1, 0, 1)
  const defTo = new Date(today.getFullYear() + 1, 11, 31)
  const fmt = (d: Date) => d.toISOString().slice(0, 10)

  const from = url.searchParams.get('from') || fmt(defFrom)
  const to = url.searchParams.get('to') || fmt(defTo)
  const statusParam = (url.searchParams.get('status') || '2').toLowerCase()
  const search = (url.searchParams.get('search') || '').trim().toLowerCase()

  const statuses = statusParam === 'all' ? [] : [statusParam]

  try {
    const { items, total } = await listBookings({
      fromArrivalDate: from,
      toArrivalDate: to,
      statuses,
    })

    // Enrich + optional client-side search across all reference numbers.
    let enriched = items.map((it) => ({
      ...it,
      country_name: resolveCountryName(it),
    }))

    if (search) {
      enriched = enriched.filter((it) => matchesSearch(it, search))
    }

    return buildApiSuccess({
      bookings: enriched,
      total: search ? enriched.length : total,
      window: { from, to },
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to load AppleSystem bookings'
    return buildApiError(msg, 502)
  }
}

function matchesSearch(it: ASBookingListItem, q: string): boolean {
  const haystack: string[] = [it.quotation_no, it.reference_id, ...(it.reference_id_full ?? [])]
  return haystack.filter(Boolean).some((v) => String(v).toLowerCase().includes(q))
}
