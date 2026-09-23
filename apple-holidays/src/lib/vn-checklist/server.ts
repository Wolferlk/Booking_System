/**
 * Vietnam booking checklist — database side. See ./shared.ts for what the sheet
 * is and how its four figures are defined.
 *
 * Writes only to vn_booking_checklists / vn_booking_checklist_items. The booking,
 * its P&L and its agenda are read, never written.
 */
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { computePNLTotals } from '@/lib/utils'
import { isMissingTable } from '@/lib/vn-includes/includes'
import {
  DEFAULT_VND_RATE, computeTotals, parseNum,
  type ChecklistBookingInfo, type ChecklistHeader, type ChecklistItem, type ChecklistLive,
  type ChecklistPayload, type ChecklistStatus, type ChecklistTotals, type PaidStatus,
} from './shared'

export { isMissingTable }

const dec = (v: Prisma.Decimal | number | null | undefined) => (v === null || v === undefined ? null : Number(v))
const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null)

const STATUSES: ChecklistStatus[] = ['DRAFT', 'CHECKED', 'FINAL']
const PAID: PaidStatus[] = ['UNPAID', 'PARTIAL', 'PAID']

/** Roles that may edit a checklist already marked FINAL. */
const FINAL_EDITORS = ['AC_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN']

type BookingWithPnl = Prisma.BookingGetPayload<{ include: { pnl: { include: { lineItems: true } } } }>

/**
 * The live figures the sheet falls back to.
 *
 * Revenue: the booking's quoted total — its selling price — when it is in USD,
 * converted at the rate when the booking quotes in VND (24 VN bookings do, and
 * reading one straight across turns 2,000,000 dong into two million dollars).
 * The OPS P&L's revenue is the fallback when there is no quote.
 */
function liveFor(b: BookingWithPnl): ChecklistLive {
  const rate = DEFAULT_VND_RATE
  const pnl = b.pnl && b.pnl.lineItems.length > 0 ? computePNLTotals(b.pnl) : null

  let quoted: number | null = null
  if (b.quotedTotal !== null && Number(b.quotedTotal) > 0) {
    const cur = String(b.currency || 'USD').trim().toUpperCase()
    quoted = cur === 'USD' ? Number(b.quotedTotal)
      : cur === 'VND' ? Math.round((Number(b.quotedTotal) / rate) * 100) / 100
      : null
  }
  const pnlRevenue = pnl && pnl.totalRevenue > 0 ? pnl.totalRevenue : null

  return {
    revenueUsd: quoted ?? pnlRevenue,
    revenueSource: quoted !== null ? 'QUOTED' : pnlRevenue !== null ? 'PNL' : null,
    exchangeRate: rate,
    pnlCostUsd: pnl && pnl.totalCost > 0 ? Math.round(pnl.totalCost * 100) / 100 : null,
    pnlRevenueUsd: pnlRevenue,
    pax: { adults: b.paxAdults, children: b.paxChildren },
  }
}

function bookingInfo(b: BookingWithPnl): ChecklistBookingInfo {
  return {
    bookingRef: b.bookingRef,
    agent: b.agent ?? null,
    cntlNumber: b.cntlNumber ?? null,
    isNumber: (b as { isNumber?: string | null }).isNumber ?? null,
    arrivalDate: day(b.arrivalDate),
    departureDate: day(b.departureDate),
    status: b.status,
    cancelled: b.cancelledAt !== null,
    currency: b.currency,
  }
}

type HeaderRow = Prisma.VnBookingChecklistGetPayload<object>
type ItemRow = Prisma.VnBookingChecklistItemGetPayload<object>

function toHeader(bookingRef: string, h: HeaderRow | null): ChecklistHeader {
  return {
    bookingRef,
    status: (h?.status as ChecklistStatus) ?? 'DRAFT',
    note: h?.note ?? null,
    revenueUsdOverride: dec(h?.revenueUsd),
    exchangeRateOverride: dec(h?.exchangeRate),
    checkedByName: h?.checkedByName ?? null,
    checkedAt: h?.checkedAt?.toISOString() ?? null,
    updatedByName: h?.updatedByName ?? null,
    updatedAt: h?.updatedAt?.toISOString() ?? null,
  }
}

function toItem(r: ItemRow): ChecklistItem {
  return {
    id: r.id,
    position: r.position,
    serviceDate: day(r.serviceDate),
    description: r.description,
    vendor: r.vendor,
    code: r.code,
    unitPrice: Number(r.unitPrice),
    unitCurrency: r.unitCurrency === 'USD' ? 'USD' : 'VND',
    quan1: Number(r.quan1),
    quan2: Number(r.quan2),
    totalOverrideVnd: dec(r.totalOverrideVnd),
    paidStatus: (PAID as string[]).includes(r.paidStatus) ? (r.paidStatus as PaidStatus) : 'UNPAID',
    paidVnd: dec(r.paidVnd),
    paidAt: r.paidAt?.toISOString() ?? null,
    paidByName: r.paidByName,
    source: (['MANUAL', 'CATALOG', 'INCLUDE'].includes(r.source) ? r.source : 'MANUAL') as ChecklistItem['source'],
    productKey: r.productKey,
    note: r.note,
    updatedByName: r.updatedByName,
  }
}

