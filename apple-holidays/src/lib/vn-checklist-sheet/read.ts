/**
 * Checklist VN 2.1v — reads for the booking panel and the board. Never touches
 * the workbook; everything comes from the mirrored tables.
 */
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { refsInCode, type PaidBucket, type SheetEvent, type SheetLine, type SheetTour } from './shared'

const num = (v: Prisma.Decimal | number | null | undefined) => (v === null || v === undefined ? null : Number(v))
const iso = (v: Date | null) => (v ? v.toISOString().slice(0, 10) : null)

type TourRow = Awaited<ReturnType<typeof prisma.vnSheetTour.findFirstOrThrow>>
type LineRow = Awaited<ReturnType<typeof prisma.vnSheetLine.findFirstOrThrow>>
type EventRow = Awaited<ReturnType<typeof prisma.vnSheetEvent.findFirstOrThrow>>

export function toTour(t: TourRow): SheetTour {
  return {
    tourCode: t.tourCode,
    refs: refsInCode(t.tourCode),
    agent: t.agent,
    agentRef: t.agentRef,
    pax: t.pax,
    monthLabel: t.monthLabel,
    arrivalDate: iso(t.arrivalDate),
    departureDate: iso(t.departureDate),
    days: t.days,
    itinerary: t.itinerary,
    quotedUsd: num(t.quotedUsd),
    revenueUsd: num(t.revenueUsd),
    totalVnd: num(t.totalVnd),
    totalEstimateVnd: num(t.totalEstimateVnd),
    pnlIncurredVnd: num(t.pnlIncurredVnd),
    profitMargin: num(t.profitMargin),
    exchangeRate: num(t.exchangeRate),
    lineCount: t.lineCount,
    linesTotalVnd: Number(t.linesTotalVnd),
    paidLineCount: t.paidLineCount,
    checkLineCount: t.checkLineCount,
    openLineCount: t.openLineCount,
    sheetTab: t.sheetTab,
    sheetRow: t.sheetRow,
    isActive: t.isActive,
    firstSeenAt: t.firstSeenAt.toISOString(),
    changedAt: t.changedAt.toISOString(),
  }
}

export function toLine(l: LineRow): SheetLine {
  return {
    id: l.id,
    position: l.position,
    sheetRow: l.sheetRow,
    details: l.details,
    vendor: l.vendor,
    code: l.code,
    dates: l.dates,
    qcStatus: l.qcStatus,
    unitPrice: num(l.unitPrice),
    quan1: num(l.quan1),
    quan2: num(l.quan2),
    totalEstimateVnd: num(l.totalEstimateVnd),
    paidRaw: l.paidRaw,
    paidBucket: l.paidBucket as PaidBucket,
    incurred: l.incurred,
    note: l.note,
  }
}

function toEvent(e: EventRow): SheetEvent {
  let changes: SheetEvent['changes'] = []
  try { changes = e.changes ? JSON.parse(e.changes) : [] } catch { /* keep empty */ }
  return { id: e.id, kind: e.kind as SheetEvent['kind'], summary: e.summary, changes, createdAt: e.createdAt.toISOString() }
}

/**
 * Every tour on the sheet for one booking. A booking ref can sit in a combined
 * code ("VN15137/VN17876"), so this matches the ref anywhere in the code.
 */
export async function toursForBooking(bookingRef: string) {
  const ref = refsInCode(bookingRef)[0] ?? bookingRef.trim().toUpperCase()
  const tours = await prisma.vnSheetTour.findMany({
    where: { OR: [{ primaryRef: ref }, { refKey: { contains: `,${ref},` } }, { tourCode: bookingRef }] },
    orderBy: [{ isActive: 'desc' }, { arrivalDate: 'desc' }],
    take: 5,
  })
  if (!tours.length) return []
  const codes = tours.map(t => t.tourCode)
  const [lines, events] = await Promise.all([
    prisma.vnSheetLine.findMany({ where: { tourCode: { in: codes } }, orderBy: [{ tourCode: 'asc' }, { position: 'asc' }] }),
    prisma.vnSheetEvent.findMany({ where: { tourCode: { in: codes } }, orderBy: { createdAt: 'desc' }, take: 30 }),
  ])
  return tours.map(t => ({
    ...toTour(t),
    lines: lines.filter(l => l.tourCode === t.tourCode).map(toLine),
    events: events.filter(e => e.tourCode === t.tourCode).map(toEvent),
  }))
}

// ── Board ────────────────────────────────────────────────────────────────────

