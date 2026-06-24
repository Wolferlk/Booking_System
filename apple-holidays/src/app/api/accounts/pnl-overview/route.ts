import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { fetchAllPnlRecords, fetchPnlRecordsFiltered } from '@/lib/accounts-db'
import type { UserRole } from '@prisma/client'

export const dynamic = 'force-dynamic'
/**
 * GET /api/accounts/pnl-overview
 *
 * Returns three lists:
 *   linked        – external PNL records matched to a booking in our system
 *   pnlOnly       – external PNL records with NO booking match yet
 *   bookingsOnly  – our bookings that have NO external PNL link
 *
 * Query params:
 *   limit   (default 300, max 500)
 *   search  – optional filter applied to is_number / tour_ref / invoice_number / vendor_name / agent_name
 */
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)

  const role = session.user.role as UserRole
  if (!['AC_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN'].includes(role)) {
    return buildApiError('Forbidden', 403)
  }

  const { searchParams } = req.nextUrl
  const limit  = Math.min(Number(searchParams.get('limit') ?? 300), 500)
  const search = searchParams.get('search')?.trim() ?? ''

  // ── 1. Fetch external PNL records via query() (not execute()) ────────────
  let extRows
  try {
    extRows = search
      ? await fetchPnlRecordsFiltered(search, limit)
      : await fetchAllPnlRecords(limit)
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Accounts DB unreachable'
    console.error('[pnl-overview] external DB error:', err)
    return buildApiError(`Accounts database error: ${msg}`, 502)
  }

  // ── 2. Load all ExternalPnlLinks with booking summary from our DB ─────────
  const allLinks = await prisma.externalPnlLink.findMany({
    include: {
      booking: {
        select: {
          id: true, bookingRef: true, isNumber: true, agent: true,
          status: true, arrivalDate: true, departureDate: true,
          paxAdults: true, paxChildren: true, quotedTotal: true, currency: true,
          operationCountry: true, dealName: true, agentBookingId: true,
          passengers: { where: { isLead: true }, select: { name: true }, take: 1 },
        },
      },
    },
  })

  // Map externalPnlId → link (one-to-one)
  const linkByExtId = new Map(allLinks.map(l => [l.externalPnlId, l]))

  // ── 3. Split into linked / pnlOnly ───────────────────────────────────────
  const linked:  object[] = []
  const pnlOnly: object[] = []

  for (const row of extRows) {
    const link = linkByExtId.get(row.id)
    if (link) {
      linked.push({
        pnlRecord: row,
        link: {
          id:            link.id,
          matchedBy:     link.matchedBy,
          matchedValue:  link.matchedValue,
          lastFetchedAt: link.lastFetchedAt,
          createdAt:     link.createdAt,
        },
        booking: link.booking,
      })
    } else {
      pnlOnly.push(row)
    }
  }

  // ── 4. Bookings with NO external PNL link ─────────────────────────────────
  const bookingsOnly = await prisma.booking.findMany({
    where: {
      externalPnlLink: null,
      NOT: { status: { in: ['DRAFT', 'CANCELLED'] } },
    },
    select: {
      id: true, bookingRef: true, isNumber: true, agent: true,
      status: true, arrivalDate: true, departureDate: true,
      paxAdults: true, paxChildren: true, quotedTotal: true, currency: true,
      operationCountry: true, dealName: true, agentBookingId: true,
      passengers: { where: { isLead: true }, select: { name: true }, take: 1 },
    },
    orderBy: { createdAt: 'desc' },
  })

  return buildApiSuccess({
    summary: {
      totalExtPnl:  extRows.length,
      linked:       linked.length,
      pnlOnly:      pnlOnly.length,
      bookingsOnly: bookingsOnly.length,
    },
    linked,
    pnlOnly,
    bookingsOnly,
  })
}
