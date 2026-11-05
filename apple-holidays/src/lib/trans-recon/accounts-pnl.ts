/**
 * The Accounts P&L as P&L lines a Trans-Reconsultation line can point at.
 *
 * Many Singapore / Malaysia files carry no P&L lines in OPS: their costing
 * lives in the Accounts system's Detailed P&L (pnl_records.as_payload), which
 * OPS already reads — read-only — for the booking page's costing sheet (see
 * src/lib/detailed-pnl). This turns that sheet's rows into lines: transport
 * and tour transfers, attractions, meals, other charges, and the stays.
 *
 * Ids are `acc:<pnl_records.id>:<section>:<row>`. They are stable while the
 * Accounts P&L does not change; resolveAccountsLine() re-derives the row
 * rather than trusting a value sent by the browser, and says so when the
 * P&L moved under a pick.
 */
import { prisma } from '@/lib/prisma'
import { isLoaded, loadDetailedPnl, missMessage } from '@/lib/detailed-pnl'

export interface AccountsPnlLine {
  id: string
  activity: string
  /** Same vocabulary as OPS PNLCategory, so the movement matcher reads both alike. */
  category: string
  value: number
  section: 'transport' | 'transfers' | 'products' | 'meals' | 'others' | 'stays'
}

export interface AccountsPnl {
  available: boolean
  message?: string
  currency: string | null
  label: string | null
  lines: AccountsPnlLine[]
}

const clean = (s: unknown) => String(s ?? '').replace(/\s+/g, ' ').trim()
const r2 = (n: number) => Math.round(n * 100) / 100

/** Never throws — an unreachable Accounts DB is an `available: false` with the reason. */
export async function accountsPnlLines(bookingRef: string): Promise<AccountsPnl> {
  const b = await prisma.booking.findUnique({
    where: { bookingRef },
    select: { bookingRef: true, isNumber: true, agentBookingId: true },
  })
  if (!b) return { available: false, message: 'Booking not found in OPS.', currency: null, label: null, lines: [] }

  let res
  try {
    res = await loadDetailedPnl({ isNumber: b.isNumber, tourRef: b.bookingRef, invoiceNumber: b.agentBookingId })
  } catch (err) {
    console.error('[trans-recon] Accounts P&L read failed:', err)
    return { available: false, message: 'Could not reach the Accounts database.', currency: null, label: null, lines: [] }
  }
  if (!isLoaded(res)) return { available: false, message: missMessage(res), currency: null, label: null, lines: [] }

  const { record, payload, detail } = res
  const t = detail.tables
  const id = (section: string, i: number) => `acc:${record.id}:${section}:${i}`
  const lines: AccountsPnlLine[] = []
  const push = (l: AccountsPnlLine) => { if (l.activity && Number.isFinite(l.value) && l.value > 0) lines.push(l) }

  t.transport.forEach((row, i) => {
    if (row.info) return
    push({ id: id('transport', i), activity: [clean(row.desc), clean(row.sub)].filter(Boolean).join(' — '), category: 'TRANSPORT', value: r2(row.total), section: 'transport' })
  })
  t.transfers.forEach((row, i) => push({
    id: id('transfers', i), activity: `${clean(row.name)}${row.day ? ` (Day ${row.day})` : ''}`, category: 'TRANSPORT', value: r2(row.total), section: 'transfers',
  }))
  t.products.forEach((row, i) => push({
    id: id('products', i), activity: `${clean(row.name)}${row.day ? ` (Day ${row.day})` : ''}`, category: 'TICKETS', value: r2(row.total), section: 'products',
  }))
  t.meals.forEach((row, i) => push({ id: id('meals', i), activity: `Day ${row.day} meals`, category: 'MEALS', value: r2(row.total), section: 'meals' }))
  t.mealExtras.forEach((row, i) => push({ id: id('mealx', i), activity: [clean(row.label), clean(row.slot)].filter(Boolean).join(' — '), category: 'MEALS', value: r2(row.total), section: 'meals' }))
  t.others.forEach((row, i) => push({ id: id('others', i), activity: [clean(row.desc), clean(row.sub)].filter(Boolean).join(' — '), category: 'OTHER', value: r2(row.total), section: 'others' }))
  t.stays.forEach((row, i) => push({ id: id('stays', i), activity: `${clean(row.name)}${row.nights ? ` · ${row.nights}N` : ''}`, category: 'HOTEL', value: r2(row.total), section: 'stays' }))

  const label = [record.is_number && `IS ${record.is_number}`, payload.quotation_no && `quote ${payload.quotation_no}`, payload.revision != null && `rev ${payload.revision}`].filter(Boolean).join(' · ') || null
  return { available: true, currency: detail.currency || payload.summary?.currency || null, label, lines }
}

/** Re-derive one picked Accounts row, or say the P&L moved. */
export async function resolveAccountsLine(bookingRef: string, lineId: string): Promise<(AccountsPnlLine & { currency: string }) | null> {
  const p = await accountsPnlLines(bookingRef)
  const hit = p.lines.find(l => l.id === lineId)
  return hit ? { ...hit, currency: p.currency || 'USD' } : null
}
