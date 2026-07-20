import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { listBookings, resolveCountryName, parseAsDate, type ASBookingListItem } from '@/lib/applesystem'

export const dynamic = 'force-dynamic'

/**
 * GET /api/as-bookings-v2  — list quotations for the "AS Bookings V2" view.
 *
 * The upstream AppleSystem list endpoint filters by ARRIVAL date only and has no
 * server-side pagination, so this proxy fetches a wide arrival window (covering
 * anything that could have been *created* in the requested window), then filters,
 * sorts, counts and paginates by CREATED date here — giving exact counts.
 *
 * Query params:
 *   created_from  YYYY-MM-DD   created-date window start (default: start of this week, Mon)
 *   created_to    YYYY-MM-DD   created-date window end   (default: end of this week, Sun)
 *   status        "1" | "2" | "all"   (default "2" = confirmed)
 *   search        free text — IS / quotation / CNTL / reference numbers
 *   page          1-based page (default 1)
 *   page_size     rows per page (default 20, max 100)
 */
export async function GET(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return buildApiError('Unauthorized', 401)
  if (session.user.role === 'CLIENT') return buildApiError('Forbidden', 403)

  const url = new URL(req.url)
  const fmt = (d: Date) => {
    const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0')
    return `${y}-${m}-${day}`
  }

  // Default created-date window = this week (Mon → Sun)
  const now = new Date()
  const diffToMon = (now.getDay() + 6) % 7
  const weekStart = new Date(now); weekStart.setDate(now.getDate() - diffToMon)
  const weekEnd = new Date(weekStart); weekEnd.setDate(weekStart.getDate() + 6)

  const createdFrom = url.searchParams.get('created_from') || fmt(weekStart)
  const createdTo = url.searchParams.get('created_to') || fmt(weekEnd)
  const statusParam = (url.searchParams.get('status') || '2').toLowerCase()
  const search = (url.searchParams.get('search') || '').trim().toLowerCase()
  const page = Math.max(1, Number(url.searchParams.get('page') || '1') || 1)
  const pageSize = Math.min(100, Math.max(1, Number(url.searchParams.get('page_size') || '20') || 20))

  // Inclusive created-date bounds → millisecond range.
  const fromMs = new Date(`${createdFrom}T00:00:00`).getTime()
  const toMs = new Date(`${createdTo}T23:59:59`).getTime()
  if (isNaN(fromMs) || isNaN(toMs)) return buildApiError('Invalid created-date range', 400)

  // Arrival window wide enough to include anything created in the requested window:
  // 3 years back → 4 years ahead. Bookings are created before travel, so this
  // comfortably covers near-future arrivals of recently-created quotations.
  const arriveFrom = fmt(new Date(now.getFullYear() - 3, 0, 1))
  const arriveTo = fmt(new Date(now.getFullYear() + 4, 11, 31))

  try {
    // Always fetch ALL statuses so the status-tab counts are correct regardless
    // of the current selection.
    const { items } = await listBookings({
      fromArrivalDate: arriveFrom,
      toArrivalDate: arriveTo,
      statuses: [],
    })

    // Enrich + filter to the created-date window.
    const inWindow = items
      .map((it) => {
        const created = parseAsDate(it.created_at)
        return { it, createdMs: created ? created.getTime() : NaN, createdIso: created?.toISOString() ?? null }
      })
      .filter((r) => !isNaN(r.createdMs) && r.createdMs >= fromMs && r.createdMs <= toMs)

    const confirmedCount = inWindow.filter((r) => r.it.status === '2').length
    const allCount = inWindow.length
    const unconfirmedCount = allCount - confirmedCount

    // Apply status + search, then sort newest-created first.
    let rows = inWindow
    if (statusParam !== 'all') rows = rows.filter((r) => r.it.status === statusParam)
    if (search) rows = rows.filter((r) => matchesSearch(r.it, search))
    rows.sort((a, b) => b.createdMs - a.createdMs)

    const filteredTotal = rows.length
    const start = (page - 1) * pageSize
    const pageRows = rows.slice(start, start + pageSize).map((r) => ({
      ...r.it,
      country_name: resolveCountryName(r.it),
      created_iso: r.createdIso,
    }))

    return buildApiSuccess({
      bookings: pageRows,
      total: filteredTotal,
      counts: { all: allCount, confirmed: confirmedCount, unconfirmed: unconfirmedCount },
      page,
      pageSize,
      pageCount: Math.max(1, Math.ceil(filteredTotal / pageSize)),
      window: { createdFrom, createdTo },
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