export class ChecklistError extends Error {
  constructor(message: string, public status = 400) { super(message) }
}

async function findBooking(bookingRef: string): Promise<BookingWithPnl> {
  const b = await prisma.booking.findUnique({
    where: { bookingRef },
    include: { pnl: { include: { lineItems: true } } },
  })
  if (!b) throw new ChecklistError('Booking not found', 404)
  if (b.operationCountry !== 'VIETNAM') throw new ChecklistError('The checklist is for Vietnam bookings only', 400)
  return b
}

export async function loadChecklist(bookingRef: string): Promise<ChecklistPayload> {
  const b = await findBooking(bookingRef)
  const live = liveFor(b)
  try {
    const [h, rows] = await Promise.all([
      prisma.vnBookingChecklist.findUnique({ where: { bookingRef } }),
      prisma.vnBookingChecklistItem.findMany({ where: { bookingRef }, orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] }),
    ])
    return { installed: true, exists: !!h || rows.length > 0, booking: bookingInfo(b), header: toHeader(bookingRef, h), items: rows.map(toItem), live }
  } catch (err) {
    if (!isMissingTable(err)) throw err
    return { installed: false, exists: false, booking: bookingInfo(b), header: toHeader(bookingRef, null), items: [], live }
  }
}

export interface SaveInput {
  header: {
    status?: string
    note?: string | null
    revenueUsdOverride?: number | string | null
    exchangeRateOverride?: number | string | null
  }
  items: Partial<ChecklistItem>[]
}

const optNum = (v: unknown): number | null =>
  v === null || v === undefined || String(v).trim() === '' ? null : parseNum(v)

/**
 * Save the whole sheet in one transaction: the header, every row sent, and the
 * removal of rows that were on the sheet but not sent. The delete is scoped to
 * this booking's own rows by id — nothing else can be touched.
 */
export async function saveChecklist(
  bookingRef: string,
  input: SaveInput,
  user: { id: string; name: string | null | undefined; role: string },
): Promise<ChecklistPayload> {
  await findBooking(bookingRef)
  const who = user.name ?? null

  const existingHeader = await prisma.vnBookingChecklist.findUnique({ where: { bookingRef } })
  if (existingHeader?.status === 'FINAL' && !FINAL_EDITORS.includes(user.role)) {
    throw new ChecklistError('This checklist is marked Final — ask Accounts to reopen it', 403)
  }

  const status = (STATUSES as string[]).includes(String(input.header.status)) ? (input.header.status as ChecklistStatus) : 'DRAFT'
  const revenue = optNum(input.header.revenueUsdOverride)
  const rate = optNum(input.header.exchangeRateOverride)
  if (revenue !== null && revenue < 0) throw new ChecklistError('Revenue cannot be negative')
  // A VND rate below 1,000 is almost certainly the workbook's "x1000" shorthand (25.5).
  if (rate !== null && rate < 1000) throw new ChecklistError('The exchange rate is VND per USD — e.g. 25,500, not 25.5')

  const becameChecked = status !== 'DRAFT' && existingHeader?.status !== status

  const existingItems = await prisma.vnBookingChecklistItem.findMany({ where: { bookingRef } })
  const byId = new Map(existingItems.map(i => [i.id, i]))

  const clean = input.items
    .map((it, idx) => ({ it, idx }))
    .filter(({ it }) => String(it.description ?? '').trim() !== '' || parseNum(it.unitPrice) !== 0)

  for (const { it } of clean) {
    if (parseNum(it.quan1) < 0 || parseNum(it.quan2) < 0) throw new ChecklistError('Quantities cannot be negative')
  }

  const keep = new Set<string>()
  const ops: Prisma.PrismaPromise<unknown>[] = []

  for (const { it, idx } of clean) {
    const prev = it.id ? byId.get(it.id) : undefined
    const paidStatus: PaidStatus = (PAID as string[]).includes(String(it.paidStatus)) ? (it.paidStatus as PaidStatus) : 'UNPAID'
    const paidChanged = !prev || prev.paidStatus !== paidStatus
    const data = {
      position: idx,
      serviceDate: it.serviceDate ? new Date(`${it.serviceDate}T00:00:00Z`) : null,
      description: String(it.description ?? '').trim() || '(no details)',
      vendor: String(it.vendor ?? '').trim() || null,
      code: String(it.code ?? '').trim().slice(0, 64) || null,
      unitPrice: parseNum(it.unitPrice),
      unitCurrency: it.unitCurrency === 'USD' ? 'USD' : 'VND',
      quan1: parseNum(it.quan1),
      quan2: parseNum(it.quan2),
      totalOverrideVnd: optNum(it.totalOverrideVnd),
      paidStatus,
      paidVnd: paidStatus === 'UNPAID' ? null : optNum(it.paidVnd),
      ...(paidChanged ? {
        paidAt: paidStatus === 'UNPAID' ? null : new Date(),
        paidByName: paidStatus === 'UNPAID' ? null : who,
      } : {}),
      source: ['CATALOG', 'INCLUDE'].includes(String(it.source)) ? String(it.source) : 'MANUAL',
      productKey: it.productKey ?? null,
      note: String(it.note ?? '').trim().slice(0, 500) || null,
      updatedByName: who,
    }
    if (prev) {
      keep.add(prev.id)
      ops.push(prisma.vnBookingChecklistItem.update({ where: { id: prev.id }, data }))
    } else {
      ops.push(prisma.vnBookingChecklistItem.create({ data: { ...data, bookingRef, createdByName: who } }))
    }
  }

  const removed = existingItems.filter(i => !keep.has(i.id)).map(i => i.id)
  if (removed.length > 0) {
    ops.push(prisma.vnBookingChecklistItem.deleteMany({ where: { bookingRef, id: { in: removed } } }))
  }

  const headerData = {
    status,
    note: String(input.header.note ?? '').trim() || null,
    revenueUsd: revenue,
    exchangeRate: rate,
    updatedByName: who,
    ...(becameChecked ? { checkedById: user.id, checkedByName: who, checkedAt: new Date() } : {}),
    ...(status === 'DRAFT' ? { checkedById: null, checkedByName: null, checkedAt: null } : {}),
  }
  ops.push(prisma.vnBookingChecklist.upsert({
    where: { bookingRef },
    create: { bookingRef, ...headerData, createdById: user.id, createdByName: who },
    update: headerData,
  }))

  await prisma.$transaction(ops)
  return loadChecklist(bookingRef)
}