export interface BoardQuery {
  q?: string
  month?: string          // yyyy-mm, by arrival
  agent?: string
  status?: 'all' | 'open' | 'check' | 'settled' | 'loss'
  includeRemoved?: boolean
  sort?: 'arrival' | 'arrival_desc' | 'pnl' | 'margin' | 'changed'
  page?: number
  pageSize?: number
}

function boardWhere(q: BoardQuery): Prisma.VnSheetTourWhereInput {
  const and: Prisma.VnSheetTourWhereInput[] = []
  if (!q.includeRemoved) and.push({ isActive: true })
  const text = q.q?.trim()
  if (text) {
    and.push({
      OR: [
        { tourCode: { contains: text } }, { agent: { contains: text } },
        { agentRef: { contains: text } }, { itinerary: { contains: text } },
      ],
    })
  }
  if (q.month && /^\d{4}-\d{2}$/.test(q.month)) {
    const [y, m] = q.month.split('-').map(Number)
    and.push({ arrivalDate: { gte: new Date(Date.UTC(y, m - 1, 1)), lt: new Date(Date.UTC(y, m, 1)) } })
  }
  if (q.agent?.trim()) and.push({ agent: { contains: q.agent.trim() } })
  if (q.status === 'open') and.push({ openLineCount: { gt: 0 } })
  if (q.status === 'check') and.push({ checkLineCount: { gt: 0 } })
  if (q.status === 'settled') and.push({ openLineCount: 0, checkLineCount: 0, lineCount: { gt: 0 } })
  if (q.status === 'loss') and.push({ pnlIncurredVnd: { lt: 0 } })
  return and.length ? { AND: and } : {}
}

export async function boardTours(q: BoardQuery) {
  const where = boardWhere(q)
  const pageSize = Math.min(Math.max(q.pageSize ?? 50, 10), 200)
  const page = Math.max(q.page ?? 1, 1)
  const orderBy: Prisma.VnSheetTourOrderByWithRelationInput[] =
    q.sort === 'arrival_desc' ? [{ arrivalDate: 'desc' }]
      : q.sort === 'pnl' ? [{ pnlIncurredVnd: 'asc' }]
        : q.sort === 'margin' ? [{ profitMargin: 'asc' }]
          : q.sort === 'changed' ? [{ changedAt: 'desc' }]
            : [{ arrivalDate: 'asc' }]

  const [rows, total, agg, buckets] = await Promise.all([
    prisma.vnSheetTour.findMany({ where, orderBy, skip: (page - 1) * pageSize, take: pageSize }),
    prisma.vnSheetTour.count({ where }),
    prisma.vnSheetTour.aggregate({
      where,
      _sum: { revenueUsd: true, totalVnd: true, totalEstimateVnd: true, pnlIncurredVnd: true, pax: true, lineCount: true, paidLineCount: true, checkLineCount: true, openLineCount: true },
    }),
    prisma.vnSheetTour.groupBy({ by: ['agent'], where, _count: { _all: true }, orderBy: { _count: { agent: 'desc' } }, take: 8 }),
  ])

  // Which of these tours OPS already has as a booking — for the "open booking" link.
  const refs = Array.from(new Set(rows.flatMap(r => refsInCode(r.tourCode))))
  const known = refs.length
    ? await prisma.booking.findMany({ where: { bookingRef: { in: refs } }, select: { bookingRef: true } })
    : []
  const knownSet = new Set(known.map(b => b.bookingRef))

  const s = agg._sum
  const totalVnd = num(s.totalVnd) ?? 0
  const pnl = num(s.pnlIncurredVnd) ?? 0
  return {
    tours: rows.map(r => ({ ...toTour(r), inOps: refsInCode(r.tourCode).filter(x => knownSet.has(x)) })),
    total,
    page,
    pageSize,
    summary: {
      tours: total,
      pax: s.pax ?? 0,
      revenueUsd: num(s.revenueUsd) ?? 0,
      totalVnd,
      totalEstimateVnd: num(s.totalEstimateVnd) ?? 0,
      pnlIncurredVnd: pnl,
      margin: totalVnd ? pnl / totalVnd : null,
      lines: s.lineCount ?? 0,
      paidLines: s.paidLineCount ?? 0,
      checkLines: s.checkLineCount ?? 0,
      openLines: s.openLineCount ?? 0,
    },
    agents: buckets.map(b => ({ agent: b.agent ?? '—', tours: b._count._all })),
  }
}

/** Lines for one tour on the board's expand. */
export async function linesForTour(tourCode: string) {
  const lines = await prisma.vnSheetLine.findMany({ where: { tourCode }, orderBy: { position: 'asc' } })
  return lines.map(toLine)
}
