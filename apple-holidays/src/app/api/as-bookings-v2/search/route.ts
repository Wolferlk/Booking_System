import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { searchBookings, resolveCountryName, parseAsDate, type ASBookingListItem } from '@/lib/applesystem'
import { normalizeIsNumber } from '@/lib/as-booking-map'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * GET /api/as-bookings-v2/search?is_number=..&quotation_no=..&status=2
 *
 * The fast, scoped lookup behind the "New Booking from AppleSystem" page. It
 * passes the IS / quotation filters straight to AppleSystem (so no giant list is
 * fetched), then annotates each row with a resolved country name, a created
 * timestamp, its normalised IS ref, and whether it has already been imported
 * into our system.
 */
export async function GET(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return buildApiError('Unauthorized', 401)
  if (session.user.role === 'CLIENT') return buildApiError('Forbidden', 403)

  const url = new URL(req.url)
  const isNumberParam = (url.searchParams.get('is_number') || '').trim()
  const quotationParam = (url.searchParams.get('quotation_no') || '').trim()
  const statusParam = (url.searchParams.get('status') || '2').toLowerCase()

  if (!isNumberParam && !quotationParam) {
    return buildApiError('Enter an IS number or a quotation number to search.', 400)
  }

  const statuses = statusParam === 'all' ? [] : [statusParam]

  try {
    const { items } = await searchBookings({
      isNumber: isNumberParam || undefined,
      quotationNo: quotationParam || undefined,
      statuses,
    })

    // Which of these already exist locally? One indexed query over the refs.
    // The row's own `is_number` ("MY 40060") is the reliable source; only some
    // rows repeat it inside `reference_id_full`, so that is just a fallback.
    const refOf = (it: ASBookingListItem): string | null => {
      const own = (it.is_number ?? '').trim()
      const raw = own && own.toUpperCase() !== 'NA'
        ? own
        : it.reference_id_full?.find((r) => /^(IS|VN|SG|MY)/i.test(r))
      return raw ? normalizeIsNumber(raw) : null
    }
    const refs = Array.from(new Set(items.map(refOf).filter((r): r is string => !!r)))
    const existing = refs.length
      ? await prisma.booking.findMany({
          where: { bookingRef: { in: refs } },
          select: { bookingRef: true },
        })
      : []
    const existingSet = new Set(existing.map((b) => b.bookingRef))

    const bookings = items.map((it) => {
      const ref = refOf(it)
      const created = parseAsDate(it.created_at)
      return {
        ...it,
        country_name: resolveCountryName(it),
        created_iso: created?.toISOString() ?? null,
        is_ref: ref,
        imported: ref ? existingSet.has(ref) : false,
      }
    })

    return buildApiSuccess({ bookings, total: bookings.length })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to search AppleSystem'
    return buildApiError(msg, 502)
  }
}
