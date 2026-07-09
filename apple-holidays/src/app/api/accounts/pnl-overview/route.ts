import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { fetchAllPnlRecords, fetchPnlRecordsFiltered, type PnlRecord } from '@/lib/accounts-db'
import { amendmentBase, parseAmendment, sortLatestFirst } from '@/lib/pnl-amendment'
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
  const rawLimit = Number(searchParams.get('limit') ?? 300)
  const limit = Math.min(Math.max(1, Number.isFinite(rawLimit) ? Math.floor(rawLimit) : 300), 500)
  const search = searchParams.get('search')?.trim() ?? ''

  // ── 1. Fetch external PNL records via query() (not execute()) ────────────
  let extRows: Awaited<ReturnType<typeof fetchAllPnlRecords>> = []
  let externalDbError: string | null = null
  try {
    extRows = search
      ? await fetchPnlRecordsFiltered(search, limit)
      : await fetchAllPnlRecords(limit)
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Accounts DB unreachable'
    console.error('[pnl-overview] external DB error:', err)
    externalDbError = `Accounts database error: ${msg}`
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

  // ── 3. Group amendments by base ref, then split into linked / pnlOnly ─────
  // All versions of a booking (VN40035, VN40035_R2/R2, …_R3/R3) collapse into
  // one row whose primary record is the LATEST version.
  const groupKey = (r: PnlRecord): string => {
    const b = amendmentBase(r.is_number)
    if (b) return `IS:${b}`
    const t = amendmentBase(r.tour_ref)
    if (t) return `REF:${t}`
    return `ID:${r.id}`
  }

  const versionSummary = (v: PnlRecord, linkedExtId: number | null) => {
    const amd = parseAmendment(v.is_number)
    return {
      id:             v.id,
      is_number:      v.is_number,
      tour_ref:       v.tour_ref,
      invoice_number: v.invoice_number,
      pnl_date:       v.pnl_date,
      actual_amount:  v.actual_amount,
      profit_loss:    v.profit_loss,
      currency:       v.currency,
      status:         v.status,
      isAmendment:    amd.isAmendment,
      amendmentLabel: amd.label,
      isLinked:       v.id === linkedExtId,
    }
  }

  // Preserve the incoming order (id DESC) of the first-seen member per group.
  const groups = new Map<string, PnlRecord[]>()
  const groupOrder: string[] = []
  for (const row of extRows) {
    const key = groupKey(row)
    if (!groups.has(key)) { groups.set(key, []); groupOrder.push(key) }
    groups.get(key)!.push(row)
  }

  const linked:  object[] = []
  const pnlOnly: object[] = []

  for (const key of groupOrder) {
    const members = sortLatestFirst(groups.get(key)!, r => r.is_number, r => r.id)
    const primary = members[0]                       // latest version
    const linkedMember = members.find(m => linkByExtId.get(m.id))
    const link = linkedMember ? linkByExtId.get(linkedMember.id)! : null
    const versions = members.map(m => versionSummary(m, linkedMember?.id ?? null))
    const isAmendment = members.length > 1 || parseAmendment(primary.is_number).isAmendment

    if (link) {
      linked.push({
        pnlRecord: primary,
        link: {
          id:            link.id,
          matchedBy:     link.matchedBy,
          matchedValue:  link.matchedValue,
          lastFetchedAt: link.lastFetchedAt,
          createdAt:     link.createdAt,
        },
        booking: link.booking,
        versions,
        isAmendment,
        // true when the booking is still linked to an older version than latest
        linkedIsStale: linkedMember!.id !== primary.id,
      })
    } else {
      pnlOnly.push({ ...primary, versions, isAmendment })
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
    externalDbError,
  })
}