/**
 * Draft rows from the products already picked on this booking's agenda
 * (Vietnam includes). Returned, not saved — the popup appends them and the
 * operator decides.
 */
export async function draftsFromIncludes(bookingRef: string): Promise<Partial<ChecklistItem>[]> {
  try {
    const rows = await prisma.agendaItemInclude.findMany({
      where: { bookingRef },
      orderBy: [{ itemDate: 'asc' }, { itemSortOrder: 'asc' }, { position: 'asc' }],
    })
    return rows.map(r => ({
      serviceDate: day(r.itemDate),
      description: r.name,
      code: r.code,
      unitPrice: dec(r.unitPriceVnd) ?? 0,
      unitCurrency: 'VND' as const,
      quan1: r.quantity || 1,
      quan2: 1,
      source: 'INCLUDE' as const,
      productKey: r.productKey,
      note: r.itemActivity ? `Agenda: ${r.itemActivity}`.slice(0, 500) : null,
    }))
  } catch (err) {
    if (isMissingTable(err)) return []
    throw err
  }
}

// ─── The board ──────────────────────────────────────────────────────────────

export interface BoardRow {
  booking: ChecklistBookingInfo
  pax: number
  header: ChecklistHeader | null
  totals: ChecklistTotals
  revenueSource: ChecklistLive['revenueSource']
  pnlCostUsd: number | null
}

export async function loadBoard(opts: {
  from: Date; to: Date; q?: string; includeCancelled?: boolean
}): Promise<{ installed: boolean; rows: BoardRow[] }> {
  const where: Prisma.BookingWhereInput = {
    operationCountry: 'VIETNAM',
    arrivalDate: { gte: opts.from, lte: opts.to },
    ...(opts.includeCancelled ? {} : { cancelledAt: null }),
  }
  const q = opts.q?.trim()
  if (q) {
    where.OR = [
      { bookingRef: { contains: q } },
      { agent: { contains: q } },
      { cntlNumber: { contains: q } },
    ]
  }

  const bookings = await prisma.booking.findMany({
    where,
    orderBy: { arrivalDate: 'asc' },
    take: 600,
    include: { pnl: { include: { lineItems: true } } },
  })
  const refs = bookings.map(b => b.bookingRef)

  let headers: HeaderRow[] = []
  let items: ItemRow[] = []
  let installed = true
  try {
    ;[headers, items] = await Promise.all([
      prisma.vnBookingChecklist.findMany({ where: { bookingRef: { in: refs } } }),
      prisma.vnBookingChecklistItem.findMany({ where: { bookingRef: { in: refs } } }),
    ])
  } catch (err) {
    if (!isMissingTable(err)) throw err
    installed = false
  }

  const hBy = new Map(headers.map(h => [h.bookingRef, h]))
  const iBy = new Map<string, ChecklistItem[]>()
  for (const r of items) {
    const list = iBy.get(r.bookingRef) ?? []
    list.push(toItem(r))
    iBy.set(r.bookingRef, list)
  }

  const rows = bookings.map(b => {
    const live = liveFor(b)
    const h = hBy.get(b.bookingRef) ?? null
    const header = toHeader(b.bookingRef, h)
    const list = iBy.get(b.bookingRef) ?? []
    return {
      booking: bookingInfo(b),
      pax: b.paxAdults + b.paxChildren,
      header: h || list.length ? header : null,
      totals: computeTotals(header, list, live),
      revenueSource: live.revenueSource,
      pnlCostUsd: live.pnlCostUsd,
    }
  })

  return { installed, rows }
}
