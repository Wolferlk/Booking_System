/**
 * Bookings created, day by day — the intake feed behind the Created by Day view.
 *
 * ## What it answers
 *
 * "How many bookings were filed on each of these days, and *which ones*?" The
 * daily report already publishes the first half of that; this route is the
 * second half, so a count on a screen can always be opened up into the IS
 * numbers that produced it. A number nobody can drill into is a number nobody
 * can check.
 *
 * ## Days are Colombo days
 *
 * Every boundary comes from `booking-date-window.ts`, which is the same module
 * the All Bookings list and the operational quick filters now use, and the same
 * business day the auto-reports anchor to. That is the whole point: this view
 * exists to be reconciled against the daily report, so it cannot be allowed to
 * count a different day. Bucketing is done in JavaScript on `opsDayOf` rather
 * than with `DATE(createdAt)` in SQL, because the column holds UTC instants and
 * a SQL `DATE()` would silently re-introduce the UTC day this replaced.
 *
 * ## Cancelled bookings are included
 *
 * This is an intake question, not an operational one. A booking filed on Monday
 * and cancelled on Thursday was still filed on Monday, and dropping it would
 * put this view out of step with the report it exists to be checked against.
 * They are returned flagged, so the client can show them struck through rather
 * than pretend they were never there.
 *
 * Read-only: one indexed `findMany` over a bounded window. It writes nothing.
 */
import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { canSeeAllCountries } from '@/lib/rbac'
import { countryScope, userCountryScope, detectCountryFromRef } from '@/lib/country-detection'
import { bookingSourceWhere, bookingSourceOf } from '@/lib/booking-source'
import { createdDayStart, opsDayOf, opsToday, OPS_TZ } from '@/lib/booking-date-window'
import { shiftDate } from '@/lib/reports/report-window'
import type { Prisma, UserRole } from '@prisma/client'

export const dynamic = 'force-dynamic'

/**
 * The widest window the view will draw. A quarter is more than the screen can
 * show as columns and far more than anyone reconciles at once; past it the
 * request is clamped rather than refused, so a hand-typed range never returns
 * an error page instead of data.
 */
const MAX_RANGE_DAYS = 92

/**
 * Rows returned in one pass. Comfortably above a quarter's intake, so in
 * practice every booking in the window is listed; if it were ever exceeded the
 * response says so rather than quietly showing a subset as if it were the whole.
 */
