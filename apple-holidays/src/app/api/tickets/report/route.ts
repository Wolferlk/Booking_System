/**
 * Reports for Tickets & Vouchers.
 *
 * Reads the *same* filters the list screen sends, so whatever is on screen is
 * what comes out of the report — there is no second definition of "purchased in
 * September" to drift away from the one in the list.
 *
 *   ?format=csv      → a row per ticket, for Excel
 *   ?format=summary  → grouped totals for the report panel (JSON)
 *
 * Read-only. Nothing here writes to the database.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError } from '@/lib/utils'
import { canSeeAllCountries } from '@/lib/rbac'
import {
  parseTicketFilters, buildTicketWhere, applyStatusFilter, buildOrderBy,
} from '@/lib/ticket-filters'
import type { UserRole, OperationCountry } from '@prisma/client'

export const dynamic = 'force-dynamic'

/**
 * A CSV big enough to matter but small enough that one person pressing Export
 * cannot read the whole ticket table into memory. Past this the report says so
 * rather than quietly truncating.
 */
const MAX_ROWS = 20000

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)

  const role = session.user.role as UserRole
  const userCountry = session.user.country as OperationCountry | undefined
  const { searchParams } = req.nextUrl

  const effectiveCountry = canSeeAllCountries(role, userCountry ?? 'ALL')
    ? ((searchParams.get('country') as OperationCountry | null) || null)
    : (userCountry || null)

  const filters = parseTicketFilters(searchParams)
  const where = applyStatusFilter(buildTicketWhere(filters, effectiveCountry), filters.status)
  const format = (searchParams.get('format') ?? 'summary').toLowerCase()

  const total = await prisma.ticket.count({ where })

  if (format === 'csv' && total > MAX_ROWS) {
    return buildApiError(
      `That filter matches ${total.toLocaleString()} tickets — the export handles ${MAX_ROWS.toLocaleString()} at a time. Narrow the date range and run it again.`,
      400,
    )
  }

  const rows = await prisma.ticket.findMany({
    where,
    select: {
      id: true, type: true, qty: true, supplier: true, currency: true,
      costPerUnit: true, totalCost: true, status: true, activated: true,
      reference: true, purchasedAt: true, createdAt: true, category: true,
      fileUrl: true, fileName: true,
      portalName: true, portalRef: true,
      approvalStatus: true, approvalPaidAt: true, approvalPaidRef: true,
      booking: {
        select: {
          bookingRef: true, agent: true, arrivalDate: true, departureDate: true,
          createdAt: true, operationCountry: true, status: true,
        },
      },
      pnlLine: { select: { category: true, paymentStatus: true, activity: true } },
      agendaItem: { select: { date: true, location: true } },
    },
    orderBy: buildOrderBy(filters.sort),
    take: format === 'csv' ? MAX_ROWS : Math.min(total, MAX_ROWS),
  })

  if (format === 'csv') {
    const stamp = new Date().toISOString().slice(0, 10)
    return new NextResponse(renderCsv(rows), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="Tickets-Report-${rows.length}-rows-${stamp}.csv"`,
        'Cache-Control': 'no-store',
      },
    })
  }

  return NextResponse.json({ success: true, data: summarise(rows, total) })
}

// ─── shaping ─────────────────────────────────────────────────────────────────

/** The shape `findMany` above selects — declared so the helpers can be typed. */
interface Row {
  type: string; qty: number; supplier: string | null; currency: string
  costPerUnit: unknown; totalCost: unknown; status: string; activated: boolean
  reference: string | null; purchasedAt: Date | null; createdAt: Date
  category: string | null; fileUrl: string | null; fileName: string | null
  portalName: string | null; portalRef: string | null
  approvalStatus: string | null; approvalPaidAt: Date | null; approvalPaidRef: string | null
  booking: {
    bookingRef: string; agent: string | null; arrivalDate: Date; departureDate: Date
    createdAt: Date; operationCountry: string | null; status: string
  } | null
  pnlLine: { category: string; paymentStatus: string; activity: string } | null
  agendaItem: { date: Date; location: string | null } | null
}

const num = (v: unknown): number => (v == null ? 0 : Number(v))
const day = (d: Date | null | undefined): string => (d ? d.toISOString().slice(0, 10) : '')

/** The category the list draws for a row — ticket column first, then P&L. */
function categoryOf(r: Row): string {
  return r.category || r.pnlLine?.category || 'OTHER'
}

/** The words the list puts on the badge, so a report reads like the screen. */
function stateOf(r: Row): string {
  if (!r.activated) return 'Pending Activation'
  if (r.status === 'PURCHASED' || r.status === 'PAID') {
    return r.fileUrl ? 'Purchased · Issued' : 'Purchased · Not issued'
  }
  return 'Active'
}

function csvCell(value: unknown): string {
  const s = value == null ? '' : String(value)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

const HEADERS = [
  'Booking Ref', 'Agent', 'Country', 'Booking Status', 'Booking Created',
  'Arrival', 'Departure', 'Service Date', 'Location',
  'Ticket Type', 'Category', 'State', 'Ticket Status', 'Activated', 'Issued (file)',
  'Qty', 'Currency', 'Cost / Unit', 'Total Cost',
  'Supplier', 'Portal', 'Portal Ref', 'Confirmation Ref',
  'Approval', 'Paid At', 'Paid Ref', 'P&L Payment', 'Purchased At', 'Ticket Created',
]

function renderCsv(rows: Row[]): string {
  const lines = [HEADERS.join(',')]
  for (const r of rows) {
    lines.push([
      r.booking?.bookingRef, r.booking?.agent, r.booking?.operationCountry, r.booking?.status,
      day(r.booking?.createdAt), day(r.booking?.arrivalDate), day(r.booking?.departureDate),
      day(r.agendaItem?.date), r.agendaItem?.location,
      r.type, categoryOf(r), stateOf(r), r.status, r.activated ? 'Yes' : 'No', r.fileUrl ? 'Yes' : 'No',
      r.qty, r.currency, num(r.costPerUnit).toFixed(2), num(r.totalCost).toFixed(2),
      r.supplier, r.portalName, r.portalRef, r.reference,
      r.approvalStatus ?? 'not submitted', day(r.approvalPaidAt), r.approvalPaidRef,
      r.pnlLine?.paymentStatus, day(r.purchasedAt), day(r.createdAt),
    ].map(csvCell).join(','))
  }
  // Excel reads UTF-8 correctly only when the file announces itself with a BOM.
  return '\uFEFF' + lines.join('\r\n')
}

// ─── summary ─────────────────────────────────────────────────────────────────

interface Bucket { key: string; count: number; qty: number; cost: number; purchased: number; issued: number }

function bucketBy(rows: Row[], keyOf: (r: Row) => string): Bucket[] {
  const map = new Map<string, Bucket>()
  for (const r of rows) {
    const key = keyOf(r) || '—'
    let b = map.get(key)
    if (!b) { b = { key, count: 0, qty: 0, cost: 0, purchased: 0, issued: 0 }; map.set(key, b) }
    b.count++
    b.qty += r.qty
    b.cost += num(r.totalCost)
    if (r.status === 'PURCHASED' || r.status === 'PAID') b.purchased++
    if (r.fileUrl) b.issued++
  }
  return Array.from(map.values()).sort((a, b) => b.cost - a.cost || b.count - a.count)
}

function summarise(rows: Row[], total: number) {
  const purchased = rows.filter(r => r.status === 'PURCHASED' || r.status === 'PAID')
  const issued = rows.filter(r => r.fileUrl)

  return {
    generatedAt: new Date().toISOString(),
    matched: total,
    // A summary over more than MAX_ROWS is measured on the first slice; the UI
    // says so rather than presenting a partial total as the whole picture.
    analysed: rows.length,
    truncated: total > rows.length,
    totals: {
      tickets: rows.length,
      qty: rows.reduce((s, r) => s + r.qty, 0),
      cost: rows.reduce((s, r) => s + num(r.totalCost), 0),
      purchased: purchased.length,
      purchasedCost: purchased.reduce((s, r) => s + num(r.totalCost), 0),
      pendingActivation: rows.filter(r => !r.activated).length,
      issued: issued.length,
      awaitingIssue: purchased.filter(r => !r.fileUrl).length,
      awaitingApproval: rows.filter(r => r.approvalStatus === 'pending').length,
      bookings: new Set(rows.map(r => r.booking?.bookingRef).filter(Boolean)).size,
    },
    byCategory: bucketBy(rows, categoryOf),
    byState:    bucketBy(rows, stateOf),
    bySupplier: bucketBy(rows, r => r.supplier ?? '—').slice(0, 15),
    byPortal:   bucketBy(rows, r => r.portalName ?? 'Direct / none').slice(0, 15),
    byAgent:    bucketBy(rows, r => r.booking?.agent ?? '—').slice(0, 15),
    byCurrency: bucketBy(rows, r => r.currency),
    // Travel month, not purchase month — this is the one operations plan against.
    byArrivalMonth: bucketBy(rows, r =>
      r.booking?.arrivalDate ? r.booking.arrivalDate.toISOString().slice(0, 7) : '—',
    ).sort((a, b) => a.key.localeCompare(b.key)),
  }
}
