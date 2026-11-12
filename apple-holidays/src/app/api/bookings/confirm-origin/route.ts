import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { canSeeAllCountries } from '@/lib/rbac'
import { userCountryScope } from '@/lib/country-detection'
import { isB2cBooking } from '@/lib/booking-source'
import { withAsDeadline } from '@/lib/applesystem'
import {
  classifyConfirmOrigin,
  getQuoteHistory,
  getQuoteHistoryByRef,
  quoteNoFromCntl,
  type ConfirmOrigin,
  type QuoteHistory,
} from '@/lib/as-confirm-origin'
import type { Prisma, UserRole } from '@prisma/client'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

/** Only files OPS created recently get a badge; older ones are no longer "today's news". */
const WINDOW_DAYS = 8
const MAX_REFS = 40
const CONCURRENCY = 4

/**
 * GET /api/bookings/confirm-origin?refs=VN43255,VN40154
 *
 * For each AppleSystem-imported booking OPS created in the last week: was it a
 * brand-new confirmation, or an older quote confirmed again? See
 * `src/lib/as-confirm-origin.ts`. Read-only towards AppleSystem and towards the
 * bookings; the page calls it after the list has rendered so the list is never
 * slowed down by the upstream.
 */
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  const role = session.user.role as UserRole
  if (role === 'CLIENT') return buildApiError('Forbidden', 403)

  const refs = Array.from(new Set(
    (req.nextUrl.searchParams.get('refs') ?? '')
      .split(',')
      .map(s => s.trim().toUpperCase())
      .filter(s => /^[A-Z]{2}\d+$/.test(s)),
  )).slice(0, MAX_REFS)
  if (!refs.length) return buildApiSuccess({ origins: {} })

  const userCountry = (session.user as any).country as string | undefined
  const userCountries = (session.user as any).countries as string[] | undefined
  const and: Prisma.BookingWhereInput[] = [
    { bookingRef: { in: refs } },
    { createdAt: { gte: new Date(Date.now() - WINDOW_DAYS * 86_400_000) } },
  ]
  if (!canSeeAllCountries(role, userCountry as any)) {
    const scope = userCountryScope(userCountry, userCountries)
    if (scope) and.push({ operationCountry: { in: scope as any } })
  }

  const bookings = await prisma.booking.findMany({
    where: { AND: and },
    select: { bookingRef: true, createdAt: true, cntlNumber: true, agent: true },
  })

  const origins: Record<string, ConfirmOrigin> = {}
  const queue = bookings.filter(b => !isB2cBooking(b.agent))

  // One deadline for the whole batch: a stalled AppleSystem must not hold the
  // request past the platform's cut-off. Whatever did not finish is UNKNOWN
  // and the page simply shows no badge for it.
  await withAsDeadline({ budgetMs: 24_000, timeoutMs: 12_000 }, async () => {
    let i = 0
    const worker = async () => {
      while (i < queue.length) {
        const b = queue[i++]
        let history: QuoteHistory | null = null
        let reason: string | undefined
        try {
          const quoteNo = quoteNoFromCntl(b.cntlNumber)
          history = quoteNo ? await getQuoteHistory(quoteNo) : await getQuoteHistoryByRef(b.bookingRef)
        } catch (err) {
          reason = `Apple system did not answer: ${err instanceof Error ? err.message.slice(0, 120) : 'error'}`
        }
        origins[b.bookingRef] = classifyConfirmOrigin(b.bookingRef, b.createdAt, history, reason)
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker))
  }).catch(() => { /* partial results are still useful */ })

  return buildApiSuccess({ origins })
}