const MAX_ROWS = 5_000

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** Every `yyyy-mm-dd` from `from` to `to`, inclusive — including the empty ones. */
function daysBetween(from: string, to: string): string[] {
  const out: string[] = []
  for (let d = from; d <= to; d = shiftDate(d, 1)) {
    out.push(d)
    if (out.length > MAX_RANGE_DAYS) break
  }
  return out
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)

  const { searchParams } = req.nextUrl
  const role = session.user.role as UserRole
  const userCountry = (session.user as any).country as string | undefined
  const userCountries = (session.user as any).countries as string[] | undefined

  const today = opsToday()

  // A preset is resolved here, not in the browser: "last 7 days" has to mean
  // seven *Colombo* days, and a laptop in another timezone would name a
  // different week than the one the columns are drawn from.
  const preset = searchParams.get('preset')
  const rawTo   = searchParams.get('to')
  const rawFrom = searchParams.get('from')

  let to = rawTo && DATE_RE.test(rawTo) ? rawTo : today
  let from: string

  if (preset === 'month') {
    to = today
    from = `${today.slice(0, 7)}-01`
  } else if (preset && /^\d{1,3}$/.test(preset)) {
    to = today
    from = shiftDate(today, -(Math.min(MAX_RANGE_DAYS, Math.max(1, Number(preset))) - 1))
  } else {
    from = rawFrom && DATE_RE.test(rawFrom) ? rawFrom : shiftDate(to, -13)
  }

  if (from > to) [from, to] = [to, from]
  // Clamp from the recent end: an over-wide range is nearly always a typo in
  // the start date, and the days nearest `to` are the ones being looked at.
  const days = daysBetween(from, to)
  if (days.length > MAX_RANGE_DAYS) from = shiftDate(to, -(MAX_RANGE_DAYS - 1))

  const andClauses: Prisma.BookingWhereInput[] = [{
    createdAt: { gte: createdDayStart(from), lt: createdDayStart(shiftDate(to, 1)) },
  }]

  // ── Scope: exactly the rows this caller may see anywhere else in the system ──
  const countryOverride = searchParams.get('country')
  if (role === 'CLIENT') {
    andClauses.push({ clientUserId: session.user.id })
  } else if (!canSeeAllCountries(role, userCountry as any)) {
    const scope = userCountryScope(userCountry, userCountries)
    if (scope) andClauses.push({ operationCountry: { in: scope as any } })
  } else if (countryOverride && countryOverride !== 'ALL') {
    if (countryOverride === 'SINGAPORE_MALAYSIA') {
      andClauses.push({ operationCountry: { in: countryScope(countryOverride)! as any } })
    } else {
      andClauses.push({ operationCountry: countryOverride as any })
    }
  }

  const sourceClause = bookingSourceWhere(searchParams.get('source'))
  if (sourceClause) andClauses.push(sourceClause as Prisma.BookingWhereInput)

  // Free text over the identifiers and the agent — the same fields the list's
  // unified search covers, minus the joins, because this view is about volume
  // and a search here is for narrowing a day, not for finding one booking.
  const search = (searchParams.get('search') ?? '').trim()
  if (search) {
    andClauses.push({
      OR: [
        { bookingRef:     { contains: search } },
        { isNumber:       { contains: search } },
        { agentBookingId: { contains: search } },
        { agent:          { contains: search } },
      ],
    })
  }

  const rows = await prisma.booking.findMany({
    where: { AND: andClauses },
    select: {
      id: true, bookingRef: true, isNumber: true, agent: true, status: true,
      operationCountry: true, createdAt: true, arrivalDate: true,
      paxAdults: true, paxChildren: true,
    },
    orderBy: { createdAt: 'desc' },
    take: MAX_ROWS + 1,
  })

  const truncated = rows.length > MAX_ROWS
  const kept = truncated ? rows.slice(0, MAX_ROWS) : rows

  const bookings = kept.map(b => ({
    id: b.id,
    ref: b.bookingRef,
    isNumber: b.isNumber,
    agent: b.agent,
    status: b.status as string,
    cancelled: b.status === 'CANCELLED' || b.status === 'PENDING_CANCELLATION',
    country: b.operationCountry ?? detectCountryFromRef(b.bookingRef) ?? 'UNKNOWN',
    source: bookingSourceOf(b.agent),
    createdAt: b.createdAt.toISOString(),
    day: opsDayOf(b.createdAt),
    arrivalDate: b.arrivalDate ? b.arrivalDate.toISOString().slice(0, 10) : null,
    pax: (b.paxAdults ?? 0) + (b.paxChildren ?? 0),
  }))

  // Zero-filled, so an empty day is drawn as an empty column rather than
  // vanishing and making the week look shorter than it was.
  const counts = new Map<string, { count: number; pax: number; cancelled: number }>()
  for (const day of daysBetween(from, to)) counts.set(day, { count: 0, pax: 0, cancelled: 0 })
  for (const b of bookings) {
    const cell = counts.get(b.day)
    if (!cell) continue // a row on the boundary of a clamped range
    cell.count += 1
    cell.pax += b.pax
    if (b.cancelled) cell.cancelled += 1
  }

  return buildApiSuccess({
    timezone: OPS_TZ,
    from,
    to,
    today,
    yesterday: shiftDate(today, -1),
    truncated,
    days: Array.from(counts.entries()).map(([date, cell]) => ({ date, ...cell })),
    bookings,
  })
}
