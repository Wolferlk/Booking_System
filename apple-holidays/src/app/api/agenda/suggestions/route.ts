import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { mergeSuggestions, seedSuggestions, isVietnamCountry } from '@/lib/agenda-suggestions'

export const dynamic = 'force-dynamic'

/** Values longer than this are one-off prose, not a reusable list entry. */
const MAX_LEN = 120
/** Rows kept per field — enough to cover the desk's repertoire, small to send. */
const PER_FIELD = 300

interface Row { value: string }

/**
 * Movement-field suggestions for the agenda editor.
 *
 * The curated seed list (src/lib/agenda-suggestions.ts) is merged with what the
 * desk has actually typed on past agendas for the same operation country, most
 * used first, so the dropdown keeps up with new products without a code change.
 * Nothing here restricts what may be saved — the fields stay free text.
 */
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)

  const country = req.nextUrl.searchParams.get('country') || ''

  const history = async (column: 'location' | 'fromPoint' | 'toPoint'): Promise<string[]> => {
    // Raw + GROUP BY: `distinct` on a TEXT column with a frequency order is not
    // expressible through the Prisma query API.
    const rows = await prisma.$queryRawUnsafe<Row[]>(
      `SELECT TRIM(i.\`${column}\`) AS value
         FROM agenda_items i
         JOIN tour_agendas a ON a.id = i.agendaId
         JOIN bookings b     ON b.id = a.bookingId
        WHERE b.operationCountry = ?
          AND i.\`${column}\` IS NOT NULL
          AND TRIM(i.\`${column}\`) <> ''
          AND CHAR_LENGTH(TRIM(i.\`${column}\`)) <= ?
        GROUP BY value
        ORDER BY COUNT(*) DESC
        LIMIT ?`,
      country, MAX_LEN, PER_FIELD,
    )
    return rows.map(r => r.value).filter(Boolean)
  }

  // Only countries we hold a seed list for get history too — elsewhere the
  // fields stay plain text boxes, exactly as before.
  const wanted = isVietnamCountry(country)
  let past = { location: [] as string[], fromPoint: [] as string[], toPoint: [] as string[] }
  if (wanted) {
    try {
      const [location, fromPoint, toPoint] = await Promise.all([
        history('location'), history('fromPoint'), history('toPoint'),
      ])
      past = { location, fromPoint, toPoint }
    } catch {
      // A suggestion list is a convenience — fall back to the seed list rather
      // than failing the editor.
    }
  }

  return buildApiSuccess({
    location:  mergeSuggestions(past.location,  seedSuggestions('location',  country)),
    fromPoint: mergeSuggestions(past.fromPoint, seedSuggestions('fromPoint', country)),
    toPoint:   mergeSuggestions(past.toPoint,   seedSuggestions('toPoint',   country)),
  })
}
