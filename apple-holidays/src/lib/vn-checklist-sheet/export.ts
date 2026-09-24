/**
 * Checklist VN 2.1v — build an .xlsx from the mirror, in the desk's own layout
 * (a header row per tour, its payment lines under it), plus a flat "Lines" tab
 * that filters and pivots cleanly. Nothing here reaches SharePoint.
 */
import * as XLSX from 'xlsx'
import { prisma } from '@/lib/prisma'
import { PAID_BUCKETS, type PaidBucket } from './shared'

const HEADER = [
  'TOUR CODE', 'AGENT', 'NO OF PAX', 'MONTH', 'ARRIVAL', 'DEPARTURE', 'NO OF DAY', 'ITINERARY',
  'DETAILS FOR PAYMENT', 'VENDORS', 'CODE', 'DATES', 'Status (Quality check)', 'UNIT PRICE', 'QUAN1', 'QUAN2',
  'Total estimate', 'Paid', 'Incurred', 'Note', 'REVENUE USD', 'Total VND', 'PNL incurred', 'Profit margin',
]

const n = (v: unknown) => (v === null || v === undefined ? null : Number(v))
const day = (v: Date | null) => (v ? v.toISOString().slice(0, 10) : null)

export async function buildMirrorWorkbook(opts: { tourCodes?: string[]; activeOnly?: boolean } = {}): Promise<Buffer> {
  const where = {
    ...(opts.tourCodes ? { tourCode: { in: opts.tourCodes } } : {}),
    ...(opts.activeOnly === false ? {} : { isActive: true }),
  }
  const tours = await prisma.vnSheetTour.findMany({ where, orderBy: [{ sheetTab: 'asc' }, { sheetRow: 'asc' }] })
  const codes = tours.map(t => t.tourCode)
  const lines = codes.length
    ? await prisma.vnSheetLine.findMany({
      where: opts.tourCodes ? { tourCode: { in: codes } } : {},
      orderBy: [{ tourCode: 'asc' }, { position: 'asc' }],
    })
    : []
  const linesBy = new Map<string, typeof lines>()
  for (const l of lines) linesBy.set(l.tourCode, [...(linesBy.get(l.tourCode) ?? []), l])

  const sheet: (string | number | null)[][] = [HEADER]
  const flat: (string | number | null)[][] = [[
    'Tour code', 'Agent', 'Arrival', 'Details for payment', 'Vendor', 'Code', 'Dates', 'Unit price',
    'Quan1', 'Quan2', 'Total estimate (VND)', 'Paid (as typed)', 'Paid status', 'Note',
  ]]

  for (const t of tours) {
    sheet.push([
      t.tourCode, t.agent, t.pax, t.monthLabel, day(t.arrivalDate), day(t.departureDate), t.days, t.itinerary,
      n(t.quotedUsd), null, null, null, null, null, null, null,
      n(t.totalEstimateVnd), null, null, null, n(t.revenueUsd), n(t.totalVnd), n(t.pnlIncurredVnd), n(t.profitMargin),
    ])
    for (const [i, l] of Array.from((linesBy.get(t.tourCode) ?? []).entries())) {
      sheet.push([
        t.tourCode, i === 0 ? t.agentRef : null, null, null, null, null, null, null,
        l.details, l.vendor, l.code, l.dates, l.qcStatus, n(l.unitPrice), n(l.quan1), n(l.quan2),
        n(l.totalEstimateVnd), l.paidRaw, l.incurred, l.note, null, null, null, null,
      ])
      flat.push([
        t.tourCode, t.agent, day(t.arrivalDate), l.details, l.vendor, l.code, l.dates, n(l.unitPrice),
        n(l.quan1), n(l.quan2), n(l.totalEstimateVnd), l.paidRaw,
        PAID_BUCKETS[l.paidBucket as PaidBucket]?.label ?? l.paidBucket, l.note,
      ])
    }
  }

  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.aoa_to_sheet(sheet)
  ws['!cols'] = HEADER.map((h, i) => ({ wch: i === 8 ? 60 : i === 7 ? 18 : Math.max(10, Math.min(h.length + 2, 16)) }))
  ws['!freeze'] = { xSplit: 1, ySplit: 1 }
  XLSX.utils.book_append_sheet(wb, ws, 'Checklist')
  const wf = XLSX.utils.aoa_to_sheet(flat)
  wf['!cols'] = [{ wch: 12 }, { wch: 14 }, { wch: 11 }, { wch: 60 }, { wch: 16 }, { wch: 10 }, { wch: 10 }, { wch: 12 }, { wch: 7 }, { wch: 7 }, { wch: 16 }, { wch: 14 }, { wch: 14 }, { wch: 30 }]
  XLSX.utils.book_append_sheet(wb, wf, 'Lines')
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer
}
